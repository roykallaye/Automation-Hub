/*
  Phase H-A — Work Area domain.

  The product rule this module exists to enforce: automation is downstream of
  understanding. A manager selects one part of the business, InnPilot maps how
  it works today, identifies what should be digitized/organized/simplified, and
  only then names automation candidates.

  That ordering is implemented here as deterministic domain logic, not as UI
  copy, so no adapter — React or MCP — can shortcut it:

    * `MapReadiness` decides whether a Work Area is understood well enough,
      from explicit section coverage and unresolved blocking questions.
    * `workflow_automation_gate` decides, per workflow, whether an automation
      candidate may exist at all.

  Both are pure functions over the stored model. Persistence, adapters and the
  MCP surface are layered on top in later commits; nothing here performs I/O,
  so the rules stay testable and cheap to audit.

  Scope note: this module models *classes* of information (an "information
  source" of kind Paper, a document type "signed contract"). It never holds
  document contents. See PHASE_H_A record for the permission levels.
*/

// Phase H-A lands in bounded commits: this module defines the domain and its
// rules first, and the services, Tauri adapters, MCP tools and UI that consume
// them follow. Until those arrive, parts of this surface have no caller.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/* ------------------------------------------------------------------ bounds */

/// Bounds mirror the Phase E store conventions: every collection is capped so
/// a planning record cannot grow without limit from agent-prepared content.
pub(crate) const MAX_NAME_CHARS: usize = 80;
pub(crate) const MAX_DESCRIPTION_CHARS: usize = 600;
pub(crate) const MAX_TEXT_CHARS: usize = 400;
pub(crate) const MAX_ROLES: usize = 32;
pub(crate) const MAX_SYSTEMS: usize = 32;
pub(crate) const MAX_INFORMATION_SOURCES: usize = 48;
pub(crate) const MAX_DOCUMENT_TYPES: usize = 48;
pub(crate) const MAX_WORKFLOWS: usize = 24;
pub(crate) const MAX_WORKFLOW_STEPS: usize = 40;
pub(crate) const MAX_QUESTIONS: usize = 40;
pub(crate) const MAX_OPPORTUNITIES: usize = 48;
pub(crate) const MAX_PAIN_POINTS: usize = 32;

/* -------------------------------------------------------------- provenance */

/// Where a mapped fact came from. Kept separate from `TruthStatus` because
/// "who said it" and "how sure are we" are different questions — conflating
/// them is how an agent guess becomes an apparent manager confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Provenance {
    /// The manager answered a question in InnPilot.
    ManagerAnswer,
    /// Derived from an approved Phase E structural snapshot.
    StructuralDiscovery,
    /// Read from InnPilot's own stored configuration.
    ExistingConfiguration,
    /// Derived from live preflight/system status.
    SystemStatus,
    /// The assistant inferred it. Never authoritative on its own.
    AgentInference,
    /// Typed directly by the manager outside the question flow.
    ManualEntry,
}

