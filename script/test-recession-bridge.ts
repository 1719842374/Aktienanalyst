/**
 * Unit tests for the rate/oil bridge (Offen_WORK_RECESSION_RATE_OIL_BRIDGE.md).
 * No network. Run: npx tsx script/test-recession-bridge.ts
 */
import {
  EQUITY_DURATION,
  LAG_13W_DAILY,
  computeBridge,
  emptyBridgeSeries,
  formatShockGeopolitics,
  isRateTight,
  isStagflationWedge,
  isSupplyShock,
  parseFredCsv,
  passThrough,
  pearson,
  seriesDeltas,
  shockGeopoliticsSection,
  zscoreLatest,
  type BridgeSeries,
  type FredObs,
} from "../server/recession-bridge";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function datesFrom(start: string, n: number, stepDays: number): string[] {
  const out: string[] = [];
  let d = start;
  for (let i = 0; i < n; i++) {
    out.push(d);
    d = addDays(d, stepDays);
  }
  return out;
}

function series(dates: string[], valueAt: (i: number) => number): FredObs[] {
  return dates.map((date, i) => ({ date, value: valueAt(i) }));
}

function base(): BridgeSeries {
  return emptyBridgeSeries();
}

console.log("\npass-through and thresholds");
{
  const up = passThrough(0.10);
  check("Δgas 0.10 → passCPI 0.0035", Math.abs(up.passCPI - 0.0035) < 1e-12, String(up.passCPI));
  check("Δgas 0.10 → passBE 0.035 pp", Math.abs(up.passBE - 0.035) < 1e-12, String(up.passBE));
  check("large gas move clips passBE at 1.0 pp", passThrough(5).passBE === 1);
  check("falling gas clips passBE at 0", passThrough(-0.2).passBE === 0);
  check("1 pp headline ≈ 10 bp: 0.35 pp → 3.5 bp", Math.abs(up.passBE * 100 - 3.5) < 1e-9);

  check("z sample [1,2,3] = 1", zscoreLatest([1, 2, 3]) === 1);
  check("z n<2 is null", zscoreLatest([1]) === null);
  check("z sd 0 is 0", zscoreLatest([2, 2, 2]) === 0);

  check("shock requires z_oil > 1.5", isSupplyShock(1.5, -0.2) === false);
  check("shock requires negative corr", isSupplyShock(1.51, 0.1) === false);
  check("shock at z>1.5 and corr<0", isSupplyShock(1.51, -0.01) === true);
  check("corr 0 is not a supply shock", isSupplyShock(3, 0) === false);
  check("rateTight is z_real > 1", isRateTight(1) === false && isRateTight(1.01) === true);
  check("wedge needs z_be > 1 and z(ΔWEI) < 0", isStagflationWedge(1.2, 0) === false);
  check("wedge fires when quantity z is negative", isStagflationWedge(1.2, -0.01) === true);
  check("missing corr is not a shock", isSupplyShock(3, null) === false);

  check("pearson of opposite moves is -1", pearson([1, 2, 3], [3, 2, 1]) === -1);
  check("duration rule +50bp ≈ -7.5%", EQUITY_DURATION.dEq === 15 && EQUITY_DURATION.plus50bpIndexPct === -7.5);
}

console.log("\nFRED csv");
{
  const csv = "DATE,VALUE\n2020-01-01,1.5\n2020-01-02,.\n2020-01-03,2\n2020-01-03,2.5\n";
  const obs = parseFredCsv(csv);
  check("skips missing and keeps last duplicate", obs.length === 2 && obs[1].value === 2.5, JSON.stringify(obs));
  check("html body is empty", parseFredCsv("<!DOCTYPE html><html></html>").length === 0);
}

console.log("\nΔwti4w is a 20-print log");
{
  const dates = datesFrom("2024-01-01", 30, 1);
  const wti = series(dates, i => (i < 10 ? 100 : 110));
  const deltas = seriesDeltas(wti, 20, "log");
  const last = deltas[deltas.length - 1];
  check("log(110/100) at t-20", Math.abs(last.delta - Math.log(1.1)) < 1e-12, String(last.delta));
}

console.log("\n20Y window ignores a 2000 rate jump");
{
  const dates: string[] = [];
  for (let d = "2000-01-01"; d <= "2026-09-04"; d = addDays(d, 1)) dates.push(d);
  const jumpAt = dates.findIndex(d => d === "2000-03-01");
  const dfii = series(dates, i => (i === jumpAt ? 51 : i === dates.length - 1 ? 1.5 : 1));
  const input = base();
  input.DFII10 = dfii;
  const bridge = computeBridge(input);
  check("recent 13W real delta is 0.5", bridge.rates.delta13w.dfii10 === 0.5, String(bridge.rates.delta13w.dfii10));
  check("z_real uses the 20Y window, not the 2000 jump", (bridge.rates.zReal ?? 0) > 1, String(bridge.rates.zReal));
  check("rateTight", bridge.flags.rateTight === true);
  check("13W lag is 65 prints", LAG_13W_DAILY === 65);
}

