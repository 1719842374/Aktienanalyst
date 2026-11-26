/**
 * Platzhalter, Validator und Kapitel des Aktien-Podcasts.
 * Ein Modelltext wird vor dem Einsetzen geprüft. Ziffern und Zahlwörter
 * mit Einheit fallen weg. Werte kommen nur aus den Fakten.
 */
import type { PodcastDropCounts, StockPodcastChapter, StockPodcastSource } from "./podcast-types";
import { emptyDropCounts, PODCAST_DISCLAIMER } from "./podcast-types";
import { PLACEHOLDER_KIND, PODCAST_PLACEHOLDERS, placeholderForbiddenInModel, type PodcastFacts, type PodcastFactValues, type PodcastPlaceholder } from "./podcast-facts";
import { guardSpan, keepCompleteSentences, NAME_GUARD, speakNormalize, spokenStillRaw, stripAllowedNumberTokens, unguard } from "./podcast-speak";

const PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/g;
const ALLOWED = new Set<string>(PODCAST_PLACEHOLDERS);

const BARE_PLACEHOLDER = new RegExp(`\\b(?:${PODCAST_PLACEHOLDERS.join("|")})\\b`, "i");
const SNAKE_PLACEHOLDER = new RegExp(`\\b(?:${PODCAST_PLACEHOLDERS.filter(name => name.includes("_")).join("|")})\\b`, "i");
const NUMBER_WORD = /^(?:null|eins|ein|eine|einen|einem|einer|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig|hundert|tausend|(?:ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)?und(?:zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig))$/i;
const UNIT = /^(?:prozent|milliarden|millionen|dollar|euro|us-dollar|prozentpunkte|punkte|mal|quartale)$/i;
const BANNED = /\b(hälfte|haelfte|drittel|viertel|verdoppelt|verdreifacht|halbiert)\b|\b[A-Za-zÄÖÜäöüß]*fach\b/i;

export interface ChapterDef {
  id: string;
  title: string;
  llmOwned: boolean;
}

export const PDF_PODCAST_CHAPTERS: ChapterDef[] = [
  { id: "einstieg", title: "Einstieg", llmOwned: false },
  { id: "zusammenfassung", title: "Executive Summary", llmOwned: false },
  { id: "these", title: "These", llmOwned: false },
  { id: "umsatz", title: "Umsatz", llmOwned: false },
  { id: "s13", title: "Moat und Porter", llmOwned: false },
  { id: "s14", title: "PESTEL", llmOwned: false },
  { id: "dcf", title: "Bewertung", llmOwned: false },
  { id: "s17", title: "Katalysatoren", llmOwned: false },
  { id: "inversion", title: "Inversion", llmOwned: false },
  { id: "earnings", title: "Earnings Call", llmOwned: false },
  { id: "news", title: "Nachrichten", llmOwned: false },
  { id: "schluss", title: "Schluss", llmOwned: false },
];

export const KI_PODCAST_CHAPTERS: ChapterDef[] = [
  { id: "s17", title: "Katalysatoren", llmOwned: false },
  { id: "s13", title: "Moat und Porter", llmOwned: false },
  { id: "s14", title: "PESTEL", llmOwned: false },
  { id: "umsatz", title: "Umsatz", llmOwned: false },
  { id: "inversion", title: "Inversion", llmOwned: false },
  { id: "earnings", title: "Earnings Call", llmOwned: false },
  { id: "news-llm", title: "News-Anknüpfung (LLM-eigen)", llmOwned: true },
  { id: "schluss", title: "Schluss", llmOwned: false },
];

export function chaptersForSource(source: StockPodcastSource): ChapterDef[] {
  switch (source) {
    case "pdf": return PDF_PODCAST_CHAPTERS;
    case "ki": return KI_PODCAST_CHAPTERS;
    default: {
      const _never: never = source;
      return _never;
    }
  }
}

export function scriptContainsForbiddenGrowth(text: string): boolean {
  return /\bYTD\b/i.test(text) || /seit Jahresbeginn/i.test(text);
}

function isNumberToken(token: string): boolean {
  return NUMBER_WORD.test(token);
}

