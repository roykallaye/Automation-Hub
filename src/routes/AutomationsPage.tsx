/*
  Automations — business workflows, not Python scripts.

  The list shows icon, name, one-line purpose and a simple status. Opening a
  workflow gives what it does, its recent result, the run action when it is
  actually runnable, and its essential setting. Scripts, folders and paths live
  under "Advanced configuration".
*/

import {
  FileSignature,
  FileText,
  FolderOpen,
  KeyRound,
  Play,
  ScanText,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import {
  contractAction,
  gmailReconnectAction,
  invoiceAction,
  maintenanceActions,
} from "../actions";
import {
  Button,
  Card,
  DetailList,
  EmptyState,
  Note,
  PageHead,
  Row,
  Rows,
  Status,
  TechnicalDetails,
} from "../components/ui";
import { useI18n, type TranslationKey, type Translate } from "../i18n";
import { deliveryModeLabel } from "../messages";
import { moduleForCommand } from "../moduleReadiness";
import { activityTone, formatWhen, moduleStatusLabel, moduleTone } from "../statusMapping";
import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  AutomationAction,
  ModuleReadiness,
} from "../types";

type WorkflowEntry = {
  action: AutomationAction;
  icon: LucideIcon;
  nameKey: TranslationKey;
  purposeKey: TranslationKey;
  /** The folder a manager would actually want to open for this workflow. */
  folderKey?: keyof AppConfigStatus["config"]["folders"];
};

const [scanAction, ocrAction] = maintenanceActions;

const WORKFLOWS: WorkflowEntry[] = [
  {
    action: invoiceAction,
    icon: FileText,
    nameKey: "workflow.invoices",
    purposeKey: "workflow.invoicesPurpose",
    folderKey: "invoiceInputFolder",
  },
  {
    action: contractAction,
    icon: FileSignature,
    nameKey: "workflow.contracts",
    purposeKey: "workflow.contractsPurpose",
    folderKey: "contractsOutputFolder",
  },
  {
    action: scanAction,
    icon: FolderOpen,
    nameKey: "workflow.scans",
    purposeKey: "workflow.scansPurpose",
    folderKey: "scansioniNetworkShare",
  },
  {
    action: ocrAction,
    icon: ScanText,
    nameKey: "workflow.ocr",
    purposeKey: "workflow.ocrPurpose",
    folderKey: "ocrTextOutputFolder",
  },
  {
    action: gmailReconnectAction,
    icon: KeyRound,
    nameKey: "workflow.gmail",
    purposeKey: "workflow.gmailPurpose",
  },
];

export function AutomationsPage({
  actionDisabledReason,
  activityHistory,
  configStatus,
  modules,
  onNavigate,
  onOpenPath,
  onRun,
  runningCommand,
}: {
  actionDisabledReason: (action: AutomationAction) => string | null;
  activityHistory: ActivityRecord[];
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  onNavigate: (page: AppPage) => void;
  onOpenPath: (path?: string | null) => void;
  onRun: (action: AutomationAction) => void;
  runningCommand: string | null;
}) {
  const { t } = useI18n();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Gmail only belongs in the list when the hotel actually uses it.
  const visible = WORKFLOWS.filter(
    (entry) =>
      entry.action !== gmailReconnectAction ||
      configStatus?.config.invoiceDeliveryMode !== "prepareOnly",
  );

  const opened = visible.find((entry) => entry.action.commandName === openKey) ?? null;

  if (opened) {
    return (
      <WorkflowDetail
        activityHistory={activityHistory}
        configStatus={configStatus}
        disabledReason={actionDisabledReason(opened.action)}
        entry={opened}
        modules={modules}
        onBack={() => setOpenKey(null)}
        onFixSetup={() => onNavigate("system")}
        onOpenPath={onOpenPath}
        onRun={() => onRun(opened.action)}
        running={runningCommand === opened.action.commandName}
      />
    );
  }

  return (
    <>
      <PageHead description={t("automations.description")} title={t("automations.title")} />

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <Button onClick={() => onNavigate("system")} variant="primary">
                {t("automations.fixSetup")}
              </Button>
            }
            icon={WorkflowIcon}
            message={t("automations.noneText")}
            title={t("automations.noneTitle")}
          />
        </Card>
      ) : (
        <Card>
          <Rows>
            {visible.map((entry) => {
              const module = moduleForCommand(modules, entry.action.commandName);
              const running = runningCommand === entry.action.commandName;
              return (
                <Row
                  icon={entry.icon}
                  key={entry.action.commandName}
                  meta={t(entry.purposeKey)}
                  onOpen={() => setOpenKey(entry.action.commandName)}
                  openLabel={`${t(entry.nameKey)} — ${t("automations.open")}`}
                  status={
                    running
                      ? { tone: "running", label: t("automations.running") }
                      : module
                        ? {
                            tone: moduleTone(module.status),
                            label: moduleStatusLabel(module.status, t),
                          }
                        : { tone: "idle", label: t("status.checking") }
                  }
                  title={t(entry.nameKey)}
                />
              );
            })}
          </Rows>
        </Card>
      )}
    </>
  );
}

