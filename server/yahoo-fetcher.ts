/**
 * yahoo-fetcher.ts — Ticket C1 (Future_2_NA_Fixes_Research.md §6/§7/§10,
 * Inventur Future_SOLL_IST_17c488e0.md „PR 4 Yahoo nur bei FMP 402“).
 *
 * Ersatzquelle NUR für den Fall, dass FMP für ein Symbol HTTP 402 liefert
 * (Plan deckt das Listing nicht ab, z. B. VOW3.DE, BMW.DE, SAP.DE).
 * Liefert Kurs, Market Cap, KGV (PE), EPS und Tageshistorie. Keine
 * Statements, keine Analystendaten. Das Symbol wird unverändert abgefragt
 * (`.DE` wird nicht auf ein anderes Listing umgelöst).
 *
 * - Cache: pro Symbol 15 min (YAHOO_CACHE_TTL_MS), auch Fehlschläge 2 min.
 * - Rate-Limit: mindestens YAHOO_MIN_INTERVAL_MS (Default 500 ms) zwischen
 *   ausgehenden Yahoo-Calls dieses Moduls.
 * - Quelle wird als `_dataSource: "yahoo"` an quote/profile markiert.
 *
 * Läuft nur serverseitig. Kein API-Key; Yahoo verlangt für quoteSummary
 * Cookie + Crumb, die hier einmalig geholt und wiederverwendet werden.
 */
// Alias: #261 importiert minorUnitInfo aus demselben Modul (eigener Name vermeidet doppelten Bezeichner beim Merge).
import { minorUnitInfo as chartMetaMinorUnit } from "../shared/listing-units";
import { yahooFetch, indicatorWarmupFromDate, type DailyBar } from "./history-fallback";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const YAHOO_CACHE_TTL_MS = Number(process.env.YAHOO_CACHE_TTL_MS ?? 15 * 60 * 1000);
const YAHOO_FAIL_TTL_MS = 2 * 60 * 1000;
const YAHOO_MIN_INTERVAL_MS = Number(process.env.YAHOO_MIN_INTERVAL_MS ?? 500);

export interface YahooSnapshot {
  symbol: string;
  price: number;
  currency: string | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  name: string | null;
  exchange: string | null;
  /** Gesetzt, wenn Name/Währung/Börse (ganz oder teilweise) aus der v8-Chart-Meta stammen: "Yahoo chart meta". */
  metaSource?: typeof YAHOO_CHART_META_SOURCE;
  /** Gesetzt, wenn MCap/EPS/KGV aus Yahoo fundamentals-timeseries stammen (ohne Crumb), mit Stichtagen. */
  fundamentalsSource?: typeof YAHOO_TIMESERIES_SOURCE;
  timeseriesAsOf?: { shares: string | null; eps: string | null };
  bars: DailyBar[];
  fundamentalsAvailable: boolean;
}

let _lastYahooCallAt = 0;
let _spacing: Promise<void> = Promise.resolve();
/** Serialisiert Yahoo-Calls mit festem Mindestabstand (Rate-Limit). */
export function spaceYahooCall(): Promise<void> {
  const next = _spacing.then(async () => {
    const wait = _lastYahooCallAt + YAHOO_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastYahooCallAt = Date.now();
  });
  _spacing = next.catch(() => undefined);
  return next;
}

// ─── Diagnose-Logging (Prod: quoteSummary null) ───
// Pro Stufe (cookie / crumb / quoteSummary, bei Reject auch chart) genau eine Zeile mit Präfix
// [YAHOO-DIAG]: Ticker, Stufe, HTTP-Status, Text ≤ 200 Zeichen. Cookie- und Crumb-Werte werden
// nie geloggt: bekannte Werte und typische Muster (crumb=…, Cookie-Paare) werden zu *** maskiert.
// Nur Logging — Rückgabewerte und Ablauf bleiben unverändert (kein Retry, kein neuer Header).
export const YAHOO_DIAG_PREFIX = "[YAHOO-DIAG]";
export type YahooDiagStage = "cookie" | "crumb" | "quoteSummary" | "chart" | "timeseries";

