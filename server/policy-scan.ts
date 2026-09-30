/**
 * KI-Abruf fuer Krypto-Regulierungen und den Liquiditaetstracker.
 * Aufruf, Cache und Force folgen dem Researcher (callLLMJson, gemeinsamer
 * OpenRouter-Client, Datei- plus Disk-Cache, 6h, force loescht den Cache).
 * Der Prompt enthaelt kein Gesetz und keine Person. Gemessene Serien bleiben
 * unangetastet. Ohne OPENROUTER_API_KEY kommt eine klare Fehlermeldung.
 */
import * as fs from "fs";
import * as path from "path";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  POLICY_SCAN_SYSTEM_PROMPT,
  buildPolicyScanPrompt,
  policyScanIsCacheable,
} from "./crypto-regulation-llm";
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import { fetchDefiTvlSnapshot, fetchStablecoinMarketSnapshot } from "./stablecoin-liquidity";
import {
  activeTreasuryBuybackCapBn,
  evidencedReserveShares,
  parsePolicyInstruments,
  parseRegulationNotes,
  priceInInstrument,
  statuteContribution,
  type PolicyInstrument,
  type RegulationNote,
} from "./policy-instruments";

export { buildPolicyScanPrompt, policyScanIsCacheable };

const SCHEMA = "v5";
const CACHE_TAB = "crypto_regulation";
const CACHE_DIR = path.join(process.cwd(), ".cache", "researcher");
const RESEARCHER_TTL_MIN = 60 * 6;
const inFlight = new Map<string, Promise<PolicyScanResult>>();

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function safeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 80);
}

function researcherDiskKey(tab: string, params: string): string {
  return `${safeKey(tab)}__${safeKey(params)}`;
}

function cacheParams(jurisdiction: string): string {
  return `${SCHEMA}__${jurisdiction}`;
}

function deletePolicyCache(params: string): void {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(CACHE_TAB)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
  try { diskResearcherDelete(researcherDiskKey(CACHE_TAB, params)); } catch {}
}

function readPolicyCache(params: string): PolicyScanResult | null {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(CACHE_TAB)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as PolicyScanResult & { _cachedAt?: string; _cacheAge?: number };
      const cachedAt = parsed?._cachedAt ? new Date(parsed._cachedAt).getTime() : 0;
      const ageMin = (Date.now() - cachedAt) / 60000;
      if (ageMin < RESEARCHER_TTL_MIN && policyScanIsCacheable(parsed)) {
        parsed._cacheAge = Math.round(ageMin);
        return parsed;
      }
    }
  } catch {}
  const fromDisk = diskResearcherGet(researcherDiskKey(CACHE_TAB, params)) as (PolicyScanResult & { _cacheAge?: number }) | null;
  if (fromDisk && policyScanIsCacheable(fromDisk)) {
    try {
      const file = path.join(CACHE_DIR, `${safeKey(CACHE_TAB)}__${safeKey(params)}.json`);
      fs.writeFileSync(file, JSON.stringify(fromDisk, null, 2));
    } catch {}
    return fromDisk;
  }
  return null;
}

