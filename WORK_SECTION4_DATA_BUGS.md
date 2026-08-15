# WORK.md – Section 4 / Datenqualitäts-Bugs (Aktienanalyst)

**Status:** Bug-Report + Fix-Spec (Brookfield / BN-Typ + AMZN Segment-Dedup, Stand 15.08.2026)  
**Priority:** P0 PEG + FCF; P1 Segmente (Dedup Geo/Business) / Earnings / Analysten / Growth; P2 Moat Alternatives  
**Scope:** Section 4, FMP-Mapping, Segment-Dedup, Alternatives-Metriken, Moat

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
| 3b | **Business-Segment erscheint erneut unter Geographic** (z. B. AMZN AWS $128.72B doppelt) | **P1** |
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

Nenner ist immer die **Wachstumsrate in %**, nie absolutes EPS in $.

Brookfield-Beispiel: `88.3 ÷ 10.9 ≈ 8.10` (Anzeige 0.04 = Bug).  
AMZN-Beispiel: UI `31.7 ÷ 57.2%` → korrekt ≈0.55, Anzeige 0.36 = derselbe Display-Bug.

### 3.2 Code-Ursache

**`Section4.tsx`:** UI zeigt `peRatio` + `epsGrowth5Y`, Wert oft `data.pegRatio` (Lynch/Forward).

**`fmp-fetcher.ts`:** `pegRatio = pe / epsGrowthFwd`.

### 3.3 Fix (generisch)

1. Modus `trailing` | `forward` | `lynch` – Anzeige = Berechnung, gleiche Inputs.
2. Keine Mischung Pfad A / Pfad B.
3. growth ≤ 0 oder pe ≤ 0 → `n/a`.
4. Sanity: peg < 0.1 && pe > 20 && growth < 30 → Flag.

---

## 4. FCF = 0 (P0)

Cashflow `limit=1`; negatives GAAP-FCF wird zu $0.  
**Fix:** Mehrperioden, Vorzeichen sichtbar, High-CapEx-Hinweis generisch (Infra/Alternatives/RE/AM).

---

## 5. Business vs. Geographic Segments – Doppelzählung (P1, NEU)

### 5.1 Problem (AMZN Live)

| Liste | Eintrag | Revenue |
|-------|---------|--------|
| Business Segments | Amazon Web Services | **$128.72B** (18 %) |
| Geographic Segments | Amazon Web Services Segment | **$128.72B** (18 %) |

Gleiche Zahl zweimal. AWS ist ein **Geschäftssegment** (global), keine Region. Amazon reportet in Filings oft NA / International / AWS als drei „reportable segments“ – FMP mappt AWS naiv in beide Buckets.

**Folgen:** optische Doppelzählung, verzerrte Geo-Anteile, falsche Interpretation („AWS = Region“).

### 5.2 Generische Fix-Logik (Code)

Keine Ticker-Hardcodes. Reihenfolge der Regeln:

```text
INPUT:
  businessSegments: { name, revenue }[]
  geographicSegments: { name, revenue }[]

// 1) Exakte Dedup: gleicher normalisierter Name + gleicher Revenue (±1% Toleranz)
function norm(s) = lower(trim(s)).replace(/\s+/g, " ")

for each g in geographicSegments:
  if exists b in businessSegments where
       norm(b.name) == norm(g.name)
       AND abs(b.revenue - g.revenue) / max(b.revenue, 1) < 0.01:
    → remove g from geographicSegments  // gehört nur zu Business

// 2) Non-Geo-Keywords (generisch, erweiterbar – keine Ticker-Liste)
NON_GEO_PATTERN = /web services|aws|cloud|advertising|subscription|
                   asset management|private equity|infrastructure fund|
                   wealth solutions|fee.?related|corporate (activities)?/i

for each g in geographicSegments:
  if NON_GEO_PATTERN.test(g.name):
    → remove g from geographic  (optional: merge into business if missing there)

// 3) UI Geographic
- Nur verbleibende echte Regionen anzeigen
- Wenn Einträge entfernt wurden: Hinweis
  "Einige reportable Segments (z. B. globale Geschäftsbereiche) sind unter
   Business Segments geführt, nicht unter Regionen."
```

