/**
 * Platzhalter, Validator und Kapitel des Aktien-Podcasts.
 * Ein Modelltext wird vor dem Einsetzen geprüft. Ziffern und Zahlwörter
 * mit Einheit fallen weg. Werte kommen nur aus den Fakten.
 */
import type { StockPodcastChapter, StockPodcastSource } from "./podcast-types";
import { PODCAST_DISCLAIMER } from "./podcast-types";
import { PLACEHOLDER_KIND, PODCAST_PLACEHOLDERS, placeholderForbiddenInModel, type PodcastFacts, type PodcastFactValues, type PodcastPlaceholder } from "./podcast-facts";
import { keepCompleteSentences } from "./podcast-speak";

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

function stripPatterns(text: string): string {
  return text
    .replace(/S&P 500/g, " ")
    .replace(/\bS\d{1,2}\b/g, " ")
    .replace(/\bQ[1-4]\b/g, " ")
    .replace(/\b(?:GJ|FY)\d{4}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d+-nm\b/g, " ")
    .replace(/\bH100\b/g, " ")
    .replace(/\bB200\b/g, " ");
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
  facts: Pick<PodcastFacts, "values" | "tokens" | "catalystGeneric">,
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
  if (hasBarePlaceholder(raw)) return { ok: false, reason: "nackter Platzhalter" };
  if (origin === "code") return { ok: true };
  let rest = raw.replace(PLACEHOLDER_RE, " ");
  if (/[{}]/.test(rest)) return { ok: false, reason: "ungültige Klammer" };
  rest = stripTokens(rest, facts.tokens);
  rest = stripPatterns(rest);
  if (/\d/.test(rest)) return { ok: false, reason: "Ziffer" };
  if (hasNumberUnit(rest)) return { ok: false, reason: "Zahlwort" };
  return { ok: true };
}

export function applyPlaceholders(
  sentence: string,
  facts: Pick<PodcastFacts, "values" | "tokens" | "catalystGeneric">,
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
    return value;
  });
  if (missing) return null;
  const polished = polishSpoken(filled);
  if (!polished || spokenLeaksPlaceholder(polished) || /\d{4}-\d{2}-\d{2}/.test(polished)) return null;
  return polished;
}

export function balanceProContra(pro: string, contra: string): { pro: string; contra: string } {
  if (contra.length >= pro.length) return { pro, contra };
  const complete = keepCompleteSentences(pro.slice(0, contra.length));
  if (!complete) return { pro, contra };
  return { pro: complete, contra };
}

function durationSec(spoken: string): number {
  const words = spoken.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 140) * 60));
}

