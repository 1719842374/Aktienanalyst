# Offen_WORK_BUFFETT_ASIA_10Y.md — Priorisierte Makro-Erweiterungen (GuruFocus-Vergleich)

> **Stand: 18.10.2026**  
> Priorisierte, wirklich relevante Punkte aus dem GuruFocus-Feature-Vergleich.  
> Alle anderen GuruFocus-Menüpunkte (Score Board, Hot Picks, Sector Picks, GF Value, Fund Letters, Options Holdings etc.) sind bewusst **nicht** enthalten – entweder bereits abgedeckt oder kein Mehrwert im aktuellen Setup.

**Ziel:** Nur die drei Punkte umsetzen, die Philip explizit als relevant markiert hat.

---

## 1. Buffett Indicator als Makro-Kontext

### Ist-Zustand
- Kein Buffett Indicator im Aktienanalyst-Dashboard.
- Referenz-Screenshot (currentmarketvaluation.com): Stand 30.06.2026 bei **+2,6 Standardabweichungen** über dem historischen Trend → stark überbewertet.

### Soll-Zustand
- Kompakter Makro-Indikator in der Aktienanalyse-Sektion (z. B. neben Sektion 12 Technische Analyse oder als eigener kleiner Filter/Karte).
- Anzeige:
  - Aktueller Wert (Std-Dev vom historischen Trend oder Percentile).
  - Kurze Einordnung (stark überbewertet / überbewertet / fair / unterbewertet).
  - Optional: kleiner historischer Chart oder Link auf den Verlauf.
- Kein 1:1-Nachbau von GuruFocus. Ein aktueller Std-Dev-Wert + Einordnung reicht.

### Datenquelle & Implementierung
- Daten: Wilshire 5000 / GDP oder vergleichbare öffentliche Quelle (FRED `WILL5000PR` + GDP, oder etablierte Berechnung).
- Backend: neuer kleiner Endpoint oder Erweiterung der bestehenden Makro-/Researcher-Pipeline.
- Frontend: neue kleine Komponente oder Overlay in der bestehenden Aktienanalyse-Page.
- Caching analog zu anderen Makro-Indikatoren (z. B. 10Y, VIX).

### Acceptance Criteria
- Aktueller Buffett-Indikator-Wert wird angezeigt.
- Einordnung (Std-Dev oder Zone) ist sichtbar und korrekt.
- Keine Abhängigkeit von bezahlten GuruFocus-Daten.
- Ladezeit und Fehlerbehandlung (N/A-Fallback) sauber.

### Soll-Ist 25.10.2026 (HEAD `09750838`)
- Soll: Karte bei S12 mit Std-Dev/Zone, ohne GuruFocus, N/A-Fallback.
- Ist: ✅ #319 `4eaf1115` (Karte S12) auf Basis #274 `99a06d1b` (robust, Grund statt 502); EU/CN-Erweiterung ✅ #320 `09750838`; Asia-Benchmark (^TPX) **offen**.

**Priorität:** Hoch  
**Aufwand:** 0,5–1 Tag

---

## 2. Asien-Aggregation im Rezession-/Korrektur-Dashboard

### Ist-Zustand (Bug / Ungenauigkeit)
- Aktuell nur **„Asien (Japan)“** als Tab/Region.
- Asien besteht aus mehr als Japan (China, Südkorea, Taiwan, Indien etc.).
- Die 50 %- „Moderat“-Bewertung und Top-Treiber gelten nur für Japan, nicht für eine echte Asien-Aggregation.

### Soll-Zustand
- Region heißt **„Asien“** (nicht mehr „Asien (Japan)“).
- Aggregation mindestens von **Japan + China** (idealerweise weitere relevante Märkte: Südkorea, Taiwan, Indien).
- Die Katalog-Bewertung (Rezession / Korrektur), Prozentwert, Zone und Top-3-Treiber werden auf der **aggregierten Asien-Ebene** berechnet und angezeigt.
- Datenquellen entsprechend erweitert und gewichtet.

### Technische Umsetzung
- Backend (`server/recession.ts` + regionale Kataloge):
  - Asien-Region als gewichtete Aggregation definieren.
  - Datenquellen für China + Japan (+ weitere) einbinden.
  - Scoring und Treiber auf aggregierter Ebene rechnen.
- Frontend (RecessionDashboard):
  - Label von „Asien (Japan)“ auf „Asien“ ändern.
  - Anzeige der aggregierten Werte und Treiber.

