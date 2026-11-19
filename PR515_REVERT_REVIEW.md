# PR 515 — Read-only Review des Reverts von #316

## Kopf

| Feld | Wert |
| --- | --- |
| PR | https://github.com/1719842374/Aktienanalyst/pull/515 (Draft, offen, nicht gemergt) |
| Head-SHA | `177c8ac50a7abf05044b33fd6f194822abff07f7` |
| Head-Parent | `7aaa13ce4ceac60e9b54be3f8edf6f4320d70629` |
| main-SHA (origin/main nach `git fetch origin main`, 19.11.2026) | `7aaa13ce4ceac60e9b54be3f8edf6f4320d70629` |
| Revertierter Commit | `2911cfcf8c0775f0454dfcc308583cecbc1203e4` (#316, gemergt 2026-11-18 18:38 UTC) |
| Parent von #316 / Referenz-Blob | `6d9f08f3fbcd9ff51f7113db8bc2c155062484a5` (`2911cfcf^` ist dieser SHA) |
| Tree von Head | `596066d18263939d4b511e5c3dd1d21319bd0baf` |
| Branch des Reverts | `revert/316-section9-tam` |
| Geprüft am | 19.11.2026, detached Checkout exakt auf dem Head |
| Offener Nachbar | https://github.com/1719842374/Aktienanalyst/pull/514, Head `1d31c75353d941a084545075ea154d278f4f697a` |

## Verdikt

**Befunde (P2, P2, P3).** Die Revert-Mechanik ist ein echter `git revert` von `2911cfcf` auf dem aktuellen main. Die drei Laufzeit-/Testdateien sind blobgleich mit `6d9f08f3`. Sektion 9 zeigt auf diesem Head wieder `tamCAGR ?? 5`, und der leere Sektor ohne Umsatz fällt wieder auf Global Market mit CAGR 5. Das n/a aus #271/#292 für fehlenden Unternehmensumsatz bleibt. Score, Rating, Entry, Fazit-Modul und Peer-Set lesen `tamCAGR` nicht.

Kein Merge-GO in diesem Review: der zurückgeholte 5-%-Wert ist ein ungekkennzeichneter Katalog-Platzhalter (P2), und #514 kollidiert textuell und in der Fallback-Reihenfolge (P2). Cache-Einträge der letzten Tage bleiben gültig; das Label „Global Market“ erscheint für seit #316 gespeicherte leere Profile erst nach Neuberechnung (P3).

Kein Fix in diesem Review. Kein Push nach main, kein Merge, keine Score-Änderung.

## Befunde

### P2 — `?? 5` und „Global Market“ 5 % werden als Branchenwert angezeigt

Beleg, Head `177c8ac5`:

- `client/src/components/sections/Section7.tsx:41` setzt `sectorGrowth = data.tamAnalysis?.tamCAGR ?? 5`.
- Dieselbe Datei `:303` formatiert die Sektor-Zelle der Zeile „Revenue Growth“ immer als Zahl. `:328` übergibt `sectorGrowth` an `BarRow` mit Label „Branche“.
- `BarRow` (`Section7.tsx:903-912`) schreibt bei einer Zahl `+5.0%`. Ein Hinweis, dass 5 der Ersatz für `null` ist, fehlt. `null` wäre dort `n/a`.
- `server/sector-data.ts:526` setzt im sonst-Zweig `tamLabel = 'Global Market'`, `tamCAGR = 5`, `tamSource = 'IMF / World Bank GDP Growth Estimate'`. Das ist eine Konstante im Code, kein gelesener IMF- oder World-Bank-Wert.
- Der No-Revenue-Return `:671-682` behält dieses `tamCAGR` und dieses Label und setzt nur die Unternehmensfelder auf `null`.
- Die Kachel „Branchen-CAGR“ (`Section7.tsx:358-360`) zeigt dann `5%` mit der Unterzeile „p.a. (5Y Prognose)“, sobald das Payload-Feld die Zahl 5 ist. Quelle darunter: der IMF-String (`:634-636`).

Zwei verschiedene Pfade:

1. Payload `tamCAGR == null` (Qualitätstor „Segment-TAM unzuverlässig“, `server/sector-data.ts:631-636`, Commit `d277527e`, 2026-08-30). Die Zeile und der Balken zeigen `+5.0%`. Die Kachel bleibt `n/a`, weil `:359` `null` ausdrücklich prüft. Der 5-%-Wert existiert nur in der Komponente.
2. Sektor und Branche leer und kein Umsatz. Der Server schreibt 5 und „Global Market“ ins Payload. Zeile, Balken und Kachel zeigen 5 %. Unternehmensseite bleibt `n/a`.

Lokal, ohne FMP: `generateTAMAnalysis("", "", "", 0, 0)` liefert `tamCAGR: 5`, `tamLabel: "Global Market"`, `quality: "weak"`, `companyDataMissing: "no-revenue"`, `companyGrowth: null`. `script/test-tam-analysis-server.ts` meldet dasselbe: `'(leer)' rev=0 … tamCAGR 5`. Ein unbekannter, nicht leerer Sektor (`"Unknown Sector"`) fällt ebenfalls in den sonst-Zweig und liefert 5; #316 hatte diesen Pfad nicht angefasst, weil der frühe Return nur bei leerem Sektor und leerer Branche griff.

Vorschlag für Engineering (nicht umgesetzt): den Platzhalter in Zeile und Kachel als Schätzung kennzeichnen oder die Zeile bei `tamCAGR == null` bei `n/a` lassen und Global Market nur dort zeigen, wo eine benannte Quelle wirklich gelesen wurde. Philip hat die Wiederherstellung des alten Stands angeordnet; der Befund ändert diese Anordnung nicht.

### P2 — Kollision mit offenem PR #514

Head #514: `1d31c75353d941a084545075ea154d278f4f697a`, Parent ebenfalls `7aaa13ce`, Draft. Titel: Peer-Median statt n/a, wenn `tamCAGR` fehlt.

`git merge-tree --write-tree 177c8ac5 1d31c753` endet mit Konflikten (Exit ungleich 0):

- `client/src/components/sections/Section7.tsx` (content)
- `script/test-section7-sector-bar.ts` (modify/delete: #515 löscht die Datei, #514 ändert sie)

`git merge-file` der drei Stände von `Section7.tsx` (Basis `7aaa13ce`, unsere Seite `177c8ac5`, deren Seite `1d31c753`) endet mit Exit 3. Konfliktanker liegen an drei Stellen: die Zuweisung von `sectorGrowth` (`?? 5` gegen Peer-Median), die Sektor-Zelle der Growth-Zeile, die beiden `BarRow`s unter „Revenue Growth vs. Branche“.

Logische Reihenfolge, auch nach einem von Hand gelösten Konflikt:

- #515 zeigt bei `tamCAGR == null` immer 5 (`Section7.tsx:41`), bevor ein Peer-Median geprüft werden kann.
- #514 (`shared/peer-revenue-median.ts` auf `1d31c753`, Funktion `medianPeerRevenueYoY`) springt nur ein, wenn `tamCAGR == null`, und beschriftet das Ergebnis mit `Median Peer-Umsatzwachstum YoY · FMP`.
- Zusätzlich schreibt #515 für den leeren Sektor die Zahl 5 ins Payload (`sector-data.ts:526`). Danach ist `tamCAGR` nicht mehr `null`. Der Peer-Median von #514 liefe für SAP.DE/VOW3.DE auch dann nicht, wenn die UI von #514 gewinnt.
- Für Titel mit `tamCAGR == null` aus dem Qualitätstor (viele Mehrsegment-Titel) verdeckt `?? 5` genau den Fall, den #514 füllen will.

n-Regel, gemessen an #514, nicht an #515. #515 berechnet keinen Peer-Median und ändert das Peer-Set nicht.

| Regel | Ist auf `1d31c753` |
| --- | --- |
| n ≥ 5: Median | `medianPeerRevenueYoY` bildet den Median ab n = 1 und beschriftet jeden Treffer mit „Median“. Keine Schwelle 5. |
| n = 3–4: Spanne, nicht nur ein Punkt | Der Test `script/test-s9-peer-revenue-median.ts:102` erwartet für NVO n = 3 das Label „Median“ und einen Punkt `+8.0%`. Keine Spanne. |
| n ≤ 2: nicht „Median“ nennen | Dieselbe Testdatei `:72` und `:84` erwartet n = 2 mit dem Median-Label (MSFT `+10.7%`, n = 2). |
| Ticker selbst nicht im Peer-Set | `medianPeerRevenueYoY` überspringt den Subject-Ticker. Das bestehende Set kommt aus `candidateSymbols` (`server/peer-adaptive.ts:96-106`), das den Subject bereits verwirft. #515 fasst diese Datei nicht an. `applyPeerOverrides` (`server/peer-cache-key.ts:43-51`) verhindert nur das Hinzufügen des eigenen Tickers, es filtert ihn nicht aus einer schon gefüllten Auto-Liste. |
| Gleiches Peer-Set wie die Multiples | #514 liest `peerComparison.peers`, dieselbe Liste wie `PeerComparison` (`client/src/components/sections/PeerComparison.tsx:76`). Das Feld `revenueGrowthMedian` wird in `analyze-route.ts` nach `buildScoringForAnalysis` angehängt. #515 hat dort keinen Diff. |

Vorschlag: #515 und #514 nicht unabhängig mergen. Zuerst festlegen, welche Fallback-Reihenfolge gilt: vorhandener `tamCAGR`, dann Peer-Median mit der n-Regel, dann gekennzeichnete Schätzung oder `n/a`. Ein stilles `?? 5` und ein Peer-Median schließen sich für `null` aus.

### P3 — Cache der letzten drei Tage bleibt gültig, das Label hinkt hinterher

- `shared/schema.ts`: `git diff 177c8ac5 origin/main -- shared/schema.ts` ist leer. `TAMAnalysis.tamCAGR` bleibt `number | null` (`shared/schema.ts:63`). Zwischen `6d9f08f3` und Head enthält der Schema-Diff keine Zeile `tamCAGR` und keinen Hunk an `TAMAnalysis`.
- `server/disk-cache.ts:10-14`: TTL 7 Tage, `CACHE_SCHEMA_VERSION = "2026-08-29-v2"`. Weder #316 noch der Revert noch die 11 Commits `2911cfcf..main` ändern diese Datei. Alte Einträge werden nicht verworfen.
- Ein Eintrag, der nach dem Merge von #316 (18.11.2026 18:38 UTC) für ein leeres Profil geschrieben wurde, trägt `tamCAGR: null` und das n/a-Label. Nach dem UI-Revert zeigt die Growth-Zeile sofort `+5.0%` über `?? 5`. Die Kachel (`Section7.tsx:359`) und `tamLabel` bleiben `n/a`, bis die Analyse neu gerechnet wird. Die Konstante „Global Market“ steht nur im neu erzeugten Payload.
- Einträge von vor #316 mit bereits gesetztem `tamCAGR: 5` sehen in der Zeile vorher und nachher gleich aus.
- Neue Felder seit `2911cfcf` sitzen schon auf main und damit auf dem Parent des Reverts: `RevenueSegment.reportedCurrency`, `fxFrom`, `fxRate`, `fxNaReason` (`7c2ea1ea`, #505). Optional, additiv. Der Revert nimmt sie nicht weg. Kein Bruch für Cache-JSON ohne diese Schlüssel.

Vorschlag: kein Schema-Bump nur für diesen Revert. Wer das Label „Global Market“ für seit #316 gecachte leere Profile sehen will, braucht eine Neuberechnung dieser Schlüssel. Die Zeile `+5.0%` erscheint auch aus dem alten `null`.

## Prüfpunkt 1 — Echte Wiederherstellung, kein Ersatzcode

Head `177c8ac5` hat genau einen Parent, `7aaa13ce` (aktuelles main). Betreff und Body sind die Standardformel `Revert "…" / This reverts commit 2911cfcf…`. Signiert, ein Tree. `2911cfcf` ist weiterhin Vorfahr von `origin/main` (kein Historien-Rewrite, kein Force-Push dieses Commits).

`git merge-tree --write-tree origin/main 177c8ac5` liefert Tree `596066d18263939d4b511e5c3dd1d21319bd0baf`, Exit 0, kein `CONFLICT`. Das ist derselbe Tree wie `git rev-parse 177c8ac5^{tree}`.

Gegenprobe in einem temporären Worktree auf `7aaa13ce`: `git show 2911cfcf | git apply --reverse --index` und `git write-tree` ergeben denselben Tree `596066d1`. `git diff 177c8ac5` danach ist leer. Der Patch ist der Inverse von #316, kein handgeschriebener Ersatz.

Diff `177c8ac5` gegen main: 6 Dateien, +9/−431. Dieselben sechs Pfade wie `2911cfcf^..2911cfcf`, in der Gegenrichtung. `git diff 6d9f08f3 177c8ac5` über diese sechs Pfade ist leer. `git log 2911cfcf..origin/main` über diese Pfade ist leer (0 Commits). Auf main liegen nach #316 elf Commits; keiner davon berührt die sechs Dateien.

Blob-Hashes (`git rev-parse <sha>:<pfad>`):

| Pfad | Blob `177c8ac5` | Blob `6d9f08f3` (= `2911cfcf^`) | Blob main `7aaa13ce` (für diese Pfade gleich `2911cfcf`) |
| --- | --- | --- | --- |
| `client/src/components/sections/Section7.tsx` | `1475280595e9af357fbec509441411065860f406` | gleich | `850e4f222134c4359b3dc8ee826ac962542fa670` |
| `server/sector-data.ts` | `a7c57cd8a389d854f9f220785f2314dbb5cdeaf5` | gleich | `d6b9d5dcb132804d456e7cbf0f3e6db9849b7150` |
| `script/test-tam-analysis-server.ts` | `4d3ab39e304422e58c3607c57dbe5bc52d5a86e7` | gleich | `f8c043020249c4044f41d18c8493ab35df0e4230` |
| `script/fixtures/analyze-tam-no-sector-2026-10-25.json` | fehlt | fehlt | `1374adae09cf0c9b46986a06ffa652d8855c7986` |
| `script/test-section7-sector-bar.ts` | fehlt | fehlt | `c99b4b4a60e03ab7adefe24d7638d1c818a23a77` |
| `script/test-tam-no-sector.ts` | fehlt | fehlt | `47b13a3419072a0d97c34926844949a79965a29c` |

Sektion 9 ist diese Datei. `client/src/pages/Dashboard.tsx:84` labelt Abschnitt 9 „Rel. Bewertung“, `:705` rendert `<Section7>`. Es gibt keine umbenannte Sektion-9-Komponente.

## Prüfpunkt 2 — Ursache der n/a-Anzeige

`tamCAGR` wurde von #316 nicht aus dem Schema gelöscht und nicht von einem späteren Commit überschrieben.

Datenkette auf `177c8ac5` (dieselben Aufrufe stehen auf main, der Revert ändert sie nicht):

1. UI: `Dashboard.tsx:218` `apiRequest("POST", "/api/analyze", …)` über `client/src/lib/queryClient.ts:51`.
2. Route: `server/routes.ts:128` `registerAnalyzeRoute`.
3. Handler: `server/analyze-route.ts:1299` `generateTAMAnalysis(effectiveSector, industry, description, revenue, revenueGrowth, revenueSegments)`.
4. Antwort: `analyze-route.ts:2060` Feld `tamAnalysis`.
5. Schema: `shared/schema.ts:60-85`, Feld `tamCAGR: number | null` (`:63`).
6. Anzeige: `Section7.tsx:41` und `:359`.

`git diff 2911cfcf origin/main -- server/analyze-route.ts` enthält keine geänderte Zeile `tamCAGR`, `generateTAMAnalysis` oder `tamAnalysis`. Die Null kommt nicht aus einem späteren Handler.

Wer die sichtbare n/a-Zeile erzeugt hat:

| Commit | Wirkung |
| --- | --- |
| `70513d23` (2026-04-06) | führt `tamCAGR ?? 5` in Section 7 ein |
| `d277527e` (2026-08-30, A1-Qualitätstor) | setzt bei `quality === 'unreliable'` `tamCAGR: null` (`sector-data.ts:631-636`). Das ist der häufige Null-Fall bei Mehrsegment-Titeln. Bestand vor #316 und nach dem Revert. |
| `60b4bcf3` (#271) und `17128032` (#292) | Unternehmensseite und TAM-Größe ohne Umsatz auf `n/a` / `null`. Branchen-CAGR blieb eine Zahl. |
| `2911cfcf` (#316) | einziger Commit, der die Growth-Zeile von `?? 5` auf `n/a` stellt (`git log -S 'tamCAGR ?? 5'` und `-S 'kein Sektor/keine TAM-Quelle'` nennen nur `2911cfcf` und den Revert `177c8ac5`). Zusätzlich früher Return in `generateTAMAnalysis`: leerer Sektor und leere Branche und kein Umsatz → `tamCAGR: null` statt Global Market 5. |

Damit ist #316 der Verursacher der n/a-Zeile für jeden `null`, auch wenn der Server einen Sektor kennt. Der frühe Return erklärt nur SAP.DE/VOW3.DE-artige Profile (leer, ohne Umsatz). Er erklärt nicht die n/a-Zeile bei Titeln, deren `tamCAGR` schon das Qualitätstor auf `null` gesetzt hat. Deren Ursache in der Anzeige ist derselbe UI-Hunk in #316. Die Ursache im Datenfeld ist `d277527e`, und die ist kein Versehen von #316.

Score-Leser: `dcfGrowthCapFromTam` (`server/sector-data.ts:448-456`, Aufruf `analyze-route.ts:1712-1716`) liefert bei `quality !== 'ok'` oder `tamCAGR == null` `useSegmentCagr: false`. `dcfGrowthRate` (`analyze-route.ts:1717`) hängt nur an `revenueGrowth`. Der Kommentar `:1710-1711` sagt, dass das Cap den Zahlenwert nicht ändert. Leerer Sektor bleibt `quality: 'weak'`, mit `tamCAGR` 5 und mit `tamCAGR` null. `shared/bias-fixes.ts` enthält kein `tamCAGR`. `shared/fazit-signal.ts` gibt es nicht; `client/src/lib/fazit-signal.ts` und `shared/fazit-entry.ts` enthalten kein `tamCAGR`. `server/scoring-integration.ts` ebenfalls nicht. `shared/chat-context.ts` übergibt `tamAnalysis` nicht.

## Prüfpunkt 3 — Was gegenüber main wegfällt, und was bleibt

Der Revert entfernt ausschließlich den Stand von #316. Sichtbar weg:

- Growth-Zeile und Balken „Branche“ zeigen bei fehlendem `tamCAGR` nicht mehr `n/a` und nicht mehr den Satz „kein Sektor/keine TAM-Quelle“.
- Leerer Sektor ohne Umsatz liefert nicht mehr `tamCAGR: null` und nicht mehr das Label `n/a – Sektor/Branche unbekannt`. Stattdessen Global Market / 5 / IMF-String.
- Drei von #316 angelegte Dateien sind weg: `script/test-section7-sector-bar.ts`, `script/test-tam-no-sector.ts`, `script/fixtures/analyze-tam-no-sector-2026-10-25.json`. Kein Laufzeitpfad importiert sie. `package.json` und die Workflows verweisen nicht darauf.

Die elf Commits auf main nach #316 bleiben im Tree, weil ihre Dateien außerhalb der sechs Pfade liegen:

| SHA | PR | Betreff |
| --- | --- | --- |
| `852cb493` | #503 | Briefing-Modal Country-Macro-Pulse |
| `1c4c2e7c` | #504 | Doku Briefing-Ampel |
| `806772f2` | #468 | Rezession, Differenzen als Prozentpunkte |
| `257d5dd6` | #508 | Doku Ampel #468 |
| `9110156c` | #509 | Doku Ampel #468 Prod-Smoke |
| `7c2ea1ea` | #505 | FX: Abschlüsse, Segmente, Jahresreihe in USD |
| `5216d347` | #510 | Doku .DE/Yahoo-Zeilen |
| `c441f5c7` | #506 | TA-Cross nach Hysterese |
| `cd26c249` | #507 | KI-YoY für kuratierte Segmente |
| `c4975703` | #511 | Earnings Yield Nicht-USD |
| `7aaa13ce` | #513 | Doku Ampel und Briefing |

#271-n/a für fehlenden Unternehmensumsatz, belegt auf `177c8ac5`:

- `Section7.tsx:45-48`: `companyNa` ist wahr bei Yahoo-only, bei `companyDataMissing === 'no-revenue'` oder bei `companyGrowth == null`.
- `:300` Aktienzelle der Growth-Zeile: `n/a`, wenn `companyNa`.
- `:305-306` Prämie dann `—`.
- `:327` Ticker-Balken `value={companyNa ? null : companyGrowth}` → `BarRow` zeigt `n/a`.
- `:354`, `:365`, `:376-377` TAM, Unternehmens-Wachstum, Marktanteil: `n/a`.
- `:589-590` „Wachstum Unternehmen vs. Branche: n/a (kein Umsatz)“ bzw. „Yahoo-Daten“.
- Server `sector-data.ts:476-480` und `:671-682`: ohne Umsatz `companyGrowth`, `companyRevenue`, `marketShare`, `outperforming` und `tamTotal` null, `companyDataMissing: 'no-revenue'`. Der Testlauf bestätigt für den leeren Sektor `t: null, g: null` bei `tamCAGR 5` und Section-7-Checks „TAM n/a“, „Unternehmens-Wachstum n/a“, „Wachstum vs. Branche: n/a (kein Umsatz)“, kein `$5,000B`.

Der Platzhalter-Befund steht oben (P2). `?? 5` und Global Market 5 % sind Katalogwerte ohne Kennzeichnung.

## Prüfpunkt 4 — #514

Siehe Befund P2. Zusätzlich: `git diff --name-only 7aaa13ce 177c8ac5` enthält keine Peer-Datei. Das Peer-Set der Multiples (`server/peer-adaptive.ts:102` verwirft den Subject) ist auf Head und auf main dasselbe Blob, weil der Revert es nicht anfasst.

Überlappende Dateien der beiden Heads: nur `Section7.tsx` und `script/test-section7-sector-bar.ts`. #514 ändert außerdem `server/analyze-route.ts`, `shared/schema.ts`, `shared/peer-revenue-median.ts` (neu), `script/test-s9-peer-revenue-median.ts` (neu). Diese vier berührt #515 nicht; sie mergen sich textuell, sobald der Section7-Konflikt gelöst ist. Fachlich bleiben sie tot, solange `?? 5` oder ein serverseitiges `tamCAGR: 5` den Null-Fall schließen.

## Prüfpunkt 5 — Score, Schema, Cache, DB, Env

Leser von `tamCAGR` auf diesem Head (grep über `*.ts`/`*.tsx`, Katalogkonstanten in `sector-data.ts` ausgenommen):

| Ort | Rolle |
| --- | --- |
| `Section7.tsx:41,189,359,508,543-623,822-868` | Anzeige und KI-Fill der Segmentzellen |
| `server/analyze-route.ts:1714` | Argument an `dcfGrowthCapFromTam`, ohne Wirkung auf `dcfGrowthRate` |
| `server/sector-data.ts:448-456,631-673` | Erzeugung und DCF-Gate |
| `shared/schema.ts:51,63` | Typ `number \| null` |
| `shared/tam-na-fill.ts` | Segment-KI, nicht der Konzern-Fallback `?? 5` |
| `script/test-tam-analysis-server.ts` | Test |

`shared/bias-fixes.ts`: kein Treffer. Fazit-Signal: kein Treffer. Scoring-Integration: kein Treffer. Peer-Set-Dateien: kein Treffer.

Schema vor/nach Revert: identisch zu main `7aaa13ce` (leerer Diff). Kompatibel mit Cache-JSON der letzten drei Tage, siehe P3. Neue DB-Tabellen oder -Spalten seit `2911cfcf`: keine. Der Diff `2911cfcf..main` enthält kein `CREATE TABLE`, kein `pgTable`, kein `sqliteTable`. Die SQLite-Tabellen `analysis_cache` und `researcher_cache` stehen unverändert in `server/disk-cache.ts`. Neue Env-Variablen: keine. `render.yaml` und `.env.example` liegen nicht im Diff. Die einzigen neuen `process.env`-Zeilen seit #316 stehen in Tests (`script/test-recession-growth-pp-render.ts` hebt `FMP_API_KEY` auf und setzt ihn zurück, `script/test-segment-n38.ts` löscht `OPENROUTER_API_KEY` lokal). Das sind keine neuen Pflichtvariablen.

## Prüfpunkt 6 — Datei für Datei in `2911cfcf`, und ob der volle Revert der richtige Hebel ist

#316 enthält neben dem Anzeige-Eingriff eine gewollte, getestete Funktion: kein stilles „Global Market 5 %“, wenn Sektor und Branche fehlen. Diese Funktion und die n/a-Zeile sind derselbe Patch, nicht ein Fehler plus ein unbeteiligtes Feature in einer anderen Datei. Ein `git checkout 6d9f08f3 -- <datei>` für alle sechs Pfade ist bytegleich zum vollen Revert, weil nach `2911cfcf` niemand diese Pfade angefasst hat. Ein Checkout nur einer der beiden Laufzeitdateien reicht für das formulierte Soll nicht.

`tamCAGR` wurde nicht gelöscht. Der Typ bleibt `number | null`. #316 hat den Wert nur auf einem Pfad auf `null` gesetzt (leerer Sektor, leere Branche, kein Umsatz) und die UI angewiesen, jedes `null` als `n/a` zu zeichnen. Quelle, Cache-Schema und spätere Commits sind nicht die Ursache der n/a-Zeile. Der Revert ist der richtige Hebel, um genau diesen #316-Patch zurückzunehmen. Er stellt keine zuvor gemessene Branchen-CAGR wieder her. Die 5 kommt aus der Konstante und aus `?? 5`.

| Datei in `2911cfcf` | Fehlerursache der n/a-Zeile | Gewollte Funktion aus #316 | Empfehlung |
| --- | --- | --- | --- |
| `client/src/components/sections/Section7.tsx` | Ja. Einziger Hunk: `?? 5` wird zu `sectorKnown` / `n/a`. Trifft jedes `tamCAGR == null`, auch Qualitätstor-Nulls von `d277527e`. | Ja. Ehrliche n/a-Zeile mit Grund statt stillem 5-%-Balken. Kein zweiter, unabhängiger Hunk. | Zurücksetzen auf `6d9f08f3` (`14752805…`), wenn die Zeile wieder `?? 5` zeigen soll. Das ist das Soll dieses Auftrags. |
| `server/sector-data.ts` | Nur für leeren Sektor und leere Branche ohne Umsatz. Der frühe Return (`+25` Zeilen in #316) setzt `tamCAGR: null` und das n/a-Label. Bekannte Sektoren und das Qualitätstor bleiben unberührt. Nicht die Ursache für „alle Aktien“. | Ja. Genau dieser Return ist der #316-Fix gegen den IMF-Default. Der #292-Block `companyDataMissing` liegt darunter und überlebt den Revert (`:671-682`). | Zurücksetzen, wenn das Payload wieder „Global Market“ und 5 tragen soll. Behalten, wenn die Kachel ehrlich `n/a` bleiben soll und nur die UI-Zeile 5 % zeigt. Das Soll dieses Auftrags verlangt Global Market 5 %. Dann diesen Hunk zurücksetzen. Dateigenau möglich: nur die beiden Exporte `TAM_NO_SECTOR_*` und der frühe Return. |
| `script/test-tam-analysis-server.ts` | Nein. Kein Laufzeitpfad. | Ja, als Schloss auf `tamCAGR === null` im Leer-Fall. | Mit zurücksetzen. Sonst erwartet der Test `null` und der Server liefert 5. |
| `script/test-section7-sector-bar.ts` | Nein. | Ja, Schloss auf die n/a-Zeile. | Mit löschen. #514 will dieselbe Datei ändern (modify/delete-Konflikt). |
| `script/test-tam-no-sector.ts` | Nein. | Ja, Schloss auf SAP/VOW3-n/a. | Mit löschen. |
| `script/fixtures/analyze-tam-no-sector-2026-10-25.json` | Nein. | Fixture für den Test, aufgezeichnet am 25.10.2026 mit damals noch `tamCAGR: 5`. | Mit löschen. Kein Produktverhalten. |

Ein Checkout nur von `Section7.tsx` stellt die Zeile auf `+5.0%`, auch wenn der Server `null` schickt. Die Kachel bleibt für leere Profile `n/a`, das Label bleibt der #316-Text, „Global Market“ kommt nicht zurück. Ein Checkout nur von `sector-data.ts` stellt Global Market 5 für den leeren Pfad her; die UI auf main zeigt diese 5, weil `tamCAGR` dann eine Zahl ist. Titel mit Qualitätstor-`null` bleiben in der Zeile `n/a`. Beide Dateien gehören zum Soll „`?? 5` und Global Market 5 %“. Die drei Testdateien müssen mit, sonst widersprechen sie dem Code. Der volle PR-Revert ist dafür der kürzeste git-treue Weg und inhaltlich dasselbe wie die sechs dateigenauen Checkouts.

## Soll-Ist

Soll ist die Anweisung, den Stand vor #316 über die Git-Historie zurückzuholen: Sektion 9 zeigt wieder `tamCAGR ?? 5` und, ohne Sektor, Global Market 5 %. Unternehmens-n/a aus #271 bleibt. Score, Rating, Entry, Fazit, Peer-Set bleiben. Kein neuer Ersatzcode.

| Soll | Ist auf `177c8ac5` | Status |
| --- | --- | --- |
| Echter `git revert` von `2911cfcf`, Parent = aktuelles main, kein Force-Push | Ein Parent `7aaa13ce`. Reverse-Apply erzeugt Tree `596066d1`. `2911cfcf` bleibt Vorfahr von main. | erfüllt |
| Drei Dateien blobgleich mit `6d9f08f3` | Section7 `14752805…`, sector-data `a7c57cd8…`, test-tam `4d3ab39e…` | erfüllt |
| Growth-Zeile `tamCAGR ?? 5` | `Section7.tsx:41`, Ausgabe `:303` und `:328` | erfüllt, Befund P2 (ohne Kennzeichnung) |
| Global Market 5 % statt n/a bei leerem Sektor ohne Umsatz | `sector-data.ts:526`, behalten in `:673`. Test: `tamCAGR 5`, quality weak. | erfüllt für neu gerechnete Payloads. Gecachte #316-Payloads: P3. |
| #271-n/a bei fehlendem Umsatz | `Section7.tsx:47-48,300,327,354,365,376,590` und `sector-data.ts:671-682`. Test 17/17, Unternehmensseite n/a, kein `$5,000B`. | erfüllt |
| Keine spätere main-Funktion weg | Diff nur die sechs #316-Pfade. Elf spätere Commits unberührt. | erfüllt |
| Score / Rating / Entry / Fazit / Peer-Set unverändert | Keine Leser in bias-fixes, fazit-signal, scoring. `dcfGrowthRate` unabhängig. Peer-Dateien nicht im Diff. | erfüllt |
| Platzhalter nicht als echter Wert | `?? 5` und IMF-String ohne Hinweis. | Abweichung, P2, kein Fix |
| Verträglich mit #514 | Drei Konflikte in `Section7.tsx`, modify/delete am Sektor-Balken-Test. Fallback `?? 5` verdrängt den Peer-Median. n-Regel in #514 nicht erfüllt. | Abweichung, P2 |
| Cache letzte 3 Tage lesbar, keine neue DB-Spalte, keine neue Env | Schema-Diff leer, Cache-Version unverändert, keine DDL, keine neue Env. | erfüllt, mit P3 zum Label |
| `tamCAGR` nur revertieren, wenn #316 es gelöscht oder falsch überschrieben hat | Nicht gelöscht. Ein Pfad bewusst auf `null` gesetzt, UI zeigt jedes `null` als n/a. Spätere Commits, Schema und Cache sind nicht die Ursache. | Hebel passt für den #316-Patch. Er holt eine Konstante zurück, keine Messung. |

## Spec-Status

Keine `fertig_`-, `Fertig_`- oder `Offen_`-Datei liegt im Diff. `fertig_WORK_TAM_SEGMENT_MAPPING.md` hat auf main und auf `177c8ac5` denselben Blob `b0ce509481aef15c4695da4b782811370a6de415` und bleibt `fertig_`.

Die Wiederherstellungsanweisung vom 19.11.2026 hat keine eigene Spec-Datei. Sie ist auf dem geprüften Head mechanisch umgesetzt und als Draft-PR offen, nicht gemergt. Der Platzhalter-Befund und die #514-Kollision sind offen; dieser Review ändert keinen Code und setzt keine Spec auf `fertig_`.

## Tests

Ausgeführt auf `177c8ac5` mit `env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY` und lokalem `node_modules` (`npm install --ignore-scripts`, keine Keys geloggt):

`./node_modules/.bin/tsx --tsconfig script/tsconfig.jsx.json script/test-tam-analysis-server.ts`

Ergebnis: 17/17 grün, Exit 0. Darunter 288 Umsatz-Fälle bytegleich zu `LEGACY_REF` `995036fa`, DCF-Gate 32/32, Section-7-SSR: TAM und Unternehmens-Wachstum `n/a`, Wachstum vs. Branche `n/a (kein Umsatz)`, kein `$5,000B`. Leerer Sektor: `tamCAGR 5`. Technology ohne Umsatz und mit „cloud“ in der Beschreibung: `tamCAGR 16` (Katalog, nicht der 5er-Fallback).

`./node_modules/.bin/tsc --pretty false --incremental false --noEmit` (das ist `npm run check`): Exit 2, 76 `error TS`. Keine Meldung in `Section7.tsx`, `server/sector-data.ts` oder `script/test-tam-analysis-server.ts`. Der PR-Text nennt dieselbe Zahl 76 auf main; dieser Lauf hat main nicht ein zweites Mal typegecheckt.

Kein POST `/api/analyze` gegen Produktion, kein Produktions-Ticker, kein FMP-Call.

## Datenfluss, kurz

`Dashboard.tsx` Abschnitt 9 → `POST /api/analyze` (`queryClient.ts`) → `routes.ts` → `analyze-route.ts:1299` `generateTAMAnalysis` → `tamAnalysis` im JSON (`:2060`) → `shared/schema.ts` `TAMAnalysis.tamCAGR` → `Section7.tsx:41` (`?? 5`) und `:359` (Rohwert oder `n/a`). Der Revert ändert nur das letzte Glied und den Leer-Pfad in `generateTAMAnalysis`. Die Übergabe dazwischen bleibt.
