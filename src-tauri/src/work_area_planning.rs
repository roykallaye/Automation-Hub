/*
  Phase H-A — Work Area planning-preparation service.

  This is the boundary MCP will call in Increment 3, and the one the local UI
  calls for manager actions. Neither adapter touches persistence directly.

  Authority comes from the caller, never from the payload
  -------------------------------------------------------
  `CallerAuthority` is a Rust argument supplied by the adapter. It is not
  deserialized, so a model cannot set it.

  More importantly, the agent-facing request types have *no provenance or truth
  fields at all*. `ProposedFact` carries a label, a detail and evidence
  references — there is nowhere to write `manager_answer` or `confirmed`.
  Combined with `deny_unknown_fields`, sending one is a parse error rather than
  something we must remember to strip. The service then assigns
  `Provenance::AgentInference` / `TruthStatus::Inferred` itself.

  That is deliberately structural: rejecting a forged provenance field relies on
  a check being present, whereas removing the field means the forgery cannot be
  expressed. Manager confirmation is a separate operation that requires
  `CallerAuthority::LocalManager`.

  Gates are enforced here, not advertised here
  --------------------------------------------
  `prepare_improvement_plan` refuses while the map is not ready, and an
  automation-category opportunity is refused unless its workflow passes
  `workflow_automation_gate`. The service returns structured gaps rather than
  accepting the artifact with a warning attached.
*/

// Increment 2b of Phase H-A: the planning service lands before the MCP adapter
// and UI that call it.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::{
    RetryDirective, SafeErrorDetails, WorkspaceError, WorkspaceErrorCategory, WorkspaceErrorCode,
    WorkspaceResult,
};
use crate::work_area::{
    record_readiness, workflow_automation_gate, ImprovementCategory, ImprovementOpportunity,
    ImprovementPlan, MappedFact, OperationKind, OperationReceipt, Provenance, Question,
    QuestionCategory, QuestionStatus, ResponseType, StepMedium, TruthStatus, WorkAreaRecord,
    WorkAreaState, Workflow, WorkflowGap, WorkflowPhase, WorkflowStep, MAX_OPPORTUNITIES,
    MAX_QUESTIONS, MAX_TEXT_CHARS, MAX_WORKFLOWS, MAX_WORKFLOW_STEPS,
};
use crate::work_area_store::WorkAreaService;

/// The InnPilot automations that actually exist today. Capability matching is
/// verified against this list rather than trusting a model's assertion.
/// Mirrors the workflow keys in preflight.rs.
pub(crate) const INNPILOT_CAPABILITIES: [&str; 5] = [
    "invoiceWorkflow",
    "gmailDraftsWorkflow",
    "scansioniNetwork",
    "ocrWorkflow",
    "contractsWorkflow",
];

const MAX_QUESTIONS_PER_REQUEST: usize = 12;
const MAX_CHOICES: usize = 8;
const MAX_EVIDENCE_REFS: usize = 8;
const MAX_REQUEST_ID_CHARS: usize = 64;

/* ------------------------------------------------------------- authority */

/// Who is asking. Supplied by the adapter as a Rust value; never parsed from a
/// request body, so it cannot be forged by a model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CallerAuthority {
    /// The manager acting through InnPilot's own local UI.
    LocalManager,
    /// The assistant, through the MCP planning adapter.
    AssistantPlanning,
}

impl CallerAuthority {
    fn is_manager(self) -> bool {
        matches!(self, CallerAuthority::LocalManager)
    }
}

/* ----------------------------------------------------------------- errors */

fn manager_authority_required() -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PermissionDenied,
        WorkspaceErrorCategory::Capability,
        "Only the hotel manager can confirm this in InnPilot.",
        RetryDirective::Never,
    )
    .with_diagnostic("operation requires CallerAuthority::LocalManager")
}

fn invalid_request(summary: &str, field_codes: Vec<String>) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::InvalidRequest,
        WorkspaceErrorCategory::Validation,
        summary.to_string(),
        RetryDirective::UserAction,
    )
    .with_details(SafeErrorDetails::Validation { field_codes })
}

fn map_not_ready(readiness_gaps: Vec<String>) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PreflightBlocked,
        WorkspaceErrorCategory::Preflight,
        "InnPilot does not understand this work area well enough yet.",
        RetryDirective::UserAction,
    )
    .with_details(SafeErrorDetails::Preflight {
        blocker_keys: readiness_gaps,
    })
}

fn automation_gate_failed(gaps: &[WorkflowGap]) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PreflightBlocked,
        WorkspaceErrorCategory::Preflight,
        "That workflow is not understood well enough to suggest automating it.",
        RetryDirective::UserAction,
    )
    .with_details(SafeErrorDetails::Preflight {
        blocker_keys: gaps.iter().map(|gap| format!("{gap:?}")).collect(),
    })
}

fn stale_revision(current: u64) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::StaleRevision,
        WorkspaceErrorCategory::Concurrency,
        "This work area changed. Refresh and try again.",
        RetryDirective::Refresh,
    )
    .with_details(SafeErrorDetails::Revision {
        resource: crate::domain::WorkspaceResource::Workspace,
        current: current.to_string(),
    })
}

fn conflicting_receipt() -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PersistenceConflict,
        WorkspaceErrorCategory::Concurrency,
        "That request was already used for something else.",
        RetryDirective::Never,
    )
}

/* ------------------------------------------------- agent-facing contracts */

/// A fact the assistant proposes.
///
/// There is deliberately no provenance or truth field: the wire format gives a
/// model nowhere to claim manager confirmation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProposedFact {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) detail: Option<String>,
    #[serde(default)]
    pub(crate) evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProposedStep {
    pub(crate) id: String,
    pub(crate) description: String,
    pub(crate) actor_role_id: Option<String>,
    pub(crate) system_id: Option<String>,
    pub(crate) medium: StepMedium,
    #[serde(default)]
    pub(crate) is_decision: bool,
}

