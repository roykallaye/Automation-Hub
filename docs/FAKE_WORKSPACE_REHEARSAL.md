# FlowHost Fake Workspace Rehearsal

Use this guide to rehearse FlowHost in Tauri with fake local data before any hotel-PC dry-run.

## Purpose

This rehearsal checks that guided setup, config saving, dry-run automation launch, JSON report capture, and Activity history work together without touching real hotel files.

## Strict Safety Rules

- Do not select real hotel folders.
- Do not select real network shares.
- Do not use real guest PDFs.
- Do not use real contracts.
- Do not use real Gmail credentials.
- Do not use real Gmail tokens.
- Do not call Gmail.
- Do not create Gmail drafts.
- Do not send emails.
- Do not run execute-mode workflows.
- Keep Safe mode on.

## Fake Workspace

Use this exact local test workspace:

```text
C:\Users\rkall\Desktop\FlowHost-Test-Workspace
```

Do not point FlowHost at Life Hotel folders, manager-PC folders, network shares, Downloads folders with real documents, or any shared production location.

## Start The App

```powershell
npm run tauri dev
```

Open FlowHost, go to `Setup`, and start the guided setup.

Before running any dry-run automation, open `Support` / `Advanced details` and check the Python environment card:

- Python should be found.
- Invoice PDF reader should be installed.
- Gmail draft library should be installed.
- Gmail sign-in library should be installed.

If packages are missing, copy the install command shown in Support and run it in PowerShell. This installs Python packages only; it does not run workflows or call Gmail.

## Exact Setup Wizard Values

### Hotel Profile

- Hotel display name: `FlowHost Test Hotel`
- Email signature name: `FlowHost Test Hotel`

### Workspace

- Workspace folder: `C:\Users\rkall\Desktop\FlowHost-Test-Workspace`

### Folder Preview

Confirm the preview contains only folders under:

```text
C:\Users\rkall\Desktop\FlowHost-Test-Workspace
```

Expected folders include:

- `Invoices\Input`
- `Invoices\ReadyToSend`
- `Invoices\Archive`
- `Invoices\Logs`
- `Gmail\Token`
- `Gmail\Credentials`
- `Scans\IncomingCache`
- `Scans\TextOutput`
- `Contracts\2026\Signed`
- `Contracts\Logs`
- `Support\Diagnostics`

### Gmail Drafts

- Draft subject: `Test invoices - FlowHost rehearsal`
- CC email: `test-cc@example.invalid`
- Credentials file: `C:\Users\rkall\Desktop\FlowHost-Test-Workspace\Gmail\Credentials\gmail_credentials.json`
- Token file: `C:\Users\rkall\Desktop\FlowHost-Test-Workspace\Gmail\Token\gmail_token.json`

FlowHost creates Gmail drafts only. It never sends emails automatically. For this rehearsal, do not use real Google credentials.

### Invoice Rules

- Input pattern: `Funzione Pubblica amministrazione*.pdf`
- Match text: `testpartner`
- Recipient email: `test@example.invalid`

### Contracts And Scans

- Contract year: `2026`
- Scanner filename prefix: `Sharp MFP`
- Contract marker: `Oggetto: Contratto di lavoro subordinato a tempo determinato`
- Shared scan folder: `C:\Users\rkall\Desktop\FlowHost-Test-Workspace\Scans\IncomingCache`
- OCR text output folder: `C:\Users\rkall\Desktop\FlowHost-Test-Workspace\Scans\TextOutput`
- Signed contracts output folder: `C:\Users\rkall\Desktop\FlowHost-Test-Workspace\Contracts\2026\Signed`

### Safety

- Safe mode: `On`
- Archive originals: `On`
- Hide personal details in support output: `On`

## Fake Gmail Credentials File

Run this PowerShell command after the workspace folder is selected or created:

```powershell
$root = "C:\Users\rkall\Desktop\FlowHost-Test-Workspace"
New-Item -ItemType Directory -Force "$root\Gmail\Credentials" | Out-Null
'{"installed":{"client_id":"fake-client","project_id":"flowhost-test","auth_uri":"https://example.invalid","token_uri":"https://example.invalid"}}' |
Set-Content -Encoding UTF8 "$root\Gmail\Credentials\gmail_credentials.json"
```

