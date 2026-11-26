/**
 * Hebt die 10-Zeichen-Grenze der deutschen Substantive auf 20 an.
 * Quelle: Wikidata-Lexeme, Sprache Deutsch, Kategorie Nomen, CC0.
 * Schreibt shared/de-nouns-long.ts und script/fixtures/de-nouns-long.snapshot.json.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/build-de-nouns-long.ts
 */
import { writeFileSync } from "node:fs";

const ENDPOINT = "https://query.wikidata.org/sparql";
const DATE = "2026-11-26";
const MIN = 11;
const MAX = 20;
const QUERY = `SELECT ?lemma WHERE {
  ?lexeme dct:language wd:Q188 ;
          wikibase:lexicalCategory wd:Q1084 ;
          wikibase:lemma ?lemma .
  FILTER(LANG(?lemma) = "de")
  FILTER(STRLEN(STR(?lemma)) > 10 && STRLEN(STR(?lemma)) <= 20)
  FILTER(STRSTARTS(LCASE(STR(?lemma)), PREFIX))
}`;

const letters = "abcdefghijklmnopqrstuvwxyzäöü".split("");

async function fetchPrefix(prefix: string): Promise<string[]> {
  const query = QUERY.replace("PREFIX", JSON.stringify(prefix));
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "AktienanalystPodcast/1.0 (lexicon snapshot)",
    },
    body: new URLSearchParams({ query }),
  });
  if (!response.ok) throw new Error(`${prefix} ${response.status}`);
  const body = await response.json() as { results?: { bindings?: Array<{ lemma?: { value?: string } }> } };
  const out: string[] = [];
  for (const row of body.results?.bindings ?? []) {
    const value = row.lemma?.value?.toLowerCase() ?? "";
    if (value.length < MIN || value.length > MAX) continue;
    if (!/^[a-zäöüß]+$/.test(value)) continue;
    out.push(value);
  }
  return out;
}

async function main(): Promise<void> {
  const found = new Set<string>();
  for (const letter of letters) {
    const rows = await fetchPrefix(letter);
    for (const row of rows) found.add(row);
    console.log(letter, rows.length, "gesamt", found.size);
  }
  const lemmas = [...found].sort((a, b) => a.localeCompare(b, "de"));
  const lines: string[] = [];
  for (let i = 0; i < lemmas.length; i += 12) lines.push(lemmas.slice(i, i + 12).join(" "));
  const header = `/** German noun lemmas, eleven to twenty letters, no spaces.
 * Source: Wikidata lexeme namespace, language German, lexical category noun (Q1084).
 * Queried ${DATE}. The two-to-ten-letter list stays in de-nouns.ts.
 * License: CC0. https://www.wikidata.org/wiki/Wikidata:Copyright
 * "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License."
 */
export const DE_NOUN_LONG: string[] = \`
${lines.join("\n")}
\`.trim().split(/\\s+/);
`;
  writeFileSync("shared/de-nouns-long.ts", header);
  writeFileSync("script/fixtures/de-nouns-long.snapshot.json", JSON.stringify({
    date: DATE,
    endpoint: ENDPOINT,
    language: "de",
    lexicalCategory: "Q1084",
    minLength: MIN,
    maxLength: MAX,
    pattern: "^[a-zäöüß]+$",
    query: QUERY,
    count: lemmas.length,
    license: "CC0",
  }, null, 2));
  console.log("geschrieben", lemmas.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