function hasNumberUnit(text: string): boolean {
  const tokens = text.split(/\s+/).map(t => t.replace(/^[„"'(]+|[”"').,:;!?]+$/g, "")).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumberToken(tokens[i] ?? "")) continue;
    let j = i;
    while (j < tokens.length) {
      const tok = tokens[j] ?? "";
      if (isNumberToken(tok)) { j++; continue; }
      if (/^komma$/i.test(tok) && isNumberToken(tokens[j + 1] ?? "")) { j++; continue; }
      break;
    }
    if (j === i) continue;
    let k = j;
    let fillers = 0;
    while (k < tokens.length && fillers < 2 && !UNIT.test(tokens[k] ?? "") && !isNumberToken(tokens[k] ?? "")) {
      fillers++;
      k++;
    }
    if (UNIT.test(tokens[k] ?? "")) return true;
  }
  return false;
}

function modelNumberLeft(text: string): string | null {
  const rest = stripAllowedNumberTokens(text).replace(/\b(?:19|20)\d{2}\b/g, " ");
  if (/\b(?:USD|EUR|CHF|GBP|JPY|DKK)\s*\d/i.test(rest)) return "Währung";
  if (/\d+(?:[.,]\d+)?\s*(?:Mrd|Mio|Bn|B|M|K|x|%)/i.test(rest)) return "Zahl mit Einheit";
  if (/\d/.test(rest) || /[<>%]/.test(rest)) return "Ziffer";
  return null;
}

function stripTokens(text: string, tokens: string[]): string {
  let out = text;
  const sorted = Array.from(new Set(tokens.filter(t => t.trim().length >= 2))).sort((a, b) => b.length - a.length);
  for (const token of sorted) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), " ");
  }
  return out;
}

function hasBarePlaceholder(text: string): boolean {
  return BARE_PLACEHOLDER.test(text.replace(PLACEHOLDER_RE, " "));
}

/** Nach dem Einsetzen: geschweifte Reste und nackte snake_case-Namen dürfen nicht gesprochen werden. */
export function spokenLeaksPlaceholder(text: string): boolean {
  return /\{[a-z0-9_]+\}/i.test(text) || SNAKE_PLACEHOLDER.test(text);
}

const UNIT_BESIDE = /(?:Dollar|Prozent|Euro|US-Dollar|Milliarden|Millionen)\s+\{([a-z0-9_]+)\}|\{([a-z0-9_]+)\}\s+(?:Dollar|Prozent|Euro|US-Dollar|Milliarden|Millionen)/gi;

function unitBesideTypedPlaceholder(sentence: string): boolean {
  UNIT_BESIDE.lastIndex = 0;
  const matches = Array.from(sentence.matchAll(UNIT_BESIDE));
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const name = (match?.[1] || match?.[2]) as PodcastPlaceholder;
    const kind = PLACEHOLDER_KIND[name];
    if (kind === "money" || kind === "percent") return true;
  }
  return false;
}

function percentUsedAsRevenue(sentence: string): boolean {
  if (/wachstum/i.test(sentence)) return false;
  if (!/umsatz/i.test(sentence) || !/beträgt/i.test(sentence)) return false;
  return /\{(?:fy_yoy|wacc|g_star|top_segment_share|quarter_yoy|crv)\}/.test(sentence);
}

function nameUsedAsAmount(sentence: string): boolean {
  return /(?:stieg|steigt|steigen|auf)\s+\{top_segment\}/i.test(sentence);
}

const METRIC_NEEDS: ReadonlyArray<{ re: RegExp; placeholders: readonly string[] }> = [
  { re: /Netto-?Upside/i, placeholders: ["netto_upside_1", "netto_upside_2", "netto_upside_3"] },
  { re: /Umsatzwachstum/i, placeholders: ["fy_yoy"] },
  { re: /FCF-Marge/i, placeholders: ["fcf_margin"] },
  { re: /Scope[-\s]+Emissionen/i, placeholders: [] },
  { re: /GLP-Technologie/i, placeholders: [] },
];

function metricWithoutPlaceholder(sentence: string): boolean {
  for (const rule of METRIC_NEEDS) {
    if (!rule.re.test(sentence)) continue;
    if (rule.placeholders.length === 0) return true;
    if (!rule.placeholders.some(name => sentence.includes(`{${name}}`))) return true;
  }
  return false;
}

const INTERNAL_NAME = /\b(?:RevWachstum|fcfMargin|nettoUpside|revenueGrowth|bruttoUpside|newsItems|lastReportedQuarter|growthThesis)\b|\b[a-zäöüß][a-zäöüß0-9]*[A-Z][A-Za-z0-9]*\b/;

function copiesPayloadTitle(sentence: string, titles: readonly string[]): boolean {
  const fold = (value: string) => value.toLowerCase().replace(/[^a-zäöüß]+/g, "");
  const body = fold(speakNormalize(sentence) ?? sentence);
  for (const title of titles) {
    const folded = fold(speakNormalize(title) ?? title);
    if (folded.length >= 16 && body.includes(folded)) return true;
  }
  return false;
}

const ENGLISH_STOP = new Set(["the", "and", "of", "for", "across", "with", "from", "into", "over", "under", "after", "before", "between", "without", "within", "through", "during", "while", "where", "when", "which", "that", "this", "these", "those", "their", "its", "are", "was", "were", "been", "being", "have", "has", "had", "will", "would", "can", "could", "should", "may", "might", "not", "but", "or", "if", "than", "then", "also", "more", "most", "other", "such", "only", "just", "about", "per", "via", "versus", "vs", "to", "in", "on", "at", "by", "as", "an", "be", "is", "it", "we", "our", "you", "your"]);

