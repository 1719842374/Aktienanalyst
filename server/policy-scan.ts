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
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import { fetchDefiTvlSnapshot, fetchStablecoinMarketSnapshot } from "./stablecoin-liquidity";
import {
  activeTreasuryBuybackCapBn,
  evidencedReserveShares,
  parsePolicyInstruments,
  priceInInstrument,
  statuteContribution,
  type PolicyInstrument,
} from "./policy-instruments";

const SCHEMA = "v4";
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
      if (ageMin < RESEARCHER_TTL_MIN && Array.isArray(parsed.instruments) && !parsed.error && "summary" in parsed) {
        parsed._cacheAge = Math.round(ageMin);
        return parsed;
      }
    }
  } catch {}
  const fromDisk = diskResearcherGet(researcherDiskKey(CACHE_TAB, params)) as (PolicyScanResult & { _cacheAge?: number }) | null;
  if (fromDisk && Array.isArray(fromDisk.instruments) && !fromDisk.error && "summary" in fromDisk) {
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
  dropped: number;
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

export function buildPolicyScanPrompt(measured: MeasuredPolicyContext): string {
  const m = measured;
  return `Heute ist ${m.asOf}. Jurisdiktion: ${m.jurisdiction}. Thema: Krypto-Liquidität.
Zwei Aufgaben, nichts anderes.

1. Krypto-Regulierungen.
Nenne nur Gesetze und Regeln, die Krypto-Liquidität ändern. Amt ist legislature oder regulator. instrumentType ist statute.
Status nur proposed, advanced, enacted, implementing, rejected, expired oder uncertain. Ein unbekannter Status oder ein Eintrag ohne https-Beleg und Datum wird verworfen.
Keine Personennamen als Schlüssel. officeHolder ist optionaler Anzeigetext. Die Regel hängt am Amt.
Kein Gesetzesname aus dem Gedächtnis ohne Quelle. Erfinde keine Belege.

2. Liquiditätstracker.
Diese Serien sind gemessen. Erfinde sie nicht und überschreibe sie nicht. Gib sie nicht als eigene Zahlen zurück.
- DeFi-TVL USD, alle Ketten: ${m.defiTvlUsd ?? "unbekannt"}
- DeFi-TVL Änderung 30 Tage USD: ${m.defiTvlChange30dUsd ?? "unbekannt"}
- Stablecoin-Marktkapitalisierung USD: ${m.stablecoinMcapUsd ?? "unbekannt"}
- Stablecoin-Änderung 30 Tage USD: ${m.mcapChange30dUsd ?? "unbekannt"}
- TGA Mrd. USD: ${m.tgaBn ?? "unbekannt"}
- M2 Mrd. USD: ${m.m2Bn ?? "unbekannt"}
- lange Rendite, 10Y Prozent: ${m.dgs10 ?? "unbekannt"}

Ein Instrument darf den Druck auf diesen Liquiditätstracker erklären. Dafür nur die Kanäle cryptoLiquidity, m2, longYield und tBillDemand, jeweils up, down oder unclear.
Reserveanteile nur mit Beleg: magnitude.kind = "share", issuer USDT oder USDC, Wert 0 bis 1. Ohne Beleg bleibt der Anteil leer und geht nicht in die T-Bill-Nachfrage.
Gesetzes-Score nur mit Beleg: magnitude.kind = "score", Wert 0 bis 1.5. Ohne Beleg kein Score.
expectedMoveBp ist die erwartete Änderung der 10-Jahres-Rendite in Basispunkten, negativ wenn die Rendite sinkt.
halfLifeDays nur wenn kein decisionDate bekannt ist.
Ein abgelehntes oder ausgelaufenes Vorhaben hat status rejected oder expired.

Schreibe summary als zwei deutsche Sätze: welche Krypto-Regulierungen die Liquidität heute ändern. Ohne Beleg im instruments-Array keinen Gesetzesnamen als Tatsache.

JSON:
{"summary":"","instruments":[{"id":"kurz","jurisdiction":"${m.jurisdiction}","office":"legislature|regulator","instrumentType":"statute","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","officeHolder":"","effectiveFrom":"YYYY-MM-DD","effectiveTo":"YYYY-MM-DD","decisionDate":"YYYY-MM-DD","halfLifeDays":90,"expectedMoveBp":0,"channels":{"cryptoLiquidity":"up|down|unclear","tBillDemand":"up|down|unclear","longYield":"up|down|unclear","m2":"up|down|unclear"},"magnitude":{"kind":"share|score","value":0,"unit":"","issuer":""},"evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}]}`;
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
      dropped: 0,
      modelUsed: null,
      summary: null,
      ...emptyEffects,
      error: "OPENROUTER_API_KEY fehlt",
    };
  }
  // Gleicher Client, dieselbe Modellkette und dieselben OpenRouter-Header
  // wie der Researcher: callLLMJson -> getClient in llm-openrouter.ts.
  const llm = await callLLMJson({
    prompt: buildPolicyScanPrompt(measured),
    maxTokens: 2200,
    temperature: 0.2,
    systemPrompt: "Du antwortest nur mit JSON. Erfinde keine Belege und keine gemessenen Zahlen. Ohne URL und Datum kein Instrument.",
  });
  if (!llm) {
    return {
      llmAvailable: true,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
      jurisdiction,
      measured,
      instruments: [],
      dropped: 0,
      modelUsed: null,
      summary: null,
      ...emptyEffects,
      error: "LLM-Abruf ohne JSON",
    };
  }
  const summaryRaw = llm.data && typeof llm.data === "object" ? (llm.data as { summary?: unknown }).summary : null;
  const summary = typeof summaryRaw === "string" && summaryRaw.trim() ? summaryRaw.trim().slice(0, 800) : null;
  const parsed = parsePolicyInstruments(llm.data);
  const computed = effectsFor(parsed.instruments, measured);
  return {
    llmAvailable: true,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
    jurisdiction,
    measured: { ...measured, dgs10History: measured.dgs10History.slice(-5) },
    instruments: parsed.instruments,
    dropped: parsed.dropped,
    modelUsed: llm.modelUsed,
    summary,
    ...computed,
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
        if (result.llmAvailable && !result.error) writePolicyCache(params, result);
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
