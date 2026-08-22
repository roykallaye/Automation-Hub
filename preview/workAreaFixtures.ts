/*
  Synthetic Work Area fixtures.

  A fictional Reception at Hotel Esempio: invented roles, invented systems,
  invented paths under a fake drive. Nothing here comes from a real hotel, and
  the harness never touches a real installation.

  These stand in for what the backend would return, so the previews exercise the
  real projections: a fact carrying its truth status, a plan bound to a map
  revision, a workflow carrying its own automation gaps.
*/

import type {
  Fact,
  ImprovementPlan,
  MappedWorkflow,
  OpportunityListing,
  WorkAreaContext,
  WorkAreaDetail,
  WorkAreaQuestion,
  WorkAreaSummary,
} from "../src/workArea/types";

function fact(
  id: string,
  label: string,
  status: Fact["status"],
  provenance: Fact["provenance"],
  detail?: string,
): Fact {
  return { id, label, detail: detail ?? null, provenance, status };
}

const roles: Fact[] = [
  fact("role-1", "Receptionist", "confirmed", "manager_answer", "Two people, split across shifts"),
  fact("role-2", "Reception manager", "confirmed", "manager_answer"),
  fact("role-3", "Night porter", "inferred", "agent_inference", "Mentioned in the shift notes"),
];

const systems: Fact[] = [
  fact("sys-1", "PMS", "confirmed", "manager_answer", "Bookings and guest records"),
  fact("sys-2", "Gmail", "observed", "existing_configuration"),
  fact("sys-3", "Excel", "stated", "manager_answer", "Daily report spreadsheet"),
  fact("sys-4", "Office scanner", "observed", "structural_discovery"),
];

const informationSources: Fact[] = [
  fact("info-1", "Booking requests", "confirmed", "manager_answer"),
  fact("info-2", "Guest contracts", "observed", "structural_discovery"),
  fact("info-3", "Daily occupancy report", "stated", "manager_answer"),
  fact("info-4", "Supplier confirmations", "inferred", "agent_inference"),
];

const documentTypes: Fact[] = [
  fact("doc-1", "Signed contract copies", "observed", "structural_discovery", "Recognised from folder structure"),
  fact("doc-2", "Invoices from suppliers", "observed", "structural_discovery"),
];

const physicalInformation: Fact[] = [
  fact("phys-1", "Handwritten shift notes", "confirmed", "manager_answer", "Passed between shifts on paper"),
  fact("phys-2", "Printed contract copies", "stated", "manager_answer", "Printed, signed, then scanned back in"),
];

const painPoints: Fact[] = [
  fact("pain-1", "The same booking is typed into two systems", "confirmed", "manager_answer"),
  fact("pain-2", "Contracts are hard to find later", "stated", "manager_answer"),
];

const guestRequests: MappedWorkflow = {
  id: "wf-guest-requests",
  phase: "current",
  name: "Guest request handling",
  purpose: "Answer a guest request and record whatever was agreed.",
  trigger: "Guest request arrives",
  inputs: ["Booking reference", "Guest message"],
  roleIds: ["role-1"],
  systemIds: ["sys-1", "sys-2"],
  steps: [
    { id: "s1", description: "Guest request arrives by email or phone", actorRoleId: "role-1", systemId: "sys-2", medium: "digital", isDecision: false },
    { id: "s2", description: "Reception checks the booking in the PMS", actorRoleId: "role-1", systemId: "sys-1", medium: "digital", isDecision: false },
    { id: "s3", description: "Booking details are reviewed against what the guest asked", actorRoleId: "role-1", systemId: null, medium: "digital", isDecision: true },
    { id: "s4", description: "A confirmation is written by hand and sent", actorRoleId: "role-1", systemId: "sys-2", medium: "digital", isDecision: false },
    { id: "s5", description: "What was agreed is noted on the shift sheet", actorRoleId: "role-1", systemId: null, medium: "physical", isDecision: false },
  ],
  output: "Guest receives a response",
  destination: "Guest",
  frequency: "Many times a day",
  exceptions: [],
  unknowns: ["What happens when the request arrives outside reception hours"],
  currentStateConfirmed: true,
  // Exceptions were never assessed, so the gate still holds this back.
  automationGaps: ["exceptions_not_assessed"],
};

