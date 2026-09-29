import type { Express, Request, Response } from "express";
import { classifyFmpError, fmpHistoricalPrices, isFmpAvailable, type FmpFailure } from "./fmp";

type Bar = { date: string; close: number };
type Meta = { n: number; first: string | null; last: string | null; truncated: boolean };

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { ts: number; bars: Bar[] }>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addYearsIso(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function clampFromTo(fromRaw: string, toRaw: string): { from: string; to: string } {
  const today = todayIso();
  let to = (toRaw || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to > today) to = today;
  const minFrom = addYearsIso(today, -5);
  let from = (fromRaw || minFrom).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < minFrom) from = minFrom;
  if (from > to) from = to;
  return { from, to };
}

function normalizeBars(raw: any): Bar[] {
  return (Array.isArray(raw) ? raw : [])
    .map((r: any) => ({
      date: String(r?.date ?? "").slice(0, 10),
      close: Number(r?.close ?? r?.adjClose),
    }))
    .filter((p) => p.date && Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function clearOhlcvCacheForTests(): void {
  cache.clear();
}

type OhlcvDeps = {
  isAvailable: () => boolean;
  fetchPrices: (ticker: string, from: string, to: string) => Promise<unknown>;
};

type LoadResult = { ok: true; bars: Bar[] } | { ok: false; failure: FmpFailure };

// Only non-empty series are cached: a 429 or an empty FMP answer must not pin [] for 24h.
async function loadBars(deps: OhlcvDeps, ticker: string, from: string, to: string): Promise<LoadResult> {
  const key = `ohlcv:${ticker}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return { ok: true, bars: hit.bars };
  try {
    const raw = await deps.fetchPrices(ticker, from, to);
    const bars = normalizeBars(raw);
    if (bars.length === 0) {
      const rawRows = Array.isArray(raw) ? raw.length : 0;
      const failure: FmpFailure = {
        errorCode: "FMP_NO_DATA",
        fmpStatus: 200,
        message: `FMP lieferte keine Kurse für ${ticker} ${from}..${to} (${rawRows} Rohzeilen, 0 gültig)`,
      };
      console.warn(`[OHLCV] ${ticker} FMP_NO_DATA: ${failure.message}`);
      return { ok: false, failure };
    }
    cache.set(key, { ts: Date.now(), bars });
    return { ok: true, bars };
  } catch (err) {
    const failure = classifyFmpError(err);
    console.warn(`[OHLCV] ${ticker} ${failure.errorCode} fmpStatus=${failure.fmpStatus ?? "-"}: ${failure.message}`);
    return { ok: false, failure };
  }
}

function httpStatusFor(failures: FmpFailure[]): number {
  if (failures.some((f) => f.errorCode === "RATE_LIMITED")) return 429;
  if (failures.some((f) => f.errorCode === "FMP_NOT_CONFIGURED")) return 503;
  if (failures.some((f) => f.errorCode === "FMP_UPSTREAM_ERROR")) return 502;
  if (failures.some((f) => f.errorCode === "FMP_UNREACHABLE")) return 503;
  return 404;
}

export function registerOhlcvRoute(app: Express, depsOverride: Partial<OhlcvDeps> = {}) {
  const deps: OhlcvDeps = {
    isAvailable: isFmpAvailable,
    fetchPrices: fmpHistoricalPrices,
    ...depsOverride,
  };
  app.get("/api/ohlcv", async (req: Request, res: Response) => {
    const tickers = String(req.query.tickers || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 12);
    const { from, to } = clampFromTo(String(req.query.from || ""), String(req.query.to || ""));

    if (!deps.isAvailable()) {
      return res.status(503).json({
        error: "FMP nicht konfiguriert",
        errorCode: "FMP_NOT_CONFIGURED",
        fmpStatus: null,
        from, to, source: null, bars: {}, meta: {},
      });
    }

    const bars: Record<string, Bar[]> = {};
    const meta: Record<string, Meta> = {};
    const errors: Record<string, FmpFailure> = {};
    for (const t of tickers) {
      const result = await loadBars(deps, t, from, to);
      if (!result.ok) {
        errors[t] = result.failure;
        continue;
      }
      const series = result.bars;
      bars[t] = series;
      const first = series[0]?.date ?? null;
      const last = series[series.length - 1]?.date ?? null;
      const truncated = series.length === 0 || (!!first && first > from);
      meta[t] = { n: series.length, first, last, truncated };
    }

    const failures = Object.values(errors);
    if (failures.length > 0 && Object.keys(bars).length === 0) {
      const primary = failures.find((f) => f.errorCode === "RATE_LIMITED") ?? failures[0];
      return res.status(httpStatusFor(failures)).json({
        error: primary.errorCode === "RATE_LIMITED"
          ? `FMP Rate-Limit (HTTP 429) — ${primary.message}`
          : `FMP-Abruf fehlgeschlagen (${primary.fmpStatus ?? primary.errorCode}) — ${primary.message}`,
        errorCode: primary.errorCode,
        fmpStatus: primary.fmpStatus,
        from, to, source: null, bars: {}, meta: {}, errors,
      });
    }

    res.json({ from, to, source: "fmp", bars, meta, ...(failures.length ? { errors } : {}) });
  });
}
