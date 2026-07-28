# WORK.md — Index & Navigationskarte

> Stand: 28.07.2026 | Branch: `main`  
> Regel: Kein Code-Push über GitHub API ohne lokale Validierung + PR + Review.

---

## Detail-Dateien

| Datei | Inhalt |
|-------|--------|
| **[WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md)** | **Scoring-Logik Vorlage** — types, pricingPower, relativeMomentum, gates, trendMult, catalysts, verdict, `runScoringPipeline`, Gate-Caps, UI-Vertrag |
| [WORK_TEIL0-6.md](./WORK_TEIL0-6.md) | Platform, BTC, Bugs, Katalysator-Formeln, OpenRouter, FMP, Roadmap |
| [WORK_BTC_MINER.md](./WORK_BTC_MINER.md) | Section 13 Miner: Hash Ribbons, Puell, Breakeven, Kapitulationszonen |
| [WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md) | TEIL 7 Detail + Gold/Realzins-Modell |
| [WORK2.md](./WORK2.md) | TEIL 8 Regulatory, Geo, PESTEL, FRED |

---

## Scoring auf einen Blick

```
finalScore = min( qualityScore × trendMultiplier , gateCap ) + catalystEV

Gates (Cap):
  PRICING_POWER      55 hard
  RELATIVE_GROWTH    60 hard
  DCF_REALITY_CHECK  65 warn
  INVENTORY          70 warn
  REGULATORY_EXPOSURE 55/65 (TEIL 8)
```

Vollständige Vorlage inkl. TypeScript: **[WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md)**

---

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
