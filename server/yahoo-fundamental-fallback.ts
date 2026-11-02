/**
 * Kostenlose Ersatzquelle, wenn FMP 402 liefert oder die Antwort leer ist.
 * quoteSummary zuerst (incomeStatementHistory, balanceSheetHistory, defaultKeyStatistics,
 * summaryDetail.trailingPE). Sind die Abschlusszeilen nur Platzhalter, übernimmt die
 * fundamentals-timeseries ohne Crumb. ETF-KGV: quoteSummary, bei Crumb v7 quote,
 * sonst die Quote-Seite über HTTP/2 (fetch scheitert an der Header-Größe) und
 * danach timeseries trailingPeRatio. Wirft nie. Fehlende Werte bleiben n/a.
 */
import http2 from "node:http2";
import type { FundamentalPoint } from "../shared/earnings-yield-roic";
import { sanitizeRoic } from "./news-peers";
import {
  fetchYahooQuoteSummaryResult,
  fetchYahooTimeseriesDocument,
  fetchYahooV7Quote,
  maskYahooSecrets,
  spaceYahooCall,
  YAHOO_BROWSER_UA,
  YAHOO_CACHE_TTL_MS,
  YAHOO_DIAG_PREFIX,
  type YahooCallDiag,
} from "./yahoo-fetcher";
import {
  annualsFromQuoteSummary,
  annualsFromTimeseries,
  DAYS_PER_FISCAL_YEAR,
  earningsYieldPointsFromAnnuals,
  preferReportedSeries,
  roicPointsFromAnnuals,
  trailingPeFromQuoteSummary,
  trailingPeFromTimeseries,
  trailingPeFromV7Quote,
  trailingPeFromYahooHtml,
  YAHOO_ANNUAL_TYPES,
  YAHOO_HTML_TRAILING_PE_SOURCE,
  YAHOO_QS_EY_SOURCE,
  YAHOO_QS_ROIC_SOURCE,
  YAHOO_QS_TRAILING_PE_SOURCE,
  YAHOO_TS_EY_SOURCE,
  YAHOO_TS_ROIC_SOURCE,
  YAHOO_TS_TRAILING_PE_SOURCE,
  YAHOO_V7_TRAILING_PE_SOURCE,
  type ReportedSeries,
} from "../shared/yahoo-fundamental-series";

const FAIL_TTL_MS = 2 * 60 * 1000;
const QS_STATEMENT_MODULES = ["incomeStatementHistory", "balanceSheetHistory", "defaultKeyStatistics"] as const;
const QS_PE_MODULES = ["summaryDetail", "defaultKeyStatistics"] as const;

export interface YahooSeriesBundle {
  earningsYield: ReportedSeries;
  roic: ReportedSeries;
}

export interface YahooTrailingPe {
  pe: number | null;
  source: string;
  note: string | null;
}

let bundleCache = new Map<string, { at: number; body: YahooSeriesBundle }>();
const bundleInflight = new Map<string, Promise<YahooSeriesBundle>>();

export function resetYahooFundamentalCacheForTests(): void {
  bundleCache = new Map();
  bundleInflight.clear();
}

function hasValue(points: FundamentalPoint[]): boolean {
  return points.some(p => p.value != null && Number.isFinite(p.value));
}

function finalizeRoic(built: { points: FundamentalPoint[]; note: string | null }): { points: FundamentalPoint[]; note: string | null } {
  const points = built.points.map(p => {
    if (p.value == null) return p;
    const sane = sanitizeRoic(p.value);
    if (sane == null) return { ...p, value: null, note: "n/a — ROIC fehlt oder unplausibel" };
    return { ...p, value: +sane.toFixed(1) };
  });
  const any = hasValue(points);
  return { points, note: any ? null : (points.find(p => p.note)?.note ?? built.note ?? "n/a — ROIC nicht berechenbar") };
}