const ENGLISH_LABEL_WORD = new Set(["demand", "expansion", "enterprise", "monetization", "recovery", "stalls", "permanently", "hydrogen", "fuel", "cell", "margin", "business", "core", "market", "growth", "revenue", "guidance", "omniverse"]);

function contentWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter(word => word.length > 2);
}

function englishHitCount(words: readonly string[]): number {
  return words.filter(word => ENGLISH_STOP.has(word) || ENGLISH_LABEL_WORD.has(word)).length;
}

/** Englisch nur über Stopp- und Fachwörter, nie über das Fehlen deutscher Marker. */
function looksLikeEnglishTitle(sentence: string): boolean {
  const spoken = speakNormalize(sentence) ?? sentence;
  const words = contentWords(spoken);
  if (words.length < 2) return false;
  const hits = englishHitCount(words);
  if (hits === 0) return false;
  if (words.length <= 3) return true;
  return hits >= 2 && hits * 2 >= words.length;
}

const PROTECTED_PLACEHOLDERS = new Set(["ticker", "company", "top_segment"]);

function guardNames(text: string, names: readonly string[]): string {
  const sorted = Array.from(new Set(names.map(name => name.trim()).filter(name => name.length >= 2)))
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^A-Za-z0-9ÄÖÜäöüß])(${escaped})(?![A-Za-z0-9ÄÖÜäöüß])`, "g");
    const parts = out.split(NAME_GUARD);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = (parts[i] ?? "").replace(re, (_full, prefix: string, match: string) => `${prefix}${guardSpan(match)}`);
    }
    out = parts.join(NAME_GUARD);
  }
  return out;
}

export function polishSpoken(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/\b(Dollar|Prozent|Euro|Milliarden|Millionen)\s+\1\b/gi, "$1");
  }
  out = out.replace(/!+\./g, "!").replace(/\?+\./g, "?").replace(/\.{2,}/g, ".").replace(/!{2,}/g, "!");
  return out.trim();
}

export function checkPodcastSentence(
  sentence: string,
  facts: Pick<PodcastFacts, "values" | "tokens" | "catalystGeneric" | "payloadTitles" | "protectedNames" | "silentTicker">,
  chapterId = "",
  origin: "model" | "code" = "model",
): { ok: true } | { ok: false; reason: string } {
  const raw = sentence.trim();
  if (!raw) return { ok: false, reason: "leer" };
  if (scriptContainsForbiddenGrowth(raw)) return { ok: false, reason: "YTD" };
  if (BANNED.test(raw)) return { ok: false, reason: "Zahlwort" };
  if (chapterId === "s17" && facts.catalystGeneric && /firmenspezifisch|unternehmensspezifisch/i.test(raw)) {
    return { ok: false, reason: "generische Katalysatoren" };
  }
  PLACEHOLDER_RE.lastIndex = 0;
  const names = Array.from(raw.matchAll(PLACEHOLDER_RE)).map(m => m[1] ?? "");
  for (const name of names) {
    if (!ALLOWED.has(name)) return { ok: false, reason: `unbekannter Platzhalter ${name}` };
    const key = name as PodcastPlaceholder;
    const value = facts.values[key];
    if (value == null || value.trim() === "") return { ok: false, reason: `Platzhalter ohne Wert ${name}` };
    if (origin === "model" && placeholderForbiddenInModel(key)) return { ok: false, reason: `Platzhalter ${name} nur im Code-Satz` };
  }
  if (origin === "model" && (unitBesideTypedPlaceholder(raw) || percentUsedAsRevenue(raw) || nameUsedAsAmount(raw))) {
    return { ok: false, reason: "Platzhalter passt nicht zum Satz" };
  }
  if (origin === "model" && /GrowthEvidence|Katalysatoren:/i.test(raw)) return { ok: false, reason: "interne Zeile" };
  if (origin === "model" && hasBarePlaceholder(raw)) return { ok: false, reason: "nackter Platzhalter" };
  if (origin === "model" && metricWithoutPlaceholder(raw)) return { ok: false, reason: "Kennzahl ohne Platzhalter" };
  if (origin === "model" && INTERNAL_NAME.test(stripTokens(raw.replace(PLACEHOLDER_RE, " "), facts.protectedNames ?? []))) {
    return { ok: false, reason: "interner Bezeichner" };
  }
  if (origin === "model" && /\{news_age\}\s+alt\b|weniger als einem Tag|einem Tag alt|einen Tag alt/i.test(raw)) {
    return { ok: false, reason: "Alter ist schon eine Wendung" };
  }
  if (origin === "model" && /\b(?:Kurs|Fairwert|Einstieg)\b|faire[rn]?\s+Wert/i.test(raw)) {
    return { ok: false, reason: "Kurs nur im Code-Satz" };
  }
  if (origin === "model" && /Quartal zum/i.test(raw)) return { ok: false, reason: "Meldedatum ist kein Quartalsende" };
  if (origin === "model" && /\b(?:crv|Forward-KGV|KGV|Kapitalwert-Rendite)\b/i.test(raw)) {
    return { ok: false, reason: "CRV nur im Code-Satz" };
  }
  if (origin === "model" && /(?:\d|zwei|drei|vier|fünf|sechs|sieben|acht|neun|null|eins)\s*x\b/i.test(raw)) {
    return { ok: false, reason: "x-Suffix" };
  }
  if (origin === "model" && /liegt vor\.?$/.test(raw) && !/liegt nicht vor/.test(raw) && !/\{[a-z0-9_]+\}/.test(raw)) {
    return { ok: false, reason: "ohne Inhalt" };
  }
  if (origin === "model" && /^(?:Die Angabe|Die Ampel|Die These) liegt nicht vor\.?$/i.test(raw.trim())) {
    return { ok: false, reason: "leerer Pflichtsatz" };
  }
  if (origin === "model" && !facts.values.company && /\bUnternehmen\b/i.test(raw)) {
    return { ok: false, reason: "Firma unbekannt" };
  }
  if (origin === "model" && /jüngste Meldung|stammt von|von heute|von gestern|von vor|Tage alt/i.test(raw)) {
    return { ok: false, reason: "Alter nur im News-Satz" };
  }
  if (origin === "model" && facts.silentTicker && new RegExp(`\\b${facts.silentTicker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(raw)) {
    return { ok: false, reason: "numerischer Ticker" };
  }
  if (origin === "model" && (copiesPayloadTitle(raw, facts.payloadTitles) || looksLikeEnglishTitle(raw))) {
    return { ok: false, reason: "Rohtext" };
  }
  if (origin === "code") return { ok: true };
  let rest = raw.replace(PLACEHOLDER_RE, " ");
  if (/[A-Za-zÄÖÜäöüß](?:19|20)\d{2}\b|\b(?:19|20)\d{2}[A-Za-zÄÖÜäöüß]/.test(stripAllowedNumberTokens(rest))) {
    return { ok: false, reason: "Zahl" };
  }
  if (/[{}]/.test(rest)) return { ok: false, reason: "ungültige Klammer" };
  rest = stripTokens(rest, [...(facts.protectedNames ?? []), ...facts.tokens]);
  const left = modelNumberLeft(rest);
  if (left) return { ok: false, reason: left };
  if (hasNumberUnit(rest)) return { ok: false, reason: "Zahlwort" };
  return { ok: true };
}

