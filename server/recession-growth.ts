/**
 * Lädt Kurs, Multpl-YoY, optional FMP-Forward und VIX für die Growth-Karte.
 * Nur Anzeige. Fehlende Quelle → n/a mit Grund, kein Ersatzwert.
 */
import { isFmpAvailable, fmpIncomeStatement, fmpObserved } from "./fmp";
import { fetchYahooQuoteHtml } from "./yahoo-fundamental-fallback";
import { fetchFredVolSeries } from "./recession-markets";
import { loadEtfBars } from "./recession-ta-route";
import { fetchYahooQuoteSummaryResult, type YahooCallDiag } from "./yahoo-fetcher";
import { epsPrintFromRow } from "../shared/recession-market-charts";
import {
  EPS_BASIS,
  FMP_LEGACY_NOTE,
  FORWARD_FORMULA_EPS,
  FORWARD_HORIZON,
  GROWTH_BOOKS,
  GROWTH_GAP_PARAMS,
  GROWTH_HOLDINGS_PARAMS,
  buildGrowthBody,
  adjTtmFromEarnings,
  adjTtmFromYahooAdjusted,
  alignConsensusToTtm,
  completeEpsCurrencies,
  resolveAdjustedFmpQuarters,
  annualizedFwdPct,
  consensusForOneYear,
  consensusFromYahooAdjusted,
  horizonWeightFactor,
  describeAnalystEstimates,
  describeEarningsRows,
  holdingsFromYahooHtml,
  multplGrowthPrints,
  nextConsensusEps,
  sliceJsonObject,
  unescapeYahooHtml,
  weightsFromHoldingsPayload,
  weightedHoldingsForward,
  yoyFromAnnualEps,
  type ForwardReading,
  type GrowthBuildInput,
  type GrowthFrequency,
  type GrowthIndex,
  type GrowthPrint,
  type HoldingGrowthRow,
  type RecessionGrowthBody,
} from "../shared/recession-growth";

export const MULTPL_GROWTH_URL = "https://www.multpl.com/s-p-500-earnings-growth/table/by-quarter";
export const MULTPL_GROWTH_SOURCE = "Multpl S&P 500 Earnings Growth (current dollars, quarterly)";

export interface FmpProbeResult {
  status: number;
  json: unknown | null;
  detail: string;
}

export interface GrowthDeps {
  loadBars: (symbol: string) => Promise<{ bars: { date: string; close: number }[]; source: "fmp" | "yahoo" | null; error: string | null }>;
  fetchMultpl: () => Promise<string | null>;
  probeFmp: (path: string, params: Record<string, string>) => Promise<FmpProbeResult>;
  loadIncome: (symbol: string) => Promise<unknown>;
  loadYahooSummary: (symbol: string, modules: readonly string[], sink?: YahooCallDiag[]) => Promise<unknown | null>;
  loadYahooHtml: (symbol: string) => Promise<{ status: number | null; html: string | null; error: string | null }>;
  loadVix: (cosd: string) => Promise<{ date: string; value: number }[]>;
  fmpAvailable: boolean;
  today: string;
}

function clip(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 140);
}

function yearsAgo(iso: string, years: number): string {
  return `${String(Number(iso.slice(0, 4)) - years).padStart(4, "0")}${iso.slice(4)}`;
}

async function defaultFetchMultpl(): Promise<string | null> {
  const resp = await fetch(MULTPL_GROWTH_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!resp.ok) throw new Error(`Multpl HTTP ${resp.status}`);
  return resp.text();
}

let yahooHtmlEnabled = true;

/** Der Stub-HTTP-Lauf bleibt offline. Die Preview lässt den Loader an. */
export function setYahooHtmlEnabledForTests(on: boolean): void {
  yahooHtmlEnabled = on;
}

export function defaultGrowthDeps(today = new Date().toISOString().slice(0, 10)): GrowthDeps {
  return {
    loadBars: loadEtfBars,
    fetchMultpl: defaultFetchMultpl,
    probeFmp: (path, params) => fmpObserved(path, params),
    loadIncome: symbol => fmpIncomeStatement(symbol, 40),
    loadYahooSummary: (symbol, modules, sink) => fetchYahooQuoteSummaryResult(symbol, modules, sink),
    loadYahooHtml: async (symbol) => {
      if (!yahooHtmlEnabled) return { status: null, html: null, error: "im Test aus" };
      return fetchYahooQuoteHtml(symbol);
    },
    loadVix: cosd => fetchFredVolSeries("VIXCLS", cosd),
    fmpAvailable: isFmpAvailable(),
    today,
  };
}

