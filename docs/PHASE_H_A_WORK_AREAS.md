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
