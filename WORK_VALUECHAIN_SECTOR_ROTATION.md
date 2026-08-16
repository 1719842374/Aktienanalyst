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

## 2–9. (bestehende Abschnitte unverändert)

> Die Abschnitte 2–9 (Value Chain Spec, LLM-Validierung, 13F, Reverse-DCF-Basket, Kostolany, UI, Reihenfolge, Design-Entscheidungen) bleiben wie zuvor dokumentiert.  
> Die bereits implementierte Basis-Utility liegt unter `client/src/lib/robustStats.ts` (R-7, Winsorize 5/95, winsorizedMedian).

---

## 10. Erweiterte robuste Statistik – Offene Implementierungs-Tasks (unmarked)

> **Status: offen / unmarked**  
> Diese Punkte sind **nicht** Teil des MVP, sondern bewusst als nächste Vertiefungsstufe für die Implementierungsphase vorgesehen.  
> Sie bauen auf der bestehenden `robustStats.ts` auf und bleiben 100 % generisch (kein Ticker-/Sektor-Hardcode).

### 10.1–10.5 (Hyndman-Fan, Huber, Bootstrap, Median-Unbiased, TS-Typen)

Siehe vorherige Dokumentation in diesem File (unverändert).

---

## 12. MVP vs. Ausbaustufen – Entscheidungsplan (Bootstrap + Huber)

> **Stand: 17.08.2026**  
> Klare Priorisierung, ob und wann Bootstrap-Konfidenzintervalle und Huber-Schätzer gebaut werden sollen.

### Kurzentscheidung

Für den **aktuellen MVP** (Reverse-DCF-Basket + Winsorized Median) brauchst du **beides noch nicht zwingend**.  
Die bereits vorhandene `robustStats.ts` (R-7 + Winsorize 5/95 + Median) reicht für den Start völlig aus.

Beide Themen sind **sinnvolle nächste Ausbaustufen**, aber **keine Blocker**.

---

### 12.1 Bootstrap-Resampling / Konfidenzintervalle

**Was ist das?**  
Beim Bootstrap ziehst du aus dem Peer-Basket viele Male mit Zurücklegen neue Stichproben und berechnest jedes Mal denselben Schätzer (winsorized Median / g_basket). Daraus entsteht eine empirische Verteilung → Konfidenzintervalle.

**Typische Zahlen (Use-Case Reverse-DCF-Basket):**

| Basket-Größe n | B (Resamples) | Typische 95 %-KI-Breite für g_basket | Aussagekraft |
|----------------|---------------|-------------------------------------|--------------|
| 4              | 1.000         | ± 8–15 pp                           | Sehr unsicher |
| 6–8            | 1.000         | ± 4–8 pp                            | Brauchbar |
| 12–15          | 2.000         | ± 3–5 pp                            | Stabil |

**Beispiel:**  
g_basket = 13,1 % → mit Bootstrap z. B. **13,1 % [9,4 % – 16,8 %]**.  
Damit siehst du, ob ein Δg von +6 pp wirklich „sportlich“ ist oder noch innerhalb der Unsicherheit liegt.

**Wann brauchst du es?**

| Situation                              | Empfehlung                                      |
|----------------------------------------|-------------------------------------------------|
| MVP / erste Live-Version               | **Nein** – Punkt-Schätzung + Ampel reicht       |
| Transparenz in Section 14              | **Ja** – sehr hoher Erklärwert                  |
| Basket oft nur 4–6 Peers               | **Besonders sinnvoll** (Unsicherheit groß)      |
| Performance (Client)                   | B=1.000 bei n≤15 ist < 50 ms → unproblematisch  |

**Fazit Bootstrap:** Nice-to-have mit hohem pädagogischem Nutzen. Nicht dringend für die erste funktionsfähige Basket-Logik.

---

### 12.2 Robuste Statistik-Algorithmen (Überblick)

| Algorithmus              | Was er macht                          | Breakdown-Punkt | Status bei uns          |
|--------------------------|---------------------------------------|-----------------|-------------------------|
| Median                   | 50 %-Quantil                          | 50 %            | ✅ bereits im Einsatz  |
| Winsorisierung           | Extreme auf Quantile setzen           | abhängig        | ✅ bereits im Einsatz  |
| Trimmen                  | Extreme entfernen                     | abhängig        | optional vorhanden      |
| Huber-Schätzer           | Kompromiss Mean ↔ Median              | ca. 25–30 %     | offen (niedrige Prio)   |
| MAD                      | Robuste Streuung                      | 50 %            | noch nicht nötig        |
| Quantile Regression      | Bedingte Quantile                     | hoch            | später                  |

**Aktueller Stand reicht:** R-7 + Winsorize 5/95 + winsorizedMedian ist die Standard-Kombination in der Finanzliteratur für Peer-Baskets.

| Erweiterung              | Jetzt nötig? | Begründung                                      |
|--------------------------|--------------|-------------------------------------------------|
| Huber-Schätzer           | **Nein**     | Winsorized Median ist robuster und einfacher    |
| MAD / robuste Volatilität| **Nein**     | Erst relevant bei Unsicherheit der CAGRs selbst |
| R-8 Quantile             | Optional     | Theoretisch etwas besser bei sehr kleinen n     |
| Bootstrap                | Optional     | Gibt Unsicherheitsmaß, ändert Punkt-Schätzer nicht |

---

### 12.3 Klare Empfehlung für das Projekt

**Jetzt (MVP)**
1. Bleib bei **winsorizedMedian** (5/95, R-7).
2. Zeige in Section 14 nur: g* · g_basket · Δg · Ampel.
3. Das beantwortet die Kernfrage:  
   „Preist der Markt realistisch im Vergleich zu dem, was die Peers historisch geliefert haben?“

**Als nächstes (wenn die Basis läuft)**
1. **Bootstrap-KI** für g_basket und Δg (hoher UI-Nutzen) → Priorität unter den Ausbaustufen.
2. Optional R-8 als umschaltbare Methode.
3. Huber nur, wenn wirklich eine dritte robuste Lage-Kennzahl verglichen werden soll.

**Was du nicht brauchst**
- Komplexe M-Schätzer-Bibliotheken
- Quantile Regression
- Sehr hohe Bootstrap-Zahlen (B > 2000)
- Hardcodierte Schwellen pro Sektor

---

### 12.4 Implementierungs-Reihenfolge (aktualisiert)

| Rang | Task                              | MVP? | Aufwand | Nutzen                  |
|------|-----------------------------------|------|---------|-------------------------|
| 1    | winsorizedMedian + Δg + Ampel     | **Ja** | gering  | Kernfunktion            |
| 2    | TypeScript-Typen erweitern        | Nein | gering  | Saubere API             |
| 3    | Bootstrap-Konfidenzintervalle     | Nein | mittel  | Hoher Erklärwert in UI  |
| 4    | R-8 als Option                    | Nein | gering  | Theoretische Verbesserung |
| 5    | Huber-Schätzer                    | Nein | mittel  | Nur bei explizitem Bedarf |

---

*Abschnitt 12 hinzugefügt am 17.08.2026 – Entscheidungsplan MVP vs. Bootstrap/Huber.*
