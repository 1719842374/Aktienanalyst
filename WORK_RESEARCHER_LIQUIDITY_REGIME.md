# WORK_RESEARCHER_LIQUIDITY_REGIME.md

**Status:** Implementierungsvorschlag  
**Datum:** 24.08.2026  
**Ziel:** Minimal-invasives Liquidity & Regime Overlay im **Researcher-Modus**  
**Fokus:** Handlungsrelevante monetaristische Signale (kein Theorietext)

---

## 1. Aktuelle Zahlen, Daten & Fakten (Stand Juni/Juli 2026)

### USA

| Kennzahl              | Wert                          | Kommentar |
|-----------------------|-------------------------------|-----------|
| **M2 Level**          | ca. **$23,15–23,2 Bio.**      | Allzeithoch |
| **M2 YoY-Wachstum**   | **5,53 %** (Juni 2026)        | Leicht über Vorjahr (4,14 %), unter langfristigem Ø (~6,8 %) |
| **M2 Velocity**       | **1,412** (Q2 2026)           | Leicht steigend von den Tiefs, immer noch deutlich unter 1,8–2,0 (Vor-2008) |
| **M2 / GDP-Ratio**    | ca. **71 %**                  | Nahezu zurück auf Pre-Pandemie-Trend |

### Eurozone

| Kennzahl              | Wert                          | Kommentar |
|-----------------------|-------------------------------|-----------|
| **M3 YoY-Wachstum**   | **3,3 %** (Juni 2026)         | Moderates Wachstum |
| **M3 Level**          | ca. **€17,61 Bio.**           | — |

### Excess Money Growth (vereinfachte Näherung)

```text
Excess Money Growth ≈ %ΔM2 − %Δ reales BIP − %Δ CPI
```

**Aktuelle grobe Schätzung (2026):**
- Reales BIP-Wachstum ≈ 2,0–2,5 %
- CPI ≈ 2,5–3,5 %
- → **leicht positiv bis neutral**

Vergleich:
- 2020/21: stark positiv (expansiv)
- 2023: negativ (kontraktiv)
- 2026: normalisiert, leicht unterstützend

### Güter- vs. Vermögenspreisinflation

- **CPI** bleibt moderat (meist 2,5–3,5 %)
- **Vermögenspreise** (Aktien, Immobilien) sind über längere Zeiträume klar stärker gestiegen als der CPI
- Die Divergenz ist ein zentrales Thema der letzten 15–20 Jahre und relevant für Multiple-Expansion

### Fazit der aktuellen Lage

Die extreme Liquiditätsflut der Pandemie ist weitgehend normalisiert.  
M2 wächst wieder moderat. Velocity erholt sich langsam.  
Das Umfeld ist weder stark inflationär noch stark restriktiv → **„normalisiertes, leicht unterstützendes“ Liquiditätsregime**.

---

## 2. Warum im Researcher-Modus?

- Der Researcher ist der richtige Ort für **Makro-Overlays** und Regime-Filter.
- Bottom-up-Analyse (DCF, GARP, Thesis-Stärke) bleibt unberührt.
- Der Overlay liefert nur Kontext und leichte Score-Anpassungen.

---

## 3. Architektur-Vorschlag (minimal-invasiv)

### 3.1 Neuer Abschnitt / Widget: „Liquidity & Regime“

**Ort:** Researcher-Seite (neben bestehenden MacroPanel / CapexPanel etc.)

**Darstellung:**
- Kompakte Karte oder Sidebar-Widget
- **Ampel / Regime-Score** (0–100 oder Grün/Gelb/Rot)
- Key-Metrics-Tabelle (USA + Eurozone nebeneinander)
- Kurzer interpretierender Text

### 3.2 Regime-Score – Formel & Gewichtung

```text
RegimeScore = 0.40 × ExcessMoneyScore
            + 0.30 × FriedmanKorridorScore
            + 0.20 × VelocityTrendScore
            + 0.10 × M2GdpDeviationScore
```

**Score-Berechnung (0–100):**

1. **ExcessMoneyScore**
   - Excess > +3 % → 90–100 (stark expansiv)
   - Excess +1 bis +3 % → 70–89
   - Excess −1 bis +1 % → 45–69 (neutral)
   - Excess < −1 % → 0–44 (restriktiv)

2. **FriedmanKorridorScore** (Zielkorridor 3–5 % M2-Wachstum)
   - 3–5 % → 80–100
   - 5–7 % oder 2–3 % → 50–79
   - > 7 % oder < 2 % → 0–49

3. **VelocityTrendScore**
   - Steigend (letzte 2–4 Quartale) → 70–100
   - Stabil → 40–69
   - Fallend → 0–39

4. **M2GdpDeviationScore**
   - Nahe Trend (z. B. ±2 pp) → hoch
   - Starke positive Deviation → expansiv
   - Starke negative Deviation → restriktiv

