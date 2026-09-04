# Executive Summary — vor Sektion 1

Zero-Hülle + **Pflicht Pro/Contra**. Quellen: S8 Invertierung, S11 Porter,
S12 PESTEL, S14/S8 Inverted DCF, S15 Katalysatoren.

Referenz MSFT 4.9.2026 12:49: $510.12 · DCF $518.86 · ΣGB 28.17 % ·
CRV 1.0 · Score 60 · NEUTRAL.

Max. Länge: Kopf + 8 Sätze + Pro-Liste (5) + Contra-Liste (5) + Urteil.
Kein 10-K, keine 10 News, keine WACC-Matrix.

---

## Pflichtkopf (Code, mit/ohne KI)

Kurs $510.12 · $3.79T · Umsatz +17.8 % · WACC 8.99 % · g* 7.27 % ·
P/E 20.7 / Fwd 25.9 / PEG 2.62 · DCF $518.86 (+1.7 %) ·
Risk-Ziel $429.87 (−15.7 %) · CRV 1.0 / RA 0.2 · Max-Entry $375 ·
Score 60 RELATIVE_GROWTH (−20.2 pp) · ΣGB 28.17 · Earnings 28.10. · NEUTRAL.

---

## Pro / Contra — Pflicht, auch ohne KI

Jede Zeile hat `src` und eine Zahl. Ohne Zahl fliegt die Zeile (KI-Modus:
FactPack). Reihenfolge fest: zuerst Code-Zeilen, dann LLM-Satz hinter der Zahl.

### Pro-Quellen (max. 5, Priorität)

1. S15 Top-GB Katalysator (nicht K5 wenn PoS < 40)
2. S15 zweiter GB
3. S11 Moat-Quelle mit Zahl (FCF-Marge / Brutto / Switching)
4. S12 PESTEL-Faktor mit `kurstreiber ≥ 1` oder Exposure Niedrig + positiv
5. S5/S14 wenn Umsatz-g oder Realized-8Q **über** WACC / g*
6. S17 Positiv-Faktor nur wenn Platz

### Contra-Quellen (max. 5, Priorität)

1. S8 höchstes Expected Damage (+ Flag UNTERSCHÄTZT wenn gesetzt)
2. S8 zweites ED **oder** S15 D1 Miss
3. S11 Force mit Bewertung High / Score ≥ 7 (Rivalität)
4. S12 PESTEL Exposure Hoch **oder** `kursrisiko ≥ 1` **oder** `marktNeg ≥ 1`
5. S8/S14 Inverted DCF vs Kurs / vs Analyst-PT (Divergenz > 20 %)
6. S6 CRV / Max-Entry / Gate-Delta

K5 (PoS 35 %, Einpr. 65 %) zählt **Contra**, nicht Pro.

Zoll-Satz nur wenn S12 Politisch `kursrisiko|marktNeg` **oder** Regulatory-Discovery
`tariff` ≠ 0. Non-US-Anteil allein reicht nicht.

---

## PESTEL in der Summary (Pflicht-Block, kompakt)

Keine 6 Essays. Eine Zeile Raster + die Treffer in Pro/Contra.

```
P | Ö | S | T | Öko | R     ← Exposure aus S12
M | M | M | N | M   | H     ← MSFT Ist
```

Dann nur Kategorien mit Hoch **oder** kurstreiber **oder** kursrisiko:

| Kat | MSFT-Ist | Liste |
|-----|----------|-------|
| Rechtlich Hoch | marktNeg 1, kursrisiko 1 | Contra |
| Technologisch Niedrig | kurstreiber 1 | Pro |
| Ökonomisch Mittel | marktNeg 1 | Contra nur wenn Satz eine Zahl hat (WACC/Δi) |
| Politisch Mittel | 0/0/1 | Zoll-Contra **nein** (kein Tariff-Hit) |

---

## Porter in der Summary (Pflicht-Block, kompakt)

```
Moat Wide · Quellen: Brutto 67.9 % · FCF 20.2 % · Switching · Netzwerk
Rivalität High → Contra
Rest Medium → keine Extra-Zeile
```

Rohscore `8/5` nicht zeigen. Nur Label + eine Mechanik.

---

## Inverted-DCF / S8-LLM

Pflicht-Contra, keine optionale Catch:

- Risk-Adj. Ziel = PT × (1 − ED) → $429.87
- Kons. Inverted DCF $183.35 (−65.7 % vs PT) wenn |Gap| > 50 % → eine Zeile
- Höchstes Risiko inkl. LLM-Flag (UNTERSCHÄTZT) — Text aus S8, Zahlen aus EW/Impact/ED
- Growth Adj. 12.1 % vs Base 15.0 % (S8-Kacheln)

---

## Mit vs ohne KI

| Slot | ohne KI | mit KI |
|------|---------|--------|
| Kopf | Code | Code |
| Pro 5 / Contra 5 | Label + Zahl + src | + ein Halbsatz, FactPack |
| PESTEL-Raster | 6 Buchstaben | unverändert |
| Porter-Zeile | Moat + High-Force | + Rivalitäts-Satz |
| Zero 3 Slots | 1 Satz Segmente | 4+5 Sätze |
| Urteil | NEUTRAL | NEUTRAL + warum |

---

## MSFT Soll-Karte

**MSFT · $510.12 · $3.79T · 4.9.2026 12:49 · NEUTRAL · 60 · CRV 1.0 · g* 7.3 % · 28.10.**

Server/Azure $129.4B 39 % +31.5 % · M365 Comm. $102B 31 % +16.2 % ·
USA 51.5 / Non-US 48.5. Umsatz +17.8 % über WACC 8.99 %, Markt g* 7.27 %.

**Porter:** Wide · Brutto 67.9 · FCF 20.2 · Switching/Netzwerk · Rivalität High.
**PESTEL:** P M · Ö M · S M · T N · Öko M · **R H** · Geo 5/10 · kein Zoll-Hit.

### Pro
- K2 Copilot F500 · GB **10.02** · PoS 68 % · Netto 14.74 % · src S15
- K1 Azure-Disclosure · GB **7.65** · PoS 72 % · src S15
- Moat Wide · FCF-Marge **20.2 %** · $66.99B TTM · src S11
- PESTEL Tech Niedrig · kurstreiber · Cloud/AI-Stack · src S12
- Realized 8Q **34.2 %** > WACC 8.99 % · src S14/S17 Gate (Stütze, nicht Kauf)

### Contra
- S8 Disruption ED **5.00 %** · UNTERSCHÄTZT · Impact 25 % (bis 30–35) · FCF 15–17 %
- Porter Rivalität **High** · OpenAI/Gemini/Llama · Preisdruck Copilot/Azure · src S11
- PESTEL Rechtlich **Hoch** · Antitrust EW 15 % · ED **3.00 %** · D3 −20 % · src S12+S8+S15
- Inverted DCF **$183.35** vs PT $535 (−65.7 %) · Risk-Ziel **$429.87** · Kurs $510 · src S8/S14
- CRV RA **0.2:1** · Max-Entry $375 · Gate −20.2 pp vs Peers · PEG 2.62 · K5 Einpr. 65 %

**Urteil NEUTRAL.** DCF +1.7 % ist kein Kauf. Pro sind Cloud-Mix und GB 28 %.
Contra sind Einpreisung (g* 7.3 vs Modell 15), Legal/Rivalität und Ziel $429 unter Kurs.
