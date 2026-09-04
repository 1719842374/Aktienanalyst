# WORK_EXEC_SUMMARY.md

> Status: **Soll** · nicht im Analyze-UI · 04.09.2026
> Hub: [docs/Doc_Soll_vs_Ist/WORK_EXEC_SUMMARY.md](./docs/Doc_Soll_vs_Ist/WORK_EXEC_SUMMARY.md)
> Karte **über** Sektion 1.

Quellen Pro/Contra: S8 Invertierung, S11 Porter, S12 PESTEL, S14 Reverse-DCF, S15 Katalysatoren.
Fazit-Logik: **dieselbe** wie S17 (Wort + Positiv/Negativ-Zählung), plus explizit
**eingepreist / nicht eingepreist / unterschätzt**.

Referenz MSFT 4.9.2026 12:49: $510.12 · DCF $518.86 · ΣGB 28.17 % ·
CRV 1.0 · Score 60 · S17 = NEUTRAL.

---

## Pflichtkopf (Code)

Kurs $510.12 · $3.79T · Umsatz +17.8 % · WACC 8.99 % · g* 7.27 % ·
P/E 20.7 / Fwd 25.9 / PEG 2.62 · DCF $518.86 (+1.7 %) ·
Risk-Ziel $429.87 (−15.7 %) · CRV 1.0 / RA 0.2 · Max-Entry $375 ·
Score 60 RELATIVE_GROWTH (−20.2 pp) · ΣGB 28.17 · Earnings 28.10.

---

## Pro / Contra (max. 5, Zahl + src Pflicht)

**Pro-Priorität:** S15 Top-GB → S15 #2 → S11 Moat-Zahl → S12 Kurstreiber → 8Q/g > WACC.
**Contra-Priorität:** S8 max ED (+ Flag UNTERSCHÄTZT) → D1 oder ED#2 → Porter High → PESTEL Hoch → Inverted-DCF-Gap.

K5 mit PoS < 40 oder Einpr. ≥ 60 zählt Contra.
Zoll nur bei Tariff-Hit, nicht wegen Non-US-Anteil.

**PESTEL-Raster Pflicht:** P M · Ö M · S M · T N · Öko M · R H (MSFT-Ist).
**Porter Pflicht:** Moat Wide · Rivalität High · Rest nicht extra.

---

## Fazit-Text — Pflicht, analog S17

Das Wort allein (`NEUTRAL`) reicht nicht. Vier Sätze, Reihenfolge fest.
Zahlen nur aus Cache. LLM darf die Klammern füllen, nicht die Schwellen ändern.

### Schablone (Code baut den Satz, KI schmückt max. 1 Halbsatz)

```
FAZIT {S17-Wort}.
EINGEPREIST: {Liste A}.
NICHT EINGEPREIST / UNTERSCHÄTZT: {Liste B}.
HANDLUNG: {Regel C} · nächster Event {Earnings-Datum}.
```

### Liste A — eingepreist (wenn Bedingung wahr)

| Bedingung | MSFT-Ist | Satzteil |
|-----------|----------|----------|
| \|g* − g1\| ≥ 3 pp **und** g* < g1 | 7.27 vs 15.0 = −7.7 pp | Modell-Wachstum 15 % nicht im Kurs; Markt preist g* 7.3 % |
| PEG ≥ 2 **oder** Lynch „schon eingepreist“ | PEG 2.62 Fast Grower | PEG 2.62 |
| Katalysator Einpr. ≥ 50 % | K4 52 %, K5 65 % | K4/K5 weitgehend im Kurs |
| Analyst-PT-Upside ≤ 8 % | +4.9 % | PT $535 nur +4.9 % |
| DCF vs Kurs \|Gap\| ≤ 5 % | +1.7 % | Kons.-DCF ≈ Kurs |
| S17-Hinweis „Katalysatoren stark eingepreist“ | ja (S8 Kasten) | ΣGB 28 % ist Modell-Upside, kein freier Hebel |

### Liste B — nicht eingepreist / unterschätzt (wenn wahr)

