/**
 * #225-Fix: FMP-Fehler mitten in der Reihe -> unvollstaendig, max. 10 min Cache; In-Flight-Sperre.
 * Ausfuehren: npx tsx script/test-gold-chart-history-cache.ts
 */
import { readFileSync } from "node:fs";
import { fetchFmpChunks, createChartHistoryCache, historyWindows, CHART_HISTORY_TTL_MS, CHART_HISTORY_INCOMPLETE_TTL_MS } from "../server/gold-chart-history";

let failed = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✅ ${name}`); else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const W = historyWindows("2026-10-11", 60, 15);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `20${String(i % 90).padStart(2, "0")}-01-01`, close: 1 }));

async function main() {
  console.log("\nFMP-Fenster: Ende vs. Fehler");
  {
    const end = await fetchFmpChunks(W, async (from) => (from >= "1996" ? rows(3) : []));
    check("leeres Fenster = normales Ende, nicht unvollstaendig", end.failedWindow === null && end.chunks.length === 2, end);
    let calls = 0;
    const err = await fetchFmpChunks(W, async () => { calls++; if (calls === 2) throw new Error("HTTP 429"); return rows(3); });
    check("Fehler im 2. Block -> failedWindow gesetzt", err.failedWindow?.from === W[1].from && err.failedWindow.error.includes("429"), err.failedWindow);
    check("Bloecke davor bleiben erhalten, danach kein weiterer Abruf", err.chunks.length === 1 && calls === 2);
    const first = await fetchFmpChunks(W, async () => { throw new Error("kein Key"); });
    check("Fehler schon im 1. Block -> leer + failedWindow", first.chunks.length === 0 && first.failedWindow?.from === W[0].from);
  }

  console.log("\nCache-Laufzeiten");
  {
    let t = 0; let loads = 0; let incomplete = true;
    const cache = createChartHistoryCache(async () => { loads++; return { incomplete, n: loads }; }, () => t);
    await cache.get();
    t = CHART_HISTORY_INCOMPLETE_TTL_MS - 1; await cache.get();
    check("unvollstaendig: innerhalb 10 min aus dem Cache", loads === 1, loads);
    t = CHART_HISTORY_INCOMPLETE_TTL_MS + 1; incomplete = false; await cache.get();
    check("unvollstaendig: nach 10 min neu geladen (nicht 6 h)", loads === 2, loads);
    t += CHART_HISTORY_TTL_MS - 1; await cache.get();
    check("vollstaendig: 6 h gecacht", loads === 2, loads);
    t += 2; await cache.get();
    check("vollstaendig: nach 6 h neu geladen", loads === 3, loads);
    check("TTL-Werte 6 h / 10 min", CHART_HISTORY_TTL_MS === 216e5 && CHART_HISTORY_INCOMPLETE_TTL_MS === 6e5);

    let t2 = 0; let l2 = 0;
    const c2 = createChartHistoryCache(async () => { l2++; return { incomplete: false, shortCache: true }; }, () => t2);
    await c2.get(); t2 = CHART_HISTORY_INCOMPLETE_TTL_MS + 1; await c2.get();
    check("shortCache (FMP-Fehler, Yahoo gezeigt): ebenfalls nur 10 min", l2 === 2, l2);

    let l3 = 0; let fail = true;
    const c3 = createChartHistoryCache(async () => { l3++; if (fail) throw new Error("x"); return { incomplete: false }; });
    await c3.get().catch(() => {}); fail = false; await c3.get();
    check("Fehler werden nicht gecacht (naechste Anfrage laedt neu)", l3 === 2, l3);
  }

  console.log("\nIn-Flight-Sperre");
  {
    let loads = 0; let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const cache = createChartHistoryCache(async () => { loads++; await gate; return { incomplete: false, id: loads }; });
    const ps = [cache.get(), cache.get(), cache.get(), cache.get()];
    release();
    const res = await Promise.all(ps);
    check("4 gleichzeitige erste Anfragen -> 1 Ladevorgang", loads === 1, loads);
    check("alle bekommen dasselbe Ergebnis", res.every(r => r === res[0]));
    await cache.get();
    check("danach aus dem Cache", loads === 1);
    let l2 = 0; let rel2!: () => void;
    const g2 = new Promise<void>(r => { rel2 = r; });
    const c2 = createChartHistoryCache(async () => { l2++; await g2; throw new Error("boom"); });
    const both = [c2.get().catch(e => e.message), c2.get().catch(e => e.message)];
    rel2();
    const errs = await Promise.all(both);
    check("geteilter Fehler: 1 Ladevorgang, beide sehen den Fehler", l2 === 1 && errs.every(m => m === "boom"), [l2, errs]);
    await c2.get().catch(() => {});
    check("Sperre wird nach Fehler freigegeben", l2 === 2, l2);
  }

  console.log("\nVerdrahtung");
  {
    const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf-8");
    const hist = routes.slice(routes.indexOf("createChartHistoryCache(async"));
    check("Route nutzt fetchFmpChunks + createChartHistoryCache", hist.includes("fetchFmpChunks(") && routes.includes("chartHistory.get()"));
    check("Antwort traegt incomplete/incompleteReason/shortCache", hist.includes("incomplete,") && hist.includes("incompleteReason:") && hist.includes("shortCache: !!fmp.failedWindow"));
    check("kein fester 6-h-Cache mehr in der Route", !routes.includes("chartHistoryCache"));
    const chart = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf-8");
    check("Chart zeigt 'unvollständig'", chart.includes('data-testid="gold-range-incomplete"') && chart.includes("unvollständig"));
    check("Client haelt unvollstaendige Daten nur 10 min", chart.includes("query.state.data?.incomplete ? 10 * 60 * 1000"));
  }

  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll gold chart-history cache checks passed.");
}
main();
