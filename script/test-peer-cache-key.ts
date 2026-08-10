/**
 * Unit-Tests fuer server/peer-cache-key.ts (Auftrag 10.08.2026, "Peer-Add/
 * Remove zuverlaessig").
 *
 * Root-Cause des urspruenglichen Bugs: Peer-Override-Listen wurden zwar
 * uppercased/getrimmt, aber NICHT sortiert/dedupliziert vor dem Cache-Key-
 * Join -- zwei Requests mit semantisch identischem Override-Set aber
 * unterschiedlicher Array-Reihenfolge (z.B. [LLY,ABT] vs. [ABT,LLY])
 * erzeugten unterschiedliche Cache-Keys, was zu "Geister-Peers" aus einem
 * alten, nicht mehr passenden Cache-Eintrag fuehren konnte.
 *
 * Ausfuehren: npx tsx script/test-peer-cache-key.ts
 */
import { normalizePeerList, normalizePeerOverrides, buildAnalyzeCacheKey, applyPeerOverrides } from "../server/peer-cache-key";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// === normalizePeerList ===

// 1. Trim + uppercase
check("normalizePeerList: trim + uppercase", JSON.stringify(normalizePeerList([" lly ", "abt"])) === JSON.stringify(["ABT", "LLY"]));

// 2. Sortierung unabhaengig von Eingabereihenfolge (Kern-Bugfix)
const orderA = normalizePeerList(["LLY", "ABT", "AMGN"]);
const orderB = normalizePeerList(["AMGN", "LLY", "ABT"]);
check("normalizePeerList: gleiche Ausgabe unabhaengig von Eingabereihenfolge", JSON.stringify(orderA) === JSON.stringify(orderB), `A=${JSON.stringify(orderA)}, B=${JSON.stringify(orderB)}`);

// 3. Deduplizierung
check("normalizePeerList: Duplikate entfernt", JSON.stringify(normalizePeerList(["LLY", "lly", "LLY "])) === JSON.stringify(["LLY"]));

// 4. Leere/undefined Eingabe -> leeres Array, kein Crash
check("normalizePeerList: undefined -> []", JSON.stringify(normalizePeerList(undefined)) === "[]");
check("normalizePeerList: leere Strings gefiltert", JSON.stringify(normalizePeerList(["", "  ", "LLY"])) === JSON.stringify(["LLY"]));

// === normalizePeerOverrides ===

// 5. hasOverrides korrekt gesetzt
check("normalizePeerOverrides: hasOverrides=true bei add", normalizePeerOverrides({ add: ["LLY"] }).hasOverrides === true);
check("normalizePeerOverrides: hasOverrides=false ohne Overrides", normalizePeerOverrides({ add: [], remove: [] }).hasOverrides === false);
check("normalizePeerOverrides: hasOverrides=false bei undefined", normalizePeerOverrides(undefined).hasOverrides === false);
check("normalizePeerOverrides: hasOverrides=true bei nur remove", normalizePeerOverrides({ remove: ["ABT"] }).hasOverrides === true);

// === buildAnalyzeCacheKey (Kern-Bugfix: Determinismus) ===

// 6. Cache-Key ist IDENTISCH unabhaengig von der Eingabereihenfolge, wenn
// die Listen VOR dem Aufruf normalisiert wurden (so wie es die Route jetzt tut).
const keyA = buildAnalyzeCacheKey("NVO", false, normalizePeerList(["LLY", "ABT"]), []);
const keyB = buildAnalyzeCacheKey("NVO", false, normalizePeerList(["ABT", "LLY"]), []);
check("buildAnalyzeCacheKey: deterministisch unabhaengig von Add-Reihenfolge (Kern-Bugfix)", keyA === keyB, `keyA=${keyA}, keyB=${keyB}`);

// 7. Kein Override -> kein Peers-Suffix im Key (Ruecken-Kompatibilitaet zu ungecachten Requests)
const keyNoOverride = buildAnalyzeCacheKey("MSFT", false, [], []);
check("buildAnalyzeCacheKey: kein Peers-Suffix ohne Overrides", !keyNoOverride.includes("peers"), keyNoOverride);
check("buildAnalyzeCacheKey: Basis-Format analyze:TICKER:llm:0/1", keyNoOverride === "analyze:MSFT:llm:0", keyNoOverride);

// 8. useLLM fliesst in den Key ein (verschiedene LLM-Modi duerfen sich nicht ueberschreiben)
const keyLLMOff = buildAnalyzeCacheKey("MSFT", false, [], []);
const keyLLMOn = buildAnalyzeCacheKey("MSFT", true, [], []);
check("buildAnalyzeCacheKey: useLLM=true/false erzeugen unterschiedliche Keys", keyLLMOff !== keyLLMOn, `off=${keyLLMOff}, on=${keyLLMOn}`);

// 9. Unterschiedliche Overrides -> unterschiedliche Keys (kein falscher Cache-Hit)
const keyWithLLY = buildAnalyzeCacheKey("NVO", false, ["LLY"], []);
const keyWithoutLLY = buildAnalyzeCacheKey("NVO", false, [], []);
check("buildAnalyzeCacheKey: mit/ohne Override erzeugen unterschiedliche Keys", keyWithLLY !== keyWithoutLLY, `withLLY=${keyWithLLY}, without=${keyWithoutLLY}`);

