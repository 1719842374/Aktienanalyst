/**
 * Eurozone and Japan prints for the recession catalogs.
 * Fetch failures become empty series. The scorer does not invent a number.
 */
import { fmpRatiosTtm } from "./fmp";
import { parseBojSeries, parseEcbCsv } from "./liquidity-briefing-math";
import { fetchVstoxxVol } from "./recession-markets";
import {
  REGION_WEIGHT,
  alignSpread,
  catalogProbability,
  blendWeighted,
  closedSlot,
  isStale,
  laborSlot,
  levelAndDelta,
  parseEurostatSeries,
  sahmGapPp,
  yoyByMonth,
  type DatedPoint,
  type RegionCatalog,
  type RegionalCatalogs,
  type RegionSlot,
  type ScoredReading,
} from "../shared/recession-regions";

const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const ECB_M3_YOY = "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M30.X.I.U2.2300.Z01.A";
const BOJ_M2_YOY = "MAM1YAM2M2MO";
const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export interface RegionalPrints {
  ezUnemployment: { geo: string; points: DatedPoint[] };
  ezLong: DatedPoint[];
  ezShort: DatedPoint[];
  ezIp: { geo: string; points: DatedPoint[] };
  ezM3Yoy: number | null;
  ezHy: number | null;
  ezPe: number | null;
  ezPeSource: string;
  ezVol: number | null;
  jpUnemployment: DatedPoint[];
  jpLong: DatedPoint[];
  jpIp: DatedPoint[];
  jpIpSource: string;
  jpM2Yoy: number | null;
  jpPe: number | null;
  jpPeSource: string;
  jpVol: number | null;
}

export interface RegionScorers {
  money: (yoy: number) => ScoredReading;
  credit: (spread: number) => ScoredReading;
  vol: (level: number) => ScoredReading;
  valuation: (ratio: number) => ScoredReading;
  activity: (yoy: number) => { rawScore: number; zone: string };
  curve: (levels: number[], stressWhenLow: boolean) => { available: boolean; raw: number };
}

export interface ScoreInput {
  prints: RegionalPrints;
  usSlots: RegionSlot[];
  usRecession12m: number;
  usCorrection12m: number;
  today: string;
  scorers: RegionScorers;
}

async function getText(url: string, timeoutMs = 20000): Promise<string> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Aktienanalyst/1.0", Accept: "application/json,text/csv,*/*" },
    });
    if (!resp.ok) return "";
    return await resp.text();
  } catch {
    return "";
  }
}

function parseFred(csv: string): DatedPoint[] {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const points: DatedPoint[] = [];
  for (const line of csv.trim().split("\n").slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw?.trim());
    if (date && /^\d{4}-\d{2}-\d{2}/.test(date) && Number.isFinite(value)) points.push({ date: date.trim(), value });
  }
  return points;
}

async function fred(id: string, cosd: string): Promise<DatedPoint[]> {
  const csv = await getText(`${FRED}?id=${encodeURIComponent(id)}&cosd=${cosd}`);
  return parseFred(csv);
}

async function eurostat(dataset: string, query: string, geos: string[]): Promise<{ geo: string; points: DatedPoint[] }> {
  for (const geo of geos) {
    const text = await getText(`${EUROSTAT}/${dataset}?format=JSON&lang=en&geo=${geo}&${query}`);
    if (!text || text.includes("<html")) continue;
    try {
      const points = parseEurostatSeries(JSON.parse(text));
      if (points.length > 0) return { geo, points };
    } catch {
      continue;
    }
  }
  return { geo: geos[0] ?? "", points: [] };
}

function latestFinite(points: DatedPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (Number.isFinite(points[i].value)) return points[i].value;
  }
  return null;
}

async function indexPe(symbols: string[]): Promise<{ value: number; source: string } | null> {
  if (!process.env.FMP_API_KEY) return null;
  for (const symbol of symbols) {
    try {
      const payload = await fmpRatiosTtm(symbol);
      const row = Array.isArray(payload) ? payload[0] : payload;
      const pe = Number(row?.priceToEarningsRatioTTM ?? row?.peRatioTTM);
      if (Number.isFinite(pe) && pe > 0) return { value: pe, source: `FMP ${symbol} PE TTM` };
    } catch {
      continue;
    }
  }
  return null;
}

const ISHARES_EXSA = "https://www.ishares.com/de/privatanleger/de/produkte/251931/ishares-stoxx-europe-600-ucits-etf-de-fund";
const OECD_JP_IP = "https://api.db.nomics.world/v22/series/OECD/DSD_STES@DF_INDSERV/JPN.M.PRVM.IX.BTE.Y._Z._Z.N?observations=1";

/** iShares priceEarnings block. German pages use a decimal comma. */
export function isharesPriceEarnings(html: string): { date: string; value: number } | null {
  if (!html) return null;
  const text = html.replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
  const match = text.match(/"priceEarnings"\s*:\s*\{[^}]*?"asOfDate"\s*:\s*(\d{8})[^}]*?"formattedValue"\s*:\s*"([0-9]+(?:[.,][0-9]+)?)"/);
  if (!match) return null;
  const compact = match[1];
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Number(match[2].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > 80) return null;
  return { date, value };
}

