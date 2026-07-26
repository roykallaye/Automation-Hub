from __future__ import annotations

import base64
import json
import sys
import tempfile
import unittest
from email.parser import BytesParser
from pathlib import Path

AUTOMATION_ROOT = Path(__file__).resolve().parents[1]
GMAIL_ROOT = AUTOMATION_ROOT / "gmail_drafts"
for path in [str(AUTOMATION_ROOT), str(GMAIL_ROOT)]:
    if path not in sys.path:
        sys.path.insert(0, path)

import create_gmail_draft  # noqa: E402
from draft_safety import DraftSafetyError, prepare_draft_once  # noqa: E402


class FakeRequest:
    def __init__(self, response: dict) -> None:
        self.response = response

    def execute(self) -> dict:
        return self.response


class FakeDrafts:
    def __init__(self, existing: list[dict] | None = None) -> None:
        self.existing = existing or []
        self.list_queries: list[str] = []
        self.create_bodies: list[dict] = []

    def list(self, *, userId: str, q: str, maxResults: int) -> FakeRequest:
        self.list_queries.append(q)
        return FakeRequest({"drafts": self.existing})

    def create(self, *, userId: str, body: dict) -> FakeRequest:
        self.create_bodies.append(body)
        return FakeRequest({"id": "new-draft-id"})


class FakeUsers:
    def __init__(self, drafts: FakeDrafts) -> None:
        self._drafts = drafts

    def drafts(self) -> FakeDrafts:
        return self._drafts


class FakeService:
    def __init__(self, existing: list[dict] | None = None) -> None:
        self.draft_api = FakeDrafts(existing)

    def users(self) -> FakeUsers:
        return FakeUsers(self.draft_api)


class DraftSafetyTests(unittest.TestCase):
    def test_first_attempt_creates_one_deterministic_draft_and_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "invoice.pdf"
            pdf.write_bytes(b"%PDF-1.4\nfixture")
            receipt_path = root / ".innpilot-draft-receipt.json"
            service = FakeService()

            receipt, created, recovered = prepare_draft_once(
                service,
                recipient_email="partner@example.test",
                cc_email="accounting@example.test",
                subject="Fixture invoices",
                body_text="Dear Partner",
                pdf_files=[pdf],
                receipt_path=receipt_path,
                archive_folder=root / "archive",
            )

            self.assertTrue(created)
            self.assertFalse(recovered)
            self.assertTrue(receipt_path.exists())
            self.assertEqual(len(service.draft_api.list_queries), 1)
            self.assertEqual(len(service.draft_api.create_bodies), 1)
            raw = service.draft_api.create_bodies[0]["message"]["raw"]
            parsed = BytesParser().parsebytes(base64.urlsafe_b64decode(raw))
            self.assertEqual(parsed["Message-ID"], receipt["messageId"])
            self.assertIn(receipt["messageId"], service.draft_api.list_queries[0])

            repeated, repeated_created, repeated_recovered = prepare_draft_once(
                object(),
                recipient_email="partner@example.test",
                cc_email="accounting@example.test",
                subject="Fixture invoices",
                body_text="Dear Partner",
                pdf_files=[pdf],
                receipt_path=receipt_path,
                archive_folder=root / "different-run",
            )
            self.assertFalse(repeated_created)
            self.assertTrue(repeated_recovered)
            self.assertEqual(repeated["draftId"], receipt["draftId"])

    def test_gmail_search_recovers_a_draft_when_crash_preceded_receipt_write(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "invoice.pdf"
            pdf.write_bytes(b"%PDF-1.4\nfixture")
            service = FakeService(existing=[{"id": "existing-draft-id"}])

            receipt, created, recovered = prepare_draft_once(
                service,
                recipient_email="partner@example.test",
                cc_email="accounting@example.test",
                subject="Fixture invoices",
                body_text="Dear Partner",
                pdf_files=[pdf],
                receipt_path=root / ".innpilot-draft-receipt.json",
                archive_folder=root / "archive",
            )

            self.assertFalse(created)
            self.assertTrue(recovered)
            self.assertEqual(receipt["draftId"], "existing-draft-id")
            self.assertEqual(service.draft_api.create_bodies, [])

    def test_uncertain_creation_attempt_fails_closed_instead_of_creating_again(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "invoice.pdf"
            pdf.write_bytes(b"%PDF-1.4\nfixture")
            receipt_path = root / ".innpilot-draft-receipt.json"
            receipt, _, _ = prepare_draft_once(
                FakeService(),
                recipient_email="partner@example.test",
                cc_email="accounting@example.test",
                subject="Fixture invoices",
                body_text="Dear Partner",
                pdf_files=[pdf],
                receipt_path=receipt_path,
                archive_folder=root / "archive",
            )
            receipt["state"] = "creating"
            receipt["draftId"] = None
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            retry_service = FakeService()

            with self.assertRaises(DraftSafetyError):
                prepare_draft_once(
                    retry_service,
                    recipient_email="partner@example.test",
                    cc_email="accounting@example.test",
                    subject="Fixture invoices",
                    body_text="Dear Partner",
                    pdf_files=[pdf],
                    receipt_path=receipt_path,
                    archive_folder=root / "archive",
                )

            self.assertEqual(len(retry_service.draft_api.list_queries), 1)
            self.assertEqual(retry_service.draft_api.create_bodies, [])

    def test_changed_attachment_blocks_automatic_retry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "invoice.pdf"
            pdf.write_bytes(b"first")
            receipt_path = root / ".innpilot-draft-receipt.json"
            prepare_draft_once(
                FakeService(),
                recipient_email="partner@example.test",
                cc_email="accounting@example.test",
                subject="Fixture invoices",
                body_text="Dear Partner",
                pdf_files=[pdf],
                receipt_path=receipt_path,
                archive_folder=root / "archive",
            )
            pdf.write_bytes(b"changed")

            with self.assertRaises(DraftSafetyError):
                prepare_draft_once(
                    object(),
                    recipient_email="partner@example.test",
                    cc_email="accounting@example.test",
                    subject="Fixture invoices",
                    body_text="Dear Partner",
                    pdf_files=[pdf],
                    receipt_path=receipt_path,
                    archive_folder=root / "archive",
                )

    def test_archive_moves_verified_files_and_receipt_without_deleting_early(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "output" / "partner@example.test"
            archive = root / "archive"
            output.mkdir(parents=True)
            pdf = output / "invoice.pdf"
            body = output / "email_body.txt"
            receipt_path = output / ".innpilot-draft-receipt.json"
            pdf.write_bytes(b"invoice")
            body.write_text("body", encoding="utf-8")
            receipt_path.write_text("{}", encoding="utf-8")
            previous_archive = create_gmail_draft.ARCHIVE_DIR
            create_gmail_draft.ARCHIVE_DIR = archive
            try:
                moved = create_gmail_draft.archive_successful_group(
                    {"folder": output, "pdf_files": [pdf], "body_file": body},
                    receipt_path,
                    {"archiveFolder": str(archive / "run" / "partner@example.test")},
                )
            finally:
                create_gmail_draft.ARCHIVE_DIR = previous_archive

            self.assertEqual(len(moved), 1)
            self.assertFalse(output.exists())
            self.assertEqual((archive / "run" / "partner@example.test" / "invoice.pdf").read_bytes(), b"invoice")
            self.assertTrue((archive / "run" / "partner@example.test" / "email_body.txt").exists())
            self.assertTrue((archive / "run" / "partner@example.test" / ".innpilot-draft-receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
