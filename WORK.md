# WORK.md — Index & Navigationskarte

> Stand: 28.07.2026 | Branch: `main`

---

## Detail-Dateien

| Datei | Inhalt |
|-------|--------|
| **[WORK_REVERSE_DCF_BRIDGE.md](./WORK_REVERSE_DCF_BRIDGE.md)** | **Reverse-DCF Methodik** + **Bridge** Fiskal/AI-Capex-Programme → Sektor-Cache → Scoring + Daily Briefing |
| **[WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md)** | Scoring-Pipeline, Gates, Lookahead/Fiscal-Ausnahme §17 |
| [WORK_TEIL0-6.md](./WORK_TEIL0-6.md) | Platform, BTC, Bugs, Katalysatoren, FMP |
| [WORK_BTC_MINER.md](./WORK_BTC_MINER.md) | Miner-Zonen |
| [WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md) | TEIL 7 + Gold/Realzins |
| [WORK2.md](./WORK2.md) | TEIL 8 Regulatory/PESTEL/FRED |

---

## Scoring / Reverse DCF / Bridge

```
finalScore = min(quality × trendMult, gateCap)
g* = ReverseDCF(price)     // implizites Wachstum
gapRatio = g* / realized8Q → DCF_REALITY_CHECK

FiscalProgram (gecacht aus Daily Briefing)
  → sectorMap (defense, ai_infra, semis, …)
  → catalystsForTicker → Scoring
  → programsBySector → Researcher Daily Briefing / Sector-Tab

Private AI-Capex = context_only (kein DCF-Softening)
Staatsprogramm legislated/funded = catalyst (DCF-Cap optional +10)
```

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
