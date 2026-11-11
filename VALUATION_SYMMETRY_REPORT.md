# VALUATION_SYMMETRY_REPORT

**Status:** nur Analyse und ein Vorschlag. Nichts gebaut. Score, Rating, Entry und Kursziel sind unverändert.
**main-SHA:** `d327705546128bef37ac8ac32d89118916337975` (`d3277055`, gleich `origin/main` nach `git fetch origin main` am 11.11.2026).
**Daten:** `POST https://aktienanalyst.onrender.com/api/analyze` mit `{ useLLM: false }`, Antworten 5–9 s, `dataTimestamp` 11.11.2026 18:19–18:20 UTC. Kein eigener FMP-Abruf. Alle sieben Ticker kommen aus diesem App-Cache und sind **generische Sektor-Katalysatoren** (`catalystsSource: "generic"`, vier von vier `generic: true`).
**Freigabe:** Bau erst nach Philips Freigabe der Tabelle unten. AUTONOM-MERGE gilt nicht.

Ein späterer Nachtrag ersetzt nur, was er ausdrücklich ersetzt. Nachtrag 4 streicht „D = −U“. Nachtrag 5 macht die drei Ausgänge zum Hauptmodell. Die Zwei-Ausgangs-Form bleibt die Vergleichsspalte. Schema und Prompt sind **ein** Entwurf.

---

## Vorher / Nachher (zur Freigabe)

Alle Ziele in USD. Das Ist-Ziel ist das, was `selectCatalystBase` heute ausgibt: Entscheidungs-DCF nur, wenn DCF × (1 + GB) mindestens 70 % des Kurses ist, sonst der Analyst-PT-Median, mal (1 + positive GB). Die Varianten-Ziele wenden **dieselbe** 70-%-Schwelle auf die neue GB an. Steht die Quelle auf `pt`, ist die Basis der Konsens, nicht der DCF.

V2f ist das Hauptmodell. Ohne begründetes `p_V` setzt der vorgeschlagene Server `p_V = 0` (nicht `1 − p`). Dann ist V2f zahlenmäßig das heutige Ziel. Das ist der Fallback, kein gemessenes Drei-Ausgangs-Ergebnis. V2a (zwei Ausgänge) und V2e brauchen ein eigenes `D` und sind deshalb `n/a`. V2b und V2d sind Spannen über den Einpreisungs-Platzhalter `e ∈ [0,30; 0,70]`, nicht Punktwerte. V2b/V2c setzen den unbekannten D-Schenkel auf 0 und sind so gekennzeichnet. V1 addiert die drei fest verdrahteten Downside-Zeilen (−11,5 Pp) und ist wegen Doppelzählung und Gate-Sprung **nicht** der Vorschlag.

| Ticker | Kurs | Ist-Basis | Ist-Ziel | V2f Haupt (3 Ausgänge) | Δ V2f | V1 Ziel (Gate) | Δ V1 | V3 | Fallback |
|---|---:|---|---:|---|---:|---:|---:|---|---|
| TSLA | 393,43 | Gehärteter Inverse-DCF **5,42**; Zielbasis Analyst-PT 442 | 474,44 | gleich Ist (`p_V = 0`, Felder fehlen) | 0 % | 423,61 (`pt`) | −10,7 % | nicht anwendbar (DCF = 1,4 % des Kurses). g* 13,27 %. 10-J-Suche ohne Schnitt | generisch, Ziel vorläufig |
| RIVN | 13,57 | Gehärteter Inverse-DCF **0,88**; Zielbasis PT 17 | 18,63 | gleich Ist | 0 % | 16,67 (`pt`) | −10,5 % | nicht anwendbar (6,5 %). g* 21,81 % bei negativem FCF, nicht als Wachstumsbeleg lesen. Bedingte EBIT-Marge 52 % | generisch, Ziel vorläufig |
| PLTR | 173,02 | Gehärteter Inverse-DCF **5,24**; Zielbasis PT 235 | 282,26 | gleich Ist | 0 % | 255,23 (`pt`) | −9,6 % | nicht anwendbar (3,0 %). g* 12,58 %. 10-J-Suche ohne Schnitt | generisch, Ziel vorläufig |
| NVDA | 176,76 | Gehärteter Inverse-DCF **35,88**; Zielbasis PT 325 | 401,37 | gleich Ist | 0 % | 364,00 (`pt`) | −9,3 % | DCF = 20,3 % des Kurses, Schwelle 10–15 % nicht gerissen. g* 11,83 %. Bedingtes g1 **36,9 %** bei fester Modellmarge 60,4 % | generisch, Ziel vorläufig |
| XPEV | 9,885 | Gehärteter Inverse-DCF **0,13**; Zielbasis PT 16 | 21,20 | gleich Ist | 0 % | 19,36 (`pt`) | −8,7 % | nicht anwendbar (1,3 %). g* 0,66 %. 10-J-Suche ohne Schnitt | generisch, Ziel vorläufig |
| KO | 96,80 | Gehärteter Inverse-DCF **66,54**; Zielbasis dieser DCF | 72,80 | gleich Ist | 0 % | 96,93 (`pt`, Gate springt) | **+33,2 %** | DCF = 68,7 % des Kurses, Schwelle nicht gerissen. g* 5,48 %. 10-J-Suche ohne Schnitt | generisch, Ziel vorläufig |
| JNJ | 278,195 | Gehärteter Inverse-DCF **144,81**; Zielbasis PT 281 | 319,10 | gleich Ist | 0 % | 286,79 (`pt`) | −10,1 % | DCF = 52,1 % des Kurses, Schwelle nicht gerissen. g* 3,92 %. Bedingte EBIT-Marge **44,4 %** bei festem Modellwachstum. g1 bis 80 % reicht nicht an den Kurs | generisch, Ziel vorläufig |

### Vergleichsspalten (nicht das Hauptmodell)