const contractProcessing: MappedWorkflow = {
  id: "wf-contracts",
  phase: "current",
  name: "Contract processing",
  purpose: "Get a signed contract stored where it can be found again.",
  trigger: "Signed document arrives",
  inputs: ["Contract PDF"],
  roleIds: ["role-2"],
  systemIds: ["sys-2", "sys-4"],
  steps: [
    { id: "c1", description: "Contract arrives as a PDF by email", actorRoleId: "role-2", systemId: "sys-2", medium: "digital", isDecision: false },
    { id: "c2", description: "It is printed for signature", actorRoleId: "role-2", systemId: null, medium: "physical", isDecision: false },
    { id: "c3", description: "The signed copy is scanned back in", actorRoleId: "role-2", systemId: "sys-4", medium: "physical", isDecision: false },
    { id: "c4", description: "The file is renamed by hand", actorRoleId: "role-2", systemId: null, medium: "digital", isDecision: false },
    { id: "c5", description: "It is saved wherever the person handling it usually saves it", actorRoleId: "role-2", systemId: null, medium: "tacit", isDecision: false },
  ],
  output: "Stored contract",
  destination: "Shared folder",
  frequency: "A few times a week",
  exceptions: ["If the guest sends a photo instead of a scan, it is retyped"],
  unknowns: [],
  currentStateConfirmed: false,
  automationGaps: ["current_state_unconfirmed"],
};

const dailyReporting: MappedWorkflow = {
  id: "wf-daily-report",
  phase: "current",
  name: "Daily reporting",
  purpose: "Give management the occupancy picture each morning.",
  trigger: "Start of the morning shift",
  inputs: ["PMS occupancy figures"],
  roleIds: ["role-2"],
  systemIds: ["sys-1", "sys-3"],
  steps: [
    { id: "d1", description: "Figures are read from the PMS", actorRoleId: "role-2", systemId: "sys-1", medium: "digital", isDecision: false },
    { id: "d2", description: "They are typed into the spreadsheet", actorRoleId: "role-2", systemId: "sys-3", medium: "digital", isDecision: false },
    { id: "d3", description: "The spreadsheet is emailed to management", actorRoleId: "role-2", systemId: "sys-2", medium: "digital", isDecision: false },
  ],
  output: "Daily occupancy report",
  destination: "Management",
  frequency: "Every morning",
  exceptions: ["If the PMS is down, yesterday's figures are reused and corrected later"],
  unknowns: [],
  currentStateConfirmed: true,
  automationGaps: [],
};

const questions: WorkAreaQuestion[] = [
  {
    questionId: "q-1",
    category: "workflow",
    prompt: "How do new guest requests usually arrive?",
    whyItMatters:
      "InnPilot needs to know where the workflow starts before it can understand the steps that follow.",
    responseType: {
      kind: "single_choice",
      choices: ["Email", "Phone", "PMS", "In person", "Several of these", "Something else"],
    },
    required: true,
    blocking: true,
    status: "open",
    managerAnswer: null,
  },
  {
    questionId: "q-2",
    category: "physical_information",
    prompt: "Are the shift notes kept anywhere after the shift ends?",
    whyItMatters: "If they are thrown away, anything written only there is lost.",
    responseType: { kind: "yes_no" },
    required: true,
    blocking: true,
    status: "open",
    managerAnswer: null,
  },
  {
    questionId: "q-3",
    category: "baseline",
    prompt: "How long does processing one contract usually take?",
    whyItMatters: "It tells InnPilot whether the print and scan cycle is worth removing.",
    responseType: { kind: "duration" },
    required: false,
    blocking: false,
    status: "answered",
    managerAnswer: "about 20 minutes",
  },
];

