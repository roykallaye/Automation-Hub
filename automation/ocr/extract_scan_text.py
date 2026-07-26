from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
import sys
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
    import fitz
except ImportError:
    fitz = None


DEFAULT_LANGUAGES = ["ita", "eng", "deu"]
DEFAULT_MAX_PAGES = 20
DEFAULT_DPI = 300
DEFAULT_MIN_EMBEDDED_CHARS = 24
DEFAULT_MAX_FILE_MB = 50


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


def extract_text(pdf: Path, settings: OcrSettings) -> ExtractionResult:
    if fitz is None:
        raise RuntimeError("PyMuPDF is not installed. Install the managed automation requirements.")
    if pdf.stat().st_size > settings.max_file_bytes:
        raise RuntimeError("PDF exceeds the configured local OCR size limit.")

    text_pages: list[str] = []
    embedded_pages = 0
    ocr_pages = 0
    with fitz.open(pdf) as document:
        if getattr(document, "is_encrypted", False):
            raise RuntimeError("Encrypted PDFs cannot be read by the local OCR worker.")
        for page_number, page in enumerate(document):
            if page_number >= settings.max_pages:
                break
            embedded = page.get_text("text").strip()
            if len(embedded) >= settings.min_embedded_chars:
                text_pages.append(embedded)
                embedded_pages += 1
                continue

            validate_tessdata(settings)
            text_page = page.get_textpage_ocr(
                language=settings.language_spec,
                dpi=settings.dpi,
                full=True,
                tessdata=str(settings.tessdata_dir),
            )
            recognized = page.get_text("text", textpage=text_page).strip()
            text_pages.append(recognized)
            ocr_pages += 1

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
