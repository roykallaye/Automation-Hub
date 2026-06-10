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
    <section className="rounded-lg border border-white/60 bg-white/58 p-6 shadow-glass backdrop-blur-xl">
      <div className="mb-6 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-teal-100">
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
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}

export const inputClassName =
  "w-full rounded-md border border-white/70 bg-white/75 px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-teal-200 focus:ring-teal-200";

export const textareaClassName =
  "min-h-28 w-full rounded-md border border-white/70 bg-white/75 px-3 py-3 text-sm font-semibold leading-6 text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-teal-200 focus:ring-teal-200";
