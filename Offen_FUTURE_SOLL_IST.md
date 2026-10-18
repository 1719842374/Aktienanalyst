> Aktueller Soll-Ist im Detail (alle 11 Future-Dateien, Stand 18.10.2026 auf `35ead515`): siehe [`Offen_FUTURE_SOLL_IST_DETAIL.md`](Offen_FUTURE_SOLL_IST_DETAIL.md). Der Inhalt unten ist der Stand vom 11.10.2026.

# Offen — Future Soll/Ist (main)

**Geprüft gegen:** `origin/main` `5849ed15a956388fea2259f166a303c16fa6ed69`  
**Commit-Betreff:** `docs: document Peer-Add bug …`  
**Datum:** 11.10.2026  
**Art:** Inventur. Kein App-Code in diesem PR.

Datenfluss der Ist-Prüfung: UI `client/src` → Hooks → API-Route → `server/` → Quelle bzw. `shared/schema.ts` (Gold: `shared/gold-schema.ts`, Regionen: `shared/recession-regions.ts`).

`fertig_` / `Fertig_` werden hier nicht zurück auf `Offen_` gesetzt. Dieses Dokument ist die neue Soll-Ist-Liste für die noch offenen Future-Specs.

---

## Nicht anfassen (Überschneidung)

| Ticket | Stand auf main | Was schon live ist | Diese Inventur |
|--------|----------------|--------------------|----------------|
| **#193** `fe6de616` | auf main, Vorfahr von `5849ed15` | Buffett-Chart: Wilshire `^W5000` × `WILSHIRE_DOLLARS_PER_POINT_BN = 1.05`, Log-Trend, ±1σ/±2σ, Zeitfenster. Scoring-Slot: Yahoo-Close × 1,05 / FRED `GDP`, Fallback Weltbank `DDDM01USA156NWDB`. Margin Debt: FINRA-xlsx, YoY gegen **z5y**, nicht die alte Rohzone +2. | Nicht nachbauen. Offene Reste stehen bei Future_1 §14/§21. |
| **#195** | Draft-PR offen, nicht auf main | Nur UI: `RegionRsiPanel.tsx` Vol/RSI/MACD-Tooltips auf Theme-Tokens. Kein Scoring, keine API. | Datei nicht anfassen. Chart-Konsolidierung (Future_1 §16) erst nach Merge von #195 oder ohne diese Datei. |

---

## Env-Keys (querschnitt)

| Key | Gebraucht für | Ist |
|-----|---------------|-----|
| `FMP_API_KEY` | Aktien-Fallback, Teile der Makro-/Region-Reads | Pflicht laut `server/index.ts`. 402 wird als `FMP_UPSTREAM_ERROR` durchgereicht (`server/fmp.ts`, `server/analyze-helpers.ts` `fmpFallbackFailureResponse`). |
| `OPENROUTER_API_KEY` | Aktien-LLM, Researcher, Value-Chain, Policy, Thesis, Management | `server/llm-openrouter.ts`. **Nicht** an Rezessions-Gewichte oder Gold-News gekoppelt. |
| `SERPAPI_KEY` oder `SERPAPI_API_KEY` | Google Trends „Recession“ | Nur `server/recession.ts` `scoreGoogleTrends`. Ohne Key: Slot N/A. |
| `REDIS_URL` / `VALUECHAIN_REDIS_URL` | optionales Value-Chain-Rate-Limit | `server/valuechain-redis-ratelimit.ts`. Kein Trends-Cache. |
| Yahoo | kein Key | `yahoo-finance2` ist **nicht** in `package.json`. Wilshire/VIX-Chart gehen über rohes `fetch` auf `query1.finance.yahoo.com`. |
| FRED | kein Key | CSV `fredgraph.csv`. |

Render: Dateisystem flüchtig, Free-Webservice schläft ein. Ein reiner In-Memory-Cache (Future_5) überlebt keinen Neustart. `ioredis` liegt in `package.json`, ist für Trends nicht verdrahtet. Bestehendes Muster ist `server/disk-cache.ts` (ebenfalls flüchtig auf Render).

---

## Status kompakt

| Datei | Status | Score-Risiko | Nächster Schnitt |
|-------|--------|--------------|------------------|
| `Future_Work.md` | **teilweise** (Peer-Add Rest; Rest gemischt) | Peer: keines. Gold/BTC-Overlays: keines, solange kein Score. Adaptive Layer: hoch. | Mini-PR 1 Peer-Rest |
| `Future_1_Work.md` | **teilweise** | Yahoo-Fallback ändert, welche Ticker Daten liefern. Regionale Gauges ändern die Anzeige, nicht die US-Handlung. | Mini-PR 4, 6, 7 |
| `Future_2_NA_Fixes_Research.md` | **teilweise** | VIX/VSTOXX-Fallback füllt heute leere Slots und ändert P. | Mini-PR 2 und 5 |
| `Future_3_SerpApi_Rate_Limits.md` | **teilweise** (Doku-Diagnose; Cache fehlt) | Last-Good-Wert ändert P gegenüber „Slot raus“. | zusammen mit 4 und 5 → Mini-PR 2 |
| `Future_4_Google_Trends_Conflict_and_Fixes.md` | **teilweise** | wie Future_3 | Mini-PR 2 |
| `Future_5_Google_Trends_Cache_Implementation.md` | **offen** (Code-Skizze, nicht im Baum) | wie Future_3 | Mini-PR 2 |
| `Future_6_Recession_Dashboard_Scoring_Logic.md` | **nur Doku** (Ist-Erklärung, Stand 09.10.) | keine Umsetzung aus dieser Datei | keine eigene PR |
| `Future_7_Scoring_Adaptivity_Historical_Crashes.md` | **nur Doku** + Empfehlung offen | Perzentil/z-Score ändert P stark | Mini-PR 10, nach den Datenfeeds |
| `Future_8_Adaptive_Scoring_Logics_Detailed.md` | **nur Doku** + Empfehlung offen | wie Future_7 | eine PR mit Future_7 |
| `Future_9_Adaptive_Macro_Framework_Complete.md` | **offen** (Konzept) | Layer + LLM ±25 % ändert P | Mini-PR 11, nach 10 |
| `Future_10_Gold_Adaptive_Scoring_Framework.md` | **teilweise** (Basis-Modell live, adaptive Schicht offen) | Overlays: keines. Layer/News-Flag: hoch | Mini-PR 3, dann 12 |

