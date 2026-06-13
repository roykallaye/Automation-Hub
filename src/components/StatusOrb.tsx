import type { CSSProperties } from "react";

/*
  StatusOrb / StatusHint: the app-wide status language.

  ready      → calm emerald      "all good"
  attention  → warm amber        "one thing to finish"
  blocked    → quiet rose        "cannot run yet"
  neutral    → soft slate        "nothing to report"
  future     → brand tint        "coming later"

  Color never stands alone: StatusHint always pairs the orb with words.
*/

export type StatusTone = "ready" | "attention" | "blocked" | "neutral" | "future";

const ORB_CLASS: Record<StatusTone, string> = {
  ready: "bg-emerald-500",
  attention: "bg-amber-500",
  blocked: "bg-rose-500",
  neutral: "bg-slate-400",
  future: "bg-brand-300",
};

const ORB_GLOW: Record<StatusTone, string> = {
  ready: "16 185 129",
  attention: "245 158 11",
  blocked: "244 63 94",
  neutral: "148 163 184",
  future: "var(--brand-300)",
};

const HINT_TEXT_CLASS: Record<StatusTone, string> = {
  ready: "text-emerald-800",
  attention: "text-amber-800",
  blocked: "text-rose-800",
  neutral: "text-slate-600",
  future: "text-brand-800",
};

export function StatusOrb({ tone, pulse = false }: { tone: StatusTone; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "status-orb",
        ORB_CLASS[tone],
        pulse ? "status-orb--pulse" : "",
      ].join(" ")}
      style={{ "--orb-glow": ORB_GLOW[tone] } as CSSProperties}
    />
  );
}

export function StatusHint({
  tone,
  label,
  pulse = false,
}: {
  tone: StatusTone;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span className={["inline-flex items-center gap-2 text-xs font-bold", HINT_TEXT_CLASS[tone]].join(" ")}>
      <StatusOrb tone={tone} pulse={pulse} />
      {label}
    </span>
  );
}
