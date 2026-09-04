# Executive Summary — vor Sektion 1

Zero-Hülle, eure Zahlen. Kein 19. Essay. Max. 18–22 Sätze + eine Kennzahlenzeile.

Referenz-Ist (MSFT, Live 4.9.2026 12:49): Kurs $510.12, MCap $3.79T, DCF $518.86,
GB Σ 28.17 %, CRV 1.0:1, Score 60/100 (Gate RELATIVE_GROWTH), Fazit NEUTRAL.

---

## Was nie in die Summary darf

- 10-K-Beschreibung (S2 Company Description)
- 10 News-Zeilen
- WACC-3er-Tabelle, FCFF-10Y, Sensitivity-Matrix
- TAM-9-Zeilen, Peer-12-Spalten
- Monte-Carlo-Histogramm
- Porter 5/5-Scores roh (`8/5`)
- PESTEL alle 6 Kategorien, wenn Exposure nicht materiell
- Management-5-Bausteine komplett
- Thesis-A–E-Balken

Die 18 Sektionen bleiben der Drill-Down. Summary = Filter.

---

## Pflicht — ohne KI (nur Cache/Code)

| Slot | Quelle | MSFT-Ist |
|------|--------|----------|
| Kopf | S1 | MSFT · $510.12 · +Stand 4.9.2026 12:49 |
| Mechanik 1 Satz | S2 Segmente, nicht Description | Server $129.4B / 39 % / +31.5 %; M365 Comm. $102B / 31 % |
| g vs WACC | S2 IS + S4/S5 | Umsatz +17.8 % · WACC 8.99 % · g* 7.27 % |
| Bewertung 1 Zeile | S1+S4+S5 | P/E 20.7 · Fwd 25.9 · PEG 2.62 · DCF $518.86 vs Kurs $510.12 (+1.7 %) |
| Risiko-Ziel | S8 | PT $535 × (1−19.6 %) = $429.87 (−15.7 % vs Kurs) |
| CRV + Gate | S6+S17 | CRV 1.0:1 · RA 0.2:1 · Max-Entry $375 · Score 60 (RELATIVE_GROWTH) |
| FCF | S1 | Yield 1.8 % · Marge 20.2 % (−5.2 pp) |
| Event | S1 | Earnings 28.10.2026 |
| Fazit-Wort | S17 | NEUTRAL |

Ohne KI **keine** Prosa-Katalysatoren, **kein** PESTEL-Satz, **kein** Porter-Satz.
K1–K5 stehen als **eine** Zeile Zahlen: `K2 GB 10.02 | ΣGB 28.17 | Kat-Ziel $665`.

---

## Pflicht — mit KI (Schablone + FactPack)

Zusätzlich zu oben, feste Überschriften, LLM füllt nur Klammern aus FACTS:

```
## Das Unternehmen        (4 Sätze, Segmente + Pivot)
## Business-Modell        (5 Sätze, Zahlungsfluss + 2 Bremsen)
## Treiber 12–24M         (max. 4 Bullets = Top-K nach GB)
## Quartal / Event        (1 Satz Beat nur wenn Pack Quartalszahl hat)
## Einpreisung            (g* vs g1 vs Umsatz vs WACC)
## Gegenargument          (höchstes ED aus S8 + UNTERSCHÄTZT-Flag)
## Catch                  (nur wenn materiell, siehe § Catch)
## Urteil                 (S17-Wort + ein Satz warum)
```

Jede Zahl im Fließtext → `validateTextAgainstFactPack`. Satz ohne Treffer fliegt.

### MSFT ausgefüllt (Soll-Text, nicht der 10-K-Dump)

**Das Unternehmen.** Microsoft verdient den Großteil in Intelligent Cloud / Server
($129.4B, 39 %, +31.5 %) und Microsoft 365 Commercial ($102.0B, 31 %, +16.2 %).
USA 51.5 %, Non-US 48.5 %. Xbox/Windows sind Restgröße, nicht der Pivot.
Offene Baustelle: FCF-Marge 20.2 % bei CapEx $115.9B und Yield nur 1.8 %.

**Business-Modell.** Kunde zahlt Cloud-Verbrauch + Sitzlizenz (M365/Dynamics) +
Werbung/Search. Wiederkehrend über Commercial + Azure; Hardware/Xbox zyklisch.
Bremse 1: AI-Trainingskosten und CapEx (K5 Einpr. 65 %).
Bremse 2: Copilot-Adoption unsicher (K2 ist größter GB).

**Treiber.** K2 Copilot F500 · PoS 68 % · Netto 14.74 % · GB 10.02.
K1 Azure-Disclosure · 72 % · 10.62 % · GB 7.65.
K3 Dynamics+LinkedIn · 65 % · 8.64 % · GB 5.62.
ΣGB 28.17 % → Kat-Ziel $665 auf DCF $518.86 — **nicht** als fairen Einstieg lesen.

