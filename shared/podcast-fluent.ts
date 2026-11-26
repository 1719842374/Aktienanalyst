/**
 * Faktenblatt zuerst, dann ein Absatz je Kapitel.
 * Der Code spricht jede belegte Zahl aus. Das Modell sieht keine Rohzahl und keinen Feldnamen.
 * Ein kaputtes Kapitel wird neu geschrieben. Erst danach setzt der Code einen mehrsätzigen Absatz.
 */
import type { PodcastDropCounts, PodcastLanguage, StockPodcastChapter, StockPodcastSource } from "./podcast-types";
import { emptyDropCounts, PODCAST_DISCLAIMER, PODCAST_DISCLAIMER_EN } from "./podcast-types";
import { PODCAST_PLACEHOLDERS, type PodcastFacts, type PodcastMeasures } from "./podcast-facts";
import { chaptersForSource } from "./podcast-script";
import { roundedParts, speakPercent } from "./podcast-speak";

export interface SpeechFact {
  id: string;
  spoken: string;
  source: string;
}

export interface SpeechSheet {
  language: PodcastLanguage;
  facts: SpeechFact[];
  context: string;
}

export interface ChapterVerdict {
  ok: boolean;
  spoken: string;
  reasons: string[];
}

const BARE_PLACEHOLDER = new RegExp(`\\b(?:${PODCAST_PLACEHOLDERS.filter(name => name.includes("_")).join("|")}|crv)\\b`, "i");
const TOKEN_RE = /\[\[([a-z0-9_]+)\]\]/g;

const DE_VERB = /\b(ist|sind|liegt|liegen|hat|haben|bleibt|bleiben|stammt|stammen|beträgt|betragen|steht|stehen|kommt|kommen|gilt|gelten|heißt|heisst|gehört|gehören|wird|werden|war|waren|zeigt|zeigen|hält|halten|bezieht|beziehen|fasst|fassen|spricht|sprechen|trägt|tragen|nennt|nennen|genannt|angekündigt|gemeldet|wurde|wurden)\b/i;
const EN_VERB = /\b(is|are|stands|stand|has|have|comes|come|remains|remain|was|were|shows|show|holds|hold|dates|date|refers|refer|stays|stay|look|looks|accounts|account|sums|sum)\b/i;
const DE_MARKER = /\b(der|die|das|den|dem|und|ist|liegt|bei|für|im|ein|eine|nicht|sind|bleibt|steht|stammt)\b/i;
const EN_MARKER = /\b(the|and|of|to|for|with|from|this|that|is|are|stands|stay|stays)\b/i;
const DE_LEAK = /\b(der|die|das|den|dem|und|liegt|liegen|nicht|für|eine|einer|ist|sind|geschäftsjahr|prozent|anlageberatung|heute|gestern|beträgt|steht|stammt|faktenblatt|angabe|jüngste)\b/i;

const DE_HOST = new Set(`damit ist der die das den dem des ein eine einer und für diesen diesem diese dieser belegte belegten kurs stand einstieg umsatzbild bewertung katalysator meldung einordnung fenster fensters datum gebunden bleibt bleiben genannt wir sprechen heute über steht bei bezieht sich auf größte größten segment anteil aufteilung umsatzwachstum geschäftsjahr beträgt jahreswert faire wert liegt stammt aus rechnerische chance-risiko-verhältnis genannten risiken risiko potenzial trägt jüngste innerhalb betrachteten zuletzt gemeldet wurde nächste earnings call angekündigt quelle lauf angabe faktenblatt werte stammen ausschließlich geschätzt werden ampel fasst zusammen einschätzung marktwert vollständig gegenseite these kapitel bleibt an die zahlen dollar prozent quartal komma`.split(/\s+/));

const EN_HOST = new Set(`that is the verified figure for this chapter and it stays tied to source we look at today price stands figures refer stay date revenue growth fiscal year annual largest segment accounts split fair value comes valuation chance-risk ratio catalyst episode risks risk report latest window considered signal sums view next earnings call set period starting point picture`.split(/\s+/));

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty first", "twenty second", "twenty third", "twenty fourth", "twenty fifth", "twenty sixth", "twenty seventh", "twenty eighth", "twenty ninth", "thirtieth", "thirty first"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function speakEnInt(n: number): string {
  const v = Math.trunc(Math.abs(n));
  if (v < 20) return ONES[v] ?? "zero";
  if (v < 100) {
    const ten = Math.floor(v / 10);
    const one = v % 10;
    return one ? `${TENS[ten]} ${ONES[one]}` : (TENS[ten] ?? "zero");
  }
  if (v < 1000) {
    const hundred = Math.floor(v / 100);
    const rest = v % 100;
    const head = `${ONES[hundred]} hundred`;
    return rest ? `${head} ${speakEnInt(rest)}` : head;
  }
  if (v < 1_000_000) {
    const thousand = Math.floor(v / 1000);
    const rest = v % 1000;
    const head = `${speakEnInt(thousand)} thousand`;
    return rest ? `${head} ${speakEnInt(rest)}` : head;
  }
  return "";
}

