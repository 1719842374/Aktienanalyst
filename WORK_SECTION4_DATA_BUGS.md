# WORK.md – Section 4 / Datenqualitäts-Bugs (Aktienanalyst)

**Status:** Bug-Report aus Live-Analyse (Brookfield-Typ / hohe P/E, 15.08.2026)  
**Priority:** P0 für PEG-Anzeige + FCF; P1 für übrige Datenlücken  
**Scope:** Bewertungskennzahlen (Section 4), FMP-Mapping, Segment-/Earnings-/Moat-/Analyst-Daten

---

## 1. Klare Fehler / Probleme (User-Befund + Code-Abgleich)

| # | Befund | Schwere | Code-Ursache (soweit nachweisbar) |
|---|--------|---------|-----------------------------------|
| 1 | FCF = $0 / 0 % Marge trotz stark negativem GAAP-FCF | **P0** | `fmp-fetcher`: Cashflow nur `limit=1`; `fcfTTM = lc.freeCashFlow \|\| OCF - \|CapEx\|`. Bei fehlendem/0 FMP-Feld oder Investitions-CapEx-Struktur (Infra/Alternatives) → 0. Kein Fallback auf TTM-Summe mehrerer Perioden, kein Hinweis „GAAP-FCF verzerrt bei High-CapEx“. |
| 2 | **PEG = 0.04** bei Anzeige P/E 88.3 ÷ Growth 10.9 % | **P0** | **Display-Bug in `Section4.tsx`:** UI zeigt `peRatio` und `epsGrowth5Y`, berechnet/zeigt aber `peg` bevorzugt aus `data.pegRatio` (Lynch/Forward-Pfad). Gleichung auf dem Screen stimmt nicht: 88.3/10.9 ≈ **8.1**, nicht 0.04. |
| 3 | „Nur geografisch — kein Geschäftssegment-Reporting“ | **P1** | Segment-Parse nur `revenue-product-segmentation`; Business-Segmente (Asset Management, Infrastructure, …) werden nicht oder falsch gemappt. Text generisch falsch für multi-segment Reporter. |
| 4 | „Zuletzt berichtet: Q4 FY2025“ veraltet | **P1** | Earnings/Period-Label aus annual statement / altem Snapshot; kein Abgleich mit `/stable/earnings` oder zuletzt veröffentlichtem Quarter. |
| 5 | Moat = None zu harsch | **P2** | Regelwerk (Abschnitt Moat) vergibt None bei schwachen Quant-Signalen; Scale/Permanent Capital/Franchise werden nicht erfasst. |
| 6 | Analysten 47 Buy / 4 Hold / 0 Sell übertrieben | **P1** | `fmp-fetcher`: Grades über `grades.slice(0, 30)` **pro Grade-Event**, nicht unique Analysten. Mehrere Upgrades desselben Hauses zählen mehrfach → künstlich hohe Buy-Counts. |
| 7 | EPS-Growth inkonsistent (10.88 % vs. 141.9 % CAGR) | **P1** | `epsGrowth5Y` (CAGR aus Income-Limit) vs. `epsGrowthFwd` / andere UI-Stellen ohne einheitliche Quelle und Label. |

**Gesamt:** Marktdaten/News oft ok; Finanzkennzahlen (FCF, PEG) und einige Labels fehlerhaft; Moat/Fazit diskutabel, hohe P/E + negativer FCF bleiben legitime Warnsignale.

---

## 2. PEG – Code-Bug (Zahlen / Fakten)

### Erwartete Rechnung (Lynch-Standard, wenn Growth in %)

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

- **Anzeige:** immer `pe` und `growth` (5Y).
- **Ergebnis:** wenn `lynchClass` gesetzt → **`data.pegRatio`** (Server: oft Forward-PE / Forward-Growth oder Lynch-Variante).
- Die sichtbare Division **P/E ÷ Growth** entspricht dann **nicht** dem angezeigten PEG.

### Server (`server/fmp-fetcher.ts`)

```ts
const pegRatio = (pe > 0 && epsGrowthFwd > 0) ? pe / epsGrowthFwd : null;
```

- Forward-PEG und Trailing-P/E / 5Y-Growth vermischen sich in der Section-4-UI.
- Extrem niedrige Werte (0.04) entstehen, wenn `epsGrowthFwd` sehr groß ist (z. B. Turnaround von kleinem/negativem EPS) **oder** wenn ein anderer Lynch-Basiswert in `pegRatio` landet, während die UI weiter 5Y-Growth zeigt.

### Fix-Anforderung (generisch, kein Ticker-Hardcode)

1. **Eine Quelle, eine Gleichung:** Entweder  
   - `PEG = peRatio / epsGrowth5Y` und genau diese beiden Zahlen anzeigen, **oder**  
   - `PEG = forwardPE / epsGrowthFwd` und **Forward-P/E + Fwd-Growth** anzeigen.
2. Lynch-Varianten (`lynchPEGBasis`) nur mit **passenden** Inputs in der gleichen Box (Mid-Cycle-PE, PEGY, …).
3. Wenn Growth ≤ 0 oder P/E ≤ 0 → `n/a`, nicht 0.04.
4. Sanity: PEG < 0.1 bei P/E > 20 und Growth < 30 % → Flag „prüfen / Dateninkonsistenz“.

---

## 3. WACC Live vs. Sektor-Ref. (Screenshot Section 4)

