# InnPilot

Windows desktop control panel for hotel office automations.

InnPilot is a Tauri + React operator dashboard for hotel automation. The versionable automation workers now live under `automation/`. The legacy `Script/` folder is treated as a local-only manager-PC import mirror and is ignored by git. InnPilot calls configured script paths through a Rust backend allowlist and performs app-side preflight checks before enabling workflow buttons.

Branding note: the app identity was renamed to InnPilot before production use. Existing pre-production Life Hotel or FlowHost app data can be ignored or removed manually during development; no automated migration is implemented yet.

## Tech Stack

- Tauri v2
- Rust backend commands
- React
- TypeScript
- Tailwind CSS
- Vite
- Windows WebView2

## Development

Required local toolchain for Windows development:

- Rust stable with the `x86_64-pc-windows-msvc` target
- Microsoft Visual Studio Build Tools
- Visual Studio workload: Desktop development with C++
- Windows 10/11 SDK
- Windows WebView2 Runtime

Install dependencies:

```powershell
npm install
```

Run the desktop app in development:

```powershell
npm run dev
```

Run Rust tests for config/preflight behavior:

```powershell
npm run test:rust
```

The Rust suite also includes fake end-to-end validation for setup, workflow report injection, and Activity history persistence. These tests build temporary fake workspaces and fake script paths only; they do not run hotel scripts, call Gmail, create drafts, or touch real hotel folders.

Run automation script fixture tests:

```powershell
npm run test:automation
```

Those Python tests also use temporary fake data only.

Check that the Tauri automation resource bundle cannot include generated or sensitive local files:

```powershell
npm run doctor:resources
```

Install Python packages for the canonical automation scripts into the active Python environment:

```powershell
npm run install:automation
```

Print basic Python diagnostics:

```powershell
npm run doctor:python
```

### Python Environment Setup

InnPilot does not bundle Python yet. Canonical automation scripts require an external Python executable plus the packages in `automation\requirements.txt`.

Recommended short-term managed environment for controlled dry-runs:

```powershell
python -m venv C:\InnPilot\.venv
C:\InnPilot\.venv\Scripts\python.exe -m pip install -r C:\InnPilot\automation\requirements.txt
C:\InnPilot\.venv\Scripts\python.exe --version
```

Then set InnPilot app config:

```text
automation.pythonExecutable = C:\InnPilot\.venv\Scripts\python.exe
```

If using the app-managed automation folder after `Install/refresh managed scripts`, install requirements from that managed folder instead. Support / Advanced shows the exact PowerShell command based on the current InnPilot setup, for example:

```powershell
& "C:\InnPilot\.venv\Scripts\python.exe" -m pip install -r "C:\InnPilot\automation\requirements.txt"
```

This setup only installs Python packages. It does not run workflows, does not call Gmail, does not create drafts, and does not touch hotel folders.

InnPilot checks:

- Python executable is available.
- PyMuPDF / `fitz` is installed for invoice PDF reading.
- `googleapiclient` is installed for Gmail draft creation.
- `google_auth_oauthlib` is installed for Gmail sign-in.

Print local Windows toolchain diagnostics:

```powershell
npm run doctor:windows
```

The doctor command is read-only. It prints Rust versions, installed Rust targets, and uses PowerShell `Get-Command` to report whether Windows build tools such as `link.exe` and `cl.exe` are visible in the current shell.

Build the Windows installer:

```powershell
npm run tauri build
```

The NSIS installer is created under:

```text
src-tauri\target\release\bundle\nsis
```

### Windows MSVC Linker Setup

Rust tests and Tauri builds on Windows use the MSVC linker. If `npm run test:rust` fails with:

```text
LINK : fatal error LNK1104: cannot open file 'msvcrt.lib'
```

that usually means the local Visual Studio C++ toolchain or Windows SDK is missing, incomplete, or not visible to the shell. This is an environment issue, not an InnPilot workflow issue.

Check diagnostics:

```powershell
npm run doctor:windows
```

Expected signs of a healthy setup:

- `rustc` and `cargo` are available
- `rustup show` uses a stable toolchain
- `rustup target list --installed` includes `x86_64-pc-windows-msvc`
- `doctor:windows` reports `link: ...\link.exe` for the Visual Studio MSVC linker
- `doctor:windows` reports `cl: ...\cl.exe` for the Visual Studio C++ compiler

Manual fix if tools or SDK libraries are missing:

1. Install or open Visual Studio Installer.
2. Install Microsoft Visual Studio Build Tools or Visual Studio Community.
3. Select the Desktop development with C++ workload.
4. Ensure an installed Windows 10/11 SDK is selected in the workload details.
5. Restart the terminal after installation.
6. Run `npm run doctor:windows`, then `npm run test:rust` again.