---

## Future_Work.md

Roadmap vom 11.10.2026, inklusive Peer-Add-Bug im selben Commit `5849ed15`.

### (a) Umsetzbare Soll-Punkte

1. Peer hinzufügen analog `TickerSearch`: sofortiger Analyse-Call, Loading, Persistenz über Reload, Cache-Key mit normalisierten Overrides.
2. i18n DE/EN für das Dashboard.
3. Industrie-Wertschöpfungskette mit LLM; Sektorrotations-Rat / Kostolany-Rad.
4. Volle bidirektionale Sync Analyse ↔ Researcher ↔ Portfolio.
5. BTC: M2/Fiscal-Overlay, Miner-Kapitulation, WALCL/QE-QT.
6. Gold: AISC als Dauersignal, Multi-Faktor WALCL+DXY, News, 50/200-MA und Volumen.
7. Monte-Carlo-Parameter flexibel; Segment-Dedup; „konsistente Formeln“ (ohne Formel-Diff).
8. Google-Trend-Score fixen; adaptive Layer-Gewichtung.
9. Fazit als Konfliktmatrix.

### (b) Ist auf `5849ed15`

**Peer-Add — teilweise, Bug bleibt.**

- UI: `client/src/components/sections/PeerComparison.tsx` `handleAdd` schreibt nur `onOverridesChange`. Kein Autocomplete, kein eigenes Loading. Plain `<input>`.
- Parent: `client/src/pages/Dashboard.tsx` hängt an Sektion „Rel. Bewertung“ (`Section7`) und ruft `startAnalyze({ force: true, peerOverrides })`. Der erste POST enthält `peerOverrides`.
- Lücke: der `_pending`-Poll in derselben Mutation (`POST /api/analyze` mit `force: false`) sendet **keine** `peerOverrides`. Ein Lauf über 22 s liest damit den Cache ohne Add.
- Persistenz: Overrides kommen aus `data.activePeerOverrides` der Response. Kein `localStorage` für Peers. Reload startet ohne Overrides.
- Server: `server/analyze-route.ts` nutzt `normalizePeerOverrides`, `buildAnalyzeCacheKey`, `applyPeerOverrides` aus `server/peer-cache-key.ts`. Listen werden sortiert und dedupliziert. Der alte Key-Bug ist behoben. Es gibt keinen Lightweight-Peer-Endpoint.

Die Doku in Future_Work („Parent ruft nicht neu“) ist damit **enger als der Code**: der Trigger existiert, Poll und Reload nicht.

**Andere Punkte**

