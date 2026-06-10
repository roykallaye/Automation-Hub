import type { ReactNode } from "react";

import type { AppPage, RunStatus } from "../types";
import { Navigation } from "./Navigation";
import { StatusPill } from "./StatusBadges";

export function AppShell({
  children,
  currentPage,
  displayName,
  status,
  statusLabel,
  onPageChange,
}: {
  children: ReactNode;
  currentPage: AppPage;
  displayName: string;
  status: RunStatus;
  statusLabel: string;
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
              FlowHost
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-600">
              Hotel operations, prepared with care.
            </p>
          </div>
          <StatusPill status={status} label={statusLabel} />
        </header>

        <div className="grid flex-1 gap-5 lg:grid-cols-[210px_1fr]">
          <Navigation currentPage={currentPage} onPageChange={onPageChange} />
          <div className="min-w-0">{children}</div>
        </div>
      </section>
    </main>
  );
}
