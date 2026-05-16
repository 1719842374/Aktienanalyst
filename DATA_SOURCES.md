# Datenquellen & Datenabfrage — Stock Analyst Pro

> **Letzte Aktualisierung:** Mai 2026  
> **Zielgruppe:** Entwickler und informierte Nutzer

---

## Übersicht: Wo kommen die Daten her?

Die App nutzt vier konzeptionell getrennte Datenschichten:

### Ebene 1 — Perplexity Finance Connector (primär)
Der **Perplexity Finance Connector** (`source_id: "finance"`) ist die primäre Datenquelle für alle Aktienanalysen, das Rezessions-Dashboard und Teile des Gold-Dashboards. Er wird über die `external-tool` CLI synchron aufgerufen:

```bash
external-tool call '{"source_id":"finance","tool_name":"finance_quotes","arguments":{...}}'
```

Jeder Call wird mit einem Mindestabstand von **250 ms** zwischen Anfragen drosselt (konfigurierbar in `routes.ts`, `gold-routes.ts`, `recession.ts`). Bei HTTP 429 / RATE_LIMITED erfolgt ein einmaliger Retry nach **4 s Backoff**. Im Haupt-Analyse-Endpunkt (`/api/analyze`) sind bis zu 3 Retries mit exponentiellem Backoff konfiguriert.

### Ebene 2 — FMP API (Fallback)
**Financial Modeling Prep (FMP)** über `https://financialmodelingprep.com/stable` dient als sekundäre Datenquelle. FMP wird parallel zur Finance-API aktiviert, wenn:
- Die `external-tool` CLI nicht verfügbar ist (`BINARY_MISSING`-Fehler),
- Die Finance-API ratenlimitiert ist und kein valider Cache vorliegt,
- Das Deployment auf Railway ohne externe CLI läuft.

FMP benötigt einen API-Key in der Umgebungsvariable `FMP_API_KEY`.

### Ebene 3 — FRED & öffentliche APIs (Gold, Rezession, BTC-Makro)
Die **Federal Reserve Economic Database (FRED)** liefert makroökonomische Zeitreihen direkt über CSV-Download (`https://fred.stlouisfed.org/graph/fredgraph.csv`). Kein API-Key erforderlich. Weitere öffentliche APIs: alternative.me (Fear & Greed), blockchain.info (BTC-Kursverlauf), mempool.space (Hashrate), CoinGecko (BTC-Preis).

### Ebene 4 — Client-seitige Berechnungen (BTC, Technicals)
Das **BTC-Dashboard** (`client/src/lib/btcAnalysis.ts`) läuft vollständig im Browser. Die Berechnungen von Power-Law, MVRV-Z-Score, Monte-Carlo-Simulation und technischen Indikatoren (MA20–MA1400, MACD, RSI) erfolgen lokal mit in JavaScript implementierten Formeln — keine Serverrunde erforderlich.

---

## Sektion 1: Aktienanalyse — Finance-Tool-Calls

Der Haupt-Analyse-Endpunkt (`POST /api/analyze`) führt folgende Finance-Tool-Calls sequenziell mit Throttling aus:

### `finance_quotes` → Kurs & Marktdaten
```json
{
  "ticker_symbols": ["TICKER"],
  "fields": ["price","currency","marketCap","pe","eps","change","changesPercentage",
             "volume","avgVolume","dayLow","dayHigh","yearLow","yearHigh",
             "previousClose","dividendYieldTTM"]
}
```
**Verwendete Felder:**
- `price` → Aktueller Kurs (Sektion 1: Kursdaten, Header)
- `currency` → Währungskennung für FX-Konvertierung
- `marketCap` → Marktkapitalisierung (Sektionen 3, 5, 12)
- `pe` → KGV (Sektion 3: Bewertung)
- `eps` → Ergebnis je Aktie (Sektion 3)
- `change` / `changesPercentage` → Tageskursveränderung (Sektion 1)
- `volume` / `avgVolume` → Handelsvolumen (Sektion 1)
- `dayLow` / `dayHigh` → Tagesrange (Sektion 1)
- `yearLow` / `yearHigh` → 52-Wochen-Spanne (Sektion 2: Technicals)
- `previousClose` → Vortageskurs (Sektion 1)
- `dividendYieldTTM` → Dividendenrendite (Sektion 7: Kapitalallokation)

**Betroffene Sektionen:** 1 (Kursdaten), 2 (Technische Analyse), 3 (Bewertung), 5 (DCF), 7 (Kapitalallokation), 12 (Risiken)

---

### `finance_company_profile` → Unternehmensstammdaten
```json
{
  "ticker_symbols": ["TICKER"]
}
```
**Verwendete Felder:**
- `companyName` → Unternehmensname (Header)
- `sector` / `industry` → Sektor/Branche (alle LLM-Prompts, Sektion 12)
- `description` → Unternehmensbeschreibung (Sektion 1, LLM-Prompt)
- `country` → Herkunftsland (für Steuer-/Regulierungsrisiko, Sektion 12)
- `fullTimeEmployees` → Mitarbeiterzahl (Sektion 1)
- `ipoDate` → IPO-Datum (Sektion 1)
- `website` → URL (Sektion 1)
- `exchange` → Börsenplatz (Währungslogik)

**Betroffene Sektionen:** 1 (Unternehmensübersicht), 8 (Risiko-Inversion), 12 (Makro-/Regulierungsrisiken), 15 (Katalysatoren)

