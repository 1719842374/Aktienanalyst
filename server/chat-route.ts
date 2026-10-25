/**
 * POST /api/chat — KI-Chatbot (WORK_DASHBOARD_FEATURES_2026-10.md §4, Architektur §4c).
 *
 * Additive Route: liest nur den vom Dashboard mitgeschickten Kontext (shared/chat-context.ts),
 * ruft das LLM über das bestehende callLLMJson (OpenRouter) mit EIGENEM Zeitlimit auf
 * (Muster Makro-Ebene; callLLMJson selbst bleibt unverändert) und gibt eine Textantwort zurück.
 * Kein Score-, Gate- oder Analyse-Einfluss; server/analyze-route.ts wird nicht berührt.
 * Kein Key → status "no-key" mit klarem Text, keine erfundene Antwort.
 * Es werden keine Keys und keine Chat-Inhalte geloggt (nur Längen/Status).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  CHAT_DASHBOARDS, CHAT_LIMITS,
  type ChatContext, type ChatRequestBody, type ChatResponseBody,
} from "../shared/chat-context";

/** Eigenes Zeitlimit für den Chat-Call (liegt unter dem apiRequest-Client-Timeout von 90 s). */
export const CHAT_LLM_TIMEOUT_MS = 30_000;
export const CHAT_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;

type LlmFn = (opts: { prompt: string; maxTokens?: number; temperature?: number; systemPrompt?: string }) =>
  Promise<{ data: any; modelUsed: string } | null>;

export interface ChatDeps {
  llmAvailable: () => boolean;
  llm: LlmFn;
  timeoutMs?: number;
}

const factValue = z.union([z.string().max(CHAT_LIMITS.maxFactValueChars), z.number().finite(), z.boolean(), z.null()]);

export const chatRequestSchema = z.object({
  dashboard: z.enum(CHAT_DASHBOARDS as unknown as [string, ...string[]]),
  sectionId: z.number().int().min(0).max(999).nullable(),
  context: z.object({
    dashboard: z.enum(CHAT_DASHBOARDS as unknown as [string, ...string[]]),
    entity: z.string().min(1).max(40),
    title: z.string().max(160),
    asOf: z.string().max(60).nullable(),
    sections: z.array(z.object({
      id: z.number().int().min(0).max(999),
      label: z.string().max(80),
      facts: z.record(z.string().max(CHAT_LIMITS.maxFactKeyChars), factValue)
        .refine(f => Object.keys(f).length <= CHAT_LIMITS.maxFactsPerSection, "zu viele Fakten"),
    })).max(CHAT_LIMITS.maxSections),
    gates: z.array(z.object({
      id: z.string().max(60), active: z.boolean(), cap: z.number().finite().nullable(),
      severity: z.string().max(30), rationale: z.string().max(CHAT_LIMITS.maxFactValueChars),
    })).max(CHAT_LIMITS.maxGates),
    notes: z.array(z.string().max(CHAT_LIMITS.maxFactValueChars)).max(CHAT_LIMITS.maxNotes),
  }),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(CHAT_LIMITS.maxMessageChars),
  })).min(1).max(CHAT_LIMITS.maxMessages),
}).strict();

function reply(status: ChatResponseBody["status"], extra: Partial<ChatResponseBody> = {}): ChatResponseBody {
  return { ok: status === "ok", answer: null, sectionRefs: [], model: null, status, error: null, ...extra };
}

/** Prüft Form, Grenzen und Konsistenz. Liefert entweder den Body oder einen Fehlertext. */
export function validateChatRequest(raw: unknown): { ok: true; body: ChatRequestBody } | { ok: false; error: string } {
  const parsed = chatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Ungültige Anfrage: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim().slice(0, 200) };
  }
  const body = parsed.data as unknown as ChatRequestBody;
  if (body.context.dashboard !== body.dashboard) return { ok: false, error: "Ungültige Anfrage: Kontext passt nicht zum Dashboard" };
  if (body.messages[body.messages.length - 1].role !== "user") return { ok: false, error: "Ungültige Anfrage: letzte Nachricht muss vom Nutzer sein" };
  if (body.sectionId != null && !body.context.sections.some(s => s.id === body.sectionId)) {
    return { ok: false, error: "Ungültige Anfrage: gebundene Sektion nicht im Kontext" };
  }
  if (JSON.stringify(body.context).length > CHAT_LIMITS.maxContextChars) return { ok: false, error: "Ungültige Anfrage: Kontext zu groß" };
  return { ok: true, body };
}

const DASHBOARD_NAME: Record<string, string> = { stock: "Aktien-Analyse", btc: "Bitcoin-Dashboard", gold: "Gold-Dashboard", recession: "Rezessions-Dashboard" };

