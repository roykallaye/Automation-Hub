# FlowHost Automation Hub

Windows desktop control panel for hotel office automations.

FlowHost is a Tauri + React operator dashboard. The versionable automation workers now live under `automation/`. The legacy `Script/` folder is treated as a local-only manager-PC import mirror and is ignored by git. FlowHost calls configured script paths through a Rust backend allowlist and performs app-side preflight checks before enabling workflow buttons.

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

Install Python packages for the canonical automation scripts into the active Python environment:

```powershell
npm run install:automation
```

Print basic Python diagnostics:

```powershell
npm run doctor:python
```

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

that usually means the local Visual Studio C++ toolchain or Windows SDK is missing, incomplete, or not visible to the shell. This is an environment issue, not a FlowHost workflow issue.

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

Do not downgrade FlowHost dependencies to hide this linker error.

## Configuration

On first launch, FlowHost creates:

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

Fresh default config prefers the canonical Python scripts under a managed automation scripts folder. In development, FlowHost uses the repo `automation/` folder when the canonical scripts are present. Outside the repo, the short-term managed location is:

```text
C:\FlowHost\automation
```

For example:

```text
C:\FlowHost\automation\invoices\process_fatture.py
```

Existing generated configs that still point at old manager-PC `.cmd` wrappers continue to work if those paths exist. Explicit script paths remain authoritative; `automation.automationRootFolder` is the support-facing folder used for defaults and diagnostics.

On a managed dry-run PC, copy the canonical `automation/` tree to `C:\FlowHost\automation`, create a Python virtual environment such as `C:\FlowHost.venv`, install `automation\requirements.txt`, and set:

```text
automation.automationRootFolder = C:\FlowHost\automation
automation.pythonExecutable = C:\FlowHost.venv\Scripts\python.exe
```

Guided setup writes `automation\config.local.json` under the selected FlowHost workspace. That setup file is separate from the managed scripts folder.

### Guided Setup

The Setup page includes a guided setup flow for new installations. It collects hotel profile details, a FlowHost workspace location, Gmail draft settings, invoice recipient rules, contract/scans settings, and safety preferences.

Guided setup is intentionally separate from automation runs:

- Preview setup shows the folders and config values FlowHost would use.
- Folder and file fields include Choose buttons plus editable text fields for setup support.
- Create folders creates only missing workspace folders and leaves existing folders/files unchanged.
- Save setup writes FlowHost app config and `automation\config.local.json`; existing config files are backed up first.
- Check setup reruns FlowHost preflight/alignment checks.

Guided setup does not process invoices, does not create Gmail drafts, does not send emails, and does not move/delete hotel files. Workflows are still run manually from the Automations page after setup is ready.

Recommended local setup:

```powershell
Copy-Item automation\config.example.json automation\config.local.json
```

Then edit:

- `automation\config.local.json` for script-level folders, Gmail credential/token paths, email subject/CC, invoice routing rules, and contract routing settings.
- FlowHost app `config.json` for app-side script paths, `automation.automationConfigPath`, `automation.pythonExecutable`, visible hotel name, and folder preflight/open-folder settings.

The two config files must agree where they describe the same operational path. In particular, FlowHost app `gmail.tokenPath` and automation config `paths.gmailTokenFile` must point to the same token file. If they differ, FlowHost blocks Gmail draft/reconnect workflows so setup support can fix the mismatch before token reset or OAuth behavior touches the wrong file.

FlowHost also warns when these overlapping values differ:

- invoice input, output, archive, and log folders
- contract output, OCR text, and log folders
- `safety.dryRunDefault`

When FlowHost runs a canonical Python automation script, it invokes it like:

```text
python automation\invoices\process_fatture.py --config <automationConfigPath>
python automation\gmail_drafts\create_gmail_draft.py --config <automationConfigPath>
python automation\contracts\process_contratti.py --config <automationConfigPath>
```

If `safety.dryRunDefault` is enabled in the FlowHost app config, FlowHost also passes `--dry-run` to the invoice and Gmail draft Python scripts. The contract script is dry-run by default unless `--execute` is explicitly passed; FlowHost does not pass `--execute` to the canonical Python contract script.

If an older generated config only contains a `paths` object, FlowHost migrates it to the new schema on startup.

## Safe Local Runtime Rehearsal

