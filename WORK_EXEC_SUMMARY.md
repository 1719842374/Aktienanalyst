# WORK_EXEC_SUMMARY.md

> Soll · Builder [`server/exec-summary.ts`](./server/exec-summary.ts) · generisch

Fazit = Lage + Bruch + Handlung + **CRV-Satz** + **PoS-Satz** + **Call** + **Cross nur wenn im Cache**.

---

## Pflicht am Textende (Absatz 3–4)

### CRV 3:1

```
crv3ok ⇔ price ≤ maxEntryCrv3
```

Erfüllt: „Chance zu Risiko 3 zu 1 ist am Kurs erfüllt.“
Nicht: „3 zu 1 ist am Kurs nicht erfüllt (jetzt {crvBase}:1, risikoadjustiert {crvRA}:1). Dafür erst unter {maxEntry}.“

MSFT-Ist: 1.0 bzw. 0.2 — **nicht** erfüllt, Schwelle 375.

### Finale Erfolgswahrscheinlichkeit (aus S15/S2, nicht neu schätzen)

Nur Katalysatoren mit GB und PoS, Top 3 nach GB, PoS ≥ 40.

\[
P_{\mathrm{alle}} = \prod_i p_i,\qquad
P_{\mathrm{bind}} = \min_i p_i
\]

Unabhängigkeit ist eine Rechenannahme, steht als Halbsatz dabei.

MSFT: 0.72 × 0.68 × 0.65 = **0.318**. Bindend K2 Copilot **68 %**.

Satz: „Azure-Disclosure, Copilot Fortune 500 und Dynamics-Bündel stehen bei 72, 68 und 65 Prozent. Dass alle drei kommen, sind unter Unabhängigkeit knapp 32 Prozent. Der bindende Fall ist Copilot mit 68 Prozent — genau das Hauptrisiko aus der These.“

### Golden / Death Cross (S9, nur wenn Status da)

| Cache | Satz |
|-------|------|
| `ma50AboveMA200 === false` | „Im Chart liegt ein Death Cross (50-Tage unter 200-Tage) — Bärenlage, die Bewertung ist kein Timing.“ |
| `ma50AboveMA200 && priceAboveMA200` | „50-Tage über 200-Tage (Golden-Cross-Lage), Kurs über der 200-Tage.“ |
| Feld fehlt | Satz weglassen, kein Cross erfinden |

Kein MACD-Essay. Ein Satz.

### Call

Unverändert: „Der nächste Earnings Call ist am {Datum}.“

---

## MSFT Soll-Fazit (menschlich, vollständig)

Microsoft ist **neutral**. Das konservative DCF sitzt fast auf dem Kurs — knapp 519 gegen 510 Dollar. Der Markt glaubt nur gut 7 % Dauerwachstum, nicht die 15 % des Fast-Grower-Modells. Azure und Copilot sind keine unentdeckte Story; das Analystenziel von 535 Dollar liegt nur knapp 5 % über dem Kurs.

Was nicht im Preis steckt, ist der Abschlag fürs Wettbewerbs- und Margenrisiko. Druck durch offene Modelle wird zu klein gerechnet — die FCF-Marge könnte Richtung 15 bis 17 % gehen. Dann eher knapp 430 Dollar als 510.

Die drei Kernkatalysatoren (Azure-Disclosure, Copilot in den Fortune 500, Dynamics-Bündel) stehen bei 72, 68 und 65 Prozent Eintritt. Dass alle drei kommen, sind unter Unabhängigkeit knapp 32 Prozent. Bindend ist Copilot mit 68 Prozent — genau der Punkt, an dem die These kippt.

Chance zu Risiko 3 zu 1 ist am Kurs **nicht** erfüllt (1 zu 1, risikoadjustiert 0,2 zu 1). Nachkaufen erst unter 375 Dollar. {Falls Death Cross im Cache: einen Satz Bärenlage.} Der nächste Earnings Call ist am 28. Oktober 2026.

---

## DoD

1. CRV-3:1-Satz immer, mit erfüllt/nicht erfüllt.
2. P_alle und P_bind aus denselben PoS wie S2/S15.
3. Cross nur aus `technicalIndicators.currentStatus`.
4. Kein zweites Rating neben S17.
