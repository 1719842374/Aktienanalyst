/**
 * F10-34 (Future_10 §11): Zentralbank-Goldkäufe per LLM, nur Anzeige in der Gold-News-Sektion.
 * Das LLM ist gemockt; auf der Box gibt es keinen OPENROUTER_API_KEY, also keinen Live-Lauf.
 * Prüft: Schema-Validierung (Quelle+Datum Pflicht, Tonnen nur wörtlich aus der Meldung), n/a mit Grund
 * (kein Key, leere/ungültige Antwort, Fehler), Cache nur bei gültiger Antwort, Karte, und dass
 * News-Flag, Score-Eingang (goldNewsScoreFlag) und der Gold-Score unverändert bleiben.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import {
  validateCentralBankLlm, loadCentralBankGoldBuying, centralBankPrompt, numberInText,
  goldNewsScoreFlag, loadGoldNewsImpact,
} from "../server/gold-news";
import { GoldNewsCard } from "../client/src/components/gold/GoldNewsCard";
import type { GoldCentralBankBuying, GoldNewsImpact, GoldNewsItem } from "../shared/gold-schema";

let fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; };
const NOW = Date.parse("2026-10-25T12:00:00Z");

const items: GoldNewsItem[] = [
  { title: "Poland's central bank buys 12 tonnes of gold in September", source: "Reuters", url: "https://r/1", pubDate: "2026-10-20T08:00:00.000Z" },
  { title: "Czech National Bank keeps adding to gold reserves", source: "Kitco", url: "https://k/2", pubDate: "2026-10-18T09:00:00.000Z" },
  { title: "Central banks bought 1,000 tonnes in 2025, WGC says", source: "WGC", url: "https://w/3", pubDate: "2026-10-15T09:00:00.000Z" },
];

// Schema-Validierung
const v = validateCentralBankLlm({ entries: [
  { item: 1, institution: "Narodowy Bank Polski", direction: "buy", tonnes: 12, period: "September 2026" },
  { item: 2, institution: "Czech National Bank", direction: "buy", tonnes: null, period: null },
  { item: 2, institution: "Czech National Bank", direction: "buy", tonnes: 5, period: null },      // 5 steht nicht in der Meldung
  { item: 9, institution: "Bundesbank", direction: "buy", tonnes: null, period: null },             // Meldung existiert nicht
  { institution: "PBoC", direction: "buy", tonnes: 10 },                                             // keine Quelle
  { item: 3, institution: "Central banks", direction: "buy", tonnes: 1000, period: "2025" },
  { item: 1, institution: "NBP", direction: "hold", tonnes: null },                                   // direction ungültig
] }, items);
check("gültige Einträge übernommen (3)", v.entries.length === 3);
check("verworfen: Zahl nicht in Meldung, Meldung fehlt, ohne Quelle, direction ungültig (4)", v.discarded === 4);
check("Quelle/URL/Datum aus dem Feed, nicht vom LLM", v.entries[0].source === "Reuters" && v.entries[0].url === "https://r/1" && v.entries[0].date === "2026-10-20T08:00:00.000Z");
check("Tonnen wörtlich belegt (12; 1,000 → 1000)", v.entries[0].tonnes === 12 && v.entries[2].tonnes === 1000);
check("ohne Tonnen bleibt null (n/a)", v.entries[1].tonnes === null);
check("numberInText erkennt keine erfundenen Zahlen", numberInText(12, items[0].title) && !numberInText(13, items[0].title));
check("ungültige Antwort → n/a mit Grund", validateCentralBankLlm("kaputt", items).reason === "OpenRouter ohne gültige Antwort (entries fehlt)");
check("leere Liste → n/a mit Grund", validateCentralBankLlm({ entries: [] }, items).reason === "keine belegten Zentralbank-Käufe in den Meldungen");
const noDate = validateCentralBankLlm({ entries: [{ item: 1, institution: "X", direction: "buy", tonnes: null }] }, [{ ...items[0], pubDate: "" }]);
check("Meldung ohne Datum → verworfen", noDate.entries.length === 0 && noDate.discarded === 1);

// Laden mit gemocktem LLM
let stored: GoldCentralBankBuying | null = null;
const deps = (over: any = {}) => ({
  now: NOW, llmAvailable: true, fetchItems: async () => items,
  complete: async () => ({ entries: [{ item: 1, institution: "NBP", direction: "buy", tonnes: 12, period: null }] }),
  cacheGet: () => null, cacheSet: (x: GoldCentralBankBuying) => { stored = x; }, ...over,
});
(async () => {
  const noKey = await loadCentralBankGoldBuying(deps({ llmAvailable: false }));
  check("ohne Key → n/a 'OPENROUTER_API_KEY fehlt'", noKey.entries.length === 0 && noKey.unavailableReason === "OPENROUTER_API_KEY fehlt");
  stored = null;
  const nul = await loadCentralBankGoldBuying(deps({ complete: async () => null }));
  check("LLM liefert nichts → n/a 'OpenRouter ohne Antwort', nicht gecacht", nul.unavailableReason === "OpenRouter ohne Antwort" && stored === null);
  const err = await loadCentralBankGoldBuying(deps({ complete: async () => { throw new Error("timeout"); } }));
  check("LLM-Fehler → n/a mit Grund, nicht gecacht", err.unavailableReason === "OpenRouter fehlgeschlagen: timeout" && stored === null);
  const bad = await loadCentralBankGoldBuying(deps({ complete: async () => ({ foo: 1 }) }));
  check("ungültig → n/a mit Grund", bad.entries.length === 0 && bad.unavailableReason!.startsWith("OpenRouter ohne gültige Antwort"));
  const noItems = await loadCentralBankGoldBuying(deps({ fetchItems: async () => [] }));
  check("keine Meldungen → n/a, kein LLM-Aufruf nötig", noItems.unavailableReason === "keine Zentralbank-Meldungen abrufbar");
  stored = null;
  let seenPrompt: string[] = [];
  const ok = await loadCentralBankGoldBuying(deps({ complete: async (h: string[]) => { seenPrompt = h; return { entries: [{ item: 1, institution: "NBP", direction: "buy", tonnes: 12, period: null }] }; } }));
  check("gültig → Eintrag + gecacht", ok.entries.length === 1 && stored !== null && ok.updatedAt === new Date(NOW).toISOString());
  check("Prompt enthält Datum und Quelle je Meldung", seenPrompt[0] === "2026-10-20 | Reuters | " + items[0].title && centralBankPrompt(seenPrompt).includes("Nichts schätzen"));
  const cached = await loadCentralBankGoldBuying(deps({ cacheGet: () => ok, complete: async () => { throw new Error("darf nicht laufen"); } }));
  check("Cache 12 h wird genutzt", cached === ok);

  // Kein Score-Effekt
  const base: GoldNewsImpact = { flag: 0.3, summary: "s", updatedAt: new Date(NOW).toISOString(), llmAvailable: true, unavailableReason: null, items, cacheTtlHours: 12 };
  check("goldNewsScoreFlag gleich mit/ohne Zentralbank-Zeile", goldNewsScoreFlag(base, NOW) === goldNewsScoreFlag({ ...base, centralBankBuying: ok }, NOW));
  check("goldNewsScoreFlag null bleibt null trotz Einträgen", goldNewsScoreFlag({ ...base, flag: null, centralBankBuying: ok }, NOW) === null);
  const impact = await loadGoldNewsImpact({ now: NOW, llmAvailable: true, fetchItems: async () => items, complete: async () => ({ flag: 0.3, summary: "s" }), cacheGet: () => null, cacheSet: () => {} });
  check("loadGoldNewsImpact (Flag-Pfad) ohne Zentralbank-Feld, Flag unverändert", impact.flag === 0.3 && !("centralBankBuying" in impact));
  const routes = readFileSync("server/gold-routes.ts", "utf8");
  check("Score-Eingang bleibt nur goldNewsScoreFlag (newsFlag)", /newsFlag: goldNewsScoreFlag\(goldNews, Date\.now\(\)\)/.test(routes) && !/centralBankBuying/.test(routes));
  check("Gold-Score-Dateien ohne Zentralbank-Bezug", !/centralBank/i.test(readFileSync("server/gold-adaptive-score.ts", "utf8")));

  // Karte
  const html = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: { goldNews: { ...base, centralBankBuying: { ...ok, discarded: 2 } } }, now: NOW }));
  check("Karte zeigt Eintrag mit Quelle und Datum", html.includes("gold-cb-buying-entry") && html.includes("NBP") && html.includes("12 t") && html.includes("Reuters") && html.includes("20.10.2026"));
  check("Karte nennt verworfene Einträge", html.includes("2 LLM-Eintrag/Einträge ohne Beleg verworfen"));
  const htmlNa = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: { goldNews: { ...base, centralBankBuying: noKey } }, now: NOW }));
  check("Karte n/a mit Grund", htmlNa.includes("gold-cb-buying-na") && htmlNa.includes("n/a · OPENROUTER_API_KEY fehlt"));
  const htmlNone = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: { goldNews: base }, now: NOW }));
  check("altes Payload ohne Feld → n/a 'keine Daten'", htmlNone.includes("n/a · keine Daten"));

  console.log(fail ? `\n${fail} Fehler` : "\nAlle Tests grün");
  process.exit(fail ? 1 : 0);
})();
