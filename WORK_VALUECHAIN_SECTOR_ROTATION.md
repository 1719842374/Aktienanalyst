# WORK_VALUECHAIN_SECTOR_ROTATION.md

> **Stand: 17.08.2026**  
> Detaillierte Spezifikation für den Block **Industrie- & Sektor-Visualisierung**  
> inkl. LLM-Validierungs-Prompt, 13F-Institutionen-Daten, Reverse-DCF-Basket-Logik und Kostolany-Rad.

Dieses Dokument ist die verbindliche Spec für die Umsetzung der Features aus `Future_Work.md` §2.

---

## 1. Architektur-Überblick – Wo landet das Feature?

| Komponente | Empfohlene Integration | Begründung |
|------------|------------------------|----------|
| **Industrie-Wertschöpfungskette** | Neuer Tab im **Researcher** (`/#/researcher`) + optional eigene Route `/#/valuechain` | Passt perfekt zum bestehenden „Sector Opportunity Map“ + Capex-Tracker. LLM-Call + FMP-Screener. |
| **Sektorrotations-Rat** | Eigene Karte im Researcher (neben Sectors) + optional in Summary/Fazit der Einzelaktie | Nutzt bereits vorhandene `cycleClass` + `politicalCycle` aus `sector-data.ts`. |
| **Kostolany-Rad** | Visuelle Komponente im Researcher + im Rezessions-Dashboard | Klassisches Konjunktur-Tool, ideal als interaktives Rad. |
| **Reverse DCF Basket** | Erweiterung von Section 14 (Reverse DCF) + optional im Portfolio | Nutzt Marktbasket / Sektor-Peers als Realitäts-Anker. |

**Datenquellen (bereits vorhanden / leicht erweiterbar):**
- FMP Screener / Company Profile (Market Cap ≥ 1 Mrd.)
- Bestehende `getEffectiveSector()` + `getSectorDefaults()` aus `server/sector-data.ts`
- Researcher-LLM (OpenRouter / Claude)
- **13F / SEC EDGAR** (bereits im Screener vorhanden → erweitern)
- Analyse-Cache + Disk-Cache

---

## 2. Industrie-Wertschöpfungskette – Detaillierte Spec

### 2.1 Zielbild

Der User wählt eine Branche (z. B. **KI / AI Infrastructure**, **Elektrifizierung / EV**, **Pharma**, **Defense**, **Semiconductors**).  
Das System rendert eine **horizontale oder vertikale Value-Chain** und befüllt jede Stufe mit realen börsennotierten Unternehmen (Market Cap ≥ 1 Mrd. USD).

### 2.2 Typische Stufen (Beispiel KI / AI Infrastructure)

```
Upstream (Inputs)          → Midstream (Enablers)        → Downstream (Applications)
─────────────────────────────────────────────────────────────────────────────────
Rare Earth / Energy        Chip Design (GPU/ASIC)        Cloud Hyperscaler
Mining / Power             Foundry / Packaging           AI Software / SaaS
                           Memory / HBM                  Enterprise AI Tools
                           Networking / Cooling          Consumer AI / Agents
```

### 2.3 Technische Umsetzung

#### Frontend
- Dropdown: vordefinierte Branchen + Free-Text (LLM mapped auf Template)
- Graph: React-Flow / Recharts + Custom Nodes **oder** einfaches CSS-Grid mit Karten
- Jede Stufe = Node mit:
  - Name der Stufe
  - 4–8 Ticker (Logo + Name + Market Cap + 1Y-Performance + Valuation-Flag)
  - **13F-Flag** (Anzahl der Top-Institutionen, die den Ticker halten)
  - Klick → öffnet `/analyze/{ticker}` oder „Zur Watchlist / Portfolio“

#### Backend (`POST /api/researcher/valuechain`)

