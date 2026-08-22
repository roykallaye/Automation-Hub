# Phase H-A — Work Areas and digitalization planning

**Status: in progress.** This record describes what is implemented today and
what is deliberately not yet built. It is updated as each increment lands.

## Why automation is downstream

InnPilot previously reasoned *inspect setup → prepare configuration →
configure automations*. That starts too late. Automating a process nobody has
described just makes a bad process faster.

The product order is:

```
select business area
  → understand people, systems, information, workflows
  → digitalize / organize what is not usable yet
  → improve: simplify, standardize, integrate
  → automate only the parts worth automating
  → operate and learn
```

Automation is a *result* of understanding, not the entry point. The two rules
that make this real rather than rhetorical are implemented as domain logic, so
neither React nor MCP can route around them.

## Implemented in this increment

`src-tauri/src/work_area.rs` — the domain and its rules, as pure functions with
no I/O. Persistence, application services, Tauri adapters, MCP tools and UI are
later increments.

### Provenance and truth are separate axes

`Provenance` records *where a fact came from* (`manager_answer`,
`structural_discovery`, `existing_configuration`, `system_status`,
`agent_inference`, `manual_entry`). `TruthStatus` records *how settled it is*
(`observed`, `stated`, `inferred`, `confirmed`, `disputed`, `unknown`).

They are deliberately not one field. Collapsing them is precisely how an agent
guess acquires the appearance of manager confirmation.

`MappedFact::normalized_status()` enforces Rule 3 structurally: a fact whose
provenance is `agent_inference` cannot be stored as `confirmed` or `observed`;
it normalizes back to `inferred`. No adapter can hand-construct a confirmed
inference.

### The automation gate (Rules 1 and 13)

`workflow_automation_gate(workflow, open_blocking_questions) -> Vec<WorkflowGap>`

An empty result means the workflow is understood well enough to yield an
automation candidate. A non-empty result is a hard stop. Gaps:

| Gap | Meaning |
| --- | --- |
| `NotCurrentState` | The workflow is a proposed future, not observed reality |
| `MissingPurpose` / `MissingTrigger` / `MissingInputs` | Basic framing absent |
| `MissingSteps` | No described steps |
| `MissingOutput` | Neither output nor destination |
| `MissingActorOrSystem` | Nothing carries the work, at workflow or step level |
| `ExceptionsNotAssessed` | Exceptions neither listed nor explicitly unknown |
| `CurrentStateUnconfirmed` | The manager has not confirmed this is how work happens |
| `BlockingQuestionsOpen` | Critical ambiguity unresolved |

Two choices worth calling out:

*Silence about exceptions is not the same as "there are none."* A workflow with
an empty `exceptions` list **and** an empty `unknowns` list fails the gate.
Recording "exceptions not yet reviewed with staff" in `unknowns` passes it. The
product is allowed to say *we do not understand this well enough yet*, and that
is better than inventing an opportunity.

*A proposed future workflow can never justify automating anything.* Only
observed current state is evidence.

### Map readiness (Rule 2)

`map_readiness(...) -> MapReadiness` reports explicit coverage per section plus
counts — `workflows_mapped`, `workflows_incomplete`, `open_blocking_questions`,
`unsettled_facts` — and a boolean `ready`.

There is deliberately no synthesized percentage. "4 mapped / 1 incomplete" is
auditable; "87% ready" is not, and would invite trusting a number nobody can
check.

`ready` requires: scope defined, **zero** open blocking questions, roles and
systems fully settled, at least one information source, at least one current
workflow, and no incomplete current workflow. An inferred-but-unconfirmed fact
leaves its section `Partial` and holds readiness back.

### Current and future stay separate (Rule 7)

`WorkflowPhase` is `Current` or `ProposedFuture`. They coexist as distinct
records; an improvement proposal never overwrites the observed current state.
Only `Current` workflows count toward `workflows_mapped`.

### Improvement taxonomy (Rules 4 and 5)

`ImprovementCategory` is `digitize | organize | standardize | simplify |
integrate | automate | keep_manual`. Automation is one option among seven, and
`keep_manual` makes "do not automate this" a first-class, expressible
recommendation.

`AutomationReadiness` and `ProductGap` separate *is this workflow ready* from
*what kind of change would this be* — process change, existing InnPilot
configuration, existing external system feature, integration, new InnPilot
capability, manual, or needs-more-information. This keeps "write a custom
Python script" from being the reflexive answer.

`MeasurementSource` (`measured | manager_estimate | agent_estimate`) is
mandatory on every `BaselineMetric`, so an agent estimate can never be rendered
as a measured saving.

