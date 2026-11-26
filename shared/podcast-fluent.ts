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

export interface PendingTitle {
  factId: string;
  raw: string;
  prefix: string;
}

export interface SpeechSheet {
  language: PodcastLanguage;
  facts: SpeechFact[];
  context: string;
  /** Titel, die erst nach einer geprüften Übersetzung gesprochen werden. */
  pendingTitles: PendingTitle[];
}

export interface ChapterVerdict {
  ok: boolean;
  spoken: string;
  reasons: string[];
}

const BARE_PLACEHOLDER = new RegExp(`\\b(?:${PODCAST_PLACEHOLDERS.filter(name => name.includes("_")).join("|")}|crv)\\b`, "i");
const TOKEN_RE = /\[\[([a-z0-9_]+)\]\]/g;

const DE_VERB = /\b(ist|sind|liegt|liegen|hat|haben|bleibt|bleiben|stammt|stammen|beträgt|betragen|steht|stehen|kommt|kommen|gilt|gelten|heißt|heisst|gehört|gehören|wird|werden|war|waren|zeigt|zeigen|hält|halten|bezieht|beziehen|fasst|fassen|spricht|sprechen|trägt|tragen|stützt|stützen|wächst|wachsen|nennt|nennen|folgt|folgen|ordnet|ordnen|begrenzt|begrenzen|genannt|angekündigt|gemeldet|wurde|wurden)\b/i;
const EN_VERB = /\b(is|are|stands|stand|has|have|comes|come|remains|remain|was|were|shows|show|holds|hold|dates|date|refers|refer|stays|stay|look|looks|accounts|account|sums|sum|leads|lead|ranks|rank)\b/i;
const DE_MARKER = /\b(der|die|das|den|dem|und|ist|liegt|bei|für|im|ein|eine|nicht|sind|bleibt|steht|stammt)\b/i;
const EN_MARKER = /\b(the|and|of|to|for|with|from|this|that|is|are|stands|stay|stays)\b/i;
const DE_LEAK = /\b(der|die|das|den|dem|und|liegt|liegen|nicht|für|eine|einer|ist|sind|geschäftsjahr|prozent|anlageberatung|heute|gestern|beträgt|steht|stammt|faktenblatt|angabe|jüngste)\b/i;

const DE_LEXICON = new Set(`der die das den dem des ein eine einer einem einen eines eins und oder für von mit auf im in am an bei aus nach vor über unter zwischen ohne als auch noch nur sehr hier dort dann dazu damit dieser diese dieses diesen diesem belegte belegten größten grössten größte grösste jüngste naechste nächste rechnerische faire genannt wir sprechen heute steht bleibt bleiben liegt liegen hat haben ist sind kommt kommen gilt gelten heißt heisst gehört gehören wird werden war waren zeigt zeigen hält halten bezieht beziehen fasst fassen spricht sprechen trägt tragen nennt nennen folgt folgen ordnet ordnen stützt stuetzen stützt wächst waechst begrenzt angekündigt gemeldet wurde wurden danach zuletzt ampel einordnung wert verhältnis komma aktie firma jahr monat januar februar märz maerz april mai juni juli august september oktober november dezember umsatz gewinn marge wachstum kurs bewertung risiko chance katalysator segment markt branche unternehmen gesellschaft anleger nachfrage angebot wettbewerb preis regulierung produktion plattform software zukunft vergleich massstab maßstab hebel rahmen gegenpol spitze liste einschätzung einschaetzung meldung fenster alter stand datum quartal prozent dollar euro potenzial potential anteil aufteilung jahreswert geschäftsjahr geschaeftsjahr einstieg these geschichte hersteller spezialist nachricht bericht periode termin kapitel lauf angabe faktenblatt werte satz absatz überblick ueberblick bild sicht lage trend ausblick ergebnis verlust cashflow rendite dividende bilanz zins kapital kosten ertrag volumen stück kueck kunde käufer kaeufer region land welt europa asien amerika geschäft geschaeft call earnings umsatzwachstum marktwert gegenseite einordnung vollständig vollstaendig zahlen quelle`.split(/\s+/));

const EN_LEXICON = new Set(`the a an we this that these those our their its and of in for from with at to by on as after is are was were has have stands stand stays stay comes come looks look refers refer accounts account sums sum holds hold dates date not today price fair value largest next latest verified catalyst catalysts risk risks report reports signal view thesis opening calculated entry period investment advice figures figure revenue growth fiscal year annual segment share potential demand margin quarter date window source chapter episode company market competition platform data center gaming dollars dollar percent point negative zero picture split chance ratio call earnings`.split(/\s+/));

