from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


class ConfigError(RuntimeError):
    """Raised when an automation config file is missing or invalid."""


def load_config(config_path: Path | None) -> dict[str, Any]:
    if config_path is None:
        return {}

    path = Path(config_path).expanduser()
    if not path.exists():
        raise ConfigError(f"Config file not found: {path}")
    if not path.is_file():
        raise ConfigError(f"Config path is not a file: {path}")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ConfigError(f"Config file is not valid JSON: {path} ({error})") from error

    if not isinstance(data, dict):
        raise ConfigError(f"Config root must be a JSON object: {path}")

    return data


def section(config: dict[str, Any], name: str) -> dict[str, Any]:
    value = config.get(name, {})
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"Config section '{name}' must be an object.")
    return value


def config_value(
    config: dict[str, Any],
    section_name: str,
    key: str,
    fallback: Any = None,
) -> Any:
    return section(config, section_name).get(key, fallback)


def config_bool(
    config: dict[str, Any],
    section_name: str,
    key: str,
    fallback: bool,
) -> bool:
    value = config_value(config, section_name, key, fallback)
    if isinstance(value, bool):
        return value
    raise ConfigError(f"Config value '{section_name}.{key}' must be true or false.")


def config_str(
    config: dict[str, Any],
    section_name: str,
    key: str,
    fallback: str,
) -> str:
    value = config_value(config, section_name, key, fallback)
    if value is None:
        return fallback
    if not isinstance(value, str):
        raise ConfigError(f"Config value '{section_name}.{key}' must be a string.")
    return value


def config_str_list(
    config: dict[str, Any],
    section_name: str,
    list_key: str,
    string_key: str,
    fallback: list[str],
) -> list[str]:
    value = config_value(config, section_name, list_key, None)
    if value is None:
        legacy_value = config_value(config, section_name, string_key, None)
        if legacy_value is None:
            return fallback
        value = legacy_value

    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        raise ConfigError(
            f"Config value '{section_name}.{list_key}' must be a string or list of strings."
        )

    result: list[str] = []
    for index, item in enumerate(values):
        if not isinstance(item, str):
            raise ConfigError(
                f"Config value '{section_name}.{list_key}' item #{index + 1} must be a string."
            )
        if item.strip():
            result.append(item.strip())

    return result or fallback


def config_path(
    config: dict[str, Any],
    section_name: str,
    key: str,
    fallback: Path,
    base_dir: Path | None = None,
) -> Path:
    value = config_value(config, section_name, key, None)
    if value in (None, ""):
        return fallback
    if not isinstance(value, str):
        raise ConfigError(f"Config value '{section_name}.{key}' must be a path string.")
    return resolve_path(value, base_dir=base_dir)


def resolve_path(value: str, base_dir: Path | None = None) -> Path:
    expanded = os.path.expandvars(value)
    path = Path(expanded).expanduser()
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    return path


def recipient_rules(
    config: dict[str, Any],
    fallback: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    raw_rules = config_value(config, "invoice", "recipientRules", None)
    if raw_rules is None:
        return fallback
    if not isinstance(raw_rules, list):
        raise ConfigError("Config value 'invoice.recipientRules' must be a list.")

    rules: list[tuple[str, str]] = []
    for index, rule in enumerate(raw_rules):
        if isinstance(rule, dict):
            match = rule.get("match")
            email = rule.get("email")
        elif isinstance(rule, list | tuple) and len(rule) == 2:
            match, email = rule
        else:
            raise ConfigError(
                f"Recipient rule #{index + 1} must be an object with match/email."
            )

        if not isinstance(match, str) or not isinstance(email, str):
            raise ConfigError(
                f"Recipient rule #{index + 1} must contain string match and email values."
            )
        if not match.strip() or not email.strip():
            raise ConfigError(f"Recipient rule #{index + 1} cannot be empty.")
        rules.append((match.strip(), email.strip()))

    return rules