/** Ersetzt Geheimnisse (Cookie-/Crumb-Werte) und typische Muster durch ***. */
export function maskYahooSecrets(text: string, secrets: Array<string | null | undefined> = []): string {
  let out = String(text ?? "");
  const known = [...secrets, _crumb?.crumb, _crumb?.cookie]
    .flatMap((v) => (v ? [v, ...v.split(/;\s*/).flatMap((pair) => {
      const eq = pair.indexOf("=");
      return eq >= 0 ? [pair.slice(eq + 1)] : [];
    })] : []))
    .filter((v) => v.length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const v of known) out = out.split(v).join("***");
  out = out.replace(/(crumb=)[^&\s"']+/gi, "$1***");
  out = out.replace(/(cookie["']?\s*[:=]\s*)[^\n"']+/gi, "$1***");
  out = out.replace(/\b([A-Za-z][A-Za-z0-9_]{0,15}=)[A-Za-z0-9_\-.%~&]{16,}/g, "$1***");
  return out;
}

function yahooDiag(ticker: string, stage: YahooDiagStage, status: number | null, text: string, secrets: Array<string | null | undefined> = []): void {
  const msg = maskYahooSecrets(text, secrets).replace(/\s+/g, " ").trim().slice(0, 200);
  console.warn(`${YAHOO_DIAG_PREFIX} ${ticker} stage=${stage} status=${status ?? "-"} ${msg}`);
}

function errText(err: unknown): string {
  const e = err as any;
  const name = e?.name && e.name !== "Error" ? `${e.name}: ` : "";
  const cause = e?.cause?.code ? ` (${e.cause.code})` : "";
  return `${name}${String(e?.message ?? e)}${cause}`;
}

/**
 * Wohin Yahoo umgeleitet hat (nur Host + Pfad, nie Query/Fragment), z. B. Consent-Wall
 * (consent.yahoo.com / guce.yahoo.com) statt Cookie. Leer, wenn keine Umleitung.
 */
function redirectNote(resp: Response): string {
  let target = "";
  try {
    const loc = resp.headers?.get?.("location");
    if (loc && resp.status >= 300 && resp.status < 400) target = loc;
    else if ((resp as any).redirected && (resp as any).url) target = (resp as any).url;
    if (!target) return "";
    const u = new URL(target, "https://fc.yahoo.com");
    const consent = /(^|\.)(consent|guce)\.yahoo\.com$/i.test(u.hostname);
    return ` → ${u.hostname}${u.pathname}${consent ? " [Consent-Wall]" : ""}`;
  } catch {
    return "";
  }
}

/** Kurzer Hinweis zur Unterscheidung im Log: Auth (Cookie/Crumb) / Rate-Limit / Zugriff verweigert. Kein Abo nötig für diese Endpunkte. */
function statusHint(status: number): string {
  if (status === 401) return " [401 Auth: Cookie/Crumb abgelehnt]";
  if (status === 403) return " [403 Zugriff verweigert]";
  if (status === 429) return " [429 Rate-Limit]";
  return "";
}

/** Body für die Diagnosezeile; Lesefehler ergeben einen Hinweis statt eines Throws. */
async function bodySnippet(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 400);
  } catch (err) {
    return `Body nicht lesbar: ${errText(err)}`;
  }
}

let _crumb: { cookie: string; crumb: string; at: number } | null = null;
async function getCrumb(ticker = "-"): Promise<{ cookie: string; crumb: string } | null> {
  if (_crumb && Date.now() - _crumb.at < 60 * 60 * 1000) return _crumb;
  let stage: "cookie" | "crumb" = "cookie";
  let cookie = "";
  let crumb = "";
  try {
    await spaceYahooCall();
    const r1 = await fetch("https://fc.yahoo.com", { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA }, redirect: "manual" });
    const setCookie = (r1.headers as any).getSetCookie?.() ?? [r1.headers.get("set-cookie") ?? ""];
    cookie = (setCookie as string[]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    if (!cookie) {
      yahooDiag(ticker, "cookie", r1.status, `kein Set-Cookie von fc.yahoo.com${redirectNote(r1)} → quoteSummary null`);
      return null;
    }
    yahooDiag(ticker, "cookie", r1.status, `ok (${(setCookie as string[]).filter(Boolean).length} Set-Cookie)${redirectNote(r1)}`, [cookie]);
    stage = "crumb";
    await spaceYahooCall();
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA, Cookie: cookie } });
    crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.length > 40 || /[<{ ]/.test(crumb)) {
      // Crumb-förmiger Text wird nie gezeigt; nur ein offensichtlicher Fehlertext/HTML-Body (Leerzeichen, <, {, > 40) erscheint maskiert.
      const looksLikeBody = /[<{ ]/.test(crumb) || crumb.length > 40;
      const shown = looksLikeBody ? crumb : (crumb ? "***" : "");
      const reason = !r2.ok ? "getcrumb nicht ok" : !crumb ? "Crumb leer" : "Crumb ungültig";
      yahooDiag(ticker, "crumb", r2.status, `${reason}${statusHint(r2.status)}${redirectNote(r2)} (Länge ${crumb.length}): ${shown}`, looksLikeBody ? [cookie] : [cookie, crumb]);
      return null;
    }
    _crumb = { cookie, crumb, at: Date.now() };
    yahooDiag(ticker, "crumb", r2.status, `ok (Länge ${crumb.length})`, [cookie, crumb]);
    return _crumb;
  } catch (err) {
    yahooDiag(ticker, stage, null, `Fehler: ${errText(err)}`, [cookie, crumb]);
    return null;
  }
}

const num = (v: any): number | null => {
  const n = typeof v === "object" && v !== null ? v.raw : v;
  return typeof n === "number" && isFinite(n) ? n : null;
};

/** Kurs/Market Cap/PE/EPS aus quoteSummary. null, wenn Yahoo nichts liefert. */
async function fetchQuoteSummary(symbol: string): Promise<Partial<YahooSnapshot> | null> {
  const auth = await getCrumb(symbol);
  if (!auth) {
    yahooDiag(symbol, "quoteSummary", null, "übersprungen: kein Cookie/Crumb (siehe stage=cookie/crumb)");
    return null;
  }
  await spaceYahooCall();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" } });
  if (resp.status === 401) _crumb = null;
  if (!resp.ok) {
    yahooDiag(symbol, "quoteSummary", resp.status, `nicht ok${statusHint(resp.status)}${redirectNote(resp)}: ${await bodySnippet(resp)}`, [auth.cookie, auth.crumb]);
    return null;
  }
  const json: any = await resp.json();
  const r = json?.quoteSummary?.result?.[0];
  if (!r) {
    const err = json?.quoteSummary?.error;
    yahooDiag(symbol, "quoteSummary", resp.status, `result leer${redirectNote(resp)}${err ? `: ${JSON.stringify(err)}` : ""}`, [auth.cookie, auth.crumb]);
    return null;
  }
  yahooDiag(symbol, "quoteSummary", resp.status, "ok", [auth.cookie, auth.crumb]);
  const price = num(r.price?.regularMarketPrice);
  const eps = num(r.defaultKeyStatistics?.trailingEps);
  let pe = num(r.summaryDetail?.trailingPE);
  if (pe == null && eps != null && eps > 0 && price != null) pe = price / eps;
  return {
    price: price ?? undefined,
    currency: r.price?.currency ?? null,
    marketCap: num(r.price?.marketCap) ?? num(r.summaryDetail?.marketCap),
    pe,
    eps,
    name: r.price?.longName ?? r.price?.shortName ?? null,
    exchange: r.price?.exchangeName ?? null,
  };
}

const cache = new Map<string, { value: YahooSnapshot | null; at: number }>();
const inflight = new Map<string, Promise<YahooSnapshot | null>>();

export function clearYahooCache(): void { cache.clear(); inflight.clear(); _crumb = null; tsCache.clear(); }

/**
 * Yahoo-Snapshot für ein Symbol (gecacht). Braucht mindestens einen Kurs
 * (quoteSummary oder letzter Schlusskurs der Historie), sonst null.
 */
export async function getYahooSnapshot(symbol: string): Promise<YahooSnapshot | null> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? YAHOO_CACHE_TTL_MS : YAHOO_FAIL_TTL_MS)) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async (): Promise<YahooSnapshot | null> => {
    const to = new Date().toISOString().slice(0, 10);
    const [qsRes, barsRes] = await Promise.allSettled([
      fetchQuoteSummary(key),
      spaceYahooCall().then(() => yahooFetch(key, indicatorWarmupFromDate(), to)),
    ]);
    // Rejected-Gründe loggen (z. B. Timeout/JSON-Fehler in quoteSummary, Chart-HTTP-Fehler). Werte unverändert.
    if (qsRes.status === "rejected") yahooDiag(key, "quoteSummary", null, `rejected: ${errText(qsRes.reason)}`);
    if (barsRes.status === "rejected") yahooDiag(key, "chart", null, `rejected: ${errText(barsRes.reason)}`);
    const qs = qsRes.status === "fulfilled" ? qsRes.value : null;
    const bars = barsRes.status === "fulfilled" ? barsRes.value : [];
    const lastClose = bars.length ? bars[bars.length - 1].close : null;
    const price = qs?.price ?? lastClose;
    if (!(typeof price === "number" && price > 0)) return null;
    return {
      symbol: key,
      price,
      currency: qs?.currency ?? null,
      marketCap: qs?.marketCap ?? null,
      pe: qs?.pe ?? null,
      eps: qs?.eps ?? null,
      name: qs?.name ?? null,
      exchange: qs?.exchange ?? null,
      bars,
      fundamentalsAvailable: !!qs,
    };
  })().catch((err) => {
    console.warn(`[YAHOO-402] ${key}: ${String(err?.message ?? err).slice(0, 120)}`);
    return null;
  });
  // Ersatzstufen A (Chart-Meta) und B (timeseries) NUR für .DE (Philip 18.10.2026 22:27); alle anderen Ticker wie main.
  const withMeta = isGermanXetraTicker(key) ? p.then(applyChartMetaFallback).then(applyTimeseriesFundamentals) : p;
  inflight.set(key, withMeta);
  try {
    const value = await withMeta;
    cache.set(key, { value, at: Date.now() });
    return value;
  } finally {
    inflight.delete(key);
  }
}

