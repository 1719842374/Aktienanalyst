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

/** FRED-Serien, die der Briefing-Fetch wirklich anfragt. Kein M2V, kein DFII*. */
export const LIVE_FRED_SERIES = ["JPNNGDP"] as const;

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
  asia: 24 * 60 * 60 * 1000,
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
 * Der Post-Text wird nicht als V, r, π oder s(z) gelesen.
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
      return [CACHE_KEYS.asia];
    default:
      return [];
  }
}
