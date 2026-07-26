from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(
    os.environ.get("INNPILOT_AUTOMATION_ROOT", Path(__file__).resolve().parent.parent)
) / "ocr"
AUTOMATION_ROOT = SCRIPT_DIR.parent
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from shared.config import ConfigError, config_path, config_str_list, config_value, load_config
from shared.report import now_iso, report_status, standard_report, write_report
from shared.safe_files import atomic_write_text, sha256_file

try:
    import pypdfium2 as pdfium
except ImportError:
    pdfium = None


DEFAULT_LANGUAGES = ["ita", "eng", "deu"]
DEFAULT_MAX_PAGES = 20
DEFAULT_DPI = 300
DEFAULT_MIN_EMBEDDED_CHARS = 24
DEFAULT_MAX_FILE_MB = 50
TESSERACT_VERSION = "5.5.3"
OCR_PAGE_TIMEOUT_SECONDS = 90
MAX_OCR_TEXT_BYTES = 5 * 1024 * 1024


@dataclass(frozen=True)
class OcrSettings:
    languages: tuple[str, ...]
    tessdata_dir: Path
    max_pages: int
    dpi: int
    min_embedded_chars: int
    max_file_bytes: int

    @property
    def language_spec(self) -> str:
        return "+".join(self.languages)


@dataclass(frozen=True)
class ExtractionResult:
    text: str
    embedded_pages: int
    ocr_pages: int


