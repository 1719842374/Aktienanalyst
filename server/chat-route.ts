/**
 * POST /api/chat — KI-Chatbot (WORK_DASHBOARD_FEATURES_2026-10.md §4, Architektur §4c).
 *
 * Additive Route: liest nur den vom Dashboard mitgeschickten Kontext (shared/chat-context.ts),
 * ruft das LLM über das bestehende callLLMJson (OpenRouter) mit EIGENEM Zeitlimit auf
 * (Muster Makro-Ebene) und eigener Modellkette chatLlmModels() (OPENROUTER_CHAT_MODEL, sonst
 * Code-Default, dahinter Fallback) und gibt eine Textantwort zurück.
 * Kein Score-, Gate- oder Analyse-Einfluss; server/analyze-route.ts wird nicht berührt.
 * Kein Key → status "no-key" mit klarem Text, keine erfundene Antwort.
 * Es werden keine Keys und keine Chat-Inhalte geloggt (nur Längen/Status).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  CHAT_DASHBOARDS, CHAT_INCOME_SECTION_ID, CHAT_LIMITS, CHAT_REQUEST_TIMEOUT_MS, chatContextTrimReport, fitChatContextBudget,
  type ChatContext, type ChatContextTrimEntry, type ChatRequestBody, type ChatResponseBody,
} from "../shared/chat-context";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import type { LlmAttempt } from "./llm-openrouter";

/** Eigenes Zeitlimit für den Chat-Call (liegt unter dem apiRequest-Client-Timeout von 90 s). */
export const CHAT_LLM_TIMEOUT_MS = 30_000;
export const CHAT_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;

/**
 * Env-Variable (Render) für das Chat-Modell. Eigene Variable, weil OPENROUTER_MODEL in
 * callWithFallback für alle Analyse-Calls gilt; Analyse und Podcast bleiben darauf.
 */
export const CHAT_MODEL_ENV = "OPENROUTER_CHAT_MODEL";
/**
 * Code-Default, wenn OPENROUTER_CHAT_MODEL leer ist (OpenRouter-ID laut https://openrouter.ai/api/v1/models).
 * Haiku 4.5 (Philip, 02.11.2026: Opus 5.5 zu teuer). Ohne Env-Wert ist die Kette nur dieses Modell.
 */
export const CHAT_LLM_DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
/** Springt ein, wenn ein per Env gesetztes Modell 402/404/429 oder eine leere Antwort liefert (erstes Glied von MODEL_FALLBACK_CHAIN). */
export const CHAT_LLM_FALLBACK_MODEL = "anthropic/claude-haiku-4.5";
/** OpenRouter-ID "anbieter/modell[:variante]". Eine falsch geschriebene ID beantwortet OpenRouter mit 400, und 400 fällt nicht auf den Fallback. */
const OPENROUTER_MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

const warnedChatModels = new Set<string>();

/** Modellkette des Chats: Env-Wert vor Code-Default, dahinter der Fallback. Wird je Anfrage gelesen. */
export function chatLlmModels(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const configured = env[CHAT_MODEL_ENV]?.trim() ?? "";
  const valid = OPENROUTER_MODEL_ID.test(configured);
  if (configured && !valid && !warnedChatModels.has(configured)) {
    warnedChatModels.add(configured);
    console.warn(`[CHAT] ${CHAT_MODEL_ENV}="${configured.slice(0, 80)}" ist keine OpenRouter-ID; nutze ${CHAT_LLM_DEFAULT_MODEL}`);
  }
  const primary = valid ? configured : CHAT_LLM_DEFAULT_MODEL;
  return primary === CHAT_LLM_FALLBACK_MODEL ? [primary] : [primary, CHAT_LLM_FALLBACK_MODEL];
}

/** Abstand zum Client-Timeout, damit der Server zuerst mit status "timeout" antwortet. */
export const CHAT_ANSWER_TIMEOUT_HEADROOM_MS = 3_000;
/**
 * Zeitlimit der Chat-Antwort samt Fortsetzungs-Call. Tabelle, Vorjahresvergleich und Quelle brauchen länger als
 * CHAT_LLM_TIMEOUT_MS (das der Podcast mitnutzt); liegt um den Abstand unter CHAT_REQUEST_TIMEOUT_MS.
 */
