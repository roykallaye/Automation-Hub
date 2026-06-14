/*
  Card tints — all derived from the active palette.

  The actual colors live in CSS variables (--tint-<slot>-bg/fg/ring/wash) that
  applyBrandingToDocument() generates by hue-rotating the brand color, so every
  tint belongs to the chosen palette. These maps just point at the utility
  classes defined in src/styles.css. Status colors stay separate and semantic
  (see StatusOrb); they are the one set of fixed hues allowed to ignore the
  palette because they must always read as ready / attention / blocked.

  Slot names are stable identifiers, not literal hues.
*/
export type CardTint = "brand" | "sky" | "violet" | "amber" | "emerald" | "rose";

/** Icon tile: palette-derived background + icon color + ring (pair with ring-1). */
export const TINT_TILE: Record<CardTint, string> = {
  brand: "tint-brand-tile",
  sky: "tint-sky-tile",
  violet: "tint-violet-tile",
  amber: "tint-amber-tile",
  emerald: "tint-emerald-tile",
  rose: "tint-rose-tile",
};

/** Gentle palette-derived gradient wash for a card surface. */
export const TINT_WASH: Record<CardTint, string> = {
  brand: "tint-brand-wash",
  sky: "tint-sky-wash",
  violet: "tint-violet-wash",
  amber: "tint-amber-wash",
  emerald: "tint-emerald-wash",
  rose: "tint-rose-wash",
};
