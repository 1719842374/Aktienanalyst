# 📊 Stock Analyst Pro

**Umfassende, evidenzbasierte Aktienanalyse mit 17 Sektionen — DCF-Modellierung, Monte Carlo Simulation, technische Analyse und mehr.**

> Objektiv · Transparent · Konservativ · Alle Rechenwege ausgewiesen

[![Live Demo](https://img.shields.io/badge/Live-Demo-blue?style=for-the-badge)](https://www.perplexity.ai/computer/a/stock-analyst-pro-soumVADUQSe7rHrLuMfsQg)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?style=for-the-badge&logo=github)](https://github.com/1719842374/Aktienanalyst)

---

## 🎯 Überblick

Stock Analyst Pro ist ein vollständiges Aktienanalyse-Dashboard, das für **jede Aktie weltweit** (US, Europa, Asien) eine objektive, konservative Bewertung erstellt. Die Analyse umfasst 17 Sektionen — von fundamentaler Bewertung über technische Analyse bis hin zu Monte Carlo Simulationen.

**Kernprinzipien:**
- 🔢 **Alle Rechenwege transparent** — jede Berechnung ist nachvollziehbar mit Step-by-Step Formeln
- ⚖️ **Anti-Bias-Protokoll** — kein selektiver Upside ohne symmetrischen Downside
- 🌍 **Generisch für jede Aktie** — US, europäische, asiatische Aktien mit automatischer Währungsumrechnung
- 📊 **Echtzeit-Daten** — Kurse, Fundamentaldaten, Analystenschätzungen via Finance API

---

## 📋 Die 17 Analyse-Sektionen

| Nr | Sektion | Beschreibung |
|----|---------|-------------|
| 1 | **Datenaktualität & Plausibilität** | Live-Kurs, Market Cap, P/E, EV/EBITDA, Analyst Ratings, Währungsumrechnung |
| 2 | **Investmentthese & Katalysatoren** | Company Description, Peter Lynch Klassifikation, Revenue-Segmente (Produkt + Region), Katalysatoren-Tabelle mit PoS/Brutto-Upside/Einpreisungsgrad |
| 3 | **Zyklus- & Strukturanalyse** | Konjunktur-/Politikzyklus, Zyklusfortschritt-Indikator, Makro-Sensitivität, Geopolitische Risiken |
| 4 | **Bewertungskennzahlen** | WACC-Szenarien (Damodaran), CAPM, PEG-Ratio, Zins-Sensitivität |
| 5 | **DCF-Modell (FCFF)** | Vollständiger FCFF-DCF mit editierbaren Parametern, 3 Szenarien, Sensitivitätsmatrix, Geschäftsmodell-Warnung |
| 6 | **Risikoadjustiertes CRV** | Worst Case (3 Methoden), Base CRV + Risk-Adjusted CRV, DCF bei CRV 3:1 |
| 7 | **Relative Bewertung** | Forward P/E, EV/EBITDA, PEG vs. Sektor, Moat-Justified vs. Speculative Premium |
| 8 | **Risikoinversion** | Top-Risiken nach Expected Damage, WACC/Growth-Adjustierung, Invertierter DCF |
| 9 | **RSL-Momentum** | Levy Relative Strength (26-Wochen), automatische DCF-Growth-Adjustment bei RSL < 105 |
| 10 | **Technische Analyse** | Interaktiver 5Y-Chart mit MA200/MA50/MACD, Golden/Death Cross (2J-Lookback), Buy-Signal-Bedingungen |
| 11 | **Moat & Porter's Five Forces** | Moat-Rating, Porter-Scoring, Wettbewerbspositions-Matrix |
| 12 | **PESTEL-Analyse** | 6 Makro-Kategorien, Exposure-Matrix, Zinsen-/Kapitalkosten-Ausblick |
| 13 | **Makro-Korrelationen** | 20+ Korrelationen (Indizes, Rohstoffe, Währungen, Crypto), Sensitivitäts-Analyse |
| 14 | **Reverse DCF** | Implizierte Wachstumsrate g*, Plausibilitätscheck |
| 15 | **Katalysatoren (Anti-Bias)** | Expandierbare Katalysator-Details, Catalyst-Adj. Target, Downside-Katalysatoren |
| 16 | **Monte Carlo Simulation** | GBM mit 10.000 Iterationen, Percentil-Verteilung, Downside-Wahrscheinlichkeit |
| 17 | **Zusammenfassung & Fazit** | Gesamtbewertung aller 17 Sektionen, Signal-Score, dynamischer Fazit-Satz |

---

## 🧮 Bewertungs-Framework

### DCF-Modell (FCFF-basiert)
```
FCFF = EBIT × (1 - Tax) + D&A - Capex - ΔWC
Terminal Value = FCFF₁₁ / (WACC - g)
WACC = E/V × Re + D/V × Rd × (1-t)
Re = Rf + β × ERP (CAPM)
Equity Value = EV - Net Debt - Minorities
```

### CRV-Formel (korrigiert)
```
CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)
DCF bei CRV 3:1 = (Kons. DCF + 3 × Worst Case) / 4
```

### Worst Case Methoden
- **M1:** Kurs × (1 - min(90%, Beta × MaxDrawdown%))
- **M2:** Kurs × (1 - 35%) — wahrscheinlichstes Risiko
- **M3:** Kurs × (1 - Sektor-MaxDrawdown%)
- **Worst Case = min(M1, M2, M3)**

### Monte Carlo (GBM)
```
S(t+Δt) = S(t) · exp((μ - σ²/2)·Δt + σ·√Δt·Z)
Z ~ N(0,1), Δt = 1/252
```

### RSL-Momentum
```
RSL = (Kurs / 26-Wochen-Durchschnitt) × 100
RSL < 105 → DCF-Growth -5% bis -10%
```

### Kaufbedingungen
```
BUY nur wenn: Kurs > MA200 AND MA50 > MA200 AND MACD > 0 + steigend
```

---

## 🛡️ Sicherheits-Mechanismen

| Feature | Beschreibung |
|---------|-------------|
| **FCF Haircut** | Automatisch bei Gov. Exposure > 20% (Pharma: 35% → 14% Haircut) |
| **WACC Floor** | Minimum 5%, Debt-Ratio gecapped bei 60% (FS-Debt-Schutz) |
| **DCF Sanity Cap** | Per-Share gecapped bei growth-adjusted PE × EPS (verhindert FS-Debt-Verzerrung) |
| **Net Debt Cap** | Maximum 70% des Enterprise Value im Equity Bridge |
| **Anti-Bias** | Symmetrische Downside-Katalysatoren für jeden Upside-Katalysator |
| **Geschäftsmodell-Warnung** | Automatisch bei Pharma (Preisregulierung), SaaS (KI-Disruption), neg. FCF |
| **Inverted DCF Warnung** | Automatisch wenn risikoadjustierter Fair Value < Kurs |

---

## 🏗️ Tech Stack

| Komponente | Technologie |
|-----------|-------------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| **Charts** | Recharts (ComposedChart, Line, Bar, Area) |
| **Backend** | Express.js, Node.js |
| **Daten-APIs** | Perplexity Finance API (Quotes, Financials, Segments, OHLCV, Earnings) |
| **Build** | Vite, esbuild |
| **Deploy** | Perplexity Computer (S3 Static Hosting) |

### Projektstruktur
```
stock-dashboard/
├── client/src/
│   ├── components/sections/   # 17 Analyse-Sektionen
│   │   ├── Section1.tsx       # Datenaktualität
│   │   ├── Section2.tsx       # Investmentthese
│   │   ├── Section3.tsx       # Zyklusanalyse
│   │   ├── Section4.tsx       # Bewertung
│   │   ├── Section5.tsx       # DCF-Modell (editierbar)
│   │   ├── Section6.tsx       # CRV (Base + Risk-Adjusted)
│   │   ├── Section7.tsx       # Relative Bewertung
│   │   ├── Section8.tsx       # Risikoinversion
│   │   ├── Section9.tsx       # RSL-Momentum
│   │   ├── TechnicalChart.tsx # Technische Analyse (interaktiv)
│   │   ├── Section15.tsx      # Moat & Porter
│   │   ├── Section16.tsx      # PESTEL
│   │   ├── Section17.tsx      # Makro-Korrelationen
│   │   ├── Section10.tsx      # Reverse DCF
│   │   ├── Section11.tsx      # Katalysatoren (Anti-Bias)
│   │   ├── Section12.tsx      # Monte Carlo (GBM)
│   │   └── Section13.tsx      # Zusammenfassung + Fazit
│   ├── lib/
│   │   ├── calculations.ts    # FCFF-DCF, CRV, RSL, Monte Carlo, Worst Case
│   │   └── formatters.ts      # Währung, Zahlen, Prozent-Formatierung
│   └── pages/
│       └── Dashboard.tsx       # Haupt-Layout mit Sidebar
├── server/
│   └── routes.ts              # API-Endpunkt /api/analyze (2500+ Zeilen)
├── shared/
│   └── schema.ts              # TypeScript-Interfaces für alle Datentypen
└── package.json
```

---

## 🚀 Installation & Entwicklung

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

> **Hinweis:** Die Finance-APIs benötigen Perplexity Computer Credentials (`external-tools`). Für unabhängigen Betrieb müssten die API-Calls auf direkte Datenquellen (Polygon.io, Yahoo Finance API) umgebaut werden.

---

## 📊 Unterstützte Aktien

| Markt | Beispiele | Währung |
|-------|-----------|---------|
| 🇺🇸 US | AAPL, MSFT, NVDA, TSLA, AMZN | USD |
| 🇩🇪 Deutschland | VOW3.DE, SAP, BMW.DE | EUR → USD |
| 🇩🇰 Dänemark | NVO (Novo Nordisk) | DKK → USD |
| 🇳🇱 Niederlande | ASML | EUR → USD |
| 🇨🇳 China | PDD, BABA, 0700.HK | CNY/HKD → USD |
| 🌍 Weitere | Jede Aktie mit gültigem Ticker | Auto-Konvertierung |

---

## 🔑 Besondere Features

### Peter Lynch Klassifikation
Automatische Einordnung in: **Zykliker** (buy at high P/E), **Fast Grower**, **Stalwart**, **Slow Grower**, **Turnaround**, **Asset Play** — mit aktienspezifischer Kauf-/Verkaufsempfehlung.

### Golden Cross / Death Cross
2-Jahres-Lookback für strukturelle MA50/MA200-Crossover-Events. Zeigt Datum und Tage seit Crossover.

### Dual CRV (Base + Risikoadjustiert)
Zwei CRV-Berechnungen nebeneinander — Base (ohne Risikoabschlag) und Risk-Adjusted (nach Expected Damage aus Risikoinversion).

### Geschäftsmodell-Warnung
Automatische Warnung beim DCF für:
- **Pharma:** IRA-Preisregulierung, Medicare-Verhandlungen
- **SaaS:** KI-Disruption der Software-Margen
- **Negativer FCF:** Margenverbesserungs-Annahme hinterfragen
- **Zykliker mit FS-Debt:** Financial-Services-Schulden-Verzerrung

### Dynamisches Fazit
Synthesiert alle 17 Sektionen zu einem Gesamturteil: **ATTRAKTIV / LEICHT ATTRAKTIV / NEUTRAL / UNATTRAKTIV / STARK UNATTRAKTIV** — mit detailliertem Fazit-Satz und Auflistung aller positiven/negativen Faktoren.

---

## 📜 Regelwerk (User Instructions)

- Immer generisch — funktioniert für jede Aktie
- Anti-Bias: Kein selektiver Upside ohne symmetrischen Downside
- CRV: `(Fair Value - Worst Case) / (Kurs - Worst Case)`
- Government Exposure > 20% → FCF Haircut 10-20%
- Inverted DCF < Kurs → AUTOMATISCHE WARNUNG
- RSL < 105 → DCF Growth -5% bis -10%
- Buy nur wenn: Kurs > MA200 AND MA50 > MA200 AND MACD > 0 + steigend
- Monte Carlo: Geometrische Brownsche Bewegung (GBM)
- DCF: FCFF-basiert mit WACC/CAPM, Gordon Growth Terminal Value
- Catalyst-Adj. Zielwert = Kons. DCF × (1 + Σ GB / 100)

---

## 📈 Datenquellen

- **Kurse & Fundamentaldaten:** Yahoo Finance, Polygon API
- **Analystenschätzungen:** Consensus Estimates, Analyst Research
- **WACC-Methodik:** Damodaran (NYU Stern)
- **Sektordaten:** Bloomberg, Simply Wall St, SEC EDGAR
- **Historische Preise:** OHLCV via Finance API (5+ Jahre)

---

## 📄 Lizenz

Dieses Projekt wurde mit [Perplexity Computer](https://www.perplexity.ai/computer) erstellt.

---

*Erstellt von Philip Diaz Rohr · Powered by Perplexity Computer*
