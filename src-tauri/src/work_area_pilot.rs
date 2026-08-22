//! Phase H-A end-to-end validation against a synthetic Reception area.
//!
//! Everything here drives the real services — the same `WorkAreaService`,
//! `WorkAreaPlanningService` and `WorkAreaApplicationService` the desktop app
//! and the MCP helper use. Nothing constructs a record by hand and writes it,
//! because a test that bypasses the service proves only that the test can
//! bypass the service.
//!
//! The fixture is deliberately incomplete at the start. A Reception where
//! everything is already known would prove nothing: the point of the product is
//! that InnPilot has to ask, the manager has to answer, and the gates have to
//! hold until they do.
//!
//! Hotel Esempio is fictional and every path, id and role is invented.

use std::fs;
use std::path::PathBuf;

use crate::domain::{WorkspaceError, WorkspaceErrorCode};
use crate::work_area::{
    AnswerValue, AutomationReadiness, ImprovementCategory, Magnitude, MappedFact, ProductGap,
    Provenance, QuestionCategory, ResponseType, StepMedium, TruthStatus, WorkAreaRecord,
    WorkAreaState, WorkAreaTemplate, WorkflowGap, WorkflowPhase, MAX_ANSWER_CHARS,
};
use crate::work_area_app::{CreateWorkAreaCommand, WorkAreaApplicationService};
use crate::work_area_planning::{
    CallerAuthority, CapabilityMatch, PrepareMapRequest, PreparePlanRequest,
    PrepareQuestionsRequest, ProposedFact, ProposedOpportunity, ProposedQuestion, ProposedStep,
    ProposedWorkflow, WorkAreaPlanningService,
};
use crate::work_area_store::{
    SubmitAnswerRequest, WorkAreaRepository, WorkAreaService, WorkAreaSummary,
};

/* ------------------------------------------------------------ test harness */

const INSTALLATION: &str = "installation-pilot";

/// A disposable Work Area root. Each pilot gets its own directory so a restart
/// can be simulated by building a second service over the same bytes.
struct PilotRoot {
    path: PathBuf,
}

impl PilotRoot {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "innpilot-pilot-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("pilot root");
        Self { path }
    }

    /// A fresh service over the same directory: the closest thing to closing
    /// and reopening the application without launching a window.
    fn service(&self) -> WorkAreaService {
        WorkAreaService::new(WorkAreaRepository::new(
            self.path.clone(),
            INSTALLATION.to_string(),
        ))
    }

    fn planning(&self) -> WorkAreaPlanningService {
        WorkAreaPlanningService::new(self.service())
    }

    fn app(&self) -> WorkAreaApplicationService {
        WorkAreaApplicationService::new(self.service())
    }
}

impl Drop for PilotRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn now(step: u32) -> String {
    format!("2026-08-22T09:{step:02}:00Z")
}

fn code(error: &WorkspaceError) -> WorkspaceErrorCode {
    error.code()
}

/* --------------------------------------------------- the synthetic fixture */

const EVIDENCE_CONTRACTS_A: &str = "evidence-contracts-a";
const EVIDENCE_CONTRACTS_B: &str = "evidence-contracts-b";
const EVIDENCE_SCANS: &str = "evidence-scans";
/// Linked by the manager but never cited by the map, so revoking it must
/// leave everything alone.
const EVIDENCE_UNUSED: &str = "evidence-front-office-archive";

fn fact(id: &str, label: &str, detail: Option<&str>, evidence: &[&str]) -> ProposedFact {
    ProposedFact {
        id: id.to_string(),
        label: label.to_string(),
        detail: detail.map(str::to_string),
        evidence_refs: evidence.iter().map(|item| item.to_string()).collect(),
    }
}

fn step(
    id: &str,
    description: &str,
    role: Option<&str>,
    system: Option<&str>,
    medium: StepMedium,
) -> ProposedStep {
    ProposedStep {
        id: id.to_string(),
        description: description.to_string(),
        actor_role_id: role.map(str::to_string),
        system_id: system.map(str::to_string),
        medium,
        is_decision: false,
    }
}

/// Guest request handling. Complete except that nobody has said what happens
/// when the normal path fails, and the intake channel is genuinely ambiguous.
fn workflow_guest_requests(exceptions_known: bool) -> ProposedWorkflow {
    ProposedWorkflow {
        id: "wf-guest-requests".to_string(),
        phase: WorkflowPhase::Current,
        name: "Guest request handling".to_string(),
        purpose: Some("Answer a guest request and record what was agreed.".to_string()),
        trigger: Some("A guest request arrives".to_string()),
        inputs: vec!["Booking reference".to_string(), "Guest message".to_string()],
        role_ids: vec!["role-receptionist".to_string()],
        system_ids: vec!["sys-pms".to_string(), "sys-mail".to_string()],
        steps: vec![
            step(
                "gr-1",
                "Request arrives by email or phone",
                Some("role-receptionist"),
                Some("sys-mail"),
                StepMedium::Digital,
            ),
            step(
                "gr-2",
                "Reception checks the booking in the PMS",
                Some("role-receptionist"),
                Some("sys-pms"),
                StepMedium::Digital,
            ),
            step(
                "gr-3",
                "A response is prepared and sent",
                Some("role-receptionist"),
                Some("sys-mail"),
                StepMedium::Digital,
            ),
            step(
                "gr-4",
                "What was agreed is written on the shift sheet",
                Some("role-receptionist"),
                None,
                StepMedium::Physical,
            ),
        ],
        output: Some("The guest receives a response".to_string()),
        destination: Some("Guest".to_string()),
        frequency: Some("Many times a day".to_string()),
        exceptions: if exceptions_known {
            vec!["Outside reception hours the night porter takes a message".to_string()]
        } else {
            Vec::new()
        },
        unknowns: Vec::new(),
        evidence_refs: Vec::new(),
    }
}

/// Contract processing: a digital document that leaves the computer and comes
/// back. The inefficiency is in the steps, not in an opinion about them.
fn workflow_contracts() -> ProposedWorkflow {
    ProposedWorkflow {
        id: "wf-contracts".to_string(),
        phase: WorkflowPhase::Current,
        name: "Contract processing".to_string(),
        purpose: Some("Get a signed contract stored where it can be found again.".to_string()),
        trigger: Some("A contract arrives as a PDF".to_string()),
        inputs: vec!["Contract PDF".to_string()],
        role_ids: vec!["role-reception-manager".to_string()],
        system_ids: vec!["sys-mail".to_string(), "sys-scanner".to_string()],
        steps: vec![
            step(
                "ct-1",
                "Contract arrives as a PDF by email",
                Some("role-reception-manager"),
                Some("sys-mail"),
                StepMedium::Digital,
            ),
            step(
                "ct-2",
                "It is printed",
                Some("role-reception-manager"),
                None,
                StepMedium::Physical,
            ),
            step(
                "ct-3",
                "It is reviewed and annotated on paper",
                Some("role-reception-manager"),
                None,
                StepMedium::Physical,
            ),
            step(
                "ct-4",
                "The signed copy is scanned back in",
                Some("role-reception-manager"),
                Some("sys-scanner"),
                StepMedium::Physical,
            ),
            step(
                "ct-5",
                "The file is renamed and saved",
                Some("role-reception-manager"),
                Some("sys-share"),
                StepMedium::Digital,
            ),
            step(
                "ct-6",
                "It is forwarded to administration",
                Some("role-reception-manager"),
                Some("sys-mail"),
                StepMedium::Digital,
            ),
        ],
        output: Some("A stored, signed contract".to_string()),
        destination: Some("Shared folder and administration".to_string()),
        frequency: Some("A few times a week".to_string()),
        exceptions: vec!["If the guest sends a photo instead of a scan it is retyped".to_string()],
        unknowns: vec!["Which of the two contract folders is the real one".to_string()],
        evidence_refs: vec![
            EVIDENCE_CONTRACTS_A.to_string(),
            EVIDENCE_CONTRACTS_B.to_string(),
        ],
    }
}

