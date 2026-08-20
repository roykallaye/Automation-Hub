/*
  Phase G — projecting authoritative backend state into four human stages.

  This file contains NO state machine. It is a pure, total function from
  backend truth (the onboarding snapshot, the local agent connection, and the
  discovery manager view) to "what should the manager see right now".

  React never decides whether a proposal is eligible, whether approval is
  valid, whether configuration applied, whether rollback succeeded, or whether
  the installation is ready. Those answers are read from the backend and
  rendered. The only judgement made here is presentational: which of the four
  stages the current backend state belongs to.
*/

import type { OnboardingSnapshot, OnboardingState } from "../onboarding";
import type { DiscoveryManagerView, LocalAgentConnectionStatus } from "../types";

export type JourneyStage = "connect" | "check" | "review" | "ready";

/** What the stage screen should actually render. Each maps to one question. */
export type JourneyView =
  /* 1 — Connect: "How do I connect the assistant?" */
  | { kind: "connectIntro" }
  | { kind: "connectAssistant" }
  /* 2 — Let it check: "What may InnPilot check?" */
  | { kind: "chooseScope" }
  | { kind: "checking" }
  | { kind: "question" }
  /* 3 — Review: "Do I approve these changes?" */
  | { kind: "review" }
  | { kind: "applying" }
  /* 4 — Ready */
  | { kind: "ready"; deferredItems: string[] }
  /* Failure states */
  | { kind: "rolledBack" }
  | { kind: "failedRecoverable" };

export type JourneyProjection = {
  stage: JourneyStage;
  view: JourneyView;
  /** True when the backend says this installation is finished with onboarding. */
  complete: boolean;
};

const STAGE_BY_STATE: Record<OnboardingState, JourneyStage> = {
  notStarted: "connect",
  bootstrapCreated: "connect",
  waitingForAgent: "connect",
  agentConnected: "check",
  scopeApprovalRequired: "check",
  discoveryRunning: "check",
  needsUserInput: "check",
  proposalReady: "review",
  waitingForApproval: "review",
  applying: "review",
  verifying: "review",
  ready: "ready",
  readyWithDeferredItems: "ready",
  readyLegacy: "ready",
  failedRecoverable: "review",
  rolledBack: "review",
};

export const JOURNEY_STAGES: JourneyStage[] = ["connect", "check", "review", "ready"];

/**
 * Projects backend state into the stage the manager is standing in.
 *
 * `agent` and `discovery` may be null while their commands are still in
 * flight; the projection degrades to the coarser onboarding state rather than
 * guessing.
 */
export function projectJourney(
  snapshot: OnboardingSnapshot,
  agent: LocalAgentConnectionStatus | null,
  discovery: DiscoveryManagerView | null,
): JourneyProjection {
  const state = snapshot.state;
  const stage = STAGE_BY_STATE[state] ?? "connect";

  // Terminal failure states are read straight from the backend. They must never
  // be inferred from a failed command call in the UI.
  if (state === "rolledBack") {
    return { stage: "review", view: { kind: "rolledBack" }, complete: false };
  }
  if (state === "failedRecoverable") {
    return { stage: "review", view: { kind: "failedRecoverable" }, complete: false };
  }

  if (stage === "ready") {
    const deferred = snapshot.activeSession?.deferredItems ?? [];
    return {
      stage: "ready",
      view: { kind: "ready", deferredItems: deferred },
      complete: snapshot.activeSession === null,
    };
  }

  if (stage === "review") {
    if (state === "applying" || state === "verifying") {
      return { stage: "review", view: { kind: "applying" }, complete: false };
    }
    return { stage: "review", view: { kind: "review" }, complete: false };
  }

  if (stage === "check") {
    if (state === "needsUserInput") {
      return { stage: "check", view: { kind: "question" }, complete: false };
    }
    if (state === "discoveryRunning") {
      return { stage: "check", view: { kind: "checking" }, complete: false };
    }
    // agentConnected / scopeApprovalRequired: the manager still has to say what
    // InnPilot may look at, unless an active scope already exists.
    const scopeActive = discovery?.discovery.scope?.state === "active";
    return {
      stage: "check",
      view: { kind: scopeActive ? "checking" : "chooseScope" },
      complete: false,
    };
  }

  // Connect. Once the backend reports a live connection we show the confirmed
  // step rather than the intro, so a returning manager is not sent backwards.
  const connected = agent?.state === "connected";
  return {
    stage: "connect",
    view: { kind: connected ? "connectAssistant" : "connectIntro" },
    complete: false,
  };
}

/** Rail state for the four-stage indicator. */
export function stageStatus(stage: JourneyStage, current: JourneyStage) {
  const currentIndex = JOURNEY_STAGES.indexOf(current);
  const index = JOURNEY_STAGES.indexOf(stage);
  if (index < currentIndex) return "done" as const;
  if (index === currentIndex) return "current" as const;
  return "upcoming" as const;
}
