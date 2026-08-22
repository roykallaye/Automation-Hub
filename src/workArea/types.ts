/*
  Work Area types, mirroring the Rust projections in `work_area_view.rs`.

  These are shapes, not logic. Nothing in the frontend decides whether a map is
  ready, whether a plan is stale, whether a fact is settled or whether a
  workflow may be automated — the backend has already decided all of it and
  these types simply carry the answer. If a screen appears to need a rule, the
  rule belongs in the aggregate.
*/

export type WorkAreaState =
  | "not_started"
  | "scope_defined"
  | "mapping"
  | "needs_input"
  | "map_ready"
  | "improvement_planning"
  | "improvement_ready"
  | "automation_opportunities_ready"
  | "map_needs_review"
  | "archived";

export type WorkAreaTemplate =
  | "reception"
  | "administration"
  | "sales"
  | "purchasing"
  | "housekeeping"
  | "maintenance"
  | "management"
  | "food_and_beverage"
  | "marketing"
  | "custom";

export type Provenance =
  | "manager_answer"
  | "structural_discovery"
  | "existing_configuration"
  | "system_status"
  | "agent_inference"
  | "manual_entry";

export type TruthStatus =
  | "observed"
  | "stated"
  | "inferred"
  | "confirmed"
  | "disputed"
  | "unknown";

export type QuestionCategory =
  | "scope"
  | "roles"
  | "systems"
  | "information_sources"
  | "documents"
  | "physical_information"
  | "workflow"
  | "rules"
  | "dependencies"
  | "pain_points"
  | "baseline";

export type QuestionStatus = "open" | "answered" | "skipped" | "superseded";

/** The shape of answer a question accepts. The backend enforces the match. */
export type ResponseType =
  | { kind: "yes_no" }
  | { kind: "single_choice"; choices: string[] }
  | { kind: "multiple_choice"; choices: string[] }
  | { kind: "short_text" }
  | { kind: "number" }
  | { kind: "duration" }
  | { kind: "frequency" };

export type AnswerValue =
  | { kind: "yes_no"; value: boolean }
  | { kind: "choice"; value: string }
  | { kind: "choices"; values: string[] }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "duration"; value: string }
  | { kind: "frequency"; value: string };

export type StepMedium = "digital" | "physical" | "tacit";
export type WorkflowPhase = "current" | "proposed_future";
export type SectionCoverage = "empty" | "partial" | "complete";

/** Why a workflow cannot yet yield an automation candidate. */
export type WorkflowGap =
  | "missing_purpose"
  | "missing_trigger"
  | "missing_inputs"
  | "missing_steps"
  | "missing_output"
  | "missing_actor_or_system"
  | "exceptions_not_assessed"
  | "current_state_unconfirmed"
  | "blocking_questions_open"
  | "not_current_state";

export type ImprovementCategory =
  | "digitize"
  | "organize"
  | "standardize"
  | "simplify"
  | "integrate"
  | "automate"
  | "keep_manual";

export type AutomationReadiness =
  | "not_ready"
  | "needs_digitization"
  | "needs_standardization"
  | "needs_integration"
  | "candidate"
  | "future_product_capability"
  | "existing_innpilot_capability"
  | "not_recommended";

export type ProductGap =
  | "process_change_only"
  | "existing_innpilot_configuration"
  | "existing_external_system_feature"
  | "integration_opportunity"
  | "new_innpilot_capability"
  | "manual_recommended"
  | "needs_more_information";

export type Magnitude = "low" | "medium" | "high";

/** Catalog presence yields only `possible_existing_capability`, never proof. */
export type CapabilityMatch =
  | "no_match"
  | "possible_existing_capability"
  | "new_capability_required";

export type WorkAreaSummary = {
  id: string;
  name: string;
  template: WorkAreaTemplate;
  state: WorkAreaState;
  revision: number;
  workflowsMapped: number;
  openBlockingQuestions: number;
  mapReady: boolean;
  planStale: boolean;
};

export type Fact = {
  id: string;
  label: string;
  detail: string | null;
  provenance: Provenance;
  status: TruthStatus;
};

export type WorkflowStep = {
  id: string;
  description: string;
  actorRoleId: string | null;
  systemId: string | null;
  medium: StepMedium;
  isDecision: boolean;
};

export type MappedWorkflow = {
  id: string;
  phase: WorkflowPhase;
  name: string;
  purpose: string | null;
  trigger: string | null;
  inputs: string[];
  roleIds: string[];
  systemIds: string[];
  steps: WorkflowStep[];
  output: string | null;
  destination: string | null;
  frequency: string | null;
  exceptions: string[];
  unknowns: string[];
  currentStateConfirmed: boolean;
  automationGaps: WorkflowGap[];
};

export type MapReadiness = {
  ready: boolean;
  scope: SectionCoverage;
  roles: SectionCoverage;
  systems: SectionCoverage;
  informationSources: SectionCoverage;
  workflowsMapped: number;
  workflowsIncomplete: number;
  openBlockingQuestions: number;
  unsettledFacts: number;
};

export type WorkAreaQuestion = {
  questionId: string;
  category: QuestionCategory;
  prompt: string;
  whyItMatters: string | null;
  responseType: ResponseType;
  required: boolean;
  blocking: boolean;
  status: QuestionStatus;
  managerAnswer: string | null;
};

export type OperationalMap = {
  workAreaId: string;
  mapRevision: number;
  confirmed: boolean;
  preparedAt: string | null;
  roles: Fact[];
  systems: Fact[];
  informationSources: Fact[];
  documentTypes: Fact[];
  physicalInformation: Fact[];
  dependencies: Fact[];
  painPoints: Fact[];
  workflows: MappedWorkflow[];
  unknowns: string[];
  readiness: MapReadiness;
};

export type WorkAreaContext = {
  id: string;
  name: string;
  template: WorkAreaTemplate;
  state: WorkAreaState;
  revision: number;
  description: string | null;
  scopeIncluded: string[];
  scopeExcluded: string[];
  linkedEvidence: string[];
  map: OperationalMap;
  questions: WorkAreaQuestion[];
  planPresent: boolean;
  planStale: boolean;
};

export type Opportunity = {
  id: string;
  category: ImprovementCategory;
  title: string;
  currentProblem: string;
  recommendedChange: string;
  why: string | null;
  workflowId: string | null;
  expectedBenefit: Magnitude | null;
  effort: Magnitude | null;
  risk: Magnitude | null;
  automationReadiness: AutomationReadiness;
  productGap: ProductGap;
  existingCapabilityKey: string | null;
  capabilityMatch: CapabilityMatch;
  prerequisites: string[];
};

export type ImprovementPlan = {
  workAreaId: string;
  revision: number;
  sourceMapRevision: number;
  currentMapRevision: number;
  stale: boolean;
  preparedAt: string;
  opportunities: Opportunity[];
};

export type WorkAreaDetail = {
  context: WorkAreaContext;
  plan: ImprovementPlan | null;
};

/** One opportunity plus the area it came from, for the Automations page. */
export type OpportunityListing = {
  workAreaId: string;
  workAreaName: string;
  planStale: boolean;
  opportunity: Opportunity;
};

export type CreateWorkAreaCommand = {
  name: string;
  template: WorkAreaTemplate;
  description: string | null;
  responsibilities: string[];
};