function writePolicyCache(params: string, data: PolicyScanResult): void {
  const payload = { ...data, fromCache: false, _cachedAt: new Date().toISOString() };
  try {
    const file = path.join(CACHE_DIR, `${safeKey(CACHE_TAB)}__${safeKey(params)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  } catch {}
  try { diskResearcherSet(researcherDiskKey(CACHE_TAB, params), payload); } catch {}
}

export interface MeasuredPolicyContext {
  asOf: string;
  jurisdiction: string;
  stablecoinMcapUsd: number | null;
  mcapChange30dUsd: number | null;
  usdtMcapUsd: number | null;
  usdcMcapUsd: number | null;
  defiTvlUsd: number | null;
  defiTvlChange30dUsd: number | null;
  tgaBn: number | null;
  dgs10: number | null;
  dgs10History: { date: string; value: number }[];
  m2Bn: number | null;
}

export interface PolicyScanResult {
  llmAvailable: boolean;
  fromCache: boolean;
  fetchedAt: string;
  jurisdiction: string;
  measured: MeasuredPolicyContext;
  instruments: PolicyInstrument[];
  /** Anzeige. Geht nicht in den Score. */
  regulations: RegulationNote[];
  dropped: number;
  /** Wie beim Researcher: leere oder abgelehnte Abrufe werden nicht gecacht. */
  _fallback?: boolean;
  modelUsed: string | null;
  /** Kurztext der Analyse. Kein Score und keine gemessene Zahl. */
  summary: string | null;
  effects: {
    treasuryBuybackCapBn: number | null;
    treasuryDurationActive: boolean;
    statuteScore: number | null;
    statuteResidual: number | null;
    statuteContribution: number;
    reserveShares: { tether: number | null; usdc: number | null; evidenced: boolean };
    tBillDemandUsd: number | null;
  };
  priced: {
    id: string;
    pricedInPct: number | null;
    halfLifeDays: number | null;
    residual: number | null;
    clockStart: string | null;
  }[];
  error?: string;
}

async function fredLatest(series: string, days: number): Promise<{ date: string; value: number }[]> {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  const cosd = start.toISOString().slice(0, 10);
  try {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${cosd}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const out: { date: string; value: number }[] = [];
    for (const line of text.trim().split(/\r?\n/).slice(1)) {
      const [date, raw] = line.split(",");
      if (!date || raw == null || raw.trim() === ".") continue;
      const value = Number(raw.trim());
      if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && Number.isFinite(value)) {
        out.push({ date: date.trim(), value });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadMeasuredPolicyContext(jurisdiction: string): Promise<MeasuredPolicyContext> {
  const asOf = new Date().toISOString().slice(0, 10);
  const [stable, tvl, dgs, tga, m2] = await Promise.all([
    fetchStablecoinMarketSnapshot().catch(() => null),
    fetchDefiTvlSnapshot().catch(() => null),
    fredLatest("DGS10", 800),
    fredLatest("WTREGEN", 120),
    fredLatest("M2SL", 800),
  ]);
  const mcap = stable?.totalMarketCapUsd ?? null;
  const prev = stable?.totalMarketCapPrevMonthUsd ?? null;
  return {
    asOf,
    jurisdiction,
    stablecoinMcapUsd: mcap,
    mcapChange30dUsd: mcap != null && prev != null ? mcap - prev : null,
    usdtMcapUsd: stable?.usdt?.circulatingUsd ?? null,
    usdcMcapUsd: stable?.usdc?.circulatingUsd ?? null,
    defiTvlUsd: tvl?.tvlUsd ?? null,
    defiTvlChange30dUsd: tvl?.change30dUsd ?? null,
    tgaBn: tga.length ? tga[tga.length - 1].value / 1000 : null,
    dgs10: dgs.length ? dgs[dgs.length - 1].value : null,
    dgs10History: dgs,
    m2Bn: m2.length ? m2[m2.length - 1].value : null,
  };
}

function observedMoveBp(history: { date: string; value: number }[], evidenceDate: string): number | null {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const prior = [...history].reverse().find(p => p.date <= evidenceDate) ?? history[0];
  if (!prior || prior.date === latest.date) return null;
  return Math.round((latest.value - prior.value) * 1000) / 10;
}

function effectsFor(instruments: PolicyInstrument[], measured: MeasuredPolicyContext) {
  const asOf = measured.asOf;
  const cap = activeTreasuryBuybackCapBn(instruments, asOf);
  const shares = evidencedReserveShares(instruments, asOf);
  const observedFor = (inst: PolicyInstrument) => {
    const ev = inst.evidence.map(e => e.date).sort()[0];
    return ev ? observedMoveBp(measured.dgs10History, ev) : null;
  };
  const statute = statuteContribution(instruments, asOf, observedFor);
  const usdt = measured.usdtMcapUsd;
  const usdc = measured.usdcMcapUsd;
  const weightBase = usdt != null && usdc != null ? usdt + usdc : 0;
  let tBillDemandUsd: number | null = null;
  if (
    measured.mcapChange30dUsd != null &&
    shares.tether != null &&
    shares.usdc != null &&
    weightBase > 0
  ) {
    const weightT = usdt! / weightBase;
    const weightC = usdc! / weightBase;
    tBillDemandUsd = measured.mcapChange30dUsd * (shares.tether * weightT + shares.usdc * weightC);
  }
  const priced = instruments.map(inst => {
    const ev = inst.evidence.map(e => e.date).sort()[0];
    const move = ev ? observedMoveBp(measured.dgs10History, ev) : null;
    const row = priceInInstrument(inst, asOf, move);
    return { id: inst.id, ...row };
  });
  return {
    effects: {
      treasuryBuybackCapBn: cap,
      treasuryDurationActive: cap != null && cap >= 4,
      statuteScore: statute.score,
      statuteResidual: statute.residual,
      statuteContribution: statute.contribution,
      reserveShares: shares,
      tBillDemandUsd,
    },
    priced,
  };
}

async function buildPolicyScan(jurisdiction: string): Promise<PolicyScanResult> {
  const measured = await loadMeasuredPolicyContext(jurisdiction);
  const emptyEffects = effectsFor([], measured);
  if (!isLLMAvailable()) {
    return {
      llmAvailable: false,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
      jurisdiction,
      measured,
      instruments: [],
      regulations: [],
      dropped: 0,
      modelUsed: null,
      summary: null,
      ...emptyEffects,
      error: "OPENROUTER_API_KEY fehlt",
      _fallback: true,
    };
  }
  // Gleicher Client, dieselbe Modellkette und dieselben OpenRouter-Header
  // wie der Researcher: callLLMJson -> getClient in llm-openrouter.ts.
  const llm = await callLLMJson({
    prompt: buildPolicyScanPrompt(measured),
    maxTokens: 2200,
    temperature: 0.2,
    systemPrompt: POLICY_SCAN_SYSTEM_PROMPT,
  });
  if (!llm) {
    return {
      llmAvailable: true,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
      jurisdiction,
      measured,
      instruments: [],
      regulations: [],
      dropped: 0,
      modelUsed: null,
      summary: null,
      ...emptyEffects,
      error: "LLM-Abruf ohne JSON",
      _fallback: true,
    };
  }
  const summaryRaw = llm.data && typeof llm.data === "object" ? (llm.data as { summary?: unknown }).summary : null;
  const summary = typeof summaryRaw === "string" && summaryRaw.trim() ? summaryRaw.trim().slice(0, 800) : null;
  const notes = parseRegulationNotes(llm.data);
  const parsed = parsePolicyInstruments(llm.data);
  const computed = effectsFor(parsed.instruments, measured);
  const empty = notes.regulations.length === 0 && parsed.instruments.length === 0;
  const result: PolicyScanResult = {
    llmAvailable: true,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
    jurisdiction,
    measured: { ...measured, dgs10History: measured.dgs10History.slice(-5) },
    instruments: parsed.instruments,
    regulations: notes.regulations,
    dropped: parsed.dropped,
    modelUsed: llm.modelUsed,
    summary,
    ...computed,
  };
  if (!empty) return result;
  return {
    ...result,
    _fallback: true,
    ...(summary ? {} : { error: "LLM-Abruf ohne Krypto-Regulierungen" }),
  };
}

export async function runPolicyScan(opts: { jurisdiction?: string; force?: boolean } = {}): Promise<PolicyScanResult> {
  const jurisdiction = (opts.jurisdiction || "US").toUpperCase();
  const params = cacheParams(jurisdiction);
  if (opts.force) {
    deletePolicyCache(params);
    console.log("[POLICY-SCAN] cache invalidated (refresh/force)");
  } else {
    const hit = readPolicyCache(params);
    if (hit) {
      console.log(`[POLICY-SCAN] cache HIT age=${(hit as PolicyScanResult & { _cacheAge?: number })._cacheAge ?? "?"}min`);
      return { ...hit, fromCache: true };
    }
  }

  let pending = opts.force ? undefined : inFlight.get(params);
  if (!pending) {
    console.log("[POLICY-SCAN] building");
    pending = buildPolicyScan(jurisdiction)
      .then((result) => {
        if (policyScanIsCacheable(result)) writePolicyCache(params, result);
        return result;
      })
      .finally(() => {
        if (inFlight.get(params) === pending) inFlight.delete(params);
      });
    inFlight.set(params, pending);
  } else {
    console.log(`[POLICY-SCAN] reusing in-flight ${params}`);
  }
  return pending;
}

/** Cap aus dem Researcher-Cache. Ohne erfolgreichen Scan bleibt der Twist aus. */
export function cachedTreasuryBuybackCapBn(jurisdiction = "US", _asOf = new Date().toISOString().slice(0, 10)): number | null {
  const hit = readPolicyCache(cacheParams(jurisdiction.toUpperCase()));
  const cap = hit?.effects?.treasuryBuybackCapBn;
  return typeof cap === "number" && Number.isFinite(cap) ? cap : null;
}