const STAGE_LABEL: Record<YahooCallDiag["stage"], string> = {
  cookie: "Cookie fc.yahoo.com",
  crumb: "getcrumb",
  quoteSummary: "quoteSummary",
  v7quote: "v7 quote",
  timeseries: "timeseries trailingPeRatio",
  html: "Quote-HTML",
};

/** n/a-Grund mit HTTP-Status und gekürztem Body. Leer bleibt ein eigener Satz. */
export function yahooTrailingPeMissNote(probes: YahooCallDiag[]): string {
  const parts = probes.map((p) => {
    const status = p.status == null ? "kein HTTP" : `HTTP ${p.status}`;
    const detail = p.detail.trim();
    return `n/a — Yahoo ${STAGE_LABEL[p.stage]} ${status}${detail ? `: ${detail}` : ""}`;
  });
  return parts.join(" · ") || "n/a — Yahoo trailingPE fehlt";
}

function clipDiag(text: string): string {
  return maskYahooSecrets(text).replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * Quote-Seite. globales fetch wirft UND_ERR_HEADERS_OVERFLOW: die CSP-Header sind
 * größer als undicis 16 KB. HTTP/2 liefert denselben Body, darin steht trailingPE.
 * Eine Session für alle ETFs. Im Leerlauf zu, per unref aus dem Event-Loop.
 * close, error und goaway verwerfen sie; der nächste Abruf baut sie neu. Wirft nie.
 */
const QUOTE_PAGE_IDLE_MS = 15_000;
let quotePageClient: http2.ClientHttp2Session | null = null;
let quotePageIdle: ReturnType<typeof setTimeout> | null = null;
let quotePageInflight = 0;

function discardQuotePageSession(client: http2.ClientHttp2Session): void {
  if (quotePageClient === client) quotePageClient = null;
}

function clearQuotePageIdle(): void {
  if (!quotePageIdle) return;
  clearTimeout(quotePageIdle);
  quotePageIdle = null;
}

function armQuotePageIdle(client: http2.ClientHttp2Session): void {
  clearQuotePageIdle();
  if (quotePageInflight > 0 || quotePageClient !== client) return;
  if (client.closed || client.destroyed) return;
  quotePageIdle = setTimeout(() => {
    quotePageIdle = null;
    if (quotePageInflight > 0 || quotePageClient !== client) return;
    quotePageClient = null;
    if (!client.closed && !client.destroyed) client.close();
  }, QUOTE_PAGE_IDLE_MS);
  quotePageIdle.unref();
}

function holdQuotePage(client: http2.ClientHttp2Session): void {
  quotePageInflight += 1;
  clearQuotePageIdle();
  client.ref();
}

function releaseQuotePage(client: http2.ClientHttp2Session): void {
  quotePageInflight = Math.max(0, quotePageInflight - 1);
  if (quotePageInflight > 0) return;
  client.unref();
  if (quotePageClient && quotePageClient !== client) quotePageClient.unref();
  if (quotePageClient && !quotePageClient.closed && !quotePageClient.destroyed) armQuotePageIdle(quotePageClient);
}

/** Schließt die gemerkte Session, damit der nächste Abruf eine neue aufbaut. */
export function closeQuotePageSessionForTests(): void {
  const client = quotePageClient;
  clearQuotePageIdle();
  quotePageClient = null;
  if (client && !client.closed && !client.destroyed) client.close();
}

function quotePageSession(): http2.ClientHttp2Session {
  if (quotePageClient && !quotePageClient.closed && !quotePageClient.destroyed) {
    clearQuotePageIdle();
    return quotePageClient;
  }
  const client = http2.connect("https://finance.yahoo.com");
  client.unref();
  client.on("error", () => {
    discardQuotePageSession(client);
    if (!client.destroyed) client.destroy();
  });
  client.on("close", () => {
    discardQuotePageSession(client);
    if (quotePageClient === null) clearQuotePageIdle();
  });
  client.on("goaway", () => {
    discardQuotePageSession(client);
    if (quotePageInflight === 0 && !client.closed && !client.destroyed) client.close();
  });
  quotePageClient = client;
  return client;
}

export function fetchYahooQuoteHtml(symbol: string): Promise<{ status: number | null; html: string | null; error: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    let held = false;
    let client: http2.ClientHttp2Session | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (out: { status: number | null; html: string | null; error: string | null }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (held && client) releaseQuotePage(client);
      resolve(out);
    };
    try {
      client = quotePageSession();
    } catch (err) {
      finish({ status: null, html: null, error: err instanceof Error ? err.message : "HTTP/2-Verbindung fehlgeschlagen" });
      return;
    }
    const session = client;
    timer = setTimeout(() => {
      discardQuotePageSession(session);
      if (!session.destroyed) session.destroy();
      finish({ status: null, html: null, error: "Timeout" });
    }, 15000);
    let req: http2.ClientHttp2Stream;
    try {
      req = session.request({
        ":path": `/quote/${encodeURIComponent(symbol)}/`,
        ":method": "GET",
        "user-agent": YAHOO_BROWSER_UA,
        accept: "text/html",
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      armQuotePageIdle(session);
      finish({ status: null, html: null, error: err instanceof Error ? err.message : "Quote-Seite fehlgeschlagen" });
      return;
    }
    holdQuotePage(session);
    held = true;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let status: number | null = null;
    req.on("response", (headers) => {
      const code = headers[":status"];
      status = typeof code === "number" ? code : null;
    });
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      chunks.push(chunk);
      if (bytes >= 2_000_000) req.close();
    });
    req.on("end", () => {
      finish({ status, html: Buffer.concat(chunks).toString("utf8"), error: null });
    });
    req.on("error", (err) => {
      const html = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : null;
      finish({ status, html, error: err instanceof Error ? err.message : "Quote-Seite fehlgeschlagen" });
    });
    req.end();
  });
}

