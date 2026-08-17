# WORK_SEKTORROTATIONS_RAT.md

> **Stand: 17.08.2026**  
> Status: **Spec / Design-Board → Implementierung** (noch nicht gebaut)  
> Quelle Design: Graphic-Design-Vorschlag „Sektorrotations-Rat“ (User-Board)  
> Verankerung: `Future_Work.md` §2 Industrie- & Sektor-Visualisierung · Priorität **Hoch** · Status dort: *komplett offen*

---

## 0) Ziel in einem Satz

Ein **datenbasierter Rahmen** für Sektorrotation: Risiko · Bewertung · Zykluseinordnung · explizite Phasen-Empfehlung — inkl. **Sektorradar** (Donut) und Konjunkturzyklus-Ring.

Kein Video, **Standbild / Dashboard-Panel** im Researcher (Tab Sectors oder neuer Sub-Tab „Rotation“).

---

## 1) Was das Design-Board festlegt (Zahlen, Daten, Fakten)

### 1.1 Sektor-Universum (9 GICS-nahe Buckets)

| # | Sektor (UI-Label) | Phase-Färbung im Radar | Risiko-Beispiel (Board) | Attraktivität (Board) |
|---|-------------------|------------------------|-------------------------|----------------------|
| 1 | Technologie | aggressiv / zyklisch | 5 (Hoch) | 2.1 |
| 2 | Kommunikationsdienste | aggressiv / zyklisch | 4 (Erhöht) | 2.6 |
| 3 | Konsumzyklik (Diskretionär) | aggressiv / zyklisch | 4 (Erhöht) | 3.2 |
| 4 | Industrie | aggressiv / zyklisch | 3 (Moderat) | 3.6 |
| 5 | Finanzen | ausgewogen | 3 (Moderat) | 3.8 |
| 6 | Energie | ausgewogen | 3 (Moderat) | 3.7 |
| 7 | Gesundheitswesen (Pharma) UNH | defensiv | 2 (Niedrig) | 4.3 |
| 8 | Konsumdefensiv | defensiv | 2 (Niedrig) | 4.0 |
| 9 | Versorger | defensiv | 1 (Sehr niedrig) | 4.2 |

Board-Hinweis: *Bewertung* = KGV vs. 10-Jahres-Durchschnitt (günstig / angemessen / teuer).  
Attraktivität-Score im Board: **1.0–5.0** (höher = attraktiver).

### 1.2 Vier Konjunkturphasen (Zykluseinordnung)

| Phase | DE-Label | Signal-Logik (Board) | Bevorzugte Sektoren (Board) |
|-------|----------|----------------------|-----------------------------|
| **Frühzyklus** | Erholung nach Rezession | Wachstumserwartungen ↑, Investitionen ↑, Risikobereitschaft ↑ | Industrie, Technologie, Konsumzyklik |
| **Hochkonjunktur** | Expansion & starkes Wachstum | Gewinne breit hoch, Zinsen moderat ↑, Bewertungen teurer | Technologie, Kommunikationsdienste, Finanzen |
| **Spätkonjunktur** | Abschwächung & Unsicherheit | Gewinnwachstum verlangsamt, Inflation/Zinsen hoch | Gesundheitswesen, Konsumdefensiv, Energie |
| **Abschwung** | Rezession / Kontraktion | Nachfrage & Gewinne fallen, Risikoaversion ↑ | Gesundheitswesen, Versorger, Konsumdefensiv |

Farbcode Board:
- 🔴 aggressiv / zyklisch (höheres Risiko)
- 🔵 ausgewogen / zyklisch
- 🟢 defensiv (niedrigeres Risiko)

### 1.3 Sektorradar (Donut) — visuelle Spec

- **9 Segmente**, feste Reihenfolge (Uhrzeigersinn, Board):
  1. Technologie (oben/rot)
  2. Kommunikationsdienste
  3. Konsumzyklik
  4. Industrie
  5. Finanzen
  6. Energie
  7. Gesundheitswesen
  8. Konsumdefensiv
  9. Versorger
