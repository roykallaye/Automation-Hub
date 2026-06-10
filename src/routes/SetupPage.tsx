import { Sparkles } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { SetupStatusPanel } from "../components/SetupStatusPanel";
import { SetupWizard } from "../components/SetupWizard/SetupWizard";
import { staffMessage } from "../messages";
import type { AppConfigStatus } from "../types";

export function SetupPage({
  configStatus,
  loading,
  onRefresh,
  onGoToAutomations,
}: {
  configStatus: AppConfigStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onGoToAutomations: () => void;
}) {
  const [showWizard, setShowWizard] = useState(false);
  const setupIncomplete =
    !loading &&
    (!configStatus ||
      configStatus.preflight.items.some((item) =>
        ["missingConfiguration", "missingScript", "missingFolder", "permissionProblem", "warning"].includes(
          item.status,
        ),
      ) ||
      configStatus.preflight.workflows.some((workflow) => workflow.commandName && !workflow.canRun));
  const nextIssue = configStatus?.preflight.workflows.find(
    (workflow) => workflow.commandName && !workflow.canRun,
  );
  const setupReady =
    !loading &&
    Boolean(configStatus) &&
    !configStatus?.preflight.workflows.some((workflow) => workflow.commandName && !workflow.canRun);

  return (
    <div className="space-y-5">
      <PageHeader title="Setup" eyebrow="Readiness check">
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </PageHeader>

      {showWizard ? (
        <SetupWizard
          config={configStatus?.config}
          onClose={() => setShowWizard(false)}
          onSetupSaved={onRefresh}
        />
      ) : (
        <section
          className={[
            "rounded-lg border p-6 shadow-glass backdrop-blur-xl",
            setupIncomplete
              ? "border-amber-200 bg-amber-50"
              : "border-white/60 bg-white/52",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-teal-100">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">Guided setup</h2>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                  Collect hotel details, folders, Gmail draft settings, invoice rules, contract
                  settings, and safety preferences in a simple draft.
                </p>
                {setupIncomplete && (
                  <p className="mt-3 text-sm font-semibold text-amber-900">
                    Setup needs attention. Start guided setup to prepare the missing details.
                  </p>
                )}
              </div>
            </div>
            <button
              className="shrink-0 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={() => setShowWizard(true)}
            >
              Start guided setup
            </button>
          </div>
        </section>
      )}

      {!showWizard && setupReady && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-glass">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-emerald-950">Setup is ready</h2>
              <p className="mt-1 text-sm font-medium text-emerald-800">
                FlowHost setup checks are passing. Workflows are still started manually.
              </p>
            </div>
            <button
              className="shrink-0 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={onGoToAutomations}
            >
              Go to Automations
            </button>
          </div>
        </section>
      )}

      {!showWizard && !setupReady && nextIssue && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-glass">
          <p className="text-sm font-semibold text-amber-950">Next item to fix</p>
          <p className="mt-1 text-sm font-medium leading-6 text-amber-800">
            {staffMessage(nextIssue.message, nextIssue.status, nextIssue.key)}
          </p>
        </section>
      )}

      <SetupStatusPanel
        configStatus={configStatus}
        loading={loading}
        onRefresh={onRefresh}
      />

      <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="text-xl font-semibold text-slate-950">Setup editing</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
          FlowHost can show setup readiness here. Editing and first-time setup will be added in the
          next phase.
        </p>
      </section>
    </div>
  );
}