### Planning artifacts carry no authority (Rule 8)

`ImprovementOpportunity::grants_execution_authority()` returns `false`
unconditionally and is asserted across every category. It exists as an explicit
predicate so the property is *tested* rather than merely intended.

Every opportunity records `source_map_revision`; `is_stale(current_revision)`
means a plan is never silently presented as current after the map moves on.

All planning records use `deny_unknown_fields`, so agent-supplied JSON cannot
smuggle extra keys into a stored record.

### Bounds

Every collection is capped (`MAX_ROLES`, `MAX_WORKFLOWS`, `MAX_QUESTIONS`,
`MAX_OPPORTUNITIES`, …), mirroring Phase E store conventions, so agent-prepared
content cannot grow a record without limit.

## Increment 2 — persistence (`c37ab85`)

One DPAPI-protected document per Work Area at `work-areas/<id>/state.dpapi`,
with a per-area lock. Not a company-wide file, and not a forest of per-entity
files: a Work Area is both the unit the manager works on and the unit every
invariant is scoped to, so making it the transactional unit means no operation
spans two documents and there is nothing to two-phase commit. Listing scans the
directory rather than keeping an index, which removes a second source of truth
that could disagree with the records it describes.

SQLite was considered and rejected. The runner ledger earns its database by
being append-heavy and queried across time; these are small, independently
locked documents read whole.

**Loading revalidates rather than trusting bytes.** Domain invariants live in
methods, but a stored document is just bytes. `validate_and_normalize()`
re-checks schema, installation binding, collection bounds, duplicate ids,
oversized text, evidence citations, and that every answer references a real
question and matches its response type. It also normalizes provenance in place,
so a fact written as confirmed but sourced from `agent_inference` loads back as
`inferred` — the Rule 3 guarantee survives a round trip through disk, which is
exactly where it would otherwise have been bypassed. A plan citing a map
revision that does not exist yet is treated as corrupt, not merely stale.

**Staleness is dependency-aware.** A manager answer or a scope change advances
the map revision and makes a derived plan stale. A rename does not.

**Idempotency is checked before CAS.** A retry carries the revision the caller
last saw, which is by then stale, so checking CAS first would reject the very
case idempotency exists to serve.

## Increment 2b — planning-preparation service (`work_area_planning.rs`)

The boundary the MCP adapter and the local UI both call. Neither touches
persistence directly; `WorkAreaService::mutate` is the single guarded
read-modify-write under the area lock.

### Authority comes from the caller, never the payload

`CallerAuthority` (`LocalManager` | `AssistantPlanning`) is a Rust argument
supplied by the adapter. It is never deserialized, so a model cannot set it.

More importantly, the agent-facing request types have **no provenance or truth
fields at all**. `ProposedFact` carries a label, a detail and evidence
references — there is nowhere to write `manager_answer` or `confirmed`. With
`deny_unknown_fields`, attempting it is a parse error rather than something a
check must remember to strip. The service then assigns
`Provenance::AgentInference` / `TruthStatus::Inferred` itself.

This is deliberately structural: rejecting a forged field relies on a check
existing; removing the field means the forgery cannot be expressed. There is a
test asserting the forged JSON fails to parse.

Manager confirmation is a separate operation requiring `LocalManager`. An
agent-prepared workflow is stored with `current_state_confirmed: false` — only
a manager can assert that a flow is how work actually happens.

### Gates are enforced, not advertised

`prepare_improvement_plan` refuses outright while `record_readiness()` is not
ready, returning structured blocker keys. An `Automate` opportunity must name a
workflow, that workflow must exist, and it must pass
`workflow_automation_gate()` — otherwise the whole plan is refused rather than
accepted with a warning. A plan whose `source_map_revision` differs from the
stored map is rejected as stale, so the assistant cannot reason over an old map.

`keep_manual` is accepted with no automation anywhere in the plan, and nothing
forces a mapped workflow to produce a candidate.

### Evidence boundary

A Work Area carries `linked_evidence`: the opaque Phase E references the
manager associated with it. Planning may cite only those, enforced both at
submission and again on load. This is what stops one area from reading
another's discovery evidence.

### Capability matching is conservative

`INNPILOT_CAPABILITIES` mirrors the real workflow keys in `preflight.rs`. An
opportunity naming a key outside that list is rejected. A key inside it
classifies as `PossibleExistingCapability` — deliberately never "supported",
because catalog presence is not proof of workflow compatibility. Nothing is
configured or applied.

### Idempotency binding

