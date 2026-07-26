from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from helpers import InnPilotWorkspace, count_files, run_script
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "invoices"))

import process_fatture  # noqa: E402


def pdf_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def create_text_pdf(
    path: Path,
    entries: list[tuple[float, float, str]],
    *,
    rotation: int = 0,
) -> None:
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    commands = ["BT", "/F1 12 Tf"]
    commands.extend(
        f"1 0 0 1 {x} {y} Tm ({pdf_string(text)}) Tj" for x, y, text in entries
    )
    commands.append("ET")
    content = DecodedStreamObject()
    content.set_data(("\n".join(commands) + "\n").encode("latin-1"))
    page[NameObject("/Contents")] = writer._add_object(content)
    if rotation:
        page[NameObject("/Rotate")] = NumberObject(rotation)
    with path.open("wb") as stream:
        writer.write(stream)


def create_invoice_pdf(path: Path) -> None:
    lines = [
        "Your Hotel", "123", "01/02/2026", "Eurotours Fixture",
        "Committente", "Cliente", "Mario Rossi", "Camera n.",
    ]
    create_text_pdf(path, [(50, 790 - index * 22, line) for index, line in enumerate(lines)])


class ProcessFattureTests(unittest.TestCase):
    def test_single_copy_crop_preserves_the_expected_half_for_supported_rotations(self) -> None:
        cases = [
            (
                0,
                [(50, 700, "SELECTED LEFT COPY"), (380, 700, "REJECTED RIGHT COPY")],
                "SELECTED LEFT COPY",
                "REJECTED RIGHT COPY",
            ),
            (
                90,
                [(50, 700, "SELECTED TOP COPY"), (50, 120, "REJECTED BOTTOM COPY")],
                "SELECTED TOP COPY",
                "REJECTED BOTTOM COPY",
            ),
            (
                270,
                [(50, 700, "REJECTED TOP COPY"), (50, 120, "SELECTED BOTTOM COPY")],
                "SELECTED BOTTOM COPY",
                "REJECTED TOP COPY",
            ),
        ]
        with InnPilotWorkspace() as workspace:
            for rotation, entries, selected, rejected in cases:
                with self.subTest(rotation=rotation):
                    source = workspace.root / f"source-{rotation}.pdf"
                    output = workspace.root / f"output-{rotation}.pdf"
                    create_text_pdf(source, entries, rotation=rotation)

                    text = process_fatture.create_single_copy_pdf_and_text(source, output)

                    self.assertIn(selected, text)
                    self.assertNotIn(rejected, text)
                    self.assertTrue(output.is_file())

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

    def test_execute_refuses_to_delete_inputs_when_verified_archiving_is_disabled(self) -> None:
        with InnPilotWorkspace() as workspace:
            config = workspace.config()
            config["safety"]["archiveSuccessfulOriginals"] = False
            workspace.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            invoice = workspace.invoice_input / "Funzione Pubblica amministrazione fixture.pdf"
            invoice.write_bytes(b"%PDF-1.4\n% fail-closed fixture\n")

            result = run_script(
                "automation/invoices/process_fatture.py",
                "--config",
                workspace.config_path,
                "--json-report",
                workspace.root / "must-not-exist.json",
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("archiveSuccessfulOriginals=true", result.stderr)
            self.assertTrue(invoice.exists())
            self.assertEqual(count_files(workspace.invoice_output), 0)
            self.assertEqual(count_files(workspace.invoice_archive), 0)

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
