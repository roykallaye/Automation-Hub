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

Every push and pull request also runs the source release gates on an isolated
Windows 2022 GitHub runner. The workflow has read-only repository permission,
pins official checkout, Node, and Python actions to exact revisions, installs
the locked dependency graphs, builds and self-tests the private automation
engine, and then runs `verify:release`. It never receives hotel files, Gmail
credentials, Supabase service-role keys, signing keys, or production device
keys. The isolated installer lifecycle and the credentialed LifeDesk cloud
acceptance remain deliberate release-operator gates.

The gate proves:

- frontend production compilation;
- packaged resource inventory;
- compiled worker checksum and synthetic smoke test;
- 48 Python workflow and safe-file tests;
- Rust formatting, strict lint, and 139 all-feature/all-target tests;
- installer contains no recognized hotel documents, credentials, tokens, or
  connection/device-key files;
- first launch creates generic settings and selects the packaged worker;
- background launch remains alive and a second launch yields to the existing
  desktop runner;
- reinstall preserves existing settings;
- uninstall preserves recoverable app data.

## Recorded evidence - 27 July 2026

| Proof | Result |
| --- | --- |
| LifeDesk cloud acceptance | 8/8 stages passed; synthetic tenant deleted and verified |
| LifeDesk tests | 78/78 passed; typecheck and production build passed |
| InnPilot Rust | 139/139 passed across all features and targets |
| InnPilot automation | 48/48 passed |
| Strict Clippy | Passed with warnings denied |
| Windows lifecycle | Clean install, background launch, single-instance handoff, upgrade preservation, and safe uninstall passed |
| Packaged worker SHA-256 | 1d2fe071dbf79ab2b6e91748081e8f33e7cb91c412b07d1162ed04a911c0328d |
| Installer data-leak scan | 0 forbidden operational files |

The commit carrying this document is the InnPilot evidence revision. LifeDesk
acceptance evidence is retained on its `dev` branch and must be rerun with
production credentials before a new commercial release.

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
| Duplicate desktop launch | Keep one runner and route the launch to the existing instance | isolated Windows lifecycle probe |
| Malformed cloud result | Emit bounded status/error codes only | runner protocol and raw-error tests |

## External gates before commercial distribution

The former PyMuPDF/AGPL packaging blocker has been removed: invoice cropping now
uses BSD-licensed `pypdf`, while embedded text and rendering use the permissively
licensed `pypdfium2`/PDFium stack. The build and tests must continue to reject any
reintroduction of `PyMuPDF` or `fitz`.

1. Obtain a trusted Windows code-signing certificate, sign the installer and
   application, and verify signatures in the release pipeline.
2. Configure a signed update channel with staged rollout and rollback. Do not
   ship an unsigned auto-updater.
3. Preserve and formally approve notices for the exact pinned Tesseract runtime
   and all DLLs recorded in its generated runtime manifest.
4. Complete a mapping and synthetic rehearsal on each manager/reception PC,
   because the shared Scansioni path can differ by machine.
5. Approve GDPR roles, retention, incident response, backup ownership, and the
   client data-processing agreement with qualified legal/privacy review.
6. Run a supervised pilot, record operator acceptance, and approve execute mode
   one workflow at a time.

These gates are represented in `release/release-policy.json` and verified against
the actual release artifacts by `scripts/inspect-authenticode.ps1` and
`scripts/release-security.mjs`. The generated security audit names every missing
gate. Setting `INNPILOT_DISTRIBUTION_MODE=commercial` must fail until the audit is
fully green; internal-evaluation mode remains available for controlled testing.

Until those gates are complete, use only controlled internal evaluation or an
explicitly supervised synthetic-data pilot.
