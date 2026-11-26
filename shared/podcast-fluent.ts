/**
 * Faktenblatt zuerst, dann ein Absatz je Kapitel.
 * Der Code spricht jede belegte Zahl aus. Das Modell sieht keine Rohzahl und keinen Feldnamen.
 * Ein kaputtes Kapitel wird neu geschrieben. Erst danach setzt der Code einen mehrsätzigen Absatz.
 */
import type { PodcastDropCounts, PodcastLanguage, StockPodcastChapter, StockPodcastSource } from "./podcast-types";
import { emptyDropCounts, PODCAST_DISCLAIMER, PODCAST_DISCLAIMER_EN } from "./podcast-types";
import { DE_CLOSED_LEMMAS, DE_VERB_LEMMAS } from "./de-closed";
import { DE_COMPANY_AMBIGUOUS, DE_COMPANY_NAMES } from "./de-companies";
import { DE_NOUN_LEMMAS } from "./de-nouns";
import { EN_COMMON_WORDS } from "./en-common";
import { countryPhrases, PODCAST_PLACEHOLDERS, type PodcastFacts, type PodcastMeasures } from "./podcast-facts";
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
  /** Sätze, die der Code setzt und die das Modell nicht als Token sieht. */
  codeLines: CodeLine[];
  /** Exakte Treffer: Firma, Peers, geschützte Namen und Namensform aus Titeln. */
  packNames: string[];
  /** Nur Firma, Peers und geschützte Namen. Nur diese haben eine Ein-Zeichen-Distanz. */
  realNames: string[];
  /** Dieselben Quellen als ganze Wendung. Nur exakt, kein Teilwort. */
  realPhrases: string[];
  /** Großwörter aus Risiko- und News-Titeln. Nur innere Ein-Zeichen-Distanz, kein Exakt-Treffer. */
  nearTitleNames: string[];
  /** Länder und Wirtschaftsräume, als ganze Wendung. Die geschlossene Tabelle plus Pack-Orte. */
  placeNames: string[];
}

export interface CodeLine {
  chapterId: string;
  spoken: string;
}

export interface ChapterVerdict {
  ok: boolean;
  spoken: string;
  reasons: string[];
  /** Konkretes Wort und Grund für den nächsten Schreibversuch. */
  notes: string[];
}

const BARE_PLACEHOLDER = new RegExp(`\\b(?:${PODCAST_PLACEHOLDERS.filter(name => name.includes("_")).join("|")}|crv)\\b`, "i");
const TOKEN_RE = /\[\[([a-z0-9_]+)\]\]/g;

const DE_VERB = /\b(ist|sind|liegt|liegen|hat|haben|bleibt|bleiben|stammt|stammen|beträgt|betragen|steht|stehen|kommt|kommen|gilt|gelten|heißt|heisst|gehört|gehören|wird|werden|war|waren|zeigt|zeigen|hält|halten|bezieht|beziehen|fasst|fassen|spricht|sprechen|trägt|tragen|stützt|stützen|wächst|wachsen|nennt|nennen|folgt|folgen|ordnet|ordnen|begrenzt|begrenzen|genannt|angekündigt|gemeldet|wurde|wurden)\b/i;
const EN_VERB = /\b(is|are|stands|stand|has|have|comes|come|remains|remain|was|were|shows|show|holds|hold|dates|date|refers|refer|stays|stay|look|looks|accounts|account|sums|sum|leads|lead|ranks|rank)\b/i;
const DE_MARKER = /\b(der|die|das|den|dem|und|ist|liegt|bei|für|im|ein|eine|nicht|sind|bleibt|steht|stammt|weil|dass|diesen)\b/i;
const EN_MARKER = /\b(the|and|of|to|for|with|from|this|that|is|are|stands|stay|stays)\b/i;
const DE_LEAK = /\b(der|die|das|den|dem|und|liegt|liegen|nicht|für|eine|einer|ist|sind|geschäftsjahr|prozent|anlageberatung|heute|gestern|beträgt|steht|stammt|faktenblatt|angabe|jüngste)\b/i;

const DE_LEXICON = new Set(`der die das den dem des ein eine einer einem einen eines eins und oder für von mit auf im in am an bei beim aus nach vor über unter zwischen ohne als auch noch nur sehr hier dort dann dazu damit dieser diese dieses diesen diesem alles seit gegen daneben vorne zuerst beide beides schaut bewertet spannend belegte belegten größten grössten größte grösste jüngste naechste nächste rechnerische faire genannt wir heute danach zuletzt ampel einordnung wert verhältnis komma aktie firma jahr monat januar februar märz maerz april mai juni juli august september oktober november dezember umsatz gewinn marge wachstum kurs bewertung risiko chance katalysator segment markt branche unternehmen gesellschaft anleger nachfrage angebot wettbewerb preis regulierung produktion plattform software zukunft vergleich massstab maßstab hebel rahmen gegenpol spitze liste einschätzung einschaetzung meldung fenster alter stand datum quartal prozent dollar euro potenzial potential anteil aufteilung jahreswert geschäftsjahr geschaeftsjahr einstieg these geschichte hersteller spezialist nachricht bericht periode termin kapitel lauf angabe faktenblatt werte satz absatz überblick ueberblick bild sicht lage trend ausblick ergebnis verlust cashflow rendite dividende bilanz zins kapital kosten ertrag volumen stück kueck kunde käufer kaeufer region land welt europa asien amerika geschäft geschaeft call earnings umsatzwachstum marktwert gegenseite einordnung vollständig vollstaendig zahlen quelle`.split(/\s+/));

const EN_LEXICON = new Set(`the a an we this that these those our their its and of in for from with at to by on as after not today date price fair value largest next latest verified catalyst catalysts risk risks report reports signal view thesis opening calculated entry period investment advice figures figure revenue growth fiscal year annual segment share potential demand margin quarter date window source chapter episode company market competition platform data center gaming dollars dollar percent point negative zero picture split chance ratio call earnings`.split(/\s+/));

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
  if (v < 1_000_000_000_000) {
    const scale = v >= 1_000_000_000 ? 1_000_000_000 : 1_000_000;
    const unit = scale === 1_000_000_000 ? "billion" : "million";
    const headCount = Math.floor(v / scale);
    const rest = v % scale;
    const head = `${speakEnInt(headCount)} ${unit}`;
    return rest ? `${head} ${speakEnInt(rest)}` : head;
  }
  return `${speakEnInt(Math.floor(v / 1_000_000_000_000))} trillion`;
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
  const parts = roundedParts(Math.abs(n), sig);
  const words = speakEnNumber(n, sig);
  if (!words || !parts) return null;
  return parts.int === 1 && parts.frac === "" ? `${words} dollar` : `${words} dollars`;
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
  if (/^(?:n\/a|n\.a\.|na|-|—)$/i.test(text)) return null;
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
  const peerKeys = ["peer_a", "peer_b", "peer_c"] as const;
  (facts.peerNames ?? []).slice(0, peerKeys.length).forEach((name, index) => {
    const key = peerKeys[index];
    if (key) addFact(out, key, name, "analysis.peerComparison");
  });
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
    addFact(out, "wacc", values.wacc, "analysis.wacc");
    addFact(out, "g_star", values.g_star, "analysis.gStar");
    addFact(out, "news_age", nakedAge(values.news_age, "de"), "analysis.newsItems");
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
    addFact(out, "wacc", enPercent(measures?.wacc), "analysis.wacc");
    addFact(out, "g_star", enPercent(measures?.gStar), "analysis.gStar");
    addFact(out, "news_age", measures?.newsAgeDays != null ? nakedAge(speakEnAge(measures.newsAgeDays), "en") : null, "analysis.newsItems");
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
    const prefix = riskPrefix(language, index);
    const title = speakableTitle(name, language, pendingTitles, `risk_${key}`, prefix);
    if (title) addFact(out, `risk_${key}`, title, "analysis.risks");
    else if (pendingTitles.some(item => item.factId === `risk_${key}`)) addFact(out, `risk_${key}`, prefix, "analysis.risks");
  });
  const segmentPrefix = language === "de" ? "das größte Segment" : "the largest segment";
  const segmentName = measures?.segmentName ?? values.top_segment;
  if (segmentName) {
    const title = speakableTitle(segmentName, language, pendingTitles, "top_segment", segmentPrefix);
    const existing = out.find(fact => fact.id === "top_segment");
    if (existing) existing.spoken = title ?? segmentPrefix;
    else addFact(out, "top_segment", title ?? segmentPrefix, "analysis.revenueSegments");
  }
  const codeLines: CodeLine[] = [];
  const crvWords = language === "de" ? values.crv : (measures?.crv != null ? speakEnNumber(measures.crv, 3) : null);
  const crv = crvSentence(crvWords, language);
  if (crv) codeLines.push({ chapterId: "dcf", spoken: crv });
  const thesis = thesisFact(facts, language);
  if (thesis) codeLines.push({ chapterId: "these", spoken: thesis.spoken });
  return {
    language,
    facts: out,
    context: modelContext(facts.redactedContext),
    pendingTitles,
    codeLines,
    ...collectPackNames(facts),
    placeNames: mergePlaceNames(facts.placeNames),
  };
}

