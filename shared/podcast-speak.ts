/**
 * Rundung und Sprechform für den Aktien-Podcast.
 * Das Modell schreibt diese Wörter nicht. Nur der Code setzt sie ein.
 */

const ONES = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"] as const;
const TEENS = ["zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"] as const;
const TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"] as const;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;
const ORDINALS = [
  "", "erster", "zweiter", "dritter", "vierter", "fünfter", "sechster", "siebter", "achter", "neunter",
  "zehnter", "elfter", "zwölfter", "dreizehnter", "vierzehnter", "fünfzehnter", "sechzehnter", "siebzehnter", "achtzehnter", "neunzehnter",
  "zwanzigster", "einundzwanzigster", "zweiundzwanzigster", "dreiundzwanzigster", "vierundzwanzigster", "fünfundzwanzigster",
  "sechsundzwanzigster", "siebenundzwanzigster", "achtundzwanzigster", "neunundzwanzigster", "dreißigster", "einunddreißigster",
] as const;

export function roundSig(n: number, sig: number): number {
  if (!Number.isFinite(n) || n === 0 || sig < 1) return 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const exp = Math.floor(Math.log10(abs));
  const pow = 10 ** (exp - sig + 1);
  let scaled = Math.round(abs / pow);
  let outPow = pow;
  if (scaled >= 10 ** sig) {
    scaled = Math.round(abs / (pow * 10));
    outPow = pow * 10;
  }
  const out = scaled * outPow;
  const clean = Number((neg ? -out : out).toPrecision(sig));
  return Object.is(clean, -0) ? 0 : clean;
}

function partsFromPrecision(n: number, sig: number): { int: number; frac: string } {
  const rounded = roundSig(Math.abs(n), sig);
  const s = rounded.toPrecision(sig);
  if (s.includes("e") || s.includes("E")) {
    const [mantissa, expRaw] = s.toLowerCase().split("e");
    const exp = Number(expRaw);
    const [mi, mf = ""] = mantissa.split(".");
    const digits = `${mi}${mf}`.replace("-", "");
    if (exp >= 0) {
      const intDigits = exp + 1;
      const intPart = digits.slice(0, intDigits).padEnd(intDigits, "0");
      return { int: Number(intPart), frac: digits.slice(intDigits).replace(/0+$/, "") };
    }
    return { int: 0, frac: `${"0".repeat(-exp - 1)}${digits}`.replace(/0+$/, "") };
  }
  const [i, f = ""] = s.split(".");
  return { int: Number(i), frac: f.replace(/0+$/, "") };
}

export function speakInt(n: number): string {
  if (!Number.isFinite(n)) return "";
  const v = Math.trunc(Math.abs(n));
  const neg = n < 0 ? "minus " : "";
  return neg + speakUnsigned(v);
}

function speakUnsigned(v: number): string {
  if (v < 10) return ONES[v] ?? "null";
  if (v < 20) return TEENS[v - 10] ?? "";
  if (v < 100) {
    const ten = Math.floor(v / 10);
    const one = v % 10;
    if (one === 0) return TENS[ten] ?? "";
    const head = one === 1 ? "ein" : ONES[one];
    return `${head}und${TENS[ten]}`;
  }
  if (v < 1000) {
    const h = Math.floor(v / 100);
    const rest = v % 100;
    const hWord = h === 1 ? "einhundert" : `${ONES[h]}hundert`;
    return rest === 0 ? hWord : `${hWord}${speakUnsigned(rest)}`;
  }
  if (v < 1_000_000) {
    const th = Math.floor(v / 1000);
    const rest = v % 1000;
    const thWord = th === 1 ? "eintausend" : `${speakUnsigned(th)}tausend`;
    return rest === 0 ? thWord : `${thWord}${speakUnsigned(rest)}`;
  }
  return String(v);
}

export function speakRounded(n: number, sig: number): string | null {
  if (!Number.isFinite(n)) return null;
  const neg = n < 0 ? "minus " : "";
  const { int, frac } = partsFromPrecision(n, sig);
  const head = speakUnsigned(int);
  if (!frac) return `${neg}${head}`;
  const tail = frac.split("").map(d => ONES[Number(d)] ?? d).join(" ");
  return `${neg}${head} Komma ${tail}`;
}

export function speakPercent(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  const neg = rounded < 0 ? "minus " : "";
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs);
  const frac = Math.round((abs - whole) * 10);
  const head = speakUnsigned(whole);
  const body = frac === 0 ? head : `${head} Komma ${ONES[frac]}`;
  return `${neg}${body} Prozent`;
}

export function speakAmountUsd(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const neg = n < 0 ? "minus " : "";
  let core = n;
  let unit = "Dollar";
  if (abs >= 1e12) {
    core = n / 1e12;
    unit = "Billionen Dollar";
  } else if (abs >= 1e9) {
    core = n / 1e9;
    unit = "Milliarden Dollar";
  } else if (abs >= 1e6) {
    core = n / 1e6;
    unit = "Millionen Dollar";
  }
  const spoken = speakRounded(Math.abs(core), 3);
  if (!spoken) return null;
  return `${neg}${spoken} ${unit}`;
}