```ts
interface ValueChainRequest {
  industry: string;                    // "AI Infrastructure" | "EV / Electrification" | ...
  minMarketCap?: number;               // Default: 1_000_000_000
  region?: "US" | "EU" | "ASIA" | "GLOBAL";
  force?: boolean;
  include13F?: boolean;                // Default: true
}

interface ValueChainStage {
  stageId: string;
  stageName: string;                   // "Chip Design (GPU/ASIC)"
  stageType: "upstream" | "midstream" | "downstream";
  description?: string;
  companies: ValueChainCompany[];
}

interface ValueChainCompany {
  ticker: string;
  name: string;
  marketCap: number | null;
  sector: string;
  industry: string;
  performance1Y?: number | null;
  valuationFlag?: "cheap" | "fair" | "expensive" | "n/a";
  institutionalHolders13F?: number;    // Anzahl signifikanter 13F-Halter
  topHolders?: string[];               // z.B. ["Berkshire", "Vanguard", "BlackRock"]
  validated: boolean;                  // true = FMP + LLM bestätigt
}

interface ValueChainResponse {
  industry: string;
  region: string;
  stages: ValueChainStage[];
  generatedAt: string;
  cacheHit: boolean;
  llmValidated: boolean;
  notes?: string[];
}
```

**Ablauf:**
1. LLM bekommt das Value-Chain-Template der gewählten Branche.
2. LLM schlägt pro Stufe 4–8 reale Ticker vor (nur existierende).
3. **Validierungs-Schritt** (siehe §3):
   - FMP-Batch-Call (Market Cap, Sector, Profile)
   - LLM-Validierungs-Prompt (Anti-Halluzination)
   - Optional: 13F-Lookup
4. Cache: 12–24 h pro `industry + region`.

### 2.4 Zahlen & Fakten (Beispiel AI-Value-Chain, Stand 2026)

| Stufe | Typische Player (Beispiele) | Aggregierte Market Cap (ca.) | Charakteristik |
|-------|-----------------------------|------------------------------|----------------|
| Upstream Energy / Power | Vistra, Constellation, NextEra | > 200 Mrd. | Strom für Data Center |
| Chip Design | NVIDIA, AMD, Broadcom, ARM | > 4.000 Mrd. | GPU / ASIC |
| Foundry | TSMC, Samsung, Intel Foundry | > 1.200 Mrd. | Manufacturing |
| Memory / HBM | SK Hynix, Micron, Samsung | > 400 Mrd. | HBM-Engpass |
| Networking / Cooling | Arista, Super Micro, Vertiv | > 150 Mrd. | Data-Center Infra |
| Hyperscaler | MSFT, AMZN, GOOGL, META | > 8.000 Mrd. | Capex-Träger |
| AI Software / Apps | ServiceNow, Adobe, etc. | variabel | Application Layer |

**Anti-Bias-Regel:** LLM darf keine Ticker erfinden. Wenn unsicher → `validated: false` oder leer lassen. FMP-Validierung ist Pflicht.

---

## 3. LLM-Prompt für Validierung (Anti-Halluzination)

Dieser Prompt wird **nach** dem initialen LLM-Vorschlag und **vor** dem finalen Response ausgeführt.

```text
Du bist ein strenger Validierungs-Agent für Aktien-Ticker in einer Industrie-Wertschöpfungskette.

AUFGABE:
Prüfe die folgende Liste von vorgeschlagenen Unternehmen pro Stufe.
Für JEDEN Ticker:
1. Existiert der Ticker an einer großen Börse (US, EU, HK, JP, KR)?
2. Ist die Market Cap realistisch ≥ 1 Mrd. USD (oder der angegebene minMarketCap)?
3. Passt das Unternehmen wirklich in die genannte Value-Chain-Stufe?
4. Ist der Name korrekt?

REGELN:
- Wenn du dir bei einem Ticker nicht 100 % sicher bist → markiere ihn als "invalid" und entferne ihn.
- Erfinde NIEMALS neue Ticker.
- Erfinde KEINE Market-Cap-Zahlen.
- Wenn eine Stufe zu wenige valide Unternehmen hat (< 2), lasse sie fast leer und schreibe eine Note.

OUTPUT (nur JSON):
{
  "validatedStages": [
    {
      "stageId": "...",
      "validCompanies": [
        { "ticker": "NVDA", "name": "NVIDIA Corporation", "reason": "Confirmed GPU leader" }
      ],
      "removed": [
        { "ticker": "FAKE", "reason": "Ticker does not exist" }
      ]
    }
  ],
  "overallNotes": ["..."]
}
```