---

### `finance_financials` → Finanzberichte
```json
{
  "ticker_symbols": ["TICKER"],
  "period": "annual",
  "as_of_fiscal_year": 2024,
  "limit": 3,
  "income_statement_metrics": ["revenue","netIncome","ebitda","eps","epsDiluted",
    "weightedAverageSharesOutstanding","operatingIncome","grossProfit"],
  "balance_sheet_metrics": ["totalDebt","cashAndCashEquivalents","totalStockholdersEquity",
    "totalAssets","totalCurrentAssets","totalCurrentLiabilities","netDebt"],
  "cash_flow_metrics": ["freeCashFlow","operatingCashFlow","capitalExpenditure"]
}
```
**Verwendete Felder:**
- `revenue` → Umsatz, YoY-Wachstum (Sektionen 4, 5, 6)
- `netIncome` / `ebitda` → Profitabilität (Sektion 4, DCF)
- `eps` / `epsDiluted` → EPS-Entwicklung (Sektion 3)
- `grossProfit` → Bruttomarge (Sektion 4)
- `operatingIncome` → EBIT-Marge (Sektion 4)
- `freeCashFlow` → FCF (Sektionen 5, 6, 7)
- `operatingCashFlow` / `capitalExpenditure` → CapEx-Ratio (Sektion 7)
- `totalDebt` / `cashAndCashEquivalents` → Nettoverschuldung (Sektion 6)
- `netDebt` → Net Debt/EBITDA (Sektion 6)
- `totalStockholdersEquity` → Buchwert für P/B (Sektion 3)
- `totalCurrentAssets` / `totalCurrentLiabilities` → Current Ratio (Sektion 6)

**Betroffene Sektionen:** 3 (Bewertung), 4 (Fundamentalanalyse), 5 (DCF), 6 (Bilanzqualität), 7 (Kapitalallokation)

---

### `finance_analyst_research` → Analystenmeinungen
```json
{
  "ticker_symbols": ["TICKER"]
}
```
**Verwendete Felder:**
- Kursziele (Median, High, Low, Mean) → Sektion 9: Analystenkonsens
- Buy/Hold/Sell-Ratings → Sektion 9
- Analystennamen und Institutionen → Sektion 9
- Neueste Research-Notes → Sektion 9

**Betroffene Sektionen:** 9 (Analystenmeinungen & Kursziele)

---

### `finance_estimates` → Konsensschätzungen
```json
{
  "ticker_symbols": ["TICKER"],
  "period_type": "annual"
}
```
**Verwendete Felder:**
- Umsatzschätzungen (nächste 1–3 Geschäftsjahre) → Sektion 10: Forward-Multiples
- EPS-Konsensschätzungen → Sektionen 3, 10
- EBITDA-Schätzungen → Sektion 10
- Forward PE / EV/EBITDA (berechnet aus Kurs ÷ Konsens-EPS) → Sektion 10

**Betroffene Sektionen:** 3 (Forward-KGV), 10 (Wachstumserwartungen & Schätzungen)

---

### `finance_ohlcv_histories` → Kursverlauf (OHLCV)
```json
{
  "ticker_symbols": ["TICKER"],
  "start_date_yyyy_mm_dd": "2014-01-01",
  "end_date_yyyy_mm_dd": "2024-12-31",
  "time_interval": "1day",
  "fields": ["open","high","low","close","volume"]
}
```
Anforderung: 10+ Jahre Tagesdaten (für 200-DMA benötigt, für vollständige Trendanalyse).

**Verwendete Felder:**
- `close` → Berechnung MA20, MA50, MA200 (Sektion 2)
- `close` (letzten 14 Tage) → RSI-14 Berechnung (Sektion 2)
- `close` / `volume` → On-Balance-Volume, Volatilitätsberechnung (Sektion 2)
- `close` (52 Wochen) → 52-Wochen-Performance (Sektion 2)
- Alle Felder → Chart-Datenpunkte (Technische Charts in UI)

**Betroffene Sektionen:** 2 (Technische Analyse), 11 (Charttechnik)

---

### `finance_segments` → Segmentberichterstattung
```json
{
  "ticker_symbols": ["TICKER"],
  "query": "revenue by business segment and geographic breakdown",
  "period_type": "annual"
}
```
**Verwendete Felder:**
- Umsatz nach Geschäftssegmenten → Sektion 13: Segmentanalyse
- Geografische Umsatzverteilung → Sektion 13 (Regionsrisiko)
- Wachstum je Segment YoY → Sektion 13

**Betroffene Sektionen:** 13 (Geschäftssegmente & Geografie)

---

### `finance_massive` → Nachrichten
```json
{
  "pathname": "/v2/reference/news",
  "params": {"ticker": "TICKER", "limit": 10, "order": "desc"}
}
```
Dieser Call ruft die aktuellsten Unternehmensnachrichten (letzten 7–30 Tage) ab.

**Verwendete Felder:**
- `title` → Schlagzeile (Sektion 16: News & Stimmung)
- `published_utc` / `published_date` → Veröffentlichungsdatum (Sektion 16)
- `publisher.name` → Quelle (Sektion 16)
- `article_url` → Link (Sektion 16)
- Sentiment-Tags (bullish/bearish/neutral) → vom LLM vergeben (Sektion 16)
- `matchedCatalyst` → Zuordnung zu LLM-Katalysatoren (Sektion 15/16)

