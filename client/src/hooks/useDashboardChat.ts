/**
 * KI-Chatbot (WORK_DASHBOARD_FEATURES_2026-10.md §4/§4c): Client-Hook.
 * DATENFLUSS: Dashboard-Provider (z.B. buildStockChatContext) → useDashboardChat → apiRequest
 * POST /api/chat → server/chat-route.ts handleChat → callLLMJson (OpenRouter).
 * Der Verlauf dieses Fensters liegt im State. useChatHistory schreibt ihn zusätzlich
 * in den Session-Cache (sessionStorage und /api/chat/history). Keine Secrets im Client.
 */
import { useCallback, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { CHAT_LIMITS, CHAT_REQUEST_TIMEOUT_MS, type ChatContext, type ChatContextTrimEntry, type ChatMessage, type ChatResponseBody } from "@shared/chat-context";

export interface ChatEntry extends ChatMessage {
  sectionRefs?: number[];
  status?: ChatResponseBody["status"];
  error?: boolean;
  /** Modell, das geantwortet hat, und warum nicht das erste der Kette (nur bei Fallback). */
  model?: string | null;
  fallbackReason?: string;
  truncated?: boolean;
}

export function useDashboardChat(context: ChatContext | null, sectionId: number | null) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [contextTrimmed, setContextTrimmed] = useState<ChatContextTrimEntry[] | undefined>();
  const reqRef = useRef(0);

  const send = useCallback(async (text: string) => {
    const content = text.trim().slice(0, CHAT_LIMITS.maxMessageChars);
    if (!content || !context || pending) return;
    const history: ChatMessage[] = [...entries.filter(e => !e.error).map(e => ({ role: e.role, content: e.content.slice(0, CHAT_LIMITS.maxMessageChars) })), { role: "user" as const, content }]
      .slice(-CHAT_LIMITS.maxMessages);
    setEntries(prev => [...prev, { role: "user", content }]);
    setPending(true);
    const reqId = ++reqRef.current;
    try {
      const res = await apiRequest("POST", "/api/chat", { dashboard: context.dashboard, sectionId, context, messages: history }, CHAT_REQUEST_TIMEOUT_MS);
      const body = (await res.json().catch(() => null)) as ChatResponseBody | null;
      if (reqId !== reqRef.current) return;
      setContextTrimmed(body?.contextTrimmed?.length ? body.contextTrimmed : undefined);
      if (body?.ok && body.answer) {
        setEntries(prev => [...prev, {
          role: "assistant", content: body.answer!, sectionRefs: body.sectionRefs, status: "ok", model: body.model,
          ...(body.fallbackReason ? { fallbackReason: body.fallbackReason } : {}), ...(body.truncated ? { truncated: true } : {}),
        }]);
      } else {
        const msg = body?.error ?? `Chat fehlgeschlagen (HTTP ${res.status})`;
        setEntries(prev => [...prev, { role: "assistant", content: msg, status: body?.status, error: true }]);
      }
    } catch (err: any) {
      if (reqId !== reqRef.current) return;
      setEntries(prev => [...prev, { role: "assistant", content: String(err?.message ?? err).slice(0, 200), error: true }]);
    } finally {
      if (reqId === reqRef.current) setPending(false);
    }
  }, [context, sectionId, entries, pending]);

  const reset = useCallback(() => { reqRef.current++; setEntries([]); setPending(false); setContextTrimmed(undefined); }, []);
  const load = useCallback((next: ChatEntry[]) => {
    reqRef.current++;
    setEntries(next);
    setPending(false);
    setContextTrimmed(undefined);
  }, []);
  return { entries, pending, send, reset, load, contextTrimmed };
}