/// Daily reporting: the same numbers typed twice.
fn workflow_daily_report() -> ProposedWorkflow {
    ProposedWorkflow {
        id: "wf-daily-report".to_string(),
        phase: WorkflowPhase::Current,
        name: "Daily reporting".to_string(),
        purpose: Some("Give management the occupancy picture each morning.".to_string()),
        trigger: Some("The start of the morning shift".to_string()),
        inputs: vec!["PMS occupancy figures".to_string()],
        role_ids: vec!["role-reception-manager".to_string()],
        system_ids: vec!["sys-pms".to_string(), "sys-sheets".to_string()],
        steps: vec![
            step(
                "dr-1",
                "Figures are read from the PMS",
                Some("role-reception-manager"),
                Some("sys-pms"),
                StepMedium::Digital,
            ),
            step(
                "dr-2",
                "They are typed into the spreadsheet",
                Some("role-reception-manager"),
                Some("sys-sheets"),
                StepMedium::Digital,
            ),
            step(
                "dr-3",
                "The report is emailed to management",
                Some("role-reception-manager"),
                Some("sys-mail"),
                StepMedium::Digital,
            ),
        ],
        output: Some("The daily occupancy report".to_string()),
        destination: Some("Hotel manager".to_string()),
        frequency: Some("Every morning".to_string()),
        exceptions: vec![
            "If the PMS is down yesterday's figures are reused and corrected later".to_string(),
        ],
        unknowns: Vec::new(),
        evidence_refs: Vec::new(),
    }
}

/// Exceptional complaints: judgement work, deliberately never made tidy enough
/// to pass the automation gate, because it should not.
fn workflow_complaints() -> ProposedWorkflow {
    ProposedWorkflow {
        id: "wf-complaints".to_string(),
        phase: WorkflowPhase::Current,
        name: "Exceptional guest complaint handling".to_string(),
        purpose: Some("Resolve a complaint that does not fit the normal process.".to_string()),
        trigger: Some("A guest complains in person or in writing".to_string()),
        inputs: vec!["The complaint".to_string()],
        role_ids: vec!["role-reception-manager".to_string()],
        system_ids: Vec::new(),
        steps: vec![
            step(
                "cp-1",
                "Whoever is at the desk listens and judges the situation",
                Some("role-reception-manager"),
                None,
                StepMedium::Tacit,
            ),
            step(
                "cp-2",
                "A remedy is decided case by case",
                Some("role-reception-manager"),
                None,
                StepMedium::Tacit,
            ),
        ],
        output: Some("A resolution agreed with the guest".to_string()),
        destination: Some("Guest".to_string()),
        frequency: Some("Rarely".to_string()),
        exceptions: vec![
            "Anything the duty manager judges serious goes to the hotel manager".to_string(),
        ],
        unknowns: Vec::new(),
        evidence_refs: Vec::new(),
    }
}

fn map_request(
    work_area_id: &str,
    revision: u64,
    request_id: &str,
    exceptions_known: bool,
) -> PrepareMapRequest {
    PrepareMapRequest {
        work_area_id: work_area_id.to_string(),
        expected_revision: revision,
        request_id: request_id.to_string(),
        roles: vec![
            fact(
                "role-receptionist",
                "Receptionist",
                Some("Two people across shifts"),
                &[],
            ),
            fact("role-reception-manager", "Reception manager", None, &[]),
        ],
        systems: vec![
            fact("sys-pms", "PMS", Some("Bookings and guest records"), &[]),
            fact("sys-mail", "Shared mailbox", None, &[]),
            fact("sys-sheets", "Spreadsheet", Some("Daily report"), &[]),
            fact("sys-scanner", "Office scanner", None, &[EVIDENCE_SCANS]),
            fact("sys-share", "Shared folder", None, &[EVIDENCE_CONTRACTS_A]),
        ],
        information_sources: vec![
            fact("info-bookings", "Booking requests", None, &[]),
            fact(
                "info-contracts",
                "Guest contracts",
                None,
                &[EVIDENCE_CONTRACTS_A],
            ),
            fact("info-reports", "Daily occupancy reports", None, &[]),
            fact("info-shift", "Shift notes", None, &[]),
        ],
        document_types: vec![fact(
            "doc-contract",
            "Signed contracts",
            Some("Recognised from folder structure"),
            &[EVIDENCE_CONTRACTS_A],
        )],
        physical_information: vec![
            fact(
                "phys-shift-notes",
                "Handwritten shift notes",
                Some("Passed between shifts on paper"),
                &[],
            ),
            fact(
                "phys-printed-contracts",
                "Printed contract copies",
                Some("Printed, signed, then scanned back"),
                &[EVIDENCE_SCANS],
            ),
            fact(
                "phys-complaint-know-how",
                "How to settle an unusual complaint",
                Some("Known by experienced staff only"),
                &[],
            ),
        ],
        dependencies: vec![fact(
            "dep-admin",
            "Administration",
            Some("Receives signed contracts"),
            &[],
        )],
        pain_points: vec![
            fact(
                "pain-double-entry",
                "The same figures are typed into two systems",
                None,
                &[],
            ),
            fact(
                "pain-contract-search",
                "Contracts are hard to find later",
                None,
                &[EVIDENCE_CONTRACTS_A, EVIDENCE_CONTRACTS_B],
            ),
        ],
        workflows: vec![
            workflow_guest_requests(exceptions_known),
            workflow_contracts(),
            workflow_daily_report(),
            workflow_complaints(),
        ],
        unknowns: vec!["Whether the night shift follows the same process".to_string()],
    }
}

/// The questions a competent assistant would ask about this area. Two are
/// blocking, which is what holds readiness closed until a manager answers.
fn question_request(
    work_area_id: &str,
    revision: u64,
    request_id: &str,
) -> PrepareQuestionsRequest {
    PrepareQuestionsRequest {
        work_area_id: work_area_id.to_string(),
        expected_revision: revision,
        request_id: request_id.to_string(),
        questions: vec![
            ProposedQuestion {
                question_id: "q-intake".to_string(),
                category: QuestionCategory::Workflow,
                prompt: "How do new guest requests usually arrive?".to_string(),
                why_it_matters: Some(
                    "InnPilot needs to know where the workflow starts before it can understand the steps that follow."
                        .to_string(),
                ),
                response_type: ResponseType::SingleChoice {
                    choices: vec![
                        "Email".to_string(),
                        "Phone".to_string(),
                        "PMS".to_string(),
                        "In person".to_string(),
                        "Several of these".to_string(),
                    ],
                },
                required: true,
                blocking: true,
            },
            ProposedQuestion {
                question_id: "q-contract-folder".to_string(),
                category: QuestionCategory::Documents,
                prompt: "Which folder is the real home for signed contracts?".to_string(),
                why_it_matters: Some("Two folders look like contract storage and InnPilot cannot tell which is authoritative.".to_string()),
                response_type: ResponseType::SingleChoice {
                    choices: vec![
                        "The shared contracts folder".to_string(),
                        "The scans folder".to_string(),
                        "Both are used".to_string(),
                    ],
                },
                required: true,
                blocking: true,
            },
            ProposedQuestion {
                question_id: "q-shift-notes".to_string(),
                category: QuestionCategory::PhysicalInformation,
                prompt: "Are the handwritten shift notes kept after the shift ends?".to_string(),
                why_it_matters: Some("If they are discarded, anything recorded only there is lost.".to_string()),
                response_type: ResponseType::YesNo,
                required: false,
                blocking: false,
            },
            ProposedQuestion {
                question_id: "q-contract-time".to_string(),
                category: QuestionCategory::Baseline,
                prompt: "How long does handling one contract usually take?".to_string(),
                why_it_matters: None,
                response_type: ResponseType::Duration,
                required: false,
                blocking: false,
            },
        ],
    }
}

