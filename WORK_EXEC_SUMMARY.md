# WORK_EXEC_SUMMARY.md

> Status: **Soll** · UI-Karte nicht verdrahtet · 04.09.2026
> Code: [`server/exec-summary.ts`](./server/exec-summary.ts) — **generisch, jeder Ticker**
> Index: [WORK.md](./WORK.md)

Keine MSFT-Konstanten im Builder. MSFT unten nur als Beispiel-Output nach einem Live-Cache.

---

## Adaptive Quelle (alle Aktien gleich)

`buildExecSummary(input)` liest nur Felder, die `/api/analyze` schon legt:

| Input | Analyze-Feld |
|-------|----------------|
| price, name, ticker | S1 |
| nextEarningsDate, lastReportedQuarter | S1 Kalender |
| wacc, dcfConservative, g1 | S5 |
| gStar | S14 |
| peg, pe, pt | S1/S4/S9 |
| riskAdjTarget, invertedDcf, risks[] | S8 |
| crv*, maxEntryCrv3, scoreCapped, gate | S6/S17 |
| catalysts[], downside[] | S15 |
| moat, porterHighForces | S11 |
| pestel[] exposure/kurstreiber/kursrisiko | S12 |
| segments[] | S2 |
| s17Verdict | S17 Fazit-Wort |

Fehlt ein Feld → Zeile weglassen oder `n/v`. Nichts raten (Call-Datum!).

---

## Call (Pflicht, adaptiv)

```ts
formatEarningsCall(nextEarningsDate, lastReportedQuarter)
// Date ok  → "Der nächste Earnings Call ist am 28. Oktober 2026; zuletzt gemeldet wurde Q4 FY2026."
// Date fehlt → "Ein Call-Termin steht im Cache nicht."
```

Kopf immer `Call TT.MM.JJJJ` oder `Call n/v`.

---

## Pro / Contra (Priorität, nicht Namen)

Pro: Top-2 GB mit PoS ≥ 40 → Moat → PESTEL-Kurstreiber → Umsatz-g > WACC.
Contra: max ED (+ „zu klein gerechnet“ wenn Flag) → Porter-High → PESTEL Hoch → Risk-Ziel < 0.95×Kurs → CRV-RA < 1 → K mit PoS<40 oder Einpr.≥60.

Max 5 je Seite. Jede Zeile `src` + Text.

---

## Fazit (3 Absätze, Template füllt Klammern)

1. `{Name} ist {s17}.` DCF vs Kurs. g* vs g1. PT wenn da.
2. Risikoabschlag. Höchstes S8. Risk-Ziel vs Kurs.
3. `Deshalb warten.` + Max-Entry-Schwelle wenn Kurs darüber. + **Earnings-Call-Satz**.

LLM darf umschreiben, nicht das Wort und nicht das Call-Datum ändern. FactPack an Zahlen.

---

## Beispiel nur zur Kontrolle (MSFT-Cache 4.9.2026)

Kopf: `MSFT · 510,12 · 60 · g* 7,3 % · Call 28.10.2026`

Fazit-Absatz 3:
`Deshalb warten. Nachkaufen erst unter 375,00 Dollar. Der nächste Earnings Call ist am 28. Oktober 2026; zuletzt gemeldet wurde Q4 FY2026.`

Nebius oder META laufen durch dieselbe Funktion — anderes Cache, gleicher Satzbau.

---

## DoD

1. `exec-summary.ts` importiert keinen Ticker-String außer `input.ticker`.
2. Call-Satz immer vorhanden (Datum oder n/v).
3. UI-Karte über S1 noch offen (Ampel ⬜).