impl Provenance {
    /// Whether this source can, by itself, make a fact confirmed.
    ///
    /// Agent inference deliberately cannot: Rule 3 says inference is never
    /// equivalent to manager confirmation.
    pub(crate) fn is_authoritative(self) -> bool {
        matches!(
            self,
            Provenance::ManagerAnswer
                | Provenance::ManualEntry
                | Provenance::StructuralDiscovery
                | Provenance::ExistingConfiguration
                | Provenance::SystemStatus
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TruthStatus {
    /// Seen directly by InnPilot (structural discovery, configuration, status).
    Observed,
    /// Asserted by the manager.
    Stated,
    /// Produced by the assistant and not yet checked by anyone.
    Inferred,
    /// Explicitly confirmed by the manager.
    Confirmed,
    /// The manager contradicted it.
    Disputed,
    /// Recorded as an acknowledged gap.
    Unknown,
}

impl TruthStatus {
    /// Whether a fact counts as settled for readiness purposes.
    pub(crate) fn is_settled(self) -> bool {
        matches!(
            self,
            TruthStatus::Observed | TruthStatus::Stated | TruthStatus::Confirmed
        )
    }
}

/// A single mapped assertion plus how it came to be believed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MappedFact {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) detail: Option<String>,
    pub(crate) provenance: Provenance,
    pub(crate) status: TruthStatus,
    /// Opaque Phase E evidence references. Never a filesystem path.
    #[serde(default)]
    pub(crate) evidence_refs: Vec<String>,
}

impl MappedFact {
    /// An agent-inferred fact may never be stored as already confirmed.
    /// Enforced here so no adapter can construct one by hand.
    pub(crate) fn normalized_status(&self) -> TruthStatus {
        if self.provenance == Provenance::AgentInference
            && matches!(self.status, TruthStatus::Confirmed | TruthStatus::Observed)
        {
            return TruthStatus::Inferred;
        }
        self.status
    }

    pub(crate) fn is_settled(&self) -> bool {
        self.normalized_status().is_settled()
    }
}

/* ---------------------------------------------------------------- lifecycle */

/// Semantic lifecycle for a Work Area. Deliberately not a UI page index: the
/// backend decides what stage the area is in from stored facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkAreaState {
    NotStarted,
    ScopeDefined,
    Mapping,
    NeedsInput,
    MapReady,
    ImprovementPlanning,
    ImprovementReady,
    /// The current-state understanding is sufficient to *identify* candidates.
    /// It does not mean automations exist, are configured, or may run.
    AutomationOpportunitiesReady,
    /// Evidence or a critical answer changed; downstream artifacts need review.
    MapNeedsReview,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkAreaTemplate {
    Reception,
    Administration,
    Sales,
    Purchasing,
    Housekeeping,
    Maintenance,
    Management,
    FoodAndBeverage,
    Marketing,
    /// Always available: the schema must not assume hotels.
    Custom,
}

/* ----------------------------------------------------------------- questions */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QuestionCategory {
    Scope,
    Roles,
    Systems,
    InformationSources,
    Documents,
    PhysicalInformation,
    Workflow,
    Rules,
    Dependencies,
    PainPoints,
    Baseline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ResponseType {
    YesNo,
    SingleChoice { choices: Vec<String> },
    MultipleChoice { choices: Vec<String> },
    ShortText,
    Number,
    Duration,
    Frequency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QuestionStatus {
    Open,
    Answered,
    Skipped,
    Superseded,
}

/// A structured question. The assistant may *prepare* these; only a local
/// manager action may answer one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Question {
    pub(crate) question_id: String,
    pub(crate) category: QuestionCategory,
    pub(crate) prompt: String,
    pub(crate) why_it_matters: Option<String>,
    pub(crate) response_type: ResponseType,
    pub(crate) required: bool,
    /// A blocking question holds back map readiness (Rule 2).
    pub(crate) blocking: bool,
    pub(crate) status: QuestionStatus,
    pub(crate) source: Provenance,
    pub(crate) revision: u64,
}

impl Question {
    pub(crate) fn is_unresolved_blocker(&self) -> bool {
        self.blocking && matches!(self.status, QuestionStatus::Open)
    }
}

/* ----------------------------------------------------------------- workflow */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StepMedium {
    Digital,
    /// Paper, printing, physical signature, physical handoff.
    Physical,
    /// Knowledge held only by a person.
    Tacit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkflowStep {
    pub(crate) id: String,
    pub(crate) description: String,
    pub(crate) actor_role_id: Option<String>,
    pub(crate) system_id: Option<String>,
    pub(crate) medium: StepMedium,
    pub(crate) is_decision: bool,
    pub(crate) provenance: Provenance,
}

/// Whether a workflow describes today or a proposed tomorrow. Rule 7: the two
/// never overwrite each other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkflowPhase {
    Current,
    ProposedFuture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Workflow {
    pub(crate) id: String,
    pub(crate) phase: WorkflowPhase,
    pub(crate) name: String,
    pub(crate) purpose: Option<String>,
    pub(crate) trigger: Option<String>,
    #[serde(default)]
    pub(crate) inputs: Vec<String>,
    #[serde(default)]
    pub(crate) role_ids: Vec<String>,
    #[serde(default)]
    pub(crate) system_ids: Vec<String>,
    #[serde(default)]
    pub(crate) steps: Vec<WorkflowStep>,
    pub(crate) output: Option<String>,
    pub(crate) destination: Option<String>,
    pub(crate) frequency: Option<String>,
    #[serde(default)]
    pub(crate) exceptions: Vec<String>,
    #[serde(default)]
    pub(crate) pain_point_ids: Vec<String>,
    /// Acknowledged gaps. An explicitly recorded unknown is information;
    /// silence is not.
    #[serde(default)]
    pub(crate) unknowns: Vec<String>,
    /// True when the manager has confirmed this reflects how work happens now.
    pub(crate) current_state_confirmed: bool,
    #[serde(default)]
    pub(crate) evidence_refs: Vec<String>,
    pub(crate) provenance: Provenance,
}

/// Why a workflow is not yet eligible to produce an automation candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkflowGap {
    MissingPurpose,
    MissingTrigger,
    MissingInputs,
    MissingSteps,
    MissingOutput,
    MissingActorOrSystem,
    ExceptionsNotAssessed,
    CurrentStateUnconfirmed,
    BlockingQuestionsOpen,
    NotCurrentState,
}

/// Rule 1 / Rule 13, as backend logic.
///
/// Returns the gaps preventing this workflow from yielding an automation
/// candidate. An empty vector means the gate is open. Callers must treat a
/// non-empty result as a hard stop, not a warning.
pub(crate) fn workflow_automation_gate(
    workflow: &Workflow,
    open_blocking_questions: usize,
) -> Vec<WorkflowGap> {
    let mut gaps = Vec::new();

    // Only the current state can justify automating anything. A proposed
    // future workflow is an aspiration, not evidence.
    if workflow.phase != WorkflowPhase::Current {
        gaps.push(WorkflowGap::NotCurrentState);
    }
    if blank(&workflow.purpose) {
        gaps.push(WorkflowGap::MissingPurpose);
    }
    if blank(&workflow.trigger) {
        gaps.push(WorkflowGap::MissingTrigger);
    }
    if workflow.inputs.is_empty() {
        gaps.push(WorkflowGap::MissingInputs);
    }
    if workflow.steps.is_empty() {
        gaps.push(WorkflowGap::MissingSteps);
    }
    if blank(&workflow.output) && blank(&workflow.destination) {
        gaps.push(WorkflowGap::MissingOutput);
    }
    // Someone or something must carry the work, at workflow or step level.
    let has_actor = !workflow.role_ids.is_empty()
        || !workflow.system_ids.is_empty()
        || workflow
            .steps
            .iter()
            .any(|step| step.actor_role_id.is_some() || step.system_id.is_some());
    if !has_actor {
        gaps.push(WorkflowGap::MissingActorOrSystem);
    }
    // Exceptions must be either listed or explicitly recorded as unknown.
    // Saying nothing about them is not the same as saying there are none.
    if workflow.exceptions.is_empty() && workflow.unknowns.is_empty() {
        gaps.push(WorkflowGap::ExceptionsNotAssessed);
    }
    if !workflow.current_state_confirmed {
        gaps.push(WorkflowGap::CurrentStateUnconfirmed);
    }
    if open_blocking_questions > 0 {
        gaps.push(WorkflowGap::BlockingQuestionsOpen);
    }
    gaps
}

pub(crate) fn workflow_supports_automation_candidate(
    workflow: &Workflow,
    open_blocking_questions: usize,
) -> bool {
    workflow_automation_gate(workflow, open_blocking_questions).is_empty()
}

/* --------------------------------------------------------------- readiness */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SectionCoverage {
    Empty,
    Partial,
    Complete,
}

/// Deterministic coverage per map section. Deliberately explicit counts rather
/// than a synthesized percentage: "4 mapped / 1 incomplete" is auditable,
/// "87% ready" is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MapReadiness {
    pub(crate) scope: SectionCoverage,
    pub(crate) roles: SectionCoverage,
    pub(crate) systems: SectionCoverage,
    pub(crate) information_sources: SectionCoverage,
    pub(crate) workflows_mapped: usize,
    pub(crate) workflows_incomplete: usize,
    pub(crate) open_blocking_questions: usize,
    pub(crate) unsettled_facts: usize,
    pub(crate) ready: bool,
}

fn coverage(count: usize, settled: usize) -> SectionCoverage {
    if count == 0 {
        SectionCoverage::Empty
    } else if settled < count {
        SectionCoverage::Partial
    } else {
        SectionCoverage::Complete
    }
}

fn blank(value: &Option<String>) -> bool {
    value
        .as_ref()
        .map(|text| text.trim().is_empty())
        .unwrap_or(true)
}

fn settled_count(facts: &[MappedFact]) -> usize {
    facts.iter().filter(|fact| fact.is_settled()).count()
}

/// Rule 2: a Work Area may not become map-ready while blocking questions
/// remain open, regardless of how much else has been filled in.
pub(crate) fn map_readiness(
    scope_defined: bool,
    roles: &[MappedFact],
    systems: &[MappedFact],
    information_sources: &[MappedFact],
    workflows: &[Workflow],
    questions: &[Question],
) -> MapReadiness {
    let open_blocking_questions = questions
        .iter()
        .filter(|question| question.is_unresolved_blocker())
        .count();

    let current: Vec<&Workflow> = workflows
        .iter()
        .filter(|workflow| workflow.phase == WorkflowPhase::Current)
        .collect();
    // Blocking questions are counted separately, so the per-workflow gate is
    // evaluated with zero of them: this asks only whether the workflow itself
    // is described well enough.
    let workflows_incomplete = current
        .iter()
        .filter(|workflow| !workflow_automation_gate(workflow, 0).is_empty())
        .count();

    let scope = if scope_defined {
        SectionCoverage::Complete
    } else {
        SectionCoverage::Empty
    };
    let roles_coverage = coverage(roles.len(), settled_count(roles));
    let systems_coverage = coverage(systems.len(), settled_count(systems));
    let sources_coverage = coverage(
        information_sources.len(),
        settled_count(information_sources),
    );

    let unsettled_facts = roles.len() + systems.len() + information_sources.len()
        - settled_count(roles)
        - settled_count(systems)
        - settled_count(information_sources);

    let ready = scope_defined
        && open_blocking_questions == 0
        && roles_coverage == SectionCoverage::Complete
        && systems_coverage == SectionCoverage::Complete
        && sources_coverage != SectionCoverage::Empty
        && !current.is_empty()
        && workflows_incomplete == 0;

    MapReadiness {
        scope,
        roles: roles_coverage,
        systems: systems_coverage,
        information_sources: sources_coverage,
        workflows_mapped: current.len(),
        workflows_incomplete,
        open_blocking_questions,
        unsettled_facts,
        ready,
    }
}

/* ------------------------------------------------------- improvement plan */

/// Rule 4: automation is one category among several. Rule 5: keeping work
/// manual is a legitimate, expressible recommendation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ImprovementCategory {
    Digitize,
    Organize,
    Standardize,
    Simplify,
    Integrate,
    Automate,
    KeepManual,
}

/// How ready a workflow is for automation, and if not, what blocks it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutomationReadiness {
    NotReady,
    NeedsDigitization,
    NeedsStandardization,
    NeedsIntegration,
    Candidate,
    FutureProductCapability,
    ExistingInnpilotCapability,
    NotRecommended,
}

