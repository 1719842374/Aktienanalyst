/**
 * server/sec-segments.ts
 *
 * FALLBACK #2 in the revenue-segment pipeline (see server/analyze-route.ts,
 * "Revenue segments" section, and the disk-cache usage there).
 *
 * WHY THIS FILE EXISTS:
 * FMP's /revenue-product-segmentation endpoint (server/fmp.ts: fmpSegments())
 * returns an empty array for a meaningful slice of tickers — verified live for
 * IREN (2026-08): FMP has geographic data (Australia/Canada) but NO business-
 * segment breakdown, because FMP simply never ingested it from the filer.
 * The company itself DOES disclose segment-level revenue (Bitcoin Mining vs.
 * AI Cloud Services) in its SEC filing — it's just missing from FMP's dataset.
 *
 * This module is the SEC EDGAR fallback:
 *   1. Ticker -> CIK          (SEC's static company_tickers.json, cached in-process)
 *   2. CIK -> latest filing   (SEC submissions API, form 10-K OR 20-F — issuer
 *                              status changes over time; IREN itself switched
 *                              from 20-F to 10-K starting FY2025, so BOTH form
 *                              types must be checked, newest first, never hardcoded
 *                              to one type)
 *   3. Filing HTML -> raw text window around segment/revenue-disaggregation
 *      keywords (regex-based; no cheerio dependency added — keeps the "additive
 *      only" rule for package.json)
 *   4. Raw text -> structured { name, revenue, percentage, fiscalYear }[] via
 *      the existing OpenRouter LLM fallback chain (server/llm-openrouter.ts,
 *      callLLMJson). The LLM is instructed to ONLY extract numbers that are
 *      literally present in the given excerpt and to return an EMPTY array on
 *      any doubt — it must never invent a segment or a number.
 *
 * Ticker-agnostic: nothing here special-cases IREN. IREN is only the verified
 * test case (10-K FY2025, Bitcoin Mining $484.6M / 96.7%, AI Cloud Services
 * $16.4M / 3.3%, https://www.sec.gov/Archives/edgar/data/1878848/000187884825000063/iren-20250630.htm).
 *
 * Caching: callers are expected to wrap this with disk-cache.ts
 * (diskResearcherGet/diskResearcherSet, key `segments__<TICKER>`, TTL handled
 * by the researcher_cache table which already runs on a 24h TTL — appropriate
 * since SEC filings change ~once per quarter).
 */

import { callLLMJson } from "./llm-openrouter";

const SEC_USER_AGENT = "StockAnalystPro contact@stockanalyst-pro.app";
const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";

export interface SecRevenueSegment {
  name: string;
  revenue: number; // in reporting currency, absolute (not thousands)
  percentage: number;
  fiscalYear?: string;
  // Auftrag 09.08.2026 ("Segment-Wachstum aus SEC-/Geschäftsberichten
  // extrahieren"): Vorjahres-Umsatz derselben Segmentzeile, falls im selben
  // Filing-Ausschnitt eine Vorjahresvergleichsspalte vorhanden ist (10-Ks
  // haben praktisch immer eine 2-Jahres-Vergleichstabelle in der Segment-
  // Note). null/undefined wenn keine belastbare Vorjahreszahl im Text stand
  // -- NIEMALS eine geratene Zahl. growth wird daraus abgeleitet, NIE selbst
  // vom LLM geschaetzt.
  prevRevenue?: number | null;
  noPriorYearMatch?: boolean; // Segment-Zuschnitt geändert/umbenannt -- kein YoY erzwingen
}

export interface SecSegmentResult {
  segments: SecRevenueSegment[];
  fiscalYear?: string; // e.g. "FY2025"
  formType?: "10-K" | "20-F";
  filingUrl?: string;
}

// --- Step 1: Ticker -> CIK -------------------------------------------------
// SEC publishes a single static JSON mapping every registrant's ticker to its
// CIK. ~1MB, changes rarely — cache in-process for the life of the server.
let _tickerCikCache: Map<string, string> | null = null;
let _tickerCikCacheAt = 0;
const TICKER_CIK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — new IPOs are rare enough