### Acceptance Criteria
- Tab/Label zeigt „Asien“.
- Bewertung und Top-Treiber basieren auf aggregierten Daten (nicht nur Japan).
- Keine Regression bei US- und Europa-Katalogen.
- N/A-Slots sauber behandelt.

### Soll-Ist 25.10.2026 (HEAD `09750838`)
- Soll: Label „Asien“, Aggregation mind. Japan + China, Score/Treiber aggregiert.
- Ist: kein Commit dazu gemeldet oder geprüft → **OFFEN**.

**Priorität:** Hoch (konkreter Fix, den Philip angesprochen hat)  
**Aufwand:** 1–1,5 Tage

---

## 3. 10-Year Treasury als Overlay in der Technischen Analyse

### Ist-Zustand
- 10Y Treasury Interest Rates sind bereits implementiert (Daten vorhanden).
- Noch **nicht** als Overlay in der Sektion **12 Technische Analyse** im Aktienanalyse-Dashboard.

### Soll-Zustand
- 10Y Treasury Yield als Overlay (oder Toggle) im technischen Chart der Aktienanalyse (Sektion 12).
- Zinskontext direkt im Chart sichtbar (steigende/fallende Zinsen im Vergleich zum Aktienchart).
- Optional: einfache Annotation oder Farbe bei signifikanten Bewegungen.

### Technische Umsetzung
- Daten sind bereits vorhanden → nur Frontend-Overlay + ggf. kleine Anpassung der Chart-Komponente.
- Wiederverwendung der bestehenden 10Y-Fetch-Logik.
- Kein neues Backend nötig, falls die Daten schon im Analyse-Response stecken; sonst kleiner Endpoint-Erweiterung.

### Acceptance Criteria
- 10Y-Linie erscheint als Overlay im Technischen Analyse-Chart.
- Toggle oder klare Sichtbarkeit.
- Keine Performance-Probleme durch den Overlay.
- Sauberer Fallback bei fehlenden Daten.

### Soll-Ist 25.10.2026 (HEAD `09750838`)
- Soll: 10Y-Treasury-Linie als Overlay/Toggle in `TechnicalChart`.
- Ist: #267 (Squash vor `4820aaa3`) bringt ein Real10Y-Overlay (FRED DFII10, real) in `TechnicalChart.tsx`; nominaler 10Y laut Spec nicht belegt → **🟡 Teil**, Entscheidung „DFII10 reicht?“ offen.

**Priorität:** Mittel (optional, aber sauber und relativ wenig Aufwand)  
**Aufwand:** 2–4 Stunden

---

## Priorisierung & Reihenfolge

| # | Feature                          | Priorität | Aufwand     | Bemerkung                          |
|---|----------------------------------|-----------|-------------|------------------------------------|
| 1 | Asien-Aggregation (Rezession)    | Hoch      | 1–1,5 Tage | Konkreter Fix, den Philip genannt hat |
| 2 | Buffett Indicator                | Hoch      | 0,5–1 Tag  | Nützlicher Makro-Kontext           |
| 3 | 10Y Treasury Overlay (TA)        | Mittel    | 2–4 h      | Daten schon da, nur Overlay        |

---

## Was bewusst **nicht** umgesetzt wird

- GuruFocus Score Board / Hot Picks / Guru Bargains (bereits über Screening + Trend-Gates abbildbar)
- Sector Picks / Industry Trends (bereits über Sektor-Analysen und 3D-Value-Chain abgedeckt)
- GF Value / Shiller P/E 1:1 (eigene Valuation-Modelle: Reverse DCF, Fast-Grower etc. sind stärker)
- Fund Letters Archive, Mutual Funds, Options Holdings, European Shorting, Geographic Trend in GuruFocus-Tiefe
- Alle weiteren Economic Indicators außer dem, was bereits existiert oder oben genannt ist

---

## Nächste Schritte

1. Asien-Aggregation als erstes Ticket anlegen und umsetzen.
2. Buffett Indicator als kompakte Karte/Overlay spezifizieren und bauen.
3. 10Y Overlay in Sektion 12 Technische Analyse ergänzen.
4. Nach Umsetzung jeweils in `WORK_IMPLEMENTIERUNG_OFFEN.md` / Ampel dokumentieren und auf `fertig_` umbenennen.

---

*Erstellt am 18.10.2026 auf Basis des GuruFocus-Vergleichs und Philips Priorisierung.  
Repo: https://github.com/1719842374/Aktienanalyst*
