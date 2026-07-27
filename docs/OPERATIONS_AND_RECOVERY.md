# InnPilot operations, recovery, and release runbook

This runbook is for the manager, reception lead, or technician responsible for
an InnPilot PC. It separates safe daily actions from engineering-only recovery
so hotel documents and cloud job evidence cannot be accidentally erased.

## Operating contract

- LifeDesk coordinates approved work. InnPilot executes allowlisted workflows on
  the paired Windows PC.
- Hotel PDFs, scans, contracts, Gmail credentials, Gmail tokens, detailed
  reports, and local paths remain on the hotel PC.
- Cloud updates contain bounded states, counters, timestamps, and safe error
  codes only.
- InnPilot never sends Gmail messages. The Gmail workflow creates drafts.
- A workflow cannot run twice at the same time on one PC.
- Closing the main window keeps the protected runner active in the Windows
  notification area; **Esci da InnPilot** in the tray menu stops it completely.
- Windows sign-in startup is opt-in and applies only to the current Windows user.
- A restarted runner marks an interrupted job for attention; it does not
  silently execute it again.
- Execute mode must be deliberately approved. Start every new PC and every
  changed workflow in safe mode with synthetic files.

## Daily operator sequence

1. Open InnPilot from the tray icon or Start menu and check the LifeDesk connection indicator.
2. Confirm the intended folder is available.
3. Open the relevant automation card and review what it will do.
4. For a new or changed setup, leave Safe mode on and use synthetic files.
5. Run one workflow.
6. Read the outcome card. Open Activity only when more detail is needed.
7. If an item says Needs attention, leave the original file in place and follow
   the matching recovery note below.

No operator should edit config.json, config.local.json, runner.db, the DPAPI
device-key file, or a generated recovery manifest by hand.

## Windows background operation

In **Hotel & Settings**, **Keep InnPilot ready** lets an operator explicitly
register or remove InnPilot from the current Windows user's sign-in startup.
When enabled, InnPilot starts with `--background`, hides its main window, and
continues only the same integrity-checked, allowlisted LifeDesk runner used while visible.
It does not run before Windows sign-in and it is not a privileged Windows
service.

Closing the window hides it to the notification area. Double-click the InnPilot
icon, or choose **Apri InnPilot**, to restore the window. Choose **Esci da
InnPilot** to stop the process and runner completely.

## Recovery points

The Support page can create a recovery point while no automation is running.
InnPilot keeps the newest ten verified points under its private Windows app-data
folder.

A point contains:

- validated InnPilot settings;
- the aligned managed automation configuration when it is present and safe;
- an online-consistent SQLite copy of durable runner job evidence;
- a manifest with byte sizes and SHA-256 hashes.

A point excludes:

- hotel documents and generated client files;
- Gmail credentials and OAuth tokens;
- activity logs and workflow reports;
- the DPAPI-protected LifeDesk device private key;
- arbitrary files from configured hotel folders.

This means a recovery point is useful for settings rollback and technical
forensics, but it is not a backup of the hotel's document archive.

### Create a point

1. Wait for the current workflow to finish.
2. Open **Support**.
3. Under **Private local recovery**, select **Create recovery point**.
4. Continue only when the latest point shows **Verified**.

If creation fails, InnPilot leaves the current configuration untouched and
removes its incomplete temporary directory.

### Restore settings

1. Stop normal hotel automation work on that PC.
2. Open **Support** and confirm that the latest point is **Verified**.
3. Select **Restore latest settings** and accept the explicit confirmation.
4. InnPilot creates another recovery point for the current state before it
   changes anything.
5. InnPilot restores configuration with rollback-safe file replacement and
   reloads its checks.

Normal restore does not overwrite the live runner ledger. That boundary
prevents a settings rollback from replaying, hiding, or deleting cloud jobs.
Ledger recovery is engineering-only and must be performed with InnPilot stopped,
a verified manifest, and a written incident record.

## Safe support report

**Copy support bundle** produces only:

- schema/version-safe operating flags;
- preflight keys and status codes;
- workflow keys, readiness, and whether each can run;
- the check timestamp.

It does not copy a local path, document name, email address, OAuth value, raw
log, report content, hotel name, or device key. Send this bounded report before
considering any broader diagnostic collection.

## Failure playbooks

### Shared scans folder unavailable

- Do not change the path to a guessed drive letter.
- Check that the hotel server and network are reachable.
- Reopen InnPilot and run **Check again** in Support.
- If each PC uses a different path, map that PC's real UNC or local path through
  guided setup. Never copy another PC's configuration file.

### File locked or still being scanned

- Leave the source file where it is.
- Close the application that has the file open or wait for the scanner upload to
  finish.
- Run the workflow again. Idempotency and verified copy operations prevent a
  successful item from being duplicated.

### Gmail sign-in expired