/** Klarer Hinweistext (Spec §7), wenn FMP 402 liefert und Yahoo übernimmt. */
export const YAHOO_402_NOTICE = "Plan deckt dieses Symbol nicht ab – Yahoo-Kurs/History aktiv";

/**
 * Gate für die automatischen Ersatzstufen A (Chart-Meta) und B (fundamentals-timeseries) im Snapshot-Pfad:
 * nur Ticker mit Suffix `.DE` (Philip 18.10.2026 22:27). US, .L, .AS, .SW, .T, .PA usw. bleiben exakt wie auf main
 * (kein Zusatz-Call, keine zusätzliche [YAHOO-DIAG]-Zeile).
 */
export function isGermanXetraTicker(symbol: string): boolean {
  return /\.DE$/i.test(String(symbol ?? "").trim());
}

// ─── Chart-Meta-Ersatz (Render: getcrumb 429 → quoteSummary fehlt) ───
// Die v8-Chart-API braucht keinen Crumb und nennt in `meta` Währung, Börse und Namen. Fehlt quoteSummary
// (oder fehlen dort diese Felder), werden NUR diese drei Felder aus der Meta ergänzt. Market Cap, KGV und EPS
// bleiben null (die Meta hat sie nicht; nichts wird geschätzt). Vorhandene quoteSummary-Werte haben Vorrang.
export const YAHOO_CHART_META_SOURCE = "Yahoo chart meta" as const;

