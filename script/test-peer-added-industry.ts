/**
 * H1 (Tester-Hinweis #260, dod-260/REPORT.md): Manuell hinzugefügte Peers bekommen industry/sector
 * aus dem FMP-Profil, wenn eins existiert (NVO + LLY → Industrie-Tab 6 statt 5).
 *
 * - Nachladen nur für Peers ohne Eintrag in der 2-Hop-Profil-Map, nur nach Band-/Datenfilter
 * - Cache: Erfolg Speicher + Disk 7 Tage, kein Profil/Fehler nur Speicher 6 h
 * - Score-neutral: Peer-Liste, Reihenfolge, Kennzahlen, peerAvg, subject bitgleich
 * - analyze-route.ts unverändert (kein Patch nötig)
 *
 * Kein Live-FMP: fetch gestubbt, FMP_API_KEY Dummy, Disk-Cache injiziert (kein data.db).
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-added-industry.ts
 */
import { readFileSync } from "node:fs";
import {
  PEER_INDUSTRY_MISS_TTL_MS, PEER_INDUSTRY_PROFILE_TTL_MS, fetchPeerComparisonFromTickers, loadPeerIndustryProfile,
  peerIndustryFromFmpProfile, peerIndustryProfileCacheKey, setPeerIndustryDepsForTests, type PeerIndustryProfile,
} from "../server/news-peers";
import { filterPeersForView } from "../client/src/lib/peerViewFilter";
import type { PeerCompany } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const DRUG = "Drug Manufacturers - General";