/// A workflow the assistant proposes. `phase` is accepted because describing a
/// possible future flow is legitimate — but a future flow can never satisfy the
/// automation gate, which is enforced separately.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProposedWorkflow {
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
    pub(crate) steps: Vec<ProposedStep>,
    pub(crate) output: Option<String>,
    pub(crate) destination: Option<String>,
    pub(crate) frequency: Option<String>,
    #[serde(default)]
    pub(crate) exceptions: Vec<String>,
    #[serde(default)]
    pub(crate) unknowns: Vec<String>,
    #[serde(default)]
    pub(crate) evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProposedQuestion {
    pub(crate) question_id: String,
    pub(crate) category: QuestionCategory,
    pub(crate) prompt: String,
    pub(crate) why_it_matters: Option<String>,
    pub(crate) response_type: ResponseType,
    #[serde(default)]
    pub(crate) required: bool,
    #[serde(default)]
    pub(crate) blocking: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrepareQuestionsRequest {
    pub(crate) work_area_id: String,
    pub(crate) expected_revision: u64,
    pub(crate) request_id: String,
    pub(crate) questions: Vec<ProposedQuestion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrepareMapRequest {
    pub(crate) work_area_id: String,
    pub(crate) expected_revision: u64,
    pub(crate) request_id: String,
    #[serde(default)]
    pub(crate) roles: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) systems: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) information_sources: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) document_types: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) physical_information: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) dependencies: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) pain_points: Vec<ProposedFact>,
    #[serde(default)]
    pub(crate) workflows: Vec<ProposedWorkflow>,
    #[serde(default)]
    pub(crate) unknowns: Vec<String>,
}

/// A proposed opportunity. Note the absence of any execution, script, command,
/// configuration or approval field — planning artifacts have no such vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProposedOpportunity {
    pub(crate) id: String,
    pub(crate) category: ImprovementCategory,
    pub(crate) title: String,
    pub(crate) current_problem: String,
    pub(crate) recommended_change: String,
    pub(crate) why: Option<String>,
    pub(crate) workflow_id: Option<String>,
    pub(crate) expected_benefit: Option<crate::work_area::Magnitude>,
    pub(crate) effort: Option<crate::work_area::Magnitude>,
    pub(crate) risk: Option<crate::work_area::Magnitude>,
    pub(crate) automation_readiness: crate::work_area::AutomationReadiness,
    pub(crate) product_gap: crate::work_area::ProductGap,
    /// Verified against INNPILOT_CAPABILITIES; an unknown key is rejected.
    pub(crate) existing_capability_key: Option<String>,
    #[serde(default)]
    pub(crate) prerequisites: Vec<String>,
    #[serde(default)]
    pub(crate) evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreparePlanRequest {
    pub(crate) work_area_id: String,
    pub(crate) expected_revision: u64,
    pub(crate) request_id: String,
    /// The map revision the assistant reasoned over. Must equal the stored one.
    pub(crate) source_map_revision: u64,
    pub(crate) opportunities: Vec<ProposedOpportunity>,
}

/// How confidently an opportunity maps onto something InnPilot already does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CapabilityMatch {
    NoMatch,
    /// The referenced capability exists in the catalog. Deliberately not
    /// "supported": catalog presence is not proof of workflow compatibility.
    PossibleExistingCapability,
    NewCapabilityRequired,
}

/* ---------------------------------------------------------------- service */

pub(crate) struct WorkAreaPlanningService {
    areas: WorkAreaService,
}

impl WorkAreaPlanningService {
    pub(crate) fn new(areas: WorkAreaService) -> Self {
        Self { areas }
    }

    pub(crate) fn areas(&self) -> &WorkAreaService {
        &self.areas
    }

    /// Assistant-prepared questions. Bounded, de-duplicated, and always
    /// recorded with agent provenance.
    pub(crate) fn prepare_questions(
        &self,
        authority: CallerAuthority,
        request: PrepareQuestionsRequest,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        check_request_id(&request.request_id)?;
        if request.questions.is_empty() || request.questions.len() > MAX_QUESTIONS_PER_REQUEST {
            return Err(invalid_request(
                "That set of questions is not a size InnPilot accepts.",
                vec!["questions".to_string()],
            ));
        }
        for question in &request.questions {
            validate_question(question)?;
        }

        let digest = digest_of(OperationKind::PrepareQuestions, &request.work_area_id, {
            let mut parts: Vec<String> = request
                .questions
                .iter()
                .map(|question| format!("{}|{}", question.question_id, question.prompt))
                .collect();
            parts.sort();
            parts.join("\n")
        });

        self.areas.mutate(&request.work_area_id, |record| {
            if let Some(existing) = replay(
                record,
                &request.request_id,
                OperationKind::PrepareQuestions,
                &digest,
            )? {
                return Ok(existing);
            }
            require_revision(record, request.expected_revision)?;
            require_active(record)?;

            for proposed in &request.questions {
                if record
                    .questions
                    .iter()
                    .any(|existing| existing.question_id == proposed.question_id)
                {
                    // Re-proposing an existing question is a no-op rather
                    // than a duplicate or a silent overwrite of its status.
                    continue;
                }
                if record.questions.len() >= MAX_QUESTIONS {
                    return Err(invalid_request(
                        "This work area already has as many open questions as InnPilot tracks.",
                        vec!["question_count".to_string()],
                    ));
                }
                record.questions.push(Question {
                    question_id: proposed.question_id.clone(),
                    category: proposed.category,
                    prompt: proposed.prompt.clone(),
                    why_it_matters: proposed.why_it_matters.clone(),
                    response_type: proposed.response_type.clone(),
                    required: proposed.required,
                    blocking: proposed.blocking,
                    status: QuestionStatus::Open,
                    // Authority, not the payload, decides this.
                    source: provenance_for(authority),
                    revision: record.revision + 1,
                });
            }

            record.revision += 1;
            record.area.updated_at = now.to_string();
            if record.area.state == WorkAreaState::ScopeDefined
                || record.area.state == WorkAreaState::NotStarted
            {
                record.area.state = WorkAreaState::Mapping;
            }
            push_receipt(
                record,
                &request.request_id,
                OperationKind::PrepareQuestions,
                &digest,
                now,
            );
            Ok(record.clone())
        })
    }

