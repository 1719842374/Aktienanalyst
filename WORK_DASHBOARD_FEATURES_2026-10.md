# WORK – Dashboard Features (Oktober 2026)

**Stand:** 18.10.2026 (aktualisiert 24.10.2026)  
**Ziel:** Design- und Funktionsziele für das Aktienanalyst-Dashboard dokumentieren, damit Agents die visuellen Referenzen und Anforderungen sehen.

---

## 1. Financial Statements – mehr Tiefe + Sankey

### Ist (aktuell)
- TTM-Werte in drei Karten (Income, Balance, Cash Flow)
- Margen-Wasserfall (Brutto → EBITDA → Operativ → Netto → FCF)
- Keine Multi-Jahr-Tabelle, keine YoY pro Zeile

### Soll (Inspiration: TIKR + Sankey-Bilder)

| Feature | Beschreibung | FMP-Quelle | Aufwand |
|---------|--------------|------------|---------|
| 8–10 Jahres-Tabelle | Annual Income / Balance / Cash Flow | `/stable/income-statement?period=annual` etc. | Mittel |
| YoY-Veränderung | Pro Zeile in Klammern, farbig (grün/rot) | Lokal berechnet | Niedrig |
| Margen-Historie | Gross, Operating, Net, FCF pro Jahr | Aus Income Statement | Niedrig |
| Sankey Income Statement | „How the company makes money“ – Segmente → Revenue → Gross Profit → Op. Income → Net Income + Kostenabflüsse | Segmente + Income Statement | Hoch |
| Sankey Balance Sheet | Assets (links) → Total Assets → Liabilities + Equity (rechts) | Balance Sheet | Hoch |

**Sankey-Referenz (Microsoft FY2026):**
- Productivity & Business Processes $140.0B (42.2 %)
- Intelligent Cloud $137.8B (41.5 %)
- More Personal Computing $54.1B (16.3 %)
- Revenue $331.8B → Gross Profit $225.5B (67.9 %) → Op. Income $155.2B (46.8 %) → Net Income $133.7B (40.3 %)
- COGS $106.4B, SG&A $34.7B, R&D $35.6B, Tax $32.2B

**Empfehlung:**  
Zuerst die Multi-Jahr-Tabelle mit YoY. Sankey als optionale zweite Ansicht in Sektion 4.

---

## 2. Earnings Beat/Miss Overlay in Technischer Analyse (Sektion 12)

### Ziel
Auf dem bestehenden Kurs-Chart Earnings-Events als Marker einzeichnen.

| Element | Beschreibung |
|---------|--------------|
| Marker | Grün = Beat, Rot = Miss, Grau = Inline |
| Position | Auf dem Kurs zum Earnings-Datum |
| Tooltip | Revenue Actual/Estimate, Surprise %, EPS Surprise % |
| Beat-Rate Badge | „Revenue Beat 32/39 (82 %)“ oben rechts |
| Toggle | Ein-/ausblendbar analog zu MA, RSI, MACD |

**Datenquelle:**  
`/stable/earnings-surprises?symbol=NVO` + Fallback auf Income Statement + Analyst Estimates.

**Aufwand:** ~8–10 Stunden.

---

## 3. Peer-Kurs-Historie in Technischer Analyse (Sektion 12)

### Ist
- 3 separate Fenster (Kurs A / B / C)
- Kein Peer-Overlay im Hauptchart

### Soll
- Im Hauptchart und in den Fenstern Peer-Ticker als zusätzliche Kurslinie hinzufügen können
- Toggle pro Peer (ein-/ausblenden)
- Normalisiert oder absolut (wählbar)
- Max. 3–4 Peers gleichzeitig

**Beispiel:**  
NVO-Hauptchart + LLY und PFE als Overlay-Linien.

**Aufwand:** ~6–8 Stunden (Daten holen, Chart-Overlay, Toggle-UI).

---

## 4. AI-Chatbot im Interface (Aktien)

### Ziel
Schwebendes Chat-Fenster, das auf den aktuellen Analysedaten antwortet und direkt an die Scoring-Gate-Logik und die 20 Sektionen angebunden ist.

**Visuelle Beispiele (Screenshots 24.10.2026 – SAP-Analyse):**
1. Erstes Widget: Schwebendes Chat-Fenster unten rechts mit „Was sollen wir erkunden?“ über der Executive Summary.
2. Zweites Widget: Fenster mit Titelleiste (Zurück, Minimieren, Maximieren, Schließen) und Resize-Handle unten rechts.

