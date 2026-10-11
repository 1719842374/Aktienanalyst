/**
 * JOB 15: Antwort-Cache für /api/analyze-gold (10 min) + Dedupe paralleler Anfragen.
 * Treffer liefern exakt dieselben Bytes; Fehler werden nicht gecacht; ?fresh=1 umgeht den Cache.
 */
import { readFileSync } from "fs";
import { createGoldResponseCache, GOLD_ANALYSIS_CACHE_TTL_MS } from "../server/gold-response-cache";

let fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

check("TTL 5–10 min (10 min)", GOLD_ANALYSIS_CACHE_TTL_MS === 10 * 60 * 1000);

{
  let clock = 1_000_000;
  const cache = createGoldResponseCache<{ n: number; payload: string }>(GOLD_ANALYSIS_CACHE_TTL_MS, () => clock);
  let calls = 0;
  const loader = async () => { calls++; await sleep(20); return { n: calls, payload: "x".repeat(1000) }; };
  const a = await cache.get(loader);
  check("erster Aufruf miss", a.status === "miss" && calls === 1);
  clock += 9 * 60 * 1000;
  const b = await cache.get(loader);
  check("nach 9 min hit, kein neuer Lauf", b.status === "hit" && calls === 1);
  check("Treffer byte-identisch", JSON.stringify(a.value) === JSON.stringify(b.value) && a.value === b.value);
  check("Alter gemeldet", b.ageMs === 9 * 60 * 1000);
  clock += 61 * 1000;
  const c = await cache.get(loader);
  check("nach >10 min neu geladen", c.status === "miss" && calls === 2 && c.value.n === 2);
  const d = await cache.get(loader, { bypass: true });
  check("bypass lädt neu und ersetzt", d.status === "bypass" && calls === 3);
  const e = await cache.get(loader);
  check("danach Treffer auf den bypass-Wert", e.status === "hit" && e.value.n === 3);
}

{
  const cache = createGoldResponseCache<number>(GOLD_ANALYSIS_CACHE_TTL_MS);
  let calls = 0;
  const loader = async () => { calls++; await sleep(50); return 42; };
  const res = await Promise.all(Array.from({ length: 5 }, (_, i) => cache.get(loader, { bypass: i > 0 })));
  check("5 parallele Anfragen = 1 Lauf", calls === 1 && cache.loads === 1);
  check("Status miss + 4× shared", res[0].status === "miss" && res.slice(1).every(r => r.status === "shared"));
  check("alle bekommen denselben Wert", res.every(r => r.value === 42));
}

{
  const cache = createGoldResponseCache<number>(GOLD_ANALYSIS_CACHE_TTL_MS);
  let calls = 0;
  const bad = async () => { calls++; await sleep(10); throw new Error("FMP down"); };
  const r = await Promise.allSettled([cache.get(bad), cache.get(bad)]);
  check("Fehler an alle parallelen Anfragen, 1 Lauf", r.every(x => x.status === "rejected") && calls === 1);
  const ok = await cache.get(async () => { calls++; return 7; });
  check("Fehler nicht gecacht, nächster Aufruf lädt", ok.status === "miss" && ok.value === 7 && calls === 2);
}

const src = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
const handler = src.slice(src.indexOf('app.get("/api/analyze-gold"'), src.indexOf("// Gold-Chart (Section 2) 10Y/Max"));
check("Route nutzt den Cache mit ?fresh=1-Bypass", handler.includes('analysisCache.get(() => buildGoldAnalysis(), { bypass: req.query.fresh === "1" })'));
check("Route liefert die Analyse unverändert aus", handler.includes("res.json(value.analysis)"));
check("Builder gibt das Analyse-Objekt zurück (vorher res.json(analysis))", handler.includes("return { analysis, timing: timing.join(\" \") };") && !handler.includes("res.json(analysis)"));
check("Fehler werden geworfen, nicht gecacht", /console\.error\("\[GOLD\] Error:", error\?\.message\);\s*throw error;/.test(handler));
check("Score-Eingänge unverändert (newsFlag, gis)", handler.includes("newsFlag: goldNews?.flag ?? null") && handler.includes("gis: gisRounded,"));
check("Timing-Header + Cache-Header", handler.includes('"X-Gold-Cache"') && handler.includes('"X-Gold-Timing"'));

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
