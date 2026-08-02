/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
      },
      // brand-* and ink map to CSS variables (see src/styles.css) so hotel
      // branding palettes can re-theme the app at runtime.
      colors: {
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
        },
        cta: {
          DEFAULT: "rgb(var(--cta) / <alpha-value>)",
          soft: "rgb(var(--cta-soft) / <alpha-value>)",
        },
        emerald: {
          50: "#f4f5f4", 100: "#e8ebe9", 200: "#d6dbd8", 300: "#b8c0bb",
          500: "#69746d", 600: "#566159", 700: "#465049", 800: "#353d38",
          900: "#252b27", 950: "#171a18",
        },
        sky: {
          50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8",
          500: "#71717a", 600: "#52525b", 700: "#3f3f46", 800: "#27272a",
          900: "#18181b", 950: "#09090b",
        },
        amber: {
          50: "#fbf7ef", 100: "#f4e8d2", 200: "#e8d1aa", 300: "#d6ad70",
          500: "#ad7228", 600: "#915a1d", 700: "#754617", 800: "#5f3916",
          900: "#4c2f16", 950: "#2b190a",
        },
        rose: {
          50: "#fbf2f2", 100: "#f4dddd", 200: "#e8bcbc", 300: "#d98f91",
          500: "#a83e45", 600: "#913039", 700: "#78262e", 800: "#611f27",
          900: "#501c23", 950: "#2d0d12",
        },
      },
      boxShadow: {
        glass: "0 12px 32px rgba(24, 24, 27, 0.08)",
        lift: "0 8px 22px rgba(24, 24, 27, 0.09)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "240ms",
      },
    },
  },
  plugins: [],
};