/// Whether acting on an opportunity is a process change, a configuration, or
/// something InnPilot would have to grow. Keeps "write a custom script" from
/// being the reflexive answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProductGap {
    ProcessChangeOnly,
    ExistingInnpilotConfiguration,
    ExistingExternalSystemFeature,
    IntegrationOpportunity,
    NewInnpilotCapability,
    ManualRecommended,
    NeedsMoreInformation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Magnitude {
    Low,
    Medium,
    High,
}

/// Where a number came from. An agent estimate must never be rendered as a
/// measured saving.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MeasurementSource {
    Measured,
    ManagerEstimate,
    AgentEstimate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BaselineMetric {
    pub(crate) label: String,
    pub(crate) value: f64,
    pub(crate) unit: String,
    pub(crate) source: MeasurementSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImprovementOpportunity {
    pub(crate) id: String,
    pub(crate) work_area_id: String,
    pub(crate) workflow_id: Option<String>,
    pub(crate) category: ImprovementCategory,
    pub(crate) title: String,
    pub(crate) current_problem: String,
    pub(crate) recommended_change: String,
    pub(crate) why: Option<String>,
    pub(crate) expected_benefit: Option<Magnitude>,
    pub(crate) effort: Option<Magnitude>,
    pub(crate) risk: Option<Magnitude>,
    pub(crate) automation_readiness: AutomationReadiness,
    pub(crate) product_gap: ProductGap,
    /// A matching existing InnPilot workflow key, when one plausibly applies.
    /// Identification only: it is never configuration or approval.
    pub(crate) existing_capability_key: Option<String>,
    #[serde(default)]
    pub(crate) prerequisites: Vec<String>,
    #[serde(default)]
    pub(crate) evidence_refs: Vec<String>,
    pub(crate) provenance: Provenance,
    /// The map revision this recommendation was derived from. If the map moves
    /// on, the opportunity is stale rather than silently current.
    pub(crate) source_map_revision: u64,
}

impl ImprovementOpportunity {
    /// Rule 8: a planning artifact never carries execution authority. Kept as
    /// an explicit predicate so the property is testable rather than implied.
    pub(crate) fn grants_execution_authority(&self) -> bool {
        false
    }

    pub(crate) fn is_stale(&self, current_map_revision: u64) -> bool {
        self.source_map_revision != current_map_revision
    }
}

/* ------------------------------------------------------------- aggregates */

pub(crate) const WORK_AREA_SCHEMA: u32 = 2;
pub(crate) const MAX_WORK_AREAS: usize = 16;
pub(crate) const MAX_ANSWER_CHARS: usize = 600;
pub(crate) const MAX_RECEIPTS: usize = 32;
pub(crate) const MAX_PHYSICAL_ITEMS: usize = 32;
pub(crate) const MAX_DEPENDENCIES: usize = 32;

/// The Work Area root record. Identity and lifecycle only; mapped content lives
/// in the assessment, so renaming an area never disturbs its map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkArea {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) template: WorkAreaTemplate,
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) scope_included: Vec<String>,
    #[serde(default)]
    pub(crate) scope_excluded: Vec<String>,
    pub(crate) state: WorkAreaState,
    /// Opaque Phase E evidence references the manager has associated with this
    /// area. Planning may cite only these, which is what stops one area from
    /// reading another's discovery evidence.
    #[serde(default)]
    pub(crate) linked_evidence: Vec<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) archived_at: Option<String>,
}

