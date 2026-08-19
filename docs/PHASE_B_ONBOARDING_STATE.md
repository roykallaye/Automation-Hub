# Phase B: durable onboarding state

## Authority

InnPilot owns onboarding state in its local backend. The React interface renders
that state and may keep ephemeral interaction details in memory, but browser
storage is not authoritative.

The durable record lives at:

```text
<InnPilot app data>/onboarding/state.json
```

It is deliberately separate from `config.json`, the automation configuration,
the runner ledger, recovery points, and hotel folders. Updating onboarding must
never change hotel configuration or invalidate the Phase A configuration-pair
revision.

## Domain model

The record uses the `innpilot.onboarding.v1` contract and separates:

- installation readiness: long-lived `notStarted`, `ready`, `readyLegacy`, or
  `readyWithDeferredItems` evidence;
- an optional active session: its stable ID, semantic state, exact base
  configuration revision, safe manual checkpoint, server-recorded folder
  provenance, timestamps, and bounded event history;
- a monotonically increasing onboarding revision used for compare-and-swap;
- one-time migration metadata.

The semantic session states are:

```text
notStarted
bootstrapCreated
waitingForAgent
agentConnected
scopeApprovalRequired
discoveryRunning
needsUserInput
proposalReady
waitingForApproval
applying
verifying
ready
readyWithDeferredItems
failedRecoverable
rolledBack
readyLegacy
```

Only explicit domain operations can move between states. There is no command
that replaces an arbitrary onboarding JSON object. Invalid transitions and
stale revisions are rejected without writing. Future agent-related states are
part of the versioned vocabulary, but Phase B does not expose discovery, MCP,
OAuth, agent write access, or proposal execution.

Completed installation readiness is historical. A later missing network share,
expired Gmail token, or unavailable runtime affects operational preflight; it
does not erase evidence that onboarding completed. Reconfiguration creates a
new session instead of rewinding a completed one.

## Persistence and recovery

Each mutation is bounded and validated, holds a cross-process lock, installs an
exact last-known-good backup, and activates the new JSON with the same synced
atomic replacement primitive used by Phase A configuration persistence.

The reader caps file size and inspects `schemaVersion` before typed
deserialization. A newer unsupported schema is never downgraded or overwritten.
A same-version record with unknown fields also fails closed; schema evolution
requires an explicit versioned migration rather than preserving arbitrary
content. A corrupt primary is never silently reset. When a validated backup exists, an
explicit recovery operation can restore it while preserving the damaged bytes
for diagnostics. Recovery advances beyond the lost primary generation and
refreshes its validated backup, preventing stale revisions from becoming valid
again even across repeated recoveries.

Onboarding and configuration remain separate atomic records. Phase C now binds
manual apply to a durable intent containing the approved operation identity,
base configuration revision, and exact target revision before the Phase A
configuration transaction. Startup can therefore distinguish not-applied,
committed, and conflicting outcomes without replaying a configuration write. It
never runs a production automation as part of reconciliation. See
`PHASE_C_DOMAIN_SERVICES.md` for the coordinator and adapter boundary.

## Startup and legacy installations

Startup order is:

1. reconcile an interrupted Phase A setup transaction;
2. capture whether `config.json` existed before default creation;
3. ensure/migrate the existing configuration;
4. reconcile or initialize onboarding state;
5. start desktop services and the runner.

Capturing the pre-existing-config fact is essential because InnPilot creates a
default `config.json` on first launch.

- Fresh installation: `notStarted`.
- Structurally complete pre-existing installation: `readyLegacy`; it is not
  forced through setup.
- Pre-existing partial installation: a resumable manual session with existing
  configuration left byte-for-byte outside the onboarding write.
- Existing in-progress session: resume from the durable checkpoint.
- Ambiguous/corrupt/future state: fail safely for review; never infer a reset.

## Browser-storage migration

The retired WebView key is:

```text
innpilot.setup-session.v1
```

The frontend sends its raw bounded value to the backend once. The backend treats
it as untrusted input, accepts only the known version and allowlisted fields,
requires its base configuration revision to match the installed Phase A pair,
and never imports browser claims that setup completed or browser-supplied paths
as cleanup authority.

The backend records the terminal migration outcome. The frontend removes only
that key after a confirmed backend response. A replay cannot overwrite a newer
backend checkpoint, and unrelated local-storage keys are never removed.
Malformed or oversized legacy data is recorded only as `discardedInvalid`; its
raw content is neither retained nor repeatedly retried.

Workspace creation and empty-folder cleanup are backend operations serialized
with both the workflow and configuration locks. Creation requires the approved
`applying` state. Cleanup is unavailable during apply/verify, uses only
server-recorded paths, and consumes that authority after one checked attempt so
a later non-empty folder can never remain eligible for deletion.

## Data boundary

The local checkpoint may contain the explicit manual setup values needed to
resume, including configured local paths and recipient rules. It does not
contain file contents. Input is allowlisted, size/depth bounded, and rejected if
it resembles embedded credential material or a raw traceback.

The onboarding record must never contain:

- Gmail access or refresh tokens, credential contents, passwords, API keys, or
  private signing keys;
- document, invoice, email, booking, or OCR contents;
- arbitrary discovered filenames;
- raw logs, tracebacks, prompts, or model output;
- unrestricted free-form diagnostic evidence.

Events contain allowlisted codes, states, revisions, timestamps, and bounded
identifiers only.

## Deliberate follow-up debt

InnPilot does not claim one filesystem transaction across configuration and
onboarding. Phase C's durable apply intent and deterministic startup
reconciliation close the expected interruption window without rolling valid
configuration back or replaying a committed candidate.

The two Phase A configuration-wide gaps remain separate follow-up work:

- a durable two-file crash journal for template updates;
- a durable two-file crash journal for manual recovery restore. Phase C added
  the shared workflow/configuration lock and lifecycle reconciliation; the
  remaining debt is crash consistency between the two replacements.

They are not solved or hidden by onboarding persistence.