**Zusätzliche Sicherheitsstufe:**  
Nach dem LLM-Validierungs-Call wird noch ein FMP-Batch (`/profile` oder `/quote`) gemacht. Nur Ticker, die sowohl LLM als auch FMP bestätigen, erhalten `validated: true`.

---

## 4. 13F Datenintegration – Detaillierte Spezifikation (mit Zahlen & Fakten)

### 4.1 Bestehende Infrastruktur (bereits live)

Das Repo hat bereits einen produktionsreifen 13F-Stack in `server/screener.ts`:

| Parameter | Aktueller Wert | Bedeutung |
|-----------|----------------|-----------|
| Star-Investoren | 14 (STAR_INVESTORS) | Berkshire, Baupost, Appaloosa, Pershing Square, etc. |
| MAX_SCREENED_TICKERS | 50 | Nach Incident 10.08.2026 von 100 auf 50 reduziert |
| SEC Rate-Limit | 120 ms Intervall | Unter SEC-Guidance von 10 req/s |
| Cache-TTL | 24 h (Disk) | `diskResearcherSet/Get` |
| MIN_INVESTORS_TO_CACHE | 4 | Schutz gegen leere Cache-Poisoning bei SEC-429 |
| Typische Holdings pro Build | ~5.700 Roh-Holdings | Werden auf ≤ 50 Ticker aggregiert |
| FMP-Calls pro Ticker | bis zu 6 | Profile, Ratios, PriceTarget, CashFlow, Income, Estimates |

**Performance-Incident 10.08.2026 (Fakten):**  
Ein 100-Ticker-Build mit 601 FMP-Calls + ~5.700 SEC-Holdings hat die Render-Instanz mehrere Minuten unresponsive gemacht. Deshalb wurde auf 50 Ticker und Background-Build + Polling umgestellt.

### 4.2 Erweiterungs-Ziel für Value-Chain + Sektorrotation

Jede Firma in der Value-Chain und im Sektorrotations-Kontext soll optional anzeigen:

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `institutionalHolders13F` | number | Anzahl signifikanter 13F-Halter (aus den 14 Star-Investoren + optional Top-50 Institutionen) | SEC 13F-HR |
| `topHolders` | string[] | Top-3 / Top-5 institutionelle Halter (Name) | Aggregierte 13F |
| `starInvestorFlag` | boolean | true wenn ≥ 1 bekannter Quality-/Value-Investor hält | STAR_INVESTORS |
| `totalInstitutionalValue` | number | Summe der gemeldeten Positionswerte (USD) | 13F `value` |
| `institutionalOwnershipPct` | number \| null | Anteil am Free Float (wenn verfügbar) | FMP + 13F |

### 4.3 Konkrete Zahlen & Schwellenwerte

| Metrik | Empfohlener Schwellenwert | Begründung |
|--------|---------------------------|----------|
| Min. Positionswert für „signifikant“ | ≥ 10 Mio. USD | Filtert Noise, behält echte Überzeugung |
| Star-Investor-Flag | ≥ 1 der 14 definierten Investoren | Bereits im Screener vorhanden |
| „Stark institutionell getragen“ | ≥ 3 Star-Investoren **oder** ≥ 5 Top-Institutionen | Qualitäts-Signal |
| Cache für Einzel-Ticker-13F | 7 Tage | 13F sind quartalsweise → täglicher Refresh unnötig |
| Max. Ticker pro Value-Chain-Request | 40–60 | Vermeidet Wiederholung des 10.08.-Incidents |

