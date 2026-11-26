/**
 * SEC EDGAR für den KI-Chat: companyfacts (XBRL), submissions, Filing-Text und der letzte
 * Earnings Release (8-K Item 2.02 bzw. 6-K, jeweils Exhibit 99.1). Kostenlos, ohne Key,
 * nur mit dem SEC-User-Agent aus sec-segments.ts. Kein Score, kein Analyse-Pfad.
 *
 * Ticker → CIK über company_tickers.json (getCikForTicker); lokale Listings ohne SEC-Filer
 * (z. B. SAP.DE) laufen über die ADR-Map aus fmp-adr-map.ts. Kein Treffer = n/a mit Grund.
 */
import { adrCandidatesFor } from "./fmp-adr-map";
import { getCikForTicker, SEC_USER_AGENT } from "./sec-segments";

export const SEC_FETCH_TIMEOUT_MS = 20_000;
/** companyfacts/submissions ändern sich mit jedem Filing (Quartalstakt); ein Tag Cache reicht. */
export const SEC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Filing-Texte sind groß (10-Q bis ~5 MB HTML); nur die letzten Einträge behalten. */
export const SEC_TEXT_CACHE_MAX = 12;
/** So viele 8-K/6-K prüft der Release-Fallback rückwärts, bevor er n/a meldet. */
export const SEC_RELEASE_SCAN_MAX = 8;

const EARNINGS_ITEM = "2.02";
const EX99_1 = /ex-?99[-_.]?0?1(?![0-9])|ex991/i;
/** Erste Zeilen eines Ergebnis-Exhibits (Quartals-/Jahresergebnis), nicht eines anderen 6-K. */
const RESULTS_CUE = /(quarter|quarterly|half[- ]year|full[- ]year|fiscal|annual)[^.]{0,120}(results|statement|report)|(results|statement)[^.]{0,80}(quarter|year)/i;
const RESULTS_HEAD_CHARS = 1500;
/** EDGAR-Kopf eines Exhibits („EX-99.1 2 datei.htm … Exhibit 99.1“) steht in den ersten Zeichen. */
const EXHIBIT_HEADER_CHARS = 300;
const EXHIBIT_HEADER = /^[\s\S]*\bexhibit 99\.1\b\s*/i;

function stripExhibitHeader(text: string): string {
  const head = text.slice(0, EXHIBIT_HEADER_CHARS);
  const m = EXHIBIT_HEADER.exec(head);
  return m ? text.slice(m[0].length) : text;
}

const jsonCache = new Map<string, { at: number; value: unknown }>();
const textCache = new Map<string, string>();

export function resetSecEdgarCache(): void {
  jsonCache.clear();
  textCache.clear();
}

async function secGet(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json,text/html,*/*" }, signal: AbortSignal.timeout(SEC_FETCH_TIMEOUT_MS) });
}

async function secJson(url: string): Promise<unknown> {
  const hit = jsonCache.get(url);
  if (hit && Date.now() - hit.at < SEC_CACHE_TTL_MS) return hit.value;
  const res = await secGet(url);
  if (!res.ok) throw Object.assign(new Error(`SEC ${res.status}`), { secStatus: res.status, url });
  const value = await res.json();
  jsonCache.set(url, { at: Date.now(), value });
  return value;
}

export interface SecFiler {
  cik10: string;
  /** Ticker, unter dem die SEC den Filer führt (SAP.DE → SAP). */
  secTicker: string;
}

/** Ticker → SEC-Filer. Direkter Treffer zuerst, dann die ADR-Kandidaten des Listings. */
export async function secFilerFor(symbol: string): Promise<SecFiler | null> {
  const t = symbol.trim().toUpperCase();
  const tries = [t, ...adrCandidatesFor(t).map(c => c.symbol)];
  for (const candidate of tries) {
    const cik10 = await getCikForTicker(candidate);
    if (cik10) return { cik10, secTicker: candidate };
  }
  return null;
}

export async function secCompanyFacts(cik10: string): Promise<unknown> {
  return secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`);
}

export async function secSubmissions(cik10: string): Promise<unknown> {
  return secJson(`https://data.sec.gov/submissions/CIK${cik10}.json`);
}

