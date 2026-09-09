# WORK_EXEC_SUMMARY.md

> Soll · Builder [`server/exec-summary.ts`](./server/exec-summary.ts) · Karte [`client/src/components/ExecSummaryCard.tsx`](./client/src/components/ExecSummaryCard.tsx)
> Stand: 09.09.2026 09:55 CEST — Ampel + S8/S15-Upside

S0 und S17-Fazit nutzen **dieselbe Ampel, dieselben Faktoren, dieselbe Upside**.
Technik aus S9, KI-Text aus S2, Katalysatoren aus S15, Risiken aus S8.

---

## 0. Ist vs. Soll (MSFT Live 09.09.2026)

| Block | S0 Executive Summary | S17 Fazit | S15 / S8 Quelle |
| --- | --- | --- | --- |
| Ampel | fehlt | **NEUTRAL** gelb | Score = #pos − #neg |
| Faktoren +/−/● | nein | 7 / 6 / 4 | S17-Listen |
| KI-These | nur Fließtext Lage/Bruch | eigener Satz, ohne S2-Wortlaut | S2 Investmentthese |
| Technik | ein Cross-Satz | „Technisch gemischt: Kurs > MA200, MA50 > MA200“ | S9 `currentStatus` |
| Upside | **fehlt** | +17,9 % (4 Treiber) | S15 GB-Summe **+36,05 %**, Ziel **705,91** |
| Pro-Namen nach KI | Azure, LinkedIn, Moat | nicht als Pro-Spalte | S15 K2/K3 |
| Contra | CRV RA 0,2:1 + K5 Bremse | ED 19,9 %, CRV 1,1 / 0,6 | S8 Total ED **19,9 %** |
| DCF im Fließtext | 252,37 vs Kurs 493,95 | Tabelle Kons. DCF + CRV 3:1 = 368,89 | S5/S6 |

S0 nach KI wechselt die **Namen**, nicht die **Zahlen**. 705,91 und +36,05 % stehen nur in S15.

---

## 1. Ampel (identisch S0 = S17)

Quelle: `SummarySection.tsx` ab „FAZIT (Big Picture)“.

\[
S = n_{+} - n_{-}
\]

| S | Rating | Farbe |
| --- | --- | --- |
| ≥ 4 | ATTRAKTIV | grün |
| ≥ 2 | LEICHT ATTRAKTIV | grün |
| ≥ −1 | **NEUTRAL** | gelb |
| ≥ −3 | UNATTRAKTIV | rot |
| sonst | STARK UNATTRAKTIV | rot |

MSFT Screenshot: 7 − 6 = **1** → NEUTRAL.

Guard: DCF-Upside > 80 % und Analyst-Upside < 15 % → eine Stufe runter, nicht unter NEUTRAL.

Eine Funktion `buildSummaryFazit(data)` in `client/src/lib/summaryFazit.ts`.
S0 und S17 rufen sie auf. Kein zweites Scoring.

UI-Kopie S17 → S0:

- Badge rechts **NEUTRAL**
- Kasten mit Fazit-Satz
- Positive Faktoren (n)
- Negative Faktoren (n)
- Neutral (n)
- Zeile `Signal-Score: 7 positiv / 6 negativ / 4 neutral = NEUTRAL`

S0 behält Headline + Pro/Contra-Spalte **zusätzlich**, ersetzt sie nicht.

---

## 2. Was in beide Fazit-Kästen muss

### 2.1 Technik (S9), ein Satz wie S17

Felder: `technicalIndicators.currentStatus`

- `priceAboveMA200`
- `ma50AboveMA200`
- `macdAboveZero`, `macdRising`
- `buySignal`

MSFT: Golden Cross, Kurs > MA200, kein volles BUY → Neutral-Faktor
„Technisch gemischt: Kurs > MA200, MA50 > MA200 (Golden Cross)“.

Nicht nur der verkürzte S0-Satz.

### 2.2 KI-Text aus S2 Investmentthese

Feld (erstes nicht-leeres):

`data.investmentThesis` | `data.thesis.summary` | `data.section2.kiText`

Regel: 1–2 Sätze, kein Prompt, kein zweites LLM in S0.
Nach KI-Enrich derselbe String wie in S2.

### 2.3 Katalysatoren = S15, Risiken = S8

**Pro (max. 3)** = Top-GB aus S15, PoS ≥ 40:

MSFT nach KI:

