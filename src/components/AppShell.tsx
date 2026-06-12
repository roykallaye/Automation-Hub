import type { ReactNode } from "react";

import type { AppPage, RunStatus } from "../types";
import type { NextAction } from "../nextAction";
import { Navigation } from "./Navigation";

export function AppShell({
  children,
  currentPage,
  displayName,
  status,
  statusLabel,
  nextAction,
  onPageChange,
}: {
  children: ReactNode;
  currentPage: AppPage;
  displayName: string;
  status: RunStatus;
  statusLabel: string;
  nextAction: NextAction;
  onPageChange: (page: AppPage) => void;
}) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#eef2f4] text-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#e5eeee_46%,#f4efe8_100%)]" />
      <div className="absolute inset-x-0 top-0 h-56 bg-white/50 backdrop-blur-3xl" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex flex-col gap-4 rounded-xl border border-white/65 bg-white/45 p-4 shadow-glass backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="text-sm font-semibold text-teal-800">{displayName}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
              InnPilot
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-600">
              Hotel operations, prepared with care.
            </p>
          </div>
        </header>

        <GuidanceBanner nextAction={nextAction} onPageChange={onPageChange} />

        <div className="grid flex-1 gap-5 lg:grid-cols-[210px_1fr]">
          <Navigation
            currentPage={currentPage}
            nextAction={nextAction}
            onPageChange={onPageChange}
          />
          <div className="min-w-0">{children}</div>
        </div>
      </section>
    </main>
  );
}

function GuidanceBanner({
  nextAction,
  onPageChange,
}: {
  nextAction: NextAction;
  onPageChange: (page: AppPage) => void;
}) {
  const styles =
    nextAction.tone === "success"
      ? "border-emerald-200 bg-emerald-50/85 text-emerald-950"
      : nextAction.tone === "blocked"
        ? "border-rose-200 bg-rose-50/85 text-rose-950"
        : nextAction.tone === "attention"
          ? "border-amber-200 bg-amber-50/85 text-amber-950"
          : "border-white/65 bg-white/60 text-slate-950";
  return (
    <section className={`rounded-xl border p-4 shadow-glass backdrop-blur-xl ${styles}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold">{nextAction.title}</p>
          <p className="mt-1 text-sm font-medium opacity-80">{nextAction.shortMessage}</p>
        </div>
        <button
          className="shrink-0 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          onClick={() => onPageChange(nextAction.targetPage)}
        >
          {nextAction.buttonLabel}
        </button>
      </div>
    </section>
  );
}