impl WorkArea {
    pub(crate) fn scope_defined(&self) -> bool {
        !self.scope_included.is_empty()
    }
}

/// A typed manager answer. The variant must match the question response type;
/// `AnswerValue::matches` is what the service checks before persisting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AnswerValue {
    YesNo { value: bool },
    Choice { value: String },
    Choices { values: Vec<String> },
    Text { value: String },
    Number { value: f64 },
    Duration { value: String },
    Frequency { value: String },
}

impl AnswerValue {
    pub(crate) fn matches(&self, response_type: &ResponseType) -> bool {
        match (self, response_type) {
            (AnswerValue::YesNo { .. }, ResponseType::YesNo) => true,
            (AnswerValue::Choice { value }, ResponseType::SingleChoice { choices }) => {
                choices.contains(value)
            }
            (AnswerValue::Choices { values }, ResponseType::MultipleChoice { choices }) => {
                !values.is_empty() && values.iter().all(|value| choices.contains(value))
            }
            (AnswerValue::Text { .. }, ResponseType::ShortText) => true,
            (AnswerValue::Number { .. }, ResponseType::Number) => true,
            (AnswerValue::Duration { .. }, ResponseType::Duration) => true,
            (AnswerValue::Frequency { .. }, ResponseType::Frequency) => true,
            _ => false,
        }
    }

    pub(crate) fn within_bounds(&self) -> bool {
        let text_ok = |value: &String| value.chars().count() <= MAX_ANSWER_CHARS;
        match self {
            AnswerValue::YesNo { .. } => true,
            AnswerValue::Number { value } => value.is_finite(),
            AnswerValue::Choice { value }
            | AnswerValue::Text { value }
            | AnswerValue::Duration { value }
            | AnswerValue::Frequency { value } => text_ok(value),
            AnswerValue::Choices { values } => values.len() <= 16 && values.iter().all(text_ok),
        }
    }
}

/// A recorded manager answer. This type only ever exists as the result of a
/// local manager action, which is what makes its provenance trustworthy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ManagerAnswer {
    pub(crate) question_id: String,
    pub(crate) value: AnswerValue,
    pub(crate) answered_at: String,
    /// Work Area revision at which this answer was accepted.
    pub(crate) at_revision: u64,
}