/** NVIDIA-Segmentnamen, die das Unternehmen selbst englisch führt und die im Deutschen Eigenname bleiben. */
const KEEP_EN_SEGMENT_IN_DE = new Set(["data center", "gaming"]);

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
  const pendingTitles: PendingTitle[] = [];
  const slot = ["a", "b", "c"];
  const ranked = [...(measures?.upsides ?? [])].sort((a, b) => b.upside - a.upside);
  ranked.slice(0, 3).forEach((row, index) => {
    const key = slot[index];
    if (!key) return;
    const pct = language === "de" ? speakPercent(row.upside) : enPercent(row.upside);
    if (!pct) return;
    const prefix = pairPrefix(language, index === 0);
    const title = speakableTitle(row.name, language, pendingTitles, `pair_${key}`, prefix);
    addFact(out, `pair_${key}`, `${title ?? prefix} ${pairTail(language, pct)}`, "analysis.catalysts");
  });
  if (!ranked.length) {
    (measures?.catalystNames ?? facts.upsideNames).slice(0, 3).forEach((name, index) => {
      const key = slot[index];
      if (!key) return;
      const prefix = pairPrefix(language, index === 0);
      const title = speakableTitle(name, language, pendingTitles, `pair_${key}`, prefix);
      addFact(out, `pair_${key}`, title ?? prefix, "analysis.catalysts");
    });
  }
  (measures?.riskNames ?? facts.riskNames).slice(0, 3).forEach((name, index) => {
    const key = slot[index];
    if (!key) return;
    const prefix = language === "de" ? "das genannte Risiko" : "the named risk";
    const title = speakableTitle(name, language, pendingTitles, `risk_${key}`, prefix);
    addFact(out, `risk_${key}`, title ?? prefix, "analysis.risks");
  });
  const segmentPrefix = language === "de" ? "das größte Segment" : "the largest segment";
  const segmentName = measures?.segmentName ?? values.top_segment;
  if (segmentName) {
    const title = speakableTitle(segmentName, language, pendingTitles, "top_segment", segmentPrefix);
    const existing = out.find(fact => fact.id === "top_segment");
    if (existing) existing.spoken = title ?? segmentPrefix;
    else addFact(out, "top_segment", title ?? segmentPrefix, "analysis.revenueSegments");
  }
  const thesis = thesisFact(facts, language);
  if (thesis) out.push(thesis);
  return {
    language,
    facts: out,
    context: modelContext(facts.redactedContext),
    pendingTitles,
  };
}

function pairPrefix(language: PodcastLanguage, top: boolean): string {
  if (language === "de") return top ? "der größte Katalysator" : "der folgende Katalysator";
  return top ? "the largest catalyst" : "the next catalyst";
}

function pairTail(language: PodcastLanguage, pct: string): string {
  if (language === "de") return `mit einem Potenzial von ${pct}`;
  return `with a potential of ${pct}`;
}

function speakableTitle(
  raw: string,
  language: PodcastLanguage,
  pending: PendingTitle[],
  factId: string,
  prefix: string,
): string | null {
  const title = raw.trim();
  if (!title || /\d/.test(title) || /[-:]$/.test(title)) return null;
  if (language === "de" && KEEP_EN_SEGMENT_IN_DE.has(title.toLowerCase())) return title;
  if (language === "de" && looksEnglishTitle(title)) {
    pending.push({ factId, raw: title, prefix });
    return null;
  }
  if (language === "en" && looksGermanTitle(title)) {
    pending.push({ factId, raw: title, prefix });
    return null;
  }
  return title;
}

const EN_TITLE_WORD = new Set(["data", "center", "safety", "industrial", "segment", "marketplaces", "business", "demand", "growth", "revenue", "expansion", "guidance", "margin"]);

function looksEnglishTitle(title: string): boolean {
  const words = title.toLowerCase().split(/[^a-z]+/).filter(word => word.length > 2);
  if (!words.length) return false;
  const hits = words.filter(word => EN_LEXICON.has(word) || EN_TITLE_WORD.has(word)).length;
  if (hits === 0) return false;
  if (words.length <= 3) return true;
  return hits >= 2;
}