### 5.3 UI-Regeln

1. Einträge mit **gleichem Namen + gleichem Revenue** in beiden Listen → nur in **Business**, aus **Geographic** entfernen.  
2. Namen, die klar **Non-Geo** sind (Web Services, AWS, Advertising, Asset Management, …) → nur Business.  
3. Geographic-Label: nur Regionen; optional Fußnote bei entfernten globalen Segmenten.

### 5.4 Akzeptanztest

| Case | Erwartung |
|------|-----------|
| AMZN | AWS nur unter Business; Geographic = North America + International (ohne AWS-Balken) |
| BN | Business-Segmente sichtbar; kein „nur geografisch“-Text wenn Business-Daten da |
| Titel nur Geo | Geographic unverändert; kein falsches Löschen |

---

## 6. Alternatives Asset Management – Metriken

Priorität für Interpretation: FBC, FRE, Fundraising, Deployable Capital, DE – nicht allein GAAP-FCF/P/E.  
Segment-Soll: Asset Management, Wealth Solutions, Infrastructure, Energy, PE, Real Estate, Corporate.

---

## 7. Brookfield Capital-Strategie 2026 (Referenz)

| Kennzahl | Wert |
|----------|------|
| Fundraising Q2 | $77 Mrd. Rekord |
| FBC | $672 Mrd. (+19 % YoY) |
| FRE | +20 % YoY |
| Deployable Capital | $210 Mrd. |
| Deployment YTD | ~$100 Mrd. |

→ Narrow Moat plausibler als None; FRE/DE statt FCF=$0.

---

## 8. WACC Live vs. Sektor-Ref.

Hoher D/V drückt Live-WACC (kein Formel-Bug). DCF nutzt Sektor-Ref. – beibehalten.

---

## 9. Weitere P1/P2

| Thema | Fix |
|-------|-----|
| Analyst Grades | Unique oder „Grade-Events“-Label |
| Earnings-Datum | `/stable/earnings` / letztes Quarter |
| EPS-Growth | Eine CAGR-Quelle + Labels |
| Moat | Scale/Permanent-Capital → Narrow generisch |

---

## 10. Implementation Priority

| Prio | Task | Done-Kriterium |
|------|------|----------------|
| **P0** | PEG: Anzeige = Formel = Inputs | BN Trailing ≈8.1; AMZN Trailing ≈0.55 wenn 31.7/57.2 |
| **P0** | FCF Mehrperioden + Vorzeichen | kein stilles $0 bei negativem FCF |
| **P1** | **Segment-Dedup Business vs Geographic** | AMZN: AWS nur einmal (Business); Geo ohne AWS |
| **P1** | Analyst / Earnings / Growth-Labels | wie oben |
| **P1** | Segment-Text „nur geo“ | nur wenn wirklich keine Business-Daten |
| **P2** | Moat Alternatives | Narrow bei Franchise/Scale möglich |

---

## 11. Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `client/src/components/sections/Section4.tsx` | PEG-Modus |
| Segment-UI (Section 2 / Thesis / wo Business+Geo gerendert werden) | Dedup-Anzeige, Hinweistext |
| `server/fmp-fetcher.ts` / `server/fmp.ts` | optional serverseitig Geographic filtern; FCF; grades; earnings |
| Moat-/Summary-Logik | Alternatives Narrow |

**Empfehlung:** Dedup **serverseitig** beim Bauen von `segments` / `geographicSegments` *oder* zentral in einer shared `dedupeSegments(business, geographic)`-Hilfsfunktion – eine Stelle, UI nur noch render.

---

**Document Owner:** Aktienanalyst Project  
**Updated:** 15.08.2026 (Segment-Dedup generisch + PEG/FCF/Alternatives)  
**Next Action:** P0 PEG + FCF; parallel P1 Segment-Dedup