/** DBnomics series.docs[0] period/value pairs. YYYY-MM becomes the month start. */
export function parseDbNomicsSeries(payload: unknown): DatedPoint[] {
  if (!payload || typeof payload !== "object") return [];
  const docs = (payload as { series?: { docs?: unknown[] } }).series?.docs;
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc || typeof doc !== "object") return [];
  const periods = (doc as { period?: unknown }).period;
  const values = (doc as { value?: unknown }).value;
  if (!Array.isArray(periods) || !Array.isArray(values)) return [];
  const points: DatedPoint[] = [];
  const n = Math.min(periods.length, values.length);
  for (let i = 0; i < n; i++) {
    const period = String(periods[i] ?? "");
    const value = typeof values[i] === "number" ? values[i] : Number(values[i]);
    if (!Number.isFinite(value)) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(period)
      ? period
      : /^\d{4}-\d{2}$/.test(period)
        ? `${period}-01`
        : "";
    if (!date) continue;
    points.push({ date, value });
  }
  return points;
}

/** The series whose last print is newer. An empty side loses. A tie keeps the primary. */
export function newerSeries(primary: DatedPoint[], fallback: DatedPoint[]): { points: DatedPoint[]; usedPrimary: boolean } {
  const last = (points: DatedPoint[]) => points.reduce((max, point) => point.date > max ? point.date : max, "");
  if (primary.length === 0) return { points: fallback, usedPrimary: false };
  if (fallback.length === 0) return { points: primary, usedPrimary: true };
  if (last(primary) >= last(fallback)) return { points: primary, usedPrimary: true };
  return { points: fallback, usedPrimary: false };
}

async function stoxxPe(today: string): Promise<{ value: number | null; source: string }> {
  const fmp = await indexPe(["^STOXX", "^SXXP", "EXSA.DE"]);
  if (fmp) return { value: fmp.value, source: fmp.source };
  const pe = isharesPriceEarnings(await getText(ISHARES_EXSA, 25000));
  if (!pe) return { value: null, source: "STOXX 600 PE (FMP leer, iShares ohne KGV)" };
  if (isStale(pe.date, today)) {
    return { value: null, source: `iShares EXSA KGV ${pe.date.slice(0, 7)} außerhalb des 18-Monats-Fensters` };
  }
  return { value: pe.value, source: `iShares EXSA KGV ${pe.date}` };
}

async function topixPe(): Promise<{ value: number | null; source: string }> {
  const fmp = await indexPe(["^TPX", "1306.T"]);
  if (fmp) return { value: fmp.value, source: fmp.source };
  return { value: null, source: "TOPIX/CAPE JP (FMP leer; JPX-PER nur xlsx)" };
}

function yearsAgo(today: string, years: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

/** One retry. The CSV is real, and a burst of US fetches can drop the first response. */
async function ecbM3Yoy(): Promise<number | null> {
  const url = `${ECB_M3_YOY}?format=csvdata&startPeriod=2005-01&detail=dataonly`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await getText(url, 25000);
    const series = parseEcbCsv(text).sort((a, b) => a.period.localeCompare(b.period));
    if (series.length > 0) return series[series.length - 1].value;
  }
  return null;
}

