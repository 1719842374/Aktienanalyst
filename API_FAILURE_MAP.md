# Stock Analyst Pro — API Failure Map

> Erstellt aus Quellcode-Analyse: `routes.ts` (L1–250, L3450–5800), `llm-openrouter.ts` (L1–505), `gold-routes.ts` (L1–130), `researcher.ts` (L994–1191)

---

## Dependency Layer 1: Perplexity Finance Connector (`external-tool`)

- **Was:** CLI-Binary `external-tool call '{"source_id":"finance","tool_name":"...","arguments":{...}}'`; wird via `execSync` aus dem Node-Prozess aufgerufen. Zugriff auf Kurspreise, Fundamentaldaten, Kurshistorie, Peer-Vergleiche, Ratios.
- **Aufruforte:** `routes.ts::callFinanceTool()` + `gold-routes.ts::callFinanceTool()` — jeweils mit 25 s Timeout, 50 MB maxBuffer, Shell-Escape für Single-Quotes.

### Failure Modes

| Code | Trigger | Erkannt? |
|---|---|---|
| `ENOENT` / `not found` / `No such file` | Binary fehlt im PATH (z.B. Railway-Deploy ohne Perplexity-Sandbox) | Ja → `{ __binaryMissing: true }` |
| `RATE_LIMITED` / HTTP 429 | Burst-Limit überschritten (z.B. viele parallele Ticker-Anfragen) | Ja → `{ __rateLimited: true }`, Retry-Backoff 4 s / 8 s |
| HTTP 401 `UNAUTHORIZED` | Token-Cooldown nach Rate-Limit | Ja → wird als `__rateLimited` behandelt (gleicher Backoff-Pfad) |
| Leere Antwort (leer / whitespace) | Tool läuft, gibt aber nichts zurück | Ja → `null` (H1-Fix) |
| Malformed JSON | Tool gibt ungültiges JSON zurück | Nein — `JSON.parse` wirft, fällt in generischen Catch → `null`; kein eigenes Log-Label |
| Timeout (>25 s) | Langsame Upstream-Antwort | Ja → `execSync` wirft, generischer Catch → `null` |
| Shell-Injection bei Sonderzeichen im Ticker | Ticker mit einfachen Anführungszeichen | Teilweise — nur `'` wird escaped; andere Shell-Metazeichen nicht |

### User Impact

Alle Sektionen der Stock-Analyse fallen bei Binary-Missing ohne FMP-Fallback vollständig aus:
- Sektion 1 (Quote / Stammdaten), Sektion 2 (Fundamentaldaten), Sektion 3 (OHLCV / Chart), Sektion 4 (Analysts), Sektion 5 (Peers / Ratios)
- Gold-Analyse vollständig (kein FMP-Fallback für Gold)
- BTC-Analyse: DXY-Datenpunkt fällt aus; Preis-Chart-Fallback auf Finance-Tool (fällt dann auch aus)

### Current Mitigation

1. **Binary-Missing:** `__binaryMissing`-Flag → sofortiger Sprung zu `getFmpFallbackData()` (routes.ts L3519–3548)
2. **Rate-Limited:** Throttled Wrapper mit `spacingMs=300 ms`, Retry 2×, Backoff 4 s / 8 s (routes.ts L70–94); in `gold-routes.ts` sync Backoff 4 s + 1 Retry
3. **Cache-Fallback:** Bei Rate-Limit-Exhaustion wird gecachte Analyse (bis zu 24 h alt) zurückgegeben, falls vorhanden (routes.ts L3527)

### Missing

