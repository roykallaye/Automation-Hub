import type { ReactNode } from "react";

export function PageHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-sm font-semibold text-teal-800">{eyebrow}</p>}
        <h2 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}
