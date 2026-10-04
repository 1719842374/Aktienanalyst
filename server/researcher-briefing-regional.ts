/**
 * Regional daily briefing (US, EU, ASIA).
 * Numbers come from a cached liquidity-index payload or stay null.
 * A region without its own source stays empty instead of copying the US text.
 * This module does not fetch and does not write the index cache.
 */

export type RegionId = "US" | "EU" | "ASIA";
export type Stance = "Vorsichtig" | "Neutral" | "Opportunistisch";
export type BriefingCategory = "Geldpolitik" | "Fiskalpolitik" | "Handel" | "Geopolitik" | "Sonstiges";
export type ChangeType = "NEW" | "ESCALATED" | "DIRECTION_FLIP" | "UNCHANGED";

export const BRIEFING_REGIONS: RegionId[] = ["US", "EU", "ASIA"];

export const BRIEFING_PROMPT_CORE =
  "Drei Regionsblöcke gleicher Felder. US-Zoll nicht als globales Event ohne EU- und Asia-Spillover-Zeile. Keine Personennamen als Score. Nur 2025–2026.";

export const REGION_FILTERS: Record<RegionId, { money: string; fiscal: string; trade: string }> = {
  US: {
    money: "Fed Δi / SOMA / EMG / V",
    fiscal: "QRA/TGA/Netto-Bills + Programme",
    trade: "USTR/Tariff",
  },
  EU: {
    money: "EZB DF-Satz / APP+PEPP Δ / M3 / V",
    fiscal: "Kommission EU-Bonds/Bills + DE Sondervermögen",
    trade: "CBAM, EU-Zölle, Vergeltung",
  },
  ASIA: {
    money: "BoJ Δi / JGB-Käufe / M2 / V",
    fiscal: "MoF JGB-Netto + JP/CN Stimulus",
    trade: "China export controls, JP/KR/TW semi, India tariff",
  },
};

const STANCES: Stance[] = ["Vorsichtig", "Neutral", "Opportunistisch"];
const POLICY = new Set<BriefingCategory>(["Geldpolitik", "Fiskalpolitik", "Handel"]);
const NO_TARIFF = "keine Tarifänderung seit gestern";

export interface RegionBrief {
  region: RegionId;
  stance: Stance;
  money: string;
  fiscal: string;
  trade: string;
  li: number | null;
  realRatePct: number | null;
  velocity: number | null;
  pricedIn: number | null;
}

export interface BriefingTopChange {
  region: RegionId;
  category: BriefingCategory;
  title: string;
  changeType: ChangeType;
  dcfImplications?: { waccDeltaBps: string; affectedSectors: string[] };
}

export interface DailyBriefingV2 {
  asOf: string;
  headline: string;
  cross: string[];
  regions: [RegionBrief, RegionBrief, RegionBrief];
  topChanges: BriefingTopChange[];
  tacticalStance: Stance;
  stanceRationale: string;
  singleRegionFocus?: boolean;
  _schema: "v2";
}

export interface RegionIndexNumbers {
  available: boolean;
  li: number | null;
  label: string | null;
  realRatePct: number | null;
  velocity: number | null;
  pricedIn: number | null;
  emg: number | null;
  liSigma: number | null;
  realRateSigma: number | null;
  moneyTrend: string | null;
  fiscalTrend: string | null;
}

export interface SourceEvent {
  region: RegionId;
  title: string;
  category?: string;
  severity?: string;
  description?: string;
  inflationImpact?: string;
  rateImpact?: string;
  equityImpact?: string;
  affectedSectors?: string[];
}

export interface PriorFingerprint {
  title: string;
  region: string;
  severity: string;
  inflationImpact: string;
  rateImpact: string;
  equityImpact: string;
}

export interface KeptEvent {
  region: RegionId;
  title: string;
  category: BriefingCategory;
  changeType: ChangeType;
  severity?: string;
  description?: string;
  affectedSectors?: string[];
  numeric?: boolean;
}