**UI-Anforderungen:**
- **Verschiebbar:** Das Widget kann per Drag & Drop frei auf dem Bildschirm positioniert werden.
- **Vergrößer- / Verkleinerbar:** Der User kann die Größe des Chat-Fensters ändern (Resize-Handles an den Ecken oder Rändern).
- **Fenster-Controls:** Minimieren, Maximieren, Schließen in der Titelleiste.
- Die Position und Größe werden im LocalStorage gespeichert, damit sie nach Reload erhalten bleiben.

**Funktionen:**
- Automatische Anbindung an die aktuelle Analyse (alle 20 Sektionen + Scoring-Gates).
- User kann sich jede Sektion detailliert und beispielhaft erklären lassen.
- Die KI kann Szenarien automatisch overriden (DCF, Gates, Ampel neu berechnen).
- Kontext: Earnings-Call, Beat/Miss-Raten, Peers, Scoring-Pipeline.

**Technik:** Claude Haiku / GPT-4o-mini (oder OpenRouter), Streaming.

**Aufwand:** ~12–16 Stunden (inkl. Drag, Resize und Fenster-Controls).

---

## 4b. Event hinzufügen Button in Sektion 17 (Katalysatoren / DCF)

### Ziel
In Sektion 17 einen „Event hinzufügen“-Button analog zum Peer-Ticker-Hinzufügen in Sektion 9. Events werden per KI-Schema berechnet und fließen in den DCF ein.

**Mechanismus:** Freitext oder strukturierte Eingabe → KI berechnet Impact nach Schema (Variable, Delta, Horizont, Wahrscheinlichkeit) → DCF und Gates werden aktualisiert.

**Aufwand:** ~8–10 Stunden.

---

## 4c. Vollständige interaktive KI-Chatbot-Anbindung für alle Assets

### Ziel
Die interaktive Chatbot-Logik (Sektions-Erklärung + Szenario-Override + Event-Hinzufügen) soll nicht nur für die Aktien-Analyse, sondern auch für die anderen Assets im Projekt übertragen werden.

### Assets

| Asset | Sektionen / Module | Beispiel-Override | Aufwand (zusätzlich) |
|-------|---------------------|-------------------|--------------------------|
| **Aktien** | 1–20 + Gates | g1, WACC, Margen, Events | Basis (siehe 4 + 4b) |
| **BTC** | Liquidität, Miner, Technische Analyse, Gates | Hashrate, Fee-Market, Liquiditäts-Index | ~6–8 h |
| **Gold** | Adaptive Gates, AISC, Makro-Overlays, Technische Analyse | Realzinsen, AISC-Stress, Geopolitik-Event | ~5–7 h |
| **Rezession** | Scoring (5 Untergruppen), Buffett, VIX, Yield Curve | Habitat, Konzentration, LLM-Flag | ~6–8 h |

### Gemeinsame Architektur
- Ein gemeinsames Chat-Widget, das den aktuellen Kontext (Asset + geladene Daten) erkennt.
- Pro Asset ein Schema für Szenario-Overrides und Events.
- Die KI nutzt die jeweilige Scoring-/Gate-Logik des Assets (nicht hardcodiert).
- Persistenz der User-Events / Overrides pro Asset und Ticker/Zeitpunkt.
- **Das Widget ist überall verschiebbar, in der Größe anpassbar und hat Fenster-Controls** (gleiche UI-Anforderungen wie bei Aktien).

### Beispiel-Fragen pro Asset
- **BTC:** „Was passiert, wenn die Hashrate um 20 % fällt?“
- **Gold:** „Override: Realzinsen steigen um 50 bp – wie ändert sich das Stress-Signal?“
- **Rezession:** „Was, wenn der Buffett-Indikator auf 180 % fällt?“

**Gesamtaufwand für Übertragung:** ~17–23 Stunden (nachdem die Aktien-Basis steht).

---

## 5. Screener – Custom Criteria

### Ist
- Preset-Screens (Buffett, GARP, 13F-Holdings)
- Keine individuellen Filter

### Soll
- Custom Screen mit Filtern (Market Cap, Industry, Country, ROIC, Forward P/E, etc.).

**Aufwand:** ~8–12 Stunden.

---

## 6. Priorisierung

