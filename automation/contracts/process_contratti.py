import argparse
import datetime as dt
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.config import (  # noqa: E402
    ConfigError,
    config_path,
    config_str,
    config_value,
    load_config,
    resolve_path,
)
from shared.report import now_iso, report_status, standard_report, write_report  # noqa: E402


SHORTCUT_PATH = Path(r"C:\Users\back-office-life\Desktop\Scansioni.lnk")
DESTINATION_DIR = Path(r"C:\Users\back-office-life\Desktop\Life Hotel\Staff\2026\CONTRATTI FIRMATI")
LOG_DIR = Path(r"C:\Users\back-office-life\Desktop\Fatture\Log")
OCR_TEXT_DIR = Path(r"C:\Users\back-office-life\Documents\CodexInput\ScansioniText")

FILE_PREFIX = "Sharp MFP"
CONTRACT_MARKER = "Oggetto: Contratto di lavoro subordinato a tempo determinato"


def setup_logging(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = log_dir / f"process_contratti_{timestamp}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return log_path


def resolve_shortcut_target(shortcut_path: Path) -> Path:
    if not shortcut_path.exists():
        raise FileNotFoundError(f"Shortcut not found: {shortcut_path}")

    command = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "$shell = New-Object -ComObject WScript.Shell; "
        "$shortcut = $shell.CreateShortcut($env:CONTRATTI_SHORTCUT_PATH); "
        "Write-Output $shortcut.TargetPath"
    )
    environment = os.environ.copy()
    environment["CONTRATTI_SHORTCUT_PATH"] = str(shortcut_path)
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        env=environment,
    )
    target = completed.stdout.strip()
    if completed.returncode != 0 or not target:
        error = completed.stderr.strip() or "Shortcut target was empty."
        raise RuntimeError(f"Could not resolve shortcut target {shortcut_path}: {error}")

    return Path(target)


def normalize_for_search(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def contains_contract_marker(text: str) -> bool:
    normalized_text = normalize_for_search(text)
    normalized_marker = normalize_for_search(CONTRACT_MARKER)
    if normalized_marker in normalized_text:
        return True

    flexible_marker = re.compile(
        r"oggetto\s*:?\s*contratto\s+di\s+lavoro\s+subordinato\s+a\s+tempo\s+determinato",
        re.IGNORECASE,
    )
    return bool(flexible_marker.search(text))


def clean_employee_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name).strip()
    name = name.strip(" \t\r\n.,;:!?()[]{}\"'`´“”‘’")
    name = re.sub(r"\s+", " ", name).strip()
    return name


def sanitize_filename_part(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*]', " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = value.rstrip(". ")
    return value


def extract_employee_name(page_text: str) -> str | None:
    normalized = re.sub(r"\s+", " ", page_text).strip()

    premesso_match = re.search(r"\bpremesso\s+che\b", normalized, flags=re.IGNORECASE)
    search_area = normalized[premesso_match.end():] if premesso_match else normalized

    point_b_match = re.search(r"(?:^|\s)b\s*[\).:-]\s*", search_area, flags=re.IGNORECASE)
    if point_b_match:
        search_area = search_area[point_b_match.end():]

    name_end = r"all[’'`´]?\s*esito\s+del\s+colloquio\s+di\s+selezione"
    title = r"(?:il|la)\s+s(?:ig|1g|íg|iq)\.?\s*(?:r\s*\.?\s*a|ra)?\.?"
    pattern = re.compile(
        rf"\b{title}\s+(?P<name>.+?)\s+{name_end}",
        flags=re.IGNORECASE,
    )
    match = pattern.search(search_area)
    if not match:
        return None

    cleaned = clean_employee_name(match.group("name"))
    return cleaned or None


def matching_pdfs(input_dir: Path) -> list[Path]:
    if not input_dir.exists():
        raise FileNotFoundError(f"Input folder not found: {input_dir}")
    if not input_dir.is_dir():
        raise NotADirectoryError(f"Input path is not a folder: {input_dir}")

    files = []
    for path in input_dir.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() != ".pdf":
            continue
        if not path.name.startswith(FILE_PREFIX):
            continue
        files.append(path)
    return sorted(files, key=lambda item: item.name.lower())