function wordHasNameForm(word: string): boolean {
  return /[a-zäöü][A-ZÄÖÜ]/.test(word) || /\d/.test(word) || /^[A-ZÄÖÜ]{2,5}$/.test(word);
}

function titleNameTokens(title: string): string[] {
  const words = title.split(/[^A-Za-zÄÖÜäöüß0-9]+/).filter(Boolean);
  const english = looksEnglishTitle(title);
  const out: string[] = [];
  words.forEach((word, index) => {
    const named = wordHasNameForm(word) || (english && index > 0 && /^[A-ZÄÖÜ]/.test(word));
    if (named && word.length >= 2) out.push(word.toLowerCase());
  });
  return out;
}

function capitalizedTitleWords(title: string): string[] {
  return title.split(/[^A-Za-zÄÖÜäöüß]+/)
    .filter(word => word.length >= 4 && /^[A-ZÄÖÜ]/.test(word))
    .map(word => word.toLowerCase());
}

function newsTitlesOf(facts: PodcastFacts): string[] {
  return facts.newsTitles ?? [];
}

function segmentNamePieces(label: string | null | undefined): string[] {
  if (!label || !/[\/(),]/.test(label)) return [];
  const pieces: string[] = [];
  for (const piece of label.split(/[\/(),]+/)) {
    const words = piece.trim().split(/[^A-Za-zÄÖÜäöüß0-9]+/).filter(word => word.length >= 2);
    const word = words[0];
    if (words.length === 1 && word && /^[A-ZÄÖÜ]/.test(word)) pieces.push(word);
  }
  return pieces;
}

function collectPackNames(facts: PodcastFacts): { packNames: string[]; realNames: string[]; realPhrases: string[]; nearTitleNames: string[] } {
  const realNames: string[] = [];
  const realPhrases: string[] = [];
  const pushReal = (item: string | null | undefined) => {
    if (!item) return;
    const phrase = item.trim();
    if (phrase && !realPhrases.includes(phrase)) realPhrases.push(phrase);
    for (const word of item.split(/[^A-Za-zÄÖÜäöüß0-9]+/)) {
      if (word.length < 2) continue;
      const lower = word.toLowerCase();
      if (!realNames.includes(lower)) realNames.push(lower);
    }
  };
  pushReal(facts.values.company);
  for (const peer of facts.peerNames ?? []) pushReal(peer);
  for (const name of facts.protectedNames) pushReal(name);
  for (const piece of segmentNamePieces(facts.measures?.segmentName)) pushReal(piece);
  const packNames = [...realNames];
  const titles = [
    ...facts.payloadTitles,
    ...facts.upsideNames,
    ...facts.riskNames,
    facts.measures?.segmentName ?? null,
    ...(facts.measures?.catalystNames ?? []),
    ...(facts.measures?.riskNames ?? []),
  ];
  for (const title of titles) {
    if (!title) continue;
    for (const lower of titleNameTokens(title)) {
      if (!packNames.includes(lower)) packNames.push(lower);
    }
  }
  const nearTitleNames: string[] = [];
  for (const title of [...facts.riskNames, ...newsTitlesOf(facts)]) {
    for (const lower of capitalizedTitleWords(title)) {
      if (!nearTitleNames.includes(lower)) nearTitleNames.push(lower);
    }
  }
  return { packNames, realNames, realPhrases, nearTitleNames };
}

/** Nackte Altersphrase. Die Präposition setzt der Satz, nicht der Token. */
function nakedAge(age: string | null, language: PodcastLanguage): string | null {
  if (!age) return null;
  if (language === "de") {
    const vor = /^vor (.+) Tagen$/.exec(age);
    return vor ? `${vor[1]} Tage` : age;
  }
  const ago = /^(.+) days ago$/.exec(age);
  return ago ? `${ago[1]} days` : age;
}

function pairPrefix(language: PodcastLanguage, top: boolean): string {
  if (language === "de") return top ? "der größte Katalysator" : "ein weiterer Katalysator";
  return top ? "the largest catalyst" : "another catalyst";
}

function riskPrefix(language: PodcastLanguage, index: number): string {
  if (language === "de") return index === 0 ? "das genannte Risiko" : index === 1 ? "ein weiteres Risiko" : "ein drittes Risiko";
  return index === 0 ? "a verified risk" : index === 1 ? "a second verified risk" : "a third verified risk";
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
  if (language === "en" && !clearlyEnglishTitle(title)) {
    pending.push({ factId, raw: title, prefix });
    return null;
  }
  return title;
}

function clearlyEnglishTitle(title: string): boolean {
  if (KEEP_EN_SEGMENT_IN_DE.has(title.toLowerCase())) return true;
  if (/[äöüß]/i.test(title)) return false;
  const words = title.split(/[^A-Za-z]+/).filter(word => word.length > 2);
  return words.length > 0 && words.every(word => EN_LEXICON.has(word.toLowerCase()) || EN_TITLE_WORD.has(word.toLowerCase()));
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
  dcf: ["dcf_fair", "entry", "wacc", "g_star"],
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

const DE_AUX = /^(?:ist|sind|war|waren|hat|haben|hatte|hatten|wird|werden|wurde|wurden|kann|konnte|muss|musste|soll|sollte|darf|durfte|will|wollte|mag|möchte|wuchs|lag|gab|kam|nahm|blieb|ging|lief|trug|hielt|sah|stieg|fiel)$/i;
const EN_AUX = /^(?:is|are|was|were|be|been|being|has|have|had|do|does|did|grew|sat|went|came|made|took|saw|said|got|left|kept|held|found|gave|stay|come|look|meet|hold|set)$/i;

function finiteVerb(sentence: string, language: PodcastLanguage): boolean {
  const nouns = language === "de" ? DE_LEXICON : EN_LEXICON;
  const words = sentence.split(/\s+/).map(word => word.replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+$/g, "")).filter(Boolean);
  for (const word of words) {
    const lower = word.toLowerCase();
    if (language === "de") {
      if (DE_AUX.test(lower)) return true;
      if (lower.length < 4 || wordAllowed(lower, nouns, "de")) continue;
      if (/(?:te|ten|test|tet|st|t|en)$/.test(lower)) return true;
    } else {
      if (EN_AUX.test(lower)) return true;
      if (lower.length < 4 || nouns.has(lower)) continue;
      if (/(?:ed|es|s)$/.test(lower)) return true;
    }
  }
  return false;
}

function verbsOk(text: string, language: PodcastLanguage): boolean {
  return podcastSentences(text).every(sentence => finiteVerb(sentence, language));
}

function maskFacts(text: string, facts: SpeechFact[]): string {
  const names = facts.map(fact => fact.spoken).filter(spoken => spoken.length > 1).sort((a, b) => b.length - a.length);
  let out = text;
  for (const spoken of names) out = out.split(spoken).join(" ");
  return out;
}

function contentTokenCount(text: string): number {
  return text.split(/\s+/).map(word => word.replace(/[^A-Za-zÄÖÜäöüß]/g, "")).filter(word => word.length >= 2).length;
}

function languageOk(text: string, language: PodcastLanguage, facts: SpeechFact[]): boolean {
  if (contentTokenCount(text) < 8) return true;
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
  if (language === "de" && clean.length >= 5) {
    const stem = clean.replace(/(?:ern|en|er|em|es|e|n|s)$/, "");
    if (stem.length >= 4 && stem !== clean) {
      if (allowed.has(stem)) return true;
      let stemmed = false;
      allowed.forEach(known => {
        if (known.length >= 4 && known.startsWith(stem) && known.length - stem.length <= 2) stemmed = true;
      });
      if (stemmed) return true;
    }
  }
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

function tokenCore(word: string): string {
  return word.replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+$/g, "");
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i += 1;
      j += 1;
    } else if (a.length > b.length) i += 1;
    else j += 1;
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits === 1;
}

function knownNames(sheet: SpeechSheet): string[] {
  const lexicon = sheet.language === "de" ? DE_LEXICON : EN_LEXICON;
  const company = sheet.facts.find(fact => fact.id === "company")?.spoken ?? "";
  const segment = sheet.facts.find(fact => fact.id === "top_segment")?.spoken ?? "";
  const titled = sheet.context.split("\n")
    .filter(line => /^Nur Kontext, nicht vorlesen:/i.test(line))
    .map(line => line.replace(/^Nur Kontext, nicht vorlesen:\s*/i, ""));
  const names: string[] = [];
  for (const word of `${company} ${segment} ${titled.join(" ")}`.split(/[^A-Za-zÄÖÜäöüß]+/)) {
    const lower = word.toLowerCase();
    if (word.length >= 6 && !lexicon.has(lower)) names.push(lower);
  }
  return names;
}