export const CHAT_ANSWER_TIMEOUT_MS = CHAT_REQUEST_TIMEOUT_MS - CHAT_ANSWER_TIMEOUT_HEADROOM_MS;
/**
 * Token-Budget je Chat-Call: Kernsatz, Posten-Tabelle (bis ~18 Zeilen), Ausreißer-Satz und Quellenlink
 * im JSON. 1 800 reichte für lange GuV-Tabellen nicht. Liegt auf der Decke LLM_JSON_MAX_TOKENS von callLLMJson.
 */
export const CHAT_LLM_MAX_TOKENS = 4_000;
/** Höchstens so viele Fortsetzungs-Calls, wenn eine Antwort trotzdem am Budget endet (finish_reason "length"). */
export const CHAT_MAX_CONTINUATIONS = 1;
/** Fortsetzen nur, wenn bis zum Antwort-Timeout noch so viel Zeit bleibt; sonst Hinweis statt Fortsetzung. */
export const CHAT_CONTINUATION_MIN_MS = 8_000;
/** Sichtbarer Hinweis, wenn die Antwort am Token-Budget endete und nicht fortgesetzt werden konnte. */
export const CHAT_TRUNCATED_NOTE = "Hinweis: Die Antwort wurde am Token-Budget abgeschnitten und ist unvollständig. Frag nach dem fehlenden Teil.";
/** Modelle ohne temperature in den OpenRouter supported_parameters (z. B. Opus 5.5) ignorieren den Wert; Haiku nutzt ihn. */
export const CHAT_LLM_TEMPERATURE = 0.3;

type LlmFn = (opts: { prompt: string; maxTokens?: number; temperature?: number; systemPrompt?: string; models?: readonly string[]; attempts?: LlmAttempt[] }) =>
  Promise<{ data: any; modelUsed: string; finishReason?: string | null; salvaged?: boolean } | null>;

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
      severity: z.string().max(30), rationale: z.string().max(CHAT_LIMITS.maxRationaleChars),
    })).max(CHAT_LIMITS.maxGates),
    notes: z.array(z.string().max(CHAT_LIMITS.maxNoteChars)).max(CHAT_LIMITS.maxNotes),
  }),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(CHAT_LIMITS.maxMessageChars),
  })).min(1).max(CHAT_LIMITS.maxMessages),
}).strict();

function reply(status: ChatResponseBody["status"], extra: Partial<ChatResponseBody> = {}): ChatResponseBody {
  const body: ChatResponseBody = { ok: status === "ok", answer: null, sectionRefs: [], model: null, status, error: null, ...extra };
  if (!body.contextTrimmed?.length) delete body.contextTrimmed;
  return body;
}

/** Kürzt Fakt-Text, Rationale und Notes auf das gemeinsame Budget, bevor Zod prüft. */
function softenChatRequest(raw: unknown): { value: unknown; contextTrimmed?: ChatContextTrimEntry[] } {
  if (!raw || typeof raw !== "object") return { value: raw };
  const body = raw as { context?: unknown };
  const ctx = body.context;
  if (!ctx || typeof ctx !== "object") return { value: raw };
  const c = ctx as { sections?: unknown; gates?: unknown; notes?: unknown };
  if (!Array.isArray(c.sections) || !Array.isArray(c.gates) || !Array.isArray(c.notes)) return { value: raw };
  const before = ctx as ChatContext;
  const fitted = fitChatContextBudget(before);
  return { value: { ...body, context: fitted }, contextTrimmed: chatContextTrimReport(before, fitted) };
}

