/** Multi-word places for a mid-sentence name check.
 * An original selection for this repository. Single-word cities stay out.
 * The labels are the English or German names of the Wikidata items cited below.
 * License: CC0. https://www.wikidata.org/wiki/Wikidata:Copyright
 * "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License."
 * New York Q60, Los Angeles Q65, San Francisco Q62, San Diego Q16552, Las Vegas Q23768,
 * Tel Aviv Q33935, Frankfurt am Main Q1794, Rio de Janeiro Q8678, Buenos Aires Q1486,
 * São Paulo Q174, Kuala Lumpur Q1865, New Delhi Q987, Cape Town Q5465, Mexico City Q1489,
 * Abu Dhabi Q1519, The Hague Q36600, Den Haag Q36600, New Jersey Q1408, New Mexico Q1522,
 * West Virginia Q1371, North Carolina Q1454, South Carolina Q1456, Baden-Württemberg Q985,
 * Nordrhein-Westfalen Q1198, Rheinland-Pfalz Q1200, Schleswig-Holstein Q1194,
 * Mecklenburg-Vorpommern Q1196.
 * No company names and no product names.
 */
export const MULTI_WORD_PLACES: string[] = `
New York
Los Angeles
San Francisco
San Diego
Las Vegas
Tel Aviv
Frankfurt am Main
Rio de Janeiro
Buenos Aires
Sao Paulo
São Paulo
Kuala Lumpur
New Delhi
Cape Town
Mexico City
Abu Dhabi
The Hague
Den Haag
New Jersey
New Mexico
West Virginia
North Carolina
South Carolina
Baden-Württemberg
Nordrhein-Westfalen
Rheinland-Pfalz
Schleswig-Holstein
Mecklenburg-Vorpommern
`.trim().split("\n");