export function speakPriceUsd(n: number, sig = 3): string | null {
  const spoken = speakRounded(n, sig);
  if (!spoken) return null;
  return `${spoken} Dollar`;
}

function ordinalInCase(ordinal: string, gramCase: "nom" | "dat"): string {
  if (gramCase === "nom") return ordinal;
  return ordinal.replace(/er$/, "en");
}

export function speakIsoDate(iso: string, gramCase: "nom" | "dat" = "nom"): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ordinal = ORDINALS[day];
  const monthName = MONTHS[month - 1];
  if (!ordinal || !monthName) return null;
  const yearWord = year >= 2000 && year < 2100
    ? (year === 2000 ? "zweitausend" : `zweitausend${speakUnsigned(year - 2000)}`)
    : speakUnsigned(year);
  return `${ordinalInCase(ordinal, gramCase)} ${monthName} ${yearWord}`;
}

export function speakYear(year: number): string {
  if (year >= 2000 && year < 2100) return year === 2000 ? "zweitausend" : `zweitausend${speakUnsigned(year - 2000)}`;
  return speakUnsigned(year);
}

/** Fiskalquartal in Worten. Ein ISO-Datum ist das Meldedatum, nicht das Quartalsende. */
export function speakQuarterPhrase(raw: string): string | null {
  const fiscal = /Q\s*([1-4])\b(?:\s*(?:FY|GJ)\s*((?:19|20)\d{2}))?/i.exec(raw);
  if (fiscal?.[2]) return `Quartal ${speakUnsigned(Number(fiscal[1]))} im Geschäftsjahr ${speakYear(Number(fiscal[2]))}`;
  if (fiscal) return `Quartal ${speakUnsigned(Number(fiscal[1]))}`;
  return null;
}

/** Fertige Altersphrase. Der Satz heißt „stammt von heute“, nicht „ist weniger als einem Tag alt“. */
export function speakNewsAge(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "von heute";
  if (Math.trunc(days) === 1) return "von gestern";
  return `vor ${speakUnsigned(Math.trunc(days))} Tagen`;
}

/** Trennt einen eingesetzten Eigennamen vom Normalisierer. */
export const NAME_GUARD = "\u0001";

export function guardSpan(value: string): string {
  if (!value || value.includes(NAME_GUARD)) return value;
  return `${NAME_GUARD}${value}${NAME_GUARD}`;
}

export function unguard(text: string): string {
  return text.split(NAME_GUARD).join("");
}

/** true, wenn der Endtext außerhalb erlaubter Produkt-Tokens noch Ziffern, <, > oder % enthält. camelCase gilt nur für den Modell-Rohtext. */
export function spokenStillRaw(text: string): boolean {
  const rest = exemptSpokenTokens(unguard(text));
  return /\d/.test(rest) || /[<>%]/.test(rest);
}

function exemptSpokenTokens(text: string): string {
  return text
    .replace(/S&P 500/g, " ")
    .replace(/\bMicrosoft 365\b/g, " ")
    .replace(/\b(?:GJ|FY)\d{4}\b/g, " ")
    .replace(/\bS\d{1,2}\b/g, " ")
    .replace(/\b\d+-nm\b/g, " ")
    .replace(/\b[A-Za-z]{1,6}\d{2,4}\b/g, " ")
    .replace(/\b\d{1,4}[A-Za-z]{1,4}\b/g, " ");
}

function speakCount(raw: string): string | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || Math.abs(n) >= 1_000_000) return null;
  const spoken = Number.isInteger(n) ? speakInt(n) : speakRounded(n, 3);
  if (!spoken || /\d/.test(spoken)) return null;
  return spoken;
}

const QTY_AFTER = String.raw`(?=\s+(?:Seats|Sitze|Sitz|Dollar|Euro|Prozent|Stück|Stueck|Einheiten|Nutzer|User|Aktien|Shares|Barrel|Tonnen)\b)`;

function speakUnit(num: string, unit: string): string | null {
  const spoken = speakCount(num);
  if (!spoken) return null;
  const key = unit.toLowerCase();
  const word = key === "mrd" ? "Milliarden" : key === "k" ? "Tausend" : "Millionen";
  return `${spoken} ${word}`;
}

function maskLiterals(text: string): { text: string; kept: string[] } {
  const kept: string[] = [];
  const patterns = [
    /S&P 500/g,
    /\bMicrosoft 365\b/g,
    /\b(?:GJ|FY)\d{4}\b/g,
    /\b\d+-nm\b/g,
    /\b[A-Za-z]{1,6}\d{2,4}\b/g,
    /\bS\d{1,2}\b/g,
  ];
  let out = text;
  for (const pattern of patterns) {
    out = out.replace(pattern, (match) => {
      kept.push(match);
      return `\u0002${"x".repeat(kept.length)}\u0002`;
    });
  }
  return { text: out, kept };
}