Receipts key on (installation, work area, operation, request id) — installation
and work area implicitly, since a receipt only lives inside that area's
installation-bound record. `OperationKind` was added to the receipt in schema 2
because otherwise one request id reused across two operations would look like a
retry of whichever ran first. The digest also binds operation and work area.
Tested: replay returns the stored outcome, reuse across operations conflicts,
reuse with different content conflicts, and the same id in a different area does
not collide.

Schema moved 1 → 2 for the receipt operation field and `linked_evidence`. Older
records fail closed rather than being reinterpreted.

## Increment 3 — MCP planning adapter

The surface grew from 10 tools to 17: four Work Area reads and three planning
writes. Existing tools are unchanged in name and semantics, asserted by an
enumeration test.

| Tool | Scope |
| --- | --- |
| `innpilot_list_work_areas` | `work_area.read` |
| `innpilot_get_work_area_context` | `work_area.read` |
| `innpilot_get_operational_map` | `work_area.read` |
| `innpilot_get_improvement_plan` | `work_area.read` |
| `innpilot_prepare_work_area_questions` | `work_area.propose` |
| `innpilot_prepare_operational_map` | `work_area.propose` |
| `innpilot_prepare_improvement_plan` | `work_area.propose` |

There is deliberately no tool to answer a question, confirm a fact, approve a
map or plan, configure, install or execute. A test asserts the whole surface
contains no name matching `answer`, `confirm`, `approve`, `apply`, `install`,
`execute`, `run_`, `configure`, `restore`, `delete`, `write`, `shell` or `sql`.
The trust boundary is the absence of the capability, not an instruction.

### Grant migration — now enforced by test

`a_pre_h_a_grant_is_denied_every_work_area_tool` constructs a grant carrying
only the original ten scopes, saves it, reloads it, and asserts the stored
vector is still ten, that `authorize` returns `capability_denied` for both new
scopes, and that earlier capabilities still work — so it is a scope boundary
rather than a broken grant. `capabilities()` already reports `grant.scopes`,
the stored vector, so an old connection is never described to the model or UI
as Work Area capable. Gaining the scopes requires the manager to reconnect.

### Contracts are shared with the planning service, not mirrored

The agent-facing planning types double as the MCP tool schemas via `JsonSchema`
derives, rather than being copied into `local_mcp.rs`. A mirrored contract can
drift, and drift would silently loosen the MCP surface relative to the
aggregate it feeds. Because those types carry no provenance or truth fields,
the MCP schema cannot express manager authority either — tested against forged
`provenance`/`truthStatus` and `currentStateConfirmed` payloads, and against
injected `script`, `command`, `path` and `applyConfiguration` fields.

### Views are projections, not the aggregate

The persisted record also holds idempotency receipts, installation binding and
protected bytes; none of it is exposed. What the assistant receives is what it
needs to reason: facts with provenance and normalized truth status, workflows
with their current `automation_gaps`, readiness counts, questions with any
manager answer, and opaque evidence references. `fact_views` calls
`normalized_status()`, so an inferred fact cannot read back as confirmed even
if the stored bytes said otherwise.

### Authority at the adapter

Every planning tool passes `CallerAuthority::AssistantPlanning` as a Rust
argument. No request field can influence it. `validate_work_area_id` rejects
anything that is not opaque, bounded and alphanumeric-with-hyphens before the
id reaches the filesystem-backed store, so a crafted id cannot act as a path
fragment.

### Not yet done in this increment

A real Codex end-to-end session against synthetic fixtures, and the reconnect
prompt in the Assistant UI. Both belong to Increments 4–5.

## Not built yet

Persistence and revisions; application services and Tauri adapters; the MCP
planning tools and their narrow scopes; manager answer submission; the Work
Areas UI; synthetic fixtures and the end-to-end walkthrough. Exit gates
covering those remain open.

## Privacy stance

The model describes *classes* of information — an information source of kind
paper, a document type "signed contract". It never holds document contents.
Document ingestion (PDF/OCR/spreadsheet/email/embeddings) is explicitly out of
scope for this milestone.

Permission levels, kept distinct so Level 1 never implies Level 2:

1. **Structural** — folder names, structure, metadata, manager-approved. Today.
2. **Selected content** — specific approved documents or categories. Future.
3. **Connected systems** — PMS/email/ERP APIs. Future.

Physical and tacit information is modeled explicitly (`StepMedium::Physical`,
`StepMedium::Tacit`) rather than ignored, because "this only exists on paper"
and "only one person knows this" are among the most valuable digitalization
findings.
