# WORK.md – Section 4 / Datenqualitäts-Bugs (Aktienanalyst)

**Status:** Bug-Report aus Live-Analyse (Brookfield / BN-Typ, Stand 15.08.2026)  
**Priority:** P0 für PEG-Anzeige + FCF; P1 für übrige Datenlücken  
**Scope:** Bewertungskennzahlen (Section 4), FMP-Mapping, Segment-/Earnings-/Moat-/Analyst-Daten

---

## 0. Gesamtbewertung (Live-Check 15.08.2026)

**Nein – nicht alles ist korrekt.** Der Report hat solide Teile, aber auch klare Fehler und Datenqualitätsprobleme.

| Bereich | Bewertung |
|---------|-----------|
| Marktdaten & aktuelle News (Kurs, Multiples, Revenue, Geography, Boralex, SWI) | **größtenteils korrekt und aktuell** |
| Finanzkennzahlen (FCF, PEG, Segment-Reporting) | **mehrere Fehler** |
| Interpretation (Moat, Fazit „STARK UNATTRAKTIV“) | Diskutabel; hohe GAAP-P/E und negativer FCF bleiben **legitime Warnsignale** |

**Fazit:** Rohanalyse brauchbar, Katalysatoren frisch; Datenqualitätslücken (besonders FCF und PEG) und faktische Fehler müssen gefixt werden. Relative Bewertungsvergleiche und Revenue-Zahlen halten.

---

## 1. Was stimmt gut

| Punkt | Report | Realität | Bewertung |
|-------|--------|----------|-----------|
| Kurs & Market Cap | $43.85 / $97.94B | Preis ~$43–45, Shares ~2.2–2.3 Mrd. | Korrekt |
| P/E TTM 88.3 | 88.3 | GAAP-Trailing-P/E ca. 81–93 | Sehr gut |
| Forward P/E ~15.9 | 15.9 | Plausibel | Gut |
| Revenue $76.1B / –11.5 % YoY | $76.1B / –11.5 % | FY 2025: $75.1B (–12.7 %), TTM ähnlich | Gute Approximation |
| Geografische Umsätze | US $27.36B, Kanada $7.81B usw. | Exakt aus 2025 Annual Report | Korrekt |
| Boralex-Deal | Integrationsabschluss als Katalysator | Deal 14.08.2026 abgeschlossen | Sehr aktuell & korrekt |
| SWI-Partnerschaft | US-Multifamily | 14.08. angekündigt | Sehr aktuell |
| Analyst-PT Median ~$59.50 | $59.50 | Median/Avg. $54–59 | Im oberen, realistischen Bereich |
| Balance-Sheet | Assets ~$519B, hohe Debt | Passt zu Q1/Q2 2026 | Gut |
| Sektor-Vergleiche | P/E 14.0, Branche +5 % | Passt | Gut |

---

## 2. Klare Fehler / Probleme (User-Befund + Code-Abgleich)

| # | Befund | Schwere | Code-Ursache (soweit nachweisbar) |
|---|--------|---------|-----------------------------------|
| 1 | **FCF = $0 / 0 % Marge** trotz stark negativem GAAP-FCF (TTM ca. –$8 bis –$13 Mrd., hohes CapEx in Infra/Energy/PE) | **P0** | `fmp-fetcher`: Cashflow nur `limit=1`; `fcfTTM = lc.freeCashFlow \|\| OCF - \|CapEx\|`. Bei 0/null oder Investitions-CapEx → 0. Kein TTM aus mehreren Perioden, kein Hinweis „GAAP-FCF verzerrt bei High-CapEx“. |
| 2 | **PEG 0.04** bei Anzeige P/E 88.3 ÷ Growth 10.9 % | **P0** | **Display-Bug `Section4.tsx`:** UI zeigt `peRatio` + `epsGrowth5Y`, PEG kommt aus `data.pegRatio` (Lynch/Forward). Korrekt: 88.3/10.9 ≈ **8.1**, nicht 0.04. |
| 3 | „Nur geografisch — kein Geschäftssegment-Reporting“ | **P1** | Falsch. Brookfield reportet Asset Management, Wealth Solutions, Infrastructure, Energy, PE, Real Estate, Corporate. Parse nur product-segmentation unzureichend. |
| 4 | „Zuletzt berichtet: Q4 FY2025“ | **P1** | Veraltet. Q1 + Q2 2026 veröffentlicht (Q2 am 13.08.2026). Label nicht an `/stable/earnings` gekoppelt. |
| 5 | Moat = None | **P2** | Zu harsch. Scale, Permanent Capital, operative Expertise, Franchise in Alternatives → mindestens Narrow Moat plausibel. |
| 6 | Analysten 47 Buy / 4 Hold / 0 Sell | **P1** | Übertrieben. Realistisch ca. 8–12 Analysten. Code zählt Grade-**Events** (`grades.slice(0, 30)`), nicht unique Analysten. |
| 7 | EPS-Growth 10.88 % vs. 141.9 % CAGR | **P1** | Inkonsistente Quellen/Labels (`epsGrowth5Y` vs. `epsGrowthFwd` / andere Stellen). |