export function applyPlaceholders(
  sentence: string,
  facts: Pick<PodcastFacts, "values" | "tokens" | "catalystGeneric" | "payloadTitles" | "protectedNames" | "silentTicker">,
  chapterId = "",
  origin: "model" | "code" = "model",
): string | null {
  if (!checkPodcastSentence(sentence, facts, chapterId, origin).ok) return null;
  let missing = false;
  PLACEHOLDER_RE.lastIndex = 0;
  const filled = sentence.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = facts.values[name as PodcastPlaceholder];
    if (value == null || value.trim() === "") {
      missing = true;
      return "";
    }
    if (PROTECTED_PLACEHOLDERS.has(name)) return guardSpan(value);
    return value;
  });
  if (missing) return null;
  const hidden = hideSilentTicker(filled, facts.silentTicker);
  const guarded = guardNames(hidden, facts.protectedNames ?? []);
  const polished = polishSpoken(guarded);
  if (!polished || spokenLeaksPlaceholder(unguard(polished))) return null;
  const spoken = speakNormalize(polished);
  if (!spoken) return null;
  if (origin === "model" && modelNumberLeft(stripTokens(unguard(spoken), facts.protectedNames ?? []))) return null;
  return spoken;
}

export function balanceProContra(pro: string, contra: string): { pro: string; contra: string } {
  if (contra.length >= pro.length) return { pro, contra };
  const complete = keepCompleteSentences(pro.slice(0, contra.length));
  if (!complete) return { pro, contra };
  return { pro: complete, contra };
}

function hideSilentTicker(text: string, ticker: string | null): string {
  if (!ticker) return text;
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${escaped}s?\\b`, "gi"), " ").replace(/[ ]{2,}/g, " ").trim();
}

function stripGluedGenitive(text: string, names: readonly string[]): string {
  let out = text;
  const sorted = Array.from(new Set(names.map(name => name.trim()).filter(name => name.length >= 2)))
    .sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (/[A-Za-zÄÖÜäöüß]$/.test(name) && !/[sS]$/.test(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9ÄÖÜäöüß])(${escaped})s\\s+([A-Za-zÄÖÜäöüß]+)`, "g"),
      "Das $2 von $1",
    );
  }
  return out;
}

function dedupeSentences(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    kept.push(part);
  }
  return kept.join(" ");
}

function withoutEmptyPresence(sentence: string): boolean {
  if (/liegt nicht vor/.test(sentence)) return true;
  return !/liegt (?:eine |ein )?[A-Za-zÄÖÜäöüß-]+ vor\.?$/.test(sentence);
}

function durationSec(spoken: string): number {
  const words = spoken.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 140) * 60));
}

