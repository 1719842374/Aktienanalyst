/**
 * Quellenkatalog — reine Rechnung und Parser.
 * Spec: Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md
 *
 * V = NGDP / M für EZ (M3) und JP (M2). US-Velocity bleibt M2V in
 * liquidity-regime.ts; dieses Modul fetcht M2V nicht.
 * Snapshot-Prints sind Testhaken, keine Laufzeitkonstanten.
 */

export const PHI = 0.3;

export const DEAD_FRED_SERIES = [
  "MYAGM2JPM189S",
  "MYAGM2JPM189N",
  "MABMM301JPM189S",
  "MABMM301EZM189S",
] as const;

/**
 * FRED-Serien, die der Briefing-Fetch wirklich anfragt.
 * Kein M2V (der bleibt im C2-Pfad) und kein DFII* außer DFII10.
 */
export const LIVE_FRED_SERIES = [
  "JPNNGDP",
  "DFII10",
  "DGS10",
  "T10YIE",
  "IRLTLT01JPM156N",
  "JPNCPIALLMINMEI",
  "FPCPITOTLZGJPN",
  "CHNCPIALLMINMEI",
  "IRLTLT01CNM156N",
  "IRLTLT01DEM156N",
  "DEXJPUS",
  "DEXUSEU",
  "DEXCHUS",
  "DFF",
  "JPNASSETS",
  "WALCL",
  "RRPONTSYD",
  "WTREGEN",
  "WSHOBL",
  "WSHOTSL",
  "GFDEGDQ188S",
] as const;

export const EM_INDEX_WEIGHT_CAP = 0.10;
export const SPILLOVER_ABS_Z = 1;

export const CACHE_KEYS = {
  us: "liqidx_v1__US",
  eu: "liqidx_v1__EU",
  euM3: "liqidx_EU__m3",
  asia: "liqidx_v1__ASIA",
} as const;

/** Bestehender C2-Cache. Wird nur gelesen oder per X-Bot gelöscht, nie neu befüllt. */
export const EXISTING_US_LIQUIDITY_CACHE_KEY = "macro__v2__US";

export const TTL_MS = {
  euM3: 24 * 60 * 60 * 1000,
  euAppPep: 24 * 60 * 60 * 1000,
  euWfs: 6 * 60 * 60 * 1000,
  asia: 24 * 60 * 60 * 1000,
  us: 6 * 60 * 60 * 1000,
  h41: 24 * 60 * 60 * 1000,
  briefing: 6 * 60 * 60 * 1000,
} as const;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export interface DatedValue {
  period: string;
  value: number;
}

export interface QuarterVelocity {
  quarter: string;
  velocity: number;
  ngdpAnnualized: number;
  money: number;
}

export interface AppMonth {
  period: string;
  netBn: number;
  holdingsBn: number;
  psppNetBn: number;
  psppHoldingsBn: number;
}

export interface PeppMonth {
  period: string;
  netBn: number;
  cumulativeNetPurchasesBn: number;
}

export function isForbiddenFredSeries(id: string): boolean {
  const s = id.trim().toUpperCase();
  if ((DEAD_FRED_SERIES as readonly string[]).includes(s)) return true;
  if (s.startsWith("DFII") && s !== "DFII10") return true;
  return false;
}

/** V = NGDP / M. Tweet-Text ist nie der Nenner. */
export function velocity(ngdp: number, money: number): number | null {
  if (!Number.isFinite(ngdp) || !Number.isFinite(money) || money === 0) return null;
  return ngdp / money;
}

/**
 * T½ = ln2 / ln(1+max(r,0.001)) · clip(V̄/V, 0.5, 2).
 * Ohne V und V̄ ist der Velocity-Faktor 1 (reine Zins-Halbwertszeit).
 */
export function halfLifeYears(r: number, v?: number | null, vBar?: number | null): number | null {
  if (!Number.isFinite(r)) return null;
  const base = Math.log(1 + Math.max(r, 0.001));
  if (!(base > 0)) return null;
  let factor = 1;
  if (v != null && vBar != null && Number.isFinite(v) && Number.isFinite(vBar) && v !== 0) {
    factor = Math.min(2, Math.max(0.5, vBar / v));
  }
  return (Math.log(2) / base) * factor;
}

