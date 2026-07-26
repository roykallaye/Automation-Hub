from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
AUTOMATION_ROOT = SCRIPT_DIR.parent
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from shared.config import ConfigError, config_path, config_str_list, config_value, load_config, resolve_path
from shared.report import now_iso, report_status, standard_report, write_report
from shared.safe_files import copy_verified_atomic, same_file_contents


def matching_pdfs(source: Path, prefixes: list[str]) -> list[Path]:
    if not source.is_dir():
        raise NotADirectoryError(f"Scan source folder not found: {source}")
    normalized = [prefix.casefold() for prefix in prefixes if prefix.strip()]
    return sorted(
        (
            path
            for path in source.iterdir()
            if path.is_file()
            and path.suffix.casefold() == ".pdf"
            and (not normalized or any(path.name.casefold().startswith(prefix) for prefix in normalized))
        ),
        key=lambda path: path.name.casefold(),
    )


def unique_destination(destination: Path, source: Path, reserved: set[Path]) -> tuple[Path, bool]:
    candidate = destination / source.name
    if candidate.exists() and same_file_contents(source, candidate):
        return candidate, True
    if not candidate.exists() and candidate not in reserved:
        reserved.add(candidate)
        return candidate, False

    counter = 2
    while True:
        candidate = destination / f"{source.stem} ({counter}){source.suffix}"
        if not candidate.exists() and candidate not in reserved:
            reserved.add(candidate)
            return candidate, False
        counter += 1


def run(args: argparse.Namespace) -> int:
    started_at = now_iso()
    config = load_config(args.config)
    base = args.config.resolve().parent
    source = args.source
    if source is None:
        configured_source = config_value(config, "paths", "scanSourceDir", None)
        if configured_source in (None, ""):
            configured_source = config_value(config, "paths", "contractInputDir", None)
        if not isinstance(configured_source, str) or not configured_source.strip():
            raise ConfigError("Configure paths.scanSourceDir before running scan copy.")
        source = resolve_path(configured_source, base)
    destination = args.destination or config_path(
        config, "paths", "scanCacheDir", Path(r"C:\InnPilot\Scans\IncomingCache"), base
    )
    prefixes = config_str_list(
        config, "contracts", "scannerFilePrefixes", "scannerFilePrefix", ["Sharp MFP"]
    )
    if source.resolve() == destination.resolve():
        raise ConfigError("Scan source and local cache must be different folders.")

    report_path = args.json_report or destination / "copy_scans_report.json"
    items: list[dict] = []
    warnings: list[str] = []
    errors: list[str] = []
    copied = 0
    skipped = 0
    planned = 0
    reserved: set[Path] = set()

    pdfs = matching_pdfs(source, prefixes)
    if not args.dry_run:
        destination.mkdir(parents=True, exist_ok=True)

    for pdf in pdfs:
        target, already_copied = unique_destination(destination, pdf, reserved)
        if already_copied:
            skipped += 1
            items.append({"sourcePath": str(pdf), "destinationPath": str(target), "status": "skipped_existing"})
            continue
        if args.dry_run:
            planned += 1
            status = "planned_copy"
        else:
            try:
                copy_verified_atomic(pdf, target)
                copied += 1
                status = "copied"
            except OSError as error:
                errors.append(f"Could not copy {pdf.name}: {error}")
                items.append({"sourcePath": str(pdf), "destinationPath": str(target), "status": "failed"})
                continue
        items.append({"sourcePath": str(pdf), "destinationPath": str(target), "status": status})

    summary = {
        "found": len(pdfs),
        "processed": len(pdfs),
        "planned": planned,
        "copied": copied,
        "skipped": skipped,
        "failed": len(errors),
        "warnings": len(warnings),
    }
    write_report(
        report_path,
        standard_report(
            workflow="scan_copy",
            mode="dry_run" if args.dry_run else "execute",
            started_at=started_at,
            finished_at=now_iso(),
            status=report_status(len(errors), len(warnings)),
            summary=summary,
            items=items,
            warnings=warnings,
            errors=errors,
            report_path=report_path,
        ),
    )
    print(f"Scans found: {len(pdfs)} | copied: {copied} | planned: {planned} | skipped: {skipped}")
    print(f"Report: {report_path}")
    return 2 if errors else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Copy new scanner PDFs into the InnPilot local cache without changing originals.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json-report", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    try:
        raise SystemExit(run(parse_args()))
    except (ConfigError, OSError) as error:
        print(f"Scan copy error: {error}", file=sys.stderr)
        raise SystemExit(2)