Use this checklist before testing FlowHost on a real hotel PC. This rehearsal must use fake data only.

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
   C:\Users\<you>\Desktop\FlowHost-Test-Workspace
   ```

4. Keep `Safe mode` enabled.
5. Do not select real hotel folders, network shares, guest PDFs, employee contracts, credentials, or tokens.
6. Use fake Gmail credential/token paths if you are only checking validation. Do not use real Gmail OAuth files for this rehearsal.
7. Create folders from the guided setup.
8. Save setup.
9. Run `Check setup`.
10. Add fake test files only if needed:

    ```text
    FlowHost-Test-Workspace\Invoices\Input\fake-invoice.pdf
    FlowHost-Test-Workspace\Scans\IncomingCache\Sharp MFP fake.pdf
    FlowHost-Test-Workspace\Scans\TextOutput\Sharp MFP fake.txt
    ```

11. Run a dry-run automation from `Automations`.
12. Confirm the Activity page receives a structured history entry marked `Safe mode`.
13. Confirm no real Gmail authentication, sending, moving, deleting, or hotel-folder access occurred.
14. Close FlowHost and delete the fake workspace when finished.

FlowHost passes app-controlled `--json-report` paths to the canonical Python scripts that support structured reports. Legacy `.cmd` and `.ps1` wrappers are left unchanged for compatibility.

## Managed Automation Deployment

FlowHost does not bundle Python yet and does not freeze the automation scripts into executables yet.

Current supported locations:

- Development: repo-local `automation/`
- Controlled hotel dry-run: `C:\FlowHost\automation`
- Future production: app-managed automation folder copied or bundled by the installer

Manual dry-run deployment checklist:

```powershell
New-Item -ItemType Directory -Force C:\FlowHost | Out-Null
Copy-Item -Recurse -Force automation C:\FlowHost\automation
python -m venv C:\FlowHost.venv
C:\FlowHost.venv\Scripts\python.exe -m pip install -r C:\FlowHost\automation\requirements.txt
C:\FlowHost.venv\Scripts\python.exe --version
```

Then set FlowHost app config:

```text
automation.automationRootFolder = C:\FlowHost\automation
automation.pythonExecutable = C:\FlowHost.venv\Scripts\python.exe
scripts.invoiceWorkflowScript = C:\FlowHost\automation\invoices\process_fatture.py
scripts.gmailDraftScript = C:\FlowHost\automation\gmail_drafts\create_gmail_draft.py
scripts.contractProcessingScript = C:\FlowHost\automation\contracts\process_contratti.py
```

`copy_scansioni.cmd` and `preprocess_scansioni_to_text.ps1` are still separate legacy/import scripts until they are collected and converted into canonical automation workers.

## Resetting Config

To reset configuration, close FlowHost, delete the generated `config.json`, and start the app again. FlowHost will recreate defaults.

PowerShell helper to locate likely FlowHost configs:

```powershell
Get-ChildItem $env:APPDATA,$env:LOCALAPPDATA -Recurse -Filter config.json -ErrorAction SilentlyContinue |
  Where-Object { Select-String -LiteralPath $_.FullName -SimpleMatch "invoiceWorkflowScript" -Quiet }
```

Review the paths before deleting any file.

## Preflight Checks

FlowHost validates the configured app-side dependencies before enabling workflow buttons:

- automation setup file path exists when canonical Python scripts are used
- automation setup file agrees with overlapping FlowHost app config values
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

Runs the configured invoice processing script, then the configured Gmail draft script. Canonical Python scripts are run with `--config <automationConfigPath>`.

Expected configured paths:

- invoice workflow script
- Gmail draft script
- invoice input folder
- invoice output folder
- invoice log folder

### Gmail Reconnect

Deletes the configured Gmail token file if it exists, then reruns the configured Gmail draft script so the external script can trigger OAuth again.

FlowHost itself does not create Gmail drafts and does not send emails. That behavior belongs to the external script.

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

Runs copy scansioni, OCR preprocessing, then the configured contract processing script. For legacy `.cmd` wrappers, FlowHost preserves the previous behavior and passes `--execute`. For the canonical Python contract script under `automation/`, FlowHost does not pass `--execute`, so the script remains dry-run by default.

By default, FlowHost requires confirmation before this file-moving workflow runs. Keep `safety.requireConfirmationForFileMoves` enabled for production.

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

Future improvement: add canonical, config-driven scan-copy and OCR-preprocessing workers, then have FlowHost run them with the same `--config` convention.

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