Do not downgrade InnPilot dependencies to hide this linker error.

## Configuration

On first launch, InnPilot creates:

```text
config.json
```

inside the Tauri app data directory for the installed app. The app shows the exact config file path in developer details for setup support.

The config contains:

- `client.displayName`
- `automation.automationRootFolder`
- `automation.automationConfigPath`
- `automation.pythonExecutable`
- `scripts.invoiceWorkflowScript`
- `scripts.gmailDraftScript`
- `scripts.copyScansioniScript`
- `scripts.ocrPreprocessingScript`
- `scripts.contractProcessingScript`
- `folders.invoiceInputFolder`
- `folders.invoiceOutputFolder`
- `folders.invoiceArchiveFolder`
- `folders.invoiceLogFolder`
- `folders.scansioniNetworkShare`
- `folders.scansioniLocalCacheFolder`
- `folders.ocrTextOutputFolder`
- `folders.contractsOutputFolder`
- `folders.contractLogFolder`
- `gmail.tokenPath`
- `safety.dryRunDefault`
- `safety.requireConfirmationForFileMoves`
- `safety.redactLogs`

Fresh default config prefers the canonical Python scripts under a managed automation scripts folder. In development, InnPilot uses the repo `automation/` folder when the canonical scripts are present. Outside the repo, the short-term managed location is:

```text
C:\InnPilot\automation
```

For example:

```text
C:\InnPilot\automation\invoices\process_fatture.py
```

Existing generated configs that still point at old manager-PC `.cmd` wrappers continue to work if those paths exist. Explicit script paths remain authoritative; `automation.automationRootFolder` is the support-facing folder used for defaults and diagnostics.

On a managed dry-run PC, copy the canonical `automation/` tree to `C:\InnPilot\automation`, create a Python virtual environment such as `C:\InnPilot\.venv`, install `automation\requirements.txt`, and set:

```text
automation.automationRootFolder = C:\InnPilot\automation
automation.pythonExecutable = C:\InnPilot\.venv\Scripts\python.exe
```

Guided setup writes `automation\config.local.json` under the selected InnPilot workspace. That setup file is separate from the managed scripts folder.

### Guided Setup

The Setup page includes a guided setup flow for new installations. It collects hotel profile details, an InnPilot workspace location, Gmail draft settings, invoice recipient rules, contract/scans settings, and safety preferences.

Guided setup is intentionally separate from automation runs:

- Preview setup shows the folders and config values InnPilot would use.
- Folder and file fields include Choose buttons plus editable text fields for setup support.
- Create folders creates only missing workspace folders and leaves existing folders/files unchanged.
- Save setup writes InnPilot app config and `automation\config.local.json`; existing config files are backed up first.
- Check setup reruns InnPilot preflight/alignment checks.

Guided setup does not process invoices, does not create Gmail drafts, does not send emails, and does not move/delete hotel files. Workflows are still run manually from the Automations page after setup is ready.

Invoice delivery mode controls whether InnPilot prepares invoice files only or also creates Gmail drafts. Existing configs without this field behave like the previous mode: `gmailDrafts`. New guided setup defaults to the recommended draft mode, but setup support can choose `prepareOnly` when the hotel wants to send emails manually. `sendAutomatically` is a future/blocked mode and does not request Gmail send scope.

Invoice file selection defaults to `allPdfs`: every PDF intentionally placed in the invoice input folder is treated as an invoice candidate, and non-PDF files are ignored. Hotels that use mixed PDF folders can switch to `filenamePatterns`; `inputGlobs` may contain multiple optional filters while legacy `inputGlob` remains accepted.

Scanner filename prefixes and contract marker text can each contain multiple values. InnPilot matches scans or contract text when any configured value matches, while still accepting older single-value config fields.

Recommended local setup:

```powershell
Copy-Item automation\config.example.json automation\config.local.json
```

Then edit:

- `automation\config.local.json` for script-level folders, Gmail credential/token paths, email subject/CC, invoice routing rules, and contract routing settings.
- InnPilot app `config.json` for app-side script paths, `automation.automationConfigPath`, `automation.pythonExecutable`, visible hotel name, and folder preflight/open-folder settings.

The two config files must agree where they describe the same operational path. In particular, InnPilot app `gmail.tokenPath` and automation config `paths.gmailTokenFile` must point to the same token file. If they differ, InnPilot blocks Gmail draft/reconnect workflows so setup support can fix the mismatch before token reset or OAuth behavior touches the wrong file.

InnPilot also warns when these overlapping values differ:

- invoice input, output, archive, and log folders
- contract output, OCR text, and log folders
- `safety.dryRunDefault`

When InnPilot runs a canonical Python automation script, it invokes it like:

```text
python automation\invoices\process_fatture.py --config <automationConfigPath>
python automation\gmail_drafts\create_gmail_draft.py --config <automationConfigPath>
python automation\contracts\process_contratti.py --config <automationConfigPath>
```

If `safety.dryRunDefault` is enabled in the InnPilot app config, InnPilot also passes `--dry-run` to the invoice and Gmail draft Python scripts. The contract script is dry-run by default unless `--execute` is explicitly passed; InnPilot does not pass `--execute` to the canonical Python contract script.

If an older generated config only contains a `paths` object, InnPilot migrates it to the new schema on startup.

## Safe Local Runtime Rehearsal

Use this checklist before testing InnPilot on a real hotel PC. This rehearsal must use fake data only.

For the full step-by-step rehearsal package, exact wizard values, fake credentials command, expected statuses, and result template, see:

```text
docs\FAKE_WORKSPACE_REHEARSAL.md
```

1. Start the app:

   ```powershell
   npm run tauri dev
   ```

2. Open `Setup`.
3. Start guided setup and choose a fake workspace, for example:

   ```text
   C:\Users\<you>\Desktop\InnPilot-Test-Workspace
   ```

4. Keep `Safe mode` enabled.
5. Do not select real hotel folders, network shares, guest PDFs, employee contracts, credentials, or tokens.
6. Use fake Gmail credential/token paths if you are only checking validation. Do not use real Gmail OAuth files for this rehearsal.
7. Create folders from the guided setup.
8. Save setup.
9. Run `Check setup`.
10. Add fake test files only if needed:

    ```text
    InnPilot-Test-Workspace\Invoices\Input\fake-invoice.pdf
    InnPilot-Test-Workspace\Scans\IncomingCache\Sharp MFP fake.pdf
    InnPilot-Test-Workspace\Scans\TextOutput\Sharp MFP fake.txt
    ```

11. Run a dry-run automation from `Automations`.
12. Confirm the Activity page receives a structured history entry marked `Safe mode`.
13. Confirm no real Gmail authentication, sending, moving, deleting, or hotel-folder access occurred.
14. Close InnPilot and delete the fake workspace when finished.

InnPilot passes app-controlled `--json-report` paths to the canonical Python scripts that support structured reports. Legacy `.cmd` and `.ps1` wrappers are left unchanged for compatibility.

## Managed Automation Deployment

InnPilot does not bundle Python yet and does not freeze the automation scripts into executables yet.

Current supported locations:

- Development: repo-local `automation/`
- Controlled hotel dry-run: `C:\InnPilot\automation`
- Installed app: app-managed automation folder under the Tauri app data directory

Manual dry-run deployment checklist:

```powershell
New-Item -ItemType Directory -Force C:\InnPilot | Out-Null
Copy-Item -Recurse -Force automation C:\InnPilot\automation
python -m venv C:\InnPilot\.venv
C:\InnPilot\.venv\Scripts\python.exe -m pip install -r C:\InnPilot\automation\requirements.txt
C:\InnPilot\.venv\Scripts\python.exe --version
```

Then set InnPilot app config:

```text
automation.automationRootFolder = C:\InnPilot\automation
automation.pythonExecutable = C:\InnPilot\.venv\Scripts\python.exe
scripts.invoiceWorkflowScript = C:\InnPilot\automation\invoices\process_fatture.py
scripts.gmailDraftScript = C:\InnPilot\automation\gmail_drafts\create_gmail_draft.py
scripts.contractProcessingScript = C:\InnPilot\automation\contracts\process_contratti.py
```

`copy_scansioni.cmd` and `preprocess_scansioni_to_text.ps1` are still separate legacy/import scripts until they are collected and converted into canonical automation workers.

### App-Managed Automation Scripts

InnPilot bundles only an explicit allowlist of versioned automation files as Tauri resources. It does not bundle the whole `automation/` directory recursively. From `Support` / `Advanced details`, setup support can run:

```text
Install/refresh managed scripts
```

That action copies only InnPilot's canonical automation source files into the app data automation folder, for example:

```text
%APPDATA%\com.innpilot.desktop\automation
```

It copies only known versioned files such as:

- `invoices\process_fatture.py`
- `gmail_drafts\create_gmail_draft.py`
- `contracts\process_contratti.py`
- `shared\*.py`
- `requirements.txt`
- documentation/example config files

It does not run workflows, does not call Gmail, does not create drafts, and does not touch hotel folders. It never copies local `config.local.json`, Gmail tokens, Gmail credentials, bytecode, logs, reports, PDFs, input/output/archive folders, or cache folders.

After a successful refresh, InnPilot updates `automation.automationRootFolder` and canonical Python script paths to the managed app data folder. Explicit legacy script paths remain supported for `.cmd` and `.ps1` workflows.

Python is still separate. Install or configure Python manually, then install automation requirements into the selected Python environment.