async function loadTickerCikMap(): Promise<Map<string, string>> {
  if (_tickerCikCache && Date.now() - _tickerCikCacheAt < TICKER_CIK_CACHE_TTL_MS) {
    return _tickerCikCache;
  }
  const resp = await fetch(TICKER_MAP_URL, {
    headers: { "User-Agent": SEC_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`SEC company_tickers.json ${resp.status}`);
  const raw = (await resp.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map = new Map<string, string>();
  for (const row of Object.values(raw)) {
    if (row?.ticker) map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  }
  _tickerCikCache = map;
  _tickerCikCacheAt = Date.now();
  return map;
}

export async function getCikForTicker(ticker: string): Promise<string | null> {
  try {
    const map = await loadTickerCikMap();
    return map.get(ticker.toUpperCase()) ?? null;
  } catch (err: any) {
    console.warn(`[SEC-SEGMENTS] CIK lookup failed for ${ticker}: ${err?.message}`);
    return null;
  }
}

// RPO (Remaining Performance Obligation) via SEC XBRL Company Concept API --
// nur fuer US-Ticker mit SEC-Filing verfuegbar. Liefert die letzten 2-3
// Datenpunkte (chronologisch), um daraus ein YoY-Wachstum abzuleiten.
// Gibt null zurueck wenn kein CIK gefunden wird, das Tag fehlt, oder der
// SEC-Call fehlschlaegt -- NIEMALS geraten/geschaetzt (Zahlen-Prinzip).
export async function fetchSecRpo(ticker: string): Promise<{ latest: number; previous: number | null; asOf: string } | null> {
  const cik = await getCikForTicker(ticker);
  if (!cik) return null;
  const cik10 = cik.padStart(10, "0");
  try {
    const resp = await fetch(
      `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik10}/us-gaap/RevenueRemainingPerformanceObligation.json`,
      { headers: { "User-Agent": SEC_USER_AGENT }, signal: AbortSignal.timeout(15000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const points = (data?.units?.USD ?? []) as Array<{ end: string; val: number; form: string }>;
    // Nur 10-K/10-Q-Werte, nach Datum aufsteigend sortiert, letzte 2 Punkte.
    const usable = points
      .filter(p => (p.form === "10-K" || p.form === "10-Q") && typeof p.val === "number" && p.val > 0)
      .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());
    if (usable.length === 0) return null;
    const latest = usable[usable.length - 1];
    const previous = usable.length >= 5 ? usable[usable.length - 5] : null; // ~1 Jahr zurück bei Quartalsdaten
    return { latest: latest.val, previous: previous?.val ?? null, asOf: latest.end };
  } catch {
    return null; // Netzwerkfehler/Timeout -> null, kein Crash, kein Rateergebnis
  }
}

// --- Step 2: CIK -> latest 10-K/20-F filing --------------------------------
// SEC filer status can change over time (e.g. IREN: 20-F through FY2024,
// 10-K from FY2025 onward after re-domiciling/graduating disclosure regime).
// We must NEVER hardcode one form type — always check both and pick whichever
// is newest by filing date.
interface FilingRef {
  formType: "10-K" | "20-F";
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
}

async function getLatestAnnualFiling(cik10: string): Promise<FilingRef | null> {
  const url = `https://data.sec.gov/submissions/CIK${cik10}.json`;
  const resp = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`SEC submissions ${resp.status}`);
  const data = await resp.json();
  const recent = data?.filings?.recent;
  if (!recent?.form) return null;

  const forms: string[] = recent.form;
  const dates: string[] = recent.filingDate;
  const accessions: string[] = recent.accessionNumber;
  const docs: string[] = recent.primaryDocument;

  let best: FilingRef | null = null;
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (form !== "10-K" && form !== "20-F") continue; // both form types accepted, order-agnostic
    if (!best || dates[i] > best.filingDate) {
      best = {
        formType: form as "10-K" | "20-F",
        filingDate: dates[i],
        accessionNumber: accessions[i],
        primaryDocument: docs[i],
      };
    }
  }
  return best;
}

function buildFilingUrl(cikNoLeadingZeros: string, accessionNumber: string, primaryDocument: string): string {
  const accNoDash = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accNoDash}/${primaryDocument}`;
}

// --- Step 3: Filing HTML -> relevant text excerpt ---------------------------
// Segment/revenue-disaggregation notes use fairly consistent keywords across
// filers ("reportable segment", "segment information", "disaggregat.*revenue",
// "revenue by segment", "<Segment Name> Revenue $"). We strip tags, collapse
// whitespace, then take a generous context window (±NNN chars) around each
// keyword hit and concatenate — small enough to stay within LLM context, large
// enough to usually contain the actual revenue table.
const SEGMENT_KEYWORDS = [
  /reportable segments?/i,
  /segment information/i,
  /disaggregat\w* revenue/i,
  /revenue by segment/i,
  /revenue.{0,20}disaggregation/i,
];

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts a bounded set of text windows around segment-revenue keywords.
 * Returns "" if nothing matched (caller must treat that as "not found").
 */
function extractSegmentExcerpt(fullText: string, maxTotalChars = 12000): string {
  const windows: string[] = [];
  const seenRanges: Array<[number, number]> = [];
  const WINDOW = 900;

  for (const kw of SEGMENT_KEYWORDS) {
    const re = new RegExp(kw.source, kw.flags.includes("g") ? kw.flags : kw.flags + "g");
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = re.exec(fullText)) !== null && count < 6) {
      count++;
      const start = Math.max(0, match.index - WINDOW / 3);
      const end = Math.min(fullText.length, match.index + WINDOW);
      // Skip if this overlaps a window we already captured (avoid duplication)
      const overlaps = seenRanges.some(([s, e]) => start < e && end > s);
      if (!overlaps) {
        seenRanges.push([start, end]);
        windows.push(fullText.substring(start, end));
      }
      if (windows.join("\n---\n").length > maxTotalChars) break;
    }
  }

  // Additionally: revenue tables often list "<Name> Revenue $ 123,456" lines
  // even without any of the keywords above nearby (e.g. IREN's income
  // statement disaggregation). Grab a couple of windows around "Total revenue"
  // too, since that anchors the actual $ figures table.
  const totalRevRe = /Total revenue/g;
  let trMatch: RegExpExecArray | null;
  let trCount = 0;
  while ((trMatch = totalRevRe.exec(fullText)) !== null && trCount < 4) {
    trCount++;
    const start = Math.max(0, trMatch.index - 600);
    const end = Math.min(fullText.length, trMatch.index + 200);
    const overlaps = seenRanges.some(([s, e]) => start < e && end > s);
    if (!overlaps) {
      seenRanges.push([start, end]);
      windows.push(fullText.substring(start, end));
    }
    if (windows.join("\n---\n").length > maxTotalChars) break;
  }

  return windows.join("\n---\n").substring(0, maxTotalChars);
}

// --- Step 4: LLM-structured extraction --------------------------------------
// STRICT instruction: only extract numbers literally present in the given
// excerpt. Return an empty array if the excerpt doesn't contain a clear
// segment/product-revenue breakdown. The LLM must NEVER invent figures.
async function extractSegmentsWithLLM(
  excerpt: string,
  ticker: string,
  companyName: string
): Promise<{ segments: SecRevenueSegment[]; fiscalYear?: string } | null> {
  if (!excerpt || excerpt.length < 100) return null;

  const prompt = `Du bekommst einen Rohtext-Ausschnitt aus einem SEC-Filing (10-K oder 20-F) von ${companyName} (${ticker}).

AUFGABE: Extrahiere NUR die Umsatzaufteilung nach Geschäftssegmenten/Produktlinien (NICHT nach Regionen/Ländern), falls im Text vorhanden.

STRIKTE REGELN:
- Extrahiere AUSSCHLIESSLICH Zahlen, die WÖRTLICH im gegebenen Text stehen.
- ERFINDE NIEMALS Zahlen oder Segmentnamen.
- Falls der Text KEINE klare Segment-Umsatzaufteilung enthält (z.B. nur Fließtext ohne Zahlen, oder nur geografische Aufteilung), gib ein LEERES Array zurück.
- Nutze die NEUESTE / letzte volle Berichtsperiode (meist die erste Zahlenspalte in einer Jahresvergleichstabelle).
- WICHTIG (Vorjahresvergleich): SEC-Segmentnotes enthalten fast immer eine 2-Jahres-Vergleichstabelle (aktuelle Periode + Vorjahresperiode nebeneinander). Falls eine Vorjahresspalte für dieselbe Segmentzeile im Text vorhanden ist, extrahiere den Vorjahreswert als "prevRevenue". Nur wenn der Text WÖRTLICH eine zweite Zahlenspalte für dasselbe Segment zeigt — sonst prevRevenue weglassen (null), NIEMALS schätzen oder aus einer Wachstumsrate rückrechnen.
- Falls sich der Segment-Zuschnitt zwischen den beiden Jahren offensichtlich geändert hat (Segment umbenannt, aufgespalten, oder im Vorjahr nicht separat ausgewiesen), setze "noPriorYearMatch": true für dieses Segment und lasse prevRevenue weg — erzwinge KEIN falsches YoY.
- Berechne percentage als (segment revenue / Summe aller Segment-Revenues) * 100, gerundet auf 1 Nachkommastelle.
- revenue und prevRevenue in absoluten Dollar/Währungseinheiten angeben (falls der Text "in USD thousands" o.ä. sagt, MULTIPLIZIERE mit 1000; falls "in millions", MULTIPLIZIERE mit 1000000).
- Gib fiscalYear als String an (z.B. "FY2025" oder "2025-06-30"), falls im Text erkennbar, sonst weglassen.

TEXT-AUSSCHNITT:
"""
${excerpt}
"""

Antworte NUR mit JSON in diesem Format:
{"segments": [{"name": "...", "revenue": 123456789, "prevRevenue": 110000000, "percentage": 96.7}], "fiscalYear": "FY2025"}

Falls keine verlässliche Segment-Aufteilung im Text erkennbar ist: {"segments": [], "fiscalYear": null}`;

  const result = await callLLMJson({
    prompt,
    maxTokens: 1200,
    temperature: 0.1,
    systemPrompt: "Du bist ein präziser Finanzdaten-Extraktor. Du erfindest NIEMALS Zahlen. Du gibst NUR JSON zurück.",
  });

  if (!result?.data) return null;
  const segs = Array.isArray(result.data.segments) ? result.data.segments : [];
  const clean: SecRevenueSegment[] = segs
    .filter((s: any) => s && typeof s.name === "string" && Number(s.revenue) > 0)
    .map((s: any) => {
      // Nur eine PLAUSIBLE Vorjahreszahl uebernehmen: muss ein positiver,
      // endlicher Wert sein UND vom LLM nicht als "kein Match" markiert sein.
      // Kein 0-Default -- fehlende/unplausible Werte bleiben undefined, damit
      // die UI "n/a" statt eine falsche 0%-Wachstumsrate zeigt.
      const prevRevenueRaw = Number(s.prevRevenue);
      const hasPlausiblePrevRevenue = !s.noPriorYearMatch && typeof s.prevRevenue === "number" && isFinite(prevRevenueRaw) && prevRevenueRaw > 0;
      return {
        name: String(s.name).trim(),
        revenue: Number(s.revenue),
        percentage: typeof s.percentage === "number" ? s.percentage : 0,
        fiscalYear: result.data.fiscalYear ?? undefined,
        ...(hasPlausiblePrevRevenue ? { prevRevenue: prevRevenueRaw } : {}),
        ...(s.noPriorYearMatch === true ? { noPriorYearMatch: true } : {}),
      };
    });

  return { segments: clean, fiscalYear: result.data.fiscalYear ?? undefined };
}

// --- Public entry point ------------------------------------------------------
/**
 * Runs the full SEC EDGAR fallback chain for one ticker. Returns null if any
 * step fails or no reliable segment data could be extracted — callers must
 * treat null as "SEC path unavailable", NOT as an error to surface to the user
 * (the analyze-route caller falls through to the "no data" message in that case).
 */
export async function fetchSecBusinessSegments(
  ticker: string,
  companyName: string
): Promise<SecSegmentResult | null> {
  try {
    const cik10 = await getCikForTicker(ticker);
    if (!cik10) {
      console.log(`[SEC-SEGMENTS] No CIK found for ${ticker} — not a US-listed SEC filer, skipping SEC fallback`);
      return null;
    }

    const filing = await getLatestAnnualFiling(cik10);
    if (!filing) {
      console.log(`[SEC-SEGMENTS] No 10-K/20-F found for ${ticker} (CIK ${cik10})`);
      return null;
    }

    const cikNoLeadingZeros = String(Number(cik10));
    const filingUrl = buildFilingUrl(cikNoLeadingZeros, filing.accessionNumber, filing.primaryDocument);

    const filingResp = await fetch(filingUrl, {
      headers: { "User-Agent": SEC_USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
    if (!filingResp.ok) {
      console.warn(`[SEC-SEGMENTS] Filing fetch failed for ${ticker}: ${filingResp.status} ${filingUrl}`);
      return null;
    }
    const html = await filingResp.text();
    const text = htmlToText(html);
    const excerpt = extractSegmentExcerpt(text);
    if (!excerpt) {
      console.log(`[SEC-SEGMENTS] No segment/revenue keywords found in ${filing.formType} for ${ticker}`);
      return null;
    }

    const extracted = await extractSegmentsWithLLM(excerpt, ticker, companyName);
    if (!extracted || extracted.segments.length === 0) {
      console.log(`[SEC-SEGMENTS] LLM found no reliable segment breakdown for ${ticker} in ${filing.formType} (${filing.filingDate})`);
      return null;
    }

    console.log(`[SEC-SEGMENTS] Extracted ${extracted.segments.length} segments for ${ticker} from ${filing.formType} (${filing.filingDate}): ${extracted.segments.map(s => `${s.name} ${s.percentage}%`).join(", ")}`);

    return {
      segments: extracted.segments,
      fiscalYear: extracted.fiscalYear,
      formType: filing.formType,
      filingUrl,
    };
  } catch (err: any) {
    console.warn(`[SEC-SEGMENTS] Fallback failed for ${ticker}: ${err?.message}`);
    return null;
  }
}
