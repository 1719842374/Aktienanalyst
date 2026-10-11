// === Numeric Safety Guard ===
// Fix 6: all formatters guard against NaN, Infinity, null, undefined
// so price=0 or division-by-zero never shows "Infinity%" in the UI
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
 * JOB 23: Währung für Statement-Aggregate (Umsatz, FCF, DCF-Summen). Hat der Server die Finanzdaten nach USD
 * umgerechnet (currencyInfo.converted), sind sie USD — sonst Listing-Währung (nach #244 auch .L in GBP).
 */
export function statementCurrency(data: { currency?: string | null; currencyInfo?: { converted?: boolean } | null }): string | null | undefined {
  return data.currencyInfo?.converted ? "USD" : data.currency;
}

/** JOB 23: Kursziel — 0/null/nicht endlich heißt „kein Ziel“ (FMP ohne .L-Targets) → "n/a" statt "£0.00". */
export function formatTarget(value: number | null | undefined, currency?: string | null): string {
  if (value == null || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "n/a";
  return formatCurrency(value, 2, currency);
}

export function formatCurrency(value: number, decimals: number = 2, currency?: string | null): string {
  const v = safeNum(value);
  return `${currencySymbol(currency)}${v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatLargeNumber(value: number, currency?: string | null): string {
  const v = safeNum(value);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const s = currencySymbol(currency);
  if (abs >= 1e12) return `${sign}${s}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${s}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${s}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${s}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${s}${abs.toFixed(2)}`;
}

export function formatPercent(value: number, decimals: number = 2): string {
  const v = safeNum(value);
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

export function formatPercentNoSign(value: number, decimals: number = 2): string {
  return `${safeNum(value).toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals: number = 2): string {
  return safeNum(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatShares(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatRatio(value: number): string {
  return `${value.toFixed(1)}:1`;
}

// Color helpers
export function getChangeColor(value: number): string {
  if (value > 0) return "text-emerald-500";
  if (value < 0) return "text-red-500";
  return "text-muted-foreground";
}

export function getCRVColor(value: number): string {
  if (value >= 2.5) return "text-emerald-500";
  if (value >= 2.0) return "text-amber-500";
  return "text-red-500";
}

export function getCRVBgColor(value: number): string {
  if (value >= 2.5) return "bg-emerald-500/10 border-emerald-500/20";
  if (value >= 2.0) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export function getRSLColor(value: number): string {
  if (value > 110) return "text-emerald-500";
  if (value > 105) return "text-amber-500";
  return "text-red-500";
}

export function getRSLBgColor(value: number): string {
  if (value > 110) return "bg-emerald-500";
  if (value > 105) return "bg-amber-500";
  return "bg-red-500";
}
