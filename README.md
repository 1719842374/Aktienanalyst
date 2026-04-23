# Stock Analyst Pro

**Umfassende Finanzanalyse-Plattform — Aktien (17 Sektionen), Bitcoin-Bewertung (12 Sektionen), Gold-Analyse und Rezessions-Dashboard.**

> Objektiv · Transparent · Konservativ · Alle Rechenwege ausgewiesen

[![Live Demo](https://img.shields.io/badge/Live-Demo-blue?style=for-the-badge)](https://www.perplexity.ai/computer/a/stock-analyst-pro-H8US06otSA6hhTHNj22ShQ)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?style=for-the-badge&logo=github)](https://github.com/1719842374/Aktienanalyst)

---

## Überblick

Stock Analyst Pro vereint vier spezialisierte Analyse-Dashboards in einer Anwendung:

| Dashboard | Route | Beschreibung |
|-----------|-------|-------------|
| **Aktien-Analyse** | `/#/` | 17-Sektionen-Analyse für jede Aktie weltweit (DCF, Monte Carlo, Tech. Analyse) |
| **BTC-Analyse** | `/#/btc` | 12-Sektionen Bitcoin-Bewertung mit Power-Law, Halving-Zyklus, 7 Indikatoren |
| **Gold-Analyse** | `/#/gold` | Fair-Value-Modell, Realzinsen, Zentralbankkäufe |
| **Rezessions-Dashboard** | `/#/recession` | 17 makroökonomische Indikatoren mit Wahrscheinlichkeits-Scoring |

---

## Aktien-Analyse (17 Sektionen)

Erstellt für **jede Aktie weltweit** (US, Europa, Asien) eine objektive, konservative Bewertung.

**Kernprinzipien:**
- Alle Rechenwege transparent — jede Berechnung nachvollziehbar
- Anti-Bias-Protokoll — kein selektiver Upside ohne symmetrischen Downside
- Generisch für jede Aktie — automatische Währungsumrechnung
- Echtzeit-Daten — Kurse, Fundamentaldaten, Analystenschätzungen via Finance API

### Die 17 Sektionen

| Nr | Sektion | Beschreibung |
|----|---------|-------------|
| 1 | **Datenaktualität & Plausibilität** | Live-Kurs, Market Cap, P/E, EV/EBITDA, Analyst Ratings |
| 2 | **Investmentthese & Katalysatoren** | Peter Lynch Klassifikation, Revenue-Segmente, Katalysatoren-Tabelle |
| 3 | **Zyklus- & Strukturanalyse** | Konjunkturzyklus, Makro-Sensitivität, Geopolitische Risiken |
| 4 | **Bewertungskennzahlen** | WACC-Szenarien (Damodaran), CAPM, PEG-Ratio |
| 5 | **DCF-Modell (FCFF)** | Vollständiger FCFF-DCF mit editierbaren Parametern, 3 Szenarien |
| 6 | **Risikoadjustiertes CRV** | Worst Case (3 Methoden), Base + Risk-Adjusted CRV |
| 7 | **Relative Bewertung** | Forward P/E, EV/EBITDA, PEG vs. Sektor |
| 8 | **Risikoinversion** | Top-Risiken nach Expected Damage, invertierter DCF |
| 9 | **RSL-Momentum** | Levy Relative Strength (26-Wochen) |
| 10 | **Technische Analyse** | Interaktiver 5Y-Chart mit MA200/MA50/MACD, Golden/Death Cross |
| 11 | **Moat & Porter's Five Forces** | Moat-Rating, Porter-Scoring |
| 12 | **PESTEL-Analyse** | 6 Makro-Kategorien, Exposure-Matrix |
| 13 | **Makro-Korrelationen** | 20+ Korrelationen (Indizes, Rohstoffe, Währungen, Crypto) |
| 14 | **Reverse DCF** | Implizierte Wachstumsrate g*, Plausibilitätscheck |
| 15 | **Katalysatoren (Anti-Bias)** | Catalyst-Adj. Target, Downside-Katalysatoren |
| 16 | **Monte Carlo Simulation** | GBM mit 10.000 Iterationen, Percentil-Verteilung |
| 17 | **Zusammenfassung & Fazit** | Gesamtbewertung, Signal-Score, dynamischer Fazit-Satz |

---

## Methodik & Formeln

### DCF-Methodik (FCFF-basiert)

Der DCF-Ansatz bewertet Unternehmen auf Basis der abgezinsten Free Cash Flows to the Firm über 10 Jahre plus Terminal Value. **FCFF** (statt FCFE) wird gewählt, weil er unabhängig von der Kapitalstruktur ist.

#### Free Cash Flow to the Firm

```
FCFF = EBIT × (1 - Tax) + D&A - Capex - ΔWC
```

**Komponenten:**
- **EBIT** (Earnings Before Interest and Tax) — nicht EBITDA. Spiegelt echte operative Profitabilität wider
- **Tax** — effektive Steuerrate (Default: 21% US, 30% DE, 22% DK)
- **D&A** — Depreciation & Amortization (wird wieder hinzugefügt, da nicht-cash)
- **Capex** — Capital Expenditures (Investitionen in Sachanlagen)
- **ΔWC** — Veränderung Working Capital (Forderungen, Vorräte minus Verbindlichkeiten)

#### 10-Jahres-Projektion + Terminal Value

```
PV(FCFF) = Σₜ₌₁¹⁰ FCFFₜ / (1 + WACC)^t

Terminal Value (Gordon Growth Model):
TV = FCFF₁₁ / (WACC - g)

Enterprise Value (EV):
EV = PV(FCFF₁₋₁₀) + PV(TV)

Equity Value:
Equity = EV - Net Debt - Minority Interests
Fair Value / Aktie = Equity / Shares Outstanding
```

**Wachstumsstufen (Fading Growth):**
- Jahr 1-3: Analysten-Consensus-Growth (oder historischer 5Y-CAGR)
- Jahr 4-7: Lineares Fading auf nachhaltiges Wachstum
- Jahr 8-10: Nachhaltiges Wachstum (sektor-spezifisch: 2-4%)
- Terminal Growth **g**: max(GDP-Wachstum, 2.5%), hart gecapped bei 4%

#### DCF-Szenarien (3 Varianten)

| Szenario | WACC | Growth-Annahme | Anwendung |
|----------|------|---------------|-----------|
| **Konservativ** | WACC + 0.5-1.5pp | Growth × 0.7 | Untergrenze — "Was wenn alles schiefgeht?" |
| **Base Case** | WACC (Damodaran) | Analysten-Consensus | Realistische Mitte |
| **Optimistisch** | WACC - 0.5-1.5pp | Growth × 1.2 | Obergrenze — Bull Case |

### WACC-Formeln (CAPM + Sektor-Profil)

#### Weighted Average Cost of Capital

```
WACC = (E/V) × Re + (D/V) × Rd × (1 - t)
```

**Wo:**
- **E/V** — Equity / Enterprise Value (gecapped bei 40%-100%)
- **D/V** — Debt / Enterprise Value (gecapped bei 0%-60%)
- **Re** — Cost of Equity (via CAPM)
- **Rd** — Cost of Debt (Risk-free + Credit Spread)
- **t** — Steuerrate

#### Cost of Equity (CAPM)

```
Re = Rf + β × ERP
```

**Parameter:**
- **Rf** (Risk-Free Rate): 10Y US-Treasury Yield (aktuell ~4.2-4.7%)
- **β** (Beta): 5Y-Beta aus Kursverlauf vs. S&P 500
- **ERP** (Equity Risk Premium): Damodaran Implied Equity Risk Premium (aktuell ~5.5%)

#### Cost of Debt

```
Rd = Rf + Credit Spread
Credit Spread basiert auf Bonität:
  AAA/AA: +0.5-1.0%
  A:      +1.0-1.5%
  BBB:    +1.5-2.5%
  BB/B:   +3.0-6.0%
  CCC:    +8.0%+
```

#### WACC-Sensitivität zu Zinsveränderungen

| Zinsänderung | WACC-Impact | DCF-Impact |
|-------------|-------------|------------|
| -100bp | -0.5 bis -1.0% | +8% bis +15% |
| +100bp | +0.5 bis +1.0% | -8% bis -15% |

#### Sektor-Profile (Damodaran NYU Stern)

Jeder Sektor hat charakteristische WACC-Niveaus:

| Sektor | WACC-Range | Beta | D/V Typisch |
|--------|-----------|------|-------------|
| Technology | 8-12% | 1.2-1.8 | 0-20% |
| Healthcare (Pharma) | 7-10% | 0.7-1.1 | 15-40% |
| Financials | 9-13% | 1.1-1.5 | 50-80% |
| Energy | 8-12% | 1.0-1.5 | 30-50% |
| Consumer Defensive | 6-9% | 0.5-0.9 | 30-50% |
| Utilities | 5-8% | 0.4-0.7 | 50-70% |

**Datenquelle:** [Damodaran Online](http://pages.stern.nyu.edu/~adamodar/) — NYU Stern

### Anti-Bias-Protokoll

Das Kernprinzip: **Kein selektiver Upside ohne symmetrischen Downside.** Für jede positive These muss eine gleichwertige negative These formuliert werden.

#### 1. Symmetrie-Pflicht bei Katalysatoren

```
Für jeden Upside-Katalysator muss ein Downside-Risiko existieren:
  K1 (+18% Revenue Beat) ↔ D1 (-15% Earnings Miss)
  K2 (+10% Margin Expansion) ↔ D2 (-12% Kostendruck)
  K3 (+8% Pipeline Approval) ↔ D3 (-20% Pipeline Failure)
```

#### 2. PoS-Herleitung mit Sicherheitsmarge

```
PoS (Probability of Success) = Historische Basis - 10-15% Sicherheitsmarge

Beispiel Revenue Growth Acceleration:
  Historische Basis: 60% der Unternehmen erreichen
  Sicherheitsmarge: -15%
  → PoS = 45%
```

#### 3. Einpreisungsgrad (Skepsis gegenüber Konsens)

```
Einpreisungsgrad via Konsens oder Reverse DCF geschätzt:
  Hoch eingepreist (>50%): Netto-Upside = Brutto × 0.4
  Moderat eingepreist (25-50%): Netto-Upside = Brutto × 0.6
  Niedrig eingepreist (<25%): Netto-Upside = Brutto × 0.8
```

#### 4. Gewichteter Beitrag (GB)

```
GB = PoS × Netto-Upside

Catalyst-Adjusted Fair Value = Kons. DCF × (1 + Σ GB)
```

#### 5. Automatische Risiko-Einpreisung

Jede Aktie erhält standardmäßig 5 Downside-Katalysatoren:

| Risiko | EW | Impact | Expected Damage |
|--------|-----|--------|----------------|
| Macro Recession / Demand Shock | 20% | 16-22% | 3.2-4.4% |
| Earnings Miss / Guidance Cut | 25% | 15% | 3.75% |
| Multiple Compression (Rising Rates) | 30% | 11-14% | 3.3-4.2% |
| Drug Pricing / Patent Cliff (Pharma) | 25% | 20% | 5.0% |
| Government Policy Dependency | 30% | 13-18% | 3.9-5.4% |

```
Total Expected Damage = Σ (EW × Impact)
Risk-Adjusted Fair Value = Fair Value × (1 - Total Expected Damage)
```

#### 6. Inverter DCF (Risikoadjustierter DCF)

```
Bei WACC_adj > WACC_base:
  WACC_adj = WACC + (Total Expected Damage / 2)
  Growth_adj = Growth × (1 - Total Expected Damage)

→ Inverted DCF = Fair Value mit adjustierten Parametern
```

Wenn **Inverted DCF < aktueller Kurs**, triggert die automatische Anti-Bias-Warnung.

### Risiko-Adjusted CRV (Chance-Risiko-Verhältnis)

```
CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)
```

#### Worst Case (3-Methoden-Minimum)

```
M1: Kurs × (1 - min(90%, β × 50%))      // Beta-basiert
M2: Kurs × (1 - 35%)                     // Sektor-Drawdown
M3: Kurs × (1 - Historischer Max-DD)     // Historischer Worst Case

Worst Case = min(M1, M2, M3)              // Konservativste Schätzung
```

#### CRV-Bewertungs-Schwellen

| CRV | Bewertung | Handlungsempfehlung |
|-----|-----------|---------------------|
| > 3.0:1 | Sehr Attraktiv | Starker Kauf möglich |
| 2.0-3.0:1 | Akzeptabel | Kauf bei Bestätigung |
| 1.0-2.0:1 | Grenzwertig | Abwarten / Teil-Position |
| < 1.0:1 | Unfavorable | **Nicht kaufen** — Kurs zu nah am Worst Case |

#### Max-Entry-Preis bei CRV 3:1

```
Max-Entry = (Fair Value + 3 × Worst Case) / 4
```

Das ist der höchste Kurs, bei dem noch ein CRV von 3:1 erreichbar ist.

### Weitere Formeln

```
Monte Carlo (GBM):
  S(t+Δt) = S(t) · exp((μ - σ²/2) · Δt + σ · √Δt · Z)
  μ = Drift (historischer Mean Return)
  σ = Volatilität (Standard Deviation der Log-Returns)
  Z ~ N(0,1) Normal-Random
  10.000 Iterationen über 252 Handelstage

RSL (Levy Relative Strength):
  RSL = (Kurs / 26-Wochen-Durchschnitt) × 100
  > 110: Strong Momentum
  105-110: Neutral
  < 105: Weak — DCF-Growth-Adjustment -5 bis -10%

Reverse DCF (Implied Growth):
  g* = WACC - (FCF / EV)
  g* > 8%: Unrealistisch ("sportlich")
  g* 4-8%: Moderat
  g* < 4%: Konservativ
  g* < 0%: Markt preist Schrumpfung ein (⚠)

BUY-Signal (alle Bedingungen müssen erfüllt sein):
  ✓ Kurs > MA200
  ✓ MA50 > MA200
  ✓ MACD > 0
  ✓ MACD steigend
```

### Sicherheits-Mechanismen & Sanity Checks

| Feature | Beschreibung | Auto-Trigger |
|---------|-------------|--------------|
| **FCF Haircut** | FCF wird um 10-20% reduziert | Gov. Exposure > 20% |
| **WACC Floor** | Minimum 5% WACC, Debt-Ratio gecapped bei 60% | Immer aktiv |
| **DCF Sanity Cap** | DCF gecapped bei growth-adjusted PE × EPS | Immer aktiv |
| **Anti-Bias-Warnung** | Automatische Warnung bei inkonsistenten Signalen | Inverted DCF < Kurs |
| **Geschäftsmodell-Warnung** | Spezielle Hinweise zu Sektor-Risiken | Pharma, SaaS, neg. FCF |
| **Consistency Check** | 9 Regeln gegen widersprüchliche Kennzahlen | Immer aktiv |
| **RSL Growth-Adjustment** | DCF-Growth -5 bis -10% bei RSL < 105 | Auto bei schwachem Momentum |
| **Reverse DCF Plausibilität** | Warnung wenn implizites Wachstum > 8% | Auto |

---

### Unterstützte Märkte

| Markt | Beispiele | Währung |
|-------|-----------|---------|
| US | AAPL, MSFT, NVDA, TSLA, AMZN | USD |
| Deutschland | VOW3.DE, SAP, BMW.DE | EUR → USD |
| Dänemark | NVO (Novo Nordisk) | DKK → USD |
| China | PDD, BABA, 0700.HK | CNY/HKD → USD |
| Weitere | Jede Aktie mit gültigem Ticker | Auto-Konvertierung |

---

## BTC-Analyse (12 Sektionen)

Vollständig clientseitige Bitcoin-Bewertung — kein Backend nötig. Alle API-Calls passieren direkt im Browser.

### Die 12 Sektionen

| Nr | Sektion | Beschreibung |
|----|---------|-------------|
| 1 | **Analysezeitpunkt & Status** | Live BTC-Preis, Market Cap, DXY Index, F&G Index |
| 2 | **Halving-Zyklus** | Letztes/nächstes Halving, Monate seit Halving, Zyklusphase, Fortschrittsbalken |
| 3 | **Indikatoren-Scoring** | 7 gewichtete Indikatoren mit GIS-Gesamtscore (siehe unten) |
| 4 | **Power-Law Bewertung** | Fair Value, Support/Resistance, Abweichung, Power-Law Korridor |
| 5 | **GWS (Gesamtwert-Signal)** | Composit-Score aus GIS (30%), Power-Law (50%), Zyklus (20%) |
| 6 | **Monte Carlo Simulation** | 10.000 Pfade (3M + 6M), Median, P10/P90, Downside-Wahrscheinlichkeit |
| 7 | **Kategorien A-E** | Probability-Verteilung: Crash/Bear/Neutral/Bull/Euphorie |
| 8 | **Zyklus-Einschätzung** | Position, Einstiegspunkt, Halving-Katalysator |
| 9 | **Finale Schätzung** | 3M + 6M Preisrange, Outlook, Zusammenfassung |
| 10 | **Technische Analyse** | Professioneller Chart (3M-5Y), alle MAs/EMAs, MACD, BTC-Overlays (2Y MA, Pi Cycle, 200W MA, Golden Ratio), Golden/Death Cross Erkennung |
| 11 | **Fear & Greed Index** | Halbkreis-Gauge, historischer Vergleich, farbkodierter 1J/3J/5J Verlauf |
| 12 | **Umfassendes Gesamt-Fazit** | Zyklus, Technische Analyse, Makro/Geopolitik, Miner-Gesundheit, Bärenmarkt-Einschätzung |

### 7-Indikatoren-Scoring (alle mit Live-Daten)

| Indikator | Gewicht | Quelle | Methode |
|-----------|---------|--------|---------|
| **MVRV Z-Score** | 20% | Blockchain.info | Power-Law Realized Price Approximation |
| **RSI (Weekly)** | 15% | Blockchain.info | Wilder 14-Perioden RSI aus wöchentlichen Schlusskursen |
| **Fear & Greed** | 10% | alternative.me | Crypto Fear & Greed Index API |
| **Hashrate Trend** | 10% | mempool.space | 90-Tage Hashrate-Veränderung in % |
| **ETF Net Flows** | 15% | Farside Investors (GitHub) | Tägliche Spot-BTC-ETF Netto-Flows (IBIT, FBTC, GBTC, ...) |
| **Macro (Fed/M2)** | 15% | FRED | Federal Funds Rate |
| **DXY** | 15% | Binance EUR/USDT | Dollar Index approximiert aus EUR/USD-Kurs |

### BTC-Overlay Indikatoren (Technischer Chart)

| Overlay | Beschreibung |
|---------|-------------|
| **2-Jahres MA** | 730-Tage gleitender Durchschnitt |
| **2-Jahres MA × 5** | Historische Zyklusspitze |
| **Pi Cycle (111d)** | Pi Cycle Top Indicator (kürzere Komponente) |
| **Pi Cycle (350d × 2)** | Pi Cycle Top Indicator (längere Komponente) |
| **350d MA** | Golden Ratio Multiplier Basis |
| **200-Wochen MA** | Langfristiger Zyklusboden |

### Datenquellen BTC

| API | Endpunkt | Daten |
|-----|----------|-------|
| Blockchain.info | `/charts/market-price?timespan=all` | Historische BTC-Preise seit 2009 (~6000+ Datenpunkte) |
| CoinGecko | `/simple/price` | Aktueller Preis, 24h-Change, Market Cap |
| alternative.me | `/fng/?limit=2000` | Fear & Greed Index (bis 5+ Jahre History) |
| mempool.space | `/v1/mining/hashrate/3m` | Hashrate (aktuell + 90d Trend) |
| Binance (Vision) | `/ticker/24hr?symbol=EURUSDT` | EUR/USD für DXY-Approximation |
| FRED | `fredgraph.csv?id=FEDFUNDS` | Federal Funds Rate (CORS-limitiert, Fallback auf letzte bekannte Rate) |
| GitHub (fadetocrypto) | `daily-crypto-reports` | Tägliche Farside Investors BTC-ETF Flows |

---

## Gold-Analyse

Fair-Value-Bewertung für Gold basierend auf fundamentalen Makro-Faktoren.

---

## Rezessions- & Korrektur-Dashboard

Objektive Wahrscheinlichkeitsberechnung basierend auf 17 makroökonomischen Indikatoren für Rezession und Marktkorrektur über 3, 6 und 12 Monate.

### 17 Indikatoren mit Echtzeit-Daten

**Rezessions-Indikatoren (7)**

| Indikator | Datenquelle | Score-Range |
|-----------|-------------|------------|
| Sahm-Regel | FRED SAHMREALTIME | +4/-3 |
| Inv. Zinskurve (10Y-2Y) | FRED T10Y2Y | +4/-3 |
| PMI (Mfg+Serv Ø) | ISM / Finance Macro API | +3/-3 |
| Durable Goods (YoY) | FRED DGORDER | +3/-2 |
| M2 Geldmenge (YoY) | FRED M2SL | +3/-2 |
| Kreditspreads (BAA-Trs) | FRED BAA10Y | +3/-2 |
| Konsumklima (CSI) | U of Michigan / Finance API | +3/-3 |

**Korrektur-Indikatoren (10)**

| Indikator | Datenquelle | Gewicht | Score-Range |
|-----------|-------------|---------|------------|
| Buffett Indikator (TMC/GDP) | currentmarketvaluation.com | ×2 | +8/-4 |
| Shiller CAPE | multpl.com | ×1.8 | +7/-5 |
| Margin Debt | currentmarketvaluation.com | ×1 | +4/-4 |
| Google Trends "Recession" | pytrends (7d-Ø) | ×1.7 | +7/-4 |
| VIX | CBOE / Finance API | ×1 | +4/-3 |
| Advance-Decline-Line | NYSE / Finance API | ×1 | +3/-2 |
| CNN Fear & Greed | Finance Sentiment Proxy | ×1.6 | +6/-5 |
| AAII Sentiment | Finance Sentiment Proxy | ×1 | +4/-4 |
| CBOE Put/Call Ratio | Finance Sentiment Proxy | ×1 | +4/-4 |
| Investors Intelligence | Finance Sentiment Proxy | ×1 | +4/-4 |

### Wahrscheinlichkeits-Modell

```
P(Subgruppe) = 50% + (Netto-Score / Max-Score) × 50%

Rezession 12M (mit NY-Fed-Anker):
  P_final = P_raw × 0.7 + NY_Fed_Probability × 0.3

Anti-Bias-Regel: Formel-Ergebnis ist mathematisch bindend.
N/A-Indikatoren: Score=0, Max wird reduziert.
Rundung auf 5%-Schritte.
```

**5 Wahrscheinlichkeits-Horizonte:** Rez. Coincident (3M), Rez. Leading (6M), Rez. Vollständig (12M), Korrektur Sentiment (3-6M), Korrektur Vollständig (12M)

### Fazit & Makro-Risikobewertung (Sektion 9)

Dynamisch generiertes Fazit mit 5 Sektionen:

1. **Quantitative Bewertung** — Indikator-Zusammenfassung, Bull/Bear/Neutral-Verteilung
2. **Bewertungsrisiko** — Buffett (230%), Shiller CAPE (37.3), Margin Debt, historische Drawdown-Analyse
3. **Geopolitik & Makro** — Iran/Hormuz-Sperrung (20% globaler Ölversorgung), Ölpreis $98-132/bbl (Dallas Fed), Stagflationsrisiko, Goldman Sachs Rezessionswahrscheinlichkeit 30%, Fed bei 3,50-3,75% (Natixis), steigende Kapitalmarktzinsen drücken Equity-Bewertungen
4. **Private Credit & Systemisches Risiko** — $3T-Markt-Stresstest, Morgan Stanley warnt vor 8% Defaults, 40% neg. FCF (IWF), NBFI-Kredite $1,92T (+66%), SVB-Parallelen, covenant-lite Risiken, AI-Datacenter-Finanzierung
5. **Handlungsempfehlung** — Defensive Positionierung, Sektorallokation, Gold-Hedge, VIX-Optionen

*Quellen: Dallas Fed, Goldman Sachs, Natixis, Morgan Stanley, CNBC, BIS, IWF, Al Jazeera, Fortune, CBS News*

---

## Tech Stack

| Komponente | Technologie |
|-----------|-------------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| **Charts** | Recharts (ComposedChart, Line, Bar, Area, Pie) |
| **Backend** | Express.js, Node.js (nur für Aktien-API) |
| **BTC-Analyse** | Komplett clientseitig — kein Backend, alle API-Calls im Browser |
| **Routing** | Wouter (Hash-basiert: `/#/btc`, `/#/gold`, `/#/recession`) |
| **Build** | Vite, esbuild |
| **Deploy** | Static Hosting (S3) |

### Projektstruktur

```
stock-dashboard/
├── client/src/
│   ├── pages/
│   │   ├── Dashboard.tsx            # Aktien-Analyse (17 Sektionen)
│   │   ├── BTCDashboard.tsx         # BTC-Analyse (12 Sektionen, ~2000 Zeilen)
│   │   ├── GoldDashboard.tsx        # Gold-Analyse
│   │   └── RecessionDashboard.tsx   # Rezessions-Dashboard
│   ├── components/sections/         # 17 Aktien-Analyse-Sektionen
│   │   ├── Section1.tsx ... Section13.tsx
│   │   └── TechnicalChart.tsx
│   ├── lib/
│   │   ├── btcAnalysis.ts           # BTC Client-Side Analysis (~965 Zeilen)
│   │   ├── btcFallbackData.ts       # Fallback-Daten bei API-Ausfall
│   │   ├── calculations.ts          # FCFF-DCF, CRV, RSL, Monte Carlo
│   │   ├── formatters.ts            # Währung, Zahlen, Prozent
│   │   └── utils.ts                 # Hilfsfunktionen
│   └── App.tsx                      # Router (wouter, Hash-basiert)
├── server/
│   └── routes.ts                    # Aktien-API Endpunkt /api/analyze
├── shared/
│   └── schema.ts                    # TypeScript-Interfaces
├── dist/public/                     # Build-Output (Static Site)
└── package.json
```

---

## Installation & Entwicklung

### Voraussetzungen
- Node.js 18+
- npm

### Lokale Entwicklung
```bash
git clone https://github.com/1719842374/Aktienanalyst.git
cd Aktienanalyst
npm install
npm run dev
```

### Build
```bash
npm run build
```

### Produktion
```bash
NODE_ENV=production node dist/index.cjs
```

> **Hinweis:** Die Aktien-APIs benötigen Perplexity Computer Credentials. Die BTC-Analyse funktioniert komplett ohne Backend — alle API-Calls gehen direkt an öffentliche APIs (Blockchain.info, CoinGecko, alternative.me, mempool.space, Binance).

---

## API-Übersicht

### Aktien-Analyse
- Perplexity Finance API (Quotes, Financials, Segments, OHLCV, Earnings)

### BTC-Analyse (alle CORS-fähig, kein API-Key nötig)
- `api.blockchain.info` — Historische Preise seit Genesis
- `api.coingecko.com` — Aktueller Preis, Market Cap
- `api.alternative.me` — Fear & Greed Index
- `mempool.space` — Hashrate, Mining-Daten
- `data-api.binance.vision` — EUR/USDT für DXY
- `raw.githubusercontent.com/fadetocrypto` — ETF Flows (Farside Investors)
- `fred.stlouisfed.org` — Federal Funds Rate (CORS-limitiert)

---

## Lizenz

Dieses Projekt wurde mit [Perplexity Computer](https://www.perplexity.ai/computer) erstellt.

---

*Erstellt von Philip Diaz Rohr · Powered by Perplexity Computer*
