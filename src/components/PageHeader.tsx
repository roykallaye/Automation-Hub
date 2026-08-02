import type { ReactNode } from "react";

export function PageHeader({
  title,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}
