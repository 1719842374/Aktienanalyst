/**
 * Lädt Kurs, Multpl-YoY, optional FMP-Forward und VIX für die Growth-Karte.
 * Nur Anzeige. Fehlende Quelle → n/a mit Grund, kein Ersatzwert.
 */
import { isFmpAvailable, fmpAnalystEstimates, fmpIncomeStatement, fmpRatiosTtm } from "./fmp";
import { fetchFredVolSeries } from "./recession-markets";
import { loadEtfBars } from "./recession-ta-route";
import { ttmEpsFromRatiosTtmRow, epsPrintFromRow } from "../shared/recession-market-charts";
import {
  GROWTH_BOOKS,
  GROWTH_GAP_PARAMS,
  buildGrowthBody,
  forwardFromEps,
  multplGrowthPrints,
  nextConsensusEps,
  yoyFromAnnualEps,
  type ForwardReading,
  type GrowthBuildInput,
  type GrowthFrequency,
  type GrowthIndex,
  type GrowthPrint,
  type RecessionGrowthBody,
} from "../shared/recession-growth";

export const MULTPL_GROWTH_URL = "https://www.multpl.com/s-p-500-earnings-growth/table/by-quarter";
export const MULTPL_GROWTH_SOURCE = "Multpl S&P 500 Earnings Growth (current dollars, quarterly)";

export interface GrowthDeps {
  loadBars: (symbol: string) => Promise<{ bars: { date: string; close: number }[]; source: "fmp" | "yahoo" | null; error: string | null }>;
  fetchMultpl: () => Promise<string | null>;
  loadEstimates: (symbol: string) => Promise<unknown>;
  loadTtm: (symbol: string) => Promise<unknown>;
  loadIncome: (symbol: string) => Promise<unknown>;
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

export function defaultGrowthDeps(today = new Date().toISOString().slice(0, 10)): GrowthDeps {
  return {
    loadBars: loadEtfBars,
    fetchMultpl: defaultFetchMultpl,
    loadEstimates: symbol => fmpAnalystEstimates(symbol, 8),
    loadTtm: symbol => fmpRatiosTtm(symbol),
    loadIncome: symbol => fmpIncomeStatement(symbol, 40),
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

async function loadForward(index: GrowthIndex, deps: GrowthDeps): Promise<ForwardReading> {
  if (!deps.fmpAvailable) return { available: false, reason: "n/a — Forward-Konsens: FMP nicht konfiguriert" };
  const notes: string[] = [];
  for (const symbol of GROWTH_BOOKS[index].fmpSymbols) {
    const estimateCall = `GET /stable/analyst-estimates?symbol=${symbol}&period=annual`;
    const ttmCall = `GET /stable/ratios-ttm?symbol=${symbol}`;
    try {
      const consensus = nextConsensusEps(await deps.loadEstimates(symbol), deps.today);
      const ttm = ttmEpsFromRatiosTtmRow(await deps.loadTtm(symbol));
      const forward = forwardFromEps(consensus?.eps ?? null, ttm, consensus?.date ?? deps.today, `FMP ${estimateCall} + ${ttmCall}`);
      if (forward.available) return forward;
      notes.push(`${symbol}: ${forward.reason.replace(/^n\/a — /, "")}`);
    } catch (err) {
      notes.push(`${symbol}: ${clip(err)}`);
    }
  }
  return { available: false, reason: `n/a — Forward-Konsens: ${notes.join("; ")}` };
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
    forward,
    vixPoints: vix.points,
    vixSource: "FRED VIXCLS",
    vixError: vix.error,
  };
  return buildGrowthBody(input);
}