async function buildBundle(symbol: string, years: number): Promise<YahooSeriesBundle> {
  const sym = symbol.trim().toUpperCase();
  const qs = await fetchYahooQuoteSummaryResult(sym, QS_STATEMENT_MODULES);
  const qsAnnuals = qs ? annualsFromQuoteSummary(qs) : [];
  const qsEy = earningsYieldPointsFromAnnuals(qsAnnuals);
  const qsRoic = finalizeRoic(roicPointsFromAnnuals(qsAnnuals));
  const primaryEy: ReportedSeries = {
    points: qsEy.points,
    source: YAHOO_QS_EY_SOURCE,
    note: qs ? qsEy.note : "n/a — Yahoo quoteSummary nicht verfügbar",
  };
  const primaryRoic: ReportedSeries = {
    points: qsRoic.points,
    source: YAHOO_QS_ROIC_SOURCE,
    note: qs ? qsRoic.note : "n/a — Yahoo quoteSummary nicht verfügbar",
  };
  if (hasValue(primaryEy.points) && hasValue(primaryRoic.points)) {
    return { earningsYield: { ...primaryEy, note: null }, roic: { ...primaryRoic, note: null } };
  }
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - years * DAYS_PER_FISCAL_YEAR * 24 * 60 * 60;
  const doc = await fetchYahooTimeseriesDocument(sym, YAHOO_ANNUAL_TYPES, period1, period2);
  const tsAnnuals = doc ? annualsFromTimeseries(doc) : [];
  const tsEy = earningsYieldPointsFromAnnuals(tsAnnuals);
  const tsRoic = finalizeRoic(roicPointsFromAnnuals(tsAnnuals));
  const fallbackEy: ReportedSeries = {
    points: tsEy.points,
    source: YAHOO_TS_EY_SOURCE,
    note: doc ? tsEy.note : "n/a — Yahoo fundamentals-timeseries nicht verfügbar",
  };
  const fallbackRoic: ReportedSeries = {
    points: tsRoic.points,
    source: YAHOO_TS_ROIC_SOURCE,
    note: doc ? tsRoic.note : "n/a — Yahoo fundamentals-timeseries nicht verfügbar",
  };
  const earningsYield = preferReportedSeries(primaryEy, fallbackEy);
  const roic = preferReportedSeries(primaryRoic, fallbackRoic);
  return {
    earningsYield: hasValue(earningsYield.points) ? { ...earningsYield, note: null } : earningsYield,
    roic: hasValue(roic.points) ? { ...roic, note: null } : roic,
  };
}