const CATALYST_ORDINALS = ["Der erste Katalysator", "Der zweite Katalysator", "Der dritte Katalysator"] as const;

function speakKnownTerms(text: string): string {
  const phase = ["", "eins", "zwei", "drei", "vier"];
  return text
    .replace(/\bGLP-1\b/g, "GLP-eins")
    .replace(/\bPhase[-\s]([1-4])\b/gi, (_match, n: string) => `Phase ${phase[Number(n)] ?? n}`);
}

function predominantlyEnglish(sentence: string): boolean {
  return looksLikeEnglishTitle(sentence);
}

function labelIsEnglish(text: string): boolean {
  const words = contentWords(text);
  if (words.some(word => ENGLISH_LABEL_WORD.has(word))) return true;
  const hits = englishHitCount(words);
  return words.length >= 3 && hits >= 2 && hits * 2 >= words.length;
}

function acceptSpokenLabel(raw: string | undefined): string | null {
  const spoken = speakKnownTerms((raw ?? "").trim());
  if (!spoken || /[&+%()]/.test(spoken) || spokenStillRaw(spoken) || labelIsEnglish(spoken)) return null;
  return /^[a-zäöü]/.test(spoken) ? `${spoken[0]!.toUpperCase()}${spoken.slice(1)}` : spoken;
}

function readSpokenLabels(data: unknown): Record<string, string> {
  const labels = data && typeof data === "object" ? (data as { labels?: unknown }).labels : null;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value === "string" && /^(?:Katalysator|Risiko) \d+$/.test(key)) out[key] = value;
  }
  return out;
}

function fallbackSentences(id: string, facts: PodcastFacts, labels: Record<string, string> = {}): string[] {
  const v = facts.values;
  const out: string[] = [];
  const add = (sentence: string) => {
    if (checkPodcastSentence(sentence, facts, id, "code").ok) out.push(sentence);
  };
  switch (id) {
    case "einstieg": {
      if (v.ticker && v.company) add("{ticker}, {company}. Stand vom {as_of}.");
      else if (v.company) add("{company}. Stand vom {as_of}.");
      else if (v.ticker) add("{ticker}. Stand vom {as_of}.");
      else if (v.as_of) add("Stand vom {as_of}.");
      if (v.price) add("Der Kurs steht bei {price}.");
      if (v.ampel) add("Die Ampel steht auf {ampel}.");
      break;
    }
    case "zusammenfassung":
      if (v.price) add("Der Kurs steht bei {price}.");
      else out.push("Der Kurs liegt nicht vor.");
      break;
    case "these":
      break;
    case "umsatz":
      if (v.fy_yoy && v.gj_year) add("Das Umsatzwachstum im Geschäftsjahr {gj_year} beträgt {fy_yoy}.");
      else if (v.fy_yoy) add("Das Umsatzwachstum im Geschäftsjahr beträgt {fy_yoy}.");
      else out.push("Das Umsatzwachstum im Geschäftsjahr liegt nicht vor.");
      if (v.top_segment && v.top_segment_share) add("Der größte genannte Umsatzträger ist {top_segment} mit einem Anteil von {top_segment_share}.");
      else out.push("Der Hauptumsatzträger liegt nicht vor.");
      if (facts.segmentPeriodMissing) out.push("Die Periode des Segments liegt nicht vor.");
      break;
    case "s13":
      if (!facts.hasPorter) out.push("Moat und Porter liegen nicht vor.");
      break;
    case "s14":
      if (!facts.hasPestel) out.push("PESTEL liegt nicht vor.");
      if (v.fcf_margin) add("Die FCF-Marge liegt bei {fcf_margin}.");
      break;
    case "dcf":
      if (v.dcf_fair) add("Der faire Wert liegt bei {dcf_fair}.");
      else out.push("Der faire Wert liegt nicht vor.");
      if (v.g_star) add("Das implizite Wachstum liegt bei {g_star}.");
      else out.push("Das implizite Wachstum liegt nicht vor.");
      if (v.wacc) add("Der Kapitalkostensatz liegt bei {wacc}.");
      else out.push("Der Kapitalkostensatz liegt nicht vor.");
      if (v.entry && facts.rankOk) add("Der rechnerische Einstieg liegt bei {entry}.");
      else if (!v.entry) out.push("Der rechnerische Einstieg liegt nicht vor.");
      if (v.crv) add("Das Chance-Risiko-Verhältnis liegt bei {crv}.");
      else out.push("Das Chance-Risiko-Verhältnis liegt nicht vor.");
      if (facts.peerBanner) out.push(facts.peerBanner);
      if (facts.sectorFlag) out.push(facts.sectorFlag);
      break;
    case "s17":
      if (v.catalyst_mode) out.push(/[.!?]$/.test(v.catalyst_mode) ? v.catalyst_mode : `${v.catalyst_mode}.`);
      else out.push("Die Katalysatoren liegen nicht vor.");
      (facts.upsideNames ?? []).forEach((_name, index) => {
        const key = (["netto_upside_1", "netto_upside_2", "netto_upside_3"] as const)[index];
        const label = acceptSpokenLabel(labels[`Katalysator ${index + 1}`]) ?? CATALYST_ORDINALS[index] ?? "Der Katalysator";
        if (key && v[key]) add(`${label}: Der Netto-Upside liegt bei {${key}}.`);
      });
      break;
    case "inversion":
      if (v.entry && facts.rankOk) add("Der rechnerische Einstieg liegt bei {entry}.");
      else if (!v.entry) out.push("Der rechnerische Einstieg liegt nicht vor.");
      facts.riskNames.forEach((_name, index) => {
        const label = acceptSpokenLabel(labels[`Risiko ${index + 1}`]);
        if (label) out.push(`${label}.`);
      });
      break;
    case "earnings":
      if (facts.earningsState === "ready" && v.call_quarter) add("Der letzte vorliegende Call ist {call_quarter}.");
      else if (facts.earningsState === "stale" && facts.earningsNote) out.push(facts.earningsNote);
      else {
        out.push("Ein Earnings-Call-Transkript liegt nicht vor.");
        if (facts.reportedQuarterLine) out.push(facts.reportedQuarterLine);
      }
      if (facts.nextCallLine) out.push(facts.nextCallLine);
      else if (facts.callEstimated) out.push("Der nächste Termin ist geschätzt.");
      break;
    case "news":
      if (v.news_age) add("Die jüngste Meldung stammt von {news_age}.");
      else out.push("Im betrachteten Zeitfenster liegen keine Meldungen vor.");
      break;
    case "news-llm":
      if (v.news_age) add("Die jüngste Meldung stammt von {news_age}.");
      else out.push("Eine eigene News-Anknüpfung liegt nicht vor.");
      break;
    case "schluss":
      out.push(PODCAST_DISCLAIMER);
      break;
    default:
      out.push("Das Kapitel liegt nicht vor.");
  }
  return out.filter(s => s.trim().length > 0 && withoutEmptyPresence(s.trim()));
}

