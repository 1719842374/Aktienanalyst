# WORK_VALUECHAIN_SECTOR_ROTATION.md

> **Stand: 17.08.2026**  
> Detaillierte Spezifikation für den Block **Industrie- & Sektor-Visualisierung**  
> inkl. React-Flow Nodes, Custom Edges + Animationen, FMP Financials, Rate-Limit-Management und CAPEX-Intensität.

---

## Implementierungsphase – Aktuelle Reihenfolge (Value Chain UI)

| Rang | Task | Status | Aufwand |
|------|------|--------|--------|
| **1** | React-Flow Node-Spezifikation + Komponenten | ✅ gepusht | 1–1,5 Tage |
| **2** | Branchen-Selector + API-Contract | offen | 0,5–1 Tag |
| **3** | LLM + FMP-Validierung + Cache + **Rate-Limit-Management** | offen | 1–1,5 Tage |
| **4** | Firmen in Nodes rendern + Klick → Analyse | offen | 0,5 Tag |
| **5** | CAPEX-Intensität pro Stufe | offen | ~1 Tag |
| **6** | 13F-Badges | offen | 0,5–1 Tag |
| **7** | React-Flow Custom Edges (MVP: smoothstep / valueFlow) | offen | 0,5 Tag |
| **8** | Custom Edge Animationen (Glow-Flow) | offen (Nice-to-have) | 0,5–1 Tag |
| **9** | Optional: CAPEX-Bar/Waterfall | offen | 0,5 Tag |

---

## 1. React-Flow Custom Edge Types & Animationen

### Was sind Edges?

In React-Flow sind **Edges** die Verbindungen zwischen Nodes.  
Standard-Edges sind einfache Linien. **Custom Edges** erlauben Aussehen, Animation und Daten an der Verbindung.

### Warum relevant für die Wertschöpfungskette?

| Anwendungsfall | Beispiel | Nutzen |
|----------------|----------|--------|
| Liefer-/Abhängigkeitsbeziehung | Foundry → Chip Design | Zeigt, wer von wem abhängt |
| Stärkere vs. schwächere Beziehung | Dicke Linie = hoher Umsatzanteil | Visuelle Gewichtung |
| Animierter Flow | Leuchtender „Daten-/Wert-Fluss“ | Ähnlich dem Referenzbild |
| Label auf der Kante | „HBM-Engpass“ oder „Capex-Träger“ | Zusätzliche Info |

### Empfohlene Edge-Typen

```ts
type EdgeType = "default" | "smoothstep" | "straight" | "step" | "valueFlow" | "dependency" | "critical";
```

| Edge-Typ | Aussehen | Wann nutzen |
|----------|----------|-------------|
| `valueFlow` | Geschwungene, leicht animierte Linie (cyan/blau Glow) | Hauptpfad Upstream → Downstream |
| `dependency` | Gestrichelte Linie | Schwächere / optionale Beziehungen |
| `critical` | Dickere, orangefarbene Linie | Engpass-Stufen (HBM, Foundry) |

### Custom Edge Animationen (Detail)

**Ziel:** Ein subtiler „Flow“-Effekt wie im Referenzbild (leuchtende Bahn).

| Technik | Beschreibung | Aufwand | Performance |
|---------|--------------|--------|-------------|
| CSS `stroke-dashoffset` Animation | Klassischer „laufender Strich“ | gering | Sehr gut |
| SVG Gradient + Animation | Weicher Glow entlang der Kante | mittel | Gut |
| Framer Motion / CSS keyframes | Stärkerer visueller Effekt | mittel | Achtung bei vielen Edges |
| Canvas / WebGL | Übertrieben für diesen Use-Case | hoch | Unnötig |

**Empfehlung MVP:**  
- `smoothstep` oder einfache `valueFlow`-Edge mit cyanem Stroke  
- Optional: leichte `stroke-dasharray` Animation (nicht zu aggressiv)  
- Volle Glow-Animation erst nach stabilem Layout

**Zahlen & Aufwand**

| Baustein | Aufwand |
|----------|--------|
| Einfache Custom Edge (Farbe + Stroke) | 1–2 h |
| Animierter Glow-Flow | 0,5–1 Tag |
| Edge mit Label + Hover-Info | 0,5 Tag |

---

## 2. FMP Financials API Integration + Rate Limit Management

### Benötigte Endpoints pro Ticker

| Datenpunkt | FMP-Endpoint | Verwendung |
|------------|--------------|------------|
| Market Cap, Sector, Name | `/profile` | Company-Node, Filter ≥ 1 Mrd. |
| Revenue (TTM / annual) | `/income-statement` | CAPEX-Intensität, Wachstum |
| Capex (TTM) | `/cash-flow-statement` | CAPEX-Intensität |
| 1Y Performance | `/quote` oder historische Preise | Company-Node |
| Optional: Peers | `/stock-peers` | Fallback-Basket |

