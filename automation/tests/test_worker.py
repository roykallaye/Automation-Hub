from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER = REPO_ROOT / "automation" / "worker.py"


class WorkerTests(unittest.TestCase):
    def run_worker(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-B", str(WORKER), *args],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_version_is_available_without_loading_a_workflow(self) -> None:
        result = self.run_worker("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("InnPilot automation worker", result.stdout)

    def test_arbitrary_python_execution_is_rejected(self) -> None:
        result = self.run_worker("-c", "print('must not run')")
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("must not run", result.stdout)
        self.assertIn("does not execute arbitrary Python code", result.stderr)

    def test_unknown_script_is_rejected_by_allowlist(self) -> None:
        result = self.run_worker(str(REPO_ROOT / "automation" / "unknown.py"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("allowlist", result.stderr)


if __name__ == "__main__":
    unittest.main()