**Betroffene Sektionen:** 15 (Katalysatoren, News-adjustiertes PoS), 16 (Nachrichten & Marktstimmung)

---

### Zusätzliche Finance-Tools (Vergleichsanalyse & Screener)

| Tool | Argumente | Zweck | Sektionen |
|------|-----------|-------|-----------|
| `finance_company_peers` | `ticker_symbol`, Sektor/Branche/KGV | Peer-Gruppe ermitteln | 14 |
| `finance_company_ratios` | Peer-Ticker-Liste | KGV, KUV, KBV für Peer-Vergleich | 14 |
| `finance_estimates` (Peers) | Peer-Ticker-Liste | Forward-Multiples Peers | 14 |
| `finance_quotes` (Peers) | Peer-Ticker-Liste, `[pe, marketCap, eps, price]` | Live-Kurse für Peers | 14 |
| `finance_market_sentiment` | `market_type`, Länder-Query | Marktbreite, AD-Linie, Sentiment-Proxy | Rezessions-Dashboard |
| `finance_macro_snapshot` | `countries`, Keywords | Makro-Snapshot (PMI, CPI, etc.) | Gold, Rezession |
| `finance_quotes` (Screener) | Holdings-Ticker, OHLCV-Felder | Bewertungsschnellcheck 13F-Holdings | Screener |
| `finance_company_profile` (Screener) | Holdings-Ticker | Profil für Screener-Karten | Screener |

---

## Sektion 2: FMP Fallback

### Fallback-Kette

```
1. Finance Connector (external-tool CLI)
       ↓  FEHLER (429 / BINARY_MISSING)
2. Cache-Check (.cache/<TICKER>.json, TTL 7 Tage)
       ↓  kein valider Cache
3. FMP Parallel-Fetch (alle Endpunkte gleichzeitig)
       ↓  HTTP 429 / FMP_API_KEY fehlt
4. Fehlerantwort (HTTP 503 + Fehlermeldung)
```

**TTL des Analyse-Caches:** 7 Tage (`ANALYZE_TTL_MIN = 60 * 24 * 7` Minuten). Cache-Key: Ticker-Symbol. Der Cache enthält außerdem das Flag `_useLLM` (boolean), damit KI-aktivierte und KI-freie Analysen nicht gegenseitig überschrieben werden.

### Alle 14 FMP-Endpoints

| Funktion | FMP-Endpoint | Zweck |
|----------|-------------|-------|
| `fmpProfile` | `/stable/profile` | Stammdaten (Sektor, Branche, Land, Beschreibung) |
| `fmpIncomeStatement` | `/stable/income-statement` | GuV: Umsatz, EBIT, Nettogewinn, EPS (3 Jahre) |
| `fmpCashFlow` | `/stable/cash-flow-statement` | FCF, CapEx, operativer CF (3 Jahre) |
| `fmpBalanceSheet` | `/stable/balance-sheet-statement` | Verschuldung, Eigenkapital, Current Assets (1 Jahr) |
| `fmpHistoricalPrices` | `/stable/historical-price-eod/full` | Tages-OHLCV (10 Jahre, für Technicals) |
| `fmpAnalystEstimates` | `/stable/analyst-estimates` | Forward-EPS-Konsens (3 Jahre, jährlich) |
| `fmpGrades` | `/stable/grades` | Analystenbewertungen Buy/Hold/Sell (20 aktuellste) |
| `fmpPriceTarget` | `/stable/price-target-consensus` | Konsens-Kursziel (Median, High, Low) |
| `fmpSegments` | `/stable/revenue-product-segmentation` | Segmentumsätze nach Produkt |
| `fmpPeers` | `/stable/stock-peers` | Peer-Unternehmen für Vergleichsanalyse |
| `fmpRatios` | `/stable/ratios` | KGV, KUV, KBV, EV/EBITDA-Zeitreihe (3 Jahre) |
| `fmpKeyMetrics` | `/stable/key-metrics` | FCF-Rendite, Buchwert/Aktie (5 Jahre) |
| `fmpBatchQuote` | `/stable/profile` (kommagetrennt) | Batch-Quote für Screener-Ticker |
| `fmpSearchTicker` | `/stable/search-symbol` + `/stable/search-name` | Name-zu-Ticker-Auflösung (13F-Resolver) |

**Basis-URL:** `https://financialmodelingprep.com/stable`  
**Auth:** Query-Parameter `apikey=<FMP_API_KEY>`  
**Timeout:** 15 Sekunden pro Request  
**Rate-Limit FMP:** Wesentlich höher als der Finance Connector — daher Parallel-Fetch ohne Throttling

**Währungskonvertierung (FMP international):** Bei nicht-USD-Tickers (erkennbar an `currency`-Feld in FMP-Profil) werden alle Finanzkennzahlen mit statischen FX-Rates in USD umgerechnet. Diese Rates werden täglich veraltet (keine Live-Aktualisierung). Betroffen: EUR, GBP, JPY, CNY u.a.

---

## Sektion 3: LLM Integration (OpenRouter / Grok)

### Modell-Strategie

Die LLM-Integration nutzt **OpenRouter** (`https://openrouter.ai/api/v1`) als Routing-Layer. Der Standard-OpenAI-Client aus dem `openai`-Package wird mit `baseURL: "https://openrouter.ai/api/v1"` konfiguriert.

**Modell-Auswahl (Datei: `server/llm-openrouter.ts`, Funktion `pickModel()`):**

