/*
  Home answers three questions and nothing else:
    1. Is InnPilot okay?
    2. Is anything asking for my attention?
    3. What can I do?

  There is one dominant status line, a short attention list only when something
  actually needs attention, and a small set of contextual actions. No metric
  tiles, no grid of equally weighted cards.
*/

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleHelp,
  History,
  LoaderCircle,
  Workflow,
} from "lucide-react";

import { Button, Card, EmptyState, Row, Rows, Section } from "../components/ui";
import { useI18n } from "../i18n";
import {
  activityTone,
  attentionModules,
  formatWhen,
  greetingKey,
  moduleStatusLabel,
  moduleTone,
} from "../statusMapping";
import type { ActivityRecord, AppConfigStatus, AppPage, ModuleReadiness } from "../types";

export function HomePage({
  activityHistory,
  configStatus,
  hotelName,
  loading,
  modules,
  runningLabel,
  onNavigate,
}: {
  activityHistory: ActivityRecord[];
  configStatus: AppConfigStatus | null;
  hotelName: string;
  loading: boolean;
  modules: ModuleReadiness[];
  runningLabel: string | null;
  onNavigate: (page: AppPage) => void;
}) {
  const { language, t } = useI18n();
  const attention = attentionModules(modules);
  const recent = [...activityHistory].reverse().slice(0, 3);

  const headline = resolveHeadline({
    attentionCount: attention.length,
    configMissing: !loading && !configStatus,
    loading,
    running: Boolean(runningLabel),
  });

  return (
    <>
      <div className="ip-headline">
        <span className="ip-headline__greeting">
          {t(greetingKey())}
          {hotelName ? ` · ${hotelName}` : ""}
        </span>
        <div className="ip-headline__state">
          <span aria-hidden="true" className={`ip-headline__mark is-${headline.mark}`}>
            <headline.icon size={16} className={headline.mark === "running" ? "ip-spin" : undefined} />
          </span>
          <h1>
            {headline.titleKey === "home.someThings"
              ? t("home.someThings", { count: attention.length })
              : t(headline.titleKey)}
          </h1>
        </div>
        <p>{t(headline.textKey)}</p>
      </div>

      <div className="ip-stack">
        {attention.length > 0 ? (
          <Section title={t("home.needsAttentionSection")}>
            <Card>
              <Rows>
                {attention.map((module) => (
                  <Row
                    key={module.id}
                    meta={module.nextAction || module.shortReason}
                    onOpen={() => onNavigate("system")}
                    openLabel={`${module.title} — ${t("home.reviewIssue")}`}
                    status={{
                      tone: moduleTone(module.status),
                      label: moduleStatusLabel(module.status, t),
                    }}
                    title={module.title}
                  />
                ))}
              </Rows>
            </Card>
          </Section>
        ) : null}

        <div className="ip-actions">
          <Button icon={Workflow} onClick={() => onNavigate("automations")} variant="primary">
            {t("home.openAutomations")}
          </Button>
          <Button icon={CircleHelp} onClick={() => onNavigate("guide")} variant="ghost">
            {t("home.howItWorks")}
          </Button>
        </div>

        <Section
          title={t("home.recentSection")}
          aside={
            recent.length > 0 ? (
              <button
                className="ip-btn ip-btn--ghost"
                onClick={() => onNavigate("activity")}
                type="button"
              >
                {t("home.seeAllActivity")}
                <ArrowRight aria-hidden="true" size={15} />
              </button>
            ) : undefined
          }
        >
          <Card>
            {recent.length === 0 ? (
              <EmptyState
                icon={History}
                message={t("home.noRecentText")}
                title={t("home.noRecent")}
              />
            ) : (
              <Rows>
                {recent.map((record) => (
                  <Row
                    key={record.id}
                    meta={formatWhen(record.finishedAt, language, t("common.never"))}
                    onOpen={() => onNavigate("activity")}
                    status={{
                      tone: activityTone(record.status),
                      label: activityStatusLabel(record.status, t),
                    }}
                    title={record.workflowTitle}
                  />
                ))}
              </Rows>
            )}
          </Card>
        </Section>
      </div>
    </>
  );
}

function activityStatusLabel(status: ActivityRecord["status"], t: ReturnType<typeof useI18n>["t"]) {
  switch (status) {
    case "success":
      return t("status.ready");
    case "needs_attention":
      return t("status.attention");
    case "failed":
      return t("status.problem");
    default:
      return t("status.checking");
  }
}

function resolveHeadline({
  attentionCount,
  configMissing,
  loading,
  running,
}: {
  attentionCount: number;
  configMissing: boolean;
  loading: boolean;
  running: boolean;
}) {
  if (loading) {
    return {
      mark: "running" as const,
      icon: LoaderCircle,
      titleKey: "home.checking" as const,
      textKey: "home.checkingText" as const,
    };
  }
  if (configMissing) {
    return {
      mark: "problem" as const,
      icon: AlertTriangle,
      titleKey: "home.unavailable" as const,
      textKey: "home.unavailableText" as const,
    };
  }
  if (running) {
    return {
      mark: "running" as const,
      icon: LoaderCircle,
      titleKey: "home.running" as const,
      textKey: "home.runningText" as const,
    };
  }
  if (attentionCount === 1) {
    return {
      mark: "attention" as const,
      icon: AlertTriangle,
      titleKey: "home.oneThing" as const,
      textKey: "home.attentionText" as const,
    };
  }
  if (attentionCount > 1) {
    return {
      mark: "attention" as const,
      icon: AlertTriangle,
      titleKey: "home.someThings" as const,
      textKey: "home.attentionText" as const,
    };
  }
  return {
    mark: "ready" as const,
    icon: Check,
    titleKey: "home.allNormal" as const,
    textKey: "home.allNormalText" as const,
  };
}
