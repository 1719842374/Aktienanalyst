/**
 * GuV-Posten für den KI-Chat.
 * Kette: dieses Hook → apiRequest GET /api/chat/income-statement/:symbol
 * → server/routes.ts → chat-income-route → SEC EDGAR (companyfacts/XBRL), FMP als zweite Quelle.
 * Die Antwort geht in S4 des Chat-Kontexts (withIncomeStatementFacts).
 */
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { incomeBriefNa, type IncomeStatementBrief } from "@shared/chat-income";

/** SEC-companyfacts und das Filing-Dokument sind groß; gleiche Decke wie der Earnings-Brief. */
const INCOME_BRIEF_TIMEOUT_MS = 45_000;

export function useIncomeStatementBrief(symbol: string | null): IncomeStatementBrief | null {
  const [brief, setBrief] = useState<IncomeStatementBrief | null>(null);

  useEffect(() => {
    if (!symbol) {
      setBrief(null);
      return;
    }
    let cancel = false;
    setBrief(null);
    apiRequest("GET", `/api/chat/income-statement/${encodeURIComponent(symbol)}`, undefined, INCOME_BRIEF_TIMEOUT_MS)
      .then(async (res) => {
        const body = await res.json().catch(() => null) as IncomeStatementBrief | { reason?: string; error?: string } | null;
        if (cancel) return;
        if (!res.ok || !body || (body as IncomeStatementBrief).status == null) {
          const reason = (body && "reason" in body && body.reason) || (body && "error" in body && body.error) || `n/a — GuV-Posten HTTP ${res.status}`;
          setBrief(incomeBriefNa(symbol, String(reason)));
          return;
        }
        setBrief(body as IncomeStatementBrief);
      })
      .catch((err: unknown) => {
        if (cancel) return;
        const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
        setBrief(incomeBriefNa(symbol, `n/a — ${message}`));
      });
    return () => { cancel = true; };
  }, [symbol]);

  return brief;
}
