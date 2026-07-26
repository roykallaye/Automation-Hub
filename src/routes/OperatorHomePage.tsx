import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  FolderCheck,
  History,
  PlayCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { useI18n } from "../i18n";
import { fillCopy, operatorCopy } from "../operatorCopy";
import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  ModuleReadiness,
  ModuleReadinessId,
  RunSummary,
} from "../types";
import type { NextAction } from "../nextAction";

export function OperatorHomePage({
  activityHistory,
  configStatus,
  loading,
  modules,
  nextAction,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  lastSummary: RunSummary | null;
  activityHistory: ActivityRecord[];
  nextAction: NextAction;
  onNavigate: (page: AppPage) => void;
}) {
  const { language } = useI18n();
  const words = operatorCopy(language);
  const primaryModules = configStatus?.config.invoiceDeliveryMode === "prepareOnly"
    ? ["invoices"] as ModuleReadinessId[]
    : ["invoices", "gmailDrafts"] as ModuleReadinessId[];
  const invoiceState = combinedState(modules, primaryModules, loading);
  const contractsState = combinedState(modules, ["contracts"], loading);
  const workModules = modules.filter((module) => module.id !== "support");
  const readyCount = workModules.filter((module) => module.status === "ready").length;
  const successfulRuns = activityHistory.filter((item) => item.status === "success").length;
  const itemsHandled = activityHistory.reduce(
    (total, item) =>
      total
      + (item.summary.processed
        ?? item.summary.created
        ?? item.summary.moved
        ?? item.summary.found
        ?? 0),
    0,
  );
  const latest = activityHistory[activityHistory.length - 1] ?? null;
  const needsSetup = !configStatus || readyCount < Math.min(2, workModules.length);

  return (
    <div className="op-home">
      <section className={`op-hero op-hero--${nextAction.tone}`}>
        <div className="op-hero__copy">
          <span className="op-eyebrow"><Sparkles aria-hidden="true" size={14} /> {words.homeEyebrow}</span>
          <p className="op-hero__greeting">{words.homeGreeting}</p>
          <h1>{nextAction.title}</h1>
          <p>{nextAction.shortMessage}</p>
          <div className="op-hero__actions">
            <button className="op-primary-button" onClick={() => onNavigate(nextAction.targetPage)} type="button">
              {nextAction.buttonLabel}<ArrowRight aria-hidden="true" size={17} />
            </button>
            <span><ShieldCheck aria-hidden="true" size={15} /> {words.homeTrustLocal}</span>
            <span><CheckCircle2 aria-hidden="true" size={15} /> {words.homeTrustReview}</span>
          </div>
        </div>
        <div className="op-hero__visual" aria-hidden="true">
          <span className="op-hero__orbit op-hero__orbit--outer" />
          <span className="op-hero__orbit op-hero__orbit--inner" />
          <span className="op-hero__core"><PlayCircle size={31} /></span>
          <span className="op-hero__node op-hero__node--one"><FileText size={18} /></span>
          <span className="op-hero__node op-hero__node--two"><FolderCheck size={18} /></span>
          <span className="op-hero__node op-hero__node--three"><CheckCircle2 size={18} /></span>
        </div>
      </section>

      <section className="op-section-heading">
        <div>
          <h2>{words.homeWorkTitle}</h2>
          <p>{words.homeWorkText}</p>
        </div>
        <span className="op-readiness-summary">
          {fillCopy(words.readyAreas, { ready: readyCount, total: workModules.length })}
        </span>
      </section>

      <section className="op-home-grid">
        <WorkflowDestination
          icon={FileText}
          kicker={words.invoicesKicker}
          title={words.invoicesTitle}
          text={words.invoicesText}
          state={invoiceState}
          stateLabels={{ ready: words.ready, blocked: words.blocked, checking: words.checking }}
          onOpen={() => onNavigate(invoiceState === "blocked" ? "setup" : "automations")}
          action={invoiceState === "blocked" ? words.fixSetup : words.openWorkflow}
          featured
        />
        <WorkflowDestination
          icon={FolderCheck}
          kicker={words.documentsKicker}
          title={words.documentsTitle}
          text={words.documentsText}
          state={contractsState}
          stateLabels={{ ready: words.ready, blocked: words.blocked, checking: words.checking }}
          onOpen={() => onNavigate(contractsState === "blocked" ? "setup" : "automations")}
          action={contractsState === "blocked" ? words.fixSetup : words.openWorkflow}
        />
        <RecentResult
          latest={latest}
          language={language}
          onOpen={() => onNavigate("activity")}
          words={words}
        />
      </section>

      {needsSetup ? (
        <section className="op-setup-strip">
          <span className="op-setup-strip__icon"><FolderCheck aria-hidden="true" size={22} /></span>
          <div>
            <strong>{words.setupCompactTitle}</strong>
            <p>{words.setupCompactText}</p>
          </div>
          <button onClick={() => onNavigate("setup")} type="button">
            {words.setupCompactAction}<ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>
      ) : (
        <section className="op-impact-strip" aria-label="InnPilot progress">
          <span><strong>{successfulRuns}</strong><small>{words.runsCompleted}</small></span>
          <i />
          <span><strong>{itemsHandled}</strong><small>{words.itemsHandled}</small></span>
          <i />
          <span><ShieldCheck aria-hidden="true" size={20} /><small>{words.protected}</small></span>
        </section>
      )}
    </div>
  );
}