export function emptyRegionalPrints(): RegionalPrints {
  return {
    ezUnemployment: { geo: "EA20", points: [] },
    ezLong: [],
    ezShort: [],
    ezIp: { geo: "EA20", points: [] },
    ezM3Yoy: null,
    ezHy: null,
    ezPe: null,
    ezPeSource: "STOXX 600 PE (FMP leer, iShares ohne KGV)",
    ezVol: null,
    jpUnemployment: [],
    jpLong: [],
    jpIp: [],
    jpIpSource: "FRED JPNPROINDMISMEI",
    jpM2Yoy: null,
    jpPe: null,
    jpPeSource: "TOPIX/CAPE JP (FMP leer; JPX-PER nur xlsx)",
    jpVol: null,
  };
}

export async function fetchRegionalPrints(today = new Date().toISOString().slice(0, 10)): Promise<RegionalPrints> {
  const cosd = yearsAgo(today, 20);
  const bojStart = yearsAgo(today, 20).slice(0, 4) + yearsAgo(today, 20).slice(5, 7);
  const [ezUnemployment, ezIp, ezLong, ezShort, ezHyPoints, jpUnemployment, jpLong, jpIpFred, oecdIpText, ezM3Yoy, bojText, ezPe, jpPe, vstoxx] = await Promise.all([
    eurostat("une_rt_m", "s_adj=SA&age=TOTAL&unit=PC_ACT&sex=T&sinceTimePeriod=2005-01", ["EA20", "EA21"]),
    eurostat("sts_inpr_m", "s_adj=SCA&nace_r2=B-D&unit=I21&sinceTimePeriod=2005-01", ["EA20", "EA21"]),
    fred("IRLTLT01EZM156N", cosd),
    fred("IR3TIB01EZM156N", cosd),
    fred("BAMLHE00EHYIOAS", cosd),
    fred("LRUNTTTTJPM156S", cosd),
    fred("IRLTLT01JPM156N", cosd),
    fred("JPNPROINDMISMEI", cosd),
    getText(OECD_JP_IP, 25000),
    ecbM3Yoy(),
    getText(`https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&code=${BOJ_M2_YOY}&startDate=${bojStart}`),
    stoxxPe(today),
    topixPe(),
    fetchVstoxxVol(cosd, today).catch(() => ({ vol: [] as { date: string; value: number }[] })),
  ]);
  let oecdIp: DatedPoint[] = [];
  if (oecdIpText && !oecdIpText.includes("<html")) {
    try {
      oecdIp = parseDbNomicsSeries(JSON.parse(oecdIpText));
    } catch {
      oecdIp = [];
    }
  }
  const jpIpPick = newerSeries(oecdIp, jpIpFred);
  const m2 = parseBojSeries(bojText, BOJ_M2_YOY);
  const vol = [...vstoxx.vol].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ezUnemployment,
    ezLong,
    ezShort,
    ezIp,
    ezM3Yoy,
    ezHy: latestFinite(ezHyPoints),
    ezPe: ezPe.value,
    ezPeSource: ezPe.source,
    ezVol: vol.length ? vol[vol.length - 1].value : null,
    jpUnemployment,
    jpLong,
    jpIp: jpIpPick.points,
    jpIpSource: jpIpPick.usedPrimary ? "OECD STES JPN.M.PRVM.IX.BTE.Y (DBnomics)" : "FRED JPNPROINDMISMEI",
    jpM2Yoy: m2.length ? m2[m2.length - 1].value : null,
    jpPe: jpPe.value,
    jpPeSource: jpPe.source,
    jpVol: null,
  };
}

function fromReading(id: RegionSlot["id"], name: string, book: RegionSlot["book"], source: string, reading: ScoredReading, value?: string): RegionSlot {
  if (reading.available === false || !Number.isFinite(reading.rawScore)) {
    return closedSlot(id, name, book, source, value ?? reading.value ?? "N/A");
  }
  return {
    id,
    name,
    book,
    value: value ?? reading.value,
    rawScore: reading.rawScore,
    weight: reading.weight,
    weightedScore: reading.weightedScore,
    maxWeighted: reading.maxWeighted,
    zone: reading.zone,
    source,
    available: true,
  };
}