export function formatContextForPrompt(ctx: ChatContext, sectionId: number | null): string {
  const lines: string[] = [`Dashboard: ${DASHBOARD_NAME[ctx.dashboard] ?? ctx.dashboard}`, `Objekt: ${ctx.title}`, `Datenstand: ${ctx.asOf ?? "n/a"}`];
  const ordered = sectionId == null ? ctx.sections : [...ctx.sections.filter(s => s.id === sectionId), ...ctx.sections.filter(s => s.id !== sectionId)];
  for (const s of ordered) {
    const facts = Object.entries(s.facts).map(([k, v]) => `${k}=${v === null ? "n/a" : String(v)}`).join("; ");
    lines.push(`[S${s.id} ${s.label}${s.id === sectionId ? " ← GEBUNDEN" : ""}] ${facts || "keine Daten"}`);
  }
  if (ctx.gates.length) {
    lines.push("Scoring-Gates:");
    for (const g of ctx.gates) lines.push(`- ${g.id}: ${g.active ? "AKTIV" : "inaktiv"}, Cap ${g.cap ?? "n/a"}, ${g.severity}; ${g.rationale}`);
  } else lines.push("Scoring-Gates: n/a");
  for (const n of ctx.notes) lines.push(`Hinweis: ${n}`);
  return lines.join("\n");
}

export const CHAT_SYSTEM_PROMPT = [
  "Du bist der Analyse-Assistent dieses Dashboards. Antworte auf Deutsch, sachlich und mit konkreten Zahlen aus dem KONTEXT.",
  "Nutze ausschließlich Werte aus dem KONTEXT. Fehlt ein Wert (n/a), sage das ausdrücklich und erfinde nichts.",
  "Erkläre Sektionen detailliert und mit einem Beispiel, wenn danach gefragt wird.",
  "Was-wäre-wenn-Fragen beantwortest du nur qualitativ als Gedankenexperiment; du änderst keine Scores, Gates oder Bewertungen und gibst keine neuen Score-Werte aus.",
  "Keine Anlageberatung. Antworte nur mit gültigem JSON: {\"answer\": string, \"sectionRefs\": number[]}.",
].join(" ");

export function buildChatPrompt(body: ChatRequestBody): string {
  const history = body.messages.map(m => `${m.role === "user" ? "Nutzer" : "Assistent"}: ${m.content}`).join("\n");
  return `KONTEXT:\n${formatContextForPrompt(body.context, body.sectionId)}\n\nVERLAUF:\n${history}\n\nAntworte auf die letzte Nutzer-Nachricht.`;
}

const TIMEOUT = Symbol("chat-timeout");
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<typeof TIMEOUT>(resolve => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
  try { return await Promise.race([p, t]); } finally { if (timer) clearTimeout(timer); }
}

export async function handleChat(raw: unknown, deps: ChatDeps): Promise<{ http: number; body: ChatResponseBody }> {
  const v = validateChatRequest(raw);
  if (!v.ok) return { http: 400, body: reply("invalid", { error: v.error }) };
  if (!deps.llmAvailable()) {
    return { http: 200, body: reply("no-key", { error: "KI nicht verfügbar: Auf diesem Server ist kein OpenRouter-Key konfiguriert. Es wird keine Antwort erzeugt." }) };
  }
  const body = v.body;
  const timeoutMs = deps.timeoutMs ?? CHAT_LLM_TIMEOUT_MS;
  let res: { data: any; modelUsed: string } | null = null;
  try {
    const call = deps.llm({ prompt: buildChatPrompt(body), systemPrompt: CHAT_SYSTEM_PROMPT, maxTokens: 900, temperature: 0.3 });
    call.catch(() => undefined);
    const raced = await withTimeout(call, timeoutMs);
    if (raced === TIMEOUT) {
      console.warn(`[CHAT] Timeout nach ${timeoutMs} ms (dashboard=${body.dashboard})`);
      return { http: 200, body: reply("timeout", { error: `KI hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} s geantwortet. Bitte erneut versuchen.` }) };
    }
    res = raced;
  } catch {
    res = null;
  }
  const answer = typeof res?.data?.answer === "string" ? res.data.answer.trim().slice(0, 8000) : "";
  if (!res || !answer) {
    console.warn(`[CHAT] LLM-Fehler oder leere Antwort (dashboard=${body.dashboard})`);
    return { http: 200, body: reply("llm-error", { error: "KI-Antwort fehlgeschlagen oder leer. Bitte erneut versuchen." }) };
  }
  const known = new Set(body.context.sections.map(s => s.id));
  const refs = Array.isArray(res.data.sectionRefs) ? res.data.sectionRefs : [];
  const sectionRefs = Array.from(new Set<number>(refs.filter((n: unknown): n is number => typeof n === "number" && known.has(n)))).slice(0, 10);
  return { http: 200, body: reply("ok", { answer, sectionRefs, model: res.modelUsed ?? null }) };
}

const hits = new Map<string, number[]>();
export function chatRateLimited(key: string, now = Date.now()): boolean {
  const xs = (hits.get(key) ?? []).filter(t => now - t < CHAT_RATE_LIMIT.windowMs);
  const limited = xs.length >= CHAT_RATE_LIMIT.max;
  if (!limited) xs.push(now);
  hits.set(key, xs);
  if (hits.size > 5000) hits.clear();
  return limited;
}

export function registerChatRoute(app: Express, depsOverride?: ChatDeps): void {
  app.post("/api/chat", async (req: Request, res: Response) => {
    if (chatRateLimited(String(req.ip ?? "unknown"))) {
      res.status(429).json(reply("invalid", { error: "Zu viele Chat-Anfragen. Bitte kurz warten." }));
      return;
    }
    const deps: ChatDeps = depsOverride ?? await (async () => {
      const m = await import("./llm-openrouter");
      return { llmAvailable: m.isLLMAvailable, llm: m.callLLMJson };
    })();
    const out = await handleChat(req.body, deps);
    res.status(out.http).json(out.body);
  });
}
