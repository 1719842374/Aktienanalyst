/**
 * KI-Abruf fuer den Politikkanal. Der Prompt enthaelt kein Gesetz und keine
 * Person. Gemessene Serien bleiben unangetastet. Ohne OPENROUTER_API_KEY
 * kommt eine leere Liste zurueck.
 */
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { fetchDefiTvlSnapshot, fetchStablecoinMarketSnapshot } from "./stablecoin-liquidity";
import {
  activeTreasuryBuybackCapBn,
  evidencedReserveShares,
  parsePolicyInstruments,
  priceInInstrument,
  statuteContribution,
  type PolicyInstrument,
} from "./policy-instruments";

const SCHEMA = "v2";
const mem = new Map<string, PolicyScanResult>();

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

function cacheKey(jurisdiction: string, asOf: string): string {
  return `policy_scan__${jurisdiction}__${SCHEMA}__${asOf}`;
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
  return `Heute ist ${m.asOf}. Jurisdiktion: ${m.jurisdiction}.
Du suchst Krypto-Liquidität, nicht ein einzelnes Stablecoin-Produkt.
Welche Gesetze, Fiskalprogramme und Schuldenoperationen ändern heute die Liquidität, die Krypto erreicht: On-Chain-Liquidität, Stablecoin-Angebot, Dollar-Liquidität oder die lange Rendite.
Jede Wirkung bekommt channels.cryptoLiquidity = "up", "down" oder "unclear".
Stablecoins sind nur eine gemessene Schicht. Ein Programm, das lange Kapitalmarktzinsen senkt, ist fiscal_program mit channels.longYield = "down" und channels.cryptoLiquidity passend zur Liquiditätswirkung.
Keine Personennamen als Schluessel. officeHolder ist optionaler Anzeigetext. Die Regel haengt am Amt.
Ein abgelehntes oder ausgelaufenes Vorhaben hat status rejected oder expired.
Treasury-Kaeufe langer Anleihen sind debt_operation, office treasury, channels.duration = "easing", magnitude.kind = "cap_bn" in Milliarden.
Reserveanteile nur mit Beleg: magnitude.kind = "share", issuer USDT oder USDC, Wert 0 bis 1.
Gesetzes-Score nur mit Beleg: magnitude.kind = "score", Wert 0 bis 1.5.
expectedMoveBp ist die erwartete Aenderung der 10-Jahres-Rendite in Basispunkten, negativ wenn die Rendite sinkt.
halfLifeDays nur wenn kein decisionDate bekannt ist.

Gemessene Serien, nicht veraendern:
- DeFi-TVL USD, alle Ketten: ${m.defiTvlUsd ?? "unbekannt"}
- DeFi-TVL Aenderung 30 Tage USD: ${m.defiTvlChange30dUsd ?? "unbekannt"}
- Stablecoin-Marktkapitalisierung USD: ${m.stablecoinMcapUsd ?? "unbekannt"}
- Stablecoin-Aenderung 30 Tage USD: ${m.mcapChange30dUsd ?? "unbekannt"}
- TGA Mrd. USD: ${m.tgaBn ?? "unbekannt"}
- 10Y-Rendite Prozent: ${m.dgs10 ?? "unbekannt"}
- M2 Mrd. USD: ${m.m2Bn ?? "unbekannt"}

JSON:
{"instruments":[{"id":"kurz","jurisdiction":"${m.jurisdiction}","office":"treasury|central_bank|legislature|regulator","instrumentType":"statute|fiscal_program|debt_operation","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","officeHolder":"","effectiveFrom":"YYYY-MM-DD","effectiveTo":"YYYY-MM-DD","decisionDate":"YYYY-MM-DD","halfLifeDays":90,"expectedMoveBp":-15,"channels":{"cryptoLiquidity":"up|down|unclear","tBillDemand":"up|down|unclear","longYield":"up|down|unclear","m2":"up|down|unclear","duration":"easing|tightening|neutral"},"magnitude":{"kind":"cap_bn|share|score|yield_bp","value":0,"unit":"","issuer":""},"evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}]}`;
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

export async function runPolicyScan(opts: { jurisdiction?: string; force?: boolean } = {}): Promise<PolicyScanResult> {
  const jurisdiction = (opts.jurisdiction || "US").toUpperCase();
  const measured = await loadMeasuredPolicyContext(jurisdiction);
  const key = cacheKey(jurisdiction, measured.asOf);
  if (!opts.force) {
    const hit = mem.get(key) ?? (diskResearcherGet(key) as PolicyScanResult | null);
    if (hit?.instruments) {
      mem.set(key, { ...hit, fromCache: true });
      return { ...hit, fromCache: true };
    }
  }
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
      ...emptyEffects,
      error: "OPENROUTER_API_KEY fehlt",
    };
  }
  const llm = await callLLMJson({
    prompt: buildPolicyScanPrompt(measured),
    maxTokens: 2200,
    temperature: 0.2,
    systemPrompt: "Du antwortest nur mit JSON. Erfinde keine Belege. Ohne URL und Datum kein Instrument. Keine fest verdrahteten Namen als Logik.",
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
      ...emptyEffects,
      error: "LLM-Abruf ohne JSON",
    };
  }
  const parsed = parsePolicyInstruments(llm.data);
  const computed = effectsFor(parsed.instruments, measured);
  const result: PolicyScanResult = {
    llmAvailable: true,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
    jurisdiction,
    measured: { ...measured, dgs10History: measured.dgs10History.slice(-5) },
    instruments: parsed.instruments,
    dropped: parsed.dropped,
    modelUsed: llm.modelUsed,
    ...computed,
  };
  mem.set(key, result);
  diskResearcherSet(key, result);
  return result;
}

/** Cap aus dem Tages-Cache. Ohne Scan bleibt der Twist aus. */
export function cachedTreasuryBuybackCapBn(jurisdiction = "US", asOf = new Date().toISOString().slice(0, 10)): number | null {
  const key = cacheKey(jurisdiction.toUpperCase(), asOf);
  const hit = mem.get(key) ?? (diskResearcherGet(key) as PolicyScanResult | null);
  const cap = hit?.effects?.treasuryBuybackCapBn;
  return typeof cap === "number" && Number.isFinite(cap) ? cap : null;
}
