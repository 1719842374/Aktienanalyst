import { useQuery } from "@tanstack/react-query";
import {
  dividendAdaptiveThreshold,
  dividendNotableHint,
  dividendYieldSpan,
  peerDividendMedian,
  sectorDividendMedian,
  type DividendAdaptiveThreshold,
  type DividendHistoryResponse,
  type DividendMedianResult,
  type DividendYieldSpan,
} from "@shared/dividends";
import { dividendKpiDisplay } from "./dividendKpi";

/** One query for /api/dividends/:ticker, shared by the TA overlay (Section 12) and the Div.-Yield KPI (Section 1 + Section 4). */
export function useDividendHistory(ticker: string | null | undefined, enabled = true) {
  return useQuery<DividendHistoryResponse>({
    queryKey: ["dividends", "v2", ticker],
    enabled: enabled && !!ticker,
    staleTime: 12 * 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/dividends/${encodeURIComponent(String(ticker))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

/** JOB 20: Div.-Yield-Anzeige aus derselben Query + Funktion für Section 1 und Section 4. */
export function useDividendKpi(data: Parameters<typeof dividendKpiDisplay>[0] & { ticker: string }) {
  const q = useDividendHistory(data.ticker);
  // JOB 22: pending → Platzhalter statt GJ-Zwischenwert (deterministisch, unabhängig vom Lade-Timing).
  return dividendKpiDisplay(data, q.data, { pending: q.isPending && q.fetchStatus !== "idle" });
}

/** F1-17/F1-18: dieselbe /api/dividends-Query plus Peer-Yield aus der Analyse. Nur Anzeige. */
export interface DividendYieldContextInput {
  ticker?: string | null;
  currency?: string | null;
  ohlcvData?: { date: string; close: number }[] | null;
  historicalPrices?: { date: string; close: number }[] | null;
  peerComparison?: {
    peers?: Array<{ dividendYield?: number | null }> | null;
    sectorMedian?: { dividendYield?: number | null } | null;
  } | null;
}

export function useDividendYieldContext(data: DividendYieldContextInput): {
  span: DividendYieldSpan;
  peer: DividendMedianResult;
  sector: DividendMedianResult;
  threshold: DividendAdaptiveThreshold;
  hint: string | null;
} {
  const q = useDividendHistory(data.ticker);
  const bars = data.ohlcvData?.length ? data.ohlcvData : data.historicalPrices;
  let span: DividendYieldSpan;
  if (!data.ticker) span = { available: false, reason: "kein Ticker" };
  else if (q.isPending && q.data == null) span = { available: false, reason: "Dividendenhistorie wird geladen" };
  else if (q.isError && q.data == null) {
    const msg = q.error instanceof Error ? q.error.message : "Fehler";
    span = { available: false, reason: `Dividendenhistorie nicht geladen (${msg})` };
  } else span = dividendYieldSpan(q.data, bars, data.currency);
  const peers = data.peerComparison?.peers;
  const peer = peerDividendMedian(peers ? peers.map(p => p.dividendYield) : null, Array.isArray(peers));
  const sector = sectorDividendMedian(data.peerComparison?.sectorMedian?.dividendYield ?? null);
  const threshold = dividendAdaptiveThreshold(span, peer);
  return { span, peer, sector, threshold, hint: dividendNotableHint(span, peer) };
}
