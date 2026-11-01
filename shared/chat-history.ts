/**
 * Chat-Verlauf (WORK_CHAT_PODCAST_MCP §1), vorerst nur Session-Cache.
 * Kein Supabase, kein Score. Reine Typen und Zusammenführung.
 * Der Server hält denselben Verlauf im Speicher, der Client zusätzlich in sessionStorage.
 */
import { CHAT_DASHBOARDS, CHAT_LIMITS, type ChatDashboard, type ChatMessage } from "./chat-context";

export const CHAT_SESSION_HEADER = "x-chat-session";

/** Sichtbare Länge einer Verlaufs-Zeile. Anzeige, kein Schwellenwert. */
export const CHAT_THREAD_TITLE_CHARS = 80;

const SESSION_ID = /^[A-Za-z0-9_-]{8,80}$/;

export interface ChatThread {
  id: string;
  dashboard: ChatDashboard;
  entity: string | null;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export function isChatSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

export function newChatId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function chatThreadTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === "user" && m.content.trim());
  if (!first) return "n/a — kein Nutzertext";
  const text = first.content.trim().replace(/\s+/g, " ");
  if (text.length <= CHAT_THREAD_TITLE_CHARS) return text;
  return `${text.slice(0, CHAT_THREAD_TITLE_CHARS - 1)}…`;
}

/** Hält Nachrichten in den bestehenden Chat-Grenzen. Leere Nachrichten fallen weg, nichts wird erfunden. */
export function clipChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const kept = messages.filter(m =>
    (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0,
  );
  return kept.slice(-CHAT_LIMITS.maxMessages).map(m => ({
    role: m.role,
    content: m.content.trim().slice(0, CHAT_LIMITS.maxMessageChars),
  }));
}

export function isChatDashboard(value: string): value is ChatDashboard {
  return (CHAT_DASHBOARDS as readonly string[]).includes(value);
}

/** Jüngerer updatedAt gewinnt. Kein Eintrag geht verloren, solange die Id verschieden ist. */
export function mergeChatThreads(local: ChatThread[], remote: ChatThread[]): ChatThread[] {
  const byId = new Map<string, ChatThread>();
  for (const thread of [...local, ...remote]) {
    const prev = byId.get(thread.id);
    if (!prev || prev.updatedAt < thread.updatedAt) byId.set(thread.id, thread);
  }
  const out: ChatThread[] = [];
  byId.forEach(thread => out.push(thread));
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}