- Kein Health-Check / Startup-Probe, der prüft ob das Binary vorhanden und authentifiziert ist
- Kein strukturiertes Monitoring / Alerting bei `__binaryMissing`-Events
- Malformed-JSON-Fehler werden nicht separat gezählt oder geloggt (kein distinktives Label)
- `gold-routes.ts` hat keinen FMP-Fallback — bei Binary-Ausfall ist die Gold-Analyse komplett tot
- Shell-Escape ist unvollständig (nur `'` → `'\''`); Ticker mit `$`, `` ` ``, `\` etc. könnten Probleme verursachen

---

## Dependency Layer 2: OpenRouter / Grok LLM

- **Was:** OpenRouter API (`https://openrouter.ai/api/v1`) via OpenAI-SDK mit `OPENROUTER_API_KEY`. Default-Modell: `x-ai/grok-4.1-fast` (bis 2026-05-15) → auto-switch zu `x-ai/grok-4.3`. Fallback-Modell: `anthropic/claude-3.5-haiku` bei `PREFER_GROK=0`.
- **Aufruforte:** `llm-openrouter.ts::generateCatalystsAndMatchNews()` (KI-Katalysatoren + News-Sentiment, Section 15), `llm-openrouter.ts::generateRiskExplanations()` (Risk Deep-Dive, Section 8), `researcher.ts::callLLMJson()` (Screener-Fallback, Macro-Pulse, Daily Briefing)

### Failure Modes

| Code | Trigger | Erkannt? |
|---|---|---|
| Key fehlt (`OPENROUTER_API_KEY` nicht gesetzt) | Deployment ohne Env-Var | Ja → `getClient()` gibt `null` zurück, Funktionen returnen sofort `null` (lazy singleton) |
| HTTP 429 Rate Limit | Token-Limit bei OpenRouter überschritten | Teilweise — generischer Catch, kein Retry im LLM-Layer |
| HTTP 404 Modell deprecated | `x-ai/grok-4.1-fast` nach 2026-05-15 | Teilweise — date-guard auto-switcht zu `grok-4.3` (kein manueller Override nötig), aber kein Fallback wenn `grok-4.3` auch nicht verfügbar |
| Malformed JSON in LLM-Response | Modell gibt kein valides JSON zurück | Ja — mehrere Validierungsschritte, bei Fehler `return null` |
| Timeout / Netzwerkfehler | OpenRouter nicht erreichbar | Ja → generischer Catch → `null` |
| Modell-Override führt zu unbekanntem Modell | Falscher Wert in `OPENROUTER_MODEL` | Nein — wird unvalidiert durchgereicht, Fehler erst zur Laufzeit |
| Kosten-Explosion bei langen Prompts | Viele SEC-Excerpts + News in einem Request | Kein Hard-Limit im Code; Prompts werden auf 1500 Tokens beschränkt (Soft-Cap) |

### User Impact

- **KI-Modus aus:** Katalysatoren fallen auf Sector-Template-Fallback zurück (vordefinierte Branchen-Katalysatoren statt company-spezifischer LLM-Katalysatoren)
- **Section 8 (Risk Deep-Dive):** Erklärungs-Texte fehlen — Risiko-Karten zeigen nur Struktur ohne narrative Erklärung
- **Section 15 (News-Sentiment):** News werden nicht mit Katalysatoren verknüpft; Sentiment-Scoring fehlt; `posAdjustment` bleibt 0
- **Researcher:** Screener-Fallback fällt aus (LLM-generierte Stock-Liste statt FMP-Daten); Macro-Pulse ohne LLM-Zusammenfassung; Daily Briefing ohne narrative Verdichtung
- `_useLLM: false` wird in Cache geschrieben, sodass KI-Off-Cache nicht für KI-On-Requests verwendet wird

### Current Mitigation

- Lazy singleton: fehlendes Key crasht nicht den Server
- Alle drei Export-Funktionen returnen `null` bei jedem Fehler → Caller hat definierte Fallback-Logik (Sector-Templates)
- `isLLMAvailable()` kann vor API-Call gecheckt werden
- Date-Guard in `pickModel()` switcht automatisch von deprecated Grok zu Nachfolger

### Missing

- Kein Retry bei 429 (Rate Limit) auf LLM-Ebene
- Kein separater Alert wenn `OPENROUTER_API_KEY` fehlt (nur `console.warn` beim ersten Call)
- `OPENROUTER_MODEL` Env-Override wird nicht validiert
- Kein Circuit-Breaker: bei anhaltenden OpenRouter-Ausfällen wird bei jeder Anfrage erneut versucht, was Latenz kostet
- Keine Kosten-Übersicht / Budget-Cap im Code

