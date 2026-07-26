# InnPilot release readiness

This document records what has been proven and what still requires an explicit
business or security decision. Passing engineering tests is not permission to
process real hotel data.

## Current release decision

| Audience | Decision | Conditions |
| --- | --- | --- |
| Engineering evaluation | Ready | Synthetic data, safe mode, controlled PC |
| Supervised hotel pilot | Conditionally ready | Per-PC mapping, recovery point, synthetic rehearsal, named operator |
| Commercial client release | Blocked | Complete every external gate below |

The release manifest intentionally labels current packages
internal-evaluation and refuses a commercial designation.

## Reproducible gates

Run from a clean committed checkout:

    npm clean-install
    npm run build:worker
    npm run verify:release
    npm run build:validation
    npm run test:clean-install

test:clean-install uses the separate product identity
com.innpilot.validation. It refuses pre-existing validation state, never
touches the real InnPilot profile, and removes only its exact synthetic profile.

The gate proves:

- frontend production compilation;
- packaged resource inventory;
- compiled worker checksum and synthetic smoke test;
- 46 Python workflow and safe-file tests;
- Rust formatting, strict lint, and 135 all-feature/all-target tests;
- installer contains no recognized hotel documents, credentials, tokens, or
  connection/device-key files;
- first launch creates generic settings and selects the packaged worker;
- reinstall preserves existing settings;
- uninstall preserves recoverable app data.

## Recorded evidence ? 26 July 2026

| Proof | Result |
| --- | --- |
| LifeDesk cloud acceptance | 8/8 stages passed; synthetic tenant deleted and verified |
| LifeDesk tests | 78/78 passed; typecheck and production build passed |
| InnPilot Rust | 135/135 passed across all features and targets |
| InnPilot automation | 46/46 passed |
| Strict Clippy | Passed with warnings denied |
| Windows lifecycle | Clean install, upgrade preservation, and safe uninstall passed |
| Packaged worker SHA-256 | 06e7168c941535e2187524a4d11daf08a333d14f4378bdc980de37d2c7f2a2b1 |
| Installer data-leak scan | 0 forbidden operational files |

Relevant source commits:

- LifeDesk: 8b19661 on dev
- InnPilot: 4d02207 on codex/lifedesk-integration

## Failure-mode coverage

| Failure | Required behavior | Evidence |
| --- | --- | --- |
| Cloud unavailable | Keep durable local state; retry without duplicate execution | runner ledger and service tests |
| PC stops during a run | Mark interrupted work for attention; never silently rerun | interrupted-job recovery test |
| Duplicate lease or replay | Accept an identical lease idempotently; reject conflicts | lease and signed-contract tests |
| Missing or untrusted folder | Block before workflow start | preflight and path-boundary tests |
| Partial settings write | Preserve old or new complete file, never a partial file | atomic replacement tests |
| Corrupt recovery point | Reject restore before modifying live settings | manifest integrity tests |
| Modified worker | Refuse execution when SHA-256 differs | worker runtime tests and installer probe |
| Gmail credential/token issue | Fail closed and guide reconnect; never upload or log secrets | preflight, DPAPI, and redaction tests |
| Uninstall or upgrade | Preserve settings and private recovery state | isolated Windows lifecycle probe |
| Malformed cloud result | Emit bounded status/error codes only | runner protocol and raw-error tests |

## External gates before commercial distribution

1. Replace PyMuPDF with a verified permissive implementation, or purchase and
   document the appropriate Artifex commercial license. Current packaging must
   not be sold while this is unresolved.
2. Obtain a trusted Windows code-signing certificate, sign the installer and
   application, and verify signatures in the release pipeline.
3. Configure a signed update channel with staged rollout and rollback. Do not
   ship an unsigned auto-updater.
4. Complete a mapping and synthetic rehearsal on each manager/reception PC,
   because the shared Scansioni path can differ by machine.
5. Approve GDPR roles, retention, incident response, backup ownership, and the
   client data-processing agreement with qualified legal/privacy review.
6. Run a supervised pilot, record operator acceptance, and approve execute mode
   one workflow at a time.

Until those gates are complete, use only controlled internal evaluation or an
explicitly supervised synthetic-data pilot.