function inflectionOnly(a: string, b: string): boolean {
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  if (long.length === short.length || !long.startsWith(short)) return false;
  return /^(?:e|n|en|er|es|s|ed|ing)$/.test(long.slice(short.length));
}

function nearKnownName(lower: string, names: string[]): boolean {
  if (lower.length < 4) return false;
  return names.some(name => name.length >= 4 && !inflectionOnly(lower, name) && withinOneEdit(lower, name));
}

/** Ein Zeichen im Wortinneren. Ein Suffix am Ende zählt nicht, ein gleicher String auch nicht. */
function internalOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const left = a.length >= b.length ? a : b;
  const right = a.length >= b.length ? b : a;
  if (left.length === right.length) {
    let index = -1;
    for (let i = 0; i < left.length; i++) {
      if (left[i] === right[i]) continue;
      if (index >= 0) return false;
      index = i;
    }
    return index > 0 && index < left.length - 1;
  }
  let i = 0;
  let j = 0;
  let extra = -1;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (extra >= 0) return false;
    extra = i;
    i += 1;
  }
  if (extra < 0) extra = left.length - 1;
  return extra > 0 && extra < left.length - 1;
}

function withoutPossessive(word: string): string {
  return word.replace(/(?:['’]s|['’])$/, "");
}

const DE_NOUNS = new Set(DE_NOUN_LEMMAS);

function foldUmlaut(word: string): string {
  return word.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
}

function nounKeys(word: string): string[] {
  const lower = withoutPossessive(word).toLowerCase();
  const folded = foldUmlaut(lower);
  return folded === lower ? [lower] : [lower, folded];
}

function isListedNoun(word: string): boolean {
  return nounKeys(word).some(key => DE_NOUNS.has(key));
}

function listedNounForm(word: string): boolean {
  const lower = withoutPossessive(word).toLowerCase();
  if (isListedNoun(lower)) return true;
  for (const suffix of ["en", "er", "e", "n", "s"]) {
    if (lower.length - suffix.length < 4 || !lower.endsWith(suffix)) continue;
    if (isListedNoun(lower.slice(0, -suffix.length))) return true;
  }
  return false;
}

const DE_CLOSED = new Set(DE_CLOSED_LEMMAS);
const DE_VERBS = new Set(DE_VERB_LEMMAS);

function partKnown(part: string): boolean {
  if (part.length < 3) return false;
  if (listedNounForm(part) || DE_CLOSED.has(part) || DE_VERBS.has(part)) return true;
  return part.length >= 4 && DE_VERBS.has(`${part}en`);
}

function knownCompound(word: string): boolean {
  const lower = withoutPossessive(word).toLowerCase();
  const forms = [lower];
  for (const suffix of ["n", "en", "e", "s"]) {
    if (lower.length - suffix.length >= 8 && lower.endsWith(suffix)) forms.push(lower.slice(0, -suffix.length));
  }
  const fugen = ["", "s", "n", "en", "es", "e"];
  for (const form of forms) {
    for (let endLen = form.length - 4; endLen >= 3; endLen--) {
      const end = form.slice(form.length - endLen);
      if (!partKnown(end)) continue;
      const rest = form.slice(0, form.length - endLen);
      for (const fuge of fugen) {
        if (fuge && !rest.endsWith(fuge)) continue;
        const head = fuge ? rest.slice(0, -fuge.length) : rest;
        if (head.length >= 4 && partKnown(head)) return true;
      }
    }
  }
  return false;
}

/** Fugen der Zerlegung. Der Lexikon-Hash umfasst diese Liste. */
export const COMPOUND_FUGEN = ["", "s", "n", "en", "es", "e"] as const;

/** Nachsilbe nur als letzter Teil, und nur wenn der Rest ein Nomen oder Verbstamm ist. */
export const COMPOUND_SUFFIXES = ["ung", "schaft", "heit", "keit", "tum", "nis"] as const;

/** Statisch erlaubte Ziffern und Codes. Produktcodes stehen hier nicht. */
export const ALLOWED_CODE_PATTERNS = ["^Q[1-4]$", "^H[12]$", "^FY\\d{2,4}$", "^(?:19|20)\\d{2}$"] as const;

const ALLOWED_CODE_RES = ALLOWED_CODE_PATTERNS.map(source => new RegExp(source, "i"));
const EN_COMMON = new Set(EN_COMMON_WORDS);

function latinForms(part: string): string[] {
  const lower = withoutPossessive(part).toLowerCase();
  const forms = [lower];
  if (lower.endsWith("en") && lower.length - 2 >= 4) {
    const stem = lower.slice(0, -2);
    forms.push(`${stem}um`, `${stem}us`, `${stem}a`);
  }
  if ((lower.endsWith("um") || lower.endsWith("us")) && lower.length - 2 >= 4) {
    forms.push(`${lower.slice(0, -2)}en`);
  } else if (lower.endsWith("a") && lower.length - 1 >= 4) {
    forms.push(`${lower.slice(0, -1)}en`);
  }
  return forms;
}

function companyForm(part: string): boolean {
  return latinForms(part).some(form => DE_COMPANY_SET.has(form));
}

function nounLeaf(part: string): boolean {
  const lower = withoutPossessive(part).toLowerCase();
  if (!lower || companyForm(part)) return false;
  if (DE_NOUNS.has(lower)) return true;
  if (lower.length < 4) return false;
  return latinForms(part).some(form => form !== lower && DE_NOUNS.has(form));
}

function nounOrPlural(part: string): boolean {
  if (companyForm(part)) return false;
  if (nounLeaf(part)) return true;
  const lower = withoutPossessive(part).toLowerCase();
  for (const suffix of ["en", "n", "e", "s"]) {
    if (!lower.endsWith(suffix) || lower.length - suffix.length < 4) continue;
    const stem = lower.slice(0, -suffix.length);
    if (companyForm(stem)) return false;
    if (nounLeaf(stem)) return true;
  }
  return false;
}

function verbStem(part: string): boolean {
  if (part.length < 4 || companyForm(part)) return false;
  if (DE_VERBS.has(part)) return true;
  return part.length >= 4 && DE_VERBS.has(`${part}en`);
}

/** Alle Teile gewöhnliche Nomen. Ein Firmenteil gibt nie frei. */
function ordinaryCompound(word: string, depth = 0): boolean {
  const lower = withoutPossessive(word).toLowerCase();
  if (lower.length < 4 || depth > 6 || companyForm(lower)) return false;
  if (nounOrPlural(lower)) return true;
  for (const suffix of COMPOUND_SUFFIXES) {
    if (!lower.endsWith(suffix) || lower.length - suffix.length < 4) continue;
    const rest = lower.slice(0, -suffix.length);
    if (companyForm(rest)) continue;
    if (nounOrPlural(rest) || verbStem(rest) || (rest.length >= 8 && ordinaryCompound(rest, depth + 1))) return true;
  }
  if (lower.length < 8) return false;
  for (let endLen = lower.length - 4; endLen >= 4; endLen--) {
    const end = lower.slice(lower.length - endLen);
    const left = lower.slice(0, lower.length - endLen);
    for (const fuge of COMPOUND_FUGEN) {
      if (fuge && !left.endsWith(fuge)) continue;
      const head = fuge ? left.slice(0, -fuge.length) : left;
      if (head.length < 4) continue;
      if (companyForm(head) || companyForm(end)) continue;
      const headOk = nounOrPlural(head) || ordinaryCompound(head, depth + 1);
      const endOk = nounOrPlural(end) || ordinaryCompound(end, depth + 1);
      if (headOk && endOk) return true;
    }
  }
  return false;
}

function packBlob(sheet: SpeechSheet): string {
  return `${sheet.facts.map(fact => fact.spoken).join(" ")} ${sheet.context} ${(sheet.packNames ?? []).join(" ")} ${(sheet.realNames ?? []).join(" ")} ${(sheet.placeNames ?? []).join(" ")}`.toLowerCase();
}

