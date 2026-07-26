from __future__ import annotations

import base64
import hashlib
import json
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from shared.safe_files import atomic_write_text, sha256_file


RECEIPT_VERSION = 1


class DraftSafetyError(RuntimeError):
    """Raised when a draft retry cannot be proven safe."""


def attachment_records(pdf_files: list[Path]) -> list[dict[str, str]]:
    return [
        {"name": pdf.name, "sha256": sha256_file(pdf)}
        for pdf in sorted(pdf_files, key=lambda item: item.name.casefold())
    ]


def draft_fingerprint(
    *,
    recipient_email: str | None,
    cc_email: str,
    subject: str,
    body_text: str,
    attachments: list[dict[str, str]],
) -> str:
    canonical = json.dumps(
        {
            "recipientEmail": recipient_email,
            "ccEmail": cc_email,
            "subject": subject,
            "bodySha256": hashlib.sha256(body_text.encode("utf-8")).hexdigest(),
            "attachments": attachments,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def deterministic_message_id(fingerprint: str) -> str:
    return f"<innpilot-{fingerprint}@drafts.innpilot.local>"


def load_receipt(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DraftSafetyError(f"Draft recovery receipt is unreadable: {path}") from error
    if not isinstance(value, dict) or value.get("version") != RECEIPT_VERSION:
        raise DraftSafetyError(f"Draft recovery receipt has an unsupported format: {path}")
    return value


def validate_receipt(
    receipt: dict[str, Any],
    *,
    recipient_email: str | None,
    cc_email: str,
    subject: str,
    body_text: str,
    current_attachments: list[dict[str, str]],
) -> None:
    expected_body_hash = hashlib.sha256(body_text.encode("utf-8")).hexdigest()
    if (
        receipt.get("recipientEmail") != recipient_email
        or receipt.get("ccEmail") != cc_email
        or receipt.get("subject") != subject
        or receipt.get("bodySha256") != expected_body_hash
    ):
        raise DraftSafetyError(
            "Prepared draft content changed after a prior Gmail operation; manual review is required."
        )
    state = receipt.get("state")
    if state not in {"creating", "ready"}:
        raise DraftSafetyError("Draft recovery receipt has an invalid state.")
    if state == "ready" and (not isinstance(receipt.get("draftId"), str) or not receipt.get("draftId")):
        raise DraftSafetyError("Completed draft receipt has no valid Gmail draft identifier.")


    receipt_attachments = {
        (item.get("name"), item.get("sha256"))
        for item in receipt.get("attachments", [])
        if isinstance(item, dict)
    }
    for item in current_attachments:
        if (item["name"], item["sha256"]) not in receipt_attachments:
            raise DraftSafetyError(
                "Prepared attachments changed after a prior Gmail operation; manual review is required."
            )


def build_message(
    *,
    recipient_email: str | None,
    cc_email: str,
    subject: str,
    body_text: str,
    pdf_files: list[Path],
    message_id: str,
) -> EmailMessage:
    message = EmailMessage()
    if recipient_email:
        message["To"] = recipient_email
    message["Cc"] = cc_email
    message["Subject"] = subject
    message["Message-ID"] = message_id
    message.set_content(body_text)
    for pdf in pdf_files:
        message.add_attachment(
            pdf.read_bytes(),
            maintype="application",
            subtype="pdf",
            filename=pdf.name,
        )
    return message


def prepare_draft_once(
    service: Any,
    *,
    recipient_email: str | None,
    cc_email: str,
    subject: str,
    body_text: str,
    pdf_files: list[Path],
    receipt_path: Path,
    archive_folder: Path,
) -> tuple[dict[str, Any], bool, bool]:
    attachments = attachment_records(pdf_files)
    existing_receipt = load_receipt(receipt_path)
    if existing_receipt is not None:
        validate_receipt(
            existing_receipt,
            recipient_email=recipient_email,
            cc_email=cc_email,
            subject=subject,
            body_text=body_text,
            current_attachments=attachments,
        )
        if existing_receipt["state"] == "ready":
            return existing_receipt, False, True

        recovered_id = search_draft_id(service, existing_receipt["messageId"])
        if recovered_id is None:
            raise DraftSafetyError(
                "A previous Gmail draft attempt has an uncertain outcome. No duplicate was created; manual review is required."
            )
        existing_receipt["state"] = "ready"
        existing_receipt["draftId"] = recovered_id
        write_receipt(receipt_path, existing_receipt)
        return existing_receipt, False, True

    fingerprint = draft_fingerprint(
        recipient_email=recipient_email,
        cc_email=cc_email,
        subject=subject,
        body_text=body_text,
        attachments=attachments,
    )
    message_id = deterministic_message_id(fingerprint)
    receipt = {
        "version": RECEIPT_VERSION,
        "state": "creating",
        "fingerprint": fingerprint,
        "messageId": message_id,
        "draftId": None,
        "recipientEmail": recipient_email,
        "ccEmail": cc_email,
        "subject": subject,
        "bodySha256": hashlib.sha256(body_text.encode("utf-8")).hexdigest(),
        "attachments": attachments,
        "archiveFolder": str(archive_folder),
    }
    write_receipt(receipt_path, receipt)

    draft_id = search_draft_id(service, message_id)
    if draft_id is not None:
        created = False
    else:
        message = build_message(
            recipient_email=recipient_email,
            cc_email=cc_email,
            subject=subject,
            body_text=body_text,
            pdf_files=pdf_files,
            message_id=message_id,
        )
        encoded = base64.urlsafe_b64encode(message.as_bytes()).decode()
        created_draft = (
            service.users()
            .drafts()
            .create(userId="me", body={"message": {"raw": encoded}})
            .execute()
        )
        draft_id = created_draft.get("id")
        created = True

    if not isinstance(draft_id, str) or not draft_id:
        raise DraftSafetyError("Gmail did not return a valid draft identifier.")
    receipt["state"] = "ready"
    receipt["draftId"] = draft_id
    write_receipt(receipt_path, receipt)
    return receipt, created, not created


def search_draft_id(service: Any, message_id: str) -> str | None:
    matches = (
        service.users()
        .drafts()
        .list(userId="me", q=f"rfc822msgid:{message_id}", maxResults=2)
        .execute()
        .get("drafts", [])
    )
    if len(matches) > 1:
        raise DraftSafetyError(
            "Multiple Gmail drafts already share this InnPilot identifier; manual review is required."
        )
    if not matches:
        return None
    draft_id = matches[0].get("id")
    if not isinstance(draft_id, str) or not draft_id:
        raise DraftSafetyError("Gmail returned an invalid draft search result.")
    return draft_id


def write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    atomic_write_text(
        path,
        json.dumps(receipt, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