/// The mapped current-state understanding of a Work Area.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OperationalMap {
    /// Bumped whenever mapped content changes. Plans bind to this value.
    pub(crate) revision: u64,
    #[serde(default)]
    pub(crate) roles: Vec<MappedFact>,
    #[serde(default)]
    pub(crate) systems: Vec<MappedFact>,
    #[serde(default)]
    pub(crate) information_sources: Vec<MappedFact>,
    #[serde(default)]
    pub(crate) document_types: Vec<MappedFact>,
    /// Paper, printed forms, handwritten notes, knowledge held by one person.
    #[serde(default)]
    pub(crate) physical_information: Vec<MappedFact>,
    #[serde(default)]
    pub(crate) dependencies: Vec<MappedFact>,
    #[serde(default)]
    pub(crate) pain_points: Vec<MappedFact>,
    #[serde(default)]
    pub(crate) workflows: Vec<Workflow>,
    #[serde(default)]
    pub(crate) unknowns: Vec<String>,
    pub(crate) prepared_at: Option<String>,
    /// True only after an explicit manager confirmation operation.
    pub(crate) confirmed: bool,
}

/// A prepared improvement plan, bound to the exact map revision it came from so
/// it becomes visibly stale rather than silently current.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImprovementPlan {
    pub(crate) revision: u64,
    pub(crate) source_map_revision: u64,
    #[serde(default)]
    pub(crate) opportunities: Vec<ImprovementOpportunity>,
    pub(crate) prepared_at: String,
}

impl ImprovementPlan {
    pub(crate) fn is_stale(&self, current_map_revision: u64) -> bool {
        self.source_map_revision != current_map_revision
    }
}

/// Which operation a receipt belongs to.
///
/// Without this, one request id reused across two different operations would
/// look like a retry of whichever ran first. The receipt key is
/// (installation, work area, operation, request id) - installation and work
/// area are implicit because a receipt only ever lives inside that area's
/// installation-bound record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OperationKind {
    ManagerAnswer,
    ManagerConfirmation,
    PrepareQuestions,
    PrepareMap,
    PreparePlan,
}

/// Idempotency receipt. A repeated request id with identical content returns
/// the stored outcome; the same id with different content, or the same id used
/// for a different operation, is a conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OperationReceipt {
    pub(crate) request_id: String,
    pub(crate) operation: OperationKind,
    /// Digest of the authoritative request content.
    pub(crate) payload_digest: String,
    pub(crate) resulting_revision: u64,
    pub(crate) recorded_at: String,
}

/// The full persisted aggregate for one Work Area.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkAreaRecord {
    pub(crate) schema_version: u32,
    pub(crate) installation_id: String,
    /// Monotonic. Every accepted mutation advances it; CAS compares against it.
    pub(crate) revision: u64,
    pub(crate) area: WorkArea,
    #[serde(default)]
    pub(crate) questions: Vec<Question>,
    #[serde(default)]
    pub(crate) answers: Vec<ManagerAnswer>,
    pub(crate) map: OperationalMap,
    pub(crate) plan: Option<ImprovementPlan>,
    #[serde(default)]
    pub(crate) receipts: Vec<OperationReceipt>,
}

/// Why a stored record was rejected on load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecordDefect {
    UnsupportedSchema,
    WrongInstallation,
    TooManyRoles,
    TooManySystems,
    TooManyInformationSources,
    TooManyDocumentTypes,
    TooManyPhysicalItems,
    TooManyDependencies,
    TooManyPainPoints,
    TooManyWorkflows,
    TooManyWorkflowSteps,
    TooManyQuestions,
    TooManyOpportunities,
    TooManyReceipts,
    DuplicateId,
    OversizedText,
    AnswerWithoutQuestion,
    AnswerTypeMismatch,
    PlanAheadOfMap,
    UnknownEvidenceReference,
}

fn has_duplicates<'a>(ids: impl Iterator<Item = &'a String>) -> bool {
    let mut seen = std::collections::BTreeSet::new();
    for id in ids {
        if !seen.insert(id) {
            return true;
        }
    }
    false
}