export async function loadYahooFundamentalBundle(symbol: string, years: number): Promise<YahooSeriesBundle> {
  const key = `${symbol.trim().toUpperCase()}|${years}`;
  const hit = bundleCache.get(key);
  const fresh = hit && Date.now() - hit.at < (hasValue(hit.body.earningsYield.points) || hasValue(hit.body.roic.points) ? YAHOO_CACHE_TTL_MS : FAIL_TTL_MS);
  if (hit && fresh) return hit.body;
  const running = bundleInflight.get(key);
  if (running) return running;
  const pending = buildBundle(symbol, years).finally(() => { bundleInflight.delete(key); });
  bundleInflight.set(key, pending);
  const body = await pending;
  bundleCache.set(key, { at: Date.now(), body });
  return body;
}

export async function loadYahooEtfTrailingPe(symbol: string): Promise<YahooTrailingPe> {
  const sym = symbol.trim().toUpperCase();
  const probes: YahooCallDiag[] = [];
  const qs = await fetchYahooQuoteSummaryResult(sym, QS_PE_MODULES, probes);
  const fromSummary = qs ? trailingPeFromQuoteSummary(qs) : null;
  if (fromSummary != null) return { pe: fromSummary, source: YAHOO_QS_TRAILING_PE_SOURCE, note: null };
  if (qs) probes.push({ stage: "quoteSummary", status: 200, detail: "summaryDetail.trailingPE fehlt" });

  const crumbFailed = probes.some((p) => p.stage === "cookie" || p.stage === "crumb");
  if (crumbFailed) {
    probes.push({ stage: "v7quote", status: null, detail: "nicht gesendet: selber Crumb wie quoteSummary" });
  } else {
    const v7 = await fetchYahooV7Quote(sym, probes);
    const fromV7 = v7 ? trailingPeFromV7Quote(v7) : null;
    if (fromV7 != null) return { pe: fromV7, source: YAHOO_V7_TRAILING_PE_SOURCE, note: null };
    if (v7) probes.push({ stage: "v7quote", status: 200, detail: "trailingPE fehlt" });
  }

  await spaceYahooCall();
  const page = await fetchYahooQuoteHtml(sym);
  const fromPage = page.html ? trailingPeFromYahooHtml(page.html) : null;
  const htmlDetail = fromPage != null
    ? "ok"
    : page.error
      ? page.error
      : page.html && page.html.length < 400
        ? page.html
        : "trailingPE fehlt";
  const htmlProbe: YahooCallDiag = { stage: "html", status: page.status, detail: clipDiag(htmlDetail) };
  console.warn(`${YAHOO_DIAG_PREFIX} ${sym} stage=html status=${page.status ?? "-"} ${htmlProbe.detail}`);
  if (fromPage != null) return { pe: fromPage, source: YAHOO_HTML_TRAILING_PE_SOURCE, note: null };
  probes.push(htmlProbe);

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 800 * 24 * 60 * 60;
  const doc = await fetchYahooTimeseriesDocument(sym, ["trailingPeRatio"], period1, period2, probes);
  const fromTs = doc ? trailingPeFromTimeseries(doc) : null;
  if (fromTs != null) return { pe: fromTs, source: YAHOO_TS_TRAILING_PE_SOURCE, note: null };
  if (doc) probes.push({ stage: "timeseries", status: 200, detail: "trailingPeRatio ohne positiven Wert" });

  return { pe: null, source: YAHOO_QS_TRAILING_PE_SOURCE, note: yahooTrailingPeMissNote(probes) };
}
