/**
 * FW-01: Sprachumschalter für die Hülle. Sektionskörper bleiben Deutsch,
 * bis jede Oberfläche übersetzt ist. Datenzeilen „n/a — Grund“ bleiben Deutsch.
 */

export type Locale = "de" | "en";

export const LOCALE_STORAGE_KEY = "aa-locale";

export const SECTION_LABELS: Record<Locale, Record<number, string>> = {
  de: {
    1: "Executive Summary",
    2: "Datenaktualität",
    3: "Investmentthese",
    4: "Financial Statements",
    5: "Zyklusanalyse",
    6: "Bewertung",
    7: "DCF-Modell",
    8: "CRV",
    9: "Rel. Bewertung",
    10: "Risikoinversion",
    11: "RSL-Momentum",
    12: "Tech. Analyse",
    13: "Moat / Porter",
    14: "PESTEL",
    15: "Makro-Korr.",
    16: "Reverse DCF",
    17: "Katalysatoren",
    18: "Monte Carlo",
    19: "Management-Score",
    20: "Zusammenfassung",
  },
  en: {
    1: "Executive summary",
    2: "Data freshness",
    3: "Investment thesis",
    4: "Financial statements",
    5: "Cycle analysis",
    6: "Valuation",
    7: "DCF model",
    8: "CRV",
    9: "Relative valuation",
    10: "Risk inversion",
    11: "RSL momentum",
    12: "Technical analysis",
    13: "Moat / Porter",
    14: "PESTEL",
    15: "Macro correlation",
    16: "Reverse DCF",
    17: "Catalysts",
    18: "Monte Carlo",
    19: "Management score",
    20: "Summary",
  },
};

const COPY = {
  de: {
    "nav.balance": "Bilanzen",
    "nav.locale": "Sprache",
    "balance.title": "Bilanzen-Screener",
    "balance.lead": "CSV hochladen. Red Flags aus der eigenen Historie. Kein Score.",
    "balance.file": "Datei",
    "balance.paste": "CSV",
    "balance.run": "Prüfen",
    "balance.rows": "Zeilen",
    "balance.empty": "Noch keine Prüfung.",
    "balance.back": "Zur Analyse",
  },
  en: {
    "nav.balance": "Statements",
    "nav.locale": "Language",
    "balance.title": "Balance-sheet screener",
    "balance.lead": "Upload a CSV. Red flags from the sheet’s own history. No score.",
    "balance.file": "File",
    "balance.paste": "CSV",
    "balance.run": "Check",
    "balance.rows": "Rows",
    "balance.empty": "No check yet.",
    "balance.back": "Back to analysis",
  },
} as const;

export type CopyKey = keyof (typeof COPY)["de"];

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "de" || value === "en";
}

export function sectionLabel(locale: Locale, id: number): string {
  return SECTION_LABELS[locale][id] ?? SECTION_LABELS.de[id] ?? String(id);
}

export function copy(locale: Locale, key: CopyKey): string {
  return COPY[locale][key];
}
