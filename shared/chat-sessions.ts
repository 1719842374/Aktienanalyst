/**
 * Chat-Verlauf im Browser (WORK_SIMPLYWALLST_LEARNINGS §6).
 * Kein Server, kein Supabase. Älteste Sessions fallen, wenn das Zeichenbudget voll ist.
 */

export interface StoredChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StoredChatSession {
  id: string;
  title: string;
  savedAt: string;
  turns: StoredChatTurn[];
}

/** Obergrenze der localStorage-Ablage, in Zeichen der JSON-Form. */
export const CHAT_SESSION_CHAR_BUDGET = 100_000;

export function chatSessionStorageKey(dashboard: string, entity: string): string {
  return `chat-sessions:${dashboard}:${entity}`;
}

export function sessionTitle(turns: readonly StoredChatTurn[]): string {
  const first = turns.find(t => t.role === "user")?.content?.trim();
  if (!first) return "Leerer Chat";
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

export function pushChatSession(sessions: readonly StoredChatSession[], next: StoredChatSession): StoredChatSession[] {
  if (next.turns.length === 0) return sessions.slice();
  const merged = [next, ...sessions.filter(s => s.id !== next.id)];
  const kept: StoredChatSession[] = [];
  let used = 0;
  for (const s of merged) {
    const n = JSON.stringify(s).length;
    if (kept.length > 0 && used + n > CHAT_SESSION_CHAR_BUDGET) break;
    kept.push(s);
    used += n;
  }
  return kept;
}

export function parseChatSessions(raw: string | null): StoredChatSession[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((s): s is StoredChatSession =>
      s && typeof s.id === "string" && typeof s.title === "string" && Array.isArray(s.turns));
  } catch {
    return [];
  }
}
