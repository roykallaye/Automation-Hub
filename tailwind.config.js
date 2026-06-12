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
      },
      boxShadow: {
        glass: "0 18px 50px rgba(15, 23, 42, 0.12)",
        lift: "0 8px 24px rgba(15, 23, 42, 0.10)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "240ms",
      },
    },
  },
  plugins: [],
};