function restoreLiterals(text: string, kept: string[]): string {
  let out = text;
  for (let i = kept.length; i >= 1; i--) {
    out = out.replace(`\u0002${"x".repeat(i)}\u0002`, kept[i - 1] ?? "");
  }
  return out;
}

/** Zahlen außerhalb geschützter Spans. Ein Eigenname zwischen den Wächtern bleibt stehen. */
function normalizeFragment(text: string): string | null {
  if (!text.trim()) return text;
  const masked = maskLiterals(text.normalize("NFKC"));
  let out = masked.text;
  const swap = (pattern: RegExp, to: (num: string, extra?: string) => string | null) => {
    out = out.replace(pattern, (full: string, num: string, extra?: string) => to(num, extra) ?? full);
  };
  swap(/<\s*(\d+(?:[.,]\d+)?)\s*%/g, num => {
    const spoken = speakPercent(Number(num.replace(",", ".")));
    return spoken ? `unter ${spoken}` : null;
  });
  swap(/>\s*(\d+(?:[.,]\d+)?)\s*%/g, num => {
    const spoken = speakPercent(Number(num.replace(",", ".")));
    return spoken ? `über ${spoken}` : null;
  });
  swap(/(\d+(?:[.,]\d+)?)\s*%/g, num => speakPercent(Number(num.replace(",", "."))));
  swap(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s+(Mrd|Mio|M|K)\b`, "gi"), (num, unit) => unit ? speakUnit(num, unit) : null);
  swap(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(Mrd|Mio|M|K)\b${QTY_AFTER}`, "gi"), (num, unit) => unit ? speakUnit(num, unit) : null);
  out = out.replace(/\b((?:19|20)\d{2})\b/g, (_full, year: string) => speakYear(Number(year)));
  out = out.replace(/\b([A-Za-zÄÖÜäöüß]{2,})-(\d{1,2})\b/g, (full, prefix: string, num: string) => {
    const word = speakUnsigned(Number(num));
    if (!word || /\d/.test(word)) return full;
    if (prefix === prefix.toUpperCase() && /[A-ZÄÖÜ]/.test(prefix)) return `${prefix}-${word}`;
    return `${prefix} ${word}`;
  });
  out = out.replace(/\bQ([1-4])\b/g, (_full, quarter: string) => `Quartal ${speakUnsigned(Number(quarter))}`);
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\b/g, (full, num: string) => speakCount(num) ?? full);
  out = restoreLiterals(out, masked.kept).replace(/\s+/g, " ");
  if (spokenStillRaw(out)) return null;
  return out;
}

/**
 * Letzter Schritt für jeden gesprochenen Satz, Code und Modell.
 * Zahlen, Jahre, Prozent, <, >, K, M und Mrd sowie Bindestrich-Zahlen werden Worte.
 * Geschützte Eigennamen und Produkt-Tokens bleiben stehen.
 */
export function speakNormalize(text: string): string | null {
  const parts = text.split(NAME_GUARD);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (i % 2 === 1) {
      out += part;
      continue;
    }
    const normalized = normalizeFragment(part);
    if (normalized == null) return null;
    out += normalized;
  }
  const joined = out.replace(/\s+/g, " ").trim();
  if (!joined) return null;
  return joined;
}

export function priceLabelDe(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

export interface RankedFigures {
  price: number | null;
  entry: number | null;
  fair: number | null;
  low: number | null;
  high: number | null;
}

/** true, wenn die Reihenfolge nach dem Runden dieselbe bleibt. Bei Gleichstand einmal vier Stellen, sonst false. */
export function rankAfterRounding(values: RankedFigures): { ok: boolean; sig: 3 | 4 } {
  const pairs = (sig: number) => {
    const keys = ["price", "entry", "fair", "low", "high"] as const;
    const raw = keys.map(k => values[k]).filter((n): n is number => n != null && Number.isFinite(n));
    const rounded = raw.map(n => roundSig(n, sig));
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const before = Math.sign(raw[i]! - raw[j]!);
        const after = Math.sign(rounded[i]! - rounded[j]!);
        if (before !== 0 && before !== after) return false;
      }
    }
    return true;
  };
  if (pairs(3)) return { ok: true, sig: 3 };
  if (pairs(4)) return { ok: true, sig: 4 };
  return { ok: false, sig: 4 };
}

/** Behält nur Sätze, die mit Punkt, Ausrufe- oder Fragezeichen enden. Ein abgeschnittenes Wort fällt weg. */
export function keepCompleteSentences(text: string): string {
  const parts = text.match(/[^.!?]*[.!?]+/g);
  if (!parts) return "";
  return parts.map(s => s.trim()).filter(Boolean).join(" ");
}
