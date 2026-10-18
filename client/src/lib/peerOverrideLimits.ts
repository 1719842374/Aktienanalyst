/**
 * #258 Tester-FAIL 5: harte Client-Grenzen für Peer-Overrides.
 *
 * Der Server (shared/schema.ts analyzeRequestSchema) lehnt `peerOverrides.add`/`remove`
 * mit mehr als 8 Einträgen oder Tickern länger als 20 Zeichen mit 400 ab:
 *   {"error":"Invalid request","details":{"fieldErrors":{"peerOverrides":["Array must contain at most 8 element(s)"]}}}
 * (server/analyze-route.ts:508). Der Client hält die Listen deshalb selbst auf 8,
 * unabhängig davon, welche Ticker der Server übernimmt, säubert localStorage beim
 * Laden und verwirft die Overrides nach einem 400, statt den Ticker dauerhaft zu sperren.
 */
import {
  hasPeerOverrideLists,
  normalizeStoredOverrides,
  writeOverrides,
  type KeyValueStore,
  type PeerOverrideLists,
} from "@shared/peer-override-persist";

/** = `.max(8)` in analyzeRequestSchema.peerOverrides.add/remove */
export const MAX_PEER_OVERRIDE_ENTRIES = 8;
/** = `.max(20)` je Ticker in analyzeRequestSchema.peerOverrides */
export const MAX_PEER_TICKER_LENGTH = 20;

/** Normalisiert (trim, upper, dedupe, sort wie der Server) und kürzt beide Listen auf 8 gültige Ticker. */
export function clampPeerOverrides(overrides: { add?: string[] | null; remove?: string[] | null } | null | undefined): PeerOverrideLists {
  const n = normalizeStoredOverrides(overrides);
  const valid = (t: string) => t.length > 0 && t.length <= MAX_PEER_TICKER_LENGTH;
  return {
    add: n.add.filter(valid).slice(0, MAX_PEER_OVERRIDE_ENTRIES),
    remove: n.remove.filter(valid).slice(0, MAX_PEER_OVERRIDE_ENTRIES),
  };
}

export function sameOverrides(a: PeerOverrideLists, b: PeerOverrideLists): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Add-Liste voll: zählt jede Hinzufügung, auch nicht übernommene (ungültig, außerhalb des Bands). */
export function addListFull(activeAdd: readonly string[]): boolean {
  return activeAdd.length >= MAX_PEER_OVERRIDE_ENTRIES;
}

/** Remove-Liste voll: ein weiterer, noch nicht entfernter Ticker würde den Server-Deckel sprengen. */
export function removeListFull(activeRemove: readonly string[], ticker: string): boolean {
  return activeRemove.length >= MAX_PEER_OVERRIDE_ENTRIES && !activeRemove.includes(ticker);
}

/** 400 auf eine Analyse mit Overrides: die Overrides sind (mit) Ursache, also verwerfen statt 5× wiederholen. */
export function isPeerOverrideRejection(status: number, sent: PeerOverrideLists | null | undefined): boolean {
  return status === 400 && hasPeerOverrideLists(sent ?? null);
}

export const PEER_OVERRIDES_REJECTED = "PEER_OVERRIDES_REJECTED";

/** Nach einem 400: gespeicherte Overrides des Tickers löschen. Rückgabe = die Overrides für den Neu-Lauf (leer). */
export function discardRejectedOverrides(storage: KeyValueStore | null, ticker: string): PeerOverrideLists {
  const empty: PeerOverrideLists = { add: [], remove: [] };
  if (storage) writeOverrides(storage, ticker, empty);
  return empty;
}
