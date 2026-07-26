import argparse
import json
from pathlib import Path
import re
import sys
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from draft_safety import load_receipt, prepare_draft_once  # noqa: E402

from shared.config import (  # noqa: E402
    ConfigError,
    config_bool,
    config_path,
    config_str,
    load_config,
)
from shared.report import now_iso, report_status, standard_report, write_report  # noqa: E402

from shared.safe_files import move_verified_atomic, same_file_contents  # noqa: E402
from shared.windows_secrets import (  # noqa: E402
    read_json_secret,
    write_json_secret,
)

ROOT = Path(r"C:\InnPilot\workspace\Invoices")
SCRIPT_DIR = ROOT / "Script"
INPUT_DIR = ROOT / "Input"
OUTPUT_DIR = ROOT / "Output_ProntoInvio"
ARCHIVE_DIR = ROOT / "Archivio"
LOG_DIR = ROOT / "Log"

CREDENTIALS_FILE = SCRIPT_DIR / "gmail_credentials.json"
TOKEN_FILE = SCRIPT_DIR / "gmail_token.json"

SUBJECT = "Invoices - Your Hotel"
CC_EMAIL = "rossella@apogia.net"
EMAIL_SIGNATURE_NAME = "Your Hotel"
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
NO_EMAIL_FOLDER_NAME = "SenzaEmail"

RECEIPT_FILENAME = ".innpilot-draft-receipt.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.compose"]

RUN_TS = datetime.now().strftime("%Y-%m-%d_%H%M%S")
ARCHIVE_RUN_DIR = ARCHIVE_DIR / RUN_TS
LOG_FILE = LOG_DIR / f"create_gmail_draft_{RUN_TS}.log"
REPORT_FILE = LOG_DIR / f"report_gmail_draft_{RUN_TS}.json"


def log(message: str) -> None:
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {message}"
    print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def get_service():
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request

    creds = None
    client_config = None

    if CREDENTIALS_FILE.exists():
        client_config = read_json_secret(
            CREDENTIALS_FILE,
            purpose="gmail-client-credentials",
        )

    if TOKEN_FILE.exists():
        token_info = read_json_secret(TOKEN_FILE, purpose="gmail-token")
        creds = Credentials.from_authorized_user_info(token_info, SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        write_json_secret(
            TOKEN_FILE,
            json.loads(creds.to_json()),
            purpose="gmail-token",
        )

    if not creds or not creds.valid:
        if client_config is None:
            raise RuntimeError(
                "Gmail client credentials are missing. Reconnect Gmail after setup is completed."
            )
        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
        creds = flow.run_local_server(port=0)
        write_json_secret(
            TOKEN_FILE,
            json.loads(creds.to_json()),
            purpose="gmail-token",
        )

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def is_valid_email_folder(path: Path) -> bool:
    return path.is_dir() and EMAIL_RE.fullmatch(path.name) is not None


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
    parser = argparse.ArgumentParser(description="Create Gmail drafts for prepared invoice PDFs.")
    parser.add_argument("--dry-run", action="store_true", help="Report draft candidates without calling Gmail or moving files.")
    parser.add_argument("--config", type=Path, help="Optional InnPilot automation JSON config file.")
    parser.add_argument("--json-report", type=Path, help="Optional path for the JSON report.")
    return parser.parse_args()


def configure_run(args: argparse.Namespace) -> None:
    global INPUT_DIR, OUTPUT_DIR, ARCHIVE_DIR, LOG_DIR, ARCHIVE_RUN_DIR, LOG_FILE, REPORT_FILE
    global CREDENTIALS_FILE, TOKEN_FILE, SUBJECT, CC_EMAIL, EMAIL_SIGNATURE_NAME

    config = {}
    config_base = None
    if args.config:
        config = load_config(args.config)
        config_base = args.config.resolve().parent

    INPUT_DIR = config_path(config, "paths", "invoiceInputDir", INPUT_DIR, config_base)
    OUTPUT_DIR = config_path(config, "paths", "invoiceOutputDir", OUTPUT_DIR, config_base)
    ARCHIVE_DIR = config_path(config, "paths", "invoiceArchiveDir", ARCHIVE_DIR, config_base)
    LOG_DIR = config_path(config, "paths", "invoiceLogDir", LOG_DIR, config_base)
    CREDENTIALS_FILE = config_path(
        config,
        "paths",
        "gmailCredentialsFile",
        CREDENTIALS_FILE,
        config_base,
    )
    TOKEN_FILE = config_path(config, "paths", "gmailTokenFile", TOKEN_FILE, config_base)
    SUBJECT = config_str(config, "gmail", "subject", SUBJECT)
    CC_EMAIL = config_str(config, "gmail", "ccEmail", CC_EMAIL)
    EMAIL_SIGNATURE_NAME = config_str(
        config,
        "client",
        "emailSignatureName",
        config_str(config, "client", "displayName", EMAIL_SIGNATURE_NAME),
    )
    if not args.dry_run:
        args.dry_run = config_bool(config, "safety", "dryRunDefault", False)

    ARCHIVE_RUN_DIR = ARCHIVE_DIR / RUN_TS
    LOG_FILE = LOG_DIR / f"create_gmail_draft_{RUN_TS}.log"
    REPORT_FILE = LOG_DIR / f"report_gmail_draft_{RUN_TS}.json"
    if args.json_report:
        REPORT_FILE = args.json_report
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)