export interface YahooChartMeta { currency: string | null; exchange: string | null; name: string | null }

/** Liest currency, fullExchangeName/exchangeName und longName/shortName aus einer v8-Chart-Antwort. null ohne Meta. */
export function parseYahooChartMeta(json: any): YahooChartMeta | null {
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s{2,}.*$/, "") : null);
  const out = { currency: str(meta.currency), exchange: str(meta.fullExchangeName) ?? str(meta.exchangeName), name: str(meta.longName) ?? str(meta.shortName) };
  return out.currency || out.exchange || out.name ? out : null;
}

/** Kleiner v8-Chart-Call (range=5d, ohne Crumb) nur für die Meta. null bei jedem Fehler (kein Throw, kein Log). */
async function fetchYahooChartMeta(symbol: string): Promise<YahooChartMeta | null> {
  try {
    await spaceYahooCall();
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
      signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!resp.ok) return null;
    return parseYahooChartMeta(await resp.json());
  } catch {
    return null;
  }
}

/**
 * (Nur .DE, sonst Snapshot unverändert.) Ergänzt fehlende Name/Währung/Börse eines Snapshots aus der Chart-Meta. Kein Call, wenn alle drei schon
 * gesetzt sind (quoteSummary ok → Snapshot unverändert). Kurs kommt ohne quoteSummary aus den Bars, die
 * history-fallback schon in die Major-Einheit bringt (yahooBarsToMajor) → Minor-Code (GBp) wird dann als
 * Major (GBP) gemeldet, damit Kurs und Währung zusammenpassen. Keine Umrechnung von Werten.
 */
