import { createContext, useContext, type ReactNode } from "react";

import { en } from "./en";
import { it } from "./it";
import { productEn } from "./product.en";
import { productIt } from "./product.it";

/*
  Dictionary registry.

  A dictionary is composed from modules so a screen's copy has one obvious
  home. `product.*` carries the refreshed product surface and is spread last,
  so it intentionally supersedes any same-named legacy key.

  Adding a language:
    1. add `product.<lang>.ts` and `<lang>.ts`;
    2. compose it below and add it to `dictionaries`;
    3. widen `Language` and the backend's accepted language values together —
       `save_app_language` validates what it persists, so the frontend must not
       offer a language the backend will reject.

  German and French are planned. They are deliberately not registered yet:
  shipping machine-translated hotel copy would be worse than shipping English,
  and the backend language enum has to move at the same time. See the Phase G
  notes for the backend change that unblocks them.
*/

const english = { ...en, ...productEn };
const italian = { ...it, ...productIt };

const dictionaries = {
  en: english,
  it: italian,
} as const;

export type Language = keyof typeof dictionaries;
export type TranslationKey = keyof typeof english;
export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

type I18nContextValue = {
  language: Language;
  t: Translate;
};

const I18nContext = createContext<I18nContextValue>({
  language: "en",
  t: (key, params) => interpolate(english[key] ?? key, params),
});

export function I18nProvider({
  language,
  children,
}: {
  language?: string | null;
  children: ReactNode;
}) {
  const normalized = normalizeLanguage(language);
  return (
    <I18nContext.Provider value={{ language: normalized, t: createTranslator(normalized) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function createTranslator(language?: string | null): Translate {
  const dictionary = dictionaries[normalizeLanguage(language)] as Record<string, string>;
  return (key, params) => interpolate(dictionary[key] ?? english[key] ?? key, params);
}

export function normalizeLanguage(value?: string | null): Language {
  return value === "it" ? "it" : "en";
}

/** Guards against a language drifting out of sync with English. */
export function assertCompleteTranslations() {
  const englishKeys = Object.keys(english).sort();
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    if (code === "en") continue;
    const keys = Object.keys(dictionary);
    const missing = englishKeys.filter((key) => !keys.includes(key));
    if (missing.length > 0) {
      throw new Error(`Missing ${code} translation keys: ${missing.join(", ")}`);
    }
    const extra = keys.filter((key) => !englishKeys.includes(key));
    if (extra.length > 0) {
      throw new Error(`Unknown ${code} translation keys: ${extra.join(", ")}`);
    }
  }
}

function interpolate(text: string, params?: Record<string, string | number>) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}
