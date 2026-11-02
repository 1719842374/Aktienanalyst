/**
 * Lädt Kurs, Multpl-YoY, optional FMP-Forward und VIX für die Growth-Karte.
 * Nur Anzeige. Fehlende Quelle → n/a mit Grund, kein Ersatzwert.
 */
import { isFmpAvailable, fmpIncomeStatement, fmpObserved } from "./fmp";
import { fetchYahooQuoteHtml } from "./yahoo-fundamental-fallback";
import { fetchFredVolSeries } from "./recession-markets";
import { loadEtfBars } from "./recession-ta-route";
import { fetchYahooQuoteSummaryResult, type YahooCallDiag } from "./yahoo-fetcher";
import { ttmEpsFromRatiosTtmRow, epsPrintFromRow } from "../shared/recession-market-charts";
import {
  FMP_LEGACY_NOTE,
  FORWARD_FORMULA_YAHOO_GROWTH,
  FORWARD_FORMULA_YAHOO_HTML,
  FORWARD_HORIZON,
  GROWTH_BOOKS,
  GROWTH_GAP_PARAMS,
  GROWTH_HOLDINGS_PARAMS,
  buildGrowthBody,
  alignConsensusToTtm,
  annualizedFwdPct,
  consensusForOneYear,
  describeAnalystEstimates,
  describeEarningsRows,
  forwardFromEps,
  forwardFromYahooQuoteSummary,
  holdingsFromYahooHtml,
  yahooEpsContext,
  multplGrowthPrints,
  nextConsensusEps,
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

async function ttmOf(symbol: string, deps: GrowthDeps, notes: string[]): Promise<{ ttm: number | null; currency: string | null }> {
  const label = callLabel("/ratios-ttm", { symbol });
  try {
    const res = await deps.probeFmp("/ratios-ttm", { symbol });
    const ttm = ttmEpsFromRatiosTtmRow(res.json);
    if (res.status !== 200 || ttm == null) {
      notes.push(`${label} HTTP ${res.status || "n/a"}: ${res.status === 200 ? "kein netIncomePerShareTTM" : res.detail}`);
    }
    return { ttm, currency: assumedCurrency(symbol, rowCurrency(res.json)) };
  } catch (err) {
    notes.push(`${label} fehlgeschlagen (${clip(err)})`);
    return { ttm: null, currency: null };
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
  asOf: string,
  days: number,
  source: string,
): { gFwdPct: number; via: string } | null {
  const base = forwardFromEps(consensus, ttm, asOf, source);
  if (!base.available) return null;
  const adj = annualizedFwdPct(consensus, ttm, days);
  const horizon = adj.annualized
    ? `Horizont ${Math.round(days)} Tage > annualizeAfterDays ${FORWARD_HORIZON.annualizeAfterDays}, CAGR auf 1J`
    : `Horizont ${Math.round(days)} Tage`;
  return { gFwdPct: adj.gFwdPct, via: `${source} · ${horizon}` };
}

function yahooMiss(symbol: string, sink: YahooCallDiag[]): string {
  const detail = sink.map(d => `${d.stage} ${d.status ?? "-"} ${d.detail}`).join("; ");
  return detail
    ? `n/a — Yahoo quoteSummary ${symbol}: ${detail}`
    : `n/a — Yahoo quoteSummary ${symbol} leer`;
}

async function yahooForward(symbol: string, deps: GrowthDeps): Promise<ForwardReading> {
  const source = `Yahoo quoteSummary earningsTrend + defaultKeyStatistics.trailingEps ${symbol} (keyless)`;
  const sink: YahooCallDiag[] = [];
  try {
    const raw = await deps.loadYahooSummary(symbol, ["earningsTrend", "defaultKeyStatistics"], sink);
    if (!raw) return { available: false, reason: yahooMiss(symbol, sink) };
    return forwardFromYahooQuoteSummary(raw, deps.today, source);
  } catch (err) {
    return { available: false, reason: `n/a — Yahoo earningsTrend ${symbol} fehlgeschlagen (${clip(err)})` };
  }
}

async function growthForHolding(
  symbol: string,
  deps: GrowthDeps,
  notes: string[],
  rates: Record<string, number> | null,
): Promise<{ gFwdPct: number | null; via: string }> {
  const raw = await probeConsensus(symbol, deps, notes);
  const consensus = raw ? consensusForOneYear(raw, deps.today) : null;
  let yahooHit: ForwardReading | null = null;
  const yahooOnce = async () => {
    if (!yahooHit) yahooHit = await yahooForward(symbol, deps);
    return yahooHit;
  };
  if (consensus) {
    const ttm = await ttmOf(symbol, deps, notes);
    const consensusCcy = assumedCurrency(symbol, consensus.currency);
    if (ttm.ttm != null && ttm.currency && consensusCcy) {
      const aligned = alignConsensusToTtm(consensus.eps, consensusCcy, ttm.ttm, ttm.currency, rates);
      if ("error" in aligned) {
        notes.push(`${symbol}: ${aligned.error}`);
      } else {
        const forward = datedForward(aligned.consensus, aligned.ttm, consensus.date, consensus.horizonDays, `FMP ${aligned.note}`);
        if (forward) return forward;
      }
    } else if (ttm.ttm == null) {
      const yahooTtm = await yahooOnce();
      if (yahooTtm.available && yahooTtm.epsTtm != null && consensusCcy) {
        const aligned = alignConsensusToTtm(consensus.eps, consensusCcy, yahooTtm.epsTtm, consensusCcy, rates);
        if (!("error" in aligned)) {
          const forward = datedForward(aligned.consensus, aligned.ttm, consensus.date, consensus.horizonDays, `FMP epsAvg + Yahoo trailingEps ${aligned.note}`);
          if (forward) return forward;
        }
      }
    } else {
      notes.push(`${symbol}: Währung fehlt`);
    }
  }
  const yahoo = await yahooOnce();
  if (!yahoo.available && deps.loadYahooHtml) {
    try {
      const page = await deps.loadYahooHtml(symbol);
      const ctx = yahooEpsContext(page.html ?? "", symbol);
      const ccy = ctx.financialCurrency;
      if (ctx.forward != null && ctx.trailing != null && ccy) {
        const aligned = alignConsensusToTtm(ctx.forward, ccy, ctx.trailing, ccy, rates);
        if ("error" in aligned) {
          notes.push(`${symbol}: ${aligned.error}`);
        } else {
          const quoteNote = ctx.quoteCurrency && ctx.quoteCurrency !== ccy
            ? `, Kurs ${ctx.quoteCurrency}`
            : "";
          const htmlFwd = forwardFromEps(
            aligned.consensus,
            aligned.ttm,
            deps.today,
            `Yahoo Quote-HTML ${symbol} (keyless, HTTP/2) · Horizont 1J (forwardEps, nächstes Geschäftsjahr) · EPS ${aligned.note}${quoteNote}`,
            FORWARD_FORMULA_YAHOO_HTML,
          );
          if (htmlFwd.available) return { gFwdPct: htmlFwd.gFwdPct, via: "Yahoo Quote-HTML" };
          notes.push(`${symbol}: ${htmlFwd.reason}`);
        }
      } else {
        notes.push(`${symbol}: ${page.error ?? "Yahoo Quote-HTML ohne EPS-Paar oder ohne financialCurrency"}`);
      }
    } catch (err) {
      notes.push(`${symbol}: Yahoo Quote-HTML fehlgeschlagen (${clip(err)})`);
    }
  }
  if (yahoo.available) {
    const via = yahoo.formula === FORWARD_FORMULA_YAHOO_GROWTH ? "Yahoo earningsTrend growth" : "Yahoo earningsTrend";
    return { gFwdPct: yahoo.gFwdPct, via: `${via} · Horizont 1J (+1y)` };
  }
  notes.push(`${symbol}: ${yahoo.reason}`);
  return { gFwdPct: null, via: "" };
}

async function loadForward(index: GrowthIndex, deps: GrowthDeps): Promise<{ forward: ForwardReading; trace: string }> {
  const notes: string[] = [FMP_LEGACY_NOTE];
  const book = GROWTH_BOOKS[index];
  const probe = memoProbe(deps.probeFmp);
  const local: GrowthDeps = { ...deps, probeFmp: probe };
  const rates = await usdPerUnit();
  let thinCoverage: string | null = null;
  if (!deps.fmpAvailable) {
    notes.push("FMP nicht konfiguriert");
  } else {
    for (const symbol of book.fmpSymbols) {
      const raw = await probeConsensus(symbol, local, notes);
      const consensus = raw ? consensusForOneYear(raw, deps.today) : null;
      if (!consensus) continue;
      const ttm = await ttmOf(symbol, local, notes);
      const consensusCcy = assumedCurrency(symbol, consensus.currency);
      if (ttm.ttm == null || !ttm.currency || !consensusCcy) {
        notes.push(`${symbol}: TTM oder Währung fehlt`);
        continue;
      }
      const aligned = alignConsensusToTtm(consensus.eps, consensusCcy, ttm.ttm, ttm.currency, rates);
      if ("error" in aligned) {
        notes.push(`${symbol}: ${aligned.error}`);
        continue;
      }
      const dated = datedForward(
        aligned.consensus,
        aligned.ttm,
        consensus.date,
        consensus.horizonDays,
        `FMP ${callLabel("/analyst-estimates", { symbol, period: "annual", limit: "8" })} + ${callLabel("/ratios-ttm", { symbol })} · ${aligned.note}`,
      );
      if (!dated) continue;
      const forward = forwardFromEps(aligned.consensus, aligned.ttm, consensus.date, dated.via);
      if (forward.available) {
        return { forward: { ...forward, gFwdPct: dated.gFwdPct, source: dated.via }, trace: notes.join("; ") };
      }
      notes.push(`${symbol}: ${forward.reason}`);
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
        rows.push({ symbol: row.symbol, weight: row.weight, gFwdPct: grown.gFwdPct });
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
          },
          trace: notes.join("; "),
        };
      }
      notes.push(weighted.reason);
      if (weighted.reason.includes("minCoverage")) thinCoverage = weighted.reason;
    }
  }
  for (const symbol of book.fmpSymbols) {
    const yahoo = await yahooForward(symbol, deps);
    if (yahoo.available) {
      if (!thinCoverage) return { forward: yahoo, trace: notes.join("; ") };
      return {
        forward: {
          ...yahoo,
          coverageWarn: thinCoverage,
          source: `${yahoo.source} · ${thinCoverage}`,
        },
        trace: notes.join("; "),
      };
    }
    notes.push(`${symbol}: ${yahoo.reason}`);
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
