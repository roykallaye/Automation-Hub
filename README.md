# Life Hotel Automation Hub

Premium Windows desktop control panel for running and monitoring existing Life Hotel office automations.

The app is an operator dashboard. It does not rewrite or modify the existing automation scripts; it calls the approved scripts through a Rust backend allowlist.

## What It Does

- Processes invoice PDFs and creates Gmail drafts.
- Processes signed employee contracts after an explicit confirmation.
- Runs maintenance actions such as copying scansioni and OCR preprocessing.
- Shows live command output, status, timing, step exit codes, and recent log files.
- Provides a Gmail reconnect action when Google access expires or is revoked.

## Tech Stack

- Tauri v2
- Rust backend commands
- React
- TypeScript
- Tailwind CSS
- Vite
- Windows WebView2

## Prerequisites

- Windows 10 or newer
- Node.js LTS or newer with npm
- Rust stable toolchain with Cargo
- Microsoft Visual Studio Build Tools with the Desktop development with C++ workload
- WebView2 Runtime
- Existing Life Hotel automation scripts at the configured absolute paths

## Install

Open PowerShell in the project folder:

```powershell
cd C:\Users\back-office-life\Desktop\LifeHotelAutomationHub
npm install
```

## Run In Development

```powershell
npm run dev
```

Tauri starts the Vite frontend and opens the desktop app window.

## Build Windows Installer

```powershell
npm run tauri build
```

The installer is created under:

```text
src-tauri\target\release\bundle\nsis
```

## Main Actions

### Invoices

Runs:

```text
C:\Users\back-office-life\Desktop\Fatture\Script\run_process_fatture_scheduled.cmd
C:\Users\back-office-life\Desktop\Fatture\Script\run_create_gmail_draft.cmd
```

Uses:

```text
C:\Users\back-office-life\Desktop\Fatture\Input
C:\Users\back-office-life\Desktop\Fatture\Output_ProntoInvio
C:\Users\back-office-life\Desktop\Fatture\Log
```

### Gmail Reconnect

If Google reports that the Gmail token is expired or revoked, the app can run `Reconnect Gmail`.

That action deletes:

```text
C:\Users\back-office-life\Desktop\Fatture\Script\gmail_token.json
```

Then it reruns the Gmail draft script so Google can open a browser sign-in and create a fresh token.

### Signed Contracts

Runs only after user confirmation:

```text
C:\Users\back-office-life\Documents\copy_scansioni.cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\back-office-life\Documents\CodexScripts\preprocess_scansioni_to_text.ps1"
C:\Users\back-office-life\Desktop\Fatture\Script\run_process_contratti.cmd --execute
```

Uses:

```text
\\172.16.47.20\shared\Scansioni
C:\Users\back-office-life\Documents\CodexInput\Scansioni
C:\Users\back-office-life\Documents\CodexInput\ScansioniText
C:\Users\back-office-life\Desktop\Life Hotel\Staff\2026\CONTRATTI FIRMATI
```

## Safety

- The frontend cannot run arbitrary commands.
- The Rust backend uses a fixed allowlist of known commands.
- Only one automation can run at a time.
- Buttons are disabled during a run.
- Destructive or file-moving contract processing requires confirmation.
- OAuth tokens, credentials, logs, build output, generated schemas, and dependencies are ignored by git.

## Generated Config

On first launch, the app creates a default config file in the Tauri app data directory. It contains the current absolute paths used by the MVP.

If path fields change in source and the app fails with a missing config field, delete the generated config and restart the app:

```powershell
Get-ChildItem $env:APPDATA,$env:LOCALAPPDATA -Recurse -Filter config.json -ErrorAction SilentlyContinue |
  Where-Object { Select-String -LiteralPath $_.FullName -SimpleMatch "run_create_gmail_draft.cmd" -Quiet } |
  Remove-Item -Force
```

## Safe Testing Order

1. Start the app in development mode.
2. Open folders first to confirm paths are correct.
3. Test `Copy Scansioni`.
4. Test `Run OCR Preprocessing`.
5. Test `Reconnect Gmail` only if Gmail access is expired or revoked.
6. Test `Process Signed Contracts` only after confirming the move action.
7. Test `Process Invoices & Create Gmail Drafts` only with test invoice files in the input folder.

## Git Notes

Commit these:

```text
package.json
package-lock.json
README.md
src
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/build.rs
src-tauri/capabilities
src-tauri/icons
src-tauri/src
src-tauri/tauri.conf.json
tailwind.config.js
postcss.config.js
tsconfig*.json
vite.config.ts
index.html
```

Do not commit:

```text
node_modules
dist
src-tauri/target
src-tauri/gen
logs
OAuth token JSON files
credential or secret files
```