function modelSentences(data: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const chapters = data && typeof data === "object" && Array.isArray((data as { chapters?: unknown }).chapters)
    ? (data as { chapters: unknown[] }).chapters
    : [];
  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== "object") continue;
    const id = typeof (chapter as { id?: unknown }).id === "string" ? (chapter as { id: string }).id : "";
    const sentences = (chapter as { sentences?: unknown }).sentences;
    if (!id || !Array.isArray(sentences)) continue;
    const texts = sentences.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    if (texts.length) map.set(id, texts);
  }
  return map;
}

const CODE_OWNED_CHAPTERS = new Set(["einstieg", "zusammenfassung", "dcf", "umsatz", "earnings", "s17"]);

function valuesOfPlaceholders(sentence: string, facts: PodcastFacts): string[] {
  PLACEHOLDER_RE.lastIndex = 0;
  const names = Array.from(sentence.matchAll(PLACEHOLDER_RE)).map(match => match[1] ?? "");
  return names
    .filter(name => {
      const kind = PLACEHOLDER_KIND[name as PodcastPlaceholder];
      return kind === "money" || kind === "percent";
    })
    .map(name => facts.values[name as PodcastPlaceholder])
    .filter((value): value is string => typeof value === "string" && value.trim().length >= 12);
}

function repeatsCodeValue(sentence: string, facts: PodcastFacts, chapterId: string, codeValues: string[]): boolean {
  const spoken = applyPlaceholders(sentence, facts, chapterId, "model");
  if (!spoken) return true;
  return codeValues.some(value => spoken.includes(value));
}

function completeModelSentences(sentences: string[]): string[] {
  return sentences.flatMap(sentence => {
    const complete = keepCompleteSentences(sentence);
    if (!complete) return [];
    return complete.split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
  });
}

function splitSentences(text: string): string[] {
  const held: string[] = [];
  const masked = text.split(NAME_GUARD).map((part, index) => {
    if (index % 2 === 1) {
      held.push(part);
      return `\u0002${held.length - 1}\u0002`;
    }
    return part.replace(/\b(Inc|Corp|Ltd|Co)\./g, "$1\u0003");
  }).join("");
  return masked.split(/(?<=[.!?])\s+/).map(part => part
    .replace(/\u0003/g, ".")
    .replace(/\u0002(\d+)\u0002/g, (_match, index: string) => `${NAME_GUARD}${held[Number(index)] ?? ""}${NAME_GUARD}`)
    .trim(),
  ).filter(Boolean);
}

function scrubSpoken(text: string): string {
  const parts = splitSentences(text);
  const kept: string[] = [];
  for (const part of parts) {
    if (/GrowthEvidence/i.test(part)) {
      kept.push("Die Sektor-Referenz ist nicht belastbar.");
      continue;
    }
    if (spokenLeaksPlaceholder(part)) continue;
    const normalized = speakNormalize(polishSpoken(part));
    if (normalized) kept.push(normalized);
  }
  return unguard(kept.join(" ").trim());
}