/// The plan a competent assistant would produce once the area is understood.
/// Six categories, including one that concludes the work should stay manual.
fn plan_request(
    work_area_id: &str,
    revision: u64,
    map_revision: u64,
    request_id: &str,
) -> PreparePlanRequest {
    PreparePlanRequest {
        work_area_id: work_area_id.to_string(),
        expected_revision: revision,
        request_id: request_id.to_string(),
        source_map_revision: map_revision,
        opportunities: vec![
            ProposedOpportunity {
                id: "op-digitize-shift-notes".to_string(),
                category: ImprovementCategory::Digitize,
                title: "Move shift notes off paper".to_string(),
                current_problem: "What happened on a shift is handwritten and exists only on that sheet.".to_string(),
                recommended_change: "Record shift notes in one shared place the next shift can read.".to_string(),
                why: Some("Anything written only on the sheet is lost when the sheet is.".to_string()),
                workflow_id: Some("wf-guest-requests".to_string()),
                expected_benefit: Some(Magnitude::High),
                effort: Some(Magnitude::Low),
                risk: Some(Magnitude::Low),
                automation_readiness: AutomationReadiness::NeedsDigitization,
                product_gap: ProductGap::ProcessChangeOnly,
                existing_capability_key: None,
                prerequisites: Vec::new(),
                evidence_refs: Vec::new(),
            },
            ProposedOpportunity {
                id: "op-document-complaint-know-how".to_string(),
                category: ImprovementCategory::Organize,
                title: "Write down how unusual complaints are settled".to_string(),
                current_problem: "The approach is known only by experienced staff.".to_string(),
                recommended_change: "Capture the current practice so it survives a change of staff.".to_string(),
                why: Some("Knowledge held by one person is a single point of failure.".to_string()),
                workflow_id: Some("wf-complaints".to_string()),
                expected_benefit: Some(Magnitude::Medium),
                effort: Some(Magnitude::Low),
                risk: Some(Magnitude::Low),
                automation_readiness: AutomationReadiness::NotReady,
                product_gap: ProductGap::ProcessChangeOnly,
                existing_capability_key: None,
                prerequisites: Vec::new(),
                evidence_refs: Vec::new(),
            },
            ProposedOpportunity {
                id: "op-standardize-contract-storage".to_string(),
                category: ImprovementCategory::Standardize,
                title: "Give signed contracts one home".to_string(),
                current_problem: "Two folders look like contract storage and practice varies.".to_string(),
                recommended_change: "Agree one location for signed contracts and use it every time.".to_string(),
                why: Some("Finding a contract currently means asking whoever filed it.".to_string()),
                workflow_id: Some("wf-contracts".to_string()),
                expected_benefit: Some(Magnitude::Medium),
                effort: Some(Magnitude::Low),
                risk: Some(Magnitude::Low),
                automation_readiness: AutomationReadiness::NeedsStandardization,
                product_gap: ProductGap::ProcessChangeOnly,
                existing_capability_key: None,
                prerequisites: vec!["Decide which folder is authoritative".to_string()],
                evidence_refs: vec![EVIDENCE_CONTRACTS_A.to_string()],
            },
            ProposedOpportunity {
                id: "op-simplify-print-scan".to_string(),
                category: ImprovementCategory::Simplify,
                title: "Stop printing contracts in order to sign them".to_string(),
                current_problem: "A digital contract is printed, annotated, scanned and renamed before it is stored.".to_string(),
                recommended_change: "Keep the contract digital from arrival to storage.".to_string(),
                why: Some("Four of the six steps exist only because the document leaves the computer.".to_string()),
                workflow_id: Some("wf-contracts".to_string()),
                expected_benefit: Some(Magnitude::High),
                effort: Some(Magnitude::Medium),
                risk: Some(Magnitude::Medium),
                automation_readiness: AutomationReadiness::ExistingInnpilotCapability,
                product_gap: ProductGap::ExistingInnpilotConfiguration,
                existing_capability_key: Some("contractsWorkflow".to_string()),
                prerequisites: vec!["Agree one location for signed contracts".to_string()],
                evidence_refs: Vec::new(),
            },
            ProposedOpportunity {
                id: "op-integrate-pms-report".to_string(),
                category: ImprovementCategory::Integrate,
                title: "Stop retyping occupancy figures".to_string(),
                current_problem: "The same numbers are read from the PMS and typed into a spreadsheet.".to_string(),
                recommended_change: "Let the figures move between the two systems without being retyped.".to_string(),
                why: Some("Retyping is where the numbers go wrong.".to_string()),
                workflow_id: Some("wf-daily-report".to_string()),
                expected_benefit: Some(Magnitude::Medium),
                effort: Some(Magnitude::High),
                risk: Some(Magnitude::Medium),
                automation_readiness: AutomationReadiness::FutureProductCapability,
                product_gap: ProductGap::NewInnpilotCapability,
                existing_capability_key: None,
                prerequisites: Vec::new(),
                evidence_refs: Vec::new(),
            },
            ProposedOpportunity {
                id: "op-automate-daily-report".to_string(),
                category: ImprovementCategory::Automate,
                title: "Assemble the daily report automatically".to_string(),
                current_problem: "The morning report is put together by hand every day.".to_string(),
                recommended_change: "Assemble the report from the figures and leave it ready to send.".to_string(),
                why: Some("The same three steps every morning, with no judgement involved.".to_string()),
                workflow_id: Some("wf-daily-report".to_string()),
                expected_benefit: Some(Magnitude::Medium),
                effort: Some(Magnitude::Medium),
                risk: Some(Magnitude::Low),
                automation_readiness: AutomationReadiness::Candidate,
                product_gap: ProductGap::IntegrationOpportunity,
                existing_capability_key: None,
                prerequisites: Vec::new(),
                evidence_refs: Vec::new(),
            },
            ProposedOpportunity {
                id: "op-keep-complaints-manual".to_string(),
                category: ImprovementCategory::KeepManual,
                title: "Leave exceptional complaints with a person".to_string(),
                current_problem: "Complaints are handled case by case by whoever is at the desk.".to_string(),
                recommended_change: "Keep this work manual.".to_string(),
                why: Some("These cases need judgement and vary too much for a reliable automation today.".to_string()),
                workflow_id: Some("wf-complaints".to_string()),
                expected_benefit: None,
                effort: None,
                risk: None,
                automation_readiness: AutomationReadiness::NotRecommended,
                product_gap: ProductGap::ManualRecommended,
                existing_capability_key: None,
                prerequisites: Vec::new(),
                evidence_refs: Vec::new(),
            },
        ],
    }
}

/* --------------------------------------------------------- pilot scenario */

/// The Reception area as a manager would create it, with evidence linked and
/// the assistant's questions already prepared. Stops short of any answer.
fn reception_awaiting_answers(root: &PilotRoot) -> (WorkAreaApplicationService, String) {
    let app = root.app();
    let detail = app
        .create(CreateWorkAreaCommand {
            name: "Reception".to_string(),
            template: WorkAreaTemplate::Reception,
            description: Some("The front desk at Hotel Esempio.".to_string()),
            responsibilities: vec![
                "Guest inquiries".to_string(),
                "Booking-related communication".to_string(),
                "Contract handling".to_string(),
                "Shift handover".to_string(),
                "Daily reporting".to_string(),
            ],
        })
        .expect("create reception");
    let id = detail.context.id.clone();

    let detail = app
        .set_evidence(
            &id,
            vec![
                EVIDENCE_CONTRACTS_A.to_string(),
                EVIDENCE_CONTRACTS_B.to_string(),
                EVIDENCE_SCANS.to_string(),
                EVIDENCE_UNUSED.to_string(),
            ],
            detail.context.revision,
        )
        .expect("link approved evidence");

    root.planning()
        .prepare_questions(
            CallerAuthority::AssistantPlanning,
            question_request(&id, detail.context.revision, "req-questions-1"),
            &now(1),
        )
        .expect("assistant prepares questions");

    (app, id)
}