GB in Prozentpunkten. Dollarziel nur, wo die Formel ohne erfundenes `D` auskommt. `e30` / `e70` sind die Spannenränder, nicht der heutige `einpreisungsgrad`.

| Ticker | Ist-GB | V2a zwei Ausgänge | V2b Spanne, D-Schenkel = 0 | V2c brutto, D = 0 | V2d Grenzfall `(p − e)·U` | V2e |
|---|---:|---|---|---:|---|---|
| TSLA | +7,34 | n/a, kein `D_i` | GB +12,61 bis +5,41 → Ziel 497,75 bis 465,89 (Δ +4,9 % / −1,8 %) | +18,02 → 521,65 (Δ +9,9 %) | GB +5,12 bis −12,08 → 464,63 bis 388,61 (Δ −2,1 % / −18,1 %) | n/a, kein `D` |
| RIVN | +9,58 | n/a | +20,61 bis +8,83 → 20,50 bis 18,50 (Δ +10,1 % / −0,7 %) | +29,44 → 22,00 (Δ +18,1 %) | +9,04 bis −18,16 → 18,54 bis 13,91 (Δ −0,5 % / −25,3 %) | n/a |
| PLTR | +20,11 | n/a | +26,11 bis +11,19 → 296,36 bis 261,30 (Δ +5,0 % / −7,4 %) | +37,30 → 322,65 (Δ +14,3 %) | +20,80 bis −1,20 → 283,88 bis 232,18 (Δ +0,6 % / −17,7 %) | n/a |
| NVDA | +23,50 | n/a | +26,50 bis +11,36 → 411,11 bis 361,90 (Δ +2,4 % / −9,8 %) | +37,85 → 448,01 (Δ +11,6 %) | +21,05 bis −1,35 → 393,41 bis 320,61 (Δ −2,0 % / −20,1 %) | n/a |
| XPEV | +32,51 | n/a | +26,78 bis +11,48 → 20,28 bis 17,84 (Δ −4,3 % / −15,9 %) | +38,25 → 22,12 (Δ +4,3 %) | +18,75 bis −7,25 → 19,00 bis 14,84 (Δ −10,4 % / −30,0 %) | n/a |
| KO | +9,41 | n/a | +13,19 bis +5,65 → 75,31 bis 70,30, Quelle bleibt DCF (Δ +3,5 % / −3,4 %) | +18,84 → 79,07, Quelle DCF (Δ +8,6 %) | +4,74 bleibt DCF (69,69, Δ −4,3 %); −14,06 springt auf PT (85,08, Δ **+16,9 %**) | n/a |
| JNJ | +13,56 | n/a | +17,92 bis +7,68 → 331,36 bis 302,58 (Δ +3,8 % / −5,2 %) | +25,60 → 352,94 (Δ +10,6 %) | +9,40 bis −12,20 → 307,41 bis 246,72 (Δ −3,7 % / −22,7 %) | n/a |

Der KO-Sprung bei V1 (+33 %) und beim unteren V2d-Rand (+17 %) ist kein höherer innerer Wert. Eine niedrigere GB drückt DCF × (1 + GB) unter 70 % des Kurses, und der Code wechselt auf den höheren Analyst-PT. Dieselbe Falle sitzt in `shared/catalyst-base.ts:12–28`.

---

## Kette

UI `client/src/pages/Dashboard.tsx:217` postet über `client/src/lib/queryClient.ts:51–63` (`apiRequest`) nach `POST /api/analyze`. Registrierung: `server/index.ts:110` → `server/routes-register.ts` → `server/routes.ts:128` → `registerAnalyzeRoute` in `server/analyze-route.ts:491`. Der Handler setzt am Ende `applyBiasFix` und `attachExecSummary` (`server/analyze-route.ts:2426–2428`). Die Katalysator-Karte ist Sektion 17: `Dashboard.tsx:717` → `CatalystsSection`. Der KI-Knopf postet `POST /api/catalyst-enrich` (`CatalystsSection.tsx:82–86` → `analyze-route.ts:2449`). PDF nimmt dieselbe Basis: `server/pdf-export.ts:148–160` ruft `selectCatalystBase` aus `shared/catalyst-base.ts:6`.

---

## Offene PRs auf dieser Kette

Geprüft gegen `main` `d3277055`. Nichts davon ist gemergt. Vorhandenes wiederverwenden, nichts parallel neu bauen.

| PR | Stand | Berührt die Kette? |
|---|---|---|
| #475 | Draft, Label an Ampel und `valuationBaseLabel` | Text der DCF-Zeile, nicht die FCFF-Rechnung. Dateien u. a. `ExecSummaryCard.tsx`, `execLageFromFazit.ts`. Ein späterer Symmetrie-Bau darf diese Labels nicht ein zweites Mal verdrahten. |
| #486 | Draft, KI-Schätzen Segmente/Regionen | Segment-Routen, nicht Kursziel oder GB. |
| #489 | Draft, Chat Zwei-Tab | `useChatHistory.ts`, nicht die Bewertungskette. |
| #490 | Draft, Earnings-Farben im Chart | `TechnicalChart.tsx`, nicht der Kegel-Bear. |
| #492 | Draft, fehlende Segmente | `Section2.tsx` und Segment-Route, nicht `selectCatalystBase`. |
| #493 | Draft, Ampel-Badge in der S12-Toolbar | Nur `TechnicalChart.tsx`. Die Bear-Formel `scenarioCone.ts:710` bleibt. |
| #494 | Draft, S15: bei Cache-404 die Analyse einmal neu laden | `CatalystsSection.tsx`, `catalystEnrichFlow.ts`, `Dashboard.tsx`, `analyze-route.ts`, `llm-openrouter.ts`. Auf `main` antwortet Enrich ohne Cache weiter mit 404 (`analyze-route.ts:2475–2476`). Der Symmetrie-Bau sollte auf diesem Fix aufsetzen, nicht einen zweiten Reload schreiben. |

