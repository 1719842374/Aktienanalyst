/**
 * Gemeinsamer Earnings-Call-Abruf für KI-Chat (chat-earnings-route), Researcher-Podcast
 * (podcast-sources) und Aktien-Podcast (stock-podcast-route). Eine Stelle, keine Kopie.
 *
 * Reihenfolge:
 *   1. FMP stable /earning-call-transcript-dates → neuester Termin nach Datum (latestTranscriptSlot).
 *      Antwortet stable mit 402/403/404, folgt ein Diagnose-Versuch auf /api/v4/earning_call_transcript.
 *   2. FMP stable /earning-call-transcript für genau diesen Termin, bei 402/403/404 /api/v3 als Versuch.
 *   3. Ohne Transkript: SEC EDGAR, neuestes 8-K mit Item 2.02 bzw. 6-K mit Quartalsmeldung → EX-99.1.
 * Jeder Schritt hinterlässt eine Diagnosezeile (HTTP-Status + gekürzter Vendor-Text, nie der Key).
 * Kein Score-Pfad, kein Schema. Fehlt alles, bleibt das Ergebnis n/a mit Grund.
 */
import { latestTranscriptSlot, transcriptContent, type TranscriptSlot } from "../shared/chat-earnings";
import type { EarningsCallMeta } from "../shared/stock-podcast";
import { FMP_LEGACY_BASE, fmpObserved } from "./fmp";
import { adrCandidatesFor } from "./fmp-adr-map";
import { SEC_USER_AGENT, getCikForTicker, htmlToText } from "./sec-segments";

export const EARNINGS_SOURCE_PARAMS = {
  /** Diese Stable-Status lösen den Legacy-Diagnoseversuch aus (Plan, Freischaltung, Pfad). */
  legacyRetryStatuses: [402, 403, 404] as readonly number[],
  /** So viele jüngste SEC-Filings werden nach einer Quartalsmeldung durchsucht. */
  secScanLimit: 25,
  /** Höchstens so viele EX-99-Dokumente werden geladen, bevor die Suche aufgibt. */
  secExhibitFetchLimit: 4,
  secTimeoutMs: 15_000,
  /** Quartal/Jahr werden nur im Kopf der Meldung gesucht, damit Vorjahresvergleiche nicht greifen. */
  quarterHeadChars: 1500,
  /** Ein 6-K zählt als Quartalsmeldung, wenn der Kopf dieses Muster trägt. */
  secResultsPattern: /\b(quarter|Q[1-4]|half[- ]year|results)\b[\s\S]{0,200}\b(results|revenue|earnings)\b/i,
  /** Gelöste Calls je Symbol im Prozess, damit FMP-Dates nicht bei jedem Öffnen laufen. */
  memoTtlMs: 6 * 60 * 60 * 1000,
} as const;

export interface FetchedEarningsCall {
  status: "ok" | "n/a";
  reason: string | null;
  meta: EarningsCallMeta | null;
  /** Volltext der Quelle (Transkript oder Pressemitteilung). null bei n/a. */
  content: string | null;
  diagnostics: string[];
}

/** FMP führt SAP.DE als SAP. Ohne ADR-Eintrag bleibt das Symbol unverändert. */
export function transcriptSymbolFor(symbol: string): string {
  const s = symbol.toUpperCase();
  return adrCandidatesFor(s)[0]?.symbol ?? s;
}

type Observed = { status: number; json: unknown | null; detail: string };
export type ObservedFetch = (path: string, params: Record<string, string>, base?: string) => Promise<Observed>;

function diag(label: string, r: Observed): string {
  if (r.status === 0) return `${label}: ${r.detail || "nicht erreichbar"}`;
  return `${label}: HTTP ${r.status}${r.detail ? ` — ${r.detail}` : ""}`;
}

function fmpError(r: Observed): Error {
  if (r.status === 0 && /FMP_API_KEY/.test(r.detail)) return new Error("FMP_API_KEY not set");
  return Object.assign(new Error(`FMP ${r.status || "unreachable"}: ${r.detail}`), r.status ? { fmpStatus: r.status } : {});
}

/** /api/v4 liefert [[quarter, year, date], …]; stable liefert Objekte. Beides → {fiscalYear, quarter, date}. */
export function normalizeTranscriptDates(rows: unknown): Array<{ fiscalYear: number; quarter: number; date: string }> {
  if (!Array.isArray(rows)) return [];
  const out: Array<{ fiscalYear: number; quarter: number; date: string }> = [];
  for (const row of rows) {
    if (Array.isArray(row) && row.length >= 3) {
      out.push({ quarter: Number(row[0]), fiscalYear: Number(row[1]), date: String(row[2]) });
    } else if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      out.push({ fiscalYear: Number(r.fiscalYear ?? r.year), quarter: Number(r.quarter), date: String(r.date ?? "") });
    }
  }
  return out;
}

