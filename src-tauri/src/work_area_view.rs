//! Work Area projections.
//!
//! Deliberately narrow views over the persisted aggregate. The record also
//! holds idempotency receipts, installation binding and DPAPI-protected bytes;
//! none of that is useful for planning and all of it is withheld here. What a
//! caller gets is what it needs to reason about the business: what is known,
//! how settled each fact is, what remains unclear, and which gaps currently
//! block automation.
//!
//! There is exactly one projection layer, and both adapters read it: the MCP
//! planning tools and the local manager UI. That is the point of this module
//! living outside either one. A second, UI-only projection could disagree with
//! what the assistant sees — and worse, could quietly present an inferred fact
//! as settled, or a stale plan as current, because it had its own opinion about
//! normalization. Here the answer is computed once.

use rmcp::schemars::{self, JsonSchema};
use serde::Serialize;

use crate::{
    work_area::{
        record_readiness, workflow_automation_gate, AnswerValue, AutomationReadiness,
        ImprovementCategory, Magnitude, MapReadiness, MappedFact, ProductGap, Provenance,
        QuestionCategory, QuestionStatus, ResponseType, SectionCoverage, StepMedium, TruthStatus,
        WorkAreaRecord, WorkAreaState, WorkAreaTemplate, WorkflowGap, WorkflowPhase,
    },
    work_area_planning::{CapabilityMatch, WorkAreaPlanningService},
};

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkAreaSummaryView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) template: WorkAreaTemplate,
    pub(crate) state: WorkAreaState,
    pub(crate) revision: u64,
    pub(crate) workflows_mapped: usize,
    pub(crate) open_blocking_questions: usize,
    pub(crate) map_ready: bool,
    pub(crate) plan_stale: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactView {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) detail: Option<String>,
    pub(crate) provenance: Provenance,
    pub(crate) status: TruthStatus,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StepView {
    pub(crate) id: String,
    pub(crate) description: String,
    pub(crate) actor_role_id: Option<String>,
    pub(crate) system_id: Option<String>,
    pub(crate) medium: StepMedium,
    pub(crate) is_decision: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowView {
    pub(crate) id: String,
    pub(crate) phase: WorkflowPhase,
    pub(crate) name: String,
    pub(crate) purpose: Option<String>,
    pub(crate) trigger: Option<String>,
    pub(crate) inputs: Vec<String>,
    pub(crate) role_ids: Vec<String>,
    pub(crate) system_ids: Vec<String>,
    pub(crate) steps: Vec<StepView>,
    pub(crate) output: Option<String>,
    pub(crate) destination: Option<String>,
    pub(crate) frequency: Option<String>,
    pub(crate) exceptions: Vec<String>,
    pub(crate) unknowns: Vec<String>,
    pub(crate) current_state_confirmed: bool,
    /// Why this workflow cannot yet yield an automation candidate. Empty means
    /// the backend gate would currently pass.
    pub(crate) automation_gaps: Vec<WorkflowGap>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadinessView {
    pub(crate) ready: bool,
    pub(crate) scope: SectionCoverage,
    pub(crate) roles: SectionCoverage,
    pub(crate) systems: SectionCoverage,
    pub(crate) information_sources: SectionCoverage,
    pub(crate) workflows_mapped: usize,
    pub(crate) workflows_incomplete: usize,
    pub(crate) open_blocking_questions: usize,
    pub(crate) unsettled_facts: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionView {
    pub(crate) question_id: String,
    pub(crate) category: QuestionCategory,
    pub(crate) prompt: String,
    pub(crate) why_it_matters: Option<String>,
    /// What shape of answer this question accepts. The manager UI renders its
    /// input from this rather than guessing from the prompt text, so an
    /// assistant cannot influence which control appears by how it phrases a
    /// question. The same value is what `AnswerValue::matches` enforces.
    pub(crate) response_type: ResponseType,
    pub(crate) required: bool,
    pub(crate) blocking: bool,
    pub(crate) status: QuestionStatus,
    /// Present once the manager has answered locally. The assistant reads this
    /// as manager truth; it has no way to write it.
    pub(crate) manager_answer: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationalMapView {
    pub(crate) work_area_id: String,
    pub(crate) map_revision: u64,
    pub(crate) confirmed: bool,
    pub(crate) prepared_at: Option<String>,
    pub(crate) roles: Vec<FactView>,
    pub(crate) systems: Vec<FactView>,
    pub(crate) information_sources: Vec<FactView>,
    pub(crate) document_types: Vec<FactView>,
    pub(crate) physical_information: Vec<FactView>,
    pub(crate) dependencies: Vec<FactView>,
    pub(crate) pain_points: Vec<FactView>,
    pub(crate) workflows: Vec<WorkflowView>,
    pub(crate) unknowns: Vec<String>,
    pub(crate) readiness: ReadinessView,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkAreaContextView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) template: WorkAreaTemplate,
    pub(crate) state: WorkAreaState,
    pub(crate) revision: u64,
    pub(crate) description: Option<String>,
    pub(crate) scope_included: Vec<String>,
    pub(crate) scope_excluded: Vec<String>,
    /// Opaque Phase E references this area may cite. Never a filesystem path.
    pub(crate) linked_evidence: Vec<String>,
    pub(crate) map: OperationalMapView,
    pub(crate) questions: Vec<QuestionView>,
    pub(crate) plan_present: bool,
    pub(crate) plan_stale: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpportunityView {
    pub(crate) id: String,
    pub(crate) category: ImprovementCategory,
    pub(crate) title: String,
    pub(crate) current_problem: String,
    pub(crate) recommended_change: String,
    pub(crate) why: Option<String>,
    pub(crate) workflow_id: Option<String>,
    pub(crate) expected_benefit: Option<Magnitude>,
    pub(crate) effort: Option<Magnitude>,
    pub(crate) risk: Option<Magnitude>,
    pub(crate) automation_readiness: AutomationReadiness,
    pub(crate) product_gap: ProductGap,
    pub(crate) existing_capability_key: Option<String>,
    /// Backend classification. Catalog presence yields only a possible match.
    pub(crate) capability_match: CapabilityMatch,
    pub(crate) prerequisites: Vec<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImprovementPlanView {
    pub(crate) work_area_id: String,
    pub(crate) revision: u64,
    pub(crate) source_map_revision: u64,
    pub(crate) current_map_revision: u64,
    pub(crate) stale: bool,
    pub(crate) prepared_at: String,
    pub(crate) opportunities: Vec<OpportunityView>,
}

pub(crate) fn fact_views(facts: &[MappedFact]) -> Vec<FactView> {
    facts
        .iter()
        .map(|fact| FactView {
            id: fact.id.clone(),
            label: fact.label.clone(),
            detail: fact.detail.clone(),
            provenance: fact.provenance,
            // Normalized, so an inferred fact can never read back as confirmed.
            status: fact.normalized_status(),
        })
        .collect()
}

pub(crate) fn workflow_views(record: &WorkAreaRecord, open_blockers: usize) -> Vec<WorkflowView> {
    record
        .map
        .workflows
        .iter()
        .map(|workflow| WorkflowView {
            id: workflow.id.clone(),
            phase: workflow.phase,
            name: workflow.name.clone(),
            purpose: workflow.purpose.clone(),
            trigger: workflow.trigger.clone(),
            inputs: workflow.inputs.clone(),
            role_ids: workflow.role_ids.clone(),
            system_ids: workflow.system_ids.clone(),
            steps: workflow
                .steps
                .iter()
                .map(|step| StepView {
                    id: step.id.clone(),
                    description: step.description.clone(),
                    actor_role_id: step.actor_role_id.clone(),
                    system_id: step.system_id.clone(),
                    medium: step.medium,
                    is_decision: step.is_decision,
                })
                .collect(),
            output: workflow.output.clone(),
            destination: workflow.destination.clone(),
            frequency: workflow.frequency.clone(),
            exceptions: workflow.exceptions.clone(),
            unknowns: workflow.unknowns.clone(),
            current_state_confirmed: workflow.current_state_confirmed,
            automation_gaps: workflow_automation_gate(workflow, open_blockers),
        })
        .collect()
}

pub(crate) fn readiness_view(readiness: &MapReadiness) -> ReadinessView {
    ReadinessView {
        ready: readiness.ready,
        scope: readiness.scope,
        roles: readiness.roles,
        systems: readiness.systems,
        information_sources: readiness.information_sources,
        workflows_mapped: readiness.workflows_mapped,
        workflows_incomplete: readiness.workflows_incomplete,
        open_blocking_questions: readiness.open_blocking_questions,
        unsettled_facts: readiness.unsettled_facts,
    }
}

pub(crate) fn answer_summary(value: &AnswerValue) -> String {
    match value {
        AnswerValue::YesNo { value } => if *value { "yes" } else { "no" }.to_string(),
        AnswerValue::Choice { value }
        | AnswerValue::Text { value }
        | AnswerValue::Duration { value }
        | AnswerValue::Frequency { value } => value.clone(),
        AnswerValue::Choices { values } => values.join(", "),
        AnswerValue::Number { value } => value.to_string(),
    }
}

pub(crate) fn question_views(record: &WorkAreaRecord) -> Vec<QuestionView> {
    record
        .questions
        .iter()
        .map(|question| QuestionView {
            question_id: question.question_id.clone(),
            category: question.category,
            prompt: question.prompt.clone(),
            why_it_matters: question.why_it_matters.clone(),
            response_type: question.response_type.clone(),
            required: question.required,
            blocking: question.blocking,
            status: question.status,
            manager_answer: record
                .answers
                .iter()
                .find(|answer| answer.question_id == question.question_id)
                .map(|answer| answer_summary(&answer.value)),
        })
        .collect()
}

pub(crate) fn map_view(record: &WorkAreaRecord) -> OperationalMapView {
    let readiness = record_readiness(record);
    OperationalMapView {
        work_area_id: record.area.id.clone(),
        map_revision: record.map.revision,
        confirmed: record.map.confirmed,
        prepared_at: record.map.prepared_at.clone(),
        roles: fact_views(&record.map.roles),
        systems: fact_views(&record.map.systems),
        information_sources: fact_views(&record.map.information_sources),
        document_types: fact_views(&record.map.document_types),
        physical_information: fact_views(&record.map.physical_information),
        dependencies: fact_views(&record.map.dependencies),
        pain_points: fact_views(&record.map.pain_points),
        workflows: workflow_views(record, readiness.open_blocking_questions),
        unknowns: record.map.unknowns.clone(),
        readiness: readiness_view(&readiness),
    }
}

pub(crate) fn context_view(record: &WorkAreaRecord) -> WorkAreaContextView {
    WorkAreaContextView {
        id: record.area.id.clone(),
        name: record.area.name.clone(),
        template: record.area.template,
        state: record.area.state,
        revision: record.revision,
        description: record.area.description.clone(),
        scope_included: record.area.scope_included.clone(),
        scope_excluded: record.area.scope_excluded.clone(),
        linked_evidence: record.area.linked_evidence.clone(),
        map: map_view(record),
        questions: question_views(record),
        plan_present: record.plan.is_some(),
        plan_stale: record
            .plan
            .as_ref()
            .is_some_and(|plan| plan.is_stale(record.map.revision)),
    }
}

pub(crate) fn opportunity_views(record: &WorkAreaRecord) -> Vec<OpportunityView> {
    record
        .plan
        .as_ref()
        .map(|plan| {
            plan.opportunities
                .iter()
                .map(|opportunity| OpportunityView {
                    id: opportunity.id.clone(),
                    category: opportunity.category,
                    title: opportunity.title.clone(),
                    current_problem: opportunity.current_problem.clone(),
                    recommended_change: opportunity.recommended_change.clone(),
                    why: opportunity.why.clone(),
                    workflow_id: opportunity.workflow_id.clone(),
                    expected_benefit: opportunity.expected_benefit,
                    effort: opportunity.effort,
                    risk: opportunity.risk,
                    automation_readiness: opportunity.automation_readiness,
                    product_gap: opportunity.product_gap,
                    existing_capability_key: opportunity.existing_capability_key.clone(),
                    capability_match: WorkAreaPlanningService::classify_capability(opportunity),
                    prerequisites: opportunity.prerequisites.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn plan_view(record: &WorkAreaRecord) -> Option<ImprovementPlanView> {
    record.plan.as_ref().map(|plan| ImprovementPlanView {
        work_area_id: record.area.id.clone(),
        revision: plan.revision,
        source_map_revision: plan.source_map_revision,
        current_map_revision: record.map.revision,
        stale: plan.is_stale(record.map.revision),
        prepared_at: plan.prepared_at.clone(),
        opportunities: opportunity_views(record),
    })
}