def matching_text_path(pdf_path: Path, text_dir: Path) -> Path:
    return text_dir / f"{pdf_path.stem}.txt"


def read_ocr_text(text_path: Path) -> str:
    return text_path.read_text(encoding="utf-8-sig", errors="replace")


def unique_destination_path(destination_dir: Path, filename: str, reserved_paths: set[Path]) -> Path:
    candidate = destination_dir / filename
    if not candidate.exists() and candidate not in reserved_paths:
        reserved_paths.add(candidate)
        return candidate

    stem = Path(filename).stem
    suffix = Path(filename).suffix
    counter = 2
    while True:
        candidate = destination_dir / f"{stem} ({counter}){suffix}"
        if not candidate.exists() and candidate not in reserved_paths:
            reserved_paths.add(candidate)
            return candidate
        counter += 1


def identify_contract_from_text(pdf_path: Path, text_dir: Path) -> tuple[bool, str | None, Path | None, bool]:
    text_path = matching_text_path(pdf_path, text_dir)
    if not text_path.exists():
        return False, None, text_path, True

    logging.info("Matching TXT found: %s -> %s", pdf_path, text_path)
    text = read_ocr_text(text_path)
    if not contains_contract_marker(text):
        return False, None, text_path, False

    employee_name = extract_employee_name(text)
    return True, employee_name, text_path, False


def build_target_filename(employee_name: str | None) -> tuple[str, bool]:
    if not employee_name:
        return "Contratto_SENZA_NOME.pdf", True

    safe_name = sanitize_filename_part(employee_name)
    if not safe_name:
        return "Contratto_SENZA_NOME.pdf", True

    return f"Contratto_{safe_name}.pdf", False


def default_report_path(log_path: Path) -> Path:
    name = log_path.name.replace("process_contratti_", "report_contratti_").replace(".log", ".json")
    return log_path.with_name(name)


def write_contract_report(
    *,
    report_path: Path,
    log_path: Path,
    args: argparse.Namespace,
    started_at: str,
    status: str,
    summary: dict[str, int],
    items: list[dict],
    warnings: list[str],
    errors: list[str],
) -> None:
    report = {
        **standard_report(
            workflow="contracts",
            mode="execute" if args.execute else "dry_run",
            started_at=started_at,
            finished_at=now_iso(),
            status=status,
            summary=summary,
            items=items,
            warnings=warnings,
            errors=errors,
            report_path=report_path,
            log_path=log_path,
        ),
        "details": {
            "inputFolder": str(args.input_dir) if args.input_dir else None,
            "inputShortcut": str(args.input_shortcut),
            "destinationFolder": str(args.destination_dir),
            "ocrTextFolder": str(args.ocr_text_dir),
        },
    }
    write_report(report_path, report)


