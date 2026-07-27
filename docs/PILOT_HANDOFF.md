# LifeDesk and InnPilot pilot handoff

This runbook covers the controlled internal-evaluation package built on
27 July 2026. It is suitable for synthetic testing and a supervised hotel
pilot. It is not yet approved for unsupervised commercial distribution.

## Exact package

- Product: InnPilot 0.1.0 for Windows x64
- Source commit: `0be4bb9da4203bb8cf0f1d6438c1ab3cbd14a91d`
- Installer: `src-tauri/target/release/bundle/nsis/InnPilot_0.1.0_x64-setup.exe`
- Installer bytes: `124630490`
- Installer SHA-256:
  `eb774c1e35263233db643e7e555e99aa9d1bf35c1cb063d1764f65bfb3748eca`
- Release manifest: `build/release/innpilot-release.json`
- Security audit: `build/release/innpilot-release-security.json`

The manifest verifies the installer, desktop app, embedded worker,
dependencies, notices, and hashes. It records that no hotel operational data
is included.

The package is deliberately labelled `internal-evaluation`. It is unsigned,
has no automatic updater, and has not yet received privacy/DPA, notice, or
supervised-pilot approval. Windows SmartScreen may warn on first installation.

## What is complete

### LifeDesk

- Administrator, manager, and reception roles can open Automation Hub.
- Administrators and managers can add, pair, revoke, and monitor PCs.
- Reception can request allowed workflows; signed-contract processing remains
  restricted to administrators and managers.
- A one-time code links one named hotel PC to one hotel.
- Only a recently connected, compatible runner can receive a request.
- The current remote request button creates a safe-mode dry run.
- Jobs support approval, cancellation, leasing, progress, completion,
  sanitized failure status, audit history, and retention.
- The dashboard shows PCs, shared-folder health, queue, history, and audit
  events.

### InnPilot

- Modern bilingual interface with Home, Automations, Activity, Configuration,
  Hotel and settings, and Support.
- Existing hotel folders can be discovered and mapped without opening or
  modifying their files.
- Each PC stores its own paths, including its own route to `Scansioni`.
- The Python/OCR/PDF worker is embedded and verified by SHA-256. Python does
  not need to be installed on the hotel PC.
- The window opens immediately while the worker check finishes; automations
  stay locked until verification succeeds.
- Built-in workflows cover invoice PDF preparation, optional Gmail drafts,
  scan copying, offline OCR, and signed-contract organization.
- Gmail drafts are review-only. No email is sent automatically.
- Safe mode prevents real file changes. Original scans remain in place.
- Settings writes are atomic and recovery points are integrity checked.
- The runner has a durable SQLite ledger, duplicate protection, restart
  recovery, cooperative cancellation, and a single-workflow lock.
- Pairing uses a per-PC Ed25519 identity protected by Windows DPAPI. Only
  signed outbound HTTPS requests are used; no inbound port is opened.
- Paths, filenames, documents, OCR text, recipients, OAuth material, private
  keys, stdout, stderr, and raw errors remain on the PC.
- InnPilot can start with Windows, remain in the notification area, and
  prevent duplicate instances.

## Existing installation on the development PC

An older InnPilot 0.1.0 installation currently exists at:

`%LOCALAPPDATA%\InnPilot`

Its current configuration and activity are under:

`%APPDATA%\com.innpilot.desktop`

An older legacy profile also exists under:

`%APPDATA%\com.innpilot.app`

Do not delete or manually move any of those folders before the upgrade test.
The new installer upgrades the program in place and preserves application
data. Keep the legacy profile until the new pilot has been accepted.

## Prepare the installer for another PC

On the development PC:

1. Open File Explorer.
2. Go to
   `<InnPilot repository>\src-tauri\target\release\bundle\nsis`.
3. Copy `InnPilot_0.1.0_x64-setup.exe` to a trusted USB drive or a private
   company-controlled transfer location.
4. Do not send the pairing code, Gmail credentials or token, hotel documents,
   or local InnPilot configuration with the installer.

On the destination PC, open PowerShell in the installer folder and run:

    Get-FileHash -Algorithm SHA256 .\InnPilot_0.1.0_x64-setup.exe

Success:

`eb774c1e35263233db643e7e555e99aa9d1bf35c1cb063d1764f65bfb3748eca`

Failure:

- Any other hash means the file is incomplete, different, or modified.
- Delete only that copied installer, copy it again from the development PC,
  and repeat the check.
