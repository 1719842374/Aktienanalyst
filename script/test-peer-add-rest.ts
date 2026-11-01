/**
 * Peer-Add-Rest: Analyse-Body (erster Call und Poll) trägt normalisierte
 * peerOverrides, localStorage übersteht einen Reload, der nächste Body nimmt
 * sie mit. Cache-Key bleibt der serverseitige aus peer-cache-key.ts.
 *
 * PR A (Peer-Selection): Deckel 8 auf sichtbare Peers, Eingabe + „Standard
 * wiederherstellen“ auch bei 0 Peers (SSR), Hinweis „X nicht übernommen“.
 *
 * Ausfuehren: npx tsx script/test-peer-add-rest.ts
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PeerComparison, { missingAddedPeers, peerCapReached, MAX_VISIBLE_PEERS } from "../client/src/components/sections/PeerComparison";
import { buildAnalyzeCacheKey, normalizePeerOverrides } from "../server/peer-cache-key";
import {
  analyzePostBody,
  hasPeerOverrideLists,
  parseStoredOverrides,
  readLastTicker,
  readOverrides,
  serializeOverrides,
  shouldRestoreLastTicker,
  writeLastTicker,
  writeOverrides,
  type KeyValueStore,
  type PeerOverrideLists,
} from "../shared/peer-override-persist";

(globalThis as any).React = React; // Komponenten nutzen im Vite-Build das automatische JSX-Runtime

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Dieselbe Lesart wie Dashboard: Ticker nur aus `?ticker=` im Hash oder in location.search. `/` und `#/` haben keinen. */
function tickerFromBareHome(hashOrPath: string): string | null {
  const hash = hashOrPath.startsWith("#") ? hashOrPath : "";
  const hashQueryIdx = hash.indexOf("?");
  const hashParams = hashQueryIdx >= 0 ? new URLSearchParams(hash.slice(hashQueryIdx + 1)) : null;
  const search = !hash && hashOrPath.includes("?") ? hashOrPath.slice(hashOrPath.indexOf("?") + 1) : "";
  const searchParams = new URLSearchParams(search);
  const ticker = (hashParams?.get("ticker") ?? searchParams.get("ticker"))?.trim().toUpperCase();
  return ticker || null;
}

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const first = analyzePostBody({ ticker: "NVO", useLLM: false, force: true, peerOverrides: { add: ["lly ", "ABT"], remove: [] } });
const poll = analyzePostBody({ ticker: "NVO", useLLM: false, force: false, peerOverrides: first.peerOverrides });
check("erster Body enthält normalisierte peerOverrides", JSON.stringify(first.peerOverrides) === JSON.stringify({ add: ["ABT", "LLY"], remove: [] }), JSON.stringify(first));
check("Poll-Body enthält dieselben peerOverrides", JSON.stringify(poll.peerOverrides) === JSON.stringify(first.peerOverrides), JSON.stringify(poll));
check("Poll setzt force=false", poll.force === false && first.force === true);
check("leere Overrides fehlen im Body", !("peerOverrides" in analyzePostBody({ ticker: "NVO", useLLM: false, force: false, peerOverrides: { add: [], remove: [] } })));

const serverSide = normalizePeerOverrides({ add: ["LLY", "ABT"], remove: [] });
const keyFromBody = buildAnalyzeCacheKey("NVO", false, first.peerOverrides!.add, first.peerOverrides!.remove);
const keyReordered = buildAnalyzeCacheKey("NVO", false, serverSide.add, serverSide.remove);
check("Cache-Key aus dem Body trifft den serverseitig normalisierten Key", keyFromBody === keyReordered, `${keyFromBody} vs ${keyReordered}`);

const store = new MemoryStore();
writeOverrides(store, "nvo", { add: ["LLY", "ABT"], remove: ["gsk"] });
const restored = readOverrides(store, "NVO");
check("localStorage liefert nach Reload dieselben Overrides", JSON.stringify(restored) === JSON.stringify({ add: ["ABT", "LLY"], remove: ["GSK"] }), JSON.stringify(restored));
const next = analyzePostBody({ ticker: "NVO", useLLM: true, force: false, peerOverrides: restored });
check("nächster Analyse-Body nimmt die gespeicherten Overrides mit", JSON.stringify(next.peerOverrides) === JSON.stringify(restored) && next.useLLM === true, JSON.stringify(next));