- Mitte: Icon + optional aktuelle Phase-Label
- Farbleiste unten: **AGGRESSIV / ZYKLISCH → DEFENSIV**
- Hover: Sektorname, Risiko (1–5), Bewertung, Attraktivität, Phase-Fit (0–100)

---

## 2) Datenquellen für Sektorrotation (Zahlen & Fakten)

### 2.1 Primär (bereits im Projekt / FMP)

| Datum | Quelle im Repo / API | Nutzung |
|-------|----------------------|---------|
| Sektor-PE, Forward-PE, PEG | FMP `/stable/ratios-ttm`, Peer-Mediane, `sector-data.ts` Defaults | **Bewertung*** vs. Historie |
| Sektor-Performance 1M/3M/6M/12M | FMP sector-performance / ETF-Proxies (XLK, XLF, XLE…) | Momentum-Tilt |
| Beta / Volatilität | FMP profile + OHLCV (`analyze-route` Tech-Pipeline) | **Risiko 1–5** |
| Makro-Regime | `server/recession.ts` (17 Indikatoren + Score) | **aktuelle Phase** ableiten |
| Fiscal / Capex | Researcher Capex-Tab, `researcher.ts` | Spät-/Frühzyklus-Feinsteuerung |
| Sector defaults (WACC, Drawdown) | `server/sector-data.ts` | Fallback wenn Live-Daten fehlen |

\*Board-Regel: KGV vs. **10J-Durchschnitt**. FMP liefert oft TTM/Forward; 10J-PE-Historie wo fehlend über ETF-Proxy oder `sector-data` Snapshot.

### 2.2 Sekundär / optional (Board-Quellenzeile)

| Quelle | Wofür | Aufwand |
|--------|-------|---------|
| **FactSet / Bloomberg** (Board-Fußnote) | institutionelle Sektor-Mediane | **nicht** im Free-Stack — nur Referenz |
| **MSCI** Sektor-Indizes | Performance & Klassifikation | optional via Public ETF |
| ETF-Proxies (Yahoo/FMP) | XLK, XLC, XLY, XLI, XLF, XLE, XLV, XLP, XLU | **praktischer Live-Weg** |
| Conference Board / ISM / Yield Curve | Phasen-Input | schon nah an `recession.ts` |

### 2.3 ETF-Proxy-Map (implementierbar, ticker-stabil)

| Sektor | US-ETF | EU-Nähe (optional) |
|--------|--------|---------------------|
| Technologie | XLK | EXI / SX8P-Proxy |
| Kommunikationsdienste | XLC | — |
| Konsumzyklik | XLY | — |
| Industrie | XLI | — |
| Finanzen | XLF | — |
| Energie | XLE | — |
| Gesundheit | XLV | — |
| Konsumdefensiv | XLP | — |
| Versorger | XLU | — |

### 2.4 Formel-Fakten (Score-Engine)

**Risiko (1–5)** — diskret, UI wie Board:

```
vol_z   = zscore(σ_60d_sektor)
beta_z  = zscore(β_vs_SPX)
dd_z    = zscore(|maxDD_12M|)
risk_raw = 0.40*vol_z + 0.35*beta_z + 0.25*dd_z
risk_1_5 = clamp(round(3 + risk_raw), 1, 5)
```

**Bewertung (Label)** — Board: KGV vs. 10J:

```
pe_ratio = PE_aktuell / PE_10J
if pe_ratio > 1.15 → "Teuer"
elif pe_ratio < 0.90 → "Attraktiv"
else → "Angemessen"
```

**Attraktivität (1.0–5.0)**:

```
val_score  = 5 - 4 * clamp((pe_ratio - 0.7) / 0.8, 0, 1)   # günstig → hoch
mom_score  = 1 + 4 * percentile_rank(return_6M)              # 1..5
phase_fit  = 1..5  # 5 wenn Sektor in aktueller Phase „bevorzugt“
attraktivität = round(0.40*val_score + 0.30*mom_score + 0.30*phase_fit, 1)
```

