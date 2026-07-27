from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scans" / "copy_scans.py"


class CopyScansTests(unittest.TestCase):
    def test_dry_run_reports_copy_without_writing_hotel_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "shared"
            destination = root / "cache"
            reports = root / "reports"
            source.mkdir()
            reports.mkdir()
            (source / "Sharp MFP sample.pdf").write_bytes(b"fake-pdf")
            (source / "unrelated.pdf").write_bytes(b"fake-pdf")
            config = root / "config.json"
            config.write_text(
                json.dumps(
                    {
                        "paths": {"scanSourceDir": str(source), "scanCacheDir": str(destination)},
                        "contracts": {"scannerFilePrefixes": ["Sharp MFP"]},
                    }
                ),
                encoding="utf-8",
            )
            report = reports / "report.json"

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--dry-run",
                    "--json-report",
                    str(report),
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(destination.exists())
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "dry_run")
            self.assertEqual(payload["summary"]["found"], 1)
            self.assertEqual(payload["summary"]["planned"], 1)

    def test_same_size_different_file_is_never_treated_as_already_copied(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "shared"
            destination = root / "cache"
            reports = root / "reports"
            source.mkdir()
            destination.mkdir()
            reports.mkdir()
            name = "Sharp MFP sample.pdf"
            (source / name).write_bytes(b"ABCD")
            (destination / name).write_bytes(b"WXYZ")
            config = root / "config.json"
            config.write_text(
                json.dumps(
                    {
                        "paths": {
                            "scanSourceDir": str(source),
                            "scanCacheDir": str(destination),
                        },
                        "contracts": {"scannerFilePrefixes": ["Sharp MFP"]},
                    }
                ),
                encoding="utf-8",
            )
            report = reports / "report.json"

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--json-report",
                    str(report),
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((destination / name).read_bytes(), b"WXYZ")
            self.assertEqual(
                (destination / "Sharp MFP sample (2).pdf").read_bytes(),
                b"ABCD",
            )
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["summary"]["copied"], 1)
            self.assertEqual(payload["summary"]["skipped"], 0)


if __name__ == "__main__":
    unittest.main()
