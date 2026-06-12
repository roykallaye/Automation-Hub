import type { ReactNode } from "react";

import type { AppPage, RunStatus } from "../types";
import type { NextAction } from "../nextAction";
import { Navigation } from "./Navigation";

export function AppShell({
  children,
  currentPage,
  displayName,
  logoDataUrl,
  nextAction,
  onPageChange,
}: {
  children: ReactNode;
  currentPage: AppPage;
  displayName: string;
  logoDataUrl?: string | null;
  status: RunStatus;
  statusLabel: string;
  nextAction: NextAction;
  onPageChange: (page: AppPage) => void;
}) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--app-bg-from)_0%,var(--app-bg-via)_46%,var(--app-bg-to)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-56 bg-white/50 backdrop-blur-3xl" />
      <BrandWatermark displayName={displayName} logoDataUrl={logoDataUrl} />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="flex items-center justify-between gap-4 rounded-xl border border-white/65 bg-white/45 px-4 py-3.5 shadow-glass backdrop-blur-xl sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            {logoDataUrl ? (
              <img
                src={logoDataUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-lg object-contain ring-1 ring-slate-900/10"
              />
            ) : (
              <div
                aria-hidden="true"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-800 text-lg font-semibold text-white"
              >
                {brandInitial(displayName)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                {displayName}
              </h1>
              <p className="truncate text-xs font-semibold text-brand-800">
                InnPilot · Hotel back-office, prepared with care
              </p>
            </div>
          </div>
        </header>

        <GuidanceBanner nextAction={nextAction} onPageChange={onPageChange} />

        <div className="grid flex-1 gap-5 lg:grid-cols-[210px_1fr]">
          <Navigation
            currentPage={currentPage}
            nextAction={nextAction}
            onPageChange={onPageChange}
          />
          <div id="main-content" key={currentPage} className="min-w-0 animate-rise">
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

function brandInitial(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? trimmed[0].toUpperCase() : "I";
}

/** Faint hotel mark; decorative only. Opacity comes from --watermark-opacity. */
function BrandWatermark({
  displayName,
  logoDataUrl,
}: {
  displayName: string;
  logoDataUrl?: string | null;
}) {
  return (
    <div className="brand-watermark" aria-hidden="true">
      {logoDataUrl ? (
        <img src={logoDataUrl} alt="" className="h-44 w-44 object-contain" />
      ) : (
        <p className="select-none text-6xl font-semibold tracking-tight text-brand-950">
          {displayName.trim() || "InnPilot"}
        </p>
      )}
    </div>
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
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft"
          onClick={() => onPageChange(nextAction.targetPage)}
        >
          {nextAction.buttonLabel}
        </button>
      </div>
    </section>
  );
}