function epsLevels(raw: unknown): { date: string; eps: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(epsPrintFromRow).filter((p): p is { date: string; eps: number } => p != null);
}

async function fmpRealized(
  symbols: readonly string[],
  deps: GrowthDeps,
): Promise<{ prints: GrowthPrint[]; source: string; error: string | null; frequency: GrowthFrequency | null }> {
  if (!deps.fmpAvailable) {
    return {
      prints: [],
      source: "FMP",
      error: "n/a — keine Multpl-Reihe für diesen Index und FMP nicht konfiguriert",
      frequency: null,
    };
  }
  const notes: string[] = [];
  for (const symbol of symbols) {
    const call = `GET /stable/income-statement?symbol=${symbol}`;
    try {
      const prints = yoyFromAnnualEps(epsLevels(await deps.loadIncome(symbol)));
      if (prints.length) {
        return { prints, source: `FMP ${call}`, error: null, frequency: "annual" };
      }
      notes.push(`${call} ohne YoY-Paar`);
    } catch (err) {
      notes.push(`${call} fehlgeschlagen (${clip(err)})`);
    }
  }
  return { prints: [], source: "FMP", error: `n/a — ${notes.join("; ")}`, frequency: null };
}

async function loadRealized(
  index: GrowthIndex,
  deps: GrowthDeps,
): Promise<{ prints: GrowthPrint[]; source: string; error: string | null; frequency: GrowthFrequency | null }> {
  const book = GROWTH_BOOKS[index];
  if (index !== "SPY") return fmpRealized(book.fmpSymbols, deps);
  try {
    const html = await deps.fetchMultpl();
    const prints = multplGrowthPrints(html ?? "");
    if (prints.length) return { prints, source: MULTPL_GROWTH_SOURCE, error: null, frequency: "quarterly" };
  } catch (err) {
    const fallback = await fmpRealized(book.fmpSymbols, deps);
    if (fallback.prints.length) return fallback;
    return {
      prints: [],
      source: MULTPL_GROWTH_SOURCE,
      error: `n/a — Multpl nicht erreichbar (${clip(err)}). ${fallback.error ?? ""}`.trim(),
      frequency: null,
    };
  }
  const fallback = await fmpRealized(book.fmpSymbols, deps);
  if (fallback.prints.length) return fallback;
  return {
    prints: [],
    source: MULTPL_GROWTH_SOURCE,
    error: `n/a — Multpl S&P-500-Gewinnwachstum leer. ${fallback.error ?? ""}`.trim(),
    frequency: null,
  };
}

function callLabel(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `GET /stable${path}${q ? `?${q}` : ""}`;
}