function context(overrides: Partial<WorkAreaContext> = {}): WorkAreaContext {
  return {
    id: "wa-reception",
    name: "Reception",
    template: "reception",
    state: "needs_input",
    revision: 14,
    description: null,
    scopeIncluded: [
      "Check-in and check-out",
      "Guest requests and complaints",
      "Contracts signed at the desk",
    ],
    scopeExcluded: [],
    linkedEvidence: ["evidence-3f21", "evidence-9ab4"],
    map: {
      workAreaId: "wa-reception",
      mapRevision: 6,
      confirmed: false,
      preparedAt: "2026-08-19T08:12:00Z",
      roles,
      systems,
      informationSources,
      documentTypes,
      physicalInformation,
      dependencies: [fact("dep-1", "Administration", "stated", "manager_answer", "Receives signed contracts")],
      painPoints,
      workflows: [guestRequests, contractProcessing, dailyReporting],
      unknowns: ["Whether the night shift follows the same process"],
      readiness: {
        ready: false,
        scope: "complete",
        roles: "complete",
        systems: "complete",
        informationSources: "partial",
        workflowsMapped: 2,
        workflowsIncomplete: 1,
        openBlockingQuestions: 2,
        unsettledFacts: 2,
      },
    },
    questions,
    planPresent: false,
    planStale: false,
    ...overrides,
  };
}

const plan: ImprovementPlan = {
  workAreaId: "wa-reception",
  revision: 2,
  sourceMapRevision: 6,
  currentMapRevision: 6,
  stale: false,
  preparedAt: "2026-08-19T09:40:00Z",
  opportunities: [
    {
      id: "op-1",
      category: "digitize",
      title: "Move shift notes off paper",
      currentProblem:
        "What happened on a shift is written by hand and only exists on that sheet.",
      recommendedChange:
        "Record shift notes in one shared place so the next shift can read them without the paper.",
      why: "Anything written only on the sheet is lost when the sheet is.",
      workflowId: "wf-guest-requests",
      expectedBenefit: "high",
      effort: "low",
      risk: "low",
      automationReadiness: "needs_digitization",
      productGap: "process_change_only",
      existingCapabilityKey: null,
      capabilityMatch: "no_match",
      prerequisites: [],
    },
    {
      id: "op-2",
      category: "organize",
      title: "Give signed contracts one home",
      currentProblem:
        "Each person saves signed contracts wherever they normally do, so nobody is sure where a contract is.",
      recommendedChange: "Agree one folder for signed contracts and use it every time.",
      why: "Looking for a contract currently means asking whoever filed it.",
      workflowId: "wf-contracts",
      expectedBenefit: "medium",
      effort: "low",
      risk: "low",
      automationReadiness: "not_ready",
      productGap: "process_change_only",
      existingCapabilityKey: null,
      capabilityMatch: "no_match",
      prerequisites: ["Decide where signed contracts belong"],
    },
    {
      id: "op-3",
      category: "simplify",
      title: "Stop printing contracts to sign them",
      currentProblem:
        "A digital contract is printed, signed, scanned and renamed before it is stored.",
      recommendedChange: "Keep the contract digital from start to finish.",
      why: "Four of the five steps exist only because the document leaves the computer.",
      workflowId: "wf-contracts",
      expectedBenefit: "high",
      effort: "medium",
      risk: "medium",
      automationReadiness: "existing_innpilot_capability",
      productGap: "existing_innpilot_configuration",
      existingCapabilityKey: "contractsWorkflow",
      capabilityMatch: "possible_existing_capability",
      prerequisites: ["Confirm that this is really how contracts are handled today"],
    },
    {
      id: "op-4",
      category: "integrate",
      title: "Stop retyping occupancy figures",
      currentProblem: "The same numbers are read from the PMS and typed into a spreadsheet.",
      recommendedChange: "Let the figures move between the two systems without being retyped.",
      why: "Retyping is where the numbers go wrong.",
      workflowId: "wf-daily-report",
      expectedBenefit: "medium",
      effort: "high",
      risk: "medium",
      automationReadiness: "future_product_capability",
      productGap: "new_innpilot_capability",
      existingCapabilityKey: null,
      capabilityMatch: "new_capability_required",
      prerequisites: [],
    },
    {
      id: "op-5",
      category: "automate",
      title: "Prepare the daily report automatically",
      currentProblem: "The morning report is assembled by hand every day.",
      recommendedChange: "Assemble the report from the figures and leave it ready to send.",
      why: "It is the same three steps every morning, with no judgement involved.",
      workflowId: "wf-daily-report",
      expectedBenefit: "medium",
      effort: "medium",
      risk: "low",
      automationReadiness: "candidate",
      productGap: "integration_opportunity",
      existingCapabilityKey: null,
      capabilityMatch: "no_match",
      prerequisites: [],
    },
    {
      id: "op-6",
      category: "keep_manual",
      title: "Exceptional guest complaints",
      currentProblem: "Complaints are handled case by case by whoever is at the desk.",
      recommendedChange: "Leave these with a person.",
      why: "These cases need judgement and vary too much for a reliable automation today.",
      workflowId: null,
      expectedBenefit: null,
      effort: null,
      risk: null,
      automationReadiness: "not_recommended",
      productGap: "manual_recommended",
      existingCapabilityKey: null,
      capabilityMatch: "no_match",
      prerequisites: [],
    },
  ],
};