| Bedingung | Modell |
|-----------|--------|
| Standard (kein Override) | `x-ai/grok-4.1-fast` (bis 2026-05-15) |
| Nach 2026-05-15 (auto-switch) | `x-ai/grok-4.3` |
| `PREFER_GROK=0` gesetzt | `anthropic/claude-3.5-haiku` |
| `OPENROUTER_MODEL=<id>` gesetzt | beliebiges OpenRouter-Modell |

**Verfügbarkeitsprüfung:** `OPENROUTER_API_KEY` muss gesetzt sein, sonst ist LLM deaktiviert (`isLLMAvailable()` → `false`). Kein API-Key → kein Absturz, stattdessen Fallback auf Sektor-Templates.

---

### Wann wird der LLM aufgerufen?

LLM-Calls erfolgen **nur**, wenn `useLLM=true` im Request-Body (`POST /api/analyze`) übergeben wird. Standardmäßig ist LLM deaktiviert (kostengünstiger Betrieb).

**Pro Analyse werden bei `useLLM=true` bis zu 2 LLM-Calls ausgeführt:**

1. **`generateCatalystsAndMatchNews`** — kombinierter Katalysatoren + Nachrichten-Call  
2. **`generateRiskExplanations`** — Risiko-Tiefenanalyse

---

### LLM Call 1: Katalysatoren + News-Matching (`generateCatalystsAndMatchNews`)

**Trigger:** `useLLM=true` und mindestens 3 Finance-API-Datenpunkte verfügbar.

**Prompt-Inputs:**
- Unternehmensname, Ticker, Sektor/Branche
- Beschreibung (max. 600 Zeichen)
- Umsatz, Umsatzwachstum, FCF-Marge
- Kurs, KGV, Marktkapitalisierung
- Key Projects aus SEC 10-K (max. 8 Items)
- SEC-Filing-Auszüge (max. 4 × 200 Zeichen)
- Aktuelle News-Schlagzeilen (max. 10 Items mit Quelle und Datum)

**Output (JSON-Mode):**
- **5 unternehmensspezifische Investmentkatalysatoren** (Sektion 15), jeder mit:
  - `name` (≤50 Zeichen, firmenspezifisch — generische Namen wie "Revenue Growth" sind verboten)
  - `context` (2–3 Sätze deutsch)
  - `timeline` (z.B. "12-18M")
  - `pos` (Probability of Success, 20–80%)
  - `bruttoUpside` (5–30%)
  - `einpreisungsgrad` (20–60%)
- **News-Sentiment-Tags** für alle News-Items:
  - `sentiment` (bullish/bearish/neutral)
  - `score` (–1.0 bis +1.0)
  - `catalyst` (K1–K5 oder none)

**Post-Processing:** Matched-News-Sentiment adjustiert die Katalysator-PoS um ±7 Prozentpunkte (max.).

**Parameter:** `max_tokens=1900`, `temperature=0.4`, `response_format: json_object`, Grok-spezifisch: `reasoning: { effort: "none" }` (verhindert verstecktes Chain-of-Thought, das Token-Budget aufbraucht).

**Kosten:** ~3–4 OpenRouter-Credits (vs. ~10–15 Credits mit vorherigem Zwei-Call-Modell)

---

### LLM Call 2: Risiko-Erklärungen (`generateRiskExplanations`)

**Trigger:** `useLLM=true` und Katalysaten erfolgreich generiert (Section 8 — Risiko-Inversions-Tabelle).

**Prompt-Inputs:** Alle Inputs von Call 1 plus:
- Staatsabhängigkeitsquote (`governmentExposure`)
- Vollständige Risikoliste (bis zu 6 Risiken mit EW%, Impact%, Expected Damage)
- Optional: Key Projects aus SEC, aktuelle News-Schlagzeilen

**Output:** Für jedes Risiko (Sektion 8):
- `kontext` — warum relevant für dieses Unternehmen
- `gewichtungsBegrundung` — Begründung für EW% und Impact%
- `bewertungsAuswirkung` — Auswirkung auf Umsatz/Margen/FCF/DCF
- `mitigation` — Unternehmensmaßnahmen zur Risikominderung
- `gesamtEinschaetzung` — Kritikalität im Gesamtkontext
- `unterschaetzt` (boolean) — ob Expected Damage unterschätzt ist

**Parameter:** `max_tokens=4500`, `temperature=0.25`

**Kosten:** ~1–2 OpenRouter-Credits

---

### LLM im Researcher-Modul

Der **Researcher** (`server/researcher.ts`) verwendet `callLLMJson()` für Synthese-Aufgaben:
- Makro-Pulse-Interpretation (Tab 1)
- Sektor-Opportunity-Scoring (Tab 2, 12 fixe Megatrend-Kategorien auf Skala 1–10)
- Moat-Bewertung im Undervalued Screener (Tab 3)
- Capex-Fiscal-Tracker-Zusammenfassung (Tab 4)

Der LLM generiert dort **keine Zahlenfakten**, sondern ausschließlich Synthese und Interpretation bereits abgerufener Finanzdaten.

---

## Sektion 4: Gold Dashboard

Das Gold-Dashboard (`GET /api/analyze-gold`, `server/gold-routes.ts`) kombiniert sechs Datenquellen:

### 4.1 Gold-Spot-Preis (`finance_quotes`)
```json
{
  "ticker_symbols": ["GCUSD"],
  "fields": ["price","change","changesPercentage","yearLow","yearHigh","previousClose"]
}
```
- Symbol `GCUSD` = Gold Spot USD/Unze (Continous Futures Proxy)
- Fallback: letzter `close`-Wert aus OHLCV wenn Quote leer
- Zweiter Fallback-Hardcode: `$4500` (Stand März 2026) mit Console-Warning

**Zusätzlich:** `DX-Y.NYB` (US Dollar Index) via `finance_quotes` für die DXY-Komponente.

### 4.2 Gold OHLCV-Verlauf (`finance_ohlcv_histories`)
```json
{
  "ticker_symbols": ["GCUSD"],
  "start_date_yyyy_mm_dd": "<2 Jahre zurück>",
  "end_date_yyyy_mm_dd": "<heute>",
  "time_interval": "1day",
  "fields": ["close"]
}
```
Liefert 2 Jahre Tagesschlusskurse für:
- 200-Tages-Durchschnitt (200-DMA) — mind. 200 Datenpunkte benötigt
- RSI-14 (Wilder-Methode)
- 30-Tages-realisierte Volatilität (annualisiert × √252)

### 4.3 FRED — Breakeven-Inflationsrate (`T10YIE`)
- **Serie:** `T10YIE` — 10-Jahr Breakeven Inflationserwartung
- **Endpunkt:** `https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10YIE`
- **Abfrage:** Synchroner `curl`-Call, letzte 5 Beobachtungen (`tail -5`)
- **Verwendung:** GIS-Indikator "Breakeven (T10YIE)", Gewicht 0.10
- **Fallback:** `2.34%` (Stand Feb 2026)

### 4.4 FRED — 10-Jahres-Realzinsen (`DFII10`)
- **Serie:** `DFII10` — 10-Year Treasury Inflation-Indexed Security (TIPS)
- **Endpunkt:** `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10`
- **Verwendung:** GIS-Indikator "Realzinsen (DFII10)", Gewicht 0.15
  - < 0%: bullish Gold
  - 0–1.5%: bullish Gold  
  - 1.5–2.5%: neutral  
  - > 2.5%: bearish Gold
- **Fallback:** `2.02%` (Stand Feb 2026)

### 4.5 FRED — M2 Geldmenge (`M2SL`) — YoY berechnet
- **Serie:** `M2SL` — US M2 Money Stock (Mrd. USD, monatlich)
- **Endpunkt:** `https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL&vintage_date=<heute>&limit=14&sort_order=desc`
- **Berechnung:** YoY aus **13 Datenpunkten** (neuester Wert ÷ Wert vor 12 Monaten − 1) × 100
- **Verwendung:** GIS-Indikator "M2 YoY", Gewicht 0.05
- **Fallback:** `4.88%` (YCharts Feb 2026 Schätzung)
- **Plausibilitätsprüfung:** Wert muss im Bereich 0–30% liegen

### 4.6 Zentralbankkäufe (WGC — hartkodiert)
- **Quelle:** World Gold Council (WGC) Gold Demand Trends, jährliche Publikation
- **Update-Zyklus:** Jährlich manuell im Code aktualisieren
- **Aktueller Wert:** `863 Tonnen` (WGC Full Year 2025, bestätigt)
- **Variable im Code:** `cbPurchases` in `gold-routes.ts`
- **Hinweis:** WGC hat keine öffentliche API. IMF IFS-Daten (via FRED `GOLDAMGBD228NLBM`) dienen nur als Preisreferenz, nicht als Mengendaten. Käufedaten kommen ausschließlich aus WGC-Jahresberichten.
- **Verwendung:** GIS-Indikator "Zentralbankkäufe", Gewicht 0.20

### 4.7 GPR-Index (Geopolitical Risk — hartkodiert)
- **Quelle:** Caldara & Iacoviello GPR Index (`matteoiacoviello.com`)
- **Update-Zyklus:** Halbjährlich manuell — keine öffentliche Echtzeit-API verfügbar
- **Aktueller Wert:** `155` (März 2026: erhöhtes geopolitisches Risiko durch Nahost + Asien)
- **Variable im Code:** `gprValue` in `gold-routes.ts`
- **Verwendung:** GIS-Indikator "Geopolitik (GPR)", Gewicht 0.15 (erhöht gegenüber früheren Versionen)

### Gold GIS-Berechnung
Der **Gold Indicator Score (GIS)** aggregiert 8 gewichtete Indikatoren:

| Indikator | Gewicht | Quelle |
|-----------|---------|--------|
| Zentralbankkäufe | 0.20 | WGC (hartkodiert) |
| ETF-Flows | 0.15 | WGC / hartkodiert |
| Realzinsen (DFII10) | 0.15 | FRED live |
| Geopolitik (GPR) | 0.15 | GPR-Index (hartkodiert) |
| Breakeven (T10YIE) | 0.10 | FRED live |
| DXY | 0.10 | Finance API live |
| Technisch (RSI+200DMA) | 0.10 | OHLCV berechnet |
| M2 YoY | 0.05 | FRED live |

**GIS-Bereich:** –1.0 (vollständig bearish) bis +1.0 (vollständig bullish)

---

## Sektion 5: BTC Dashboard

Das BTC-Dashboard läuft vollständig **client-seitig** (`client/src/lib/btcAnalysis.ts`). Alle API-Calls erfolgen direkt aus dem Browser.

