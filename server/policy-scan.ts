/**
 * KI-Abruf fuer Sektion 14. Der Server misst die fuenf FRED-Serien zuerst,
 * inklusive Richtung ueber ein und zwei Jahre. Das Modell schreibt danach.
 * Aufruf, Cache und Force folgen dem Researcher (callLLMJson, gemeinsamer
 * OpenRouter-Client, Datei- plus Disk-Cache, 6h, force loescht den Cache).
 * Ohne OPENROUTER_API_KEY kommt eine klare Fehlermeldung.
 */
import * as fs from "fs";
import * as path from "path";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  POLICY_SCAN_SYSTEM_PROMPT,
  buildPolicyNote,
  buildPolicyScanPrompt,
  policyScanIsCacheable,
  withNoticeFallback,
  type PolicyNote,
} from "./crypto-regulation-llm";
import {
  applyNoticeTitles,
  fetchOfficialNotices,
  mergeByTitle,
  noticesToRegulationPayload,
} from "./crypto-regulation-sources";
import { allowedKeyEventEvidence, germanNoticeBody, isOfficialEvidenceUrl, usableEventSentences } from "../shared/policy-event-copy";
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import {
  FRED_LOOKBACK_DAYS,
  allowedMeasuredNumbers,
  proseNumbersAreMeasured,
  readingFromSeries,
  type PolicyWindows,
} from "./policy-scan-windows";
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

