import type { ClientBranding } from "./types";

/*
  Hotel branding palettes.

  Each palette maps to the CSS variables declared in src/styles.css.
  Color values are RGB triplets ("r g b") so Tailwind's alpha syntax works.
  Every palette keeps brand-800 readable on brand-50 and white on ink
  (WCAG AA for normal text).
*/

export type BrandPalette = {
  id: string;
  name: string;
  tagline: string;
  brand: {
    50: string;
    100: string;
    200: string;
    300: string;
    700: string;
    800: string;
    900: string;
    950: string;
  };
  ink: string;
  inkSoft: string;
  background: {
    base: string;
    from: string;
    via: string;
    to: string;
  };
};

export const BRAND_PALETTES: BrandPalette[] = [
  {
    id: "innpilotDefault",
    name: "InnPilot Default",
    tagline: "Calm teal with warm neutrals",
    brand: {
      50: "240 253 250",
      100: "204 251 241",
      200: "153 246 228",
      300: "94 234 212",
      700: "15 118 110",
      800: "17 94 89",
      900: "19 78 74",
      950: "4 47 46",
    },
    ink: "2 6 23",
    inkSoft: "30 41 59",
    background: {
      base: "#eef2f4",
      from: "#f8fafc",
      via: "#e5eeee",
      to: "#f4efe8",
    },
  },
  {
    id: "coastalHotel",
    name: "Coastal Hotel",
    tagline: "Marine blue, fresh and bright",
    brand: {
      50: "240 247 252",
      100: "217 236 247",
      200: "179 217 239",
      300: "124 189 228",
      700: "22 97 143",
      800: "19 79 117",
      900: "17 64 94",
      950: "7 39 60",
    },
    ink: "10 30 47",
    inkSoft: "26 56 80",
    background: {
      base: "#eef3f6",
      from: "#f7fafc",
      via: "#e4eef4",
      to: "#eef2ef",
    },
  },
  {
    id: "luxuryGold",
    name: "Luxury Gold",
    tagline: "Bronze and ivory, quietly grand",
    brand: {
      50: "251 247 238",
      100: "245 234 210",
      200: "237 220 176",
      300: "221 193 131",
      700: "138 100 32",
      800: "116 83 26",
      900: "94 67 21",
      950: "58 42 12",
    },
    ink: "38 28 17",
    inkSoft: "64 49 32",
    background: {
      base: "#f4efe6",
      from: "#fdfaf4",
      via: "#f4eee2",
      to: "#efe7d8",
    },
  },
  {
    id: "alpineSpa",
    name: "Alpine Spa",
    tagline: "Sage and pine, soft and restful",
    brand: {
      50: "243 248 244",
      100: "224 238 227",
      200: "194 221 200",
      300: "151 194 161",
      700: "46 107 64",
      800: "39 88 53",
      900: "33 72 45",
      950: "18 42 26",
    },
    ink: "14 31 21",
    inkSoft: "36 59 45",
    background: {
      base: "#eef3ee",
      from: "#f7faf7",
      via: "#e8f0e9",
      to: "#f1efe7",
    },
  },
  {
    id: "modernMinimal",
    name: "Modern Minimal",
    tagline: "Graphite monochrome, clean lines",
    brand: {
      50: "246 247 248",
      100: "233 235 238",
      200: "211 215 221",
      300: "174 181 192",
      700: "63 71 84",
      800: "52 59 70",
      900: "43 49 58",
      950: "21 24 30",
    },
    ink: "15 18 24",
    inkSoft: "42 48 58",
    background: {
      base: "#f1f2f4",
      from: "#fafbfc",
      via: "#edeff2",
      to: "#f2f2f0",
    },
  },
  {
    id: "mediterranean",
    name: "Mediterranean",
    tagline: "Terracotta warmth, sunlit stone",
    brand: {
      50: "253 244 240",
      100: "250 227 216",
      200: "243 200 179",
      300: "232 161 129",
      700: "173 74 34",
      800: "145 62 29",
      900: "118 51 25",
      950: "70 29 13",
    },
    ink: "47 26 17",
    inkSoft: "76 44 30",
    background: {
      base: "#f5f0ea",
      from: "#fcf8f3",
      via: "#f3ebe2",
      to: "#eef0ea",
    },
  },
];

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

