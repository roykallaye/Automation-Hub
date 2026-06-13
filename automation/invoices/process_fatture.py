import argparse
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.config import (  # noqa: E402
    ConfigError,
    config_bool,
    config_path,
    config_str_list,
    config_str,
    config_value,
    load_config,
    recipient_rules,
)
from shared.report import now_iso, standard_report, write_report  # noqa: E402


ROOT = Path(r"C:\InnPilot\workspace\Invoices")

INPUT_DIR = ROOT / "Input"
OUTPUT_DIR = ROOT / "Output_ProntoInvio"
ARCHIVE_DIR = ROOT / "Archivio"
LOG_DIR = ROOT / "Log"
INPUT_GLOB = "*.pdf"
INPUT_GLOBS = [INPUT_GLOB]
FILE_SELECTION_MODE = "allPdfs"
EMAIL_SIGNATURE_NAME = "Your Hotel"
HOTEL_DISPLAY_NAME = "Your Hotel"
ARCHIVE_SUCCESSFUL_ORIGINALS = True
DELIVERY_MODE = "gmailDrafts"

# Default email body, customizable via gmail.bodyTemplate in the automation
# config. Keep in sync with DEFAULT_GMAIL_DRAFT_BODY in src-tauri/src/config.rs.
DEFAULT_EMAIL_BODY_TEMPLATE = (
    "Dear Partner,\n"
    "\n"
    "please find attached the invoices related to our mutual guests' stays at our hotel.\n"
    "For any additional information, please contact us.\n"
    "\n"
    "Kind regards,\n"
    "{signature}\n"
)
EMAIL_BODY_TEMPLATE = DEFAULT_EMAIL_BODY_TEMPLATE

RUN_TS = datetime.now().strftime("%Y-%m-%d_%H%M%S")
ARCHIVE_RUN_DIR = ARCHIVE_DIR / RUN_TS
LOG_FILE = LOG_DIR / f"process_fatture_{RUN_TS}.log"
REPORT_FILE = LOG_DIR / f"report_fatture_{RUN_TS}.json"
COMMITTENTE_EMAIL_RULES = [
    ("eurotours", "invoice@eurotours.at"),
    ("dertour", "dtd-invoices@dertouristik.com"),
    ("luxhoba", "direzione@luxhoba.com"),
]


def get_pymupdf():
    try:
        import pymupdf
    except ImportError as error:
        raise RuntimeError(
            "PyMuPDF is required to process invoice PDFs. Install automation requirements first."
        ) from error
    return pymupdf


def log(message: str) -> None:
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {message}"
    print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def safe_filename_part(value: str) -> str:
    value = value or ""
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r'[<>:"/\\|?*]', "-", value)
    value = value.strip(" .-")
    return value


def safe_email_folder_name(email: str) -> str:
    return safe_filename_part(email).lower()


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    stem = path.stem
    suffix = path.suffix
    parent = path.parent

    i = 2
    while True:
        candidate = parent / f"{stem} ({i}){suffix}"
        if not candidate.exists():
            return candidate
        i += 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process hotel invoice PDFs for Gmail draft preparation.")
    parser.add_argument("--dry-run", action="store_true", help="Inspect invoices without writing output PDFs or deleting originals.")
    parser.add_argument("--config", type=Path, help="Optional InnPilot automation JSON config file.")
    parser.add_argument("--json-report", type=Path, help="Optional path for the JSON report.")
    return parser.parse_args()


