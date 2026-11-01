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
  crossModuleQueryKeyList,
  type CrossModuleSlot,
} from "@shared/cross-module-refresh";
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

async function readJson(res: Response, label: string): Promise<unknown> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
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
  return readJson(res, `researcher/${tab}`);
}

async function refreshAnalyzeViaApi(): Promise<void> {
  const storage = safeLocalStorage();
  const ticker = storage ? readLastTicker(storage) : null;
  if (!ticker) return;
  const peerOverrides = clampPeerOverrides(storage ? readOverrides(storage, ticker) : { add: [], remove: [] });
  const res = await apiRequest("POST", "/api/analyze", analyzePostBody({
    ticker,
    useLLM: false,
    force: true,
    peerOverrides,
  }), 120000);
  await readJson(res, "analyze");
}

async function refreshResearcherViaApi(): Promise<void> {
  const scope = readResearcherScope();
  await postResearcher(scope.tab, scope.region, true);
  if (scope.tab !== "capex") await postResearcher("capex", scope.region, true);
  const fiscal = await apiRequest("GET", "/api/researcher/fiscal-programs");
  await readJson(fiscal, "fiscal-programs");
}

async function refreshPortfolioViaApi(): Promise<void> {
  const positions = loadPositionsFromStorage();
  const policy = loadPolicyFromStorage();
  const tickers = Array.from(new Set(positions.map((position) => position.ticker.toUpperCase()).filter(Boolean)));
  await Promise.all(tickers.map(async (ticker) => {
    const res = await apiRequest("POST", "/api/analyze", { ticker, useLLM: false, force: true }, 120000);
    await readJson(res, "analyze");
  }));
  const benchmark = (policy.benchmark || "SPY").trim().toUpperCase() || "SPY";
  const ohlcvTickers = Array.from(new Set([benchmark, ...tickers])).slice(0, 12);
  if (ohlcvTickers.length === 0) return;
  const from = timeframeCutoffIso("1Y");
  const res = await apiRequest(
    "GET",
    `/api/ohlcv?tickers=${encodeURIComponent(ohlcvTickers.join(","))}&from=${encodeURIComponent(from)}`,
  );
  await readJson(res, "ohlcv");
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
  inFlight = Promise.all(
    crossModuleQueryKeyList().map((queryKey) => client.invalidateQueries({ queryKey: [...queryKey] })),
  ).then(() => undefined).finally(() => {
    inFlight = null;
    setPending(false);
  });
  return inFlight;
}

export { CROSS_MODULE_QUERY_KEYS, CROSS_MODULE_INITIAL_UPDATED_AT };
