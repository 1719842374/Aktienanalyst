/**
 * PR 3 (Chatbot-Kontext vollständig): kleiner Client-"Datenbus" für den Chat-Kontext.
 *
 * Sektionen, deren Werte erst im Client entstehen (DCF/CRV/RSL/Monte Carlo) oder die ihre Daten
 * selbst nachladen (BTC S3/S13, Rezession RSI/Märkte/Buffett), veröffentlichen hier GENAU die
 * Variablen, die sie anzeigen. Die Seite liest sie und reicht sie an `enrichChatContext`.
 *
 * - Keine neue Berechnung, keine neue Abfrage: veröffentlicht wird nur, was schon gerendert wird.
 * - Veröffentlichung läuft im Render (idempotent, nur Map-Schreibzugriff); Listener werden per
 *   Microtask benachrichtigt, damit kein setState während eines fremden Renders passiert.
 * - Rein lesend für den Chat, kein Einfluss auf Scores.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ChatFactValue } from "@shared/chat-context";

export type ChatDashboardId = "stock" | "btc" | "gold" | "recession";
export type ChatLiveFacts = Record<string, ChatFactValue>;
export type ChatLiveSnapshot = Readonly<Record<string, ChatLiveFacts>>;

const EMPTY: ChatLiveSnapshot = Object.freeze({});
const store = new Map<ChatDashboardId, { snap: ChatLiveSnapshot; sig: Record<string, string> }>();
const listeners = new Map<ChatDashboardId, Set<() => void>>();
const pending = new Set<ChatDashboardId>();

function notify(dashboard: ChatDashboardId) {
  if (pending.has(dashboard)) return;
  pending.add(dashboard);
  queueMicrotask(() => {
    pending.delete(dashboard);
    listeners.get(dashboard)?.forEach(l => l());
  });
}

/** Veröffentlicht (oder entfernt bei `null`) die angezeigten Werte einer Sektion. */
export function publishChatSectionData(dashboard: ChatDashboardId, key: string, facts: ChatLiveFacts | null): void {
  const cur = store.get(dashboard) ?? { snap: EMPTY, sig: {} };
  const sig = facts ? JSON.stringify(facts) : "";
  if ((cur.sig[key] ?? "") === sig) return;
  const snap: Record<string, ChatLiveFacts> = { ...cur.snap };
  const sigs = { ...cur.sig };
  if (facts) { snap[key] = facts; sigs[key] = sig; } else { delete snap[key]; delete sigs[key]; }
  store.set(dashboard, { snap: Object.freeze(snap), sig: sigs });
  notify(dashboard);
}

export function readChatSectionData(dashboard: ChatDashboardId): ChatLiveSnapshot {
  return store.get(dashboard)?.snap ?? EMPTY;
}

/** Nur für Tests. */
export function resetChatSectionData(): void {
  store.clear();
}

/** Hook für Sektionen: veröffentlicht die übergebenen (bereits angezeigten) Werte. */
export function usePublishChatSection(dashboard: ChatDashboardId, key: string, facts: ChatLiveFacts | null): void {
  const sig = facts ? JSON.stringify(facts) : "";
  // Im Render statt in useEffect, damit SSR-Fixture-Tests denselben Wert sehen wie die Anzeige.
  useMemo(() => publishChatSectionData(dashboard, key, facts), [dashboard, key, sig]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Hook für Seiten: liest alle veröffentlichten Sektionswerte eines Dashboards. */
export function useChatSectionData(dashboard: ChatDashboardId): ChatLiveSnapshot {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(dashboard);
      if (!set) { set = new Set(); listeners.set(dashboard, set); }
      set.add(cb);
      return () => { set!.delete(cb); };
    },
    () => readChatSectionData(dashboard),
    () => readChatSectionData(dashboard),
  );
}