const SCHEMA = "v10";
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
  tgaBn: number | null;
  dgs10: number | null;
  dgs10History: { date: string; value: number }[];
  policyRate: number | null;
  realYield10y: number | null;
  m2Bn: number | null;
  windows: PolicyWindows;
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
  /** Analystennotiz. Zahlen darin stammen aus windows, nicht aus dem Modell. */
  summary: string | null;
  note: PolicyNote;
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
  const [dgs, tga, m2, funds, realYield] = await Promise.all([
    fredLatest("DGS10", FRED_LOOKBACK_DAYS),
    fredLatest("WTREGEN", FRED_LOOKBACK_DAYS),
    fredLatest("M2SL", FRED_LOOKBACK_DAYS),
    fredLatest("DFF", FRED_LOOKBACK_DAYS),
    fredLatest("DFII10", FRED_LOOKBACK_DAYS),
  ]);
  const windows: PolicyWindows = {
    policyRate: readingFromSeries(funds, asOf),
    realYield10y: readingFromSeries(realYield, asOf),
    dgs10: readingFromSeries(dgs, asOf),
    m2Bn: readingFromSeries(m2, asOf),
    tgaBn: readingFromSeries(tga, asOf, value => value / 1000),
  };
  return {
    asOf,
    jurisdiction,
    tgaBn: windows.tgaBn.latest,
    dgs10: windows.dgs10.latest,
    dgs10History: dgs,
    policyRate: windows.policyRate.latest,
    realYield10y: windows.realYield10y.latest,
    m2Bn: windows.m2Bn.latest,
    windows,
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
  // Stablecoin-Marktkapitalisierung ist kein Zufluss. Ohne belegten Betrag bleibt die Nachfrage leer.
  const tBillDemandUsd: number | null = null;
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

function publicMeasured(measured: MeasuredPolicyContext): MeasuredPolicyContext {
  return { ...measured, dgs10History: measured.dgs10History.slice(-5) };
}

function scrubModelRegulationNotes(
  regulations: RegulationNote[],
  measured: MeasuredPolicyContext,
): RegulationNote[] {
  const allowed = allowedMeasuredNumbers(measured.windows);
  const kept: RegulationNote[] = [];
  for (const reg of regulations) {
    const evidence = allowedKeyEventEvidence(reg.evidence);
    if (evidence.length === 0) continue;
    let note = usableEventSentences(reg.note);
    if (note && !proseNumbersAreMeasured(note, allowed)) note = null;
    if (!note && evidence.some(item => isOfficialEvidenceUrl(item.url))) {
      note = germanNoticeBody(reg.title, reg.channels);
    }
    kept.push({ ...reg, evidence, ...(note ? { note } : {}) });
  }
  return kept;
}

function noteFromModel(measured: MeasuredPolicyContext, model: Record<string, unknown> | null, regulationCount: number): PolicyNote {
  const built = buildPolicyNote(model, measured.windows);
  if (built.summarySource === "measured" && regulationCount > 0) {
    return { ...built.note, summary: withNoticeFallback(built.note.summary, regulationCount) };
  }
  return built.note;
}

async function buildPolicyScan(jurisdiction: string): Promise<PolicyScanResult> {
  const measured = await loadMeasuredPolicyContext(jurisdiction);
  const emptyEffects = effectsFor([], measured);
  const notices = await fetchOfficialNotices(jurisdiction, measured.asOf);
  const noticeNotes = scrubModelRegulationNotes(
    parseRegulationNotes(noticesToRegulationPayload(notices, jurisdiction)).regulations,
    measured,
  );
  const promptInput = {
    asOf: measured.asOf,
    jurisdiction: measured.jurisdiction,
    ...measured.windows,
  };
  if (!isLLMAvailable()) {
    const note = noteFromModel(measured, null, noticeNotes.length);
    return {
      llmAvailable: false,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
      jurisdiction,
      measured: publicMeasured(measured),
      instruments: [],
      regulations: noticeNotes,
      dropped: 0,
      modelUsed: null,
      summary: note.summary,
      note,
      ...emptyEffects,
      error: "OPENROUTER_API_KEY fehlt",
      _fallback: true,
    };
  }
  // Gleicher Client und dieselbe Modellkette wie der Researcher, plus
  // OpenRouter-Websuche nur fuer diesen Abruf.
  const llm = await callLLMJson({
    prompt: buildPolicyScanPrompt(promptInput, notices),
    maxTokens: 2800,
    temperature: 0.2,
    systemPrompt: POLICY_SCAN_SYSTEM_PROMPT,
    online: true,
  });
  if (!llm) {
    const note = noteFromModel(measured, null, noticeNotes.length);
    return {
      llmAvailable: true,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
      jurisdiction,
      measured: publicMeasured(measured),
      instruments: [],
      regulations: noticeNotes,
      dropped: 0,
      modelUsed: null,
      summary: note.summary,
      note,
      ...emptyEffects,
      ...(noticeNotes.length > 0 ? {} : { error: "LLM-Abruf ohne JSON", _fallback: true as const }),
    };
  }
  const model = llm.data && typeof llm.data === "object" ? llm.data as Record<string, unknown> : null;
  const notes = parseRegulationNotes(model);
  const regulations = scrubModelRegulationNotes(
    mergeByTitle(applyNoticeTitles(notes.regulations, notices), noticeNotes, 8),
    measured,
  );
  const note = noteFromModel(measured, model, regulations.length);
  const parsed = parsePolicyInstruments(model);
  parsed.instruments = applyNoticeTitles(parsed.instruments, notices).flatMap(inst => {
    const evidence = allowedKeyEventEvidence(inst.evidence);
    return evidence.length === 0 ? [] : [{ ...inst, evidence }];
  });
  const computed = effectsFor(parsed.instruments, measured);
  const empty = regulations.length === 0 && parsed.instruments.length === 0;
  const result: PolicyScanResult = {
    llmAvailable: true,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
    jurisdiction,
    measured: publicMeasured(measured),
    instruments: parsed.instruments,
    regulations,
    dropped: parsed.dropped,
    modelUsed: llm.modelUsed,
    summary: note.summary,
    note,
    ...computed,
  };
  if (!empty) return result;
  return {
    ...result,
    _fallback: true,
    ...(note.summary ? {} : { error: "LLM-Abruf ohne Krypto-Regulierungen" }),
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
