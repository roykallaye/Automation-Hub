from __future__ import annotations

import json
import unittest

from helpers import InnPilotWorkspace, count_files, run_script


class ProcessContrattiTests(unittest.TestCase):
    def test_default_dry_run_reports_candidate_without_moving_pdf(self) -> None:
        with InnPilotWorkspace() as workspace:
            pdf = workspace.scans_cache / "Sharp MFP fixture.pdf"
            pdf.write_bytes(b"%PDF-1.4\n% fake scan\n")
            text = workspace.ocr_text / "Sharp MFP fixture.txt"
            text.write_text(
                "\n".join(
                    [
                        "Oggetto: Contratto di lavoro subordinato a tempo determinato",
                        "premesso che b) il sig. Mario Rossi all'esito del colloquio di selezione",
                    ]
                ),
                encoding="utf-8",
            )
            report = workspace.root / "contracts-report.json"

            result = run_script(
                "automation/contracts/process_contratti.py",
                "--config",
                workspace.config_path,
                "--json-report",
                report,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(pdf.exists())
            self.assertEqual(count_files(workspace.contracts_signed), 0)
            self.assertTrue(report.exists())

            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["workflow"], "contracts")
            self.assertEqual(data["mode"], "dry_run")
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["summary"]["found"], 1)
            self.assertEqual(data["summary"]["planned"], 1)
            self.assertEqual(data["summary"]["moved"], 0)
            self.assertEqual(data["items"][0]["status"], "planned_move")
            self.assertIn("destinationPath", data["items"][0])

    def test_missing_config_fails_safely_before_touching_workspace(self) -> None:
        with InnPilotWorkspace() as workspace:
            sentinel = workspace.scans_cache / "Sharp MFP sentinel.pdf"
            sentinel.write_bytes(b"keep")

            result = run_script(
                "automation/contracts/process_contratti.py",
                "--config",
                workspace.root / "missing.json",
                "--json-report",
                workspace.root / "contracts-report.json",
            )

            self.assertEqual(result.returncode, 2)
            self.assertTrue(sentinel.exists())
            self.assertEqual(count_files(workspace.contracts_signed), 0)


if __name__ == "__main__":
    unittest.main()