def process(args: argparse.Namespace) -> int:
    started_at = now_iso()
    log_path = setup_logging(args.log_dir)
    report_path = args.json_report or default_report_path(log_path)
    logging.info("Mode: %s", "EXECUTE" if args.execute else "DRY RUN")
    logging.info("Log file: %s", log_path)
    logging.info("Report file: %s", report_path)
    logging.info("Shortcut path: %s", args.input_shortcut)
    logging.info("Configured input folder: %s", args.input_dir)

    input_dir = args.input_dir if args.input_dir else resolve_shortcut_target(args.input_shortcut)
    destination_dir = args.destination_dir
    text_dir = args.ocr_text_dir
    logging.info("Resolved input folder path: %s", input_dir)
    logging.info("Destination folder: %s", destination_dir)
    logging.info("OCR text folder: %s", text_dir)

    try:
        pdfs = matching_pdfs(input_dir)
    except PermissionError as error:
        logging.error("Could not access input folder: %s | error: %s", input_dir, error)
        logging.info("No files were renamed or moved.")
        write_contract_report(
            report_path=report_path,
            log_path=log_path,
            args=args,
            started_at=started_at,
            status="failed",
            summary={
                "found": 0,
                "processed": 0,
                "planned": 0,
                "created": 0,
                "moved": 0,
                "failed": 1,
                "warnings": 0,
            },
            items=[],
            warnings=[],
            errors=[f"Could not access input folder: {error}"],
        )
        return 2
    except Exception as error:
        logging.error("Could not list input folder: %s | error: %s", input_dir, error)
        logging.info("No files were renamed or moved.")
        write_contract_report(
            report_path=report_path,
            log_path=log_path,
            args=args,
            started_at=started_at,
            status="failed",
            summary={
                "found": 0,
                "processed": 0,
                "planned": 0,
                "created": 0,
                "moved": 0,
                "failed": 1,
                "warnings": 0,
            },
            items=[],
            warnings=[],
            errors=[f"Could not list input folder: {error}"],
        )
        return 2

    if args.limit:
        pdfs = pdfs[: args.limit]

    logging.info("PDFs found: %s", len(pdfs))
    for pdf in pdfs:
        logging.info("PDF found: %s", pdf)

    if args.list_only:
        logging.info("List-only mode: no TXT read, no rename, and no move will be attempted.")
        items = []
        for pdf in pdfs:
            logging.info("LIST ONLY PDF: %s", pdf)
            text_path = matching_text_path(pdf, text_dir)
            logging.info("LIST ONLY matching TXT path: %s", text_path)
            items.append({
                "sourcePath": str(pdf),
                "status": "listed",
                "textPath": str(text_path),
            })
        logging.info("Finished list-only report. Log file: %s", log_path)
        write_contract_report(
            report_path=report_path,
            log_path=log_path,
            args=args,
            started_at=started_at,
            status="success",
            summary={
                "found": len(pdfs),
                "processed": 0,
                "planned": 0,
                "created": 0,
                "moved": 0,
                "failed": 0,
                "warnings": 0,
            },
            items=items,
            warnings=[],
            errors=[],
        )
        return 0

    if args.execute:
        destination_dir.mkdir(parents=True, exist_ok=True)
    reserved_paths: set[Path] = set()

    identified = 0
    skipped_not_contract = 0
    moved = 0
    no_name = 0
    matching_txt_found = 0
    missing_txt = 0
    text_read_failures = 0
    names_extracted = 0
    items = []
    warnings = []
    errors = []

    for pdf_path in pdfs:
        try:
            is_contract, employee_name, text_path, is_missing_text = identify_contract_from_text(pdf_path, text_dir)
        except Exception as error:
            text_read_failures += 1
            logging.exception("OCR text read failure; skipping file: %s | error: %s", pdf_path, error)
            errors.append(f"OCR text read failure for {pdf_path.name}: {error}")
            items.append({
                "sourcePath": str(pdf_path),
                "status": "error",
                "error": str(error),
            })
            continue

        if is_missing_text:
            missing_txt += 1
            logging.warning("Missing OCR text; skipping file: %s | expected TXT: %s", pdf_path, text_path)
            warnings.append(f"Missing OCR text for {pdf_path.name}.")
            items.append({
                "sourcePath": str(pdf_path),
                "status": "missing_ocr_text",
                "textPath": str(text_path),
            })
            continue

        matching_txt_found += 1

        if not is_contract:
            skipped_not_contract += 1
            logging.info("Skipped as not contract: %s | TXT: %s", pdf_path, text_path)
            items.append({
                "sourcePath": str(pdf_path),
                "status": "skipped_not_contract",
                "textPath": str(text_path),
            })
            continue

        identified += 1
        logging.info("PDF identified as contract: %s | TXT: %s", pdf_path, text_path)

        filename, used_no_name = build_target_filename(employee_name)
        if used_no_name:
            no_name += 1
            logging.warning("Contract identified but employee name was not extracted: %s", pdf_path)
            logging.info("Will use no-name filename: %s", filename)
            warnings.append(f"Contract identified without employee name: {pdf_path.name}.")
        else:
            names_extracted += 1
            logging.info("Extracted employee name: %s", employee_name)

        final_path = unique_destination_path(destination_dir, filename, reserved_paths)
        logging.info("Original path: %s", pdf_path)
        logging.info("Final path: %s", final_path)

        if args.execute:
            shutil.move(str(pdf_path), str(final_path))
            moved += 1
            logging.info("Renamed and moved: %s -> %s", pdf_path, final_path)
            item_status = "moved"
        else:
            logging.info("DRY RUN would rename and move: %s -> %s", pdf_path, final_path)
            item_status = "planned_move"

        items.append({
            "sourcePath": str(pdf_path),
            "status": item_status,
            "textPath": str(text_path),
            "destinationPath": str(final_path),
            "hasEmployeeName": not used_no_name,
        })

    logging.info("Summary")
    logging.info("PDFs found: %s", len(pdfs))
    logging.info("Matching TXT found: %s", matching_txt_found)
    logging.info("Missing TXT: %s", missing_txt)
    logging.info("PDFs identified as contracts: %s", identified)
    logging.info("PDFs skipped as not contracts: %s", skipped_not_contract)
    logging.info("Names extracted: %s", names_extracted)
    logging.info("PDFs renamed and moved: %s", moved)
    logging.info("PDFs identified as contracts but renamed Contratto_SENZA_NOME: %s", no_name)
    logging.info("OCR text read failures: %s", text_read_failures)
    logging.info("Finished. Log file: %s", log_path)

    if not args.execute:
        logging.info("Dry run only. Re-run with --execute to move positively identified contracts.")

    write_contract_report(
        report_path=report_path,
        log_path=log_path,
        args=args,
        started_at=started_at,
        status=report_status(text_read_failures, len(warnings)),
        summary={
            "found": len(pdfs),
            "processed": len(pdfs),
            "planned": identified,
            "created": 0,
            "moved": moved,
            "failed": text_read_failures,
            "warnings": len(warnings),
        },
        items=items,
        warnings=warnings,
        errors=errors,
    )
    logging.info("Report: %s", report_path)

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use preprocessed OCR text to identify employee contract PDFs, rename them by employee name, and move them safely.",
    )
    parser.add_argument("--config", type=Path, help="Optional FlowHost automation JSON config file.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually move and rename identified contracts. Without this flag, the script only reports what it would do.",
    )
    parser.add_argument("--input-shortcut", type=Path)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--destination-dir", type=Path)
    parser.add_argument("--log-dir", type=Path)
    parser.add_argument("--ocr-text-dir", type=Path)
    parser.add_argument("--json-report", type=Path, help="Optional path for the JSON report.")
    parser.add_argument("--max-pages", type=int, default=3, help=argparse.SUPPRESS)
    parser.add_argument("--dpi", type=int, default=200, help=argparse.SUPPRESS)
    parser.add_argument("--ocr-language", default="it-IT", help=argparse.SUPPRESS)
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional maximum number of matching PDFs to inspect, useful for a small dry run.",
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="Only resolve the shortcut and list matching PDFs/TXT paths. No TXT read, rename, or move is attempted.",
    )
    return configure_args(parser.parse_args())