### 5.1 BTC-Preis und Kursverlauf

**Primär: Blockchain.com API**
```
GET https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true
```
Liefert vollständige Tagespreishistorie seit 2009 (Genesis-Block). Timeout: 60 Sekunden.

**Fallback 1: CoinGecko Market Chart**
```
GET https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range
    ?vs_currency=usd&from=<5YearsAgo>&to=<now>
```
Wird aktiviert wenn Blockchain.com fehlschlägt. Liefert 5 Jahre Tagespreise.

**Aktueller Preis: CoinGecko Simple Price**
```
GET https://api.coingecko.com/api/v3/simple/price
    ?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true
```
Felder: `btcPrice`, `btcChange24h`, `btcMarketCap`

### 5.2 Power-Law Modell (Giovanni Santostasi)
Formel: **`Preis = 1.0117e-17 × DaysSinceGenesis^5.82`**
- `DaysSinceGenesis` = Tage seit 2009-01-03 (Bitcoin Genesis-Block)
- Support: `FairValue × 0.40`
- Resistance: `FairValue × 2.50`
- 6-Monats-Projektion: gleiches Modell mit `DaysSinceGenesis + 180`

Dieses Modell stammt vom Physiker **Giovanni Santostasi** und beschreibt den langfristigen BTC-Preispfad als Power-Law-Potenzfunktion der Zeit. Keine externe API — reine Berechnung.

### 5.3 MVRV Z-Score (approximiert — kein Glassnode-Zugang)

**Methode 1 (bevorzugt, wenn ≥200 Preisdatenpunkte):**
```
Realized Price ≈ 200-DMA × 0.92
MVRV = BTC-Preis / Realized Price
MVRV Z-Score = (MVRV − 1.45) / 1.15
```
- Kalibrierungsparameter aus Glassnode-Historik 2013–2025: Ø MVRV ≈ 1.45, σ ≈ 1.15
- Multiplier `0.92`: Realized Price liegt historisch ~8% unter dem 200-DMA

**Methode 2 (Fallback, <200 Datenpunkte):**
```
Realized Price ≈ Power-Law-FairValue × 0.62
```

**Hinweis:** Der echte MVRV Z-Score benötigt On-Chain-Daten (Glassnode, Coinmetrics — beide kostenpflichtig). Die hier verwendete 200-DMA-Approximation weicht typischerweise um ±0.08 vom echten Glassnode-Wert ab.

### 5.4 Halving-Daten (hartkodiert)
- **Letztes Halving:** `2024-04-20` (Block 840.000)
- **Nächstes Halving:** `~April 2028` (geschätzt, ~210.000 Blöcke)
- Zyklusphase wird aus `monthsSinceHalving` berechnet

### 5.5 Fear & Greed Index
```
GET https://api.alternative.me/fng/?limit=1       # aktuell
GET https://api.alternative.me/fng/?limit=2000     # Historie
```
- Quelle: alternative.me (kostenlose API)
- Felder: `value` (0–100), `value_classification`
- Historische Stats: 30d/90d/365d Durchschnitt, Jahreshoch/-tief

### 5.6 Hashrate (mempool.space)
```
GET https://mempool.space/api/v1/mining/hashrate/3m
```
90-Tage-Hashrate-Trend. Berechnung: `(currentHashrate − oldHashrate) / oldHashrate × 100`

### 5.7 Makro-Daten (FRED)
```
GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&cosd=2024-01-01
```
Liefert Federal Funds Rate (aktueller Leitzins). Letzter gültiger Wert wird verwendet.

### 5.8 DXY (Binance EURUSDT als Proxy)
```
GET https://data-api.binance.vision/api/v3/ticker/24hr?symbol=EURUSDT
```
DXY-Approximation aus EUR/USDT: `DXY ≈ 50.14348 + 55.274 × (1/EURUSD) + 3.7`
(Empirische Näherung basierend auf 57.6% EUR-Gewicht im DXY)

### 5.9 ETF Flows (Farside Investors via GitHub)
```
https://raw.githubusercontent.com/fadetocrypto/daily-crypto-reports/main/{YYYYMMDD}/ETF flow MM-DD-YYYY.md
```
Letzten 7 Tage werden parallel geprüft (inkl. Folgetag-Offset). Regex-Extraktion aus Markdown-Datei. Bei Fehler: `N/A`.

### 5.10 Monte Carlo GBM (BTC)
- **Methode:** Geometrische Brownsche Bewegung (GBM)
- **Tägliche Volatilität σ:** `0.025` (~2.5% täglich, ≈47.8% annualisiert)
- **Volatilitäts-Anpassung:** σ × 1.2 wenn >18 Monate nach Halving (späte Zyklusphase)
- **Drift μ:** aus GWS-Score abgeleitet (–0.001 bis +0.001/Tag)
- **Iterationen:** 10.000 GBM-Pfade (Box-Muller-Normalverteilung)
- **Zeithorizonte:** 90 Tage (3M), 180 Tage (6M)
- **Ausgabe:** P5, P10, P25, P50, P75, P90, P95 + Histogramm

### BTC GWS-Score (Global Weighted Score)
```
GWS = GIS × 0.30 + PowerSignal × 0.50 + CycleSignal × 0.20
```
| Komponente | Quelle | Gewicht |
|-----------|--------|---------|
| GIS (7 Indikatoren) | Diverse APIs | 30% |
| PowerSignal (Power-Law-Abweichung) | Berechnet | 50% |
| CycleSignal (Monate seit Halving) | Hartkodiert | 20% |

