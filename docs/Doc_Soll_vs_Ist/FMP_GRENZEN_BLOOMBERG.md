# FMP-Validierungsgrenzen + Bloomberg-Anschluss

> Stand: 04.09.2026 | Code: `server/fmp.ts`, `analyze-helpers.ts`, `factpack-validate.ts`
> Kein FactSet-/Bloomberg-Key im Repo. FactPack ist die gemeinsame Form.

---

## 1. Was FMP bei euch konkret liefert

`getFmpFallbackData` = **14 parallele Calls**, Budget-Zähler:

| Konstante | Default im Code (`analyze-helpers.ts`) |
|-----------|----------------------------------------|
| `FMP_DAILY_LIMIT` | **15 000** (ENV override) |
| `FMP_WARN_THRESHOLD` | **10 000** |
| `FMP_CALLS_PER_ANALYSIS` | **13** |
| Timeout / Call | **15 s** (`fmp.ts`) |
| Basis | `https://financialmodelingprep.com/stable` |

`DATA_SOURCES.md` nennt noch Free-Tier **750/Tag** — das ist der Plan-Deckel, nicht der Code-Default.

Pro Analyse (Soll-Last): 13 × N Ticker. 100 Analysen/Tag ≈ 1 300 Calls. Unter 15k. Screener + Peers + Earnings-Kalender kommen **on top**.

OHLCV: ihr zieht **10Y** (`Date.now()-10y`). FMP Free/Starter oft nur **5Y** — dann greift `history-fallback.ts` (Yahoo → Stooq). 200-DMA braucht ≥ 200 Punkte; 5Y reichen, 10Y-Charts nicht immer.

Estimates: `fmpAnalystEstimates(ticker, 8)`, `period=annual`. Kommentar im Code: `limit=3` lieferte die **weitesten** Zukunftsjahre (2028–30), nicht Next-FY. Deshalb 8.

---

## 2. Validierungsgrenzen der FMP-Daten

Grenzen, die der FactPack-Checker **nicht heilen** kann — er prüft nur, ob die LLM-Zahl *im Pack* steht, nicht ob das Pack wahr ist.

### 2.1 Konsens ≠ FactSet ≠ Bloomberg

| Feld | FMP (`/analyst-estimates`) | FactSet (Zero-Beat-Dots) | Bloomberg BEST |
|------|----------------------------|--------------------------|----------------|
| EPS-Konsens | `epsAvg` annual | Quartals-Konsens + Surprise | `BEST_EPS`, `BEST_EPS_GAAP` |
| Surprise $ / % | **nicht** im 13er-Bundle | `actual − est`, % | `ERN_ANN_DT_AND_VAL` |
| Adjusted vs GAAP | oft gemischt, undokumentiert je Titel | klar getrennt | klar getrennt |
| Coverage Mid/Small | lückenhaft | breiter | am breitesten |
| Revisions-Historie | nein (nur aktueller Schnitt) | ja | `BEST_EPS_NUMEST`, 4wk rev |

Zero kann „+$0,44 Beat Q1’26“ schreiben, weil FactSet **Quartals-Surprise** hat. Euer Pack hat heute **Jahres-Konsens + GuV-EPS**. Ein LLM-Satz „Q2-Umsatz 582,3 Mio.“ matcht `inc.revenue` nur wenn FMP die *gleiche Periode* in `income[0]` hat — bei FY-Zeile ist das ein **False-Negative oder False-Positive**.

**Grenze:** FactPack-Toleranz ±3 % / EPS ±0,02 validiert Konsistenz LLM↔Pack, nicht Qualität des Konsens.

### 2.2 Währung (im Code schon als Falle markiert)

- Income hat `reportedCurrency` (NVO = DKK trotz ADR-USD).
- Estimates haben das Feld **nicht**. Workaround: Estimates mit Income-Währung taggen, dann `convertFmpRowsToUsd`.
- FX in `fetchFXRate`: **statische** Tabelle (`EUR: 1.09`, `DKK: 0.146`, …), „täglich veraltet“ (`DATA_SOURCES.md`).
- Peg-Bug vor dem Fix: DKK-EPS × ~5,4 → PEG unsinnig.

**Grenze:** Internationale Filings ± mehrere Prozent vs. Bloomberg FX am Stichtag. FactPack darf DKK-rohe und USD-konvertierte Zahlen nicht in einen Topf — Pack nur **nach** `convertFmpRowsToUsd`.

### 2.3 Periodizität und Restatements

| Thema | FMP-Ist bei euch | Wirkung |
|-------|------------------|--------|
| Income/CF | **3** Jahreszeilen | YoY ok, QoQ-Beat wie Nebius **nicht** |
| Balance | **2** Jahre (Inventory-Gate) | 1 Jahr → Gate tot |
| Estimates | annual, 8 Zeilen | kein Quartalskonsens |
| Segmente | `/revenue-product-segmentation` | IREN historisch `[]` → SEC-Fallback |
| FCF | `freeCashFlow` sonst OCF−\|CapEx\|, 3 Perioden, nie stilles $0 | Restatement einer Periode kippt TTM |
| Grades | 20 letzte | keine Institution-Gewichtung |

FMP spielt Restatements oft **nur in der neuesten Zeile** nach, ältere Limits bleiben Altstand. Bloomberg/FactSet point-in-time „as-was“ vs. „as-now“ getrennt. Euer Score hat Lookahead-Regel — FMP-Historie ist trotzdem **as-now**.

### 2.4 Was der Checker bewusst durchlässt