type DestinationState = "ready" | "blocked" | "checking";

function combinedState(
  modules: ModuleReadiness[],
  ids: ModuleReadinessId[],
  loading: boolean,
): DestinationState {
  if (loading) return "checking";
  const selected = ids.map((id) => modules.find((module) => module.id === id));
  return selected.length > 0 && selected.every((module) => module?.status === "ready")
    ? "ready"
    : "blocked";
}

function WorkflowDestination({
  action,
  featured = false,
  icon: Icon,
  kicker,
  onOpen,
  state,
  stateLabels,
  text,
  title,
}: {
  action: string;
  featured?: boolean;
  icon: typeof FileText;
  kicker: string;
  onOpen: () => void;
  state: DestinationState;
  stateLabels: Record<DestinationState, string>;
  text: string;
  title: string;
}) {
  return (
    <button
      className={`op-destination${featured ? " is-featured" : ""}`}
      onClick={onOpen}
      type="button"
    >
      <span className="op-destination__top">
        <span className="op-destination__icon"><Icon aria-hidden="true" size={23} /></span>
        <span className={`op-state-dot is-${state}`}><i /> {stateLabels[state]}</span>
      </span>
      <span className="op-destination__copy">
        <small>{kicker}</small>
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <span className="op-destination__action">{action}<ArrowRight aria-hidden="true" size={17} /></span>
    </button>
  );
}

function RecentResult({
  language,
  latest,
  onOpen,
  words,
}: {
  language: "en" | "it";
  latest: ActivityRecord | null;
  onOpen: () => void;
  words: ReturnType<typeof operatorCopy>;
}) {
  const successful = latest?.status === "success";
  return (
    <button className="op-recent" onClick={onOpen} type="button">
      <span className="op-recent__icon">
        {latest ? <History aria-hidden="true" size={21} /> : <Clock3 aria-hidden="true" size={21} />}
      </span>
      <small>{words.recentKicker}</small>
      <strong>{latest?.workflowTitle || words.recentTitle}</strong>
      <p>
        {latest
          ? `${formatDate(latest.finishedAt, language)} · ${activityLabel(latest, language)}`
          : words.recentText}
      </p>
      <span className={`op-recent__status${successful ? " is-success" : ""}`}>
        {latest ? activityLabel(latest, language) : words.noRun}
      </span>
      <span className="op-recent__action">{words.recentOpen}<ArrowRight aria-hidden="true" size={16} /></span>
    </button>
  );
}

function activityLabel(record: ActivityRecord, language: "en" | "it") {
  const labels = language === "it"
    ? {
        success: "Completata",
        needs_attention: "Da controllare",
        failed: "Non riuscita",
        cancelled: "Annullata",
        unknown: "Risultato disponibile",
      }
    : {
        success: "Completed",
        needs_attention: "Review needed",
        failed: "Failed",
        cancelled: "Cancelled",
        unknown: "Result available",
      };
  return labels[record.status];
}

function formatDate(value: string, language: "en" | "it") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
