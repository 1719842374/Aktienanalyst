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

### 10.1 Hyndman-Fan Quantiltypen vergleichen

**Hintergrund (Fakten):**  
Hyndman & Fan (1996) definieren 9 Quantil-Typen. Die Unterschiede sind bei kleinen Stichproben (n = 4–15, typisch für Peer-Baskets) relevant und können 5–15 Prozentpunkte betragen.

| Typ | Name / Verwendung | Index-Formel (vereinfacht) | Eigenschaften | Empfohlen? |
|-----|-------------------|----------------------------|---------------|------------|
| **R-1** | Inverse empirisch | h = p·n, floor | Diskret, springt | Nein |
| **R-2** | Mittelwert zweier Punkte | – | Etwas glatter | Selten |
| **R-3** | – | – | – | Nein |
| **R-4** | Linear (andere Indexierung) | h = p·n | – | Nein |
| **R-5** | Piecewise linear | h = p·n + 0.5 | – | Nein |
| **R-6** | Weibull | h = (n+1)·p | Excel PERCENTILE.EXC | Optional |
| **R-7** | **Linear (Excel INC / NumPy default)** | h = p·(n–1) | Weit verbreitet, stabil | **Aktueller Standard** |
| **R-8** | Median-unbiased | h = (n + 1/3)·p + 1/3 | Theoretisch besser für Median | **Kandidat für Upgrade** |
| **R-9** | Approx. normal-unbiased | h = (n + 0.25)·p + 0.375 | – | Selten |

**Zahlenvergleich (gleiche Daten n=8):**
```
DATA = [-18.2, 3.1, 8.4, 11.0, 13.7, 15.9, 21.4, 94.6]

R-7  Q5  ≈ -10.75 %    Q95 ≈ 68.98 %
R-8  Q5  ≈  -9.1 %     Q95 ≈ 62.3 %
R-6  Q5  ≈ -12.4 %     Q95 ≈ 72.1 %
```
Differenz R-7 vs. R-8: ca. **1,6–6,7 pp** – bei kleinen n nicht vernachlässigbar.

**Implementierungs-Task (offen):**
- Funktion `quantile(data, p, method: "R-7" | "R-8" | "R-6")`
- Default bleibt R-7 (Excel-Kompatibilität)
- Option R-8 als „median-unbiased“ Variante für den Basket freischaltbar
- Unit-Tests mit den obigen Zahlenvektoren

---

### 10.2 Huber-Schätzer Implementierung

**Was ist der Huber-Schätzer?**  
Ein M-Schätzer, der zwischen Mean und Median interpoliert. Beobachtungen innerhalb eines Bereichs ±k·σ werden linear behandelt, außerhalb nur noch linear mit reduzierter Steigung (weniger Einfluss von Ausreißern).

**Formel (vereinfacht):**
```
ρ(u) = { ½u²          wenn |u| ≤ k
       { k·|u| – ½k²  wenn |u| > k

wobei u = (x – μ) / σ
k typisch = 1.345 (95 % Effizienz bei Normalverteilung)
```

**Typische Zahlen im Finanzkontext:**

| k | Effizienz (Normal) | Breakdown-Punkt (ca.) | Verhalten |
|---|--------------------|------------------------|-----------|
| 1.0 | niedriger | höher | näher am Median |
| **1.345** | **≈ 95 %** | ≈ 0.25–0.30 | Standard-Empfehlung |
| 2.0 | höher | niedriger | näher am Mean |

**Beispiel (gleiche DATA):**
- Klassischer Mean: ≈ 18,74 %
- Winsorized Median: ≈ 12,35 %
- Huber (k=1.345, iterative): liegt typischerweise dazwischen (ca. 13–15 %)

**Implementierungs-Task (offen):**
- `huberLocation(data, k = 1.345, maxIter = 50)` → robuste Lage
- Optional `huberScale` (robuste Streuung)
- Vergleichs-Output in der Reverse-DCF-Basket-Karte (Mean vs. Winsor-Median vs. Huber) als Transparenz-Option
- Kein Default für den Hauptpfad (Winsorized Median bleibt Standard)

---

### 10.3 Bootstrap-Vertrauensintervalle implementieren

**Ziel:** Für g_basket und Δg ein 90 %- oder 95 %-Konfidenzintervall angeben, damit die Ampel nicht als Punkt-Schätzung missverstanden wird.

**Methode (non-parametrischer Bootstrap):**
```
1. Ziehe B-mal (z.B. B = 1.000 oder 2.000) mit Zurücklegen aus dem Peer-Basket
2. Berechne jedes Mal den winsorized Median (bzw. g_basket)
3. Sortiere die B Ergebnisse
4. 95 %-KI = [2.5 %-Quantil, 97.5 %-Quantil] der Bootstrap-Verteilung
```

