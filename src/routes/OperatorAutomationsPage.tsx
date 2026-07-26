import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  FolderCheck,
  KeyRound,
  LoaderCircle,
  ScanText,
  ShieldCheck,
} from "lucide-react";

import {
  contractAction,
  gmailReconnectAction,
  invoiceAction,
  maintenanceActions,
} from "../actions";
import { useI18n } from "../i18n";
import { deliveryModeLabel } from "../messages";
import { moduleForCommand } from "../moduleReadiness";
import { fillCopy, operatorCopy } from "../operatorCopy";
import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  AutomationAction,
  ModuleReadiness,
} from "../types";

export function OperatorAutomationsPage({
  actionDisabledReason,
  activityHistory,
  configStatus,
  modules,
  onNavigate,
  onOpenPath,
  onRun,
  runningCommand,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  activityHistory: ActivityRecord[];
  runningCommand: string | null;
  actionDisabledReason: (action: AutomationAction) => string | null;
  onRun: (action: AutomationAction) => void;
  onOpenPath: (path?: string | null) => void;
  onNavigate: (page: AppPage) => void;
}) {
  const { language, t } = useI18n();
  const words = operatorCopy(language);
  const anyRunning = Boolean(runningCommand);
  const [scanAction, ocrAction] = maintenanceActions;
  const folders = configStatus?.config.folders;

  const lastRun = (commandName: string) => {
    const record = [...activityHistory]
      .reverse()
      .find((item) => item.workflowCommandName === commandName);
    return record
      ? fillCopy(words.lastRun, { time: formatTime(record.finishedAt, language) })
      : words.noRun;
  };

  return (
    <div className="op-workflows">
      <header className="op-page-heading">
        <span>{words.automationsEyebrow}</span>
        <h1>{words.automationsTitle}</h1>
        <p>{words.automationsText}</p>
      </header>

      <section className="op-workflow-section">
        <div className="op-workflow-section__heading">
          <div><h2>{words.dailyTitle}</h2><p>{words.dailyText}</p></div>
          <span><ShieldCheck aria-hidden="true" size={15} /> {words.safeMode}</span>
        </div>
        <div className="op-workflow-grid">
          <OperatorWorkflowCard
            actionLabel={words.runSafe}
            anyRunning={anyRunning}
            description={words.invoicesText}
            disabledReason={actionDisabledReason(invoiceAction)}
            folderLabel={words.openFolder}
            icon={FileText}
            isRunning={runningCommand === invoiceAction.commandName}
            kicker={words.invoicesKicker}
            lastRun={lastRun(invoiceAction.commandName)}
            mode={fillCopy(words.invoicesMode, {
              mode: deliveryModeLabel(configStatus?.config.invoiceDeliveryMode, t),
            })}
            module={moduleForCommand(modules, invoiceAction.commandName)}
            onFix={() => onNavigate("setup")}
            onOpenFolder={() => onOpenPath(folders?.invoiceInputFolder)}
            onRun={() => onRun(invoiceAction)}
            statusLabels={{
              blocked: words.blocked,
              ready: words.ready,
              running: words.running,
            }}
            title={words.invoicesTitle}
          />
          <OperatorWorkflowCard
            actionLabel={words.runSafe}
            anyRunning={anyRunning}
            description={words.documentsText}
            disabledReason={actionDisabledReason(contractAction)}
            folderLabel={words.openFolder}
            icon={FolderCheck}
            isRunning={runningCommand === contractAction.commandName}
            kicker={words.documentsKicker}
            lastRun={lastRun(contractAction.commandName)}
            mode={words.contractsSafety}
            module={moduleForCommand(modules, contractAction.commandName)}
            onFix={() => onNavigate("setup")}
            onOpenFolder={() => onOpenPath(folders?.scansioniNetworkShare)}
            onRun={() => onRun(contractAction)}
            title={words.documentsTitle}
            statusLabels={{
              blocked: words.blocked,
              ready: words.ready,
              running: words.running,
            }}
          />
        </div>
      </section>

      <details className="op-tools">
        <summary>
          <span><span className="op-tools__icon"><ScanText aria-hidden="true" size={19} /></span><span><strong>{words.toolsTitle}</strong><small>{words.toolsText}</small></span></span>
          <ChevronDown aria-hidden="true" size={19} />
        </summary>
        <div className="op-tools__grid">
          <CompactToolCard
            action={scanAction}
            anyRunning={anyRunning}
            description={words.scansText}
            disabledReason={actionDisabledReason(scanAction)}
            icon={FolderCheck}
            isRunning={runningCommand === scanAction.commandName}
            onFix={() => onNavigate("setup")}
            onRun={() => onRun(scanAction)}
            title={words.scansTitle}
            words={words}
          />
          <CompactToolCard
            action={ocrAction}
            anyRunning={anyRunning}
            description={words.ocrText}
            disabledReason={actionDisabledReason(ocrAction)}
            icon={ScanText}
            isRunning={runningCommand === ocrAction.commandName}
            onFix={() => onNavigate("setup")}
            onRun={() => onRun(ocrAction)}
            title={words.ocrTitle}
            words={words}
          />
          {configStatus?.config.invoiceDeliveryMode !== "prepareOnly" ? (
            <CompactToolCard
              action={gmailReconnectAction}
              anyRunning={anyRunning}
              description={words.gmailText}
              disabledReason={actionDisabledReason(gmailReconnectAction)}
              icon={KeyRound}
              isRunning={runningCommand === gmailReconnectAction.commandName}
              onFix={() => onNavigate("setup")}
              onRun={() => onRun(gmailReconnectAction)}
              title={words.gmailTitle}
              words={words}
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}

function OperatorWorkflowCard({
  actionLabel,
  anyRunning,
  description,
  disabledReason,
  folderLabel,
  icon: Icon,
  isRunning,
  kicker,
  lastRun,
  mode,
  module,
  onFix,
  onOpenFolder,
  onRun,
  title,
  statusLabels,
}: {
  actionLabel: string;
  anyRunning: boolean;
  description: string;
  disabledReason: string | null;
  folderLabel: string;
  icon: typeof FileText;
  isRunning: boolean;
  kicker: string;
  lastRun: string;
  mode: string;
  module?: ModuleReadiness;
  onFix: () => void;
  onOpenFolder: () => void;
  onRun: () => void;
  statusLabels: {
    blocked: string;
    ready: string;
    running: string;
  };
  title: string;
}) {
  const ready = module?.status === "ready" && !disabledReason;
  return (
    <article className={`op-workflow-card${ready ? " is-ready" : " is-blocked"}${isRunning ? " is-running" : ""}`}>
      <div className="op-workflow-card__top">
        <span className="op-workflow-card__icon"><Icon aria-hidden="true" size={24} /></span>
        <span className={`op-workflow-state${ready ? " is-ready" : ""}`}>
          {isRunning ? <LoaderCircle aria-hidden="true" className="op-spin" size={14} /> : ready ? <CheckCircle2 aria-hidden="true" size={14} /> : <AlertCircle aria-hidden="true" size={14} />}
          {isRunning ? statusLabels.running : ready ? statusLabels.ready : statusLabels.blocked}
        </span>
      </div>
      <small>{kicker}</small>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="op-workflow-card__facts"><span>{mode}</span><span>{lastRun}</span></div>
      {disabledReason ? <p className="op-workflow-card__reason">{disabledReason}</p> : null}
      <div className="op-workflow-card__actions">
        {ready ? (
          <button className="op-primary-button" disabled={anyRunning} onClick={onRun} type="button">
            {isRunning ? <LoaderCircle aria-hidden="true" className="op-spin" size={16} /> : <ShieldCheck aria-hidden="true" size={16} />}
            {actionLabel}<ArrowRight aria-hidden="true" size={16} />
          </button>
        ) : (
          <button className="op-primary-button" onClick={onFix} type="button">{actionLabel}<ArrowRight aria-hidden="true" size={16} /></button>
        )}
        <button className="op-text-button" onClick={onOpenFolder} type="button">{folderLabel}</button>
      </div>
    </article>
  );
}

function CompactToolCard({
  action,
  anyRunning,
  description,
  disabledReason,
  icon: Icon,
  isRunning,
  onFix,
  onRun,
  title,
  words,
}: {
  action: AutomationAction;
  anyRunning: boolean;
  description: string;
  disabledReason: string | null;
  icon: typeof FileText;
  isRunning: boolean;
  onFix: () => void;
  onRun: () => void;
  title: string;
  words: ReturnType<typeof operatorCopy>;
}) {
  return (
    <article className="op-tool-card">
      <span><Icon aria-hidden="true" size={19} /></span>
      <div><strong>{title}</strong><p>{description}</p></div>
      <button
        disabled={!disabledReason && anyRunning}
        onClick={disabledReason ? onFix : onRun}
        type="button"
      >
        {isRunning ? <LoaderCircle aria-hidden="true" className="op-spin" size={14} /> : null}
        {disabledReason ? words.fixSetup : action === gmailReconnectAction ? words.reconnect : words.runSafe}
      </button>
    </article>
  );
}

function formatTime(value: string, language: "en" | "it") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
