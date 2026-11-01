# Fertig_WORK_GOLD_MINER_BREAKEVEN.md — Gold Spot vs. Miner-Breakeven (AISC)

> **Stand: 2026-11-01**  
> Basis main `d9b70685bc20e782e2268619e807fe0ae6e0b72a` (#374).  
> Design-Spec: Gold „Spot vs. Miner-Breakeven (AISC)“ analog BTC Section 13.  
> Status: **Fertig_** — S1–S9 sind ✅. Offen bleiben nur die zwei Philip-Entscheidungen unten (Euphorie P90, BTC adaptiv).

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

| # | Soll | Ist auf main `d9b70685` | Nach dieser Arbeit | Status |
|---|---|---|---|---|
| S1 | AISC nicht im Preischart | Overlay + Chip `toggle-gold-aisc` in `GoldPriceChart.tsx` | Chip, Linie, Stressbänder, Tooltip und `gold-aisc-status` sind raus. Link `gold-aisc-link-s9` scrollt zu Abschnitt 9. | ✅ |
| S2 | eigener Block „Spot vs. Miner-Breakeven (AISC)“ mit Zonen-Bändern | fehlt | `GoldMinerBreakevenSection` als Sektion 9 direkt nach dem Preis-Chart. Drei Zeit-Bänder, Spot und AISC auf eigener Achse. | ✅ |
| S3 | Karten Multiple / AISC Ø NEM/B/AEM / Marge / Kapitulations-Score | Multiple nur im Tooltip | Vier Karten aus `aiscZone.latest`. Chat-Kontext Sektion 9 trägt dieselben Zahlen. | ✅ |
| S4 | RSI eigenes Pane | `GoldPriceChart.tsx` RSI(14) eigenes Pane | unverändert | ✅ |
| S5 | Schwellen adaptiv (Perzentil der eigenen Historie) | feste 1,10/1,15 in `shared/gold-aisc.ts` | Sektion 9 nutzt P20/P50 plus Spot&lt;AISC. `goldAiscStress` bleibt im Modul (Tests, nicht gelöscht) und steuert keinen Chart mehr. | ✅ |
| Skala | Eigene $/oz-Achse nur für Spot und AISC (nicht bei 0, kein Aufschlag ×1,15). Multiple und Marge je eigene Achse. Format `$X.Xk` wie die Gold-Preisachse, aber nicht dieselbe Domain. | TA-`yDomain` zog das Minimum auf die AISC-Stufe und das Maximum mindestens auf AISC×1,15 | `goldMinerPriceDomain`: Padding 6 % um Spot und AISC. Spot 1.100 / AISC 1.000 endet unter 1.150. Die TA-Achse liest AISC nicht mehr. | ✅ |
| Rechnung | Wie BTC Section 13: Kostenlinie gegen den Spot, Verhältnis Spot/Kosten, drei senkrechte Zeit-Zonen (Kapitulation, Übergang, Profitabel). Gold-Schwellen aus der eigenen Multiple-Historie. | Overlay: `goldAiscStress` 1,10/1,15 als waagerechte Preisbänder im TA-Chart | 1,12× ist im Overlay „Vorwarnung“, in der Sektion Kapitulation, sobald die eigene P20 darüber liegt. `multiple = spot/aisc`, `marginUsd = spot−aisc`. | ✅ |
| S6 | Datenkette server-seitig, Response-Feld `aiscZone` | `aiscLine` vorhanden, `aiscZone` fehlt | `GET /api/analyze-gold` setzt `aiscZone: buildGoldMinerZone(historicalPrices, aiscSeries)` neben `aiscLine`. `aisc: null` an `scoreGoldAdaptive` unverändert. Fallback ohne Feld. | ✅ |
| S7 | States Offline/n/a/375/1440 | Overlay-Chips; Block fehlt | Offline ohne `aiscZone`, n/a mit `naReason`, Karten 2/4 Spalten, Charts 220/170/150 unter 640 px. | ✅ |
| S8 | BTC unverändert | Section 13, `minerMetrics.ts` | nicht angefasst | ✅ |
| S9 | #374 QE/QT-Bänder + Gold/WALCL bleiben | vorhanden seit `d9b70685` | nicht angefasst | ✅ |

## Offen (Philip, nicht in diesem Auftrag entschieden)

- Euphorie-Zone ≥ P90: ja oder nein. Typ-Slot `euphoria` / `thresholds.pEuphRank: 90` / `euph: null` ist angelegt, es wird keine Euphorie-Zone vergeben.
- BTC-Schwellen später auch adaptiv: ja oder nein. BTC-Code unverändert.