// 10. Ticker wird uppercased
check("buildAnalyzeCacheKey: Ticker wird uppercased", buildAnalyzeCacheKey("nvo", false, [], []) === "analyze:NVO:llm:0");

// 11. Remove-Overrides fliessen ebenfalls deterministisch in den Key ein
const keyRemoveA = buildAnalyzeCacheKey("NVO", false, [], normalizePeerList(["ABT", "GSK"]));
const keyRemoveB = buildAnalyzeCacheKey("NVO", false, [], normalizePeerList(["GSK", "ABT"]));
check("buildAnalyzeCacheKey: Remove-Liste deterministisch unabhaengig von Reihenfolge", keyRemoveA === keyRemoveB, `A=${keyRemoveA}, B=${keyRemoveB}`);

// === applyPeerOverrides ===

// 12. NVO-Live-Fall: Add LLY zu Auto-Peers
const autoNVO = ["ABT", "AMGN", "AZN", "GILD", "GSK"];
const withLLY = applyPeerOverrides(autoNVO, "NVO", ["LLY"], []);
check("applyPeerOverrides: NVO +LLY -> LLY in effektiver Liste", withLLY.includes("LLY"), JSON.stringify(withLLY));
check("applyPeerOverrides: Auto-Peers bleiben erhalten bei reinem Add", autoNVO.every(t => withLLY.includes(t)), JSON.stringify(withLLY));

// 13. NVO +LLY -ABT
const withLLYMinusABT = applyPeerOverrides(autoNVO, "NVO", ["LLY"], ["ABT"]);
check("applyPeerOverrides: NVO +LLY -ABT -> LLY drin, ABT weg", withLLYMinusABT.includes("LLY") && !withLLYMinusABT.includes("ABT"), JSON.stringify(withLLYMinusABT));

// 14. Restore (leere Overrides) -> unveraendert
const restored = applyPeerOverrides(autoNVO, "NVO", [], []);
check("applyPeerOverrides: leere Overrides -> Auto-Liste unveraendert", JSON.stringify(restored) === JSON.stringify(autoNVO), JSON.stringify(restored));

// 15. Max-8-Enforcement
const almostFull = ["A", "B", "C", "D", "E", "F", "G"]; // 7 Peers
const withOneMore = applyPeerOverrides(almostFull, "SUBJ", ["H"], [], 8);
check("applyPeerOverrides: Add bei 7 Peers -> 8 erlaubt", withOneMore.length === 8 && withOneMore.includes("H"), JSON.stringify(withOneMore));
const alreadyFull = ["A", "B", "C", "D", "E", "F", "G", "H"]; // bereits 8
const rejectedAdd = applyPeerOverrides(alreadyFull, "SUBJ", ["I"], [], 8);
check("applyPeerOverrides: Add bei bereits 8 Peers -> abgelehnt (Max-8-Enforcement)", rejectedAdd.length === 8 && !rejectedAdd.includes("I"), JSON.stringify(rejectedAdd));

// 16. Subject-Ticker kann nicht sich selbst als Peer hinzufuegen
const selfAddAttempt = applyPeerOverrides(["ABT"], "NVO", ["NVO"], []);
check("applyPeerOverrides: Subject-Ticker kann nicht sich selbst hinzufuegen", !selfAddAttempt.includes("NVO"), JSON.stringify(selfAddAttempt));

// 17. Bereits vorhandener Peer wird nicht dupliziert
const dupAttempt = applyPeerOverrides(["ABT", "AMGN"], "NVO", ["ABT"], []);
check("applyPeerOverrides: bereits vorhandener Peer wird nicht dupliziert", dupAttempt.filter(t => t === "ABT").length === 1, JSON.stringify(dupAttempt));

// === Gesamt-Determinismus: End-to-End (normalizePeerOverrides -> buildAnalyzeCacheKey) ===

// 18. Zwei "Anfragen" mit gleichem Override-Set aber unterschiedlicher Feld-
// Reihenfolge im peerOverrides-Objekt selbst erzeugen denselben Cache-Key --
// das ist exakt das Szenario, das im Live-Betrieb zu Geister-Peers fuehrte.
const reqA = normalizePeerOverrides({ add: ["LLY", "ABT"], remove: [] });
const reqB = normalizePeerOverrides({ add: ["ABT", "LLY"], remove: [] });
const cacheKeyReqA = buildAnalyzeCacheKey("NVO", false, reqA.add, reqA.remove);
const cacheKeyReqB = buildAnalyzeCacheKey("NVO", false, reqB.add, reqB.remove);
check("End-to-End: identische Overrides in unterschiedlicher Reihenfolge -> identischer Cache-Key (Geister-Peer-Fix)", cacheKeyReqA === cacheKeyReqB, `A=${cacheKeyReqA}, B=${cacheKeyReqB}`);

console.log(failed === 0 ? `\n✅ Alle Peer-Cache-Key-Tests bestanden (18 Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
