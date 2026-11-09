/**
 * FW-05 — Gemeinsamer Refresh: Button ruft invalidateQueries für Analyse,
 * Researcher und Portfolio auf. Die Query-Funktionen treffen die API-Routen.
 * Ist die Seite gemountet, läuft ihr bestehender Refresh-Handler (derselbe
 * Request wie bisher, force). Sonst derselbe Request aus dem letzten Scope.
 * Kein Score-Pfad.
 */
import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  CROSS_MODULE_QUERY_KEYS,
  createForceAnalyzeGate,
  crossModuleQueryKeyList,
  refreshErrorLine,
  type CrossModuleSlot,
  type RefreshModuleError,
} from "@shared/cross-module-refresh";
import { toast } from "@/hooks/use-toast";
import {
  analyzePostBody,
  readLastTicker,
  readOverrides,
  safeLocalStorage,
} from "@shared/peer-override-persist";
import { clampPeerOverrides } from "@/lib/peerOverrideLimits";
import { loadPolicyFromStorage, loadPositionsFromStorage, timeframeCutoffIso } from "@/lib/portfolio/positions";
import { apiRequest } from "@/lib/queryClient";

export type CrossModuleRefreshResult = {
  phase: "idle" | "ready";
  slot: CrossModuleSlot;
};

const RESEARCHER_SCOPE_KEY = "aktienanalyst_researcher_scope_v1";
const CROSS_MODULE_INITIAL_UPDATED_AT = 1;

type RefreshHandler = () => Promise<void>;

const handlers: Record<CrossModuleSlot, RefreshHandler | null> = {
  analyze: null,
  researcher: null,
  portfolio: null,
};

let armed = false;
let pending = false;
let inFlight: Promise<void> | null = null;
const pendingListeners = new Set<() => void>();
export const EMPTY_REFRESH_ERRORS: RefreshModuleError[] = [];
let refreshErrors: RefreshModuleError[] = EMPTY_REFRESH_ERRORS;
const errorListeners = new Set<() => void>();
let forceGate = createForceAnalyzeGate();
let activeToast: { dismiss: () => void } | null = null;

type AnalyzeRefreshAdapter = {
  ticker: () => string;
  run: (ticker: string) => Promise<unknown>;
};

type PortfolioRefreshAdapter = {
  tickers: () => string[];
  fetchTicker: (ticker: string) => Promise<void>;
};

let analyzeRefresh: AnalyzeRefreshAdapter | null = null;
let portfolioRefresh: PortfolioRefreshAdapter | null = null;

function setPending(next: boolean): void {
  pending = next;
  pendingListeners.forEach((listener) => listener());
}

export function subscribeCrossModulePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

export function isCrossModulePending(): boolean {
  return pending;
}

export function subscribeRefreshErrors(listener: () => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

export function getRefreshErrors(): RefreshModuleError[] {
  return refreshErrors;
}

export function registerAnalyzeRefresh(adapter: AnalyzeRefreshAdapter): () => void {
  analyzeRefresh = adapter;
  return () => {
    if (analyzeRefresh === adapter) analyzeRefresh = null;
  };
}

export function registerPortfolioRefresh(adapter: PortfolioRefreshAdapter): () => void {
  portfolioRefresh = adapter;
  return () => {
    if (portfolioRefresh === adapter) portfolioRefresh = null;
  };
}

function notifyErrors(): void {
  errorListeners.forEach((listener) => listener());
}

function clearRefreshErrors(): void {
  refreshErrors = EMPTY_REFRESH_ERRORS;
  notifyErrors();
  activeToast?.dismiss();
  activeToast = null;
}

export function reportRefreshError(module: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  refreshErrors = [...refreshErrors, { module, message }];
  notifyErrors();
  activeToast?.dismiss();
  activeToast = toast({
    title: "Refresh fehlgeschlagen",
    description: refreshErrorLine(refreshErrors),
    variant: "destructive",
  });
}

/** Fängt einen 500 (oder jeden anderen Fehler) und zeigt Modul + Text. Der übrige Refresh läuft weiter. */
export async function guardModule(module: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    reportRefreshError(module, err);
  }
}

