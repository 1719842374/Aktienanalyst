# PR 492 — Read-only Review Segment-Lücken

Read-only. Kein Merge, kein Push nach `main`, keine Score-, Rating-, Entry- oder Peer-Set-Änderung.

## Kopf

| Feld | Wert |
| --- | --- |
| PR | https://github.com/1719842374/Aktienanalyst/pull/492 (Draft, offen, MERGEABLE) |
| Branch | `cursor/missing-segments-1bac` |
| Geprüfter Head | `a69872b7ecc9a6512a9b9bde2c30cf13eb695ef9` (2026-11-19 10:55:15 +0000, „Fix: Software-Wort zählt nur im Zeilennamen“) |
| main zum Prüfzeitpunkt | `7aaa13ce4ceac60e9b54be3f8edf6f4320d70629` (2026-11-19 10:02:23 +0100, Docs #513) |
| merge-base Head/main | `c4975703ecfb8166edc57c6d54faed2161b2d093` |
| Vorgänger auf main mit `server/llm-openrouter.ts` | `58f6c237198c026197349e76ea8e03308b69008f` (#494), ist Vorfahr der merge-base |
| Blob `server/llm-openrouter.ts` auf main und merge-base | `b64756664d4b0302a0aaf04fdf1c4a85f7ac0319` |
| Blob `server/llm-openrouter.ts` auf Head und in Commit `52e486d6` | `ff390ba1a7b6a2c42350c094a5fe865e818b8037` |
| Merge-Simulation | `git merge-tree --write-tree origin/main HEAD` → Tree `b08dd816aaf5b05d7429e7f16d13f29eb1fee215`, Exit 0, kein Konflikt |

## Verdikt

**GO.**

Keine P1, keine P2. Die Host-Zuordnung liest den Zeilennamen, `bundledWith` und den Host-Namen. `expansion`, `basis` und Hinweistext hängen die Zeile nicht um. Charging und Regulatory Credits bleiben unter dem Service-Eltern, wenn das Modell sie dort ablegt. `SEGMENT_GAP_MAX_CALLS = 4` begrenzt die OpenRouter-HTTP-Versuche. Der Merge auf den aktuellen `main` überschreibt keine seit der merge-base dazugekommene Codeänderung.

Drei Residuen stehen unten. Sie ändern das Verdikt nicht.

## Git-Historie (zuerst)

- `origin/main` ist `7aaa13ce`. Seit der merge-base `c4975703` liegt auf `main` genau ein Commit: `7aaa13ce` Docs (`WORK_IMPLEMENTIERUNG_OFFEN.md`, +19/−1). Keine Laufzeitdatei.
- `git log c4975703..origin/main` über alle elf vom PR berührten Pfade ist leer. Keine dieser Dateien ist auf `main` seit dem Abzweig geändert.
- Der PR-Head trägt 36 Commits über der merge-base, letzter `a69872b7`. Diff gegen `origin/main`: 11 Dateien, +4992/−12. Neu: `server/segment-gap-route.ts`, `shared/segment-gap.ts`, `client/src/components/sections/SegmentGapPanel.tsx`, `script/test-segment-n36.ts`, `script/preview-tsla-segment-gaps.json`. Geändert: `Section2.tsx`, `Dashboard.tsx` (nur `pb-16` → `pb-24`), `server/routes.ts` (Registrierung), `server/llm-openrouter.ts` (Budget), `shared/segment-children.ts` (eine Bedingung), `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` (Fortschritt, Spec bleibt offen).
- `shared/schema.ts` ist nicht im Diff. Score, Rating, Entry und Peer-Set sind nicht im Diff.
- Feature auf `main`: nicht vorhanden. `server/segment-gap-route.ts` entsteht erst in diesem PR.
- Offene PRs daneben (Auszug, nicht dieser Review-Gegenstand): #515, #514, #512, #498, #497, #496, #495, #491, #488, #484 und ältere. Keiner davon ist der Head `a69872b7`.

### Merge-Simulation, Vorher/Nachher

`git merge-tree --write-tree origin/main a69872b7` erzeugt `b08dd816` ohne Konflikt.

| Datei | main / merge-base | nach Merge (= PR-Head, außer Docs) |
| --- | --- | --- |
| `server/llm-openrouter.ts` | `b6475666` | `ff390ba1` (identisch mit Head und mit `52e486d6`) |
| übrige 10 PR-Pfade | Blob = merge-base | Blob = Head |
| `WORK_IMPLEMENTIERUNG_OFFEN.md` | Stand `7aaa13ce` | bleibt der main-Stand; der PR fasst die Datei nicht an |

Vorher/Nachher `server/llm-openrouter.ts` (`git diff c4975703 a69872b7 -- server/llm-openrouter.ts`, +36/−1):

- Neu: `AsyncLocalStorage`, `withOpenRouterHttpBudget`, `openRouterHttpBudgetRemaining`, `takeOpenRouterHttpAttempt`.
- In `callWithFallback` steht der Zähler vor `chat.completions.create`. Bei aktivem Budget ist `maxRetries` 0. `budgetExhausted` wird in `callWithFallback` weitergeworfen.
- Die bestehende Zeile `opts?.online && !model.endsWith(":online")` bleibt. Der PR fügt kein Modell-Suffix hinzu.
- `58f6c237` (#494) ist Vorfahr der merge-base. Dessen Stand ist `b6475666` und bleibt die Basis von `ff390ba1`. Nichts aus #494 wird durch den Branch ersetzt.

## Prüfpunkt 1 — Host-Zuordnung

Pfad, SHA `a69872b7`:

1. `POST /api/segment-gaps` in `server/segment-gap-route.ts:961`.
2. Pro Eltern ein Prompt (`segmentGapPrompt`, `186–245`). `only` ist der Name dieses Elterns (`1112–1122`).
3. `reviewSegmentGaps` (`596–684`) übernimmt `parent` nur über `canonicalParent` / `sameShownParent` (`532–543`, `616–619`): Schlüsselgleichheit oder dieselbe Menge nach `prettifyProductSegmentName`. Ein anderer Elternname wird mit `parent_not_listed` verworfen (`617–619`).
4. `bundleFields` (`337–346`) kopiert `bundledWith`, `kind` und `expansion` auf die Zeile (`662–664`).
5. `reply` ruft danach `placeBundledSoftware` (`1015–1016`, Funktion `450–487`).

Umhängen nur wenn alle Bedingungen gelten (`458–465`):

- `kind === "product"` und `serviceParentName(item.parent)` (`279–281`, Regex `service|abo|subscription|software|support` auf dem aktuellen Elternnamen).
- `bundledKind === "device_software"`.
- `reportedSegment(item.bundledWith, products)` (`323–328`): `bundledWith` muss exakt einem Produkt-Eltern im Schlüssel `segmentGapKey` entsprechen.
- `hardwareHostName(named)` (`435–448`): Kopf-Token des Host-Namens ist ein Geräte-Stamm (`HARDWARE_STEMS`, `406`) oder `pc`/`pcs`. Ein Block-Token im Host-Namen (`441`, `444`) macht den Host ungültig.
- `deviceBoundSoftware(item.name)` (`318–321`) liest nur den Zeilennamen über `positiveSoftware` (`310–316`).
- `nameBlocksBundle(item.name)` (`330–335`) liest nur den Zeilennamen.

`item.expansion` wird gesetzt und nie gelesen. `basis`, `source`, `hint` und die Profilbeschreibung gehen nicht in `placeBundledSoftware`. Die Erklärung kann die Zuordnung auf diesem Head nicht verschieben.

Belege aus `script/test-segment-n36.ts`, Lauf auf diesem Head 147/0:

- `expansion-only-software-word-stays` (`3031–3037`): Name `FSD`, `expansion` `Autonomie-Software`, `kind` `device_software`, `bundledWith` `Automotive Sales` → Eltern bleibt `Services and Other`, Anteil 14.
- `hint-or-basis-does-not-reparent` (`3040–3043`): `basis` „bundled with Automotive Sales“ und Feld `hint` hängen Charging, Regulatory Credits, Supercharging und die übrigen Namen der Liste nicht um.
- `self-driving-name-follows-exact-bundled-with` (`3021–3029`): der Zeilenname `Full Self-Driving` hängt um, weil `positiveSoftware` die Zeichenfolge `self driving` im Namen trifft (`313–314`), nicht weil ein Erklärungstext das tut.
- `device-software-follows-exact-bundled-with` (`3013–3019`): `FSD Software` hängt an `Automotive Sales`, Anteil wird dabei genullt und der Satz nennt die Bündelung (`475–483`).

`positiveSoftware` (`310–316`) ist Namensvokabular, keine Hintertür über `expansion`. Getroffen wird der Zeilenname bei `software|firmware|embedded|betriebssystem|autonomie|autonomy|fahrassistenz|connectivity|freischalt`, bei den Phrasen `operating system`, `driver assistance`, `self driving`, und beim Token `os`.

## Prüfpunkt 2 — Charging und Credits

Sie werden vom Umhänge-Pfad nicht vom Service-Eltern auf ein Hardware-Eltern gesetzt.

- Name `Charging`: `deviceBoundSoftware` ist falsch, weil kein positives Software-Muster im Namen steht. `placeBundledSoftware` bricht bei `458–465` ab. Eltern bleibt.
- Name `Regulatory Credits`: Token `credits` steht in `HARDWARE_BLOCK_TOKENS` (`363–364`). `nameBlocksBundle` (`330–335`) blockt. Eltern bleibt. Dasselbe gilt für `Regulatory Credits Marked` (`3048–3051`).
- `Supercharging` im Fixture bleibt `Services & Other` (`bundled-software-follows-reporting-hardware-parent`, Testzeile `2388–2394`). Die Zeile `Software & Digital Services` mit `kind: device_software` und `bundledWith: Automotive` geht nach `Automotive`. Das ist der Software-Name, nicht Charging.

Laufbeleg:

- `charging-expansion-device-software-stays`: Charging, `expansion` `device software`, `kind` `device_software`, `bundledWith` `Automotive Sales` → `Services and Other`, Anteil 9.
- `charging-and-credits-expansion-device-software-stay`: Charging und Regulatory Credits beide `Services and Other`, Anteil 9.
- `hint-or-basis-does-not-reparent`: Charging und Regulatory Credits `Services and Other`.

Legt das Modell die Zeile im Automotive-Aufruf bereits mit `parent: Automotive` ab, bleibt dieses Eltern. `reviewSegmentGaps` korrigiert den Namen nicht nach Services. Im Fixture `tsla1` (`2059–2068`, `2349–2350`) entsteht `Regulatory Credits` unter `Automotive`; die Kopie aus dem Service-Aufruf mit fremdem Eltern wird als `parent_not_listed` nach `internalReason` gelegt (`2156–2159`), nicht in die sichtbare `reason`. Das ist die vom Modell gesetzte Elternzeile, kein Umhängen über `expansion`. Ein Ticker-Zwang „Credits immer unter Services“ ist nicht im Code. Das entspricht der Vorgabe, nicht pro Firma zu hartcodieren, und dem Zusatz „beziehungsweise das korrekte Host-Segment“.

`absorbGapItem` (`489–505`) behält bei demselben Produktbegriff auf einem Service-Eltern und einem Nicht-Service-Eltern die Nicht-Service-Zeile. Das trifft Charging oder Credits nur, wenn das Modell denselben Namen auch unter dem Hardware-Eltern liefert. Eine nur unter Services gelieferte Zeile bleibt dort.

## Prüfpunkt 3 — Hartcodierung

Keine Ticker-Liste, kein `if (ticker === "TSLA")`, kein festes Paar `FSD → Automotive` im Server. Test `no-ticker-parent-map` (`3264–3267`) prüft `server/segment-gap-route.ts` und `shared/segment-gap.ts` auf `TSLA`, `MSFT`, `NVO`, `SAP.DE`, `S/4HANA`, `SuccessFactors`. Der Lauf ist PASS. `script/preview-tsla-segment-gaps.json` ist eine Fixture und wird von keiner Laufzeitdatei importiert.

| Stelle | SHA-Zeile | Bewertung |
| --- | --- | --- |
| `TICKER_RE` | `server/segment-gap-route.ts:48` | Formatprüfung des Tickers. Keine Firmenliste. Zulässig. |
| `SEGMENT_GAP_PROMPT_VERSION = "n36-gap-p23"` | `:50` | Cache-Stand. Zulässig. |
| `serviceParentName` | `:279–281` | Generische Eltern-Wörter `service`, `abo`, `subscription`, `software`, `support`. Zulässige Taxonomie. |
| `CONCEPT_FILLER` | `:283–286` | Stoppwörter für den Begriffsabgleich. Zulässig. |
| `softwareLabelBlocked` | `:305–308` | `cloud`, `saas`, `platform`/`plattform`, `abo`, `subscription`, `abonnement`. Sperrt Cloud- und Abo-Namen gegen das Umhängen. Zulässig. |
| `positiveSoftware` | `:310–316` | Generisches Software-Vokabular plus Fahrzeug-Phrasen `fahrassistenz`, `autonomie`/`autonomy`, `self driving`, `driver assistance`, Token `os`. Kein Ticker. Bewegt `Full Self-Driving` über den Zeilennamen. Zulässige Taxonomie, domänennah, nicht firmenspezifisch. |
| `HARDWARE_BLOCK_TOKENS` | `:360–390` | Dienst, Finanz, Credit/Credits, Lease, Miete, Plan, Software, Support. Schützt Regulatory Credits über das Token `credits`. Zulässig. |
| `HARDWARE_COMPOUND_ENDINGS` | `:391` | `dienste`, `dienst`, `finanzierung`, `vermietung`, `versicherung`, `wartung`, `miete`. Zulässig. |
| `HARDWARE_STEMS` | `:406` | `device`, `gerat`, `hardware`, `computing`, `automotive`, `vehicle`, `fahrzeug`, `console`, `konsole`, `phone`, `smartphone`, `antrieb`. Kopfwort des Hosts. Zulässig. |
| `REVENUE_HEADS` | `:407` | `sales`, `products`, `revenue`, `revenues`. Zulässig. |
| `pc` / `pcs` | `:402–404`, `:429–433` | `PCS` in Großbuchstaben ist kein Host, `PCs` als Plural schon. Zulässig. |
| `GAP_REASON_CODE` plus `Object.hasOwn` | `:507–517` | Feste n/a-Codes. `toString`, `__proto__`, `constructor` werden nicht als Code gelesen. Tests `prototype-key-*` PASS. Defensive Prüfung, kein Firmenhack. |
| `DIRECT_MEMBERS`, `GEO_ALIAS` | `shared/segment-gap.ts:46–91` | Geografie ohne Firmen- oder Ticker-Mapping (Kommentar `:42–44`). Zulässig. |
| Prompt-Sätze zu Software-, Abo- und Freischalt-Umsatz | `segment-gap-route.ts:207–213`, `:1005` | Generische Anweisung an das Modell. Keine Produktliste, kein Ticker. Zulässig. |
| Dashboard-Ticker `AAPL` … `TSLA` | `client/src/pages/Dashboard.tsx:825` | Nicht in diesem Diff. Der PR ändert dort nur `pb-24`. |

## Prüfpunkt 4 — Regression `llm-openrouter.ts` und die anderen Dateien

Ergebnis: der Branch überschreibt keine main-Änderung seit der merge-base.

- `git log c4975703..origin/main -- server/llm-openrouter.ts` ist leer.
- main-Blob = merge-base-Blob = `b6475666`.
- Head-Blob = Blob von `52e486d68a16f3e0d914014c1a55f1042fabbf68` = `ff390ba1`.
- Nach `merge-tree` ist der Blob im Merge-Tree wieder `ff390ba1`. Der Diff zum main-Blob ist genau der Budget-Zusatz (+36/−1), kein Rückbau von #494.
- Dieselbe Blob-Gleichheit main = merge-base gilt für `Section2.tsx` (`aeb31800`), `Dashboard.tsx` (`a7cd035e`), `server/routes.ts` (`99804be0`), `shared/segment-children.ts` (`65a8ac3c`), `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` (`41c1130b`). Die fünf neuen Dateien existieren auf main nicht.
- Einziger Unterschied zwischen Merge-Tree `b08dd816` und Head `a69872b7`: `WORK_IMPLEMENTIERUNG_OFFEN.md` aus `7aaa13ce`. Der Merge behält den main-Text.

Nebenwirkung, geprüft, kein Rückbau einer Segmentzeile: `shared/segment-children.ts:315`. Vorher wurde jede `source`-Zeichenkette an `basis` gehängt. Jetzt nur, wenn `sourced` (konkrete Quelle) wahr ist. Anteil und Wachstum waren ohne konkrete Quelle schon `null` (`310–313`). Die Untersegment-Zeile bleibt. Ein nicht belegter Quellentext erscheint nicht mehr in `basis`.

## Prüfpunkt 5 — Werte, Kennzeichnung, Limit, Suffix, Cache

### Keine erfundenen Zahlen

`toGapItem` (`796–848`):

- Anteil nur bei konkreter Quelle (`concreteSource` in `shared/segment-children.ts:668–694`: Dokumenttyp, Jahr im Fenster von drei Jahren, Firma oder neutrale URL).
- Fakt: `revenue > 0`, Elternumsatz `> 0`, Währung `USD`, dann `round(revenue / parentUsd * 1000) / 10`, nur wenn das Ergebnis in `(0, 100]` liegt, `shareOrigin` `fact`, Formel in `basis` (`813–819`).
- Schätzung: gemeldeter `shareOfParentPct` in `(0, 100]` plus konkrete Quelle, `shareOrigin` `estimate` (`828–830`).
- Anteil `0` wird verworfen (`621`). `revenue` zählt nur bei `> 0` (`807`). Kein Ersatzwert `1`, `15` oder `0`.
- Ohne Quelle: `shareOfParentPct` null, `shareNote` aus `specificGapNote` (`831–834`). Wachstum ohne Quelle wird in `reviewKiChildren` genullt (`310–313`).

### Kennzeichnung

`SegmentGapPanel.tsx:140–162`:

- Zeile mit Anteil `> 0`: Badge `KI-Schätzung`. Bei `shareOrigin === "estimate"` ist der Anteil violett (`149–154`).
- Zeile ohne belegten Anteil: Badge `KI-Vorschlag`, Text `n/a — ohne Quelle` oder `shareNote`. Test `unsourced-fsd-shows-phrase` verlangt `KI-Vorschlag` und verbietet `KI-Schätzung` sowie `0.0 %`.
- Belegte Schätzung zeigt die Quelle in `basis` (`estimate-share-is-violet`: `8.0 %`, `Tesla Annual Report 2025`, `KI-Schätzung`).
- Fakt zeigt die Formel und ebenfalls `KI-Schätzung` (`fact-share-shows-formula`).

Die Soll-Formulierung „jede KI-Zeile ist KI-Schätzung mit Quelle“ ist für Zeilen mit Zahl umgesetzt. Zeilen ohne Beleg tragen keine Zahl und das Badge `KI-Vorschlag`. Das ist der getestete Stand und verhindert eine Schätz-Marke ohne Quelle.

### `SEGMENT_GAP_MAX_CALLS = 4`

Wirksam, drei Stellen plus der HTTP-Zähler:

- Konstante `server/segment-gap-route.ts:56`.
- `tasks.slice(0, SEGMENT_GAP_MAX_CALLS)` beim Cache-Treffer (`1034–1035`) und beim Live-Lauf (`1081–1082`). Der Rest erhält `n/a — nicht abgefragt (Call-Limit)`.
- `withOpenRouterHttpBudget(SEGMENT_GAP_MAX_CALLS, …)` umschließt den Handler (`968`).
- `takeOpenRouterHttpAttempt` (`75–85`) läuft in `callWithFallback` vor `create` (`99`). Bei `remaining <= 0` wirft sie `openrouter-budget`, bevor ein weiterer HTTP-Call geht. `callWithFallback` wirft `budgetExhausted` weiter (`112`). Bei aktivem Budget ist `maxRetries` 0 (`100–102`), die SDK-Wiederholung zählt nicht extra.
- Vor jedem weiteren Eltern prüft der Handler `openRouterHttpBudgetRemaining() === 0` (`1099–1102`).
- SEC-Extraktion (`fetchSecBusinessSegments` → `callLLMJson` in `server/sec-segments.ts:298`) läuft im selben Budget, ohne `online: true`.
- Test `http-budget-counts-fallback-and-sec`: `openRouterHttp === 4`, `reason` enthält `nicht abgefragt (Call-Limit)`.
- Test `tsla-fits-call-limit`: 3 Produkt-Eltern plus ein Regionen-Aufruf, 4 Calls, kein Limit-Satz.

`callLLMJson` fängt `budgetExhausted` und gibt `null` zurück (`server/llm-openrouter.ts:925–928`). Der laufende Eltern wirkt dann wie „KI nicht erreichbar“. Ein weiterer HTTP-Call entsteht nicht, die folgenden Eltern stoppen bei `remaining === 0`. Der Deckel von 4 HTTP-Versuchen bleibt.

### `:online`

Grep auf dem Head: die Zeichenkette `:online` steht in `server/llm-openrouter.ts:96` und `:114`. Beide Zeilen sind im main-Blob `b6475666` schon vorhanden. Der Segment-Lücken-Aufruf übergibt `online` nicht (`1110–1127`). `sec-segments.ts:298` übergibt `online` nicht. Test `segment-gap-does-not-add-online-call` (`3257–3260`) ist PASS: die Route enthält kein `online: true`.

### Cache

- Schlüssel `parentCacheKey` (`920–922`): `n36-gap-p23|<TICKER>|<Elternlabel>|v:<Server-USD>`. Leer, wenn kein Umsatz > 0.
- TTL 24 h (`GAP_CACHE_MS`, `:43`). Platzhalter ohne Treffer 60 s (`:44`, `:1147`).
- Ablauf: `freshParent` löscht den Eintrag (`925–931`). `pruneGapCache` läuft pro Request (`111–117`, `:998`).
- Invalidierung über den Schlüssel: neue Prompt-Version, anderer Ticker, anderes Elternlabel, anderer Server-USD. Obergrenze 400, ältester Eintrag fliegt (`119–130`).
- Parallel gleiche Eltern teilen sich `gapInflight` (`951–958`).
- Client: `queryKey` `["/api/segment-gaps", ticker, shown]` mit Namen und Umsätzen, `staleTime` 15 min, `enabled` nur bei offenem Schalter (`SegmentGapPanel.tsx:23–32`).
- Speicher ist der Prozess. Ein Neustart leert ihn. Der Dateikopf `:6–7` sagt das.

Der Schlüssel enthält die Geschwisterliste nicht. Ändern sich andere Segmentnamen bei gleichem Elternumsatz, kann die Antwort bis zu 24 h die alte Prompt-Umgebung tragen. Die Prompt-Version im Schlüssel invalidiert Änderungen am Prompt-Text.

## Prüfpunkt 6 — Datenkette und bestehende Anzeige

Kette auf `a69872b7`:

1. UI: `SegmentEstimateBlock` in `client/src/components/sections/Section2.tsx`. State `gapResult` `:684`. `SegmentGapUnderParent` unter der Pure-Play-Zeile `:883`, unter jedem Geschäftssegment `:922`, unter jeder Region `:1045`. Schalter `SegmentGapPanel` `:1056–1061`.
2. Hook: `useQuery` in `SegmentGapPanel.tsx:28–51`. Transport `apiRequest` aus `client/src/lib/queryClient.ts:51–66`. `queryClient.ts` ist nicht im Diff.
3. Route: `server/routes.ts:585–586` registriert `registerSegmentGapRoute`.
4. Handler: `server/segment-gap-route.ts:961` `POST /api/segment-gaps`.
5. Typen: `shared/segment-gap.ts:1–35`. `shared/schema.ts` unverändert. Die Lücken hängen nicht am Analyze-Dokument.

Bestehende Anzeige bleibt:

- Balken, Prozent, Umsatz, YoY (`SegmentGrowthWithKi`), `SegmentChildrenPanel`, `SegmentSupplementView`, Geo-Fußnote. Der Diff fügt Zeilen ein und ändert die Namens-Klasse auf `break-words` plus `data-testid`.
- `SegmentGapUnderParent` gibt `null` zurück, wenn keine Zeile zum Eltern gehört (`104`). Geschlossener Schalter: Test `toggle-starts-hidden`, der Block mit `segment-gap-list` ist nicht im Markup.
- `n/a` in diesem Diff ist der Text der Lücken-Zeile oder des Lücken-Panels (`84`, `145`), nicht der Ersatz einer bestehenden Prozent- oder YoY-Zelle.
- `Dashboard.tsx`: nur `pb-16` → `pb-24` am `<main>`. Keine Sektion entfernt.

Leser der neuen Felder (`shareOrigin`, `shareNote`, `bundledWith`, `bundledKind`, `expansion`, `internalReason`, `promptVersion`, `queried`, `total`, `cached`):

- Schreiben und Lesen im Handler `server/segment-gap-route.ts`.
- Anzeige in `SegmentGapPanel.tsx` (`shareOrigin`, `shareNote`, `basis`, `queried`, `total`, `reason`). `expansion`, `bundledWith` und `internalReason` rendert das Panel nicht.
- Tests in `script/test-segment-n36.ts`.

Kein Treffer dieser Felder in Score-, Rating-, Entry- oder Peer-Set-Modulen. Der Diff der Laufzeitdateien enthält kein `finalScore`, kein `entryPrice`, kein `peerSet`.

## Soll-Ist

Soll ist Philips Auftrag plus `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` §3 (Unterposten eingerückt, Anteil relativ zum Elternsegment, Schätzung gekennzeichnet, keine neuen Top-Level-Segmente, kein festes Ticker-Mapping). Das Beispiel „FSD unter Automotive“ ist das gewünschte Bild, nicht eine feste TSLA-Tabelle.

| Soll | Ist auf `a69872b7` |
| --- | --- |
| Generisch, adaptiv, per KI, nicht pro Ticker hartcodiert | Prompt und Eltern kommen aus den angezeigten FMP-/SEC-Namen. Keine Ticker-Map. Taxonomie in Prüfpunkt 3. |
| FSD als Untersegment von Automotive, wenn es dorthin gehört | Modell-Eltern `Automotive` bleibt (`keeps-fsd-under-automotive`). Name `FSD Software` oder `Full Self-Driving` plus `bundledWith` auf einem Hardware-Host wird dorthin gelegt. Nackter Name `FSD` mit Software-Wort nur in `expansion` bleibt am Service-Eltern. |
| Charging und Regulatory Credits nicht über den Erklärungstext umhängen | Bleiben am Service-Eltern. Belege in Prüfpunkt 2. |
| Jede Zeile mit Zahl: Quelle und `KI-Schätzung` | Badge und `basis` in `SegmentGapPanel.tsx:140–162`. Ohne Quelle: `KI-Vorschlag` und `n/a`, Anteil null. |
| Keine Platzhalterzahl | Anteil 0 verworfen, kein Default. |
| Höchstens 4 KI-Calls | `SEGMENT_GAP_MAX_CALLS` und HTTP-Budget, Test `http=4`. |
| Kein `:online` für diesen Abruf | Route setzt `online` nicht. |
| Cache mit Schlüssel, TTL, Invalidierung | `parentCacheKey`, 24 h / 60 s, Prompt-Version und Umsatz im Schlüssel. |
| Datenkette UI → Query → Route → Handler → Schema | Kette bis `shared/segment-gap.ts`. `schema.ts` bewusst unverändert. |
| Bestehende Segment- und Regionenanzeige bleibt | Additiv unter der Elternzeile. Balken und YoY bleiben. |
| Keine Score-/Rating-/Entry-/Peer-Änderung | Diff ohne diese Felder. |
| Merge ohne Verlust von main seit dem Abzweig | Merge-Tree konfliktfrei. Einziger main-Commit seit der Basis ist Docs und bleibt. |

Weiter offen auf der Spec, auch nach diesem Head: Wachstumsschätzung für das nächste Jahr am Elternsegment; manuelles Bestätigen oder Überschreiben. Der Perplexity-Footer ist auf main `7aaa13ce` nicht Bestandteil dieses Diffs; der Spec-Nachtrag auf dem PR-Head sagt, er sei im Baum von `9110156c` schon weg.

## Spec-Status

`WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` bleibt **offen**. Der PR-Head ergänzt den Nachtrag „Soll-Ist-Teil-Fortschritt 18.11.2026 – #492“ und schreibt dort „Spec bleibt OFFEN“. Kein Rename, kein `fertig_`. Die Dateien `fertig_*` und `Fertig_*` sind nicht im Diff und werden hier nicht auf offen gestellt.

Auf main `7aaa13ce` endet die Spec beim Nachtrag 11.11.2026 (#482). Der #492-Nachtrag liegt nur auf dem PR-Head.

## Tests auf diesem Head

Befehl, Keys aus der Umgebung entfernt:

`env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n36.ts`

Ergebnis: **147 PASS, 0 FAIL**, letzte Zeile `n36 PASS`. Kein Live-Call an FMP oder OpenRouter, kein `POST /api/analyze`, kein Production-Ticker. Der Budget-Test ersetzt `fetch`.

`env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npm run check` endet mit Exit 2 und **76** `error TS`. Keine Meldung in den elf PR-Dateien. Die 76 liegen in `analyze-helpers.ts`, `Compare.tsx`, `Section9.tsx`, `analyze-route.ts`, `Section3.tsx`, `researcher.ts`, `bias-fixes.ts`, `buffett-ratio.ts`, `Section8.tsx`. Das ist die bekannte Baseline „tsc 76“ aus dem Spec-Nachtrag vom 10.11.2026, nicht ein Fehler dieses Diffs. `schema.ts` ist unverändert, die PESTEL-Fehler hängen nicht an der einen Zeile in `segment-children.ts`.

## Residuen (kein Befund, Verdikt bleibt GO)

1. Cache-Schlüssel je Eltern enthält die anderen Segmentnamen nicht (`parentCacheKey`, `920–922`). Bei unverändertem Umsatz dieses Elterns kann eine Antwort bis zu 24 h alt sein, obwohl die Geschwisterliste sich geändert hat. Prompt-Textänderungen invalidieren über `SEGMENT_GAP_PROMPT_VERSION`.
2. `callLLMJson` mappt `openrouter-budget` auf `null` (`925–928`). Der HTTP-Deckel 4 bleibt wirksam. Der betroffene Eltern kann als „KI nicht erreichbar“ erscheinen; die weiteren Eltern tragen den Call-Limit-Satz.
3. `reviewKiChildren` hängt eine nicht konkrete Quelle nicht mehr an `basis` (`shared/segment-children.ts:315`). Die Zeile und die bestehende Segmentanzeige bleiben.

## Nicht getan

Kein Merge von #492. Kein Push nach `main`. Keine Änderung an Scores, Ratings, Entries oder Peer-Sets. Kein Live-`POST /api/analyze`. Dieser Bericht ist die einzige Datei auf `cursor/pr492-segment-gap-review-670d`.