async function datesWithDiagnostics(symbol: string, fetchFn: ObservedFetch, diagnostics: string[]): Promise<unknown[]> {
  const stable = await fetchFn("/earning-call-transcript-dates", { symbol });
  diagnostics.push(diag(`FMP stable/earning-call-transcript-dates?symbol=${symbol}`, stable));
  if (stable.status >= 200 && stable.status < 300) return normalizeTranscriptDates(stable.json);
  if (!EARNINGS_SOURCE_PARAMS.legacyRetryStatuses.includes(stable.status)) throw fmpError(stable);
  const legacy = await fetchFn("/v4/earning_call_transcript", { symbol }, FMP_LEGACY_BASE);
  diagnostics.push(diag(`FMP api/v4/earning_call_transcript?symbol=${symbol}`, legacy));
  if (legacy.status >= 200 && legacy.status < 300) return normalizeTranscriptDates(legacy.json);
  throw fmpError(stable);
}

async function transcriptWithDiagnostics(symbol: string, slot: TranscriptSlot, fetchFn: ObservedFetch, diagnostics: string[]): Promise<unknown> {
  const params = { symbol, year: String(slot.year), quarter: String(slot.quarter) };
  const stable = await fetchFn("/earning-call-transcript", params);
  diagnostics.push(diag(`FMP stable/earning-call-transcript FY${slot.year} Q${slot.quarter}`, stable));
  if (stable.status >= 200 && stable.status < 300) return stable.json;
  if (!EARNINGS_SOURCE_PARAMS.legacyRetryStatuses.includes(stable.status)) throw fmpError(stable);
  const legacy = await fetchFn(`/v3/earning_call_transcript/${encodeURIComponent(symbol)}`,
    { year: params.year, quarter: params.quarter }, FMP_LEGACY_BASE);
  diagnostics.push(diag(`FMP api/v3/earning_call_transcript FY${slot.year} Q${slot.quarter}`, legacy));
  if (legacy.status >= 200 && legacy.status < 300) return legacy.json;
  throw fmpError(stable);
}

const defaultObserved: ObservedFetch = (path, params, base) => fmpObserved(path, params, base);

/** Default-Dep für buildEarningsBrief (Chat, Researcher): Termine mit Legacy-Versuch und ADR-Symbol. */
export async function fetchTranscriptDates(symbol: string, fetchFn: ObservedFetch = defaultObserved): Promise<unknown[]> {
  return datesWithDiagnostics(transcriptSymbolFor(symbol), fetchFn, []);
}

/** Default-Dep für buildEarningsBrief: Transkript eines Termins, Legacy-Versuch bei 402/403/404. */
export async function fetchTranscript(symbol: string, year: number, quarter: number, fetchFn: ObservedFetch = defaultObserved): Promise<unknown> {
  return transcriptWithDiagnostics(transcriptSymbolFor(symbol), { year, quarter, date: "" }, fetchFn, []);
}

// ── SEC-Fallback ─────────────────────────────────────────────────────────────

export interface SecDeps {
  cik: (ticker: string) => Promise<string | null>;
  getText: (url: string) => Promise<{ status: number; text: string }>;
}

const defaultSecDeps: SecDeps = {
  cik: getCikForTicker,
  getText: async (url) => {
    const resp = await fetch(url, {
      headers: { "User-Agent": SEC_USER_AGENT },
      signal: AbortSignal.timeout(EARNINGS_SOURCE_PARAMS.secTimeoutMs),
    });
    return { status: resp.status, text: resp.ok ? await resp.text() : "" };
  },
};

interface SecFiling { form: string; date: string; accession: string; items: string }

export function earningsFilingCandidates(submissions: unknown): SecFiling[] {
  const recent = (submissions as { filings?: { recent?: Record<string, unknown[]> } } | null)?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const out: SecFiling[] = [];
  const n = Math.min(recent.form.length, EARNINGS_SOURCE_PARAMS.secScanLimit);
  for (let i = 0; i < n; i++) {
    const form = String(recent.form[i]);
    const items = String(recent.items?.[i] ?? "");
    const isEarnings8k = form === "8-K" && items.split(",").map(s => s.trim()).includes("2.02");
    if (!isEarnings8k && form !== "6-K") continue;
    out.push({ form, items, date: String(recent.filingDate?.[i] ?? ""), accession: String(recent.accessionNumber?.[i] ?? "") });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Zeilen der Filing-Indexseite → Link des EX-99.1 (sonst des ersten EX-99). */
export function exhibitFromIndex(indexHtml: string): string | null {
  const rows = indexHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  let fallback: string | null = null;
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 4) continue;
    const type = htmlToText(cells[3]).toUpperCase();
    const href = /href="([^"]+)"/i.exec(cells[2])?.[1];
    if (!href) continue;
    const path = href.replace(/^\/ix\?doc=/, "");
    if (type === "EX-99.1") return `https://www.sec.gov${path}`;
    if (!fallback && /^EX-99(\.\d+)?$/.test(type)) fallback = `https://www.sec.gov${path}`;
  }
  return fallback;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

