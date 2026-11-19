/**
 * FW-38: Peer-Autocomplete — reine Hilfsfunktionen fuer die Vorschlagsliste
 * am Peer-Eingabefeld (PeerComparison.tsx). Nutzt dieselbe Antwort wie
 * TickerSearch.tsx (GET /api/search-ticker → { results: [...] }).
 *
 * Reine Anzeige-/Eingabehilfe: beeinflusst weder Peer-Scoring noch Fair
 * Values. Ein Vorschlag fuellt nur das Eingabefeld; das Hinzufuegen laeuft
 * unveraendert ueber handleAddTicker (onOverridesChange).
 *
 * ETF: Die Suchantwort enthaelt kein isEtf/type-Feld, und im Peer-Pfad gibt
 * es keinen bestehenden ETF-Block (isEtfOrFund wirkt nur auf Reverse DCF).
 * Deshalb wird hier NICHT gesperrt, sondern nur ein Namens-Hinweis
 * ("ETF/Fonds laut Name") gesetzt und ans Ende sortiert.
 */

export interface PeerSuggestion {
  ticker: string;
  name: string;
  exchange: string;
  unavailable: boolean;
  /** Nur Namens-Hinweis (enthaelt "ETF"/"Fund"), keine verifizierte Klassifikation. */
  etfByName: boolean;
}

/** Robust gegen Fehler/Fremdformate: alles ausser { results: [...] } → []. */
export function parsePeerSearchResponse(data: unknown): PeerSuggestion[] {
  const rows = (data as any)?.results;
  if (!Array.isArray(rows)) return [];
  const out: PeerSuggestion[] = [];
  for (const r of rows) {
    const ticker = typeof r?.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
    if (!ticker) continue;
    const name = typeof r?.name === "string" && r.name.trim() ? r.name.trim() : ticker;
    out.push({
      ticker,
      name,
      exchange: typeof r?.exchange === "string" ? r.exchange : "",
      unavailable: r?.unavailable === true,
      etfByName: /\b(ETF|ETN|Fund)\b/i.test(name),
    });
  }
  return out;
}

/**
 * Entfernt Subject und bereits vorhandene Peers (gleiche Regeln wie
 * handleAddTicker: Grossschreibung, kein Subject, keine Duplikate),
 * sortiert: verfuegbar vor "keine Daten", Aktien vor ETF-Namenshinweis,
 * sonst Server-Reihenfolge. Begrenzt auf `limit`.
 */
export function rankPeerSuggestions(
  list: PeerSuggestion[],
  opts: { subject: string; existing: string[]; limit?: number },
): PeerSuggestion[] {
  const subject = (opts.subject || "").toUpperCase();
  const existing = new Set(opts.existing.map(t => t.toUpperCase()));
  const seen = new Set<string>();
  const kept = list
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => {
      if (s.ticker === subject || existing.has(s.ticker) || seen.has(s.ticker)) return false;
      seen.add(s.ticker);
      return true;
    });
  kept.sort((a, b) =>
    Number(a.s.unavailable) - Number(b.s.unavailable) ||
    Number(a.s.etfByName) - Number(b.s.etfByName) ||
    a.i - b.i);
  return kept.slice(0, opts.limit ?? 8).map(k => k.s);
}