function activitySlot(name: string, source: string, points: DatedPoint[], today: string, score: RegionScorers["activity"]): RegionSlot {
  if (points.length === 0) return closedSlot("activity", name, "recession", source);
  const last = [...points].sort((a, b) => a.date < b.date ? -1 : 1).at(-1)!;
  const yoy = yoyByMonth(points);
  if (isStale(last.date, today) || !Number.isFinite(yoy)) {
    return closedSlot("activity", name, "recession", source, `${last.value.toFixed(1)} (${last.date.slice(0, 7)})`);
  }
  const scored = score(yoy);
  return {
    id: "activity",
    name,
    book: "recession",
    value: `YoY ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% (${last.date.slice(0, 7)})`,
    rawScore: scored.rawScore,
    weight: 1,
    weightedScore: scored.rawScore,
    maxWeighted: 3,
    zone: scored.zone,
    source,
    available: true,
  };
}

function curveSlot(
  name: string,
  source: string,
  points: DatedPoint[],
  stressWhenLow: boolean,
  score: RegionScorers["curve"],
): RegionSlot {
  const snapshot = levelAndDelta(points);
  if (!snapshot) return closedSlot("curve", name, "recession", source);
  const delta = snapshot.delta == null ? "n/a" : `${snapshot.delta > 0 ? "+" : ""}${snapshot.delta.toFixed(2)} pp`;
  const value = `${snapshot.level.toFixed(2)}% · 12M Δ ${delta}`;
  const scored = score(points.map(point => point.value), stressWhenLow);
  if (!scored.available) return { ...closedSlot("curve", name, "recession", source, value), zone: "keine 20J-Historie" };
  return {
    id: "curve",
    name,
    book: "recession",
    value,
    rawScore: scored.raw,
    weight: 1,
    weightedScore: scored.raw,
    maxWeighted: 4,
    zone: stressWhenLow ? "Spread s(z)" : "Niveau s(z)",
    source,
    available: true,
  };
}

function region(id: RegionCatalog["id"], label: string, slots: RegionSlot[]): RegionCatalog {
  return {
    id,
    label,
    weight: REGION_WEIGHT[id],
    slots,
    recessionProbability: catalogProbability(slots, "recession"),
    correctionProbability: catalogProbability(slots, "correction"),
  };
}

