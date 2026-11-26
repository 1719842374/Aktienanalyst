/**
 * Fallback je Absatz nach zwei Redos, none true.
 * Ohne Argument: der vorregistrierte 168er-Satz, Tuning.
 * Mit --fresh: der andere Ticker-Satz. Den erst nach dem Commit laufen lassen.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/measure-podcast-fallback-none.ts
 */
import { buildPodcastFacts } from "../shared/podcast-facts";
import { applyRedo, buildSpeechSheet, fallbackParagraph, seedDrafts } from "../shared/podcast-fluent";
import type { PodcastLanguage } from "../shared/podcast-types";
import {
  FALLBACK_168_AT,
  FALLBACK_168_CHAPTERS,
  FALLBACK_168_COMPANIES,
  FALLBACK_168_PER_LANGUAGE,
  FALLBACK_168_TICKERS,
} from "./fixtures/podcast-fallback-168";
import {
  FALLBACK_FRESH_AT,
  FALLBACK_FRESH_CHAPTERS,
  FALLBACK_FRESH_COMPANIES,
  FALLBACK_FRESH_TICKERS,
} from "./fixtures/podcast-fallback-fresh";

function wilsonUpper(k: number, n: number): number {
  if (n === 0) return 1;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return center + margin;
}

const fresh = process.argv.includes("--fresh");
const tickers = fresh ? FALLBACK_FRESH_TICKERS : FALLBACK_168_TICKERS;
const companies = fresh ? FALLBACK_FRESH_COMPANIES : FALLBACK_168_COMPANIES;
const chapters = fresh ? FALLBACK_FRESH_CHAPTERS : FALLBACK_168_CHAPTERS;
const at = new Date(fresh ? FALLBACK_FRESH_AT : FALLBACK_168_AT);

function pack(ticker: string, company: string) {
  return {
    ticker,
    day: "2026-11-26",
    generatedAt: at.toISOString(),
    analysis: {
      ticker,
      companyName: company,
      podcastCompanySource: "yahoo-chart",
      currency: "USD",
      currentPrice: 100,
      dataTimestamp: "2026-11-26T10:00:00.000Z",
      s17Verdict: "GRÜN",
      dcfConservative: 120,
      crv: 0.2,
      maxEntryCrv3: 80,
      financialStatements: { incomeStatement: { revenueGrowth: 8 } },
      revenueSegments: [{ name: "Kern", percentage: 60, fiscalYear: "2026" }],
      catalysts: [{ name: "Ausbau", nettoUpside: 4 }],
      risks: [{ name: "Preis" }],
      newsItems: [{ title: "Hinweis", pubDate: "2026-11-25T08:00:00.000Z" }],
      _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
      growthThesis: "Die Nachfrage trägt die Geschichte der Firma.",
    },
    pestelLlm: null,
    management: null,
    managementInterpret: null,
    earningsBrief: null,
    regulatory: null,
    thesisStrength: null,
    policyContext: null,
    timedOut: [],
    sections: { analyze: true },
  };
}

console.log(fresh ? "fresh" : "168 tuning");
for (const language of ["de", "en"] as const satisfies readonly PodcastLanguage[]) {
  let ambiguous = 0;
  let rest = 0;
  let n = 0;
  const restNotes = new Map<string, number>();
  for (let i = 0; i < tickers.length; i++) {
    const sheet = buildSpeechSheet(buildPodcastFacts(pack(tickers[i]!, companies[i]!) as never, at), language);
    for (const id of chapters) {
      const base = fallbackParagraph(id, sheet);
      if (!base) continue;
      const tail = language === "de"
        ? "Die Nachfrage bleibt der Maßstab und der Kurs stützt die Bewertung."
        : "Demand remains the verified view and the price stays with the firm.";
      for (const text of [base, `${base} ${tail}`]) {
        n += 1;
        const model = { chapters: [{ id, paragraph: text, entities: [], none: true }] };
        const none = new Set([id]);
        const entities = new Map<string, string[] | null>([[id, []]]);
        let drafts = seedDrafts(sheet, "pdf", model, entities, new Set(), none);
        drafts = applyRedo(sheet, drafts, model, entities, entities, new Set(), none);
        drafts = applyRedo(sheet, drafts, model, entities, entities, new Set(), none);
        const draft = drafts.find(row => row.id === id);
        if (!draft?.reasons.length) continue;
        if (draft.notes.some(note => note.startsWith("ambiguous"))) ambiguous += 1;
        else {
          rest += 1;
          const key = draft.notes.join("|") || draft.reasons.join("|");
          restNotes.set(key, (restNotes.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const fallen = ambiguous + rest;
  console.log(language, "n", n, "pro Sprache", "ambiguous", ambiguous, "rest", rest, "fallen", fallen, "upper", wilsonUpper(fallen, n).toFixed(4));
  for (const [key, count] of restNotes) console.log(" ", count, key);
  if (!fresh && n !== FALLBACK_168_PER_LANGUAGE) {
    console.error(`${language}: Nenner ${n}`);
    process.exit(1);
  }
  if (fresh && n < 100) {
    console.error(`${language}: Abnahme-Nenner ${n} unter 100`);
    process.exit(1);
  }
}
