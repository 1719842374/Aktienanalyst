# WORK.md — Index & Navigationskarte

> Stand: 28.07.2026 | Branch: `main`  
> Regel: Kein Code-Push über GitHub API ohne lokale Validierung + PR + Review.  
> Ausnahme: reine Dokumentations-Updates sind freigegeben.

**Warum mehrere Dateien?**  
GitHub-API truncates große Markdown-Dateien still. Deshalb ist die Detailtiefe aufgeteilt — der **Inhalt ist vollständig**, nur nicht in einer einzigen 65-KB-Datei.

---

## Detail-Dateien (volle Tiefe: Code, Formeln, Regeln, Scoring)

| Datei | Inhalt | Status |
|-------|--------|--------|
| **[WORK_TEIL0-6.md](./WORK_TEIL0-6.md)** | TEIL 0–6: Platform, BTC-Restore, Bugs A–D, Katalysator-Formeln, Reverse DCF, OpenRouter-Fallback, FMP-Migration, Roadmap | ✅ vollständig |
| **[WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md)** | TEIL 7: Pricing Power, Relative Momentum, Gates/Veto, Trend-Multiplikator, Katalysatoren, Porter-Delta, LLM-Extraktion, Konfliktmatrix, Gold vs Real Yields — **gesamter TypeScript-Code** | ✅ vollständig |
| **[WORK2.md](./WORK2.md)** | TEIL 8: Regulatory Exposure, Geographic Segmentation, Zölle, Confidence-Filter, Test-Matrix, PESTEL Political/Legal, FRED MacroSnapshot, CompanyTech, Economic/Technological Builder | ✅ vollständig |

---

## Schnellübersicht TEIL 0–8

### TEIL 0 — Platform
- Produktiv: **pplx.app** (primär) + **Render** (sekundär). Railway wird **nicht** genutzt.
- P0: Env Vars, Quota-Guard deaktivieren, Health-Check `/api/health`
- Mega-Files >80 KB → Barrel-Pattern (researcher, llm-openrouter, Researcher.tsx)

### TEIL 1 — BTC Dashboard
- Truncation: Sections 3–12 fehlen → Split in `btc/Sections1to6`, `7to12`, `Section13Miner`

### TEIL 2 — Bugs
| Bug | Kern |
|-----|------|
| A | FMP-Key / fmpAvailable |
| B | Peer ROIC 3J + ROE (`calcROIC`) |
| C | Product + Geographic Segments |
| D | Non-USD DCF (`toUSD = val * fxRate`) |

### TEIL 3 — Katalysatoren
```
Netto-Upside = Brutto × (1 − Einpreisung/100)
GB = PoS/100 × Netto-Upside
catalystTarget = dcfFairValue × (1 + ΣGB/100)
Reverse DCF: Binary Search g* (N=5)
```

### TEIL 4 — Researcher / OpenRouter
- 402 → 3-Modell-Kette: Haiku → Llama-Free → Gemini-Free
- Hybrid: Sonar (Live) + Claude (Struktur)

### TEIL 5 — FMP-Migration
8 priorisierte Fix-Branches (Budget → Non-USD → Peer → Segments → Reverse DCF → Catalyst Math → Fallback → Integration-Test)

### TEIL 6 — Roadmap
PESTEL S14, Reverse DCF S15, Summary S17, Thesis Score, Kelly, BTC Miner (Puell/Hash Ribbons)

### TEIL 7 — Trend-Gates & Scoring  → **[WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md)**
```
finalScore = clamp(quality × trendMult, 0, gateCap) + catalystEV
Gates: PRICING_POWER (55), RELATIVE_GROWTH (60), DCF_REALITY (65), INVENTORY (70)
```
Nike-Test: Level grün + Delta rot → Veto deckelt, kein Wegkompensieren durch DCF/Marke.

### TEIL 8 — Regulatory / PESTEL / FRED  → **[WORK2.md](./WORK2.md)**
Geo-Segmente → LLM Regulatory+Zölle → Confidence-Filter → Gate + PESTEL + Katalysatoren  
8.12: FRED (DGS10, DFII10, CPI, UNRATE…), R&D/Capex, Economic/Technological Builder

---

## Commits (Restore-Kette)

| SHA | Was |
|-----|-----|
| `975dbe93` | Letzter monolithischer Stand TEIL 0–8.11 |
| `a18bf294` | WORK_TEIL7_SCORING.md (volles Scoring) |
| `9ba8c416` | WORK_TEIL0-6.md (volle Platform/Bugs/Formeln) |
| WORK2.md | TEIL 8 inkl. 8.12 FRED/PESTEL |

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
