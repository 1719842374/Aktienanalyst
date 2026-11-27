import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { buildPodcastLlmPrompt } from "../shared/podcast-script";
const analysis: any = { ticker: "NVO", companyName: "Novo Nordisk A/S", currentPrice: 48, currency: "USD", sector: "Healthcare", industry: "Drug Manufacturers", catalystsSource: "llm", dataTimestamp: "2026-11-26T12:00:00.000Z",
  growthThesis: "GLP-1-Marktführer mit Pipeline CagriSema; Preisdruck in den USA bremst.",
  financialStatements: { incomeStatement: { revenue: 40e9, revenueGrowth: 8 } }, _podcastInternals: { revenueY1: 37e9, fiscalYear: "2025", fxRateToUsd: 1, reportedCurrency: "USD" },
  revenueSegments: [{ name: "GLP-1 Diabetes (Ozempic/Rybelsus)", revenue: 17e9, percentage: 43.6 }],
  catalysts: [{ name: "CagriSema Phase-3 Zulassung & Marktstart", nettoUpside: 9.1 }, { name: "Orales Wegovy", nettoUpside: 4.2 }],
  risks: [{ name: "US Preisregulierung IRA" }, { name: "Wettbewerb durch Lilly" }],
  newsItems: [{ title: "Novo cuts prices for Wegovy in US", pubDate: "2026-11-26T08:00:00.000Z" }],
  moatAssessment: { porterForces: [{ force: "Rivalität", summary: "Duopol mit Lilly, hoher Preisdruck." }, { force: "Lieferantenmacht", summary: "Gering." }] },
  moat: { summary: "Patente und Produktionskapazität." },
};
const pack: any = { ticker: "NVO", day: "2026-11-26", generatedAt: "2026-11-26T12:00:00.000Z", analysis,
  pestelLlm: [{ dimension: "Political", summary: "Medicare-Preisverhandlungen ab 2027." }],
  management: null,
  managementInterpret: { data: { gesamteinschaetzung: "Solide Umsetzung.", staerken: ["Delivery: hält Guidance", "Kapital: Rückkäufe", "Segment: GLP-1 wächst", "Glaubwürdigkeit: konsistent", "Qual: wenig Skandale", "Pipeline: breit", "Produktion: Ausbau"], schwaechen: ["Preisdruck unterschätzt"], interpretation: { positiv: "Execution stark", kritisch: "USA-Preise", governanceSignal: null, datenlueckenHinweis: null }, fazit: "7,1 ist ein starker Score." } },
  earningsBrief: null,
  regulatory: { ticker: "NVO", exposures: [{ country: "USA", regulationAxis: "price_regulation", title: "IRA Preisverhandlung", description: "Medicare verhandelt Semaglutid-Preis.", revenueShareInCountry: 0.55, estimatedImpactOnSales: -0.08, probability: 0.9, timeHorizon: "0-12m", source: { url: "https://x", publishedAt: "2026-11-01", snippet: "s" }, confidence: "high", epsImpact: -0.3, material: true, badgeOnly: false }, { country: "EU", regulationAxis: "competition_antitrust", title: "EU Kartell", description: "Prüfung.", revenueShareInCountry: 0.2, estimatedImpactOnSales: -0.01, probability: 0.2, timeHorizon: "24-36m", source: { url: "https://y", publishedAt: "2026-10-01", snippet: "t" }, confidence: "low", epsImpact: 0, material: false, badgeOnly: true }], discarded: 1, gate: { id: "REGULATORY_EXPOSURE", active: true, cap: 6, severity: "warn", rationale: "US-Preisregulierung material." }, modelUsed: "x-ai/grok-4", generatedAt: "2026-11-26T11:00:00.000Z" },
  thesisStrength: null, policyContext: { usa: "Zölle auf Pharma angedroht.", moatImpact: "Gering." }, timedOut: [], sections: { analyze: true } };