- Never bypass a hash mismatch.

## Install on the manager PC

1. Sign in to the normal Windows account the manager will use. The device key
   is protected for that Windows user.
2. If an older InnPilot is running, use its notification-area icon and choose
   **Esci**. Do not uninstall it or delete its AppData.
3. Double-click `InnPilot_0.1.0_x64-setup.exe`.
4. Because this internal package is unsigned, SmartScreen may appear. Continue
   with **Ulteriori informazioni** and **Esegui comunque** only after the hash
   above matches.
5. Complete the per-user installer.
6. Open **InnPilot** from the Start menu.

Success:

- InnPilot opens to its operator interface.
- It remains responsive while the automation engine is checked.
- A first cold worker check can take about 45 seconds.

Failure:

- If installation fails, record the exact Windows message and stop.
- If the worker stays unavailable, open **Assistenza** and copy only the
  sanitized support details.
- If antivirus quarantines a file, do not disable it. Record the antivirus
  product, detection name, and installer hash for review.

## Stage 1: synthetic setup

Do this before selecting the real network share.

1. In InnPilot, open **Hotel e impostazioni** and choose **Italiano** if needed.
2. Open **Configurazione** and choose **Avvia configurazione**.
3. Choose **Crea un nuovo spazio InnPilot**.
4. Select a normal empty folder inside the manager's Documents folder. Do not
   select a drive root, Windows folder, or real hotel folder.
5. Enter the hotel display name and email signature name.
6. Choose **Prepara solo i file** for invoice email behavior.
7. Keep **Modalità sicura** enabled.
8. Keep personal details hidden in support output.
9. Preview, create missing folders, save, and choose
   **Controlla configurazione**.

Success:

- The message says **Controllo configurazione superato**.
- Home says safe mode is active.
- Configured workflow cards show **Pronto** after the engine check.

Failure:

- **Cartella non leggibile**: select a folder accessible to this account.
- **Potrebbe essere solo lettura**: use a normal local Documents subfolder.
- **Manca ancora un passaggio**: follow the single blocking item shown.
- Do not weaken Windows permissions globally to make the test pass.

Add only clearly synthetic sample PDFs to the generated input folders. Open
**Automazioni**, start one workflow, read the confirmation, and keep safe mode
enabled.

Success:

- Activity reports what would be processed.
- Synthetic originals remain unchanged.
- No Gmail draft or email is created in file-only mode.

Failure:

- Stop at the first unexpected file change.
- Preserve the Activity entry and sanitized support details.
- Do not repeat the run until the cause is reviewed.

## Stage 2: map the real Scansioni share

Do this only while someone familiar with the manager PC and server is present.

1. In File Explorer, prove that the manager's normal Windows account can open
   the real `Scansioni` folder.
2. Copy the exact path from that PC. Do not assume another PC uses the same
   path.
3. In InnPilot, open **Configurazione** and choose
   **Usa cartelle hotel esistenti**.
4. For **Cartella scansioni condivisa**, choose the real share.
5. Use separate local controlled folders for **Cache locale scansioni** and
   **Cartella testo documenti**.
6. Choose **Controlla cartella**. Discovery is read-only.
7. Leave unrelated areas blank when they are outside this pilot.
8. Preview, save, and run **Controlla configurazione**.
9. Keep **Modalità sicura** enabled for the first real-share rehearsal.

Success:

- The share is readable.
- Local cache and output folders are writable.
- Discovery and safe mode do not change existing files.

Failure:

- Share unavailable: verify the hotel network and open the same path in File
  Explorer.
- Access denied: ask the server administrator for only the required share and
  NTFS permissions.
- Never embed a password in configuration or grant access to Everyone.

## Pair the manager PC with LifeDesk

In LifeDesk:

1. Open `https://life-ops.frontdesklife2022.workers.dev/`.
2. Sign in as an administrator or manager.
3. Open the **Automation Hub** card.
4. In **PC e cartella condivisa**, choose **Aggiungi PC**.
5. Enter `PC Manager` or another unique name.
6. Create it and choose **Copia** on the protected one-time code.
7. Do not send the code by email or chat.

In InnPilot on that same PC:

1. Open **Hotel e impostazioni**.
2. At **Collega questo PC allo spazio dell'hotel**, paste the complete code
   into **Codice monouso da LifeDesk**.