- Sätze ohne Zahl („Management optimistisch“)
- Jahreszahlen 1990–2100 (werden nicht als Claim gelesen)
- Deal-Namen ohne Betrag
- `einpreisungsgrad` / PoS (interne Modellgrößen, nicht FMP)

### 2.5 Harte „nicht validierbar mit FMP“-Liste (Zero-Felder)

| Zero-Satztyp | FMP-Feld vorhanden? |
|--------------|---------------------|
| Quartals-Beat EPS $ | nein im Bundle |
| Quartals-Umsatz vs. Konsens | nein |
| Adjusted EBITDA 236,2 Mio. (Nicht-GAAP) | selten, nicht standardisiert |
| Barmittel Stichtag 30.06. | nur letzter BS, nicht intra-quarter |
| Wandelanleihe 5,75 Mrd. | kein Debt-Deal-Feed |
| Surprise-Historie 5 Quartale (Beat-Dots) | fehlt |

Diese Sätze darf das LLM nach der Regel **nicht** schreiben, solange das Pack sie nicht enthält — sonst fliegt der Satz. Das ist gewollt.

---

## 3. Bloomberg-Integration (Soll, nicht live)

### 3.1 Produkt ≠ ein REST-Key

| Produkt | Was es ist | Große Ordnung 2026 |
|---------|------------|---------------------|
| Terminal | UI + Excel | ~20–27k USD/Jahr/Seat |
| B-PIPE / Server API | Realtime Quotes | Enterprise, 5-stellig+/Monat |
| Data License / Per Security | Bulk Fundamentals, Estimates | typ. Vertrag + per-field |
| Open FIGI | nur ID-Mapping, **keine** Fundamentals | frei |
| Bloomberg Query Language (BQL) | Excel/Terminal | an Seat gebunden |

Für Aktienanalyst ist nur **Data License / Per-Security REST** sinnvoll (gleiche Rolle wie FMP). Terminal-Scraping nicht.

### 3.2 Felder, die das FactPack ersetzen/ergänzen

Mapping auf `buildFactPackFromFactSet`-IDs (gleiche IDs, `source: "bloomberg"`):

| FactPack-id | Bloomberg Field | Periode |
|-------------|-----------------|--------|
| `eps_actual` | `IS_EPS` / `ERN_ANN_DT_AND_VAL` | Quartal + FY |
| `eps_cons` | `BEST_EPS` (Rel Period +1Q / +1FY) | |
| `eps_surp` | `BEST_EPS` − actual, oder Surprise-Feld | |
| `rev_actual` | `SALES_REV_TURN` | |
| `rev_cons` | `BEST_SALES` | |
| `rev_surp` | Differenz | |
| `ebitda_adj` | `BEST_EBITDA` + company adj. | optional |
| `cash` | `CASH_AND_ST_INVESTMENTS` | |
| `nd` | `NET_DEBT` | |
| `px` | `PX_LAST` | |

Zusatz, das FMP nicht sauber hat und euer Score braucht:

- `BEST_EPS_NUMEST` — Zahl der Schätzer (Coverage-Gate: `<5` → Konsens dünn)
- 4-Wochen-Revision `BEST_EPS` — Lookahead-ehrlicher als Level
- `EQY_FUND_CRNCY` + `PX_LAST` in Handelswährung — ersetzt statische FX-Tabelle
- `EXPECTED_REPORT_DT` — Earnings-Kalender statt FMP-Kalender-Lücken

### 3.3 Architektur (kein zweites Scoring)

```
FMP 13er-Bundle     → buildFactPackFromFmp     → source=fmp
Bloomberg Per-Sec   → buildFactPackFromBloomberg → source=bloomberg
FactSet (optional)  → buildFactPackFromFactSet    → source=factset
                         ↓
              mergeFactPacks(priority: bb > fs > fmp)
                         ↓
              validateTextAgainstFactPack(llmText, pack)
```

Regel: **eine Zahl, eine Quelle.** Merge nicht mitteln. Wenn BB `BEST_EPS=0.44` und FMP `epsAvg=0.51` → Pack nutzt BB, FMP-Wert liegt nicht mehr im Match-Set (sonst würde das LLM beide überleben).

Cache: `factpack_v1__{TICKER}` TTL wie Analyze L2 (7 d), Invalidate am Earnings-Tag (`EXPECTED_REPORT_DT`).

### 3.4 Was ihr *nicht* von Bloomberg holen sollt

- OHLCV (Yahoo/Stooq/FMP reichen, BB teuer pro Tick)
- News-Fließtext (habt RSS + LLM)
- DCF/WACC (euer Modell)
- Realtime B-PIPE für Paper-Portfolio

### 3.5 Mindestvertrag, der die Zero-Lücke schließt

Nur 6 Felder Quartal + FY, ~500 Ticker Universe:
`BEST_EPS, BEST_SALES, IS_EPS, SALES_REV_TURN, EXPECTED_REPORT_DT, EQY_FUND_CRNCY`.

Damit: Beat-Dots wie Zero, FactPack-Sätze zu Nebius Q2, keine 45 TraderFox-Kriterien.

Ohne Vertrag bleibt FMP-Jahreskonsens — und der Checker **darf** Quartals-Beats nicht durchwinken.

---

## 4. DoD

1. Pack-`source` steht an jedem Fact.
2. LLM-Satz mit Quartals-Umsatz ohne Quartals-Fact → drop.
3. DKK-Filer: Pack nur USD-nach-Konvertierung; Test NVO EPS nicht ×5.
4. Bloomberg-Client fehlend → `available:false` auf Surprise-Feldern, kein Fake-0,44.
5. Merge niemals Mittelwert zweier Vendor-EPS.
