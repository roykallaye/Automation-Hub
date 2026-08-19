# Phase D: secure local MCP foundation

Status: implemented and tested with synthetic data only. This is an
internal-evaluation capability. It is not a remote support channel and does not
authorize any InnPilot change.

## Decision and tested compatibility

InnPilot ships a separate Rust STDIO helper:

```text
Codex
  -> MCP over stdin/stdout
  -> innpilot-mcp.exe
  -> narrow LocalMcpFacade
  -> Phase C Setup, Onboarding, Configuration, Health and Recovery services
  -> InnPilot-owned local state
```

The helper reuses the application crate and therefore does not reimplement
configuration or onboarding rules. It has no listening socket. Its lifetime is
owned by the MCP client, while the existing workflow/configuration locks remain
the concurrency authority across InnPilot and the helper.

The implementation uses the maintained Rust MCP SDK `rmcp` 3.1.3. This avoids a
second runtime, produces one Windows sidecar that can later be signed with the
application, and keeps the protocol adapter replaceable above Phase C services.
The server advertises the SDK's known protocol versions instead of assuming one
client generation.

Verified on 2026-08-19:

- MCP specification considered: 2026-07-28;
- installed client: `codex-cli 0.144.3`;
- actual protocol negotiated by that client: `2025-06-18`;
- helper/application version: `0.1.0`;
- Windows: Microsoft Windows 10 Home 10.0.19045, `x86_64-pc-windows-msvc`;
- tested transport: local STDIO, one JSON-RPC message per line;
- tested Codex registration: `codex mcp add <name> -- <helper> --profile <id>`.