const NAMED_ENTITIES: Record<string, string> = { euro: "€", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", mdash: "—", ndash: "–", bull: "•", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', reg: "®", trade: "™", copy: "©" };

/** htmlToText lässt numerische und viele benannte Entities stehen; für Sprache müssen sie Zeichen sein. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

/** „quarter ended September 30, 2026“ → 2026-09-30. */
export function parsePeriodEnd(text: string): string | null {
  const head = text.slice(0, EARNINGS_SOURCE_PARAMS.quarterHeadChars);
  const m = /\b(?:quarter|period|months)\s+ended\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(head);
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[2].padStart(2, "0")}` : null;
}

/**
 * Quartal und Geschäftsjahr aus dem Kopf der Meldung. Nennt der Kopf nur das Quartal
 * („First Quarter Results“), bleibt das Geschäftsjahr null. Steht nichts da, null.
 */
export function parseFiscalQuarter(text: string): { fiscalYear: number | null; quarter: number } | null {
  const head = text.slice(0, EARNINGS_SOURCE_PARAMS.quarterHeadChars);
  const patterns: Array<[RegExp, (m: RegExpExecArray) => { fiscalYear: number | null; quarter: number }]> = [
    [/\b(first|second|third|fourth)\s+quarter(?:\s+(?:of\s+)?(?:fiscal\s+)?(?:year\s+)?)(\d{4})\b/i,
      m => ({ quarter: ORDINALS[m[1].toLowerCase()], fiscalYear: Number(m[2]) })],
    [/\bfiscal\s+(?:year\s+)?(\d{4})\s+(first|second|third|fourth)\s+quarter\b/i,
      m => ({ quarter: ORDINALS[m[2].toLowerCase()], fiscalYear: Number(m[1]) })],
    [/\bQ([1-4])\s*(?:FY\s?)?(\d{4}|\d{2})\b/i, m => ({ quarter: Number(m[1]), fiscalYear: fullYear(m[2]) })],
    [/\bFY\s?(\d{4}|\d{2})\s*Q([1-4])\b/i, m => ({ quarter: Number(m[2]), fiscalYear: fullYear(m[1]) })],
    [/\b(first|second|third|fourth)\s+quarter\b/i, m => ({ quarter: ORDINALS[m[1].toLowerCase()], fiscalYear: null })],
  ];
  for (const [re, pick] of patterns) {
    const m = re.exec(head);
    if (m) return pick(m);
  }
  return null;
}

export async function fetchSecEarningsRelease(symbol: string, deps: SecDeps, diagnostics: string[]): Promise<{ meta: EarningsCallMeta; content: string } | null> {
  const secSymbol = transcriptSymbolFor(symbol);
  const cik10 = await deps.cik(secSymbol);
  if (!cik10) {
    diagnostics.push(`SEC: kein CIK für ${secSymbol} in company_tickers.json`);
    return null;
  }
  const sub = await deps.getText(`https://data.sec.gov/submissions/CIK${cik10}.json`);
  diagnostics.push(`SEC submissions CIK${cik10}: HTTP ${sub.status}`);
  if (sub.status !== 200) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(sub.text); } catch { diagnostics.push("SEC submissions: JSON nicht lesbar"); return null; }
  const candidates = earningsFilingCandidates(parsed);
  if (!candidates.length) {
    diagnostics.push(`SEC: kein 8-K Item 2.02 / 6-K unter den letzten ${EARNINGS_SOURCE_PARAMS.secScanLimit} Filings`);
    return null;
  }
  const cik = String(Number(cik10));
  let fetched = 0;
  for (const f of candidates) {
    if (fetched >= EARNINGS_SOURCE_PARAMS.secExhibitFetchLimit) break;
    const accNoDash = f.accession.replace(/-/g, "");
    const idx = await deps.getText(`https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${f.accession}-index.html`);
    if (idx.status !== 200) { diagnostics.push(`SEC ${f.form} ${f.date} Index: HTTP ${idx.status}`); continue; }
    const url = exhibitFromIndex(idx.text);
    if (!url) { diagnostics.push(`SEC ${f.form} ${f.date}: kein EX-99`); continue; }
    fetched++;
    const doc = await deps.getText(url);
    if (doc.status !== 200) { diagnostics.push(`SEC ${f.form} ${f.date} EX-99: HTTP ${doc.status}`); continue; }
    const text = decodeEntities(htmlToText(doc.text));
    if (f.form === "6-K" && !EARNINGS_SOURCE_PARAMS.secResultsPattern.test(text.slice(0, EARNINGS_SOURCE_PARAMS.quarterHeadChars))) {
      diagnostics.push(`SEC 6-K ${f.date}: keine Quartalsmeldung`);
      continue;
    }
    const fq = parseFiscalQuarter(text);
    const periodEnd = parsePeriodEnd(text);
    const found = fq ? `Q${fq.quarter}${fq.fiscalYear != null ? ` FY${fq.fiscalYear}` : " (Geschäftsjahr im Kopf nicht genannt)"}` : "Quartal im Kopf nicht genannt";
    diagnostics.push(`SEC ${f.form} ${f.date} EX-99: ok (${found}${periodEnd ? `, Periodenende ${periodEnd}` : ""})`);
    return {
      content: text,
      meta: {
        kind: "sec-exhibit",
        fiscalYear: fq?.fiscalYear ?? null,
        quarter: fq?.quarter ?? null,
        periodEnd,
        date: f.date || null,
        sourceLabel: `SEC ${f.form} Exhibit 99.1 (Pressemitteilung, ${f.date})`,
        sourceUrl: url,
        sourceSymbol: secSymbol,
      },
    };
  }
  return null;
}

