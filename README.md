# Stock Analyst Pro

**Umfassende Finanzanalyse-Plattform — Aktien (17 Sektionen), Bitcoin-Bewertung (12 Sektionen), Gold-Analyse und Rezessions-Dashboard.**

> Objektiv · Transparent · Konservativ · Alle Rechenwege ausgewiesen

[![Live Demo](https://img.shields.io/badge/Live-Demo-blue?style=for-the-badge)](https://www.perplexity.ai/computer/a/stock-analyst-pro-rZ4JAR_BTDqcATEm4h888g)
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

### Bewertungs-Framework

```
FCFF = EBIT × (1 - Tax) + D&A - Capex - ΔWC
Terminal Value = FCFF₁₁ / (WACC - g)
WACC = E/V × Re + D/V × Rd × (1-t)
Re = Rf + β × ERP (CAPM)
```

```
CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)
Monte Carlo: S(t+Δt) = S(t) · exp((μ - σ²/2)·Δt + σ·√Δt·Z)
RSL = (Kurs / 26-Wochen-Durchschnitt) × 100
BUY: Kurs > MA200 AND MA50 > MA200 AND MACD > 0 + steigend
```

### Sicherheits-Mechanismen

| Feature | Beschreibung |
|---------|-------------|
| **FCF Haircut** | Automatisch bei Gov. Exposure > 20% |
| **WACC Floor** | Minimum 5%, Debt-Ratio gecapped bei 60% |
| **DCF Sanity Cap** | Gecapped bei growth-adjusted PE × EPS |
| **Anti-Bias** | Symmetrische Downside für jeden Upside-Katalysator |
| **Geschäftsmodell-Warnung** | Automatisch bei Pharma, SaaS, neg. FCF |

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

## Rezessions-Dashboard

17 makroökonomische Indikatoren zur Einschätzung der Rezessionswahrscheinlichkeit mit automatischem Scoring und historischem Vergleich.

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