---

## Sektion 6: Rezessions-Dashboard

Das Rezessions-Dashboard (`POST /api/analyze-recession`, `server/recession.ts`) wertet **17 Indikatoren** aus, gruppiert in zwei Kategorien.

### 6.1 Rezessions-Indikatoren (7) — Quelle überwiegend FRED

| # | Indikator | Subgruppe | FRED-Serie | Quelle |
|---|-----------|-----------|------------|--------|
| 1 | **Sahm-Regel** | coincident | `SAHMREALTIME` | FRED live |
| 2 | **Inv. Zinskurve (10Y-2Y)** | coincident | `T10Y2Y` | FRED live |
| 3 | **PMI (Mfg+Serv Ø)** | coincident | `NAPM` (Fallback) | Finance API (`finance_macro_snapshot`) + FRED |
| 4 | **Durable Goods (YoY)** | leading | `DGORDER` | FRED live (36-Monats-Serie, YoY berechnet) |
| 5 | **M2 Geldmenge (YoY)** | leading | `M2SL` | FRED live (36-Monats-Serie, YoY berechnet) |
| 6 | **Kreditspreads (BAA-Trs)** | leading | `BAA10Y` (Fallback: `BAA`−`GS10`) | FRED live |
| 7 | **Konsumklima (CSI)** | full | `UMCSENT` | Finance API + FRED (Fallback) |

**FRED-Abruf:** Alle 7 Serien werden über `https://fred.stlouisfed.org/graph/fredgraph.csv` abgerufen. Zeitraum: letzte 24–36 Monate. Kein API-Key erforderlich.

**NY-Fed-Anker:** `RECPROUSM156N` (NY Fed Recession Probability, 12M) wird als 30%-Gewichtung in die 12-Monats-Rezessionswahrscheinlichkeit eingerechnet:
```
P(Rez 12M) = Formel × 0.70 + NY-Fed-Anker × 0.30
```

### 6.2 Korrektur-Indikatoren (10) — gemischte Quellen

| # | Indikator | Subgruppe | Quelle |
|---|-----------|-----------|--------|
| 8 | **Buffett-Indikator (TMC/GDP)** | valuation | currentmarketvaluation.com (primär) / Wilshire 5000 via `finance_quotes` + FRED `GDP` (sekundär) / GuruFocus (tertiär) |
| 9 | **Shiller CAPE** | valuation | multpl.com (primär) / currentmarketvaluation.com (sekundär) |
| 10 | **Margin Debt** | valuation | currentmarketvaluation.com (Web-Scraping der Meta-Description) |
| 11 | **Google Trends "Recession"** | sentiment_ext | Google Trends API via `pytrends` Python-Library (7-Tage-Schnitt, US) |
| 12 | **VIX** | sentiment | `finance_quotes` `^VIX` (primär) / FRED `VIXCLS` (Fallback) |
| 13 | **Advance-Decline-Line** | sentiment | `finance_market_sentiment` (Divergenz-Proxy) |
| 14 | **CNN Fear & Greed** | sentiment | CNN Business API `production.dataviz.cnn.io` (primär) / alternative.me Crypto F&G (Fallback) / `finance_market_sentiment` (tertiär) |
| 15 | **AAII Sentiment** | sentiment | `finance_market_sentiment` (primär) / FRED VIXCLS-Proxy (Fallback) |
| 16 | **CBOE Put/Call Ratio** | sentiment | `finance_market_sentiment` (primär) / VIX-Proxy (Fallback) |
| 17 | **Investors Intelligence** | sentiment | `finance_market_sentiment` (primär) / VIX-Proxy (Fallback) |

**Hinweis zu Sentiment-Proxies:** AAII, CBOE PCR und Investors Intelligence werden von ihren Originalanbietern aktiv blockiert (Bot-Schutz). Als letzte Instanz wird der VIX-Wert (FRED `VIXCLS`) als inverser Stimmungsindikator verwendet.

### Wahrscheinlichkeitsberechnung (5 Subgruppen)
```
P(%) = max(5%, min(95%, 50% + (NetScore / MaxScore) × 50%))
```
Gerundet auf nächste 5%-Schritte.

---

## Sektion 7: Researcher & Screener

### 7.1 13F Holdings — SEC EDGAR (kostenlos, kein API-Key)

**Investoren:** 14 Star-Investoren (Buffett/Berkshire, Dalio/Bridgewater, Ackman/Pershing Square, Tepper/Appaloosa, Einhorn/Greenlight, Loeb/Third Point, Klarman/Baupost, Halvorsen/Viking Global, Coatue, Tiger Global, Druckenmiller/Duquesne, Elliott, ValueAct, Icahn)

**Abruf-Schritte:**
1. `GET https://data.sec.gov/submissions/CIK{CIK}.json` — neueste Filings-Liste
2. Index der neuesten `13F-HR`-Einreichung ermitteln
3. XML-Informationstabelle (`infotable.xml`) aus dem Primärdokument parsen
4. Positionen parsen: `nameOfIssuer`, `cusip`, `value` (in Tausend USD × 1000), `shrsOrPrnAmt`

**Cache:** 24 Stunden (`SCREENER_CACHE_TTL = 24 * 60 * 60 * 1000`)

**Rate-Limit:** SEC erlaubt 10 Requests/Sekunde. Alle 14 Investoren werden parallel gefetcht.

