/**
 * Peer-Variante A (WORK_PEER_SELECTION_DETAILED §6 / WORK_PEER_SELECTION §3.4 „Same PE: Forward PE ±30 %“).
 * Nur Anzeige/Filter, nicht score-wirksam.
 *
 * Forward-KGV eines Peers = aktueller Kurs / EPS-Konsens des nächsten Geschäftsjahres
 * (FMP /stable/analyst-estimates; dieselbe Zeilenwahl wie analyze-route: nächstes künftiges GJ,
 * sonst letztes vergangenes mit positivem EPS).
 * Währung: Schätzungen kommen in Berichtswährung, der Kurs in Handelswährung. Ohne verlässliche
 * Handelswährung rechnen wir nur, wenn beides sicher USD ist (Berichtswährung USD und Ticker ohne
 * Börsen-Suffix). Sonst null → die UI fällt auf das Trailing-KGV zurück (kein geschätzter FX-Wert).
 */
export function pickNextFyEps(rows: readonly any[] | null | undefined, todayIso: string): number | null {
  const eps = (r: any): number => Number(r?.epsAvg ?? r?.estimatedEpsAvg ?? r?.estimatedEps ?? 0) || 0;
  const list = Array.isArray(rows) ? rows : [];
  const future = list.filter(r => String(r?.date ?? "") > todayIso && eps(r) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const past = list.filter(r => String(r?.date ?? "") <= todayIso && eps(r) > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const row = future[0] ?? past[0];
  return row ? eps(row) : null;
}

export function peerForwardPe(args: {
  ticker: string; price: number | null | undefined; reportedCurrency: string | null | undefined;
  estimates: readonly any[] | null | undefined; todayIso: string;
}): number | null {
  const price = Number(args.price);
  if (!(price > 0)) return null;
  if (/[.:]/.test(args.ticker)) return null; // Nicht-US-Listing: Handelswährung unbekannt
  if (args.reportedCurrency && args.reportedCurrency.toUpperCase() !== "USD") return null; // z.B. NVO (DKK)
  const eps = pickNextFyEps(args.estimates, args.todayIso);
  if (eps == null || !(eps > 0)) return null;
  const v = price / eps;
  return Number.isFinite(v) && v > 0 && v < 500 ? +v.toFixed(1) : null;
}
