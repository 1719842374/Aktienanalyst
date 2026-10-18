# Offen_WORK_RESEARCHER_CAPEX_MAP.md — Capex-Map + Sektor-Overlay im Researcher-Tab

> **Stand: 18.10.2026**  
> Investor-fokussierte, schlanke Weltkarte im Researcher-Tab.  
> Kein OSINT / God’s-Eye-View-Scope (keine Live-Flüge, Schiffe, Satelliten, CCTV).  
> Fokus: Capex-Hotspots + Sektor-Exposure, ergänzt durch optionale Layer.

**Ziel:** Im Researcher-Tab eine 2D-Weltkarte, auf der man auf einen Blick sieht, **wo** Unternehmen am meisten investieren (Capex) und welche Sektoren in welchen Regionen dominieren.

---

## 1. Capex / Investment Hotspots (Hauptfeature)

### Soll-Zustand
- 2D-Weltkarte (Leaflet, react-simple-maps oder vergleichbar).
- Unternehmen oder aggregierte Regionen als Punkte / Heatmap / Bubble.
- **Größe / Farbe = Capex-Volumen** (TTM oder letztes FY, absolut oder YoY-Wachstum).
- Klick auf Land / Region → Side-Panel mit:
  - Top-Investoren (Unternehmen + Capex-Betrag)
  - Dominante Sektoren
  - Link zu bestehenden Analysen / Researcher-Details
- Beispiel-Fragen, die die Map beantworten soll:
  - „Wo investieren Tech- und Energie-Firmen gerade am stärksten?“
  - „Welche Regionen haben den höchsten Capex-Zuwachs YoY?“

### Datenquellen & Fakten
- **FMP**: Capex (Cash-Flow-Statement), Geographic Segments (Revenue + ggf. Capex-Approximation).
- Bestehende Researcher-Pipeline (`server/researcher.ts`) und Geographic-Segment-Daten, die teilweise schon vorhanden sind.
- Aggregation auf Länder- oder Regions-Ebene (US, Europa, Asien, Lateinamerika etc.).
- Optional später: Capex-Ankündigungen aus Earnings Calls / News (nicht v1).

### Acceptance Criteria
- Karte lädt mit Capex-Daten für die wichtigsten Regionen.
- Bubble-/Heatmap-Größe korreliert mit Capex-Volumen.
- Klick auf Region öffnet Side-Panel mit Top-Unternehmen und Zahlen.
- Fallback bei fehlenden Daten (N/A, graue Region).
- Performance: Karte bleibt flüssig auch bei mehreren hundert Datenpunkten.

**Priorität:** Hoch  
**Aufwand:** 2–3 Tage

---

## 2. Sektor- & Industry-Exposure Overlay

### Soll-Zustand
- Farbcodierte Regionen nach dominanter Sektor-Aktivität.
- Beispiele:
  - Semiconductors → Taiwan, Südkorea
  - Autos → Deutschland, Mexiko, Japan
  - Mining → Australien, Chile, Kanada
  - Tech / Software → USA, Indien
- Toggle oder Layer, der zwischen Capex und Sektor-Exposure wechselt.
- Klick zeigt die Top-Sektoren und Unternehmen der Region.
- Passt direkt an den bestehenden **Sector-Opportunity-Tab** an.

### Datenquellen & Fakten
- FMP Sector / Industry Classification + Geographic Segments.
- Bestehende Sector-Opportunity-Daten im Researcher.
- Aggregation: Anteil des Sektor-Capex oder -Revenue pro Region.

### Acceptance Criteria
- Regionen sind farblich nach dominantem Sektor codiert.
- Overlay ist unabhängig vom Capex-Layer umschaltbar.
- Side-Panel zeigt Sektor-Breakdown der angeklickten Region.

**Priorität:** Hoch  
**Aufwand:** 1–1,5 Tage (aufbauend auf Capex-Map)

---

## 3. Optionale weitere Layer (nicht v1, aber sinnvoll)

| Layer                        | Beschreibung                                      | Priorität | Datenquelle                  |
|-----------------------------|---------------------------------------------------|-----------|------------------------------|
| Guru / 13F geografisch      | Cluster der größten Guru-Positionen nach Land     | Mittel    | Bestehende 13F-Pipeline      |
| Recession-Score             | Regionen eingefärbt nach Recession-/Korrektur-Score | Mittel    | Bestehendes Recession-Dashboard |
| Revenue Geographic Split    | Wo verdienen die Top-Unternehmen ihr Geld?        | Mittel    | FMP Geographic Segments      |
| Supply-Chain-Risiko         | Einfache Flags (China-Exposure, Taiwan-Risiko)    | Niedrig   | Manuell / LLM / FMP          |
| Mining / Commodity Exposure | Große Minen / Ressourcen-Standorte                 | Niedrig   | Öffentliche Daten + FMP        |

---

## Technische Umsetzung (Researcher-Tab)

- **Frontend:** Neue Komponente im Researcher (z. B. `CapexMapPanel.tsx` oder neuer Tab/Unterbereich).
- **Karte:** 2D mit `react-simple-maps`, Leaflet oder Mapbox (kein Cesium / 3D-Tiles nötig).
- **Backend:**
  - Erweiterung von `server/researcher.ts` oder neuer Endpoint `GET /api/researcher/capex-map`.
  - Aggregation von FMP Capex + Geographic Segments auf Länder-/Regions-Ebene.
  - Caching analog zu anderen Researcher-Endpunkten.
- **Datenfluss:** UI → Query → API-Route → Researcher-Handler → FMP / Cache → aggregierte Geo-Daten.
- **UI:**
  - Layer-Toggle (Capex / Sektor / optional Recession).
  - Side-Panel bei Klick auf Region.
  - Links zu bestehenden Analysen und zum Sector-Opportunity-Tab.

### Acceptance Criteria (gesamt)
- Karte ist im Researcher-Tab erreichbar.
- Capex-Layer und Sektor-Overlay funktionieren.
- Klick → Side-Panel mit Zahlen und Unternehmen.
- Keine Regression in den bestehenden Researcher-Tabs (Macro, Sectors, Screener, Capex).
- Saubere N/A- und Lade-Zustände.

**Gesamt-Aufwand v1 (Capex + Sektor):** ca. 3–4,5 Tage  
**Priorität:** Hoch (direkter Nutzen, ergänzt bestehende Tabs)

---

## Was bewusst nicht enthalten ist
- Photorealistische 3D-Globus / Cesium / Google 3D Tiles
- Live-Tracking von Flugzeugen, Schiffen, Satelliten, CCTV
- Voice-Control oder OSINT-Features
- Militärische oder geopolitische Event-Layer im God’s-Eye-View-Stil

---

## Nächste Schritte

1. Daten-Verfügbarkeit prüfen (FMP Capex + Geographic Segments auf Länderebene).
2. Backend-Endpoint für aggregierte Capex-/Sektor-Daten spezifizieren und bauen.
3. 2D-Karten-Komponente im Researcher-Tab implementieren.
4. Side-Panel + Layer-Toggle.
5. Nach Umsetzung in Ampel / `WORK_IMPLEMENTIERUNG_OFFEN.md` dokumentieren und auf `fertig_` umbenennen.

---

*Erstellt am 18.10.2026 auf Basis der God’s-Eye-View-Idee, aber stark auf investor-relevante Capex- und Sektor-Daten reduziert.  
Repo: https://github.com/1719842374/Aktienanalyst*