| Bedingung | MSFT-Ist | Satzteil |
|-----------|----------|----------|
| S8 Flag `UNTERSCHÄTZT` | Disruption ED 5 %, Impact bis 30–35 | Disruption unterschätzt |
| Risk-Adj. Ziel < Kurs − 5 % | $429.87 vs $510.12 = −15.7 % | Risikoabschlag nicht im Kurs |
| Inverted DCF vs PT Gap > 50 % | $183 vs $535 = −65.7 % | Inverted DCF $183 |
| CRV RA < 1 | 0.2:1 | CRV RA 0.2 |
| Gate bindet | RELATIVE_GROWTH −20.2 pp | Wachstum hinter Peers nicht als Qualität lesbar |
| S15 D1/D3 noch ohne hohen Einpr. | D1 Miss −15 %, D3 −20 % | Miss/Antitrust nicht wie K2 eingepreist |
| Porter High + PESTEL Legal Hoch | beides | Rivalität/Legal unterbewertet gegenüber Moat-Wide-Narrativ |

Liste A und B je **max. 3** Treffer, höchste Priorität oben.
Widerspruch ist erlaubt und gewollt (eingepreist **und** unterschätzt gleichzeitig).

### Regel C — Handlung (kein drittes Urteilwort)

```
WENN S17 ∈ {VERKAUFEN, MEIDEN}            → „nicht aufstocken“
WENN Kurs > Max-Entry (CRV 3:1)            → „Abwarten, Einstieg erst ≤ $375“
WENN Risk-Ziel < Kurs UND S17 = NEUTRAL    → „Abwarten bis Earnings / besserem CRV“
WENN S17 ∈ {KAUFEN} UND CRV RA ≥ 2         → „Staffel unter DCF, Stop = WC“
SONST                                      → S17-Wort + Earnings-Datum
```

MSFT trifft Zeile 3: Neutral + Risk-Ziel unter Kurs + Kurs über Max-Entry
→ Handlung = Abwarten, nicht Staffelkauf.

Ohne KI: die vier Sätze rein aus Tabellen (Template-Fill).
Mit KI: ein Halbsatz pro Liste, FactPack an jeder Zahl. Kein neues Wort neben S17.

---

## MSFT Soll-Karte (inkl. Fazit)

**MSFT · $510.12 · $3.79T · 4.9.2026 12:49 · 60 · CRV 1.0 · g* 7.3 % · 28.10.**

Server/Azure $129.4B 39 % +31.5 % · M365 $102B 31 %. Umsatz +17.8 % über WACC 8.99 %.
**Porter:** Wide · FCF 20.2 · Rivalität High. **PESTEL:** R Hoch · T Niedrig · kein Zoll.

**Pro:** K2 GB 10.02 · K1 GB 7.65 · FCF 20.2 % · Tech-Kurstreiber · 8Q 34.2 % > WACC.
**Contra:** Disruption ED 5 % UNTERSCHÄTZT · Rivalität High · Legal/Antitrust ED 3 % ·
Inverted $183 vs PT $535 · CRV RA 0.2 / Max-Entry $375 / PEG 2.62.

**Fazit NEUTRAL.**
EINGEPREIST: Kons.-DCF $518.86 liegt +1.7 % am Kurs; Markt g* 7.27 % statt Modell 15 %;
PEG 2.62; PT nur +4.9 %; K4/K5 Einpr. 52/65 % — ΣGB 28 % ist kein freier Hebel.
NICHT EINGEPREIST / UNTERSCHÄTZT: S8 Disruption (Flag UNTERSCHÄTZT, Impact bis 30–35 %,
FCF 15–17 %); Risk-Ziel $429.87 (−15.7 % vs Kurs); Inverted DCF $183 (−65.7 % vs PT);
Miss/Antitrust (D1/D3); Relativwachstum −20.2 pp steckt im Gate 60, nicht im Multiple.
HANDLUNG: Abwarten. Kein Aufstocken über Max-Entry $375. Nächster Event Earnings 28.10.2026.

---

## DoD

1. Karte über S1.
2. Fazit immer 4 Sätze: Wort · eingepreist · unterschätzt · Handlung.
3. S17-Wort unverändert; Summary erfindet kein zweites Rating.
4. Liste A/B nur aus den Tabellen, max. 3 Treffer.
5. `UNTERSCHÄTZT` aus S8-Flag, nicht aus LLM-Stimmung.
6. FactPack auf Zahlen im Fazit-Fließtext.