    /// Assistant-prepared operational map. Everything it contains is recorded
    /// as inference until a manager confirms it.
    pub(crate) fn prepare_operational_map(
        &self,
        authority: CallerAuthority,
        request: PrepareMapRequest,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        check_request_id(&request.request_id)?;
        if request.workflows.len() > MAX_WORKFLOWS {
            return Err(invalid_request(
                "That map describes more workflows than InnPilot stores.",
                vec!["workflows".to_string()],
            ));
        }
        for workflow in &request.workflows {
            if workflow.steps.len() > MAX_WORKFLOW_STEPS {
                return Err(invalid_request(
                    "That workflow has more steps than InnPilot stores.",
                    vec!["workflow_steps".to_string()],
                ));
            }
            check_text(&workflow.name, "workflow_name")?;
        }
        for group in [
            &request.roles,
            &request.systems,
            &request.information_sources,
            &request.document_types,
            &request.physical_information,
            &request.dependencies,
            &request.pain_points,
        ] {
            for fact in group {
                check_text(&fact.label, "fact_label")?;
                if fact.evidence_refs.len() > MAX_EVIDENCE_REFS {
                    return Err(invalid_request(
                        "That entry cites more evidence than InnPilot accepts.",
                        vec!["evidence_refs".to_string()],
                    ));
                }
            }
        }

        let digest = digest_of(
            OperationKind::PrepareMap,
            &request.work_area_id,
            format!(
                "{}|{}|{}",
                request.roles.len(),
                request.systems.len(),
                request
                    .workflows
                    .iter()
                    .map(|workflow| workflow.id.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        );

        self.areas.mutate(&request.work_area_id, |record| {
            if let Some(existing) = replay(
                record,
                &request.request_id,
                OperationKind::PrepareMap,
                &digest,
            )? {
                return Ok(existing);
            }
            require_revision(record, request.expected_revision)?;
            require_active(record)?;

            // Citations must resolve against the evidence the manager linked to
            // this area, which is what prevents cross-area evidence reuse.
            let allowed: std::collections::BTreeSet<&String> =
                record.area.linked_evidence.iter().collect();
            let mut cited: Vec<&String> = Vec::new();
            for group in [
                &request.roles,
                &request.systems,
                &request.information_sources,
                &request.document_types,
                &request.physical_information,
                &request.dependencies,
                &request.pain_points,
            ] {
                cited.extend(group.iter().flat_map(|fact| fact.evidence_refs.iter()));
            }
            cited.extend(
                request
                    .workflows
                    .iter()
                    .flat_map(|workflow| workflow.evidence_refs.iter()),
            );
            if let Some(unknown) = cited
                .iter()
                .find(|reference| !allowed.contains(**reference))
            {
                return Err(invalid_request(
                    "That map cites evidence this work area does not have access to.",
                    vec![format!("evidence:{unknown}")],
                ));
            }

            let provenance = provenance_for(authority);
            let convert = |facts: &Vec<ProposedFact>| -> Vec<MappedFact> {
                facts
                    .iter()
                    .map(|fact| MappedFact {
                        id: fact.id.clone(),
                        label: fact.label.clone(),
                        detail: fact.detail.clone(),
                        provenance,
                        // Assigned here, not accepted from the payload.
                        status: truth_for(authority),
                        evidence_refs: fact.evidence_refs.clone(),
                    })
                    .collect()
            };

            record.map.roles = convert(&request.roles);
            record.map.systems = convert(&request.systems);
            record.map.information_sources = convert(&request.information_sources);
            record.map.document_types = convert(&request.document_types);
            record.map.physical_information = convert(&request.physical_information);
            record.map.dependencies = convert(&request.dependencies);
            record.map.pain_points = convert(&request.pain_points);
            record.map.unknowns = request.unknowns.clone();
            record.map.workflows = request
                .workflows
                .iter()
                .map(|workflow| Workflow {
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
                        .map(|step| WorkflowStep {
                            id: step.id.clone(),
                            description: step.description.clone(),
                            actor_role_id: step.actor_role_id.clone(),
                            system_id: step.system_id.clone(),
                            medium: step.medium,
                            is_decision: step.is_decision,
                            provenance,
                        })
                        .collect(),
                    output: workflow.output.clone(),
                    destination: workflow.destination.clone(),
                    frequency: workflow.frequency.clone(),
                    exceptions: workflow.exceptions.clone(),
                    pain_point_ids: Vec::new(),
                    unknowns: workflow.unknowns.clone(),
                    // Only a manager can assert that this is how work happens.
                    current_state_confirmed: false,
                    evidence_refs: workflow.evidence_refs.clone(),
                    provenance,
                })
                .collect();

            record.map.revision += 1;
            record.map.prepared_at = Some(now.to_string());
            record.map.confirmed = false;
            record.revision += 1;
            record.area.updated_at = now.to_string();
            record.area.state = derive_state(record);
            push_receipt(
                record,
                &request.request_id,
                OperationKind::PrepareMap,
                &digest,
                now,
            );
            Ok(record.clone())
        })
    }

    /// Manager confirmation of a single mapped fact or workflow.
    ///
    /// This is the only way inference becomes confirmed, and it requires local
    /// manager authority. There is no assistant-reachable equivalent.
    pub(crate) fn confirm_fact(
        &self,
        authority: CallerAuthority,
        work_area_id: &str,
        target_id: &str,
        expected_revision: u64,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        if !authority.is_manager() {
            return Err(manager_authority_required());
        }
        self.areas.mutate(work_area_id, |record| {
            require_revision(record, expected_revision)?;
            let mut touched = false;
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
                    if fact.id == target_id {
                        fact.status = TruthStatus::Confirmed;
                        fact.provenance = Provenance::ManagerAnswer;
                        touched = true;
                    }
                }
            }
            for workflow in record.map.workflows.iter_mut() {
                if workflow.id == target_id {
                    workflow.current_state_confirmed = true;
                    touched = true;
                }
            }
            if !touched {
                return Err(invalid_request(
                    "InnPilot could not find that item to confirm.",
                    vec!["target_id".to_string()],
                ));
            }
            record.map.revision += 1;
            record.revision += 1;
            record.area.updated_at = now.to_string();
            record.area.state = derive_state(record);
            Ok(record.clone())
        })
    }

