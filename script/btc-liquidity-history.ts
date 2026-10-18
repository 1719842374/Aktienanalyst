/**
 * Vorher/Nachher-Tabelle BTC-Score (GIS/GWS) + Einzelkomponenten an festen Stichtagen.
 *
 * Läuft den ECHTEN analyzeBTC() (client/src/lib/btcAnalysis.ts) in Node mit gemocktem fetch
 * und gemockter Uhr: jede Quelle wird aus einer vollständigen Historie (Fixture) auf den
 * Stichtag abgeschnitten (point-in-time mit Veröffentlichungsverzug).
 *   Vorher  = Liquiditäts-Endpoint nicht erreichbar (= Code ohne Block); zusätzlich wird
 *             analyzeBTC von main 35ead515 (git show) mit denselben Mocks gerechnet → muss identisch sein.
 *   Nachher = Liquiditäts-Endpoint liefert computeBtcLiquidityBlock(Fixtures, Stichtag).
 *
 * Fixtures: script/fixtures/btc-liquidity/ (freie Quellen, Abrufzeit in meta.json).
 *   npx tsx script/btc-liquidity-history.ts            # Fixtures nutzen (fehlende werden geladen)
 *   npx tsx script/btc-liquidity-history.ts --refresh  # alle Fixtures neu laden, Stichtag „jetzt“ = heute
 * Ausgabe: Markdown auf stdout + script/fixtures/btc-liquidity/history-table.md
 *
 * NICHT rekonstruierbar (gekennzeichnet in der Tabelle):
 *  - ETF Net Flows: Farside-Historie nicht frei abrufbar → analyzeBTC-eigener 7d-Momentum-Proxy.
 *  - Macro-Slot: fiscal-frontend (FE_30/MSPD/DTS) nicht point-in-time → historisch FFR-Regel
 *    (analyzeBTC-Fallback). Nur „heute (App-Pfad)“ nutzt die aufgezeichnete fiscal-frontend-Antwort.
 *  - DXY: Binance EURUSDT nicht historisch → FRED DEXUSEU als EUR/USD-Proxy in derselben Formel.
 *  - Hashrate: mempool /3m nicht historisch → /all auf 90 T. vor Stichtag geschnitten, currentHashrate = letzter Tageswert.
 *  - Zyklus: analyzeBTC rechnet fest mit Halving 2024-04-20 → für 2020/2022 negative Monate, Zyklus-Signal dort nicht aussagekräftig.
 *  - FRED-Revisionen (ALFRED-Vintages) nicht nachgebildet: heutiger Datenstand mit Veröffentlichungsverzug.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchFredCsv, fredCsvObservations } from "../server/fred-csv";
import { addDays, BTC_LIQUIDITY_SERIES, type LiquidityObs } from "../shared/btc-liquidity";
import { buildBtcLiquidityResponse } from "../server/btc-liquidity";

const ROOT = process.cwd();
const FIX = path.join(ROOT, "script/fixtures/btc-liquidity");
const REFRESH = process.argv.includes("--refresh");
const MAIN_SHA = "35ead515";

const SOURCES = {
  blockchain: { file: "blockchain-market-price-all.json", url: "https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true" },
  fng: { file: "fng-all.json", url: "https://api.alternative.me/fng/?limit=0&format=json" },
  hashrate: { file: "mempool-hashrate-all.json", url: "https://mempool.space/api/v1/mining/hashrate/all" },
} as const;
const FRED_IDS = ["FEDFUNDS", "DEXUSEU", BTC_LIQUIDITY_SERIES.walcl, BTC_LIQUIDITY_SERIES.dgs10, BTC_LIQUIDITY_SERIES.bills, BTC_LIQUIDITY_SERIES.otherMarketable] as const;
const FRED_COSD: Record<string, string> = { FEDFUNDS: "2015-01-01", DEXUSEU: "2015-01-01", WALCL: "2002-12-01", DGS10: "2015-01-01", BOGZ1FL313161110Q: "1990-01-01", BOGZ1FL313161275Q: "1990-01-01" };
/** Veröffentlichungsverzug in Tagen (Datum + lag ≤ Stichtag). FEDFUNDS: Monatsmittel, ~1. Werktag Folgemonat. */
const FRED_LAG: Record<string, number> = { FEDFUNDS: 32, DEXUSEU: 1 };