---

## Dependency Layer 3: FRED API (Gold, Recession, BTC-Macro)

- **Was:** St. Louis Fed FRED HTTP-Endpunkt `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>` — kein API-Key nötig, direktes CSV via `curl`. Series: `T10YIE` (Breakeven Inflation), `DFII10` (Real Rate), `M2SL` (M2 Money Supply), `FEDFUNDS` (Fed Funds Rate), `GOLDAMGBD228NLBM` (Gold/IMF).
- **Aufruforte:** `gold-routes.ts::fetchFREDSeries()` (15 s Timeout), `routes.ts` BTC-Endpoint (FEDFUNDS, inline curl)

### Failure Modes

| Code | Trigger | Erkannt? |
|---|---|---|
| Netzwerk-Timeout (>15 s) | FRED-Server überlastet oder nicht erreichbar | Ja → `try/catch → return null` |
| HTTP-Fehler / leerer Response | FRED-Wartung | Teilweise — leere CSV wird als 0 Datenpunkte gewertet, kein distinktives Error-Log |
| Veraltete Werte (`"."` statt Zahl) | FRED liefert Punkte für noch nicht gemeldete Perioden | Ja — Code überspringt `.`-Werte beim Rückwärts-Scan |
| Series-ID-Umbenennung / Deprecated | FRED benennt selten Series um | Nein — hard-coded IDs, keine Validierung |
| Rate-Limiting (anon, >120 req/min) | Viele parallele Gold/BTC-Analysen | Nicht explizit erkannt — landet in generischem Catch |

### User Impact

- **Gold-Analyse:** Breakeven-Rate, Real-Rate, M2-YoY fallen auf hartcodierte Fallback-Werte zurück (z.B. `2.34%`, `2.02%`); Analyse läuft, aber mit veralteten Makro-Inputs
- **BTC-Analyse:** Fed-Funds-Rate fällt auf Fallback `5.25%` zurück; Macro-Score-Berechnung wird ungenauer
- Keine direkte UI-Anzeige des Datenqualitäts-Problems

### Current Mitigation

- Alle Aufrufe in `try/catch`, Fallback auf statische Defaultwerte
- `M2SL` M2-YoY: eigener Try/Catch-Block mit Warn-Log und Fallback-Prozentsatz
- FRED-Daten sind supplementär (nicht primär für Gold-Preisberechnung)

### Missing

- Keine Staleness-Anzeige im UI wenn FRED-Fallback aktiv ist
- Keine Validierung ob FRED-Wert plausibel ist (z.B. Real Rate von 50% würde durchgereicht)
- Keine Unterscheidung zwischen FRED-Down (temporär) und falscher Series-ID (permanent)
- Kein Caching der FRED-Werte über Requests hinweg (bei jeder Gold-Analyse neuer Curl)

---

## Dependency Layer 4: FMP API (Fallback für Stock-Analyse)

- **Was:** Financial Modeling Prep REST-API (`https://financialmodelingprep.com/api/v3/...`) mit `FMP_API_KEY` Env-Var. Wird als primärer Fallback aktiviert wenn `external-tool` nicht verfügbar (`__binaryMissing`) oder nach Rate-Limit-Exhaustion.
- **Aufruforte:** `routes.ts::getFmpFallbackData()` — parallele `Promise.allSettled()` Calls: Quote, Profile, Income, CashFlow, BalanceSheet, PriceTarget, Grades, Estimates, HistoricalPrices, Segments, Peers, Ratios (12 parallele Requests)

### Failure Modes