| Feature | Nutzen | Aufwand | Priorität |
|---------|--------|---------|-----------|
| Detailed Financials (10 Jahre + YoY) | Hoch | Mittel | 1 |
| Peer-Kurs-Overlay (Sektion 12) | Hoch | Mittel | 2 |
| Earnings Beat/Miss Overlay | Hoch | Mittel | 3 |
| Screener Custom Criteria | Hoch | Mittel | 4 |
| Sankey Income / Balance | Mittel | Hoch | 5 |
| AI-Chatbot Aktien (Sektions-Erklärung + Override + Drag/Resize + Controls) | Mittel–Hoch | Hoch | 6 |
| Event hinzufügen (Sektion 17) | Mittel | Mittel | 7 |
| KI-Chatbot Übertragung auf BTC / Gold / Rezession | Mittel | Hoch | 8 |

---

## 7. Design-Referenzen (Bilder aus Chat)

- TIKR Detailed Financials, Earnings Call, Sankey, Fiscal.ai, Screener, GuruAI
- **Screenshot 24.10.2026 (1):** Schwebendes Chat-Widget über der SAP-Executive-Summary
- **Screenshot 24.10.2026 (2):** Chat-Widget mit Titelleiste (Minimieren, Maximieren, Schließen) und Resize-Handle

---

**Nächster Schritt:**  
Agents können die Prioritäten abarbeiten. Die Aktien-Chatbot-Basis sollte vor der Übertragung auf die anderen Assets stehen.

## Soll-Ist-Nachtrag 10.11.2026 – #465 @dd30e8b7
## 07:50 Europe/Berlin (10.11.2026) · HEAD main `dd30e8b7` · Ampel 🟡 · #465 TEILWEISE umgesetzt (Lanes belegt)
- #465 (https://github.com/1719842374/Aktienanalyst/pull/465) squash `dd30e8b7a3faf6b13da29c7257ba07c3ce52c540` über Parent `1a8791bb`, PR-Head `88d72a0d`. Tree `bd705da7` = merge-tree = Merge-Probe `61dce036` = GitHub pull/465/merge `c090184a`. 38 Files +7958/−137 (25 A, 13 M, 0 D, 0 R), 0 Konflikt-Marker, keine Trunkierung, Minuszeilen echte Ersetzungen. Wächter 8/8 Blobs gleich (researcher `fee6d637` bytegleich, #180 erhalten; schema `89bafb1d`). Hunk-Vergleich #479/#472/#386/#180: 0 fehlend, 0 doppelt, 0 zurück.
- Datenkette (DC): index.ts:110 → routes-register.ts:8 → routes.ts:582 (segment-growth :608, children :633, outline :727) + routes-register.ts:84 financial-history / :86 segment-supplement. Dashboard :698 → Section2/YahooSection3 → SegmentEstimateBlock :549 → useSegmentGrowth → /api/segment-growth; SegmentChildrenPanel → /api/segment-children → reviewKiChildren (shared/segment-children.ts); SegmentSupplementView → POST /api/segment-supplement → shared/segment-supplement.ts; Dashboard :699 → FinancialStatements → AnnualFinancials → /api/financial-history → buildFinancialHistory (shared/financial-history.ts) → StatementSankey. Neue Typen in shared-Modulen, schema.ts unverändert. Keine erfundenen Werte (null → „n/a — …“). Plausibel durchgereicht.
- Soll WORK_DASHBOARD_FEATURES_2026-10.md (Blob `61d01de8`) §1 + WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md (Blob `bebef8d7`), beide auf main unverändert.
- Ist ERLEDIGT auf `dd30e8b7`: Jahres-Tabelle (AnnualFinancials), Sankey (StatementSankey), Segment-YoY (segment-growth), KI-Untersegmente mit Fremdmarken-Prüfung (Live: HPE „n/a — Fremdmarke verworfen: Arista Networks“, MSFT Power Platform bleibt, kein Dell/PowerEdge/AMD/Intel/Samsung), promptVersion `n29-brandOwner` live.
- Ist OFFEN → beide Specs bleiben OFFEN, nicht fertig_: P2-N29-2 KI-Lüge ohne geladenen Peer (Folgespec FMP-Namenssuche pro brand); P2-3 fail-open (vorbestehend); Folgespec „eigene Unterbrands“/P3; Elternsegment als Kind (NVDA „Data Center Segment“, HPE „Hybrid Cloud Segment“); UNTESTED-Flaggschiffe wegen 24-h-KI-Cache (CRM, AX, NAV, Azure OpenAI, GitHub Copilot, Nuance, Aruba, Cisco, Juniper, Alletra MP, Zerto, DGX, Blackwell, Mellanox, MacBook Air, Beats).
- Baseline NEU: Tests **259/30** (n=289; +11 neu grün segment-*; cone-stable bekannter Flake, isoliert 0/6 rot); guard-180/326 rot wie zuvor. tsc 76 (normdiff 0). Build rc 0. Pins Δ0 (VWAGY 4.7357 / SAP 5.1748 / MSFT 4.0581, Buffett 5.6381). Live MSFT finalScore 70, HPE 55 Prod = Preview.
- Lanes: DC-Delta GO mit Auflagen /workspace/dispatch/DC-PR465-88d72a0d.md · Tester enger Live-PASS @`88d72a0d` Deployment 7674709527 /workspace/dod-465-88d72a0d/report.md · DC Post-Merge KLAR mit Hinweisen /workspace/dispatch/DC-PR465-postmerge-dd30e8b7.md (Raws /workspace/audit/pm465-dd30e8b7-raws/) · CI success Run 42768069621 · Prod liefert dd30e8b7-Bundle (index-CJJ_04RX.js, Neustart 07:25:05 Madrid; kein GitHub-Production-Deployment-Eintrag, H2).
- Hinweise: H3 Merge-Kommentar 6760620940 nennt N29-15 ms fälschlich „Ablesefehler von DC“ (nicht korrigiert). H4 Drafts #381/#394 durch #465 neu konfliktbehaftet und fachlich überholt (Entscheid Stabschef). #448/#461 Konflikt wie vorher.
- Ersetzt 07:25-Hinweis „Post-Merge DC/Prod-Tester nicht belegt“. Neu abgeschlossen: keine Spec. Offen außerdem: #480, Country-Macro-Pulse-Header/Nav, §2 Earnings-Restlücken, guard-180/326-Mutationstests.
- Do-not-touch: Miner, PEG, invertierter DCF, Sentiment, Portfolio F.2; fertig_/Fertig_ nicht auf Offen_ drehen; Spec-Dateien nicht umbenennen.