export function forceAnalyzeOnce(ticker: string, module: string, job: () => Promise<unknown>): Promise<void> {
  return forceGate.once(ticker, () => guardModule(module, job));
}

export function registerCrossModuleHandler(slot: CrossModuleSlot, handler: RefreshHandler): () => void {
  handlers[slot] = handler;
  return () => {
    if (handlers[slot] === handler) handlers[slot] = null;
  };
}

export function useCrossModuleHandler(slot: CrossModuleSlot, handler: RefreshHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => registerCrossModuleHandler(slot, () => ref.current()), [slot]);
}

export function writeResearcherScope(tab: string, region: string): void {
  try {
    sessionStorage.setItem(RESEARCHER_SCOPE_KEY, JSON.stringify({ tab, region }));
  } catch {
    /* privater Modus / SSR */
  }
}

type ResearcherTab = "macro" | "sectors" | "screener" | "capex";
type ResearcherRegion = "US" | "EU" | "ASIA";

function readResearcherScope(): { tab: ResearcherTab; region: ResearcherRegion } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(RESEARCHER_SCOPE_KEY) || "null") as { tab?: unknown; region?: unknown } | null;
    const tab: ResearcherTab = raw?.tab === "sectors" || raw?.tab === "screener" || raw?.tab === "capex" || raw?.tab === "macro"
      ? raw.tab
      : "macro";
    const region: ResearcherRegion = raw?.region === "EU" || raw?.region === "ASIA" || raw?.region === "US"
      ? raw.region
      : "US";
    return { tab, region };
  } catch {
    return { tab: "macro", region: "US" };
  }
}

async function readJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
}

async function postAnalyze(ticker: string): Promise<void> {
  const storage = safeLocalStorage();
  const peerOverrides = clampPeerOverrides(storage ? readOverrides(storage, ticker) : { add: [], remove: [] });
  const res = await apiRequest("POST", "/api/analyze", analyzePostBody({
    ticker,
    useLLM: false,
    force: true,
    peerOverrides,
  }), 120000);
  await readJson(res);
}

function analyzeTarget(): string {
  const fromPage = analyzeRefresh?.ticker().trim().toUpperCase() ?? "";
  if (fromPage) return fromPage;
  const storage = safeLocalStorage();
  return storage ? (readLastTicker(storage) ?? "").trim().toUpperCase() : "";
}

function portfolioTargets(): string[] {
  if (portfolioRefresh) {
    return portfolioRefresh.tickers().map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  }
  return loadPositionsFromStorage().map((position) => position.ticker.trim().toUpperCase()).filter(Boolean);
}

function moduleAndJob(ticker: string, analyzeTicker: string): { module: string; job: () => Promise<void> } {
  const analyzeAdapter = analyzeRefresh;
  const pageTicker = analyzeAdapter?.ticker().trim().toUpperCase() ?? "";
  if (analyzeAdapter && pageTicker === ticker) {
    return { module: "analyze", job: async () => { await analyzeAdapter.run(ticker); } };
  }
  const portfolioAdapter = portfolioRefresh;
  const held = portfolioAdapter?.tickers().map((item) => item.trim().toUpperCase()) ?? [];
  if (portfolioAdapter && held.includes(ticker)) {
    return { module: "Portfolio", job: () => portfolioAdapter.fetchTicker(ticker) };
  }
  const module = ticker === analyzeTicker ? "analyze" : "Portfolio";
  return { module, job: () => postAnalyze(ticker) };
}