export async function applyChartMetaFallback(snap: YahooSnapshot | null): Promise<YahooSnapshot | null> {
  if (!snap || !isGermanXetraTicker(snap.symbol)) return snap; // nur .DE
  if (snap.currency && snap.name && snap.exchange) return snap;
  const meta = await fetchYahooChartMeta(snap.symbol);
  if (!meta) return snap;
  let currency = meta.currency;
  if (currency && !snap.fundamentalsAvailable) currency = chartMetaMinorUnit(currency)?.major ?? currency;
  const filled: string[] = [];
  const next: YahooSnapshot = { ...snap };
  if (!next.currency && currency) { next.currency = currency; filled.push(`Währung ${currency}`); }
  if (!next.name && meta.name) { next.name = meta.name; filled.push(`Name ${meta.name}`); }
  if (!next.exchange && meta.exchange) { next.exchange = meta.exchange; filled.push(`Börse ${meta.exchange}`); }
  if (!filled.length) return snap;
  next.metaSource = YAHOO_CHART_META_SOURCE;
  console.log(`[YAHOO-402] ${snap.symbol}: ${filled.join(", ")} aus ${YAHOO_CHART_META_SOURCE} (quoteSummary ${snap.fundamentalsAvailable ? "unvollständig" : "fehlt"}; Market Cap/KGV/EPS bleiben null)`);
  return next;
}

// ─── Fundamentals ohne Crumb: Yahoo fundamentals-timeseries (Render: getcrumb 429) ───
// Nur wenn quoteSummary fehlt (fundamentalsAvailable false). Ein Call ohne Cookie/Crumb, mit Browser-UA (ohne UA → 429).
// MCap = Kurs (Chart) × quarterlyOrdinarySharesNumber (Ersatz annualOrdinarySharesNumber), EPS = trailingDilutedEPS,
// KGV = Kurs / EPS (nur EPS > 0). Alles vom selben Listing; EPS nur, wenn dessen currencyCode = Snapshot-Währung
// (Chart-Meta) — keine FX-Umrechnung, kein ADR. Fehler/fehlende Werte → Feld bleibt null (UI n/a), nie geschätzt.
// Je Abruf eine Zeile [YAHOO-DIAG] stage=timeseries mit HTTP-Status (Render-Gegenprobe).
export const YAHOO_TIMESERIES_SOURCE = "Yahoo timeseries" as const;
const TIMESERIES_TYPES = ["quarterlyOrdinarySharesNumber", "annualOrdinarySharesNumber", "trailingDilutedEPS"] as const;
/** Ältere Werte als das werden ignoriert (Halbjahres-Berichter liegen bei ≤ ~9 Monaten). */
export const TIMESERIES_MAX_AGE_DAYS = 550;

