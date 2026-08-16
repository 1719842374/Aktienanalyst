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

## 4. 13F Institutionen-Daten Integration

### 4.1 Ziel
Jede Firma in der Value-Chain und im Sektorrotations-Kontext soll optional anzeigen:
- Anzahl signifikanter 13F-Halter
- Top-3 / Top-5 institutionelle Halter (Name)
- Ob der Ticker in bekannten Quality-/Value-Portfolios (z. B. Berkshire, Baupost, etc.) auftaucht

### 4.2 Datenquelle
- Bestehender `server/screener.ts` + SEC EDGAR 13F-Logik
- Erweiterung um Batch-Lookup pro Ticker-Liste
- Cache: 7 Tage (13F sind quartalsweise)

### 4.3 API-Erweiterung
```ts
// In ValueChainCompany und in Sektor-Rotation-Response
institutionalHolders13F?: number;
topHolders?: Array<{ name: string; shares?: number; valueUsd?: number }>;
starInvestorFlag?: boolean;   // true wenn bekannter Quality-Investor hält
```

### 4.4 Nutzen
- Qualitäts-Signal: Viele Top-Institutionen + Star-Investoren → höheres Confidence
- Rotations-Signal: Wenn Institutionen massiv aus Tech in Healthcare rotieren → Input für Sektorrotations-Rat

---

## 5. Reverse DCF anhand von Basket-Performance des Marktes

### 5.1 Idee
Der klassische Reverse DCF (Section 14) rechnet die **implizite Wachstumsrate g*** aus dem aktuellen Kurs.  
Erweiterung: Vergleich dieser g* mit der **tatsächlichen realisierten Performance eines relevanten Baskets** (Sektor-Peers, Market, Value-Chain-Stufe).

### 5.2 Logik

```
1. Berechne g* (Reverse DCF) für den Einzeltitel (bereits vorhanden).
2. Baue einen Basket:
   - Primär: Peers aus derselben Value-Chain-Stufe oder demselben Sektor
   - Fallback: Sektor-ETF oder Broad Market (SPY / sector ETF)
3. Berechne realisierte 3Y / 5Y / 8Q Umsatz- und EPS-Wachstumsraten des Baskets (median / winsorized).
4. Divergenz-Metrik:
   Δg = g*_Titel − g_realisiert_Basket

Interpretation:
- Δg > +4 pp  → Markt preist deutlich mehr Wachstum ein als der Basket historisch geliefert hat (sportlich / riskant)
- Δg ≈ 0      → pret voll konsistent mit Peer-Realität
- Δg < −3 pp  → Markt preist weniger als der Basket → potenziell konservativ / unterbewertet
```

### 5.3 Integration
- **Section 14 (Reverse DCF)**: zusätzliche Zeile / Karte „vs. Sector/Value-Chain Basket“
- Optional im Portfolio: Basket-Reverse-DCF als Sanity-Check für die gesamte Allokation
- Scoring-Gate-Erweiterung möglich: `REVERSE_DCF_BASKET_DIVERGENCE`

### 5.4 Datenbedarf
- Peer-Liste (bereits vorhanden über `peerOverrides` + Auto-Peers)
- Historische Financials der Peers (FMP)
- Optional: Value-Chain-Stufen-Peers aus dem neuen Endpoint

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
| 4 | 13F-Lookup Integration | 1 Tag | 3 |
| 5 | Frontend Value-Chain-Explorer (Grid/Karten) | 1–1,5 Tage | 3 |
| 6 | Kostolany-Rad Visualisierung | 1 Tag | sector-data.ts |
| 7 | Sektorrotations-Rat (Regeln + LLM-Text) | 1 Tag | 6 |
| 8 | Reverse-DCF-Basket-Erweiterung (Section 14) | 1 Tag | Peers + Value Chain |
| 9 | End-to-End Tests + Anti-Bias-Checks | 0,5–1 Tag | alle |

**Gesamtaufwand (MVP):** ca. 7–9 Tage

---

## 9. Offene Design-Entscheidungen

1. **React-Flow vs. CSS-Grid** für die Value-Chain → Empfehlung: erst CSS-Grid (einfacher), später optional React-Flow.
2. **Wie aggressiv 13F filtern?** Nur „Star Investors“ oder alle > 10 Mio. USD Position?
3. **Basket-Definition für Reverse DCF:** feste Sektor-Peers oder dynamisch aus der Value-Chain-Stufe?
4. **i18n:** Alle neuen Strings von Anfang an DE + EN vorbereiten?

---

*Dokument erstellt am 17.08.2026 · Referenz: Future_Work.md + aktuelle Gesprächs-Inputs (LLM-Validierung, 13F, Reverse-DCF-Basket)*
