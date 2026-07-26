from __future__ import annotations

import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


AUTOMATION_ROOT = Path(__file__).resolve().parents[1]
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from ocr import extract_scan_text  # noqa: E402


class FakeTextPage:
    def __init__(self, text: str) -> None:
        self.text = text
        self.closed = False

    def get_text_bounded(self) -> str:
        return self.text

    def close(self) -> None:
        self.closed = True


class FakeImage:
    def __init__(self, recognized: str) -> None:
        self.recognized = recognized
        self.closed = False

    def close(self) -> None:
        self.closed = True


class FakeBitmap:
    def __init__(self, recognized: str) -> None:
        self.image = FakeImage(recognized)
        self.closed = False

    def to_pil(self) -> FakeImage:
        return self.image

    def close(self) -> None:
        self.closed = True


class FakePage:
    def __init__(self, embedded: str, recognized: str = "") -> None:
        self.embedded = embedded
        self.recognized = recognized
        self.render_calls: list[dict] = []
        self.closed = False

    def get_textpage(self) -> FakeTextPage:
        return FakeTextPage(self.embedded)

    def render(self, **kwargs) -> FakeBitmap:
        self.render_calls.append(kwargs)
        return FakeBitmap(self.recognized)

    def close(self) -> None:
        self.closed = True


class FakeDocument:
    def __init__(self, pages: list[FakePage]) -> None:
        self.pages = pages
        self.closed = False

    def __len__(self) -> int:
        return len(self.pages)

    def __getitem__(self, index: int) -> FakePage:
        return self.pages[index]

    def close(self) -> None:
        self.closed = True


class FakePdfium:
    def __init__(self, document: FakeDocument) -> None:
        self.document = document

    def PdfDocument(self, _path: str) -> FakeDocument:
        return self.document


class ExtractScanTextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_pdfium = extract_scan_text.pdfium
        self.original_ocr_page_image = extract_scan_text.ocr_page_image

    def tearDown(self) -> None:
        extract_scan_text.pdfium = self.original_pdfium
        extract_scan_text.ocr_page_image = self.original_ocr_page_image

    def test_embedded_text_is_used_without_ocr(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "scan.pdf"
            pdf.write_bytes(b"fixture")
            page = FakePage("This page already contains enough embedded text.")
            extract_scan_text.pdfium = FakePdfium(FakeDocument([page]))

            result = extract_scan_text.extract_text(pdf, settings(root))

            self.assertEqual(result.embedded_pages, 1)
            self.assertEqual(result.ocr_pages, 0)
            self.assertEqual(page.render_calls, [])

    def test_image_page_uses_local_three_language_ocr(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            add_fake_language_data(root)
            pdf = root / "scan.pdf"
            pdf.write_bytes(b"fixture")
            page = FakePage("", "Contratto riconosciuto localmente")
            extract_scan_text.pdfium = FakePdfium(FakeDocument([page]))
            extract_scan_text.ocr_page_image = (
                lambda image, _settings: image.recognized
            )

            result = extract_scan_text.extract_text(pdf, settings(root))

            self.assertEqual(result.ocr_pages, 1)
            self.assertEqual(result.text, "Contratto riconosciuto localmente")
            self.assertAlmostEqual(page.render_calls[0]["scale"], 300 / 72)
            self.assertTrue(page.render_calls[0]["grayscale"])
            self.assertTrue(page.closed)

    def test_missing_language_data_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "scan.pdf"
            pdf.write_bytes(b"fixture")
            extract_scan_text.pdfium = FakePdfium(FakeDocument([FakePage("", "text")]))

            with self.assertRaisesRegex(RuntimeError, "language data"):
                extract_scan_text.extract_text(pdf, settings(root))

    def test_tesseract_subprocess_is_argument_safe_and_gets_a_minimal_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "tesseract.exe"
            executable.write_bytes(b"fixture")
            os_secret = "INNPILOT_SECRET_TEST_VALUE"
            extract_scan_text.os.environ[os_secret] = "must-not-be-forwarded"
            try:
                with mock.patch.object(
                    extract_scan_text, "find_tesseract_executable", return_value=executable
                ), mock.patch.object(
                    extract_scan_text.subprocess,
                    "run",
                    return_value=extract_scan_text.subprocess.CompletedProcess(
                        args=[], returncode=0, stdout="tesseract 5.5.3\n", stderr=""
                    ),
                ) as runner:
                    result = extract_scan_text.run_tesseract(["--version"], root)
            finally:
                extract_scan_text.os.environ.pop(os_secret, None)

            self.assertEqual(result.returncode, 0)
            command = runner.call_args.args[0]
            options = runner.call_args.kwargs
            self.assertEqual(command, [str(executable), "--version"])
            self.assertFalse(options["shell"])
            self.assertNotIn(os_secret, options["env"])

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