type TsPoint = { asOfDate: string; currencyCode: string | null; value: number };

/** Jüngster gültiger Punkt (asOfDate max, Wert endlich) eines Typs aus der timeseries-Antwort. */
function latestTsPoint(json: any, type: string, now: number): TsPoint | null {
  const results: any[] = Array.isArray(json?.timeseries?.result) ? json.timeseries.result : [];
  let best: TsPoint | null = null;
  for (const r of results) {
    const rows = r?.[type];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const v = row?.reportedValue?.raw;
      const d = typeof row?.asOfDate === "string" ? row.asOfDate : null;
      if (typeof v !== "number" || !Number.isFinite(v) || !d) continue;
      const t = Date.parse(`${d}T00:00:00Z`);
      if (!Number.isFinite(t) || now - t > TIMESERIES_MAX_AGE_DAYS * 86400000 || t - now > 86400000) continue;
      if (!best || d > best.asOfDate) best = { asOfDate: d, currencyCode: typeof row.currencyCode === "string" ? row.currencyCode : null, value: v };
    }
  }
  return best;
}

/**
 * Leitet MCap/EPS/KGV aus einer timeseries-Antwort ab (rein, testbar). Nur Werte vom selben Listing und in der
 * Snapshot-Währung; sonst null.
 */
export function deriveTimeseriesFundamentals(json: any, price: number, currency: string, now: number = Date.now()): {
  marketCap: number | null; eps: number | null; pe: number | null; sharesAsOf: string | null; epsAsOf: string | null;
} {
  const shares = latestTsPoint(json, "quarterlyOrdinarySharesNumber", now) ?? latestTsPoint(json, "annualOrdinarySharesNumber", now);
  const epsPt = latestTsPoint(json, "trailingDilutedEPS", now);
  const okPrice = Number.isFinite(price) && price > 0;
  const marketCap = okPrice && shares && shares.value > 0 ? price * shares.value : null;
  const epsSameCcy = epsPt && epsPt.currencyCode != null && epsPt.currencyCode.toUpperCase() === currency.toUpperCase() ? epsPt : null;
  const eps = epsSameCcy ? epsSameCcy.value : null;
  const pe = okPrice && eps != null && eps > 0 ? price / eps : null;
  return { marketCap, eps, pe, sharesAsOf: marketCap != null ? shares!.asOfDate : null, epsAsOf: eps != null ? epsSameCcy!.asOfDate : null };
}

/** Ergebnis von fetchYahooTimeseriesFundamentals. Fehlende Werte sind null (= n/a), nie 0 oder geschätzt. */
export interface YahooTimeseriesFundamentals {
  symbol: string;
  /**
   * ok       = MCap und EPS/KGV abgeleitet
   * partial  = nur ein Teil (z. B. MCap ja, EPS fehlt/andere Währung)
   * no_data  = timeseries 200, aber nichts Verwertbares
   * no_meta  = keine Listing-Währung/kein Kurs (Chart-Meta fehlt) → kein timeseries-Call
   * http_error = timeseries HTTP ≠ 2xx (z. B. 429), error = Netzwerk/Timeout/JSON
   */
  status: "ok" | "partial" | "no_data" | "no_meta" | "http_error" | "error";
  /** HTTP-Status des timeseries-Calls (null: kein Call oder Netzwerkfehler). */
  httpStatus: number | null;
  /** Listing-Währung (Major-Einheit, z. B. GBp → GBP); Kurs, MCap und EPS sind in dieser Währung. */
  currency: string | null;
  exchangeName: string | null;
  name: string | null;
  /** Kurs (Major-Einheit), aus opts.price oder Chart-Meta regularMarketPrice. */
  price: number | null;
  sharesOutstanding: number | null;
  /** price × sharesOutstanding. */
  marketCap: number | null;
  /** trailingDilutedEPS (TTM), nur wenn currencyCode = currency. */
  epsDiluted: number | null;
  /** price / epsDiluted, nur wenn epsDiluted > 0. */
  pe: number | null;
  /** Stichtage (asOfDate, YYYY-MM-DD) der Aktienzahl und des EPS. */
  asOf: { shares: string | null; eps: string | null };
  /** "Yahoo timeseries", sobald MCap oder EPS daraus stammt; sonst "Yahoo chart meta" (nur Name/Währung/Börse/Kurs). */
  source: typeof YAHOO_TIMESERIES_SOURCE | typeof YAHOO_CHART_META_SOURCE;
}