export interface ComposeRegionInput {
  region: RegionId;
  hasMacro: boolean;
  macroAction?: string | null;
  events: SourceEvent[];
  prior: PriorFingerprint[];
  index: unknown;
  priorIndex?: { li: number | null; realRatePct: number | null } | null;
}

export interface ComposeLlm {
  headline?: string;
  cross?: string[];
  regions?: Array<{ region?: string; stance?: string; money?: string; fiscal?: string; trade?: string }>;
  tacticalStance?: string;
  stanceRationale?: string;
}

function emptyIndex(): RegionIndexNumbers {
  return {
    available: false,
    li: null,
    label: null,
    realRatePct: null,
    velocity: null,
    pricedIn: null,
    emg: null,
    liSigma: null,
    realRateSigma: null,
    moneyTrend: null,
    fiscalTrend: null,
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function parseIndexCache(raw: unknown): RegionIndexNumbers {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const o = raw as Record<string, any>;
  const liNode = o.LI && typeof o.LI === "object" ? o.LI : null;
  if (o.available === false || liNode?.available === false) return emptyIndex();
  const li = num(o.li);
  const available = o.available === true || liNode?.available === true || li != null;
  if (!available) return emptyIndex();
  const stocks = o.stocks && typeof o.stocks === "object" ? o.stocks : {};
  return {
    available: true,
    li,
    label: typeof o.label === "string" ? o.label : null,
    realRatePct: num(o.realRatePct ?? o.r ?? stocks.realRatePct),
    velocity: num(o.velocity ?? o.V ?? stocks.velocity),
    pricedIn: num(o.pricedIn ?? o.pi ?? stocks.pricedIn),
    emg: num(o.emg ?? o.EMG ?? stocks.excessMoneyGrowth),
    liSigma: num(o.liSigma ?? o.sigma),
    realRateSigma: num(o.realRateSigma ?? o.rSigma),
    moneyTrend: typeof o.moneyTrend === "string" ? o.moneyTrend : null,
    fiscalTrend: typeof o.fiscalTrend === "string" ? o.fiscalTrend : null,
  };
}

export function indexPromptLine(region: RegionId, idx: RegionIndexNumbers): string {
  if (!idx.available) return `${region}: Index n/v`;
  const fmt = (n: number | null) => (n == null ? "n/v" : String(n));
  return `${region}: LI=${fmt(idx.li)} label=${idx.label ?? "n/v"} r=${fmt(idx.realRatePct)} V=${fmt(idx.velocity)} EMG=${fmt(idx.emg)} π=${fmt(idx.pricedIn)} moneyTrend=${idx.moneyTrend ?? "n/v"} fiscalTrend=${idx.fiscalTrend ?? "n/v"}`;
}

export function mapCategory(raw: string | undefined): BriefingCategory {
  const s = String(raw || "").toLowerCase();
  if (s.includes("handel") || s.includes("zoll") || s.includes("tariff") || s.includes("trade") || s.includes("cbam")) return "Handel";
  if (s.includes("fiskal") || s.includes("fiscal")) return "Fiskalpolitik";
  if (s.includes("geld") || s.includes("zentral") || s.includes("monetar")) return "Geldpolitik";
  if (s.includes("geo")) return "Geopolitik";
  return "Sonstiges";
}

function normalizeTitle(t: string): string {
  return String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function classifyChange(ev: SourceEvent, prior: PriorFingerprint[]): ChangeType | null {
  const key = `${ev.region}|${normalizeTitle(ev.title)}`;
  const last = prior.find(p => `${p.region}|${normalizeTitle(p.title)}` === key);
  const severity = ev.severity || "low";
  if (!last) return severity === "high" ? "NEW" : null;
  const flipped =
    last.inflationImpact !== (ev.inflationImpact || "neutral") ||
    last.rateImpact !== (ev.rateImpact || "neutral") ||
    last.equityImpact !== (ev.equityImpact || "neutral");
  const escalated = last.severity !== "high" && severity === "high";
  if (escalated) return "ESCALATED";
  if (flipped) return "DIRECTION_FLIP";
  return null;
}

function jumpEvents(
  region: RegionId,
  idx: RegionIndexNumbers,
  prior: { li: number | null; realRatePct: number | null } | null | undefined,
): KeptEvent[] {
  if (!idx.available || !prior) return [];
  const out: KeptEvent[] = [];
  const liJump =
    idx.li != null && prior.li != null && idx.liSigma != null && idx.liSigma > 0 &&
    Math.abs(idx.li - prior.li) / idx.liSigma >= 0.5;
  const rJump =
    idx.realRatePct != null && prior.realRatePct != null && idx.realRateSigma != null && idx.realRateSigma > 0 &&
    Math.abs(idx.realRatePct - prior.realRatePct) / idx.realRateSigma >= 0.5;
  if (liJump) {
    out.push({ region, category: "Geldpolitik", title: `${region} LI ≥0.5σ`, changeType: "NEW", numeric: true });
  }
  if (rJump) {
    out.push({ region, category: "Geldpolitik", title: `${region} r ≥0.5σ`, changeType: "NEW", numeric: true });
  }
  return out;
}

export function selectRegionalEvents(regions: ComposeRegionInput[]): KeptEvent[] {
  const kept: KeptEvent[] = [];
  for (const regionId of BRIEFING_REGIONS) {
    const src = regions.find(r => r.region === regionId);
    if (!src) continue;
    const idx = parseIndexCache(src.index);
    for (const ev of src.events || []) {
      if (ev.region !== regionId) continue;
      const category = mapCategory(ev.category);
      const changeType = classifyChange(ev, src.prior || []);
      if (changeType == null && !POLICY.has(category)) continue;
      kept.push({
        region: regionId,
        title: String(ev.title || ""),
        category,
        changeType: changeType ?? "UNCHANGED",
        severity: ev.severity,
        description: ev.description,
        affectedSectors: ev.affectedSectors,
      });
    }
    kept.push(...jumpEvents(regionId, idx, src.priorIndex));
  }
  return kept;
}

function severityRank(s?: string): number {
  if (s === "high") return 0;
  if (s === "medium") return 1;
  return 2;
}

function changeRank(c: ChangeType): number {
  if (c === "NEW") return 0;
  if (c === "ESCALATED") return 1;
  if (c === "DIRECTION_FLIP") return 2;
  return 3;
}

function compareKept(a: KeptEvent, b: KeptEvent): number {
  const numeric = Number(b.numeric === true) - Number(a.numeric === true);
  if (numeric) return numeric;
  const change = changeRank(a.changeType) - changeRank(b.changeType);
  if (change) return change;
  return severityRank(a.severity) - severityRank(b.severity);
}

function noneEvent(region: RegionId): KeptEvent {
  return { region, category: "Sonstiges", title: "none", changeType: "UNCHANGED" };
}

function toTopChange(e: KeptEvent): BriefingTopChange {
  const change: BriefingTopChange = {
    region: e.region,
    category: e.category,
    title: e.title,
    changeType: e.changeType,
  };
  if (e.title !== "none" && Array.isArray(e.affectedSectors) && e.affectedSectors.length) {
    change.dcfImplications = { waccDeltaBps: "n/v", affectedSectors: e.affectedSectors.slice(0, 6).map(String) };
  }
  return change;
}

export function applyTopChangeQuota(events: KeptEvent[]): BriefingTopChange[] {
  const buckets: Record<RegionId, KeptEvent[]> = { US: [], EU: [], ASIA: [] };
  for (const e of events) {
    if (!e || e.title === "none" || !buckets[e.region]) continue;
    buckets[e.region].push(e);
  }
  for (const region of BRIEFING_REGIONS) buckets[region].sort(compareKept);
  const limited: Record<RegionId, KeptEvent[]> = {
    US: buckets.US.slice(0, 3),
    EU: buckets.EU.slice(0, 5),
    ASIA: buckets.ASIA.slice(0, 5),
  };
  const chosen: KeptEvent[] = [];
  const used: Record<RegionId, number> = { US: 0, EU: 0, ASIA: 0 };
  const take = (region: RegionId): boolean => {
    if (chosen.length >= 6) return false;
    const next = limited[region][used[region]];
    if (!next) return false;
    chosen.push(next);
    used[region] += 1;
    return true;
  };
  for (const region of BRIEFING_REGIONS) {
    if (!take(region)) chosen.push(noneEvent(region));
  }
  let guard = 0;
  while (chosen.length < 6 && guard < 24) {
    guard++;
    let added = false;
    for (const region of BRIEFING_REGIONS) {
      if (chosen.length >= 6) break;
      if (chosen.some(c => c.region === region && c.title === "none")) continue;
      if (take(region)) added = true;
    }
    if (!added) break;
  }
  return chosen.slice(0, 6).map(toTopChange);
}

export function headlineOk(headline: string, singleRegionFocus = false): boolean {
  if (singleRegionFocus) return true;
  const text = headline || "";
  if (/cross/i.test(text)) return true;
  const found = new Set<string>();
  if (/\bUS\b/.test(text)) found.add("US");
  if (/\bEU\b|\bEZ\b/.test(text)) found.add("EU");
  if (/\bASIA\b/.test(text)) found.add("ASIA");
  return found.size >= 2;
}

export function briefingV2Failures(b: DailyBriefingV2): string[] {
  const errors: string[] = [];
  if (!Array.isArray(b.regions) || b.regions.length !== 3) errors.push("regions.length");
  else if (b.regions.map(r => r.region).join(",") !== "US,EU,ASIA") errors.push("order");
  for (const r of b.regions || []) {
    if (!r?.trade || !String(r.trade).trim()) errors.push(`trade-${r?.region || "?"}`);
  }
  const changes = Array.isArray(b.topChanges) ? b.topChanges : [];
  if (changes.length > 0 && changes.every(c => c.region === "US")) errors.push("us-only");
  if (changes.filter(c => c.region === "US" && c.title !== "none").length > 3) errors.push("us-cap");
  if (changes.length > 6) errors.push("cap");
  for (const region of BRIEFING_REGIONS) {
    if (!changes.some(c => c.region === region)) errors.push(`quota-${region}`);
  }
  if (!headlineOk(b.headline || "", b.singleRegionFocus === true)) errors.push("headline");
  if (!Array.isArray(b.cross) || b.cross.length !== 3) errors.push("cross");
  return errors;
}

export function briefingSchema(payload: any): "v1" | "v2" {
  const regions = payload?.regions ?? payload?.briefing?.regions;
  if (Array.isArray(regions) && regions.length === 3) return "v2";
  return "v1";
}

export function berlinDateKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function berlinHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

/** Fresh until 18:00 Berlin the same day, or for 6 hours, matching the existing briefing window. */
export function briefingV2CacheFresh(savedAtIso: string, now = new Date()): boolean {
  const saved = new Date(savedAtIso);
  if (Number.isNaN(saved.getTime())) return false;
  const age = now.getTime() - saved.getTime();
  if (age < 0) return false;
  if (berlinDateKey(saved) === berlinDateKey(now) && berlinHour(now) < 18) return true;
  return age < 6 * 60 * 60 * 1000;
}

function allowedNumbers(idx: RegionIndexNumbers): string[] {
  return [idx.li, idx.realRatePct, idx.velocity, idx.pricedIn, idx.emg]
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .flatMap(n => {
      const s = String(n);
      return [s, s.replace(".", ",")];
    });
}

function numbersAllowed(text: string, idx: RegionIndexNumbers): boolean {
  const found = text.match(/\d+(?:[.,]\d+)?/g) || [];
  const allowed = allowedNumbers(idx);
  return found.every(n => allowed.includes(n) || allowed.includes(n.replace(",", ".")));
}

function usableSentence(
  text: string | undefined,
  usText: string | undefined,
  region: RegionId,
  idx: RegionIndexNumbers,
): string | null {
  const t = String(text || "").trim();
  if (!t || t === "n/v" || t === "Index n/v") return null;
  if (region !== "US" && usText && t === usText.trim()) return null;
  if (!numbersAllowed(t, idx)) return null;
  return t;
}

function stanceFromAction(action?: string | null): Stance | null {
  if (action === "Buy") return "Opportunistisch";
  if (action === "Avoid") return "Vorsichtig";
  if (action === "Watch") return "Neutral";
  return null;
}

function asStance(value: string | undefined): Stance | null {
  return STANCES.includes(value as Stance) ? value as Stance : null;
}

function moneyText(
  region: RegionId,
  hasMacro: boolean,
  events: SourceEvent[],
  idx: RegionIndexNumbers,
  llm: string | undefined,
  usLlm: string | undefined,
): string {
  if (!hasMacro && !idx.available) return "Index n/v";
  const geld = hasMacro ? events.find(e => e.region === region && mapCategory(e.category) === "Geldpolitik") : undefined;
  if (geld?.title) return String(geld.title);
  const sentence = usableSentence(llm, usLlm, region, idx);
  if (sentence) return sentence;
  if (!idx.available) return "Index n/v";
  const bits: string[] = [];
  if (idx.li != null) bits.push(`LI ${idx.li}`);
  if (idx.label) bits.push(idx.label);
  if (idx.realRatePct != null) bits.push(`r ${idx.realRatePct}`);
  if (idx.velocity != null) bits.push(`V ${idx.velocity}`);
  if (idx.emg != null) bits.push(`EMG ${idx.emg}`);
  if (idx.pricedIn != null) bits.push(`π ${idx.pricedIn}`);
  return bits.length ? bits.join(", ") : "Index n/v";
}

function fiscalText(
  region: RegionId,
  hasMacro: boolean,
  events: SourceEvent[],
  idx: RegionIndexNumbers,
  llm: string | undefined,
  usLlm: string | undefined,
): string {
  if (!hasMacro) return "n/v";
  const fiskal = events.find(e => e.region === region && mapCategory(e.category) === "Fiskalpolitik");
  if (fiskal?.title) return String(fiskal.title);
  return usableSentence(llm, usLlm, region, idx) || "n/v";
}

function tradeText(
  region: RegionId,
  hasMacro: boolean,
  events: SourceEvent[],
  idx: RegionIndexNumbers,
  llm: string | undefined,
  usLlm: string | undefined,
): string {
  if (!hasMacro) return "n/v";
  const handel = events.find(e => e.region === region && mapCategory(e.category) === "Handel");
  if (handel?.title) return String(handel.title);
  return usableSentence(llm, usLlm, region, idx) || NO_TARIFF;
}

function crossLines(briefs: RegionBrief[]): string[] {
  const by = Object.fromEntries(briefs.map(b => [b.region, b])) as Record<RegionId, RegionBrief>;
  const pairs: Array<[RegionId, RegionId, string]> = [
    ["US", "EU", "US→EZ"],
    ["US", "ASIA", "US→Asia"],
    ["EU", "ASIA", "EZ→Asia"],
  ];
  return pairs.map(([a, b, label]) => {
    const left = by[a]?.trade || "n/v";
    const right = by[b]?.trade || "n/v";
    if (left === "n/v" && right === "n/v") return `${label}: n/v`;
    return `${label}: ${a} ${left} | ${b} ${right}`;
  });
}

function pickHeadline(llm: string | undefined, singleRegionFocus: boolean): string {
  const text = String(llm || "").trim();
  if (singleRegionFocus && text) return text;
  if (text && headlineOk(text, false) && numbersAllowed(text, emptyIndex())) return text;
  return "Cross US EU ASIA";
}

function emptyRegionInput(region: RegionId): ComposeRegionInput {
  return { region, hasMacro: false, events: [], prior: [], index: null, priorIndex: null };
}

export function composeRegionalBriefing(input: {
  asOf: string;
  singleRegionFocus?: boolean;
  regions: ComposeRegionInput[];
  llm?: ComposeLlm | null;
}): DailyBriefingV2 {
  const singleRegionFocus = input.singleRegionFocus === true;
  const ordered = BRIEFING_REGIONS.map(id => input.regions.find(r => r.region === id) || emptyRegionInput(id));
  const llmRegions = input.llm?.regions || [];
  const llmOf = (id: RegionId) => llmRegions.find(r => r.region === id);
  const usLlm = llmOf("US");
  const kept = selectRegionalEvents(ordered);
  const topChanges = applyTopChangeQuota(kept);

  const briefs = ordered.map(src => {
    const idx = parseIndexCache(src.index);
    const llm = llmOf(src.region);
    const hasSource = src.hasMacro || idx.available;
    const fromMacro = stanceFromAction(src.macroAction);
    const stance: Stance = !hasSource
      ? "Neutral"
      : fromMacro || asStance(llm?.stance) || "Neutral";
    const brief: RegionBrief = {
      region: src.region,
      stance,
      money: moneyText(src.region, src.hasMacro, src.events || [], idx, llm?.money, usLlm?.money),
      fiscal: fiscalText(src.region, src.hasMacro, src.events || [], idx, llm?.fiscal, usLlm?.fiscal),
      trade: tradeText(src.region, src.hasMacro, src.events || [], idx, llm?.trade, usLlm?.trade),
      li: idx.available ? idx.li : null,
      realRatePct: idx.available ? idx.realRatePct : null,
      velocity: idx.available ? idx.velocity : null,
      pricedIn: idx.available ? idx.pricedIn : null,
    };
    return { brief, hasSource };
  });

  const regions = briefs.map(b => b.brief) as [RegionBrief, RegionBrief, RegionBrief];
  const live = briefs.filter(b => b.hasSource).map(b => b.brief.stance);
  const tacticalStance: Stance = !live.length
    ? "Neutral"
    : live.includes("Vorsichtig")
      ? "Vorsichtig"
      : live.every(s => s === "Opportunistisch")
        ? "Opportunistisch"
        : "Neutral";
  const stanceRationale = live.length
    ? regions.map(r => `${r.region} ${r.stance}`).join(", ")
    : "n/v";

  const briefing: DailyBriefingV2 = {
    asOf: input.asOf,
    headline: pickHeadline(input.llm?.headline, singleRegionFocus),
    cross: crossLines(regions),
    regions,
    topChanges,
    tacticalStance,
    stanceRationale,
    _schema: "v2",
  };
  if (singleRegionFocus) briefing.singleRegionFocus = true;
  return briefing;
}

export function buildRegionalBriefingPrompt(input: {
  today: string;
  indexLines: string[];
  eventBlock: string;
  catalogHint?: string;
}): string {
  const filters = BRIEFING_REGIONS.map(region => {
    const f = REGION_FILTERS[region];
    return `${region}: Geld ${f.money} | Fiskal ${f.fiscal} | Handel ${f.trade}`;
  }).join("\n");
  return [
    "Du bist täglicher Marktstratege. Zahlen stehen unten. Du lieferst nur Synthese.",
    BRIEFING_PROMPT_CORE,
    "LLM darf keine r/V erfinden. Fehlt eine Serie, schreibe n/v. Fehlt der Index, schreibe Index n/v.",
    `Heute: ${input.today}.`,
    "Filter, in jeder Region dieselben drei Bücher:",
    filters,
    "REGION_CONTEXT ist Katalog-Hinweis, nicht der Filter.",
    input.catalogHint || "",
    "Index-Cache:",
    ...input.indexLines,
    "Events je Region:",
    input.eventBlock || "keine",
    'JSON: {"headline":"","cross":["US→EZ:","US→Asia:","EZ→Asia:"],"regions":[{"region":"US","stance":"Neutral","money":"","fiscal":"","trade":""},{"region":"EU","stance":"Neutral","money":"","fiscal":"","trade":""},{"region":"ASIA","stance":"Neutral","money":"","fiscal":"","trade":""}],"tacticalStance":"Neutral","stanceRationale":""}',
    "trade ist ein Pflichtfeld. US-Zoll ist kein globales Event ohne EU- und Asia-Zeile.",
  ].join("\n");
}