**Phase (aus Recession-Dashboard)**:

| Recession-Score (bestehend) | Phase |
|----------------------------|-------|
| Expansion / niedriges Rezessionsrisiko | Hochkonjunktur oder Spät* |
| Erholung nach Stress | Frühzyklus |
| Stress steigend | Spätkonjunktur |
| Kontraktion / Rezession aktiv | Abschwung |

\*Spät vs. Hoch: Zins- und Gewinnrevision-Tilt (FMP grades / estimates), nicht nur Binary.

---

## 3) Wie implementiere ich den Sektorradar? (konkret)

### 3.1 Architektur

```
server/sector-rotation.ts          # Scores + Phase + ETF-Performance
server/researcher.ts               # Route /api/researcher/sector-rotation
client/.../SectorRotationPanel.tsx # Tabelle + Zyklus-Ring + Empfehlungen
client/.../SectorRadar.tsx         # Donut (SVG oder Recharts Pie)
```

Anbindung: **Researcher → Tab Sectors** (neuer Block unter/neben `SectorsPanel`) oder Sub-Tab `Rotation`.

### 3.2 Sektorradar UI (Technik)

| Option | Wann | Fakt |
|--------|------|------|
| **SVG Donut** (eigene Komponente) | volle Kontrolle Labels/Icons | ~150–200 LOC, keine neue Lib |
| **Recharts `PieChart`** | schon im Projekt für Pies | schnell, Labels custom |
| Chart.js / D3 | unnötig | Overhead |

**Empfehlung:** Recharts Pie (innerRadius ~55–60 %, outerRadius ~80) **oder** reines SVG wie Portfolio-Pie-Pattern.

Segment-Daten:

```ts
type SectorSlice = {
  id: string;           // "XLK" | "technology"
  label: string;        // "Technologie"
  risk: 1 | 2 | 3 | 4 | 5;
  valuation: "Teuer" | "Angemessen" | "Attraktiv";
  attractiveness: number; // 1.0–5.0
  phaseFit: number;     // 0–100
  color: string;        // aus fester Palette aggressiv→defensiv
};
```

Feste Farbpalette (Board-ähnlich, Tailwind):

```ts
const SECTOR_COLORS = [
  "#e11d48", // Tech
  "#f43f5e", // Comm
  "#f97316", // Disc
  "#f59e0b", // Indu
  "#eab308", // Fin
  "#84cc16", // Energy
  "#22c55e", // Health
  "#14b8a6", // Staples
  "#3b82f6", // Utils
];
```

### 3.3 Layout = Design-Board (4 Blöcke)

1. **Risiko & Bewertung** — Tabelle 9 Zeilen (wie Board)
2. **Zykluseinordnung** — 4-Quadranten / Ring um „KONJUNKTUR ZYKLUS“
3. **Explizite Empfehlung** — 4 Karten (Früh / Hoch / Spät / Abschwung)
4. **Sektorradar** — Donut + Legende aggressiv→defensiv

Responsive: Desktop 2×2 Grid; Mobile stapeln (Tabelle → Phase → Empfehlung → Radar).

### 3.4 API-Contract (Vorschlag)

`GET /api/researcher/sector-rotation`

```json
{
  "asOf": "2026-08-17",
  "phase": "Spätkonjunktur",
  "phaseConfidence": 0.62,
  "sectors": [
    {
      "id": "technology",
      "label": "Technologie",
      "etf": "XLK",
      "risk": 5,
      "valuation": "Teuer",
      "pe": 32.4,
      "pe10y": 24.1,
      "attractiveness": 2.1,
      "return6M": 0.12,
      "phaseFit": 35
    }
  ],
  "recommendations": {
    "Frühzyklus": ["Industrie", "Technologie", "Konsumzyklik"],
    "Hochkonjunktur": ["Technologie", "Kommunikationsdienste", "Finanzen"],
    "Spätkonjunktur": ["Gesundheitswesen", "Konsumdefensiv", "Energie"],
    "Abschwung": ["Gesundheitswesen", "Versorger", "Konsumdefensiv"]
  },
  "dataQuality": { "etfCoverage": 9, "pe10yCoverage": 7, "source": "fmp+etf" }
}
```

