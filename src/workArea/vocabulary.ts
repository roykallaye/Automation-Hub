/*
  Backend vocabulary → manager vocabulary.

  The aggregate speaks in process-engineering terms: provenance, truth status,
  section coverage, automation readiness, product gaps. A hotel manager should
  never see any of those words. Everything here is a lookup table from an
  authoritative backend value to a phrase and a tone.

  Two rules hold throughout:

    1. No table invents a state. Every entry is total over the backend enum, so
       a value the backend can produce always has a manager-facing rendering and
       nothing silently falls through to a friendlier default.
    2. No table upgrades certainty. An inferred fact never renders like a
       confirmed one, a catalog match never renders as "supported", and a
       proposed future workflow never renders as how the area works today.
*/

import type { StatusTone } from "../components/ui";
import type { TranslationKey } from "../i18n";
import type {
  AutomationReadiness,
  CapabilityMatch,
  ImprovementCategory,
  Magnitude,
  MappedWorkflow,
  ProductGap,
  Provenance,
  SectionCoverage,
  StepMedium,
  TruthStatus,
  WorkAreaContext,
  WorkAreaDetail,
  WorkAreaState,
  WorkAreaSummary,
  WorkAreaTemplate,
  WorkflowGap,
} from "./types";

/* ------------------------------------------------------------ area lifecycle */

/**
 * The manager-facing reading of the backend lifecycle.
 *
 * A straight lookup, deliberately. The backend decides what stage an area is
 * in from stored facts; if this function started combining `state` with
 * question counts it would become a second state machine that could disagree
 * with the first.
 */
export type MappingStage =
  | "starting"
  | "learning"
  | "needsYou"
  | "readyToReview"
  | "planReady"
  | "needsReview"
  | "archived";

export const AREA_STAGE: Record<WorkAreaState, MappingStage> = {
  not_started: "starting",
  scope_defined: "starting",
  mapping: "learning",
  needs_input: "needsYou",
  map_ready: "readyToReview",
  improvement_planning: "learning",
  improvement_ready: "planReady",
  automation_opportunities_ready: "planReady",
  map_needs_review: "needsReview",
  archived: "archived",
};

export const STAGE_LABEL: Record<MappingStage, TranslationKey> = {
  starting: "workArea.stage.starting",
  learning: "workArea.stage.learning",
  needsYou: "workArea.stage.needsYou",
  readyToReview: "workArea.stage.readyToReview",
  planReady: "workArea.stage.planReady",
  needsReview: "workArea.stage.needsReview",
  archived: "workArea.stage.archived",
};

export const STAGE_TEXT: Record<MappingStage, TranslationKey> = {
  starting: "workArea.stage.startingText",
  learning: "workArea.stage.learningText",
  needsYou: "workArea.stage.needsYouText",
  readyToReview: "workArea.stage.readyToReviewText",
  planReady: "workArea.stage.planReadyText",
  needsReview: "workArea.stage.needsReviewText",
  archived: "workArea.stage.archivedText",
};

export const STAGE_TONE: Record<MappingStage, StatusTone> = {
  starting: "idle",
  learning: "running",
  needsYou: "attention",
  readyToReview: "ready",
  planReady: "ready",
  needsReview: "attention",
  archived: "idle",
};

export function areaStage(area: Pick<WorkAreaSummary, "state">): MappingStage {
  return AREA_STAGE[area.state];
}

/* ----------------------------------------------------------- dominant action */

/**
 * Which single thing this area is waiting on.
 *
 * This picks between authoritative facts; it does not produce one. Ordering is
 * the product invariant made concrete: an unanswered question outranks a stale
 * artifact, which outranks reviewing a map, which outranks looking at a plan.
 * Understanding comes before improving comes before automating.
 */
export type AreaAction =
  | { kind: "answerQuestions"; count: number }
  | { kind: "planNeedsUpdate" }
  | { kind: "mapNeedsReview" }
  | { kind: "reviewPlan" }
  | { kind: "reviewMap" }
  | { kind: "waitForAssistant" };

export function dominantAction(detail: WorkAreaDetail): AreaAction {
  const { context, plan } = detail;
  const open = openQuestions(context).length;
  if (open > 0) return { kind: "answerQuestions", count: open };
  if (plan?.stale) return { kind: "planNeedsUpdate" };
  if (context.state === "map_needs_review") return { kind: "mapNeedsReview" };
  if (plan) return { kind: "reviewPlan" };
  if (context.map.readiness.ready) return { kind: "reviewMap" };
  return { kind: "waitForAssistant" };
}

export const ACTION_LABEL: Record<AreaAction["kind"], TranslationKey> = {
  answerQuestions: "workArea.action.answerQuestions",
  planNeedsUpdate: "workArea.action.updatePlan",
  mapNeedsReview: "workArea.action.checkAgain",
  reviewPlan: "workArea.action.reviewPlan",
  reviewMap: "workArea.action.reviewMap",
  waitForAssistant: "workArea.action.continueMapping",
};

/** Questions the manager can actually answer right now. */
export function openQuestions(context: WorkAreaContext) {
  return context.questions.filter((question) => question.status === "open");
}

