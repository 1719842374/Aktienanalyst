/**
 * GET /api/researcher/sector-pe — Sektor-KGV nur als Anzeige.
 * Schreibt nicht in pe/pe10y der Sektorrotation und nicht in den Aktien-Score.
 * Gleiches Zeitbudget wie PE_BUDGET_MS in sector-rotation.ts.
 */
import type { Express, Request, Response } from "express";
import type { SectorPeResponse } from "../shared/schema";
import { canStopHoldingsFetch, composeSectorPeDisplay, type HoldingWeight } from "../shared/sector-pe-display";
import { ETF_PROXY_MAP } from "./sector-rotation-math";
import { fmpEtfHoldings, fmpRatios, isFmpAvailable } from "./fmp";
import { loadYahooEtfTrailingPe, type YahooTrailingPe } from "./yahoo-fundamental-fallback";

/** Wanduhr-Budget, analog PE_BUDGET_MS im Score-Pfad. Die Anzeige bricht ab, der Score-Pfad läuft separat. */
export const SECTOR_PE_FETCH_BUDGET_MS = 20_000;
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface SectorPeDeps {
  ratios: (symbol: string, limit: number) => Promise<unknown>;
  holdings: (symbol: string) => Promise<unknown>;
  now: () => number;
  /** Trailing PE des ETFs selbst, wenn Holdings und Ratios nichts liefern. */
  etfTrailingPe?: (symbol: string) => Promise<YahooTrailingPe>;
}

const defaultDeps: SectorPeDeps = {
  ratios: (symbol, limit) => fmpRatios(symbol, limit),
  holdings: symbol => fmpEtfHoldings(symbol),
  now: () => Date.now(),
  etfTrailingPe: symbol => loadYahooEtfTrailingPe(symbol),
};

let cache: { at: number; body: SectorPeResponse } | null = null;

export function resetSectorPeCacheForTests(): void {
  cache = null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function pickRatioPe(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  const candidates = [row.pe, row.peRatio, row.peRatioTTM, row.priceToEarningsRatio, row.priceEarningsRatio, row.priceEarningsRatioTTM, row.priceToEarnings];
  for (const c of candidates) {
    const n = num(c);
    if (n != null && n > 0) return n;
  }
  return null;
}

export function parseHoldingRows(raw: unknown): { symbol: string; weight: number | null }[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: { symbol: string; weight: number | null }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = String(r.asset ?? r.symbol ?? r.assetSymbol ?? "").trim().toUpperCase();
    if (!symbol || symbol.includes(" ")) continue;
    const weight = num(r.weightPercentage) ?? num(r.weight) ?? num(r.weightPercent);
    out.push({ symbol, weight: weight != null && weight > 0 ? weight : null });
  }
  return out.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}

function historyFromRatios(raw: unknown): { date: string; pe: number | null }[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map(row => {
    const r = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const date = typeof r.date === "string" ? r.date.slice(0, 10) : "";
    return { date, pe: pickRatioPe(r) };
  }).filter(p => p.date);
}