/** Vor den parallelen Query-Funktionen: ein Claim pro Ticker. Der erste Claim gewinnt. */
function seedForceAnalyzes(): void {
  const analyzeTicker = analyzeTarget();
  const tickers = new Set<string>();
  if (analyzeTicker) tickers.add(analyzeTicker);
  for (const ticker of portfolioTargets()) tickers.add(ticker);
  Array.from(tickers).forEach((ticker) => {
    const planned = moduleAndJob(ticker, analyzeTicker);
    void forceAnalyzeOnce(ticker, planned.module, planned.job);
  });
}

async function postResearcher(tab: ResearcherTab, region: ResearcherRegion, force: boolean): Promise<unknown> {
  const body: {
    region: ResearcherRegion;
    force: boolean;
    marketCapMin?: number;
    marketCapMax?: number;
    peMax?: number;
    revenueGrowthMin?: number;
  } = { region, force };
  if (tab === "screener") {
    body.marketCapMin = 1000;
    body.marketCapMax = 500000;
    body.peMax = 30;
    body.revenueGrowthMin = 5;
  }
  const res = await apiRequest("POST", `/api/researcher/${tab}`, body, 120000);
  return readJson(res);
}

async function refreshAnalyzeViaApi(): Promise<void> {
  const ticker = analyzeTarget();
  if (!ticker) return;
  const planned = moduleAndJob(ticker, ticker);
  await forceAnalyzeOnce(ticker, planned.module, planned.job);
}

async function refreshResearcherViaApi(): Promise<void> {
  const scope = readResearcherScope();
  await guardModule(scope.tab, () => postResearcher(scope.tab, scope.region, true));
  if (scope.tab !== "capex") await guardModule("capex", () => postResearcher("capex", scope.region, true));
  await guardModule("fiscal", async () => {
    const fiscal = await apiRequest("GET", "/api/researcher/fiscal-programs");
    await readJson(fiscal);
  });
}

async function refreshPortfolioViaApi(): Promise<void> {
  const tickers = portfolioTargets();
  const analyzeTicker = analyzeTarget();
  await Promise.all(tickers.map((ticker) => {
    const planned = moduleAndJob(ticker, analyzeTicker);
    return forceAnalyzeOnce(ticker, planned.module, planned.job);
  }));
  await guardModule("Portfolio", async () => {
    const policy = loadPolicyFromStorage();
    const benchmark = (policy.benchmark || "SPY").trim().toUpperCase() || "SPY";
    const ohlcvTickers = Array.from(new Set([benchmark, ...tickers])).slice(0, 12);
    if (ohlcvTickers.length === 0) return;
    const from = timeframeCutoffIso("1Y");
    const res = await apiRequest(
      "GET",
      `/api/ohlcv?tickers=${encodeURIComponent(ohlcvTickers.join(","))}&from=${encodeURIComponent(from)}`,
    );
    await readJson(res);
  });
}

export async function runCrossModuleSlot(slot: CrossModuleSlot): Promise<CrossModuleRefreshResult> {
  if (!armed) return { phase: "idle", slot };
  const handler = handlers[slot];
  if (handler) {
    await handler();
    return { phase: "ready", slot };
  }
  switch (slot) {
    case "analyze":
      await refreshAnalyzeViaApi();
      return { phase: "ready", slot };
    case "researcher":
      await refreshResearcherViaApi();
      return { phase: "ready", slot };
    case "portfolio":
      await refreshPortfolioViaApi();
      return { phase: "ready", slot };
    default: {
      const unreachable: never = slot;
      return unreachable;
    }
  }
}

export function invalidateCrossModuleQueries(client: QueryClient): Promise<void> {
  if (inFlight) return inFlight;
  armed = true;
  setPending(true);
  clearRefreshErrors();
  forceGate = createForceAnalyzeGate();
  seedForceAnalyzes();
  inFlight = Promise.all(
    crossModuleQueryKeyList().map((queryKey) => client.invalidateQueries({ queryKey: [...queryKey] })),
  ).then(() => undefined).finally(() => {
    inFlight = null;
    setPending(false);
  });
  return inFlight;
}

export { CROSS_MODULE_QUERY_KEYS, CROSS_MODULE_INITIAL_UPDATED_AT };
