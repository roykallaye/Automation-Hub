import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/*
  Bundle rather than transform.

  A single-file transform leaves relative imports in place, and a data: URL
  module cannot resolve them — so any module under test that imports a real
  value (rather than only types) fails to load. `stages.ts` does exactly that:
  it imports `assistantConnectionState`, because there is one shared definition
  of what "connected" means. Bundling keeps that sharing testable.
*/
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

const { assistantHasReachedInnPilot, projectJourney } = await importTypeScript(
  "../src/onboarding/stages.ts",
);
const {
  isOnboardingReady,
  isOnboardingStateReady,
  shouldShowOnboardingJourney,
} = await importTypeScript("../src/onboarding/readiness.ts");

let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

function snapshot(state, activeSession = null) {
  return { state, activeSession };
}

const noAgent = {
  state: "notConnected",
  profileId: null,
  lastActivityAt: null,
  lastClientName: null,
  lastProtocolVersion: null,
};
const preparedAgent = {
  ...noAgent,
  state: "connected",
  profileId: "profile_phase_g",
};
const activeAgent = {
  ...preparedAgent,
  lastActivityAt: "2026-08-20T10:00:00Z",
  lastClientName: "codex-mcp-client",
  lastProtocolVersion: "2025-06-18",
};
const noScope = { discovery: { scope: null }, proposal: null };
const activeScope = {
  discovery: { scope: { state: "active" } },
  proposal: null,
};
const revokedScope = {
  discovery: { scope: { state: "revoked" } },
  proposal: {
    status: "ready_for_review",
    unresolvedQuestions: [],
    invalidationReason: "discovery_scope_revoked",
  },
};
const questionProposal = {
  discovery: { scope: { state: "active" } },
  proposal: {
    status: "needs_user_input",
    unresolvedQuestions: ["Which folder is current?"],
    invalidationReason: null,
  },
};
const reviewProposal = {
  discovery: { scope: { state: "active" } },
  proposal: {
    status: "ready_for_review",
    unresolvedQuestions: [],
    invalidationReason: null,
  },
};

check(projectJourney(snapshot("notStarted"), noAgent, noScope).view.kind, "connectIntro", "fresh install");
check(
  projectJourney(
    snapshot("bootstrapCreated", { mode: "agentAssisted" }),
    noAgent,
    noScope,
  ).view.kind,
  "connectAssistant",
  "started agent journey",
);
check(projectJourney(snapshot("bootstrapCreated"), preparedAgent, noScope).view.kind, "connectAssistant", "profile is not a handshake");
check(assistantHasReachedInnPilot(preparedAgent), false, "prepared grant is not shown as connected");
check(assistantHasReachedInnPilot(activeAgent), true, "audited MCP activity confirms connection");
check(projectJourney(snapshot("bootstrapCreated"), activeAgent, noScope).view.kind, "chooseScope", "assistant reached InnPilot");
check(projectJourney(snapshot("bootstrapCreated"), activeAgent, activeScope).view.kind, "checking", "approved discovery");
check(projectJourney(snapshot("bootstrapCreated"), activeAgent, questionProposal).view.kind, "question", "proposal question");
check(projectJourney(snapshot("bootstrapCreated"), activeAgent, reviewProposal).view.kind, "review", "review-ready proposal");
check(projectJourney(snapshot("proposalReady"), activeAgent, revokedScope).view, { kind: "chooseScope", reason: "revoked" }, "revoked scope wins");
check(projectJourney(snapshot("applying"), noAgent, noScope).view.kind, "applying", "applying is backend truth");
check(projectJourney(snapshot("verifying"), noAgent, noScope).view.kind, "applying", "verifying is backend truth");
check(projectJourney(snapshot("rolledBack"), activeAgent, reviewProposal).view.kind, "rolledBack", "rollback is terminal");
check(projectJourney(snapshot("failedRecoverable"), activeAgent, reviewProposal).view.kind, "failedRecoverable", "failure cannot appear ready");

const readyWithSession = snapshot("ready", { mode: "agentAssisted" });
check(isOnboardingStateReady(readyWithSession), true, "semantic ready state");
check(isOnboardingReady(readyWithSession), false, "settled readiness still requires session retirement");
check(shouldShowOnboardingJourney(snapshot("readyLegacy"), false, false), false, "readyLegacy bypasses onboarding");
check(shouldShowOnboardingJourney(snapshot("notStarted"), false, false), true, "fresh install enters onboarding");
check(shouldShowOnboardingJourney(readyWithSession, true, false), true, "Ready screen remains visible");
check(shouldShowOnboardingJourney(readyWithSession, true, true), false, "Go to InnPilot exits Ready");
check(shouldShowOnboardingJourney(snapshot("failedRecoverable"), true, true), true, "later failure reopens journey");

console.log(`Phase G UI authority projections: ${checks}/${checks} passed`);
