// Auftrag 10.08.2026 ("Peer-Add/Remove zuverlaessig"): pure, unit-testbare
// Normalisierung fuer Peer-Overrides und den davon abhaengigen Analyse-
// Cache-Key. Extrahiert aus server/analyze-route.ts (fragile Datei, siehe
// stock-analyst-regression-guard -- neue Logik lebt hier additiv, damit sie
// isoliert getestet werden kann, ohne die Route-Datei umzubauen).
//
// Root-Cause des urspruenglichen Bugs: Peer-Override-Listen wurden zwar
// uppercased/getrimmt, aber NICHT sortiert/dedupliziert vor dem Cache-Key-
// Join. Zwei Requests mit semantisch identischem Override-Set aber
// unterschiedlicher Array-Reihenfolge (z.B. [LLY,ABT] vs. [ABT,LLY])
// erzeugten unterschiedliche Cache-Keys -- das konnte zu "Geister-Peers"
// aus einem alten, nicht mehr passenden Cache-Eintrag fuehren.

/** Trim, uppercase, dedupliziere und sortiere eine Peer-Ticker-Liste. */
export function normalizePeerList(list: string[] | undefined | null): string[] {
  return Array.from(new Set((list ?? []).map(t => String(t).trim().toUpperCase()).filter(Boolean))).sort();
}

export interface PeerOverridesNormalized {
  add: string[];
  remove: string[];
  hasOverrides: boolean;
}

export function normalizePeerOverrides(overrides: { add?: string[] | null; remove?: string[] | null } | undefined | null): PeerOverridesNormalized {
  const add = normalizePeerList(overrides?.add);
  const remove = normalizePeerList(overrides?.remove);
  return { add, remove, hasOverrides: add.length > 0 || remove.length > 0 };
}

/**
 * Deterministischer Analyse-Cache-Key. Muss stabil sein unabhaengig von der
 * Eingabereihenfolge der Overrides -- deshalb werden add/remove HIER (nicht
 * am Call-Standort) normalisiert erwartet (siehe normalizePeerOverrides).
 */
export function buildAnalyzeCacheKey(ticker: string, useLLM: boolean, peerAddList: string[], peerRemoveList: string[]): string {
  const upperTicker = ticker.trim().toUpperCase();
  const hasOverrides = peerAddList.length > 0 || peerRemoveList.length > 0;
  return `analyze:${upperTicker}:llm:${useLLM ? 1 : 0}${hasOverrides ? `:peers:+${peerAddList.join(",")}:-${peerRemoveList.join(",")}` : ""}`;
}

/** Wendet add/remove-Overrides auf eine bereits gefilterte Auto-Peer-Liste an. Max. 8 Peers gesamt (Ticket-Vorgabe). */
export function applyPeerOverrides(autoSelectedPeers: string[], subjectTicker: string, peerAddList: string[], peerRemoveList: string[], maxPeers = 8): string[] {
  const upperSubject = subjectTicker.trim().toUpperCase();
  let result = autoSelectedPeers.filter(t => !peerRemoveList.includes(t));
  for (const addTicker of peerAddList) {
    if (addTicker !== upperSubject && !result.includes(addTicker) && result.length < maxPeers) {
      result.push(addTicker);
    }
  }
  return result;
}