### 7.2 Ticker-Resolver (Name → Ticker)

**Phase 1 — Static Map:** ~50 hartkodierte Einträge (AAPL, MSFT, AMZN, GOOGL, META, NVDA, TSLA u.v.m.). Kein API-Call, sofort.

**Phase 2 — FMP `/search-symbol` + `/search-name` (parallel):** Dynamischer Fallback für alle nicht aufgelösten Holdings. Bevorzugung: NYSE/NASDAQ vor anderen Börsen. Verarbeitung in Batches von max. 30, mit 120 ms Delay (≈8 Req/s, innerhalb FMP-Free-Limit).

### 7.3 Researcher Tabs (LLM-Synthese)

| Tab | Endpoint | Finance-Daten | LLM-Aufgabe |
|-----|----------|---------------|-------------|
| Macro Pulse | `/api/researcher/macro` | `finance_macro_snapshot` (US/EU/Asia) | Synthese & Ausblick |
| Sector Opportunity | `/api/researcher/sectors` | `finance_macro_snapshot` + Sektordaten | Scoring 12 Megatrends (1–10, Pflicht) |
| Undervalued Screener | `/api/researcher/screener` | FMP Batch-Quotes + Profile | Moat-Bewertung |
| Capex Tracker | `/api/researcher/capex` | `finance_macro_snapshot` regional | Fiskal-Programme zusammenfassen |

**LLM-Modell:** identisch mit Aktienanalyse (Grok 4.3 / Haiku 3.5)  
**Cache:** 7 Tage, Key: Tab + Eingabeparameter

---

## Sektion 8: Bekannte Einschränkungen

### Finance-API Tageslimit
Die Perplexity Finance API hat ein Tageslimit. Die genaue Zahl ist nicht dokumentiert — empirisch wurden bei intensiver Nutzung **~15–25 vollständige Aktienanalysen/Tag** beobachtet, bevor HTTP 429 zurückgegeben wird. Jede Vollanalyse verbraucht **7–8 Finance-Tool-Calls** (Quote, Profile, Financials, Analyst, Estimates, OHLCV, Segments, News). Bei Gold-, Rezessions- und BTC-Dashboard addieren sich weitere Calls. Der 7-Tage-Cache reduziert den Verbrauch für wiederholte Anfragen auf 0 Calls.

### MVRV approximiert (kein Glassnode)
Der MVRV Z-Score im BTC-Dashboard ist eine **Approximation**, keine On-Chain-Messung. Der echte MVRV-Z-Score erfordert Zugang zu Glassnode (kostenpflichtig, ab ~$29/Monat) oder CoinMetrics. Die 200-DMA × 0.92-Methode weicht historisch um ±0.08–0.15 Z-Score-Einheiten vom Glassnode-Wert ab — ausreichend für Trendeinschätzungen, nicht für Präzisionsanalyse.

### Zentralbankkäufe — jährlicher Update-Zyklus
Der WGC veröffentlicht **keine öffentliche API** für Zentralbankkäufe. Die Daten werden aus dem jährlichen WGC Gold Demand Trends Report manuell in `gold-routes.ts` (`cbPurchases`-Variable) aktualisiert. Zwischenzeitlich veröffentlichte Quartalszahlen (WGC Flash Estimates) fließen nicht automatisch ein.

### GPR-Index — halbjährliches manuelles Update
Der GPR Index (Caldara & Iacoviello) hat keine öffentliche Echtzeit-API. Er wird auf `matteoiacoviello.com` publiziert und alle **~6 Monate manuell** im Code (`gprValue` in `gold-routes.ts`) aktualisiert. Kurzfristige geopolitische Schocks werden nicht reflektiert.

### EU/APAC-Tickers — statische FX-Konvertierung
Für nicht-USD-Tickers (z.B. `.DE`, `.PA`, `.HK`, `.NS`, `.T`) werden Finanzkennzahlen mit **statischen Wechselkursen** in USD umgerechnet. Diese Rates werden täglich veraltet. Bei starken Währungsbewegungen können DCF-Bewertungen um 5–15% abweichen. Eine Live-FX-Konvertierung (via `finance_quotes` für Forex-Paare) ist für einzelne Calls implementiert, aber nicht systematisch für alle Finanzkennzahlen angewendet.

### AAII / CBOE / Investors Intelligence — Bot-Blockierung
Drei der zehn Korrektur-Indikatoren im Rezessions-Dashboard können ihre Originaldaten nicht direkt abrufen, da AAII, CBOE und Investors Intelligence externe Automations-Zugriffe aktiv blockieren. Als Fallback wird ein **VIX-basierter Proxy** (FRED `VIXCLS`) mit inverser Korrelationsannahme genutzt. Die Aussagekraft dieser drei Indikatoren ist in Marktphasen mit VIX-Extremen (VIX > 35 oder VIX < 12) eingeschränkt.

### Google Trends — `pytrends` Abhängigkeit
Der Google Trends-Indikator im Rezessions-Dashboard benötigt die Python-Library `pytrends`. Ist `python3` oder `pytrends` im Deployment nicht installiert, fällt der Indikator auf `N/A` zurück, und der Max-Score wird von 73.1 auf 61.2 reduziert.

---

*Dieses Dokument beschreibt den Stand der Datenarchitektur per Mai 2026. Bei Änderungen an Datenquellen oder Modellen bitte entsprechend aktualisieren.*