writeOverrides(store, "NVO", { add: [], remove: [] });
check("Reset löscht die Listen", !hasPeerOverrideLists(readOverrides(store, "NVO")));
check("kaputter JSON-Eintrag wird leer", JSON.stringify(parseStoredOverrides("{")) === JSON.stringify({ add: [], remove: [] }));
check("serialize ist normalisiert", serializeOverrides({ add: ["lly", "lly"], remove: [] }) === JSON.stringify({ add: ["LLY"], remove: [] }));

writeLastTicker(store, "nvo");
check("letzter Ticker übersteht den Reload", readLastTicker(store) === "NVO");
check("Reload ohne URL stellt den letzten Ticker wieder her", shouldRestoreLastTicker({ urlTicker: null, lastTicker: "NVO" }) === "NVO");
check("nackte URL / ohne Ticker stellt den letzten Ticker wieder her", shouldRestoreLastTicker({ urlTicker: tickerFromBareHome("/"), lastTicker: "NVO" }) === "NVO");
check("Hash #/ ohne Ticker stellt den letzten Ticker wieder her", shouldRestoreLastTicker({ urlTicker: tickerFromBareHome("#/"), lastTicker: "NVO" }) === "NVO");
check("ohne gespeicherten Ticker bleibt / leer", shouldRestoreLastTicker({ urlTicker: null, lastTicker: null }) === null);
check("URL-Ticker gewinnt vor dem letzten Ticker", shouldRestoreLastTicker({ urlTicker: "msft", lastTicker: "NVO" }) === "MSFT");

const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
check("Dashboard-Poll nutzt analyzePostBody", dash.includes("analyzePostBody({ ticker, useLLM: llm, force: false, peerOverrides })"));
check("alter Poll ohne peerOverrides ist weg", !dash.includes('apiRequest("POST", "/api/analyze", { ticker, useLLM: llm, force: false })'));
check("Dashboard schreibt Overrides vor dem Request", dash.includes("writeOverrides(storage, args.ticker, resolved)"));
check("Dashboard hängt die Wiederherstellung nicht an navigationType=reload", !dash.includes("navigationType"));
check("Section7 reicht peerBusy durch", readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8").includes("peerBusy={peerBusy}"));
check("Peer-Zeile zeigt Loading", readFileSync(new URL("../client/src/components/sections/PeerComparison.tsx", import.meta.url), "utf8").includes('data-testid="peer-add-loading"'));

const unused: PeerOverrideLists = { add: [], remove: [] };
check("hasPeerOverrideLists erkennt leer", hasPeerOverrideLists(unused) === false);

// ── PR A: Deckel, leere Liste, „nicht übernommen“ ──
console.log("\nPR A — PeerComparison");
const mkPeer = (ticker: string) => ({
  ticker, name: ticker, pe: 20, peg: 1.5, ps: 4, pb: 3, epsGrowth1Y: 10, epsGrowth5Y: 8,
  marketCap: 100e9, revenueGrowth: 5, roic: 15, roicFiscalYear: "2025", roic5Y: 14, roic5YYearsUsed: 5,
});
const autoFive = ["GSK", "AZN", "SNY", "MRK", "PFE"].map(mkPeer);
const sevenWithAdds = [...autoFive, mkPeer("LLY"), mkPeer("ABT")];
check("Deckel konstant 8", MAX_VISIBLE_PEERS === 8);
check("5 Auto + 2 übernommene Adds = 7 sichtbar → nicht gesperrt (alt: 2+7=9 ≥ 8 gesperrt)", peerCapReached(sevenWithAdds) === false && (2 + sevenWithAdds.length >= 8));
check("8 sichtbare Peers → gesperrt", peerCapReached([...sevenWithAdds, mkPeer("JNJ")]) === true);
check("0 Peers → nicht gesperrt", peerCapReached([]) === false);
check("nicht übernommen: XYZ fehlt, LLY angekommen", JSON.stringify(missingAddedPeers(["LLY", "XYZ"], sevenWithAdds, "NVO")) === JSON.stringify(["XYZ"]));
check("nicht übernommen: Groß/Klein egal, Subject zählt nicht", JSON.stringify(missingAddedPeers(["lly", "nvo"], [mkPeer("LLY")], "NVO")) === "[]");

const subject = { ...mkPeer("NVO"), name: "Novo Nordisk" };
const peerAvg = { pe: 20, peg: 1.5, ps: 4, pb: 3, epsGrowth1Y: 10, epsGrowth5Y: 8, roic: 15, roic5Y: 14 };
const mkData = (peers: any[] | null, add: string[], remove: string[] = []) => ({
  ticker: "NVO",
  peerComparison: peers === null ? undefined : { subject, peers, peerAvg },
  activePeerOverrides: { add, remove },
}) as any;
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(PeerComparison as any, props));
const noop = () => {};