Current official references used for the implementation are the
[MCP specification](https://modelcontextprotocol.io/specification/2026-07-28),
[STDIO transport rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio),
[tool semantics](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
and the [Rust SDK releases](https://github.com/modelcontextprotocol/rust-sdk/releases).

Tools were chosen instead of duplicating the same data as resources. This gives
each read one authorization, rate-limit and audit point and matches the tested
Codex behavior. The server exposes no resources or prompts. Tool output is typed
structured JSON; annotations declare every tool read-only, non-destructive,
idempotent and closed-world.

## Local grant and process boundary

Creating a connection in InnPilot creates one bounded local grant:

- a random 128-bit profile identifier used only as a non-secret selector;
- the opaque InnPilot installation ID;
- exactly six Phase D scopes;
- creation and 30-day expiry timestamps;
- revocation and last-activity metadata;
- a bounded set of proposal-validation receipts.

The grant and audit trail are protected with Windows DPAPI for the current user
and stored under InnPilot's app-data directory. The copied profile identifier is
not a bearer credential: the protected grant must also exist, decrypt for the
current Windows user, match the installation, be unexpired, unrevoked and contain
the required scope. No secret is placed in the Codex command, process arguments,
stdout, UI preview or audit trail. Revocation is checked again on every call.

This protects the InnPilot capability boundary; it does not claim to stop
arbitrary malware already running with the same Windows user's authority.

## Exact MCP surface

| Tool | Scope | Returned boundary |
|---|---|---|
| `innpilot_get_capabilities` | `installation.read` | Product/helper versions, opaque installation identity, safe display name, lifecycle, contracts/scopes and explicit forbidden flags. No paths. |
| `innpilot_get_onboarding_state` | `onboarding.read` | Semantic state/revision/readiness, deferred item keys and whether user action is required. No persisted events or raw JSON. |
| `innpilot_get_configuration_summary` | `configuration.read_redacted` | Configuration revision, safe modes, workflow presence/counts and known-path existence booleans. No raw paths, emails, rules, templates or extensions. |
| `innpilot_get_health` | `health.read` | A bounded, redacted health summary. It does not start processes, run write probes, enumerate folders, or return tracebacks/logs. |
| `innpilot_get_recovery_status` | `recovery.read` | Recovery-point count/latest timestamp, recoverability and interrupted-setup flag. No recovery contents. |
| `innpilot_validate_setup_proposal` | `proposal.validate` | Deterministic, revision-bound Phase C preview and digest. It cannot approve or commit. |

There is technically no MCP path for configuration commit, onboarding approval,
automation execution, arbitrary filesystem access or discovery, directory
listing, document/log reading, shell or script execution, credentials/Gmail,
SQL, arbitrary URLs, LifeDesk, remote control, resources, or prompts.

## Proposal contract

The validator accepts a strict `innpilot.local-mcp.v1` object with:

- `proposalId`;
- `baseConfigurationRevision` (`sha256:` plus 64 lowercase hex characters);
- `contractVersion`;
- `changes`, whose only fields are `hotelDisplayName`,
  `invoiceDeliveryMode`, `invoiceFileSelectionMode`, `safeMode`,
  `archiveOriginals`, and `redactLogs`.

Unknown fields and internal-looking `apply` or approval fields fail
deserialization. Types, enum values, identifiers and a 16 KiB serialized limit
are validated before Phase C preview. The existing preservation-aware candidate
builder enforces the observed configuration revision. The response contains the
normalized changes, safe warnings/effects, base and expected target revisions,
a canonical SHA-256 proposal digest, `humanApprovalRequired = true`, and
`mutationPerformed = false`.

Receipts make an exact proposal-ID replay deterministic. Reusing an ID with a
different payload fails. Stale configuration returns a typed refresh response.
No approval receipt can be created and no apply service is reachable from the
adapter.

## Errors, limits and audit

Typed Phase C errors are mapped to stable model-facing codes, a safe message,
retry/refresh guidance and an optional safe revision. Internal diagnostics and
raw paths are excluded.

Resource bounds are deliberate:

- 1 MiB maximum inbound MCP message;
- 16 KiB maximum proposal;
- 120 tool calls per helper process per minute;
- at most four concurrent blocking operations;
- 15-second response timeout; a timed-out operation keeps its slot until it
  stops, preventing unbounded blocked-worker accumulation;
- at most eight grant profiles, 32 proposal receipts and 256 audit events;
- protected grant/audit file size limits.

Malformed or oversized protocol input is rejected without writing to stdout.
STDOUT is reserved for MCP; operational errors use STDERR. Audit writes fail
closed. The DPAPI-protected bounded audit records timestamp, safe profile ID,
tool, outcome/error code, safe revision, proposal ID/digest, and sanitized client
and protocol names. It never records prompts, request payloads, credentials,
documents, raw logs or paths.

## Product and packaging flow

The existing Assistant page now has a minimal **Local agent connection** area:
create, copy the exact Codex command, inspect scopes/expiry/last activity, refresh
status and revoke. The primary text is nontechnical; MCP configuration is a copy
action rather than manual TOML editing.

`npm run build:desktop` builds the web application and the release helper. The
packaging preparation script compiles `innpilot-mcp`, detects the Rust Windows
target and copies it to Tauri's target-qualified sidecar path. Release and
validation configs include that external binary. Development-only synthetic
bootstrap commands are compile-time absent from release builds. The helper is
not commercially code-signed yet; commercial distribution remains blocked by
the existing release gates.

## Real Codex evidence

The real installed Codex CLI launched the debug helper from this checkout against
a sentinel-marked synthetic installation under
`%TEMP%\innpilot-phase-d-codex-gate` (the disposable fixture was removed after
the test). It successfully called capabilities, onboarding, redacted
configuration, health and recovery tools.

Codex then called `innpilot_validate_setup_proposal` using an exact observed
revision. The server returned:

- accepted/non-mutating validation;
- `humanApprovalRequired = true`;
- `mutationPerformed = false`;
- base revision
  `sha256:cb307f6eccce543a8317925525f97147658b71934a0302e2b4187220a8b77de0`;
- proposal digest
  `bd1bf66dccd704e4c03e794fe6867d7ec085c7b736a00221bb38f88761d9aa6b`;
- deterministic target revision
  `sha256:012c7f5d36a0f9ac04cba3e9f522bee821782a23ee3bb1dd278aa3ee22eba86e`.

The local status recorded client `codex-mcp-client`, negotiated protocol
`2025-06-18`, and the proposal tool. After revocation, the same profile failed
during the next Codex MCP initialization; no tool was available. The temporary
Codex MCP entry and all synthetic fixture roots were removed. ChatGPT desktop,
web and phone compatibility were not tested and are not claimed.

## Security and regression evidence

Automated tests cover the exact six-tool surface; false mutation/discovery/
execution/credential/SQL/remote flags; redaction; byte-for-byte preservation of
configuration, automation configuration and onboarding across reads/proposals;
stale, unknown, hidden, approval-like, apply-like, malformed and oversized
proposal inputs; replay conflict; revoked/expired/missing-scope/wrong-installation
grants; tampered/future protected state; bounded safe audit; rate limit; timeout
and concurrency-slot behavior; and synthetic Codex fixture behavior.

Final verification on Windows:

- full Rust suite: 238 passed, 0 failed;
- focused local MCP suite: 18 passed, 0 failed;
- production TypeScript/Vite build: passed (1,623 modules);
- release-security suite: 8 passed;
- automation-runtime suite: 3 passed;
- synthetic Python automation suite: 49 passed;
- release helper preparation: passed for `x86_64-pc-windows-msvc`;
- release helper rejected the development-only synthetic command with the
  expected usage/exit code 2;
- Tauri validation package: passed with `innpilot.exe` as the main application
  and the MCP helper as an external sidecar;
- validation installer SHA-256:
  `89C4A5F8ADB91311482542C1FDB694791F56EE6AE26684F950622B13A4AF3A66`.

No hotel file, production configuration, Gmail material or production workflow
was read or executed, and nothing was deployed.

## Remaining risks and next phase

- MCP and client protocol generations still evolve; retain multi-version
  negotiation tests when Codex or `rmcp` changes.
- Commercial Windows signing and signed update compatibility remain release
  gates.
- Same-user malware is outside this grant model's protection goal.
- Existing same-path cleanup identity, template two-file journal and manual
  recovery journal items remain tracked; Phase D did not weaken or broaden them.

The smallest next milestone is a **bounded, manager-approved environment
discovery and durable proposal engine**: fixed discovery roots/capabilities,
preview receipts, explicit InnPilot UI approval and deterministic Phase C apply.
It must remain separate from automation execution and remote LifeDesk support.
