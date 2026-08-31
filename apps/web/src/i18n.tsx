import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppLanguage = "ru" | "en";
export type Translate = (russian: string, english: string) => string;

interface I18nContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  tr: Translate;
}

const storageKey = "fluxio-ui-language";
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    const saved = window.localStorage.getItem(storageKey);
    return saved === "en" || saved === "ru" ? saved : "en";
  });
  const setLanguage = useCallback((next: AppLanguage) => {
    window.localStorage.setItem(storageKey, next);
    setLanguageState(next);
  }, []);
  const tr = useCallback((russian: string, english: string) =>
    language === "ru" ? russian : english, [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "ru" ? "FluxIO · Эфирная консоль" : "FluxIO · Playout Console";
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, tr }), [language, setLanguage, tr]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
