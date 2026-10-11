/**
 * Peer-Add-Rest: Analyse-Body (erster Call und Poll) trägt normalisierte
 * peerOverrides, localStorage übersteht einen Reload, der nächste Body nimmt
 * sie mit. Cache-Key bleibt der serverseitige aus peer-cache-key.ts.
 *
 * Ausfuehren: npx tsx script/test-peer-add-rest.ts
 */
import { readFileSync } from "node:fs";
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

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
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
check("Reload ohne URL stellt den letzten Ticker wieder her", shouldRestoreLastTicker({ urlTicker: null, navigationType: "reload", lastTicker: "NVO" }) === "NVO");
check("frischer Besuch stellt nichts her", shouldRestoreLastTicker({ urlTicker: null, navigationType: "navigate", lastTicker: "NVO" }) === null);
check("URL-Ticker gewinnt vor dem letzten Ticker", shouldRestoreLastTicker({ urlTicker: "msft", navigationType: "reload", lastTicker: "NVO" }) === "MSFT");

const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
check("Dashboard-Poll nutzt analyzePostBody", dash.includes("analyzePostBody({ ticker, useLLM: llm, force: false, peerOverrides })"));
check("alter Poll ohne peerOverrides ist weg", !dash.includes('apiRequest("POST", "/api/analyze", { ticker, useLLM: llm, force: false })'));
check("Dashboard schreibt Overrides vor dem Request", dash.includes("writeOverrides(storage, args.ticker, resolved)"));
check("Section7 reicht peerBusy durch", readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8").includes("peerBusy={peerBusy}"));
check("Peer-Zeile zeigt Loading", readFileSync(new URL("../client/src/components/sections/PeerComparison.tsx", import.meta.url), "utf8").includes('data-testid="peer-add-loading"'));

const unused: PeerOverrideLists = { add: [], remove: [] };
check("hasPeerOverrideLists erkennt leer", hasPeerOverrideLists(unused) === false);

console.log(failed === 0 ? "\n✅ Alle Peer-Add-Rest-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
