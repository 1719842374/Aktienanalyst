/**
 * Substantive länger als 20 Buchstaben mit Adjektivkopf.
 * Quelle: Wikidata-Lexeme, Sprache Deutsch, Kategorie Nomen (Q1084), CC0.
 * Keine Firmen- und keine Produktnamen. Plural wird nicht gespeichert.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/build-de-nouns-adj.ts
 */
import { writeFileSync } from "node:fs";
import { DE_COMPANY_NAMES } from "../shared/de-companies";
import { DE_NOUN_LEMMAS } from "../shared/de-nouns";
import { DE_PRODUCT_NAMES } from "../shared/de-products";

const ENDPOINT = "https://query.wikidata.org/sparql";
const DATE = "2026-11-26";
const HEADS = ["gross", "groß", "hoch", "klein", "schnell", "stark", "kurz", "lang", "schwach", "breit", "tief", "weit"];
const QUERY = `SELECT ?lemma WHERE {
  ?lexeme dct:language wd:Q188 ;
          wikibase:lexicalCategory wd:Q1084 ;
          wikibase:lemma ?lemma .
  FILTER(LANG(?lemma) = "de")
  FILTER(STRLEN(STR(?lemma)) > 20 && STRLEN(STR(?lemma)) <= 36)
  FILTER(REGEX(LCASE(STR(?lemma)), "^(gross|groß|hoch|klein|schnell|stark|kurz|lang|schwach|breit|tief|weit)"))
}`;

async function main(): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "AktienanalystPodcast/1.0 (lexicon snapshot)",
    },
    body: new URLSearchParams({ query: QUERY }),
  });
  if (!response.ok) throw new Error(String(response.status));
  const body = await response.json() as { results?: { bindings?: Array<{ lemma?: { value?: string } }> } };
  const companies = new Set(DE_COMPANY_NAMES);
  const products = new Set(DE_PRODUCT_NAMES);
  const nouns = new Set(DE_NOUN_LEMMAS);
  const found = new Set<string>();
  for (const row of body.results?.bindings ?? []) {
    const value = (row.lemma?.value ?? "").toLowerCase();
    if (value.length < 21 || value.length > 36) continue;
    if (!/^[a-zäöüß]+$/.test(value)) continue;
    if (!HEADS.some(head => value.startsWith(head) && value.length - head.length >= 8)) continue;
    if (companies.has(value) || products.has(value) || nouns.has(value)) continue;
    found.add(value);
  }
  const lemmas = [...found].sort((a, b) => a.localeCompare(b, "de"));
  const lines: string[] = [];
  for (let i = 0; i < lemmas.length; i += 8) lines.push(lemmas.slice(i, i + 8).join(" "));
  const header = `/** German noun lemmas with an adjective head, 21 to 36 letters.
 * Source: Wikidata lexeme namespace, language German, lexical category noun (Q1084).
 * Queried ${DATE}. Plurals are not stored; the name check derives them from the lemma.
 * Company names and product names are left out. No copied company or product list.
 * License: CC0. https://www.wikidata.org/wiki/Wikidata:Copyright
 * "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License."
 */
export const DE_NOUN_ADJECTIVE: string[] = \`
${lines.join("\n")}
\`.trim().split(/\\s+/);
`;
  writeFileSync("shared/de-nouns-adj.ts", header);
  writeFileSync("script/fixtures/de-nouns-adj.snapshot.json", JSON.stringify({
    date: DATE,
    endpoint: ENDPOINT,
    language: "de",
    lexicalCategory: "Q1084",
    minLength: 21,
    maxLength: 36,
    heads: HEADS,
    pattern: "^[a-zäöüß]+$",
    query: QUERY,
    count: lemmas.length,
    license: "CC0",
    plural: "not stored; derived from the lemma",
  }, null, 2));
  console.log("geschrieben", lemmas.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