async function main() {
  console.log("Profil-Parsing und Cache");
  check("Profil → industry/sector (getrimmt)", JSON.stringify(peerIndustryFromFmpProfile({ industry: ` ${DRUG} `, sector: "Healthcare" })) === JSON.stringify({ industry: DRUG, sector: "Healthcare" }));
  check("leeres/fehlendes Profil → null", peerIndustryFromFmpProfile(null) === null && peerIndustryFromFmpProfile({ industry: "", sector: " " }) === null && peerIndustryFromFmpProfile([]) === null);
  check("Cache-Key", peerIndustryProfileCacheKey(" lly ") === "peerindustry:LLY");

  const disk = new Map<string, { data: any; storedAt: number }>();
  let loaderCalls = 0;
  let loaderResult: PeerIndustryProfile | null | "throw" = { industry: DRUG, sector: "Healthcare" };
  setPeerIndustryDepsForTests({
    loader: async () => { loaderCalls++; if (loaderResult === "throw") throw new Error("FMP 429"); return loaderResult; },
    cacheGet: (key, now) => { const e = disk.get(key); return e && now - e.storedAt <= PEER_INDUSTRY_PROFILE_TTL_MS ? e : null; },
    cacheSet: (key, data) => { disk.set(key, { data, storedAt: T0 }); },
  });
  const T0 = Date.parse("2026-10-18T12:00:00Z");
  const r1 = await loadPeerIndustryProfile("LLY", T0);
  check("1. Aufruf: FMP-Profil, 1 Call", r1.source === "fmp" && r1.profile?.industry === DRUG && loaderCalls === 1, JSON.stringify(r1));
  check("Erfolg landet im Disk-Cache (peerindustry:LLY)", disk.get("peerindustry:LLY")?.data?.industry === DRUG);
  const r2 = await loadPeerIndustryProfile("lly", T0 + 1000);
  check("2. Aufruf: Speicher-Cache, kein Call", r2.source === "memory" && loaderCalls === 1);
  setPeerIndustryDepsForTests({
    loader: async () => { loaderCalls++; return null; },
    cacheGet: (key, now) => { const e = disk.get(key); return e && now - e.storedAt <= PEER_INDUSTRY_PROFILE_TTL_MS ? e : null; },
    cacheSet: (key, data) => { disk.set(key, { data, storedAt: T0 }); },
  });
  const r3 = await loadPeerIndustryProfile("LLY", T0 + 60_000);
  check("nach Neustart (Speicher leer): Disk-Cache, kein Call", r3.source === "disk" && r3.profile?.industry === DRUG && loaderCalls === 1);
  const r4 = await loadPeerIndustryProfile("LLY", T0 + PEER_INDUSTRY_PROFILE_TTL_MS + 60_000);
  check("nach 7 Tagen: neu laden", loaderCalls === 2 && r4.source === "miss");
  const miss1 = await loadPeerIndustryProfile("NOPROF", T0);
  const miss2 = await loadPeerIndustryProfile("NOPROF", T0 + 1000);
  check("kein Profil: 6 h im Speicher, kein Disk-Eintrag", miss1.source === "miss" && miss2.source === "memory" && miss2.profile === null && !disk.has("peerindustry:NOPROF"));
  const callsBefore = loaderCalls;
  await loadPeerIndustryProfile("NOPROF", T0 + PEER_INDUSTRY_MISS_TTL_MS + 1000);
  check("kein Profil: nach 6 h erneuter Versuch", loaderCalls === callsBefore + 1);
  loaderResult = "throw";
  setPeerIndustryDepsForTests({ loader: async () => { throw new Error("FMP 429"); }, cacheGet: () => null, cacheSet: () => {} });
  const err = await loadPeerIndustryProfile("ERR", T0).catch(() => "threw" as const);
  check("Fehler beim Laden wirft nicht → miss", err !== "threw" && err.source === "miss" && err.profile === null);

  console.log("\nNVO + LLY (FMP gestubbt): Branche für den hinzugefügten Peer");
  process.env.FMP_API_KEY = "test-dummy-not-a-key";
  setPeerIndustryDepsForTests({ cacheGet: () => null, cacheSet: () => {} });
  const mk = (sym: string, cap: number, pe: number) => ({ quote: { symbol: sym, name: sym, marketCap: cap, price: 100, eps: 100 / pe }, ratios: [{ priceToEarningsRatio: pe, priceToSalesRatio: 4, priceToBookRatio: 3, netIncomePerShare: 5, revenuePerShare: 20 }, { netIncomePerShare: 4, revenuePerShare: 18 }] });
  const fx: Record<string, any> = {
    PFE: mk("PFE", 160e9, 18.3), GILD: mk("GILD", 100e9, 12), AMGN: mk("AMGN", 160e9, 20), BMY: mk("BMY", 120e9, 13), AZN: mk("AZN", 250e9, 22),
    LLY: mk("LLY", 800e9, 46.6),
  };
  const profiles: Record<string, any> = { LLY: { symbol: "LLY", industry: DRUG, sector: "Healthcare" } };
  const calls: Record<string, number> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    const sym = url.searchParams.get("symbol") ?? "";
    const ep = url.pathname.split("/").pop() ?? "";
    calls[ep] = (calls[ep] ?? 0) + 1;
    let body: any = [];
    if (ep === "quote") body = sym.split(",").map(s => fx[s]?.quote).filter(Boolean);
    else if (ep === "ratios") body = fx[sym]?.ratios ?? [];
    else if (ep === "profile") body = profiles[sym] ? [profiles[sym]] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const auto = ["PFE", "GILD", "AMGN", "BMY", "AZN"];
  // 2-Hop-Profil-Map wie aus resolveAdaptivePeerTickers: nur Auto-Peers
  const map: ReadonlyMap<string, PeerIndustryProfile> = new Map(auto.map(t => [t, { industry: DRUG, sector: "Healthcare" }]));
  const args = ["NVO", [...auto, "LLY", "XXXX1"], 14, 1.5, 40e9, 400e9, 10, 8, { pb: 10, epsGrowth1Y: 12 }] as const;
  const legacy = await fetchPeerComparisonFromTickers(...args);
  check("ohne Map: kein /profile-Call, keine industry-Keys (Altpfad bitgleich)", !calls.profile && !!legacy && legacy.peers.every(p => !("industry" in p)));
  for (const k of Object.keys(calls)) delete calls[k];
  const withFill = await fetchPeerComparisonFromTickers(...args, map);
  const lly = withFill?.peers.find(p => p.ticker === "LLY");
  check("LLY (manuell hinzugefügt) → Branche aus FMP-Profil", lly?.industry === DRUG && lly?.sector === "Healthcare", JSON.stringify(lly));
  check("genau 1 /profile-Call (LLY), keiner für Auto-Peers oder XXXX1 (gefiltert)", calls.profile === 1, JSON.stringify(calls));
  const industryTab = filterPeersForView(withFill!.peers as PeerCompany[], { marketCap: 400e9, pe: 14 }, DRUG, "industry");
  check("Industrie-Tab NVO + LLY: 6 statt 5", industryTab.length === 6, industryTab.map(p => p.ticker).join(","));
  for (const k of Object.keys(calls)) delete calls[k];
  const again = await fetchPeerComparisonFromTickers(...args, map);
  check("2. Analyse: 0 /profile-Calls (Cache)", !calls.profile && again?.peers.find(p => p.ticker === "LLY")?.industry === DRUG, JSON.stringify(calls));

  console.log("\nScore-Neutralität");
  setPeerIndustryDepsForTests({ loader: async () => null, cacheGet: () => null, cacheSet: () => {} });
  const noFill = await fetchPeerComparisonFromTickers(...args, map);
  setPeerIndustryDepsForTests({ loader: async () => { throw new Error("FMP down"); }, cacheGet: () => null, cacheSet: () => {} });
  const failing = await fetchPeerComparisonFromTickers(...args, map);
  globalThis.fetch = realFetch;
  setPeerIndustryDepsForTests(null);
  const strip = (ps: any[]) => JSON.stringify(ps.map(({ industry: _i, sector: _s, forwardPe: _f, ...rest }) => rest));
  check("Peers (ohne industry/sector) bitgleich zum Altpfad", strip(withFill!.peers) === JSON.stringify(legacy!.peers));
  check("Peer-Reihenfolge unverändert", withFill!.peers.map(p => p.ticker).join() === legacy!.peers.map(p => p.ticker).join());
  check("peerAvg bitgleich (mit Fill / ohne Profil / Altpfad)", [withFill, noFill, failing].every(r => JSON.stringify(r?.peerAvg) === JSON.stringify(legacy?.peerAvg)));
  check("subject bitgleich", JSON.stringify(withFill?.subject) === JSON.stringify(legacy?.subject));
  check("ohne Profil: LLY bleibt n/a (null)", noFill?.peers.find(p => p.ticker === "LLY")?.industry === null);
  check("Profil-Fehler: Ergebnis nicht null, LLY n/a", !!failing && failing.peers.find(p => p.ticker === "LLY")?.industry === null);

  console.log("\nQuelltext");
  const route = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  check("analyze-route.ts unverändert: 3 peerProfiles-Vorkommen wie auf main", (route.match(/peerProfiles/g) ?? []).length === 3);
  const np = readFileSync(new URL("../server/news-peers.ts", import.meta.url), "utf8");
  check("Nachladen nur im Map-Pfad", np.includes("if (peerProfiles) await fillMissingPeerIndustry(peers, peerProfiles);"));
  check("peerAvg-Berechnung liest kein industry/sector", !/avg\([^)]*\.(industry|sector)/.test(np));

  console.log(failed === 0 ? "\n✅ Alle Peer-Added-Industry-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
