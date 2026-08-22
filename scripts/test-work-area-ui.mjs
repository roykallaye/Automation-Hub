/*
  Work Area UI authority tests.

  These exist to prove a negative: that the frontend does not create business
  truth. Everything asserted here is a projection of a value the backend
  produced — a lifecycle state, a question count, a staleness flag, a stored
  grant scope — and the tests fail if a screen starts deciding one for itself.

  They also check totality. Every backend enum value must have a manager-facing
  rendering, because a missing entry would fall through to whatever the UI
  happened to do next, and "whatever happened next" is exactly how an inferred
  fact ends up looking confirmed.
*/

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function importTypeScript(path) {
  const result = await build({
    bundle: true,
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    format: "esm",
    platform: "node",
    target: "es2020",
    write: false,
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const vocabulary = await importTypeScript("../src/workArea/vocabulary.ts");
const { assistantWorkAreaAccess } = await importTypeScript("../src/assistantConnection.ts");

let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

/* ------------------------------------------------------------ grant scopes */

const PRE_H_A_SCOPES = [
  "installation.read",
  "onboarding.read",
  "configuration.read",
  "preflight.read",
  "proposal.prepare",
  "proposal.read",
  "discovery.read",
  "discovery.propose",
  "recovery.read",
  "apply.read",
];
const WORK_AREA_SCOPES = ["work_area.read", "work_area.propose"];

const connectedAgent = {
  state: "connected",
  profileId: "profile_preview",
  scopes: PRE_H_A_SCOPES,
  lastActivityAt: "2026-08-20T10:00:00Z",
  lastClientName: "codex-mcp-client",
  lastProtocolVersion: "2025-06-18",
};

check(
  assistantWorkAreaAccess(connectedAgent),
  "needsUpdate",
  "a working pre-H-A grant needs updated access, and is never called disconnected",
);
check(
  assistantWorkAreaAccess({ ...connectedAgent, scopes: [...PRE_H_A_SCOPES, ...WORK_AREA_SCOPES] }),
  "ready",
  "a grant carrying both work area scopes is ready",
);
check(
  assistantWorkAreaAccess({ ...connectedAgent, scopes: [...PRE_H_A_SCOPES, "work_area.read"] }),
  "needsUpdate",
  "a partial work area grant is not treated as ready",
);
check(
  assistantWorkAreaAccess({ ...connectedAgent, state: "expired" }),
  "unavailable",
  "an expired grant is handled by the normal reconnect flow, not the access prompt",
);
check(assistantWorkAreaAccess(null), "unavailable", "no grant means no access prompt");
check(
  assistantWorkAreaAccess({
    ...connectedAgent,
    scopes: [...PRE_H_A_SCOPES, ...WORK_AREA_SCOPES],
    lastActivityAt: null,
    lastClientName: null,
    lastProtocolVersion: null,
  }),
  "ready",
  "access readiness comes from stored scopes, not from whether a tool has been called",
);

/* ------------------------------------------------------------- enum totality */

const STATES = [
  "not_started",
  "scope_defined",
  "mapping",
  "needs_input",
  "map_ready",
  "improvement_planning",
  "improvement_ready",
  "automation_opportunities_ready",
  "map_needs_review",
  "archived",
];
const TRUTH = ["observed", "stated", "inferred", "confirmed", "disputed", "unknown"];
const PROVENANCE = [
  "manager_answer",
  "structural_discovery",
  "existing_configuration",
  "system_status",
  "agent_inference",
  "manual_entry",
];
const COVERAGE = ["empty", "partial", "complete"];
const MEDIUM = ["digital", "physical", "tacit"];
const GAPS = [
  "missing_purpose",
  "missing_trigger",
  "missing_inputs",
  "missing_steps",
  "missing_output",
  "missing_actor_or_system",
  "exceptions_not_assessed",
  "current_state_unconfirmed",
  "blocking_questions_open",
  "not_current_state",
];
const CATEGORIES = [
  "digitize",
  "organize",
  "standardize",
  "simplify",
  "integrate",
  "automate",
  "keep_manual",
];
const READINESS = [
  "not_ready",
  "needs_digitization",
  "needs_standardization",
  "needs_integration",
  "candidate",
  "future_product_capability",
  "existing_innpilot_capability",
  "not_recommended",
];
const PRODUCT_GAPS = [
  "process_change_only",
  "existing_innpilot_configuration",
  "existing_external_system_feature",
  "integration_opportunity",
  "new_innpilot_capability",
  "manual_recommended",
  "needs_more_information",
];
const TEMPLATES = [
  "reception",
  "administration",
  "sales",
  "purchasing",
  "housekeeping",
  "maintenance",
  "management",
  "food_and_beverage",
  "marketing",
  "custom",
];
const MAGNITUDES = ["low", "medium", "high"];
const CAPABILITY = ["no_match", "possible_existing_capability", "new_capability_required"];

function total(values, table, label) {
  const missing = values.filter((value) => table[value] === undefined);
  check(missing, [], `${label} covers every backend value`);
}

total(STATES, vocabulary.AREA_STAGE, "area stage");
total(TRUTH, vocabulary.TRUTH_LABEL, "truth label");
total(TRUTH, vocabulary.TRUTH_TONE, "truth tone");
total(PROVENANCE, vocabulary.PROVENANCE_LABEL, "provenance label");
total(COVERAGE, vocabulary.COVERAGE_LABEL, "coverage label");
total(MEDIUM, vocabulary.MEDIUM_LABEL, "medium label");
total(GAPS, vocabulary.GAP_LABEL, "automation gap label");
total(CATEGORIES, vocabulary.CATEGORY_LABEL, "improvement category label");
total(CATEGORIES, vocabulary.CATEGORY_TEXT, "improvement category description");
total(READINESS, vocabulary.READINESS_LABEL, "automation readiness label");
total(READINESS, vocabulary.READINESS_TEXT, "automation readiness description");
total(READINESS, vocabulary.READINESS_TONE, "automation readiness tone");
total(PRODUCT_GAPS, vocabulary.PRODUCT_GAP_LABEL, "product gap label");
total(TEMPLATES, vocabulary.TEMPLATE_LABEL, "template label");
total(MAGNITUDES, vocabulary.MAGNITUDE_LABEL, "magnitude label");
total(CAPABILITY, vocabulary.CAPABILITY_LABEL, "capability match label");

check(
  [...vocabulary.IMPROVEMENT_ORDER].sort(),
  [...CATEGORIES].sort(),
  "the Improve stage lists every category exactly once",
);
check(
  vocabulary.IMPROVEMENT_ORDER[vocabulary.IMPROVEMENT_ORDER.length - 1],
  "automate",
  "automation is listed last, after the improvements that come first",
);

/* --------------------------------------------------------- truth rendering */

check(
  vocabulary.TRUTH_TONE.inferred === vocabulary.TRUTH_TONE.confirmed,
  false,
  "an InnPilot guess never renders like something the manager confirmed",
);
check(vocabulary.TRUTH_TONE.inferred, "attention", "an inferred fact reads as an open question");

/* -------------------------------------------------------------- lifecycle */

check(vocabulary.AREA_STAGE.map_needs_review, "needsReview", "a changed area asks to be rechecked");
check(vocabulary.AREA_STAGE.needs_input, "needsYou", "the backend decides when the manager is needed");
check(
  vocabulary.areaStage({ state: "automation_opportunities_ready" }),
  "planReady",
  "candidates ready is a plan state, not an automation state",
);

/* -------------------------------------------------------------- workflows */

const currentConfirmed = { phase: "current", currentStateConfirmed: true };
const currentUnconfirmed = { phase: "current", currentStateConfirmed: false };
const future = { phase: "proposed_future", currentStateConfirmed: true };

check(vocabulary.workflowStatus(currentConfirmed).label, "workArea.workflow.mapped", "a confirmed current workflow is mapped");
check(
  vocabulary.workflowStatus(currentUnconfirmed).label,
  "workArea.workflow.needsConfirmation",
  "an unconfirmed current workflow asks for confirmation",
);
check(
  vocabulary.workflowStatus(future).label,
  "workArea.workflow.suggested",
  "a proposed future workflow is a suggestion even when it claims to be confirmed",
);

check(
  vocabulary.isAutomationTopic("not_recommended"),
  false,
  "keep-manual is a recommendation, not an automation topic",
);
check(vocabulary.isAutomationTopic("not_ready"), true, "a blocked candidate is still shown, with its blocker");
check(vocabulary.isAutomationTopic("candidate"), true, "a candidate is an automation topic");

/* --------------------------------------------------- the dominant action */

function detail({ questions = [], ready = false, state = "mapping", plan = null }) {
  return {
    context: {
      state,
      questions,
      map: { readiness: { ready } },
    },
    plan,
  };
}

const openQuestion = { questionId: "q1", status: "open" };
const answeredQuestion = { questionId: "q2", status: "answered" };
const supersededQuestion = { questionId: "q3", status: "superseded" };

check(
  vocabulary.dominantAction(detail({ questions: [openQuestion], ready: true, plan: { stale: true } })),
  { kind: "answerQuestions", count: 1 },
  "an unanswered question outranks everything else",
);
check(
  vocabulary.dominantAction(detail({ questions: [answeredQuestion], plan: { stale: true } })),
  { kind: "planNeedsUpdate" },
  "a stale plan is raised before the plan is offered for review",
);
check(
  vocabulary.dominantAction(detail({ state: "map_needs_review", plan: null })),
  { kind: "mapNeedsReview" },
  "a map the backend flagged for review is raised",
);
check(
  vocabulary.dominantAction(detail({ plan: { stale: false }, ready: true })),
  { kind: "reviewPlan" },
  "a current plan is what to look at next",
);
check(
  vocabulary.dominantAction(detail({ ready: true })),
  { kind: "reviewMap" },
  "map readiness comes from the backend, not from counting facts",
);
check(
  vocabulary.dominantAction(detail({ ready: false })),
  { kind: "waitForAssistant" },
  "an incomplete map does not invent something for the manager to do",
);
check(
  vocabulary.openQuestions({ questions: [openQuestion, answeredQuestion, supersededQuestion] }).length,
  1,
  "only questions the backend still reports as open are answerable",
);

/* ------------------------------------------------------------ home alerts */

const summaries = [
  { id: "a", name: "Reception", state: "needs_input", openBlockingQuestions: 2, planStale: false },
  { id: "b", name: "Administration", state: "map_ready", openBlockingQuestions: 0, planStale: true },
  { id: "c", name: "Sales", state: "mapping", openBlockingQuestions: 0, planStale: false },
  { id: "d", name: "Purchasing", state: "improvement_ready", openBlockingQuestions: 0, planStale: false },
  { id: "e", name: "Old area", state: "archived", openBlockingQuestions: 4, planStale: true },
  { id: "f", name: "Housekeeping", state: "map_needs_review", openBlockingQuestions: 0, planStale: false },
];

check(
  vocabulary.actionableAreas(summaries).map((alert) => [alert.area.id, alert.kind]),
  [
    ["a", "questions"],
    ["b", "planStale"],
    ["d", "planReady"],
    ["f", "mapNeedsReview"],
  ],
  "Home raises only areas with something to act on, and never an archived one",
);
total(
  ["questions", "planStale", "mapNeedsReview", "planReady"],
  vocabulary.ALERT_TITLE,
  "alert title",
);
total(["questions", "planStale", "mapNeedsReview", "planReady"], vocabulary.ALERT_TONE, "alert tone");

console.log(`Work Area UI authority projections: ${checks}/${checks} passed`);
