/**
 * F9-17 Historische Validierung der Makro-Ebene (2000 / 2008 / 2022) — nur Lesen, kein Score-Eingriff.
 *
 * Baut zu Stichtagen die bestehenden Rezessions-Slots point-in-time aus den exportierten Readern von
 * server/recession.ts nach (FRED fredgraph.csv über fetchFredCsv, multpl CAPE, FINRA Margin) und stellt
 * bestehendes P (Formel bzw. mit NY-Fed-Anker) der Makro-Ebene gegenüber.
 * Sichtbarkeit: Beobachtung zählt erst ab Datum + Veröffentlichungsverzug (VIS_LAG_DAYS).
 * Grenzen: aktuelle FRED-Vintage (Revisionen nicht zurückgedreht, kein ALFRED); Buffett, Google Trends,
 * CNN F&G, WEI historisch n/a (nicht nachbaubar) → wie im Live-Pfad: n/a zählt weder net noch max.
 * Ausführen: npx tsx script/f9-macro-history.ts [--write]   (Ergebnis: script/fixtures/macro/f9-history-2026-10-18.json)
 * F9-07/10/11: --gaps rechnet zusätzlich Konzentration (SPY/RSP ab 2003), Managing (EPS multpl, Realzins, Konzentration)
 * und Widersprüche point-in-time; Ergebnis getrennt in script/fixtures/macro/f9-history-gaps-2026-10-18.json.
 * Ohne --gaps bleibt die Ausgabe unverändert.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchFredCsv, fredCsvObservations, type FredObservation } from "../server/fred-csv";
import {
  activityIndicator, anchoredRecessionProbability, capeFromPoint, creditReading, crowdReading, csiReading, durableReading,
  finraMarginPoints, latestMultplCape, m2Reading, marginDebtReading, probabilityFromNet, scoredTotals, vixReading,
  yieldCurveReading, yoyPercent, type IndicatorResult,
} from "../server/recession";
import { sahmIndicatorFromScore, scoreSahmFromUnemployment, SAHM_HISTORY_YEARS } from "../server/recession-sahm";
import { buildMacroLayer, detectHabitat, type MacroIndicatorInput } from "../shared/macro-layer";
import { computeConcentration, computeContradictions, computeManaging, epsGrowthVsTrend, gapInputs, type PriceBar } from "../shared/macro-layer-gaps";
import { altFetchYahooThenStooq } from "../server/history-fallback";
import { MULTPL_EPS_URL, parseMultplMonthlyTable } from "../server/macro-layer-gaps";

const GAPS = process.argv.includes("--gaps");
/** multpl TTM-EPS (Monatsende) gilt erst nach Quartalsberichtssaison als bekannt. */
export const EPS_VIS_LAG_DAYS = 90;

async function bars(symbol: string): Promise<PriceBar[]> {
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/${symbol}-bars.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const b = (await altFetchYahooThenStooq(symbol, "2002-01-01", "2026-10-18")).map(x => ({ date: x.date, close: x.close }));
  if (b.length) writeFileSync(f, JSON.stringify(b));
  return b;
}

export const F9_HISTORY_DATES = ["2000-03-31", "2000-09-29", "2007-10-31", "2007-12-31", "2008-09-30", "2022-01-31", "2022-06-30", "2026-10-15"];

/** Veröffentlichungsverzug in Tagen ab FRED-Beobachtungsdatum (Monatsreihen: Monatsanfang). */
export const VIS_LAG_DAYS: Record<string, number> = {
  UNRATE: 37, SAHMREALTIME: 37, INDPRO: 47, TCU: 47, DGORDER: 60, M2SL: 56, UMCSENT: 31, RECPROUSM156N: 62,
  T10Y2Y: 1, T10Y3M: 1, BAA10Y: 1, VIXCLS: 1, DFII10: 1, DFF: 1, CAPE: 31, MARGIN: 50,
};

const CACHE = "/tmp/f9-history-cache";
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const yearsBack = (iso: string, y: number) => `${Number(iso.slice(0, 4)) - y}${iso.slice(4)}`;

async function fred(id: string): Promise<FredObservation[]> {
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/${id}.csv`;
  let csv = existsSync(f) ? readFileSync(f, "utf8") : null;
  if (!csv) {
    csv = await fetchFredCsv(id, "1975-01-01", 60000, 3);
    if (csv) writeFileSync(f, csv);
  }
  return fredCsvObservations(csv);
}

async function text(url: string, file: string, binary = false): Promise<Buffer | null> {
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/${file}`;
  if (existsSync(f)) return readFileSync(f);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); writeFileSync(f, b); return b; }
    } catch { /* retry */ }
  }
  return null;
}

const visible = (obs: FredObservation[], id: string, asOf: string) => obs.filter(o => addDays(o.date, VIS_LAG_DAYS[id] ?? 1) <= asOf);
const last = (obs: FredObservation[]) => (obs.length ? obs[obs.length - 1].value : NaN);

