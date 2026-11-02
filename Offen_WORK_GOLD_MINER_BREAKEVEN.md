# Offen_WORK_GOLD_MINER_BREAKEVEN.md — Gold Spot vs. Miner-Breakeven (AISC)

> **Stand: 2026-11-02**  
> Basis main `fc933a5e5bee5691a85dac5e2402c2bacc520b70` (#412).  
> Design-Spec: Gold „Spot vs. Miner-Breakeven (AISC)“ analog BTC Section 13.  
> Status dieser Datei: **Offen_** bis S1–S9 vollständig ✅ sind und die Lane das bestätigt. Nicht von Hand auf `Fertig_` drehen, solange eine Zeile offen ist.

Reine Anzeige. Kein GIS, kein adaptiver Score (`inScore: false`). BTC-Miner-Kernformeln bleiben unberührt.

## Datenkette

`server/data/gold-aisc.json` → `shared/gold-aisc.ts` `buildGoldAiscSeries` → `server/gold-aisc.ts` `loadGoldAiscSeries()` → `server/gold-routes.ts` `GET /api/analyze-gold` (`historicalPrices` + `aiscLine` + `aiscZone`) → `shared/gold-miner-zone.ts` `buildGoldMinerZone()` → `GoldDashboard.tsx` `useQuery(["/api/analyze-gold"])` über `client/src/lib/queryClient.ts` → `GoldPriceChart` (AISC-Pane, Kapitulationsflächen) und `GoldMinerBreakevenSection`. Dieselbe Reihe geht über `goldAiscScoreSteps` an `scoreGoldAdaptive` (F10-20, nicht an den GIS).

Kein neuer Endpoint. Offline-Fallback `client/src/lib/goldFallbackData.ts` trägt kein `aiscZone` (State „offline“).

## Rechnung

- Multiple = Spot / AISC-Stufe (`goldAiscStepAt`). Vor der ersten Stufe und in n/a-Stufen bleibt das Multiple leer.
- Schwellen am Tag d nur aus Werten ≤ d. Unter `GOLD_MINER_ZONE_MIN_OBS = 120` ist die Zone null, `naReason` = „Historie < 120 Handelstage“.
- P20 = Kapitulationskante, Median P50 = profitabel, P90 = Euphorie wenn P90 streng über dem Median liegt. `multiple < 1` (Spot unter AISC) ist ebenfalls Kapitulation.
- z-Score = (letztes Multiple − Mittel der vorherigen Werte) / Stichproben-σ. σ = 0 oder zu wenig Werte → `n/a`, keine Ersatzzahl.
- Kapitulations-Score = Perzentil-Rang des aktuellen Multiples (0 = niedrigstes, 100 = höchstes), bei `multiple < 1` auf höchstens 10 gekappt.
- Glättung Fenster 7 nur für die Segmente. `latest.zone` bleibt die Tageszone.

## Soll-Ist

Ist-SHA vor dieser Arbeit: main `d9b70685bc20e782e2268619e807fe0ae6e0b72a`.

| # | Soll | Ist auf main `fc933a5e` | Dieser Auftrag | Status |
|---|---|---|---|---|
| S1 | AISC nicht im Preischart | Overlay seit #398 weg, Link auf Abschnitt 9 | bleibt ohne Linie auf der Preisachse. Eigenes Pane unter RSI, gleiche Höhe 130, Tooltip `hsl(var(--card))`, Achse in `$/oz`. | ✅ |
| S2 | eigener Block mit Zonen-Bändern | Sektion 9, im 1Y-Fenster eine Fläche; Band 2025-11-13 → 2026-10-21 fehlte als zweite Fläche | Euphorie ab P90 teilt das 1Y-Fenster. Auf GC=F 2025-10-30 → 2026-10-21 liegen mehrere Flächen, darunter Euphorie bis 2026-03-23 und Profitabel 2026-09-02 → 2026-10-21. `y1`/`y2` = Preisdomain. | ✅ |
| S3 | Karten Multiple / AISC Ø NEM/B/AEM / Marge / Kapitulations-Score | vier Karten | unverändert, z-Score zusätzlich auf der Multiple-Karte | ✅ |
| S4 | RSI eigenes Pane | RSI(14) unter MACD | unverändert; AISC-Pane direkt darunter | ✅ |
| S5 | Schwellen adaptiv (Perzentil / Median / z-Score), keine Magic Numbers | P20/P50, Euphorie nicht klassifiziert, Overlay-Faktoren 1,10/1,15 ungenutzt im Chart | P20, Median P50, P90 (`GOLD_MINER_P_*_RANK`). z = (letztes Multiple − Mittel) / Stichproben-σ, sonst n/a. Klassifikation nutzt nicht ×1,10/×1,15. | ✅ |
| Skala | Eigene $/oz-Achse, nicht bei 0, kein ×1,15 | `goldMinerPriceDomain` | unverändert | ✅ |
| Rechnung | Spot/AISC, Zonen aus der eigenen Historie | P20/P50 plus Spot unter AISC, keine Euphorie | zusätzlich Euphorie, wenn P90 streng über dem Median liegt und das Multiple ≥ P90 | ✅ |
| S6 | `aiscZone` in der Antwort | gesetzt, Supply-Schicht bekam `aisc: null` | `aiscZone` bleibt. F10-20: `goldAiscScoreSteps` (availableFrom, keine n/a-Stufe) an `scoreGoldAdaptive`. GIS unberührt. | ✅ |
| S7 | Offline / n/a / 375 / 1440 | Sektion 9 | Pane und Kapitulations-Legende sagen `n/a — Grund`, wenn die Quelle fehlt | ✅ |
| S8 | BTC unverändert | Section 13 | nicht angefasst | ✅ |
| S9 | #374 QE/QT-Bänder + Gold/WALCL | vorhanden | nicht angefasst | ✅ |

## Offen (Philip)

- BTC-Schwellen später auch adaptiv: ja oder nein. BTC-Code unverändert.
- Euphorie ab P90 ist in diesem Auftrag umgesetzt (nur wenn P90 über dem Median liegt). Dateiname bleibt `Offen_`, bis die Lane S1–S9 bestätigt.