Der im Grundprompt genannte Lauf `bc-b8864828` (S12-Layout) ist im Repo und in der offenen PR-Liste nicht vorhanden. Der offene S12-Stand ist #493.

---

## A — TSLA 5,42 $ nachgerechnet

Die 5,42 $ sind `biasFix.decisionPerShare` unter dem Label „Gehärteter Inverse-DCF“. Der unadjustierte Conservative DCF daneben ist 5,81 $ und trägt das Label „Unadjusted / Extrapolative“. Beide Labels entstehen in `shared/bias-fixes.ts:824–848`. Der Wechsel passiert ab zwei aktiven Triggern (`applyBiasAdjustment`, `shared/bias-fixes.ts:372–408`). Bei TSLA sind drei aktiv: Moat Narrow (Regel-Moat, nicht das gespeicherte Badge), DCF-gegen-Analyst Δ 110,9 Pp, Gate `PRICING_POWER`. WACC-Uplift der Bandmitte für drei Trigger: +1,05 Pp (`WACC_UPLIFT_PP_3`).

Nachrechnung auf dem Cache-Payload mit `buildDefaultDCFParams` + `calculateFCFFDCF` + `buildBiasDecision` (dieselben Funktionen wie die UI):

| Größe | Wert | Herkunft |
|---|---:|---|
| Kurs | 393,43 | Payload |
| Aktien | 3 952 757 929 | Payload. Kurs × Aktien = `marketCap` auf 0,00 % Abweichung |
| FCF gesamt | 6,220 Mrd. $ | `computeFcfTTM`, Gesellschaftssumme, `server/analyze-helpers.ts:196–216` |
| FCF je Aktie | 1,5736 $ | 6,220 Mrd. / 3,953 Mrd. Aktien, identisch mit `financialStatements.cashFlow.fcfPerShare` |
| Umsatz / EBIT | 94,827 / 4,355 Mrd. | EBIT-Marge 4,6 % |
| Capex | 8,527 Mrd. = 9,0 % vom Umsatz | in den Parametern `capexPct: 9` |
| Netto-Cash | 8,137 Mrd. | `totalDebt − cash` ist negativ, wird addiert, nicht abgezogen |
| EPS TTM | 1,08 | Sanity-Cap greift nicht (kein „DCF-Sanity“ in `steps`) |
| Lynch | cyclical | `classifyLynch`: Auto → zyklisch, `server/catalyst-engine.ts:69–72` |
| g1 / g2 / Terminal | 6 % / 4 % / 2 % | Lynch-Tabelle `shared/lynch-dcf-defaults.ts:59–66`, nicht das historische −2,9 % Umsatzwachstum |
| FCF-Abschlag | 8 % | Payload-Feld ist 0. `0` ist in `fcfHaircut: sectorFcfHaircut \|\| lynch` falsy, also greift der Lynch-Default 8 (`shared/valuation-signal.ts:407–410`) |
| β | 1,743 → 1,74 | Klemme 0,50–1,80, `shared/valuation-signal.ts:188–199`. Kein Deckel-Eingriff, nur Rundung |
| Rf / ERP / Steuer / Rd | 4,2 / 5,5 / 21 / 5,0 | `valuation-signal.ts:184–187` |
| RSL | 104,1 < 105 | Malus −7,5 % relativ auf g1 und g2, `valuation-signal.ts:471–537` |
| WACC unadjustiert | 13,67 % | CAPM in `calculateFCFFDCF`, nicht der Sektor-WACC 8,5 % |
| Y1-FCFF des Modells | 1,45 Mrd. | NOPAT aus 4,6 % Marge + DA 7,2 % − Capex 9 % − ΔWC 5 % des Umsatzzuwachses, dann × 0,92 |
| Equity / Aktie unadjustiert | 5,81 $ | EV 14,84 Mrd. + Netto-Cash 8,14 Mrd. = 22,98 Mrd. / 3,953 Mrd. Aktien |
| Gehärtet | 5,42 $ | WACC 14,72 % (+1,05 Pp), g1 5,4 % (6 % × 0,9 Moat-Faktor), RSL-Malus zusätzlich innerhalb von `calculateFCFFDCF` |

**Einheitenfehler: keiner.** FCF ist die Gesellschaftssumme in Dollar, die Aktie entsteht einmal durch Division durch `sharesOutstanding`. FCF je Aktie im Payload und die Division stimmen überein. Kurs × Aktien stimmt mit der Marktkapitalisierung überein. Der Sanity-Cap auf ein KGV (`valuation-signal.ts:624–639`) hat nicht gegriffen.

**Warum trotzdem 5,42 statt eines kursnahen Werts.** Das FCFF-Modell setzt den berichteten FCF von 6,22 Mrd. nicht als Start-Cashflow ein. Es baut FCFF aus EBIT-Marge, einer DA-Quote von 80 % des Capex und 9 % Capex neu auf. Jahr 1 liefert 1,45 Mrd. statt 6,22 Mrd. Dazu deckelt Lynch „cyclical“ das Wachstum auf 6 %, obwohl der einfache Fünfjahres-FCF-DCF in `analyze-route.ts:1712–1725` den berichteten FCF mit bis zu 25 % wachsen lässt und **23,17 $** ergibt. Beide liegen weit unter dem Kurs. Der Namensbestandteil „Inverse“ ist auf diesem Pfad ein gehärteter Forward-FCFF, kein aus dem Kurs gelöstes Reverse-DCF. Das steht so in `fertig_WORK_BIAS_FIXES_INVERSE_DCF.md` (Switch ab zwei Triggern, Unadjusted bleibt sichtbar). Die Datei heißt `fertig_` und wird nicht zurückgedreht. Der Kommentar in `shared/bias-fixes.ts:2` nennt noch den alten Dateinamen `Offen_WORK_BIAS_FIXES_INVERSE_DCF.md`; die Datei auf `main` ist die fertige.