| Code | Trigger | Erkannt? |
|---|---|---|
| `FMP_API_KEY` fehlt | Deployment ohne Env-Var | Ja → `isFmpAvailable()` gibt `false`, `getFmpFallbackData()` gibt `null` + Warn-Log |
| HTTP 401 / ungültiger Key | Key falsch oder abgelaufen | Teilweise — `Promise.allSettled` verschluckt es; Quote-Check `!quote?.price` fängt es als `null` |
| HTTP 429 Rate Limit | FMP Free-Tier: 250 Calls/Tag | Nein — kein explizites Rate-Limit-Handling im FMP-Layer |
| Quote-Daten leer | Ticker auf FMP nicht bekannt (OTC, ausländische Börse) | Ja → frühes `return null` mit Warn-Log |
| Teilausfälle einzelner Endpoints | FMP-Partialausfall | Ja — `Promise.allSettled` gibt `null` für fehlgeschlagene Calls; Code hat `|| []`-Guards |
| FMP Free-Tier hat kein `segments`-Endpunkt | Plan-Limitation | Nein — kein Plan-Check, nur stilles `[]` |

### User Impact

Wenn FMP-Fallback ebenfalls ausfällt (kein Key + Binary-Missing):
- Kompletter Ausfall der Stock-Analyse mit HTTP 503 / `RATE_LIMITED`-Fehlerseite
- Gecachte Analyse wird als letzter Ausweg serviert, wenn vorhanden

Bei FMP aktiv aber Partial-Failure:
- `segments` (Revenue-Segmentierung), `peers` (Peer-Vergleich), `ratios` (historische Ratios) können fehlen → entsprechende Sektionen zeigen `[]`-Daten oder entfallen

### Current Mitigation

- `Promise.allSettled` verhindert dass ein einzelner FMP-Fehler den ganzen Fallback killt
- Quote-Prüfung (`!quote?.price`) als Gesundheitscheck
- Fallback-Kette: `external-tool` → FMP → Cache → HTTP 503

### Missing

- Kein Retry bei FMP-429 (Rate Limit)
- Keine Unterscheidung welche FMP-Endpoints Plan-bedingt fehlen
- `fmpKeyMetrics` ist importiert, aber in `getFmpFallbackData()` nicht aufgerufen (potentiell fehlende Daten für Section 6)
- Kein Monitoring wie oft FMP-Fallback aktiv ist
- FMP Free-Tier-Limit (250 Calls/Tag) könnte bei vielen Usern schnell erreicht sein — kein Counter

---

## Dependency Layer 5: CoinGecko / alternative.me (BTC-Analyse)

- **Was:**
  - **CoinGecko:** `https://api.coingecko.com/api/v3/simple/price` + `/coins/bitcoin/market_chart/range` — kein API-Key (Demo-Tier), direkt via `curl`
  - **alternative.me Fear & Greed:** `https://api.alternative.me/fng/?limit=1` + `?limit=365` — kein API-Key
- **Aufruforte:** `routes.ts` BTC-Endpoint, Sektion 1 (aktueller Preis), Sektion 14 (historische Preisdaten 5Y), Sektion 17 (Fear & Greed historisch)

### Failure Modes

| Code | Trigger | Erkannt? |
|---|---|---|
| CoinGecko 429 (Demo-Tier: 30 req/min) | Mehrere BTC-Anfragen innerhalb einer Minute | Teilweise — `try/catch`, `btcPrice` bleibt 0; Analyse läuft mit `price=0` weiter |
| CoinGecko liefert unvollständige Chart-Daten | API Partial-Response bei großem Zeitfenster | Teilweise — 5Y-Chunk-Strategie mit 1Y-Fallback bei `allPriceData.length === 0` |
| alternative.me API down | Service-Ausfall | Ja → `try/catch`, `fearGreedIndex` bleibt 50 (neutral) |
| CoinGecko API down | Service-Ausfall | Teilweise — `btcPrice=0` propagiert; GIS/GWS/MC-Berechnungen mit Preis 0 sind wertlos |
| Demo-Tier wird abgeschaltet oder Key-Pflicht | CoinGecko Policy-Änderung | Nein — kein Key konfiguriert; würde sofort zu 401-Fehlern führen |