def client_name_from_pdf(pdf: Path) -> str:
    match = re.match(r"^(.+?)-(.+)-\d{2}-\d{2}-\d{4}$", pdf.stem)
    if match:
        return match.group(2).strip()
    return pdf.stem


def build_no_email_body(pdf_files: list[Path]) -> str:
    client_names = [client_name_from_pdf(pdf) for pdf in pdf_files]
    client_lines = [f"- {client_name}" for client_name in client_names]

    return "\n".join([
        "Buongiorno,",
        "",
        "alleghiamo fatture dei clienti che hanno soggiornato presso il Your Hotel.",
        "",
        "Nomi dei clienti:",
        *client_lines,
        "",
        "Saluti,",
        "Buon lavoro",
        EMAIL_SIGNATURE_NAME,
        "",
    ])


def find_recipient_groups() -> list[dict]:
    groups = []

    if not OUTPUT_DIR.exists():
        return groups

    for folder in sorted(OUTPUT_DIR.iterdir(), key=lambda p: p.name.lower()):
        if folder.is_dir() and folder.name.lower() == NO_EMAIL_FOLDER_NAME.lower():
            pdf_files = sorted(folder.glob("*.pdf"))
            if not pdf_files:
                log(f"Skipping {folder.name}: no PDFs found.")
                continue

            groups.append({
                "recipient_email": None,
                "group_name": NO_EMAIL_FOLDER_NAME,
                "folder": folder,
                "pdf_files": pdf_files,
                "body_file": None,
                "body_text": build_no_email_body(pdf_files),
            })
            continue

        if not is_valid_email_folder(folder):
            if folder.is_dir():
                log(f"Skipping non-recipient folder: {folder.name}")
            continue

        pdf_files = sorted(folder.glob("*.pdf"))
        if not pdf_files:
            log(f"Skipping {folder.name}: no PDFs found.")
            continue

        body_file = folder / "email_body.txt"
        if body_file.exists():
            body_text = body_file.read_text(encoding="utf-8")
        else:
            log(f"Missing email_body.txt for {folder.name}; using generated fallback body.")
            body_lines = [
                "Dear Partner,",
                "",
                "please find attached the invoices related to our mutual guests' stays at our hotel.",
                "For any additional information, please contact us.",
                "",
                "Kind regards,",
                EMAIL_SIGNATURE_NAME,
                "",
            ]
            body_text = "\n".join(body_lines)

        groups.append({
            "recipient_email": folder.name,
            "group_name": folder.name,
            "folder": folder,
            "pdf_files": pdf_files,
            "body_file": body_file,
            "body_text": body_text,
        })

    return groups