Dieselbe Struktur, kurz, bei den anderen Titeln: Aktien und Marktkapitalisierung passen überall auf 0,00 %. FCF je Aktie passt überall zum Cashflow-Feld. NVDA-β 2,216 wird auf 1,80 geklemmt und senkt damit den WACC, erklärt die 35,88 $ also nicht. NVDA-Y1-FCFF 98,2 Mrd. liegt am berichteten FCF 96,7 Mrd.; der Abstand zum einfachen DCF von 156,25 $ kommt vom Lynch-g1 von 6 % gegen ein Umsatzwachstum von 65 % (der einfache DCF deckelt bei 25 %). RIVN hat negatives EBIT und negatives EBITDA, der Margen-Default wird dann **15 %** (`valuation-signal.ts:331–336`) bei Capex-Deckel 25 %. Das erfindet eine Marge, drückt den Wert aber nur auf 0,88 $, nicht auf einen Einheiten-Unfall. XPEV: EBIT negativ, EBITDA positiv, Marge = 0,6 × EBITDA / Umsatz = 1,7 %, deshalb 0,13 $ gegen einen einfachen FCF-DCF von 32,61 $.

---

## B — Ist-Formel des Catalyst-Adj. Target

Positive GB-Summe, nur ▲:

```
netto = brutto × (1 − einpreisungsgrad / 100)
gb = (pos / 100) × netto
Summe = Σ gb, wobei ▼ und negative Richtung 0 beitragen
```

`shared/bias-fixes.ts:251–259` (`sumUpsideGb` / `upsideGb`). Gesetzte Stelle für Template-Katalysatoren: `server/analyze-route.ts:1409–1412`. Dieselbe Formel für den KI-Enrich: `analyze-route.ts:2525–2531`. Der LLM-Parser zwingt `bruttoUpside` auf mindestens +3 (`server/llm-openrouter.ts:281–286`). Ein negatives D kann diese Funktion heute nicht überleben.

Ziel (`CatalystsSection.tsx:161–166`, PDF `pdf-export.ts:153–157`):

```
Basis = selectCatalystBase(Entscheidungs-DCF, Summe GB, Kurs, Analyst-PT-Median)
Ziel  = Basis × (1 + Summe GB / 100)
```

`selectCatalystBase` (`shared/catalyst-base.ts:12–28`): wenn Entscheidungs-DCF × (1 + GB) unter 70 % des Kurses liegt und ein PT-Median > 0 existiert, ist die Basis der **Analyst-PT-Median**. Bei TSLA: 5,42 × 1,0734 = 5,82, das ist 1,5 % des Kurses, also PT 442 × 1,0734 = **474,44**. Das ist der zirkuläre Pfad Konsens × (1 + GB). Der 5,42-$-DCF steht in der Zeile als Bewertung, treibt das angezeigte Kursziel nicht.

D1–D3 (`CatalystsSection.tsx:651–677`) sind feste Tabellenzeilen, keine Datenfelder:

| Zeile | p | Schaden | Beitrag p × Schaden |
|---|---:|---:|---:|
| D1 Earnings Miss / Guidance Cut | 25 % | −15 % | −3,75 Pp |
| D2 Macro Shock / Black Swan | 15 % | −25 % | −3,75 Pp |
| D3 Regulierung / Kartellverfahren | 20 % | −20 % | −4,00 Pp |

Sie werden nicht summiert. Ein leeres D3 kommt im Ist nicht vor: die Zeile ist immer gefüllt. Wirkt wie eine Addition von 0 auf die GB. Die ▼-Katalysatoren aus der Liste würden ebenfalls 0 zur positiven GB beitragen; im Cache dieser sieben Ticker gibt es keinen ▼.

Die harte 40-%-Schwelle steckt **nicht** in der GB. Sie steckt im Fließtext: `buildPosLine` nimmt nur PoS ≥ 40 (`server/exec-summary.ts:292–299`), und eine Contra-Zeile markiert PoS < 40 oder Einpreisung ≥ 60 (`exec-summary.ts:220–223`). Der Prompt verlangt außerdem einen Downside-Katalysator mit PoS ≤ 40 (`llm-openrouter.ts:197`), der Parser macht daraus trotzdem positives Brutto. User-Events mit negativem Brutto fließen nur bei PoS > 50 % ein (`shared/catalyst-event.ts:13–14` und `:78–80`). Nachtrag 1 lässt diese Schwellen für die Erwartungsformel weg. Sie bleiben heute Anzeige- und Event-Regeln.

---

## C — Varianten, nur gerechnet

### V1

V1 = positive GB + Σ (p × Schaden) der drei festen Zeilen = Ist-GB − 11,5 Pp. Ein leerer Pflicht-Downside wäre zu markieren und nicht als 0 zu zählen. Im Ist gibt es diese Lücke nicht. Die Zahlen stehen in der Tabelle. Nicht einbauen: die Zeilen doppeln Risiken (Abschnitt D), und das 70-%-Gate kann das Ziel nach oben springen lassen (KO).

### Einpreisung `e` — Wahrscheinlichkeit oder Reverse-DCF?

`calcEinpreisungsgrad` (`server/catalyst-engine.ts:37–56`), aufgerufen mit dem **Sektor-WACC** (`analyze-route.ts:953` und `:1409`):

```
e = clamp( max(0, g*_Sektor) / bruttoUpside , 0,15 , 0,70 ), gerundet auf ganze Prozent
```

`g*_Sektor = Sektor-WACC − FCF / EV`. Das ist ein Quotient aus dem Gordon-Reverse und dem Brutto-Upside, danach geklemmt. Es ist keine Wahrscheinlichkeit. Für TSLA ist der Sektor-WACC 8,5 %, FCF/EV ≈ 0,40 Pp, also g* ≈ 8,1 %. Daraus werden die beobachteten 54 % (8,1 / 15) und 70 % (Klemme, sobald 8,1 / U > 0,70). Die Spanne „54–70 %“ im Auftrag ist diese Klemme auf den TSLA-Templates, kein eigener Parameter.

