# Phase C: typed domain services and adapter boundary

## Scope and audit result

Before Phase C, the safety logic was sound but its application boundary was
fragmented:

- Tauri commands resolved private paths and directly called configuration,
  onboarding, preflight, recovery, and workspace functions.
- onboarding lifecycle decisions, file persistence, locking, configuration
  inspection, and workspace effects lived in one module and its public entry
  points required an `AppHandle`;
- setup candidate generation, recovery-point policy, the two-file journal, and
  activation lived in one path, while React orchestrated `applying -> folders ->
  configuration save -> verifying -> ready` across separate commands;
- preflight was Tauri-independent but onboarding inspected its serialized JSON
  instead of a typed projection;
- recovery obtained its paths, build version, locks, and runner database from
  `AppHandle` even though its actual behavior needed only explicit local paths;
- important setup/recovery failures were strings, which forced a future adapter
  either to parse prose or to duplicate policy.

The most important discrepancy was the cross-record window. If the exact
configuration pair committed after onboarding entered `applying`, but the
renderer disappeared before recording `verifying`, startup knew only that the
configuration revision changed. It could not distinguish the approved commit
from an unrelated write and therefore required review.

## Implemented layers

```text
React UI
    |
Tauri command adapters (lib.rs)
    |
application.rs
    |-- SetupApplicationService (cross-record coordinator)
    |-- HealthService
    `-- RecoveryApplicationService
    |
typed capability services
    |-- onboarding::OnboardingService
    |-- setup::ConfigurationService
    `-- recovery::RecoveryService
    |
purpose-specific local adapters
    |-- onboarding::FileOnboardingRepository
    |-- config::ConfigurationRepository
    |-- platform::{InstallationPaths, BuildInfo}
    `-- runner_ledger path-based locks and backup
    |