def archive_successful_group(
    group: dict,
    receipt_path: Path,
    receipt: dict,
) -> list[str]:
    archive_group_dir = Path(receipt["archiveFolder"]).resolve()
    archive_root = ARCHIVE_DIR.resolve()
    if archive_group_dir != archive_root and archive_root not in archive_group_dir.parents:
        raise RuntimeError("Draft archive receipt points outside the configured invoice archive.")
    archive_group_dir.mkdir(parents=True, exist_ok=True)

    archived_pdf_files = []
    for pdf in group["pdf_files"]:
        destination = archive_group_dir / pdf.name
        if destination.exists() and not same_file_contents(pdf, destination):
            destination = unique_path(destination)
        move_verified_atomic(pdf, destination)
        archived_pdf_files.append(str(destination))

    body_file = group.get("body_file")
    if body_file and body_file.exists():
        body_destination = archive_group_dir / body_file.name
        if body_destination.exists() and not same_file_contents(body_file, body_destination):
            body_destination = unique_path(body_destination)
        move_verified_atomic(body_file, body_destination)

    receipt_destination = archive_group_dir / RECEIPT_FILENAME
    if receipt_destination.exists() and not same_file_contents(receipt_path, receipt_destination):
        receipt_destination = unique_path(receipt_destination)
    move_verified_atomic(receipt_path, receipt_destination)

    try:
        if group["folder"].exists() and not any(group["folder"].iterdir()):
            group["folder"].rmdir()
    except OSError:
        pass
    return archived_pdf_files


def recover_completed_receipts() -> int:
    recovered = 0
    if not OUTPUT_DIR.exists():
        return recovered
    for folder in sorted(OUTPUT_DIR.iterdir(), key=lambda path: path.name.casefold()):
        receipt_path = folder / RECEIPT_FILENAME
        if not folder.is_dir() or not receipt_path.is_file() or any(folder.glob("*.pdf")):
            continue
        receipt = load_receipt(receipt_path)
        if receipt is None:
            continue
        archive_successful_group(
            {"folder": folder, "pdf_files": [], "body_file": folder / "email_body.txt"},
            receipt_path,
            receipt,
        )
        recovered += 1
    return recovered


def gmail_report_item(
    group: dict,
    *,
    receipt: dict | None = None,
    draft_created: bool = False,
    recovered_existing: bool = False,
    archived_pdf_files: list[str] | None = None,
) -> dict:
    item = {
        "recipientEmail": group["recipient_email"],
        "groupName": group["group_name"],
        "folder": str(group["folder"]),
        "pdfCount": len(group["pdf_files"]),
        "pdfFiles": [pdf.name for pdf in group["pdf_files"]],
    }
    if receipt:
        item["idempotencyKey"] = receipt["fingerprint"][:12]
        item["draftCreated"] = draft_created
        item["recoveredExistingDraft"] = recovered_existing
    if archived_pdf_files is not None:
        item["archivedPdfFiles"] = archived_pdf_files
    else:
        item["wouldArchiveFolder"] = str(ARCHIVE_RUN_DIR / "Output_DraftCreati" / group["group_name"])
    return item