/* ------------------------------------------------------------------ alerts */

export type AreaAlert = {
  area: WorkAreaSummary;
  kind: "questions" | "planStale" | "mapNeedsReview" | "planReady";
};

export const ALERT_TITLE: Record<AreaAlert["kind"], TranslationKey> = {
  questions: "workArea.alert.questions",
  planStale: "workArea.alert.planStale",
  mapNeedsReview: "workArea.alert.mapNeedsReview",
  planReady: "workArea.alert.planReady",
};

export const ALERT_TONE: Record<AreaAlert["kind"], StatusTone> = {
  questions: "attention",
  planStale: "attention",
  mapNeedsReview: "attention",
  planReady: "ready",
};

/**
 * Areas with something a manager could act on right now.
 *
 * Home shows these and nothing else — an area quietly being mapped is not news.
 * Each condition is a stored fact: a question count, a staleness flag, or the
 * backend's own lifecycle state. There is no "probably needs attention" here.
 */
export function actionableAreas(areas: WorkAreaSummary[]): AreaAlert[] {
  const alerts: AreaAlert[] = [];
  for (const area of areas) {
    if (area.state === "archived") continue;
    if (area.openBlockingQuestions > 0) {
      alerts.push({ area, kind: "questions" });
    } else if (area.planStale) {
      alerts.push({ area, kind: "planStale" });
    } else if (area.state === "map_needs_review") {
      alerts.push({ area, kind: "mapNeedsReview" });
    } else if (
      area.state === "improvement_ready" ||
      area.state === "automation_opportunities_ready"
    ) {
      alerts.push({ area, kind: "planReady" });
    }
  }
  return alerts;
}

/* ------------------------------------------------------------------- truth */

/**
 * How settled a fact is, in words a manager can act on.
 *
 * `inferred` is the one that matters: it is InnPilot's own guess, and it must
 * read as an open question rather than as knowledge. The backend normalizes an
 * agent inference back to `inferred` even if the stored bytes claimed more, so
 * this table can trust what it receives.
 */
export const TRUTH_LABEL: Record<TruthStatus, TranslationKey> = {
  confirmed: "workArea.truth.confirmed",
  stated: "workArea.truth.reported",
  observed: "workArea.truth.observed",
  inferred: "workArea.truth.needsConfirmation",
  disputed: "workArea.truth.disputed",
  unknown: "workArea.truth.unknown",
};

export const TRUTH_TONE: Record<TruthStatus, StatusTone> = {
  confirmed: "ready",
  stated: "ready",
  observed: "ready",
  inferred: "attention",
  disputed: "problem",
  unknown: "idle",
};

/** Only shown under technical details. */
export const PROVENANCE_LABEL: Record<Provenance, TranslationKey> = {
  manager_answer: "workArea.provenance.managerAnswer",
  structural_discovery: "workArea.provenance.structuralDiscovery",
  existing_configuration: "workArea.provenance.existingConfiguration",
  system_status: "workArea.provenance.systemStatus",
  agent_inference: "workArea.provenance.agentInference",
  manual_entry: "workArea.provenance.manualEntry",
};

/* ---------------------------------------------------------------- coverage */

export const COVERAGE_LABEL: Record<SectionCoverage, TranslationKey> = {
  empty: "workArea.coverage.empty",
  partial: "workArea.coverage.partial",
  complete: "workArea.coverage.complete",
};

export const COVERAGE_TONE: Record<SectionCoverage, StatusTone> = {
  empty: "idle",
  partial: "attention",
  complete: "ready",
};

/* ---------------------------------------------------------------- workflows */

export const MEDIUM_LABEL: Record<StepMedium, TranslationKey> = {
  digital: "workArea.medium.digital",
  physical: "workArea.medium.physical",
  tacit: "workArea.medium.tacit",
};

/**
 * What a workflow row should say about itself.
 *
 * A proposed future workflow is never described as how the area works, no
 * matter how complete it is. That is the one distinction the whole Improve
 * stage rests on.
 */
export function workflowStatus(workflow: MappedWorkflow): {
  label: TranslationKey;
  tone: StatusTone;
} {
  if (workflow.phase === "proposed_future") {
    return { label: "workArea.workflow.suggested", tone: "idle" };
  }
  if (workflow.currentStateConfirmed) {
    return { label: "workArea.workflow.mapped", tone: "ready" };
  }
  return { label: "workArea.workflow.needsConfirmation", tone: "attention" };
}

/** Plain-language rendering of why automation is not yet on the table. */
export const GAP_LABEL: Record<WorkflowGap, TranslationKey> = {
  missing_purpose: "workArea.gap.purpose",
  missing_trigger: "workArea.gap.trigger",
  missing_inputs: "workArea.gap.inputs",
  missing_steps: "workArea.gap.steps",
  missing_output: "workArea.gap.output",
  missing_actor_or_system: "workArea.gap.actor",
  exceptions_not_assessed: "workArea.gap.exceptions",
  current_state_unconfirmed: "workArea.gap.unconfirmed",
  blocking_questions_open: "workArea.gap.questions",
  not_current_state: "workArea.gap.notCurrent",
};

