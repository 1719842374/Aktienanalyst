/**
 * Letzter Earnings Call für den KI-Chat.
 * Kette: dieses Hook → apiRequest GET /api/chat/earnings-brief/:symbol
 * → server/routes.ts → chat-earnings-route → FMP.
 * Dieselbe Antwort geht in den Chat-Kontext (withEarningsBriefFacts), nicht nur in die Anzeige.
 */
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { earningsBriefNa, type EarningsCallBrief } from "@shared/chat-earnings";

export function useEarningsBrief(symbol: string | null): EarningsCallBrief | null {
  const [brief, setBrief] = useState<EarningsCallBrief | null>(null);

  useEffect(() => {
    if (!symbol) {
      setBrief(null);
      return;
    }
    let cancel = false;
    setBrief(null);
    apiRequest("GET", `/api/chat/earnings-brief/${encodeURIComponent(symbol)}`, undefined, 45000)
      .then(async (res) => {
        const body = await res.json().catch(() => null) as EarningsCallBrief | { reason?: string; error?: string } | null;
        if (cancel) return;
        if (!res.ok || !body || (body as EarningsCallBrief).status == null) {
          const reason = (body && "reason" in body && body.reason) || (body && "error" in body && body.error) || `n/a — Earnings-Call HTTP ${res.status}`;
          setBrief(earningsBriefNa(symbol, String(reason)));
          return;
        }
        setBrief(body as EarningsCallBrief);
      })
      .catch((err: unknown) => {
        if (cancel) return;
        const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
        setBrief(earningsBriefNa(symbol, `n/a — ${message}`));
      });
    return () => { cancel = true; };
  }, [symbol]);

  return brief;
}
