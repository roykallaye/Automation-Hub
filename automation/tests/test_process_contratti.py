from __future__ import annotations

import unittest

from helpers import FlowHostWorkspace, count_files, latest_log_text, run_script


class ProcessContrattiTests(unittest.TestCase):
    def test_default_dry_run_reports_candidate_without_moving_pdf(self) -> None:
        with FlowHostWorkspace() as workspace:
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

            result = run_script(
                "automation/contracts/process_contratti.py",
                "--config",
                workspace.config_path,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(pdf.exists())
            self.assertEqual(count_files(workspace.contracts_signed), 0)
            log_text = latest_log_text(workspace.contract_logs, "process_contratti_*.log")
            self.assertIn("PDF identified as contract", log_text)
            self.assertIn("DRY RUN would rename and move", log_text)

    def test_missing_config_fails_safely_before_touching_workspace(self) -> None:
        with FlowHostWorkspace() as workspace:
            sentinel = workspace.scans_cache / "Sharp MFP sentinel.pdf"
            sentinel.write_bytes(b"keep")

            result = run_script(
                "automation/contracts/process_contratti.py",
                "--config",
                workspace.root / "missing.json",
            )

            self.assertEqual(result.returncode, 2)
            self.assertTrue(sentinel.exists())
            self.assertEqual(count_files(workspace.contracts_signed), 0)


if __name__ == "__main__":
    unittest.main()