export interface YahooTimeseriesOpts {
  /** Kurs in Listing-Währung (Major). Mit `currency` zusammen gesetzt → kein Chart-Meta-Call. */
  price?: number | null;
  currency?: string | null;
  name?: string | null;
  exchangeName?: string | null;
}

const tsCache = new Map<string, { value: YahooTimeseriesFundamentals; at: number }>();

/**
 * Stufe 2 (Yahoo ohne Crumb): Name/Währung/Börse/Kurs aus der v8-Chart-Meta (oder aus opts), Aktienzahl und
 * trailingDilutedEPS aus fundamentals-timeseries. Wirft nie; Fehler stehen in `status`/`httpStatus`, Werte sind dann null.
 * Gecacht pro Symbol+Kurs+Währung (15 min, Fehlschläge 2 min). Je timeseries-Call eine Zeile [YAHOO-DIAG] stage=timeseries.
 *
 * Hinweis: Der direkte Aufruf dieser Funktion ist NICHT auf `.DE` begrenzt (z. B. für feat/fmp-adr-mapping).
 * Nur die automatische Ersatzstufe im Snapshot-Pfad (getYahooSnapshot → applyTimeseriesFundamentals) läuft
 * ausschließlich für `.DE` (isGermanXetraTicker). Wer sie direkt aufruft, entscheidet selbst über das Gate.
 */
export async function fetchYahooTimeseriesFundamentals(symbol: string, opts: YahooTimeseriesOpts = {}): Promise<YahooTimeseriesFundamentals> {
  const sym = String(symbol || "").trim().toUpperCase();
  const cacheKey = `${sym}|${opts.price ?? ""}|${opts.currency ?? ""}`;
  const hit = tsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < (hit.value.status === "ok" || hit.value.status === "partial" ? YAHOO_CACHE_TTL_MS : YAHOO_FAIL_TTL_MS)) return hit.value;
  const value = await fetchYahooTimeseriesFundamentalsUncached(sym, opts);
  tsCache.set(cacheKey, { value, at: Date.now() });
  return value;
}