function speakEnYear(year: number): string {
  if (year >= 2000 && year < 2100) {
    return year === 2000 ? "two thousand" : `two thousand ${speakEnInt(year - 2000)}`;
  }
  return speakEnInt(year);
}

function speakEnNumber(n: number, sig?: number): string | null {
  if (!Number.isFinite(n)) return null;
  const neg = n < 0;
  const abs = Math.abs(n);
  let int = Math.trunc(abs);
  let frac = "";
  if (sig != null) {
    const parts = roundedParts(abs, sig);
    if (!parts) return null;
    int = parts.int;
    frac = parts.frac;
  } else {
    const rounded = Math.round(abs * 10) / 10;
    int = Math.trunc(rounded);
    const tenths = Math.round((rounded - int) * 10);
    frac = tenths ? String(tenths) : "";
  }
  const head = speakEnInt(int);
  if (!head) return null;
  const body = frac ? `${head} point ${frac.split("").map(d => ONES[Number(d)] ?? "").filter(Boolean).join(" ")}` : head;
  return neg ? `negative ${body}` : body;
}

export function speakEnDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const monthName = MONTHS[month - 1];
  const ordinal = ORDINALS[day];
  if (!monthName || !ordinal) return null;
  return `${monthName} ${ordinal}, ${speakEnYear(year)}`;
}

function speakEnQuarter(raw: string | null): string | null {
  if (!raw) return null;
  const fiscal = /Q\s*([1-4])\b(?:\s*(?:FY|GJ)\s*((?:19|20)\d{2}))?/i.exec(raw);
  if (!fiscal) return null;
  const q = ["", "one", "two", "three", "four"][Number(fiscal[1])] ?? "";
  if (!q) return null;
  if (fiscal[2]) return `quarter ${q} of fiscal year ${speakEnYear(Number(fiscal[2]))}`;
  return `quarter ${q}`;
}

function speakEnAge(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (Math.trunc(days) === 1) return "yesterday";
  return `${speakEnInt(Math.trunc(days))} days ago`;
}

function speakEnAmpel(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase();
  if (key === "GRÜN" || key === "GRUEN" || key === "GREEN") return "green";
  if (key === "GELB" || key === "YELLOW") return "yellow";
  if (key === "ROT" || key === "RED") return "red";
  if (key === "NEUTRAL") return "neutral";
  if (DE_LEAK.test(raw) || /\d/.test(raw)) return null;
  return raw.trim();
}

function enMoney(n: number | null | undefined, sig: number): string | null {
  if (n == null) return null;
  const words = speakEnNumber(n, sig);
  return words ? `${words} dollars` : null;
}

function enPercent(n: number | null | undefined): string | null {
  if (n == null) return null;
  const words = speakEnNumber(n);
  return words ? `${words} percent` : null;
}

function modelContext(raw: string): string {
  return raw.split("\n").map(line => line.trim()).filter(line => {
    if (!line) return false;
    if (/\d|[{}_]/.test(line)) return false;
    if (/[a-z][A-Za-z0-9]*[A-Z]/.test(line)) return false;
    return true;
  }).join("\n");
}

function cleanSpoken(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!text || /\d/.test(text)) return null;
  return text;
}

function addFact(out: SpeechFact[], id: string, spoken: string | null, source: string): void {
  const clean = cleanSpoken(spoken);
  if (!clean) return;
  out.push({ id, spoken: clean, source });
}

function crvSentence(spoken: string | null, language: PodcastLanguage): string | null {
  if (!spoken) return null;
  if (language === "de") return `Das Chance-Risiko-Verhältnis liegt bei ${spoken}.`;
  return `The chance-risk ratio stands at ${spoken}.`;
}