**Einpreisung.** Umsatz +17.8 % liegt über WACC 8.99 %. Markt preist g* = 7.27 %.
Modell-g1 Fast-Grower 15 % klafft gegen g*. PEG 2.62. Upside im Kurs zum Teil drin.

**Gegenargument (Invertierung).** S8 Tech Disruption ED 5.00 %, Flag UNTERSCHÄTZT:
Impact bis 30–35 % möglich, FCF-Marge 15–17 %. Risk-Adj. Ziel $429.87 unter Kurs.
CRV gehärtet 1.0:1, RA 0.2:1. Max-Entry $375 — Kurs darüber.

**Urteil.** NEUTRAL. DCF +1.7 % ist kein Kauf. Gate 60 wegen Relativwachstum −20.2 pp vs Peers.

---

## Catch-Regeln (PESTEL / Porter / Zölle)

Ein Satz **nur** wenn mindestens eine Bedingung gilt. Sonst Slot weglassen.

| Trigger | Bedingung im Cache | MSFT 4.9.2026 |
|---------|--------------------|---------------|
| Porter | Rivalität = High **oder** Score ≥ 7 | Rivalität High → 1 Satz AI-Preisdruck |
| PESTEL Legal | Exposure = Hoch | Ja → Antitrust S8 EW 15 % / ED 3.00 % |
| PESTEL Politisch | Exposure ≥ Mittel **und** Tariff-Discovery hit | MSFT Political nur Mittel, 0 Markt-Neg. → **kein Zoll-Satz** |
| Zölle / Handelskrieg | Regulatory-KI `tariff` EPS-Impact ≠ 0 auf Top-Geo | Non-US 48.5 % allein reicht **nicht** |
| Geldpolitik | S13 Fed-Korrelation ≠ schwach **oder** Δi 90T materiell | Fed Funds Neutral/Schwach → kein Extra-Satz (WACC steht schon unter Einpreisung) |
| Fiskal / Gov | `govExposure` ≥ 20 % oder K-Gov GB ≥ 3 | Gov 5 % + K4 GB 3.90 → optional Halbsatz, kein PESTEL-Block |

Falsch: „PESTEL Neutral, 6 Kategorien.“ Das ist Zero-Gegenteil.
Richtig: ein Catch oder keiner.

---

## Scoring — was in die Summary muss

Nicht die 96.8 roh, nicht A–E.

| Feld | Rein? |
|------|-------|
| Cap-Score + Gate-Name | ja (60 · RELATIVE_GROWTH) |
| Aktives Gate-Delta | ja, eine Zahl (−20.2 pp vs Peers) |
| Quality×Trend roh | nein |
| Thesis 7.4 / 10 | ja, eine Zeile, separat vom Gate |
| Klassifikations-Konfidenz 45 % | nein (zu weich für Summary) |
| Management 5.9 | nein (S18) |
| Inventory +48.9 % | nur wenn INVENTORY-Gate aktiv und Cap bindet |

---

## Katalysatoren — Zero-Art, eure Formel

Zero: Kurz/Lang ohne PoS.
Ihr: Top-3 nach **GB**, plus Pflicht-Downside aus S15 D1–D3.

```
Kurz: K1 6–12M (Azure-Zahl sichtbar), D1 Next Quarter Miss −15 %
Lang: K2/K3 12–24M, D3 Antitrust 12–24M −20 %
```

LLM schreibt Namen + einen Belegsatz. PoS/GB bleiben Code.
K5 (Cost Inflation, PoS 35 %) ist Downside im Upside-Kleid — in der Summary unter Gegenargument, nicht unter Treiber.

---

## Mit vs ohne KI — eine Box

```
| Slot           | ohne KI                         | mit KI                              |
|----------------|---------------------------------|-------------------------------------|
| Kopf+Kennzahl  | Code                            | Code                                |
| 3 Zero-Slots   | 1 Satz Segmente                 | 4+5+Bullets, FactPack               |
| g vs WACC      | eine Zeile                      | dieselbe + Satz Einpreisung         |
| K-Tabelle      | Top3 GB Zahlen                  | + Kontextsatz, Zahlen ungeändert    |
| Invertierung   | ED-Summe + $429.87              | + UNTERSCHÄTZT-Absatz aus S8        |
| Catch          | aus                    | 0–1 Satz wenn Trigger              |
| Urteil         | S17-Wort                        | S17-Wort + ein Satz                 |
```

KI aus → Summary bleibt vollständig handelbar. KI an → lesbarer, keine neue Zahl.

---

## UI

Eine Karte **über** Sektion 1, Default offen. Tabs nicht nachbauen.
Rechts: Mini-Zeile `NEUTRAL · 60 · CRV 1.0 · g* 7.3% · Earnings 28.10.`
„Mehr“ scrollt zu S2 / S8 / S15 / S17.