Cache: **6–24 h** (wie Researcher), manuell refreshbar.

---

## 4) Abgrenzung zu bestehenden WORK-Dateien

| Datei | Inhalt | Relation |
|-------|--------|----------|
| `Future_Work.md` | Idee + Priorität Hoch | **Parent** |
| `WORK_VALUECHAIN_SECTOR_ROTATION.md` | Wertschöpfungskette, React-Flow, CAPEX, Backoff | **parallel**, nicht dasselbe UI |
| `WORK_SEKTORROTATIONS_RAT.md` (diese) | Design-Board, Scores, Radar, Datenquellen | **dieses Feature** |
| `SectorsPanel.tsx` | Sector Opportunity / Trends / Top Picks | **Host** für Panel |
| `recession.ts` | Makro-Score | **Phase-Input** |
| `sector-data.ts` | Defaults / Klassifikation | **Fallback** |

Kostolany-Rad (`Future_Work`) = **Phase-2**-Visual (Growth/Value/Defensiv-Logik), nicht MVP.

---

## 5) Implementierungsphasen

| Phase | Liefergegenstand | Aufwand (Richtwert) |
|-------|------------------|---------------------|
| **P0** | `sector-rotation.ts` Scores + ETF-Map + Phase aus `recession` | 0.5–1 Tag |
| **P1** | API + Cache + leere UI-Tabelle | 0.5 Tag |
| **P2** | Sektorradar Donut + Farbskala | 0.5 Tag |
| **P3** | Zyklus-Ring + 4 Empfehlungskarten | 0.5 Tag |
| **P4** | PE-10J-Historie härten + dataQuality-Banner | 0.5 Tag |
| **P5** | Kostolany-Rad (optional) | 1 Tag |

**MVP = P0–P3** → entspricht dem Design-Board visuell + live Scores.

---

## 6) Acceptance Criteria

- [ ] 9 Sektoren mit Risiko 1–5, Bewertung-Label, Attraktivität 1.0–5.0
- [ ] Aktuelle Phase aus Makro/Recession, nicht hardcodiert
- [ ] Sektorradar: 9 Segmente, Hover mit Zahlen, Legende aggressiv→defensiv
- [ ] 4 Empfehlungskarten matchen Phase-Logik (nicht nur statischer Text)
- [ ] Kein Crash bei fehlendem PE-10J → `dataQuality` + Fallback-Label
- [ ] Researcher-Refresh invalidiert Cache
- [ ] Quellenzeile UI: „FMP + ETF-Proxies · Stand {asOf}“ (Bloomberg/FactSet nur als Hinweis, nicht als Live-Feed)

---

## 7) Fazit

| Frage | Antwort |
|-------|---------|
| Schon in WORK spezifiziert? | **Jetzt ja** — dieses Dokument; zuvor nur Stichwort in `Future_Work.md` |
| Datenquellen? | **FMP + ETF-Proxies (XL*) + `recession.ts` + `sector-data`**; FactSet/MSCI/Bloomberg = Board-Referenz, nicht MVP-Feed |
| Sektorradar? | Donut (Recharts oder SVG), 9 feste Segmente, Farben aggressiv→defensiv, Daten aus `/api/researcher/sector-rotation` |
| Nächster Code-Schritt | `server/sector-rotation.ts` + Panel-Shell in Researcher Sectors |

---

*Design-Board-Zahlen (Risiko/Attraktivität) sind **Beispielstand Mai 2024** laut Vorlage — Live-API ersetzt sie bei jedem Refresh.*
