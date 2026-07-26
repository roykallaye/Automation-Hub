# LifeDesk connection

Status: InnPilot implementation guide for runner protocol version `1`.

The authoritative protocol and threat model live in the LifeDesk repository:

- `docs/AUTOMATION_RUNNER_PROTOCOL_V1.md`
- `docs/AUTOMATION_SECURITY_MODEL.md`

## Boundary

InnPilot is the only component that may read or write hotel folders. It makes
outbound HTTPS requests to the configured Supabase Edge Function and never
opens an inbound listener.

The cloud may request only a built-in workflow identifier plus `dry_run` or
`execute`. It may not send a command, script, argument, URL, path, filename, or
document. InnPilot maps protocol identifiers to reviewed local workflow code and
fails closed on unknown values.

Paths, filenames, document contents, OCR text, recipient information, OAuth
material, private keys, stdout, stderr, and raw errors remain local. Cloud
updates contain only bounded counters, timestamps, states, and allowlisted
machine-readable codes.

## Device identity

- Generate one Ed25519 key pair per InnPilot installation.
- Send only the public key during single-use pairing.
- Protect the private key with Windows DPAPI in current-user scope.
- Never render, log, export, synchronize, or back up the private key.
- Sign every sync request with timestamp, nonce, and exact body digest.
- Pin configuration to the expected HTTPS Supabase project host.
- Treat installation identifiers and public-key fingerprints as non-secret.

## Runtime

- Keep one sync loop per installation.
- Sync every 30 seconds with jitter and exponential offline backoff.
- Persist a leased job in SQLite before acknowledging or executing it.
- Enforce unique cloud job and idempotency identifiers locally.
- Acquire a cross-process workflow lock before running Python.
- Preserve original files and use validated atomic output replacement.
- Check cooperative cancellation between steps.
- Keep item-level reports local and send only sanitized results.
- Resume after reboot from the ledger, never from in-memory state.

## Delivery sequence

1. Pairing, request signing, and secure local key storage.
2. Local SQLite ledger, durable state machine, and single-runner lock.
3. Signed sync client with compatibility, heartbeat, lease, result, and
   cancellation handling.
4. Focused connection and recovery UI.
5. Synthetic end-to-end rehearsal.
6. Signed Windows installer and update flow.
7. Manager-PC dry-run pilot before any live workflow is enabled.

## Release gates

The release fails if a secret, real hotel document, personal-data filename,
absolute hotel path, local configuration, raw report, or token is present in Git
or a packaged resource. It also fails if replay, signature, revocation,
idempotency, crash recovery, unavailable-share, locked-file, or disk-full tests
do not pass.

## Current implementation

Pairing and signed manual heartbeat are implemented. Workflow leasing remains
fail-closed until the durable executor milestone is complete.

- The release endpoint is fixed to the LifeDesk Supabase project and redirects are disabled.
- Ed25519 private seed material is protected with current-user Windows DPAPI.
- The one-time pairing token is never written to disk or logs.
- Public connection metadata is written with an interrupted-write backup path.
- Sync uses a fresh nonce, timestamp, exact-body SHA-256, and Ed25519 signature.