Das in der Karte gezeigte g* ist ein **anderes**: `impliedGStar` mit dem Company-CAPM-WACC (`catalyst-engine.ts:16–28`). TSLA 13,27 % bei WACC 13,67 %. `e` ist also aus einem Reverse-DCF belegbar, aber nicht aus dem g*, das die UI als g* ausweist. Als Wahrscheinlichkeit gelesen wäre `e` falsch: es kann 70 % sein, obwohl der Katalysator nichts mit einer 70-%-Chance zu tun hat.

### V2a–V2e (Vergleich, nicht Standard)

- V2a: `p·U_netto + (1−p)·D_i` mit `p_eingepreist = 0`. `D_i` fehlt im Schema. Zelle `n/a`. Mit `D = 0` wäre es die heutige GB. Das wird nicht als V2a ausgegeben.
- V2b: dieselbe Kürzung `(1−e)` auf U und auf D. D fehlt. Die Tabelle zeigt nur den U-Schenkel als Spanne `e ∈ [0,30; 0,70]`.
- V2c: beide ungekürzt. Ohne D ist das `Σ p·U` und so beschriftet.
- V2d: `(p − e)·U`, ausdrücklich Grenzfall. Spanne über `e`, nicht der Punktwert des gespeicherten `e`.
- V2e: `(p − p_eingepreist)·(U − D)`. Ohne D `n/a`.

### V2f — Hauptmodell, drei Ausgänge

```
GB = p_G · U + p_V · D
p_G + p_V ≤ 1
Rest = Halten, Beitrag 0
```

Dieselbe Einpreisungs-Kürzung auf U und auf D, sobald beide Felder da sind (Nachtrag 5 Punkt 3). Fehlt ein begründetes `p_V`, setzt der Server `p_V = 0`, nicht `1 − p`. Deshalb ist die Hauptspalte heute gleich dem Ist.

**China, nur Illustration von D = −U, nicht der Standard** (Nachtrag 4 streicht die Regel). `p = 0,30`, `U = +3 %`, `D = −3 %`, `e = 0`:

| Lesart | Rechnung | Ergebnis |
|---|---|---|
| Heute, nur der positive Schenkel | 0,30 × 3 % | **+0,9 %** |
| Zwei Ausgänge, `p_V = 1 − p` | 0,30 × 3 + 0,70 × (−3) | **−1,2 %** |
| Drei Ausgänge 30 / 40 / 30 als Gewinn / Halten / Verlust | 0,30 × 3 + 0,30 × (−3) + 0,40 × 0 | **0 %** |

Die Lesart Gewinn 30 / Verlust 40 / Halten 30 ergäbe −0,3 % und trifft die im Auftrag genannte 0 % nicht. Die 0 % entsteht, wenn die mittlere 40 der Halte-Rest ist und Gewinn und Verlust je 30 % sind. Im TSLA-Cache gibt es keinen China-Katalysator. „China Weakness“ steckt im Risiko-Template (Abschnitt D), nicht in der GB.

### V3 — DCF unter etwa 10–15 % des Kurses

Schwelle hier als Oberkante 15 % des Kurses gelesen. Darunter: „Modell nicht anwendbar“. Die Hauptzahl ist dann das vorhandene Reverse-DCF, nicht der Konsens-PT.

Das fertige Reverse ist eine Kennzahl, kein 10-Jahres-Paar aus Umsatzwachstum und Zielmarge (`fertig_WORK_REVERSE_DCF_BRIDGE.md` Teil 1, `calculateReverseDCF` in `shared/valuation-signal.ts:688–715`):

```
g* = WACC − FCF / EV
```

Eine zweite Unbekannte (Zielmarge und g1 zugleich) ist aus einem Kurs nicht bestimmt. Gerechnet wurden zwei bedingte Suchen auf dem bestehenden FCFF, Suchraum g1 ∈ [−20 %, 80 %] und EBIT-Marge ∈ [−10 %, 60 %], die jeweils andere Größe fest. Kein Schnitt heißt: der Kurs ist in diesem Suchraum nicht darstellbar. Es wird nichts außerhalb des Schnitts geschätzt.

| Ticker | DCF / Kurs | Flag | g* (CAPM-WACC des FCFF) | Bedingtes g1 | Bedingte EBIT-Marge |
|---|---:|---|---:|---|---|
| TSLA | 1,4 % | nicht anwendbar | 13,27 % | kein Schnitt (bei 80 % noch 22,55 $) | kein Schnitt (bei 60 % noch 20,19 $) |
| RIVN | 6,5 % | nicht anwendbar | 21,81 % (FCF negativ, g* liegt über dem WACC) | kein Schnitt (bei 80 % noch 13,28 $) | 52,3 % auf der erfundenen 15-%-Startmarge |
| PLTR | 3,0 % | nicht anwendbar | 12,58 % | kein Schnitt (Deckel 41,98 $) | kein Schnitt (Deckel 9,40 $) |
| NVDA | 20,3 % | Schwelle nicht gerissen | 11,83 % | **36,9 %** | kein Schnitt, Modellmarge 60,4 % ist schon die Oberkante des Suchraums und liefert 36 $ |
| XPEV | 1,3 % | nicht anwendbar | 0,66 % | kein Schnitt, hohes g1 senkt den Wert (ΔWC) | kein Schnitt |
| KO | 68,7 % | Schwelle nicht gerissen | 5,48 % | kein Schnitt (Deckel 83,48 $) | kein Schnitt (Deckel 45,08 $) |
| JNJ | 52,1 % | Schwelle nicht gerissen | 3,92 % | kein Schnitt (bei 80 % noch 277,85 $ gegen Kurs 278,20) | **44,4 %** |

### V4

Keine Perzentile P10/P50/P90 für mehrstufiges Wachstum, Marge und Reinvestition aus historischen Basisraten inklusive gescheiterter und delisteter Firmen. Der Backtest kennt Delistings nur als Universums-Mitgliedschaft (`server/backtest/build-events.ts`, `script/test-backtest-survivorship.ts`), nicht als Verteilung von Umsatzwachstum oder Marge. Es wird nichts geschätzt. V4 = n/a.