def main(args: argparse.Namespace | None = None):
    args = args or parse_args()
    configure_run(args)
    started_at = now_iso()
    dry_run = args.dry_run
    input_pdfs = sorted(path for path in INPUT_DIR.glob("*.pdf") if path.is_file())

    log("=== START create Gmail draft ===")
    log(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    log(f"Input PDFs found: {len(input_pdfs)}")
    log(f"Output folder: {OUTPUT_DIR}")

    groups = find_recipient_groups()
    if not dry_run:
        cleaned_receipts = recover_completed_receipts()
        if cleaned_receipts:
            log(f"Completed {cleaned_receipts} interrupted draft archive cleanup operation(s).")
    log(f"Draft groups found: {len(groups)}")

    for group in groups:
        recipient_label = group["recipient_email"] or "SenzaEmail (CC only)"
        log(
            f"Draft candidate: {recipient_label} "
            f"({len(group['pdf_files'])} PDF)"
        )

    if not groups:
        report = {
            **standard_report(
                workflow="gmail_drafts",
                mode="dry_run" if dry_run else "execute",
                started_at=started_at,
                finished_at=now_iso(),
                status="success",
                summary={
                    "found": 0,
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
                "outputFolder": str(OUTPUT_DIR),
                "subject": SUBJECT,
                "ccEmail": CC_EMAIL,
            },
        }
        log("No draft groups with PDFs found. Gmail drafts not created.")
        log("Total drafts created: 0")
        write_report(REPORT_FILE, report)
        log(f"Report: {REPORT_FILE}")
        log("=== END ===")
        return

    if dry_run:
        items = []
        for group in groups:
            recipient_label = group["recipient_email"] or "SenzaEmail (CC only)"
            attachment_names = [pdf.name for pdf in group["pdf_files"]]
            log(
                f"DRY RUN would create draft for {recipient_label}; "
                f"CC: {CC_EMAIL}; subject: {SUBJECT}; attachments: {attachment_names}"
            )
            item = gmail_report_item(group)
            item["wouldCreateDraft"] = True
            item["ccEmail"] = CC_EMAIL
            item["subject"] = SUBJECT
            items.append(item)

        report = {
            **standard_report(
                workflow="gmail_drafts",
                mode="dry_run",
                started_at=started_at,
                finished_at=now_iso(),
                status="success",
                summary={
                    "found": len(groups),
                    "processed": len(groups),
                    "planned": len(groups),
                    "created": 0,
                    "moved": 0,
                    "failed": 0,
                    "warnings": 0,
                },
                items=items,
                warnings=[],
                errors=[],
                report_path=REPORT_FILE,
                log_path=LOG_FILE,
            ),
            "details": {
                "outputFolder": str(OUTPUT_DIR),
                "subject": SUBJECT,
                "ccEmail": CC_EMAIL,
            },
        }
        write_report(REPORT_FILE, report)
        log(f"Dry-run draft count: {len(groups)}")
        log(f"Report: {REPORT_FILE}")
        log("=== END ===")
        return

    service = get_service()
    items = []
    errors = []
    archived_count = 0
    created_count = 0
    recovered_count = 0

    for group in groups:
        recipient_label = group["recipient_email"] or "SenzaEmail (CC only)"
        receipt_path = group["folder"] / RECEIPT_FILENAME
        archive_folder = ARCHIVE_RUN_DIR / "Output_DraftCreati" / group["group_name"]
        try:
            receipt, draft_created, recovered_existing = prepare_draft_once(
                service,
                recipient_email=group["recipient_email"],
                cc_email=CC_EMAIL,
                subject=SUBJECT,
                body_text=group["body_text"],
                pdf_files=group["pdf_files"],
                receipt_path=receipt_path,
                archive_folder=archive_folder,
            )
            if draft_created:
                created_count += 1
                log(f"Draft created safely for {recipient_label}.")
            else:
                recovered_count += 1
                log(f"Existing draft recovered safely for {recipient_label}; no duplicate was created.")

            archived_pdf_files = archive_successful_group(group, receipt_path, receipt)
            archived_count += len(archived_pdf_files)
            log(f"Archived {len(archived_pdf_files)} verified PDF for {recipient_label}.")
            item = gmail_report_item(
                group,
                receipt=receipt,
                draft_created=draft_created,
                recovered_existing=recovered_existing,
                archived_pdf_files=archived_pdf_files,
            )
            item["ccEmail"] = CC_EMAIL
            item["subject"] = SUBJECT
            items.append(item)
        except Exception as error:
            error_type = type(error).__name__
            log(f"Draft workflow needs attention for {recipient_label}: {error_type}")
            errors.append(f"{group['group_name']}: {error_type}")
            item = gmail_report_item(group)
            item["status"] = "failed"
            item["errorType"] = error_type
            items.append(item)

    report = {
        **standard_report(
            workflow="gmail_drafts",
            mode="execute",
            started_at=started_at,
            finished_at=now_iso(),
            status=report_status(len(errors), 0),
            summary={
                "found": len(groups),
                "processed": len(items),
                "planned": len(groups),
                "created": created_count,
                "recovered": recovered_count,
                "moved": archived_count,
                "failed": len(errors),
                "warnings": 0,
            },
            items=items,
            warnings=[],
            errors=errors,
            report_path=REPORT_FILE,
            log_path=LOG_FILE,
        ),
        "details": {
            "outputFolder": str(OUTPUT_DIR),
            "subject": SUBJECT,
            "ccEmail": CC_EMAIL,
        },
    }
    write_report(REPORT_FILE, report)

    log(f"New drafts created: {created_count} | existing drafts recovered: {recovered_count}")
    log(f"Report: {REPORT_FILE}")
    log("=== END ===")
    if errors:
        raise SystemExit(2)


if __name__ == "__main__":
    try:
        main()
    except ConfigError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        raise SystemExit(2)