export async function main() {
  const ids = ["UNRATE", "SAHMREALTIME", "T10Y2Y", "T10Y3M", "INDPRO", "TCU", "DGORDER", "M2SL", "BAA10Y", "UMCSENT", "VIXCLS", "RECPROUSM156N", "DFII10", "DFF"];
  const s: Record<string, FredObservation[]> = {};
  for (const id of ids) s[id] = await fred(id);
  const capeHtml = (await text("https://www.multpl.com/shiller-pe/table/by-month", "cape.html"))?.toString("utf8") ?? "";
  const capeRows = (capeHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).flatMap(r => { const p = latestMultplCape(`<table>${r}</table>`); return p ? [p] : []; })
    .sort((a, b) => a.date.localeCompare(b.date));
  const marginBuf = await text("https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx", "margin.xlsx", true);
  const margin = marginBuf ? finraMarginPoints(marginBuf) : [];
  const coverage = Object.fromEntries([...ids.map(id => [id, s[id].length ? `${s[id][0].date}…${s[id].at(-1)!.date} (${s[id].length})` : "n/a"]),
    ["CAPE", capeRows.length ? `${capeRows[0].date}…${capeRows.at(-1)!.date}` : "n/a"], ["MARGIN", margin.length ? `${margin[0].date}…${margin.at(-1)!.date}` : "n/a"]]);

  const spy = GAPS ? await bars("SPY") : [];
  const rsp = GAPS ? await bars("RSP") : [];
  const epsAll = GAPS ? parseMultplMonthlyTable((await text(MULTPL_EPS_URL, "eps.html"))?.toString("utf8")) : [];
  const gapRows = [];
  const rows = [];
  for (const asOf of F9_HISTORY_DATES) {
    const v = (id: string, years?: number) => { const o = visible(s[id], id, asOf); return years ? o.filter(p => p.date >= yearsBack(asOf, years)) : o; };
    const sahmCut = yearsBack(asOf, SAHM_HISTORY_YEARS);
    const sahmScore = scoreSahmFromUnemployment(v("UNRATE").filter(p => p.date >= sahmCut), v("SAHMREALTIME").filter(p => p.date >= sahmCut));
    const sc = sahmIndicatorFromScore(sahmScore.score);
    const sahm: IndicatorResult = { name: "Sahm-Regel", group: "recession", subgroup: "coincident", value: sc.value, rawScore: sc.rawScore, weight: sc.weight,
      weightedScore: sc.weightedScore, maxWeighted: sc.maxWeighted, zone: sc.zone, source: "FRED SAHMREALTIME", description: "", available: sc.available };
    const tcu = last(v("TCU"));
    const t3m = last(v("T10Y3M"));
    const vix = last(v("VIXCLS"));
    const capeVis = capeRows.filter(p => addDays(p.date, VIS_LAG_DAYS.CAPE) <= asOf);
    const marginVis = margin.filter(p => addDays(p.date, VIS_LAG_DAYS.MARGIN) <= asOf);
    const inds: IndicatorResult[] = [
      sahm,
      yieldCurveReading(v("T10Y2Y", 20), Number.isFinite(t3m) ? t3m : null),
      activityIndicator(v("INDPRO", 3), Number.isFinite(tcu) ? tcu : null),
      durableReading(yoyPercent(v("DGORDER", 3))),
      m2Reading(yoyPercent(v("M2SL", 3))),
      creditReading(last(v("BAA10Y"))),
      csiReading(last(v("UMCSENT"))),
      capeFromPoint(capeVis.length ? capeVis[capeVis.length - 1] : null, asOf),
      marginVis.length ? marginDebtReading(marginVis) : { ...marginDebtReading([]) },
      ...(Number.isFinite(vix) ? [vixReading(vix)] : []),
      crowdReading(null, Number.isFinite(vix) ? vix : null, false),
    ];
    const naSlots = ["Buffett Indikator (TMC/GDP)", "Google Trends \"Recession\"", "CNN Fear & Greed (live)", "Weekly Nowcast (WEI)"];
    const rec = inds.filter(i => i.group === "recession");
    const cor = inds.filter(i => i.group === "correction");
    const rt = scoredTotals(rec), ct = scoredTotals(cor);
    const ny = last(v("RECPROUSM156N"));
    const anchored = anchoredRecessionProbability(rt.net, rt.max, Number.isFinite(ny) ? ny : null);
    const habitat = detectHabitat({
      realYieldMonthly: v("DFII10").filter(p => p.date >= yearsBack(asOf, 21)),
      fedFunds: v("DFF").filter(p => p.date >= yearsBack(asOf, 2)),
      concentration: null,
    });
    const input: MacroIndicatorInput[] = inds.map(i => ({ name: i.name, group: i.group, weightedScore: i.weightedScore, maxWeighted: i.maxWeighted, available: i.available }));
    const layer = buildMacroLayer({ asOf, indicators: input, habitat, ai: null, aiStatus: "disabled" });
    if (GAPS) {
      const conc = computeConcentration(spy.filter(b => b.date <= asOf), rsp.filter(b => b.date <= asOf));
      const habG = detectHabitat({
        realYieldMonthly: v("DFII10").filter(p => p.date >= yearsBack(asOf, 21)),
        fedFunds: v("DFF").filter(p => p.date >= yearsBack(asOf, 2)),
        concentration: conc.value,
      });
      const epsVis = epsAll.filter(p => addDays(p.date, EPS_VIS_LAG_DAYS) <= asOf);
      const gaps = {
        concentration: conc,
        managing: computeManaging({ eps: epsVis.length ? epsGrowthVsTrend(epsVis) : null, realYield: habG.realYield, realYieldZ: habG.realYieldZ, concentration: conc }),
        widersprueche: computeContradictions(input),
      };
      const lg = buildMacroLayer({ asOf, indicators: [...input, ...gapInputs(gaps)], habitat: habG, ai: null, aiStatus: "disabled" });
      gapRows.push({
        asOf,
        habitat: { regime: habG.regime, concentration: conc.value },
        recession: { anchored: anchored.probability, layerF9: layer.recession.layer, layerGaps: lg.recession.layer },
        correction: { formula: probabilityFromNet(ct.net, ct.max), layerF9: layer.correction.layer, layerGaps: lg.correction.layer },
        concentration: { value: conc.value, z: conc.z, rslCap: conc.rslCap, rslEqual: conc.rslEqual, note: conc.note },
        managing: { score: gaps.managing.score, components: gaps.managing.components.map(c => ({ id: c.id, value: c.value, z: c.z, component: c.component })) },
        widersprueche: { score: gaps.widersprueche.score, pairs: gaps.widersprueche.pairs.map(p => ({ id: p.id, scoreA: p.scoreA, scoreB: p.scoreB, contradiction: p.contradiction })) },
        weights: Object.fromEntries(lg.dimensions.map(d => [d.id, d.finalWeight == null ? null : Math.round(d.finalWeight * 1000) / 1000])),
      });
    }
    rows.push({
      asOf,
      habitat: { regime: habitat.regime, realYieldZ: habitat.realYieldZ, fedFundsChange12mPp: habitat.fedFundsChange12mPp },
      recession: { formula: probabilityFromNet(rt.net, rt.max), anchored: anchored.probability, nyFed: Number.isFinite(ny) ? ny : null, layer: layer.recession.layer },
      correction: { formula: probabilityFromNet(ct.net, ct.max), layer: layer.correction.layer },
      weights: Object.fromEntries(layer.dimensions.map(d => [d.id, d.finalWeight == null ? null : Math.round(d.finalWeight * 1000) / 1000])),
      slots: inds.map(i => ({ name: i.name, value: i.value, weightedScore: i.weightedScore, maxWeighted: i.maxWeighted, available: i.available !== false })),
      naSlots,
    });
  }
  const out = { generated: "2026-10-18", note: "aktuelle FRED-Vintage; Buffett/Google/CNN/WEI n/a; Habitat-Konzentration n/a (F9-07); Gewichte deterministisch", coverage, rows };
  console.log("| Stichtag | Habitat | P_rez Formel | P_rez Anker (bestehend) | P_rez Makro-Ebene | P_korr bestehend | P_korr Makro-Ebene | gewertete Slots |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const n = r.slots.filter(x => x.available && x.maxWeighted > 0).length;
    const p = (x: number | null) => (x == null ? "n/a" : `${x}%`);
    console.log(`| ${r.asOf} | ${r.habitat.regime ?? "n/a"} | ${p(r.recession.formula)} | ${p(r.recession.anchored)} | ${p(r.recession.layer)} | ${p(r.correction.formula)} | ${p(r.correction.layer)} | ${n}/${r.slots.length} |`);
  }
  if (process.argv.includes("--write") && !GAPS) writeFileSync("script/fixtures/macro/f9-history-2026-10-18.json", JSON.stringify(out, null, 2) + "\n");
  if (GAPS) {
    const p = (x: number | null) => (x == null ? "n/a" : `${x}%`);
    const f = (x: number | null, d = 2) => (x == null ? "n/a" : x.toFixed(d));
    console.log("\n| Stichtag | Konzentration | Managing | Widersprüche | P_rez bestehend | P_rez F9 | P_rez F9+Lücken | P_korr bestehend | P_korr F9 | P_korr F9+Lücken |");
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const g of gapRows) {
      console.log(`| ${g.asOf} | ${f(g.concentration.value, 3)} | ${f(g.managing.score)} | ${f(g.widersprueche.score)} | ${p(g.recession.anchored)} | ${p(g.recession.layerF9)} | ${p(g.recession.layerGaps)} | ${p(g.correction.formula)} | ${p(g.correction.layerF9)} | ${p(g.correction.layerGaps)} |`);
    }
    const outG = { generated: "2026-10-18", note: "wie f9-history; zusätzlich F9-07/10/11; SPY/RSP Yahoo-Chart (frei), EPS multpl (Sichtbarkeit +90 T); CAPEX n/a", rows: gapRows };
    if (process.argv.includes("--write")) writeFileSync("script/fixtures/macro/f9-history-gaps-2026-10-18.json", JSON.stringify(outG, null, 2) + "\n");
  }
  return out;
}

main().catch(err => { console.error(err); process.exit(1); });