import { ALLOWED_CODE_PATTERNS, COMPOUND_FUGEN, COMPOUND_SUFFIXES, buildSpeechSheet, verifyChapter } from "../shared/podcast-fluent";
const facts = buildPodcastFacts(pack, new Date("2026-11-26T13:00:00Z"));
const de = buildSpeechSheet(facts, "de"), en = buildSpeechSheet(facts, "en");
console.log("packNames", JSON.stringify([...new Set(de.packNames)]));
const DE: [string,string][] = [
 ["einstieg","Heute schauen wir uns [[company]] genauer an, und die Aktie kostet im Moment [[price]]. Die Zahlen beziehen sich auf den [[as_of]] und geben einen guten Überblick über die Lage."],
 ["umsatz","Im Geschäftsjahr [[gj_year]] wuchs der Konzernumsatz um [[fy_yoy]] gegenüber dem Vorjahr. Dabei trägt [[top_segment]] mit [[top_segment_share]] den größten Teil zum Ergebnis bei."],
 ["s17","Der stärkste Treiber für die Aktie ist [[pair_a]], und viele Anleger achten deshalb genau darauf. Den zweiten Impuls liefert [[pair_b]], auch wenn der Gegenwind im Markt spürbar bleibt."],
 ["news","Die jüngste Meldung stammt von [[news_age]] und betrifft die Preise des Unternehmens in den Vereinigten Staaten. Für die Aktionäre ist das ein wichtiger Hinweis auf die weitere Entwicklung."],
 ["s17","Spannend bleibt vor allem [[pair_a]], weil davon der Ausbau der Produktion abhängt. Insgesamt liefert auch [[pair_b]] einen Beitrag, der den Kursrückgang der letzten Monate abfedern könnte."],
 ["umsatz","Der Umsatz stieg im Jahr [[gj_year]] um [[fy_yoy]], was für ein Unternehmen dieser Größe solide ist. Das wichtigste Geschäft bleibt [[top_segment]] mit einem Anteil von [[top_segment_share]] am Gesamtumsatz."],
 ["s17","Wichtig ist der Wettbewerb, denn [[pair_a]] entscheidet über die Stellung des Unternehmens im Markt. Auch [[pair_b]] braucht noch die Zulassung durch die Behörden, bevor daraus echter Umsatz werden kann."],
 ["news","Die letzte Nachricht kam von [[news_age]], und sie dreht sich um gesenkte Preise in den Vereinigten Staaten. Der Markt reagiert auf solche Meldungen oft schnell und nervös."],
 ["einstieg","Willkommen zu unserer kurzen Analyse von [[company]], deren Aktie derzeit bei [[price]] steht. Alle Angaben in dieser Folge beziehen sich auf den [[as_of]] und auf die neuen Studiendaten."],
 ["s17","Die nächste Phase der Studien entscheidet über [[pair_a]], und die Firma investiert dafür kräftig. Bei [[pair_b]] hängt viel am Marktstart, der für die neue Produktgruppe geplant ist."],
 ["umsatz","Das Wachstum von [[fy_yoy]] im Jahr [[gj_year]] kam vor allem aus dem Geschäft mit Diabetes und Übergewicht. Davon entfällt auf [[top_segment]] ein Anteil von [[top_segment_share]] am gesamten Geschäft."],
];
const EN: [string,string][] = [
 ["einstieg","Today we take a closer look at [[company]], and the stock currently trades at [[price]]. All figures in this episode are as of [[as_of]] and give a good overview of the situation."],
 ["umsatz","In fiscal year [[gj_year]] the company grew its revenue by [[fy_yoy]] compared with the prior year. The biggest contribution comes from [[top_segment]], which accounts for [[top_segment_share]] of the business."],
 ["s17","The strongest driver for the stock is [[pair_a]], and many investors are watching it closely. The second push comes from [[pair_b]], even though headwinds in the market remain moderate."],
 ["news","The latest report came out [[news_age]] and deals with lower prices for the company in the United States. For shareholders this is an important signal about the next few quarters."],
 ["s17","The key question is whether [[pair_a]] can deliver, because the expansion of production depends on it. Overall [[pair_b]] also adds something, which could soften the recent decline in the share price."],
 ["umsatz","Revenue rose by [[fy_yoy]] in [[gj_year]], which is a solid result for a company of this size. The most important business remains [[top_segment]] with a share of [[top_segment_share]] of total sales."],
 ["s17","Competition matters here, since [[pair_a]] decides how strong the company stays in its market. The next phase also needs approval from regulators before [[pair_b]] can turn into real sales."],
 ["news","The most recent news arrived [[news_age]] and it is about price cuts in the United States market. Markets tend to react to this kind of headline quickly and with some nervousness."],
 ["einstieg","Welcome to our short analysis of [[company]], whose shares are trading at [[price]] right now. Every number in this episode is as of [[as_of]] and reflects the latest data we have."],
];
for (const [lab, sheet, set] of [["DE", de, DE], ["EN", en, EN]] as const) { let ok = 0; for (const [c, t] of set) { const v = verifyChapter(c, t, sheet, null); const v2 = verifyChapter(c, t, sheet, []); if (v.ok && v2.ok) ok++; else console.log(lab, c, JSON.stringify(v.notes), JSON.stringify(v2.notes)); } console.log(lab, `${ok}/${set.length} ok`); }
const NAMES: [string,string,string,string[]][] = [
 ["DE","s17","Der stärkste Treiber für die Aktie ist [[pair_a]], und auch Toyota beobachtet diesen Markt sehr genau.",["Toyota"]],
 ["DE","s17","Apple steigt ebenfalls in den Markt ein, und deshalb zählt [[pair_a]] für die Aktie jetzt besonders viel.",["Apple"]],
 ["DE","s17","Der Konkurrent Pfizer arbeitet an einem ähnlichen Mittel, während [[pair_a]] für die Firma weiter wichtig bleibt.",["Pfizer"]],
 ["DE","s17","Das Mittel Zepbound setzt die Firma unter Druck, aber [[pair_a]] bleibt für die Aktie der wichtigste Treiber.",["Zepbound"]],
 ["DE","s17","Auch Mounjaro wächst schnell im Markt, und deshalb bleibt [[pair_a]] für die Aktie ein entscheidender Punkt.",["Mounjaro"]],
 ["DE","s17","Der Rivale Lily holt im Markt auf, und deshalb bleibt [[pair_a]] für die Aktie ein entscheidender Punkt.",["Lily"]],
 ["DE","s17","Der Rivale Lilly holt im Markt auf, und deshalb bleibt [[pair_a]] für die Aktie ein entscheidender Punkt.",["Lilly"]],
 ["DE","s17","Auch Ozempic bleibt für die Firma wichtig, und deshalb zählt [[pair_a]] für die Aktie jetzt besonders viel.",["Ozempic"]],
 ["DE","s17","Die Phasen und Zulassungen in vielen Märkten bleiben wichtig, und deshalb zählt [[pair_a]] für die Aktie besonders viel.",[]],
 ["EN","s17","Toyota is also watching this market closely, and [[pair_a]] remains the key driver for the stock.",["Toyota"]],
 ["EN","s17","The key driver remains [[pair_a]], while Apple is also entering this market with a similar product.",["Apple"]],
 ["EN","s17","The key driver remains [[pair_a]], while rival Lily is catching up quickly in the same market.",["Lily"]],
 ["EN","s17","The key driver remains [[pair_a]], while the center of attention stays on the same market for now.",[]],
 ["EN","news","The latest report came out [[news_age]] and it concerns price rules in the United Kingdom for the company.",[]],
];
for (const [l,c,t,e] of NAMES) { const s = l==="DE"?de:en; console.log("NAME", l, t.slice(0,34), "null:", verifyChapter(c,t,s,null).notes.join(",")||"OK", "| []:", verifyChapter(c,t,s,[]).notes.join(",")||"OK", "| ents:", verifyChapter(c,t,s,e).notes.join(",")||"OK"); }