// ── Gesamtauflösung ──────────────────────────────────────────────────────────

export interface EarningsCallDeps {
  fmp: ObservedFetch;
  sec: SecDeps;
  now: () => number;
}

const memo = new Map<string, { at: number; value: FetchedEarningsCall }>();

export function resetEarningsCallMemo(): void {
  memo.clear();
}

const defaultDeps: EarningsCallDeps = { fmp: defaultObserved, sec: defaultSecDeps, now: () => Date.now() };

function fmpTranscriptUrl(symbol: string, slot: TranscriptSlot): string {
  return `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${encodeURIComponent(symbol)}&year=${slot.year}&quarter=${slot.quarter}`;
}

export async function resolveLatestEarningsCall(symbol: string, deps: EarningsCallDeps = defaultDeps): Promise<FetchedEarningsCall> {
  const key = symbol.toUpperCase();
  const hit = memo.get(key);
  if (hit && deps.now() - hit.at < EARNINGS_SOURCE_PARAMS.memoTtlMs) return hit.value;
  const fmpSymbol = transcriptSymbolFor(key);
  const diagnostics: string[] = [];
  if (fmpSymbol !== key) diagnostics.push(`FMP-Symbol ${fmpSymbol} für ${key} (ADR-Map)`);
  let fmpReason = "";
  try {
    const slot = latestTranscriptSlot(await datesWithDiagnostics(fmpSymbol, deps.fmp, diagnostics));
    if (!slot) fmpReason = "FMP lieferte keinen Earnings-Call-Termin";
    else {
      const content = transcriptContent(await transcriptWithDiagnostics(fmpSymbol, slot, deps.fmp, diagnostics));
      if (content) {
        const value: FetchedEarningsCall = {
          status: "ok", reason: null, content, diagnostics,
          meta: {
            kind: "fmp-transcript", fiscalYear: slot.year, quarter: slot.quarter, periodEnd: null, date: slot.date,
            sourceLabel: `FMP Earnings-Call-Transkript (Q${slot.quarter} FY${slot.year}, ${slot.date})`,
            sourceUrl: fmpTranscriptUrl(fmpSymbol, slot), sourceSymbol: fmpSymbol,
          },
        };
        memo.set(key, { at: deps.now(), value });
        return value;
      }
      fmpReason = `FMP lieferte kein Transkript für FY${slot.year} Q${slot.quarter}`;
    }
  } catch (err) {
    const e = err as { message?: string; fmpStatus?: number };
    fmpReason = typeof e?.fmpStatus === "number" ? `FMP antwortete HTTP ${e.fmpStatus}`
      : /FMP_API_KEY/.test(String(e?.message)) ? "FMP_API_KEY nicht konfiguriert" : "FMP nicht erreichbar";
  }
  let sec: Awaited<ReturnType<typeof fetchSecEarningsRelease>> = null;
  try {
    sec = await fetchSecEarningsRelease(key, deps.sec, diagnostics);
  } catch (err) {
    diagnostics.push(`SEC: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
  if (!sec) return { status: "n/a", reason: `n/a — ${fmpReason}; SEC-Fallback ohne Quartalsmeldung`, meta: null, content: null, diagnostics };
  const value: FetchedEarningsCall = {
    status: "ok", reason: `Kein FMP-Transkript (${fmpReason}); Quelle ist die SEC-Pressemitteilung`,
    meta: sec.meta, content: sec.content, diagnostics,
  };
  memo.set(key, { at: deps.now(), value });
  return value;
}