### Ein Schema- und Prompt-Entwurf

Nachträge 2, 3, 4 und 5 in einem Vorschlag. Alle Felder optional. Fehlen sie, bleibt das heutige Verhalten (alte Cache-Einträge). `D = −U` als Standard für Marktanteil ist gestrichen.

Felder an `Catalyst` in `shared/schema.ts` (heute endet das Interface bei `flag`, Zeile 201–240):

| Feld | Typ | Regel |
|---|---|---|
| `catalystKind` | `"option" \| "marktposition" \| "regulierung_makro"` | Nachtrag 5. Option ⇒ `D = 0` und `pVerlust = 0`. |
| `complementType` | `"status_quo" \| "counter_event"` | Bezogen auf die DCF-Basisannahme, die der Prompt mitgibt (Entscheidungs-Label, g1, EBIT-Marge, WACC). `counter_event` nur mit den Zusatzfeldern. |
| `pGewinn` | Zahl 0–100, dieselbe Skala wie `pos` | Wahrscheinlichkeit Gewinn gegen die Basis. |
| `pVerlust` | Zahl 0–100 | Fehlt eine Begründung, setzt der Server 0, nicht `100 − pGewinn`. Summe mit `pGewinn` ≤ 100. Rest = Halten. |
| `downsidePct` | Zahl, vorzeichenbehaftet, in Prozent der Basis | `D`. `|D| > U` oder `D = −U` ohne Begründung ⇒ Feld verwerfen, `pVerlust = 0`. |
| `segmentRef` | String | Fehlender Segmentbezug ⇒ `D = 0`. |
| `segmentRevenueShare` | Zahl oder null | Umsatzanteil, nur wenn belegt. |
| `downsideRationale` | String, eine Zeile | Pflicht, sobald `D ≠ 0` oder `pVerlust > 0`. |

Server-Regeln, nicht nur Prompt-Text:

1. Haupt-GB = `(pGewinn/100) · U_nach_Kürzung + (pVerlust/100) · D_nach_Kürzung`. Halten trägt 0.
2. Dieselbe Kürzung `(1 − e/100)` auf U und auf D. `e` bleibt der bestehende Quotient und wird als Quotient beschriftet, nicht als Wahrscheinlichkeit und nicht als `p_eingepreist`.
3. Thema schon in D1–D3 oder in `risks[].name` / `expectedDamage` ⇒ dieses `D` entfällt (Abschnitt D).
4. Zwei-Ausgangs-Form `p·U + (1−p)·D` nur als Vergleichsspalte, nie als Standard.
5. Score, Rating, Entry und das verbindliche Kursziel bleiben auf der heutigen positiven GB, bis die Tabelle freigegeben ist. Die neue GB darf davor nur daneben stehen.

Prompt-Zusatz für `generateCatalystsAndMatchNews` (`server/llm-openrouter.ts:185–223`), aufgerufen aus dem Enrich-Handler `analyze-route.ts:2484`. Die Basisannahme gehört in den Kontextblock, der heute Kurs, PT und g* schon enthält (`llm-openrouter.ts:163–168`):

```
DCF-BASISANNAHME (U und D sind relativ zu dieser Basis, nicht zum Kurs):
Label, WACC, g1, EBIT-Marge, Terminal-g aus dem Entscheidungs-DCF.

Je Katalysator zusätzlich:
catalystKind: option | marktposition | regulierung_makro
complementType: status_quo | counter_event
pGewinn, pVerlust (Prozent, Summe ≤ 100, Rest ist Halten und trägt 0)
downsidePct (D, vorzeichenbehaftet; 0 ist erlaubt)
segmentRef und segmentRevenueShare
downsideRationale in einem Satz

Option ⇒ downsidePct = 0 und pVerlust = 0.
D = −U oder |D| > U nur mit downsideRationale, sonst weglassen.
Kein Segmentbezug ⇒ downsidePct = 0.
Nicht D = −U als Standard für Marktanteil setzen.
```

Der Parser darf ein abgelehntes `D` nicht still auf `−U` oder auf `1 − p` setzen.

---

## D — Doppelzählung

Heute steckt D1–D3 **nicht** im Kursziel. Dieselbe Geschichte steckt aber schon in `risks[].expectedDamage` und damit im Bear des S12-Kegels.

Der Kegel-Bear ist `Kurs × (1 − Σ expectedDamage / 100)` (`client/src/lib/scenarioCone.ts:710–711`, Summe in `:802–813`). Die offene Spec `WORK_SCENARIO_CONE_STOCK.md` beschreibt genau diese Bear-Linie und sagt: nur Visualisierung, keine neue Scoring-Logik. Ist entspricht dem. `fertig_`/`Fertig_` wird nicht angetastet.

`generateRisks` (`server/sector-data.ts:144–172`) setzt für jeden Sektor „Earnings Miss / Guidance Cut“ mit EW 25 % und Impact 15 %. `expectedDamage = 3,75`. Das ist **dieselbe** 25 × 15 wie die Anzeigezeile D1, nur mit positivem Schaden. D1 ist die vorzeichenverkehrte Kopie dieses Templates.

| Ticker | Σ ED | Bear-Kurs | Gleicher Stoff wie D1–D3 |
|---|---:|---:|---|
| TSLA | 21,30 % | 309,63 | D1 = Earnings Miss 3,75. Dazu Macro Recession 4,80 und „Consumer Spending Slowdown / China Weakness“ 6,00. D3-Regulierung ist in dieser Risiko-Liste nicht enthalten. |
| RIVN | 21,10 % | 10,71 | Dieselben Consumer-Templates wie TSLA. |
| PLTR | 20,85 % | 136,95 | D1 = Earnings Miss 3,75. Regulatory / Antitrust 3,00 (Thema D3, andere Höhe: 15 × 20). Macro Recession 4,60. |
| NVDA | 22,05 % | 137,78 | Wie PLTR, Tech-Template. |
| XPEV | 19,90 % | 7,92 | Wie TSLA, inklusive China Weakness 6,00. |
| KO | 14,20 % | 83,05 | D1 = Earnings Miss 3,75. Kein eigenes Regulierungs-Risiko. D3 wäre hier neu, nicht eine zweite Kopie. |
| JNJ | 20,65 % | 220,75 | D1 = 3,75. Dazu Drug Pricing 5,00 und Government Contract 5,40. D3 würde Regulierung ein drittes Mal anreißen. |