/** Prüft Form, Grenzen und Konsistenz. Liefert entweder den Body oder einen Fehlertext. */
export function validateChatRequest(raw: unknown): { ok: true; body: ChatRequestBody; contextTrimmed?: ChatContextTrimEntry[] } | { ok: false; error: string } {
  const softened = softenChatRequest(raw);
  const parsed = chatRequestSchema.safeParse(softened.value);
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
  return softened.contextTrimmed ? { ok: true, body, contextTrimmed: softened.contextTrimmed } : { ok: true, body };
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
  "Jede Sektion kann ein Feld \"auffaelligkeiten\" haben: mögliche Schwächen oder Auffälligkeiten, abgeleitet nur aus vorhandenen Daten, Flags und Gates. Nenne sie, wenn nach Schwächen, Risiken oder Auffälligkeiten einer Sektion gefragt wird, und erkläre sie mit den Zahlen der Sektion; erfinde keine weiteren.",
  "Du machst keine Änderungsvorschläge an Parametern und keine Overrides.",
  "Fragen zu GuV-Posten (Umsatz, Kosten, Aufwendungen, Erträge, sonstige Posten, Zinsen, Steuern, Ergebnis) beantwortest du aus den S4-Fakten mit dem Präfix guv in genau vier Teilen:",
  "(1) Ein Satz mit der Kernzahl, aktuelle Periode gegen Vorjahresperiode laut guvPeriode.",
  "(2) Eine Markdown-Tabelle der Posten mit den Spalten Posten | aktuelle Periode | Vorjahresperiode | Δ, nur Zeilen aus guv_-Fakten, Unterposten direkt unter ihrer Summenzeile, Einheit wie in guvPeriode.",
  "(3) Ein Satz zum größten Ausreißer aus guvAusreisser_ mit der Erklärung laut Filing; steht dort n/a, nenne den Grund.",
  "(4) Quelle: Markdown-Link auf guvFilingUrl mit Formular, Periode und Einreichdatum aus guvQuelle.",
  "Diese Form hat bei GuV-Fragen Vorrang vor der Gliederung Catalysts, Assumptions und Risks. Rechne keine fehlenden Posten aus; fehlen guv-Fakten oder steht guvHinweis mit n/a, antworte mit n/a und dem Grund.",
  "Fragen zum letzten Earnings Call: Datum (earningsCallDatum), Art der Quelle (earningsCallArt), Kernaussagen aus Zusammenfassung bzw. Auszug, wörtliche Zitate nur aus earningsCallZitate mit Namen, und die Quelle als Link auf earningsCallQuelleUrl, falls vorhanden. Ein Earnings Release ist kein Call-Transkript; sag das. Fehlt alles, nenne earningsCallHinweis.",
  "Zahlen mit Vergleich nennst du immer mit beiden Perioden und mit Quelle.",
  "Die letzte Zeile jeder Antwort beginnt mit „Quelle:“: Link auf guvFilingUrl bzw. earningsCallQuelleUrl, wenn du diese Daten nutzt, sonst „Quelle: geladene Dashboard-Daten“.",
  "Zeilenumbrüche im JSON-String schreibst du als einfaches \\n, nie doppelt escaped.",
  "Betrifft die Frage die Lage des Assets und steht keine AUFGABE für die ganze Analyse im Prompt, gliedere die Antwort in die Abschnitte Catalysts, Assumptions und Risks. Nur Werte aus dem KONTEXT, Fehlendes als n/a.",
  "Liegt im Nutzerprompt eine AUFGABE für die ganze Analyse, halte ihre Blockreihenfolge ein. PESTEL nur, wenn pestelStark=ja. Thesis immer als dominante Klasse, ohne Wachstumsschwelle.",
  "Keine Anlageberatung. Antworte nur mit gültigem JSON: {\"answer\": string, \"sectionRefs\": number[]}.",
].join(" ");

/** Ganze Analyse: kohärentes Bild, keine Sektionsliste. WORK_KI_CHAT_SCHEMA + SCHEMA_UPDATE. */
export const CHAT_BIG_PICTURE_TASK = [
  "Ordne die Daten zu einem Bild. Liste nicht Sektion für Sektion auf.",
  "Blöcke in dieser Reihenfolge, jeder Block nur aus dem KONTEXT:",
  "1. Wachstumstreiber: größtes Segment und das, was der letzte Earnings Call als Treiber nennt. Steht earningsCallHinweis, nenne den Grund und erfinde keinen Call.",
  "2. Financials: was die Kennzahlen in S4 zeigen; GuV-Posten aus guv_ mit Vorjahresvergleich und dem Link guvFilingUrl als Quelle.",
  "3. Moat / Ökosystem: Burggraben und Bindung aus S13. Peers nur, wenn sie im Kontext stehen.",
  "4. PESTEL: nur wenn pestelStark=ja. Sonst diesen Block weglassen.",
  "5. Technical: Momentum aus S11/S12 (RSL, Cross). Fehlende Client-Werte als n/a mit dem genannten Grund.",
  "6. Bewertung: was der Preis impliziert (DCF, g*, Ampel). Keine neue Score-Zahl.",
  "7. Management: Delivery und Kapitalallokation aus S19 inklusive kiAntwort, falls vorhanden. Fehlt der Score: n/a mit Grund.",
  "8. Thesis: immer die dominante Klasse (thesisDominanteKlasse, größter Anteil). Keine Wachstumsschwelle. Fehlt die Klasse: n/a — Thesis-Klassen nicht geladen.",
  "9. Fazit: zwei bis vier Sätze.",
  "News aus newsTop einordnen, nicht nur aufzählen. newsPositiv und newsNegativ nur verwenden, wenn sie keine n/a-Zeile sind.",
  "Analysten: Buy/Hold/Sell aus S1. Narrative Thesen nur, wenn analystenThesen keine n/a-Zeile ist. Beat/Miss aus beatMiss, wenn das keine n/a-Zeile ist; sonst nur, was die Earnings-Zusammenfassung dazu sagt. Steht es dort nicht: n/a.",
  "Steht kiAntwort in einer Sektion, beziehe dich darauf. Fehlt sie, wurde die KI-Analyse dieser Sektion nicht ausgeführt.",
].join(" ");

