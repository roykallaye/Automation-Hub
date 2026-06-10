import { DetailsPanel } from "../components/DetailsPanel";
import { LiveOutputPanel } from "../components/LiveOutputPanel";
import { PageHeader } from "../components/PageHeader";
import type { AppConfigStatus, LatestLog, RunSummary } from "../types";

export function ActivityPage({
  configStatus,
  latestLogs,
  liveOutput,
  lastSummary,
  onOpenPath,
  onRefresh,
}: {
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  liveOutput: string[];
  lastSummary: RunSummary | null;
  onOpenPath: (path?: string | null) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title="Activity" eyebrow="Runs and results">
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
        <section className="space-y-5">
          <LiveOutputPanel liveOutput={liveOutput} />
          {!lastSummary && (
            <div className="rounded-xl border border-white/65 bg-white/55 p-6 shadow-glass backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-slate-950">No activity yet</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                Runs will appear here after staff start an automation from the Automations page.
              </p>
            </div>
          )}
        </section>
        <DetailsPanel
          summary={lastSummary}
          latestLogs={latestLogs}
          configStatus={configStatus}
          showDeveloperDetails={false}
          onOpenPath={onOpenPath}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}