/// Revalidate a record read from disk.
///
/// Domain invariants live in constructors and methods, but a stored document is
/// just bytes: anything that edits the file, or a different writer, could
/// present a record that violates them. Loading therefore re-checks bounds,
/// identity and cross-references rather than trusting serde, and normalizes
/// provenance in place so an inferred fact cannot arrive from disk already
/// marked confirmed.
pub(crate) fn validate_and_normalize(
    record: &mut WorkAreaRecord,
    installation_id: &str,
) -> Result<(), RecordDefect> {
    if record.schema_version != WORK_AREA_SCHEMA {
        return Err(RecordDefect::UnsupportedSchema);
    }
    if record.installation_id != installation_id {
        return Err(RecordDefect::WrongInstallation);
    }

    if record.map.roles.len() > MAX_ROLES {
        return Err(RecordDefect::TooManyRoles);
    }
    if record.map.systems.len() > MAX_SYSTEMS {
        return Err(RecordDefect::TooManySystems);
    }
    if record.map.information_sources.len() > MAX_INFORMATION_SOURCES {
        return Err(RecordDefect::TooManyInformationSources);
    }
    if record.map.document_types.len() > MAX_DOCUMENT_TYPES {
        return Err(RecordDefect::TooManyDocumentTypes);
    }
    if record.map.physical_information.len() > MAX_PHYSICAL_ITEMS {
        return Err(RecordDefect::TooManyPhysicalItems);
    }
    if record.map.dependencies.len() > MAX_DEPENDENCIES {
        return Err(RecordDefect::TooManyDependencies);
    }
    if record.map.pain_points.len() > MAX_PAIN_POINTS {
        return Err(RecordDefect::TooManyPainPoints);
    }
    if record.map.workflows.len() > MAX_WORKFLOWS {
        return Err(RecordDefect::TooManyWorkflows);
    }
    if record.questions.len() > MAX_QUESTIONS {
        return Err(RecordDefect::TooManyQuestions);
    }
    if record.receipts.len() > MAX_RECEIPTS {
        return Err(RecordDefect::TooManyReceipts);
    }

    if record.area.name.chars().count() > MAX_NAME_CHARS {
        return Err(RecordDefect::OversizedText);
    }
    if record
        .area
        .description
        .as_ref()
        .is_some_and(|text| text.chars().count() > MAX_DESCRIPTION_CHARS)
    {
        return Err(RecordDefect::OversizedText);
    }

    for workflow in &record.map.workflows {
        if workflow.steps.len() > MAX_WORKFLOW_STEPS {
            return Err(RecordDefect::TooManyWorkflowSteps);
        }
        if has_duplicates(workflow.steps.iter().map(|step| &step.id)) {
            return Err(RecordDefect::DuplicateId);
        }
    }
    if has_duplicates(record.map.workflows.iter().map(|workflow| &workflow.id)) {
        return Err(RecordDefect::DuplicateId);
    }
    if has_duplicates(
        record
            .questions
            .iter()
            .map(|question| &question.question_id),
    ) {
        return Err(RecordDefect::DuplicateId);
    }

    // Every answer must correspond to a real question and match its shape.
    // Otherwise an edited file could assert an answer to a question that was
    // never asked, or a value that question could not have produced.
    for answer in &record.answers {
        let Some(question) = record
            .questions
            .iter()
            .find(|question| question.question_id == answer.question_id)
        else {
            return Err(RecordDefect::AnswerWithoutQuestion);
        };
        if !answer.value.matches(&question.response_type) {
            return Err(RecordDefect::AnswerTypeMismatch);
        }
        if !answer.value.within_bounds() {
            return Err(RecordDefect::OversizedText);
        }
    }

    if let Some(plan) = &record.plan {
        if plan.opportunities.len() > MAX_OPPORTUNITIES {
            return Err(RecordDefect::TooManyOpportunities);
        }
        // A plan claiming to derive from a map revision that does not exist yet
        // is not merely stale, it is incoherent.
        if plan.source_map_revision > record.map.revision {
            return Err(RecordDefect::PlanAheadOfMap);
        }
    }

    // Every cited evidence reference must be one the manager linked to this
    // area. A record naming evidence the area was never granted is rejected
    // rather than quietly trusted.
    {
        let allowed: std::collections::BTreeSet<&String> =
            record.area.linked_evidence.iter().collect();
        let mut cited: Vec<&String> = Vec::new();
        for facts in [
            &record.map.roles,
            &record.map.systems,
            &record.map.information_sources,
            &record.map.document_types,
            &record.map.physical_information,
            &record.map.dependencies,
            &record.map.pain_points,
        ] {
            cited.extend(facts.iter().flat_map(|fact| fact.evidence_refs.iter()));
        }
        cited.extend(
            record
                .map
                .workflows
                .iter()
                .flat_map(|workflow| workflow.evidence_refs.iter()),
        );
        if let Some(plan) = &record.plan {
            cited.extend(
                plan.opportunities
                    .iter()
                    .flat_map(|opportunity| opportunity.evidence_refs.iter()),
            );
        }
        if cited.iter().any(|reference| !allowed.contains(*reference)) {
            return Err(RecordDefect::UnknownEvidenceReference);
        }
    }

    // Provenance normalization: an inferred fact can never load as confirmed.
    for facts in [
        &mut record.map.roles,
        &mut record.map.systems,
        &mut record.map.information_sources,
        &mut record.map.document_types,
        &mut record.map.physical_information,
        &mut record.map.dependencies,
        &mut record.map.pain_points,
    ] {
        for fact in facts.iter_mut() {
            fact.status = fact.normalized_status();
        }
    }

    Ok(())
}

/// Readiness computed from a stored record.
pub(crate) fn record_readiness(record: &WorkAreaRecord) -> MapReadiness {
    map_readiness(
        record.area.scope_defined(),
        &record.map.roles,
        &record.map.systems,
        &record.map.information_sources,
        &record.map.workflows,
        &record.questions,
    )
}