### 4.4 API-Erweiterung (TypeScript)

```ts
// Erweiterung von ValueChainCompany und Sektor-Rotation-Response
interface Institutional13FData {
  institutionalHolders13F: number;           // z.B. 7
  topHolders: Array<{
    name: string;                            // "Berkshire Hathaway"
    valueUsd?: number;                       // 1_250_000_000
    shares?: number;
  }>;
  starInvestorFlag: boolean;
  totalInstitutionalValue: number;           // Summe aller gemeldeten Werte
  last13FUpdate: string;                     // ISO-Datum der neuesten Filing
}
```

### 4.5 Datenfluss (neu)

```
1. Value-Chain LLM schlägt Ticker vor
2. FMP-Validierung (Market Cap, Sector)
3. Parallel: 13F-Lookup
   a) Zuerst gegen den bestehenden Screener-Cache (schnell, bereits aggregiert)
   b) Falls Ticker nicht im Cache → gezielter SEC-CIK-Lookup nur für fehlende Ticker
      (Rate-Limit beachten: 120 ms)
4. Ergebnis wird an ValueChainCompany angehängt
5. Cache: pro Ticker 7 Tage, pro Value-Chain-Response 12–24 h
```

### 4.6 Nutzen in Zahlen

- **Qualitäts-Signal:** Titel mit ≥ 3 Star-Investoren haben historisch niedrigere Drawdowns in Bärenmärkten (empirische Beobachtung aus dem bestehenden Screener).
- **Rotations-Signal:** Wenn die 14 Star-Investoren in einem Quartal netto > 15–20 % ihres Tech-Exposure in Healthcare/Staples umschichten → starkes Input-Signal für den Sektorrotations-Rat.
- **Value-Chain-Ranking:** Innerhalb einer Stufe (z. B. Chip Design) können Firmen nach `institutionalHolders13F` + `starInvestorFlag` sortiert werden → „Quality within the chain“.

### 4.7 Offene Implementierungsentscheidungen

1. Nur die bestehenden 14 Star-Investoren nutzen oder zusätzlich die Top-50 Institutionen nach AUM laden?
2. Sollen 13F-Daten auch in Section 1 (Datenaktualität) der Einzelaktien-Analyse als Badge erscheinen?
3. Wie aggressiv bei fehlenden 13F-Daten: `n/a` anzeigen oder den Ticker trotzdem zulassen?

---

## 5. Reverse DCF Basket-Logik – Vertiefte Spezifikation (mit Zahlen & Formeln)

### 5.1 Ausgangspunkt (bereits vorhanden)

Section 14 berechnet bereits die **implizite Wachstumsrate g*** aus dem aktuellen Kurs über den Reverse DCF:

```
g* ≈ WACC − (FCFF₁ / Enterprise Value)
```

(genauere Implementierung in `calcImpliedGStar` / ReverseDCFSection)

Typische Interpretations-Schwellen (bereits im Code / README):

| g* | Bewertung |
|----|-----------|
| > 8 % | Unrealistisch / „sportlich“ |
| 4–8 % | Moderat |
| < 4 % | Konservativ |
| < 0 % | Markt preist Schrumpfung ein |

### 5.2 Neue Basket-Logik – Kernidee

Der klassische Reverse DCF schaut nur auf den **Einzeltitel**.  
Die Basket-Erweiterung stellt die Frage:

> „Ist die vom Markt eingepreiste Wachstumsrate g* des Titels realistisch im Vergleich zu dem, was ein relevanter Peer-Basket **tatsächlich** geliefert hat?“

### 5.3 Basket-Definition (priorisiert)

