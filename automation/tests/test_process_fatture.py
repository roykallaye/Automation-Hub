from __future__ import annotations

import json
import unittest
from pathlib import Path

from helpers import InnPilotWorkspace, count_files, run_script


def create_invoice_pdf(path: Path) -> None:
    try:
        import pymupdf
    except ImportError as error:
        raise unittest.SkipTest("PyMuPDF is not installed; skipping PDF fixture test.") from error

    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text(
        (50, 72),
        "\n".join(
            [
                "Your Hotel",
                "123",
                "01/02/2026",
                "Eurotours Fixture",
                "Committente",
                "Cliente",
                "Mario Rossi",
                "Camera n.",
            ]
        ),
        fontsize=12,
    )
    document.save(path)
    document.close()


class ProcessFattureTests(unittest.TestCase):
    def test_dry_run_invalid_pdf_keeps_original_and_writes_temp_report(self) -> None:
        with InnPilotWorkspace() as workspace:
            invoice = workspace.invoice_input / "Funzione Pubblica amministrazione invalid.pdf"
            report = workspace.root / "invoice-invalid-report.json"
            invoice.write_bytes(b"not a real pdf")

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(invoice.exists())
            self.assertTrue(report.exists())
            self.assertFalse((workspace.invoice_output / "test@example.com").exists())
            self.assertEqual(count_files(workspace.invoice_archive), 0)

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["workflow"], "invoices")
            self.assertEqual(data["mode"], "dry_run")
            self.assertEqual(data["status"], "failed")
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["failed"], 1)
            self.assertEqual(data["items"][0]["status"], "error")
            self.assertEqual(data["outputs"]["reportPath"], str(report))

    def test_dry_run_keeps_original_and_does_not_finalize_outputs(self) -> None:
        with InnPilotWorkspace() as workspace:
            invoice = workspace.invoice_input / "Funzione Pubblica amministrazione fixture.pdf"
            report = workspace.root / "invoice-report.json"
            create_invoice_pdf(invoice)

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(invoice.exists())
            self.assertTrue(report.exists())
            self.assertFalse((workspace.invoice_output / "test@example.com").exists())
            self.assertEqual(count_files(workspace.invoice_archive), 0)

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["workflow"], "invoices")
            self.assertEqual(data["mode"], "dry_run")
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["processed"], 1)
            self.assertEqual(data["summary"]["planned"], 1)
            self.assertEqual(data["summary"]["created"], 0)
            self.assertEqual(data["items"][0]["recipient_email"], "test@example.com")
            self.assertIn("test@example.com", data["details"]["recipientGroups"])

    def test_missing_config_fails_safely_before_touching_workspace(self) -> None:
        with InnPilotWorkspace() as workspace:
            sentinel = workspace.invoice_input / "sentinel.txt"
            sentinel.write_text("keep", encoding="utf-8")

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.root / "missing.json",
                "--dry-run",
                "--json-report",
                workspace.root / "missing-report.json",
            )

            self.assertEqual(result.returncode, 2)
            self.assertTrue(sentinel.exists())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