export function buildChatPrompt(body: ChatRequestBody): string {
  const history = body.messages.map(m => `${m.role === "user" ? "Nutzer" : "Assistent"}: ${m.content}`).join("\n");
  const task = body.sectionId == null ? `\n\nAUFGABE (ganze Analyse):\n${CHAT_BIG_PICTURE_TASK}` : "";
  return `KONTEXT:\n${formatContextForPrompt(body.context, body.sectionId)}\n\nVERLAUF:\n${history}${task}\n\nAntworte auf die letzte Nutzer-Nachricht.`;
}

/** Prompt für die Fortsetzung einer am Token-Budget abgeschnittenen Antwort. */
export function buildChatContinuationPrompt(body: ChatRequestBody, partial: string): string {
  return `${buildChatPrompt(body)}\n\nDEINE BISHERIGE ANTWORT (am Token-Budget abgeschnitten):\n${partial}\n\n`
    + "Setze die Antwort genau an der Abbruchstelle fort, auch mitten im Satz oder in der Tabellenzeile. Wiederhole nichts. "
    + "answer enthält nur die Fortsetzung; die letzte Zeile beginnt mit „Quelle:“.";
}

/** Länge der Antwort im Response-Body. Liegt über dem, was CHAT_LLM_MAX_TOKENS samt Fortsetzung erzeugen kann. */
export const CHAT_ANSWER_MAX_CHARS = 32_000;

/**
 * Doppelt escapte Umbrüche ("\\n" im JSON → wörtliches \n im Text) und eine verschachtelte
 * JSON-Hülle ({"answer": "…"} als String) werden zu normalem Markdown-Text.
 */