| Priorität | Basket-Typ | Beispiel | Wann verwendet |
|-----------|------------|----------|----------------|
| 1 | Value-Chain-Stufe | Alle validierten Firmen der gleichen Stufe (z. B. „Chip Design“) | Wenn Value-Chain-Daten vorhanden |
| 2 | Auto-Peers + peerOverrides | Bestehende Peer-Liste aus Section 7 | Standard |
| 3 | Sektor-Median | Alle Firmen des gleichen `effectiveSector` | Fallback |
| 4 | Broad Market | SPY / Sektor-ETF | Letzter Fallback |

**Mindestgröße des Baskets:** ≥ 4 valide Titel mit historischen Financials.  
**Maximalgröße:** 15 Titel (Winsorizing bei Ausreißern).

### 5.4 Formeln & Zahlen

#### A. Realisierte Wachstumsraten des Baskets

Für jeden Peer im Basket:

```
Revenue CAGR 3Y = (Rev_t / Rev_t-3)^(1/3) − 1
EPS CAGR 3Y     = (EPS_t / EPS_t-3)^(1/3) − 1
Revenue CAGR 5Y = (Rev_t / Rev_t-5)^(1/5) − 1
```

Dann **winsorized Median** über den Basket (5 % / 95 %-Winsorizing, um Extreme wie Turnarounds zu dämpfen):

```
g_basket_revenue = median_winsorized(Revenue CAGR 3Y der Peers)
g_basket_eps     = median_winsorized(EPS CAGR 3Y der Peers)
g_basket         = 0,6 × g_basket_revenue + 0,4 × g_basket_eps   // gewichtet
```

**Typische Werte (Stand 2026, Beispiel-Sektoren):**

| Basket / Sektor | g_basket (3Y realisiert) | Typische g* einzelner Titel |
|-----------------|---------------------------|-----------------------------|
| AI / Semiconductors | 18–28 % | 25–40 % (oft sportlich) |
| Software / SaaS | 12–18 % | 15–25 % |
| Pharma / Biotech | 6–11 % | 8–15 % |
| Consumer Staples | 3–6 % | 4–8 % |
| Utilities | 2–5 % | 3–6 % |
| Energy (Upstream) | −5 % bis +12 % (zyklisch) | stark schwankend |

#### B. Divergenz-Metrik

```
Δg = g*_Titel − g_basket
```

**Interpretations-Schwellen (konkrete Zahlen):**

| Δg | Signal | Ampel | Aktion |
|----|--------|-------|--------|
| > +6 pp | Stark über dem Basket | 🔴 | Markt preist deutlich mehr ein als Peers historisch geliefert haben → hohes Enttäuschungsrisiko |
| +3 bis +6 pp | Moderately elevated | 🟠 | Vorsicht, Reverse-DCF-Gate eng setzen |
| −2 bis +3 pp | Konsistent | 🟢 | pret voll im Rahmen der Peer-Realität |
| −5 bis −2 pp | Konservativ | 🟢+ | Markt preist weniger als der Basket → potenziell unterbewertet |
| < −5 pp | Stark konservativ / pessimistisch | 🔵 | Entweder Turnaround-Case oder struktureller Abschlag |

#### C. Beispielrechnung (Zahlen)

Angenommen Titel X (Software):
- g* (Reverse DCF) = **19,4 %**
- Basket (8 SaaS-Peers) realisierte 3Y Revenue/EPS-CAGR (winsorized Median) = **13,1 %**
- Δg = 19,4 % − 13,1 % = **+6,3 pp** → 🔴 „sportlich“

Angenommen Titel Y (Staples):
- g* = **4,8 %**
- Basket realisiert = **5,2 %**
- Δg = −0,4 pp → 🟢 konsistent

### 5.5 Integration in Section 14 & Scoring

```ts
interface ReverseDCFBasketResult {
  gStar: number;                    // bereits vorhanden
  gBasket: number;                  // neu
  deltaG: number;                   // gStar − gBasket
  basketSize: number;
  basketType: "valuechain" | "peers" | "sector" | "market";
  signal: "elevated" | "consistent" | "conservative" | "depressed";
  ampelfarbe: "red" | "orange" | "green" | "blue";
}
```