export function buildSpeechSheet(facts: PodcastFacts, language: PodcastLanguage): SpeechSheet {
  const values = facts.values;
  const measures: PodcastMeasures | undefined = facts.measures;
  const out: SpeechFact[] = [];
  const companySource = measures?.companySource ?? (values.company ? "analysis.companyName" : "missing");
  addFact(out, "company", values.company, companySource);
  if (language === "de") {
    addFact(out, "price", values.price, "analysis.currentPrice");
    addFact(out, "as_of", values.as_of, "analysis.dataTimestamp");
    addFact(out, "ampel", values.ampel, "analysis.s17Verdict");
    addFact(out, "fy_yoy", values.fy_yoy, "analysis.revenueGrowth");
    addFact(out, "gj_year", values.gj_year, "analysis.fiscalYear");
    addFact(out, "top_segment", values.top_segment, "analysis.revenueSegments");
    addFact(out, "top_segment_share", values.top_segment_share, "analysis.revenueSegments");
    addFact(out, "dcf_fair", values.dcf_fair, "analysis.dcfConservative");
    addFact(out, "entry", values.entry, "analysis.maxEntryCrv3");
    addFact(out, "crv", crvSentence(values.crv, "de"), "analysis.crv");
    addFact(out, "wacc", values.wacc, "analysis.wacc");
    addFact(out, "g_star", values.g_star, "analysis.gStar");
    addFact(out, "news_age", values.news_age, "analysis.newsItems");
    addFact(out, "call_date", values.call_date, "analysis.nextEarningsDate");
    addFact(out, "call_quarter", values.call_quarter, "analysis.lastReportedQuarter");
  } else {
    const sig = measures?.sig ?? 3;
    addFact(out, "price", enMoney(measures?.price, sig), "analysis.currentPrice");
    addFact(out, "as_of", measures ? speakEnDate(measures.asOfIso) : null, "analysis.dataTimestamp");
    addFact(out, "ampel", speakEnAmpel(measures?.ampel ?? values.ampel), "analysis.s17Verdict");
    addFact(out, "fy_yoy", enPercent(measures?.fyYoy), "analysis.revenueGrowth");
    addFact(out, "gj_year", measures?.fiscalYear != null ? speakEnYear(measures.fiscalYear) : null, "analysis.fiscalYear");
    addFact(out, "top_segment", measures?.segmentName ?? null, "analysis.revenueSegments");
    addFact(out, "top_segment_share", enPercent(measures?.segmentShare), "analysis.revenueSegments");
    addFact(out, "dcf_fair", enMoney(measures?.fair, sig), "analysis.dcfConservative");
    addFact(out, "entry", enMoney(measures?.entry, sig), "analysis.maxEntryCrv3");
    addFact(out, "crv", crvSentence(measures?.crv != null ? speakEnNumber(measures.crv, 3) : null, "en"), "analysis.crv");
    addFact(out, "wacc", enPercent(measures?.wacc), "analysis.wacc");
    addFact(out, "g_star", enPercent(measures?.gStar), "analysis.gStar");
    addFact(out, "news_age", measures?.newsAgeDays != null ? speakEnAge(measures.newsAgeDays) : null, "analysis.newsItems");
    addFact(out, "call_date", measures?.callDateIso ? speakEnDate(measures.callDateIso) : null, "analysis.nextEarningsDate");
    addFact(out, "call_quarter", speakEnQuarter(measures?.callQuarterRaw ?? null), "analysis.lastReportedQuarter");
  }
  const names = measures?.catalystNames ?? facts.upsideNames;
  const slot = ["a", "b", "c"];
  const upsides = measures?.upsides ?? [];
  upsides.forEach((row, index) => {
    const key = slot[index];
    if (!key) return;
    const pct = language === "de" ? speakPercent(row.upside) : enPercent(row.upside);
    addFact(out, `upside_${key}`, pct, "analysis.catalysts");
    addFact(out, `catalyst_${key}`, row.name, "analysis.catalysts");
  });
  if (!upsides.length) {
    names.slice(0, 3).forEach((name, index) => {
      const key = slot[index];
      if (key) addFact(out, `catalyst_${key}`, name, "analysis.catalysts");
    });
  }
  (measures?.riskNames ?? facts.riskNames).slice(0, 3).forEach((name, index) => {
    const key = slot[index];
    if (key) addFact(out, `risk_${key}`, name, "analysis.risks");
  });
  const thesis = thesisFact(facts, language);
  if (thesis) out.push(thesis);
  return {
    language,
    facts: out,
    context: modelContext(facts.redactedContext),
  };
}

function thesisFact(facts: PodcastFacts, language: PodcastLanguage): SpeechFact | null {
  const text = facts.thesisText?.trim() ?? "";
  if (!text || /\d/.test(text)) return null;
  const spoken = /[.!?]$/.test(text) ? text : `${text}.`;
  const words = spoken.split(/\s+/).filter(Boolean);
  if (words.length < 8) return null;
  if (!verbsOk(spoken, language)) return null;
  if (language === "de" && !DE_MARKER.test(spoken)) return null;
  if (language === "en" && DE_LEAK.test(spoken)) return null;
  return { id: "thesis", spoken, source: "analysis.growthThesis" };
}