- Use the dedicated reconnect action.
- Confirm the Google consent page belongs to the expected hotel account.
- InnPilot stores the resulting token with Windows DPAPI for the current user.
- Do not email or upload credential/token files and do not place them in a
  recovery point.

### LifeDesk says the runner is offline

- Confirm InnPilot is running in the notification area and that HTTPS access is available.
- Use **Sync now** once.
- If the pairing was revoked, a manager creates a new one-time code in LifeDesk
  and pairs that exact PC again.
- Never reuse or send a pairing code by email or chat.

### InnPilot or Windows restarted during a run

- Reopen InnPilot.
- The local ledger changes an interrupted running job to Needs attention and
  reports bounded evidence to LifeDesk.
- Check the original and output folders before approving another execute run.
- Do not delete runner.db.

### Disk full or permission denied

- Stop retries.
- Free space or restore the intended Windows folder permission.
- Keep originals intact.
- Create a recovery point after the PC is healthy, then repeat first in safe
  mode.

### Cloud temporarily unavailable

- InnPilot keeps terminal job evidence in the local ledger until LifeDesk
  acknowledges it.
- Leave the InnPilot background runner active and use Sync later.
- Do not rerun only because LifeDesk has not yet refreshed.

## First-hotel rollout

1. Use one manager PC.
2. Use a dedicated Windows account or a clearly controlled staff account.
3. Configure the real shared-folder path on that PC.
4. Pair it with the correct LifeDesk hotel.
5. Enable **Keep InnPilot ready**, sign out and back in, and verify it starts in
   the notification area without a duplicate process.
6. Create a recovery point.
7. Run the packaged worker with synthetic PDFs in safe mode.
8. Verify LifeDesk receives only counters and safe state.
9. Observe for one week before enabling execute mode.
10. Add the first reception PC only after the manager-PC results are reviewed.
11. Record who can approve execute jobs, revoke a runner, restore settings, and
    access the Windows account.

## Release integrity

`npm run release:windows` performs the worker build, packaged-worker smoke test,
NSIS build, and release-manifest generation. The manifest hashes the installer,
desktop executable, worker, worker checksum, resolved dependency list, third-party
notices, and generated release-security audit.

Before InnPilot starts the packaged worker for a readiness check, it hashes the
worker and compares it with the packaged checksum. A failed integrity check is
blocking and the worker is never executed. A successful readiness result is
reused for up to ten minutes only when both the canonical worker path and
verified SHA-256 digest still match; this avoids repeated one-file worker cold
starts while preserving fail-closed verification.

The checked-in `release/release-policy.json` is deliberately fail-closed. Every
commercial field starts empty or false. The Authenticode audit inspects the actual
installer, desktop executable, and automation worker with Windows trust APIs; it
requires the exact publisher subject, an allowlisted certificate thumbprint, and
a trusted timestamp on all three files. It also requires an integrated signed
update client, pinned HTTPS endpoint and public key, tested staged rollout and
rollback, approved OCR-runtime notices, privacy/DPA approval, and supervised pilot
acceptance.

Normal generation emits an **internal-evaluation** manifest and a named list of
missing gates. A commercial attempt is intentionally explicit:

```powershell
$env:INNPILOT_DISTRIBUTION_MODE = "commercial"
npm run release:manifest
```

That command exits non-zero unless every policy gate and live artifact check
passes. A successful technical build alone is not commercial approval. Do not
rename, bypass, or populate policy evidence before the corresponding external
work has actually been completed and recorded.

## Release gate checklist

- [ ] Tracked source tree is clean.
- [ ] Frontend production build passes.
- [ ] Python automation tests pass.
- [ ] Rust tests pass with all features and targets.
- [ ] Strict clippy passes with warnings denied.
- [ ] Resource privacy doctor passes.
- [ ] Packaged worker checksum and smoke test pass.
- [ ] Disposable LifeDesk cloud test passes and removes its fixture.
- [ ] Installer is validated in a clean Windows environment.
- [ ] Upgrade preserves configuration and DPAPI identity.
- [ ] Uninstall behavior is documented and does not remove hotel folders.
- [ ] Installer, desktop executable, and worker signatures match the pinned publisher and thumbprint.
- [ ] Every signed executable contains a trusted timestamp.
- [ ] Signed update verification, staged rollout, and rollback tests pass.
- [ ] PDF/OCR notices are approved for commercial distribution.
- [ ] Release security audit reports zero missing gates.
- [ ] Release manifest and its checksum are archived with the release.

## Incident evidence

For a real incident, record:

- date/time and PC label;
- operator and workflow;
- LifeDesk job ID;
- safe status/error code;
- whether files were synthetic or real;
- whether originals, outputs, and archives were verified;
- recovery point date;
- resolution and approver.

Do not paste guest names, employee documents, invoice contents, local paths,
Gmail data, private keys, or raw reports into tickets or chat.