/* --------------------------------------------------------------- exports */

export const areasEmpty: WorkAreaSummary[] = [];

export const areas: WorkAreaSummary[] = [
  {
    id: "wa-reception",
    name: "Reception",
    template: "reception",
    state: "needs_input",
    revision: 14,
    workflowsMapped: 2,
    openBlockingQuestions: 2,
    mapReady: false,
    planStale: false,
  },
  {
    id: "wa-administration",
    name: "Administration",
    template: "administration",
    state: "improvement_ready",
    revision: 31,
    workflowsMapped: 4,
    openBlockingQuestions: 0,
    mapReady: true,
    planStale: false,
  },
  {
    id: "wa-sales",
    name: "Sales",
    template: "sales",
    state: "not_started",
    revision: 1,
    workflowsMapped: 0,
    openBlockingQuestions: 0,
    mapReady: false,
    planStale: false,
  },
];

/** Mapping under way, questions outstanding, no plan yet. */
export const receptionMapping: WorkAreaDetail = { context: context(), plan: null };

/** Map complete and a plan prepared from the current map revision. */
export const receptionPlanned: WorkAreaDetail = {
  context: context({
    state: "automation_opportunities_ready",
    planPresent: true,
    questions: questions.map((question) =>
      question.status === "open" ? { ...question, status: "answered" as const, managerAnswer: "Email" } : question,
    ),
    map: {
      ...context().map,
      confirmed: true,
      readiness: {
        ready: true,
        scope: "complete",
        roles: "complete",
        systems: "complete",
        informationSources: "complete",
        workflowsMapped: 3,
        workflowsIncomplete: 0,
        openBlockingQuestions: 0,
        unsettledFacts: 1,
      },
    },
  }),
  plan,
};

/** The area moved on after the plan was prepared, so the plan is stale. */
export const receptionStalePlan: WorkAreaDetail = {
  context: context({
    state: "map_needs_review",
    planPresent: true,
    planStale: true,
    questions: questions.map((question) => ({ ...question, status: "answered" as const })),
    map: { ...receptionPlanned.context.map, mapRevision: 8 },
  }),
  plan: { ...plan, currentMapRevision: 8, stale: true },
};

export const opportunityListings: OpportunityListing[] = plan.opportunities
  .filter((opportunity) => opportunity.automationReadiness !== "not_recommended")
  .map((opportunity) => ({
    workAreaId: "wa-reception",
    workAreaName: "Reception",
    planStale: false,
    opportunity,
  }));
