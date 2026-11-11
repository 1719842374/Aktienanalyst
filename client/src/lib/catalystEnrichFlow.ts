/**
 * S15: Katalysator-Enrich prüft res.ok lokal. Bei 404 lädt der Aufrufer die
 * Analyse höchstens einmal pro Ticker und Sitzung neu (gleicher Dashboard-Lauf)
 * und wiederholt den Enrich-Call genau einmal. apiRequest bleibt unangetastet.
 */

export const RELOAD_MESSAGE = "Analyse nicht mehr im Cache, wird neu geladen";
export const LLM_LIMIT_MESSAGE = "KI-Limit erreicht";
export const TIMEOUT_MESSAGE = "Timeout";
export const NETWORK_MESSAGE = "Netzwerkfehler";
export const EMPTY_CATALYSTS_MESSAGE = "Keine Katalysatoren erhalten.";

const CACHE_MISS_FALLBACK = "Keine Analyse im Cache — zuerst /api/analyze aufrufen";
const SESSION_KEY = "aktienanalyst.catalystReload.v1";

export type EnrichBody = {
  error?: unknown;
  _llmSkipped?: unknown;
  llmSkipReason?: unknown;
  catalysts?: unknown;
  growthThesis?: string | null;
  growthThesisGeneratedAt?: string | null;
  execSummary?: unknown;
};

export type EnrichResponse = {
  ok: boolean;
  status: number;
  body: EnrichBody;
};

export type FlowNotice = { level: "info" | "error"; text: string };

export type FlowResult =
  | {
      kind: "success";
      catalysts: unknown[];
      growthThesis?: string | null;
      growthThesisGeneratedAt?: string | null;
      execSummary?: unknown;
      notices: FlowNotice[];
    }
  | {
      kind: "llm-limit";
      message: string;
      catalysts?: unknown[];
      notices: FlowNotice[];
    }
  | {
      kind: "error";
      message: string;
      notices: FlowNotice[];
    };

export interface ReloadSession {
  /** true nur beim ersten Mal für diesen Ticker in dieser Sitzung. */
  claim(ticker: string): boolean;
}

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function tickerKey(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function reloadedNotice(at: Date): string {
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `Analyse neu geladen (Stand ${hh}:${mm})`;
}

export function memoryReloadSession(): ReloadSession {
  const seen = new Set<string>();
  return {
    claim(ticker: string) {
      const key = tickerKey(ticker);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

function readClaimed(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function storageReloadSession(storage: StorageLike): ReloadSession {
  return {
    claim(ticker: string) {
      const key = tickerKey(ticker);
      if (!key) return false;
      const claimed = readClaimed(storage);
      if (claimed.includes(key)) return false;
      claimed.push(key);
      storage.setItem(SESSION_KEY, JSON.stringify(claimed));
      return true;
    },
  };
}

let browserSession: ReloadSession | null = null;

/** Eine Sitzung pro Tab (sessionStorage), sonst der Speicher dieser Seite. */
export function browserReloadSession(): ReloadSession {
  if (browserSession) return browserSession;
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage) {
      browserSession = storageReloadSession(sessionStorage);
      return browserSession;
    }
  } catch {
    /* privater Modus */
  }
  browserSession = memoryReloadSession();
  return browserSession;
}

function bodyError(body: EnrichBody, fallback: string): string {
  return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
}

function isLlmLimit(status: number, body: EnrichBody): boolean {
  if (status === 402 || status === 429 || body._llmSkipped === true) return true;
  const reason = body.llmSkipReason;
  return reason === "402" || reason === "429" || reason === 402 || reason === 429;
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const message = err instanceof Error ? err.message : "";
  return name === "AbortError" || message === TIMEOUT_MESSAGE || message.startsWith("Timeout:");
}

function isNetworkError(err: unknown): boolean {
  if (isTimeoutError(err)) return false;
  if (!(err instanceof Error)) return true;
  if (err.name === "TypeError") return true;
  return /fetch failed|failed to fetch|networkerror|econnreset|enotfound|econnrefused/i.test(err.message);
}

export function thrownEnrichMessage(err: unknown): string {
  if (isTimeoutError(err)) return TIMEOUT_MESSAGE;
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  if (err instanceof Error && err.message.trim()) return err.message;
  return NETWORK_MESSAGE;
}

type Classified =
  | { kind: "miss"; message: string }
  | { kind: "limit"; catalysts?: unknown[] }
  | { kind: "server"; message: string }
  | { kind: "http"; message: string }
  | { kind: "ok"; body: EnrichBody }
  | { kind: "empty" };

function classify(res: EnrichResponse): Classified {
  const body = res.body ?? {};
  if (res.status === 404) return { kind: "miss", message: bodyError(body, CACHE_MISS_FALLBACK) };
  if (isLlmLimit(res.status, body)) {
    return { kind: "limit", catalysts: Array.isArray(body.catalysts) ? body.catalysts : undefined };
  }
  if (res.status >= 500) return { kind: "server", message: bodyError(body, `HTTP ${res.status}`) };
  if (!res.ok || res.status >= 400) return { kind: "http", message: bodyError(body, `HTTP ${res.status}`) };
  if (Array.isArray(body.catalysts)) return { kind: "ok", body };
  return { kind: "empty" };
}

function thesisField(value: unknown): string | null | undefined {
  if (typeof value === "string" || value === null) return value;
  return undefined;
}

function fromClassified(classified: Exclude<Classified, { kind: "miss" }>, notices: FlowNotice[]): FlowResult {
  switch (classified.kind) {
    case "ok":
      return {
        kind: "success",
        catalysts: classified.body.catalysts as unknown[],
        growthThesis: thesisField(classified.body.growthThesis),
        growthThesisGeneratedAt: thesisField(classified.body.growthThesisGeneratedAt),
        execSummary: classified.body.execSummary,
        notices,
      };
    case "limit":
      return { kind: "llm-limit", message: LLM_LIMIT_MESSAGE, catalysts: classified.catalysts, notices };
    case "server":
    case "http":
      return { kind: "error", message: classified.message, notices };
    case "empty":
      return { kind: "error", message: EMPTY_CATALYSTS_MESSAGE, notices };
    default: {
      const _exhaustive: never = classified;
      return _exhaustive;
    }
  }
}

export async function runCatalystEnrich(args: {
  ticker: string;
  session: ReloadSession;
  request: () => Promise<EnrichResponse>;
  reloadDashboard: () => Promise<unknown>;
  now?: () => Date;
  onNotice?: (notice: FlowNotice) => void;
}): Promise<FlowResult> {
  const notices: FlowNotice[] = [];
  const push = (notice: FlowNotice) => {
    notices.push(notice);
    args.onNotice?.(notice);
  };
  const fail = (message: string): FlowResult => {
    push({ level: "error", text: message });
    return { kind: "error", message, notices };
  };

  let response: EnrichResponse;
  try {
    response = await args.request();
  } catch (err) {
    return fail(thrownEnrichMessage(err));
  }

  let classified = classify(response);
  if (classified.kind === "miss") {
    if (!args.session.claim(args.ticker)) return fail(classified.message);
    push({ level: "info", text: RELOAD_MESSAGE });
    try {
      await args.reloadDashboard();
    } catch (err) {
      return fail(thrownEnrichMessage(err));
    }
    push({ level: "info", text: reloadedNotice((args.now ?? (() => new Date()))()) });
    try {
      response = await args.request();
    } catch (err) {
      return fail(thrownEnrichMessage(err));
    }
    classified = classify(response);
  }

  if (classified.kind === "miss") return fail(classified.message);
  return fromClassified(classified, notices);
}