function looksGermanTitle(title: string): boolean {
  if (/[äöüß]/i.test(title)) return true;
  const words = title.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  return words.some(word => /(?:ung|keit|heit|plattform|regeln|antrieb|zentren|wettbewerb|durch|automobil|kurs)$/.test(word) || DE_LEXICON.has(word));
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
  s17: ["pair_a", "pair_b", "pair_c"],
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

function allowedWords(sheet: SpeechSheet): Set<string> {
  const host = sheet.language === "de" ? DE_LEXICON : EN_LEXICON;
  const allowed = new Set(host);
  const blob = `${sheet.facts.map(fact => fact.spoken).join(" ")} ${sheet.context}`;
  for (const word of blob.split(/[^A-Za-zÄÖÜäöüß0-9/+-]+/)) {
    if (word) allowed.add(word.toLowerCase());
  }
  return allowed;
}

function wordAllowed(word: string, allowed: Set<string>, language: PodcastLanguage): boolean {
  const clean = word.toLowerCase();
  if (!clean) return true;
  if (allowed.has(clean)) return true;
  const parts = clean.split("-").filter(Boolean);
  if (parts.length > 1 && parts.every(part => allowed.has(part))) return true;
  if (language === "de" && clean.length >= 8) {
    for (let i = 4; i <= clean.length - 3; i++) {
      const left = clean.slice(0, i);
      const right = clean.slice(i).replace(/^s/, "");
      if (allowed.has(left) && right.length >= 3 && allowed.has(right)) return true;
    }
  }
  return false;
}

function unknownName(text: string, sheet: SpeechSheet): boolean {
  const allowed = allowedWords(sheet);
  for (const sentence of podcastSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const clean = (words[i] ?? "").replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+$/g, "");
      if (!clean || !/^[A-ZÄÖÜ]/.test(clean)) continue;
      if (!wordAllowed(clean, allowed, sheet.language)) return true;
    }
  }
  return false;
}

const DE_NUMBER_ATOMS = ["milliarden", "millionen", "milliarde", "million", "tausend", "hundert", "neunzehn", "achtzehn", "siebzehn", "sechzehn", "fünfzehn", "fuenfzehn", "vierzehn", "dreizehn", "zwölf", "zwoelf", "elf", "neunzig", "achtzig", "siebzig", "sechzig", "fünfzig", "fuenfzig", "vierzig", "dreißig", "dreissig", "zwanzig", "zehn", "neun", "acht", "sieben", "sechs", "fünf", "fuenf", "vier", "drei", "zwei", "null"];
const EN_NUMBER = /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|percent)\b/i;

function isGermanQuantity(word: string): boolean {
  const w = word.toLowerCase();
  if (/^(ein|eine|einer|einem|einen|eines|eins)$/.test(w)) return false;
  if (/^(erste[rnms]?|zweite[rnms]?|dritte[rnms]?|vierte[rnms]?)$/.test(w)) return false;
  let rest = w;
  let parts = 0;
  while (rest.length) {
    if (rest.startsWith("und")) {
      rest = rest.slice(3);
      continue;
    }
    if (rest.startsWith("ein") && rest.length > 3) {
      rest = rest.slice(3);
      parts += 1;
      continue;
    }
    const atom = DE_NUMBER_ATOMS.find(item => rest.startsWith(item));
    if (!atom) return false;
    rest = rest.slice(atom.length);
    parts += 1;
  }
  return parts > 0;
}

export function quantityOutsideFacts(text: string, facts: SpeechFact[], language: PodcastLanguage): boolean {
  let masked = text;
  const phrases = facts.map(fact => fact.spoken).filter(spoken => spoken.length > 2).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) masked = masked.split(phrase).join(" ");
  if (language === "en") return EN_NUMBER.test(masked);
  return masked.split(/[^A-Za-zÄÖÜäöüß]+/).filter(Boolean).some(word => isGermanQuantity(word));
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
  if (spoken && unknownName(spoken, sheet)) reasons.push("name");
  if (spoken && quantityOutsideFacts(spoken, sheet.facts, sheet.language)) reasons.push("number");
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

function joinSentences(parts: string[]): string {
  return parts.map(period).filter(Boolean).join(" ");
}