/* -------------------------------------------------------------- improvement */

export const CATEGORY_LABEL: Record<ImprovementCategory, TranslationKey> = {
  digitize: "workArea.category.digitize",
  organize: "workArea.category.organize",
  standardize: "workArea.category.standardize",
  simplify: "workArea.category.simplify",
  integrate: "workArea.category.integrate",
  automate: "workArea.category.automate",
  keep_manual: "workArea.category.keepManual",
};

export const CATEGORY_TEXT: Record<ImprovementCategory, TranslationKey> = {
  digitize: "workArea.category.digitizeText",
  organize: "workArea.category.organizeText",
  standardize: "workArea.category.standardizeText",
  simplify: "workArea.category.simplifyText",
  integrate: "workArea.category.integrateText",
  automate: "workArea.category.automateText",
  keep_manual: "workArea.category.keepManualText",
};

/**
 * The order the Improve stage lists categories in.
 *
 * Automation is last and is not visually privileged. A plan whose honest answer
 * is "digitize this first" is a good plan, and the layout has to agree.
 */
export const IMPROVEMENT_ORDER: ImprovementCategory[] = [
  "digitize",
  "organize",
  "standardize",
  "simplify",
  "integrate",
  "keep_manual",
  "automate",
];

export const MAGNITUDE_LABEL: Record<Magnitude, TranslationKey> = {
  low: "workArea.magnitude.low",
  medium: "workArea.magnitude.medium",
  high: "workArea.magnitude.high",
};

/* --------------------------------------------------------------- automation */

export const READINESS_LABEL: Record<AutomationReadiness, TranslationKey> = {
  candidate: "workArea.automation.candidate",
  existing_innpilot_capability: "workArea.automation.possibleExisting",
  future_product_capability: "workArea.automation.newCapability",
  needs_digitization: "workArea.automation.needsDigitization",
  needs_standardization: "workArea.automation.needsStandardization",
  needs_integration: "workArea.automation.needsIntegration",
  not_ready: "workArea.automation.notReady",
  not_recommended: "workArea.automation.keepManual",
};

export const READINESS_TEXT: Record<AutomationReadiness, TranslationKey> = {
  candidate: "workArea.automation.candidateText",
  existing_innpilot_capability: "workArea.automation.possibleExistingText",
  future_product_capability: "workArea.automation.newCapabilityText",
  needs_digitization: "workArea.automation.needsDigitizationText",
  needs_standardization: "workArea.automation.needsStandardizationText",
  needs_integration: "workArea.automation.needsIntegrationText",
  not_ready: "workArea.automation.notReadyText",
  not_recommended: "workArea.automation.keepManualText",
};

export const READINESS_TONE: Record<AutomationReadiness, StatusTone> = {
  candidate: "ready",
  existing_innpilot_capability: "attention",
  future_product_capability: "idle",
  needs_digitization: "attention",
  needs_standardization: "attention",
  needs_integration: "attention",
  not_ready: "attention",
  not_recommended: "idle",
};

/**
 * Whether an opportunity belongs on the Automate stage at all.
 *
 * Everything the backend produced is shown somewhere; this only decides where.
 * An opportunity blocked behind a prerequisite still appears on Automate, as
 * "not ready", because hiding it would leave the manager wondering why an
 * obvious candidate vanished.
 */
export function isAutomationTopic(readiness: AutomationReadiness) {
  return readiness !== "not_recommended";
}

/**
 * Deliberately hedged copy. `possible_existing_capability` means the referenced
 * capability exists in the catalog — not that it fits this workflow. Saying
 * "supported" here would be a commercial promise the backend never made.
 */
export const CAPABILITY_LABEL: Record<CapabilityMatch, TranslationKey> = {
  no_match: "workArea.capability.none",
  possible_existing_capability: "workArea.capability.possible",
  new_capability_required: "workArea.capability.newNeeded",
};

export const PRODUCT_GAP_LABEL: Record<ProductGap, TranslationKey> = {
  process_change_only: "workArea.productGap.processChange",
  existing_innpilot_configuration: "workArea.productGap.innpilotConfiguration",
  existing_external_system_feature: "workArea.productGap.externalFeature",
  integration_opportunity: "workArea.productGap.integration",
  new_innpilot_capability: "workArea.productGap.newCapability",
  manual_recommended: "workArea.productGap.manual",
  needs_more_information: "workArea.productGap.moreInformation",
};

/* ---------------------------------------------------------------- templates */

export const TEMPLATE_LABEL: Record<WorkAreaTemplate, TranslationKey> = {
  reception: "workArea.template.reception",
  administration: "workArea.template.administration",
  sales: "workArea.template.sales",
  purchasing: "workArea.template.purchasing",
  housekeeping: "workArea.template.housekeeping",
  maintenance: "workArea.template.maintenance",
  management: "workArea.template.management",
  food_and_beverage: "workArea.template.foodAndBeverage",
  marketing: "workArea.template.marketing",
  custom: "workArea.template.custom",
};

export const TEMPLATE_ORDER: WorkAreaTemplate[] = [
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