def config_int(
    config: dict,
    section_name: str,
    key: str,
    fallback: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = config_value(config, section_name, key, fallback)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(f"Config value '{section_name}.{key}' must be a whole number.")
    if not minimum <= value <= maximum:
        raise ConfigError(
            f"Config value '{section_name}.{key}' must be between {minimum} and {maximum}."
        )
    return value


def cli_or_config_int(
    cli_value: int | None,
    cli_name: str,
    config: dict,
    config_key: str,
    fallback: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    if cli_value is None:
        return config_int(
            config, "ocr", config_key, fallback, minimum=minimum, maximum=maximum
        )
    if not minimum <= cli_value <= maximum:
        raise ConfigError(f"{cli_name} must be between {minimum} and {maximum}.")
    return cli_value


def build_settings(config: dict, config_base: Path, args: argparse.Namespace) -> OcrSettings:
    languages = (
        [part.strip() for part in args.languages.split("+") if part.strip()]
        if args.languages
        else config_str_list(config, "ocr", "languages", "language", DEFAULT_LANGUAGES)
    )
    if not languages:
        raise ConfigError("Configure at least one local OCR language.")
    for language in languages:
        if not language.isascii() or not language.replace("_", "").isalnum():
            raise ConfigError(
                "OCR language codes may contain only letters, numbers, and underscores."
            )

    packaged_tessdata = SCRIPT_DIR / "tessdata"
    tessdata_dir = args.tessdata or config_path(
        config, "ocr", "tessdataDir", packaged_tessdata, config_base
    )
    max_pages = cli_or_config_int(
        args.max_pages,
        "--max-pages",
        config,
        "maxPages",
        DEFAULT_MAX_PAGES,
        minimum=1,
        maximum=100,
    )
    dpi = cli_or_config_int(
        args.dpi, "--dpi", config, "dpi", DEFAULT_DPI, minimum=150, maximum=600
    )
    min_embedded_chars = cli_or_config_int(
        args.min_embedded_chars,
        "--min-embedded-chars",
        config,
        "minEmbeddedChars",
        DEFAULT_MIN_EMBEDDED_CHARS,
        minimum=1,
        maximum=1000,
    )
    max_file_mb = config_int(
        config, "ocr", "maxFileMb", DEFAULT_MAX_FILE_MB, minimum=1, maximum=500
    )
    return OcrSettings(
        languages=tuple(languages),
        tessdata_dir=tessdata_dir,
        max_pages=max_pages,
        dpi=dpi,
        min_embedded_chars=min_embedded_chars,
        max_file_bytes=max_file_mb * 1024 * 1024,
    )


def validate_tessdata(settings: OcrSettings) -> None:
    if not settings.tessdata_dir.is_dir():
        raise RuntimeError(
            "Local OCR language data is missing. Reinstall or refresh InnPilot's managed scripts."
        )
    missing = [
        language
        for language in settings.languages
        if not (settings.tessdata_dir / f"{language}.traineddata").is_file()
    ]
    if missing:
        raise RuntimeError(
            "Local OCR language data is incomplete. Missing: " + ", ".join(sorted(missing))
        )


def find_tesseract_executable() -> Path:
    candidates: list[Path] = []
    configured = os.environ.get("INNPILOT_TESSERACT_EXE", "").strip()
    if configured:
        candidates.append(Path(configured))
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        candidates.append(Path(bundle_root) / "tesseract" / "tesseract.exe")
    candidates.extend(
        [
            Path(__file__).resolve().parents[2]
            / "build"
            / "tesseract-runtime"
            / "tesseract.exe",
            SCRIPT_DIR / "tesseract" / "tesseract.exe",
        ]
    )
    discovered = shutil.which("tesseract")
    if discovered:
        candidates.append(Path(discovered))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("The verified local OCR engine is missing. Reinstall InnPilot.")


def minimal_tesseract_environment(runtime_dir: Path, temporary_dir: Path) -> dict[str, str]:
    return {
        "PATH": str(runtime_dir),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", r"C:\Windows"),
        "WINDIR": os.environ.get("WINDIR", r"C:\Windows"),
        "TEMP": str(temporary_dir),
        "TMP": str(temporary_dir),
    }


def run_tesseract(arguments: list[str], temporary_dir: Path) -> subprocess.CompletedProcess[str]:
    executable = find_tesseract_executable()
    try:
        return subprocess.run(
            [str(executable), *arguments],
            cwd=executable.parent,
            env=minimal_tesseract_environment(executable.parent, temporary_dir),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=OCR_PAGE_TIMEOUT_SECONDS,
            check=False,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Local OCR timed out while reading a page.") from error
    except OSError as error:
        raise RuntimeError("The verified local OCR engine could not start.") from error


def tesseract_version() -> str:
    with tempfile.TemporaryDirectory(prefix="innpilot-ocr-health-") as temporary:
        result = run_tesseract(["--version"], Path(temporary))
    lines = (result.stdout or result.stderr).splitlines()
    version = lines[0].strip() if lines else ""
    if result.returncode != 0 or not version.startswith(f"tesseract v{TESSERACT_VERSION}"):
        raise RuntimeError("The local OCR engine failed its version integrity check.")
    return version


def ocr_page_image(image: object, settings: OcrSettings) -> str:
    validate_tessdata(settings)
    with tempfile.TemporaryDirectory(prefix="innpilot-ocr-page-") as temporary:
        temporary_dir = Path(temporary)
        image_path = temporary_dir / "page.png"
        output_base = temporary_dir / "recognized"
        image.save(image_path, format="PNG")
        result = run_tesseract(
            [
                str(image_path),
                str(output_base),
                "--tessdata-dir",
                str(settings.tessdata_dir.resolve()),
                "-l",
                settings.language_spec,
                "--dpi",
                str(settings.dpi),
            ],
            temporary_dir,
        )
        output_path = output_base.with_suffix(".txt")
        if result.returncode != 0 or not output_path.is_file():
            raise RuntimeError("Local OCR could not recognize this page.")
        if output_path.stat().st_size > MAX_OCR_TEXT_BYTES:
            raise RuntimeError("Local OCR output exceeded the safety limit.")
        return output_path.read_text(encoding="utf-8", errors="replace").strip()


def run_ocr_self_test(tessdata_dir: Path) -> bool:
    from PIL import Image, ImageDraw, ImageFont

    settings = OcrSettings(
        languages=("eng",),
        tessdata_dir=tessdata_dir,
        max_pages=1,
        dpi=300,
        min_embedded_chars=24,
        max_file_bytes=1024 * 1024,
    )
    image = Image.new("L", (1600, 360), color=255)
    try:
        font_path = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "arial.ttf"
        font = ImageFont.truetype(str(font_path), 110)
        ImageDraw.Draw(image).text((70, 90), "INNPILOT OCR 2026", fill=0, font=font)
        recognized = ocr_page_image(image, settings).upper()
        return "INNPILOT" in recognized and "2026" in recognized
    finally:
        image.close()


def extract_text(pdf: Path, settings: OcrSettings) -> ExtractionResult:
    if pdfium is None:
        raise RuntimeError("The managed PDF renderer is not installed. Reinstall InnPilot.")
    if pdf.stat().st_size > settings.max_file_bytes:
        raise RuntimeError("PDF exceeds the configured local OCR size limit.")

    text_pages: list[str] = []
    embedded_pages = 0
    ocr_pages = 0
    try:
        document = pdfium.PdfDocument(str(pdf))
    except Exception as error:
        raise RuntimeError("The PDF is invalid, encrypted, or unsupported.") from error
    try:
        for page_number in range(min(len(document), settings.max_pages)):
            page = document[page_number]
            try:
                text_page = page.get_textpage()
                try:
                    embedded = text_page.get_text_bounded().strip()
                finally:
                    text_page.close()
                if len(embedded) >= settings.min_embedded_chars:
                    text_pages.append(embedded)
                    embedded_pages += 1
                    continue

                bitmap = page.render(scale=settings.dpi / 72, grayscale=True)
                try:
                    image = bitmap.to_pil()
                    try:
                        recognized = ocr_page_image(image, settings)
                    finally:
                        image.close()
                finally:
                    bitmap.close()
                text_pages.append(recognized)
                ocr_pages += 1
            finally:
                page.close()
    finally:
        document.close()

    return ExtractionResult(
        text="\n\n".join(text for text in text_pages if text).strip(),
        embedded_pages=embedded_pages,
        ocr_pages=ocr_pages,
    )


def source_hash_path(text_path: Path) -> Path:
    return text_path.with_suffix(text_path.suffix + ".source.sha256")


def output_is_current(pdf: Path, text_path: Path) -> bool:
    digest_path = source_hash_path(text_path)
    if not text_path.is_file() or not digest_path.is_file():
        return False
    try:
        recorded = digest_path.read_text(encoding="ascii").strip().lower()
    except OSError:
        return False
    return len(recorded) == 64 and recorded == sha256_file(pdf)


def write_extraction(text_path: Path, text: str, source_digest: str) -> None:
    atomic_write_text(text_path, text)
    atomic_write_text(source_hash_path(text_path), source_digest + "\n", encoding="ascii")


def run(args: argparse.Namespace) -> int:
    started_at = now_iso()
    config = load_config(args.config)
    base = args.config.resolve().parent
    source = args.source or config_path(
        config, "paths", "scanCacheDir", Path(r"C:\InnPilot\Scans\IncomingCache"), base
    )
    destination = args.destination or config_path(
        config, "paths", "contractOcrTextDir", Path(r"C:\InnPilot\OCR\ScansText"), base
    )
    settings = build_settings(config, base, args)
    prefixes = config_str_list(
        config, "contracts", "scannerFilePrefixes", "scannerFilePrefix", ["Sharp MFP"]
    )
    normalized = [prefix.casefold() for prefix in prefixes if prefix.strip()]
    if not source.is_dir():
        raise NotADirectoryError(f"Local scan cache not found: {source}")
    pdfs = sorted(
        (
            path
            for path in source.iterdir()
            if path.is_file()
            and path.suffix.casefold() == ".pdf"
            and (not normalized or any(path.name.casefold().startswith(prefix) for prefix in normalized))
        ),
        key=lambda path: path.name.casefold(),
    )

    report_path = args.json_report or destination / "extract_scan_text_report.json"
    items: list[dict] = []
    warnings: list[str] = []
    errors: list[str] = []
    extracted = 0
    planned = 0
    skipped = 0
    ocr_pages = 0
    embedded_pages = 0

    for pdf in pdfs:
        target = destination / f"{pdf.stem}.txt"
        if output_is_current(pdf, target):
            skipped += 1
            items.append({"sourcePath": str(pdf), "textPath": str(target), "status": "skipped_current"})
            continue
        try:
            result = extract_text(pdf, settings)
        except Exception as error:
            errors.append(f"Could not read {pdf.name}: {type(error).__name__}")
            items.append({"sourcePath": str(pdf), "textPath": str(target), "status": "failed"})
            continue
        ocr_pages += result.ocr_pages
        embedded_pages += result.embedded_pages
        if not result.text:
            warnings.append(f"{pdf.name} did not contain recognizable text and was left unchanged.")
            items.append({"sourcePath": str(pdf), "textPath": str(target), "status": "no_text_found"})
            continue
        if args.dry_run:
            planned += 1
            status = "planned_text_output"
        else:
            write_extraction(target, result.text, sha256_file(pdf))
            extracted += 1
            status = "text_written"
        items.append(
            {
                "sourcePath": str(pdf),
                "textPath": str(target),
                "status": status,
                "embeddedPages": result.embedded_pages,
                "ocrPages": result.ocr_pages,
            }
        )

    summary = {
        "found": len(pdfs),
        "processed": len(pdfs),
        "planned": planned,
        "created": extracted,
        "skipped": skipped,
        "failed": len(errors),
        "warnings": len(warnings),
        "embeddedPages": embedded_pages,
        "ocrPages": ocr_pages,
    }
    write_report(
        report_path,
        standard_report(
            workflow="document_text_extraction",
            mode="dry_run" if args.dry_run else "execute",
            started_at=started_at,
            finished_at=now_iso(),
            status=report_status(len(errors), len(warnings)),
            summary=summary,
            items=items,
            warnings=warnings,
            errors=errors,
            report_path=report_path,
        ),
    )
    print(
        f"PDFs found: {len(pdfs)} | text files: {extracted} | planned: {planned} "
        f"| OCR pages: {ocr_pages} | warnings: {len(warnings)}"
    )
    print(f"Report: {report_path}")
    return 2 if errors else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract text from scanner PDFs locally without modifying the originals."
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--dpi", type=int)
    parser.add_argument("--min-embedded-chars", type=int)
    parser.add_argument("--languages")
    parser.add_argument("--tessdata", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json-report", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    try:
        raise SystemExit(run(parse_args()))
    except (ConfigError, OSError, RuntimeError, ValueError) as error:
        print(f"Document reading error: {error}", file=sys.stderr)
        raise SystemExit(2)