Before building an installer, run:

```powershell
npm run doctor:resources
npm run build
npm run tauri build
```

`doctor:resources` fails if generated or sensitive files are found under `automation/`, including local config, tokens, credentials, bytecode, logs, reports, PDFs, or real input/output/archive folders.

## Resetting Config

To reset configuration, close InnPilot, delete the generated `config.json`, and start the app again. InnPilot will recreate defaults.

PowerShell helper to locate likely InnPilot configs:

```powershell
Get-ChildItem $env:APPDATA,$env:LOCALAPPDATA -Recurse -Filter config.json -ErrorAction SilentlyContinue |
  Where-Object { Select-String -LiteralPath $_.FullName -SimpleMatch "invoiceWorkflowScript" -Quiet }
```

Review the paths before deleting any file.

## Preflight Checks

InnPilot validates the configured app-side dependencies before enabling workflow buttons:

- automation setup file path exists when canonical Python scripts are used
- automation setup file agrees with overlapping InnPilot app config values
- Python executable is available when canonical Python scripts are used
- configured script path exists and is a file
- configured folder path exists and is a folder
- readable folders can be listed
- writable folders can accept a small temporary probe file
- network share path appears reachable
- Gmail token path is configured, and whether the token file currently exists
- external script dependencies are reported as unknown until the real scripts are collected and audited

Workflow buttons are disabled when required scripts or folders are missing or permissions look wrong. The backend also refuses to run a workflow that is not ready, even if the frontend is bypassed.

## Current Workflows

### Invoice Workflow

Runs the configured invoice processing script. In `prepareOnly` mode Gmail is skipped; in `gmailDrafts` mode the configured Gmail draft script runs afterward. Canonical Python scripts are run with `--config <automationConfigPath>`.

By default, every PDF placed in the invoice input folder is treated as an invoice candidate. Filename filters are optional advanced setup for folders that may contain other PDFs.

Expected configured paths:

- invoice workflow script
- Gmail draft script
- invoice input folder
- invoice output folder
- invoice log folder

### Gmail Reconnect

Deletes the configured Gmail token file if it exists, then reruns the configured Gmail draft script so the external script can trigger OAuth again.

InnPilot itself does not create Gmail drafts and does not send emails. That behavior belongs to the external script.

### Scansioni Copy

Runs the configured copy scansioni script.

Expected configured paths:

- copy scansioni script
- scansioni network share
- scansioni local cache folder

### OCR Preprocessing

Runs the configured OCR preprocessing PowerShell script.

Expected configured paths:

- OCR preprocessing script
- scansioni local cache folder
- OCR text output folder

### Signed Contracts

Runs copy scansioni, OCR preprocessing, then the configured contract processing script. For legacy `.cmd` wrappers, InnPilot preserves the previous behavior and passes `--execute`. For the canonical Python contract script under `automation/`, InnPilot does not pass `--execute`, so the script remains dry-run by default.

By default, InnPilot requires confirmation before this file-moving workflow runs. Keep `safety.requireConfirmationForFileMoves` enabled for production.

## Automation Scripts

The canonical versionable scripts are under:

- `automation\invoices\process_fatture.py`
- `automation\gmail_drafts\create_gmail_draft.py`
- `automation\contracts\process_contratti.py`

Still missing from the manager-PC collection:

- `copy_scansioni.cmd`
- `preprocess_scansioni_to_text.ps1`

The ignored `Script/` folder may exist locally as a copied manager-PC mirror. Do not commit it.

## Fake-Script Test Mode Design

For app-side testing, point a copy of `config.json` at fake scripts in a temporary folder. Fake scripts should only print output and write harmless marker files under test folders.

Example fake script behavior:

- invoice fake script: print the input/output folders and exit `0`
- Gmail fake script: create a local `draft-created.txt` marker instead of calling Gmail
- copy scansioni fake script: copy a fixture text file between temp folders
- OCR fake script: write a fixture `.txt` file
- contract fake script: print the target contracts folder and exit `0`

Use temporary folders for every configured folder path. Never point test config at real guest PDFs, real contracts, or the real Gmail token.

Future improvement: add canonical, config-driven scan-copy and OCR-preprocessing workers, then have InnPilot run them with the same `--config` convention.

## Data That Must Never Be Committed

Never commit:

- `gmail_token.json`
- Google OAuth client secrets or credential JSON files
- `.env` files
- real guest PDFs
- real invoice outputs
- real employee contracts
- OCR text extracted from real documents
- logs containing guest, employee, booking, email, or contract data
- generated `dist`, `src-tauri/target`, and dependency folders
- local `Script/` manager-PC import mirror
- local `automation/config.local.json`

The repository `.gitignore` excludes common token, credential, log, build, and dependency files, but operators still need to avoid copying real client data into the repo.
