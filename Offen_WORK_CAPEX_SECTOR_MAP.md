# Offen_WORK_CAPEX_SECTOR_MAP.md — Capex- und Sektor-Map im Researcher-Tab
<img width="1792" height="1008" alt="image" src="https://github.com/user-attachments/assets/976dceca-6737-4b61-a0cf-c46e4f307186" />

> **Stand: 18.10.2026**  
> Fokussierte Spec für Capex-Hotspots und Sektor-Exposure auf einer 2D-Weltkarte.  
> Mit konkreten Zahlen, Datenquellen und Acceptance Criteria.  
> Ergänzt die erweiterte Version in `Offen_WORK_RESEARCHER_CAPEX_MAP.md`.

**Ziel:** Im Researcher-Tab eine 2D-Weltkarte, die zeigt, wo Unternehmen am meisten investieren (Capex) und welche Sektoren in welchen Regionen dominieren.

---

## 1. Capex / Investment Hotspots

### Soll-Zustand
- 2D-Karte mit Bubbles oder Heatmap.
- Größe/Farbe = Capex-Volumen (TTM/FY in Mrd. USD oder YoY %).
- Klick auf Land/Region → Side-Panel mit Top-Unternehmen + Capex-Betrag + Sektor-Anteil.

### Daten & Fakten
- Quelle: FMP Capex (Cash Flow) + Geographic Segments.
- Aggregation: Länder/Regionen (US, CN, TW, KR, DE, JP, IN, etc.).
- Beispiel: „Taiwan: ~30+ Mrd. USD Capex, dominiert von TSMC (Semiconductors)“.
- Bestehende Researcher-Pipeline wiederverwenden.

### Acceptance Criteria
- ≥ 20 Länder/Regionen mit Capex-Daten.
- Konkrete USD-Zahlen im Side-Panel.
- Caching und N/A-Fallback.

**Aufwand:** 2–3 Tage

---

## 2. Sektor- & Industry-Exposure Overlay

### Soll-Zustand
- Farbcodierung nach dominanter Sektor-Aktivität.
- Beispiele:
  - Semiconductors: Taiwan, Südkorea.
  - Autos: Deutschland, Mexiko, Japan.
  - Mining: Australien, Chile.
  - Tech: USA, Indien.
- Toggle zum Capex-Layer.
- Side-Panel: Sektor-Breakdown in %.

### Daten & Fakten
- FMP Sector + Geographic Segments.
- Metrik: Anteil des Sektor-Capex/-Revenue pro Region (z. B. „70 % Capex in KR = Semiconductors/Memory“).
- Anbindung an bestehenden Sector-Opportunity-Tab.

### Acceptance Criteria
- 8–10 Sektoren unterscheidbar.
- Prozentuale Aufteilung im Side-Panel.
- Unabhängig umschaltbar.

**Aufwand:** 1–1,5 Tage

---

## Technische Umsetzung

- Frontend: `GeoMapPanel` oder ähnlich im Researcher.
- Backend: `GET /api/researcher/geo-map?layer=capex|sector`.
- Datenfluss: UI → API → FMP-Aggregation → Side-Panel.
- 2D-Karte (react-simple-maps / Leaflet).

### Gesamt-Acceptance
- Beide Layer funktionieren mit konkreten Zahlen.
- Keine Regression in anderen Researcher-Tabs.
- Flüssige Performance.

**Gesamt-Aufwand:** ca. 3,5–4,5 Tage  
**Priorität:** Hoch

---

## Nächste Schritte
1. FMP-Datenverfügbarkeit prüfen.
2. Aggregations-Endpoint bauen.
3. Karte + Side-Panel implementieren.
4. Nach Umsetzung auf `fertig_` umbenennen.

---

*Erstellt am 18.10.2026 – detaillierte Capex- + Sektor-Map-Spec mit Zahlen und Fakten.  
Repo: https://github.com/1719842374/Aktienanalyst*

---

## Ampel / Soll-Ist (Nachzug main `01bf6089`, 09.11.2026 Europe/Madrid)

| Teil | Ampel | Beleg auf main |
|---|---|---|
| Capex-Layer Slice 1 | 🟡 Soft | #283 Squash `0498b8617b44…` — `GeoMapPanel.tsx` → `GET /api/researcher/geo-map?layer=capex` → `server/researcher-geo-map-route.ts` → `server/researcher-geo-map.ts` → `shared/geo-map.ts` |
| Sektor-Overlay | 🟡 Soft | Layer `sector` in `GeoMapPanel.tsx` (`LAYERS`, `sectorColor` / `sectorLegendShares`); Acceptance „8–10 Sektoren live + Side-Panel %“ nicht in diesem Docs-Lauf live belegt |
| Gold-Mining-Layer | 🟡 Soft | Companion-Spec §4 / #411 Squash `a2ac30c8d4feea2ab67e093b826ce2a31f695ead` (Parent `266d3899`) — `layer=gold`, USGS-Bubbles |
| Miner-Layer | 🟡 Soft | `layer=miner` + `MinerMapPanel` auf main; Länderanteil n/a laut Panel-Kommentar |
| Spec-Datei | offen | bleibt `Offen_WORK_CAPEX_SECTOR_MAP.md` (kein Rename). Live-Acceptance ≥20 Länder / Top-Firmen-Panel nicht in diesem Lauf gegen Prod geprüft → nicht 🟢 |

Kette (Capex/Sektor): UI `client/src/components/researcher/GeoMapPanel.tsx` + Mount `Researcher.tsx` Tab capex → `apiRequest`/`queryClient` → `GET /api/researcher/geo-map?layer=capex|sector|…` → `server/routes-register.ts` `registerGeoMapRoute` → `server/researcher-geo-map-route.ts` → `server/researcher-geo-map.ts` → `shared/geo-map.ts` / `shared/geo-map-layers.ts`.