## Soll-Ist-Teil-Fortschritt 11.11.2026 – #483 @727ca998 · HEAD main `fb5546ea`

- erledigt @`727ca998`: Elternsegment nicht mehr als eigenes Kind (NVDA „Data Center Segment“, HPE „Hybrid Cloud Segment“). `productChildKey` in `shared/segment-children.ts`. Kette UI → `GET /api/segment-children/:ticker` → Server → shared auf main `fb5546ea9768140679e72185ba7ff50860e506de` geprüft.
- erledigt @`dd30e8b7`: Jahres-Tabelle, Sankey, Segment-YoY, KI-Untersegmente mit Fremdmarken-Prüfung. Der Vollblock steht im Nachtrag 10.11. darüber (Docs #481); hier nur der Fortschritt.
- Offen: P2-3 fail-open; eigene Unterbrands; UNTESTED-Flaggschiffe (24-h-KI-Cache). P2-N29-2 erledigt @`63a5cbcf` (FMP-Namenssuche pro brand).
- Spec bleibt OFFEN. Kein Rename. Kein `fertig_`/`Fertig_`. `fertig_`/`Fertig_` nicht zurück auf `Offen_`.

## Soll-Ist-Teil-Fortschritt 11.11.2026 – #482 @63a5cbcf · HEAD main `63a5cbcf`

- #482 (https://github.com/1719842374/Aktienanalyst/pull/482) Squash `63a5cbcf30805280ca921dac3aca1a3ee66f2b2e`. DC Post-Merge KLAR mit Hinweisen (`test-segment-n29-2.ts` 22 PASS). Tester PASS @`6856db4a`: HPE Networking „n/a — Fremdmarke verworfen“, Arista kein Kind. UNTESTED: ungültige FMP-Namenssuche live, Alletra. Ampel 🟡 TEILWEISE.
- Kette auf main geprüft: `SegmentChildrenPanel` → GET `/api/segment-children/:ticker` (`segment-growth-route.ts:701`) → `fmpSearchCompanyName` (`server/fmp.ts`) → `ownClaimBrandQueries` / `reviewKiChildren` (`shared/segment-children.ts`).
- Offen: P2-3 fail-open; eigene Unterbrands; Flaggschiffe (24-h-KI-Cache); P3 Obergrenze `ownClaimBrandQueries` (270 s gegen 90 s).
- Der Abschnitt bei Z.189 bleibt der historische #465-Stand und bleibt OFFEN. Kein Rename. Kein `fertig_`/`Fertig_`. `fertig_`/`Fertig_` nicht zurück auf `Offen_`.