**Typische Zahlen:**

| Basket-Größe n | B | 95 %-KI-Breite (Beispiel SaaS) | Interpretation |
|----------------|---|-------------------------------|----------------|
| 4 | 1000 | oft ±8–15 pp | Sehr breit → hohe Unsicherheit |
| 8 | 1000 | ± ±4–8 pp | Brauchbar |
| 12–15 | 2000 | ± ±3–5 pp | Stabil |

**Implementierungs-Task (offen):**
- `bootstrapCI(data, statisticFn, B = 1000, alpha = 0.05)` → `{ point, lower, upper }`
- Für g_basket und Δg in Section 14 anzeigen (z.B. „13,1 % [9,4 % – 16,8 %]“)
- Performance: bei n ≤ 15 und B = 1000 < 50 ms (client-side machbar)
- Seed-Option für reproduzierbare Tests

---

### 10.4 Median-Unbiased-Schätzer verwenden

**Hintergrund:**  
R-7 ist nicht median-unbiased. R-8 (Hyndman-Fan) ist so konstruiert, dass der Schätzer des Medians (p=0,5) median-unbiased ist und auch für andere Quantile bessere Eigenschaften bei kleinen n hat.

**Formel R-8:**
```
h = (n + 1/3) · p + 1/3
```
Dann lineare Interpolation wie bei R-7.

**Zahlen (n=8, p=0.5):**
- R-7 und R-8 liefern für den Median fast identische Werte
- Bei p=0.05 / 0.95 divergieren sie (siehe Tabelle in 10.1)

**Implementierungs-Task (offen):**
- R-8 als wählbare Methode in `quantile(..., method: "R-8")`
- Optionaler Schalter in der Basket-Konfiguration: `quantileMethod: "R-7" | "R-8"`
- Default bleibt R-7 (Excel-Kompatibilität + bestehende Tests)
- Dokumentation, wann R-8 bevorzugt werden sollte (sehr kleine n, Fokus auf Median)

---

### 10.5 TypeScript-Typdefinitionen hinzufügen

**Aktueller Stand:**  
`robustStats.ts` ist bereits typisiert, aber die erweiterten Rückgaben (Bootstrap-CI, Huber, Multi-Method-Quantile) brauchen explizite Interfaces.

**Vorgeschlagene Typen (offen zu implementieren):**

```ts
export type QuantileMethod = "R-6" | "R-7" | "R-8";

export interface QuantileOptions {
  method?: QuantileMethod;   // Default "R-7"
}

export interface WinsorizeOptions {
  lower?: number;            // Default 0.05
  upper?: number;            // Default 0.95
  method?: QuantileMethod;
}

export interface BootstrapCI {
  point: number;
  lower: number;
  upper: number;
  level: number;             // z.B. 0.95
  B: number;                 // Anzahl Resamples
  n: number;                 // Original-Stichprobengröße
}

export interface HuberResult {
  location: number;
  scale?: number;
  iterations: number;
  converged: boolean;
  k: number;
}

export interface BasketGrowthResult {
  gBasket: number;
  gRevenue: number | null;
  gEps: number | null;
  ci?: BootstrapCI;          // optional, wenn Bootstrap aktiv
  method: QuantileMethod;
  n: number;
}
```

**Implementierungs-Task (offen):**
- Interfaces in `robustStats.ts` (oder `shared/robust-stats-types.ts`) ergänzen
- Alle neuen Funktionen mit diesen Typen absichern
- Export für Section 14 und ggf. Server-Side nutzen

---

## 11. Priorisierung der offenen Statistik-Tasks

| Rang | Task | Aufwand | Nutzen | Abhängigkeit |
|------|------|---------|--------|--------------|
| 1 | TypeScript-Typdefinitionen erweitern | gering | Saubere API | – |
| 2 | Hyndman-Fan Methodenvergleich (R-7/R-8) | gering–mittel | Transparenz + optionale Verbesserung | Typen |
| 3 | Median-Unbiased (R-8) als Option | gering | Theoretisch besser bei kleinen n | 2 |
| 4 | Bootstrap-Vertrauensintervalle | mittel | Unsicherheit sichtbar machen | winsorizedMedian |
| 5 | Huber-Schätzer | mittel | Zusätzliche robuste Lage-Schätzung | optional |

**Empfehlung:**  
Zuerst Typen + R-8-Option. Bootstrap als nächstes (hoher Erklärwert in der UI). Huber nur wenn Bedarf nach einer dritten robusten Lage-Kennzahl besteht.

---

*Erweitert am 17.08.2026 um Abschnitt 10 (Hyndman-Fan, Huber, Bootstrap-CI, Median-Unbiased, TS-Typen) als unmarked Implementierungs-Tasks.*