async function fetchYahooTimeseriesFundamentalsUncached(sym: string, opts: YahooTimeseriesOpts): Promise<YahooTimeseriesFundamentals> {
  let price = typeof opts.price === "number" && Number.isFinite(opts.price) && opts.price > 0 ? opts.price : null;
  let currency = typeof opts.currency === "string" && opts.currency.trim() ? opts.currency.trim() : null;
  let name = opts.name ?? null;
  let exchangeName = opts.exchangeName ?? null;
  if (price == null || currency == null) {
    const m = await fetchYahooChartMetaWithPrice(sym);
    if (m) {
      // Meta-Kurs ist in der Meta-Währung; Minor (GBp) → Major (GBP), damit Kurs, MCap und Währung zusammenpassen.
      const mu = m.currency ? chartMetaMinorUnit(m.currency) : null;
      if (price == null && m.price != null) price = mu ? m.price / mu.factor : m.price;
      if (currency == null && m.currency) currency = mu ? mu.major : m.currency;
      name = name ?? m.name;
      exchangeName = exchangeName ?? m.exchange;
    }
  }
  const base: YahooTimeseriesFundamentals = {
    symbol: sym, status: "no_meta", httpStatus: null, currency, exchangeName, name, price,
    sharesOutstanding: null, marketCap: null, epsDiluted: null, pe: null, asOf: { shares: null, eps: null }, source: YAHOO_CHART_META_SOURCE,
  };
  if (!sym || price == null || currency == null) return base;
  try {
    await spaceYahooCall();
    const nowSec = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?type=${TIMESERIES_TYPES.join(",")}&period1=${nowSec - 2 * 366 * 86400}&period2=${nowSec}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!resp.ok) {
      yahooDiag(sym, "timeseries", resp.status, `nicht ok${statusHint(resp.status)}${redirectNote(resp)}: ${await bodySnippet(resp)} → MCap/KGV/EPS n/a`);
      return { ...base, status: "http_error", httpStatus: resp.status };
    }
    const d = deriveTimeseriesFundamentals(await resp.json(), price, currency);
    if (d.marketCap == null && d.eps == null) {
      yahooDiag(sym, "timeseries", resp.status, `ok, aber keine verwertbaren Werte (Aktienzahl/EPS fehlen, zu alt oder andere Währung als ${currency}) → MCap/KGV/EPS n/a`);
      return { ...base, status: "no_data", httpStatus: resp.status };
    }
    yahooDiag(sym, "timeseries", resp.status, `ok: MCap ${d.marketCap != null ? `Kurs × Aktien (Stand ${d.sharesAsOf})` : "n/a"}, EPS ${d.eps != null ? `trailingDilutedEPS (Stand ${d.epsAsOf})` : "n/a"}, KGV ${d.pe != null ? "Kurs/EPS" : "n/a"} [${currency}]`);
    return {
      ...base,
      status: d.marketCap != null && d.eps != null && d.pe != null ? "ok" : "partial",
      httpStatus: resp.status,
      sharesOutstanding: d.marketCap != null ? d.marketCap / price : null,
      marketCap: d.marketCap, epsDiluted: d.eps, pe: d.pe,
      asOf: { shares: d.sharesAsOf, eps: d.epsAsOf },
      source: YAHOO_TIMESERIES_SOURCE,
    };
  } catch (err) {
    yahooDiag(sym, "timeseries", null, `Fehler: ${errText(err)} → MCap/KGV/EPS n/a`);
    return { ...base, status: "error" };
  }
}

/** Chart-Meta inkl. regularMarketPrice (für den Standalone-Aufruf ohne Snapshot). */
async function fetchYahooChartMetaWithPrice(symbol: string): Promise<(YahooChartMeta & { price: number | null }) | null> {
  try {
    await spaceYahooCall();
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
      signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const meta = parseYahooChartMeta(json);
    if (!meta) return null;
    const px = Number(json?.chart?.result?.[0]?.meta?.regularMarketPrice);
    return { ...meta, price: Number.isFinite(px) && px > 0 ? px : null };
  } catch {
    return null;
  }
}

/** Snapshot-Stufe (nur .DE): ergänzt fehlende marketCap/eps/pe über fetchYahooTimeseriesFundamentals, wenn quoteSummary fehlt. Wirft nie. */
export async function applyTimeseriesFundamentals(snap: YahooSnapshot | null): Promise<YahooSnapshot | null> {
  if (!snap || !isGermanXetraTicker(snap.symbol)) return snap; // nur .DE
  if (snap.fundamentalsAvailable) return snap; // quoteSummary ok → unverändert, kein Call
  if (snap.marketCap != null && snap.eps != null && snap.pe != null) return snap;
  // Nur mit bestätigtem Listing (Währung + Name oder Börse aus der Chart-Meta): sonst kein „selbe Währung“-Check → n/a, kein Call.
  // (Eine nur aus dem Börsen-Suffix geratene Währung reicht nicht.)
  if (!snap.currency || !(snap.name || snap.exchange)) return snap;
  const f = await fetchYahooTimeseriesFundamentals(snap.symbol, { price: snap.price, currency: snap.currency, name: snap.name, exchangeName: snap.exchange });
  if (f.source !== YAHOO_TIMESERIES_SOURCE) return snap;
  return {
    ...snap,
    marketCap: snap.marketCap ?? f.marketCap,
    eps: snap.eps ?? f.epsDiluted,
    pe: snap.pe ?? f.pe,
    fundamentalsSource: YAHOO_TIMESERIES_SOURCE,
    timeseriesAsOf: { shares: f.asOf.shares, eps: f.asOf.eps },
  };
}