export function scoreRegionalCatalogs(input: ScoreInput): RegionalCatalogs {
  const { prints, scorers, today } = input;
  const ezRates = prints.ezUnemployment.points.map(point => point.value);
  const ezLaborSource = prints.ezUnemployment.points.length
    ? `Eurostat une_rt_m ${prints.ezUnemployment.geo}`
    : "Eurostat une_rt_m EA20";
  const ezSpread = alignSpread(prints.ezLong, prints.ezShort);
  const ezIpSource = prints.ezIp.points.length
    ? `Eurostat sts_inpr_m ${prints.ezIp.geo} I21`
    : "Eurostat sts_inpr_m";
  const ez: RegionSlot[] = [
    laborSlot("ALQ Eurozone", ezLaborSource, sahmGapPp(ezRates)),
    curveSlot("Kurve EZ (10J−3M)", "FRED IRLTLT01EZM156N − IR3TIB01EZM156N", ezSpread, true, scorers.curve),
    activitySlot("Aktivität EZ", ezIpSource, prints.ezIp.points, today, scorers.activity),
    prints.ezM3Yoy == null
      ? closedSlot("money", "Geld EZ M3", "recession", "ECB BSI.M.U2.Y.V.M30")
      : fromReading("money", "Geld EZ M3", "recession", "ECB BSI.M.U2.Y.V.M30", scorers.money(prints.ezM3Yoy), `${prints.ezM3Yoy.toFixed(1)}%`),
    prints.ezHy == null
      ? closedSlot("spreads", "Spreads EZ HY", "recession", "FRED BAMLHE00EHYIOAS")
      : fromReading("spreads", "Spreads EZ HY", "recession", "FRED BAMLHE00EHYIOAS", scorers.credit(prints.ezHy), `${prints.ezHy.toFixed(2)}%`),
    prints.ezPe == null
      ? closedSlot("valuation", "STOXX 600 PE", "correction", prints.ezPeSource)
      : fromReading("valuation", "STOXX 600 PE", "correction", prints.ezPeSource, scorers.valuation(prints.ezPe), prints.ezPe.toFixed(1)),
    prints.ezVol == null
      ? closedSlot("vol", "VSTOXX", "correction", "STOXX V2TX")
      : fromReading("vol", "VSTOXX", "correction", "STOXX V2TX", scorers.vol(prints.ezVol), prints.ezVol.toFixed(1)),
  ];
  const jp: RegionSlot[] = [
    laborSlot("ALQ Japan", "FRED LRUNTTTTJPM156S", sahmGapPp(prints.jpUnemployment.map(point => point.value))),
    curveSlot("Kurve JP 10J", "FRED IRLTLT01JPM156N", prints.jpLong, false, scorers.curve),
    activitySlot("Aktivität JP", prints.jpIpSource || "FRED JPNPROINDMISMEI", prints.jpIp, today, scorers.activity),
    prints.jpM2Yoy == null
      ? closedSlot("money", "Geld JP M2", "recession", "BoJ M2")
      : fromReading("money", "Geld JP M2", "recession", "BoJ M2", scorers.money(prints.jpM2Yoy), `${prints.jpM2Yoy.toFixed(1)}%`),
    closedSlot("spreads", "Spreads JP", "recession", "JGB-Corp (keine freie OAS-Serie)"),
    prints.jpPe == null
      ? closedSlot("valuation", "TOPIX/CAPE JP", "correction", prints.jpPeSource)
      : fromReading("valuation", "TOPIX/CAPE JP", "correction", prints.jpPeSource, scorers.valuation(prints.jpPe), prints.jpPe.toFixed(1)),
    prints.jpVol == null
      ? closedSlot("vol", "JNVI", "correction", "JNVI (keine freie Serie)")
      : fromReading("vol", "JNVI", "correction", "JNVI", scorers.vol(prints.jpVol), prints.jpVol.toFixed(1)),
  ];
  const us = region("US", "USA", input.usSlots);
  const euro = region("EZ", "Eurozone", ez);
  const japan = region("JP", "Japan", jp);
  return {
    weights: { ...REGION_WEIGHT },
    regions: [us, euro, japan],
    blendedRecession12m: blendWeighted([
      { weight: REGION_WEIGHT.US, probability: input.usRecession12m },
      { weight: REGION_WEIGHT.EZ, probability: euro.recessionProbability },
      { weight: REGION_WEIGHT.JP, probability: japan.recessionProbability },
    ]),
    blendedCorrection12m: blendWeighted([
      { weight: REGION_WEIGHT.US, probability: input.usCorrection12m },
      { weight: REGION_WEIGHT.EZ, probability: euro.correctionProbability },
      { weight: REGION_WEIGHT.JP, probability: japan.correctionProbability },
    ]),
    actionUsesUsBooks: true,
  };
}

export function usSlotsFromIndicators(indicators: Array<{
  name: string;
  group: "recession" | "correction";
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  available?: boolean;
}>): RegionSlot[] {
  const pick = (id: RegionSlot["id"], nameIncludes: string): RegionSlot | null => {
    const found = indicators.find(indicator => indicator.name.includes(nameIncludes));
    if (!found) return null;
    const available = found.available !== false && found.maxWeighted > 0;
    return {
      id,
      name: found.name,
      book: found.group,
      value: found.value,
      rawScore: found.rawScore,
      weight: available ? found.weight : 0,
      weightedScore: available ? found.weightedScore : 0,
      maxWeighted: available ? found.maxWeighted : 0,
      zone: found.zone,
      source: found.source,
      available,
    };
  };
  return [
    pick("labor", "Sahm"),
    pick("curve", "Zinskurve"),
    pick("activity", "Aktivität"),
    pick("money", "M2"),
    pick("spreads", "Kredit"),
    pick("valuation", "Buffett"),
    pick("valuation", "CAPE"),
    pick("vol", "VIX"),
  ].filter((slot): slot is RegionSlot => slot != null);
}
