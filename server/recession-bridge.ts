/**
 * Rate and oil bridge beside the 17 recession indicators.
 * Spec: Offen_WORK_RECESSION_RATE_OIL_BRIDGE.md
 *
 * Does not enter Netto/Max. Explains why correction-P and recession-P can diverge.
 *
 * FRED series named in the spec: DCOILWTICO, GASREGW, CPIAUCSL, DGS10, DFII10, T10YIE, DFF.
 * The flag formulas also name WEI and corr(SPX, WTI). Those two are fetched here
 * (FRED WEI, FRED SP500) and are not a new 18th/19th indicator.
 *
 * Monitor (spec):
 *   Δwti4w  = log(WTI_t / WTI_{t-20d})
 *   z_oil   = z(Δwti4w) over 10Y
 *   shock   = z_oil > 1.5 AND corr_20d(SPX, WTI) < 0
 *   passCPI = 0.035 * Δgas_8w
 *   passBE  = clip(0.10 * passCPI * 100, 0, 1.0) pp
 *
 * Δgas_8w is the 8-week relative change (P_t / P_{t-8} - 1), not a log and not
 * "10" for a 10% move. passCPI is then the CPI fraction (weight × relative
 * change). The ×100 inside passBE converts that fraction to percentage points
 * before the spec's rule "1 pp headline for one year ≈ 10 bp on T10YIE".
 * UI pp = passCPI × 100, UI bp = passBE × 100.
 *
 * Rate score: 20Y z-score of the 13-week level change.
 *   z_real = z(Δ DFII10_13w)
 *   z_be   = z(Δ T10YIE_13w)
 *   rateTight = z_real > 1
 *   stagflationWedge = z_be > 1 && z(Δ WEI_13w) < 0
 *
 * 13W on a business-daily series is 65 prints (13×5). On weekly WEI it is 13 prints.
 * 4W WTI is the spec's t-20d: 20 prints. z is the sample z-score (n-1) of the
 * latest change against changes whose date falls in the trailing window.
 */

export interface FredObs {
  date: string;
  value: number;
}

export const LAG_WTI_4W = 20;
export const LAG_GAS_8W = 8;
export const LAG_13W_DAILY = 65;
export const LAG_13W_WEEKLY = 13;
export const Z_OIL_YEARS = 10;
export const Z_RATE_YEARS = 20;
export const GAS_CPI_WEIGHT = 0.035;

/** D_eq ≈ 15 at g* 7% / WACC 9%. +50 bp nominal ⇒ ≈ −7.5% index. */
export const EQUITY_DURATION = {
  dEq: 15,
  gStar: 0.07,
  wacc: 0.09,
  plus50bpIndexPct: -7.5,
} as const;

const FRED_LOOKBACK_YEARS = 21;

export interface RecessionBridge {
  rates: {
    dgs10: number | null;
    dfii10: number | null;
    t10yie: number | null;
    dff: number | null;
    asOf: string | null;
    delta13w: {
      dgs10: number | null;
      dfii10: number | null;
      t10yie: number | null;
    };
    zReal: number | null;
    zBe: number | null;
    zWei: number | null;
    identityGap: number | null;
    equityDuration: typeof EQUITY_DURATION;
  };
  oil: {
    wti: number | null;
    gas: number | null;
    cpi: number | null;
    asOf: string | null;
    deltaWti4w: number | null;
    zOil: number | null;
    corr20d: number | null;
    deltaGas8w: number | null;
    passCPI: number | null;
    passBE: number | null;
    shock: boolean;
  };
  flags: {
    rateTight: boolean;
    stagflationWedge: boolean;
    shock: boolean;
  };
}

export interface BridgeSeries {
  DCOILWTICO: FredObs[];
  GASREGW: FredObs[];
  CPIAUCSL: FredObs[];
  DGS10: FredObs[];
  DFII10: FredObs[];
  T10YIE: FredObs[];
  DFF: FredObs[];
  WEI: FredObs[];
  SP500: FredObs[];
}

export function emptyBridgeSeries(): BridgeSeries {
  return {
    DCOILWTICO: [],
    GASREGW: [],
    CPIAUCSL: [],
    DGS10: [],
    DFII10: [],
    T10YIE: [],
    DFF: [],
    WEI: [],
    SP500: [],
  };
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Spec pass-through. Δgas_8w is a relative change (0.10 = +10%). */
export function passThrough(deltaGas8w: number): { passCPI: number; passBE: number } {
  const passCPI = GAS_CPI_WEIGHT * deltaGas8w;
  const passBE = clip(0.10 * passCPI * 100, 0, 1.0);
  return { passCPI, passBE };
}

export function zscoreLatest(sample: number[]): number | null {
  const xs = sample.filter(v => Number.isFinite(v));
  if (xs.length < 2) return null;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return 0;
  return (xs[xs.length - 1] - mean) / sd;
}

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (!(dx > 0) || !(dy > 0)) return null;
  return num / Math.sqrt(dx * dy);
}