**Ampel-Mapping:**
- ≥ 70 → Grün (leicht/stark expansiv)
- 40–69 → Gelb (neutral)
- < 40 → Rot (restriktiv)

### 3.3 Key Metrics Tabelle

| Metric                  | USA          | Eurozone     |
|-------------------------|--------------|--------------|
| Geldmengenwachstum YoY  | M2 %         | M3 %         |
| Velocity                | M2V          | —            |
| Excess Money Growth     | berechnet    | berechnet*   |
| Asset vs Goods          | optional     | optional     |

*Eurozone-Approximation mit M3 und verfügbaren BIP/CPI-Daten.

---

## 4. Datenquellen (pragmatisch & stabil)

### Primär – FRED (kostenlos, sehr stabil)

| Series ID     | Beschreibung                      | Verwendung          |
|---------------|-----------------------------------|---------------------|
| `M2SL`        | M2 Money Stock (SA)               | Level + YoY         |
| `M2V`         | Velocity of M2                    | Velocity            |
| `GDP`         | Real Gross Domestic Product       | reales BIP          |
| `CPIAUCSL`    | Consumer Price Index              | CPI                 |
| `GDPC1`       | Real GDP (alternative)            | Fallback            |

### Eurozone

- ECB Statistical Data Warehouse (M3)
- Alternativ: FRED-Serie für Euro Area M3 oder Trading Economics / manueller Import

### Optional (später)

- CFS Divisia Monetary Aggregates (höhere Qualität)
- Housing Price Index (Case-Shiller oder deutscher Index) für Asset-vs-Goods

**Update-Frequenz:** Monatlich (M2) / Quartalsweise (Velocity, GDP)

---

## 5. Integration in den bestehenden Researcher-Flow

1. Beim Laden einer Watchlist / eines Research-Berichts wird der aktuelle Regime-Score automatisch mitgeladen.
2. Kurzer Text-Block (Beispiel):

   > **Aktuelles Liquiditätsregime:** leicht expansiv (Score 68).  
   > Excess Money Growth positiv. Unterstützt eher Growth/Duration und höhere Multiples.

3. Optionaler Toggle:  
   `Monetarist Overlay aktivieren` → beeinflusst leicht Thesis-Stärke oder Risiko-Score (±5–10 Punkte).

4. Keine Änderung der bestehenden Bottom-up-Logik (DCF, GARP, Scoring-Gates etc.).

---

## 6. Was bewusst weggelassen wird

- Keine komplizierte endogen/exogen-Geldschöpfungslogik
- Keine volle k-Prozent-Regel-Simulation
- Keine langen theoretischen Erklärungen zu Friedman
- Keine multi-country Velocity-Modelle in der ersten Version

Nur **handlungsrelevante Signale**.

---

## 7. Umsetzungspriorität

| Prio | Feature                                      | Aufwand | Nutzen |
|------|----------------------------------------------|---------|--------|
| 1    | Excess Money Growth + M2 YoY + Velocity (USA)| Mittel  | Sehr hoch |
| 2    | Regime-Ampel / Score                         | Niedrig | Hoch |
| 3    | Eurozone M3 parallel                         | Mittel  | Mittel |
| 4    | Asset-vs-Goods-Vergleich                     | Mittel  | Mittel |

---

## 8. Technische Skizze (Server + Client)

### Server-seitig (TypeScript)

```ts
// server/liquidity-regime.ts (neu)

export interface LiquidityMetrics {
  m2YoY: number;
  velocity: number;
  excessMoneyGrowth: number;
  m2GdpRatio: number;
  regimeScore: number;      // 0-100
  regimeLabel: "expansiv" | "neutral" | "restriktiv";
  asOf: string;
}

export async function fetchLiquidityMetrics(): Promise<LiquidityMetrics> {
  // 1. FRED calls for M2SL, M2V, GDP, CPI
  // 2. Calculate YoY, Excess, Score
  // 3. Cache (disk-cache oder in-memory, TTL 24h)
  // ...
}
```

### Client-seitig

- Neues Panel analog zu `MacroPanel.tsx` / `CapexPanel.tsx`
- Props: `metrics: LiquidityMetrics`
- Anzeige: Ampel + Tabelle + kurzer Text

### Beispiel-Berechnung Excess Money Growth

```ts
const excess = m2YoY - realGdpYoY - cpiYoY;
```

---

## 9. Nächste konkrete Schritte

1. FRED API Key / bestehende Macro-Dateninfrastruktur prüfen (`server/fmp-macro.ts`, `server/btc-macro.ts` etc.)
2. `fetchLiquidityMetrics()` implementieren + Caching
3. Neues Panel im Researcher einbauen
4. Regime-Score in Thesis-Stärke optional einklinken (Toggle)
5. Tests + Live-Verifikation mit aktuellen Daten

---

**Ende der Spec**  
Dieses Dokument dient als alleinige Arbeitsgrundlage für die Implementierung. Alle Zahlen, Formeln und Prioritäten sind hier dokumentiert.
