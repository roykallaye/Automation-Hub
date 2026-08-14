# ADR 0001: Agent-assisted operations boundaries

- Status: Accepted for the Phase A foundation
- Date: 2026-08-13
- Scope: InnPilot local setup and operations, LifeDesk shared services, and future agent adapters

## Context

InnPilot is becoming the local transition and operations layer that can help a
hotel understand and safely adapt its existing folders, scripts, runtimes, and
workflows. An AI assistant can make discovery and setup easier, but it cannot
become the authority that changes a hotel computer.

The product already has two different integration surfaces that must not be
confused:

- InnPilot is the local execution and configuration boundary on the hotel PC.
- LifeDesk has an existing remote OAuth MCP surface for bounded, cloud-backed
  hotel operations. Some existing tools can write shared cloud data.

The local MCP adapter, support relay, company-knowledge layer, and native
InnPilot assistant are later milestones. Phase A establishes the boundaries
they must follow without implementing them.

## Decision

### 1. Authority and trust boundary

The invariant is:

> The local agent discovers and prepares. InnPilot validates and applies. The
> manager approves. LifeDesk coordinates shared/cloud information and support.

Responsibilities are deliberately separated:

| Actor | May | Must not |
| --- | --- | --- |
| Agent | Inspect explicitly approved information, reason, ask questions, prepare proposals, request deterministic checks | Authorize itself, write configuration directly, run arbitrary commands, or bypass InnPilot controls |
| InnPilot/domain services | Validate inputs, enforce permissions and scope, create recovery points, apply atomically, run approved automations, and audit | Delegate authorization, privacy, or validation decisions to model output |
| Manager/authorized human | Approve discovery scope and material changes, review unresolved ambiguity, revoke access | Be treated as having approved merely because an agent requested an action |
| LifeDesk | Coordinate allowlisted cloud data, sanitized status, support, and approvals | Become an inbound remote-control tunnel to a hotel PC |

Agent-led setup remains proposal-only until configuration preservation is
proven. A model response is untrusted input, not an authorization artifact.

### 2. Local and cloud data boundary

Local by default:

- absolute paths and sensitive filenames;
- document, email, invoice, booking, and extracted OCR content;
- scripts, raw logs, tracebacks, and detailed discovery evidence;
- Gmail tokens, credentials, private keys, and other secrets;
- configuration proposals containing local operational details.

LifeDesk may receive only explicitly allowlisted and sanitized information,
such as tenant, installation, workflow, request and version identifiers;
structured status/error codes; counters and timestamps; approval references;
and a human-approved diagnostic result.

Sharing one item does not grant access to its source, siblings, containing
folder, later versions, or future uses. Redaction and allowlisting are
deterministic domain responsibilities, never prompt instructions alone.

### 3. MCP is an adapter

MCP handlers contain transport mapping and typed input/output schemas only.
Core setup, discovery, configuration, health, recovery, audit, and automation
rules live in narrow typed domain services.

The InnPilot UI, a future native assistant, local MCP, and other approved
clients call the same domain operations. No adapter receives a more privileged
code path than the UI. Domain contracts do not depend on Codex, MCP, STDIO,
OAuth, prompt formats, or a specific model vendor.

### 4. No general remote control

Neither LifeDesk nor a remote agent may request arbitrary shell commands,
filesystem paths, scripts, SQL, URLs, or process execution on a hotel PC.

Any later support diagnostic is a versioned, typed capability with bounded
input, explicit local authorization, deterministic output redaction, expiry,
and audit. Local execution continues through InnPilot's existing signed,
allowlisted, approval-aware automation boundary. LifeDesk remains outbound-only
from the hotel installation.

### 5. Future native assistant compatibility

Codex and local MCP are pilot and development mechanisms, not the commercial
product boundary. A future `Set up InnPilot with AI` experience must reuse the
same domain services and proposal protocol without requiring a manager to
understand MCP, STDIO, OAuth, configuration files, or developer commands.

Manual setup remains a supported recovery and accessibility path.

### 6. Existing LifeDesk remote MCP

The LifeDesk remote MCP is a pre-existing compatibility surface, not part of
the Phase A implementation. During Phase A:

- no new write/destructive tools or broader capabilities are added;
- no bridge from a remote tool to arbitrary local InnPilot execution is added;
- current behavior is not silently removed or changed;
- existing write scope, consent, tenant isolation, audit, and idempotency are
  reviewed as a separate security milestone before expansion.

"Frozen" means no capability expansion during this phase; it does not disable
existing customer-visible behavior.

## Foundation gates

1. Phase A: reopening or saving setup must preserve unrelated known, custom,
   and unknown configuration, with regression evidence.
2. Phase B: durable onboarding state must survive restart and migrate existing healthy
   installations without resetting them.
3. Phase C: UI operations must use the same typed, validated domain services intended
   for future adapters.
4. Phase D: agent-originated writes remain disabled until the preceding gates pass and
   the proposal/approval/recovery design has its own review.

## Consequences

- More work is required in the backend/domain boundary before building agent
  UX, but UI and future adapters cannot diverge on safety rules.
- Local details stay available for accurate diagnosis without becoming cloud
  data by default.
- MCP or a model provider can be replaced without rewriting core operations.
- Some useful actions require an explicit proposal and approval round trip.
- Existing remote MCP capabilities require reconciliation with the stricter
  long-term approval model before they are expanded.

## Rejected alternatives

- Letting the model directly edit configuration or execute scripts.
- Putting validation, authorization, or business logic only in MCP handlers.
- Giving agents arbitrary filesystem or shell access for convenience.
- Sending raw local evidence to LifeDesk and relying on the model to redact it.
- Coupling the commercial onboarding flow to Codex or any single MCP client.
- Removing the existing LifeDesk MCP abruptly to make documentation match a
  future-state plan.

## Verification

Changes governed by this ADR require tests appropriate to their boundary,
including configuration-preservation and stale-revision tests, recovery tests,
approved-root traversal and Windows junction/reparse-point tests, expired and
revoked grant tests, cross-tenant/cross-role authorization tests, secret-leak
checks, and proof that production automations do not run during onboarding.

## Related documents

- [Future Relay and company-knowledge boundary](../RELAY_INTEGRATION_BOUNDARY.md)
- [LifeDesk connection](../LIFEDESK_CONNECTION.md)
- [Operations and recovery](../OPERATIONS_AND_RECOVERY.md)
