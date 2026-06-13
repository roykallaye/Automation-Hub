import { RefreshCw } from "lucide-react";

import { useI18n } from "../i18n";
import { friendlyWorkflowLabel, staffMessage } from "../messages";
import type { AppConfigStatus } from "../types";
import { ReadinessBadge } from "./StatusBadges";

export function SetupStatusPanel({
  configStatus,
  loading,
  onRefresh,
}: {
  configStatus: AppConfigStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const workflows = configStatus?.preflight.workflows ?? [];
  const automationConfig = configStatus?.preflight.items.find(
    (item) => item.key === "automationConfigPath",
  );
  const configAlignment = configStatus?.preflight.items.find(
    (item) => item.key === "configAlignment" && item.status === "warning",
  );
  return (
    <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-4 flex items-start justify-between gap-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{t("setup.panelTitle")}</h2>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {configStatus
              ? t("setup.panelReadyText")
              : loading
                ? t("setup.panelChecking")
                : t("app.setupLoadFailed")}
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-white/70 bg-white/65 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          <RefreshCw className="h-4 w-4 text-brand-700" />
          {t("common.refresh")}
        </button>
      </div>
      {automationConfig && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-white/60 p-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("setup.automationSetupFile")}</p>
            <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
              {staffMessage(
                automationConfig.message,
                automationConfig.status,
                automationConfig.key,
              )}
            </p>
          </div>
          <ReadinessBadge status={automationConfig.status} />
        </div>
      )}
      {configAlignment && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
          <div>
            <p className="text-sm font-semibold text-amber-950">{t("setup.needsReview")}</p>
            <p className="mt-1 text-xs font-medium leading-5 text-amber-800">
              {staffMessage(configAlignment.message, configAlignment.status, configAlignment.key)}
            </p>
          </div>
          <ReadinessBadge status={configAlignment.status} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workflows.map((workflow) => (
          <div key={workflow.key} className="rounded-md bg-white/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">
                {friendlyWorkflowLabel(workflow)}
              </p>
              <ReadinessBadge status={workflow.status} />
            </div>
            <p className="min-h-10 text-xs font-medium leading-5 text-slate-600">
              {staffMessage(workflow.message, workflow.status, workflow.key)}
            </p>
          </div>
        ))}
        {!workflows.length && (
          <div className="rounded-md bg-white/60 p-3 text-sm font-medium text-slate-700">
            {t("setup.notChecked")}
          </div>
        )}
      </div>
    </section>
  );
}
