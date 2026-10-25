/**
 * KI-Chatbot (WORK_DASHBOARD_FEATURES_2026-10.md §4/§4c): Client-Hook.
 * DATENFLUSS: Dashboard-Provider (z.B. buildStockChatContext) → useDashboardChat → apiRequest
 * POST /api/chat → server/chat-route.ts handleChat → callLLMJson (OpenRouter).
 * Der Verlauf lebt nur im Speicher dieses Widgets; keine Secrets im Client.
 */
import { useCallback, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { CHAT_LIMITS, type ChatContext, type ChatMessage, type ChatResponseBody } from "@shared/chat-context";

export interface ChatEntry extends ChatMessage {
  sectionRefs?: number[];
  status?: ChatResponseBody["status"];
  error?: boolean;
}

export function useDashboardChat(context: ChatContext | null, sectionId: number | null) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [pending, setPending] = useState(false);
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
      const res = await apiRequest("POST", "/api/chat", { dashboard: context.dashboard, sectionId, context, messages: history }, 45000);
      const body = (await res.json().catch(() => null)) as ChatResponseBody | null;
      if (reqId !== reqRef.current) return;
      if (body?.ok && body.answer) {
        setEntries(prev => [...prev, { role: "assistant", content: body.answer!, sectionRefs: body.sectionRefs, status: "ok" }]);
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

  const reset = useCallback(() => { reqRef.current++; setEntries([]); setPending(false); }, []);
  return { entries, pending, send, reset };
}