- i18n: kein `i18next` / Sprachumschalter.
- Wertschöpfungskette: `client/src/pages/ValueChainDashboard.tsx`, `server/valuechain-routes.ts`, LLM `enrichValueChainStages` in `server/llm-openrouter.ts`. Basis ist live. Kostolany-Rad als eigene UI: nicht vorhanden. Sektor-Route: `server/researcher-sector-rotation-route.ts` (nicht das Rad).
- Sync: Analyse-Cache `server/disk-cache.ts` (7 Tage), Researcher 1 Tag, Portfolio `localStorage` (`client/src/lib/portfolio/positions.ts`). Keine bidirektionale Kopplung.
- BTC M2: live in `client/src/pages/BTCDashboard.tsx` (`showM2Yoy`, absolut, Lag). Fiscal: `GET /api/analyze-btc/fiscal-frontend` (`server/btc-routes.ts`, `server/fiscal-frontend.ts`), UI `client/src/components/btc/StablecoinLiquidityPanel.tsx`, Score in `client/src/lib/btcAnalysis.ts`. Miner-Zonen: `server/btc-miner.ts` (`capitulation` / Puell / Hash Ribbons). WALCL als BTC-Chart-Overlay: nicht in `BTCDashboard.tsx`. Liquiditätsindex ist das Researcher-Panel (#190), nicht dieses Overlay.
- Gold: siehe Future_10. MA200-Linie ist schon im Chart. AISC ist ein Gate, kein kontinuierliches Signal. News-Sektion fehlt.
- Monte-Carlo: `GoldMonteCarloSection`, GBM in `server/gold-routes.ts`. Keine Nutzer-Regler in der Spec konkretisiert.
- Segment-Dedup: `server/sec-segments.ts` existiert. Kein benanntes Dedup-Kriterium in der Spec.
- Google Trends / adaptive Layer: siehe Future_3–5 und Future_7–9.
- Konfliktmatrix: Aktien-Fazit ist Verdict-Text (`server/exec-summary.ts`, `server/pdf-export.ts`). Rezession: `generateFazit` in `server/recession.ts`. Keine Konfliktmatrix-Komponente.

### (c) Status

**Teilweise.** Peer-Add ist der einzige harte Bug mit klarem Rest. Mehrere „offen“-Zeilen der Roadmap sind Basis-live (Value Chain, BTC-M2, Fiscal, Miner, Gold-MA200, Multi-Faktor).

### (d) Abhängigkeiten

Peer: keine neuen Keys (`FMP_API_KEY` / `OPENROUTER_API_KEY` nur, weil die volle Analyse sie schon braucht). Trends: `SERPAPI_KEY`. Gold-News / adaptive LLM: `OPENROUTER_API_KEY`.

### (e) Risiko

Peer-Rest: kein Score, kein Breaking der Formel. Cache-Key bleibt. Gold-MA-Overlay: kein Score. Adaptive Layer und Konfliktmatrix: Score- bzw. Fazit-Änderung, nicht in denselben PR.

### (f) Mini-PR

**PR 1 — Peer-Add-Rest.** Poll muss `peerOverrides` mitsenden. Overrides über Reload halten (Client-State oder `localStorage`, an den nächsten Analyse-Body hängen). Loading am bestehenden Dashboard-Retry sichtbar lassen. Autocomplete nur, wenn `TickerSearch` ohne Verhaltensänderung wiederverwendbar ist. Kein zweiter Endpoint.

---

## Future_1_Work.md

FMP-402, Yahoo, Dividenden-Plot, Credit, Buffett, Chart-Bündel, regionale Gauges, N/A-Katalog. Stand Spec 09.10.2026.

### (a) Umsetzbare Soll-Punkte

1. Kette: Perplexity → FMP → **Yahoo nur bei FMP-Fehler, besonders 402** → klarer Frontend-Fehler. Neue Datei `server/yahoo-fetcher.ts`. Mapping nur Kurs, Market Cap, PE, EPS, History. Cache und Rate-Limit. Tests: `VOW3.DE`, `BMW.DE`, `SAP.DE` fallen auf Yahoo; `AAPL` bleibt auf FMP; ungültiger Ticker crasht nicht.
2. Frontend-Text bei 402: Plan deckt das Symbol nicht, Fallback aktiv bzw. warum nicht.
3. `.DE` nicht auf ein anderes Listing auflösen.
4. Dividendenrendite: KPI in Sektion 1, Overlay in `TechnicalChart.tsx` (Sektion 10), nur wenn Dividende > 0. Historische Yield = Dividende / Kurs.
5. Credit-Risiko (5Y-CDS, lange Bond-Yield, Rating) in Sektion 8, optional Stress in Sektion 6. Quelle ist **nicht** frei auf FMP/Yahoo.
6. Buffett robuster: Retry, `period2` aktuell, letzter Punkt für die Annotation, Fehlertext statt generischer roter Box, Fehler nicht cachen. Globalisierung: Foreign-Revenue nicht hardcoded, optional LLM, Fallback markieren.
7. Eine Chart-Sektion Rezession: Preis + RSI + MACD + VIX/VSTOXX, dann Buffett, Credit, Kurve. Leerer Overlay blendet sich aus.
8. Buttons US / Europa / Asien schalten die fünf Gauges, Tabelle, Top-3. Aggregat 0,70/0,20/0,10 und US-Handlung bleiben. Zu viele N/A → Hinweis, kein erfundener Wert.
9. N/A-Katalog EZ/JP/Charts schließen oder als N/A lassen, ohne Netto/Max zu verzerren.

### (b) Ist

**Yahoo / 402 — offen.**

- `yahoo-finance2` fehlt. Kein `server/yahoo-fetcher.ts`.
- `fmpFallbackFailureResponse` liefert exakt `FMP-Fehler HTTP ${fmpStatus} für ${ticker}.` Dashboard zeigt diese Meldung unter „Analyse fehlgeschlagen“.
- 402 ist kein eigener `errorCode`, sondern `FMP_UPSTREAM_ERROR`.

**Dividende — teilweise, Plot offen.**

- `dividendYield` sitzt in `server/fmp-fetcher.ts` und `server/analyze-route.ts` (Lynch/PEGY). Kein Yield in `client/src/components/sections/TechnicalChart.tsx`.

**Credit — offen.**

- Einziger Credit-Spread im Rezessionspfad: FRED `BAA10Y` (`scoreCreditSpreads` in `server/recession.ts`). Kein CDS-, Rating- oder Einzelemittenten-Bond-Feld in `shared/schema.ts`.

**Buffett — #193 erledigt den US-Chart und den FINRA-Score. Reste offen.**

- Live-Chart: `GET /api/analyze-recession/buffett` in `server/buffett-route.ts`. US: Yahoo `^W5000`, `period2 = now + 86400`, Timeout 25 s, Abbruch unter 500 Bars, Financial-Accounts-Splice, Log-Trend. EU/CN: Weltbank-Jahresquoten `DDDM01EZA156NWDB` / `DDDM01CNA156NWDB`, **nicht** STOXX/TOPIX/VGK/ASHR. Cache 6 h, nur bei nicht-leerer Reihe. Fehler: HTTP 502 `Buffett-Quote nicht verfügbar`, kein Retry-Loop.
- UI: `client/src/components/recession/BuffettRatioPanel.tsx`.
- Scoring-Slot: `scoreBuffett()` in `server/recession.ts`, Zonen weiter fest (`buffettReading`: >200 → +16, 165–200 → +10, 140–165 → +4, <140 → −8, Gewicht ×2).
- `server/buffett-ratio.ts` `buildBuffettSeries` rechnet `foreignShare` / `geoPct` aus Gewinnreihen, **ohne** LLM. Aufrufer: nur `script/test-buffett-ratio.ts`. Die Route und der Score nutzen das nicht.
- Kein OpenRouter-Call für φ.

**Chart-Bündel — teilweise, nicht eine Sektion.**

`client/src/pages/RecessionDashboard.tsx`: Katalog Sektion 8, `RecessionRsiSection` 9, `RecessionMarketChartsSection` 10 (Preis/RSI/MACD/VIX je Region, `server/recession-markets.ts`), Buffett 11. Kein gemeinsames Pane mit Buffett + Credit + Kurve. VIX-Chart: FRED `VIXCLS`, kein Yahoo-Fallback. VSTOXX: FMP, dann STOXX `h_v2tx.txt` (`server/recession-markets.ts`).

**Regionale Gauges — teilweise.**

- Backend-Katalog: `server/recession-regions.ts`, Gewichte 0,70/0,20/0,10, N/A-Slots mit `closedSlot` (weder Netto noch Max). UI-Satz in `RegionalCatalogSection.tsx`: Handlung bleibt auf den US-Büchern.
- Die fünf Haupt-Gauges (Sektion 1) haben **keinen** `selectedRegion`. Sie lesen die US-Pipeline aus `runRecessionAnalysis`.
- EZ-Kurve, EZ-HY, Japan-ALQ/Kurve/Aktivität/Spreads/CAPE/JNVI: Slots existieren und werden geschlossen, wenn der Print leer ist. Die Spec-Tabelle „alles N/A“ ist damit ein Datenstand, kein fehlender Slot. Ob die FRED-Serien am 11.10. live Zahlen liefern, ist hier nicht neu abgefragt.

### (c) Status

**Teilweise.** #193 schließt den US-Buffett-Chart, den Wilshire-Faktor und FINRA-z5y. Yahoo, Dividenden-Plot, CDS, Gauge-Umschalter, EU/Asien-Benchmark und die eine TA-Sektion sind offen.

### (d) Abhängigkeiten

`FMP_API_KEY` für den Primär-/Fallback-Pfad. Yahoo ohne Key. Credit ohne freie API. Buffett-LLM wäre `OPENROUTER_API_KEY` und ist nicht der erste Schnitt. Regionen: FRED ohne Key, VSTOXX ohne SerpApi.

### (e) Risiko

Yahoo bei 402: deutsche Ticker, die heute 502 sind, liefern eine **dünne** Analyse. Das ist gewollt und muss im UI als Teilabdeckung stehen, sonst sieht es nach vollem Faktenset aus. Gauge-Umschalter: Anzeige ändert sich, US-Handlung nicht, wenn der Soll-Satz eingehalten wird. Buffett-Formel umbauen: Score-Änderung — nicht mit #193 vermischen. Chart-Bündel: UI, Kollision mit #195.

### (f) Mini-PRs

- **PR 4** Yahoo nur bei `fmpStatus === 402` (und klarem Upstream-Fail), plus Satz im Fehler/Erfolg „Plan-Limit, Yahoo-Kurs/History“. Kein Fundamentals-Ersatz.
- **PR 6** Gauge-Umschalter auf vorhandene Katalog-P. US-Default. Hinweis bei vielen N/A.
- **PR 7** Dividenden-Overlay nur mit vorhandener Serie (FMP-Historie oder später Yahoo). Punkt-KPI kann früher, wenn `dividendYield` schon in der Analyse-Response liegt.
- **PR 8** Chart-Panes erst ohne `RegionRsiPanel.tsx` (#195).
- **PR 9** Buffett-Rest: EU/CN-Benchmark **oder** `buildBuffettSeries` an die Route hängen, nicht beides, nicht die 1,05-Konstante anfassen. LLM-φ weglassen.

---

## Future_2_NA_Fixes_Research.md

Recherche, kein eigenes Feature neben Future_1 und Future_3–5.

### (a) Umsetzbare Soll-Punkte

1. Trends: 6–12 h Cache, bei Fehler letzten Wert, UI-Alter > 24 h.
2. VIX: FRED `VIXCLS`, Fallback Yahoo `^VIX`.
3. VSTOXX: Yahoo `^V2TX` oder `V2TX.DE` statt FMP-first.
4. EZ-Kurve: `IRLTLT01EZM156N` validieren, sonst ECB.
5. Buffett-Retry (siehe #193 / Future_1).
6. SPY PE/EPS: Yahoo `quoteSummary`, wenn FMP leer.

### (b) Ist

- Trends: siehe Future_3–5. Kein Cache, kein Last-Good.
- VIX-Score: `vixReading` / `getLatestFredValue("VIXCLS")`. Kein `^VIX`.
- VSTOXX-Charts: FMP, dann STOXX-Datei. Yahoo ist nicht der Pfad. Scoring-Slot EZ: `server/recession-regions.ts` „STOXX V2TX“, sonst `closedSlot`.
- EZ-Kurve: Differenz der beiden FRED-Serien ist im Katalog verdrahtet (`curveSlot`). Leer → geschlossen, Netto/Max unberührt.
- Buffett-Retry: Timeout 25 s, kein zweiter Versuch. `period2` ist auf dem Chart-Pfad gesetzt. Der **Score**-Pfad holt nur `range=10d` (`WILSHIRE_CHART` in `server/recession.ts`).
- SPY-Fundamentals: kein Yahoo-`quoteSummary`.

### (c) Status

**Teilweise.** Slot-Gerüst und „N/A zählt nicht“ sind da. Fallbacks Yahoo und Trends-Cache fehlen.

### (d) Abhängigkeiten

`SERPAPI_KEY` nur für Trends. FRED/Yahoo/STOXX ohne Key. `FMP_API_KEY` für den heutigen VSTOXX-Erstversuch und Factpack.

### (e) Risiko

Ein VIX- oder VSTOXX-Fallback, der einen heute leeren Slot füllt, **ändert** Korrektur-P. Das ist der Sinn, aber ein eigener PR mit Vorher/Nachher-P, nicht zusammen mit adaptiven Zonen.

### (f) Mini-PR

**PR 5** nach PR 2: `vixReading` bei nicht-endlichem FRED auf Yahoo `^VIX`. VSTOXX: STOXX-Pfad behalten, Yahoo nur wenn FMP und STOXX leer. SPY-`quoteSummary` nicht in denselben PR (anderer Datenfluss, Factpack).

---

## Future_3, Future_4, Future_5 (ein Thema)

Drei Dokumente, ein Soll: SerpApi-429/leer/Timeout darf die Korrektur-P nicht als frisches Markt-Signal verbiegen.

### (a) Umsetzbare Soll-Punkte

- Cache 6–12 h (Future_5: 12 h), Key sinngemäß `google-trends-recession`.
- Bei 429, leerem Timeline, Timeout: letzten gültigen Wert weiter scoren.
- UI: Alter in Stunden, `isStale` ab 6 h, Hinweis.
- Kein Wert in 48 h: Slot **nicht verfügbar** (nicht Zone „Normal = 0“).
- Optional später: Retry-Backoff, pytrends, SerpApi-Plan, offizielle Trends-API. Redis ausdrücklich niedrige Priorität.
- Datei-Skizze `server/cache/google-trends-cache.ts` existiert **nicht**.

Zonen, die bleiben sollen (`googleReading` in `server/recession.ts`, stimmt mit der Spec überein):

| 7d-Ø | Raw | Gewicht | Max |
|------|-----|---------|-----|
| >75 | +7 | ×1,7 | 11,9 |
| 60–75 | +4 | ×1,7 | 11,9 |
| 30–60 | 0 | ×1,7 | 11,9 |
| <30 | −4 | ×1,7 | 11,9 |

### (b) Ist

`scoreGoogleTrends()`:

- URL `serpapi.com/search.json`, `engine=google_trends`, `q=Recession`, `geo=US`, `date=now 7-d`, Timeout 12 s.
- Erfolg: 7d-Mittel, Source-String enthält Ø / Latest / Peak.
- Fehlschlag oder kein Key: `googleReading(null)` → `closedIndicator`: `available: false`, `weight: 0`, `maxWeighted: 0`, Zone `N/A`.
- `scoredTotals` lässt `available === false` aus Netto **und** Max. Der Slot verzerrt P also nicht mehr als „neutraler 0-Punkte-Beitrag bei vollem Max“. Er verschwindet. Das ist **nicht** der Last-Good-Soll.
- UI `client/src/components/recession/recessionDashboardPartsB2.tsx` sagt weiterhin: „Score auf 0 gesetzt, effektiver Max-Score für Korrektur Vollständig auf 61.2 reduziert.“ Der Satz ist fest und passt nicht zu `maxWeighted: 0`.
- Kein `ageHours`. Kein Disk-Eintrag. Jeder `runRecessionAnalysis`-Lauf trifft SerpApi, wenn der Key gesetzt ist.
- Hook: `client/src/pages/RecessionDashboard.tsx` lädt die Analyse; Trends stecken in `indicators`, nicht in einem eigenen Hook.

### (c) Status

Future_3 und Future_4: **teilweise** (N/A wird aus Netto/Max genommen; Cache, Last-Good, UI-Alter fehlen; UI-Text ist alt).  
Future_5: **offen** (die beschriebene Datei ist nicht im Baum).

### (d) Abhängigkeiten

`SERPAPI_KEY` oder `SERPAPI_API_KEY`. Ohne Key bleibt der Slot N/A — Last-Good hilft erst nach einem erfolgreichen Lauf. Redis nicht nötig.

### (e) Risiko

**Score-Änderung**, sobald ein stale Wert wieder in Netto und Max geht (Gewicht ×1,7, Max 11,9). Heute fehlt der Slot ganz. Das ist die gewünschte Korrektur, gehört in einen PR mit klarem „veraltet“-Label, nicht in den Peer-PR und nicht in die Zonen-Umstellung (Future_7/8).

### (f) Mini-PR

**PR 2 — ein PR für Future_3+4+5.**  
Cache (Disk-Muster oder Prozess-Speicher, TTL 12 h). Fehler → letzter Wert, Response-Felder `value`, `ageHours`, `isStale`. Nur ohne Wert seit 48 h: `closedIndicator`. UI-Satz in `recessionDashboardPartsB2.tsx` durch Alter ersetzen, die „61.2“ streichen. Zonen nicht anfassen. Kein pytrends, kein Redis, kein Plan-Wechsel.

---

## Future_6_Recession_Dashboard_Scoring_Logic.md

Erklärung der fünf Wahrscheinlichkeiten zum 09.10.2026, mit Beispielzahlen (Rez 40/40/30, Korr 50/80).

### (a) Umsetzbare Soll-Punkte

Keine neuen Features. Die Datei beschreibt die Formel:

- P = 50 % + (Netto / Max) × 50 %, gerundet.
- Rezession 12M: P_score × 0,7 + NY-Fed × 0,3 (`RECPROUSM156N`).
- Feste Zonen Buffett, CAPE, VIX, Trends, CSI, Spreads.
- Regionale Kataloge parallel; Handlung auf US-Büchern.
- Top-3-Treiber nach absolutem Beitrag.

### (b) Ist — Formel stimmt, Beispielzahlen und ein Indikator nicht

- `probabilityFromNet`, `NY_FED_ANCHOR_WEIGHT = 0.3`, `blendWithNyFedAnchor` in `server/recession.ts`. Clamp 5–95, Schritt 5 (`clampAndRound`). Die Spec-Rechnung ohne Clamp ist die Rohformel; die Response ist gerundet und geklemmt.
- Untergruppen: Coincident (Sahm, Kurve, Aktivität), Leading (+ Durable, M2, Kredit), Full (+ Konsumklima), Sentiment (VIX + ein Crowd-Bein), Full-Korrektur (+ Bewertung inkl. Trends).
- NY-Fed-Anker und US-Handlung: wie Spec. UI-Text in `RegionalCatalogSection`.
- **Abweichung Margin Debt:** Spec-Tabelle „YoY +37,2 % → Raw +2 ×1“. Code: `marginDebtReading`, Score aus **z5y** (`rawFromS(sOfZ(z))`), Max 4, Quelle FINRA. Das ist #193, nicht ein offener Bug.
- **Abweichung Trends-N/A:** Spec „N/A → 0“ bei vollem Gewicht. Code nimmt den Slot aus Netto und Max (siehe Future_3–5).
- Weekly Nowcast WEI: `weight: 0`, „Ablesung, kein Score“. Die Spec-Zeile „×0“ stimmt.
- Buffett-Zonen und CAPE-Zonen (`capeReading`: >35 → +7×1,8 = 12,6) stimmen mit der Tabelle überein.
- Die Prozentwerte 40/40/30/50/80 sind ein Tagesbild, keine Soll-Konstanten.

### (c) Status

**Nur Doku.** Umsetzung steckt in `server/recession.ts` und der Dashboard-UI. Kein eigener Implementierungs-PR.

### (d) Abhängigkeiten

Keine neuen. Die laufende Pipeline braucht FRED, Yahoo-Wilshire, FINRA, optional `SERPAPI_KEY`, Multpl für CAPE.

### (e) Risiko

Keines, solange die Datei Doku bleibt. Wer die Beispielzahlen als Soll codiert, bricht das Scoring.

### (f) Mini-PR

Keine. Abweichungen wandern nach PR 2 (Trends-UI) und bleiben bei #193 (Margin-z5y).

---

## Future_7 und Future_8 (ein Thema)

Frage: Hätten feste Zonen 2001, 2008, 2022 ohne neue Hardcodes erkannt? Empfehlung: z-Score oder Perzentil über 20–30 Jahre.

### (a) Umsetzbare Soll-Punkte

- Buffett und CAPE: Perzentil oder z über 20–25 bzw. 20–30 Jahre, nicht die Absolut-Zonen >200 % / >35.
- VIX: fest lassen oder z über 10–15 Jahre.
- Sahm: fest lassen (die Regel ist schon veränderungsbasiert).
- Konkrete Funktionen aus Future_8: `zScoreToScore`, `percentileScore` (>90 → +4, >75 → +2, <10 → −4, <25 → −2), `calculateAdaptiveScore` mit Mindestlänge 60.
- Kein stilles Ersetzen der Live-P. Die Spec selbst sagt, 2008 bleibt über Bewertung neutral — Kredit/Sahm/VIX tragen den Crash.

### (b) Ist

- `buffettReading` und `capeReading`: feste Schwellen, nur der **letzte** Punkt. Keine 20-Jahres-Verteilung im Score.
- VIX: feste Schwellen in `vixReading`.
- Sahm: `server/recession-sahm.ts`, regionale Boards, nicht die Future-8-Funktion.
- Adaptiv **woanders**, nicht im Rezessions-Bewertungsslot:
  - Margin Debt z5y (#193) in `marginDebtReading`.
  - Buffett-**Chart** hat z gegen die Log-Trendlinie (`BuffettRatioPanel`), das ist nicht der Score.
  - `server/fiscal-frontend-math.ts` `zScore` für BTC-Fiscal.
  - `server/stablecoin-channel-math.ts` z und Perzentil für Stablecoins.
  - Aktien: `shared/schema.ts` `realizedGrowth8QPercent` ist der Aktien-Gap, nicht der Makro-Layer aus Future_9.
- `calculateAdaptiveScore` / `percentileScore` als Rezessions-Scorer: nicht vorhanden.

### (c) Status

**Nur Doku**, Empfehlung **offen**. Nicht „implementiert“, weil z-Scores in anderen Modulen eine andere Serie bewerten.

### (d) Abhängigkeiten

Lange Reihen, die der Chart-Pfad schon holt (Wilshire+GDP, Multpl-CAPE), müssen in den Scorer. Kein neuer Key. Nicht mit `OPENROUTER_API_KEY` mischen.

### (e) Risiko

**Hohe Score-Änderung** an P_korr12 (Buffett-Max 16 und CAPE-Max 12,6 sind die größten Treiber in der Spec). Breaking für jede gespeicherte Interpretation, die „>200 % = +16“ zitiert. Zonen-Tabelle in der UI (`RecessionDashboard` Sektion 4) muss mitziehen.

### (f) Mini-PR

**PR 10**, erst nach PR 2 und PR 5 (sonst misst man Fallback und neue Skala gleichzeitig).  
Ein PR für Future_7+8: Perzentil 20 Jahre für Buffett und CAPE, VIX/Sahm unverändert. Alte Zone als zweite Zeile in der Indikator-Tabelle stehen lassen, bis der Vergleich steht. Kein Habitat, kein LLM.

---

## Future_9_Adaptive_Macro_Framework_Complete.md

Konzept: Habitat, Layer-Gewichte, Managing-Score (CAPEX, EPS, Realzins, Konzentration), Widersprüche, Realized Growth Gap, Inventory/Demand, optional OpenRouter ±25 %.

### (a) Umsetzbare Soll-Punkte

Die Datei sagt selbst: „Umsetzung über Analyse-Button … vorgesehen“, Status Konzept.

Konkrete erste Scheibe, die sich bauen lässt, ohne die fünf Live-Gauges zu ersetzen:

1. Signale mit z/Stärke nur als **Zusatzobjekt** in der Rezessions-Response (noch nicht in `scoredTotals`).
2. `calculateAdaptiveWeights` mit den Basisgewichten aus der Spec und Habitat `restrictive` / Konzentration.
3. `getAIWeightSuggestion` über den **bestehenden** Client `server/llm-openrouter.ts` (`callLLMJson`), nicht eine zweite OpenAI-Instanz. JSON, Clamp ±25 %, Timeout → quantitative Gewichte, Cache 6–12 h.
4. UI: welche Gewichte angepasst wurden. Europa-Fallbacks nicht im ersten Schnitt.

Daten, die die Spec neu will und die heute **nicht** als Makro-Score laufen: Gewinnwachstum vs. Trend, Surprise/Revisionen, Inventory-to-Sales, Konzentration Cap-Weight vs. Equal-Weight RSL, Hyperscaler-CAPEX. Vorhanden als Serie, aber nicht in diesem Layer: Sahm, T10Y2Y, BAA10Y, FINRA-Margin, VIX, Buffett, CAPE, DFII10 (Gold/BTC), WALCL (Gold-Multi-Faktor und Liquiditätsindex).

### (b) Ist

- Kein `calculateAdaptiveWeights`, kein Habitat-Regime, kein Makro-Managing-Score, kein Inventory-Gap im Rezessions-Dashboard.
- OpenRouter ist live für Aktien/Researcher/Value-Chain/Policy (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`). Der Prompt aus §9 ist nicht angeschlossen.
- Aktien-`realizedGrowth8Q` und Thesis-Strength sind ein anderes Produkt (`server/scoring-integration.ts`, `server/thesis-strength.ts`). Nicht als Makro-Habitat wiederverwenden.

### (c) Status

**Offen** (nur Doku / Konzept). Die LLM-Infrastruktur ist da, die Kalibrierung nicht.

### (d) Abhängigkeiten

Quant-Teil: FRED, bestehende Reihen, kein neuer Key. LLM-Teil: `OPENROUTER_API_KEY`. Fehlender Key muss der Spec folgen: quantitative Gewichte, kein Abbruch der Gauges.

### (e) Risiko

**Hohe Score-Änderung und faktisch Breaking**, wenn die Layer die heutigen Gewichte (Buffett ×2, CAPE ×1,8, Trends ×1,7) ersetzen. Deshalb Zusatzobjekt zuerst. LLM-Kosten: Cache Pflicht.

### (f) Mini-PR

**PR 11** nach PR 10. Erst das Zusatzobjekt und die Gewichte anzeigen. LLM in einem Folge-Commit derselben kleinen PR nur, wenn der Clamp und der Fallback getestet sind. Live-P nicht umschalten.

---

## Future_10_Gold_Adaptive_Scoring_Framework.md

Adaptives Gold-Scoring auf dem bestehenden Real-Yield-Modell. Spec-Status: Konzept.

### (a) Umsetzbare Soll-Punkte

1. Dimensionen mit Layer-Gewichten: Real Yield 1,8, Policy 1,3, Liquidity 1,2, Inflation 0,8, Supply 0,9, Technical 1,0, Macro 0,9. Habitat `stress`, Realzins-Trend, M2-z. `effectiveWeight = base × (0,7 + strength × 0,6)`.
2. Technical: Golden Cross +1, Death Cross −1, Preis vs. 200-MA, Volumen-Spike > 1,5× 20-Tage, optional MACD. RSI relativ zur eigenen Historie.
3. Supply: AISC-Margin als Signal, nicht nur Gate. Kapitulationszone und Produktionsänderung fehlen als Daten.
4. Policy: Fed Funds, Real10Y-Rückgang, M2 YoY, WALCL. Neues Gate Policy-Mismatch und Gate „Death Cross aktiv“.
5. Chart-Overlays: Real10Y, M2 YoY, DXY, Breakeven, WALCL, 50/200-MA, Volumen, AISC-Linie.
6. News-Sektion analog BTC-Liquidität: RSS/API, OpenRouter-Flag −1…+1, Cache 6–12 h, Anzeige Flag + Summary + Zeit. Flag leicht, nicht harter Score, bis die Quellen stehen.
7. Offene Daten: AISC-Zeitreihe, Volumen zuverlässig, News-Quellen, Backtest der Crosses, Zentralbankkäufe.

### (b) Ist

Pfad: `client/src/pages/GoldDashboard.tsx` → kein eigener Data-Hook in der Page (Fetch in der Page) → Gold-API in `server/gold-routes.ts` → `server/gold-realyield-model.ts` → `shared/gold-schema.ts`.

| Spec-Ist-Zeile | Code jetzt |
|----------------|------------|
| Technical Score RSI + MA200, feste Schwellen | `getTechnicalScore` in `gold-routes.ts`: RSI>75 und \|Abw\|>25 % → −1, sonst feste RSI-Bänder → 0 oder +1. Kein Cross, kein Volumen. |
| Real-Yield OLS 252 Tage | `gold-realyield-model.ts`, Chart-Toggle Real10Y in `GoldPriceChart.tsx`. |
| Multi-Faktor Real10Y + DXY + WALCL | gebaut, UI als Vergleich in `GoldFairValueSection.tsx`, nicht als Layer-Gewicht. |
| Gates `GOLD_REAL_YIELD_REGIME`, `GOLD_AISC_STRESS`, Decoupling | in `gold-realyield-model.ts`. AISC-Gate inaktiv ohne Daten („kein Fake-Default“). Policy-Mismatch und Death-Cross-Gate: fehlen. |
| Monte Carlo GBM | `GoldMonteCarloSection`. |
| Chart nur Gold vs Real10Y | **enger als der Code:** `GoldPriceChart.tsx` zeichnet `close`, `ma200` und optional Real10Y. Kein MA50, kein Volumen, kein DXY/M2/WALCL/Breakeven im Preis-Chart. |
| News | keine Gold-News-Sektion, kein `getGoldNewsImpact`. |
| Adaptive Gewichte | nicht vorhanden. |

`GoldPricePoint` (`shared/gold-schema.ts`): `date`, `close`, optionales `ma200`. Kein `volume`, kein `ma50`.

BTC-Analog für News/Liquidität ist live (`StablecoinLiquidityPanel`), Gold hat das Muster nicht übernommen.

### (c) Status

**Teilweise.** Das in §1 der Spec beschriebene Basis-Modell ist live und an einigen Stellen weiter (MA200-Linie, Multi-Faktor-Vergleich). Die adaptive Struktur, Crosses, Volumen, News, Policy-Gates sind **offen**.

### (d) Abhängigkeiten

FRED `DFII10`, `M2SL`, `WALCL`, `T10YIE`, `DTWEXBGS`, `FEDFUNDS` ohne Key (ein Teil schon im Modell). Goldpreis über den bestehenden Fetch in `gold-routes.ts`. News-LLM: `OPENROUTER_API_KEY`. AISC: keine stabile Quelle im Code, Gate bleibt aus.

### (e) Risiko

Chart-MA50/Cross-**Marker**: kein Score, geringes Breaking (zusätzliche Serie).  
`getTechnicalScore` um Cross/Volumen erweitern oder Layer-Gewichte auf den GIS legen: **Score-Änderung**. News-Flag als harter Bestandteil: Score-Änderung plus LLM-Kosten. AISC-Zeitreihe erfinden: verboten, Gate ist bewusst inaktiv.

### (f) Mini-PRs

- **PR 3** nur Chart: MA50 aus vorhandenen Closes, Golden/Death als Marker. Volumen erst, wenn der Preis-Fetch Volumen liefert — nicht mit Nullen füllen. Score-Funktion nicht ändern.
- **PR 12** nach PR 10/11: Layer-Gewichte als Zusatz, Policy-Gate, News-Flag mit Cache. GIS-Formel erst umschalten, wenn das Zusatzobjekt stimmt.

---

## Empfohlene Reihenfolge (kleine PRs)

Jede PR eine Sache, live prüfbar, US-Handlung und #193-Formel nicht nebenbei ändern. #195 (`RegionRsiPanel.tsx`) nicht anfassen.

| # | PR | Specs | Score / Breaking | Keys |
|---|-----|-------|------------------|------|
| 1 | Peer-Add: Poll sendet Overrides, Reload behält sie | Future_Work | keines | keine neuen |
| 2 | Trends Last-Good 12 h + UI-Alter, Zonen gleich | Future_2 Punkt 4, Future_3, Future_4, Future_5 | **P ändert sich**, wenn ein stale Wert wieder zählt | `SERPAPI_KEY` |
| 3 | Gold-Chart MA50 + Cross-Marker, ohne Score | Future_Work Gold, Future_10 §4/§7 | keines | keine |
| 4 | Yahoo nur bei FMP 402, dünnes Mapping, klarer Text | Future_1 §1–10 | neue Daten für `.DE`, kein Formel-Bruch | `FMP_API_KEY` bleibt; Yahoo ohne Key |
| 5 | VIX-Yahoo wenn FRED leer; VSTOXX-Yahoo nur als dritte Stufe | Future_2 | **P ändert sich**, wenn Slot heute N/A ist | keine |
| 6 | Region-Buttons auf Katalog-P, US-Default, US-Handlung bleibt | Future_1 §17–18 | Anzeige, nicht die US-Formel | keine |
| 7 | Dividenden-KPI/Overlay nur mit echter Serie | Future_1 §11.1 | keines an den Gates | FMP, später Yahoo |
| 8 | Rezessions-Panes ohne `RegionRsiPanel.tsx` | Future_1 §16 | keines, solange Scoring unangetastet | keine |
| 9 | Buffett-Rest: entweder EU/CN-Benchmark oder `geoPct` live, nicht #193 neu | Future_1 §14, §21 | Score nur, wenn der Slot die Formel wechselt | keine für den Chart; LLM später |
| 10 | Perzentil Buffett+CAPE, alte Zone sichtbar | Future_7, Future_8 | **hoch** | keine |
| 11 | Makro-Layer als Zusatz, dann OpenRouter ±25 % mit Fallback | Future_9 | **hoch**, wenn P umgeschaltet wird | `OPENROUTER_API_KEY` nur für den LLM-Schritt |
| 12 | Gold-Layer, Policy-Gate, News-Flag | Future_10 Rest, Future_Work | **hoch** am GIS | `OPENROUTER_API_KEY` für News |

Bewusst später, ohne eigenen Platz in 1–3: i18n, Kostolany-Rad, bidirektionale Cache-Sync, Konfliktmatrix, CDS (keine freie Quelle), Segment-Dedup (kein Kriterium), Monte-Carlo-Regler (kein Soll-Parameter), pytrends, Redis, SerpApi-Plan, offizielle Trends-API.

**Top 3 zum Start:** PR 1 Peer-Add-Rest, PR 2 Trends-Cache, PR 3 Gold-MA50 ohne Score.
