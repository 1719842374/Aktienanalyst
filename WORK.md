# WORK.md

> Stand: 28.07.2026 | Branch: `main`
> Regel: Kein Code-Push über GitHub API ohne lokale Validierung + PR + Review.

---

## ⚠️ RESTORE NÖTIG — TEIL 0–7

Beim Push von Abschnitt 8.12 wurde `WORK.md` versehentlich auf nur TEIL 8 gekürzt.

**Vollständiger Stand TEIL 0–8.11 liegt in Commit:**
`975dbe93ce11365a7fd1b0d5d7093cb638a6f4c6`

### Sofort-Restore (lokal, 30 Sekunden)

```bash
cd /pfad/zu/Aktienanalyst
git fetch origin
git checkout 975dbe93ce11365a7fd1b0d5d7093cb638a6f4c6 -- WORK.md
git add WORK.md
git commit -m "restore: WORK.md TEIL 0-7 from 975dbe93"
git push
```

Danach optional TEIL 8.12 aus `WORK2.md` ans Ende von `WORK.md` anhängen:

```bash
# 8.12-Abschnitt aus WORK2.md manuell ans Ende von WORK.md kopieren
# oder:
tail -n +$(grep -n "## 8.12" WORK2.md | cut -d: -f1) WORK2.md >> WORK.md
git add WORK.md && git commit -m "docs: append 8.12 from WORK2" && git push
```

---

## Aktuelle Datei-Struktur (nach Fix)

| Datei | Inhalt |
|-------|--------|
| **WORK.md** | TEIL 0–7 (nach Restore aus 975dbe93) + optional 8.x |
| **WORK2.md** | TEIL 8 komplett (8.1–8.12): Regulatory, Geo, Zölle, PESTEL, FRED, CompanyTech |

**WORK2.md Link:** https://github.com/1719842374/Aktienanalyst/blob/main/WORK2.md  
**Guter Commit (0–8.11):** https://github.com/1719842374/Aktienanalyst/blob/975dbe93ce11365a7fd1b0d5d7093cb638a6f4c6/WORK.md

---

## Inhalt TEIL 0–7 (Kurzübersicht — voller Text im Restore-Commit)

| Teil | Thema |
|------|--------|
| 0 | Platform-Realität, Render/pplx, Quota-Guard, Mega-File-Splits |
| 1 | BTC Dashboard Restore |
| 2 | Bugs A–D (FMP, Peers/ROIC, Segments, Non-USD DCF) |
| 3 | Katalysatoren-Formeln (PoS, Netto-Upside, GB, Reverse DCF) |
| 4 | Researcher OpenRouter 402 / Fallback-Chain / Sonar |
| 5 | FMP-Migrationsplan |
| 6 | Feature-Roadmap (PESTEL Section 14, Reverse DCF, Thesis Score) |
| 7 | Trend-Gates, Pricing Power, Relative Momentum, Veto-Architektur, Gold vs Real Yields |

---

## TEIL 8 → siehe WORK2.md

Komplette Spezifikation inkl.:
- Regulatory Exposure + Tariff Exposure
- Geographic Segmentation (FMP)
- LLM-Prompt Regulatory/Zölle
- EPS-Impact, Confidence-Filter, Test-Matrix
- REGULATORY_EXPOSURE-Gate
- PESTEL Political/Legal
- **8.12** FRED MacroSnapshot, CompanyTech, Economic- & Technological-Builder

https://github.com/1719842374/Aktienanalyst/blob/main/WORK2.md
