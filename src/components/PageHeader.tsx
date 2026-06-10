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
    <div className="mb-5 flex items-start justify-between gap-5">
      <div>
        {eyebrow && <p className="text-sm font-semibold text-teal-800">{eyebrow}</p>}
        <h2 className="mt-1 text-3xl font-semibold text-slate-950">{title}</h2>
      </div>
      {children}
    </div>
  );
}
