/**
 * server/sector-rotation.ts — Sprint C1 P0 (WORK_SEKTORROTATIONS_RAT.md)
 */
import type { DailyBar } from "./history-fallback";
import {
  ETF_PROXY_MAP,
  SPX_PROXY_ETF,
  mean,
  metricsFromBars,
} from "./sector-rotation-math";
import { computeSectorRotation, type RecessionLike, type SectorRotationResult } from "./sector-rotation-score";

export * from "./sector-rotation-math";
export * from "./sector-rotation-score";

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }
  return null;
}

function pickPe(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  return numOrNull(row.pe)
    ?? numOrNull(row.peRatio)
    ?? numOrNull(row.peRatioTTM)
    ?? numOrNull(row.priceToEarningsRatio)
    ?? numOrNull(row.priceEarningsRatio)
    ?? numOrNull(row.priceEarningsRatioTTM)
    ?? numOrNull(row.priceToEarnings);
}

/**
 * Live-Orchestrierung. Dynamische Imports, damit Fixture-Tests die Engine
 * ohne FMP/FRED/sector-data laden. sector-data Defaults NUR wenn Live-PE fehlt
 * (zaehlt NICHT als pe10yCoverage).
 */
export async function fetchSectorRotationLive(): Promise<SectorRotationResult> {
  const { altFetchYahooThenStooq, fromDateForTimeframe } = await import("./history-fallback");
  const { fmpRatios, isFmpAvailable } = await import("./fmp");
  const { getSectorDefaults } = await import("./sector-data");
  const { runRecessionAnalysis } = await import("./recession");

  const to = new Date().toISOString().slice(0, 10);
  const from = fromDateForTimeframe("1Y");

  let recession: RecessionLike = { indicators: [], subgroups: [], nyFedValue: null, interpretation: "" };
  try {
    recession = await runRecessionAnalysis();
  } catch (err) {
    console.warn(`[SECTOR-ROTATION] runRecessionAnalysis failed: ${(err as Error)?.message ?? err}`);
  }

  let spxBars: DailyBar[] = [];
  try {
    spxBars = await altFetchYahooThenStooq(SPX_PROXY_ETF, from, to);
  } catch (err) {
    console.warn(`[SECTOR-ROTATION] SPX proxy ${SPX_PROXY_ETF} failed: ${(err as Error)?.message ?? err}`);
  }

  // OHLCV: Yahoo/Stooq in parallel (kein FMP-Quote). Render: Client 90s,
  // FMP 15s Abort + 250ms Spacing sitzt in fmpFetch. PE daher sequentiell,
  // max 9 fmpRatios, hartes Zeitbudget damit ein Cold-Start nicht die 90s sprengt.
  const ohlcv = await Promise.all(ETF_PROXY_MAP.map(async (proxy) => {
    let bars: DailyBar[] = [];
    try {
      bars = await altFetchYahooThenStooq(proxy.etf, from, to);
    } catch (err) {
      console.warn(`[SECTOR-ROTATION] OHLCV ${proxy.etf} failed: ${(err as Error)?.message ?? err}`);
    }
    return { proxy, metrics: metricsFromBars(bars, spxBars) };
  }));

  const fmpOn = isFmpAvailable();
  const PE_BUDGET_MS = 20_000;
  const peStarted = Date.now();

  const perSector = [];
  for (const { proxy, metrics } of ohlcv) {
    let pe: number | null = null;
    let pe10y: number | null = null;

    if (fmpOn && Date.now() - peStarted < PE_BUDGET_MS) {
      try {
        const ratios = await fmpRatios(proxy.etf, 10);
        const rows: Record<string, unknown>[] = Array.isArray(ratios) ? ratios : [];
        const pes = rows.map(r => pickPe(r)).filter((v): v is number => v != null);
        if (pes.length > 0) pe = pes[0];
        if (pes.length >= 5) pe10y = mean(pes);
      } catch { /* live PE optional — Coverage sinkt, kein Throw */ }
    }

    if (pe == null) {
      try {
        const d = getSectorDefaults(proxy.sectorDefaultKey, "");
        pe = numOrNull(d.sectorAvgPE);
      } catch { /* sector-data fallback optional */ }
    }

    perSector.push({
      id: proxy.id,
      vol60d: metrics.vol60d,
      betaSpx: metrics.betaSpx,
      maxDd12m: metrics.maxDd12m,
      pe,
      pe10y,
      return6M: metrics.return6M,
      lastDate: metrics.lastDate,
    });
  }

  const dates = perSector.map(s => s.lastDate).filter((d): d is string => !!d).sort();
  const asOf = dates.length > 0 ? dates[dates.length - 1] : to;

  return computeSectorRotation({ asOf, recession, sectors: perSector });
}