| # | Name | PoS | GB |
| --- | --- | --- | --- |
| K2 | Azure AI Infrastructure Capacity Expansion | 68 % | +10,02 |
| K3 | LinkedIn Advertising AI Monetization | 65 % | +8,32 |
| K4 | Dynamics 365 Cloud Migration Acceleration | 70 % | +8,25 |

Nicht die generischen Labels „Revenue Growth Acceleration“.

**Contra (max. 2)** = Top-Expected-Damage aus S8:

| Risiko | EW | Impact | ED |
| --- | --- | --- | --- |
| Macro Recession / Demand Shock | 20 % | 21 % | **4,20 %** |
| Tech Disruption / Competitive Shift | 20 % | 25 % | **5,00 %** |
| **Summe ED** | | | **19,9 %** |

Mapping-Bug: S8 heißt `expectedDamage`, Builder liest `expectedDamagePct` → ED-Zeile in S0 oft leer, Contra fällt auf CRV/K5 zurück.

Fix in `exec-summary-attach.ts`:

```ts
risks: (a.risks || []).map(r => ({
  name: r.name,
  expectedDamagePct: r.expectedDamagePct ?? r.expectedDamage,
  underestimated: r.underestimated,
})),
```

---

## 3. Upside — die fehlende Zahl

S15 Rechenweg (Screenshot):

\[
\text{GB-Summe} = \sum_i \mathrm{PoS}_i \times \text{Netto-Upside}_i = +36{,}05\,\%
\]

\[
T_{\text{Kat}} = \mathrm{DCF}_{\text{kons}} \times (1 + \text{GB-Summe})
= 518{,}86 \times 1{,}3605 = 705{,}91
\]

\[
U_{\text{vs Kurs}} = \frac{705{,}91}{493{,}95} - 1 = +42{,}9\,\%
\]

Nicht eingepreist am Kurs:

\[
493{,}95 \times 1{,}3605 = 672{,}02 \quad (+36{,}05\,\%)
\]

S17 zeigt +17,9 % (andere Aggregation, 4 Treiber). S0 zeigt **nichts** davon.

Pflichtzeile in S0 unter der Headline:

```
Kat.-Upside +36.05 % · Ziel 705.91 · vs. Kurs +42.9 % · S15
Risk-Adj. Target 428.80 (−13.2 % vs Kurs, ED 19.9 %) · S8
```

S8-Ziel laut Screenshot:

\[
535 \times (1 - 0{,}199) = 428{,}80
\]

Eine Quelle: `calculateCatalystUpside(catalysts, dcfBase)` wie S15/S17.
Kein dritter Pfad.

`dcfFairValue` in der Analyze-Response war zeitweise 252,37 — das ist **nicht** die S15-Basis 518,86. S0 darf 252,37 nicht als „Das konservative DCF sitzt bei …“ zeigen, wenn S5/S15 518,86 rechnen. Basis = dieselbe `calculateFCFFDCF(buildDefaultDCFParams(data)).perShare` wie S5.

---

## 4. Dateien

| Datei | Änderung |
| --- | --- |
| `client/src/lib/summaryFazit.ts` | **neu** — Listen + Score + Rating + Fazit-Satz |
| `client/src/components/sections/SummarySection.tsx` | FAZIT-IIFE → Aufruf summaryFazit |
| `client/src/components/ExecSummaryCard.tsx` | Ampel-Block + Upside-Zeile + S2-Satz |
| `server/exec-summary.ts` | `upsideLine`, `thesisLine`, `rating` |
| `server/exec-summary-attach.ts` | `expectedDamage` mappen, thesis-Feld, S15-GB-Summe |

Nicht anfassen: DCF-Engine, Analyze-Route-LLM, S15-Tabelle selbst.

---

## 5. Acceptance MSFT

```
[ ] S0-Badge === S17-Badge (NEUTRAL)
[ ] Signal-Score S0 === S17 (7 / 6 / 4)
[ ] S0-Pro nach KI = Azure / LinkedIn / Dynamics (S15), nicht Generic-Labels
[ ] S0-Contra enthält Top-ED aus S8 (Tech Disruption 5.00 % oder Macro 4.20 %)
[ ] S0-Upside-Zeile: GB +36.05 %, Ziel ~705.91, vs Kurs ~+42.9 %
[ ] S0-Technik-Satz enthält Golden Cross wie S17
[ ] S0-Fazit zitiert S2-KI-Satz, kein zweites LLM
[ ] DCF-Zahl in S0-Lage === S5 perShare (nicht 252.37 wenn S5 = 518.86)
```