function finishSpoken(text: string, facts: PodcastFacts): string {
  const hidden = hideSilentTicker(text, facts.silentTicker);
  return polishSpoken(dedupeSentences(stripGluedGenitive(hidden, facts.protectedNames ?? [])));
}

export function assemblePodcastChapters(source: StockPodcastSource, facts: PodcastFacts, modelData: unknown): StockPodcastChapter[] & { dropped: PodcastDropCounts } {
  const blocked = modelData != null && scriptContainsForbiddenGrowth(JSON.stringify(modelData));
  const fromModel = blocked ? new Map<string, string[]>() : modelSentences(modelData);
  const labels = readSpokenLabels(modelData);
  const dropped = emptyDropCounts();
  const note = (reason: string) => {
    dropped.total += 1;
    dropped.byReason[reason] = (dropped.byReason[reason] ?? 0) + 1;
  };
  const planned = chaptersForSource(source).map(def => ({ def, fallback: fallbackSentences(def.id, facts, labels) }));
  const valuesByChapter = new Map(planned.map(item => [
    item.def.id,
    item.fallback.flatMap(sentence => valuesOfPlaceholders(sentence, facts)),
  ]));
  const chapters = planned.map(({ def, fallback }) => {
    const ownValues = valuesByChapter.get(def.id) ?? [];
    const foreignValues = Array.from(valuesByChapter.entries())
      .filter(([id]) => id !== def.id)
      .flatMap(([, values]) => values);
    const model = completeModelSentences(fromModel.get(def.id) ?? []).filter(sentence => {
      const verdict = checkPodcastSentence(sentence, facts, def.id, "model");
      if (!verdict.ok) {
        note(verdict.reason);
        return false;
      }
      if (repeatsCodeValue(sentence, facts, def.id, ownValues) || repeatsCodeValue(sentence, facts, def.id, foreignValues)) {
        note("Wiederholung");
        return false;
      }
      return true;
    });
    const keepNews = def.id === "news-llm" && !!facts.values.news_age;
    const codeOnly = def.id === "schluss" || model.length === 0;
    const tagged = codeOnly
      ? fallback.map(text => ({ text, origin: "code" as const }))
      : CODE_OWNED_CHAPTERS.has(def.id) || keepNews
        ? [...fallback.map(text => ({ text, origin: "code" as const })), ...model.map(text => ({ text, origin: "model" as const }))]
        : model.map(text => ({ text, origin: "model" as const }));
    const spokenParts = tagged
      .map(part => applyPlaceholders(part.text, facts, def.id, part.origin))
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    let spoken = finishSpoken(scrubSpoken(spokenParts.join(" ").trim()), facts);
    if (def.id === "umsatz" && !/Geschäftsjahr/.test(spoken)) {
      const fiscal = applyPlaceholders(fallbackSentences("umsatz", facts)[0] ?? "", facts, "umsatz", "code");
      if (fiscal) spoken = finishSpoken(scrubSpoken(`${fiscal} ${spoken}`), facts);
    }
    if (def.id === "schluss" && !spoken.includes(PODCAST_DISCLAIMER)) spoken = `${spoken} ${PODCAST_DISCLAIMER}`.trim();
    return {
      id: def.id,
      title: def.title,
      label: def.title,
      template: tagged.map(part => part.text).join(" "),
      spoken,
      durationSec: durationSec(spoken),
      llmOwned: def.llmOwned,
      audioUrl: null,
    };
  });
  if (source === "pdf") {
    const pro = chapters.find(c => c.id === "zusammenfassung");
    const contra = chapters.find(c => c.id === "inversion");
    if (pro && contra) {
      const balanced = balanceProContra(pro.spoken, contra.spoken);
      pro.spoken = balanced.pro || "Der Kurs liegt nicht vor.";
      contra.spoken = balanced.contra;
      pro.durationSec = durationSec(pro.spoken);
      contra.durationSec = durationSec(contra.spoken);
    }
  }
  const linted = lintChapters(chapters, facts.protectedNames ?? [], note);
  return Object.assign(linted, { dropped });
}

