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
| **[WORK_BTC_MINER.md](./WORK_BTC_MINER.md)** | **Section 13 Miner-Zone:** Hash Ribbons, Puell, Hashprice, Breakeven, Difficulty Ribbon, MPI, Kapitulations-/Profit-Zonen, Chart-Logik (rot/gelb/grün) | ✅ neu |
| **[WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md)** | TEIL 7: Pricing Power, Relative Momentum, Gates/Veto, Trend-Multiplikator, Katalysatoren, Porter-Delta, LLM-Extraktion, Konfliktmatrix, Gold vs Real Yields | ✅ vollständig |
| **[WORK2.md](./WORK2.md)** | TEIL 8: Regulatory, Geo, Zölle, Confidence-Filter, Test-Matrix, PESTEL, FRED MacroSnapshot, CompanyTech | ✅ vollständig |

---

## Schnellübersicht TEIL 0–8

### TEIL 0 — Platform
- Produktiv: **pplx.app** (primär) + **Render** (sekundär). Railway wird **nicht** genutzt.
- P0: Env Vars, Quota-Guard deaktivieren, Health-Check `/api/health`
- Mega-Files >80 KB → Barrel-Pattern

### TEIL 1 — BTC Dashboard
- Truncation → Split in `btc/Sections1to6`, `7to12`, `Section13Miner`
- **Section 13 Miner-Zone (Detail):** → **[WORK_BTC_MINER.md](./WORK_BTC_MINER.md)**
  - 🔴 Kapitulation: Spot < Breakeven, Puell < 0.5, Hash Ribbon bearish
  - 🟢 Profitabel: Spot > Breakeven × 1.2, Ribbon Buy, Puell normal
  - Chart: Spot vs Breakeven + farbige Zonen-Bänder (wie TA-Sections)

### TEIL 2 — Bugs
| Bug | Kern |
|-----|------|
| A | FMP-Key / fmpAvailable |
| B | Peer ROIC 3J + ROE |
| C | Product + Geographic Segments |
| D | Non-USD DCF (`toUSD`) |

### TEIL 3 — Katalysatoren
```
Netto-Upside = Brutto × (1 − Einpreisung/100)
GB = PoS/100 × Netto-Upside
catalystTarget = dcfFairValue × (1 + ΣGB/100)
```

### TEIL 4 — Researcher / OpenRouter
- 402 → Haiku → Llama-Free → Gemini-Free
- Hybrid: Sonar (Live) + Claude (Struktur)

### TEIL 5 — FMP-Migration
8 priorisierte Fix-Branches

### TEIL 6 — Roadmap
PESTEL S14, Reverse DCF S15, Summary S17, Thesis Score, Kelly, BTC Miner

### TEIL 7 — Trend-Gates & Scoring  → **[WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md)**
```
finalScore = clamp(quality × trendMult, 0, gateCap) + catalystEV
Gates: PRICING_POWER (55), RELATIVE_GROWTH (60), DCF_REALITY (65), INVENTORY (70)
```

### TEIL 8 — Regulatory / PESTEL / FRED  → **[WORK2.md](./WORK2.md)**

---

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