export function resolvePalette(paletteId?: string): BrandPalette {
  return (
    BRAND_PALETTES.find((palette) => palette.id === paletteId) ?? BRAND_PALETTES[0]
  );
}

/** Applies hotel branding to the design tokens in src/styles.css. */
export function applyBrandingToDocument(branding?: ClientBranding | null) {
  const resolved = branding ?? DEFAULT_BRANDING;
  const palette = resolvePalette(resolved.palette);
  const root = document.documentElement.style;

  const brandScale = { ...palette.brand };
  const primaryOverride = hexToRgbTriplet(resolved.primaryColor);
  if (primaryOverride) {
    brandScale[700] = primaryOverride;
    brandScale[800] = mixTriplet(primaryOverride, "0 0 0", 0.18);
    brandScale[900] = mixTriplet(primaryOverride, "0 0 0", 0.32);
    brandScale[950] = mixTriplet(primaryOverride, "0 0 0", 0.6);
    brandScale[50] = mixTriplet(primaryOverride, "255 255 255", 0.94);
    brandScale[100] = mixTriplet(primaryOverride, "255 255 255", 0.85);
    brandScale[200] = mixTriplet(primaryOverride, "255 255 255", 0.7);
    brandScale[300] = mixTriplet(primaryOverride, "255 255 255", 0.5);
  }
  root.setProperty("--brand-50", brandScale[50]);
  root.setProperty("--brand-100", brandScale[100]);
  root.setProperty("--brand-200", brandScale[200]);
  root.setProperty("--brand-300", brandScale[300]);
  root.setProperty("--brand-700", brandScale[700]);
  root.setProperty("--brand-800", brandScale[800]);
  root.setProperty("--brand-900", brandScale[900]);
  root.setProperty("--brand-950", brandScale[950]);

  const accentOverride = hexToRgbTriplet(resolved.accentColor);
  root.setProperty("--ink", accentOverride ?? palette.ink);
  root.setProperty(
    "--ink-soft",
    accentOverride ? mixTriplet(accentOverride, "255 255 255", 0.18) : palette.inkSoft,
  );

  const background = palette.background;
  root.setProperty("--app-bg", background.base);
  if (resolved.backgroundStyle === "plain") {
    root.setProperty("--app-bg-from", background.base);
    root.setProperty("--app-bg-via", background.base);
    root.setProperty("--app-bg-to", background.base);
  } else if (resolved.backgroundStyle === "warm") {
    root.setProperty("--app-bg-from", background.from);
    root.setProperty("--app-bg-via", background.to);
    root.setProperty("--app-bg-to", background.via);
  } else {
    root.setProperty("--app-bg-from", background.from);
    root.setProperty("--app-bg-via", background.via);
    root.setProperty("--app-bg-to", background.to);
  }

  const opacityPercent = resolved.watermarkEnabled
    ? Math.min(Math.max(resolved.watermarkOpacity, 0), MAX_WATERMARK_OPACITY_PERCENT)
    : 0;
  root.setProperty("--watermark-opacity", String(opacityPercent / 100));
}

function hexToRgbTriplet(hex?: string): string | null {
  if (!hex) return null;
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/** Mixes an "r g b" triplet toward another by the given amount (0..1). */
function mixTriplet(triplet: string, toward: string, amount: number): string {
  const from = triplet.split(" ").map(Number);
  const to = toward.split(" ").map(Number);
  return from
    .map((channel, index) => Math.round(channel + (to[index] - channel) * amount))
    .join(" ");
}

export function tripletToCss(triplet: string): string {
  return `rgb(${triplet.split(" ").join(" ")})`;
}