InnPilot-owned local files / Windows runtime / automation runtime
```

`domain.rs` defines the adapter-neutral error contract. `platform.rs` is the
only new boundary that resolves application paths and package information from
Tauri. The services receive concrete, purpose-specific paths; none exposes a
generic read/list/write filesystem capability.

## Service contracts

### OnboardingService

The path-based service supports:

- startup reconciliation and current snapshot;
- begin/resume and revision-checked manual progress;
- durable apply intent, setup-saved evidence, completion, recoverable failure,
  restart, and one-time legacy import;
- completed-operation lookup for idempotent replay;
- approved workspace creation with backend-owned provenance and checked cleanup;
- validated backup recovery.

The filesystem repository owns the bounded versioned JSON record, process lock,
CAS revision, backup, atomic replacement, corruption/future-schema handling,
receipts, and event persistence. Compatibility functions that still accept an
`AppHandle` are adapters and delegate to this service.

### ConfigurationService

The service supports:

- exact app/automation pair snapshots and SHA-256 revision;
- preservation-aware patch preparation;
- preview from the same opaque candidate used for commit;
- explicit recovery-point staging;
- commit-time CAS, exact backups, Phase A pair journal, ordered atomic file
  replacement, rollback, and deterministic interrupted-commit reconciliation;
- fast/full health input and configuration validation.

`ValidatedSetupCandidate` is opaque outside the configuration module. No UI or
adapter can obtain its raw bytes and write them independently. Unknown manager-PC
JSON extensions, legacy migration behavior, future-schema refusal, and exact
pair revision semantics remain in the shared candidate/commit path.

`ConfigurationRepository` owns the installed configuration path, bootstrap and
migration, the installation lock, atomic activation, and preservation-aware
narrow settings updates. Setup/configuration writes exposed to future adapters
go through `ConfigurationService`; direct arbitrary JSON mutation is not an API.

### HealthService

The service exposes typed `fast` or `full` status and validation requests. It
uses `ConfigurationService` and the existing deterministic preflight builder.
`PreflightReport::deferred_workflow_keys()` is now a typed projection; lifecycle
code no longer reflects over serialized preflight JSON.

### RecoveryService

`RecoveryEnvironment` supplies only the InnPilot configuration, recovery root,
runner directory/database, and app version. The path-based service can list,
create, verify/read, and restore supported recovery points without Tauri.
`RecoveryApplicationService` maps read/create outcomes to typed adapter errors;
manual restore runs through `SetupApplicationService` so onboarding is
reconciled against the restored configuration before the command returns.

## Typed failures

`WorkspaceError` serializes only a reviewed safe envelope:

- stable code and category;
- safe summary;
- retry directive and refresh requirement;
- one bounded detail variant for a revision, transition, schema, validation,
  preflight blocker keys, or recovery-point ID.

The current codes cover revision/transition/request errors, capability and
confirmation failures, unsupported/corrupt state, persistence conflict/failure,
configuration conflict/invalidity, path policy/availability, preflight,
recovery, permission, busy operations, and internal failure. Technical causes
stay in a nonserialized diagnostic field. There is no arbitrary JSON detail and
no adapter receives tokens, document contents, raw logs, or private paths from
this error model.

Legacy `OnboardingError` values are mapped by their stable code, never by parsing
their message. Remaining string-returning filesystem internals are classified by
the application operation that failed, not by prose matching.

## Cross-record setup authority and ordering

Authority is explicit:

- exact app + automation bytes and their pair revision are authoritative for
  installed configuration facts;
- the onboarding record is authoritative for lifecycle, approval, progress,
  folder provenance, and idempotency identity;
- the setup journal plus verified recovery point is authoritative for an
  in-flight two-file configuration commit;
- current preflight is authoritative for live operability. Historical onboarding
  readiness is not live health.

`SetupApplicationService::apply_approved_setup` is the only renderer-exposed
manual finalization operation. Its order is:

1. require explicit manual UI confirmation and validate both revisions;
2. build the exact opaque candidate and target pair revision once;
3. stage the exact predecessor recovery point when both configuration files
   change;
4. persist `ApplyIntent { operationId, payloadDigest, baseConfigRevision,
   targetConfigRevision, recoveryPointId, workspaceInitialized }` while entering
   `applying`;
5. create only the approved workspace folders and persist backend provenance;
6. commit the prepared candidate with the Phase A CAS/journal/atomic write path;
7. derive and persist `verifying`, then terminal readiness, from installed data;
8. return one typed result to the UI.

The former renderer commands that could separately manufacture `applying`, a
setup-saved receipt, or completion are no longer registered.

Startup always reconciles the Phase A pair journal before configuration
bootstrap and onboarding. For an interrupted durable apply intent:

- current revision equals base: no approved write occurred; resume for input;
- current revision equals target and backend workspace evidence is present: the
  approved candidate committed; finalize without writing configuration again;
- a no-op target without workspace evidence: resume for input rather than
  treating the operation as complete;
- current revision is neither: report a configuration conflict and require
  review;
- an older Phase B `applying` record without a target keeps its conservative
  `apply_outcome_unknown` behavior.

An explicit manual restore that makes the installed pair structurally
incomplete reopens a backend-owned review session. Startup performs the same
check, closing the small window between the configuration restore and lifecycle
reconciliation.

The operation ID plus payload digest survives terminal receipt eviction in the
last-completed-session summary. Same ID/same payload returns the observed result;
same ID/different payload is rejected. A response lost after configuration
commit is therefore reconciled and replayed without a second configuration
write.

## Frontend and Tauri impact

The wizard remains visually and behaviorally the same. It still saves durable
progress, and the nonmutating preview command remains available, but Finish now
invokes one `apply_approved_setup` request. It no longer coordinates workspace
creation, configuration persistence, or onboarding completion itself.

Important Tauri commands now resolve `InstallationPaths`/`BuildInfo`, construct a
service, call one typed operation, and return its typed result/error. Existing
command names were kept for state, progress, preview, health, and recovery where
practical. Frontend error normalization accepts both the Phase B onboarding
shape and the new safe workspace-error envelope.

## Configuration mutation boundary

The supported future adapter surface has one preservation-aware setup mutation
route:

```text
adapter -> SetupApplicationService -> ConfigurationService
        -> ConfigurationRepository -> validated candidate/Phase A commit
```

Branding, language, managed-worker selection, and cloud-probe metadata continue
to use narrow `ConfigurationRepository::update` operations under the same
installation lock and raw-extension-preserving activation. They are not exposed
as arbitrary mutation to the future adapter. Template synchronization remains a
known specialized two-file writer and is listed below; it is not represented as
if it already uses the setup coordinator.

## Deliberate remaining debt

Phase C does not hide or broaden the three accepted medium hardening items:

- same-path directory identity and final cleanup swap/crash windows;
- template-update two-file crash journal;
- manual-recovery two-file crash journal. Manual restore now holds the shared
  workflow/configuration locks and reconciles onboarding, but power loss between
  its two replacements remains journal debt.

For path-changing setup commits, the recovery point authorizes restoration of
the predecessor path only. An interrupted rollback can leave the newly created
configuration file as an unreferenced orphan rather than treating a journal path
as deletion authority.

The cross-record onboarding/configuration ambiguity is no longer in that list:
durable target intent and deterministic reconciliation address it.

## Phase D boundary

The smallest safe next step is a local, read-only/proposal-oriented adapter over
these services. It should authenticate a local caller, expose redacted health,
onboarding, configuration revision/summary, recovery status, and synthetic
proposal validation, and return the same typed errors. It must not expose raw
filesystem operations, current `HubConfig`, configuration commit, automation
execution, credentials, or completion evidence. A proposal should bind to the
exact configuration revision and still require manager approval through
InnPilot before `SetupApplicationService` can apply it.

No MCP, OAuth, remote relay, discovery engine, proposal engine, model prompt, or
agent permission system is implemented in Phase C.
