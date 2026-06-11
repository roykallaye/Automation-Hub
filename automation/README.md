# FlowHost Automation Scripts

These are the versionable FlowHost automation workers. The legacy `Script/` folder is a local import mirror from the manager PC and is ignored by git; do not treat it as the canonical source.

## Structure

- `invoices/process_fatture.py` crops and prepares invoice PDFs for Gmail draft creation.
- `gmail_drafts/create_gmail_draft.py` creates Gmail drafts from prepared invoice folders. It uses the Gmail compose scope and does not send emails.
- `contracts/process_contratti.py` reads OCR text for scanned PDFs, identifies signed contract documents, and can rename/move them into the contracts folder.
- `shared/config.py` loads the shared JSON config.
- `config.example.json` documents the local configuration shape.
- `requirements.txt` lists the Python packages currently needed by the available scripts.

Still missing from the manager-PC script collection:

- `copy_scansioni.cmd`
- `preprocess_scansioni_to_text.ps1`

## Install Dependencies

Create and activate a Python virtual environment, then install:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r automation\requirements.txt
```

The `.cmd` wrappers under `automation/` use `python` from `PATH`. If a hotel PC uses a virtual environment, activate it before running the wrappers or call the scripts with that environment's Python executable.

## Local Config

Copy the example config to a local, uncommitted file:

```powershell
Copy-Item automation\config.example.json automation\config.local.json
```

Edit `automation\config.local.json` for the PC where FlowHost is installed. Do not put real Gmail tokens or credentials into the example file. Local config files can contain real paths, but they must not contain guest PDFs, contracts, logs, or OAuth token contents.

Important config sections:

- `client`: hotel display/signature names.
- `paths`: invoice folders, Gmail credential/token file locations, contract scan/OCR/log folders.
- `gmail`: subject and CC address for draft creation.
- `invoice`: input glob and recipient routing rules.
- `contracts`: scanner filename prefix, contract marker text, and year metadata.
- `safety`: dry-run default, original archiving, and log redaction flags.

## FlowHost Integration

FlowHost has its own app config file in the Tauri app data directory. That app config should point `automation.automationConfigPath` at the local automation config file, usually:

```text
automation\config.local.json
```

Keep overlapping FlowHost app config values and `automation\config.local.json` aligned. The most important one is Gmail:

- FlowHost app config: `gmail.tokenPath`
- automation config: `paths.gmailTokenFile`

These must point to the same token file. If they differ, FlowHost blocks Gmail draft/reconnect workflows because the app may check or reset one token file while the Gmail worker uses another. FlowHost also warns when invoice folders, contract folders, or `safety.dryRunDefault` differ between the two config files.

When FlowHost runs canonical Python workers, it passes the config path:

```text
python automation\invoices\process_fatture.py --config <automationConfigPath>
python automation\gmail_drafts\create_gmail_draft.py --config <automationConfigPath>
python automation\contracts\process_contratti.py --config <automationConfigPath>
```

If FlowHost app config has `safety.dryRunDefault` enabled, it also passes `--dry-run` to the invoice and Gmail draft workers. The contract worker is dry-run by default unless `--execute` is explicitly passed.

## Guided Setup

FlowHost's Setup page can generate and save a local setup from a guided wizard. The wizard writes paths and settings only:

- FlowHost app config in the Tauri app data directory.
- `automation\config.local.json` for the Python automation scripts.
- Missing workspace folders when the operator explicitly confirms folder creation.

Guided setup does not run these automation scripts, does not create Gmail drafts, and does not send emails. After setup is saved and checked, workflows are still started separately from the FlowHost Automations page.

## Safe Dry Runs

Invoice processing:

```powershell
python automation\invoices\process_fatture.py --config automation\config.local.json --dry-run
```

In dry-run mode the invoice script reads matching input PDFs and uses a temporary file for PDF parsing, but it does not write final PDFs into the real output folder, does not create recipient folders, does not copy failed originals, and does not delete originals.

Gmail draft creation:

```powershell
python automation\gmail_drafts\create_gmail_draft.py --config automation\config.local.json --dry-run
```

In dry-run mode the Gmail script does not authenticate, does not call Gmail, does not create drafts, does not move PDFs to archive, does not delete `email_body.txt`, and reports the drafts it would create.

Contract processing:

```powershell
python automation\contracts\process_contratti.py --config automation\config.local.json
```

The contract script defaults to dry-run. It only moves and renames files when run with `--execute`.

Do not run these commands against real hotel folders unless you intentionally want to inspect those local folders. For tests, use fake fixture folders and synthetic PDFs/text files.

## JSON Reports

The canonical scripts can write structured JSON reports for FlowHost activity history:

```powershell
python automation\invoices\process_fatture.py --config automation\config.local.json --dry-run --json-report C:\Temp\invoice-report.json
python automation\gmail_drafts\create_gmail_draft.py --config automation\config.local.json --dry-run --json-report C:\Temp\gmail-report.json
python automation\contracts\process_contratti.py --config automation\config.local.json --json-report C:\Temp\contracts-report.json
```

Reports use this common shape:

```json
{
  "workflow": "invoices",
  "mode": "dry_run",
  "startedAt": "2026-01-01T10:00:00+01:00",
  "finishedAt": "2026-01-01T10:00:01+01:00",
  "status": "success",
  "summary": {
    "found": 0,
    "processed": 0,
    "planned": 0,
    "created": 0,
    "moved": 0,
    "failed": 0,
    "warnings": 0
  },
  "items": [],
  "warnings": [],
  "errors": [],
  "outputs": {
    "reportPath": "C:\\Temp\\invoice-report.json",
    "logPath": "C:\\Temp\\process.log"
  }
}
```

Reports are intended as safe summaries for FlowHost. They do not include Gmail credential or token contents, raw OCR text, or email body text. They may include operational file paths, recipient folder names, and planned destination paths so setup support can understand what happened.

## Automation Tests

The automation tests use Python `unittest` and temporary fake workspaces only. They do not call Gmail, do not create Gmail drafts, do not send emails, and do not use real hotel PDFs, contracts, credentials, tokens, logs, or reports.

Run them from the repository root:

```powershell
npm run test:automation
```

Equivalent direct command:

```powershell
python -m unittest discover automation/tests
```

The tests cover:

- invoice dry-run behavior with a generated fake PDF when PyMuPDF is installed
- Gmail draft dry-run reporting without authentication or file moves
- contract processing dry-run using fake scan PDF names and fake OCR text
- missing config failures that leave temp fixture files untouched
- credential/token file contents not appearing in dry-run output

If PyMuPDF is not installed, the invoice PDF fixture test is skipped. Install `automation\requirements.txt` to run the full automation test suite.

## Files That Must Never Be Committed

Never commit:

- `gmail_token.json`
- `gmail_credentials.json`
- `client_secret*.json`
- local config files containing real machine paths or operational settings
- real guest PDFs
- real invoices
- real contracts
- OCR text containing guest or employee personal data
- logs or reports containing names, emails, booking data, employee data, or full local paths
- `__pycache__` and `*.pyc`
- local input, output, archive, log, scan, or cache folders

## Remaining Fallbacks

The Python scripts still keep legacy manager-PC defaults for compatibility when no `--config` is supplied. New installs should pass `--config` and should not rely on those fallback paths.