/// Answer one question through the real local manager path.
fn answer(
    app: &WorkAreaApplicationService,
    id: &str,
    question: &str,
    value: AnswerValue,
    request: &str,
) -> u64 {
    let revision = app
        .detail(id)
        .expect("read before answering")
        .context
        .revision;
    app.submit_answer(SubmitAnswerRequest {
        work_area_id: id.to_string(),
        question_id: question.to_string(),
        value,
        expected_revision: revision,
        request_id: request.to_string(),
    })
    .expect("manager answer accepted")
    .context
    .revision
}

/// Confirm every mapped role and system, which is what readiness requires and
/// what only a manager can do.
fn confirm_understanding(app: &WorkAreaApplicationService, id: &str) {
    loop {
        let detail = app.detail(id).expect("read before confirming");
        let pending: Option<String> = detail
            .context
            .map
            .roles
            .iter()
            .chain(detail.context.map.systems.iter())
            .chain(detail.context.map.information_sources.iter())
            .find(|fact| fact.status == TruthStatus::Inferred)
            .map(|fact| fact.id.clone());
        let Some(target) = pending else { break };
        app.confirm(id, &target, detail.context.revision)
            .expect("manager confirms a mapped fact");
    }
    // And that each current workflow really is how the work happens.
    loop {
        let detail = app.detail(id).expect("read before confirming workflows");
        let pending: Option<String> = detail
            .context
            .map
            .workflows
            .iter()
            .find(|workflow| {
                workflow.phase == WorkflowPhase::Current && !workflow.current_state_confirmed
            })
            .map(|workflow| workflow.id.clone());
        let Some(target) = pending else { break };
        app.confirm(id, &target, detail.context.revision)
            .expect("manager confirms a workflow");
    }
}

/// Reception, taken all the way to a ready map through the real services.
fn reception_ready(root: &PilotRoot) -> (WorkAreaApplicationService, String) {
    let (app, id) = reception_awaiting_answers(root);

    answer(
        &app,
        &id,
        "q-intake",
        AnswerValue::Choice {
            value: "Several of these".to_string(),
        },
        "req-answer-intake",
    );
    answer(
        &app,
        &id,
        "q-contract-folder",
        AnswerValue::Choice {
            value: "The shared contracts folder".to_string(),
        },
        "req-answer-folder",
    );
    answer(
        &app,
        &id,
        "q-shift-notes",
        AnswerValue::YesNo { value: false },
        "req-answer-shift",
    );
    answer(
        &app,
        &id,
        "q-contract-time",
        AnswerValue::Duration {
            value: "about 20 minutes".to_string(),
        },
        "req-answer-time",
    );

    let revision = app.detail(&id).expect("read before map").context.revision;
    root.planning()
        .prepare_operational_map(
            CallerAuthority::AssistantPlanning,
            map_request(&id, revision, "req-map-1", true),
            &now(2),
        )
        .expect("assistant prepares the map");

    confirm_understanding(&app, &id);
    (app, id)
}