### User Impact

- **BTC-Preis = 0:** Alle Score-Berechnungen (Power-Law, GIS, GWS, Monte-Carlo) werden mit Nullwert berechnet — Ergebnis ist unbrauchbar, aber es gibt keine Fehlerseite
- **Fear & Greed = 50:** Neutral-Fallback ist akzeptabel, aber nicht gekennzeichnet
- **Historische Chartdaten fehlen:** MA50/MA200, EMA, RSI können nicht berechnet werden; Chart-Sektion fällt aus

### Current Mitigation

- 5Y-Chunk-Strategie (zwei separate Zeitraum-Abrufe) reduziert 429-Risiko
- 1Y-Fallback bei leerem 5Y-Ergebnis
- Finance-Tool (`get_stock_chart BTC-USD`) als dritter Fallback für Preis-History (L5244)
- Statische Defaults für Fear & Greed und Fed-Funds-Rate

### Missing

- `btcPrice=0` sollte einen frühen Error-Return mit Fehlermeldung auslösen, statt defekte Analyse zu liefern
- Kein CoinGecko API-Key (Pro-Tier) — Demo-Tier ist nicht für Produktionslast geeignet
- Kein Rate-Limit-Tracking über Requests hinweg (kein Request-Queue für CoinGecko)
- alternative.me ist ein inoffizieller Drittanbieter ohne SLA

---

## Dependency Layer 6: SEC EDGAR (Stock-Analyse 10-K + Screener 13F)

- **Was:**
  - **10-K Filings:** `https://data.sec.gov/submissions/CIK{n}.json` + `https://www.sec.gov/Archives/edgar/data/...` — kein API-Key, Public REST API
  - **13F Holdings (Screener):** `https://data.sec.gov/submissions/CIK{n}.json` + EDGAR XML-Informationstabellen für Star-Investor-Portfolios (Buffett, Ackman, etc.)
- **Aufruforte:** `routes.ts` L4131–4244 (10-K für KI-Kontext), L5578–5741 (13F-Screener)

### Failure Modes

| Code | Trigger | Erkannt? |
|---|---|---|
| HTTP 429 (Rate Limit: 10 req/s) | Zu viele parallele 13F-Abrufe | Teilweise — `fetch13FHoldings` hat eigenen Try/Catch → leeres Array, kein Retry |
| CIK nicht gefunden | Unbekannter Ticker oder nicht-US-Unternehmen | Ja → leere Holding-Liste, kein Crash |
| 13F-HR Filing nicht vorhanden | Investor hat keine 13F-Pflicht (< $100M AUM) | Ja → `latestIdx === -1` → leeres Array |
| Veraltetes 13F (quartalsweise) | Daten sind bis zu 135 Tage alt | Nein — kein Staleness-Hinweis im UI |
| XML-Parsing-Fehler | Unerwartetes EDGAR-Format | Ja → Try/Catch → leere Ergebnisliste |
| EDGAR-Wartung / Down | Geplante Wartungsfenster (nachts ET) | Ja → Try/Catch → leere Ergebnisliste |
| 10-K Parsing schlägt fehl | Unstrukturiertes Filing-Format | Ja → `secErr`-Catch, kein Crash, aber `keyProjects=[]` und `secFilingExcerpts=[]` |

### User Impact

- **10-K fehlt:** LLM erhält weniger Kontext → Katalysatoren sind generischer (aber Analyst läuft durch)
- **13F-Screener fehlt:** Star-Investor-Tab zeigt leere Listen; FMP-Ticker-Resolver (`fmpSearchTicker`) als Fallback für unaufgelöste Ticker-Namen
- Bei vollständigem EDGAR-Ausfall: Screener liefert 0 Holdings → leere Tabelle im UI

### Current Mitigation

