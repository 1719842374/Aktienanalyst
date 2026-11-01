/**
 * FW-17: GET /api/gold-bond-ratio. Nur Anzeige auf /gold, kein Score.
 * Kette: GoldBondRatioRow → diese Route → Yahoo-Chart GC=F und TLT → shared/gold-bond-ratio.ts.
 */
import type { Express } from "express";
import {
  GOLD_BOND_PARAMS,
  closesFromYahooChart,
  goldBondSnapshot,
  type DatedClose,
  type GoldBondSnapshot,
} from "@shared/gold-bond-ratio";

export async function yahooDailyCloses(symbol: string): Promise<DatedClose[] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${GOLD_BOND_PARAMS.range}&interval=${GOLD_BOND_PARAMS.interval}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return closesFromYahooChart(await res.json());
  } catch {
    return null;
  }
}

export async function loadGoldBondRatio(
  fetchCloses: (symbol: string) => Promise<DatedClose[] | null> = yahooDailyCloses,
): Promise<GoldBondSnapshot> {
  const [gold, bond] = await Promise.all([
    fetchCloses(GOLD_BOND_PARAMS.goldSymbol),
    fetchCloses(GOLD_BOND_PARAMS.bondSymbol),
  ]);
  return goldBondSnapshot(gold, bond);
}

export function registerGoldBondRatioRoute(
  app: Express,
  deps: { fetchCloses?: (symbol: string) => Promise<DatedClose[] | null>; now?: () => number } = {},
): void {
  const fetchCloses = deps.fetchCloses ?? yahooDailyCloses;
  const now = deps.now ?? Date.now;
  let cache: { at: number; value: GoldBondSnapshot } | null = null;
  app.get("/api/gold-bond-ratio", async (_req, res) => {
    if (cache && now() - cache.at < GOLD_BOND_PARAMS.cacheTtlMs) return res.json(cache.value);
    try {
      const value = await loadGoldBondRatio(fetchCloses);
      if (value.ratio != null) cache = { at: now(), value };
      res.json(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const empty = goldBondSnapshot(null, null);
      res.json({ ...empty, unavailableReason: `n/a — ${message}` });
    }
  });
}
