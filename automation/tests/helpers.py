from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]


class InnPilotWorkspace:
    def __init__(self) -> None:
        self._temp = TemporaryDirectory(prefix="innpilot_automation_test_")
        self.root = Path(self._temp.name)
        self.workspace = self.root / "InnPilot" / "workspace"
        self.invoice_input = self.workspace / "Invoices" / "Input"
        self.invoice_output = self.workspace / "Invoices" / "ReadyToSend"
        self.invoice_archive = self.workspace / "Invoices" / "Archive"
        self.invoice_logs = self.workspace / "Invoices" / "Logs"
        self.gmail_token_dir = self.workspace / "Gmail" / "Token"
        self.gmail_credentials_dir = self.workspace / "Gmail" / "Credentials"
        self.scans_cache = self.workspace / "Scans" / "IncomingCache"
        self.ocr_text = self.workspace / "Scans" / "TextOutput"
        self.contracts_signed = self.workspace / "Contracts" / "2026" / "Signed"
        self.contract_logs = self.workspace / "Contracts" / "Logs"
        self.support_diagnostics = self.workspace / "Support" / "Diagnostics"
        self.config_path = self.root / "automation.config.local.json"

    def __enter__(self) -> "InnPilotWorkspace":
        for folder in [
            self.invoice_input,
            self.invoice_output,
            self.invoice_archive,
            self.invoice_logs,
            self.gmail_token_dir,
            self.gmail_credentials_dir,
            self.scans_cache,
            self.ocr_text,
            self.contracts_signed,
            self.contract_logs,
            self.support_diagnostics,
        ]:
            folder.mkdir(parents=True, exist_ok=True)

        self.gmail_credentials_file.write_text(
            '{"installed":{"client_id":"fake-client"}}',
            encoding="utf-8",
        )
        self.gmail_token_file.write_text(
            '{"token":"fake-token"}',
            encoding="utf-8",
        )
        self.write_config()
        return self

    def __exit__(self, *args: object) -> None:
        self._temp.cleanup()

    @property
    def gmail_credentials_file(self) -> Path:
        return self.gmail_credentials_dir / "gmail_credentials.json"

    @property
    def gmail_token_file(self) -> Path:
        return self.gmail_token_dir / "gmail_token.json"

    def config(self) -> dict[str, Any]:
        return {
            "client": {
                "displayName": "Fixture Hotel",
                "emailSignatureName": "Fixture Hotel",
            },
            "paths": {
                "invoiceInputDir": str(self.invoice_input),
                "invoiceOutputDir": str(self.invoice_output),
                "invoiceArchiveDir": str(self.invoice_archive),
                "invoiceLogDir": str(self.invoice_logs),
                "gmailCredentialsFile": str(self.gmail_credentials_file),
                "gmailTokenFile": str(self.gmail_token_file),
                "contractInputShortcut": str(self.scans_cache / "Scans.lnk"),
                "contractInputDir": str(self.scans_cache),
                "contractDestinationDir": str(self.contracts_signed),
                "contractOcrTextDir": str(self.ocr_text),
                "contractLogDir": str(self.contract_logs),
            },
            "gmail": {
                "subject": "Fixture invoices",
                "ccEmail": "accounting@example.test",
            },
            "invoice": {
                "inputGlob": "Funzione Pubblica amministrazione*.pdf",
                "inputGlobs": [
                    "Funzione Pubblica amministrazione*.pdf",
                    "Booking*.pdf",
                ],
                "recipientRules": [
                    {"match": "eurotours", "email": "test@example.com"},
                ],
            },
            "contracts": {
                "scannerFilePrefix": "Sharp MFP",
                "scannerFilePrefixes": ["Sharp MFP", "Canon"],
                "contractMarker": "Oggetto: Contratto di lavoro subordinato a tempo determinato",
                "contractMarkers": [
                    "Oggetto: Contratto di lavoro subordinato a tempo determinato",
                    "Contratto fixture alternativo",
                ],
                "year": "2026",
            },
            "safety": {
                "dryRunDefault": False,
                "archiveSuccessfulOriginals": True,
                "redactLogs": True,
            },
        }

    def write_config(self) -> None:
        self.config_path.write_text(
            json.dumps(self.config(), indent=2),
            encoding="utf-8",
        )


def run_script(script: str, *args: str | Path) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(REPO_ROOT / script), *[str(arg) for arg in args]]
    return subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def latest_log_text(log_dir: Path, pattern: str) -> str:
    logs = sorted(log_dir.glob(pattern), key=lambda path: path.stat().st_mtime)
    if not logs:
        return ""
    return logs[-1].read_text(encoding="utf-8", errors="replace")


def count_files(folder: Path) -> int:
    return sum(1 for item in folder.rglob("*") if item.is_file())