Σ ED liegt bei allen sieben unter der Bias-Schwelle 25 % (`bias-fixes.ts:306–307`), der Trigger `expected_damage` ist deshalb aus. Die Summe geht trotzdem in den risikoadjustierten CRV (`shared/fazit-entry.ts:52–53`) und in den Kegel.

Würde V1 die −11,5 Pp zusätzlich auf das Kursziel legen, wäre der Earnings-Miss doppelt: einmal in der GB, einmal im Bear und im CRV. Für Tech-Namen käme Regulierung fast doppelt (D3 −4,0 Pp neben ED 3,0). Für TSLA/RIVN/XPEV läge „China“ schon als Risiko-ED 6 % im Bear, während ein China-Katalysator mit eigenem `D` denselben Stoff noch einmal zöge. Regel im Entwurf: solches `D` entfällt.

Der Ist-Stand zählt den Stoff im Kursziel nicht mit. Die Überschneidung ist die Identität von D1 mit dem Earnings-Miss-Risiko plus die thematische Nähe von D2/D3 zu Macro, Antitrust, China und Drug Pricing.

---

## Fallback-Flag und Score / Entry

Alle sieben Zeilen sind Fallback: vier generische Template-Katalysatoren, Modus „Katalysatoren: generisch (Sektor)“ (`bias-fixes.ts:262–267`). Das Catalyst-Adj. Target ist damit vorläufig, auch wenn die UI es als Zahl zeigt.

Wirkt das heute auf Score oder Entry?

**Score und Rating: ja, über die GB.** `catalystAdjustment = positiveGb / 10` (`bias-fixes.ts:434`) addiert sich auf `overallScore` (`:435–439`). `generic: true` schließt die Katalysatoren aus dem These-Baustein E aus (`server/thesis-strength.ts:591–596`, E-Score hier überall 0,35, neutral), nicht aus dieser GB. Rating-Bänder: `overallRatingFromScore` (`bias-fixes.ts:270–275`).

| Ticker | Score mit GB | Rating | Score ohne die generische GB | Rating ohne |
|---|---:|---|---:|---|
| TSLA | 0,799 | STARK UNATTRAKTIV | 0,065 | STARK UNATTRAKTIV |
| RIVN | 0,763 | STARK UNATTRAKTIV | −0,195 | STARK UNATTRAKTIV |
| PLTR | 2,153 | STARK UNATTRAKTIV | 0,142 | STARK UNATTRAKTIV |
| NVDA | 3,304 | UNATTRAKTIV | 0,954 | STARK UNATTRAKTIV |
| XPEV | 2,812 | STARK UNATTRAKTIV | −0,439 | STARK UNATTRAKTIV |
| KO | 4,672 | NEUTRAL | 3,731 | UNATTRAKTIV |
| JNJ | 4,302 | UNATTRAKTIV | 2,946 | STARK UNATTRAKTIV |

Bei NVDA, KO und JNJ verschiebt die generische GB das Rating-Band. Angefasst wurde nichts. Der Befund ist der Ist-Stand des Cache vom 11.11.2026.

**Entry: die GB geht nicht in die Formel.** `computeFazitEntry` (`shared/fazit-entry.ts:40–54`) nimmt den Entscheidungs-DCF, nicht die GB. Max-Entry = (Entscheidungs-DCF + 2 × Worst Case) / 3. Ist-Werte aus derselben Funktion: TSLA 106,72 (Fair 5,42, Worst 157,37), RIVN 3,91, PLTR 56,53, NVDA 67,93, XPEV 3,45, KO 69,55, JNJ 184,31. Der niedrige DCF zieht den Entry. Die generischen Katalysatoren tun es nicht. Ein späterer Wechsel der GB darf den Entry erst nach Freigabe berühren, und auch dann nur, wenn die Freigabe die Basis und nicht nur die GB meint.

---

## E — Tabelle

Die Tabelle steht oben. Quelle, Gate und die Regel „fehlendes `p_V` ⇒ 0“ sind dort verbindlich. Kurz die Ist-GB je Ticker aus dem Cache: TSLA +7,34 (e = 70 / 54 / 54 / 70), RIVN +9,58, PLTR +20,11, NVDA +23,50, XPEV +32,51 (alle e = 15, weil g* nahe 0 und die Klemme unten bei 15 % liegt), KO +9,41, JNJ +13,56.

---

## F — Empfehlung, erst nach Freigabe

**Welche Variante.** V2f, drei Ausgänge, als einziges künftiges Hauptmodell. V2a nur als Vergleichsspalte. V1 nicht: feste −11,5 Pp, Doppelzählung, Gate-Sprung. V2d nicht als Standard. `D = −U` nicht. V3 als Sichtbarkeitsregel, nicht als Ersatz des fertigen g*: unter 15 % des Kurses „Modell nicht anwendbar“ und das vorhandene g* als Hauptzahl, nicht der Konsens-PT. Eine 10-Jahres-Suche nur anzeigen, wenn sie einen Schnitt hat (hier: NVDA g1 36,9 %, JNJ Marge 44,4 %, RIVN Marge 52 % mit dem Vorbehalt der 15-%-Default-Marge). Sonst „kein Schnitt“, nicht schätzen. V4 nicht bauen, bis Basisraten inklusive Delistings vorliegen.

