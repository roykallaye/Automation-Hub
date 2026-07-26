from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


AUTOMATION_ROOT = Path(__file__).resolve().parents[1]
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from ocr import extract_scan_text  # noqa: E402


class FakeTextPage:
    def __init__(self, text: str) -> None:
        self.text = text


class FakePage:
    def __init__(self, embedded: str, recognized: str = "") -> None:
        self.embedded = embedded
        self.recognized = recognized
        self.ocr_calls: list[dict] = []

    def get_text(self, _kind: str, textpage: FakeTextPage | None = None) -> str:
        return textpage.text if textpage else self.embedded

    def get_textpage_ocr(self, **kwargs) -> FakeTextPage:
        self.ocr_calls.append(kwargs)
        return FakeTextPage(self.recognized)


class FakeDocument:
    is_encrypted = False

    def __init__(self, pages: list[FakePage]) -> None:
        self.pages = pages

    def __enter__(self) -> "FakeDocument":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def __iter__(self):
        return iter(self.pages)


class FakeFitz:
    def __init__(self, document: FakeDocument) -> None:
        self.document = document

    def open(self, _path: Path) -> FakeDocument:
        return self.document


class ExtractScanTextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_fitz = extract_scan_text.fitz

    def tearDown(self) -> None:
        extract_scan_text.fitz = self.original_fitz

    def test_embedded_text_is_used_without_ocr(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "scan.pdf"
            pdf.write_bytes(b"fixture")
            page = FakePage("This page already contains enough embedded text.")
            extract_scan_text.fitz = FakeFitz(FakeDocument([page]))

            result = extract_scan_text.extract_text(pdf, settings(root))

            self.assertEqual(result.embedded_pages, 1)
            self.assertEqual(result.ocr_pages, 0)
            self.assertEqual(page.ocr_calls, [])

    def test_image_page_uses_local_three_language_ocr(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            add_fake_language_data(root)
            pdf = root / "scan.pdf"
            pdf.write_bytes(b"fixture")
            page = FakePage("", "Contratto riconosciuto localmente")
            extract_scan_text.fitz = FakeFitz(FakeDocument([page]))

            result = extract_scan_text.extract_text(pdf, settings(root))

            self.assertEqual(result.ocr_pages, 1)
            self.assertEqual(result.text, "Contratto riconosciuto localmente")
            self.assertEqual(page.ocr_calls[0]["language"], "ita+eng+deu")
            self.assertEqual(page.ocr_calls[0]["tessdata"], str(root))
            self.assertTrue(page.ocr_calls[0]["full"])

    def test_missing_language_data_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "scan.pdf"
            pdf.write_bytes(b"fixture")
            extract_scan_text.fitz = FakeFitz(FakeDocument([FakePage("", "text")]))

            with self.assertRaisesRegex(RuntimeError, "language data"):
                extract_scan_text.extract_text(pdf, settings(root))

    def test_invalid_cli_limit_is_rejected_instead_of_falling_back(self) -> None:
        args = extract_scan_text.argparse.Namespace(
            languages=None,
            tessdata=None,
            max_pages=0,
            dpi=None,
            min_embedded_chars=None,
        )

        with self.assertRaisesRegex(extract_scan_text.ConfigError, "--max-pages"):
            extract_scan_text.build_settings(
                {},
                Path.cwd(),
                args,
            )

    def test_hash_sidecar_prevents_stale_output_from_being_reused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "scan.pdf"
            target = root / "scan.txt"
            pdf.write_bytes(b"first")
            extract_scan_text.write_extraction(
                target, "recognized", extract_scan_text.sha256_file(pdf)
            )
            self.assertTrue(extract_scan_text.output_is_current(pdf, target))

            pdf.write_bytes(b"other")
            self.assertFalse(extract_scan_text.output_is_current(pdf, target))


def settings(tessdata: Path) -> extract_scan_text.OcrSettings:
    return extract_scan_text.OcrSettings(
        languages=("ita", "eng", "deu"),
        tessdata_dir=tessdata,
        max_pages=20,
        dpi=300,
        min_embedded_chars=24,
        max_file_bytes=1024 * 1024,
    )


def add_fake_language_data(root: Path) -> None:
    for language in ("ita", "eng", "deu"):
        (root / f"{language}.traineddata").write_bytes(b"fixture")


if __name__ == "__main__":
    unittest.main()