function inPackFacts(clean: string, sheet: SpeechSheet): boolean {
  if (clean.length < 2) return false;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9äöüß])${escaped}(?:$|[^a-z0-9äöüß])`).test(packBlob(sheet));
}

function codeAllowed(token: string, sheet: SpeechSheet): boolean {
  if (ALLOWED_CODE_RES.some(pattern => pattern.test(token))) return true;
  if (!/\d/.test(token) || !/[A-Za-zÄÖÜäöüß]/.test(token)) return false;
  return packBlob(sheet).includes(token.toLowerCase());
}

function nameShaped(token: string): boolean {
  if (!token) return false;
  if (/\d/.test(token)) return true;
  if (/[a-zäöü][A-ZÄÖÜ]/.test(token)) return true;
  return /^[A-ZÄÖÜ]/.test(token);
}

function noneTokenCleared(token: string, sheet: SpeechSheet): boolean {
  const clean = withoutPossessive(token).toLowerCase();
  if (!clean || !nameShaped(token)) return true;
  if (codeAllowed(token, sheet)) return true;
  if (releasedNames(sheet).has(clean) || inPackFacts(clean, sheet)) return true;
  if (token.includes("-")) {
    const parts = token.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every(part => noneTokenCleared(part, sheet))) return true;
  }
  if (companyForm(clean)) return false;
  if (sheet.language === "en") return EN_COMMON.has(clean) || EN_LEXICON.has(clean);
  if (DE_LEXICON.has(clean) || DE_CLOSED.has(clean)) return true;
  return nounOrPlural(clean) || ordinaryCompound(clean);
}

function noneNameMiss(text: string, sheet: SpeechSheet): string | null {
  for (const sentence of podcastSentences(text)) {
    for (const word of sentence.split(/\s+/).filter(Boolean)) {
      const token = tokenBody(word);
      if (!token || noneTokenCleared(token, sheet)) continue;
      return token;
    }
  }
  return null;
}

function tokenBody(word: string): string {
  return word.replace(/^[^A-Za-zÄÖÜäöüß0-9]+|[^A-Za-zÄÖÜäöüß0-9]+$/g, "");
}

function strayDigit(spoken: string, sheet: SpeechSheet): string | null {
  for (const raw of spoken.split(/\s+/)) {
    const token = tokenBody(raw);
    if (!token || !/\d/.test(token) || codeAllowed(token, sheet)) continue;
    return token.match(/\d+/)?.[0] ?? token;
  }
  return null;
}

/** Exakte Freigabe, kein Präfix. CEO und Kunden stehen hier nicht. */
const STATIC_NAME_ALLOW: Array<[string, string]> = [
  ["sec", "US-Börsenaufsicht"],
  ["bafin", "deutsche Finanzaufsicht"],
  ["fca", "britische Finanzaufsicht"],
  ["esma", "europäische Wertpapieraufsicht"],
  ["cftc", "US-Terminaufsicht"],
  ["finra", "US-Brokeraufsicht"],
  ["fed", "US-Notenbank, Kurzname"],
  ["federal reserve", "US-Notenbank"],
  ["ezb", "europäische Notenbank, Kurzname"],
  ["ecb", "europäische Notenbank, englischer Kurzname"],
  ["europäische zentralbank", "europäische Notenbank"],
  ["europaeische zentralbank", "europäische Notenbank, ohne Umlaut"],
  ["boe", "Bank of England, Kurzname"],
  ["boj", "Bank of Japan, Kurzname"],
  ["snb", "Schweizerische Nationalbank, Kurzname"],
  ["ira", "US-Gesetz Inflation Reduction Act, Kurzname"],
  ["dsgvo", "EU-Datenschutzgesetz, Kurzname"],
  ["gdpr", "EU-Datenschutzgesetz, englischer Kurzname"],
  ["mifid", "EU-Finanzmarktgesetz, Kurzname"],
  ["dax", "deutscher Aktienindex"],
  ["mdax", "deutscher Mid-Cap-Index"],
  ["sdax", "deutscher Small-Cap-Index"],
  ["stoxx", "europäischer Indexanbieter"],
  ["nasdaq", "US-Börse und Index"],
  ["ftse", "britischer Aktienindex"],
  ["dow", "US-Aktienindex, Kurzname"],
  ["nyse", "New Yorker Börse"],
  ["xetra", "deutsche Börse"],
  ["usd", "US-Dollar, Währungscode"],
  ["eur", "Euro, Währungscode"],
  ["gbp", "Pfund, Währungscode"],
  ["jpy", "Yen, Währungscode"],
  ["chf", "Franken, Währungscode"],
];

const DE_COMPANY_SET = new Set(DE_COMPANY_NAMES);
const DE_COMPANY_AMBIGUOUS_SET = new Set(DE_COMPANY_AMBIGUOUS);

let structuralNameCalls = 0;

/** Testzähler. Der Annahmeweg ruft structuralName nicht auf. */
export function readStructuralNameCalls(): number {
  const seen = structuralNameCalls;
  structuralNameCalls = 0;
  return seen;
}

function releasedNames(sheet: SpeechSheet): Set<string> {
  const out = new Set<string>();
  for (const [name] of STATIC_NAME_ALLOW) out.add(name);
  const blobs = [
    ...(sheet.realNames ?? []),
    ...(sheet.realPhrases ?? []),
    ...(sheet.placeNames ?? []),
    ...(sheet.packNames ?? []),
    ...(sheet.nearTitleNames ?? []),
  ];
  for (const phrase of blobs) {
    out.add(phrase.toLowerCase());
    for (const bit of phrase.toLowerCase().split(/[^a-zäöüß0-9]+/)) {
      if (bit) out.add(bit);
    }
  }
  return out;
}

/** Exakter Firmenkurzname, vor jedem Substantiv-Beweis. Freigegebene Pack-Namen zählen nicht. */
function companyLexiconHit(text: string, sheet: SpeechSheet): { word: string; ambiguous: boolean } | null {
  const released = releasedNames(sheet);
  const lexicon = sheet.language === "de" ? DE_LEXICON : EN_LEXICON;
  for (const sentence of podcastSentences(text)) {
    for (const word of sentence.split(/\s+/).filter(Boolean)) {
      const token = tokenCore(word);
      const clean = withoutPossessive(token).toLowerCase();
      if (!clean || !/^[A-ZÄÖÜ0-9]/.test(token) || lexicon.has(clean) || !DE_COMPANY_SET.has(clean) || released.has(clean)) continue;
      return { word: tokenCore(word), ambiguous: DE_COMPANY_AMBIGUOUS_SET.has(clean) };
    }
  }
  return null;
}

/** Englisches Possessiv an einem nicht freigegebenen Namen. Lilly's aus dem Pack bleibt. */
function possessiveNameHit(text: string, sheet: SpeechSheet): string | null {
  if (sheet.language !== "en") return null;
  const released = releasedNames(sheet);
  for (const sentence of podcastSentences(text)) {
    for (const word of sentence.split(/\s+/).filter(Boolean)) {
      if (!/['’]s$/i.test(word)) continue;
      const bare = withoutPossessive(tokenCore(word));
      if (!bare || !/^[A-Z]/.test(bare) || released.has(bare.toLowerCase())) continue;
      return bare;
    }
  }
  return null;
}

function placeBits(text: string): string[] {
  return withoutPossessive(text).replace(/\./g, "").split(/[^A-Za-zÄÖÜäöüß]+/)
    .map(bit => withoutPossessive(bit))
    .filter(bit => bit.length >= 2)
    .map(bit => bit.toLowerCase());
}

function mergePlaceNames(fromPack: string[] | undefined): string[] {
  const out: string[] = [];
  for (const name of [...countryPhrases(), ...(fromPack ?? [])]) {
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function flexBit(bit: string): string {
  const lower = bit.toLowerCase();
  for (const suffix of ["em", "en", "er", "e"]) {
    if (lower.length - suffix.length >= 4 && lower.endsWith(suffix)) return lower.slice(0, -suffix.length);
  }
  return lower;
}

function placeCovers(words: string[], index: number, places: string[]): boolean {
  const tokens: Array<{ bit: string; index: number }> = [];
  words.forEach((word, wordIndex) => {
    for (const bit of placeBits(tokenCore(word))) tokens.push({ bit, index: wordIndex });
  });
  for (const place of places) {
    const parts = placeBits(place);
    if (!parts.length) continue;
    for (let start = 0; start + parts.length <= tokens.length; start++) {
      const match = parts.every((part, offset) => {
        const bit = tokens[start + offset]?.bit;
        return bit === part || (bit != null && flexBit(bit) === flexBit(part));
      });
      if (!match) continue;
      for (let offset = 0; offset < parts.length; offset++) {
        if (tokens[start + offset]?.index === index) return true;
      }
    }
  }
  return false;
}

function packNameLeak(text: string, sheet: SpeechSheet): string | null {
  const lexicon = sheet.language === "de" ? DE_LEXICON : EN_LEXICON;
  const exact = sheet.packNames ?? [];
  const spoken = [...sheet.facts.map(fact => fact.spoken), ...sheet.codeLines.map(line => line.spoken)].join(" ");
  for (const sentence of podcastSentences(text)) {
    for (const word of sentence.split(/\s+/).filter(Boolean)) {
      const clean = tokenCore(word);
      const lower = clean.toLowerCase();
      if (lower.length < 4 || lexicon.has(lower)) continue;
      if (allowedPackToken(clean, sheet)) continue;
      const nearTitle = (sheet.nearTitleNames ?? []).some(name => internalOneEdit(lower, name));
      if (!exact.includes(lower) && !nearKnownName(lower, sheet.realNames ?? []) && !nearTitle) continue;
      if (entityMentioned(clean, spoken)) continue;
      return clean;
    }
  }
  return null;
}

/** Strukturelle Kandidaten. Der Annahmeweg ruft diese Funktion nicht auf. */
function structuralName(text: string, sheet: SpeechSheet, proveNouns = false): string | null {
  structuralNameCalls += 1;
  void proveNouns;
  const allowed = allowedWords(sheet);
  const names = knownNames(sheet);
  for (const sentence of podcastSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const clean = tokenCore(words[i] ?? "");
      if (!clean || wordAllowed(withoutPossessive(clean), allowed, sheet.language)) continue;
      if (placeCovers(words, i, sheet.placeNames ?? []) || allowedPackToken(clean, sheet)) continue;
      const lower = clean.toLowerCase();
      const camelOrDigit = /[a-zäöü][A-ZÄÖÜ]|\d/.test(clean);
      const allCaps = /^[A-ZÄÖÜ]{2,5}$/.test(clean);
      const enMid = sheet.language === "en" && i > 0 && /^[A-Z]/.test(clean);
      if (camelOrDigit || allCaps || enMid || nearKnownName(lower, names)) return clean;
    }
  }
  return null;
}

function entityMentioned(entity: string, text: string): boolean {
  const needle = tokenCore(entity);
  if (needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:s|['’]s)?(?![\\p{L}\\p{N}])`, "iu");
  return boundary.test(text);
}

