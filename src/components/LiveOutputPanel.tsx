import { Terminal } from "lucide-react";

export function LiveOutputPanel({ liveOutput }: { liveOutput: string[] }) {
  return (
    <section className="rounded-xl border border-slate-900/10 bg-slate-950/90 p-5 shadow-glass">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <Terminal className="h-5 w-5 text-teal-300" />
          <h2 className="text-lg font-semibold">Run progress</h2>
        </div>
        <span className="text-xs font-medium text-slate-300">
          {liveOutput.length ? `${liveOutput.length} lines` : "Idle"}
        </span>
      </div>
      <p className="text-sm font-medium text-slate-200">
        {liveOutput.length
          ? "InnPilot is tracking this run."
          : "No automation is running right now."}
      </p>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-semibold text-teal-200">
          Show technical output
        </summary>
        <pre className="mt-3 h-56 overflow-auto rounded-md bg-black/30 p-4 font-mono text-xs leading-5 text-slate-100">
          {liveOutput.length ? liveOutput.join("\n") : "No technical output yet."}
        </pre>
      </details>
    </section>
  );
}
