import { createContext, useContext, type ReactNode } from "react";

import { en } from "./en";
import { it } from "./it";

export type Language = "en" | "it";
export type TranslationKey = keyof typeof en;

const dictionaries = { en, it } as const;

type I18nContextValue = {
  language: Language;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue>({
  language: "en",
  t: (key, params) => interpolate(en[key] ?? key, params),
});

export function I18nProvider({
  language,
  children,
}: {
  language?: string | null;
  children: ReactNode;
}) {
  const normalized = normalizeLanguage(language);
  const dictionary = dictionaries[normalized];
  return (
    <I18nContext.Provider
      value={{
        language: normalized,
        t: (key, params) => interpolate(dictionary[key] ?? en[key] ?? key, params),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function createTranslator(language?: string | null) {
  const normalized = normalizeLanguage(language);
  const dictionary = dictionaries[normalized];
  return (key: TranslationKey, params?: Record<string, string | number>) =>
    interpolate(dictionary[key] ?? en[key] ?? key, params);
}

export function normalizeLanguage(value?: string | null): Language {
  return value === "it" ? "it" : "en";
}

export function assertCompleteTranslations() {
  const englishKeys = Object.keys(en).sort();
  const italianKeys = Object.keys(it).sort();
  if (englishKeys.length !== italianKeys.length) {
    throw new Error("Translation dictionaries do not have the same number of keys.");
  }
  for (const key of englishKeys) {
    if (!italianKeys.includes(key)) {
      throw new Error(`Missing Italian translation key: ${key}`);
    }
  }
}

function interpolate(text: string, params?: Record<string, string | number>) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}