function hideNames(text: string, names: readonly string[]): string {
  const sorted = Array.from(new Set(names.map(name => name.trim()).filter(name => name.length >= 2)))
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9ÄÖÜäöüß])${escaped}(?![A-Za-z0-9ÄÖÜäöüß])`, "g"), " ");
  }
  return out;
}

function lintReason(sentence: string, names: readonly string[]): string | null {
  const text = sentence.trim();
  if (!text) return "leer";
  if (/von von/i.test(text)) return "von von";
  if (/von das\b/i.test(text)) return "von das";
  const uncovered = stripAllowedNumberTokens(hideNames(text, names));
  if (/[&+%()]/.test(uncovered)) return "Zeichen";
  if (spokenStillRaw(uncovered)) return "Ziffer";
  const firstWord = /^[a-zäöü][A-Za-zÄÖÜäöüß]*/.exec(text);
  if (firstWord && !/[A-ZÄÖÜ]/.test(firstWord[0].slice(1))) return "Satzanfang";
  if (predominantlyEnglish(uncovered)) return "englisch";
  return null;
}

function lintChapters(chapters: StockPodcastChapter[], names: readonly string[], note: (reason: string) => void): StockPodcastChapter[] {
  const next: StockPodcastChapter[] = [];
  for (const chapter of chapters) {
    const seen = new Set<string>();
    const parts = splitSentences(chapter.spoken);
    const kept: string[] = [];
    for (const part of parts) {
      const reason = seen.has(part) ? "doppelt" : lintReason(part, names);
      if (reason) {
        note(reason);
        continue;
      }
      seen.add(part);
      kept.push(part);
    }
    const spoken = kept.join(" ").trim();
    if (!spoken && chapter.id !== "schluss") continue;
    next.push({ ...chapter, spoken, durationSec: durationSec(spoken || chapter.spoken) });
  }
  return next;
}

export function buildPodcastLlmPrompt(source: StockPodcastSource, facts: PodcastFacts): { systemPrompt: string; prompt: string } {
  const ids = chaptersForSource(source).map(c => `${c.id} (${c.title})`).join(", ");
  const available = (Object.keys(facts.values) as PodcastPlaceholder[])
    .filter(k => facts.values[k] != null && !placeholderForbiddenInModel(k));
  const systemPrompt = [
    "Du schreibst ein deutsches Podcast-Transkript als JSON.",
    "Antworte nur mit {\"chapters\":[{\"id\":string,\"sentences\":string[]}],\"labels\":{\"<Schlüssel>\":string}}.",
    "labels ist ein Objekt. Schlüssel sind genau die im Kontext genannten „Katalysator 1“ bis „Katalysator n“ und „Risiko 1“ bis „Risiko n“. Der Wert ist ein deutsches Kurzlabel. Keine Ziffer außer einem Produktnamen wie H100. Keine Zeichen & + % ( ). GLP-1 schreibst du als GLP-eins, Phase-3 als Phase drei. Schreibe Katalysator, nicht Katalyse. Ein Label nie nach Position zuordnen.",
    "Keine Ziffer, kein Zahlwort mit Einheit, kein YTD, kein seit Jahresbeginn.",
    "Zahlen nur als Platzhalter in geschweiften Klammern, zum Beispiel {fy_yoy}. Den Namen ohne Klammern nie schreiben. Fehlt ein Platzhalter in der Liste, nutze ihn nicht.",
    "Eine Kennzahl nennst du nur zusammen mit ihrem Platzhalter: Umsatzwachstum mit {fy_yoy}, die FCF-Marge mit {fcf_margin}, den Netto-Upside mit {netto_upside_1}. Ohne diesen Platzhalter nennst du die Kennzahl nicht.",
    "Keine internen Namen wie RevWachstum und keine camelCase-Feldnamen.",
    "Englische Überschriften nicht abschreiben. Formuliere den Inhalt auf Deutsch. Titel im Kontext sind nur Hintergrund.",
    "Das Alter einer Meldung schreibt der Code einmal: Die jüngste Meldung stammt von heute, von gestern oder von vor drei Tagen. Diesen Satz nicht wiederholen.",
    "Kurs, fairer Wert, Einstieg und das Chance-Risiko-Verhältnis schreibt nur der Code. Kein x hinter eine Kennzahl, kein Forward-KGV, keine Kapitalwert-Rendite.",
    "Risiken fasst du auf Deutsch zusammen. Den englischen Titel nicht kopieren und kein s an einen Eigennamen hängen.",
    "Eine andere Firma und einen anderen Sektor nicht erfinden. Ein numerisches Börsenkürzel nicht schreiben.",
    "Erfinde keine Kennzahl. Ein Satz ohne belegten Platzhalter sagt nichts Zahlenhaftes.",
    facts.catalystGeneric ? "Katalysatoren sind generisch. Nenne sie nicht firmenspezifisch." : "Katalysatoren dürfen als KI-firmenspezifisch bezeichnet werden.",
  ].join(" ");
  const prompt = [
    `Quelle: ${source}.`,
    `Kapitel in dieser Reihenfolge: ${ids}.`,
    `Erlaubte Platzhalter mit vorhandenem Wert: ${available.map(name => `{${name}}`).join(", ") || "keine"}.`,
    "Kontext, Ziffern entfernt:",
    facts.redactedContext || "kein Zusatzkontext",
    "Das Schlusskapitel bleibt kurz. Der Disclaimer wird vom Code angehängt.",
  ].join("\n");
  return { systemPrompt, prompt };
}

export function spokenHasDigits(chapters: StockPodcastChapter[]): boolean {
  return chapters.some(c => spokenStillRaw(c.spoken));
}

export function placeholderValues(values: PodcastFactValues): PodcastFactValues {
  return values;
}