function WorkflowDetail({
  activityHistory,
  configStatus,
  disabledReason,
  entry,
  modules,
  onBack,
  onFixSetup,
  onOpenPath,
  onRun,
  running,
}: {
  activityHistory: ActivityRecord[];
  configStatus: AppConfigStatus | null;
  disabledReason: string | null;
  entry: WorkflowEntry;
  modules: ModuleReadiness[];
  onBack: () => void;
  onFixSetup: () => void;
  onOpenPath: (path?: string | null) => void;
  onRun: () => void;
  running: boolean;
}) {
  const { language, t } = useI18n();
  const module = moduleForCommand(modules, entry.action.commandName);
  const last = [...activityHistory]
    .reverse()
    .find((record) => record.workflowCommandName === entry.action.commandName);
  const folders = configStatus?.config.folders;
  const folderPath = entry.folderKey ? folders?.[entry.folderKey] : undefined;

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Button onClick={onBack} variant="ghost">
          {t("automations.back")}
        </Button>
      </div>

      <PageHead
        actions={
          module?.status === "ready" && !disabledReason ? (
            <Button busy={running} icon={Play} onClick={onRun} variant="primary">
              {t("automations.runSafe")}
            </Button>
          ) : (
            <Button onClick={onFixSetup} variant="secondary">
              {t("automations.fixSetup")}
            </Button>
          )
        }
        description={t(entry.purposeKey)}
        title={t(entry.nameKey)}
      />

      <div className="ip-stack">
        <Card>
          <Rows>
            <Row
              title={t("automations.whatItDoes")}
              meta={t(entry.purposeKey)}
              aside={
                <Status
                  label={
                    running
                      ? t("automations.running")
                      : module
                        ? moduleStatusLabel(module.status, t)
                        : t("status.checking")
                  }
                  tone={running ? "running" : module ? moduleTone(module.status) : "idle"}
                />
              }
            />
            <Row
              title={t("automations.recentResult")}
              meta={
                last
                  ? `${formatWhen(last.finishedAt, language, t("common.never"))} · ${itemsHandled(last, t)}`
                  : t("automations.neverRun")
              }
              aside={
                last ? (
                  <Status label={activityLabel(last, t)} tone={activityTone(last.status)} />
                ) : undefined
              }
            />
            {entry.action === invoiceAction ? (
              <Row
                title={t("field.invoiceDelivery")}
                meta={deliveryModeLabel(configStatus?.config.invoiceDeliveryMode, t)}
              />
            ) : null}
            {folderPath ? (
              <Row
                title={t("common.folder")}
                meta={entry.folderKey ? folderMeaning(entry.folderKey, t) : ""}
                stackAsideOnMobile
                aside={
                  <Button icon={FolderOpen} onClick={() => onOpenPath(folderPath)} variant="ghost">
                    {t("automations.openFolder")}
                  </Button>
                }
              />
            ) : null}
          </Rows>
        </Card>

        {disabledReason ? <Note tone="attention">{disabledReason}</Note> : null}

        <TechnicalDetails label={t("automations.advanced")}>
          <DetailList
            items={[
              { label: "Command", value: entry.action.commandName, mono: true },
              { label: "Workflow key", value: entry.action.workflowKey, mono: true },
              ...(folderPath ? [{ label: "Folder", value: folderPath, mono: true }] : []),
              ...(module
                ? [
                    { label: "Readiness", value: module.status },
                    ...(module.blockingProblems.length > 0
                      ? [{ label: "Blocking", value: module.blockingProblems.join(" · ") }]
                      : []),
                    ...(module.warnings.length > 0
                      ? [{ label: "Warnings", value: module.warnings.join(" · ") }]
                      : []),
                  ]
                : []),
            ]}
          />
        </TechnicalDetails>
      </div>
    </>
  );
}

function itemsHandled(record: ActivityRecord, t: Translate) {
  const count =
    record.summary.processed ??
    record.summary.created ??
    record.summary.moved ??
    record.summary.found ??
    0;
  return count > 0 ? t("activity.itemsHandled", { count }) : t("activity.noItems");
}

function activityLabel(record: ActivityRecord, t: Translate) {
  switch (record.status) {
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

function folderMeaning(key: keyof AppConfigStatus["config"]["folders"], t: Translate) {
  const map: Partial<Record<typeof key, TranslationKey>> = {
    invoiceInputFolder: "field.invoiceInputMeaning",
    invoiceOutputFolder: "field.invoiceOutputMeaning",
    invoiceArchiveFolder: "field.invoiceArchiveMeaning",
    invoiceLogFolder: "field.invoiceLogMeaning",
    scansioniNetworkShare: "field.sharedScansMeaning",
    scansioniLocalCacheFolder: "field.scanCacheMeaning",
    ocrTextOutputFolder: "field.ocrOutputMeaning",
    contractsOutputFolder: "field.signedContractsMeaning",
    contractLogFolder: "field.contractLogMeaning",
  };
  const translationKey = map[key];
  return translationKey ? t(translationKey) : "";
}
