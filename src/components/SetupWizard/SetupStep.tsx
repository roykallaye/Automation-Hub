import type { ReactNode } from "react";

import { InfoHint } from "../InfoHint";

export function SetupStep({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200/80 bg-white/90 p-5 shadow-glass backdrop-blur-xl sm:p-6">
      <div className="mb-5 flex items-center gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-800 ring-1 ring-zinc-200">
          {icon}
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function FieldLabel({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        {label}
        {help && <InfoHint text={help} />}
      </span>
      {children}
    </label>
  );
}

export const inputClassName =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-3 text-sm font-semibold text-zinc-900 outline-none ring-1 ring-transparent transition placeholder:text-zinc-400 focus:border-brand-300 focus:ring-brand-100";

export const textareaClassName =
  "min-h-28 w-full rounded-lg border border-zinc-200 bg-white px-3 py-3 text-sm font-semibold leading-6 text-zinc-900 outline-none ring-1 ring-transparent transition placeholder:text-zinc-400 focus:border-brand-300 focus:ring-brand-100";
