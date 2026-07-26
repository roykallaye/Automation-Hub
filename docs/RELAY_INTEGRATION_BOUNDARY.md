# Future Relay and company-knowledge boundary

Relay is a later milestone. The present LifeDesk?InnPilot product does not let
agents read company files, answer other agents, change automations, or publish
knowledge autonomously.

This boundary preserves a safe integration seam without expanding today?s
attack surface.

## Intended outcome

Humans and their authorized agents may eventually exchange questions,
responses, workflow-change requests, and approved knowledge. The system should
reduce meetings and errors while keeping the responsible human in control.

Relay is a communication and approval layer, not a back door into hotel PCs.

## Non-negotiable controls

- Every hotel is a separate tenant; database and storage policies must enforce
  isolation rather than relying on UI filtering.
- Every human, service, device, and agent has a distinct revocable identity.
- Agents receive the minimum scope and time needed for one task.
- An outbound agent answer requires approval from the human who owns that agent
  unless a narrowly defined policy was approved in advance.
- Reading a source never implies permission to quote, publish, train on, or
  retain it.
- Raw guest, employee, contract, invoice, booking, credential, token, and local
  path data are denied by default.
- Automation code changes become reviewed change requests. Agents cannot deploy
  or enable execute mode directly.
- Prompts, approvals, tool calls, source versions, responses, and revocations
  are append-only audited with bounded retention.
- A kill switch can revoke an agent or connector without disabling normal hotel
  work.

## Safe product seam

LifeDesk may later host tenant-scoped Relay conversations, assignments,
approvals, and safe status events. InnPilot may expose only typed capabilities
and bounded operational metadata through its existing signed device channel.

The default InnPilot event may contain:

- tenant, device, workflow, and request identifiers;
- allowlisted status and error codes;
- counters and timestamps;
- source version or checksum identifiers;
- the approval policy that was applied.

It must not contain document bodies, extracted OCR text, email bodies, guest or
employee identifiers, credentials, arbitrary exception text, or local paths.

When source content is genuinely required, use a separate explicit retrieval
request with purpose, scope, expiry, redaction, human approval, and an audited
result. Keeping source content local remains the preferred design.

## Knowledge ingestion stages

1. A human registers a source and its owner, purpose, classification, retention,
   and allowed audiences.
2. The source enters quarantine; malware, format, tenant, and sensitivity checks
   run before parsing.
3. Deterministic redaction and access-control labels are attached before any
   indexing.
4. Each derived item keeps provenance, source checksum, version, and expiry.
5. Retrieval enforces tenant, user/agent, purpose, and document-level access at
   query time.
6. Answers cite the approved source versions and distinguish facts from model
   inference.
7. Deletion or revocation propagates to indexes, caches, and derived material.

No ?upload everything and let the model decide? path is acceptable.

## Workflow-change loop

1. A staff member reports a changed workflow.
2. Relay creates a structured change request with owner and operational impact.
3. An agent proposes analysis, tests, migration, rollback, and documentation.
4. An authorized manager and engineer approve the proposal.
5. The change runs against synthetic fixtures and safe mode.
6. A signed release is deployed gradually.
7. Monitoring and human acceptance close the request; failure triggers rollback.

## Before implementation

- threat-model cross-tenant access, prompt injection, poisoned knowledge,
  impersonation, excessive agent scope, and accidental disclosure;
- define the exact LifeDesk schema and row-level policies;
- define agent authentication, key rotation, revocation, and approval expiry;
- decide where content is processed and whether any external model provider is
  permitted;
- define retention and deletion for messages, audit evidence, embeddings, and
  backups;
- prove the controls with adversarial multi-tenant tests.

Relay remains disabled until this design is reviewed as its own security
milestone.
