/**
 * Grundformlexika für die Namensprüfung.
 * Quelle: Wikidata-Lexeme, CC0.
 * Filter: nur die genannte Wortart; Lexeme mit zusätzlich Eigenname (Q147276) entfallen;
 * nach Kleinschreibung nur Buchstaben, keine Leerzeichen, Ziffern oder Bindestriche;
 * Lemmata aus de-companies und de-products entfallen.
 * Deutsche Zusatznomen: Q1084, 21 bis 40 Buchstaben, die noch nicht in de-nouns stehen.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/build-base-lexicons.ts
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { DE_COMPANY_NAMES } from "../shared/de-companies";
import { DE_NOUN_LEMMAS } from "../shared/de-nouns";
import { DE_PRODUCT_NAMES } from "../shared/de-products";

const ENDPOINT = "https://query.wikidata.org/sparql";
const DATE = "2026-11-26";
const PROPER = "Q147276";
const FILTER_RULE = "Lexical category is the one named in the query. A lexeme that also has proper-noun category Q147276 is excluded. After lowercasing, only letter lemmas are kept (German a-z äöüß, English a-z), so spaces, digits and hyphens drop out. Lemmas that also occur in de-companies or de-products are removed.";

const BLOCKED = new Set<string>([...DE_COMPANY_NAMES, ...DE_PRODUCT_NAMES]);
const HAVE_NOUNS = new Set(DE_NOUN_LEMMAS);

interface Job {
  file: string;
  snapshot: string;
  exportName: string;
  language: "de" | "en";
  langQ: string;
  category: string;
  categoryQ: string;
  min: number;
  max: number;
  onlyMissingNouns?: boolean;
}

const JOBS: Job[] = [
  { file: "shared/de-adjectives.ts", snapshot: "script/fixtures/de-adjectives.snapshot.json", exportName: "DE_ADJECTIVE_LEMMAS", language: "de", langQ: "Q188", category: "adjective", categoryQ: "Q34698", min: 2, max: 40 },
  { file: "shared/de-verbs-base.ts", snapshot: "script/fixtures/de-verbs-base.snapshot.json", exportName: "DE_VERB_BASE_LEMMAS", language: "de", langQ: "Q188", category: "verb", categoryQ: "Q24905", min: 2, max: 40 },
  { file: "shared/en-adjectives.ts", snapshot: "script/fixtures/en-adjectives.snapshot.json", exportName: "EN_ADJECTIVE_LEMMAS", language: "en", langQ: "Q1860", category: "adjective", categoryQ: "Q34698", min: 2, max: 40 },
  { file: "shared/en-verbs.ts", snapshot: "script/fixtures/en-verbs.snapshot.json", exportName: "EN_VERB_LEMMAS", language: "en", langQ: "Q1860", category: "verb", categoryQ: "Q24905", min: 2, max: 40 },
  { file: "shared/en-nouns.ts", snapshot: "script/fixtures/en-nouns.snapshot.json", exportName: "EN_NOUN_LEMMAS", language: "en", langQ: "Q1860", category: "noun", categoryQ: "Q1084", min: 2, max: 40 },
  { file: "shared/de-nouns-extra.ts", snapshot: "script/fixtures/de-nouns-extra.snapshot.json", exportName: "DE_NOUN_EXTRA", language: "de", langQ: "Q188", category: "noun", categoryQ: "Q1084", min: 21, max: 40, onlyMissingNouns: true },
];

function letters(language: "de" | "en"): string[] {
  const base = "abcdefghijklmnopqrstuvwxyz".split("");
  return language === "de" ? [...base, "ä", "ö", "ü"] : base;
}

function pattern(language: "de" | "en"): RegExp {
  return language === "de" ? /^[a-zäöüß]+$/ : /^[a-z]+$/;
}

async function fetchPrefix(job: Job, prefix: string): Promise<string[]> {
  const query = `SELECT ?lemma WHERE {
  ?lexeme dct:language wd:${job.langQ} ;
          wikibase:lexicalCategory wd:${job.categoryQ} ;
          wikibase:lemma ?lemma .
  FILTER(LANG(?lemma) = "${job.language}")
  FILTER(STRSTARTS(LCASE(STR(?lemma)), ${JSON.stringify(prefix)}))
  FILTER NOT EXISTS { ?lexeme wikibase:lexicalCategory wd:${PROPER} }
}`;
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "AktienanalystPodcast/1.0 (lexicon snapshot)",
      },
      body: new URLSearchParams({ query }),
    });
    if (response.ok) {
      const body = await response.json() as { results?: { bindings?: Array<{ lemma?: { value?: string } }> } };
      const out: string[] = [];
      for (const row of body.results?.bindings ?? []) out.push(row.lemma?.value ?? "");
      return out;
    }
    last = `${response.status}`;
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new Error(`${job.category} ${prefix} ${last}`);
}

function keep(job: Job, raw: string): string | null {
  const value = raw.toLowerCase();
  if (value.length < job.min || value.length > job.max) return null;
  if (!pattern(job.language).test(value)) return null;
  if (BLOCKED.has(value)) return null;
  if (job.onlyMissingNouns && HAVE_NOUNS.has(value)) return null;
  return value;
}

function header(job: Job, count: number): string {
  const kind = job.language === "de" ? "German" : "English";
  return `/** ${kind} ${job.category} lemmas, ${job.min} to ${job.max} letters.
 * Source: Wikidata lexeme namespace, language ${job.language === "de" ? "German (Q188)" : "English (Q1860)"}, lexical category ${job.category} (${job.categoryQ}).
 * Queried ${DATE}. Count ${count}.
 * Filter: ${FILTER_RULE}
 * License: CC0. https://www.wikidata.org/wiki/Wikidata:Copyright
 * "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License."
 */
export const ${job.exportName}: string[] = \`
`;
}

async function main(): Promise<void> {
  for (const job of JOBS) {
    const found = new Set<string>();
    for (const prefix of letters(job.language)) {
      const rows = await fetchPrefix(job, prefix);
      for (const row of rows) {
        const value = keep(job, row);
        if (value) found.add(value);
      }
      console.log(job.exportName, prefix, rows.length, "kept", found.size);
    }
    const lemmas = [...found].sort((a, b) => a.localeCompare(b, job.language));
    const lines: string[] = [];
    for (let i = 0; i < lemmas.length; i += 12) lines.push(lemmas.slice(i, i + 12).join(" "));
    writeFileSync(job.file, `${header(job, lemmas.length)}${lines.join("\n")}\n\`.trim().split(/\\s+/);\n`);
    const joined = lemmas.join("\n");
    writeFileSync(job.snapshot, JSON.stringify({
      date: DATE,
      endpoint: ENDPOINT,
      language: job.language,
      languageQ: job.langQ,
      lexicalCategory: job.categoryQ,
      category: job.category,
      minLength: job.min,
      maxLength: job.max,
      properNounExcluded: PROPER,
      filter: FILTER_RULE,
      onlyMissingNouns: job.onlyMissingNouns === true,
      count: lemmas.length,
      license: "CC0",
      lemmaSha256: createHash("sha256").update(joined).digest("hex"),
    }, null, 2));
    console.log("geschrieben", job.file, lemmas.length);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