function allowedPackToken(clean: string, sheet: SpeechSheet): boolean {
  const lower = withoutPossessive(clean).replace(/\./g, "").toLowerCase();
  if (!lower) return false;
  if ((sheet.realNames ?? []).includes(lower)) return true;
  return (sheet.placeNames ?? []).some(place => {
    const parts = placeBits(place);
    return parts.length === 1 && parts[0] === lower;
  });
}

function samePhrase(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((bit, index) => bit === right[index]);
}

function allowedListedName(entity: string, sheet: SpeechSheet): boolean {
  const bits = placeBits(entity);
  if (!bits.length) return false;
  if (bits.length === 1 && bits[0] && allowedPackToken(bits[0], sheet)) return true;
  const phrases = [...(sheet.realPhrases ?? []), ...(sheet.placeNames ?? [])];
  return phrases.some(phrase => samePhrase(placeBits(phrase), bits));
}

function entityHit(entities: string[] | null | undefined, raw: string, spoken: string, sheet: SpeechSheet): string | null {
  if (!entities?.length) return null;
  const allowed = allowedWords(sheet);
  for (const entity of entities) {
    if (allowedListedName(entity, sheet)) continue;
    const clean = tokenCore(entity);
    if (!entityMentioned(clean, raw) && !entityMentioned(clean, spoken)) continue;
    if (wordAllowed(clean, allowed, sheet.language)) continue;
    return clean;
  }
  return null;
}

function mergeEntityLists(first: string[] | null | undefined, redo: string[] | null | undefined): string[] | null {
  const merged: string[] = [];
  for (const list of [first, redo]) {
    if (!list) continue;
    for (const item of list) {
      if (!merged.includes(item)) merged.push(item);
    }
  }
  if (!merged.length && first == null && redo == null) return null;
  return merged;
}

const DE_NUMBER_ATOMS = ["milliarden", "millionen", "milliarde", "million", "tausend", "hundert", "neunzehn", "achtzehn", "siebzehn", "sechzehn", "fünfzehn", "fuenfzehn", "vierzehn", "dreizehn", "zwölf", "zwoelf", "elf", "neunzig", "achtzig", "siebzig", "sechzig", "fünfzig", "fuenfzig", "vierzig", "dreißig", "dreissig", "zwanzig", "zehn", "neun", "acht", "sieben", "sechs", "fünf", "fuenf", "vier", "drei", "zwei", "null"];
const EN_NUMBER = /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|percent|doubled|tripled|halved|twice|half|twofold|double|triple|dozen|highest|record|couple|quarter)\b/i;
const DE_FOLD = /\b(verdoppelt|verdreifacht|halbiert|hälfte|haelfte|drittel|viertel|rekord|höchster|höchste|höchsten|höchstem)\b|\b[A-Za-zÄÖÜäöüß]*fach\b|höchste[rnms]?\s+seit/i;

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

function isQuantityToken(word: string, language: PodcastLanguage): boolean {
  const clean = word.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (!clean) return false;
  if (language === "en") return EN_NUMBER.test(clean) || /^(?:percent|dollars|dollar|point|negative)$/i.test(clean);
  return isGermanQuantity(clean) || DE_FOLD.test(clean) || /^(?:prozent|dollar|komma|minus)$/i.test(clean);
}

function numberSubphrases(spoken: string, language: PodcastLanguage): string[] {
  const words = spoken.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= words.length; i++) {
    const hit = i < words.length && isQuantityToken(words[i] ?? "", language);
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      if (i - start >= 2) {
        const raw = words.slice(start, i).join(" ");
        const clean = raw.replace(/[.,;:!?]+/g, "").replace(/\s+/g, " ").trim();
        out.push(raw);
        if (clean !== raw) out.push(clean);
      }
      start = -1;
    }
  }
  return out;
}

function maskKnownPhrases(text: string, sheet: SpeechSheet): string {
  let masked = text;
  const phrases = [...sheet.facts.map(fact => fact.spoken), ...sheet.codeLines.map(line => line.spoken)]
    .filter(spoken => spoken.length > 2)
    .sort((a, b) => b.length - a.length);
  const parts: string[] = [];
  for (const phrase of phrases) {
    parts.push(phrase);
    const bare = phrase.replace(/^(?:auf den|für den|as of|for|von|from)\s+/i, "");
    if (bare !== phrase) parts.push(bare);
    for (const sub of numberSubphrases(phrase, sheet.language)) parts.push(sub);
  }
  parts.sort((a, b) => b.length - a.length);
  for (const phrase of parts) masked = masked.split(phrase).join(" ");
  return masked;
}

export function quantityWord(text: string, sheet: SpeechSheet): string | null {
  const masked = maskKnownPhrases(text, sheet);
  if (sheet.language === "en") {
    const hit = EN_NUMBER.exec(masked);
    return hit?.[0] ?? null;
  }
  const fold = DE_FOLD.exec(masked);
  if (fold?.[0]) return fold[0];
  return masked.split(/[^A-Za-zÄÖÜäöüß]+/).find(word => isGermanQuantity(word)) ?? null;
}

export function quantityOutsideFacts(text: string, facts: SpeechFact[], language: PodcastLanguage): boolean {
  return quantityWord(text, { language, facts, context: "", pendingTitles: [], codeLines: [], packNames: [], realNames: [], realPhrases: [], nearTitleNames: [], placeNames: [] }) != null;
}

export function applyFactTokens(text: string, facts: SpeechFact[]): string {
  return text.replace(TOKEN_RE, (all, id: string) => facts.find(fact => fact.id === id)?.spoken ?? all);
}

const DOUBLED_PREP = /\b(auf den auf den|für den für den|für den auf den|auf den für den|vom auf den|vom für den|von vor|von von|seit von|as of as of|for for|from from)\b/i;

const SLOT_UNIT = /\[\[(price|dcf_fair|entry|fy_yoy|wacc|g_star|top_segment_share|fcf_margin|pair_[abc])\]\]\s+(Dollar|Prozent|Euro|dollars|percent|dollar)\b/i;
const ARTICLE_SLOT = /\b(ein|eine|einem|einen|one|a|an)\s+\[\[(fy_yoy|wacc|g_star|top_segment_share|fcf_margin|pair_[abc])\]\]/i;
const DOUBLED_UNIT = /\b(Dollar|Prozent|Euro|dollars|percent)\s+\1\b/i;
const DATE_ARTICLE = /\b(?:Der|Die|Das|Den|The)\s+\[\[(?:as_of|call_date)\]\]/;

