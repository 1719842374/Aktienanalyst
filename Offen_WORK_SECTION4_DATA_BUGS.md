# WORK.md – Section 4 / Datenqualitäts-Bugs (Aktienanalyst)

**Status:** Bug-Report + Fix-Spec (Brookfield / BN-Typ + AMZN Segment-Dedup, Stand 15.08.2026)  
**Priority:** P0 FCF (offen); **P0 PEG Section4 = DONE** (Commit 9df4055); P1 Segmente / Earnings / Analysten / Growth; P2 Moat  
**Scope:** Section 4, FMP-Mapping, Segment-Dedup, Alternatives-Metriken, Moat

---

## 0. Gesamtbewertung (Live-Check 15.08.2026)

**Nein – nicht alles ist korrekt.** Solide Marktdaten/News, aber klare Fehler bei FCF, (PEG Display war Bug — gefixt), Segmenten, Earnings-Datum, Analysten-Zählung, Moat.

| Bereich | Bewertung |
|---------|-----------|
| Marktdaten & News | größtenteils korrekt & aktuell |
| Finanzkennzahlen (FCF, Segment-Reporting) | mehrere Fehler; **PEG-Anzeige Section4 gefixt** |
| Interpretation (Moat, Fazit) | diskutabel |

---

## 1. Was stimmt gut

| Punkt | Report | Realität | Bewertung |
|-------|--------|----------|-----------|
| Kurs & Market Cap | $43.85 / $97.94B | ~$43–45 | Korrekt |
| P/E TTM 88.3 | 88.3 | GAAP ~81–93 | Sehr gut |
| Forward P/E ~15.9 | 15.9 | Plausibel | Gut |
| Revenue / Geo / News | … | … | Gut |

---

## 2. Klare Fehler (Kurz)

| # | Befund | Prio | Status |
|---|--------|------|--------|
| 1 | FCF = $0 / 0 % Marge | **P0** | offen |
| 2 | PEG Anzeige ≠ Formel | **P0** | **DONE Section4** (Trailing) |
| 3 / 3b | Segmente / Geo-Duplikat AWS | **P1** | offen |
| 4 | Earnings-Datum veraltet | **P1** | offen |
| 5 | Moat = None zu harsch | **P2** | offen |
| 6 | Analyst Grades Events | **P1** | offen |
| 7 | EPS-Growth inkonsistent | **P1** | offen |

---

## 3. PEG – Fix implementiert (P0)

### 3.1 Formeln

```text
Trailing PEG = P/E_TTM ÷ EPS_Growth_5Y_%     ← Section4 Box (ab 15.08.2026)
Forward / Lynch = data.pegRatio               ← nur Hinweis, wenn abweichend
```

### 3.2 Was geändert wurde (`Section4.tsx`, Commit `9df4055`)

- **Vorher:** `lynchPEG = data.pegRatio` überschrieb die Division → Box zeigte z. B. 88.3 ÷ 10.9 = **0.04**
- **Nachher:** Box-PEG = immer `peRatio / epsGrowth5Y` (wenn beide > 0), sonst `n/a`
- Labels: „P/E (TTM)“ / „EPS Growth 5Y“
- Rechenweg spiegelt exakt die sichtbaren Zahlen
- Sanity-Flag wenn `peg < 0.1 && pe > 20 && growth < 30`
- Server/Lynch-`pegRatio` nur als **Zusatzzeile**, wenn > 0.05 Abweichung — **keine** Vermischung in der Box

### 3.3 Akzeptanz

| Case | Erwartung |
|------|-----------|
| BN pe≈88.3, growth≈10.9 | PEG **≈8.1**, nicht 0.04 |
| AMZN pe≈31.7, growth≈57.2 | PEG **≈0.55**, nicht 0.36 |
| pe≤0 oder growth≤0 | **n/a** |

**Hinweis:** Section1 / Summary / Compare können weiter `data.pegRatio` (Server-Forward) zeigen — optional später angleichen. Section4 ist die Stelle der expliziten Gleichung.

---

## 4. FCF = 0 (P0, offen)

Cashflow `limit=1`; negatives GAAP-FCF → $0.  
**Fix:** Mehrperioden, Vorzeichen, High-CapEx-Hinweis (`fmp-fetcher` / analyze-helpers).

---

## 5. Business vs. Geographic Dedup (P1, offen)

Spec unverändert: Name+Revenue-Match + NON_GEO_PATTERN; ideal in `analyze-helpers` / `fmp.ts` vor UI.

---

## 6–9. Alternatives / BN 2026 / WACC / P1–P2

Unverändert (siehe vorherige Version).

---

## 10. Implementation Priority

| Prio | Task | Status |
|------|------|--------|
| **P0** | PEG Section4 Anzeige = Formel | **DONE** `9df4055` |
| **P0** | FCF Mehrperioden + Vorzeichen | offen |
| **P1** | Segment-Dedup | offen |
| **P1** | Analyst / Earnings / Growth-Labels | offen |
| **P2** | Moat Alternatives | offen |

---

## 11. Betroffene Dateien

| Datei | Status |
|-------|--------|
| `client/src/components/sections/Section4.tsx` | **PEG gefixt** |
| `server/fmp-fetcher.ts` / `fmp.ts` | FCF, Dedup, grades, earnings noch offen |
| Section2 Segment-UI | Dedup-Hinweis noch offen |

---

**Document Owner:** Aktienanalyst Project  
**Updated:** 15.08.2026 — P0 PEG Section4 implemented  
**Next Action:** P0 FCF; P1 Segment-Dedup
