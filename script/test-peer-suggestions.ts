// FW-38: Peer-Autocomplete. Stubs = echte /api/search-ticker-Antworten (Production,
// 2026-10-25) aus script/fixtures/search-ticker/peer-search-live-2026-10-25.json.
import { readFileSync } from "fs";
import { parsePeerSearchResponse, rankPeerSuggestions } from "../shared/peer-suggestions";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  FAIL " + m); } };
const fx = JSON.parse(readFileSync(new URL("./fixtures/search-ticker/peer-search-live-2026-10-25.json", import.meta.url), "utf8"));
const R = fx.responses;

// Parsing
const lly = parsePeerSearchResponse(R.LLY);
ok(lly.length === R.LLY.results.length, "LLY: alle echten Zeilen geparst");
ok(lly[0].ticker === "LLY" && lly[0].name === "Eli Lilly and Company", "LLY: erster Treffer unveraendert");
ok(lly.find(s => s.ticker === "LLYX")?.etfByName === true, "LLYX (\"…LLY ETF\") bekommt ETF-Namenshinweis");
ok(lly.find(s => s.ticker === "LLY")?.etfByName === false, "LLY ohne ETF-Hinweis");
const pfe = parsePeerSearchResponse(R.Pfizer);
ok(pfe.find(s => s.ticker === "PFE.F")?.unavailable === true, "PFE.F: unavailable-Flag vom Server uebernommen");

// Fehlerpfade → keine Vorschlaege (keine erfundenen Werte)
ok(parsePeerSearchResponse(null).length === 0, "null → []");
ok(parsePeerSearchResponse({ results: [] }).length === 0, "leere Antwort → []");
ok(parsePeerSearchResponse({ error: "x" }).length === 0, "Fehlerobjekt → []");
ok(parsePeerSearchResponse("<html>").length === 0, "HTML/String → []");
ok(parsePeerSearchResponse({ results: [{ name: "ohne ticker" }, { ticker: " abc " }] }).map(s => s.ticker).join() === "ABC", "Zeilen ohne Ticker verworfen, Ticker normalisiert");
ok(parsePeerSearchResponse({ results: [{ ticker: "ABC" }] })[0].name === "ABC", "fehlender Name → Ticker, kein Ersatzwert");

// Ranking/Filter
const r1 = rankPeerSuggestions(lly, { subject: "lly", existing: [] });
ok(!r1.some(s => s.ticker === "LLY"), "Subject ausgeblendet (case-insensitive)");
ok(r1.length <= 8, "max. 8 Vorschlaege");
const nov = parsePeerSearchResponse(R.nov);
const r2 = rankPeerSuggestions(nov, { subject: "PFE", existing: ["NOVT"], limit: 20 });
ok(!r2.some(s => s.ticker === "NOVT"), "vorhandener Peer ausgeblendet");
const firstEtf = r2.findIndex(s => s.etfByName);
ok(firstEtf === -1 || r2.slice(firstEtf).every(s => s.etfByName || s.unavailable), "ETF-Namenshinweise hinter Aktien");
ok(r2.some(s => s.etfByName), "ETF-Treffer werden nicht gesperrt (kein bestehender Peer-ETF-Block)");
const r3 = rankPeerSuggestions(pfe, { subject: "LLY", existing: [], limit: 20 });
ok(r3[r3.length - 1].unavailable === true && !r3.slice(0, -1).some(s => s.unavailable), "\"keine Daten\" ans Ende");
ok(r3[0].ticker === "PFIZER.BO", "sonst Server-Reihenfolge stabil");
ok(rankPeerSuggestions([...pfe, ...pfe], { subject: "", existing: [], limit: 50 }).length === pfe.length, "Duplikate entfernt");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