/* ------------------------------------------------------------------ tests */

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(id: &str, provenance: Provenance, status: TruthStatus) -> MappedFact {
        MappedFact {
            id: id.to_string(),
            label: format!("fact {id}"),
            detail: None,
            provenance,
            status,
            evidence_refs: Vec::new(),
        }
    }

    fn complete_workflow() -> Workflow {
        Workflow {
            id: "wf_contract".to_string(),
            phase: WorkflowPhase::Current,
            name: "Contract processing".to_string(),
            purpose: Some("File signed contracts".to_string()),
            trigger: Some("Signed contract arrives by email".to_string()),
            inputs: vec!["Signed contract PDF".to_string()],
            role_ids: vec!["role_receptionist".to_string()],
            system_ids: vec!["sys_shared_folder".to_string()],
            steps: vec![WorkflowStep {
                id: "s1".to_string(),
                description: "Save contract to shared folder".to_string(),
                actor_role_id: Some("role_receptionist".to_string()),
                system_id: Some("sys_shared_folder".to_string()),
                medium: StepMedium::Digital,
                is_decision: false,
                provenance: Provenance::ManagerAnswer,
            }],
            output: Some("Filed contract".to_string()),
            destination: Some("Contracts folder".to_string()),
            frequency: Some("weekly".to_string()),
            exceptions: vec!["Unsigned document arrives".to_string()],
            pain_point_ids: Vec::new(),
            unknowns: Vec::new(),
            current_state_confirmed: true,
            evidence_refs: Vec::new(),
            provenance: Provenance::ManagerAnswer,
        }
    }

    fn blocking_question(status: QuestionStatus) -> Question {
        Question {
            question_id: "q1".to_string(),
            category: QuestionCategory::Workflow,
            prompt: "Where do signed contracts go?".to_string(),
            why_it_matters: None,
            response_type: ResponseType::ShortText,
            required: true,
            blocking: true,
            status,
            source: Provenance::AgentInference,
            revision: 1,
        }
    }

    /* -------- Rule 3: inference is never confirmation -------- */

    #[test]
    fn agent_inference_cannot_be_stored_as_confirmed() {
        let claim = fact("f1", Provenance::AgentInference, TruthStatus::Confirmed);
        assert_eq!(claim.normalized_status(), TruthStatus::Inferred);
        assert!(!claim.is_settled());
    }

    #[test]
    fn agent_inference_cannot_masquerade_as_observed() {
        let claim = fact("f1", Provenance::AgentInference, TruthStatus::Observed);
        assert_eq!(claim.normalized_status(), TruthStatus::Inferred);
    }

    #[test]
    fn manager_answer_is_authoritative_and_settles() {
        let claim = fact("f1", Provenance::ManagerAnswer, TruthStatus::Stated);
        assert!(claim.provenance.is_authoritative());
        assert!(claim.is_settled());
    }

    #[test]
    fn agent_inference_is_not_authoritative() {
        assert!(!Provenance::AgentInference.is_authoritative());
    }

    /* -------- Rule 1 / 13: the automation gate -------- */

    #[test]
    fn complete_current_workflow_opens_the_gate() {
        assert!(workflow_supports_automation_candidate(
            &complete_workflow(),
            0
        ));
        assert!(workflow_automation_gate(&complete_workflow(), 0).is_empty());
    }

    #[test]
    fn blocking_question_closes_the_gate() {
        let gaps = workflow_automation_gate(&complete_workflow(), 1);
        assert!(gaps.contains(&WorkflowGap::BlockingQuestionsOpen));
        assert!(!workflow_supports_automation_candidate(
            &complete_workflow(),
            1
        ));
    }

    #[test]
    fn workflow_without_steps_closes_the_gate() {
        let mut workflow = complete_workflow();
        workflow.steps.clear();
        assert!(workflow_automation_gate(&workflow, 0).contains(&WorkflowGap::MissingSteps));
    }

    #[test]
    fn workflow_without_trigger_closes_the_gate() {
        let mut workflow = complete_workflow();
        workflow.trigger = None;
        assert!(workflow_automation_gate(&workflow, 0).contains(&WorkflowGap::MissingTrigger));
    }

    #[test]
    fn unconfirmed_current_state_closes_the_gate() {
        let mut workflow = complete_workflow();
        workflow.current_state_confirmed = false;
        assert!(
            workflow_automation_gate(&workflow, 0).contains(&WorkflowGap::CurrentStateUnconfirmed)
        );
    }

    #[test]
    fn silence_about_exceptions_closes_the_gate() {
        let mut workflow = complete_workflow();
        workflow.exceptions.clear();
        workflow.unknowns.clear();
        assert!(
            workflow_automation_gate(&workflow, 0).contains(&WorkflowGap::ExceptionsNotAssessed)
        );
    }

    #[test]
    fn explicitly_recorded_unknown_satisfies_exception_assessment() {
        let mut workflow = complete_workflow();
        workflow.exceptions.clear();
        workflow.unknowns = vec!["Exceptions not yet reviewed with staff".to_string()];
        assert!(
            !workflow_automation_gate(&workflow, 0).contains(&WorkflowGap::ExceptionsNotAssessed)
        );
    }

    /* -------- Rule 7: proposed futures cannot justify automation -------- */

    #[test]
    fn proposed_future_workflow_cannot_produce_a_candidate() {
        let mut workflow = complete_workflow();
        workflow.phase = WorkflowPhase::ProposedFuture;
        let gaps = workflow_automation_gate(&workflow, 0);
        assert!(gaps.contains(&WorkflowGap::NotCurrentState));
        assert!(!workflow_supports_automation_candidate(&workflow, 0));
    }

    /* -------- Rule 2: blocking questions hold back readiness -------- */

    fn settled(id: &str) -> MappedFact {
        fact(id, Provenance::ManagerAnswer, TruthStatus::Stated)
    }

    #[test]
    fn map_is_ready_when_sections_and_workflow_are_complete() {
        let readiness = map_readiness(
            true,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow()],
            &[],
        );
        assert!(readiness.ready);
        assert_eq!(readiness.workflows_mapped, 1);
        assert_eq!(readiness.workflows_incomplete, 0);
    }

    #[test]
    fn open_blocking_question_prevents_map_readiness() {
        let readiness = map_readiness(
            true,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow()],
            &[blocking_question(QuestionStatus::Open)],
        );
        assert!(!readiness.ready);
        assert_eq!(readiness.open_blocking_questions, 1);
    }

    #[test]
    fn answering_the_blocking_question_restores_readiness() {
        let readiness = map_readiness(
            true,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow()],
            &[blocking_question(QuestionStatus::Answered)],
        );
        assert!(readiness.ready);
        assert_eq!(readiness.open_blocking_questions, 0);
    }

    #[test]
    fn undefined_scope_prevents_readiness() {
        let readiness = map_readiness(
            false,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow()],
            &[],
        );
        assert!(!readiness.ready);
        assert_eq!(readiness.scope, SectionCoverage::Empty);
    }

    #[test]
    fn no_mapped_workflow_prevents_readiness() {
        let readiness = map_readiness(
            true,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[],
            &[],
        );
        assert!(!readiness.ready);
        assert_eq!(readiness.workflows_mapped, 0);
    }

    #[test]
    fn unsettled_inferred_fact_leaves_section_partial() {
        let readiness = map_readiness(
            true,
            &[
                settled("r1"),
                fact("r2", Provenance::AgentInference, TruthStatus::Inferred),
            ],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow()],
            &[],
        );
        assert_eq!(readiness.roles, SectionCoverage::Partial);
        assert_eq!(readiness.unsettled_facts, 1);
        assert!(!readiness.ready);
    }

    #[test]
    fn incomplete_workflow_is_counted_and_blocks_readiness() {
        let mut incomplete = complete_workflow();
        incomplete.id = "wf_daily".to_string();
        incomplete.steps.clear();
        let readiness = map_readiness(
            true,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow(), incomplete],
            &[],
        );
        assert_eq!(readiness.workflows_mapped, 2);
        assert_eq!(readiness.workflows_incomplete, 1);
        assert!(!readiness.ready);
    }

    #[test]
    fn future_workflows_are_not_counted_as_mapped_current_state() {
        let mut future = complete_workflow();
        future.id = "wf_future".to_string();
        future.phase = WorkflowPhase::ProposedFuture;
        let readiness = map_readiness(
            true,
            &[settled("r1")],
            &[settled("s1")],
            &[settled("i1")],
            &[complete_workflow(), future],
            &[],
        );
        assert_eq!(readiness.workflows_mapped, 1);
    }

    /* -------- Rule 8: planning artifacts carry no authority -------- */

    fn opportunity(category: ImprovementCategory) -> ImprovementOpportunity {
        ImprovementOpportunity {
            id: "op1".to_string(),
            work_area_id: "wa_reception".to_string(),
            workflow_id: Some("wf_contract".to_string()),
            category,
            title: "Remove print-and-scan step".to_string(),
            current_problem: "Digital contract is printed then rescanned".to_string(),
            recommended_change: "Keep the original digital file".to_string(),
            why: None,
            expected_benefit: Some(Magnitude::Medium),
            effort: Some(Magnitude::Low),
            risk: Some(Magnitude::Low),
            automation_readiness: AutomationReadiness::NotReady,
            product_gap: ProductGap::ProcessChangeOnly,
            existing_capability_key: None,
            prerequisites: Vec::new(),
            evidence_refs: Vec::new(),
            provenance: Provenance::AgentInference,
            source_map_revision: 4,
        }
    }

    #[test]
    fn opportunity_never_grants_execution_authority() {
        for category in [
            ImprovementCategory::Digitize,
            ImprovementCategory::Organize,
            ImprovementCategory::Standardize,
            ImprovementCategory::Simplify,
            ImprovementCategory::Integrate,
            ImprovementCategory::Automate,
            ImprovementCategory::KeepManual,
        ] {
            assert!(!opportunity(category).grants_execution_authority());
        }
    }

    #[test]
    fn keep_manual_is_expressible() {
        let recommendation = opportunity(ImprovementCategory::KeepManual);
        assert_eq!(recommendation.category, ImprovementCategory::KeepManual);
        assert_eq!(recommendation.product_gap, ProductGap::ProcessChangeOnly);
    }

    /* -------- staleness -------- */

    #[test]
    fn opportunity_is_stale_when_the_map_moves_on() {
        let recommendation = opportunity(ImprovementCategory::Simplify);
        assert!(!recommendation.is_stale(4));
        assert!(recommendation.is_stale(5));
    }

    /* -------- serialization contracts -------- */

    #[test]
    fn workflow_round_trips_through_serde() {
        let workflow = complete_workflow();
        let encoded = serde_json::to_string(&workflow).unwrap();
        let decoded: Workflow = serde_json::from_str(&encoded).unwrap();
        assert_eq!(workflow, decoded);
    }

    #[test]
    fn unknown_fields_are_rejected_on_planning_records() {
        // deny_unknown_fields keeps agent-supplied JSON from smuggling extra
        // keys into a stored planning record.
        let malformed = r#"{
            "id": "op1",
            "workAreaId": "wa",
            "workflowId": null,
            "category": "simplify",
            "title": "t",
            "currentProblem": "p",
            "recommendedChange": "c",
            "why": null,
            "expectedBenefit": null,
            "effort": null,
            "risk": null,
            "automationReadiness": "not_ready",
            "productGap": "process_change_only",
            "existingCapabilityKey": null,
            "provenance": "agent_inference",
            "sourceMapRevision": 1,
            "executeNow": true
        }"#;
        assert!(serde_json::from_str::<ImprovementOpportunity>(malformed).is_err());
    }

    #[test]
    fn question_blocking_predicate_only_counts_open_questions() {
        assert!(blocking_question(QuestionStatus::Open).is_unresolved_blocker());
        assert!(!blocking_question(QuestionStatus::Answered).is_unresolved_blocker());
        assert!(!blocking_question(QuestionStatus::Skipped).is_unresolved_blocker());
        assert!(!blocking_question(QuestionStatus::Superseded).is_unresolved_blocker());
    }
}