- Alle EDGAR-Calls in Try/Catch → graceful Degradation
- In-Flight-Deduplication im Researcher-Layer (verhindert Parallel-Builds für gleichen Key)
- `withProxyGuard` (25 s) verhindert Client-Timeouts; 202-Response mit Retry-Hinweis
- 90 s Hard-Timeout auf Build-Ebene
- Error-Marker wird in Cache geschrieben bei Fehler (FM2-Fix), verhindert endlose Retries

### Missing

- Kein explizites Rate-Limit-Tracking für EDGAR (10 req/s-Limit)
- Kein Retry mit Backoff bei 429 von EDGAR (nur sofortiger Fehler-Return)
- Kein Staleness-Badge im UI für 13F-Daten (Quartalsdaten können 135 Tage alt sein)
- 13F-Resolver-Limit: nur 30 unaufgelöste Ticker werden via FMP gesucht (L5741)
- Kein Monitoring wie oft EDGAR-Calls fehlschlagen

---

## Summary Table

| Dependency | Failure Probability | User Impact (1-10) | Has Fallback? | Monitor? |
|---|---|---|---|---|
| Perplexity Finance Connector (`external-tool`) | **High** (Rate-Limit häufig, Binary-Missing bei Railway) | **9** — Kernfunktion der Stock-Analyse | Ja — FMP-Fallback + Cache | Nein (nur console.error) |
| OpenRouter / Grok LLM | **Medium** (Key-Rotation, Modell-Deprecation) | **6** — KI-Modus, Section 8 + 15, Researcher-Narrative | Teilweise — Sector-Template-Fallback; kein LLM-Retry | Nein (nur console.warn) |
| FRED API (Gold, Recession, BTC) | **Low** (freier Gov-Service, hohe Uptime) | **3** — Makro-Inputs, statische Fallbacks vorhanden | Ja — hartcodierte Defaults | Nein |
| FMP API (Stock-Fallback) | **Medium** (Free-Tier 250 Calls/Tag leicht erreichbar) | **8** — letzter Rettungsanker wenn external-tool down | Ja — nur Cache als weiterer Fallback | Nein (nur console.warn) |
| CoinGecko / alternative.me (BTC) | **Medium** (Demo-Tier Rate-Limits bei Last) | **7** — komplette BTC-Analyse bei Preis=0 wertlos | Teilweise — Finance-Tool-Fallback für History; keine Preis-Alternative | Nein |
| SEC EDGAR (10-K + 13F) | **Low** (freier Gov-Service, aber Rate-Limits) | **4** — LLM-Kontext ärmer; Screener leer; Analyse läuft durch | Teilweise — graceful Degradation, FMP-Ticker-Resolver | Nein |

### Bewertungslegende

- **Low** — Ausfälle selten (<1×/Woche), hohe externe Uptime
- **Medium** — Rate-Limits oder Key-Management-Fehler realistisch (mehrmals/Woche möglich)
- **High** — Strukturelles Problem (Binary-Deployment, Burst-Traffic) — tritt regelmäßig auf
- **Critical** — Würde Service komplett unbrauchbar machen (derzeit kein Dependency auf diesem Level)

---

## Priorisierte Handlungsempfehlungen

1. **[Kritisch] Health-Check für `external-tool` beim Serverstart** — bindet keine Requests, spart stille Degradation
2. **[Hoch] FMP-Rate-Limit-Counter** — Free-Tier (250/Tag) wird bei mehreren Usern schnell erreicht; Pro-Plan oder Zähler nötig
3. **[Hoch] CoinGecko Pro-Key** — Demo-Tier nicht produktionstauglich; `btcPrice=0`-Guard fehlt
4. **[Mittel] LLM-Retry bei 429** — aktuell kein Retry im OpenRouter-Layer
5. **[Mittel] FRED-Wert-Validierung** — Plausibilitätsprüfung für Makro-Werte (z.B. Real Rate > 20% = Fehler)
6. **[Mittel] 13F-Staleness-Badge im UI** — User sehen nicht, dass Daten bis zu 135 Tage alt sein können
7. **[Niedrig] Structured Logging / Alerting** — alle Failure-Pfade loggen nur `console.error/warn`; kein Monitoring-Hook