function archiveBase(cik10: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik10)}/${accession.replace(/-/g, "")}`;
}

export interface SecRecentFiling {
  form: string;
  filingDate: string;
  reportDate: string | null;
  accession: string;
  primaryDocument: string;
  items: string;
}

export function recentFilings(submissions: unknown): SecRecentFiling[] {
  const r = (submissions as any)?.filings?.recent;
  if (!r || !Array.isArray(r.form)) return [];
  const out: SecRecentFiling[] = [];
  for (let i = 0; i < r.form.length; i++) {
    out.push({
      form: String(r.form[i]), filingDate: String(r.filingDate?.[i] ?? ""), reportDate: r.reportDate?.[i] ? String(r.reportDate[i]) : null,
      accession: String(r.accessionNumber?.[i] ?? ""), primaryDocument: String(r.primaryDocument?.[i] ?? ""), items: String(r.items?.[i] ?? ""),
    });
  }
  return out.sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));
}

/** Link auf das Hauptdokument eines Filings (10-Q/10-K/20-F). */
export function secFilingDocUrl(cik10: string, submissions: unknown, accession: string): string | null {
  const f = recentFilings(submissions).find(x => x.accession === accession);
  if (!f?.primaryDocument) return null;
  return `${archiveBase(cik10, accession)}/${f.primaryDocument}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  mdash: "—", ndash: "–", hellip: "…", bull: "•", euro: "€", reg: "®", trade: "™", copy: "©",
};

/** Filing-HTML → Fließtext. Entfernt den Inline-XBRL-Kopf (versteckte Fakten) und Skripte. */
export function filingHtmlToText(html: string): string {
  return html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function secFilingText(url: string): Promise<string> {
  const hit = textCache.get(url);
  if (hit != null) return hit;
  const res = await secGet(url);
  if (!res.ok) throw Object.assign(new Error(`SEC ${res.status}`), { secStatus: res.status, url });
  const text = filingHtmlToText(await res.text());
  textCache.set(url, text);
  if (textCache.size > SEC_TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value as string);
  return text;
}

export interface SecEarningsRelease {
  form: string;
  filingDate: string;
  accession: string;
  url: string;
  indexUrl: string;
  text: string;
}

async function exhibit99(cik10: string, accession: string): Promise<string | null> {
  const base = archiveBase(cik10, accession);
  const idx = await secJson(`${base}/index.json`) as any;
  const items: Array<{ name?: string }> = Array.isArray(idx?.directory?.item) ? idx.directory.item : [];
  const hit = items.find(i => typeof i.name === "string" && /\.html?$/i.test(i.name) && EX99_1.test(i.name));
  return hit?.name ? `${base}/${hit.name}` : null;
}

/**
 * Letzter Earnings Release: 8-K mit Item 2.02 (US-Filer) bzw. 6-K, dessen Exhibit 99.1 mit
 * einem Ergebnis-Titel beginnt (Foreign Private Issuer wie SAP). Liefert null mit Grund.
 */
export async function secLatestEarningsRelease(cik10: string): Promise<{ release: SecEarningsRelease | null; reason: string | null }> {
  const filings = recentFilings(await secSubmissions(cik10));
  const candidates = filings.filter(f => (f.form === "8-K" && f.items.split(",").includes(EARNINGS_ITEM)) || f.form === "6-K").slice(0, SEC_RELEASE_SCAN_MAX);
  if (!candidates.length) return { release: null, reason: "n/a — SEC: kein 8-K mit Item 2.02 und kein 6-K in den letzten Filings" };
  for (const f of candidates) {
    const url = await exhibit99(cik10, f.accession).catch(() => null);
    if (!url) continue;
    const text = await secFilingText(url).catch(() => "");
    if (!text) continue;
    if (f.form === "6-K" && !RESULTS_CUE.test(text.slice(0, RESULTS_HEAD_CHARS))) continue;
    return {
      release: { form: f.form, filingDate: f.filingDate, accession: f.accession, url, indexUrl: `${archiveBase(cik10, f.accession)}/`, text: stripExhibitHeader(text) },
      reason: null,
    };
  }
  return { release: null, reason: `n/a — SEC: in den letzten ${candidates.length} 8-K/6-K kein Earnings-Release-Exhibit 99.1` };
}
