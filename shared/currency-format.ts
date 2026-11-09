/**
 * Währungsformat (Symbol, Statement-Währung, Betrag) — UNVERÄNDERT aus client/src/lib/formatters.ts
 * nach shared/ verschoben, damit Server (PDF-Export) und Client dieselbe Funktion nutzen.
 * client/src/lib/formatters.ts re-exportiert alles; Importpfade und Verhalten bleiben gleich.
 */
import { isMinorUnitListingTicker } from "./listing-units";

function safeNum(v: number, fallback = 0): number {
  if (v === null || v === undefined || !isFinite(v) || isNaN(v)) return fallback;
  return v;
}

// === Currency Formatters ===
/**
 * JOB 22: Symbol aus der Listing-Währung der Analyse (data.currency). Ohne/unbekannte Währung bleibt es "$"
 * (bisheriges Verhalten), unbekannte Codes erscheinen als "CHF " usw. statt eines falschen "$".
 */
// Minor Units (GBp = Pence, nur bei fehlender FX, siehe listingFxWarning) bleiben als Code sichtbar, nicht als "£".
// JOB 23: Codes ohne Symbol mit geschütztem Leerzeichen (U+00A0): recharts <Text> trennt an normalen Leerzeichen
// in Wörter und setzt sie ohne Abstand zusammen → Achse zeigte „CAD171“ statt „CAD 171“.
const CODE_SEP = "\u00A0";
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", JPY: "¥", GBp: `GBp${CODE_SEP}`, GBX: `GBX${CODE_SEP}`, ZAc: `ZAc${CODE_SEP}`, ILA: `ILA${CODE_SEP}` };
export function currencySymbol(currency?: string | null): string {
  if (!currency) return "$";
  const c = currency.trim();
  return CURRENCY_SYMBOLS[c] ?? `${c}${CODE_SEP}`;
}

/**
 * JOB 23: Währung für Statement-Werte (Umsatz, FCF, EPS, Bilanz, DCF). Der Server rechnet Finanzdaten mit
 * reportedCurrency ≠ USD immer nach USD um (fmp.ts convertFmpRowsToUsd; currencyInfo wird dabei nicht gesetzt).
 * Nur Minor-Unit-Listings (.L/.JO/.TA) werden danach per #244 in die Major-Listing-Währung (GBP …) gebracht.
 * Also: USD, außer bei Minor-Unit-Listings → Listing-Währung. (SAP.DE: Kurs €, Statements $.)
 * Steht die Listing-Währung noch auf der Minor Unit (GBp/GBX/ZAc/ILA = keine FX, #244 nicht angewandt), sind die
 * Statements unverändert USD.
 * Gilt für ALLE DCF- und daraus abgeleiteten Per-Share-Werte, damit dieselbe Zahl nie einmal mit $ und einmal mit € erscheint.
 */
const UNCONVERTED_MINOR_UNITS = new Set(["GBp", "GBX", "ZAc", "ILA"]);
export function statementCurrency(data: { ticker?: string | null; currency?: string | null }): string {
  const c = data.currency?.trim();
  return isMinorUnitListingTicker(data.ticker) && c && !UNCONVERTED_MINOR_UNITS.has(c) ? c : "USD";
}

export function formatCurrency(value: number, decimals: number = 2, currency?: string | null): string {
  const v = safeNum(value);
  return `${currencySymbol(currency)}${v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