export function fallbackParagraph(chapterId: string, sheet: SpeechSheet): string {
  const facts = factsForChapter(sheet, chapterId);
  const take = (id: string) => factById(facts, id)?.spoken ?? null;
  const parts: string[] = [];
  const de = sheet.language === "de";
  if (chapterId === "einstieg") {
    const company = take("company");
    const price = take("price");
    const asOf = take("as_of");
    if (company && price) parts.push(de ? `Wir sprechen heute über ${company}, und der Kurs steht bei ${price}` : `We look at ${company} today and the price stands at ${price}`);
    else if (price) parts.push(de ? `Der Kurs steht bei ${price} und ist der belegte Marktwert der Aktie` : `The price stands at ${price} and is the verified market value`);
    if (asOf) parts.push(de ? `Der Stand bezieht sich auf den ${asOf}` : `The figures refer to ${asOf}`);
    else if (price) parts.push(de ? "Dieser Kurs ist der belegte Marktwert der Aktie" : "This price is the verified market value of the company");
  } else if (chapterId === "zusammenfassung") {
    const ampel = take("ampel");
    const company = take("company");
    if (ampel && company) parts.push(de ? `Die Ampel für ${company} steht auf ${ampel} und fasst die belegte Einschätzung zusammen` : `The signal for ${company} stands at ${ampel} and sums up the verified view`);
    else if (ampel) parts.push(de ? `Die Ampel steht auf ${ampel} und fasst die belegte Einschätzung zusammen` : `The signal stands at ${ampel} and sums up the verified view`);
    if (ampel) parts.push(de ? "Diese Einschätzung ordnet die Aktie der Firma ein" : "This signal ranks the company in the market");
  } else if (chapterId === "these") {
    const thesis = take("thesis");
    if (thesis) {
      parts.push(thesis);
      parts.push(de ? "Diese These ordnet die Aktie der Firma ein" : "This thesis ranks the company in the market");
    }
  } else if (chapterId === "umsatz") {
    const growth = take("fy_yoy");
    const year = take("gj_year");
    const segment = take("top_segment");
    const share = take("top_segment_share");
    if (growth && year) parts.push(de ? `Das Umsatzwachstum im Geschäftsjahr ${year} beträgt ${growth} und ist der belegte Jahreswert` : `Revenue growth in fiscal year ${year} is ${growth} and is the verified annual figure`);
    else if (growth) parts.push(de ? `Das Umsatzwachstum beträgt ${growth} und ist der belegte Jahreswert` : `Revenue growth is ${growth} and is the verified annual figure`);
    if (segment && share) {
      const named = de ? !/^das größte Segment$/i.test(segment) : !/^the largest segment$/i.test(segment);
      parts.push(de
        ? `${named ? `Das größte Segment ${segment}` : "Das größte Segment"} hat einen Anteil von ${share}`
        : `${named ? `The largest segment ${segment}` : "The largest segment"} accounts for ${share}`);
    } else if (growth) parts.push(de ? "Dieses Wachstum ist der belegte Jahreswert der Firma" : "This growth is the verified annual figure for the company");
  } else if (chapterId === "dcf") {
    const fair = take("dcf_fair");
    const entry = take("entry");
    const crv = take("crv");
    if (fair) parts.push(de ? `Der faire Wert liegt bei ${fair} und stammt aus der belegten Bewertung` : `The fair value stands at ${fair} and comes from the verified valuation`);
    if (entry) parts.push(de ? `Der rechnerische Einstieg liegt bei ${entry}` : `The calculated entry stands at ${entry}`);
    if (crv) parts.push(crv);
    if (parts.length < 2) parts.push(de ? "Diese Bewertung ordnet die Aktie der Firma ein" : "This valuation ranks the company in the market");
  } else if (chapterId === "s17") {
    const first = take("pair_a");
    const second = take("pair_b");
    if (first) parts.push(de ? `An der Spitze steht ${first}` : `At the top stands ${first}`);
    if (second) parts.push(de ? `Danach folgt ${second}` : `After that comes ${second}`);
    else if (first) parts.push(de ? "Dieser Katalysator steht an der Spitze der belegten Liste" : "This catalyst leads the verified list for the company");
  } else if (chapterId === "inversion") {
    const risks = ["risk_a", "risk_b", "risk_c"].map(take).filter((name): name is string => !!name);
    const entry = take("entry");
    if (risks.length) parts.push(de ? `Die Gegenseite nennt ${risks.join(" und ")} und begrenzt die Chance der Firma` : `The risks are ${risks.join(" and ")} and limit the chance of the company`);
    if (entry) parts.push(de ? `Der rechnerische Einstieg liegt bei ${entry}` : `The calculated entry stands at ${entry}`);
    else if (risks.length) parts.push(de ? "Dieses Risiko bleibt der Gegenpol zur belegten Chance" : "This risk limits the verified chance of the company");
  } else if (chapterId === "earnings") {
    const quarter = take("call_quarter");
    const date = take("call_date");
    if (quarter) parts.push(de ? `Zuletzt gemeldet wurde das ${quarter}` : `The latest reported period is ${quarter}`);
    if (date) parts.push(de ? `Der nächste Earnings Call ist für den ${date} angekündigt` : `The next earnings call is set for ${date}`);
    if (parts.length < 2 && parts.length > 0) parts.push(de ? "Dieser Termin ist der belegte Stand des Calls" : "This date is the verified timing of the call");
  } else if (chapterId === "news" || chapterId === "news-llm") {
    const age = take("news_age");
    if (age) {
      parts.push(de ? `Die jüngste Meldung stammt von ${age} und liegt im betrachteten Fenster` : `The latest report dates from ${age} and stays inside the window we considered`);
      parts.push(de ? "Dieses Alter ist der belegte Stand der Meldung" : "This age is the verified timing of the report");
    }
  }
  if (!parts.length) return "";
  return joinSentences(parts);
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
  pair_a: "Katalysator", pair_b: "Katalysator", pair_c: "Katalysator",
  risk_a: "Risiko", risk_b: "Risiko", risk_c: "Risiko", thesis: "These",
};

