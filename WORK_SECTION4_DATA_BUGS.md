# WORK.md – Section 4 / Datenqualitäts-Bugs (Aktienanalyst)

**Status:** Bug-Report + Fix-Spec (Brookfield / BN-Typ, Stand 15.08.2026)  
**Priority:** P0 PEG + FCF; P1 Segmente/Earnings/Analysten/Growth; P2 Moat Alternatives  
**Scope:** Section 4, FMP-Mapping, Alternatives-Asset-Management-Metriken, Moat

---

## 0. Gesamtbewertung (Live-Check 15.08.2026)

**Nein – nicht alles ist korrekt.** Solide Marktdaten/News, aber klare Fehler bei FCF, PEG, Segmenten, Earnings-Datum, Analysten-Zählung, Moat.

| Bereich | Bewertung |
|---------|-----------|
| Marktdaten & News (Kurs, Multiples, Revenue, Geo, Boralex, SWI) | größtenteils korrekt & aktuell |
| Finanzkennzahlen (FCF, PEG, Segment-Reporting) | mehrere Fehler |
| Interpretation (Moat None, „STARK UNATTRAKTIV“) | diskutabel; hohe GAAP-P/E + negativer FCF = legitime Warnsignale |

---

## 1. Was stimmt gut

| Punkt | Report | Realität | Bewertung |
|-------|--------|----------|-----------|
| Kurs & Market Cap | $43.85 / $97.94B | ~$43–45, Shares ~2.2–2.3 Mrd. | Korrekt |
| P/E TTM 88.3 | 88.3 | GAAP-Trailing ca. 81–93 | Sehr gut |
| Forward P/E ~15.9 | 15.9 | Plausibel | Gut |
| Revenue $76.1B / –11.5 % YoY | $76.1B / –11.5 % | FY2025 ~$75.1B (–12.7 %) | Gute Approximation |
| Geografische Umsätze | US $27.36B, Kanada $7.81B … | Annual Report 2025 | Korrekt |
| Boralex / SWI | Katalysatoren | 14.08.2026 | Sehr aktuell |
| Analyst-PT Median ~$59.50 | $59.50 | $54–59 | Realistisch |
| Balance Sheet | Assets ~$519B, hohe Debt | Q1/Q2 2026 | Gut |

---

## 2. Klare Fehler (Kurz)

| # | Befund | Prio |
|---|--------|------|
| 1 | FCF = $0 / 0 % Marge (Reality TTM ca. –$8 bis –$13 Mrd.) | **P0** |
| 2 | PEG 0.04 statt ≈8.1 bei P/E 88.3 ÷ Growth 10.9 % | **P0** |
| 3 | „Nur geografisch“ – falsch (Business-Segmente existieren) | **P1** |
| 4 | „Zuletzt berichtet Q4 FY2025“ – Q1/Q2 2026 schon raus | **P1** |
| 5 | Moat = None zu harsch | **P2** |
| 6 | 47 Buy – Grade-Events, nicht unique Analysten | **P1** |
| 7 | EPS-Growth 10.88 % vs. 141.9 % – inkonsistente Quellen | **P1** |

---

## 3. PEG – Bug, Formel, Fix-Spec (P0)

### 3.1 Korrekte Formeln

```text
Trailing PEG = P/E_TTM ÷ EPS_Growth_5Y_%
Forward PEG = Forward_P/E ÷ EPS_Growth_Fwd_%
PEGY (Lynch Slow Grower) = P/E ÷ (Growth_% + DivYield_%)
```

Brookfield-Beispiel:

```text
88.3 ÷ 10.9 ≈ 8.10   ← korrekt
Anzeige 0.04         ← Bug
```

### 3.2 Code-Ursache

**`Section4.tsx`:**

```ts
const lynchPEG = data.pegRatio && data.lynchClass ? data.pegRatio : null;
const pe = data.peRatio;            // Anzeige 88.3
const growth = data.epsGrowth5Y;    // Anzeige 10.9%
const peg = lynchPEG ?? (pe / growth); // Wert oft data.pegRatio ≠ pe/growth
```

**`fmp-fetcher.ts`:**

```ts
pegRatio = (pe > 0 && epsGrowthFwd > 0) ? pe / epsGrowthFwd : null;
```

UI zeigt Trailing-Inputs, Wert kommt aus Forward/Lynch → Gleichung gelogen.

### 3.3 Fix (generisch, keine Ticker-Hardcodes)

1. **Modus explizit wählen und anzeigen:**
   - `trailing`: `peg = peRatio / epsGrowth5Y`, Box zeigt P/E TTM + 5Y Growth
   - `forward`: `peg = forwardPE / epsGrowthFwd`, Box zeigt Forward P/E + Fwd Growth
   - `lynch`: nur mit `lynchPEGBasis` und den **gleichen** Inputs wie die Berechnung
2. Niemals Zähler/Nenner aus Pfad A und Ergebnis aus Pfad B.
3. `growth <= 0` oder `pe <= 0` → `n/a` (nicht 0.04).
4. Sanity-Flag: `peg < 0.1 && pe > 20 && growth < 30` → „Dateninkonsistenz prüfen“.
5. Rechenweg-Text muss die **tatsächlich verwendeten** Zahlen wiedergeben.

**Akzeptanztest:** Für BN (oder jeden Titel mit pe≈88, growth≈11) muss die Box **≈8.1** zeigen, wenn Trailing-Modus aktiv ist – oder Forward-Zahlen, wenn Forward-Modus aktiv ist.

---

## 4. FCF = 0 (P0)

```ts
fcfTTM: lc.freeCashFlow || (OCF - |CapEx|),
cashflow limit=1
```

| Reality (BN-Typ) | Tool |
|------------------|------|
| GAAP-FCF TTM stark negativ (–$8 bis –$13 Mrd.) | $0 / 0 % Marge |