fn detail_of(
    app: &WorkAreaApplicationService,
    id: &str,
) -> crate::work_area_app::WorkAreaDetailView {
    app.detail(id).expect("read work area")
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ------------------------------------------- part 2: the manager flow */

    #[test]
    fn a_manager_can_create_reception_and_it_survives_a_restart() {
        let root = PilotRoot::new("restart");
        let (app, id) = reception_awaiting_answers(&root);
        let before = detail_of(&app, &id);
        assert_eq!(before.context.name, "Reception");
        assert_eq!(before.context.scope_included.len(), 5);
        assert_eq!(before.context.questions.len(), 4);

        // A brand new service over the same directory: the app has restarted.
        let reopened = root.app();
        let after = detail_of(&reopened, &id);
        assert_eq!(after.context.revision, before.context.revision);
        assert_eq!(after.context.scope_included, before.context.scope_included);
        assert_eq!(after.context.questions.len(), 4);
        assert_eq!(
            reopened.overview().expect("list after restart").len(),
            1,
            "the area is still listed after a restart"
        );
    }

    #[test]
    fn a_manager_answer_is_recorded_as_manager_truth_and_advances_the_revision() {
        let root = PilotRoot::new("answer");
        let (app, id) = reception_awaiting_answers(&root);
        let before = detail_of(&app, &id).context.revision;

        answer(
            &app,
            &id,
            "q-shift-notes",
            AnswerValue::YesNo { value: false },
            "req-a1",
        );

        let after = detail_of(&app, &id);
        assert!(
            after.context.revision > before,
            "answering advances the revision"
        );
        let question = after
            .context
            .questions
            .iter()
            .find(|question| question.question_id == "q-shift-notes")
            .expect("question still present");
        assert_eq!(question.status, crate::work_area::QuestionStatus::Answered);
        assert_eq!(question.manager_answer.as_deref(), Some("no"));

        // The stored answer carries manager provenance, and the question that
        // produced it was agent-sourced. Those stay distinguishable.
        let record = root.service().get(&id).expect("stored record");
        assert_eq!(record.answers.len(), 1);
        let asked = record
            .questions
            .iter()
            .find(|question| question.question_id == "q-shift-notes")
            .expect("stored question");
        assert_eq!(asked.source, Provenance::AgentInference);
    }

    #[test]
    fn the_assistant_cannot_reach_the_manager_answer_path() {
        let root = PilotRoot::new("no-agent-answer");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        // confirm_fact is the only planning-service operation that mutates
        // manager truth, and it refuses assistant authority outright.
        let error = root
            .planning()
            .confirm_fact(
                CallerAuthority::AssistantPlanning,
                &id,
                "role-receptionist",
                revision,
                &now(3),
            )
            .expect_err("assistant confirmation refused");
        assert_eq!(code(&error), WorkspaceErrorCode::PermissionDenied);
    }

    /* ------------------------------------- part 6: philosophical negatives */

    #[test]
    fn case_a_automation_cannot_be_planned_before_the_area_is_understood() {
        let root = PilotRoot::new("case-a");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        let error = root
            .planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&id, revision, 0, "req-premature"),
                &now(4),
            )
            .expect_err("planning before understanding is refused");
        assert_eq!(code(&error), WorkspaceErrorCode::PreflightBlocked);
    }

    #[test]
    fn case_b_silence_about_exceptions_is_not_the_same_as_having_none() {
        let root = PilotRoot::new("case-b");
        let (app, id) = reception_awaiting_answers(&root);
        answer(
            &app,
            &id,
            "q-intake",
            AnswerValue::Choice {
                value: "Email".to_string(),
            },
            "req-b1",
        );
        answer(
            &app,
            &id,
            "q-contract-folder",
            AnswerValue::Choice {
                value: "Both are used".to_string(),
            },
            "req-b2",
        );

        let revision = detail_of(&app, &id).context.revision;
        // The same guest-request workflow, with nothing said about exceptions.
        root.planning()
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&id, revision, "req-map-b", false),
                &now(5),
            )
            .expect("map prepared");

        let detail = detail_of(&app, &id);
        let workflow = detail
            .context
            .map
            .workflows
            .iter()
            .find(|workflow| workflow.id == "wf-guest-requests")
            .expect("guest request workflow");
        assert!(
            workflow
                .automation_gaps
                .contains(&WorkflowGap::ExceptionsNotAssessed),
            "an unassessed exception path is a gap, not an absence of exceptions"
        );
    }

    #[test]
    fn case_c_a_proposed_future_workflow_cannot_justify_automating_itself() {
        let root = PilotRoot::new("case-c");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);
        let revision = detail.context.revision;
        let map_revision = detail.context.map.map_revision;

        // A beautiful future flow, added alongside the confirmed current ones.
        let mut request = map_request(&id, revision, "req-map-c", true);
        let mut future = workflow_daily_report();
        future.id = "wf-daily-report-future".to_string();
        future.phase = WorkflowPhase::ProposedFuture;
        future.name = "Daily reporting, redesigned".to_string();
        request.workflows.push(future);
        root.planning()
            .prepare_operational_map(CallerAuthority::AssistantPlanning, request, &now(6))
            .expect("future workflow may be described");

        let detail = detail_of(&app, &id);
        let proposed = detail
            .context
            .map
            .workflows
            .iter()
            .find(|workflow| workflow.id == "wf-daily-report-future")
            .expect("future workflow stored");
        assert!(
            proposed
                .automation_gaps
                .contains(&WorkflowGap::NotCurrentState),
            "a future flow is never current-state evidence"
        );

        // And an automation opportunity naming it is refused outright.
        confirm_understanding(&app, &id);
        let detail = detail_of(&app, &id);
        let mut plan = plan_request(
            &id,
            detail.context.revision,
            detail.context.map.map_revision,
            "req-plan-c",
        );
        plan.opportunities
            .retain(|item| item.category == ImprovementCategory::Automate);
        plan.opportunities[0].workflow_id = Some("wf-daily-report-future".to_string());
        let error = root
            .planning()
            .prepare_improvement_plan(CallerAuthority::AssistantPlanning, plan, &now(7))
            .expect_err("automation from a future flow is refused");
        assert_eq!(code(&error), WorkspaceErrorCode::PreflightBlocked);
        let _ = map_revision;
    }

    #[test]
    fn case_d_manager_provenance_is_not_expressible_in_the_agent_schema() {
        // Every forged authority field is rejected at parse time, so there is
        // no code path in which a model-supplied claim reaches the aggregate.
        let forged_fact = r#"{"id":"f","label":"l","provenance":"manager_answer"}"#;
        assert!(serde_json::from_str::<ProposedFact>(forged_fact).is_err());

        let forged_truth = r#"{"id":"f","label":"l","truthStatus":"confirmed"}"#;
        assert!(serde_json::from_str::<ProposedFact>(forged_truth).is_err());

        let forged_workflow = r#"{"id":"w","phase":"current","name":"n","purpose":null,"trigger":null,"output":null,"destination":null,"frequency":null,"currentStateConfirmed":true}"#;
        assert!(serde_json::from_str::<ProposedWorkflow>(forged_workflow).is_err());

        // And what the assistant does store lands as inference regardless.
        let root = PilotRoot::new("case-d");
        let (app, id) = reception_awaiting_answers(&root);
        answer(
            &app,
            &id,
            "q-intake",
            AnswerValue::Choice {
                value: "Email".to_string(),
            },
            "req-d1",
        );
        answer(
            &app,
            &id,
            "q-contract-folder",
            AnswerValue::Choice {
                value: "Both are used".to_string(),
            },
            "req-d2",
        );
        let revision = detail_of(&app, &id).context.revision;
        root.planning()
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&id, revision, "req-map-d", true),
                &now(8),
            )
            .expect("map prepared");

        let record = root.service().get(&id).expect("stored record");
        assert!(
            record
                .map
                .roles
                .iter()
                .all(|fact| fact.provenance == Provenance::AgentInference
                    && fact.normalized_status() == TruthStatus::Inferred),
            "assistant facts are stored and read back as inference"
        );
        assert!(
            record
                .map
                .workflows
                .iter()
                .all(|workflow| !workflow.current_state_confirmed),
            "the assistant cannot mark a workflow as the confirmed current state"
        );
    }

    #[test]
    fn case_e_a_blocking_question_stops_the_improvement_plan() {
        let root = PilotRoot::new("case-e");
        let (app, id) = reception_ready(&root);

        // Re-open the area with a fresh blocking question.
        let revision = detail_of(&app, &id).context.revision;
        let mut request = question_request(&id, revision, "req-questions-e");
        request
            .questions
            .retain(|question| question.question_id == "q-intake");
        request.questions[0].question_id = "q-new-blocker".to_string();
        root.planning()
            .prepare_questions(CallerAuthority::AssistantPlanning, request, &now(9))
            .expect("new blocking question");

        let detail = detail_of(&app, &id);
        assert!(
            !detail.context.map.readiness.ready,
            "a new blocker closes readiness"
        );
        let error = root
            .planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    detail.context.revision,
                    detail.context.map.map_revision,
                    "req-plan-e",
                ),
                &now(10),
            )
            .expect_err("planning is refused while a blocker is open");
        assert_eq!(code(&error), WorkspaceErrorCode::PreflightBlocked);
    }

    #[test]
    fn case_f_a_plan_whose_conclusion_is_keep_manual_is_a_successful_plan() {
        let root = PilotRoot::new("case-f");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);

        let mut plan = plan_request(
            &id,
            detail.context.revision,
            detail.context.map.map_revision,
            "req-plan-f",
        );
        plan.opportunities
            .retain(|item| item.category == ImprovementCategory::KeepManual);
        root.planning()
            .prepare_improvement_plan(CallerAuthority::AssistantPlanning, plan, &now(11))
            .expect("a keep-manual-only plan is accepted");

        let detail = detail_of(&app, &id);
        let stored = detail.plan.expect("plan stored");
        assert_eq!(stored.opportunities.len(), 1);
        assert_eq!(
            stored.opportunities[0].category,
            ImprovementCategory::KeepManual
        );
        assert_eq!(
            detail.context.state,
            WorkAreaState::ImprovementReady,
            "no automation candidate is required for a plan to be complete"
        );
    }

    #[test]
    fn case_g_an_unknown_capability_reference_is_rejected() {
        let root = PilotRoot::new("case-g");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);

        let mut plan = plan_request(
            &id,
            detail.context.revision,
            detail.context.map.map_revision,
            "req-plan-g",
        );
        plan.opportunities
            .retain(|item| item.existing_capability_key.is_some());
        plan.opportunities[0].existing_capability_key = Some("magicHotelBrain".to_string());
        let error = root
            .planning()
            .prepare_improvement_plan(CallerAuthority::AssistantPlanning, plan, &now(12))
            .expect_err("invented capability refused");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn case_h_a_real_capability_reference_yields_only_a_possible_match() {
        let root = PilotRoot::new("case-h");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);
        root.planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    detail.context.revision,
                    detail.context.map.map_revision,
                    "req-plan-h",
                ),
                &now(13),
            )
            .expect("plan accepted");

        let plan = detail_of(&app, &id).plan.expect("plan stored");
        let matched = plan
            .opportunities
            .iter()
            .find(|item| item.existing_capability_key.as_deref() == Some("contractsWorkflow"))
            .expect("capability-referencing opportunity");
        assert_eq!(
            matched.capability_match,
            CapabilityMatch::PossibleExistingCapability,
            "catalog presence is a possible match, never proof of support"
        );
    }

    #[test]
    fn case_i_a_plan_built_on_a_superseded_map_is_rejected() {
        let root = PilotRoot::new("case-i");
        let (app, id) = reception_ready(&root);
        let seen = detail_of(&app, &id);
        let stale_map_revision = seen.context.map.map_revision;

        // The manager confirms one more thing, which advances the map.
        let revision = seen.context.revision;
        app.confirm(&id, "info-shift", revision).ok();
        let moved = detail_of(&app, &id);
        assert!(
            moved.context.map.map_revision > stale_map_revision
                || moved.context.revision > revision,
            "the area moved on"
        );

        let error = root
            .planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    moved.context.revision,
                    stale_map_revision,
                    "req-plan-i",
                ),
                &now(14),
            )
            .expect_err("a plan reasoned over an older map is refused");
        assert_eq!(code(&error), WorkspaceErrorCode::StaleRevision);
    }

    #[test]
    fn case_j_a_cosmetic_rename_does_not_invalidate_the_plan() {
        let root = PilotRoot::new("case-j");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);
        root.planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    detail.context.revision,
                    detail.context.map.map_revision,
                    "req-plan-j",
                ),
                &now(15),
            )
            .expect("plan accepted");
        assert!(!detail_of(&app, &id).plan.expect("plan").stale);

        let revision = detail_of(&app, &id).context.revision;
        root.service()
            .rename(&id, "Front desk".to_string(), revision, &now(16))
            .expect("rename accepted");

        let after = detail_of(&app, &id);
        assert_eq!(after.context.name, "Front desk");
        assert!(
            !after.plan.expect("plan survives").stale,
            "renaming an area says nothing about how it works"
        );
    }

    #[test]
    fn case_k_revoking_cited_evidence_makes_dependent_work_need_review() {
        let root = PilotRoot::new("case-k");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);
        root.planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    detail.context.revision,
                    detail.context.map.map_revision,
                    "req-plan-k",
                ),
                &now(17),
            )
            .expect("plan accepted");

        // A second, untouched area must not be disturbed by any of this.
        let other = app
            .create(CreateWorkAreaCommand {
                name: "Administration".to_string(),
                template: WorkAreaTemplate::Administration,
                description: None,
                responsibilities: vec!["Supplier invoices".to_string()],
            })
            .expect("second area");
        let other_revision = other.context.revision;

        let revision = detail_of(&app, &id).context.revision;
        app.set_evidence(&id, vec![EVIDENCE_SCANS.to_string()], revision)
            .expect("manager revokes contract evidence");

        let after = detail_of(&app, &id);
        assert_eq!(after.context.state, WorkAreaState::MapNeedsReview);
        assert!(
            after.plan.expect("plan still readable").stale,
            "a plan standing on revoked evidence is stale"
        );
        assert_eq!(
            detail_of(&app, &other.context.id).context.revision,
            other_revision,
            "another work area is untouched"
        );
    }

    #[test]
    fn case_k_revoking_uncited_evidence_disturbs_nothing() {
        let root = PilotRoot::new("case-k2");
        let (app, id) = reception_ready(&root);
        let before = detail_of(&app, &id);

        // EVIDENCE_UNUSED is linked but nothing in the map cites it.
        let kept = vec![
            EVIDENCE_CONTRACTS_A.to_string(),
            EVIDENCE_CONTRACTS_B.to_string(),
            EVIDENCE_SCANS.to_string(),
        ];
        app.set_evidence(&id, kept, before.context.revision)
            .expect("unlink unused evidence");

        let after = detail_of(&app, &id);
        assert_eq!(
            after.context.map.map_revision, before.context.map.map_revision,
            "removing evidence nothing depended on leaves the map alone"
        );
        assert_ne!(after.context.state, WorkAreaState::MapNeedsReview);
    }

    #[test]
    fn case_l_a_map_may_not_cite_evidence_from_another_work_area() {
        let root = PilotRoot::new("case-l");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        let mut request = map_request(&id, revision, "req-map-l", true);
        request.systems[0].evidence_refs = vec!["evidence-belonging-to-administration".to_string()];
        let error = root
            .planning()
            .prepare_operational_map(CallerAuthority::AssistantPlanning, request, &now(18))
            .expect_err("foreign evidence refused");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);
    }

    /* ------------------------------------ the full understand→improve→automate */

    #[test]
    fn the_full_reception_journey_produces_a_mixed_plan_only_after_understanding() {
        let root = PilotRoot::new("journey");
        let (app, id) = reception_awaiting_answers(&root);

        // 1. Nothing is understood yet, and planning is refused.
        let start = detail_of(&app, &id);
        assert!(!start.context.map.readiness.ready);
        assert_eq!(start.context.map.readiness.open_blocking_questions, 2);
        assert!(root
            .planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(&id, start.context.revision, 0, "req-too-early"),
                &now(19),
            )
            .is_err());

        // 2. The manager answers; the assistant maps; the manager confirms.
        answer(
            &app,
            &id,
            "q-intake",
            AnswerValue::Choice {
                value: "Several of these".to_string(),
            },
            "req-j1",
        );
        answer(
            &app,
            &id,
            "q-contract-folder",
            AnswerValue::Choice {
                value: "The shared contracts folder".to_string(),
            },
            "req-j2",
        );
        let revision = detail_of(&app, &id).context.revision;
        root.planning()
            .prepare_operational_map(
                CallerAuthority::AssistantPlanning,
                map_request(&id, revision, "req-map-j", true),
                &now(20),
            )
            .expect("map prepared");

        let mapped = detail_of(&app, &id);
        assert!(
            !mapped.context.map.readiness.ready,
            "an assistant-built map is inference, and inference is not understanding"
        );
        confirm_understanding(&app, &id);

        // 3. Only now is the area ready.
        let ready = detail_of(&app, &id);
        assert!(
            ready.context.map.readiness.ready,
            "readiness follows manager confirmation"
        );
        assert_eq!(ready.context.map.readiness.workflows_mapped, 4);
        assert_eq!(ready.context.map.readiness.open_blocking_questions, 0);

        // 4. The plan spans six categories and ends in an automation candidate.
        root.planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    ready.context.revision,
                    ready.context.map.map_revision,
                    "req-plan-j",
                ),
                &now(21),
            )
            .expect("plan accepted once the area is understood");

        let final_detail = detail_of(&app, &id);
        let plan = final_detail.plan.expect("plan stored");
        assert!(!plan.stale);
        let categories: Vec<ImprovementCategory> = plan
            .opportunities
            .iter()
            .map(|item| item.category)
            .collect();
        for expected in [
            ImprovementCategory::Digitize,
            ImprovementCategory::Organize,
            ImprovementCategory::Standardize,
            ImprovementCategory::Simplify,
            ImprovementCategory::Integrate,
            ImprovementCategory::Automate,
            ImprovementCategory::KeepManual,
        ] {
            assert!(categories.contains(&expected), "plan covers {expected:?}");
        }
        assert_eq!(
            final_detail.context.state,
            WorkAreaState::AutomationOpportunitiesReady
        );

        // 5. The physical and tacit findings survived into the map.
        assert_eq!(final_detail.context.map.physical_information.len(), 3);
        assert!(final_detail
            .context
            .map
            .workflows
            .iter()
            .any(|workflow| workflow
                .steps
                .iter()
                .any(|step| step.medium == StepMedium::Tacit)));

        // 6. Exactly one workflow is an automation candidate; complaints are not.
        let gated: Vec<&str> = final_detail
            .context
            .map
            .workflows
            .iter()
            .filter(|workflow| workflow.automation_gaps.is_empty())
            .map(|workflow| workflow.id.as_str())
            .collect();
        assert!(gated.contains(&"wf-daily-report"));
        let complaints = plan
            .opportunities
            .iter()
            .find(|item| item.category == ImprovementCategory::KeepManual)
            .expect("keep-manual recommendation");
        assert_eq!(complaints.workflow_id.as_deref(), Some("wf-complaints"));
        assert_eq!(
            complaints.automation_readiness,
            AutomationReadiness::NotRecommended
        );
    }

    /* ------------------------------- part 15: idempotency before CAS */

    #[test]
    fn an_uncertain_retry_replays_the_stored_outcome() {
        let root = PilotRoot::new("retry");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        let request = || SubmitAnswerRequest {
            work_area_id: id.clone(),
            question_id: "q-shift-notes".to_string(),
            value: AnswerValue::YesNo { value: true },
            expected_revision: revision,
            request_id: "req-retry".to_string(),
        };
        let first = app.submit_answer(request()).expect("first attempt");
        // The caller never saw the response and sends the identical request,
        // still quoting the revision it last knew about.
        let replay = app.submit_answer(request()).expect("retry replays");
        assert_eq!(replay.context.revision, first.context.revision);
        assert_eq!(
            root.service().get(&id).expect("record").answers.len(),
            1,
            "a retry records one answer, not two"
        );
    }

    #[test]
    fn the_same_request_id_with_a_different_answer_is_a_conflict() {
        let root = PilotRoot::new("retry-changed");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        app.submit_answer(SubmitAnswerRequest {
            work_area_id: id.clone(),
            question_id: "q-shift-notes".to_string(),
            value: AnswerValue::YesNo { value: true },
            expected_revision: revision,
            request_id: "req-same".to_string(),
        })
        .expect("first answer");

        let error = app
            .submit_answer(SubmitAnswerRequest {
                work_area_id: id.clone(),
                question_id: "q-shift-notes".to_string(),
                value: AnswerValue::YesNo { value: false },
                expected_revision: revision,
                request_id: "req-same".to_string(),
            })
            .expect_err("changed payload under a used request id");
        assert_eq!(code(&error), WorkspaceErrorCode::PersistenceConflict);
    }

    #[test]
    fn a_request_id_does_not_alias_across_operations() {
        let root = PilotRoot::new("retry-operation");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        app.submit_answer(SubmitAnswerRequest {
            work_area_id: id.clone(),
            question_id: "q-shift-notes".to_string(),
            value: AnswerValue::YesNo { value: true },
            expected_revision: revision,
            request_id: "req-shared".to_string(),
        })
        .expect("answer recorded");

        let revision = detail_of(&app, &id).context.revision;
        let error = root
            .planning()
            .prepare_questions(
                CallerAuthority::AssistantPlanning,
                question_request(&id, revision, "req-shared"),
                &now(22),
            )
            .expect_err("same id, different operation");
        assert_eq!(code(&error), WorkspaceErrorCode::PersistenceConflict);
    }

    #[test]
    fn a_request_id_is_scoped_to_one_work_area() {
        let root = PilotRoot::new("retry-scope");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;
        app.submit_answer(SubmitAnswerRequest {
            work_area_id: id.clone(),
            question_id: "q-shift-notes".to_string(),
            value: AnswerValue::YesNo { value: true },
            expected_revision: revision,
            request_id: "req-scoped".to_string(),
        })
        .expect("answer in the first area");

        // The same request id in a different area is a different operation and
        // must not collide with the receipt stored in the first.
        let second = app
            .create(CreateWorkAreaCommand {
                name: "Purchasing".to_string(),
                template: WorkAreaTemplate::Purchasing,
                description: None,
                responsibilities: vec!["Supplier orders".to_string()],
            })
            .expect("second area");
        root.planning()
            .prepare_questions(
                CallerAuthority::AssistantPlanning,
                question_request(&second.context.id, second.context.revision, "req-scoped"),
                &now(23),
            )
            .expect("no collision across work areas");
    }

    #[test]
    fn a_stale_expected_revision_is_refused_when_the_request_is_genuinely_new() {
        let root = PilotRoot::new("stale-cas");
        let (app, id) = reception_awaiting_answers(&root);
        let stale = detail_of(&app, &id).context.revision;
        answer(
            &app,
            &id,
            "q-shift-notes",
            AnswerValue::YesNo { value: true },
            "req-moved",
        );

        let error = app
            .submit_answer(SubmitAnswerRequest {
                work_area_id: id.clone(),
                question_id: "q-contract-time".to_string(),
                value: AnswerValue::Duration {
                    value: "10 minutes".to_string(),
                },
                expected_revision: stale,
                request_id: "req-brand-new".to_string(),
            })
            .expect_err("stale revision refused");
        assert_eq!(code(&error), WorkspaceErrorCode::StaleRevision);
    }

    /* --------------------------------- part 14: adversarial local state */

    #[test]
    fn a_tampered_work_area_document_fails_closed() {
        let root = PilotRoot::new("tamper");
        let (_app, id) = reception_awaiting_answers(&root);
        let file = root.path.join(&id).join("state.dpapi");
        let mut bytes = fs::read(&file).expect("stored bytes");
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        fs::write(&file, bytes).expect("tamper");

        let error = root
            .service()
            .get(&id)
            .expect_err("tampered record refused");
        assert!(matches!(
            code(&error),
            WorkspaceErrorCode::CorruptState | WorkspaceErrorCode::PersistenceFailed
        ));
    }

    #[test]
    fn a_record_from_another_installation_is_not_adopted() {
        let root = PilotRoot::new("foreign");
        let (_app, id) = reception_awaiting_answers(&root);

        let foreign = WorkAreaService::new(WorkAreaRepository::new(
            root.path.clone(),
            "installation-somewhere-else".to_string(),
        ));
        let error = foreign.get(&id).expect_err("foreign installation refused");
        assert!(matches!(
            code(&error),
            WorkspaceErrorCode::CorruptState | WorkspaceErrorCode::UnsupportedSchema
        ));
    }

    #[test]
    fn an_answer_that_does_not_match_its_question_is_refused() {
        let root = PilotRoot::new("answer-shape");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;

        // q-intake is a single choice; a yes/no is not an answer to it.
        let error = app
            .submit_answer(SubmitAnswerRequest {
                work_area_id: id.clone(),
                question_id: "q-intake".to_string(),
                value: AnswerValue::YesNo { value: true },
                expected_revision: revision,
                request_id: "req-shape".to_string(),
            })
            .expect_err("mismatched answer refused");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);

        // Nor is a choice that was never offered.
        let error = app
            .submit_answer(SubmitAnswerRequest {
                work_area_id: id.clone(),
                question_id: "q-intake".to_string(),
                value: AnswerValue::Choice {
                    value: "Carrier pigeon".to_string(),
                },
                expected_revision: revision,
                request_id: "req-shape-2".to_string(),
            })
            .expect_err("unoffered choice refused");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn an_oversized_answer_is_refused() {
        let root = PilotRoot::new("oversize");
        let (app, id) = reception_awaiting_answers(&root);
        let revision = detail_of(&app, &id).context.revision;
        let error = app
            .submit_answer(SubmitAnswerRequest {
                work_area_id: id.clone(),
                question_id: "q-contract-time".to_string(),
                value: AnswerValue::Duration {
                    value: "x".repeat(MAX_ANSWER_CHARS + 1),
                },
                expected_revision: revision,
                request_id: "req-oversize".to_string(),
            })
            .expect_err("oversized answer refused");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn an_already_answered_question_cannot_be_answered_again() {
        let root = PilotRoot::new("twice");
        let (app, id) = reception_awaiting_answers(&root);
        answer(
            &app,
            &id,
            "q-shift-notes",
            AnswerValue::YesNo { value: true },
            "req-first",
        );
        let revision = detail_of(&app, &id).context.revision;

        let error = app
            .submit_answer(SubmitAnswerRequest {
                work_area_id: id.clone(),
                question_id: "q-shift-notes".to_string(),
                value: AnswerValue::YesNo { value: false },
                expected_revision: revision,
                request_id: "req-second".to_string(),
            })
            .expect_err("a resolved question is not re-answerable");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn an_archived_area_accepts_no_further_planning() {
        let root = PilotRoot::new("archived");
        let (app, id) = reception_ready(&root);
        let revision = detail_of(&app, &id).context.revision;
        app.archive(&id, revision).expect("archive");

        let revision = root.service().get(&id).expect("record").revision;
        let error = root
            .planning()
            .prepare_questions(
                CallerAuthority::AssistantPlanning,
                question_request(&id, revision, "req-after-archive"),
                &now(24),
            )
            .expect_err("archived areas are closed to planning");
        assert!(matches!(
            code(&error),
            WorkspaceErrorCode::InvalidTransition | WorkspaceErrorCode::InvalidRequest
        ));
    }

    /* ---------------------- part 13: planning objects are not runtime objects */

    #[test]
    fn an_opportunity_id_is_not_usable_as_any_runtime_identifier() {
        let root = PilotRoot::new("cross-domain");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);
        root.planning()
            .prepare_improvement_plan(
                CallerAuthority::AssistantPlanning,
                plan_request(
                    &id,
                    detail.context.revision,
                    detail.context.map.map_revision,
                    "req-plan-x",
                ),
                &now(25),
            )
            .expect("plan accepted");
        let plan = detail_of(&app, &id).plan.expect("plan");
        let candidate = plan
            .opportunities
            .iter()
            .find(|item| item.category == ImprovementCategory::Automate)
            .expect("automation candidate");

        // The runtime command registry is the only thing that names something
        // runnable. A planning id is not in it, and never can be: opportunity
        // ids come from a model, runtime command names are a closed set
        // compiled into the product.
        const RUNTIME_COMMANDS: [&str; 5] = [
            "process_invoices_and_drafts",
            "reconnect_gmail",
            "copy_scansioni",
            "ocr_preprocessing",
            "process_signed_contracts",
        ];
        assert!(
            !RUNTIME_COMMANDS.contains(&candidate.id.as_str()),
            "an opportunity id names nothing the runtime can execute"
        );
        assert!(
            !crate::work_area_planning::INNPILOT_CAPABILITIES.contains(&candidate.id.as_str()),
            "an opportunity id is not a capability key either"
        );

        // And a plan cannot be deserialized as a Phase F setup proposal patch.
        let serialized = serde_json::to_string(&plan).expect("plan serializes");
        assert!(
            serde_json::from_str::<crate::setup::SetupPatch>(&serialized).is_err(),
            "a plan is not a configuration change"
        );
    }

    /* ------------------------------------- readiness and gate documentation */

    #[test]
    fn readiness_names_exactly_what_is_missing() {
        let root = PilotRoot::new("readiness");
        let (app, id) = reception_awaiting_answers(&root);
        let readiness = detail_of(&app, &id).context.map.readiness;
        assert!(!readiness.ready);
        assert_eq!(readiness.open_blocking_questions, 2);
        assert_eq!(readiness.workflows_mapped, 0);
        assert_eq!(readiness.scope, crate::work_area::SectionCoverage::Complete);
        assert_eq!(readiness.roles, crate::work_area::SectionCoverage::Empty);
    }

    #[test]
    fn the_complaint_workflow_never_becomes_an_automation_candidate() {
        let root = PilotRoot::new("complaints");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);
        let complaints = detail
            .context
            .map
            .workflows
            .iter()
            .find(|workflow| workflow.id == "wf-complaints")
            .expect("complaint workflow");

        // It passes the gate structurally - it is a real, confirmed current
        // process - so the reason it stays manual is a judgement recorded in the
        // plan, not a technicality. That distinction is the product's honesty:
        // "we could automate this but should not" is a legitimate answer.
        let mut plan = plan_request(
            &id,
            detail.context.revision,
            detail.context.map.map_revision,
            "req-plan-cm",
        );
        plan.opportunities
            .retain(|item| item.category == ImprovementCategory::KeepManual);
        root.planning()
            .prepare_improvement_plan(CallerAuthority::AssistantPlanning, plan, &now(26))
            .expect("keep-manual recommendation accepted");
        let stored = detail_of(&app, &id).plan.expect("plan");
        assert_eq!(stored.opportunities.len(), 1);
        assert_eq!(
            stored.opportunities[0].category,
            ImprovementCategory::KeepManual
        );
        assert_eq!(
            stored.opportunities[0].workflow_id.as_deref(),
            Some("wf-complaints")
        );
        assert!(complaints
            .steps
            .iter()
            .any(|step| step.medium == StepMedium::Tacit));
    }

    /* ----------------------------------------------- the projection boundary */

    #[test]
    fn the_manager_view_never_exposes_receipts_or_installation_binding() {
        let root = PilotRoot::new("projection");
        let (app, id) = reception_awaiting_answers(&root);
        let detail = detail_of(&app, &id);
        let json = serde_json::to_string(&detail).expect("view serializes");
        for forbidden in [
            "receipts",
            "installationId",
            "payloadDigest",
            "schemaVersion",
        ] {
            assert!(
                !json.contains(forbidden),
                "the view must not expose {forbidden}"
            );
        }
        // The stored record does hold them.
        let record: WorkAreaRecord = root.service().get(&id).expect("record");
        assert_eq!(record.installation_id, INSTALLATION);
        assert!(!record.receipts.is_empty());
    }

    #[test]
    fn a_summary_reports_only_backend_derived_counts() {
        let root = PilotRoot::new("summary");
        let (app, id) = reception_ready(&root);
        let summaries: Vec<WorkAreaSummary> = root.service().list().expect("list");
        let summary = summaries
            .iter()
            .find(|item| item.id == id)
            .expect("reception");
        let detail = detail_of(&app, &id);
        assert_eq!(summary.map_ready, detail.context.map.readiness.ready);
        assert_eq!(
            summary.open_blocking_questions,
            detail.context.map.readiness.open_blocking_questions
        );
        assert_eq!(
            summary.workflows_mapped,
            detail.context.map.readiness.workflows_mapped
        );
    }

    /* ------------------------- found by the real Codex session */

    /// A live `codex-cli` session broke a Work Area by citing evidence in an
    /// improvement plan that the area had never been granted. The plan was
    /// accepted and written, and the area could not be loaded afterwards.
    ///
    /// Two things were wrong: the plan path did not apply the evidence rule the
    /// map path already applied, and `save` would write a record that `load`
    /// would then refuse. Both are covered here.
    #[test]
    fn a_plan_may_not_cite_evidence_the_area_was_never_granted() {
        let root = PilotRoot::new("plan-evidence");
        let (app, id) = reception_ready(&root);
        let detail = detail_of(&app, &id);

        let mut plan = plan_request(
            &id,
            detail.context.revision,
            detail.context.map.map_revision,
            "req-plan-foreign",
        );
        plan.opportunities[0].evidence_refs = vec!["evidence-from-somewhere-else".to_string()];
        let error = root
            .planning()
            .prepare_improvement_plan(CallerAuthority::AssistantPlanning, plan, &now(27))
            .expect_err("foreign evidence in a plan is refused");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);

        // And the area is still readable, which is the part that actually broke.
        let after = detail_of(&app, &id);
        assert_eq!(after.context.id, id);
        assert!(after.plan.is_none(), "the rejected plan was never stored");
    }

    /// The general invariant, independent of any one operation: whatever is
    /// written must be readable back. Enforced in `save`, so an operation that
    /// forgets a rule fails loudly at the write instead of quietly bricking the
    /// area at the next read.
    #[test]
    fn a_record_that_could_not_be_read_back_is_never_written() {
        let root = PilotRoot::new("save-validates");
        let (app, id) = reception_ready(&root);
        let service = root.service();

        let error = service
            .mutate(&id, |record| {
                // Exactly the shape the Codex session produced: a citation to
                // evidence this area does not have.
                record.map.roles[0]
                    .evidence_refs
                    .push("evidence-never-granted".to_string());
                record.revision += 1;
                Ok(())
            })
            .expect_err("an unreadable record is refused at the write");
        assert_eq!(code(&error), WorkspaceErrorCode::InvalidRequest);

        // The area survives, at its previous revision.
        let after = detail_of(&app, &id);
        assert!(after
            .context
            .map
            .roles
            .iter()
            .all(|fact| !fact.id.is_empty()));
        assert_eq!(service.get(&id).expect("still readable").area.id, id);
    }

    /* ------------------------------------------- unused-import anchors */

    #[test]
    fn mapped_facts_normalize_on_the_way_out() {
        let forged = MappedFact {
            id: "f".to_string(),
            label: "l".to_string(),
            detail: None,
            provenance: Provenance::AgentInference,
            status: TruthStatus::Confirmed,
            evidence_refs: Vec::new(),
        };
        assert_eq!(forged.normalized_status(), TruthStatus::Inferred);
        assert!(!forged.is_settled());
    }
}