export function normalizeChatAnswer(raw: string): string {
  let s = raw;
  if (/^\s*\{\s*"answer"\s*:/.test(s)) {
    try {
      const inner = JSON.parse(s);
      if (typeof inner?.answer === "string") s = inner.answer;
    } catch { /* kein gültiges JSON: Text bleibt */ }
  }
  return s.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\\t/g, "  ").replace(/\\"/g, '"');
}

/** Zeile „Quelle: …“ (auch fett oder als Liste) irgendwo in der Antwort. */
const SOURCE_LINE = /(^|\n)\s*(?:[-*]\s*)?(?:\*\*|__)?Quellen?(?:\*\*|__)?\s*:/i;
const GUV_QUESTION = /\b(guv|gewinn- und verlust|income statement|umsatz|revenue|kosten|aufwend|expense|ertr[äa]g|income|zins|steuer|ergebnis|marge|margin|posten)/i;
const EARNINGS_QUESTION = /\b(earnings|call|quartalszahlen|release|transkript|transcript)/i;

function factOf(ctx: ChatContext, key: string): string | null {
  for (const s of ctx.sections) {
    const v = s.facts[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const httpUrl = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null);
const mdLabel = (v: string) => v.replace(/[[\]]/g, "");

/**
 * Quellzeile, die zur letzten Frage passt: GuV-Frage (oder gebundene S4) → Filing-Link aus guvFilingUrl,
 * Earnings-Frage → earningsCallQuelleUrl, sonst die geladenen Dashboard-Daten mit Datenstand.
 */
export function chatSourceLines(body: ChatRequestBody): Array<{ line: string; plain: string; url: string | null }> {
  const ctx = body.context;
  const question = [...body.messages].reverse().find(m => m.role === "user")?.content ?? "";
  const out: Array<{ line: string; plain: string; url: string | null }> = [];
  const guvUrl = httpUrl(factOf(ctx, "guvFilingUrl"));
  if (guvUrl && (body.sectionId === CHAT_INCOME_SECTION_ID || GUV_QUESTION.test(question))) {
    const label = mdLabel(factOf(ctx, "guvQuelle") ?? "Filing");
    out.push({ line: `Quelle: [${label}](${guvUrl})`, plain: `Quelle: ${label} (${guvUrl})`, url: guvUrl });
  }
  const earnUrl = httpUrl(factOf(ctx, "earningsCallQuelleUrl"));
  if (EARNINGS_QUESTION.test(question) && (earnUrl || factOf(ctx, "earningsCallQuelle"))) {
    const label = mdLabel(factOf(ctx, "earningsCallQuelle") ?? "Earnings Release");
    out.push({ line: earnUrl ? `Quelle: [${label}](${earnUrl})` : `Quelle: ${label}`, plain: earnUrl ? `Quelle: ${label} (${earnUrl})` : `Quelle: ${label}`, url: earnUrl });
  }
  if (!out.length) {
    const line = `Quelle: geladene Dashboard-Daten (${ctx.title}, Datenstand ${ctx.asOf ?? "n/a"})`;
    out.push({ line, plain: line, url: null });
  }
  return out;
}

/**
 * Fehlertext für timeout und llm-error: was passiert ist, der Grund und die Quelle der Daten, auf die
 * sich die Frage bezog. Das Widget zeigt Fehler als Rohtext, deshalb Klartext statt Markdown-Link.
 */
export function chatErrorText(headline: string, reason: string, body: ChatRequestBody): string {
  return `${headline}\nGrund: ${reason}\nBitte erneut versuchen.\n${chatSourceLines(body).map(l => l.plain).join("\n")}`;
}

/** Hängt fehlende Quellzeilen an: jede passende Quelle mit Link muss im Text stehen, und eine Zeile „Quelle:“ immer. */
export function ensureChatSourceLine(answer: string, body: ChatRequestBody): string {
  const lines = chatSourceLines(body);
  const hasLine = SOURCE_LINE.test(answer);
  const missing = lines.filter(l => (l.url ? !answer.includes(l.url) : !hasLine));
  if (!missing.length) return answer;
  return `${answer.trimEnd()}\n\n${missing.map(l => l.line).join("\n\n")}`;
}

/** Warum nicht das erste Modell der Kette antwortete. null, wenn es das erste war. */
export function chatFallbackReason(attempts: readonly LlmAttempt[], modelUsed: string | null): string | null {
  const failed = attempts.filter(a => a.outcome !== "ok");
  if (!failed.length || (modelUsed && attempts[0]?.model === modelUsed)) return null;
  return failed.map(a => {
    if (a.outcome === "empty") return `${a.model}: leere Antwort (finish_reason ${a.finishReason ?? "n/a"})`;
    return `${a.model}: ${a.status != null ? `HTTP ${a.status}` : "Fehler ohne HTTP-Status"}`;
  }).join(" | ");
}

const TIMEOUT = Symbol("chat-timeout");
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<typeof TIMEOUT>(resolve => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
  try { return await Promise.race([p, t]); } finally { if (timer) clearTimeout(timer); }
}

type LlmResult = Awaited<ReturnType<LlmFn>>;

async function callChatLlm(deps: ChatDeps, opts: Parameters<LlmFn>[0], ms: number): Promise<LlmResult | typeof TIMEOUT> {
  try {
    const call = deps.llm(opts);
    call.catch(() => undefined);
    return await withTimeout(call, ms);
  } catch {
    return null;
  }
}

const isCut = (r: NonNullable<LlmResult>) => r.finishReason === "length" || r.salvaged === true;

export async function handleChat(raw: unknown, deps: ChatDeps): Promise<{ http: number; body: ChatResponseBody }> {
  const v = validateChatRequest(raw);
  if (!v.ok) return { http: 400, body: reply("invalid", { error: v.error }) };
  const trim = v.contextTrimmed?.length ? { contextTrimmed: v.contextTrimmed } : {};
  if (!deps.llmAvailable()) {
    return { http: 200, body: reply("no-key", { error: OPENROUTER_NO_KEY_MESSAGE, ...trim }) };
  }
  const body = v.body;
  const timeoutMs = deps.timeoutMs ?? CHAT_ANSWER_TIMEOUT_MS;
  const startedAt = Date.now();
  const models = chatLlmModels();
  const attempts: LlmAttempt[] = [];
  const raced = await callChatLlm(deps, {
    prompt: buildChatPrompt(body), systemPrompt: CHAT_SYSTEM_PROMPT,
    maxTokens: CHAT_LLM_MAX_TOKENS, temperature: CHAT_LLM_TEMPERATURE, models, attempts,
  }, timeoutMs);
  const fallbackReason = chatFallbackReason(attempts, raced && raced !== TIMEOUT ? raced.modelUsed : null);
  if (fallbackReason) console.warn(`[CHAT] Fallback (Kette ${models.join(" → ")}): ${fallbackReason}`);
  const fallback = fallbackReason ? { fallbackReason } : {};
  const failedAttempts = chatFallbackReason(attempts, null);
  if (raced === TIMEOUT) {
    const reason = `Zeitlimit ${Math.round(timeoutMs / 1000)} s überschritten (Kette ${models.join(" → ")})${failedAttempts ? `; vorher ${failedAttempts}` : ""}`;
    console.warn(`[CHAT] Timeout nach ${timeoutMs} ms (dashboard=${body.dashboard}): ${reason}`);
    return { http: 200, body: reply("timeout", { error: chatErrorText(`KI hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} s geantwortet.`, reason, body), ...trim, ...fallback }) };
  }
  const res = raced;
  const first = typeof res?.data?.answer === "string" ? normalizeChatAnswer(res.data.answer) : "";
  if (!res || !first.trim()) {
    const reason = res
      ? `${res.modelUsed} lieferte keinen Antworttext (finish_reason ${res.finishReason ?? "n/a"})`
      : failedAttempts ?? `keine verwertbare Antwort von OpenRouter (Netz-, HTTP- oder JSON-Fehler, Kette ${models.join(" → ")})`;
    console.warn(`[CHAT] LLM-Fehler oder leere Antwort (dashboard=${body.dashboard}): ${reason}`);
    return { http: 200, body: reply("llm-error", { error: chatErrorText("KI-Antwort fehlgeschlagen oder leer.", reason, body), ...trim, ...fallback }) };
  }
  let answer = first;
  let cut = isCut(res);
  let continued = false;
  const refs: unknown[] = Array.isArray(res.data.sectionRefs) ? [...res.data.sectionRefs] : [];
  for (let i = 0; cut && i < CHAT_MAX_CONTINUATIONS; i++) {
    const left = timeoutMs - (Date.now() - startedAt);
    if (left < CHAT_CONTINUATION_MIN_MS) break;
    console.warn(`[CHAT] Antwort am Token-Budget (finish_reason ${res.finishReason ?? "n/a"}, ${answer.length} Zeichen); Fortsetzung ${i + 1}`);
    const more = await callChatLlm(deps, {
      prompt: buildChatContinuationPrompt(body, answer), systemPrompt: CHAT_SYSTEM_PROMPT,
      maxTokens: CHAT_LLM_MAX_TOKENS, temperature: CHAT_LLM_TEMPERATURE, models: [res.modelUsed],
    }, left);
    const tail = more && more !== TIMEOUT && typeof more.data?.answer === "string" ? normalizeChatAnswer(more.data.answer) : "";
    if (!more || more === TIMEOUT || !tail.trim()) break;
    answer += tail;
    continued = true;
    cut = isCut(more);
    if (Array.isArray(more.data.sectionRefs)) refs.push(...more.data.sectionRefs);
  }
  if (cut) {
    console.warn(`[CHAT] Antwort bleibt am Token-Budget abgeschnitten (${answer.length} Zeichen, Fortsetzung ${continued ? "unvollständig" : "nicht möglich"})`);
    answer = `${answer.trimEnd()}…\n\n*${CHAT_TRUNCATED_NOTE}*`;
  }
  answer = ensureChatSourceLine(answer.trim(), body).slice(0, CHAT_ANSWER_MAX_CHARS);
  const known = new Set(body.context.sections.map(s => s.id));
  const sectionRefs = Array.from(new Set<number>(refs.filter((n: unknown): n is number => typeof n === "number" && known.has(n)))).slice(0, 10);
  return {
    http: 200,
    body: reply("ok", { answer, sectionRefs, model: res.modelUsed ?? null, ...trim, ...fallback, ...(cut ? { truncated: true } : {}), ...(continued ? { continued: true } : {}) }),
  };
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