def configure_run(args: argparse.Namespace) -> None:
    global INPUT_DIR, OUTPUT_DIR, ARCHIVE_DIR, LOG_DIR, ARCHIVE_RUN_DIR, LOG_FILE, REPORT_FILE
    global COMMITTENTE_EMAIL_RULES, INPUT_GLOB, INPUT_GLOBS, EMAIL_SIGNATURE_NAME, ARCHIVE_SUCCESSFUL_ORIGINALS, DELIVERY_MODE
    global HOTEL_DISPLAY_NAME, EMAIL_BODY_TEMPLATE, FILE_SELECTION_MODE

    config = {}
    config_base = None
    if args.config:
        config = load_config(args.config)
        config_base = args.config.resolve().parent

    INPUT_DIR = config_path(config, "paths", "invoiceInputDir", INPUT_DIR, config_base)
    OUTPUT_DIR = config_path(config, "paths", "invoiceOutputDir", OUTPUT_DIR, config_base)
    ARCHIVE_DIR = config_path(config, "paths", "invoiceArchiveDir", ARCHIVE_DIR, config_base)
    LOG_DIR = config_path(config, "paths", "invoiceLogDir", LOG_DIR, config_base)
    INPUT_GLOBS = config_str_list(config, "invoice", "inputGlobs", "inputGlob", INPUT_GLOBS)
    INPUT_GLOB = INPUT_GLOBS[0]
    configured_file_selection_mode = config_str(config, "invoice", "fileSelectionMode", "")
    has_legacy_patterns = (
        config_value(config, "invoice", "inputGlobs", None) is not None
        or config_value(config, "invoice", "inputGlob", None) is not None
    )
    if configured_file_selection_mode:
        FILE_SELECTION_MODE = configured_file_selection_mode
    elif has_legacy_patterns:
        FILE_SELECTION_MODE = "filenamePatterns"
    else:
        FILE_SELECTION_MODE = "allPdfs"
    if FILE_SELECTION_MODE not in {"allPdfs", "filenamePatterns"}:
        raise ConfigError(
            "Config value 'invoice.fileSelectionMode' must be 'allPdfs' or 'filenamePatterns'."
        )
    DELIVERY_MODE = config_str(config, "invoice", "deliveryMode", DELIVERY_MODE)
    HOTEL_DISPLAY_NAME = config_str(config, "client", "displayName", HOTEL_DISPLAY_NAME)
    EMAIL_SIGNATURE_NAME = config_str(
        config,
        "client",
        "emailSignatureName",
        config_str(config, "client", "displayName", EMAIL_SIGNATURE_NAME),
    )
    EMAIL_BODY_TEMPLATE = config_str(config, "gmail", "bodyTemplate", EMAIL_BODY_TEMPLATE)
    if not EMAIL_BODY_TEMPLATE.strip():
        EMAIL_BODY_TEMPLATE = DEFAULT_EMAIL_BODY_TEMPLATE
    COMMITTENTE_EMAIL_RULES = recipient_rules(config, COMMITTENTE_EMAIL_RULES)
    ARCHIVE_SUCCESSFUL_ORIGINALS = config_bool(
        config,
        "safety",
        "archiveSuccessfulOriginals",
        ARCHIVE_SUCCESSFUL_ORIGINALS,
    )
    if not args.dry_run:
        args.dry_run = config_bool(config, "safety", "dryRunDefault", False)

    ARCHIVE_RUN_DIR = ARCHIVE_DIR / RUN_TS
    LOG_FILE = LOG_DIR / f"process_fatture_{RUN_TS}.log"
    REPORT_FILE = LOG_DIR / f"report_fatture_{RUN_TS}.json"

    if args.json_report:
        REPORT_FILE = args.json_report

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not args.dry_run:
        for folder in [INPUT_DIR, OUTPUT_DIR, ARCHIVE_DIR]:
            folder.mkdir(parents=True, exist_ok=True)


