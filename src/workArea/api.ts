/*
  The only path between the Work Area UI and the backend.

  Every write here is a typed local manager operation. There is deliberately no
  generic "update work area" call, and no path by which the assistant could
  reach these: the MCP surface has no equivalent tool. React never edits a Work
  Area in memory — it sends an operation and re-renders whatever the backend
  says the area now is.
*/

import { invoke } from "@tauri-apps/api/core";

import type {
  AnswerValue,
  CreateWorkAreaCommand,
  OpportunityListing,
  WorkAreaDetail,
  WorkAreaSummary,
} from "./types";

export function listWorkAreas() {
  return invoke<WorkAreaSummary[]>("list_work_areas");
}

export function getWorkArea(workAreaId: string) {
  return invoke<WorkAreaDetail>("get_work_area", { workAreaId });
}

export function createWorkArea(command: CreateWorkAreaCommand) {
  return invoke<WorkAreaDetail>("create_work_area", { command });
}

/**
 * Record a manager answer.
 *
 * `expectedRevision` is the revision the manager was actually looking at, so a
 * question answered against a stale view is refused rather than applied to a
 * changed area. `requestId` must stay stable across retries of the same answer:
 * the backend treats a repeat as the same operation instead of a second one.
 */
export function submitWorkAreaAnswer(request: {
  workAreaId: string;
  questionId: string;
  value: AnswerValue;
  expectedRevision: number;
  requestId: string;
}) {
  return invoke<WorkAreaDetail>("submit_work_area_answer", { request });
}

export function archiveWorkArea(workAreaId: string, expectedRevision: number) {
  return invoke<WorkAreaSummary[]>("archive_work_area", { workAreaId, expectedRevision });
}

export function listWorkAreaOpportunities() {
  return invoke<OpportunityListing[]>("list_work_area_opportunities");
}

/**
 * A stable identifier for one answer attempt.
 *
 * Generated once when the manager opens a question and reused if the first
 * submission fails and they press again, which is what makes a retry a retry.
 */
export function newRequestId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `${prefix}-${random}`;
}