function memoProbe(probe: GrowthDeps["probeFmp"]): GrowthDeps["probeFmp"] {
  const cache = new Map<string, Promise<FmpProbeResult>>();
  return (path, params) => {
    const key = `${path}?${new URLSearchParams(params).toString()}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = probe(path, params);
    cache.set(key, pending);
    return pending;
  };
}

/** Stabiler Konsens. Bei HTTP 402 zusätzlich ohne limit und ohne period, damit das Symbol vom Parameter zu trennen ist. */
async function probeConsensus(symbol: string, deps: GrowthDeps, notes: string[]): Promise<unknown | null> {
  const variants: Record<string, string>[] = [
    { symbol, period: "annual", limit: "8" },
    { symbol, period: "annual" },
    { symbol, limit: "8" },
    { symbol },
  ];
  let saw402 = false;
  for (let i = 0; i < variants.length; i++) {
    if (i > 0 && !saw402) break;
    const params = variants[i];
    const label = callLabel("/analyst-estimates", params);
    try {
      const res = await deps.probeFmp("/analyst-estimates", params);
      const shape = res.status === 200 ? describeAnalystEstimates(res.json, deps.today) : res.detail;
      const line = i === 0 || res.status !== 402
        ? `${label} HTTP ${res.status || "n/a"}${shape ? `: ${shape}` : ""}`
        : `${label} HTTP 402 (Parameter geändert, gleicher Gate)`;
      notes.push(line);
      if (res.status === 402) saw402 = true;
      else saw402 = false;
      if (res.status === 200 && nextConsensusEps(res.json, deps.today)) return res.json;
      if (res.status !== 402) break;
    } catch (err) {
      notes.push(`${label} fehlgeschlagen (${clip(err)})`);
      break;
    }
  }
  const fin = { symbol, period: "annual", limit: "8" };
  const finLabel = callLabel("/financial-estimates", fin);
  try {
    const res = await deps.probeFmp("/financial-estimates", fin);
    const shape = res.status === 200 ? describeAnalystEstimates(res.json, deps.today) : res.detail;
    notes.push(`${finLabel} HTTP ${res.status || "n/a"}${shape ? `: ${shape}` : ""}`);
    if (res.status === 200 && nextConsensusEps(res.json, deps.today)) return res.json;
  } catch (err) {
    notes.push(`${finLabel} fehlgeschlagen (${clip(err)})`);
  }
  return null;
}

function rowCurrency(raw: unknown): string | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const value = record.reportedCurrency ?? record.currency ?? record.epsCurrency;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A US listing without a currency field is USD. An exchange suffix without a field is unknown. */
function assumedCurrency(symbol: string, explicit: string | null): string | null {
  if (explicit) return explicit;
  return symbol.includes(".") ? null : "USD";
}

async function adjTtmOf(symbol: string, deps: GrowthDeps, notes: string[]): Promise<{
  ttm: number | null;
  currency: string | null;
  cite: string;
  raw: unknown;
  unusableReason: string | null;
}> {
  const label = callLabel("/earnings", { symbol });
  const empty = { ttm: null, currency: null, cite: label, raw: null, unusableReason: null };
  try {
    const res = await deps.probeFmp("/earnings", { symbol });
    if (res.status !== 200) {
      notes.push(`${label} HTTP ${res.status || "n/a"}: ${res.detail}`);
      return empty;
    }
    const parsed = adjTtmFromEarnings(res.json, deps.today);
    const currency = assumedCurrency(symbol, rowCurrency(res.json));
    if (parsed.unusableReason) {
      notes.push(`${label} HTTP 200: ${parsed.unusableReason}`);
      return { ttm: null, currency, cite: label, raw: res.json, unusableReason: parsed.unusableReason };
    }
    if (parsed.adjTtm == null) {
      notes.push(`${label} HTTP 200: ${parsed.quarters.length} gemeldete epsActual, keine ${EPS_BASIS.reportedQuarters}`);
      return { ttm: null, currency, cite: label, raw: res.json, unusableReason: null };
    }
    notes.push(`${label} HTTP 200: ${parsed.quarters.length} gemeldete epsActual`);
    return {
      ttm: parsed.adjTtm,
      currency,
      cite: label,
      raw: res.json,
      unusableReason: null,
    };
  } catch (err) {
    notes.push(`${label} fehlgeschlagen (${clip(err)})`);
    return empty;
  }
}

async function usdPerUnit(): Promise<Record<string, number> | null> {
  try {
    const resp = await fetch("https://api.frankfurter.dev/v1/latest?from=USD", { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const body = await resp.json() as { rates?: Record<string, unknown> };
    const rates: Record<string, number> = { USD: 1 };
    for (const [code, value] of Object.entries(body.rates ?? {})) {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(n) && n > 0) rates[code.toUpperCase()] = n;
    }
    return rates;
  } catch {
    return null;
  }
}

function datedForward(
  consensus: number,
  ttm: number,
  fyEnd: string,
  daysToFyEnd: number,
  tDays: number,
  source: string,
): { gFwdPct: number; via: string } | { reason: string } {
  const adj = annualizedFwdPct(consensus, ttm, tDays);
  if ("reason" in adj) return { reason: adj.reason };
  const horizon = `Horizont t=${Math.round(tDays)} Tage = ${Math.round(daysToFyEnd)} Tage bis FY-Ende ${fyEnd} + ${FORWARD_HORIZON.midYearDays}, g_ann = (Konsens/adjTTM)^(365/t)−1, g ungedämpft`;
  return { gFwdPct: adj.gFwdPct, via: `${source} · ${horizon}` };
}

type ConsensusFy = NonNullable<ReturnType<typeof consensusForOneYear>>;

interface YahooAdjHit {
  ttm: number | null;
  currency: string | null;
  cite: string;
  consensus: ConsensusFy | null;
  unusableReason: string | null;
  raw: unknown;
}

const YAHOO_ADJ_MODULES = ["earningsHistoryNonGaap", "earningsTrendNonGaap", "earningsNonGaap"] as const;
const NO_ADJ_QUARTERS = "n/a — keine 4 Quartale adjusted";
const NO_HORIZON = "n/a — kein Horizont t";
const NO_ADJ_AND_HORIZON = "n/a — keine 4 Quartale adjusted und kein Horizont t";

function shownEps(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

async function loadYahooAdjusted(symbol: string, deps: GrowthDeps, notes: string[]): Promise<YahooAdjHit> {
  const empty: YahooAdjHit = { ttm: null, currency: null, cite: "", consensus: null, unusableReason: null, raw: null };
  let raw: unknown = null;
  let origin = "";
  const sink: YahooCallDiag[] = [];
  try {
    raw = await deps.loadYahooSummary(symbol, YAHOO_ADJ_MODULES, sink);
    if (raw) origin = `Yahoo quoteSummary earningsHistoryNonGaap ${symbol} (keyless)`;
  } catch (err) {
    notes.push(`${symbol}: Yahoo earningsHistoryNonGaap fehlgeschlagen (${clip(err)})`);
  }
  if (!raw && deps.loadYahooHtml) {
    try {
      const page = await deps.loadYahooHtml(symbol);
      const text = unescapeYahooHtml(page.html ?? "");
      const history = sliceJsonObject(text, "earningsHistoryNonGaap");
      const trend = sliceJsonObject(text, "earningsTrendNonGaap");
      const chart = sliceJsonObject(text, "earningsNonGaap");
      if (history || trend || chart) {
        raw = { earningsHistoryNonGaap: history, earningsTrendNonGaap: trend, earningsNonGaap: chart };
        origin = `Yahoo Quote-HTML earningsHistoryNonGaap ${symbol} (keyless)`;
      } else if (page.error) {
        notes.push(`${symbol}: ${page.error}`);
      }
    } catch (err) {
      notes.push(`${symbol}: Yahoo Quote-HTML fehlgeschlagen (${clip(err)})`);
    }
  }
  if (!raw) {
    if (sink.length) notes.push(yahooMiss(symbol, sink));
    return empty;
  }
  const parsed = adjTtmFromYahooAdjusted(raw, deps.today);
  const consensus = consensusFromYahooAdjusted(raw, deps.today);
  const quarters = parsed.quarters.map(row => `${row.date}=${shownEps(row.eps)}`).join(" + ");
  const cite = parsed.adjTtm != null
    ? `${origin} · adjTTM Summe letzter ${EPS_BASIS.reportedQuarters} = ${shownEps(parsed.adjTtm)} (${quarters})`
    : origin;
  return {
    ttm: parsed.adjTtm,
    currency: assumedCurrency(symbol, parsed.currency),
    cite,
    consensus,
    unusableReason: parsed.unusableReason,
    raw,
  };
}

async function annualizedFromConsensus(
  symbol: string,
  consensus: ConsensusFy,
  deps: GrowthDeps,
  notes: string[],
  rates: Record<string, number> | null,
  loadYahoo: () => Promise<YahooAdjHit>,
): Promise<{ gFwdPct: number; via: string; epsConsensus: number; epsTtm: number } | { excludeReason: string } | null> {
  const ttm = await adjTtmOf(symbol, deps, notes);
  if (ttm.unusableReason) return { excludeReason: ttm.unusableReason };
  const yahooTtm = await loadYahoo();
  const resolved = resolveAdjustedFmpQuarters(ttm.raw, yahooTtm.raw, deps.today);
  if (resolved.unusableReason) return { excludeReason: resolved.unusableReason };
  const amount = resolved.adjTtm ?? yahooTtm.ttm;
  const amountCcy = resolved.adjTtm != null ? (ttm.currency ?? yahooTtm.currency) : yahooTtm.currency;
  const basis = resolved.adjTtm != null ? `FMP ${ttm.cite} · ${resolved.cite}` : yahooTtm.cite;
  if (amount == null) {
    if (yahooTtm.unusableReason) return { excludeReason: yahooTtm.unusableReason };
    return { excludeReason: NO_ADJ_QUARTERS };
  }
  const filled = completeEpsCurrencies(
    consensus.eps,
    assumedCurrency(symbol, consensus.currency),
    amount,
    amountCcy,
  );
  if (filled.inferred) notes.push(`${symbol}: ${filled.inferred}`);
  if (!filled.consensusCcy || !filled.ttmCcy) {
    notes.push(`${symbol}: Währung fehlt`);
    return { excludeReason: "n/a — Währung fehlt auf einer EPS-Seite" };
  }
  const aligned = alignConsensusToTtm(consensus.eps, filled.consensusCcy, amount, filled.ttmCcy, rates);
  if ("error" in aligned) {
    notes.push(`${symbol}: ${aligned.error}`);
    return { excludeReason: `n/a — ${aligned.error}` };
  }
  const forward = datedForward(
    aligned.consensus,
    aligned.ttm,
    consensus.date,
    consensus.daysToFyEnd,
    consensus.horizonDays,
    `${basis} · ${aligned.note}`,
  );
  if ("reason" in forward) return { excludeReason: forward.reason };
  return { gFwdPct: forward.gFwdPct, via: forward.via, epsConsensus: aligned.consensus, epsTtm: aligned.ttm };
}

function yahooMiss(symbol: string, sink: YahooCallDiag[]): string {
  const detail = sink.map(d => `${d.stage} ${d.status ?? "-"} ${d.detail}`).join("; ");
  return detail
    ? `n/a — Yahoo quoteSummary ${symbol}: ${detail}`
    : `n/a — Yahoo quoteSummary ${symbol} leer`;
}

async function growthForHolding(
  symbol: string,
  deps: GrowthDeps,
  notes: string[],
  rates: Record<string, number> | null,
): Promise<{ gFwdPct: number | null; via: string; excludeReason: string | null; tDays: number | null }> {
  const raw = await probeConsensus(symbol, deps, notes);
  const consensus = raw ? consensusForOneYear(raw, deps.today) : null;
  if (raw && !consensus && nextConsensusEps(raw, deps.today)) {
    notes.push(`${symbol}: Konsens-FY ohne positiven Horizont t`);
  }
  let yahooHit: YahooAdjHit | null = null;
  const yahooOnce = async () => {
    if (!yahooHit) yahooHit = await loadYahooAdjusted(symbol, deps, notes);
    return yahooHit;
  };
  if (consensus) {
    const grown = await annualizedFromConsensus(symbol, consensus, deps, notes, rates, yahooOnce);
    if (grown && "excludeReason" in grown) return { gFwdPct: null, via: "", excludeReason: grown.excludeReason, tDays: consensus.horizonDays };
    if (grown) return { gFwdPct: grown.gFwdPct, via: grown.via, excludeReason: null, tDays: consensus.horizonDays };
  }
  const yahoo = await yahooOnce();
  if (yahoo.unusableReason) return { gFwdPct: null, via: "", excludeReason: yahoo.unusableReason, tDays: yahoo.consensus?.horizonDays ?? null };
  if (yahoo.consensus && yahoo.ttm != null && yahoo.currency) {
    const consensusCcy = assumedCurrency(symbol, yahoo.consensus.currency);
    if (!consensusCcy) {
      notes.push(`${symbol}: Währung fehlt`);
    } else {
      const aligned = alignConsensusToTtm(yahoo.consensus.eps, consensusCcy, yahoo.ttm, yahoo.currency, rates);
      if ("error" in aligned) {
        notes.push(`${symbol}: ${aligned.error}`);
      } else {
        const forward = datedForward(
          aligned.consensus,
          aligned.ttm,
          yahoo.consensus.date,
          yahoo.consensus.daysToFyEnd,
          yahoo.consensus.horizonDays,
          `${yahoo.cite} · ${aligned.note}`,
        );
        if ("reason" in forward) return { gFwdPct: null, via: "", excludeReason: forward.reason, tDays: yahoo.consensus.horizonDays };
        return { gFwdPct: forward.gFwdPct, via: forward.via, excludeReason: null, tDays: yahoo.consensus.horizonDays };
      }
    }
  }
  const hasQuarters = yahoo.ttm != null;
  const hasHorizon = yahoo.consensus != null || consensus != null;
  if (!hasQuarters && !hasHorizon) {
    return { gFwdPct: null, via: "", excludeReason: NO_ADJ_AND_HORIZON, tDays: null };
  }
  if (!hasHorizon) return { gFwdPct: null, via: yahoo.cite, excludeReason: NO_HORIZON, tDays: null };
  return { gFwdPct: null, via: "", excludeReason: NO_ADJ_QUARTERS, tDays: yahoo.consensus?.horizonDays ?? consensus?.horizonDays ?? null };
}

async function loadForward(index: GrowthIndex, deps: GrowthDeps): Promise<{ forward: ForwardReading; trace: string }> {
  const notes: string[] = [FMP_LEGACY_NOTE];
  const book = GROWTH_BOOKS[index];
  const probe = memoProbe(deps.probeFmp);
  const local: GrowthDeps = { ...deps, probeFmp: probe };
  const rates = await usdPerUnit();
  if (!deps.fmpAvailable) {
    notes.push("FMP nicht konfiguriert");
  } else {
    for (const symbol of book.fmpSymbols) {
      const raw = await probeConsensus(symbol, local, notes);
      const consensus = raw ? consensusForOneYear(raw, deps.today) : null;
      if (!consensus) {
        if (raw && nextConsensusEps(raw, deps.today)) {
          notes.push(`${symbol}: Konsens-FY ohne positiven Horizont t`);
        }
        continue;
      }
      const grown = await annualizedFromConsensus(symbol, consensus, local, notes, rates, () => loadYahooAdjusted(symbol, deps, notes));
      if (!grown) continue;
      if ("excludeReason" in grown) {
        notes.push(`${symbol}: ${grown.excludeReason}`);
        continue;
      }
      return {
        forward: {
          available: true,
          gFwdPct: grown.gFwdPct,
          epsConsensus: grown.epsConsensus,
          epsTtm: grown.epsTtm,
          asOf: consensus.date,
          source: grown.via,
          formula: FORWARD_FORMULA_EPS,
          lines: [{
            symbol,
            gAnnPct: grown.gFwdPct,
            indexWeight: 1,
            weight: horizonWeightFactor(consensus.horizonDays),
            tDays: consensus.horizonDays,
            source: grown.via,
            excludeReason: null,
          }],
        },
        trace: notes.join("; "),
      };
    }
    const earnLabel = callLabel("/earnings", { symbol: book.etf });
    try {
      const earned = await probe("/earnings", { symbol: book.etf });
      const shape = earned.status === 200 ? describeEarningsRows(earned.json, deps.today) : earned.detail;
      notes.push(`${earnLabel} HTTP ${earned.status || "n/a"}${shape ? `: ${shape}` : ""}`);
    } catch (err) {
      notes.push(`${earnLabel} fehlgeschlagen (${clip(err)})`);
    }
    let weights: { symbol: string; weight: number }[] = [];
    let weightOrigin = "";
    const holdLabel = callLabel("/etf/holdings", { symbol: book.etf });
    try {
      const held = await probe("/etf/holdings", { symbol: book.etf });
      const parsed = weightsFromHoldingsPayload(held.json).slice(0, GROWTH_HOLDINGS_PARAMS.maxNames);
      if (held.status === 200 && parsed.length) {
        weights = parsed;
        weightOrigin = "FMP /stable/etf/holdings";
        notes.push(`${holdLabel} HTTP 200, ${parsed.length} Gewichte`);
      } else {
        notes.push(`${holdLabel} HTTP ${held.status || "n/a"}: ${held.detail || "keine Gewichte"}`);
      }
    } catch (err) {
      notes.push(`${holdLabel} fehlgeschlagen (${clip(err)})`);
    }
    if (!weights.length) {
      try {
        const sink: YahooCallDiag[] = [];
        const yahoo = await deps.loadYahooSummary(book.etf, ["topHoldings"], sink);
        const parsed = weightsFromHoldingsPayload(yahoo).slice(0, GROWTH_HOLDINGS_PARAMS.maxNames);
        if (parsed.length) {
          weights = parsed;
          weightOrigin = "Yahoo quoteSummary topHoldings";
          notes.push(`Yahoo topHoldings ${book.etf}: ${parsed.length} Gewichte`);
        } else {
          notes.push(sink.length ? yahooMiss(book.etf, sink) : `Yahoo topHoldings ${book.etf}: keine Gewichte`);
        }
      } catch (err) {
        notes.push(`Yahoo topHoldings ${book.etf} fehlgeschlagen (${clip(err)})`);
      }
    }
    if (!weights.length && deps.loadYahooHtml) {
      try {
        const page = await deps.loadYahooHtml(book.etf);
        const parsed = holdingsFromYahooHtml(page.html ?? "").slice(0, GROWTH_HOLDINGS_PARAMS.maxNames);
        if (parsed.length) {
          weights = parsed;
          weightOrigin = "Yahoo Quote-HTML topHoldings (keyless, HTTP/2)";
          notes.push(`Yahoo Quote-HTML ${book.etf}: ${parsed.length} Gewichte`);
        } else {
          notes.push(`Yahoo Quote-HTML ${book.etf} HTTP ${page.status ?? "n/a"}: ${page.error ?? "keine Holdings"}`);
        }
      } catch (err) {
        notes.push(`Yahoo Quote-HTML ${book.etf} fehlgeschlagen (${clip(err)})`);
      }
    }
    if (weights.length) {
      const rows: HoldingGrowthRow[] = [];
      const vias = new Set<string>();
      for (const row of weights) {
        const grown = await growthForHolding(row.symbol, local, notes, rates);
        if (grown.via) vias.add(grown.via);
        rows.push({
          symbol: row.symbol,
          weight: row.weight,
          gFwdPct: grown.gFwdPct,
          tDays: grown.tDays,
          source: grown.via || null,
          excludeReason: grown.excludeReason,
        });
      }
      const weighted = weightedHoldingsForward(rows);
      if (weighted.available) {
        const via = Array.from(vias).join(" + ") || "FMP";
        return {
          forward: {
            available: true,
            gFwdPct: weighted.gFwdPct,
            epsConsensus: null,
            epsTtm: null,
            asOf: deps.today,
            source: `${via} · Gewichte ${weightOrigin} · ${weighted.note} · ${weighted.used.join(", ")}`,
            formula: weighted.formula,
            coverageWarn: weighted.coverageWarn,
            lines: weighted.lines,
          },
          trace: notes.join("; "),
        };
      }
      notes.push(weighted.reason);
      return {
        forward: { available: false, reason: weighted.reason, lines: weighted.lines },
        trace: notes.join("; "),
      };
    }
  }
  const reason = shortForwardReason(notes);
  return { forward: { available: false, reason }, trace: notes.join("; ") };
}

function shortForwardReason(notes: string[]): string {
  const pick = (re: RegExp) => notes.find(n => re.test(n));
  const chosen = [
    pick(/minCoverage/),
    pick(/analyst-estimates\?symbol=SPY/),
    pick(/analyst-estimates\?symbol=(%5E|\^)GSPC[^;]*limit=8/),
    pick(/etf\/holdings/),
    pick(/Quote-HTML|crumb|earningsTrend fehlt|topHoldings|FMP nicht konfiguriert/),
  ].filter((line): line is string => !!line).map(line => line.slice(0, 220));
  const body = (chosen.length ? chosen : notes.slice(0, 2)).join("; ");
  return `n/a — Forward-Konsens: ${body}`;
}

export async function loadRecessionGrowth(index: GrowthIndex, deps: GrowthDeps = defaultGrowthDeps()): Promise<RecessionGrowthBody> {
  const book = GROWTH_BOOKS[index];
  const [bars, realized, forward, vix] = await Promise.all([
    deps.loadBars(book.etf).catch(err => ({ bars: [] as { date: string; close: number }[], source: null, error: `n/a — Kurs: ${clip(err)}` })),
    loadRealized(index, deps),
    loadForward(index, deps),
    index === "SPY"
      ? deps.loadVix(yearsAgo(deps.today, GROWTH_GAP_PARAMS.medianWindowYears + 1)).then(
          points => ({ points, error: null as string | null }),
          err => ({ points: [] as { date: string; value: number }[], error: `n/a — VIX: ${clip(err)}` }),
        )
      : Promise.resolve({
          points: [] as { date: string; value: number }[],
          error: `n/a — VIX-Spike nur über FRED VIXCLS am S&P 500, nicht an ${book.etf}`,
        }),
  ]);
  const input: GrowthBuildInput = {
    index,
    price: bars.bars.map(b => ({ date: b.date, close: b.close })),
    priceSource: bars.source,
    priceError: bars.bars.length ? null : (bars.error ?? "n/a — kein Kurs"),
    realized: realized.prints,
    realizedSource: realized.source,
    realizedError: realized.error,
    realizedFrequency: realized.frequency,
    forward: forward.forward,
    consensusTrace: forward.trace,
    vixPoints: vix.points,
    vixSource: "FRED VIXCLS",
    vixError: vix.error,
  };
  return buildGrowthBody(input);
}
