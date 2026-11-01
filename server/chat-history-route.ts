/**
 * Chat-Verlauf im Prozess-Speicher, Schlüssel ist die Session aus dem Header.
 * Kein Supabase, keine Env, kein Score. Der Client spiegelt denselben Stand in sessionStorage.
 */
import type { Express, Request, Response } from "express";
import {
  CHAT_HISTORY_MEMORY_BUDGET_CHARS, CHAT_HISTORY_SESSION_CHAR_BUDGET, CHAT_HISTORY_THREADS_PER_SESSION,
  CHAT_HISTORY_TTL_MS, CHAT_SESSION_HEADER,
  chatThreadTitle, clipChatMessages, isChatDashboard, isChatSessionId,
  type ChatThread,
} from "../shared/chat-history";
import type { ChatMessage } from "../shared/chat-context";

/**
 * Sessions, die bei voller Zeichen-Cap in `CHAT_HISTORY_MEMORY_BUDGET_CHARS` passen:
 * floor(Speicherbudget / 36 000). Das Rate-Limit zählt Anfragen pro IP und Minute,
 * nicht Sessions, und setzt diesen Cap nicht. Verdrängt wird nur die am längsten
 * inaktive Session, und erst wenn der Cap überschritten ist.
 */
export const CHAT_HISTORY_SESSION_CAP = Math.max(
  1,
  Math.floor(CHAT_HISTORY_MEMORY_BUDGET_CHARS / CHAT_HISTORY_SESSION_CHAR_BUDGET),
);

export { CHAT_HISTORY_TTL_MS };

interface Slot {
  thread: ChatThread;
  touchedAt: number;
}

interface SessionBag {
  touchedAt: number;
  threads: Map<string, Slot>;
}

const sessions = new Map<string, SessionBag>();

export function resetChatHistoryStore(): void {
  sessions.clear();
}

function promoteSession(sessionId: string, now: number): SessionBag {
  const existing = sessions.get(sessionId);
  if (existing) sessions.delete(sessionId);
  const bag: SessionBag = existing ?? { touchedAt: now, threads: new Map() };
  bag.touchedAt = now;
  sessions.set(sessionId, bag);
  return bag;
}

function threadChars(bag: SessionBag): number {
  let n = 0;
  bag.threads.forEach(slot => { slot.thread.messages.forEach(m => { n += m.content.length; }); });
  return n;
}

function dropOldestThread(bag: SessionBag, keepId: string): boolean {
  let drop: string | undefined;
  bag.threads.forEach((_, id) => { if (drop === undefined && id !== keepId) drop = id; });
  if (drop === undefined) return false;
  bag.threads.delete(drop);
  return true;
}

/** Stückzahl und Zeichenbudget. Der gerade geschriebene Thread bleibt. Ältester Zugriff zuerst. */
function evictThreads(bag: SessionBag, keepId: string): void {
  const over = () => bag.threads.size > CHAT_HISTORY_THREADS_PER_SESSION || threadChars(bag) > CHAT_HISTORY_SESSION_CHAR_BUDGET;
  while (over()) {
    if (!dropOldestThread(bag, keepId)) break;
  }
}

function evictSessions(): void {
  while (sessions.size > CHAT_HISTORY_SESSION_CAP) {
    let oldest: string | undefined;
    sessions.forEach((_, id) => { if (oldest === undefined) oldest = id; });
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function dropExpired(now: number): void {
  const deadSessions: string[] = [];
  sessions.forEach((bag, id) => {
    if (now - bag.touchedAt >= CHAT_HISTORY_TTL_MS) { deadSessions.push(id); return; }
    const deadThreads: string[] = [];
    bag.threads.forEach((slot, threadId) => {
      if (now - slot.touchedAt >= CHAT_HISTORY_TTL_MS) deadThreads.push(threadId);
    });
    deadThreads.forEach(threadId => bag.threads.delete(threadId));
    if (bag.threads.size === 0) deadSessions.push(id);
  });
  deadSessions.forEach(id => sessions.delete(id));
}

function sweep(now: number): void {
  dropExpired(now);
  evictSessions();
}

export function listChatThreads(sessionId: string, dashboard?: string, entity?: string, now = Date.now()): ChatThread[] {
  sweep(now);
  const bag = sessions.get(sessionId);
  if (!bag) return [];
  promoteSession(sessionId, now);
  const matched: ChatThread[] = [];
  const refresh: string[] = [];
  bag.threads.forEach(slot => {
    const t = slot.thread;
    const sameDash = dashboard == null || t.dashboard === dashboard;
    const sameEntity = entity == null || entity === "" || t.entity === entity;
    if (sameDash && sameEntity) { matched.push(t); refresh.push(t.id); }
  });
  // Gelesene Threads nach hinten, Reihenfolge untereinander bleibt. Das setzt ihre TTL neu.
  refresh.forEach(id => {
    const slot = bag.threads.get(id);
    if (!slot) return;
    bag.threads.delete(id);
    slot.touchedAt = now;
    bag.threads.set(id, slot);
  });
  return matched.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function putChatThread(sessionId: string, thread: ChatThread, now = Date.now()): ChatThread {
  sweep(now);
  const bag = promoteSession(sessionId, now);
  const stored: ChatThread = { ...thread, updatedAt: new Date(now).toISOString() };
  bag.threads.delete(stored.id);
  bag.threads.set(stored.id, { thread: stored, touchedAt: now });
  evictThreads(bag, stored.id);
  evictSessions();
  return stored;
}

export function deleteChatThread(sessionId: string, id: string, now = Date.now()): boolean {
  sweep(now);
  const bag = sessions.get(sessionId);
  if (!bag) return false;
  const removed = bag.threads.delete(id);
  if (bag.threads.size === 0) sessions.delete(sessionId);
  else promoteSession(sessionId, now);
  return removed;
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