async function ensureFixtures(): Promise<{ meta: Record<string, string> }> {
  mkdirSync(FIX, { recursive: true });
  const metaPath = path.join(FIX, "meta.json");
  const meta: Record<string, string> = existsSync(metaPath) && !REFRESH ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  for (const [key, s] of Object.entries(SOURCES)) {
    const p = path.join(FIX, s.file);
    if (existsSync(p) && !REFRESH) continue;
    const res = await fetch(s.url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
    let body: any = await res.json();
    // Hashrate: nur Tageswerte ab 2019 (frühester Stichtag 2020-06-30 braucht 90 T.), difficulty-Teil nicht gebraucht
    if (key === "hashrate") body = { hashrates: (body.hashrates as any[]).filter(h => h.timestamp >= Date.parse("2019-01-01T00:00:00Z") / 1000) };
    writeFileSync(p, JSON.stringify(body));
    meta[key] = `${s.url} @ ${new Date().toISOString()}`;
  }
  for (const id of FRED_IDS) {
    const p = path.join(FIX, `${id}.csv`);
    if (existsSync(p) && !REFRESH) continue;
    const csv = await fetchFredCsv(id, FRED_COSD[id]);
    if (!csv || fredCsvObservations(csv).length === 0) throw new Error(`FRED ${id}: kein CSV (fetchFredCsv null)`);
    writeFileSync(p, csv);
    meta[id] = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${FRED_COSD[id]} @ ${new Date().toISOString()}`;
  }
  const fiscalPath = path.join(FIX, "fiscal-frontend-heute.json");
  if (!existsSync(fiscalPath) || REFRESH) {
    const { buildFiscalFrontendResponse } = await import("../server/fiscal-frontend");
    const body = await buildFiscalFrontendResponse();
    writeFileSync(fiscalPath, JSON.stringify(body));
    meta.fiscalFrontend = `buildFiscalFrontendResponse() @ ${body.fetchedAt}`;
  }
  if (!meta.today || REFRESH) meta.today = new Date().toISOString().slice(0, 10);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { meta };
}

const readJson = (f: string) => JSON.parse(readFileSync(path.join(FIX, f), "utf8"));
const fred = (id: string): LiquidityObs[] => fredCsvObservations(readFileSync(path.join(FIX, `${id}.csv`), "utf8"));
const visible = (obs: LiquidityObs[], asOf: string, lag: number) => obs.filter(o => addDays(o.date, lag) <= asOf);

interface Scenario { label: string; asOf: string; withLiquidity: boolean; fiscal: "none" | "recorded" }

function makeFetch(sc: Scenario, unexpected: Set<string>) {
  const cutoffMs = Date.parse(`${sc.asOf}T23:59:59Z`);
  const cutoffSec = Math.floor(cutoffMs / 1000);
  const blockchain = readJson(SOURCES.blockchain.file);
  const fng = readJson(SOURCES.fng.file);
  const hashrate = readJson(SOURCES.hashrate.file);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const text = (body: string, status = 200) => new Response(body, { status });

  const fngVisible = (fng.data as any[]).filter(d => Number(d.timestamp) <= cutoffSec); // neueste zuerst
  return async (input: any): Promise<Response> => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.startsWith("https://api.alternative.me/fng/?limit=1")) return json({ data: fngVisible.slice(0, 1) });
    if (url.startsWith("https://api.alternative.me/fng/?limit=2000")) return json({ data: fngVisible.slice(0, 2000) });
    if (url.includes("fredgraph.csv?id=FEDFUNDS")) {
      const obs = visible(fred("FEDFUNDS"), sc.asOf, FRED_LAG.FEDFUNDS);
      return text(["observation_date,FEDFUNDS", ...obs.map(o => `${o.date},${o.value}`)].join("\n") + "\n");
    }
    if (url.startsWith("https://api.blockchain.info/charts/market-price")) {
      return json({ ...blockchain, values: (blockchain.values as any[]).filter(v => v.x <= cutoffSec) });
    }
    if (url.includes("ticker/24hr?symbol=EURUSDT")) {
      const obs = visible(fred("DEXUSEU"), sc.asOf, FRED_LAG.DEXUSEU);
      if (!obs.length) return json({}, 404);
      return json({ lastPrice: String(obs[obs.length - 1].value) });
    }
    if (url.startsWith("https://mempool.space/api/v1/mining/hashrate/3m")) {
      const from = cutoffSec - 90 * 86400;
      const hs = (hashrate.hashrates as any[]).filter(h => h.timestamp > from && h.timestamp <= cutoffSec);
      return json({ hashrates: hs, currentHashrate: hs.length ? hs[hs.length - 1].avgHashrate : 0 });
    }
    if (url.includes("/api/analyze-btc/liquidity")) {
      if (!sc.withLiquidity) return text("not found", 404);
      const series = {
        walcl: fred(BTC_LIQUIDITY_SERIES.walcl),
        bills: fred(BTC_LIQUIDITY_SERIES.bills),
        otherMarketable: fred(BTC_LIQUIDITY_SERIES.otherMarketable),
        dgs10: fred(BTC_LIQUIDITY_SERIES.dgs10),
      };
      return json(buildBtcLiquidityResponse(series, sc.asOf));
    }
    if (url.includes("/api/analyze-btc/fiscal-frontend")) {
      return sc.fiscal === "recorded" ? json(readJson("fiscal-frontend-heute.json")) : text("n/a", 503);
    }
    if (url.includes("/api/analyze-btc/macro-history")) return text("n/a", 503);
    // ETF (Farside/GitHub), Binance-Klines, CoinGecko: nicht historisch → Ausfall wie im Client vorgesehen
    if (url.includes("raw.githubusercontent.com") || url.includes("api.binance.com") || url.includes("api.coingecko.com")) {
      return text("offline (historisch nicht rekonstruierbar)", 404);
    }
    unexpected.add(url);
    return text("unexpected", 404);
  };
}

type Analyze = (force?: boolean) => Promise<any>;

async function runAt(analyze: Analyze, sc: Scenario, unexpected: Set<string>) {
  const RealDate = Date;
  const fixed = RealDate.parse(`${sc.asOf}T23:59:59Z`);
  class FakeDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [any]));
    }
    static now() { return fixed; }
  }
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  (globalThis as any).Date = FakeDate;
  globalThis.fetch = makeFetch(sc, unexpected) as any;
  console.log = () => {};
  try {
    return await analyze(true);
  } finally {
    (globalThis as any).Date = RealDate;
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

async function loadMainAnalyze(): Promise<{ analyze: Analyze; cleanup: () => void }> {
  const src = execFileSync("git", ["show", `${MAIN_SHA}:client/src/lib/btcAnalysis.ts`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (/^import /m.test(src)) throw new Error("main-btcAnalysis hat Imports – Kopie nicht eigenständig");
  const tmp = path.join(ROOT, "script", `.main-btcAnalysis-${MAIN_SHA}.tmp.ts`);
  writeFileSync(tmp, src);
  const mod = await import(pathToFileURL(tmp).href);
  return { analyze: mod.analyzeBTC, cleanup: () => { try { unlinkSync(tmp); } catch { /* egal */ } } };
}

const f = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(d));

async function main() {
  const { meta } = await ensureFixtures();
  const today = meta.today;
  const scenarios: Omit<Scenario, "withLiquidity">[] = [
    { label: "QE 2020", asOf: "2020-06-30", fiscal: "none" },
    { label: "QT 2022", asOf: "2022-10-31", fiscal: "none" },
    { label: `jetzt (rekonstr.)`, asOf: today, fiscal: "none" },
    { label: `heute (App-Pfad)`, asOf: today, fiscal: "recorded" },
  ];
  const { analyzeBTC } = await import("../client/src/lib/btcAnalysis");
  const mainMod = await loadMainAnalyze();
  const unexpected = new Set<string>();
  const rows: any[] = [];
  let parityFail = 0;
  try {
    for (const s of scenarios) {
      const before = await runAt(analyzeBTC, { ...s, withLiquidity: false }, unexpected);
      const beforeMain = await runAt(mainMod.analyze, { ...s, withLiquidity: false }, unexpected);
      const after = await runAt(analyzeBTC, { ...s, withLiquidity: true }, unexpected);
      const parity = before.gis === beforeMain.gis && before.gws.value === beforeMain.gws.value;
      if (!parity) parityFail++;
      rows.push({ s, before, beforeMain, after, parity });
    }
  } finally {
    mainMod.cleanup();
  }

  const ind = (a: any, name: string) => a.indicators.find((i: any) => i.name === name);
  const names = ["MVRV Z-Score", "RSI (Weekly)", "Fear & Greed", "Hashrate Trend", "ETF Net Flows", "Macro (Fed/M2)", "DXY"];
  const marks: Record<string, string> = {
    "Hashrate Trend": " ²", "ETF Net Flows": " ³", "Macro (Fed/M2)": " ⁴", DXY: " ⁵",
  };
  const header = `| Zeile | ${rows.map(r => `${r.s.label} ${r.s.asOf}`).join(" | ")} |`;
  const sep = `|---|${rows.map(() => "---").join("|")}|`;
  const lines: string[] = [header, sep];
  const add = (label: string, cell: (r: any) => string) => lines.push(`| ${label} | ${rows.map(cell).join(" | ")} |`);
  add("BTC-Kurs (letzter Punkt ≤ Stichtag)", r => `$${Math.round(r.before.btcPrice).toLocaleString("en-US")}`);
  for (const n of names) {
    add(`${n}${marks[n] ?? ""}: Score (Wert)`, r => { const i = ind(r.before, n); return `${f(i.score, 1)} (${i.value})`; });
  }
  add("Gewicht je Alt-Indikator vorher → nachher", r => (r.after.liquidity?.available ? "×1 → ×0,85" : "×1 → ×1 (Block n/a)"));
  for (const key of ["walcl", "bills", "dgs10"]) {
    add(`Liquidität ${key.toUpperCase()}: Score (Wert, Stand)`, r => {
      const c = r.after.liquidity?.components.find((x: any) => x.key === key);
      if (!c) return "n/a";
      return c.available ? `${f(c.score, 1)} (${c.value}; ${c.asOf}; Anteil ${(c.effectiveSubWeight * 100).toFixed(1)} %)` : `n/a (${c.note})`;
    });
  }
  add("Liquiditätsblock L (Abdeckung)", r => (r.after.liquidity?.available ? `${f(r.after.liquidity.score, 3)} (${(r.after.liquidity.coverage * 100).toFixed(0)} %)` : `n/a`));
  add("**GIS vorher**", r => `**${f(r.before.gis, 4)}**`);
  add("**GIS nachher**", r => `**${f(r.after.gis, 4)}**`);
  add("Δ GIS", r => f(r.after.gis - r.before.gis, 4));
  add("Power-Law-Signal", r => f(r.before.gws.powerSignal, 1));
  add("Zyklus-Signal ¹", r => `${f(r.before.gws.cycleSignal, 1)} (${r.before.monthsSinceHalving} M)`);
  add("**GWS vorher**", r => `**${f(r.before.gws.value, 4)}**`);
  add("**GWS nachher**", r => `**${f(r.after.gws.value, 4)}**`);
  add("Δ GWS", r => f(r.after.gws.value - r.before.gws.value, 4));
  add("Vorher = main 35ead515 (GIS & GWS identisch)", r => (r.parity ? "✅" : `❌ main GIS ${f(r.beforeMain.gis, 4)}`));

  const notes = [
    "",
    "¹ Zyklus: analyzeBTC rechnet fest mit Halving 2024-04-20; für 2020/2022 ergibt das negative Monate → Zyklus-Signal historisch NICHT aussagekräftig (bestehendes Verhalten, unverändert).",
    "² Hashrate: mempool /all auf 90 T. vor Stichtag geschnitten (Proxy für /3m).",
    "³ ETF: Farside-Historie nicht rekonstruierbar → analyzeBTC-eigener 7d-Momentum-Proxy (in allen Spalten, auch heute).",
    "⁴ Macro: historisch und „jetzt (rekonstr.)“ FFR-Regel (fiscal-frontend nicht point-in-time); „heute (App-Pfad)“ mit aufgezeichneter fiscal-frontend-Antwort.",
    "⁵ DXY: FRED DEXUSEU als EUR/USD-Proxy für Binance EURUSDT in derselben Formel.",
    "Alle Reihen point-in-time mit Veröffentlichungsverzug (WALCL/DGS10/DEXUSEU +1 T., FEDFUNDS +32 T., Z.1 +165 T.); FRED-Revisionen (ALFRED) nicht nachgebildet.",
    "BTC-Kurs: blockchain.info market-price (timespan=all, 4-Tage-Raster) bis Stichtag; CoinGecko-Spot nicht historisch → letzter Punkt.",
    `Fixtures: ${Object.entries(meta).filter(([k]) => k !== "today").map(([k, v]) => `${k} = ${v}`).join("; ")}`,
  ];
  const out = [`### Vorher/Nachher BTC-Score (Skript script/btc-liquidity-history.ts)`, "", ...lines, ...notes].join("\n");
  console.log(out);
  writeFileSync(path.join(FIX, "history-table.md"), out + "\n");
  if (unexpected.size) console.error(`Unerwartete URLs (404 geliefert): ${[...unexpected].join(", ")}`);
  if (parityFail) {
    console.error(`❌ ${parityFail} Stichtag(e): Vorher ≠ main`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
