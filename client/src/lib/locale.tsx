import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { copy, isLocale, sectionLabel, LOCALE_STORAGE_KEY, type CopyKey, type Locale } from "@shared/ui-locale";

interface LocaleValue {
  locale: Locale;
  toggleLocale: () => void;
  t: (key: CopyKey) => string;
  section: (id: number) => string;
}

const LocaleContext = createContext<LocaleValue>({
  locale: "de",
  toggleLocale: () => {},
  t: key => copy("de", key),
  section: id => sectionLabel("de", id),
});

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "de";
  } catch {
    return "de";
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(readStoredLocale);

  const value = useMemo<LocaleValue>(() => ({
    locale,
    toggleLocale: () => {
      setLocale(prev => {
        const next: Locale = prev === "de" ? "en" : "de";
        try {
          localStorage.setItem(LOCALE_STORAGE_KEY, next);
        } catch {
          /* Anzeige bleibt, der Speicher nicht. */
        }
        return next;
      });
    },
    t: key => copy(locale, key),
    section: id => sectionLabel(locale, id),
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function LocaleSwitch() {
  const { locale, toggleLocale, t } = useLocale();
  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="h-8 px-2 text-[11px] font-medium rounded-md border border-border/60 hover:bg-muted/50"
      data-testid="button-locale"
      aria-label={t("nav.locale")}
    >
      {locale === "de" ? "EN" : "DE"}
    </button>
  );
}
