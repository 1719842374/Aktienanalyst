/**
 * 25 Negativfälle, fest vor der Abnahme.
 *
 * N12 und N22 lassen Blatt und [] durch, weil „blackwell“ kleingeschrieben ist
 * und nicht in de-companies steht. N05, N06, N18 und N19 nennen Rekord oder highest
 * ohne folgende Zahl und sind deshalb keine Zahlen-Behauptung.
 */
export interface PodcastNegativeCase {
  id: string;
  chapterId: string;
  language: "de" | "en";
  text: string;
  entities: string[] | null;
}

export const PODCAST_NEGATIVES_25: PodcastNegativeCase[] = [
  { id: "N01", chapterId: "umsatz", language: "de", entities: null, text: "Das Umsatzwachstum im Geschäftsjahr [[gj_year]] hat sich verdoppelt und bleibt der Jahreswert. Das Segment bleibt die belegte Aufteilung der Firma." },
  { id: "N02", chapterId: "umsatz", language: "de", entities: null, text: "Der Gewinn der Firma wurde halbiert und bleibt der belegte Stand. Diese Lage ordnet die Aktie ein und bleibt an die Quelle gebunden." },
  { id: "N03", chapterId: "umsatz", language: "de", entities: null, text: "Das Wachstum ist dreifach so hoch und bleibt der Jahreswert der Firma. Diese Lage ordnet die Aktie ein und bleibt belegt." },
  { id: "N04", chapterId: "umsatz", language: "de", entities: null, text: "Das Wachstum beträgt fünfzig Prozent und bleibt der Jahreswert der Firma. Diese Lage ordnet die Aktie ein und bleibt belegt." },
  { id: "N05", chapterId: "einstieg", language: "de", entities: null, text: "Der Kurs steht bei [[price]] und bleibt der höchste Stand seit dem letzten Lauf. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden." },
  { id: "N06", chapterId: "einstieg", language: "de", entities: null, text: "Der Kurs steht bei [[price]] und bleibt ein Rekord für die Firma. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden." },
  { id: "N07", chapterId: "umsatz", language: "de", entities: null, text: "Das Umsatzwachstum im Geschäftsjahr [[gj_year]] beträgt [[fy_yoy]] Prozent und ist der belegte Jahreswert. Das Segment bleibt die belegte Aufteilung der Firma." },
  { id: "N08", chapterId: "umsatz", language: "de", entities: null, text: "Das Wachstum ist ein [[fy_yoy]] und bleibt der belegte Jahreswert der Firma. Diese Lage ordnet die Aktie ein und bleibt an die Quelle gebunden." },
  { id: "N09", chapterId: "einstieg", language: "de", entities: null, text: "Der [[as_of]] ist der belegte Stand und bleibt an die Quelle gebunden. Der Kurs steht bei [[price]] und bleibt der Marktwert der Aktie." },
  { id: "N10", chapterId: "einstieg", language: "de", entities: null, text: "Der Kurs steht bei n/a und bleibt der Marktwert der Aktie. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden." },
  { id: "N11", chapterId: "einstieg", language: "de", entities: ["Apple"], text: "Wir sprechen heute über Apple, und der Kurs steht bei [[price]]. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden." },
  { id: "N12", chapterId: "s17", language: "de", entities: ["blackwell"], text: "An der Spitze steht [[pair_a]] und blackwell bleibt der zweite Treiber. Diese Liste bleibt der belegte Stand der Firma." },
  { id: "N13", chapterId: "dcf", language: "de", entities: null, text: "Der faire Wert liegt bei [[dcf_fair]] und stammt aus der belegten Bewertung. Das Chance-Risiko-Verhältnis liegt bei minus eins Komma zwei und bleibt der belegte Satz." },
  { id: "N14", chapterId: "umsatz", language: "en", entities: null, text: "Revenue doubled in fiscal year [[gj_year]] and remains the verified annual figure. The segment stays the verified split of the company." },
  { id: "N15", chapterId: "umsatz", language: "en", entities: null, text: "Revenue is twice the prior year and remains the verified annual figure. The segment stays the verified split of the company." },
  { id: "N16", chapterId: "umsatz", language: "en", entities: null, text: "The margin is half the prior year and remains the verified figure. The segment stays the verified split of the company." },
  { id: "N17", chapterId: "umsatz", language: "en", entities: null, text: "Growth is twofold and remains the verified annual figure for the company. The segment stays the verified split of the company." },
  { id: "N18", chapterId: "einstieg", language: "en", entities: null, text: "The price stands at [[price]] and remains the highest since the prior year. The figures are dated [[as_of]] and stay tied to that date." },
  { id: "N19", chapterId: "einstieg", language: "en", entities: null, text: "The price stands at [[price]] and remains a record for the company. The figures are dated [[as_of]] and stay tied to that date." },
  { id: "N20", chapterId: "einstieg", language: "en", entities: null, text: "The price stands at [[price]] dollars and stays the verified market value. The figures are dated [[as_of]] and stay tied to that date." },
  { id: "N21", chapterId: "einstieg", language: "en", entities: ["Apple"], text: "We look at Apple today and the price stands at [[price]]. The figures are dated [[as_of]] and stay tied to that date." },
  { id: "N22", chapterId: "s17", language: "en", entities: ["blackwell"], text: "At the top stands [[pair_a]] and blackwell remains the next driver. This list stays the verified set for the company." },
  { id: "N23", chapterId: "einstieg", language: "de", entities: ["Pfizer"], text: "Wir sprechen heute über Pfizer, und der Kurs steht bei [[price]]. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden." },
  { id: "N24", chapterId: "news", language: "en", entities: null, text: "The latest report is 4 days old and stays inside the window we considered. The figures stay tied to that close." },
  { id: "N25", chapterId: "umsatz", language: "en", entities: null, text: "Revenue grew by 12 percent in fiscal year [[gj_year]] and remains the verified annual figure. The segment stays the verified split of the company." },
];