const HUMAN_EN: Record<string, string> = {
  company: "company name", price: "share price", as_of: "as of date", ampel: "signal",
  fy_yoy: "revenue growth", gj_year: "fiscal year", top_segment: "segment",
  top_segment_share: "segment share", dcf_fair: "fair value", entry: "entry",
  crv: "chance-risk ratio", wacc: "cost of capital", g_star: "growth", news_age: "report age",
  call_date: "call date", call_quarter: "quarter", pair_a: "catalyst", pair_b: "catalyst",
  pair_c: "catalyst", risk_a: "risk", risk_b: "risk", risk_c: "risk", thesis: "thesis",
};

export function titleTranslationOk(raw: string, translated: string, language: PodcastLanguage): boolean {
  const text = translated.trim();
  if (!text || /\d/.test(text) || text.length > 120) return false;
  if (quantityOutsideFacts(text, [], language)) return false;
  if (language === "en" && DE_LEAK.test(text)) return false;
  if (language === "de" && looksEnglishTitle(text) && !KEEP_EN_SEGMENT_IN_DE.has(text.toLowerCase())) return false;
  const known = new Set(raw.split(/[^A-Za-zÄÖÜäöüß]+/).filter(word => /^[A-ZÄÖÜ]/.test(word)).map(word => word.toLowerCase()));
  const lexicon = language === "de" ? DE_LEXICON : EN_LEXICON;
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const clean = (words[i] ?? "").replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+$/g, "");
    if (!clean || !/^[A-ZÄÖÜ]/.test(clean)) continue;
    if (known.has(clean.toLowerCase())) continue;
    if (wordAllowed(clean, lexicon, language)) continue;
    return false;
  }
  return true;
}

export function applyTitleMap(sheet: SpeechSheet, rows: Array<{ raw: string; text: string }>): void {
  for (const pending of sheet.pendingTitles) {
    const row = rows.find(item => item.raw === pending.raw);
    if (!row || !titleTranslationOk(pending.raw, row.text, sheet.language)) continue;
    const fact = sheet.facts.find(item => item.id === pending.factId);
    if (!fact || !fact.spoken.startsWith(pending.prefix)) continue;
    const rest = fact.spoken.slice(pending.prefix.length).trim();
    fact.spoken = rest ? `${row.text.trim()} ${rest}` : row.text.trim();
  }
}

export function readTitleMap(data: unknown): Array<{ raw: string; text: string }> {
  const rows = data && typeof data === "object" && Array.isArray((data as { titles?: unknown }).titles)
    ? (data as { titles: unknown[] }).titles
    : [];
  const out: Array<{ raw: string; text: string }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = typeof (row as { raw?: unknown }).raw === "string" ? (row as { raw: string }).raw : "";
    const text = typeof (row as { text?: unknown }).text === "string" ? (row as { text: string }).text : "";
    if (raw && text) out.push({ raw, text });
  }
  return out;
}

export function titlePrompt(sheet: SpeechSheet): { prompt: string; systemPrompt: string } {
  const lines = sheet.pendingTitles.map(item => item.raw);
  const systemPrompt = sheet.language === "en"
    ? "Translate each title into English. Keep proper names. Add no number and no new name. Reply as JSON {\"titles\":[{\"raw\":\"...\",\"text\":\"...\"}]}"
    : "Übersetze jeden Titel ins Deutsche. Eigennamen bleiben. Keine neue Zahl und kein neuer Name. Antworte als JSON {\"titles\":[{\"raw\":\"...\",\"text\":\"...\"}]}";
  return {
    systemPrompt,
    prompt: lines.join("\n"),
  };
}

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
