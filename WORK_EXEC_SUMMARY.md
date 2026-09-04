# WORK_EXEC_SUMMARY.md

> Status: **Soll** · nicht im Analyze-UI · 04.09.2026
> Karte **über** Sektion 1.

Pro/Contra: S8, S11, S12, S14, S15.
Fazit: S17-Wort + Einpreisung vs. Unterschätzung als Fließtext.
**Earnings Call ist Pflichtnennung** (Datum + Wort „Call“).

---

## Earnings Call — wann, wie nennen

Quelle nur S1-Cache: `nextEarningsDate` / `lastReported`. Kein LLM-Datum.

| Feld | Pflicht | MSFT-Ist 4.9.2026 |
|------|---------|-------------------|
| Nächster Call | ja, Absatz 3 + Kopf | **Earnings Call am 28. Oktober 2026** |
| Letztes berichtetes Quartal | ja, ein Halbsatz wenn vorhanden | zuletzt Q4 FY2026 |
| Uhrzeit / Ticker-Zeit | nur wenn im Cache | sonst weglassen, nicht 16:00 raten |
| Kein Datum | Satz: „Ein Call-Termin steht im Cache nicht.“ | nie „demnächst“ |

Formulierung fest, damit es nicht als beliebiges Event untergeht:

```
Der nächste Earnings Call ist am {TT. Monat JJJJ}.
```

Nicht: „28.10.“, „Zahlentermin“, „Prüfpunkt“ allein. Das Wort **Earnings Call**
muss im Fazit stehen. Im Kopf darf die Kurzform `Call 28.10.2026` stehen.

Abstand heute → Call (MSFT: 4.9. → 28.10. = 54 Tage) darf als Kontext rein
(„in gut sieben Wochen“), ersetzt aber nicht das Kalenderdatum.

---

## Pflichtkopf

$510.12 · $3.79T · +17.8 % · WACC 8.99 % · g* 7.3 % · P/E 20.7 ·
PEG 2.62 · DCF $519 · Risk $430 · CRV 1.0 · Score 60 · **Call 28.10.2026**.

---

## Fazit — drei Absätze

1. Lage + was schon im Kurs steckt.
2. Was zu klein gerechnet ist (eine Zielzahl).
3. Handlung + **Earnings Call am {Datum}** als eigener Satz.

---

## Template ohne KI

```
{Name} ist {S17-Wort}: das konservative DCF liegt praktisch am Kurs, der Markt
preist aber nur {g*} Wachstum ein — unser Modell unterstellt mehr.

Was fehlt, ist der Risikoabschlag. {S8-Risiko in einem Halbsatz} wird zu klein
gerechnet; mit Abschlag eher {Risk-Ziel} als der heutige Kurs.

Deshalb nicht nachkaufen. Einstieg erst unter {Max-Entry}.
Der nächste Earnings Call ist am {TT. Monat JJJJ} (zuletzt berichtet: {Quartal}).
```

---

## MSFT — Soll-Fazit

Microsoft ist **neutral**. Das konservative DCF sitzt fast auf dem Kurs — knapp
519 gegen 510 Dollar. Der Markt glaubt nur gut 7 % Dauerwachstum, nicht die 15 %
des Fast-Grower-Modells. Azure und Copilot sind keine unentdeckte Story; das
Analystenziel von 535 Dollar liegt nur knapp 5 % über dem Kurs.

Was nicht im Preis steckt, ist der Abschlag fürs Wettbewerbs- und Margenrisiko.
Druck durch OpenAI, Gemini und offene Modelle wird zu klein gerechnet — die
FCF-Marge könnte Richtung 15 bis 17 % gehen. Dann eher knapp 430 Dollar als 510.

Deshalb warten. Nachkaufen erst unter 375 Dollar. Der nächste **Earnings Call
ist am 28. Oktober 2026**; zuletzt gemeldet wurde Q4 FY2026.

---

## DoD

1. Fazit-Absatz 3 enthält wörtlich „Earnings Call“ + volles Datum.
2. Kopf enthält `Call {TT.MM.JJJJ}`.
3. Fehlt das Feld → Satz „steht im Cache nicht“, kein erfundenes Datum.
4. S17-Wort einmal. FactPack an Zahlen.
