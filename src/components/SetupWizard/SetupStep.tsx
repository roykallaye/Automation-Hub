import type { ReactNode } from "react";

export function SetupStep({
  icon,
  title,
  helper,
  children,
}: {
  icon: ReactNode;
  title: string;
  helper: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/65 bg-white/60 p-5 shadow-glass backdrop-blur-xl sm:p-6">
      <div className="mb-6 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-800 ring-1 ring-brand-100">
          {icon}
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">{helper}</p>
        </div>
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
        {help && (
          <span
            className="inline-grid h-5 w-5 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800 ring-1 ring-brand-100"
            title={help}
            aria-label={help}
          >
            ?
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

export const inputClassName =
  "w-full rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200";

export const textareaClassName =
  "min-h-28 w-full rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold leading-6 text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200";