console.log("\nsupply shock vs boom");
{
  const n = 400;
  const dates = datesFrom("2024-01-01", n, 1);
  // Last 20 daily log-returns vary, sum to log(1.10). History is flat so z_oil is large.
  // Supply: SPX returns are the negative. Boom: SPX returns match WTI.
  // Pearson needs that day-to-day variation; two smooth opposite trends can still correlate > 0.
  const shockRets = [0.02, -0.005, 0.015, 0.004, -0.008, 0.012, 0.001, 0.009, -0.002, 0.011, 0.003, -0.004, 0.008, 0.006, -0.001, 0.007, 0.002, -0.003, 0.01, 0];
  const sumRet = shockRets.reduce((s, r) => s + r, 0);
  shockRets[shockRets.length - 1] += Math.log(1.1) - sumRet;
  function pricesFrom(flatBefore: number, rets: number[]): number[] {
    const out: number[] = [];
    let px = flatBefore;
    for (let i = 0; i < n; i++) {
      if (i >= n - rets.length) px = px * Math.exp(rets[i - (n - rets.length)]);
      out.push(px);
    }
    return out;
  }
  const wtiPx = pricesFrom(100, shockRets);
  const spxDownPx = pricesFrom(500, shockRets.map(r => -r));
  const spxUpPx = pricesFrom(500, shockRets);
  const wti = series(dates, i => wtiPx[i]);
  const spxDown = series(dates, i => spxDownPx[i]);
  const spxUp = series(dates, i => spxUpPx[i]);
  const gasDates = datesFrom("2025-01-01", 20, 7);
  const gas = series(gasDates, i => (i === gasDates.length - 1 ? 110 : 100));

  const rateDates = datesFrom("2026-06-01", 80, 1);
  const flat = (level: number) => series(rateDates, () => level);

  function pack(spx: FredObs[], beLastBump: boolean, weiDown: boolean): BridgeSeries {
    const input = base();
    input.DCOILWTICO = wti;
    input.SP500 = spx;
    input.GASREGW = gas;
    input.CPIAUCSL = [{ date: "2026-08-01", value: 321.5 }];
    input.DFF = [{ date: "2026-09-04", value: 3.75 }];
    input.DGS10 = flat(4.2);
    input.DFII10 = flat(1.85);
    input.T10YIE = series(rateDates, i => (beLastBump && i === rateDates.length - 1 ? 4 : 2.35));
    const weiDates = datesFrom("2025-01-04", 40, 7);
    input.WEI = series(weiDates, i => (weiDown && i === weiDates.length - 1 ? 0.5 : 1));
    return input;
  }

  const supply = computeBridge(pack(spxDown, true, true));
  check("shock true when oil z>1.5 and corr<0", supply.flags.shock === true && supply.oil.shock === true, `z=${supply.oil.zOil} corr=${supply.oil.corr20d}`);
  check("Δwti4w is log(110/100)", Math.abs((supply.oil.deltaWti4w ?? 0) - Math.log(1.1)) < 1e-9, String(supply.oil.deltaWti4w));
  check("Δgas_8w is +10%", Math.abs((supply.oil.deltaGas8w ?? 0) - 0.1) < 1e-12, String(supply.oil.deltaGas8w));
  check("passCPI / passBE", Math.abs((supply.oil.passCPI ?? 0) - 0.0035) < 1e-12 && Math.abs((supply.oil.passBE ?? 0) - 0.035) < 1e-12, `cpi=${supply.oil.passCPI} be=${supply.oil.passBE}`);
  check("identity residual is DGS10 − (DFII10 + T10YIE)", supply.rates.identityGap != null && Math.abs(supply.rates.identityGap - (4.2 - (1.85 + 4))) < 1e-9, String(supply.rates.identityGap));
  check("levels DGS10 DFII10 T10YIE DFF CPI", supply.rates.dgs10 === 4.2 && supply.rates.dfii10 === 1.85 && supply.rates.dff === 3.75 && supply.oil.cpi === 321.5);
  check("stagflation wedge", supply.flags.stagflationWedge === true, `zBe=${supply.rates.zBe} zWei=${supply.rates.zWei}`);
  check("equity duration rides on rates", supply.rates.equityDuration.plus50bpIndexPct === -7.5);

  const text = formatShockGeopolitics(supply);
  check("section exists only with shock", text != null && shockGeopoliticsSection(supply)?.title === "Geopolitik & Makro: Inflation, Zinsen");
  check("UI line", text?.startsWith("Öl +10.0 % / 4W · Headline-Beitrag ~0.35 pp · mechan. 10J-BE ~3.5 bp · Realzins vs BE siehe Brücke.") === true, text ?? "");
  check("chain WTI→CPI→BE→DGS10", text?.includes("Kette WTI→CPI→BE→DGS10") === true);
  check("no Hormuz paragraph", text != null && !text.includes("Hormuz"));
  check("April essay is not the chain", text != null && !text.includes("Exogene Energie"));

  const boom = computeBridge(pack(spxUp, false, false));
  check("boom corr is not a supply shock", boom.flags.shock === false, `z=${boom.oil.zOil} corr=${boom.oil.corr20d}`);
  check("!shock hides geopolitics", formatShockGeopolitics(boom) === null && shockGeopoliticsSection(boom) === null);
  check("flat real yield is not rateTight", boom.flags.rateTight === false);
  check("flat bridge identity holds", boom.rates.identityGap === 0, String(boom.rates.identityGap));
  check("no wedge without a soft WEI", boom.flags.stagflationWedge === false);
}

console.log(failed === 0 ? "\n✅ Alle Recession-Bridge-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