export function billsStockDiff(laterBn: number, earlierBn: number): number | null {
  if (!Number.isFinite(laterBn) || !Number.isFinite(earlierBn)) return null;
  return laterBn - earlierBn;
}

export function millionToBillion(million: number): number {
  return million / 1000;
}

/** BoJ-Einheit „100 million yen“ → Mrd. Yen. */
export function bojHundredMillionYenToBillion(raw: number): number {
  return raw / 10;
}

export function median(values: number[]): number | null {
  const xs = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return xs[mid];
  return (xs[mid - 1] + xs[mid]) / 2;
}

export function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/,/g, "");
  if (t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseFredCsv(csv: string): DatedValue[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return [];
  const lines = text.trim().split("\n");
  const out: DatedValue[] = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = splitCsvLine(line);
    const value = parseNum(raw);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && value != null) {
      out.push({ period: date.trim(), value });
    }
  }
  return out;
}

export function observationOn(obs: DatedValue[], date: string): number | null {
  const hit = obs.find(p => p.period === date);
  return hit ? hit.value : null;
}

export function parseEcbCsv(csv: string): DatedValue[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return [];
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map(h => h.trim().toUpperCase());
  const tIdx = header.indexOf("TIME_PERIOD");
  const vIdx = header.indexOf("OBS_VALUE");
  if (tIdx < 0 || vIdx < 0) return [];
  const out: DatedValue[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const value = parseNum(cols[vIdx]);
    const period = (cols[tIdx] || "").trim();
    if (period && value != null) out.push({ period, value });
  }
  return out;
}