const empty = render({ data: mkData([], ["XYZ"]), onOverridesChange: noop });
check("SSR 0 Peers: Eingabefeld da", empty.includes('data-testid="input-peer-add"'), empty.slice(0, 300));
check("SSR 0 Peers: „Standard wiederherstellen“ da", empty.includes("Standard wiederherstellen") && empty.includes('data-testid="button-peer-reset"'));
check("SSR 0 Peers: „XYZ nicht übernommen“", empty.includes('data-testid="peer-not-adopted"') && empty.includes("XYZ nicht übernommen"));
check("SSR 0 Peers: Reset aktiv bei Overrides", !/data-testid="button-peer-reset"[^>]*disabled|disabled=""[^>]*data-testid="button-peer-reset"/.test(empty));

const emptyNoOverrides = render({ data: mkData([], []), onOverridesChange: noop });
check("SSR 0 Peers ohne Overrides: Eingabe + Reset gerendert", emptyNoOverrides.includes('data-testid="input-peer-add"') && emptyNoOverrides.includes("Standard wiederherstellen"));
check("SSR 0 Peers ohne Overrides: kein Hinweis", !emptyNoOverrides.includes("nicht übernommen"));

const noPc = render({ data: mkData(null, ["XYZ"]), onOverridesChange: noop });
check("SSR peerComparison fehlt: Eingabe + Reset + Hinweis", noPc.includes('data-testid="input-peer-add"') && noPc.includes("Standard wiederherstellen") && noPc.includes("XYZ nicht übernommen"));

const emptyReadonly = render({ data: mkData([], ["XYZ"]) });
check("SSR 0 Peers ohne Callback: weiterhin keine Steuerung", !emptyReadonly.includes("input-peer-add") && !emptyReadonly.includes("Standard wiederherstellen"));

const seven = render({ data: mkData(sevenWithAdds, ["ABT", "LLY"]), onOverridesChange: noop });
check("SSR 7 Peers (5 Auto + 2 Adds): kein „Max. 8 Peers erreicht“", seven.includes('data-testid="peer-scored-table"') && !seven.includes("Max. 8 Peers erreicht"));
check("SSR 7 Peers: kein „nicht übernommen“", !seven.includes("nicht übernommen"));

const eight = render({ data: mkData([...sevenWithAdds, mkPeer("JNJ")], ["ABT", "JNJ", "LLY"]), onOverridesChange: noop });
check("SSR 8 Peers: „Max. 8 Peers erreicht“", eight.includes("Max. 8 Peers erreicht"));

const busy = render({ data: mkData(autoFive, ["XYZ"]), onOverridesChange: noop, peerBusy: true });
check("SSR peerBusy: kein Hinweis auf alten Daten, Loading sichtbar", !busy.includes("nicht übernommen") && busy.includes('data-testid="peer-add-loading"'));

const pcSrc = readFileSync(new URL("../client/src/components/sections/PeerComparison.tsx", import.meta.url), "utf8");
check("alte Doppelzählung activeAdd.length + peers.length ist weg", !pcSrc.includes("activeAdd.length + peers.length"));

console.log(failed === 0 ? "\n✅ Alle Peer-Add-Rest-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