### Konkrete Zahlen aus dem bestehenden Stack

- Pro Ticker oft **4–6 FMP-Calls** (Profile, Ratios, Income, Cashflow, Estimates …).
- **Incident 10.08.2026:** ~601 FMP-Calls bei 100 Tickern → Render-Instanz unresponsive → Limit auf **50 Ticker**.
- Value Chain: typisch **25–50 validierte Ticker** pro Branche → realistisch **100–250 Calls**, wenn alles frisch geladen wird.

### FMP API Rate Limit Management (Detail)

| Maßnahme | Konkrete Regel | Begründung |
|----------|----------------|----------|
| **Cache pro Branche** | 12–24 h TTL (`industry + region`) | 13F/Financials ändern sich nicht stündlich |
| **Max. parallele Requests** | 5–8 gleichzeitig | Verhindert Burst-Limits |
| **Budget-Guard** | `wouldExceedBudget()` (bereits vorhanden) | Früher Abbruch statt 429-Spam |
| **Capex optional** | `includeCapex: boolean` im Request | Schnellerer Erst-Load möglich |
| **Ticker-Cap pro Request** | ≤ 50–60 Firmen | Wiederholung des 10.08.-Incidents vermeiden |
| **Background-Build + Polling** | Wie beim 13F-Screener | Lange Jobs blockieren nicht den HTTP-Request |
| **Retry mit Backoff** | Bei 429: 1s → 2s → 4s | Robust gegen kurzzeitige Limits |

**Beispiel-Budget-Rechnung**

```
40 Ticker × 3 Calls (Profile + Income + Cashflow) = 120 Calls
Bei 8 parallelen Requests ≈ 15 Runden
Mit 100–150 ms Pause → Gesamt ~2–4 Sekunden (+ Cache-Hit fast 0)
```

### CAPEX-Berechnung mit FMP-Daten

```
Capex (Cash Flow) = -4.2 Mrd. USD   (oft negativ)
Revenue (Income)  = 18.5 Mrd. USD

capexIntensity = |−4.2| / 18.5 ≈ 0.227 → 22.7 %
```

**Typische Bandbreiten (AI-Beispiel)**

| Stufe | Typische Capex/Revenue | Charakter |
|-------|------------------------|----------|
| Foundry / Manufacturing | 30–50 %+ | Sehr kapitalintensiv |
| Hyperscaler / Data Center | 20–35 % | Hoch |
| Chip Design (fabless) | 5–15 % | Mittel |
| AI Software / SaaS | 2–8 % | Asset-light |

---

## 3. CAPEX-Intensität (bereits in Spec)

### Status in Code

In `valueChainTypes.ts` bereits vorbereitet:

```ts
capexIntensity?: number | null;          // pro Firma
avgCapexIntensity?: number | null;       // pro Stufe

computeCapexIntensity(capex, revenue)
aggregateStageCapexIntensity(companies)  // Median
formatCapexIntensity(value)              // "22.7%"
```

StageNode zeigt das Badge, sobald `avgCapexIntensity` befüllt ist.

### Noch offene Implementierungsschritte

| Schritt | Beschreibung | Aufwand |
|---------|--------------|--------|
| 1 | Beim FMP-Enrichment Capex + Revenue laden | 0,5 Tag |
| 2 | `computeCapexIntensity` pro Firma | gering |
| 3 | `aggregateStageCapexIntensity` pro Stufe | gering |
| 4 | Wert in StageNodeData schreiben | vorbereitet |
| 5 | Optional: Farbcodierung | 0,25 Tag |
| 6 | Optional: Bar-Chart unter dem Pfad | 0,5 Tag |

**Aggregation:** Median der Firmen-Intensitäten (robust).

---

## Zusammenspiel

```
FMP Financials (+ Rate-Limit-Management)
    ↓
Capex + Revenue pro Ticker
    ↓
capexIntensity pro Firma
    ↓
avgCapexIntensity pro Stufe
    ↓
StageNode zeigt Badge
    +
React-Flow Custom Edges (+ optionale Animation)
    → verbinden die Stufen optisch (Glow / Flow)
```

---

## Priorität

1. Nodes rendern (✅ Spec da)  
2. FMP-Daten inkl. Rate-Limit-Management anschließen  
3. CAPEX-Intensität live berechnen und anzeigen  
4. Custom Edges (MVP ohne starke Animation)  
5. Edge-Animationen (Nice-to-have)

---

*Aktualisiert am 17.08.2026: Custom Edge Animationen + FMP Rate Limit Management detailliert aufgenommen.*