const CHAPTER_FACT_IDS: Record<string, string[]> = {
  einstieg: ["company", "price", "as_of"],
  zusammenfassung: ["company", "ampel"],
  these: ["thesis"],
  umsatz: ["fy_yoy", "gj_year", "top_segment", "top_segment_share"],
  dcf: ["dcf_fair", "entry", "crv", "wacc", "g_star"],
  s17: ["catalyst_a", "catalyst_b", "catalyst_c", "upside_a", "upside_b", "upside_c"],
  inversion: ["entry", "risk_a", "risk_b", "risk_c"],
  earnings: ["call_quarter", "call_date"],
  news: ["news_age"],
  "news-llm": ["news_age"],
};

export function factsForChapter(sheet: SpeechSheet, chapterId: string): SpeechFact[] {
  const ids = new Set(CHAPTER_FACT_IDS[chapterId] ?? []);
  return sheet.facts.filter(fact => ids.has(fact.id));
}

function factById(facts: SpeechFact[], id: string): SpeechFact | undefined {
  return facts.find(fact => fact.id === id);
}

export function podcastSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
}

export function fluencyStats(text: string): { sentences: number; avg: number; short: number } {
  const sentences = podcastSentences(text);
  const counts = sentences.map(sentence => sentence.split(/\s+/).filter(Boolean).length);
  const avg = counts.reduce((sum, n) => sum + n, 0) / (counts.length || 1);
  return { sentences: sentences.length, avg, short: counts.filter(n => n < 4).length };
}

function verbsOk(text: string, language: PodcastLanguage): boolean {
  const pattern = language === "de" ? DE_VERB : EN_VERB;
  return podcastSentences(text).every(sentence => pattern.test(sentence));
}

function maskFacts(text: string, facts: SpeechFact[]): string {
  const names = facts.map(fact => fact.spoken).filter(spoken => spoken.length > 1).sort((a, b) => b.length - a.length);
  let out = text;
  for (const spoken of names) out = out.split(spoken).join(" ");
  return out;
}

function languageOk(text: string, language: PodcastLanguage, facts: SpeechFact[]): boolean {
  const masked = maskFacts(text, facts);
  if (language === "de") {
    const german = masked.match(new RegExp(DE_MARKER, "gi"))?.length ?? 0;
    const english = masked.match(new RegExp(EN_MARKER, "gi"))?.length ?? 0;
    return german > 0 && german >= english;
  }
  if (language === "en") return !DE_LEAK.test(masked);
  const _never: never = language;
  return _never;
}

function allowedWords(sheet: SpeechSheet, facts: SpeechFact[]): Set<string> {
  const host = sheet.language === "de" ? DE_HOST : EN_HOST;
  const allowed = new Set(host);
  const blob = `${facts.map(fact => fact.spoken).join(" ")} ${sheet.context}`;
  for (const word of blob.split(/[^A-Za-zÄÖÜäöüß0-9/+-]+/)) {
    if (word) allowed.add(word.toLowerCase());
  }
  return allowed;
}

function unknownName(text: string, sheet: SpeechSheet, facts: SpeechFact[]): boolean {
  const allowed = allowedWords(sheet, facts);
  for (const sentence of podcastSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      const clean = (words[i] ?? "").replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+$/g, "");
      if (!clean || !/^[A-ZÄÖÜ]/.test(clean)) continue;
      if (!allowed.has(clean.toLowerCase())) return true;
    }
  }
  return false;
}

export function applyFactTokens(text: string, facts: SpeechFact[]): string {
  return text.replace(TOKEN_RE, (all, id: string) => facts.find(fact => fact.id === id)?.spoken ?? all);
}

export function verifyChapter(chapterId: string, raw: string, sheet: SpeechSheet): ChapterVerdict {
  const facts = factsForChapter(sheet, chapterId);
  const spoken = applyFactTokens(raw, sheet.facts).replace(/\s+/g, " ").trim();
  const reasons: string[] = [];
  if (!spoken) reasons.push("empty");
  if (/\d/.test(spoken)) reasons.push("digit");
  if (/\[\[[a-z0-9_]+\]\]|\{[a-z0-9_]+\}/.test(spoken) || BARE_PLACEHOLDER.test(spoken)) reasons.push("placeholder");
  if (/\blieg(?:t|en)\s+nicht\s+vor\b/i.test(spoken)) reasons.push("absent");
  if (/\bYTD\b|seit Jahresbeginn/i.test(spoken)) reasons.push("ytd");
  if (/^\s*[-•]/m.test(raw)) reasons.push("list");
  const crv = factById(facts, "crv");
  if (crv && !spoken.includes(crv.spoken)) reasons.push("crv");
  if (spoken && !languageOk(spoken, sheet.language, facts)) reasons.push("language");
  if (spoken && unknownName(spoken, sheet, facts)) reasons.push("name");
  const flu = fluencyStats(spoken);
  if (!spoken || flu.sentences < 2 || flu.short > 0 || flu.avg < 8 || !verbsOk(spoken, sheet.language)) reasons.push("fragment");
  const naked = podcastSentences(spoken).some(sentence => {
    const bare = sentence.replace(/[.!?]+$/g, "").trim();
    return facts.some(fact => fact.spoken.replace(/[.!?]+$/g, "").trim() === bare && fact.spoken.split(/\s+/).length < 6);
  });
  if (naked) reasons.push("fragment");
  return { ok: reasons.length === 0, spoken, reasons };
}

