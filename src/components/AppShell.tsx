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
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#dfe7e8_42%,#f5efe6_100%)]" />
      <div className="absolute inset-x-0 top-0 h-48 bg-white/45 backdrop-blur-3xl" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-8 py-7">
        <header className="flex items-center justify-between gap-5">
          <div>
            <p className="text-sm font-medium text-teal-800">{displayName}</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-normal text-slate-950">
              FlowHost
            </h1>
          </div>
          <StatusPill status={status} label={statusLabel} />
        </header>

        <div className="grid flex-1 gap-5 lg:grid-cols-[220px_1fr]">
          <Navigation currentPage={currentPage} onPageChange={onPageChange} />
          <div className="min-w-0">{children}</div>
        </div>
      </section>
    </main>
  );
}
