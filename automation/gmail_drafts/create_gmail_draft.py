import argparse
from pathlib import Path
import base64
import re
import shutil
import sys
from datetime import datetime
from email.message import EmailMessage

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.config import (  # noqa: E402
    ConfigError,
    config_bool,
    config_path,
    config_str,
    load_config,
)
from shared.report import now_iso, standard_report, write_report  # noqa: E402


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

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())

    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
        creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return build("gmail", "v1", credentials=creds)


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


def create_draft(service, recipient_email: str | None, body_text: str, pdf_files: list[Path]) -> str:
    message = EmailMessage()
    if recipient_email:
        message["To"] = recipient_email
    message["Cc"] = CC_EMAIL
    message["Subject"] = SUBJECT
    message.set_content(body_text)

    for pdf in pdf_files:
        message.add_attachment(
            pdf.read_bytes(),
            maintype="application",
            subtype="pdf",
            filename=pdf.name,
        )

    encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()

    draft = (
        service.users()
        .drafts()
        .create(userId="me", body={"message": {"raw": encoded_message}})
        .execute()
    )

    return draft.get("id")


def archive_successful_group(group: dict) -> list[str]:
    archive_group_dir = ARCHIVE_RUN_DIR / "Output_DraftCreati" / group["group_name"]
    archive_group_dir.mkdir(parents=True, exist_ok=True)

    archived_pdf_files = []
    for pdf in group["pdf_files"]:
        destination = unique_path(archive_group_dir / pdf.name)
        shutil.move(str(pdf), str(destination))
        archived_pdf_files.append(str(destination))

    body_file = group.get("body_file")
    if body_file and body_file.exists():
        body_file.unlink()

    try:
        if group["folder"].exists() and not any(group["folder"].iterdir()):
            group["folder"].rmdir()
    except OSError:
        pass

    return archived_pdf_files


def gmail_report_item(group: dict, *, draft_id: str | None = None, archived_pdf_files: list[str] | None = None) -> dict:
    item = {
        "recipientEmail": group["recipient_email"],
        "groupName": group["group_name"],
        "folder": str(group["folder"]),
        "pdfCount": len(group["pdf_files"]),
        "pdfFiles": [pdf.name for pdf in group["pdf_files"]],
    }
    if draft_id:
        item["draftId"] = draft_id
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
    input_pdfs = sorted(INPUT_DIR.glob("Funzione Pubblica amministrazione*.pdf"))

    log("=== START create Gmail draft ===")
    log(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    log(f"Funzione Pubblica amministrazione PDFs found: {len(input_pdfs)}")
    log(f"Output folder: {OUTPUT_DIR}")

    groups = find_recipient_groups()
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
    archived_count = 0

    for group in groups:
        draft_id = create_draft(
            service,
            group["recipient_email"],
            group["body_text"],
            group["pdf_files"],
        )

        recipient_label = group["recipient_email"] or "SenzaEmail (CC only)"
        log(f"Draft created for {recipient_label}. Draft ID: {draft_id}")
        archived_pdf_files = archive_successful_group(group)
        archived_count += len(archived_pdf_files)
        log(f"Archived {len(archived_pdf_files)} PDF for {recipient_label}.")

        item = gmail_report_item(group, draft_id=draft_id, archived_pdf_files=archived_pdf_files)
        item["ccEmail"] = CC_EMAIL
        item["subject"] = SUBJECT
        items.append(item)

    report = {
        **standard_report(
            workflow="gmail_drafts",
            mode="execute",
            started_at=started_at,
            finished_at=now_iso(),
            status="success",
            summary={
                "found": len(groups),
                "processed": len(groups),
                "planned": len(groups),
                "created": len(items),
                "moved": archived_count,
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

    log(f"Total drafts created: {len(items)}")
    log(f"Report: {REPORT_FILE}")
    log("=== END ===")


if __name__ == "__main__":
    try:
        main()
    except ConfigError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        raise SystemExit(2)