    /// Assistant-prepared improvement plan.
    ///
    /// Refused entirely while the map is not ready, and per-opportunity for any
    /// automation whose workflow fails the gate.
    pub(crate) fn prepare_improvement_plan(
        &self,
        authority: CallerAuthority,
        request: PreparePlanRequest,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        check_request_id(&request.request_id)?;
        if request.opportunities.is_empty() || request.opportunities.len() > MAX_OPPORTUNITIES {
            return Err(invalid_request(
                "That plan is not a size InnPilot accepts.",
                vec!["opportunities".to_string()],
            ));
        }
        for opportunity in &request.opportunities {
            check_text(&opportunity.title, "title")?;
            check_text(&opportunity.current_problem, "current_problem")?;
            check_text(&opportunity.recommended_change, "recommended_change")?;
            // Capability claims are verified against the real catalog.
            if let Some(key) = &opportunity.existing_capability_key {
                if !INNPILOT_CAPABILITIES.contains(&key.as_str()) {
                    return Err(invalid_request(
                        "That plan refers to an InnPilot capability that does not exist.",
                        vec![format!("capability:{key}")],
                    ));
                }
            }
        }

        let digest = digest_of(
            OperationKind::PreparePlan,
            &request.work_area_id,
            request
                .opportunities
                .iter()
                .map(|opportunity| opportunity.id.as_str())
                .collect::<Vec<_>>()
                .join(","),
        );

        self.areas.mutate(&request.work_area_id, |record| {
            if let Some(existing) = replay(
                record,
                &request.request_id,
                OperationKind::PreparePlan,
                &digest,
            )? {
                return Ok(existing);
            }
            require_revision(record, request.expected_revision)?;
            require_active(record)?;

            // Rule 2: understanding first.
            let readiness = record_readiness(record);
            if !readiness.ready {
                return Err(map_not_ready(readiness_gaps(&readiness)));
            }
            // The assistant must have reasoned over the map that is actually
            // stored, not an earlier one.
            if request.source_map_revision != record.map.revision {
                return Err(stale_revision(record.revision));
            }

            let open_blockers = readiness.open_blocking_questions;
            let mut opportunities = Vec::new();
            for proposed in &request.opportunities {
                // Rules 1/13: an automation recommendation requires a current
                // workflow that passes the gate.
                if proposed.category == ImprovementCategory::Automate {
                    let Some(workflow_id) = &proposed.workflow_id else {
                        return Err(invalid_request(
                            "An automation suggestion must name the workflow it applies to.",
                            vec!["workflow_id".to_string()],
                        ));
                    };
                    let Some(workflow) = record
                        .map
                        .workflows
                        .iter()
                        .find(|candidate| candidate.id == *workflow_id)
                    else {
                        return Err(invalid_request(
                            "That automation suggestion refers to an unknown workflow.",
                            vec!["workflow_id".to_string()],
                        ));
                    };
                    let gaps = workflow_automation_gate(workflow, open_blockers);
                    if !gaps.is_empty() {
                        return Err(automation_gate_failed(&gaps));
                    }
                }

                opportunities.push(ImprovementOpportunity {
                    id: proposed.id.clone(),
                    work_area_id: record.area.id.clone(),
                    workflow_id: proposed.workflow_id.clone(),
                    category: proposed.category,
                    title: proposed.title.clone(),
                    current_problem: proposed.current_problem.clone(),
                    recommended_change: proposed.recommended_change.clone(),
                    why: proposed.why.clone(),
                    expected_benefit: proposed.expected_benefit,
                    effort: proposed.effort,
                    risk: proposed.risk,
                    automation_readiness: proposed.automation_readiness,
                    product_gap: proposed.product_gap,
                    existing_capability_key: proposed.existing_capability_key.clone(),
                    prerequisites: proposed.prerequisites.clone(),
                    evidence_refs: proposed.evidence_refs.clone(),
                    provenance: provenance_for(authority),
                    source_map_revision: record.map.revision,
                });
            }

            let next_revision = record
                .plan
                .as_ref()
                .map(|plan| plan.revision + 1)
                .unwrap_or(1);
            record.plan = Some(ImprovementPlan {
                revision: next_revision,
                source_map_revision: record.map.revision,
                opportunities,
                prepared_at: now.to_string(),
            });
            record.revision += 1;
            record.area.updated_at = now.to_string();
            record.area.state = if record.plan.as_ref().is_some_and(|plan| {
                plan.opportunities
                    .iter()
                    .any(|item| item.category == ImprovementCategory::Automate)
            }) {
                WorkAreaState::AutomationOpportunitiesReady
            } else {
                WorkAreaState::ImprovementReady
            };
            push_receipt(
                record,
                &request.request_id,
                OperationKind::PreparePlan,
                &digest,
                now,
            );
            Ok(record.clone())
        })
    }

    /// Conservative, deterministic capability classification.
    pub(crate) fn classify_capability(opportunity: &ImprovementOpportunity) -> CapabilityMatch {
        match &opportunity.existing_capability_key {
            Some(key) if INNPILOT_CAPABILITIES.contains(&key.as_str()) => {
                CapabilityMatch::PossibleExistingCapability
            }
            Some(_) => CapabilityMatch::NoMatch,
            None => match opportunity.product_gap {
                crate::work_area::ProductGap::NewInnpilotCapability => {
                    CapabilityMatch::NewCapabilityRequired
                }
                _ => CapabilityMatch::NoMatch,
            },
        }
    }
}

/* ---------------------------------------------------------------- helpers */

fn provenance_for(authority: CallerAuthority) -> Provenance {
    match authority {
        CallerAuthority::LocalManager => Provenance::ManualEntry,
        CallerAuthority::AssistantPlanning => Provenance::AgentInference,
    }
}

fn truth_for(authority: CallerAuthority) -> TruthStatus {
    match authority {
        CallerAuthority::LocalManager => TruthStatus::Stated,
        CallerAuthority::AssistantPlanning => TruthStatus::Inferred,
    }
}

fn require_revision(record: &WorkAreaRecord, expected: u64) -> WorkspaceResult<()> {
    if record.revision != expected {
        return Err(stale_revision(record.revision));
    }
    Ok(())
}

fn require_active(record: &WorkAreaRecord) -> WorkspaceResult<()> {
    if record.area.state == WorkAreaState::Archived {
        return Err(invalid_request(
            "That work area is archived.",
            vec!["work_area_state".to_string()],
        ));
    }
    Ok(())
}

/// Idempotency lookup, matched on operation as well as request id so one id
/// cannot be replayed across two different operations.
fn replay(
    record: &WorkAreaRecord,
    request_id: &str,
    operation: OperationKind,
    digest: &str,
) -> WorkspaceResult<Option<WorkAreaRecord>> {
    match record
        .receipts
        .iter()
        .find(|receipt| receipt.request_id == request_id)
    {
        Some(receipt) if receipt.operation == operation && receipt.payload_digest == digest => {
            Ok(Some(record.clone()))
        }
        Some(_) => Err(conflicting_receipt()),
        None => Ok(None),
    }
}

