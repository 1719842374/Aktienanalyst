# Offen_WORK_GOLD_MINER_BREAKEVEN.md — Gold Spot vs. Miner-Breakeven (AISC)

> **Stand: 2026-11-01, nachgezogen auf #398**  
> Basis main `d9b70685bc20e782e2268619e807fe0ae6e0b72a` (#374).  
> Nachzug Squash `ef79c90cc7783f2e0795a4467ff76b3c2ec9ad64` (#398, Parent `c5f300e0b55530aada1f5cd04df013cdb2a61ba3`): Prompt 4, AISC aus dem TA-Chart.  
> Design-Spec: Gold „Spot vs. Miner-Breakeven (AISC)“ analog BTC Section 13.  
> Status dieser Datei: **Offen_** bis S1–S9 vollständig ✅ sind. Nicht von Hand auf `Fertig_` drehen, solange eine Zeile offen ist.

Reine Anzeige. Kein GIS, kein adaptiver Score (`inScore: false`). BTC-Miner-Kernformeln bleiben unberührt.

## Datenkette

`server/data/gold-aisc.json` → `shared/gold-aisc.ts` `buildGoldAiscSeries` → `server/gold-aisc.ts` `loadGoldAiscSeries()` → `server/gold-routes.ts` `GET /api/analyze-gold` (`historicalPrices` + `aiscLine`) → `shared/gold-miner-zone.ts` `buildGoldMinerZone()` → `GoldAnalysis.aiscZone` → `GoldDashboard.tsx` `useQuery(["/api/analyze-gold"])` über `client/src/lib/queryClient.ts` → `GoldMinerBreakevenSection`.

Kein neuer Endpoint. Offline-Fallback `client/src/lib/goldFallbackData.ts` trägt kein `aiscZone` (State „offline“).

## Rechnung

- Multiple = Spot / AISC-Stufe (`goldAiscStepAt`). Vor der ersten Stufe und in n/a-Stufen bleibt das Multiple leer.
- Schwellen am Tag d nur aus Werten ≤ d. Unter `GOLD_MINER_ZONE_MIN_OBS = 120` ist die Zone null, `naReason` = „Historie < 120 Handelstage“.
- P20 = Kapitulationskante, P50 = profitabel. `multiple < 1` (Spot unter AISC) ist ebenfalls Kapitulation.
- Kapitulations-Score = Perzentil-Rang des aktuellen Multiples (0 = niedrigstes, 100 = höchstes), bei `multiple < 1` auf höchstens 10 gekappt.
- Glättung Fenster 7 nur für die Segmente. `latest.zone` bleibt die Tageszone.

## Soll-Ist

Ist-SHA vor dieser Arbeit: main `d9b70685bc20e782e2268619e807fe0ae6e0b72a`.

| # | Soll | Ist auf main `d9b70685` | Nach Prompt 1 | Status |
|---|---|---|---|---|
| S1 | AISC nicht im Preischart | Overlay + Chip `toggle-gold-aisc` in `GoldPriceChart.tsx` | unverändert (Prompt 4) | ✅ #398 Squash `ef79c90cc7783f2e0795a4467ff76b3c2ec9ad64`. TA-Chart ohne AISC-Linie und ohne Chip `toggle-gold-aisc`. Link `data-testid="gold-aisc-link-s9"`. |
| S2 | eigener Block „Spot vs. Miner-Breakeven (AISC)“ mit Zonen-Bändern | fehlt | `GoldMinerBreakevenSection` als Sektion 9 direkt nach dem Preis-Chart. Drei Zeit-Bänder, Spot und AISC auf eigener Achse. | ✅ |
| S3 | Karten Multiple / AISC Ø NEM/B/AEM / Marge / Kapitulations-Score | Multiple nur im Tooltip | Vier Karten aus `aiscZone.latest`. Chat-Kontext Sektion 9 trägt dieselben Zahlen. | ✅ |
| S4 | RSI eigenes Pane | `GoldPriceChart.tsx` RSI(14) eigenes Pane | unverändert | ✅ |
| S5 | Schwellen adaptiv (Perzentil der eigenen Historie) | feste 1,10/1,15 in `shared/gold-aisc.ts` | Sektion 9 klassifiziert über P20/P50 plus Spot&lt;AISC. Die Overlay-Faktoren 1,10/1,15 bleiben im Modul, bis Prompt 4 das Overlay aus dem TA-Chart nimmt. | 🟡 #398 nimmt das Overlay aus dem TA-Chart. `GOLD_AISC_STRESS_LOW` 1.10 und `GOLD_AISC_STRESS_HIGH` 1.15 stehen auf dem Squash weiter in `shared/gold-aisc.ts`. Sektion 9 bleibt P20/P50. |
| Skala | Eigene $/oz-Achse nur für Spot und AISC (nicht bei 0, kein Aufschlag ×1,15). Multiple und Marge je eigene Achse. | TA-`yDomain` zieht das Minimum auf die AISC-Stufe und das Maximum mindestens auf AISC×1,15, solange das Overlay an ist | `goldMinerPriceDomain`: Padding 6 % um Spot und AISC. Beispiel Spot 1.100 / AISC 1.000 endet unter 1.150. | ✅ #398: `yDomain` in `GoldPriceChart.tsx` nur aus Kurs und sichtbaren MAs, ohne AISC-Stufe und ohne ×1,15. Sektion 9 bleibt `goldMinerPriceDomain` (Padding 6 %, #399 `636979f1`). |
| Rechnung | Wie BTC: eine Kostenlinie gegen den Spot, Verhältnis Spot/Kosten, drei Zeit-Zonen (Kapitulation, Übergang, Profitabel). Gold-Schwellen aus der eigenen Multiple-Historie, nicht die BTC-Punktetabelle und nicht ×1,10/×1,15. | Overlay: `goldAiscStress` mit festen 1,10/1,15 auf der Preisachse | 1,12× ist im Overlay „Vorwarnung“, in der Sektion Kapitulation, wenn die eigene P20 darüber liegt. `multiple = spot/aisc`, `marginUsd = spot−aisc`. | 🟡 Zonen der Sektion aus P20/P50 (#399). #398 zeichnet `goldAiscStress` nicht mehr auf der TA-Preisachse. Die Faktoren 1,10/1,15 bleiben in `shared/gold-aisc.ts`. |
| S6 | Datenkette server-seitig, Response-Feld `aiscZone` | `aiscLine` vorhanden, `aiscZone` fehlt | `GET /api/analyze-gold` setzt `aiscZone: buildGoldMinerZone(historicalPrices, aiscSeries)` neben `aiscLine`. `aisc: null` an `scoreGoldAdaptive` unverändert. Fallback ohne Feld. | ✅ |
| S7 | States Offline/n/a/375/1440 | Overlay-Chips; Block fehlt | Offline ohne `aiscZone`, n/a mit `naReason`, Karten 2/4 Spalten, Charts 220/170/150 unter 640 px. | ✅ |
| S8 | BTC unverändert | Section 13, `minerMetrics.ts` | nicht angefasst | ✅ |
| S9 | #374 QE/QT-Bänder + Gold/WALCL bleiben | vorhanden seit `d9b70685` | nicht angefasst | ✅ |

## Nachzug #398 (Squash auf main)

Belegt per `git log` und `git show` auf main: `ef79c90cc7783f2e0795a4467ff76b3c2ec9ad64`, Betreff „Gold: AISC aus dem TA-Chart nehmen (Prompt 4) (#398)“, ein Parent `c5f300e0b55530aada1f5cd04df013cdb2a61ba3`. Drei Dateien, +28/−127. Die Spec war nicht im Squash. Dateien: `client/src/components/gold/GoldPriceChart.tsx`, `client/src/components/gold/GoldMinerBreakevenSection.tsx`, `script/test-gold-aisc-line.ts`.

| # | Soll | Ist im Squash #398 | Status |
|---|---|---|---|
| S1 | AISC nicht im Preischart | AISC-Overlay-Import aus `GoldPriceChart.tsx` entfernt. Link `gold-aisc-link-s9`, Text „Minen-AISC → Abschnitt 9 Miner-Breakeven“. Kein `dataKey="aisc"`, kein `toggle-gold-aisc`. | ✅ |
| S2 | eigener Block mit Zonen-Bändern | Block aus #399 `636979f1`. #398 benennt nur `dataKey` `aisc` → `minerAisc`. | ✅ |
| S2-Band | zwei Zonenflächen im Fenster 1Y | Die `ReferenceArea` je Segment bleibt. Keine zweite Fläche im Diff. Der PR-Text von #398 führt das Band als nicht enthalten. | ❌ nicht Teil von #398 |
| S5 | Schwellen adaptiv, nicht die festen 1,10/1,15 | Sektion 9 über P20/P50. `shared/gold-aisc.ts` behält `GOLD_AISC_STRESS_LOW` 1.10 und `GOLD_AISC_STRESS_HIGH` 1.15. | 🟡 |
| Skala | Spot/AISC-Achse ohne Aufschlag ×1,15; TA-Achse nicht auf die AISC-Stufe gezogen | `yDomain` nur Kurs und sichtbare MAs. `goldMinerPriceDomain` unverändert, Padding 6 %. | ✅ |
| Rechnung | Schwellen aus der eigenen Multiple-Historie, nicht ×1,10/×1,15 auf der Preisachse | Overlay-Stress von der Preisachse entfernt. `goldAiscStress` bleibt im Modul. | 🟡 |
| S6–S9 | Datenkette, States, BTC unverändert, #374-Bänder | Kein `server/` und kein BTC-Code in den drei Dateien. Test prüft, dass QE/QT, Gold/WALCL und das RSI-Pane im Chart bleiben. | ✅ |
| Euphorie ≥ P90 | Entscheidung Philip | `shared/gold-miner-zone.ts` ist nicht im Squash. Keine Euphorie-Zone. | ❌ |
| BTC-Schwellen adaptiv | nicht dieser Auftrag | BTC-Code nicht unter den drei Dateien. | offen |

Auf Tip `4286b44f48532e2d501fb8cbf3ae2122c7456b4f` steht der Link `gold-aisc-link-s9` weiter in `GoldPriceChart.tsx`. `yDomain` dort weiter nur Kurs und sichtbare MAs. Dateiname bleibt `Offen_`.

## Offen (Philip, nicht in diesem Auftrag entschieden)

- Euphorie-Zone ≥ P90: ja oder nein. Typ-Slot `euphoria` / `thresholds.pEuphRank: 90` / `euph: null` ist angelegt, es wird keine Euphorie-Zone vergeben.
- BTC-Schwellen später auch adaptiv: ja oder nein. BTC-Code unverändert.
