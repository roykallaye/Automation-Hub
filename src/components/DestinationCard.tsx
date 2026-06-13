import { ArrowRight, type LucideIcon } from "lucide-react";

import { InfoHint } from "./InfoHint";
import { StatusHint, type StatusTone } from "./StatusOrb";
import { TINT_TILE, TINT_WASH, type CardTint } from "./tints";

/*
  DestinationCard: the large guided entry points on Home.

  Minimal text on the surface — title, status, action. The one-sentence
  explanation lives behind a friendly info bubble. Each destination gets its
  own cheerful tint so the grid feels colorful, not gray.
*/
export function DestinationCard({
  icon: Icon,
  title,
  description,
  tint = "brand",
  hintTone,
  hintLabel,
  actionLabel,
  highlighted = false,
  futureChip,
  onOpen,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  tint?: CardTint;
  hintTone: StatusTone;
  hintLabel: string;
  actionLabel: string;
  highlighted?: boolean;
  futureChip?: string;
  onOpen: () => void;
}) {
  return (
    <button
      className={[
        "card-lift group relative flex h-full flex-col rounded-xl border p-5 text-left shadow-glass backdrop-blur-xl",
        highlighted
          ? "next-highlight border-brand-200 bg-brand-50/70"
          : `border-white/65 ${TINT_WASH[tint]}`,
      ].join(" ")}
      onClick={onOpen}
    >
      {highlighted && (
        <span className="absolute right-4 top-4 rounded-full bg-brand-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          Start here
        </span>
      )}
      {futureChip && !highlighted && (
        <span className="absolute right-4 top-4 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200">
          {futureChip}
        </span>
      )}

      <div
        aria-hidden="true"
        className={[
          "grid h-12 w-12 place-items-center rounded-xl ring-1 transition-transform duration-fast group-hover:scale-105",
          highlighted ? "bg-brand-800 text-white ring-brand-800" : TINT_TILE[tint],
        ].join(" ")}
      >
        <Icon className="h-6 w-6" />
      </div>

      <span className="mt-4 inline-flex items-center gap-2">
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
        <InfoHint text={description} />
      </span>
      {/* Screen readers always get the sentence; sighted users hover the bubble. */}
      <span className="sr-only">{description}</span>

      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <StatusHint tone={hintTone} label={hintLabel} pulse={hintTone === "attention" && highlighted} />
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-800">
          {actionLabel}
          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </button>
  );
}