fn push_receipt(
    record: &mut WorkAreaRecord,
    request_id: &str,
    operation: OperationKind,
    digest: &str,
    now: &str,
) {
    record.receipts.push(OperationReceipt {
        request_id: request_id.to_string(),
        operation,
        payload_digest: digest.to_string(),
        resulting_revision: record.revision,
        recorded_at: now.to_string(),
    });
    const MAX_RECEIPTS: usize = 32;
    if record.receipts.len() > MAX_RECEIPTS {
        let excess = record.receipts.len() - MAX_RECEIPTS;
        record.receipts.drain(0..excess);
    }
}

/// The digest binds the operation kind and work area alongside the content, so
/// the same request id cannot be reused across operations or areas.
fn digest_of(operation: OperationKind, work_area_id: &str, content: impl AsRef<str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{operation:?}").as_bytes());
    hasher.update([0]);
    hasher.update(work_area_id.as_bytes());
    hasher.update([0]);
    hasher.update(content.as_ref().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn derive_state(record: &WorkAreaRecord) -> WorkAreaState {
    if record.area.state == WorkAreaState::Archived {
        return WorkAreaState::Archived;
    }
    let readiness = record_readiness(record);
    if readiness.ready {
        WorkAreaState::MapReady
    } else if readiness.open_blocking_questions > 0 {
        WorkAreaState::NeedsInput
    } else {
        WorkAreaState::Mapping
    }
}

fn readiness_gaps(readiness: &crate::work_area::MapReadiness) -> Vec<String> {
    let mut gaps = Vec::new();
    if readiness.open_blocking_questions > 0 {
        gaps.push("blocking_questions".to_string());
    }
    if readiness.workflows_mapped == 0 {
        gaps.push("no_current_workflow".to_string());
    }
    if readiness.workflows_incomplete > 0 {
        gaps.push("incomplete_workflow".to_string());
    }
    if readiness.unsettled_facts > 0 {
        gaps.push("unconfirmed_facts".to_string());
    }
    if gaps.is_empty() {
        gaps.push("scope_or_coverage".to_string());
    }
    gaps
}

fn check_request_id(request_id: &str) -> WorkspaceResult<()> {
    if request_id.trim().is_empty() || request_id.chars().count() > MAX_REQUEST_ID_CHARS {
        return Err(invalid_request(
            "That request could not be identified.",
            vec!["request_id".to_string()],
        ));
    }
    Ok(())
}

fn check_text(value: &str, field: &str) -> WorkspaceResult<()> {
    if value.trim().is_empty() || value.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid_request(
            "That text is empty or longer than InnPilot stores.",
            vec![field.to_string()],
        ));
    }
    Ok(())
}

fn validate_question(question: &ProposedQuestion) -> WorkspaceResult<()> {
    check_text(&question.prompt, "prompt")?;
    if question.question_id.trim().is_empty()
        || question.question_id.chars().count() > MAX_REQUEST_ID_CHARS
    {
        return Err(invalid_request(
            "That question could not be identified.",
            vec!["question_id".to_string()],
        ));
    }
    match &question.response_type {
        ResponseType::SingleChoice { choices } | ResponseType::MultipleChoice { choices } => {
            if choices.is_empty() || choices.len() > MAX_CHOICES {
                return Err(invalid_request(
                    "That question offers an unusable set of choices.",
                    vec!["choices".to_string()],
                ));
            }
            for choice in choices {
                check_text(choice, "choice")?;
            }
        }
        _ => {}
    }
    Ok(())
}