This is not a real Google credential. It is only a fake file so FlowHost can validate that a credentials path exists.

Do not create `gmail_token.json`. A missing token file is expected and non-blocking because a real Gmail sign-in would create it later. This rehearsal must not perform real Gmail sign-in.

## Setup Actions To Run

1. Click `Preview setup`.
2. Confirm all paths are inside the fake workspace.
3. Click `Create folders`.
4. Confirm the result says folders were created or already existed.
5. Click `Save setup`.
6. Confirm the result says setup was saved and backup behavior is reported if existing config files were replaced.
7. Click `Check setup`.

## Expected Setup Messages

Expected good messages:

- `Setup saved`
- `Folders ready`
- `Setup check passed`
- `Safe mode is on`

Acceptable warning during this fake rehearsal:

- Missing Gmail token file. This is expected and should not block setup.

Unexpected warnings that should be investigated:

- Any path outside `C:\Users\rkall\Desktop\FlowHost-Test-Workspace`
- Gmail credentials file not found after the fake credentials command was run
- Automation setup file is missing after saving setup
- FlowHost setup and automation setup do not match
- Any prompt for real Gmail sign-in

## Expected Module Readiness

Expected after setup and fake credentials are in place:

- Invoices: `Ready` or blocked only by missing fake invoice input files
- Gmail drafts: `Ready` or needs Gmail sign-in later, with no real sign-in during rehearsal
- Scanned documents: `Needs setup` or `Not configured` if the real copy script is unavailable
- Document reading / OCR: `Needs setup` or `Not configured` if the real OCR script is unavailable
- Signed contracts: may need OCR or contract setup if supporting scripts are unavailable
- Support: `Ready`

Missing scan/OCR scripts should not make invoices and Gmail look globally broken.

## Optional Fake Input Files

Only create fake files inside the fake workspace. Do not copy real hotel PDFs or contracts.

Example placeholders:

```powershell
$root = "C:\Users\rkall\Desktop\FlowHost-Test-Workspace"
New-Item -ItemType Directory -Force "$root\Invoices\Input" | Out-Null
New-Item -ItemType Directory -Force "$root\Scans\IncomingCache" | Out-Null
New-Item -ItemType Directory -Force "$root\Scans\TextOutput" | Out-Null
"fake invoice placeholder" | Set-Content -Encoding UTF8 "$root\Invoices\Input\Funzione Pubblica amministrazione testpartner.pdf"
"fake scan placeholder" | Set-Content -Encoding UTF8 "$root\Scans\IncomingCache\Sharp MFP fake.pdf"
"Oggetto: Contratto di lavoro subordinato a tempo determinato" | Set-Content -Encoding UTF8 "$root\Scans\TextOutput\Sharp MFP fake.txt"
```

These are not real PDFs. Some automation scripts may report that they are invalid, which is acceptable as long as the failure stays inside the fake workspace and Activity records the result.

## Dry-Run Automation Check

From `Automations`, run only one workflow that is clearly available and marked safe. Keep Safe mode on.

Expected result:

- Confirmation appears before high-impact actions.
- No Gmail auth browser opens.
- No Gmail draft is created.
- No emails are sent.
- No files are moved or deleted from real locations.
- Activity receives a structured history entry marked safe mode or dry-run.

## Expected Activity Result

Open `Activity`.

Expected:

- A recent run appears.
- The mode is `Safe mode` or `dry_run`.
- The summary is human-readable.
- Technical output is collapsed.
- Report path, if shown, is inside app-controlled activity reports.

## Cleanup

After the rehearsal, close FlowHost and remove only the fake workspace if no longer needed:

```powershell
Remove-Item -LiteralPath "C:\Users\rkall\Desktop\FlowHost-Test-Workspace" -Recurse -Force
```

Before running that command, verify the path is exactly the fake workspace path above.

## Rehearsal Result Template

- Date/time:
- Commit/hash:
- Workspace used:
- Setup created folders: yes/no
- Setup saved config: yes/no
- Check setup result:
- Automation tested:
- Activity entry created: yes/no
- Gmail auth opened: yes/no
- Files moved/deleted: yes/no
- Issues observed:
- Verdict:
