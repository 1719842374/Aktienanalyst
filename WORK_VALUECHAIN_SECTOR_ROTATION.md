# WORK_VALUECHAIN_SECTOR_ROTATION.md

> **Stand: 17.08.2026**  
> Detaillierte Spezifikation für den Block **Industrie- & Sektor-Visualisierung**  
> inkl. LLM-Validierungs-Prompt, 13F-Institutionen-Daten, Reverse-DCF-Basket-Logik, Kostolany-Rad, React-Flow Nodes und CAPEX-Intensität.

---

## Implementierungsphase – Aktuelle Reihenfolge (Value Chain UI)

| Rang | Task | Status | Aufwand | Abhängigkeit |
|------|------|--------|---------|--------------|
| **1** | **React-Flow Node-Spezifikation + Komponenten** | ✅ Spec + Code gepusht | 1–1,5 Tage | – |
| **2** | Branchen-Selector + API-Contract (`/api/researcher/valuechain`) | offen | 0,5–1 Tag | 1 |
| **3** | LLM-Stufen-Vorschlag + FMP-Validierung + Cache | offen | 1–1,5 Tage | 2 |
| **4** | Firmen in Stage-/Company-Nodes rendern + Klick → Analyse | offen | 0,5 Tag | 1 + 3 |
| **5** | **CAPEX-Intensität pro Stufe** (Berechnung + Badge im Stage-Node) | offen | ~1 Tag | 3 (Market Cap + Financials fließen) |
| **6** | 13F-Badges aus bestehendem Screener-Cache | offen | 0,5–1 Tag | 3 |
| **7** | Optional: CAPEX-Bar/Waterfall unter dem Pfad | offen | 0,5 Tag | 5 |

### Empfohlene Reihenfolge (verbindlich)

1. **React-Flow Node-Spezifikation zuerst definieren und bauen (ohne CAPEX).**  
   → Erledigt: `valueChainTypes.ts`, `StageNode.tsx`, `CompanyNode.tsx`, `nodeTypes.ts`

2. **Sobald Firmen + Market Cap fließen → CAPEX-Intensität als zusätzliche Metrik pro Stufe hinzufügen.**

---

## React-Flow Node Spec (Kurz)

### Dateien

| Datei | Inhalt |
|-------|--------|
| `client/src/lib/valueChainTypes.ts` | Domain-Types + StageNodeData + CompanyNodeData + CAPEX-Helper |
| `client/src/components/valuechain/StageNode.tsx` | Custom Node für Wertschöpfungsstufe |
| `client/src/components/valuechain/CompanyNode.tsx` | Custom Node für einzelnes Unternehmen |
| `client/src/components/valuechain/nodeTypes.ts` | React-Flow `nodeTypes` Registry |

### Stage-Node zeigt
- Stufenname + Typ (upstream / midstream / downstream)
- Anzahl Firmen + aggregierte Market Cap
- **CAPEX-Intensität-Badge** (sobald Daten da sind)

### Company-Node zeigt
- Ticker + Name + Logo
- Market Cap + 1Y-Performance
- Valuation-Flag + 13F-Stern

### CAPEX-Intensität

```
capexIntensity = |Capex_TTM| / Revenue_TTM
stageAvg       = Median der Firmen-Intensitäten in der Stufe
```

Hilfsfunktionen bereits in `valueChainTypes.ts`:
- `computeCapexIntensity(capex, revenue)`
- `aggregateStageCapexIntensity(companies)`
- `formatCapexIntensity(value)`

---

## Nächste konkrete Schritte

1. React-Flow Canvas-Seite / Tab im Researcher anlegen und die Node-Typen registrieren.
2. Dummy-Daten (hardcodierte AI-Value-Chain) rendern → Layout prüfen.
3. API + LLM + FMP anschließen.
4. CAPEX-Felder befüllen und Badge aktivieren.

---

*React-Flow Node Spec + CAPEX-Intensität-Logik am 17.08.2026 als Implementierungsphase-Start gepusht.*