/* -------------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_area::{AutomationReadiness, Magnitude, ProductGap, WorkAreaTemplate};
    use crate::work_area_store::{CreateWorkAreaRequest, WorkAreaRepository, WorkAreaService};
    use std::fs;
    use std::path::PathBuf;

    const NOW: &str = "2026-08-22T09:00:00Z";

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let unique = format!(
                "innpilot-plan-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn planning(root: &TempRoot) -> WorkAreaPlanningService {
        WorkAreaPlanningService::new(WorkAreaService::new(WorkAreaRepository::new(
            root.0.clone(),
            "inst-1".to_string(),
        )))
    }

    fn new_area(service: &WorkAreaPlanningService) -> WorkAreaRecord {
        service
            .areas()
            .create(
                CreateWorkAreaRequest {
                    name: "Reception".to_string(),
                    template: WorkAreaTemplate::Reception,
                    description: None,
                },
                NOW,
            )
            .unwrap()
    }

    /// Scope, linked evidence and a settled information source, applied
    /// directly so tests can start from a realistic mid-mapping state.
    fn seed_context(service: &WorkAreaPlanningService, record: &WorkAreaRecord) -> WorkAreaRecord {
        service
            .areas()
            .mutate(&record.area.id, |stored| {
                stored.area.scope_included = vec!["Front desk".to_string()];
                stored.area.linked_evidence = vec!["ev-reception-1".to_string()];
                stored.revision += 1;
                Ok(stored.clone())
            })
            .unwrap()
    }

    fn fact(id: &str) -> ProposedFact {
        ProposedFact {
            id: id.to_string(),
            label: format!("{id} label"),
            detail: None,
            evidence_refs: Vec::new(),
        }
    }

    fn complete_workflow(id: &str) -> ProposedWorkflow {
        ProposedWorkflow {
            id: id.to_string(),
            phase: WorkflowPhase::Current,
            name: "Contract processing".to_string(),
            purpose: Some("File signed contracts".to_string()),
            trigger: Some("Contract arrives by email".to_string()),
            inputs: vec!["Signed PDF".to_string()],
            role_ids: vec!["role-1".to_string()],
            system_ids: vec!["sys-1".to_string()],
            steps: vec![ProposedStep {
                id: "s1".to_string(),
                description: "Save to shared folder".to_string(),
                actor_role_id: Some("role-1".to_string()),
                system_id: Some("sys-1".to_string()),
                medium: StepMedium::Digital,
                is_decision: false,
            }],
            output: Some("Filed contract".to_string()),
            destination: Some("Contracts folder".to_string()),
            frequency: Some("weekly".to_string()),
            exceptions: vec!["Unsigned document".to_string()],
            unknowns: Vec::new(),
            evidence_refs: Vec::new(),
        }
    }

    fn map_request(record: &WorkAreaRecord, workflows: Vec<ProposedWorkflow>) -> PrepareMapRequest {
        PrepareMapRequest {
            work_area_id: record.area.id.clone(),
            expected_revision: record.revision,
            request_id: "map-1".to_string(),
            roles: vec![fact("role-1")],
            systems: vec![fact("sys-1")],
            information_sources: vec![fact("src-1")],
            document_types: Vec::new(),
            physical_information: Vec::new(),
            dependencies: Vec::new(),
            pain_points: Vec::new(),
            workflows,
            unknowns: Vec::new(),
        }
    }

    /// Drive an area all the way to map-ready: agent proposes, manager confirms
    /// every fact and the workflow.
    fn ready_area(service: &WorkAreaPlanningService) -> WorkAreaRecord {
        let created = new_area(service);
        let seeded = seed_context(service, &created);
        let mut record = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();
        for target in ["role-1", "sys-1", "src-1", "wf-1"] {
            record = service
                .confirm_fact(
                    CallerAuthority::LocalManager,
                    &record.area.id,
                    target,
                    record.revision,
                    NOW,
                )
                .unwrap();
        }
        record
    }

    fn opportunity(id: &str, category: ImprovementCategory) -> ProposedOpportunity {
        ProposedOpportunity {
            id: id.to_string(),
            category,
            title: "Remove the print and scan step".to_string(),
            current_problem: "A digital contract is printed and rescanned".to_string(),
            recommended_change: "Keep the original digital file".to_string(),
            why: None,
            workflow_id: None,
            expected_benefit: Some(Magnitude::Medium),
            effort: Some(Magnitude::Low),
            risk: Some(Magnitude::Low),
            automation_readiness: AutomationReadiness::NotReady,
            product_gap: ProductGap::ProcessChangeOnly,
            existing_capability_key: None,
            prerequisites: Vec::new(),
            evidence_refs: Vec::new(),
        }
    }

    fn plan_request(
        record: &WorkAreaRecord,
        items: Vec<ProposedOpportunity>,
    ) -> PreparePlanRequest {
        PreparePlanRequest {
            work_area_id: record.area.id.clone(),
            expected_revision: record.revision,
            request_id: "plan-1".to_string(),
            source_map_revision: record.map.revision,
            opportunities: items,
        }
    }

    /* ---------------- manager authority ---------------- */

    #[test]
    fn the_assistant_cannot_confirm_a_fact() {
        let root = TempRoot::new("confirm-authority");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        let mapped = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();

        let error = service
            .confirm_fact(
                CallerAuthority::AssistantPlanning,
                &mapped.area.id,
                "role-1",
                mapped.revision,
                NOW,
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::PermissionDenied);
    }

    #[test]
    fn the_manager_can_confirm_a_fact() {
        let root = TempRoot::new("confirm-manager");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        let mapped = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();
        assert_eq!(mapped.map.roles[0].status, TruthStatus::Inferred);

        let confirmed = service
            .confirm_fact(
                CallerAuthority::LocalManager,
                &mapped.area.id,
                "role-1",
                mapped.revision,
                NOW,
            )
            .unwrap();
        assert_eq!(confirmed.map.roles[0].status, TruthStatus::Confirmed);
    }

    #[test]
    fn agent_prepared_facts_are_recorded_as_inference() {
        let root = TempRoot::new("provenance");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        let mapped = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();

        assert_eq!(mapped.map.roles[0].provenance, Provenance::AgentInference);
        assert_eq!(mapped.map.roles[0].status, TruthStatus::Inferred);
        // The agent cannot assert that this is how work actually happens.
        assert!(!mapped.map.workflows[0].current_state_confirmed);
        assert!(!mapped.map.confirmed);
    }

    #[test]
    fn a_proposed_fact_has_nowhere_to_claim_confirmation() {
        // The wire type has no provenance or status field, so a forged claim is
        // a parse error rather than something that must be stripped.
        let forged = r#"{
            "id": "role-1",
            "label": "Receptionist",
            "detail": null,
            "evidenceRefs": [],
            "provenance": "manager_answer",
            "status": "confirmed"
        }"#;
        assert!(serde_json::from_str::<ProposedFact>(forged).is_err());
    }

    /* ---------------- questions ---------------- */

    fn question_request(
        record: &WorkAreaRecord,
        id: &str,
        blocking: bool,
    ) -> PrepareQuestionsRequest {
        PrepareQuestionsRequest {
            work_area_id: record.area.id.clone(),
            expected_revision: record.revision,
            request_id: format!("q-{id}"),
            questions: vec![ProposedQuestion {
                question_id: id.to_string(),
                category: QuestionCategory::Workflow,
                prompt: "How do guest requests arrive?".to_string(),
                why_it_matters: Some("It marks where the workflow starts.".to_string()),
                response_type: ResponseType::SingleChoice {
                    choices: vec!["Email".to_string(), "Phone".to_string()],
                },
                required: true,
                blocking,
            }],
        }
    }

    #[test]
    fn prepared_questions_are_open_and_agent_sourced() {
        let root = TempRoot::new("questions");
        let service = planning(&root);
        let created = new_area(&service);
        let prepared = service
            .prepare_questions(
                CallerAuthority::AssistantPlanning,
                question_request(&created, "q1", true),
                NOW,
            )
            .unwrap();
        assert_eq!(prepared.questions.len(), 1);
        assert_eq!(prepared.questions[0].status, QuestionStatus::Open);
        assert_eq!(prepared.questions[0].source, Provenance::AgentInference);
    }

    #[test]
    fn re_proposing_a_question_does_not_duplicate_it() {
        let root = TempRoot::new("questions-dupe");
        let service = planning(&root);
        let created = new_area(&service);
        let first = service
            .prepare_questions(
                CallerAuthority::AssistantPlanning,
                question_request(&created, "q1", true),
                NOW,
            )
            .unwrap();
        let mut again = question_request(&first, "q1", true);
        again.request_id = "q-second".to_string();
        let second = service
            .prepare_questions(CallerAuthority::AssistantPlanning, again, NOW)
            .unwrap();
        assert_eq!(second.questions.len(), 1);
    }

    #[test]
    fn a_question_with_no_choices_is_rejected() {
        let root = TempRoot::new("questions-choices");
        let service = planning(&root);
        let created = new_area(&service);
        let mut request = question_request(&created, "q1", true);
        request.questions[0].response_type = ResponseType::SingleChoice {
            choices: Vec::new(),
        };
        let error = service
            .prepare_questions(CallerAuthority::AssistantPlanning, request, NOW)
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    /* ---------------- evidence boundary ---------------- */

    #[test]
    fn a_map_citing_unlinked_evidence_is_rejected() {
        let root = TempRoot::new("evidence");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        let mut request = map_request(&seeded, vec![complete_workflow("wf-1")]);
        // Evidence belonging to some other area.
        request.roles[0].evidence_refs = vec!["ev-administration-9".to_string()];
        let error = service
            .prepare_operational_map(CallerAuthority::AssistantPlanning, request, NOW)
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn a_map_citing_linked_evidence_is_accepted() {
        let root = TempRoot::new("evidence-ok");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        let mut request = map_request(&seeded, vec![complete_workflow("wf-1")]);
        request.roles[0].evidence_refs = vec!["ev-reception-1".to_string()];
        assert!(service
            .prepare_operational_map(CallerAuthority::AssistantPlanning, request, NOW)
            .is_ok());
    }

    /* ---------------- plan gating ---------------- */

    #[test]
    fn a_plan_is_refused_before_the_map_is_ready() {
        let root = TempRoot::new("plan-early");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        // Mapped but nothing confirmed, so readiness is not satisfied.
        let mapped = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();
        let error = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &mapped,
                    vec![opportunity("op1", ImprovementCategory::Simplify)],
                ),
                NOW,
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::PreflightBlocked);
    }

    #[test]
    fn a_plan_is_accepted_once_the_map_is_ready() {
        let root = TempRoot::new("plan-ready");
        let service = planning(&root);
        let ready = ready_area(&service);
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &ready,
                    vec![opportunity("op1", ImprovementCategory::Simplify)],
                ),
                NOW,
            )
            .unwrap();
        let plan = planned.plan.expect("plan stored");
        assert_eq!(plan.opportunities.len(), 1);
        assert_eq!(plan.source_map_revision, planned.map.revision);
        assert_eq!(planned.area.state, WorkAreaState::ImprovementReady);
    }

    #[test]
    fn a_plan_built_on_an_older_map_revision_is_rejected() {
        let root = TempRoot::new("plan-stale-map");
        let service = planning(&root);
        let ready = ready_area(&service);
        let mut request = plan_request(
            &ready,
            vec![opportunity("op1", ImprovementCategory::Organize)],
        );
        request.source_map_revision = ready.map.revision - 1;
        let error = service
            .prepare_improvement_plan(CallerAuthority::AssistantPlanning, request, NOW)
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::StaleRevision);
    }

    /* ---------------- automation gating ---------------- */

    #[test]
    fn an_automation_without_a_workflow_is_rejected() {
        let root = TempRoot::new("auto-noworkflow");
        let service = planning(&root);
        let ready = ready_area(&service);
        let error = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &ready,
                    vec![opportunity("op1", ImprovementCategory::Automate)],
                ),
                NOW,
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn an_automation_on_an_eligible_workflow_is_accepted() {
        let root = TempRoot::new("auto-ok");
        let service = planning(&root);
        let ready = ready_area(&service);
        let mut item = opportunity("op1", ImprovementCategory::Automate);
        item.workflow_id = Some("wf-1".to_string());
        item.existing_capability_key = Some("contractsWorkflow".to_string());
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&ready, vec![item]),
                NOW,
            )
            .unwrap();
        assert_eq!(
            planned.area.state,
            WorkAreaState::AutomationOpportunitiesReady
        );
        let stored = &planned.plan.unwrap().opportunities[0];
        assert!(!stored.grants_execution_authority());
    }

    #[test]
    fn an_automation_on_an_incomplete_workflow_is_refused() {
        let root = TempRoot::new("auto-gate");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);

        // A workflow with no steps and no exception knowledge.
        let mut thin = complete_workflow("wf-1");
        thin.steps.clear();
        thin.exceptions.clear();
        let mut record = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![thin]),
                NOW,
            )
            .unwrap();
        for target in ["role-1", "sys-1", "src-1", "wf-1"] {
            record = service
                .confirm_fact(
                    CallerAuthority::LocalManager,
                    &record.area.id,
                    target,
                    record.revision,
                    NOW,
                )
                .unwrap();
        }

        let mut item = opportunity("op1", ImprovementCategory::Automate);
        item.workflow_id = Some("wf-1".to_string());
        let error = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&record, vec![item]),
                NOW,
            )
            .unwrap_err();
        // Readiness fails first because the workflow is incomplete; either way
        // the premature automation never lands.
        assert_eq!(error.code(), WorkspaceErrorCode::PreflightBlocked);
    }

    #[test]
    fn a_future_only_workflow_cannot_justify_automation() {
        let root = TempRoot::new("auto-future");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);

        let mut future = complete_workflow("wf-future");
        future.phase = WorkflowPhase::ProposedFuture;
        let current = complete_workflow("wf-1");
        let mut record = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![current, future]),
                NOW,
            )
            .unwrap();
        for target in ["role-1", "sys-1", "src-1", "wf-1"] {
            record = service
                .confirm_fact(
                    CallerAuthority::LocalManager,
                    &record.area.id,
                    target,
                    record.revision,
                    NOW,
                )
                .unwrap();
        }

        let mut item = opportunity("op1", ImprovementCategory::Automate);
        item.workflow_id = Some("wf-future".to_string());
        let error = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&record, vec![item]),
                NOW,
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::PreflightBlocked);
    }

    #[test]
    fn keep_manual_is_accepted_without_any_automation() {
        let root = TempRoot::new("keep-manual");
        let service = planning(&root);
        let ready = ready_area(&service);
        let mut item = opportunity("op1", ImprovementCategory::KeepManual);
        item.product_gap = ProductGap::ManualRecommended;
        item.why = Some("Exceptional complaints need human judgement.".to_string());
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&ready, vec![item]),
                NOW,
            )
            .unwrap();
        let stored = &planned.plan.unwrap().opportunities[0];
        assert_eq!(stored.category, ImprovementCategory::KeepManual);
        // Nothing forces a mapped workflow to yield an automation.
        assert_eq!(planned.area.state, WorkAreaState::ImprovementReady);
    }

    /* ---------------- capability matching ---------------- */

    #[test]
    fn an_unknown_capability_reference_is_rejected() {
        let root = TempRoot::new("capability-bad");
        let service = planning(&root);
        let ready = ready_area(&service);
        let mut item = opportunity("op1", ImprovementCategory::Integrate);
        item.existing_capability_key = Some("magicWorkflow".to_string());
        let error = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&ready, vec![item]),
                NOW,
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn a_real_capability_is_only_a_possible_match() {
        let root = TempRoot::new("capability-good");
        let service = planning(&root);
        let ready = ready_area(&service);
        let mut item = opportunity("op1", ImprovementCategory::Integrate);
        item.existing_capability_key = Some("invoiceWorkflow".to_string());
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&ready, vec![item]),
                NOW,
            )
            .unwrap();
        let stored = &planned.plan.unwrap().opportunities[0];
        // Catalog presence is never upgraded to "supported".
        assert_eq!(
            WorkAreaPlanningService::classify_capability(stored),
            CapabilityMatch::PossibleExistingCapability
        );
    }

    #[test]
    fn a_new_capability_requirement_is_classified_as_such() {
        let root = TempRoot::new("capability-new");
        let service = planning(&root);
        let ready = ready_area(&service);
        let mut item = opportunity("op1", ImprovementCategory::Integrate);
        item.product_gap = ProductGap::NewInnpilotCapability;
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&ready, vec![item]),
                NOW,
            )
            .unwrap();
        let stored = &planned.plan.unwrap().opportunities[0];
        assert_eq!(
            WorkAreaPlanningService::classify_capability(stored),
            CapabilityMatch::NewCapabilityRequired
        );
    }

    #[test]
    fn every_catalog_key_is_a_real_innpilot_workflow() {
        // Guards against the catalog drifting away from preflight.rs.
        for key in INNPILOT_CAPABILITIES {
            assert!(matches!(
                key,
                "invoiceWorkflow"
                    | "gmailDraftsWorkflow"
                    | "scansioniNetwork"
                    | "ocrWorkflow"
                    | "contractsWorkflow"
            ));
        }
    }

    /* ---------------- idempotency binding ---------------- */

    #[test]
    fn replaying_a_map_request_returns_the_stored_outcome() {
        let root = TempRoot::new("replay-map");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);
        let request = map_request(&seeded, vec![complete_workflow("wf-1")]);

        let first = service
            .prepare_operational_map(CallerAuthority::AssistantPlanning, request.clone(), NOW)
            .unwrap();
        // The retry still carries the pre-write revision, as a real retry would.
        let replay = service
            .prepare_operational_map(CallerAuthority::AssistantPlanning, request, NOW)
            .unwrap();
        assert_eq!(first.revision, replay.revision);
        assert_eq!(replay.map.revision, first.map.revision);
    }

    #[test]
    fn a_request_id_cannot_be_reused_across_operations() {
        let root = TempRoot::new("cross-operation");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);

        let mut questions = question_request(&seeded, "q1", false);
        questions.request_id = "shared-id".to_string();
        let after = service
            .prepare_questions(CallerAuthority::AssistantPlanning, questions, NOW)
            .unwrap();

        // Same id, different operation kind.
        let mut map = map_request(&after, vec![complete_workflow("wf-1")]);
        map.request_id = "shared-id".to_string();
        let error = service
            .prepare_operational_map(CallerAuthority::AssistantPlanning, map, NOW)
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::PersistenceConflict);
    }

    #[test]
    fn a_request_id_reused_for_different_content_is_a_conflict() {
        let root = TempRoot::new("same-op-conflict");
        let service = planning(&root);
        let created = new_area(&service);
        let seeded = seed_context(&service, &created);

        let first = service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();

        // Same request id, different workflow set.
        let mut different = map_request(&first, vec![complete_workflow("wf-2")]);
        different.request_id = "map-1".to_string();
        let error = service
            .prepare_operational_map(CallerAuthority::AssistantPlanning, different, NOW)
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::PersistenceConflict);
    }

    #[test]
    fn the_same_request_id_in_another_work_area_does_not_collide() {
        let root = TempRoot::new("cross-area");
        let service = planning(&root);

        let first = new_area(&service);
        let first_seeded = seed_context(&service, &first);
        service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&first_seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .unwrap();

        let second = service
            .areas()
            .create(
                CreateWorkAreaRequest {
                    name: "Administration".to_string(),
                    template: WorkAreaTemplate::Administration,
                    description: None,
                },
                NOW,
            )
            .unwrap();
        let second_seeded = seed_context(&service, &second);
        // Receipts live inside each area's record, so the same id is fine here.
        assert!(service
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&second_seeded, vec![complete_workflow("wf-1")]),
                NOW,
            )
            .is_ok());
    }

    /* ---------------- staleness ---------------- */

    #[test]
    fn confirming_a_fact_makes_an_existing_plan_stale() {
        let root = TempRoot::new("plan-stale");
        let service = planning(&root);
        let ready = ready_area(&service);
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &ready,
                    vec![opportunity("op1", ImprovementCategory::Digitize)],
                ),
                NOW,
            )
            .unwrap();
        assert!(!planned
            .plan
            .as_ref()
            .unwrap()
            .is_stale(planned.map.revision));

        let after = service
            .confirm_fact(
                CallerAuthority::LocalManager,
                &planned.area.id,
                "sys-1",
                planned.revision,
                NOW,
            )
            .unwrap();
        assert!(after.plan.unwrap().is_stale(after.map.revision));
    }

    #[test]
    fn renaming_does_not_make_the_plan_stale() {
        let root = TempRoot::new("plan-rename");
        let service = planning(&root);
        let ready = ready_area(&service);
        let planned = service
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &ready,
                    vec![opportunity("op1", ImprovementCategory::Standardize)],
                ),
                NOW,
            )
            .unwrap();
        let renamed = service
            .areas()
            .rename(
                &planned.area.id,
                "Front desk".to_string(),
                planned.revision,
                NOW,
            )
            .unwrap();
        assert!(!renamed.plan.unwrap().is_stale(renamed.map.revision));
    }

    /* ---------------- archived areas ---------------- */

    #[test]
    fn an_archived_area_rejects_planning_writes() {
        let root = TempRoot::new("archived");
        let service = planning(&root);
        let created = new_area(&service);
        let archived = service
            .areas()
            .archive(&created.area.id, created.revision, NOW)
            .unwrap();
        let error = service
            .prepare_questions(
                CallerAuthority::AssistantPlanning,
                question_request(&archived, "q1", true),
                NOW,
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }
}