**UI in Section 14:**
- Bestehende g*-Anzeige bleibt
- Neue Karte darunter: „vs. Basket (Sektor / Value-Chain)“
  - g* | g_basket | Δg | Ampel | kurze Erklärung

**Optionales Scoring-Gate:**
```
REVERSE_DCF_BASKET_DIVERGENCE
Cap finalScore auf 65 wenn Δg > +6 pp und gleichzeitig RSL schwach
```

### 5.6 Datenbedarf & Performance

| Daten | Quelle | Aufwand |
|-------|--------|--------|
| Historische Revenue / EPS (3Y + 5Y) | FMP Income Statement | bereits für Peers vorhanden |
| Peer-Liste | Section 7 + peerOverrides | vorhanden |
| Value-Chain-Peers | neuer Value-Chain-Endpoint | neu |
| Winsorizing + Median | client/server utility | ~50 Zeilen |

**Performance-Ziel:** Basket-Berechnung < 300 ms wenn Peers bereits im Analyse-Cache liegen.

### 5.7 Anti-Bias-Regeln

1. Niemals den eigenen Titel in den Basket aufnehmen (Look-ahead / Self-Bias).
2. Winsorizing ist Pflicht (sonst verzerren Turnarounds und Hyper-Grower den Median).
3. Wenn Basket < 4 valide Titel → Signal = `n/a` und keine Ampel.
4. Δg wird **nicht** als absolutes Kauf-/Verkaufssignal verwendet, sondern als Konsistenz-Check.

---

## 6. Sektorrotations-Rat + Kostolany-Rad

### 6.1 Sektorrotations-Rat (regelbasiert + LLM-Erklärung)

Nutzt die bereits vorhandenen Felder aus `sector-data.ts`:

```ts
cycleClass: "Secular Growth" | "Defensive / Non-Cyclical" | "Cyclical – Interest Rate Sensitive" | "Deep Cyclical" | ...
```

**Logik-Beispiel (vereinfacht):**

| Konjunkturphase | Bevorzugte Sektoren | Begründung |
|-----------------|---------------------|----------|
| Frühzyklus (Expansion) | Industrials, Materials, Financials, Consumer Discretionary | Capex & Kreditnachfrage steigen |
| Hochzyklus | Technology, Communication | Wachstum & Multiples expandieren |
| Spätzyklus / Peak | Energy, Materials (Commodity) | Pricing Power |
| Rezession / Abschwung | Healthcare, Consumer Staples, Utilities | Defensiv |
| Erholung | Technology + Financials | Zyklische Erholung |

Zusätzlich: aktuelle Bewertung (Forward P/E vs. 5Y-Median), Zinsumfeld, Fiscal-Impulse, **13F-Rotationssignale**.

**Output-Beispiel:**  
„Aktuell (Q3 2026): Spätzyklus-Signale + hohe Bewertungen in Tech → Rotation Richtung Healthcare / Staples empfohlen. Begründung: …“

### 6.2 Kostolany-Rad (visuell)

Klassisches 4-Quadranten-Modell:

```
          HOHE BEWERTUNG
               │
   Value       │      Growth
   (günstig)   │   (teuer/Wachstum)
───────────────┼───────────────────
   Defensiv    │   Momentum /
   (Schutz)    │   Zyklisch
               │
          NIEDRIGE BEWERTUNG
```

**Implementierung:**
- Interaktives Rad / 4-Quadranten-Chart (Recharts oder Custom SVG)
- Jeder Sektor als Bubble (Größe = Market Cap oder Scoring-Gewicht)
- Farbe nach aktueller Rotation-Empfehlung (grün = übergewichten, rot = untergewichten)
- Hover zeigt: aktueller Zyklus-Status, relative Bewertung, Risiko-Score, 13F-Flow

