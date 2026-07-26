from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
AUTOMATION_ROOT = SCRIPT_DIR.parent
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from shared.config import ConfigError, config_path, config_str_list, load_config
from shared.report import now_iso, report_status, standard_report, write_report

try:
    import fitz
except ImportError:
    fitz = None


def extract_text(pdf: Path, max_pages: int) -> str:
    if fitz is None:
        raise RuntimeError("PyMuPDF is not installed. Install the managed automation requirements.")
    with fitz.open(pdf) as document:
        pages = []
        for page in list(document)[:max_pages]:
            pages.append(page.get_text("text"))
    return "\n\n".join(pages).strip()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def run(args: argparse.Namespace) -> int:
    started_at = now_iso()
    if args.max_pages < 1:
        raise ConfigError("--max-pages must be at least 1.")
    config = load_config(args.config)
    base = args.config.resolve().parent
    source = args.source or config_path(
        config, "paths", "scanCacheDir", Path(r"C:\InnPilot\Scans\IncomingCache"), base
    )
    destination = args.destination or config_path(
        config, "paths", "contractOcrTextDir", Path(r"C:\InnPilot\OCR\ScansText"), base
    )
    prefixes = config_str_list(
        config, "contracts", "scannerFilePrefixes", "scannerFilePrefix", ["Sharp MFP"]
    )
    normalized = [prefix.casefold() for prefix in prefixes if prefix.strip()]
    if not source.is_dir():
        raise NotADirectoryError(f"Local scan cache not found: {source}")
    pdfs = sorted(
        (
            path
            for path in source.iterdir()
            if path.is_file()
            and path.suffix.casefold() == ".pdf"
            and (not normalized or any(path.name.casefold().startswith(prefix) for prefix in normalized))
        ),
        key=lambda path: path.name.casefold(),
    )

    report_path = args.json_report or destination / "extract_scan_text_report.json"
    items: list[dict] = []
    warnings: list[str] = []
    errors: list[str] = []
    extracted = 0
    planned = 0
    skipped = 0

    for pdf in pdfs:
        target = destination / f"{pdf.stem}.txt"
        if target.exists() and target.stat().st_mtime >= pdf.stat().st_mtime:
            skipped += 1
            items.append({"sourcePath": str(pdf), "textPath": str(target), "status": "skipped_current"})
            continue
        try:
            text = extract_text(pdf, args.max_pages)
        except Exception as error:
            errors.append(f"Could not read {pdf.name}: {error}")
            items.append({"sourcePath": str(pdf), "textPath": str(target), "status": "failed"})
            continue
        if not text:
            warnings.append(
                f"{pdf.name} has no embedded text. Image-only OCR is not installed; the PDF was left unchanged."
            )
            items.append({"sourcePath": str(pdf), "textPath": str(target), "status": "needs_image_ocr"})
            continue
        if args.dry_run:
            planned += 1
            status = "planned_text_output"
        else:
            atomic_write_text(target, text)
            extracted += 1
            status = "text_written"
        items.append({"sourcePath": str(pdf), "textPath": str(target), "status": status})

    summary = {
        "found": len(pdfs),
        "processed": len(pdfs),
        "planned": planned,
        "created": extracted,
        "skipped": skipped,
        "failed": len(errors),
        "warnings": len(warnings),
    }
    write_report(
        report_path,
        standard_report(
            workflow="document_text_extraction",
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
    print(f"PDFs found: {len(pdfs)} | text files: {extracted} | planned: {planned} | warnings: {len(warnings)}")
    print(f"Report: {report_path}")
    return 2 if errors else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract embedded text from searchable scanner PDFs without modifying the originals.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json-report", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    try:
        raise SystemExit(run(parse_args()))
    except (ConfigError, OSError, RuntimeError) as error:
        print(f"Document reading error: {error}", file=sys.stderr)
        raise SystemExit(2)