def clean_line(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def is_label(x: str) -> bool:
    labels = {
        "cliente",
        "committente",
        "indirizzo",
        "stato",
        "cap e città",
        "cap e citta",
        "partita iva",
        "cod.fiscale",
        "fattura n.",
        "rif.",
        "data",
        "camera n.",
        "descrizione addebito",
        "totale",
        "iva",
        "imposta",
        "imponibile",
        "corr. pagato",
        "corr. non pagato",
        "note",
    }
    return x.lower() in labels


def find_line_index(lines: list[str], label: str):
    label = label.lower()
    for i, line in enumerate(lines):
        if line.lower() == label:
            return i
    return None


def first_value_after(lines: list[str], label: str):
    i = find_line_index(lines, label)
    if i is None:
        return None

    for j in range(i + 1, min(i + 8, len(lines))):
        if not is_label(lines[j]):
            return lines[j]

    return None


def assign_recipient_email(committente: str) -> dict:
    committente_text = (committente or "").lower()

    for match_text, email in COMMITTENTE_EMAIL_RULES:
        if match_text in committente_text:
            return {
                "recipient_email": email,
                "email_match": match_text,
            }

    return {
        "recipient_email": None,
        "email_match": None,
    }


def extract_fields(text: str) -> dict:
    lines = [clean_line(x) for x in text.splitlines()]
    lines = [x for x in lines if x]

    cliente = first_value_after(lines, "Cliente")

    # Often the committente value appears immediately before the label "Committente"
    committente = None
    i_comm = find_line_index(lines, "Committente")

    if i_comm is not None:
        for j in range(i_comm - 1, max(i_comm - 6, -1), -1):
            candidate = lines[j]
            if not is_label(candidate) and not re.fullmatch(r"[A-Z]{1,2}", candidate):
                committente = candidate
                break

        if not committente:
            committente = first_value_after(lines, "Committente")

    i_camera = find_line_index(lines, "Camera n.")
    header_lines = lines[:i_camera] if i_camera is not None else lines[:50]
    header_text = "\n".join(header_lines)

    dates = re.findall(r"\b\d{2}/\d{2}/\d{4}\b", header_text)
    data = dates[-1].replace("/", "-") if dates else None

    fattura_numero = None
    if dates:
        first_date_index = None
        for i, line in enumerate(header_lines):
            if re.fullmatch(r"\d{2}/\d{2}/\d{4}", line):
                first_date_index = i
                break

        search_area = header_lines[:first_date_index] if first_date_index is not None else header_lines
        numeric_candidates = [
            x for x in search_area
            if re.fullmatch(r"\d{1,6}", x) and len(x) <= 6
        ]
        if numeric_candidates:
            fattura_numero = numeric_candidates[-1]

    email_info = assign_recipient_email(committente)

    return {
        "cliente": cliente,
        "committente": committente,
        "data": data,
        "fattura_numero": fattura_numero,
        "recipient_email": email_info["recipient_email"],
        "email_match": email_info["email_match"],
        "lines_preview": lines[:40],
    }


def create_single_copy_pdf_and_text(input_pdf: Path, output_pdf: Path) -> str:
    pymupdf = get_pymupdf()
    doc = pymupdf.open(input_pdf)
    page = doc[0]

    rotation = page.rotation

    # Hotel invoices are usually internally portrait with rotation=90,
    # visually landscape with duplicated invoice left/right.
    if rotation == 90:
        mb = page.mediabox
        clip = pymupdf.Rect(mb.x0, mb.y0, mb.x1, mb.y0 + (mb.height / 2))
        output_width = clip.height
        output_height = clip.width
        output_rotation = 90

    elif rotation == 270:
        mb = page.mediabox
        clip = pymupdf.Rect(mb.x0, mb.y0 + (mb.height / 2), mb.x1, mb.y1)
        output_width = clip.height
        output_height = clip.width
        output_rotation = 270

    else:
        rect = page.rect
        clip = pymupdf.Rect(rect.x0, rect.y0, rect.x0 + (rect.width / 2), rect.y1)
        output_width = clip.width
        output_height = clip.height
        output_rotation = 0

    new_doc = pymupdf.open()
    new_page = new_doc.new_page(width=output_width, height=output_height)
    new_page.show_pdf_page(new_page.rect, doc, 0, clip=clip)

    if output_rotation:
        new_page.set_rotation(output_rotation)

    new_doc.save(output_pdf)
    new_doc.close()
    doc.close()

    single_doc = pymupdf.open(output_pdf)
    text = single_doc[0].get_text("text")
    single_doc.close()

    return text


def render_email_body(
    template: str,
    *,
    hotel_name: str,
    signature: str,
    invoice_count: int,
    date_text: str,
) -> str:
    """Renders the email body template with simple placeholder replacement.

    Unknown placeholders are left untouched so a typo never breaks a run.
    """
    rendered = template if template.strip() else DEFAULT_EMAIL_BODY_TEMPLATE
    replacements = {
        "{hotelName}": hotel_name,
        "{signature}": signature,
        "{invoiceCount}": str(invoice_count),
        "{date}": date_text,
    }
    for placeholder, value in replacements.items():
        rendered = rendered.replace(placeholder, value)
    return rendered


def write_email_bodies_by_group(processed_files: list[dict]) -> dict:
    groups = {}

    for item in processed_files:
        if item["status"] != "ok":
            continue

        recipient_email = item.get("recipient_email")
        if not recipient_email:
            continue

        groups.setdefault(recipient_email, []).append(item["output_pdf_name"])

    for recipient_email, pdf_names in groups.items():
        body_path = OUTPUT_DIR / safe_email_folder_name(recipient_email) / "email_body.txt"

        body_text = render_email_body(
            EMAIL_BODY_TEMPLATE,
            hotel_name=HOTEL_DISPLAY_NAME,
            signature=EMAIL_SIGNATURE_NAME,
            invoice_count=len(pdf_names),
            date_text=datetime.now().strftime("%d/%m/%Y"),
        )

        body_path.write_text(body_text, encoding="utf-8")

    return groups


def collect_groups_by_email(processed_files: list[dict]) -> dict:
    groups = {}
    for item in processed_files:
        if item["status"] != "ok":
            continue
        recipient_email = item.get("recipient_email")
        if not recipient_email:
            continue
        groups.setdefault(recipient_email, []).append(item["output_pdf_name"])
    return groups


def collect_input_pdfs() -> tuple[list[Path], dict[str, int]]:
    folder_items = [path for path in INPUT_DIR.iterdir()] if INPUT_DIR.is_dir() else []
    pdf_candidates = [path for path in folder_items if path.is_file() and path.suffix.lower() == ".pdf"]
    ignored_non_pdf = len([path for path in folder_items if path.is_file() and path.suffix.lower() != ".pdf"])

    if FILE_SELECTION_MODE == "allPdfs":
        matches = {str(path.resolve() if path.exists() else path): path for path in pdf_candidates}
        skipped_by_filename_filter = 0
    else:
        matches: dict[str, Path] = {}
        for pattern in INPUT_GLOBS:
            for path in INPUT_DIR.glob(pattern):
                if not path.is_file() or path.suffix.lower() != ".pdf":
                    continue
                key = str(path.resolve() if path.exists() else path)
                matches.setdefault(key, path)
        matched_keys = set(matches.keys())
        skipped_by_filename_filter = len([
            path
            for path in pdf_candidates
            if str(path.resolve() if path.exists() else path) not in matched_keys
        ])

    return sorted(matches.values(), key=lambda path: path.name.lower()), {
        "candidatePdfsFound": len(pdf_candidates),
        "ignoredNonPdf": ignored_non_pdf,
        "skippedByFilenameFilter": skipped_by_filename_filter,
    }


def invoice_report_item(result: dict) -> dict:
    item = {
        "sourcePath": result.get("input_pdf") or result.get("input_pdf_original_deleted"),
        "status": result.get("status"),
    }
    for key in [
        "recipient_email",
        "reason",
        "output_pdf",
        "planned_output_pdf",
        "would_create_output_pdf",
        "input_pdf_original_archived",
        "would_archive_original",
        "would_copy_to_failed_archive",
    ]:
        if result.get(key) is not None:
            item[key] = result[key]
    if result.get("output_pdf_name"):
        item["outputName"] = result["output_pdf_name"]
    return item


def invoice_status(failed_count: int, warning_count: int) -> str:
    if failed_count:
        return "failed"
    if warning_count:
        return "needs_attention"
    return "success"


def main(args: argparse.Namespace | None = None):
    args = args or parse_args()
    configure_run(args)
    started_at = now_iso()
    dry_run = args.dry_run
    input_pdfs, selection_stats = collect_input_pdfs()

    log("=== START process fatture ===")
    log(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    log(f"Input folder: {INPUT_DIR}")
    log(f"Output folder: {OUTPUT_DIR}")
    log(f"Archive folder: {ARCHIVE_DIR}")
    if FILE_SELECTION_MODE == "allPdfs":
        log(f"Input PDFs found: {len(input_pdfs)}")
    else:
        log(f"Input PDFs found for {INPUT_GLOBS}: {len(input_pdfs)}")
    if selection_stats["ignoredNonPdf"]:
        log(f"Ignored non-PDF files: {selection_stats['ignoredNonPdf']}")
    if selection_stats["skippedByFilenameFilter"]:
        log(f"Skipped by filename filter: {selection_stats['skippedByFilenameFilter']}")

    if not input_pdfs:
        report = {
            **standard_report(
                workflow="invoices",
                mode="dry_run" if dry_run else "execute",
                started_at=started_at,
                finished_at=now_iso(),
                status="success",
                summary={
                    "found": 0,
                    "candidatePdfsFound": selection_stats["candidatePdfsFound"],
                    "ignoredNonPdf": selection_stats["ignoredNonPdf"],
                    "skippedByFilenameFilter": selection_stats["skippedByFilenameFilter"],
                    "processed": 0,
                    "planned": 0,
                    "created": 0,
                    "moved": 0,
                    "failed": 0,
                    "warnings": 0,
                },
                items=[],
                warnings=[],
                errors=[],
                report_path=REPORT_FILE,
                log_path=LOG_FILE,
            ),
            "details": {
                "inputFolder": str(INPUT_DIR),
                "outputFolder": str(OUTPUT_DIR),
                "archiveFolder": str(ARCHIVE_RUN_DIR),
                "deliveryMode": DELIVERY_MODE,
                "fileSelectionMode": FILE_SELECTION_MODE,
                "inputGlobs": INPUT_GLOBS if FILE_SELECTION_MODE == "filenamePatterns" else [],
                "gmailSkippedByMode": DELIVERY_MODE == "prepareOnly",
                "recipientGroups": {},
            },
        }
        write_report(REPORT_FILE, report)

        log("No new input invoices found. Output_ProntoInvio was left unchanged.")
        if DELIVERY_MODE == "prepareOnly":
            log("Gmail draft step skipped because invoice delivery mode is prepareOnly.")
        else:
            log("Gmail draft skipped because no new invoices were processed.")
        log("=== SUMMARY ===")
        log("PDFs found: 0")
        log("Processed OK: 0")
        log("Missing email: 0")
        log("Failed: 0")
        log("Groups created by email: 0")
        log("Drafts expected: 0")
        log(f"Report: {REPORT_FILE}")
        log("=== END ===")
        return

    failed_dir = ARCHIVE_RUN_DIR / "Falliti"

    results = []

    for pdf_path in input_pdfs:
        log(f"Processing: {pdf_path.name}")

        temp_context = tempfile.TemporaryDirectory(prefix="innpilot_invoice_") if dry_run else None
        temp_base = Path(temp_context.name) if temp_context else OUTPUT_DIR
        temp_pdf = temp_base / f"__TEMP__{pdf_path.stem}.pdf"

        try:
            text = create_single_copy_pdf_and_text(pdf_path, temp_pdf)
            fields = extract_fields(text)

            cliente = fields["cliente"]
            committente = fields["committente"]
            data = fields["data"]
            recipient_email = fields["recipient_email"]

            missing = []
            if not cliente:
                missing.append("cliente")
            if not committente:
                missing.append("committente")
            if not data:
                missing.append("data")

            if missing:
                if temp_pdf.exists():
                    temp_pdf.unlink()

                if dry_run:
                    log(
                        f"DRY RUN failed missing {', '.join(missing)}: {pdf_path.name}. "
                        f"Would copy original to {failed_dir / pdf_path.name}"
                    )
                    results.append({
                        "input_pdf": str(pdf_path),
                        "status": "failed",
                        "dry_run": True,
                        "reason": f"missing: {', '.join(missing)}",
                        "would_copy_to_failed_archive": str(failed_dir / pdf_path.name),
                        "extracted": fields,
                    })
                    continue

                failed_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(pdf_path, failed_dir / pdf_path.name)

                log(f"FAILED missing {', '.join(missing)}: {pdf_path.name}")

                results.append({
                    "input_pdf": str(pdf_path),
                    "status": "failed",
                    "reason": f"missing: {', '.join(missing)}",
                    "extracted": fields,
                })
                continue

            final_name = (
                f"{safe_filename_part(committente)}-"
                f"{safe_filename_part(cliente)}-"
                f"{safe_filename_part(data)}.pdf"
            )

            if recipient_email:
                destination_dir = OUTPUT_DIR / safe_email_folder_name(recipient_email)
                status = "ok"
                log(
                    f"Assigned recipient {recipient_email} from committente "
                    f"match '{fields['email_match']}'."
                )
            else:
                destination_dir = OUTPUT_DIR / "SenzaEmail"
                status = "missing_email"
                log(
                    f"MISSING EMAIL: no committente email rule matched "
                    f"'{committente}' in {pdf_path.name}. "
                    "Invoice will be drafted separately with CC only."
                )

            final_pdf = unique_path(destination_dir / final_name)

            if dry_run:
                log(f"DRY RUN would create: {final_pdf}")
                log(f"DRY RUN would archive original: {ARCHIVE_RUN_DIR / 'Originali_Processati' / pdf_path.name}")
                results.append({
                    "input_pdf": str(pdf_path),
                    "status": status,
                    "dry_run": True,
                    "would_create_output_pdf": str(final_pdf),
                    "would_archive_original": str(ARCHIVE_RUN_DIR / "Originali_Processati" / pdf_path.name),
                    "output_pdf_name": final_pdf.name,
                    "recipient_email": recipient_email,
                    "extracted": {
                        "cliente": cliente,
                        "committente": committente,
                        "data": data,
                        "fattura_numero": fields["fattura_numero"],
                        "recipient_email": recipient_email,
                        "email_match": fields["email_match"],
                    },
                })
                continue

            destination_dir.mkdir(parents=True, exist_ok=True)
            final_pdf = unique_path(destination_dir / final_name)
            original_input_pdf = str(pdf_path)
            archived_original = None
            if ARCHIVE_SUCCESSFUL_ORIGINALS:
                processed_originals_dir = ARCHIVE_RUN_DIR / "Originali_Processati"
                processed_originals_dir.mkdir(parents=True, exist_ok=True)
                archived_original = unique_path(processed_originals_dir / pdf_path.name)

                try:
                    shutil.copy2(pdf_path, archived_original)
                except Exception as archive_error:
                    log(
                        f"ARCHIVE FAILED: original left in Input and not deleted: "
                        f"{pdf_path.name} | error: {archive_error}"
                    )
                    results.append({
                        "input_pdf": original_input_pdf,
                        "planned_output_pdf": str(final_pdf),
                        "output_pdf_name": final_pdf.name,
                        "status": "archive_failed",
                        "reason": str(archive_error),
                        "recipient_email": recipient_email,
                        "extracted": {
                            "cliente": cliente,
                            "committente": committente,
                            "data": data,
                            "fattura_numero": fields["fattura_numero"],
                            "recipient_email": recipient_email,
                            "email_match": fields["email_match"],
                        },
                    })
                    continue

            temp_pdf.rename(final_pdf)
            pdf_path.unlink()

            log(f"OK: {pdf_path.name} -> {final_pdf}")
            if archived_original:
                log(f"Original archived: {archived_original}")

            results.append({
                "input_pdf_original_deleted": original_input_pdf,
                "input_pdf_original_archived": str(archived_original) if archived_original else None,
                "output_pdf": str(final_pdf),
                "output_pdf_name": final_pdf.name,
                "status": status,
                "recipient_email": recipient_email,
                "extracted": {
                    "cliente": cliente,
                    "committente": committente,
                    "data": data,
                    "fattura_numero": fields["fattura_numero"],
                    "recipient_email": recipient_email,
                    "email_match": fields["email_match"],
                },
            })

        except Exception as e:
            if temp_pdf.exists():
                try:
                    temp_pdf.unlink()
                except Exception:
                    pass

            if not dry_run:
                failed_dir.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copy2(pdf_path, failed_dir / pdf_path.name)
                except Exception:
                    pass
            else:
                log(f"DRY RUN would copy failed original to: {failed_dir / pdf_path.name}")

            log(f"ERROR {pdf_path.name}: {e}")

            results.append({
                "input_pdf": str(pdf_path),
                "status": "error",
                "reason": str(e),
            })
        finally:
            if temp_context:
                temp_context.cleanup()

    ok_items = [x for x in results if x["status"] == "ok"]
    missing_email_items = [x for x in results if x["status"] == "missing_email"]
    processed_items = ok_items + missing_email_items
    failed_items = [x for x in results if x["status"] not in {"ok", "missing_email"}]

    groups_by_email = {}
    if dry_run:
        groups_by_email = collect_groups_by_email(results)
        for recipient_email, pdf_names in groups_by_email.items():
            log(f"DRY RUN would create group: {recipient_email} ({len(pdf_names)} PDF)")
    elif ok_items:
        groups_by_email = write_email_bodies_by_group(results)
        for recipient_email, pdf_names in groups_by_email.items():
            log(f"Group created: {recipient_email} ({len(pdf_names)} PDF)")

    report = {
        **standard_report(
            workflow="invoices",
            mode="dry_run" if dry_run else "execute",
            started_at=started_at,
            finished_at=now_iso(),
            status=invoice_status(len(failed_items), len(missing_email_items)),
            summary={
                "found": len(input_pdfs),
                "candidatePdfsFound": selection_stats["candidatePdfsFound"],
                "ignoredNonPdf": selection_stats["ignoredNonPdf"],
                "skippedByFilenameFilter": selection_stats["skippedByFilenameFilter"],
                "processed": len(processed_items),
                "planned": len(groups_by_email) + (1 if missing_email_items else 0),
                "created": 0 if dry_run else len(processed_items),
                "moved": 0 if dry_run else len(processed_items),
                "failed": len(failed_items),
                "warnings": len(missing_email_items),
            },
            items=[invoice_report_item(result) for result in results],
            warnings=[
                f"No recipient rule matched for {Path(item.get('input_pdf', '')).name}"
                for item in missing_email_items
            ],
            errors=[
                f"{Path((item.get('input_pdf') or item.get('input_pdf_original_deleted') or '')).name}: {item.get('reason', item.get('status'))}"
                for item in failed_items
            ],
            report_path=REPORT_FILE,
            log_path=LOG_FILE,
        ),
        "details": {
            "inputFolder": str(INPUT_DIR),
            "outputFolder": str(OUTPUT_DIR),
            "archiveFolder": str(ARCHIVE_RUN_DIR),
            "deliveryMode": DELIVERY_MODE,
            "fileSelectionMode": FILE_SELECTION_MODE,
            "inputGlobs": INPUT_GLOBS if FILE_SELECTION_MODE == "filenamePatterns" else [],
            "gmailSkippedByMode": DELIVERY_MODE == "prepareOnly",
            "recipientGroups": groups_by_email,
        },
    }

    write_report(REPORT_FILE, report)

    log("=== SUMMARY ===")
    log(f"PDFs found: {len(input_pdfs)}")
    log(f"Processed OK: {len(processed_items)}")
    log(f"Missing email: {len(missing_email_items)}")
    log(f"Failed: {len(failed_items)}")
    log(f"Groups created by email: {len(groups_by_email)}")
    log(f"Drafts expected: {len(groups_by_email) + (1 if missing_email_items else 0)}")
    if groups_by_email or missing_email_items:
        log("Gmail draft can be created by the draft script.")
    else:
        log("Gmail draft skipped because no recipient email groups were created.")
    log(f"Report: {REPORT_FILE}")
    log("=== END ===")


if __name__ == "__main__":
    try:
        main()
    except ConfigError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        raise SystemExit(2)
