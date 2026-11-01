# Offen_WORK_GOLD_MINER_BREAKEVEN.md — Gold Spot vs. Miner-Breakeven (AISC)

> **Stand: 2026-11-01**  
> Basis main `d9b70685bc20e782e2268619e807fe0ae6e0b72a` (#374).  
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
| S1 | AISC nicht im Preischart | Overlay + Chip `toggle-gold-aisc` in `GoldPriceChart.tsx` | unverändert (Prompt 4) | ❌ |
| S2 | eigener Block „Spot vs. Miner-Breakeven (AISC)“ mit Zonen-Bändern | fehlt | fehlt (Prompt 3) | ❌ |
| S3 | Karten Multiple / AISC Ø NEM/B/AEM / Marge / Kapitulations-Score | Multiple nur im Tooltip | fehlt (Prompt 3) | ❌ |
| S4 | RSI eigenes Pane | `GoldPriceChart.tsx` RSI(14) eigenes Pane | unverändert | ✅ |
| S5 | Schwellen adaptiv (Perzentil der eigenen Historie) | feste 1,10/1,15 in `shared/gold-aisc.ts` | `shared/gold-miner-zone.ts`: P20/P50 expanding window, keine 1,10/1,15. Die festen Stressfaktoren im Overlay-Modul bleiben bis Prompt 4 liegen (nicht gelöscht). | 🟡 |
| S6 | Datenkette server-seitig, Response-Feld `aiscZone` | `aiscLine` vorhanden, `aiscZone` fehlt | `GET /api/analyze-gold` setzt `aiscZone: buildGoldMinerZone(historicalPrices, aiscSeries)` neben `aiscLine`. `aisc: null` an `scoreGoldAdaptive` unverändert. Fallback ohne Feld. | ✅ |
| S7 | States Offline/n/a/375/1440 | Overlay-Chips; Block fehlt | fehlt (Prompt 3) | ❌ |
| S8 | BTC unverändert | Section 13, `minerMetrics.ts` | nicht angefasst | ✅ |
| S9 | #374 QE/QT-Bänder + Gold/WALCL bleiben | vorhanden seit `d9b70685` | nicht angefasst | ✅ |

## Offen (Philip, nicht in diesem Auftrag entschieden)

- Euphorie-Zone ≥ P90: ja oder nein. Typ-Slot `euphoria` / `thresholds.pEuphRank: 90` / `euph: null` ist angelegt, es wird keine Euphorie-Zone vergeben.
- BTC-Schwellen später auch adaptiv: ja oder nein. BTC-Code unverändert.