export function verifyChapter(chapterId: string, raw: string, sheet: SpeechSheet, entities?: string[] | null, none = false): ChapterVerdict {
  const facts = factsForChapter(sheet, chapterId);
  const spoken = applyFactTokens(raw, sheet.facts).replace(/\s+/g, " ").trim();
  const reasons: string[] = [];
  const notes: string[] = [];
  const note = (code: string, word: string) => {
    reasons.push(code);
    notes.push(`${code} ${word}`);
  };
  if (!spoken) reasons.push("empty");
  const digit = spoken ? strayDigit(spoken, sheet) : null;
  if (digit) note("digit", digit);
  if (/\[\[[a-z0-9_]+\]\]s\b/i.test(raw)) note("token", "genitive");
  if (/\[\[[a-z0-9_]+\]\]|\{[a-z0-9_]+\}/.test(spoken) || BARE_PLACEHOLDER.test(spoken)) {
    note("placeholder", spoken.match(/\[\[[a-z0-9_]+\]\]|\{[a-z0-9_]+\}/)?.[0] ?? "placeholder");
  }
  if (/\bn\/a\b|\bn\.a\.\b/i.test(spoken)) note("na", "n/a");
  if (/\blieg(?:t|en)\s+nicht\s+vor\b/i.test(spoken)) note("absent", "liegt nicht vor");
  if (/\bYTD\b|seit Jahresbeginn/i.test(spoken)) note("ytd", "YTD");
  if (/^\s*[-•]/m.test(raw)) note("list", "list");
  const unit = raw.match(SLOT_UNIT)?.[2] ?? raw.match(ARTICLE_SLOT)?.[1] ?? spoken.match(DOUBLED_UNIT)?.[1] ?? (DATE_ARTICLE.test(raw) ? "Datum" : null);
  if (unit) note("unit", unit);
  if (spoken && !languageOk(spoken, sheet.language, facts)) note("language", sheet.language);
  const prep = spoken.match(DOUBLED_PREP);
  if (prep?.[0]) note("prep", prep[0].toLowerCase());
  const company = spoken ? companyLexiconHit(spoken, sheet) : null;
  if (company) {
    note("name", company.word);
    if (company.ambiguous) note("ambiguous", company.word);
  }
  if (none && spoken) {
    const missed = noneNameMiss(spoken, sheet);
    if (missed && !notes.some(item => item === `name ${missed}`)) note("name", missed);
  }
  const possessive = spoken ? possessiveNameHit(spoken, sheet) : null;
  if (possessive) note("name", possessive);
  const leaked = spoken ? packNameLeak(spoken, sheet) : null;
  const extra = spoken ? entityHit(entities, raw, spoken, sheet) : null;
  const name = leaked ?? extra;
  if (name) note("name", name);
  const quantity = spoken ? quantityWord(spoken, sheet) : null;
  if (quantity) note("number", quantity);
  const flu = fluencyStats(spoken);
  const lengthBad = !spoken || flu.sentences < 1 || flu.short > 0 || flu.avg < 8;
  const verbBad = !spoken || !verbsOk(spoken, sheet.language);
  if (lengthBad) note("fragment", "length");
  else if (verbBad) note("fragment", "verb");
  const naked = podcastSentences(spoken).some(sentence => {
    const bare = sentence.replace(/[.!?]+$/g, "").trim();
    return facts.some(fact => fact.spoken.replace(/[.!?]+$/g, "").trim() === bare && fact.spoken.split(/\s+/).length < 6);
  });
  if (naked) note("fragment", "label");
  return { ok: reasons.length === 0, spoken, reasons, notes };
}

function period(text: string): string {
  const clean = text.trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function joinSentences(parts: string[]): string {
  return parts.map(period).filter(Boolean).join(" ");
}

function newsAgeSentence(age: string): string {
  if (age === "heute" || age === "gestern") return `Die jüngste Meldung stammt von ${age} und liegt im betrachteten Fenster`;
  return `Die jüngste Meldung ist ${age} alt und liegt im betrachteten Fenster`;
}

function newsAgeSentenceEn(age: string): string {
  if (age === "today" || age === "yesterday") return `The latest report dates from ${age} and stays inside the window we considered`;
  return `The latest report is ${age} old and stays inside the window we considered`;
}

function hostedName(spoken: string, de: boolean): string {
  if (/^(der|die|das|ein|eine|the|a|an|another)\b/i.test(spoken)) return spoken;
  if (/\b(Katalysator|catalyst)\b/i.test(spoken)) return spoken;
  return de ? `der Katalysator ${spoken}` : `the catalyst ${spoken}`;
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
    if (asOf) parts.push(de ? `Der Stand bezieht sich auf den ${asOf}` : `The figures are as of ${asOf}`);
    else if (price) parts.push(de ? "Dieser Kurs ist der belegte Marktwert der Aktie" : "This price is the verified market value of the company");
  } else if (chapterId === "zusammenfassung") {
    const ampel = take("ampel");
    const company = take("company");
    if (ampel && company) parts.push(de ? `Die Ampel für ${company} steht auf ${ampel} und fasst die belegte Einschätzung zusammen` : `The signal for ${company} stands at ${ampel} and sums up the verified view`);
    else if (ampel) parts.push(de ? `Die Ampel steht auf ${ampel} und fasst die belegte Einschätzung zusammen` : `The signal stands at ${ampel} and sums up the verified view`);
  } else if (chapterId === "these") {
    const thesis = take("thesis");
    if (thesis) parts.push(thesis);
  } else if (chapterId === "umsatz") {
    const growth = take("fy_yoy");
    const year = take("gj_year");
    const segment = take("top_segment");
    const share = take("top_segment_share");
    if (growth && year) parts.push(de ? `Das Umsatzwachstum im Geschäftsjahr ${year} beträgt ${growth}` : `Revenue growth in fiscal year ${year} is ${growth}`);
    else if (growth) parts.push(de ? `Das Umsatzwachstum beträgt ${growth}` : `Revenue growth is ${growth}`);
    if (segment && share) {
      const named = de ? !/^das größte Segment$/i.test(segment) : !/^the largest segment$/i.test(segment);
      parts.push(de
        ? `${named ? `Das größte Segment ${segment}` : "Das größte Segment"} hat einen Anteil von ${share}`
        : `${named ? `The largest segment ${segment}` : "The largest segment"} accounts for ${share}`);
    }
  } else if (chapterId === "dcf") {
    const fair = take("dcf_fair");
    const entry = take("entry");
    if (fair) parts.push(de ? `Der faire Wert liegt bei ${fair} und stammt aus der belegten Bewertung` : `The fair value stands at ${fair} and comes from the verified valuation`);
    if (entry) parts.push(de ? `Der rechnerische Einstieg liegt bei ${entry}` : `The calculated entry stands at ${entry}`);
  } else if (chapterId === "s17") {
    const first = take("pair_a");
    const second = take("pair_b");
    if (first) parts.push(de ? `An der Spitze steht ${hostedName(first, true)}` : `At the top stands ${hostedName(first, false)}`);
    if (second) parts.push(de ? `Danach folgt ${hostedName(second, true)}` : `After that comes ${hostedName(second, false)}`);
  } else if (chapterId === "inversion") {
    const risks = ["risk_a", "risk_b", "risk_c"].map(take).filter((name): name is string => !!name);
    const entry = take("entry");
    const placeholder = de ? /^das genannte Risiko$|^ein weiteres Risiko$|^ein drittes Risiko$/ : /^a (?:second |third )?verified risk$/;
    const named = risks.filter(risk => !placeholder.test(risk));
    if (named.length === 1) {
      parts.push(de
        ? `Das genannte Risiko ist ${named[0]} und begrenzt die Chance der Firma`
        : `The risk is ${named[0]} and limits the chance of the company`);
    } else if (named.length > 1) {
      parts.push(de
        ? `Die Risiken sind ${named.join(" und ")} und begrenzen die Chance der Firma`
        : `The risks are ${named.join(" and ")} and limit the chance of the company`);
    } else if (risks.length) {
      parts.push(de ? "Die Gegenseite begrenzt die Chance der Firma" : "The other side limits the chance of the company");
    }
    if (entry) parts.push(de ? `Der rechnerische Einstieg liegt bei ${entry}` : `The calculated entry stands at ${entry}`);
  } else if (chapterId === "earnings") {
    const quarter = take("call_quarter");
    const date = take("call_date");
    if (quarter) parts.push(de ? `Zuletzt gemeldet wurde das ${quarter}` : `The latest reported period is ${quarter}`);
    if (date) parts.push(de ? `Der nächste Earnings Call ist für den ${date} angekündigt` : `The next earnings call is set for ${date}`);
  } else if (chapterId === "news" || chapterId === "news-llm") {
    const age = take("news_age");
    if (age) parts.push(de ? newsAgeSentence(age) : newsAgeSentenceEn(age));
  }
  const body = parts.length ? joinSentences(parts) : "";
  return appendCodeLines(body, sheet, chapterId);
}

function appendCodeLines(text: string, sheet: SpeechSheet, chapterId: string): string {
  let out = text.trim();
  for (const line of sheet.codeLines) {
    if (line.chapterId !== chapterId || out.includes(line.spoken)) continue;
    out = `${out} ${line.spoken}`.trim();
  }
  return out.replace(/\s+/g, " ").trim();
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
  peer_a: "Vergleichsfirma", peer_b: "Vergleichsfirma", peer_c: "Vergleichsfirma",
  risk_a: "Risiko", risk_b: "Risiko", risk_c: "Risiko", thesis: "These",
};