| Szenario | Beta | D/V | WACC Live (CAPM) | WACC Sektor-Ref. |
|----------|------|-----|------------------|------------------|
| Conservative | 2.02 | 83.8 % | 5.88 % | 11.0 % |
| Average | 1.84 | 76.1 % | 6.42 % | 9.5 % |
| Optimistic | 1.65 | 68.5 % | 6.80 % | 8.0 % |

**Rechnung Live (Average) – methodisch konsistent mit Code:**

```text
Re = Rf + β × MRP = 4.2% + 1.84 × 5.5% = 14.32%
WACC = E/V×Re + D/V×Rd×(1−t)
     ≈ 23.9%×14.32% + 76.1%×5.0%×0.79 ≈ 6.4%
```

- Hoher D/V **drückt** den WACC trotz hohem Equity-Beta (viel billiges Debt in der Formel).
- Das ist **kein Rechenfehler**, aber für Alternatives/Infra oft **zu optimistisch** für DCF → deshalb nutzt Section 5 bewusst **WACC Sektor-Ref.** (höher).
- UI-Hinweis existiert bereits („Abweichung methodisch, kein Fehler“) – gut beibehalten.

**Kein P0 an der Formel;** optional: bei D/V > 60 % Warnung „WACC Live stark leverage-getrieben – DCF nutzt Sektor-Ref.“

---

## 4. FCF = 0 (P0 Datenpfad)

```ts
// fmp-fetcher.ts
fcfTTM: lc.freeCashFlow || (lc.operatingCashFlow || 0) - Math.abs(lc.capitalExpenditure || 0),
// cashflow limit=1 → nur eine Periode
```

| Problem | Wirkung |
|---------|--------|
| Nur 1 Cashflow-Periode | Kein echtes TTM aus 4 Quarters |
| `freeCashFlow` 0/null bei manchen Filern | Fallback OCF−CapEx; bei fehlendem CapEx → 0 |
| High-CapEx-Geschäftsmodelle | GAAP-FCF stark negativ, Tool zeigt 0 % Marge → falsche Ampel |

**Fix-Richtung:**  
- Cashflow `limit` ≥ 4 (Quarter) oder annual + explizites Label.  
- Wenn FCF ≤ 0: anzeigen als negativ/0 mit Hinweis, nicht als „saubere 0 %-Marge“.  
- Optional: Owner-Earnings / AFFO-Hinweis für RE/Infra/Alternatives (generisch über Sector/Industry, kein Ticker-Hardcode).

---

## 5. Segmente, Earnings-Datum, Analysten, EPS-Growth

### Segmente
- Product-Segmentation-Endpoint deckt Brookfield-Business-Segmente nicht zuverlässig ab.
- Text „nur geografisch“ nur anzeigen, wenn **beide** Product- und Geo-Endpoints leer/ungeeignet sind – und Business-Segment-Quellen erweitern, wo FMP sie liefert.

### Earnings-Label
- „Zuletzt berichtet“ an `/stable/earnings` (bzw. letzte Period mit Datum) koppeln, nicht nur FY-Income[0].

### Analyst Grades
- Nicht Events zählen, sondern **unique** Analyst/Firm wenn API es hergibt; sonst Label „Grade-Events (nicht unique Analysten)“.

### EPS-Growth
- Eine kanonische 5Y-CAGR-Funktion (bereits `calcEpsGrowth` in `fmp.ts`) überall verwenden.
- UI: überall labeln „5Y CAGR“ vs. „Fwd YoY“ – keine stillen Wechsel.

---

## 6. Moat = None

- Quant-Heuristik allein unterschätzt Franchise/Scale/Permanent Capital.
- P2: Narrow-Moat-Kandidaten bei Sector ∈ Alternatives/Asset Management + stabilen Fee-Related Earnings (wenn Daten da) – weiterhin **generisch**, keine Brookfield-Ausnahme.

---

## 7. Implementation Priority

| Priority | Task |
|----------|------|
| **P0** | Section4 PEG: Anzeige = dieselbe Formel und dieselben Inputs (Trailing **oder** Forward, nie Mischung) |
| **P0** | FCF: Mehrperioden / korrektes Vorzeichen / kein stilles „0 % Marge“ bei fehlenden Daten |
| **P1** | Analyst Grades deduplizieren oder als Events kennzeichnen |
| **P1** | Earnings „zuletzt berichtet“ aktualisieren |
| **P1** | EPS-Growth-Quellen vereinheitlichen + Label |
| **P1** | Segment-Text nur wenn wirklich keine Business-Segmente |
| **P2** | Moat-Heuristik für Quality-Alternatives vorsichtiger |

---

## 8. Betroffene Dateien

| Datei | Thema |
|-------|--------|
| `client/src/components/sections/Section4.tsx` | PEG-Display vs. Lynch-`pegRatio` |
| `server/fmp-fetcher.ts` | `pegRatio`, `epsGrowthFwd`/`epsGrowth5Y`, `fcfTTM`, grades-Zählung, cashflow limit |
| `server/fmp.ts` | `calcEpsGrowth`, Segmente, earnings |
| Moat-/Summary-Logik | Moat None, Fazit |

---

**Document Owner:** Aktienanalyst Project  
**Created:** 15.08.2026  
**Next Action:** P0 PEG-Konsistenz + FCF-Datenpfad fixen; danach P1 Labels/Analysten/Segmente
