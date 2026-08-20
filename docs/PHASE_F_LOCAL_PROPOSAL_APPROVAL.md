# Phase F — Local proposal approval, verification, and rollback

Phase F keeps the Phase D/E authority boundary unchanged:

> The assistant discovers and proposes. InnPilot validates and applies. The manager approves.

## Trusted call path

`AssistantPage` sends only `proposalId`, `proposalRevision`, `proposalDigest`, a unique request ID, and explicit confirmation to the local Tauri command. The command obtains the active originating local grant and delegates to `ProposalApplyService`. No MCP router references this command or service.

`ProposalApplyService` reloads the protected proposal and discovery snapshot, then delegates candidate creation and mutation to the existing `SetupApplicationService` / `ConfigurationService` boundary. The opaque `ValidatedSetupCandidate` is built once after approval and the same Rust value is committed.

## Protected approval/apply record

`<app-data>/proposal-approvals/state.dpapi` is schema-versioned, bounded, atomically replaced, locked, and encrypted/authenticated for the current Windows user by DPAPI. It stores no proposal content, paths, credentials, prompts, logs, or hotel documents.

Each one-operation record binds:

- installation ID;
- proposal ID, revision, schema, and digest;
- originating profile digest;
- base and target configuration revisions;
- onboarding revision and discovery snapshot digest;
- target revision as normalized candidate digest;
- changed-field digest and warning count;
- approval ID, operation ID, request ID, timestamp, and 15-minute expiry;
- a digest of the local Windows/DPAPI context (never the raw username or SID);
- verified recovery-point ID;
- workspace/commit/verification/rollback stage flags;
- bounded safe audit events and final outcome.

The record is the approval and lifecycle authority. The Phase A setup journal remains the only configuration-pair crash journal. When both config files change, it is enriched with proposal, approval, operation, base/target revision, and workspace evidence. Single-file atomic changes do not need a pair journal. Thus Phase F does not introduce a second configuration-write algorithm or competing pair journal.

## Eligibility and exact-candidate proof

Before approval and again immediately before mutation InnPilot checks:

- exact proposal ID, revision, schema, and digest;
- `ready_for_review`, no required questions, not expired/superseded/invalidated;
- exact base configuration and onboarding revisions;
- active originating grant and scope;
- current immutable discovery snapshot and evidence references;
- local-path digest and snapshot canonical-path equality;
- recomputed proposal digest;
- deterministic candidate target revision equals the proposal target revision;
- approval record, installation, Windows context, expiry, and operation identity;
- verified readable predecessor recovery bytes.

The proof chain is:

`reviewed immutable proposal digest → protected approval → deterministic SetupPatch → one opaque ValidatedSetupCandidate → identical target configuration revision → ConfigurationService commit`.

Any changed authority fails closed. InnPilot never merges or silently regenerates an approved proposal.

## Transaction and verification

1. Reload proposal/config/onboarding/discovery authority.
2. Persist local approval.
3. Reload and revalidate every authority.
4. Build one opaque candidate and check its target digest.
5. Create, read back, and byte-compare the predecessor recovery point.
6. Persist `applying` plus recovery identity.
7. Prepare workspace through backend-owned provenance.
8. Commit through the preservation-aware Phase A configuration transaction.
9. Persist `verifying`.
10. Run full deterministic preflight; no hotel workflow or production script runs.
11. Require the hotel profile and primary invoice workflow. Other unavailable workflows are deferred.
12. Complete as `ready` or `ready_with_deferred_items` only after required checks pass.

## Rollback

Required verification failure records `verification_failed` and `rollback_started`, restores the exact verified predecessor recovery point under the existing workflow/configuration locks, reloads the installed pair, and proves its revision equals the recorded base revision. Only then does onboarding become `rolled_back` and the approval close.

If restore or integrity verification fails, the record becomes `failed_recoverable`, evidence is retained, and no repeated destructive loop is started.

## Startup reconciliation

Startup first reconciles the Phase A configuration-pair journal, then the protected Phase F record, then generic onboarding. Outcomes are determined from active configuration revision plus durable stage evidence:

| Durable state | Installed revision | Result |
| --- | --- | --- |
| approved | base | close unused approval; never apply |
| applying/verifying | target | verify/finalize; never reapply |
| rollback started | base | finalize verified rollback |
| rollback started | non-base | at most one bounded retry, then recovery required |
| ready lifecycle, record not finalized | target | finalize record after response loss |
| rolled-back lifecycle, record not finalized | base | finalize record after response loss |
| any unexpected revision | other | fail recoverably; never merge/replay |

Phase F operation IDs are recognized by onboarding. Generic restart logic cannot promote an interrupted Phase F apply to ready without Phase F verification.

## Manager UI

The local review shows current versus proposed values, authoritative real local paths, evidence/validation, warnings/questions, and precise statements about preserved settings, files, scripts, documents, and Gmail credentials. Approval is disabled unless the proposal is eligible. The action is **Approve and finish setup** and explains apply, verification, and rollback directly beside the button.

## MCP surface

The MCP remains exactly ten non-applying tools:

1. `innpilot_get_capabilities`
2. `innpilot_get_onboarding_state`
3. `innpilot_get_configuration_summary`
4. `innpilot_get_health`
5. `innpilot_get_recovery_status`
6. `innpilot_validate_setup_proposal`
7. `innpilot_get_discovery_scope`
8. `innpilot_discover_environment`
9. `innpilot_prepare_setup_proposal`
10. `innpilot_get_active_setup_proposal`

There is no MCP approval, receipt, apply, onboarding-transition, recovery, automation-run, or production-script capability.

## Existing bounded debt

Phase F does not broaden the previously recorded medium hardening work:

1. same-path created-folder identity/cleanup race;
2. template-update two-file crash journal;
3. standalone manual-recovery two-file crash journal.

Phase F rollback is protected by its durable stage record and bounded startup reconciliation; the broader manual recovery command debt remains separate.