3. Choose **Collega in sicurezza**.
4. Choose **Controlla collegamento**.

Success:

- InnPilot shows **Collegato** and the chosen PC name.
- LifeDesk shows the PC online, its version, capabilities, and sanitized
  shared-folder status within about 30 seconds.

Failure:

- Expired or used code: select the PC in LifeDesk, choose
  **Nuovo codice**, and paste the replacement directly into InnPilot.
- Wrong PC: revoke it in LifeDesk and pair the intended PC with a new code.
- Cannot contact LifeDesk: verify HTTPS access and Windows date/time. Do not
  open router ports or disable the firewall.
- Still offline: leave InnPilot open for one minute, select
  **Controlla collegamento**, and record the sanitized error.

## Run the first LifeDesk-to-InnPilot job

1. Keep safe mode enabled in InnPilot.
2. In LifeDesk, open **Automation Hub**.
3. Select the online `PC Manager`.
4. Under **Automazioni disponibili**, request one safe test for a configured
   workflow.
5. Watch the LifeDesk queue and InnPilot Activity page.

Success:

- LifeDesk moves the request through queued, running, and completed.
- LifeDesk receives only status and counters.
- Detailed item information remains in InnPilot.
- The dry run does not modify hotel files or create Gmail drafts.

Failure:

- **Runner non disponibile**: confirm it was seen in the last two minutes and
  supports that workflow.
- Already queued: wait for or cancel the active request; duplicates are
  intentionally rejected.
- **Attenzione** after restart: inspect local Activity instead of silently
  repeating the job.
- Cloud unavailable: InnPilot keeps durable local state and retries; do not
  create duplicate requests.

## Gmail draft pilot

Do not use copied personal credentials or tokens. The installer contains none.

1. Complete the file-only invoice rehearsal first.
2. Have the hotel create or approve its own Google OAuth desktop application.
3. In InnPilot Configuration, choose the hotel's
   `gmail_credentials.json` and a private token folder for this Windows user.
4. Change invoice delivery to **Crea bozze Gmail**.
5. Use **Ricollega Gmail** and sign in as the intended hotel mailbox.
6. Run only with synthetic invoices first.

Success:

- InnPilot creates reviewable drafts and never sends them automatically.
- A retry does not duplicate an already completed draft.

Failure:

- Reconnect if consent is denied or expired.
- Never paste OAuth tokens into LifeDesk, GitHub, chat, logs, or support text.
- If recipient or attachment is wrong, delete the draft, keep safe mode on,
  and correct the local mapping before another test.

## Background operation

After the supervised pilot is stable:

1. In InnPilot, open **Hotel e impostazioni**.
2. Under **Mantieni InnPilot pronto**, choose **Avvia con Windows**.
3. Close the main window.

Success:

- InnPilot remains in the notification area.
- LifeDesk continues to show the runner online.
- Opening InnPilot again returns to the existing instance.

Use **Esci** from the notification-area menu only to stop the runner fully.

## Upgrade, uninstall, and rollback

- Upgrade by closing InnPilot and running the newer verified installer over
  the existing installation.
- Do not uninstall first when settings should be preserved.
- Reinstall and uninstall preservation were tested in an isolated profile.
- Do not manually delete `%APPDATA%\com.innpilot.desktop` during the pilot.
- If a new build fails, stop it, keep AppData unchanged, reinstall the last
  approved package, and review the local recovery point.
- Use one approved installer hash across hotel PCs and record each install.

## Evidence to record

For each pilot PC, record:

- PC label and Windows user role, never its password;
- installer SHA-256, date, and InnPilot version;
- folder read/write results;
- synthetic workflow used;
- LifeDesk queued/running/completed timestamps;
- whether safe mode changed any file;
- operator feedback and confusing UI moments;
- sanitized error code and recovery result for any failure.

Avoid screenshots containing guest names, filenames, email addresses, booking
data, or document contents.

## Commercial-release blockers

Before unsupervised commercial distribution:

1. Obtain a trusted Windows code-signing certificate and timestamp all three
   executable artifacts.
2. Build and test a signed, pinned, staged update channel with rollback.
3. Record formal approval of OCR runtime notices.
4. Approve GDPR roles, retention, incident response, backup ownership, and the
   data-processing agreement with qualified privacy/legal review.
5. Complete and sign off the supervised hotel pilot.

The release tooling fails closed if asked to label this unsigned package as
commercial.