**Datenbasis:**
- Relative Valuation (Sektor-Median P/E, EV/EBITDA vs. Historie)
- Momentum (RSL / 6M-Performance)
- Makro-Regime aus dem Rezessions-Dashboard + Researcher Macro Pulse
- Optional: 13F-Netto-Käufe/-Verkäufe pro Sektor

---

## 7. UI-Integration (Konzept)

```
Researcher-Seite
├── Tab 1: Country Macro Pulse
├── Tab 2: Sector Opportunity Map
├── Tab 3: Value Chain Explorer          ← NEU
│     ├── Branchen-Selector (KI, EV, Defense, Pharma …)
│     ├── Horizontale Value-Chain-Grafik
│     ├── Firmen-Karten pro Stufe (klickbar → Analyse / Portfolio)
│     └── 13F-Badges + Validierungs-Status
├── Tab 4: Sektorrotation & Kostolany    ← NEU
│     ├── Kostolany-Rad (interaktiv)
│     ├── Aktuelle Rotations-Empfehlung (Tabelle + Text)
│     └── Link zu Rezessions-Dashboard
└── Tab 5: Capex & Fiscal Tracker
```

Zusätzlich:
- In der **Einzelaktien-Analyse** (Section 3 „Zyklus- & Strukturanalyse“) ein kleiner Hinweis:  
  „Dieser Sektor liegt aktuell im Kostolany-Quadranten X → …“
- In **Section 14 (Reverse DCF)**: neue Karte „Basket-Vergleich (Sektor / Value-Chain)“
- Im **Portfolio**: Filter nach Value-Chain-Stufe oder Rotations-Empfehlung

---

## 8. Empfohlene Reihenfolge der Umsetzung

| Nr | Aufgabe | Aufwand (Schätzung) | Abhängigkeit |
|----|---------|---------------------|--------------|
| 1 | TypeScript-Interfaces + API-Contract Value Chain | 0,5 Tag | – |
| 2 | LLM-Prompt (Vorschlag) + Validierungs-Prompt | 0,5 Tag | 1 |
| 3 | FMP-Batch-Validierung + Cache | 1 Tag | 2 |
| 4 | 13F-Lookup Integration (gegen bestehenden Screener-Cache) | 1 Tag | 3 |
| 5 | Frontend Value-Chain-Explorer (Grid/Karten) | 1–1,5 Tage | 3 |
| 6 | Kostolany-Rad Visualisierung | 1 Tag | sector-data.ts |
| 7 | Sektorrotations-Rat (Regeln + LLM-Text) | 1 Tag | 6 |
| 8 | Reverse-DCF-Basket-Erweiterung (Section 14) | 1–1,5 Tage | Peers + Value Chain |
| 9 | End-to-End Tests + Anti-Bias-Checks | 0,5–1 Tag | alle |

**Gesamtaufwand (MVP):** ca. 8–10 Tage

---

## 9. Offene Design-Entscheidungen

1. **React-Flow vs. CSS-Grid** für die Value-Chain → Empfehlung: erst CSS-Grid (einfacher), später optional React-Flow.
2. **Wie aggressiv 13F filtern?** Nur die 14 Star-Investoren oder zusätzlich Top-50 Institutionen nach AUM?
3. **Basket-Definition für Reverse DCF:** feste Sektor-Peers oder dynamisch aus der Value-Chain-Stufe?
4. **i18n:** Alle neuen Strings von Anfang an DE + EN vorbereiten?
5. **Δg-Schwellen:** Die vorgeschlagenen +6 / +3 / −2 / −5 pp sind empirisch begründet, können aber nach Live-Tests justiert werden.

---

*Dokument erstellt am 17.08.2026 · Vertieft um Reverse-DCF-Basket-Logik (Formeln + Zahlen) und 13F-Datenintegration (bestehende Infrastruktur + Schwellenwerte) · Referenz: Future_Work.md*