export function yearsBefore(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function parseFredCsv(csv: string): FredObs[] {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const byDate = new Map<string, number>();
  for (const line of csv.trim().split("\n").slice(1)) {
    if (!line.trim()) continue;
    const [dateRaw, valRaw] = line.split(",");
    const date = dateRaw?.trim();
    const value = parseFloat(valRaw?.trim());
    if (date && Number.isFinite(value)) byDate.set(date, value);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

type DeltaKind = "diff" | "log" | "rel";

export function seriesDeltas(
  obs: FredObs[],
  lag: number,
  kind: DeltaKind,
): { date: string; delta: number }[] {
  const out: { date: string; delta: number }[] = [];
  if (lag < 1) return out;
  for (let i = lag; i < obs.length; i++) {
    const prev = obs[i - lag].value;
    const cur = obs[i].value;
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    if (kind !== "diff" && (!(prev > 0) || !(cur > 0))) continue;
    let delta: number;
    if (kind === "diff") delta = cur - prev;
    else if (kind === "log") delta = Math.log(cur / prev);
    else delta = cur / prev - 1;
    if (Number.isFinite(delta)) out.push({ date: obs[i].date, delta });
  }
  return out;
}

function latestDeltaZ(
  obs: FredObs[],
  lag: number,
  kind: DeltaKind,
  years: number,
): { delta: number | null; z: number | null } {
  const deltas = seriesDeltas(obs, lag, kind);
  if (deltas.length === 0) return { delta: null, z: null };
  const asOf = deltas[deltas.length - 1].date;
  const cutoff = yearsBefore(asOf, years);
  const sample = deltas.filter(d => d.date >= cutoff && d.date <= asOf);
  const delta = sample.length > 0 ? sample[sample.length - 1].delta : deltas[deltas.length - 1].delta;
  const z = zscoreLatest(sample.map(d => d.delta));
  return { delta, z };
}

function last(obs: FredObs[]): FredObs | null {
  return obs.length > 0 ? obs[obs.length - 1] : null;
}

/**
 * corr_20d(SPX, WTI): Pearson correlation of daily log returns on the last
 * 20 paired trading days. Supply shocks print oil up / equities down.
 */
export function corr20d(spx: FredObs[], wti: FredObs[]): number | null {
  const wtiByDate = new Map(wti.map(o => [o.date, o.value]));
  const paired: { spx: number; wti: number }[] = [];
  for (const row of spx) {
    const w = wtiByDate.get(row.date);
    if (w != null && row.value > 0 && w > 0) paired.push({ spx: row.value, wti: w });
  }
  if (paired.length < LAG_WTI_4W + 1) return null;
  const window = paired.slice(-(LAG_WTI_4W + 1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < window.length; i++) {
    xs.push(Math.log(window[i].spx / window[i - 1].spx));
    ys.push(Math.log(window[i].wti / window[i - 1].wti));
  }
  return pearson(xs, ys);
}

export function isSupplyShock(zOil: number | null, corr: number | null): boolean {
  return zOil != null && zOil > 1.5 && corr != null && corr < 0;
}

export function isRateTight(zReal: number | null): boolean {
  return zReal != null && zReal > 1;
}

export function isStagflationWedge(zBe: number | null, zWei: number | null): boolean {
  return zBe != null && zBe > 1 && zWei != null && zWei < 0;
}

export function emptyBridge(): RecessionBridge {
  return computeBridge(emptyBridgeSeries());
}

export function computeBridge(input: BridgeSeries): RecessionBridge {
  const wtiLast = last(input.DCOILWTICO);
  const gasLast = last(input.GASREGW);
  const cpiLast = last(input.CPIAUCSL);
  const dgs = last(input.DGS10);
  const real = last(input.DFII10);
  const be = last(input.T10YIE);
  const dff = last(input.DFF);

  const wtiZ = latestDeltaZ(input.DCOILWTICO, LAG_WTI_4W, "log", Z_OIL_YEARS);
  const gasZ = latestDeltaZ(input.GASREGW, LAG_GAS_8W, "rel", Z_OIL_YEARS);
  const realZ = latestDeltaZ(input.DFII10, LAG_13W_DAILY, "diff", Z_RATE_YEARS);
  const beZ = latestDeltaZ(input.T10YIE, LAG_13W_DAILY, "diff", Z_RATE_YEARS);
  const dgsZ = latestDeltaZ(input.DGS10, LAG_13W_DAILY, "diff", Z_RATE_YEARS);
  const weiZ = latestDeltaZ(input.WEI, LAG_13W_WEEKLY, "diff", Z_RATE_YEARS);
  const corr = corr20d(input.SP500, input.DCOILWTICO);

  const pass = gasZ.delta == null ? null : passThrough(gasZ.delta);
  const zOil = wtiZ.z;
  const zReal = realZ.z;
  const zBe = beZ.z;
  const zWei = weiZ.z;

  const shock = isSupplyShock(zOil, corr);
  const rateTight = isRateTight(zReal);
  const stagflationWedge = isStagflationWedge(zBe, zWei);

  const identityGap = dgs && real && be
    ? dgs.value - (real.value + be.value)
    : null;

  return {
    rates: {
      dgs10: dgs?.value ?? null,
      dfii10: real?.value ?? null,
      t10yie: be?.value ?? null,
      dff: dff?.value ?? null,
      asOf: dgs?.date ?? real?.date ?? be?.date ?? null,
      delta13w: {
        dgs10: dgsZ.delta,
        dfii10: realZ.delta,
        t10yie: beZ.delta,
      },
      zReal,
      zBe,
      zWei,
      identityGap,
      equityDuration: EQUITY_DURATION,
    },
    oil: {
      wti: wtiLast?.value ?? null,
      gas: gasLast?.value ?? null,
      cpi: cpiLast?.value ?? null,
      asOf: wtiLast?.date ?? null,
      deltaWti4w: wtiZ.delta,
      zOil,
      corr20d: corr,
      deltaGas8w: gasZ.delta,
      passCPI: pass?.passCPI ?? null,
      passBE: pass?.passBE ?? null,
      shock,
    },
    flags: {
      rateTight,
      stagflationWedge,
      shock,
    },
  };
}

function fmt(n: number | null, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

function signed(n: number | null, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const body = n.toFixed(digits);
  return n > 0 ? `+${body}` : body;
}

/**
 * UI line plus the WTI→CPI→BE→DGS10 chain. null when shock is false,
 * so generateFazit drops the geopolitics section.
 */
export function formatShockGeopolitics(bridge: RecessionBridge): string | null {
  if (!bridge.flags.shock) return null;
  const oil = bridge.oil;
  const rates = bridge.rates;
  const xPct = oil.deltaWti4w == null || !Number.isFinite(oil.deltaWti4w)
    ? null
    : (Math.exp(oil.deltaWti4w) - 1) * 100;
  const yPp = oil.passCPI == null ? null : oil.passCPI * 100;
  const zBp = oil.passBE == null ? null : oil.passBE * 100;
  const line = `Öl ${signed(xPct, 1)} % / 4W · Headline-Beitrag ~${fmt(yPp, 2)} pp · mechan. 10J-BE ~${fmt(zBp, 1)} bp · Realzins vs BE siehe Brücke.`;
  const chain = `Kette WTI→CPI→BE→DGS10: WTI ${fmt(oil.wti, 2)} $/bbl, Δ4W log ${fmt(oil.deltaWti4w, 3)} (z_oil ${fmt(oil.zOil, 2)}), corr_20d(SPX, WTI) ${fmt(oil.corr20d, 2)}, GASREGW Δ8W ${signed(oil.deltaGas8w == null ? null : oil.deltaGas8w * 100, 1)} %, CPIAUCSL ${fmt(oil.cpi, 3)}, passCPI ${fmt(oil.passCPI, 4)}, passBE ${fmt(oil.passBE, 3)} pp. DGS10 ${fmt(rates.dgs10, 2)} % = DFII10 ${fmt(rates.dfii10, 2)} % + T10YIE ${fmt(rates.t10yie, 2)} % (Residuum ${fmt(rates.identityGap, 2)} pp), Δ13W real ${fmt(rates.delta13w.dfii10, 2)} pp (z_real ${fmt(rates.zReal, 2)}), Δ13W BE ${fmt(rates.delta13w.t10yie, 2)} pp (z_be ${fmt(rates.zBe, 2)}), DFF ${fmt(rates.dff, 2)} %, z(Δ WEI) ${fmt(rates.zWei, 2)}. Flags: rateTight ${bridge.flags.rateTight}, stagflationWedge ${bridge.flags.stagflationWedge}.`;
  return `${line} ${chain}`;
}

export function shockGeopoliticsSection(
  bridge: RecessionBridge,
): { title: string; emoji: string; text: string } | null {
  const text = formatShockGeopolitics(bridge);
  if (!text) return null;
  return {
    title: "Geopolitik & Makro: Inflation, Zinsen",
    emoji: "🌍",
    text,
  };
}

async function fetchFredSeries(seriesId: string, cosd: string): Promise<FredObs[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${cosd}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return [];
    return parseFredCsv(await resp.text());
  } catch {
    return [];
  }
}

/** Seven spec series plus WEI and SP500 for the named flags. Never throws. */
export async function fetchBridge(): Promise<RecessionBridge> {
  const cosd = yearsBefore(new Date().toISOString().slice(0, 10), FRED_LOOKBACK_YEARS);
  const ids = [
    "DCOILWTICO",
    "GASREGW",
    "CPIAUCSL",
    "DGS10",
    "DFII10",
    "T10YIE",
    "DFF",
    "WEI",
    "SP500",
  ] as const;
  try {
    const rows = await Promise.all(ids.map(id => fetchFredSeries(id, cosd)));
    const series = emptyBridgeSeries();
    ids.forEach((id, i) => {
      series[id] = rows[i];
    });
    return computeBridge(series);
  } catch {
    return emptyBridge();
  }
}