export async function loadSectorPeDisplay(deps: SectorPeDeps = defaultDeps): Promise<SectorPeResponse> {
  const now = deps.now();
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const started = now;
  let holdingsDown: string | null = null;
  const sectors = [];
  for (const proxy of ETF_PROXY_MAP) {
    if (deps.now() - started > SECTOR_PE_FETCH_BUDGET_MS) {
      sectors.push(composeSectorPeDisplay({
        id: proxy.id,
        etf: proxy.etf,
        label: proxy.label,
        holdings: null,
        etfHistory: null,
        holdingsNote: "n/a — Zeitbudget der Anzeige erschöpft",
      }));
      continue;
    }
    let history: { date: string; pe: number | null }[] = [];
    try {
      history = historyFromRatios(await deps.ratios(proxy.etf, 12));
    } catch {
      history = [];
    }
    let holdings: HoldingWeight[] | null = null;
    let holdingsNote: string | null = holdingsDown;
    if (!holdingsDown) {
      try {
        const parsed = parseHoldingRows(await deps.holdings(proxy.etf)).filter(h => h.symbol !== proxy.etf);
        const fetched: HoldingWeight[] = [];
        for (let i = 0; i < parsed.length; i++) {
          if (deps.now() - started > SECTOR_PE_FETCH_BUDGET_MS) break;
          const row = parsed[i];
          if (row.weight == null) {
            fetched.push({ symbol: row.symbol, weight: null, pe: null });
            continue;
          }
          let pe: number | null = null;
          try {
            const ratios = await deps.ratios(row.symbol, 1);
            const first = Array.isArray(ratios) ? ratios[0] : null;
            pe = pickRatioPe(first && typeof first === "object" ? first as Record<string, unknown> : null);
          } catch {
            pe = null;
          }
          fetched.push({ symbol: row.symbol, weight: row.weight, pe });
          const rest = parsed[i + 1]?.weight ?? 0;
          if (canStopHoldingsFetch(rest, fetched)) break;
        }
        holdings = fetched;
        if (fetched.length === 0) holdingsNote = "n/a — ETF-Holdings leer";
      } catch (err) {
        holdingsDown = `n/a — Holdings nicht geladen (${err instanceof Error ? err.message.slice(0, 80) : "Fehler"})`;
        holdingsNote = holdingsDown;
        holdings = null;
      }
    }
    let historyOrigin: "etf-ratios" | "yahoo-trailing-pe" | undefined;
    let sourceLabel: string | null = null;
    const draft = composeSectorPeDisplay({
      id: proxy.id,
      etf: proxy.etf,
      label: proxy.label,
      holdings,
      etfHistory: history,
      holdingsNote,
    });
    if (draft.current == null && deps.now() - started <= SECTOR_PE_FETCH_BUDGET_MS) {
      try {
        const trailing = await (deps.etfTrailingPe ?? defaultDeps.etfTrailingPe)?.(proxy.etf);
        if (trailing?.pe != null) {
          history = [{ date: new Date(deps.now()).toISOString().slice(0, 10), pe: trailing.pe }];
          historyOrigin = "yahoo-trailing-pe";
          sourceLabel = trailing.source;
        } else if (trailing?.note) {
          holdingsNote = [holdingsNote, trailing.note].filter((n): n is string => !!n).join(" · ");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 80) : "Fehler";
        holdingsNote = [holdingsNote, `n/a — ETF-KGV nicht geladen (${msg})`].filter((n): n is string => !!n).join(" · ");
      }
    }
    sectors.push(composeSectorPeDisplay({
      id: proxy.id,
      etf: proxy.etf,
      label: proxy.label,
      holdings,
      etfHistory: history,
      holdingsNote,
      historyOrigin,
      sourceLabel,
    }));
  }
  const body: SectorPeResponse = {
    asOf: new Date(now).toISOString().slice(0, 10),
    sectors,
    scoreImpact: false,
  };
  if (sectors.some(s => s.current != null || s.avg10y != null)) cache = { at: now, body };
  return body;
}

export function registerSectorPeRoute(app: Express, deps: SectorPeDeps = defaultDeps): void {
  app.get("/api/researcher/sector-pe", async (_req: Request, res: Response) => {
    if (!isFmpAvailable() && deps === defaultDeps) {
      const empty: SectorPeResponse = {
        asOf: new Date().toISOString().slice(0, 10),
        sectors: ETF_PROXY_MAP.map(proxy => composeSectorPeDisplay({
          id: proxy.id,
          etf: proxy.etf,
          label: proxy.label,
          holdings: null,
          etfHistory: null,
          holdingsNote: "n/a — FMP nicht konfiguriert",
        })),
        scoreImpact: false,
      };
      return res.json(empty);
    }
    try {
      res.json(await loadSectorPeDisplay(deps));
    } catch (err) {
      const note = `n/a — Abruf fehlgeschlagen (${err instanceof Error ? err.message.slice(0, 80) : "Fehler"})`;
      res.json({
        asOf: new Date().toISOString().slice(0, 10),
        sectors: ETF_PROXY_MAP.map(proxy => composeSectorPeDisplay({
          id: proxy.id, etf: proxy.etf, label: proxy.label, holdings: null, etfHistory: null, holdingsNote: note,
        })),
        scoreImpact: false,
      });
    }
  });
}
