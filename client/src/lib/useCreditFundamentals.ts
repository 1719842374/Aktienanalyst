import { useQuery } from "@tanstack/react-query";
import type { CreditFundamentalsResponse } from "@shared/schema";
import { CREDIT_TICKER_RE } from "@shared/credit";
import { getQueryFn } from "./queryClient";

/** Query-Pfad für GET /api/credit-fundamentals/:ticker. Peers sortiert, damit der Cache stabil bleibt. */
export function creditFundamentalsQueryKey(ticker: string, peers: readonly string[]): string {
  const self = ticker.trim().toUpperCase();
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of peers) {
    const peer = raw.trim().toUpperCase();
    if (!CREDIT_TICKER_RE.test(peer) || peer === self || seen.has(peer)) continue;
    seen.add(peer);
    list.push(peer);
  }
  list.sort();
  const q = list.length ? `?peers=${encodeURIComponent(list.join(","))}` : "";
  return `/api/credit-fundamentals/${encodeURIComponent(self)}${q}`;
}

/**
 * F1-20: Debt/Equity und Zinsdeckung. Eine Query über den Standard-Fetcher (queryClient).
 * Nicht score-wirksam. Fehlende Lieferung kommt als n/a mit Grund, nicht als 0.
 */
export function useCreditFundamentals(ticker: string, peers: readonly string[], enabled = true) {
  const path = creditFundamentalsQueryKey(ticker, peers);
  return useQuery<CreditFundamentalsResponse | null>({
    queryKey: [path],
    queryFn: getQueryFn<CreditFundamentalsResponse | null>({ on401: "throw" }),
    enabled: enabled && ticker.trim().length > 0,
    staleTime: 12 * 60 * 60 * 1000,
  });
}