const HUMAN_EN: Record<string, string> = {
  company: "company name", price: "share price", as_of: "as of date", ampel: "signal",
  fy_yoy: "revenue growth", gj_year: "fiscal year", top_segment: "segment",
  top_segment_share: "segment share", dcf_fair: "fair value", entry: "entry",
  crv: "chance-risk ratio", wacc: "cost of capital", g_star: "growth", news_age: "report age",
  call_date: "call date", call_quarter: "quarter", pair_a: "catalyst", pair_b: "catalyst",
  pair_c: "catalyst", peer_a: "peer", peer_b: "peer", peer_c: "peer",
  risk_a: "risk", risk_b: "risk", risk_c: "risk", thesis: "thesis",
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

export function fluentPrompt(
  sheet: SpeechSheet,
  source: StockPodcastSource,
  redo?: Array<{ id: string; reasons: string[]; notes?: string[] }>,
): { prompt: string; systemPrompt: string } {
  const chapters = chaptersForSource(source).filter(def => def.id !== "schluss" && factsForChapter(sheet, def.id).length > 0);
  const wanted = redo?.length ? chapters.filter(def => redo.some(row => row.id === def.id)) : chapters;
  const lines = sheet.facts.map(fact => {
    const label = (sheet.language === "en" ? HUMAN_EN : HUMAN_DE)[fact.id] ?? "Angabe";
    return `[[${fact.id}]] = ${fact.spoken} (${label})`;
  });
  const redoLine = redo?.length
    ? redo.map(row => `${row.id}: ${(row.notes && row.notes.length ? row.notes : row.reasons).join("; ")}`).join("\n")
    : "";
  const systemPrompt = sheet.language === "en"
    ? "You write one connected paragraph per chapter, in whole sentences, the way a host speaks. Leave every [[id]] token unchanged. Do not add an s after a token. The company is only [[company]]. A peer is only [[peer_a]], [[peer_b]] or [[peer_c]], written as of [[peer_a]] or the stock of [[peer_a]]. Do not invent a number, a name, or a date. No lists, no one-word sentence, no sentence under four words. If a fact is absent, do not mention it. Do not say that something is missing. Reply as JSON {\"chapters\":[{\"id\":\"...\",\"paragraph\":\"...\",\"entities\":[\"...\"],\"none\":false}]}. entities lists every proper name in that paragraph. An empty list is valid only together with none true, and only when the paragraph has no proper name. titles translates each catalyst and risk title into English. Proper names stay."
    : "Du schreibst je Kapitel einen zusammenhängenden Absatz aus ganzen Sätzen, wie ein Moderator. Du lässt jedes Token [[id]] unverändert. Du hängst kein s an ein Token. Die eigene Firma nur als [[company]]. Eine Vergleichsfirma nur als [[peer_a]], [[peer_b]] oder [[peer_c]], in der Form von [[peer_a]] oder die Aktie von [[peer_a]]. Du erfindest keine Zahl, keinen Namen und kein Datum. Keine Aufzählung, kein Ein-Wort-Satz, kein Satz unter vier Wörtern. Was nicht als Fakt dasteht, erwähnst du nicht. Du sagst nicht, dass etwas fehlt. Antworte als JSON {\"chapters\":[{\"id\":\"...\",\"paragraph\":\"...\",\"entities\":[\"...\"],\"none\":false}]}. entities nennt alle Eigennamen im Absatz. Eine leere Liste gilt nur zusammen mit none true, und nur wenn kein Eigenname vorkommt.";
  const titleBlock = sheet.language === "en" && sheet.pendingTitles.length
    ? `TITEL\n${sheet.pendingTitles.map(item => item.raw).join("\n")}`
    : "";
  const prompt = [
    sheet.language === "en" ? "Write English." : "Schreibe Deutsch.",
    `Quelle des Laufs: ${source}.`,
    "FAKTENBLATT",
    lines.join("\n"),
    "KONTEXT",
    sheet.context || (sheet.language === "en" ? "No further context." : "Kein weiterer Kontext."),
    titleBlock,
    "KAPITEL",
    wanted.map(def => def.id).join(", "),
    redoLine ? `NEU SCHREIBEN\n${redoLine}` : "",
    sheet.language === "en"
      ? "Use each token once, as a fixed phrase. Do not repeat dollars, percent, or an article in front of a token. Do not write the company or a peer as bare words. Use of [[peer_a]] or the stock of [[peer_a]]. Date tokens are the bare phrase. You choose as of, for, or from. For today or yesterday say from the age token. For a duration say the report is that many days old. Do not put ago before the age token."
      : "Setze jedes Token einmal als feste Wendung. Wiederhole Dollar oder Prozent nicht und setze keinen Artikel davor. Schreibe die Firma und Vergleichsfirmen nicht als nackte Wörter. Sag von [[peer_a]] oder die Aktie von [[peer_a]]. Datumstoken sind die nackte Phrase. Du wählst auf den oder für den. Bei heute oder gestern sagst du von dem Alterstoken. Bei einer Dauer sagst du ist das Alterstoken alt. Sag nicht vor vor dem Alterstoken.",
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

export interface ChapterPayload {
  paragraphs: Map<string, string>;
  /** null je Kapitel heißt: entities fehlt. [] ohne none ist kein gültiges Ergebnis. */
  entities: Map<string, string[] | null>;
  /** Kapitel, deren entities-Feld da ist, aber kein Array aus Zeichenketten. */
  invalidEntities: Set<string>;
  /** Kapitel mit none true. Nur das schaltet die Namensliste als leer frei. */
  none: Set<string>;
  /** null heißt: titles fehlt oder ist ungültig. */
  titles: Array<{ raw: string; text: string }> | null;
}

export function readChapterPayload(data: unknown): ChapterPayload {
  const paragraphs = readParagraphs(data);
  const entities = new Map<string, string[] | null>();
  const invalidEntities = new Set<string>();
  const none = new Set<string>();
  const chapters = data && typeof data === "object" && Array.isArray((data as { chapters?: unknown }).chapters)
    ? (data as { chapters: unknown[] }).chapters
    : [];
  for (const row of chapters) {
    if (!row || typeof row !== "object") continue;
    const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : "";
    if (!id) continue;
    if ((row as { none?: unknown }).none === true) none.add(id);
    if (!Object.prototype.hasOwnProperty.call(row, "entities")) {
      if (none.has(id)) entities.set(id, []);
      continue;
    }
    const listed = (row as { entities?: unknown }).entities;
    if (listed == null || !Array.isArray(listed) || listed.some(item => typeof item !== "string")) {
      entities.set(id, null);
      invalidEntities.add(id);
      continue;
    }
    entities.set(id, listed as string[]);
  }
  const titles = data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "titles")
    && Array.isArray((data as { titles?: unknown }).titles)
    ? readTitleMap(data)
    : null;
  return { paragraphs, entities, invalidEntities, none, titles };
}

const EN_CHAPTER_TITLE: Record<string, string> = {
  einstieg: "Opening",
  zusammenfassung: "Executive Summary",
  these: "Thesis",
  umsatz: "Revenue",
  s13: "Moat and Porter",
  s14: "PESTEL",
  dcf: "Valuation",
  s17: "Catalysts",
  inversion: "Inversion",
  earnings: "Earnings Call",
  news: "News",
  "news-llm": "News link",
  schluss: "Closing",
};

function chapterShell(def: { id: string; title: string; llmOwned: boolean }, spoken: string, llmOwned: boolean, language: PodcastLanguage): StockPodcastChapter {
  const title = language === "en" ? (EN_CHAPTER_TITLE[def.id] ?? def.title) : def.title;
  const words = spoken.split(/\s+/).filter(Boolean).length;
  return {
    id: def.id,
    title,
    label: title,
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
  notes: string[];
  spoken: string;
  entityState?: "ok" | "missing" | "invalid";
}

function namesThatMustBeListed(sheet: SpeechSheet, chapterId: string): string[] {
  const lexicon = sheet.language === "de" ? DE_LEXICON : EN_LEXICON;
  const names = [...(sheet.realNames ?? [])];
  for (const fact of factsForChapter(sheet, chapterId)) {
    for (const word of fact.spoken.split(/[^A-Za-zÄÖÜäöüß0-9]+/)) {
      if (!wordHasNameForm(word)) continue;
      const lower = word.toLowerCase();
      if (lower.length < 2 || lexicon.has(lower) || names.includes(lower)) continue;
      names.push(lower);
    }
  }
  return names;
}

function mentionsListedName(raw: string, sheet: SpeechSheet, chapterId: string): boolean {
  const lexicon = sheet.language === "de" ? DE_LEXICON : EN_LEXICON;
  for (const name of namesThatMustBeListed(sheet, chapterId)) {
    if (name.length < 2 || lexicon.has(name)) continue;
    if (entityMentioned(name, raw) || entityMentioned(`${name}s`, raw)) return true;
  }
  return false;
}

function tokenInsertedNames(raw: string, sheet: SpeechSheet): string[] {
  const names: string[] = [];
  const tokenRe = /\[\[([a-z0-9_]+)\]\]/g;
  let match: RegExpExecArray | null = tokenRe.exec(raw);
  while (match) {
    const id = match[1];
    if (id === "company" || id === "ticker") {
      const spoken = sheet.facts.find(fact => fact.id === id)?.spoken ?? "";
      for (const word of spoken.split(/[^A-Za-zÄÖÜäöüß0-9]+/)) {
        if (word.length >= 2 && !names.includes(word)) names.push(word);
      }
    }
    match = tokenRe.exec(raw);
  }
  return names;
}

function entityField(
  entities: Map<string, string[] | null> | null | undefined,
  invalid: Set<string> | undefined,
  id: string,
  raw: string,
  sheet: SpeechSheet,
  none = false,
): { state: "ok" | "missing" | "invalid"; names: string[] | null } {
  if (invalid?.has(id)) return { state: "invalid", names: null };
  if (!entities?.has(id)) return { state: "missing", names: null };
  const listed = entities.get(id);
  if (!Array.isArray(listed)) return { state: "missing", names: null };
  if (listed.length === 0 && !none) return { state: "missing", names: null };
  return { state: "ok", names: listed };
}

export function seedDrafts(
  sheet: SpeechSheet,
  source: StockPodcastSource,
  modelData: unknown,
  entities?: Map<string, string[] | null> | null,
  invalid?: Set<string>,
  none?: Set<string>,
): FluentDraft[] {
  const found = readParagraphs(modelData);
  const drafts: FluentDraft[] = [];
  for (const def of chaptersForSource(source)) {
    if (def.id === "schluss") continue;
    if (!factsForChapter(sheet, def.id).length) continue;
    const raw = found.get(def.id) ?? "";
    if (!raw) {
      drafts.push({ id: def.id, attempts: 1, reasons: ["empty"], notes: ["empty"], spoken: "" });
      continue;
    }
    const field = entityField(entities, invalid, def.id, raw, sheet, none?.has(def.id) === true);
    if (field.state !== "ok") {
      drafts.push({
        id: def.id,
        attempts: 1,
        reasons: ["entities"],
        notes: ["entities fehlt"],
        spoken: raw,
        entityState: field.state,
      });
      continue;
    }
    const verdict = verifyChapter(def.id, raw, sheet, mergeEntityLists(field.names, tokenInsertedNames(raw, sheet)), none?.has(def.id) === true);
    drafts.push({
      id: def.id,
      attempts: 1,
      reasons: verdict.ok ? [] : verdict.reasons,
      notes: verdict.ok ? [] : verdict.notes,
      spoken: verdict.ok ? appendCodeLines(verdict.spoken, sheet, def.id) : raw,
      entityState: "ok",
    });
  }
  return drafts;
}

export function applyRedo(
  sheet: SpeechSheet,
  drafts: FluentDraft[],
  modelData: unknown,
  entities?: Map<string, string[] | null> | null,
  prior?: Map<string, string[] | null> | null,
  invalid?: Set<string>,
  none?: Set<string>,
): FluentDraft[] {
  const found = readParagraphs(modelData);
  return drafts.map(draft => {
    if (!draft.reasons.length || draft.reasons[0] === "empty" || draft.reasons[0] === "timeout") return draft;
    const raw = found.get(draft.id) ?? "";
    if (!raw) return { ...draft, attempts: draft.attempts + 1, reasons: ["empty"], notes: ["empty"], spoken: "" };
    const field = entityField(entities, invalid, draft.id, raw, sheet, none?.has(draft.id) === true);
    if (field.state !== "ok") {
      return {
        ...draft,
        attempts: draft.attempts + 1,
        reasons: ["entities"],
        notes: ["entities fehlt"],
        spoken: raw,
        entityState: field.state,
      };
    }
    const priorListed = prior?.get(draft.id);
    const priorNames = Array.isArray(priorListed) ? priorListed : [];
    const verdict = verifyChapter(draft.id, raw, sheet, mergeEntityLists(priorNames, mergeEntityLists(field.names, tokenInsertedNames(raw, sheet))), none?.has(draft.id) === true);
    return {
      id: draft.id,
      attempts: draft.attempts + 1,
      reasons: verdict.ok ? [] : verdict.reasons,
      notes: verdict.ok ? [] : verdict.notes,
      spoken: verdict.ok ? appendCodeLines(verdict.spoken, sheet, draft.id) : raw,
      entityState: "ok",
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
      chapters.push(chapterShell(def, spoken, false, sheet.language));
      reports.push({ id: def.id, attempts: 1, fallback: null });
      continue;
    }
    const draft = drafts.find(row => row.id === def.id);
    const codeSpoken = appendCodeLines("", sheet, def.id);
    if (!draft) {
      if (!codeSpoken) continue;
      chapters.push(chapterShell(def, codeSpoken, false, sheet.language));
      reports.push({ id: def.id, attempts: 1, fallback: null });
      continue;
    }
    if (!draft.reasons.length) {
      chapters.push(chapterShell(def, draft.spoken, true, sheet.language));
      reports.push({ id: def.id, attempts: draft.attempts, fallback: null });
      continue;
    }
    const spoken = fallbackParagraph(def.id, sheet);
    if (!spoken) continue;
    const reason = draft.reasons[0] ?? "verifier";
    dropped.total += 1;
    dropped.byReason[reason] = (dropped.byReason[reason] ?? 0) + 1;
    chapters.push(chapterShell(def, spoken, false, sheet.language));
    reports.push({ id: def.id, attempts: draft.attempts, fallback: reason });
  }
  return { chapters, dropped, reports };
}

export function brokenDrafts(drafts: FluentDraft[]): FluentDraft[] {
  return drafts.filter(draft => draft.reasons.length > 0 && draft.reasons[0] !== "empty" && draft.reasons[0] !== "timeout");
}

/** Pack, das Doublecheck je Hold-out-Fall übergibt. */
export interface HoldoutNamePack {
  company: string;
  peers: string[];
  segments: string[];
  regions: string[];
}

function holdoutTokens(value: string): string[] {
  return value.split(/[^A-Za-zÄÖÜäöüß0-9]+/).map(word => word.toLowerCase()).filter(word => word.length >= 2);
}

function sheetFromHoldout(pack: HoldoutNamePack, language: PodcastLanguage, chapterId: string): SpeechSheet {
  const phrases = [pack.company, ...pack.peers, ...pack.segments, ...pack.regions];
  const tokens = phrases.flatMap(holdoutTokens);
  const slot = language === "de" ? "der belegte stand der firma im jahr" : "the verified view of the firm this year";
  const facts: SpeechFact[] = [
    { id: "company", spoken: pack.company, source: "holdout.company" },
    ...pack.peers.slice(0, 3).map((name, index) => ({ id: `peer_${"abc"[index] ?? "a"}`, spoken: name, source: "holdout.peers" })),
    ...pack.segments.map((name, index) => ({ id: `segment_${index}`, spoken: name, source: "holdout.segments" })),
    ...pack.regions.map((name, index) => ({ id: `region_${index}`, spoken: name, source: "holdout.regions" })),
  ];
  for (const id of CHAPTER_FACT_IDS[chapterId] ?? []) {
    if (!facts.some(fact => fact.id === id)) facts.push({ id, spoken: slot, source: "holdout.slot" });
  }
  return {
    language,
    facts,
    context: phrases.join("\n"),
    pendingTitles: [],
    codeLines: [],
    packNames: tokens,
    realNames: [pack.company, ...pack.peers].flatMap(holdoutTokens),
    realPhrases: [pack.company, ...pack.peers, ...pack.regions],
    nearTitleNames: [],
    placeNames: pack.regions,
  };
}

/**
 * Hold-out-Spalten.
 * list: modelNames. none: none true. empty: [] geht durch entityField und seedDrafts.
 * redo ist wahr, wenn die Gründe des Entwurfs „entities“ enthalten. Kein festes redo.
 */
export function judgeHoldoutName(input: {
  pack: HoldoutNamePack;
  language: PodcastLanguage;
  chapterId: string;
  text: string;
  column: "list" | "none" | "empty";
  modelNames?: string[];
}): { ok: boolean; redo: boolean; reasons: string[]; notes: string[] } {
  const sheet = sheetFromHoldout(input.pack, input.language, input.chapterId);
  if (input.column === "empty" || input.column === "none") {
    const source: StockPodcastSource = chaptersForSource("pdf").some(def => def.id === input.chapterId) ? "pdf" : "ki";
    const none = input.column === "none";
    const drafts = seedDrafts(sheet, source, {
      chapters: [{ id: input.chapterId, paragraph: input.text, entities: [], ...(none ? { none: true } : {}) }],
    }, new Map([[input.chapterId, []]]), new Set(), none ? new Set([input.chapterId]) : new Set());
    const draft = drafts.find(row => row.id === input.chapterId);
    const reasons = draft?.reasons ?? [];
    const notes = draft?.notes ?? [];
    const redo = none ? reasons.length > 0 : reasons.includes("entities");
    return { ok: reasons.length === 0, redo, reasons, notes };
  }
  const names = input.column === "list" ? (input.modelNames ?? []) : [];
  const verdict = verifyChapter(input.chapterId, input.text, sheet, names);
  return { ok: verdict.ok, redo: false, reasons: verdict.reasons, notes: verdict.notes };
}