---

## 3. PEG – Code-Bug (Zahlen / Fakten)

### Erwartete Rechnung

```text
PEG = P/E ÷ EPS-Wachstum(%)
    = 88.3 ÷ 10.9 ≈ 8.10
```

### Was die UI zeigt

```text
P/E 88.3  ÷  EPS Growth 10.9%  =  PEG 0.04   ← inkonsistent
```

### Code (`client/src/components/sections/Section4.tsx`)

```ts
const lynchPEG = data.pegRatio && data.lynchClass ? data.pegRatio : null;
const pe = data.peRatio;
const growth = data.epsGrowth5Y;
const peg = lynchPEG ?? (pe > 0 && growth > 0 ? pe / growth : null);
```

- Anzeige: immer Trailing-P/E + 5Y-Growth.
- Wert: bei gesetztem `lynchClass` → Server-`pegRatio` (Forward/Lynch) → **Gleichung auf dem Screen stimmt nicht**.

### Server (`server/fmp-fetcher.ts`)

```ts
const pegRatio = (pe > 0 && epsGrowthFwd > 0) ? pe / epsGrowthFwd : null;
```

### Fix (generisch)

1. Eine Formel = dieselben Inputs in der Box (Trailing **oder** Forward, nie Mischung).
2. Lynch-Varianten nur mit passenden Inputs + `lynchPEGBasis`-Text.
3. Growth ≤ 0 oder P/E ≤ 0 → `n/a`.
4. Sanity: PEG < 0.1 bei P/E > 20 und Growth < 30 % → Flag Dateninkonsistenz.

---

## 4. WACC Live vs. Sektor-Ref. (kein Rechenfehler)

| Szenario | Beta | D/V | WACC Live | WACC Sektor-Ref. |
|----------|------|-----|-----------|------------------|
| Conservative | 2.02 | 83.8 % | 5.88 % | 11.0 % |
| Average | 1.84 | 76.1 % | 6.42 % | 9.5 % |
| Optimistic | 1.65 | 68.5 % | 6.80 % | 8.0 % |

```text
Re = 4.2% + 1.84 × 5.5% = 14.32%
WACC ≈ 23.9%×14.32% + 76.1%×5.0%×0.79 ≈ 6.4%
```

Hoher D/V drückt Live-WACC – methodisch ok, für DCF oft zu optimistisch → Section 5 nutzt Sektor-Ref. (korrekt).

---

## 5. FCF = 0 (P0 Datenpfad)

```ts
fcfTTM: lc.freeCashFlow || (lc.operatingCashFlow || 0) - Math.abs(lc.capitalExpenditure || 0),
// cashflow limit=1
```

- Reality: GAAP-FCF TTM stark negativ (ca. –$8 bis –$13 Mrd.) wegen CapEx in Operating Businesses.
- Tool: $0 / 0 % Marge → Datenfehler.

**Fix:** Mehrperioden-Cashflow; negatives FCF sichtbar; optional AFFO/Owner-Earnings-Hinweis generisch für Infra/Alternatives/RE.

---

## 6. Segmente, Earnings, Analysten, EPS-Growth, Moat

| Thema | Soll |
|-------|------|
| Segmente | Business-Segmente parsen; Text „nur geo“ nur wenn wirklich keine Business-Daten |
| Earnings | „Zuletzt berichtet“ an `/stable/earnings` / letztes Quarter |
| Analysten | Unique Firms/Analysten oder Label „Grade-Events“ |
| EPS-Growth | Eine CAGR-Quelle + klare Labels (5Y CAGR vs. Fwd YoY) |
| Moat | Narrow bei Scale/Permanent-Capital-Profilen generisch ermöglichen (P2) |

---

## 7. Implementation Priority

| Priority | Task |
|----------|------|
| **P0** | Section4 PEG: Anzeige = Formel = Inputs |
| **P0** | FCF: Mehrperioden, Vorzeichen, kein stilles 0 %-Marge |
| **P1** | Analyst Grades dedup / kennzeichnen |
| **P1** | Earnings-Datum aktualisieren |
| **P1** | EPS-Growth vereinheitlichen + Label |
| **P1** | Segment-Text nur wenn zutreffend |
| **P2** | Moat-Heuristik Quality-Alternatives |

---

## 8. Betroffene Dateien

| Datei | Thema |
|-------|--------|
| `client/src/components/sections/Section4.tsx` | PEG-Display |
| `server/fmp-fetcher.ts` | pegRatio, FCF, grades, cashflow limit |
| `server/fmp.ts` | calcEpsGrowth, Segmente, earnings |
| Moat-/Summary-Logik | Moat, Fazit |

---

**Document Owner:** Aktienanalyst Project  
**Created / Updated:** 15.08.2026 (vollständiger Live-Check inkl. „Was stimmt“)  
**Next Action:** P0 PEG + FCF fixen