/** BoJ getDataCode CSV. `code` ist der SERIES_CODE ohne DB-Präfix. */
export function parseBojSeries(csv: string, code: string): DatedValue[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const want = code.trim().toUpperCase();
  const out: DatedValue[] = [];
  for (const line of text.split("\n")) {
    const cols = splitCsvLine(line).map(c => c.trim());
    if (!cols[0] || cols[0].toUpperCase() !== want) continue;
    const dateIdx = cols.findIndex(c => /^\d{6}$/.test(c));
    if (dateIdx < 0 || dateIdx + 1 >= cols.length) continue;
    const value = parseNum(cols[dateIdx + 1]);
    if (value == null) continue;
    const ym = cols[dateIdx];
    out.push({ period: `${ym.slice(0, 4)}-${ym.slice(4, 6)}`, value });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/** Reihe M2-Durchschnitt, Einheit 100 Mio. Yen. */
export function parseBojMoneyStock(csv: string): DatedValue[] {
  return parseBojSeries(csv, "MAM1NAM2M2MO");
}

function periodFromYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseAppBreakdown(csv: string): AppMonth[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let year: number | null = null;
  const out: AppMonth[] = [];
  for (const line of text.split("\n")) {
    const cols = splitCsvLine(line).map(c => c.trim());
    if (/^\d{4}$/.test(cols[0] || "")) year = Number(cols[0]);
    const month = MONTHS[(cols[1] || "").toLowerCase()];
    if (!year || !month) continue;
    const nums = cols.slice(2).map(parseNum);
    if (nums.length < 12) continue;
    const nets = nums.slice(0, 4);
    const holdings = nums.slice(8, 12);
    if (nets.some(n => n == null) || holdings.some(n => n == null)) continue;
    const netM = nets[0]! + nets[1]! + nets[2]! + nets[3]!;
    const holdM = holdings[0]! + holdings[1]! + holdings[2]! + holdings[3]!;
    out.push({
      period: periodFromYearMonth(year, month),
      netBn: millionToBillion(netM),
      holdingsBn: millionToBillion(holdM),
      psppNetBn: millionToBillion(nets[3]!),
      psppHoldingsBn: millionToBillion(holdings[3]!),
    });
  }
  return out;
}

export function parsePeppPurchases(csv: string): PeppMonth[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let year: number | null = null;
  const out: PeppMonth[] = [];
  for (const line of text.split("\n")) {
    const cols = splitCsvLine(line).map(c => c.trim());
    if (/^\d{4}$/.test(cols[0] || "")) year = Number(cols[0]);
    const month = MONTHS[(cols[1] || "").toLowerCase()];
    if (!year || !month) continue;
    const net = parseNum(cols[2]);
    const cum = parseNum(cols[3]);
    if (net == null || cum == null) continue;
    out.push({
      period: periodFromYearMonth(year, month),
      netBn: millionToBillion(net),
      cumulativeNetPurchasesBn: millionToBillion(cum),
    });
  }
  return out;
}

/** YYYY-MM, YYYY-MM-DD oder YYYY-Qn → YYYY-Qn. */
export function toQuarter(period: string): string | null {
  const q = /^(\d{4})-Q([1-4])$/i.exec(period.trim());
  if (q) return `${q[1]}-Q${q[2]}`;
  const d = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(period.trim());
  if (!d) return null;
  const month = Number(d[2]);
  if (month < 1 || month > 12) return null;
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${d[1]}-Q${quarter}`;
}

export function averageInQuarter(points: DatedValue[], quarter: string): number | null {
  const hits = points.filter(p => toQuarter(p.period) === quarter);
  if (hits.length === 0) return null;
  const sum = hits.reduce((s, p) => s + p.value, 0);
  return sum / hits.length;
}

export function quarterVelocity(input: {
  ngdp: DatedValue[];
  moneyMonthly: DatedValue[];
  annualizeNgdp: boolean;
}): QuarterVelocity[] {
  const out: QuarterVelocity[] = [];
  const seen = new Set<string>();
  const quarters = input.ngdp
    .map(p => ({ quarter: toQuarter(p.period), value: p.value }))
    .filter((p): p is { quarter: string; value: number } => p.quarter != null)
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
  for (const row of quarters) {
    if (seen.has(row.quarter)) continue;
    const money = averageInQuarter(input.moneyMonthly, row.quarter);
    if (money == null) continue;
    const ngdpAnnualized = input.annualizeNgdp ? row.value * 4 : row.value;
    const v = velocity(ngdpAnnualized, money);
    if (v == null) continue;
    seen.add(row.quarter);
    out.push({ quarter: row.quarter, velocity: v, ngdpAnnualized, money });
  }
  return out;
}

export function yoyPercent(points: DatedValue[]): { latest: number; period: string } | null {
  const monthly = points
    .filter(p => /^\d{4}-\d{2}$/.test(p.period) && Number.isFinite(p.value))
    .sort((a, b) => a.period.localeCompare(b.period));
  if (monthly.length < 2) return null;
  const last = monthly[monthly.length - 1];
  const [y, m] = last.period.split("-").map(Number);
  const ago = `${y - 1}-${String(m).padStart(2, "0")}`;
  const prev = monthly.find(p => p.period === ago);
  if (!prev || prev.value === 0) return null;
  return { latest: ((last.value - prev.value) / prev.value) * 100, period: last.period };
}

/** FRED-Prozent (2.42) → Dezimal für T½ (0.0242). */
export function percentToDecimal(pct: number): number | null {
  if (!Number.isFinite(pct)) return null;
  return pct / 100;
}

/** r^JP = i_10 − π_CPI, beide in Prozent, ex post. */
export function exPostRealPercent(nominalPct: number, cpiYoyPct: number): number | null {
  if (!Number.isFinite(nominalPct) || !Number.isFinite(cpiYoyPct)) return null;
  return nominalPct - cpiYoyPct;
}

export function carryBp(leftPct: number, rightPct: number): number | null {
  if (!Number.isFinite(leftPct) || !Number.isFinite(rightPct)) return null;
  return (leftPct - rightPct) * 100;
}

export function qtNetBn(appNet: number, peppNet: number): number | null {
  if (!Number.isFinite(appNet) || !Number.isFinite(peppNet)) return null;
  return Math.round((appNet + peppNet) * 10) / 10;
}

/** WSHOTSL − WSHOBL, beide in Mio. $, Ergebnis in Mrd. $. */
export function somaNotesBn(totalMillions: number, billsMillions: number): number | null {
  if (!Number.isFinite(totalMillions) || !Number.isFinite(billsMillions)) return null;
  return (totalMillions - billsMillions) / 1000;
}

function monthKey(period: string): string | null {
  const m = /^(\d{4}-\d{2})/.exec(period.trim());
  return m ? m[1] : null;
}

/** Letzte Beobachtung je YYYY-MM. Tages- und Monatswerte landen auf demselben Schlüssel. */
export function lastInMonth(points: DatedValue[]): DatedValue[] {
  const map = new Map<string, DatedValue>();
  const sorted = [...points]
    .filter(p => Number.isFinite(p.value) && monthKey(p.period))
    .sort((a, b) => a.period.localeCompare(b.period));
  for (const p of sorted) {
    const key = monthKey(p.period);
    if (key) map.set(key, { period: key, value: p.value });
  }
  return Array.from(map.values());
}

export function yoyOnIndex(points: DatedValue[]): { latest: number; period: string } | null {
  return yoyPercent(lastInMonth(points));
}

export function spreadSeries(left: DatedValue[], right: DatedValue[], scale = 1): DatedValue[] {
  const rightByMonth = new Map(lastInMonth(right).map(p => [p.period, p.value]));
  const out: DatedValue[] = [];
  for (const p of lastInMonth(left)) {
    const other = rightByMonth.get(p.period);
    if (other == null) continue;
    out.push({ period: p.period, value: (p.value - other) * scale });
  }
  return out;
}

export function deltaSeries(points: DatedValue[], lag: number): DatedValue[] {
  const sorted = [...points].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  const out: DatedValue[] = [];
  for (let i = lag; i < sorted.length; i++) {
    out.push({ period: sorted[i].period, value: sorted[i].value - sorted[i - lag].value });
  }
  return out;
}

export function seriesInTrailingYears(points: DatedValue[], years: number): DatedValue[] {
  const sorted = [...points]
    .filter(p => Number.isFinite(p.value) && p.period)
    .sort((a, b) => a.period.localeCompare(b.period));
  if (sorted.length === 0) return [];
  const lastRaw = sorted[sorted.length - 1].period.slice(0, 10);
  const lastIso = lastRaw.length === 7 ? `${lastRaw}-01` : lastRaw;
  const end = new Date(`${lastIso}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return sorted;
  end.setUTCFullYear(end.getUTCFullYear() - years);
  const cutoff = end.toISOString().slice(0, 10);
  return sorted.filter(p => p.period.slice(0, 10) >= cutoff);
}

/** z der letzten Beobachtung gegen die eigene 5-Jahres-Historie. Zu wenig Punkte → null, kein Event. */
export function zOfLatest(points: DatedValue[], minPoints = 24): { latest: number; z: number; asOf: string } | null {
  const xs = seriesInTrailingYears(points, 5);
  if (xs.length < minPoints) return null;
  const last = xs[xs.length - 1];
  const sample = xs.slice(0, -1).map(p => p.value);
  if (sample.length < 2) return null;
  const mean = sample.reduce((sum, x) => sum + x, 0) / sample.length;
  const variance = sample.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (sample.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return { latest: last.value, z: (last.value - mean) / sd, asOf: last.period };
}

export function spilloverEvent(z: number | null): boolean {
  return z != null && Number.isFinite(z) && Math.abs(z) >= SPILLOVER_ABS_Z;
}

/** 1_{z(Δr)} — 1 sobald |z| ≥ 1, sonst 0. Ohne z kein Kanal. */
export function indicatorOfZ(z: number | null): number | null {
  if (z == null || !Number.isFinite(z)) return null;
  return Math.abs(z) >= SPILLOVER_ABS_Z ? 1 : 0;
}

/** A = clip(ΔM / max(φ F/M, ε), 0, 1). Fehlendes F → null. */
export function absorptionShare(deltaM: number, fRest: number, money: number, phi = PHI): number | null {
  if (![deltaM, fRest, money, phi].every(Number.isFinite)) return null;
  if (!(money > 0) || !(phi > 0) || !(fRest > 0)) return null;
  const denom = Math.max(phi * (fRest / money), 1e-9);
  return Math.min(1, Math.max(0, deltaM / denom));
}

/**
 * π = 0.6 · 1_{z(Δr)} + 0.4 · A. Nicht in LI addieren.
 * Ein fehlender Kanal lässt π null.
 */
export function pricedInPi(
  zDeltaR: number | null,
  deltaM: number | null,
  fRest: number | null,
  money: number | null,
): number | null {
  const indicator = indicatorOfZ(zDeltaR);
  if (indicator == null || deltaM == null || fRest == null || money == null) return null;
  const absorbed = absorptionShare(deltaM, fRest, money);
  if (absorbed == null) return null;
  return 0.6 * indicator + 0.4 * absorbed;
}

export function preferNominal(
  daily: DatedValue[],
  monthly: DatedValue[],
): { value: number; asOf: string; source: "mof-daily" | "fred-monthly" } | null {
  const sortedDaily = [...daily].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  const dailyLast = sortedDaily.length ? sortedDaily[sortedDaily.length - 1] : null;
  if (dailyLast) return { value: dailyLast.value, asOf: dailyLast.period, source: "mof-daily" };
  const sortedMonthly = [...monthly].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  const monthlyLast = sortedMonthly.length ? sortedMonthly[sortedMonthly.length - 1] : null;
  if (monthlyLast) return { value: monthlyLast.value, asOf: monthlyLast.period, source: "fred-monthly" };
  return null;
}

export function qtNetSeries(app: AppMonth[], pepp: PeppMonth[]): DatedValue[] {
  const peppByPeriod = new Map(pepp.map(row => [row.period, row.netBn]));
  const out: DatedValue[] = [];
  for (const row of app) {
    const peppNet = peppByPeriod.get(row.period);
    if (peppNet == null) continue;
    const net = qtNetBn(row.netBn, peppNet);
    if (net == null) continue;
    out.push({ period: row.period, value: net });
  }
  return out;
}

export function latestOnOrBefore(points: DatedValue[], date: string): DatedValue | null {
  let hit: DatedValue | null = null;
  for (const point of [...points].sort((a, b) => a.period.localeCompare(b.period))) {
    if (point.period.slice(0, 10) <= date.slice(0, 10)) hit = point;
    else break;
  }
  return hit;
}

export function deltaOverDays(points: DatedValue[], days: number): number | null {
  const sorted = [...points].filter(p => Number.isFinite(p.value) && /^\d{4}-\d{2}-\d{2}/.test(p.period))
    .sort((a, b) => a.period.localeCompare(b.period));
  if (sorted.length < 2) return null;
  const last = sorted[sorted.length - 1];
  const end = new Date(`${last.period.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return null;
  end.setUTCDate(end.getUTCDate() - days);
  const target = end.toISOString().slice(0, 10);
  const prev = latestOnOrBefore(sorted, target);
  if (!prev) return null;
  return last.value - prev.value;
}

function isTenYearHeader(cell: string): boolean {
  const t = cell.trim();
  const lower = t.toLowerCase();
  if (lower === "10y" || lower === "10-year" || lower === "10 year" || t === "10年") return true;
  return /^10[^\d]/.test(t);
}

function normalizeMofDate(raw: string): string | null {
  const trimmed = raw.trim();
  const era = /^([RHS])(\d+)\.(\d+)\.(\d+)$/i.exec(trimmed);
  if (era) {
    const year = Number(era[2]);
    const letter = era[1].toUpperCase();
    const base = letter === "R" ? 2018 : letter === "H" ? 1988 : 1925;
    return `${base + year}-${era[3].padStart(2, "0")}-${era[4].padStart(2, "0")}`;
  }
  const iso = trimmed.replace(/\//g, "-").replace(/\./g, "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

/** MoF constant-maturity CSV. Bevorzugter Live-Input für den JP-10y, nicht der FRED-Monat. */
export function parseMofJgb10(csv: string): DatedValue[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return [];
  const lines = text.split("\n").filter(line => line.trim());
  let headerIdx = -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]).map(cell => cell.trim());
    const found = cells.findIndex(isTenYearHeader);
    if (found >= 0) {
      headerIdx = i;
      idx = found;
      break;
    }
  }
  if (headerIdx < 0 || idx < 0) return [];
  const out: DatedValue[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cols = splitCsvLine(line);
    const period = normalizeMofDate(cols[0] || "");
    const value = parseNum(cols[idx]);
    if (period && value != null) out.push({ period, value });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

function monthsApart(older: string, newer: string): number | null {
  const toIso = (period: string) => /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : period.slice(0, 10);
  const a = new Date(`${toIso(older)}T00:00:00.000Z`);
  const b = new Date(`${toIso(newer)}T00:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Monatlicher Index → YoY. Die Jahresreihe FPCPITOTLZGJPN ist schon Prozent
 * und nur der Fallback, wenn der Monatsindex mehr als 18 Monate hinter dem Nominalzins liegt.
 */
export function japanCpiYoy(
  monthlyIndex: DatedValue[],
  annualPercent: DatedValue[],
  nominalAsOf: string | null,
): { latest: number; period: string; source: "FRED JPNCPIALLMINMEI" | "FRED FPCPITOTLZGJPN" } | null {
  const monthly = yoyOnIndex(monthlyIndex);
  const annualSorted = [...annualPercent].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  const annual = annualSorted.length ? annualSorted[annualSorted.length - 1] : null;
  const anchor = nominalAsOf || annual?.period || null;
  const age = monthly && anchor ? monthsApart(monthly.period, anchor) : null;
  const monthlyFresh = monthly != null && (age == null || age <= 18);
  if (monthly && monthlyFresh) {
    return { latest: monthly.latest, period: monthly.period, source: "FRED JPNCPIALLMINMEI" };
  }
  if (annual) {
    return { latest: annual.value, period: annual.period.slice(0, 7), source: "FRED FPCPITOTLZGJPN" };
  }
  if (monthly) return { latest: monthly.latest, period: monthly.period, source: "FRED JPNCPIALLMINMEI" };
  return null;
}

/** FiscalData MSPD, total_mil_amt in Mio. $ → Mrd. $. */
export function parseMspdBillStockBn(jsonText: string): DatedValue[] {
  let parsed: { data?: { record_date?: string; total_mil_amt?: string }[] };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const out: DatedValue[] = [];
  for (const row of parsed.data ?? []) {
    const date = row.record_date ?? "";
    const millions = parseNum(row.total_mil_amt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || millions == null) continue;
    out.push({ period: date, value: millions / 1000 });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export function monthStockDiff(points: DatedValue[]): number | null {
  const months = lastInMonth(points);
  if (months.length < 2) return null;
  return billsStockDiff(months[months.length - 1].value, months[months.length - 2].value);
}

const OFFICIAL_URL = /https?:\/\/[^\s<>"')\]]+/gi;

export function textHasOfficialReleaseUrl(text: string): boolean {
  const matches = text.match(OFFICIAL_URL) || [];
  return matches.some(raw => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host === "boj.or.jp" || host.endsWith(".boj.or.jp")) return true;
      if (host === "ecb.europa.eu" || host.endsWith(".ecb.europa.eu")) return true;
      if (host === "mof.go.jp" || host.endsWith(".mof.go.jp")) return true;
      if (host.endsWith(".gov")) return true;
      return false;
    } catch {
      return false;
    }
  });
}

/**
 * X ist die Klingel. Ohne Amts-URL keine Keys.
 * Der Post-Text wird nicht als V, r, π oder s(z) gelesen und nicht nach Personen benannt.
 */
export function xBotInvalidationKeys(account: string, text: string): string[] {
  if (!textHasOfficialReleaseUrl(text)) return [];
  const name = account.trim().toLowerCase().replace(/^@/, "");
  switch (name) {
    case "federalreserve":
    case "newyorkfed":
    case "ustreasury":
      return [CACHE_KEYS.us, EXISTING_US_LIQUIDITY_CACHE_KEY];
    case "ecb":
      return [CACHE_KEYS.eu, CACHE_KEYS.euM3];
    case "eu_commission":
      return [CACHE_KEYS.eu];
    case "bank_of_japan_e":
    case "mof_japan_eng":
    case "rbi":
      return [CACHE_KEYS.asia];
    default:
      return [];
  }
}
