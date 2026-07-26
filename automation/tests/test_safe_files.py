from __future__ import annotations

import tempfile
import sys
import unittest
from pathlib import Path

AUTOMATION_ROOT = Path(__file__).resolve().parents[1]
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from shared.safe_files import (
    atomic_write_bytes,
    copy_verified_atomic,
    move_verified_atomic,
    same_file_contents,
    sha256_file,
)


class SafeFilesTests(unittest.TestCase):
    def test_copy_publishes_identical_bytes_without_overwriting(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.pdf"
            destination = root / "nested" / "destination.pdf"
            source.write_bytes(b"fixture-one")

            self.assertEqual(copy_verified_atomic(source, destination), "copied")
            self.assertTrue(source.exists())
            self.assertTrue(same_file_contents(source, destination))
            self.assertEqual(sha256_file(source), sha256_file(destination))

            self.assertEqual(copy_verified_atomic(source, destination), "existing")
            destination.write_bytes(b"fixture-two")
            with self.assertRaises(FileExistsError):
                copy_verified_atomic(source, destination)
            self.assertEqual(destination.read_bytes(), b"fixture-two")

    def test_move_removes_source_only_after_verified_destination(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.pdf"
            destination = root / "archive" / "source.pdf"
            source.write_bytes(b"fixture")

            self.assertEqual(move_verified_atomic(source, destination), "moved")
            self.assertFalse(source.exists())
            self.assertEqual(destination.read_bytes(), b"fixture")

    def test_atomic_bytes_replace_never_leaves_a_partial_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "Secrets" / "oauth.dpapi"

            atomic_write_bytes(destination, b"first")
            atomic_write_bytes(destination, b"second")

            self.assertEqual(destination.read_bytes(), b"second")
            self.assertEqual(
                [path for path in destination.parent.iterdir() if path.suffix == ".partial"],
                [],
            )


if __name__ == "__main__":
    unittest.main()