function fallbackSentences(id: string, facts: PodcastFacts): string[] {
  const v = facts.values;
  const out: string[] = [];
  const add = (sentence: string) => {
    if (checkPodcastSentence(sentence, facts, id, "code").ok) out.push(sentence);
  };
  switch (id) {
    case "einstieg":
      add("{ticker}, {company}. Stand vom {as_of}.");
      if (v.ampel) add("Die Ampel steht auf {ampel}.");
      else out.push("Die Ampel liegt nicht vor.");
      break;
    case "zusammenfassung":
      if (v.price) add("Der Kurs steht bei {price}.");
      else out.push("Der Kurs liegt nicht vor.");
      break;
    case "these":
      out.push(facts.hasThesis ? "Eine Investmentthese liegt vor." : "Die These liegt nicht vor.");
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
      out.push(facts.hasPorter ? "Zu Moat und Porter liegt eine Einordnung vor." : "Moat und Porter liegen nicht vor.");
      break;
    case "s14":
      out.push(facts.hasPestel ? "Zur PESTEL-Lage liegt eine Einordnung vor." : "PESTEL liegt nicht vor.");
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
      break;
    case "inversion":
      if (v.entry && facts.rankOk) add("Der rechnerische Einstieg liegt bei {entry}.");
      else out.push("Der rechnerische Einstieg liegt nicht vor.");
      out.push(facts.riskNames.length ? `Die Inversion nennt ${facts.riskNames.join(" und ")}.` : "Die Inversion liegt nicht vor.");
      break;
    case "earnings":
      if (facts.earningsState === "ready" && v.call_quarter) add("Der letzte vorliegende Call ist {call_quarter}.");
      else if (facts.earningsState === "stale" && facts.earningsNote) out.push(facts.earningsNote);
      else {
        out.push("Ein Earnings-Call-Transkript liegt nicht vor.");
        if (v.call_quarter) out.push(`Zuletzt gemeldet wurde das ${v.call_quarter}.`);
      }
      if (facts.nextCallLine) out.push(facts.nextCallLine);
      else if (facts.callEstimated) out.push("Der nächste Termin ist geschätzt.");
      break;
    case "news":
      if (v.news_1) add("Die jüngste Meldung ist {news_1}.");
      if (v.news_2) add("Eine weitere Meldung ist {news_2}.");
      if (v.news_3) add("Eine weitere Meldung ist {news_3}.");
      if (v.news_age) add("Die älteste gesprochene Meldung ist {news_age} alt.");
      if (!v.news_1) out.push("Im betrachteten Zeitfenster liegen keine Meldungen vor.");
      break;
    case "news-llm":
      out.push("Eine eigene News-Anknüpfung liegt nicht vor.");
      break;
    case "schluss":
      out.push(PODCAST_DISCLAIMER);
      break;
    default:
      out.push("Das Kapitel liegt nicht vor.");
  }
  return out.filter(s => s.trim().length > 0);
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

const CODE_OWNED_CHAPTERS = new Set(["zusammenfassung", "dcf", "umsatz", "earnings", "s17"]);

function valuesOfPlaceholders(sentence: string, facts: PodcastFacts): string[] {
  PLACEHOLDER_RE.lastIndex = 0;
  const names = Array.from(sentence.matchAll(PLACEHOLDER_RE)).map(match => match[1] ?? "");
  return names
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

function scrubSpoken(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
  const kept = parts.map(part => {
    if (/GrowthEvidence/i.test(part)) return "Die Sektor-Referenz ist nicht belastbar.";
    if (spokenLeaksPlaceholder(part) || /\d{4}-\d{2}-\d{2}/.test(part)) return "Die Angabe liegt nicht vor.";
    return polishSpoken(part);
  });
  return polishSpoken(kept.join(" ")).trim();
}

export function assemblePodcastChapters(source: StockPodcastSource, facts: PodcastFacts, modelData: unknown): StockPodcastChapter[] {
  const blocked = modelData != null && scriptContainsForbiddenGrowth(JSON.stringify(modelData));
  const fromModel = blocked ? new Map<string, string[]>() : modelSentences(modelData);
  const chapters = chaptersForSource(source).map(def => {
    const fallback = fallbackSentences(def.id, facts);
    const codeValues = fallback.flatMap(sentence => valuesOfPlaceholders(sentence, facts));
    const model = completeModelSentences(fromModel.get(def.id) ?? [])
      .filter(s => checkPodcastSentence(s, facts, def.id, "model").ok)
      .filter(s => !repeatsCodeValue(s, facts, def.id, codeValues));
    const codeOnly = def.id === "schluss" || model.length === 0;
    const tagged = codeOnly
      ? fallback.map(text => ({ text, origin: "code" as const }))
      : CODE_OWNED_CHAPTERS.has(def.id)
        ? [...fallback.map(text => ({ text, origin: "code" as const })), ...model.map(text => ({ text, origin: "model" as const }))]
        : model.map(text => ({ text, origin: "model" as const }));
    const spokenParts = tagged
      .map(part => applyPlaceholders(part.text, facts, def.id, part.origin))
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    let spoken = scrubSpoken(spokenParts.join(" ").trim()) || "Die Angabe liegt nicht vor.";
    if (def.id === "umsatz" && !/Geschäftsjahr/.test(spoken)) {
      const fiscal = applyPlaceholders(fallbackSentences("umsatz", facts)[0] ?? "", facts, "umsatz", "code");
      if (fiscal) spoken = scrubSpoken(`${fiscal} ${spoken}`);
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
  return chapters;
}

export function buildPodcastLlmPrompt(source: StockPodcastSource, facts: PodcastFacts): { systemPrompt: string; prompt: string } {
  const ids = chaptersForSource(source).map(c => `${c.id} (${c.title})`).join(", ");
  const available = (Object.keys(facts.values) as PodcastPlaceholder[]).filter(k => facts.values[k] != null);
  const systemPrompt = [
    "Du schreibst ein deutsches Podcast-Transkript als JSON.",
    "Antworte nur mit {\"chapters\":[{\"id\":string,\"sentences\":string[]}]}.",
    "Keine Ziffer, kein Zahlwort mit Einheit, kein YTD, kein seit Jahresbeginn.",
    "Zahlen nur als Platzhalter in geschweiften Klammern, zum Beispiel {fy_yoy}. Den Namen ohne Klammern nie schreiben. Fehlt ein Platzhalter in der Liste, nutze ihn nicht.",
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
  return chapters.some(c => /\d/.test(c.spoken.replace(/S&P 500|\bS\d{1,2}\b|\bQ[1-4]\b|\b(?:GJ|FY)\d{4}\b|\b(?:19|20)\d{2}\b|\b\d+-nm\b|\bH100\b|\bB200\b/g, "")));
}

export function placeholderValues(values: PodcastFactValues): PodcastFactValues {
  return values;
}