// Satzanfangs-Probes (DE, Pflicht OK mit null und [])
const STARTS = ["Zudem bleibt [[pair_a]] für die Aktie wichtig, und der Markt achtet sehr genau darauf.","Gleichzeitig bleibt [[pair_a]] für die Aktie wichtig, und der Markt achtet sehr genau darauf.","Unterm Strich bleibt [[pair_a]] für die Aktie wichtig, und der Markt achtet sehr genau darauf.","Wichtig bleibt [[pair_a]] für die Aktie, und der Markt achtet sehr genau darauf im Moment.","Trotzdem bleibt [[pair_a]] für die Aktie wichtig, und Investoren achten sehr genau darauf.","Besonders bleibt [[pair_a]] für die Aktie wichtig, und die Börse achtet sehr genau darauf.","Kurzfristig bleibt [[pair_a]] für die Aktie wichtig, und Analysten achten sehr genau darauf.","Spannend ist [[pair_a]] für die Aktie, denn Medikamente gegen Fettleibigkeit wachsen sehr stark.","Letztlich zählt [[pair_a]] für die Aktie, weil Abnehmspritzen und Diabetesmittel stark gefragt sind.","Ehrlich gesagt bleibt [[pair_a]] für die Aktie wichtig, und der Markt achtet genau darauf.","Allerdings bleibt [[pair_a]] für die Aktie wichtig, und der Markt achtet sehr genau darauf.","Insgesamt bleibt [[pair_a]] für die Aktie wichtig, und der Markt achtet sehr genau darauf."];
let sOk = 0; for (const t of STARTS) { const a = verifyChapter("s17", t, de, null), b = verifyChapter("s17", t, de, []); if (a.ok && b.ok) sOk++; else console.log("START FAIL", t.slice(0, 30), a.notes.join(","), "|", b.notes.join(",")); }
console.log(`STARTS ${sOk}/${STARTS.length} ok`);
// Namens-Probes DE mit null/[]: Pflicht REJECT; Ozempic (im Pack) Pflicht OK
const TRAPS = ["Toyota","Apple","Pfizer","Zepbound","Mounjaro","Lily","Pfizerwerk","Toyotawagen"];
for (const n of [...TRAPS, "Lilly", "Ozempic"]) { const t = `Der stärkste Treiber ist [[pair_a]], und auch ${n} beobachtet den Markt sehr genau.`; console.log("TRAP", n.padEnd(12), "null:", verifyChapter("s17", t, de, null).notes.join(",") || "OK", "| []:", verifyChapter("s17", t, de, []).notes.join(",") || "OK", "| ents:", verifyChapter("s17", t, de, [n]).notes.join(",") || "OK", "| none:", verifyChapter("s17", t, de, [], true).notes.join(",") || "OK"); }
const lexiconRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lexiconFiles = ["shared/de-nouns.ts", "shared/de-closed.ts", "shared/de-companies.ts", "shared/de-nouns-long.ts", "shared/de-nouns-adj.ts", "shared/de-products.ts", "shared/en-common.ts", "shared/place-names.ts", "shared/quantity-words.ts"];
const lexiconHash = createHash("sha256");
for (const rel of lexiconFiles) {
  const bytes = readFileSync(join(lexiconRoot, rel));
  lexiconHash.update(rel);
  lexiconHash.update(bytes);
  console.log("LEXICON-FILE", rel, createHash("sha256").update(bytes).digest("hex"));
}
lexiconHash.update(["fugen", ...COMPOUND_FUGEN].join("\n"));
lexiconHash.update(["suffix", ...COMPOUND_SUFFIXES].join("\n"));
lexiconHash.update(["code", ...ALLOWED_CODE_PATTERNS].join("\n"));
console.log("LEXICON", lexiconHash.digest("hex"));
process.exit(0);
