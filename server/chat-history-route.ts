/**
 * Chat-Verlauf im Prozess-Speicher, Schlüssel ist die Session aus dem Header.
 * Kein Supabase, keine Env, kein Score. Der Client spiegelt denselben Stand in sessionStorage.
 */
import type { Express, Request, Response } from "express";
import {
  CHAT_SESSION_HEADER, chatThreadTitle, clipChatMessages, isChatDashboard, isChatSessionId,
  type ChatThread,
} from "../shared/chat-history";
import type { ChatMessage } from "../shared/chat-context";

const sessions = new Map<string, Map<string, ChatThread>>();

export function resetChatHistoryStore(): void {
  sessions.clear();
}

function bag(sessionId: string): Map<string, ChatThread> {
  let found = sessions.get(sessionId);
  if (!found) { found = new Map(); sessions.set(sessionId, found); }
  return found;
}

export function listChatThreads(sessionId: string, dashboard?: string, entity?: string): ChatThread[] {
  const all: ChatThread[] = [];
  sessions.get(sessionId)?.forEach(thread => all.push(thread));
  return all
    .filter(t => (dashboard == null || t.dashboard === dashboard) && (entity == null || entity === "" || t.entity === entity))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function putChatThread(sessionId: string, thread: ChatThread): ChatThread {
  const stored: ChatThread = { ...thread, updatedAt: new Date().toISOString() };
  bag(sessionId).set(stored.id, stored);
  return stored;
}

export function deleteChatThread(sessionId: string, id: string): boolean {
  return sessions.get(sessionId)?.delete(id) ?? false;
}

function sessionOf(req: Request): string | null {
  const raw = req.header(CHAT_SESSION_HEADER) ?? "";
  return isChatSessionId(raw) ? raw : null;
}

function readThread(body: unknown, id: string): { ok: true; thread: Omit<ChatThread, "updatedAt"> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "n/a — Verlauf ohne Körper" };
  const b = body as { dashboard?: unknown; entity?: unknown; messages?: unknown };
  if (typeof b.dashboard !== "string" || !isChatDashboard(b.dashboard)) return { ok: false, error: "n/a — Dashboard fehlt" };
  if (!isChatSessionId(id)) return { ok: false, error: "n/a — Chat-Id ungültig" };
  const entity = b.entity == null || b.entity === "" ? null : (typeof b.entity === "string" ? b.entity.slice(0, 40) : null);
  if (b.entity != null && b.entity !== "" && typeof b.entity !== "string") return { ok: false, error: "n/a — Asset fehlt" };
  if (!Array.isArray(b.messages)) return { ok: false, error: "n/a — Nachrichten fehlen" };
  const messages = clipChatMessages(b.messages as ChatMessage[]);
  if (!messages.length) return { ok: false, error: "n/a — Verlauf ohne Nachricht" };
  return {
    ok: true,
    thread: { id, dashboard: b.dashboard, entity, title: chatThreadTitle(messages), messages },
  };
}

export function registerChatHistoryRoute(app: Express): void {
  app.get("/api/chat/history", (req: Request, res: Response) => {
    const sessionId = sessionOf(req);
    if (!sessionId) { res.status(400).json({ error: "n/a — keine Chat-Session" }); return; }
    const dashboard = typeof req.query.dashboard === "string" ? req.query.dashboard : undefined;
    const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
    if (dashboard != null && !isChatDashboard(dashboard)) { res.status(400).json({ error: "n/a — Dashboard fehlt" }); return; }
    res.json({ threads: listChatThreads(sessionId, dashboard, entity) });
  });

  app.put("/api/chat/history/:id", (req: Request, res: Response) => {
    const sessionId = sessionOf(req);
    if (!sessionId) { res.status(400).json({ error: "n/a — keine Chat-Session" }); return; }
    const parsed = readThread(req.body, String(req.params.id ?? ""));
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    const thread = putChatThread(sessionId, { ...parsed.thread, updatedAt: "" });
    res.json({ thread });
  });

  app.delete("/api/chat/history/:id", (req: Request, res: Response) => {
    const sessionId = sessionOf(req);
    if (!sessionId) { res.status(400).json({ error: "n/a — keine Chat-Session" }); return; }
    const id = String(req.params.id ?? "");
    if (!isChatSessionId(id)) { res.status(400).json({ error: "n/a — Chat-Id ungültig" }); return; }
    deleteChatThread(sessionId, id);
    res.json({ ok: true, threads: listChatThreads(sessionId) });
  });
}
