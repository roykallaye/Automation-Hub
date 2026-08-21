/*
  The one place that decides what "connected" means for the local assistant.

  InnPilot and the assistant use the word differently, and conflating them is
  what made the connect screen claim "not connected" while Codex reported a live
  connection. The backend exposes two independent facts, and the honest states
  come from combining them:

    grant     - LocalAgentConnectionStatus.state, derived from the stored
                grant: absent/revoked -> notConnected, past expiry -> expired,
                otherwise connected. Says only that access exists.
    activity  - lastActivityAt / lastClientName / lastProtocolVersion, which the
                backend fills from the audit log. The audit is written by the
                tool-invocation wrapper alone, so these stay null until an
                assistant actually calls a tool. Completing the MCP handshake
                records nothing.

  So a valid grant with no audited activity is a real, distinct state: access is
  ready and the assistant may well be attached, but InnPilot has not yet been
  asked to do anything and genuinely cannot tell the difference between
  "attached and idle" and "never attached". It says so rather than guessing.

  Note: a revoked grant is filtered out by the backend's active-grant lookup and
  surfaces as `notConnected`, so it is indistinguishable from never-configured
  here and lands in `notConfigured`. Only expiry is separately observable.
*/

import type { LocalAgentConnectionStatus } from "./types";
import type { StatusTone } from "./components/ui";
import type { TranslationKey } from "./i18n";

export type AssistantConnectionState =
  /** No usable grant: never created, or revoked. */
  | "notConfigured"
  /** Grant is valid, but no assistant has exercised it yet. */
  | "accessReady"
  /** The audit log proves an assistant has called InnPilot. */
  | "connected"
  /** The grant exists but is past its expiry. */
  | "reconnectRequired";

/**
 * Whether the audit log shows an assistant has actually called InnPilot.
 *
 * This is the only evidence InnPilot has that the connection was used; a
 * successful handshake leaves no trace.
 */
export function hasAuditedActivity(agent: LocalAgentConnectionStatus | null) {
  return Boolean(agent?.lastActivityAt || agent?.lastClientName || agent?.lastProtocolVersion);
}

export function assistantConnectionState(
  agent: LocalAgentConnectionStatus | null,
): AssistantConnectionState {
  if (!agent) return "notConfigured";
  if (agent.state === "expired") return "reconnectRequired";
  if (agent.state !== "connected" || !agent.profileId) return "notConfigured";
  return hasAuditedActivity(agent) ? "connected" : "accessReady";
}

export const ASSISTANT_STATE_LABEL: Record<AssistantConnectionState, TranslationKey> = {
  notConfigured: "assistantState.notConfigured",
  accessReady: "assistantState.accessReady",
  connected: "assistantState.connected",
  reconnectRequired: "assistantState.reconnectRequired",
};

export const ASSISTANT_STATE_TONE: Record<AssistantConnectionState, StatusTone> = {
  notConfigured: "idle",
  accessReady: "attention",
  connected: "ready",
  reconnectRequired: "problem",
};

/** Longer explanation for screens that have room for one. */
export const ASSISTANT_STATE_DETAIL: Record<AssistantConnectionState, TranslationKey> = {
  notConfigured: "assistant.notConnectedText",
  accessReady: "assistantState.accessReadyDetail",
  connected: "assistant.connectedText",
  reconnectRequired: "assistant.expiredText",
};
