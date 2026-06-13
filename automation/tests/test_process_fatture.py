from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from helpers import InnPilotWorkspace, count_files, run_script

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "invoices"))

import process_fatture  # noqa: E402


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

    def test_dry_run_uses_multiple_invoice_input_patterns_without_duplicates(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["invoice"]["inputGlobs"] = ["Booking*.pdf", "*.pdf"]
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            invoice = workspace.invoice_input / "Booking fixture.pdf"
            report = workspace.root / "invoice-multiple-patterns-report.json"
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

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["planned"], 1)

    def test_dry_run_all_pdfs_mode_processes_arbitrary_pdf_names(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["invoice"]["fileSelectionMode"] = "allPdfs"
            config["invoice"]["inputGlobs"] = ["Funzione Pubblica amministrazione*.pdf"]
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            invoice = workspace.invoice_input / "renamed by reception.pdf"
            report = workspace.root / "invoice-all-pdfs-report.json"
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

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["details"]["fileSelectionMode"], "allPdfs")
            self.assertEqual(data["summary"]["candidatePdfsFound"], 1)
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["skippedByFilenameFilter"], 0)

    def test_dry_run_ignores_non_pdf_files_in_all_pdfs_mode(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["invoice"]["fileSelectionMode"] = "allPdfs"
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            invoice = workspace.invoice_input / "manual-name.pdf"
            note = workspace.invoice_input / "do-not-process.txt"
            report = workspace.root / "invoice-ignore-non-pdf-report.json"
            create_invoice_pdf(invoice)
            note.write_text("not an invoice pdf", encoding="utf-8")

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(note.exists())

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["ignoredNonPdf"], 1)

    def test_filename_patterns_mode_skips_non_matching_pdfs(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["invoice"]["fileSelectionMode"] = "filenamePatterns"
            config["invoice"]["inputGlobs"] = ["Booking*.pdf"]
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            matching = workspace.invoice_input / "Booking fixture.pdf"
            skipped = workspace.invoice_input / "manual-name.pdf"
            report = workspace.root / "invoice-filter-report.json"
            create_invoice_pdf(matching)
            create_invoice_pdf(skipped)

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(skipped.exists())

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["details"]["fileSelectionMode"], "filenamePatterns")
            self.assertEqual(data["summary"]["candidatePdfsFound"], 2)
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["skippedByFilenameFilter"], 1)

    def test_legacy_input_glob_without_selection_mode_keeps_filename_filtering(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["invoice"].pop("inputGlobs", None)
            config["invoice"]["inputGlob"] = "Booking*.pdf"
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            matching = workspace.invoice_input / "Booking fixture.pdf"
            skipped = workspace.invoice_input / "manual-name.pdf"
            report = workspace.root / "invoice-legacy-glob-report.json"
            create_invoice_pdf(matching)
            create_invoice_pdf(skipped)

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.config_path,
                "--dry-run",
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["details"]["fileSelectionMode"], "filenamePatterns")
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["skippedByFilenameFilter"], 1)

    def test_dry_run_prepare_only_reports_gmail_skipped_by_mode(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["invoice"]["deliveryMode"] = "prepareOnly"
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            invoice = workspace.invoice_input / "Funzione Pubblica amministrazione fixture.pdf"
            report = workspace.root / "invoice-prepare-only-report.json"
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

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["details"]["deliveryMode"], "prepareOnly")
            self.assertTrue(data["details"]["gmailSkippedByMode"])

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


class RenderEmailBodyTests(unittest.TestCase):
    def test_default_template_renders_signature(self) -> None:
        body = process_fatture.render_email_body(
            process_fatture.DEFAULT_EMAIL_BODY_TEMPLATE,
            hotel_name="Hotel Bellavista",
            signature="Front Office Team",
            invoice_count=3,
            date_text="13/06/2026",
        )

        self.assertIn("Dear Partner,", body)
        self.assertIn("Front Office Team", body)
        self.assertNotIn("{signature}", body)

    def test_custom_template_renders_all_placeholders(self) -> None:
        body = process_fatture.render_email_body(
            "From {hotelName} on {date}: {invoiceCount} invoices.\n{signature}",
            hotel_name="Hotel Bellavista",
            signature="The Team",
            invoice_count=2,
            date_text="13/06/2026",
        )

        self.assertEqual(
            body,
            "From Hotel Bellavista on 13/06/2026: 2 invoices.\nThe Team",
        )

    def test_unknown_placeholders_are_left_untouched(self) -> None:
        body = process_fatture.render_email_body(
            "Hello {guestName}, regards {signature}",
            hotel_name="Hotel",
            signature="Team",
            invoice_count=1,
            date_text="13/06/2026",
        )

        self.assertEqual(body, "Hello {guestName}, regards Team")

    def test_blank_template_falls_back_to_default(self) -> None:
        body = process_fatture.render_email_body(
            "   \n  ",
            hotel_name="Hotel",
            signature="Team",
            invoice_count=1,
            date_text="13/06/2026",
        )

        self.assertIn("Dear Partner,", body)
        self.assertIn("Team", body)


if __name__ == "__main__":
    unittest.main()
