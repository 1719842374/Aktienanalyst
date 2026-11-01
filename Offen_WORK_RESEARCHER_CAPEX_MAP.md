# Offen_WORK_RESEARCHER_CAPEX_MAP.md — Capex-Map + Sektor-Overlay + Bitcoin-Miner-Layer im Researcher-Tab

> **Stand: 18.10.2026 (erweitert)**  
> Investor-fokussierte 2D-Weltkarte im Researcher-Tab.  
> Enthält Capex-Hotspots, Sektor-Exposure und Bitcoin-Miner-Lokalisierung.  
> Kein OSINT / God’s-Eye-View-Scope.

**Ziel:** Im Researcher eine schlanke 2D-Weltkarte, auf der Capex, Sektoren und Bitcoin-Miner geografisch sichtbar sind – mit konkreten Zahlen, Datenquellen und Acceptance Criteria.

---

## 1. Capex / Investment Hotspots (Hauptfeature)

### Soll-Zustand
- 2D-Weltkarte (react-simple-maps oder Leaflet).
- Bubble- oder Heatmap-Darstellung: Größe/Farbe = Capex-Volumen (TTM oder FY, absolut oder YoY).
- Klick auf Land/Region → Side-Panel:
  - Top 5–10 Unternehmen mit Capex-Betrag (in USD).
  - Dominante Sektoren + Anteil.
  - Link zu bestehenden Analysen.

### Daten & Fakten
- Quelle: FMP Cash-Flow (capex) + Geographic Segments.
- Aggregation auf Länder- oder Regions-Ebene (US, CN, TW, KR, DE, JP, etc.).
- Beispiel-Metriken: Capex in Mrd. USD, YoY-Wachstum in %, Anteil am regionalen Gesamt-Capex.
- Bestehende Researcher-Pipeline und Geographic-Segment-Daten wiederverwenden.

### Acceptance Criteria
- Karte zeigt Capex-Daten für ≥ 20 Länder/Regionen.
- Bubble-Größe skaliert korrekt mit Capex-Volumen.
- Side-Panel zeigt konkrete Zahlen (z. B. „TSMC: 30 Mrd. USD Capex in TW“).
- N/A-Fallback und Caching vorhanden.

**Priorität:** Hoch  
**Aufwand:** 2–3 Tage

---

## 2. Sektor- & Industry-Exposure Overlay

### Soll-Zustand
- Farbcodierte Regionen nach dominanter Sektor-Aktivität.
- Beispiele mit Fakten:
  - Semiconductors → Taiwan, Südkorea (TSMC, Samsung).
  - Autos → Deutschland, Mexiko, Japan.
  - Mining → Australien, Chile, Kanada.
  - Tech/Software → USA, Indien.
- Layer-Toggle zwischen Capex und Sektor.
- Side-Panel zeigt Sektor-Breakdown in %.

### Daten & Fakten
- FMP Sector/Industry + Geographic Segments.
- Bestehende Sector-Opportunity-Daten im Researcher.
- Metrik: Anteil des Sektor-Capex oder -Revenue pro Region (z. B. „65 % des Capex in TW entfällt auf Semiconductors“).

### Acceptance Criteria
- Mindestens 8–10 Sektoren farblich unterscheidbar.
- Overlay unabhängig umschaltbar.
- Side-Panel zeigt prozentuale Aufteilung.

**Priorität:** Hoch  
**Aufwand:** 1–1,5 Tage

---

## 3. Bitcoin-Miner-Layer

### Soll-Zustand
- Marker oder Bubbles für bekannte Mining-Standorte / Länder.
- Größe/Farbe = geschätzte Hashrate-Anteil oder Power Capacity (MW).
- Klick → Liste der Miner (MARA, RIOT, CLSK, BITF, IREN, HUT etc.) mit:
  - Hashrate (EH/s),
  - Stromkosten / Hashprice-Kontext,
  - Standort-Details.
- Beispiele: Texas (USA), Kazakhstan, Canada, Paraguay, Oman.

### Daten & Fakten
- Öffentliche Unternehmensangaben + bekannte Farm-Standorte.
- Cambridge Bitcoin Electricity Consumption Index (Hashrate nach Land) als Referenz.
- Bestehende BTC-Miner-Pipeline (`btc-miner.ts`, Hashprice, Breakeven) für Zahlen.
- Typische Werte (Stand 2026): USA ~35–40 % der globalen Hashrate, Kazakhstan und Canada relevant, einzelne Farms 100–500 MW.

### Acceptance Criteria
- Mindestens 8–10 Mining-Regionen/Standorte sichtbar.
- Klick zeigt konkrete Miner + Hashrate/MW-Zahlen.
- Verknüpfung mit bestehendem BTC-Dashboard möglich.
- Sauberer Fallback, wenn Standort-Daten fehlen.

**Priorität:** Hoch (passt perfekt zum bestehenden BTC-Modul)  
**Aufwand:** 1,5–2 Tage

---

## Technische Umsetzung

- Frontend: Neue Komponente im Researcher (z. B. `GeoMapPanel.tsx`).
- Karte: 2D (react-simple-maps / Leaflet).
- Backend: `GET /api/researcher/geo-map?layer=capex|sector|miner`.
- Datenfluss: UI → Query → API → Researcher-Handler → FMP / BTC-Miner-Daten / Cache.
- Layer-Toggle + Side-Panel.

### Gesamt-Acceptance
- Alle drei Layer funktionieren und sind umschaltbar.
- Konkrete Zahlen in Side-Panels.
- Keine Regression in bestehenden Researcher-Tabs.
- Performance flüssig.

**Gesamt-Aufwand v1:** ca. 5–6,5 Tage  
**Priorität:** Hoch

---

## Nächste Schritte
1. Datenverfügbarkeit prüfen (FMP Capex/Geo + Miner-Standorte).
2. Backend-Endpoint bauen.
3. 2D-Karte + Layer implementieren.
4. Side-Panels mit Zahlen.
5. Nach Umsetzung auf `fertig_` umbenennen und in Ampel dokumentieren.

---

*Erweitert am 18.10.2026 – Capex + Sektor + Bitcoin-Miner mit konkreten Daten und Fakten.  
Repo: https://github.com/1719842374/Aktienanalyst*
