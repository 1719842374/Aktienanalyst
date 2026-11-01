/**
 * Chat-Verlauf pro Browser-Session.
 * Kette: sessionStorage (lokal) und apiRequest → GET/PUT/DELETE /api/chat/history
 * → server/routes.ts → chat-history-route. Kein Supabase.
 */
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  CHAT_SESSION_HEADER, isChatSessionId, mergeChatThreads, newChatId,
  type ChatThread,
} from "@shared/chat-history";

const SESSION_KEY = "chatSession:v1";
let memorySession = "";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage || typeof window.sessionStorage.getItem !== "function") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function threadsKey(sessionId: string): string {
  return `chatThreads:v1:${sessionId}`;
}

function readThreads(sessionId: string): ChatThread[] {
  const raw = storage()?.getItem(threadsKey(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeThreads(sessionId: string, threads: ChatThread[]): void {
  try { storage()?.setItem(threadsKey(sessionId), JSON.stringify(threads)); } catch { /* voll oder privat */ }
}

export function chatSessionId(): string {
  const store = storage();
  const existing = store?.getItem(SESSION_KEY) ?? "";
  if (isChatSessionId(existing)) return existing;
  if (!store && isChatSessionId(memorySession)) return memorySession;
  const id = newChatId();
  memorySession = id;
  try { store?.setItem(SESSION_KEY, id); } catch { /* Anzeige bleibt, Server-Cache fehlt dann */ }
  return id;
}

export function useChatHistory(dashboard: string, entity: string | null) {
  const sessionId = chatSessionId();
  const [threads, setThreads] = useState<ChatThread[]>(() => readThreads(sessionId));

  const remember = useCallback((next: ChatThread[]) => {
    const merged = mergeChatThreads(readThreads(sessionId), next);
    writeThreads(sessionId, merged);
    setThreads(merged);
  }, [sessionId]);

  useEffect(() => {
    const params = new URLSearchParams({ dashboard });
    if (entity) params.set("entity", entity);
    let cancel = false;
    apiRequest("GET", `/api/chat/history?${params.toString()}`, undefined, 15000, { [CHAT_SESSION_HEADER]: sessionId })
      .then(async (res) => {
        if (!res.ok || cancel) return;
        const body = await res.json().catch(() => null) as { threads?: ChatThread[] } | null;
        if (!cancel && Array.isArray(body?.threads)) remember(body.threads);
      })
      .catch(() => { /* lokaler Cache bleibt */ });
    return () => { cancel = true; };
  }, [dashboard, entity, sessionId, remember]);

  const save = useCallback(async (thread: ChatThread) => {
    remember([thread]);
    try {
      const res = await apiRequest("PUT", `/api/chat/history/${encodeURIComponent(thread.id)}`, {
        dashboard: thread.dashboard,
        entity: thread.entity,
        messages: thread.messages,
      }, 15000, { [CHAT_SESSION_HEADER]: sessionId });
      if (!res.ok) return;
      const body = await res.json().catch(() => null) as { thread?: ChatThread } | null;
      if (body?.thread) remember([body.thread]);
    } catch { /* lokaler Cache bleibt */ }
  }, [remember, sessionId]);

  const remove = useCallback(async (id: string) => {
    const next = readThreads(sessionId).filter(t => t.id !== id);
    writeThreads(sessionId, next);
    setThreads(next);
    try {
      await apiRequest("DELETE", `/api/chat/history/${encodeURIComponent(id)}`, undefined, 15000, { [CHAT_SESSION_HEADER]: sessionId });
    } catch { /* lokal ist gelöscht */ }
  }, [sessionId]);

  const visible = threads.filter(t => t.dashboard === dashboard && (entity == null || t.entity === entity));
  return { sessionId, threads: visible, save, remove };
}