function period(text: string): string {
  const clean = text.trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function ensureFluent(parts: string[], closer: string): string {
  const body = parts.map(period).filter(Boolean);
  let text = body.join(" ");
  const stats = fluencyStats(text);
  if (body.length < 2 || stats.avg < 8 || stats.short > 0) text = `${text} ${period(closer)}`.trim();
  return text;
}

function closerFor(chapterId: string, language: PodcastLanguage): string {
  if (language === "en") {
    switch (chapterId) {
      case "einstieg":
        return "That is the verified starting point for this chapter and it stays tied to the source.";
      case "umsatz":
        return "That is the verified revenue picture for this chapter and it stays tied to the source.";
      case "dcf":
        return "That is the verified valuation for this chapter and it stays tied to the source.";
      case "s17":
        return "That is the verified catalyst for this chapter and it stays tied to the source.";
      case "inversion":
        return "That is the verified risk picture for this chapter and it stays tied to the source.";
      case "earnings":
        return "That is the verified call for this chapter and it stays tied to the source.";
      case "news":
      case "news-llm":
        return "That is the verified report for this chapter and it stays tied to the source.";
      case "zusammenfassung":
        return "That is the verified view for this chapter and it stays tied to the source.";
      case "these":
        return "That is the verified thesis for this chapter and it stays tied to the source.";
      default:
        return "That is the verified figure for this chapter and it stays tied to the source.";
    }
  }
  switch (chapterId) {
    case "einstieg":
      return "Damit ist der belegte Kurs für diesen Einstieg genannt und bleibt an die Quelle gebunden.";
    case "umsatz":
      return "Damit ist das belegte Umsatzbild für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "dcf":
      return "Damit ist die belegte Bewertung für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "s17":
      return "Damit ist der belegte Katalysator für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "inversion":
      return "Damit ist die belegte Gegenseite für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "earnings":
      return "Damit ist der belegte Call für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "news":
    case "news-llm":
      return "Damit ist die belegte Meldung für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "zusammenfassung":
      return "Damit ist die belegte Einordnung für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    case "these":
      return "Damit ist die belegte These für diesen Lauf genannt und bleibt an die Quelle gebunden.";
    default:
      return "Damit ist die belegte Angabe für diesen Lauf genannt und bleibt an die Quelle gebunden.";
  }
}

export function fallbackParagraph(chapterId: string, sheet: SpeechSheet): string {
  const facts = factsForChapter(sheet, chapterId);
  const take = (id: string) => factById(facts, id)?.spoken ?? null;
  const parts: string[] = [];
  if (sheet.language === "en") {
    if (chapterId === "einstieg") {
      const company = take("company");
      const price = take("price");
      const asOf = take("as_of");
      if (company && price) parts.push(`We look at ${company} today and the price stands at ${price}`);
      else if (price) parts.push(`The price stands at ${price} and is the verified market value in this opening`);
      if (asOf) parts.push(`The figures refer to ${asOf} and stay tied to that date`);
    } else if (chapterId === "zusammenfassung") {
      const ampel = take("ampel");
      const company = take("company");
      if (ampel && company) parts.push(`The signal for ${company} stands at ${ampel} and sums up the verified view`);
      else if (ampel) parts.push(`The signal stands at ${ampel} and sums up the verified view`);
    } else if (chapterId === "these") {
      const thesis = take("thesis");
      if (thesis) parts.push(thesis);
    } else if (chapterId === "umsatz") {
      const growth = take("fy_yoy");
      const year = take("gj_year");
      const segment = take("top_segment");
      const share = take("top_segment_share");
      if (growth && year) parts.push(`Revenue growth in fiscal year ${year} is ${growth} and is the verified annual figure`);
      else if (growth) parts.push(`Revenue growth is ${growth} and is the verified annual figure`);
      if (segment && share) parts.push(`The largest segment ${segment} accounts for ${share} and stays the verified split`);
    } else if (chapterId === "dcf") {
      const fair = take("dcf_fair");
      const entry = take("entry");
      const crv = take("crv");
      if (fair) parts.push(`The fair value stands at ${fair} and comes from the verified valuation`);
      if (entry) parts.push(`The calculated entry stands at ${entry} and stays tied to that source`);
      if (crv) parts.push(crv);
    } else if (chapterId === "s17") {
      const name = take("catalyst_a");
      const upside = take("upside_a");
      if (name && upside) parts.push(`The verified catalyst ${name} carries a potential of ${upside} and stays tied to that source`);
      else if (name) parts.push(`The verified catalyst in this episode is ${name} and stays tied to that source`);
    } else if (chapterId === "inversion") {
      const risks = ["risk_a", "risk_b", "risk_c"].map(take).filter((name): name is string => !!name);
      const entry = take("entry");
      if (risks.length) parts.push(`The verified risks are ${risks.join(", ")} and stay tied to that source`);
      if (entry) parts.push(`The calculated entry stands at ${entry} and stays tied to that source`);
    } else if (chapterId === "earnings") {
      const quarter = take("call_quarter");
      const date = take("call_date");
      if (quarter) parts.push(`The latest reported period is ${quarter} and stays tied to that source`);
      if (date) parts.push(`The next earnings call is set for ${date} and stays tied to that source`);
    } else if (chapterId === "news" || chapterId === "news-llm") {
      const age = take("news_age");
      if (age) parts.push(`The latest report dates from ${age} and stays inside the window we considered`);
    }
  } else {
    if (chapterId === "einstieg") {
      const company = take("company");
      const price = take("price");
      const asOf = take("as_of");
      if (company && price) parts.push(`Wir sprechen heute über ${company}, und der Kurs steht bei ${price}`);
      else if (price) parts.push(`Der Kurs steht bei ${price} und ist der belegte Marktwert in diesem Einstieg`);
      if (asOf) parts.push(`Der Stand bezieht sich auf den ${asOf} und bleibt an dieses Datum gebunden`);
    } else if (chapterId === "zusammenfassung") {
      const ampel = take("ampel");
      const company = take("company");
      if (ampel && company) parts.push(`Die Ampel für ${company} steht auf ${ampel} und fasst die belegte Einschätzung zusammen`);
      else if (ampel) parts.push(`Die Ampel steht auf ${ampel} und fasst die belegte Einschätzung zusammen`);
    } else if (chapterId === "these") {
      const thesis = take("thesis");
      if (thesis) parts.push(thesis);
    } else if (chapterId === "umsatz") {
      const growth = take("fy_yoy");
      const year = take("gj_year");
      const segment = take("top_segment");
      const share = take("top_segment_share");
      if (growth && year) parts.push(`Das Umsatzwachstum im Geschäftsjahr ${year} beträgt ${growth} und ist der belegte Jahreswert`);
      else if (growth) parts.push(`Das Umsatzwachstum beträgt ${growth} und ist der belegte Jahreswert`);
      if (segment && share) parts.push(`Das größte Segment ${segment} hat einen Anteil von ${share} und bleibt die belegte Aufteilung`);
    } else if (chapterId === "dcf") {
      const fair = take("dcf_fair");
      const entry = take("entry");
      const crv = take("crv");
      if (fair) parts.push(`Der faire Wert liegt bei ${fair} und stammt aus der belegten Bewertung`);
      if (entry) parts.push(`Der rechnerische Einstieg liegt bei ${entry} und bleibt an diese Quelle gebunden`);
      if (crv) parts.push(crv);
    } else if (chapterId === "s17") {
      const name = take("catalyst_a");
      const upside = take("upside_a");
      if (name && upside) parts.push(`Der belegte Katalysator ${name} trägt ein Potenzial von ${upside} und bleibt an diese Quelle gebunden`);
      else if (name) parts.push(`Der belegte Katalysator in diesem Lauf ist ${name} und bleibt an diese Quelle gebunden`);
    } else if (chapterId === "inversion") {
      const risks = ["risk_a", "risk_b", "risk_c"].map(take).filter((name): name is string => !!name);
      const entry = take("entry");
      if (risks.length === 1) parts.push(`Das genannte Risiko ist ${risks[0]} und bleibt an diese Quelle gebunden`);
      else if (risks.length) parts.push(`Die genannten Risiken sind ${risks.join(" und ")} und bleiben an diese Quelle gebunden`);
      if (entry) parts.push(`Der rechnerische Einstieg liegt bei ${entry} und bleibt an diese Quelle gebunden`);
    } else if (chapterId === "earnings") {
      const quarter = take("call_quarter");
      const date = take("call_date");
      if (quarter) parts.push(`Zuletzt gemeldet wurde das ${quarter} und diese Einordnung bleibt an die Quelle gebunden`);
      if (date) parts.push(`Der nächste Earnings Call ist für den ${date} angekündigt und bleibt an diese Quelle gebunden`);
    } else if (chapterId === "news" || chapterId === "news-llm") {
      const age = take("news_age");
      if (age) parts.push(`Die jüngste Meldung stammt von ${age} und bleibt innerhalb des betrachteten Fensters`);
    }
  }
  if (!parts.length) return "";
  return ensureFluent(parts, closerFor(chapterId, sheet.language));
}

function schlussParagraph(language: PodcastLanguage): string {
  if (language === "en") {
    return `${PODCAST_DISCLAIMER_EN} The figures in this episode come from the verified fact sheet and are not estimates.`;
  }
  return `${PODCAST_DISCLAIMER} Die genannten Werte stammen ausschließlich aus dem belegten Faktenblatt und werden hier nicht geschätzt.`;
}

const HUMAN_DE: Record<string, string> = {
  company: "Firmenname", price: "Kurs", as_of: "Stand", ampel: "Ampel", fy_yoy: "Umsatzwachstum",
  gj_year: "Geschäftsjahr", top_segment: "Segment", top_segment_share: "Segmentanteil",
  dcf_fair: "fairer Wert", entry: "Einstieg", crv: "Chance-Risiko-Verhältnis", wacc: "Kapitalkosten",
  g_star: "Wachstum", news_age: "Meldungsalter", call_date: "Call-Termin", call_quarter: "Quartal",
  catalyst_a: "Katalysator", catalyst_b: "Katalysator", catalyst_c: "Katalysator",
  upside_a: "Potenzial", upside_b: "Potenzial", upside_c: "Potenzial",
  risk_a: "Risiko", risk_b: "Risiko", risk_c: "Risiko", thesis: "These",
};

const HUMAN_EN: Record<string, string> = {
  company: "company name", price: "share price", as_of: "as of date", ampel: "signal",
  fy_yoy: "revenue growth", gj_year: "fiscal year", top_segment: "segment",
  top_segment_share: "segment share", dcf_fair: "fair value", entry: "entry",
  crv: "chance-risk ratio", wacc: "cost of capital", g_star: "growth", news_age: "report age",
  call_date: "call date", call_quarter: "quarter",   catalyst_a: "catalyst", catalyst_b: "catalyst",
  catalyst_c: "catalyst", upside_a: "potential", upside_b: "potential", upside_c: "potential",
  risk_a: "risk", risk_b: "risk", risk_c: "risk", thesis: "thesis",
};

export function fluentPrompt(
  sheet: SpeechSheet,
  source: StockPodcastSource,
  redo?: Array<{ id: string; reasons: string[] }>,
): { prompt: string; systemPrompt: string } {
  const chapters = chaptersForSource(source).filter(def => def.id !== "schluss" && factsForChapter(sheet, def.id).length > 0);
  const wanted = redo?.length ? chapters.filter(def => redo.some(row => row.id === def.id)) : chapters;
  const lines = sheet.facts.map(fact => {
    const label = (sheet.language === "en" ? HUMAN_EN : HUMAN_DE)[fact.id] ?? "Angabe";
    return `[[${fact.id}]] = ${fact.spoken} (${label})`;
  });
  const redoLine = redo?.length
    ? redo.map(row => `${row.id}: ${row.reasons.join(", ")}`).join("\n")
    : "";
  const systemPrompt = sheet.language === "en"
    ? "You write one connected paragraph per chapter, in whole sentences, the way a host speaks. Leave every [[id]] token unchanged. Do not invent a number, a name, or a date. No lists, no one-word sentence, no sentence under four words. If a fact is absent, do not mention it. Do not say that something is missing. Reply as JSON {\"chapters\":[{\"id\":\"...\",\"paragraph\":\"...\"}]}"
    : "Du schreibst je Kapitel einen zusammenhängenden Absatz aus ganzen Sätzen, wie ein Moderator. Du lässt jedes Token [[id]] unverändert. Du erfindest keine Zahl, keinen Namen und kein Datum. Keine Aufzählung, kein Ein-Wort-Satz, kein Satz unter vier Wörtern. Was nicht als Fakt dasteht, erwähnst du nicht. Du sagst nicht, dass etwas fehlt. Antworte als JSON {\"chapters\":[{\"id\":\"...\",\"paragraph\":\"...\"}]}";
  const prompt = [
    sheet.language === "en" ? "Write English." : "Schreibe Deutsch.",
    `Quelle des Laufs: ${source}.`,
    "FAKTENBLATT",
    lines.join("\n"),
    "KONTEXT",
    sheet.context || (sheet.language === "en" ? "No further context." : "Kein weiterer Kontext."),
    "KAPITEL",
    wanted.map(def => def.id).join(", "),
    redoLine ? `NEU SCHREIBEN\n${redoLine}` : "",
    sheet.language === "en"
      ? "Use the tokens in whole sentences. The chance-risk token, when listed, must appear as its own sentence."
      : "Setze die Token in ganze Sätze. Das Chance-Risiko-Token steht, wenn es gelistet ist, als eigener Satz.",
  ].filter(Boolean).join("\n");
  return { prompt, systemPrompt };
}

export function readParagraphs(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const chapters = data && typeof data === "object" && Array.isArray((data as { chapters?: unknown }).chapters)
    ? (data as { chapters: unknown[] }).chapters
    : [];
  for (const row of chapters) {
    if (!row || typeof row !== "object") continue;
    const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : "";
    const paragraph = typeof (row as { paragraph?: unknown }).paragraph === "string"
      ? (row as { paragraph: string }).paragraph
      : "";
    const sentences = Array.isArray((row as { sentences?: unknown }).sentences)
      ? (row as { sentences: unknown[] }).sentences.filter((item): item is string => typeof item === "string")
      : [];
    const text = (paragraph || sentences.join(" ")).trim();
    if (id && text) out.set(id, text);
  }
  return out;
}

function chapterShell(def: { id: string; title: string; llmOwned: boolean }, spoken: string, llmOwned: boolean): StockPodcastChapter {
  const words = spoken.split(/\s+/).filter(Boolean).length;
  return {
    id: def.id,
    title: def.title,
    label: def.title,
    template: spoken,
    spoken,
    durationSec: Math.max(8, Math.round(words / 2.4)),
    llmOwned,
    audioUrl: null,
  };
}

export interface FluentDraft {
  id: string;
  attempts: number;
  reasons: string[];
  spoken: string;
}

export function seedDrafts(sheet: SpeechSheet, source: StockPodcastSource, modelData: unknown): FluentDraft[] {
  const found = readParagraphs(modelData);
  const drafts: FluentDraft[] = [];
  for (const def of chaptersForSource(source)) {
    if (def.id === "schluss") continue;
    if (!factsForChapter(sheet, def.id).length) continue;
    const raw = found.get(def.id) ?? "";
    if (!raw) {
      drafts.push({ id: def.id, attempts: 1, reasons: ["empty"], spoken: "" });
      continue;
    }
    const verdict = verifyChapter(def.id, raw, sheet);
    drafts.push({
      id: def.id,
      attempts: 1,
      reasons: verdict.ok ? [] : verdict.reasons,
      spoken: verdict.ok ? verdict.spoken : raw,
    });
  }
  return drafts;
}

export function applyRedo(sheet: SpeechSheet, drafts: FluentDraft[], modelData: unknown): FluentDraft[] {
  const found = readParagraphs(modelData);
  return drafts.map(draft => {
    if (!draft.reasons.length || draft.reasons[0] === "empty" || draft.reasons[0] === "timeout") return draft;
    const raw = found.get(draft.id) ?? "";
    if (!raw) return { ...draft, attempts: draft.attempts + 1, reasons: ["empty"], spoken: "" };
    const verdict = verifyChapter(draft.id, raw, sheet);
    return {
      id: draft.id,
      attempts: draft.attempts + 1,
      reasons: verdict.ok ? [] : verdict.reasons,
      spoken: verdict.ok ? verdict.spoken : raw,
    };
  });
}

export function chaptersFromDrafts(sheet: SpeechSheet, source: StockPodcastSource, drafts: FluentDraft[]): {
  chapters: StockPodcastChapter[];
  dropped: PodcastDropCounts;
  reports: Array<{ id: string; attempts: number; fallback: string | null }>;
} {
  const dropped = emptyDropCounts();
  const reports: Array<{ id: string; attempts: number; fallback: string | null }> = [];
  const chapters: StockPodcastChapter[] = [];
  for (const def of chaptersForSource(source)) {
    if (def.id === "schluss") {
      const spoken = schlussParagraph(sheet.language);
      chapters.push(chapterShell(def, spoken, false));
      reports.push({ id: def.id, attempts: 1, fallback: null });
      continue;
    }
    const draft = drafts.find(row => row.id === def.id);
    if (!draft) continue;
    if (!draft.reasons.length) {
      chapters.push(chapterShell(def, draft.spoken, true));
      reports.push({ id: def.id, attempts: draft.attempts, fallback: null });
      continue;
    }
    const spoken = fallbackParagraph(def.id, sheet);
    if (!spoken) continue;
    const reason = draft.reasons[0] ?? "verifier";
    dropped.total += 1;
    dropped.byReason[reason] = (dropped.byReason[reason] ?? 0) + 1;
    chapters.push(chapterShell(def, spoken, false));
    reports.push({ id: def.id, attempts: draft.attempts, fallback: reason });
  }
  return { chapters, dropped, reports };
}

export function brokenDrafts(drafts: FluentDraft[]): FluentDraft[] {
  return drafts.filter(draft => draft.reasons.length > 0 && draft.reasons[0] !== "empty" && draft.reasons[0] !== "timeout");
}