**Betroffene Dateien, wenn gebaut wird.**

- `shared/schema.ts` `Catalyst` (Felder optional)
- `server/llm-openrouter.ts` Prompt und Parser (`:185–291`)
- `server/analyze-route.ts` Template-GB (`:1409–1412`) und Enrich-GB (`:2525–2541`)
- `server/catalyst-engine.ts` `calcEinpreisungsgrad` (Beschriftung, keine stillschweigende Wahrscheinlichkeit)
- `shared/bias-fixes.ts` `sumUpsideGb` erst nach Freigabe
- `shared/catalyst-base.ts` 70-%-Gate (der KO-Sprung)
- `client/src/components/sections/CatalystsSection.tsx` Anzeige und D1–D3
- `server/pdf-export.ts` `pdfCatalystTarget`
- `server/exec-summary.ts` PoS-Zeile und Moduszeile
- `client/src/components/sections/Section2.tsx`, `Section6.tsx`, `SummarySection.tsx` (rufen `selectCatalystBase`)
- Tests: `script/test-bias-fixes.ts`, `script/test-catalyst-event.ts`

**Breaking-Change.** Eine neue GB ändert PDF-Kursziel, S0-Fließtext (PoS ≥ 40, Contra-Zeile), S2 sobald die These die neuen Katalysatoren zitiert, und über `catalystAdjustment` Score und bei NVDA/KO/JNJ das Rating. Entry ändert sich erst, wenn die Entscheidungsbasis sich ändert, nicht durch die GB allein. Das 70-%-Gate kann ein niedrigeres GB in ein höheres Ziel übersetzen. Deshalb zuerst die Spalte daneben, nicht der Ersatz.

**Reihenfolge nach Freigabe, nicht vorher.**

1. Optionale Felder und Parser. Alte Caches bleiben beim heutigen Verhalten. Kein Schreibzugriff auf Score.
2. Prompt mit der DCF-Basisannahme. Anzeige einer zweiten Spalte V2f gegen Ist und gegen die Zwei-Ausgangs-Form. #494 (Cache-Reload) wiederverwenden, nicht doppelt bauen. #475 (Label an `valuationBaseLabel`) nicht erneut anfassen.
3. Doppelzählungs-Abgleich gegen D1–D3 und `risks[]`, bevor ein `D` in eine Summe darf.
4. 70-%-Gate so fassen, dass eine niedrigere GB nicht auf den höheren PT springt. Eigene Freigabe, weil KO und der untere V2d-Rand das Ziel sonst nach oben ziehen.
5. Erst dann die verbindliche GB, PDF, S0 und S2 umstellen.
6. V3-Hinweis „nicht anwendbar“ plus vorhandenes g*, ohne die fertige g*-Formel aus `fertig_WORK_REVERSE_DCF_BRIDGE.md` zu ersetzen.
7. Brier-Kalibrierung nicht in diesem Schritt.

---

## Stabilität (Nachtrag 5 Punkt 4) — nicht gelaufen

Die drei Läufe TSLA und die drei Läufe NVDA über `POST /api/catalyst-enrich` sind **nicht** ausgeführt.

Grund: In dieser Umgebung gibt es keinen `OPENROUTER_API_KEY` (geprüft nur auf Vorhandensein, nichts geloggt). Der bestehende Enrich auf der Produktion schreibt die neuen Katalysatoren in den RAM-Cache und in den 7-Tage-Disk-Cache und rechnet `applyBiasFix` plus `attachExecSummary` neu (`analyze-route.ts:2642–2649`). Das würde Score und Catalyst-Adj. Target von TSLA und NVDA für nachfolgende Nutzer ändern. Das widerspricht dem Auftrag, Score und Kursziel nicht anzufassen. Eine Streuung von Typ und GB liegt deshalb nicht vor. Feste Typ-Regeln über den Entwurf oben hinaus werden nicht aus einem Lauf abgeleitet, den es nicht gab.

---

## Kalibrierung (Brier) — nur Machbarkeit

`p_G` und `p_V` mit Datum brauchen einen Speicher, der einen Deploy überlebt. Render Free hat kein dauerhaftes Dateisystem; der RAM-Cache der Analyse ist 20 Minuten (`analyze-route.ts:193`), der SQLite-Cache `data.db` fällt auf einen No-Op, wenn das Dateisystem nur lesbar ist (`server/disk-cache.ts:1–8`). Dieselbe Datei nutzt `server/backtest/snapshot-store.ts` für Scoring-Snapshots, ebenfalls ohne Garantie auf Render Free. Ein Brier-Log gehört in eine gemanagte Datenbank (Postgres), nicht in die ephemere Disk und nicht in den Analyse-Cache, der beim nächsten Lauf überschrieben wird. Nichts davon ist gebaut.

---

## Offene Punkte

1. Freigabe der Tabelle durch Philip. Bis dahin kein Bau.
2. Stabilitätsläufe, Grund oben.
3. Echte Drei-Ausgangs-Zahlen für die sieben Ticker: die Felder fehlen, der Cache ist generisch. V2f = Ist ist der spezifizierte Fallback, kein Messergebnis.
4. 10-Jahres-Reverse hat für TSLA, PLTR, XPEV, KO und für RIVN-g1 keinen Schnitt im Suchraum. Nicht extrapoliert.
5. Zwei verschiedene g*: Company-CAPM in `impliedGStar`, Sektor-WACC in `einpreisungsgrad`. Vor einem Bau festlegen, welcher Quotient `e` ist.
6. `bc-b8864828` nicht auffindbar. S12-Ist zur Bear-Linie ist der Code plus die offene Spec `WORK_SCENARIO_CONE_STOCK.md`. #493 ändert die Formel nicht.
7. RIVN-Marge 15 % bei Verlust (Default) und XPEV-Marge 1,7 % über den EBITDA-Proxy sind Modellannahmen, keine Einheitenfehler. Sie gehören in die V3-Lesart, nicht in einen stillen Fix.
