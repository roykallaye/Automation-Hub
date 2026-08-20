import type { ClientBranding } from "./types";

/*
  Hotel branding.

  InnPilot has a single product palette. It previously shipped twelve
  selectable "brand palettes", but applyBrandingToDocument already resolved
  BRAND_PALETTES[0] regardless of the stored id and desaturated every derived
  tint to grey — so the picker persisted a choice that had no visual effect.
  Twelve themes that all render identically is a decision the manager should
  not be asked to make, so the choice is gone.

  Persistence is deliberately untouched. `ClientBranding` still carries
  palette, primaryColor, accentColor, backgroundStyle and watermark fields;
  BrandingPanel round-trips them unchanged, so existing configurations remain
  valid against the backend's KNOWN_PALETTES validation and nothing has to be
  migrated. Only the presentation changed.

  Semantic status colors (ready / attention / problem) live in
  design/system.css and are never palette-derived: they must stay recognizable.
*/

/** The InnPilot accent, matching --ip-accent in design/system.css. */
const PRODUCT_PALETTE = {
  50: "240 246 248",
  100: "223 236 240",
  200: "202 221 227",
  300: "138 178 192",
  700: "29 78 95",
  800: "24 64 78",
  900: "20 52 63",
  950: "11 29 35",
} as const;

const CANVAS = "#f5f4f1";

export const DEFAULT_PALETTE_ID = "innpilotDefault";

export const MAX_WATERMARK_OPACITY_PERCENT = 30;

export const DEFAULT_BRANDING: ClientBranding = {
  palette: DEFAULT_PALETTE_ID,
  logoPath: "",
  primaryColor: "",
  accentColor: "",
  backgroundStyle: "soft",
  watermarkEnabled: true,
  watermarkOpacity: 6,
};

/**
 * Applies branding to the Tailwind token layer in src/styles.css.
 *
 * Only the hotel's logo and watermark opacity are actually variable; the
 * accent is the product's own and does not change per hotel.
 */
export function applyBrandingToDocument(branding?: ClientBranding | null) {
  const resolved = branding ?? DEFAULT_BRANDING;
  const root = document.documentElement.style;

  root.setProperty("--brand-50", PRODUCT_PALETTE[50]);
  root.setProperty("--brand-100", PRODUCT_PALETTE[100]);
  root.setProperty("--brand-200", PRODUCT_PALETTE[200]);
  root.setProperty("--brand-300", PRODUCT_PALETTE[300]);
  root.setProperty("--brand-700", PRODUCT_PALETTE[700]);
  root.setProperty("--brand-800", PRODUCT_PALETTE[800]);
  root.setProperty("--brand-900", PRODUCT_PALETTE[900]);
  root.setProperty("--brand-950", PRODUCT_PALETTE[950]);

  root.setProperty("--ink", "28 27 23");
  root.setProperty("--ink-soft", "70 66 58");
  root.setProperty("--cta", PRODUCT_PALETTE[700]);
  root.setProperty("--cta-soft", PRODUCT_PALETTE[800]);

  root.setProperty("--app-bg", CANVAS);
  root.setProperty("--app-bg-from", CANVAS);
  root.setProperty("--app-bg-via", CANVAS);
  root.setProperty("--app-bg-to", CANVAS);

  const opacityPercent = resolved.watermarkEnabled
    ? Math.min(Math.max(resolved.watermarkOpacity, 0), MAX_WATERMARK_OPACITY_PERCENT)
    : 0;
  root.setProperty("--watermark-opacity", String(opacityPercent / 100));
}
