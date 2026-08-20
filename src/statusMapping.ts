/*
  One place that turns backend status vocabularies into the product's four
  visual tones. Keeping this centralised is what stops "needs_attention",
  "missingFolder" and "warning" from each growing their own ad-hoc colour
  somewhere in a component.
*/

import type { Translate } from "./i18n";
import type { StatusTone } from "./components/ui";
import type {
  ActivityStatus,
  ModuleReadiness,
  ModuleReadinessStatus,
  ReadinessStatus,
} from "./types";

export function moduleTone(status: ModuleReadinessStatus): StatusTone {
  switch (status) {
    case "ready":
      return "ready";
    case "needs_attention":
      return "attention";
    case "blocked":
      return "problem";
    case "not_configured":
      return "idle";
    default:
      return "idle";
  }
}

export function moduleStatusLabel(status: ModuleReadinessStatus, t: Translate) {
  switch (status) {
    case "ready":
      return t("status.ready");
    case "needs_attention":
      return t("status.attention");
    case "blocked":
      return t("status.problem");
    case "not_configured":
      return t("status.notConfigured");
    default:
      return t("status.checking");
  }
}

export function readinessTone(status: ReadinessStatus): StatusTone {
  switch (status) {
    case "ready":
      return "ready";
    case "warning":
      return "attention";
    case "notChecked":
      return "idle";
    default:
      return "problem";
  }
}

export function activityTone(status: ActivityStatus): StatusTone {
  switch (status) {
    case "success":
      return "ready";
    case "needs_attention":
      return "attention";
    case "failed":
      return "problem";
    default:
      return "idle";
  }
}

/** Modules a manager should actually act on, most severe first. */
export function attentionModules(modules: ModuleReadiness[]) {
  const severity: Record<ModuleReadinessStatus, number> = {
    blocked: 0,
    needs_attention: 1,
    not_configured: 2,
    not_checked: 3,
    ready: 4,
  };
  return modules
    .filter((module) => module.id !== "support")
    .filter((module) => module.status === "blocked" || module.status === "needs_attention")
    .sort((left, right) => severity[left.status] - severity[right.status]);
}

export function formatWhen(value: string | null | undefined, language: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(language === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function greetingKey(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "home.greetingMorning" as const;
  if (hour < 18) return "home.greetingAfternoon" as const;
  return "home.greetingEvening" as const;
}