def configure_args(args: argparse.Namespace) -> argparse.Namespace:
    global FILE_PREFIX, CONTRACT_MARKER

    config = {}
    config_base = None
    if args.config:
        config = load_config(args.config)
        config_base = args.config.resolve().parent

    args.input_shortcut = args.input_shortcut or config_path(
        config,
        "paths",
        "contractInputShortcut",
        SHORTCUT_PATH,
        config_base,
    )
    configured_input_dir = config_value(config, "paths", "contractInputDir", "")
    if args.input_dir is None and isinstance(configured_input_dir, str) and configured_input_dir.strip():
        args.input_dir = resolve_path(configured_input_dir, config_base)
    args.destination_dir = args.destination_dir or config_path(
        config,
        "paths",
        "contractDestinationDir",
        DESTINATION_DIR,
        config_base,
    )
    args.log_dir = args.log_dir or config_path(
        config,
        "paths",
        "contractLogDir",
        LOG_DIR,
        config_base,
    )
    args.ocr_text_dir = args.ocr_text_dir or config_path(
        config,
        "paths",
        "contractOcrTextDir",
        OCR_TEXT_DIR,
        config_base,
    )
    FILE_PREFIX = config_str(config, "contracts", "scannerFilePrefix", FILE_PREFIX)
    CONTRACT_MARKER = config_str(config, "contracts", "contractMarker", CONTRACT_MARKER)
    return args


if __name__ == "__main__":
    try:
        raise SystemExit(process(parse_args()))
    except ConfigError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        raise SystemExit(2)
    except KeyboardInterrupt:
        print("Interrupted by user.", file=sys.stderr)
        raise SystemExit(130)
