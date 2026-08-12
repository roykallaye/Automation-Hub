from __future__ import annotations

import argparse
import json
import unittest
from unittest.mock import patch

from automation.gmail_drafts import create_gmail_draft as gmail_draft
from helpers import InnPilotWorkspace, count_files, latest_log_text, run_script


class CreateGmailDraftTests(unittest.TestCase):
    def test_authorize_only_never_reads_or_changes_invoice_work(self) -> None:
        with InnPilotWorkspace() as workspace:
            input_pdf = workspace.invoice_input / "unprocessed.pdf"
            input_pdf.write_bytes(b"%PDF-1.4\n")
            recipient_folder = workspace.invoice_output / "test@example.com"
            recipient_folder.mkdir(parents=True)
            ready_pdf = recipient_folder / "ready.pdf"
            ready_pdf.write_bytes(b"%PDF-1.4\n")
            body = recipient_folder / "email_body.txt"
            body.write_text("Do not touch this draft body.", encoding="utf-8")
            report = workspace.root / "gmail-authorization-report.json"
            args = argparse.Namespace(
                authorize_only=True,
                config=workspace.config_path,
                dry_run=False,
                json_report=report,
            )

            with (
                patch.object(gmail_draft, "get_service") as get_service,
                patch.object(
                    gmail_draft,
                    "find_recipient_groups",
                    side_effect=AssertionError("authorization inspected invoice groups"),
                ),
                patch.object(
                    gmail_draft,
                    "recover_completed_receipts",
                    side_effect=AssertionError("authorization entered archive recovery"),
                ),
            ):
                gmail_draft.main(args)

            get_service.assert_called_once_with()
            self.assertEqual(input_pdf.read_bytes(), b"%PDF-1.4\n")
            self.assertEqual(ready_pdf.read_bytes(), b"%PDF-1.4\n")
            self.assertEqual(body.read_text(encoding="utf-8"), "Do not touch this draft body.")
            self.assertEqual(count_files(workspace.invoice_archive), 0)
            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["workflow"], "gmail_authorization")
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["summary"], {"authorized": 1, "failed": 0})
            self.assertEqual(data["items"], [])

    def test_dry_run_reports_drafts_without_auth_or_file_moves(self) -> None:
        with InnPilotWorkspace() as workspace:
            recipient_folder = workspace.invoice_output / "test@example.com"
            recipient_folder.mkdir(parents=True)
            invoice = recipient_folder / "fake_invoice.pdf"
            invoice.write_bytes(b"%PDF-1.4\n% fake fixture\n")
            body = recipient_folder / "email_body.txt"
            body.write_text("Dear Partner,\nFixture body.", encoding="utf-8")
            report = workspace.root / "gmail-report.json"

            result = run_script(
                "automation/gmail_drafts/create_gmail_draft.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(invoice.exists())
            self.assertTrue(body.exists())
            self.assertEqual(count_files(workspace.invoice_archive), 0)
            self.assertTrue(report.exists())

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["workflow"], "gmail_drafts")
            self.assertEqual(data["mode"], "dry_run")
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["planned"], 1)
            self.assertEqual(data["summary"]["created"], 0)
            self.assertEqual(data["items"][0]["recipientEmail"], "test@example.com")
            self.assertEqual(data["items"][0]["pdfFiles"], ["fake_invoice.pdf"])
            self.assertEqual(data["outputs"]["reportPath"], str(report))

    def test_dry_run_does_not_need_or_expose_credential_contents(self) -> None:
        with InnPilotWorkspace() as workspace:
            secret_marker = "secret-value-that-must-not-appear"
            workspace.gmail_credentials_file.write_text(secret_marker, encoding="utf-8")
            workspace.gmail_token_file.write_text(secret_marker, encoding="utf-8")

            recipient_folder = workspace.invoice_output / "test@example.com"
            recipient_folder.mkdir(parents=True)
            (recipient_folder / "fake_invoice.pdf").write_bytes(b"%PDF-1.4\n")
            report = workspace.root / "gmail-report.json"

            result = run_script(
                "automation/gmail_drafts/create_gmail_draft.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            output = result.stdout + result.stderr
            output += report.read_text(encoding="utf-8")
            output += latest_log_text(workspace.invoice_logs, "create_gmail_draft_*.log")
            self.assertNotIn(secret_marker, output)

    def test_missing_config_fails_safely_without_google_auth(self) -> None:
        with InnPilotWorkspace() as workspace:
            result = run_script(
                "automation/gmail_drafts/create_gmail_draft.py",
                "--config",
                workspace.root / "missing.json",
                "--dry-run",
                "--json-report",
                workspace.root / "gmail-report.json",
            )

            self.assertEqual(result.returncode, 2)
            self.assertFalse((workspace.root / "gmail-report.json").exists())


if __name__ == "__main__":
    unittest.main()
