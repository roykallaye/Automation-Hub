from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def report_status(failed: int = 0, warnings: int = 0) -> str:
    if failed:
        return "failed"
    if warnings:
        return "needs_attention"
    return "success"


def standard_report(
    *,
    workflow: str,
    mode: str,
    started_at: str,
    finished_at: str,
    status: str,
    summary: dict[str, int],
    items: list[dict[str, Any]],
    warnings: list[str],
    errors: list[str],
    report_path: Path,
    log_path: Path | None = None,
) -> dict[str, Any]:
    return {
        "workflow": workflow,
        "mode": mode,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "status": status,
        "summary": summary,
        "items": items,
        "warnings": warnings,
        "errors": errors,
        "outputs": {
            "reportPath": str(report_path),
            "logPath": str(log_path) if log_path else None,
        },
    }


def write_report(report_path: Path, report: dict[str, Any]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
