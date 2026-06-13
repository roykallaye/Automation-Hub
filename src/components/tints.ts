/*
  Cheerful card tints.

  Status colors stay strictly semantic (see StatusOrb); these tints are purely
  decorative hues that give each destination and workflow its own friendly
  identity. Soft pastels only — premium and warm, never neon.
*/
export type CardTint = "brand" | "sky" | "violet" | "amber" | "emerald" | "rose";

/** Icon tile: colored background + icon color + soft ring. */
export const TINT_TILE: Record<CardTint, string> = {
  brand: "bg-brand-50 text-brand-800 ring-brand-100",
  sky: "bg-sky-100 text-sky-700 ring-sky-200",
  violet: "bg-violet-100 text-violet-700 ring-violet-200",
  amber: "bg-amber-100 text-amber-700 ring-amber-200",
  emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  rose: "bg-rose-100 text-rose-700 ring-rose-200",
};

/** Gentle gradient wash for the card surface. */
export const TINT_WASH: Record<CardTint, string> = {
  brand: "bg-gradient-to-br from-brand-50/90 via-white/60 to-white/55",
  sky: "bg-gradient-to-br from-sky-50/90 via-white/60 to-white/55",
  violet: "bg-gradient-to-br from-violet-50/90 via-white/60 to-white/55",
  amber: "bg-gradient-to-br from-amber-50/90 via-white/60 to-white/55",
  emerald: "bg-gradient-to-br from-emerald-50/90 via-white/60 to-white/55",
  rose: "bg-gradient-to-br from-rose-50/90 via-white/60 to-white/55",
};