**Fix:**
- Cashflow `limit` ≥ 4 (Quarter) oder klar annual + Label
- Negatives FCF anzeigen, nie stilles „0 % Marge“
- Generischer Hinweis wenn Sector/Industry ∈ Infra / Alternatives / RE / Asset Management: „GAAP-FCF durch Investitions-CapEx verzerrt; FRE/DE/AFFO beachten“

---

## 5. Alternatives Asset Management – Analyse-Metriken (für Fixes & Moat)

GAAP-P/E und GAAP-FCF allein sind für Alternatives **unzureichend**. Beim Fix und bei der Interpretation priorisieren:

| Metrik | Rolle |
|--------|--------|
| Fee-Bearing Capital (FBC) | Fee-Basis |
| Fee-Related Earnings (FRE) | „Betriebsgewinn“ der AM-Franchise |
| Fundraising | Wachstum FBC |
| Deployable Capital / Dry Powder | Fähigkeit zu deployen |
| Distributable Earnings (DE) | Cash an Corp-Ebene |
| Forward P/E / FRE-Multiple | relevantere Bewertung als GAAP-Trailing-P/E |

Segment-Soll (Business, nicht nur Geo): Asset Management, Wealth Solutions, Infrastructure, Energy, Private Equity, Real Estate, Corporate.

Text „Unternehmen berichtet nur geografisch“ **nur** wenn Product- **und** sinnvolle Business-Segmentdaten fehlen.

---

## 6. Brookfield Capital-Strategie 2026 (Referenz zum Verifizieren der Fixes)

Quelle: BN/BAM Q2 2026 (u. a. 13.08.2026 Supplemental / Earnings).

| Kennzahl | Wert |
|----------|------|
| Fundraising Q2 2026 | **$77 Mrd.** (Rekordquartal) |
| Fundraising YTD 2026 | **~$98 Mrd.** |
| Fee-Bearing Capital | **$672 Mrd.** (+19 % YoY) |
| Fee-Related Earnings | **+20 %** YoY (Quartal) |
| Deployable Capital | **$210 Mrd.** Rekord ($96 Mrd. Liquidität + $114 Mrd. uncalled) |
| Deployment YTD | **~$100 Mrd.** |
| Monetisierungen YTD | **~$40 Mrd.** |
| DE Quartal / LTM | $1.5 Mrd. / $6.2 Mrd. |
| Buybacks | u. a. BN @ ~$42 unter Management-Intrinsic-View |
| Struktur | Simplification BN + Wealth Solutions (Shareholder approved) |

Strategische Säulen: Flagship-Fundraising (PE/Infra), Permanent Capital + Insurance (Just Group), Deployment in AI-Infra/Energy/Retirement, Buybacks, Franchise-Scale.

→ Unterstützt **Narrow Moat** (Scale, Fundraising-Zugang, Permanent Capital), nicht „None“.  
→ Unterstützt, dass **FRE/DE/FBC** die Analyse treiben sollen, nicht FCF=$0.

---

## 7. WACC Live vs. Sektor-Ref. (kein Formel-Bug)

| Szenario | Beta | D/V | WACC Live | Sektor-Ref. |
|----------|------|-----|-----------|-------------|
| Average | 1.84 | 76.1 % | 6.42 % | 9.5 % |

`Re = 4.2 + 1.84×5.5 = 14.32 %` → hoher D/V drückt Live-WACC. DCF nutzt bewusst Sektor-Ref. – beibehalten. Optional: Warnung bei D/V > 60 %.

---

## 8. Weitere P1/P2-Fixes

| Thema | Fix |
|-------|-----|
| Analyst Grades | Unique Firm/Analyst oder Label „Grade-Events (nicht unique)“ |
| Earnings-Datum | An `/stable/earnings` / letztes Quarter koppeln |
| EPS-Growth | Eine CAGR-Pipeline (`calcEpsGrowth`) + Labels „5Y CAGR“ vs. „Fwd YoY“ |
| Moat | Generisch: Scale + Permanent-Capital-/AM-Profil → mindestens Narrow erlauben (kein BN-Hardcode) |

---

## 9. Implementation Priority

| Prio | Task | Done-Kriterium |
|------|------|----------------|
| **P0** | PEG Section4: eine Formel = sichtbare Inputs | BN-Trailing zeigt ≈8.1, nicht 0.04 |
| **P0** | FCF Mehrperioden + Vorzeichen + High-CapEx-Hinweis | kein stilles $0 / 0 % bei negativem GAAP-FCF |
| **P1** | Analyst Dedup/Label | Counts plausibel oder als Events gekennzeichnet |
| **P1** | Earnings „zuletzt berichtet“ | Q2 2026 sichtbar wo published |
| **P1** | Growth-Labels vereinheitlichen | keine 10 % vs. 141 % ohne Erklärung |
| **P1** | Segment-Text | Business-Segmente oder ehrliches „unvollständig“ |
| **P2** | Moat Alternatives | Narrow bei Franchise/Scale-Signalen möglich |

---

## 10. Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `client/src/components/sections/Section4.tsx` | PEG-Modus, Anzeige = Berechnung |
| `server/fmp-fetcher.ts` | pegRatio-Klarheit, FCF limit/Vorzeichen, grades |
| `server/fmp.ts` | earnings, Segmente, calcEpsGrowth |
| Moat-/Summary-Logik | Alternatives Narrow-Moat-Heuristik |

---

**Document Owner:** Aktienanalyst Project  
**Updated:** 15.08.2026 (Fix-Spec PEG/FCF + Alternatives-Metriken + BN Capital Strategy 2026)  
**Next Action:** P0 implementieren (PEG-Konsistenz + FCF-Datenpfad)
