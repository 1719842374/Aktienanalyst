# WORK_RECESSION_MARKET_CHARTS.md

Vier Märkte, ein Raster. Vol-Chart wie das Poster, **Zeitachse linear im gewählten Fenster**.
Bewertung nur im Tooltip/Click — keine zweite Y-Achse für PE.

---

## Universen (Preis = ETF, Vol = Optionsindex)

| Karte | Index | ETF (USD, FMP-OHLCV) | Vol-Serie | Vol ab |
|-------|-------|----------------------|-----------|--------|
| US Broad | S&P 500 | `SPY` | FRED `VIXCLS` | 1990 |
| US Growth | Nasdaq-100 | `QQQ` | FRED `VXNCLS` | 2001 |
| Europa | STOXX Europe 600 / Euro Stoxx 50 | `VGK` (breit) oder `FEZ` (EZ-50) | Eurex VSTOXX `^V2TX` (Yahoo/Stoox), nicht FRED | 1999 |
| Asien | CSI 300 / Shanghai-A | `ASHR` (Onshore-A), nicht FXI (HK) | **kein** Live-VIX: `VXFXICLS` FRED **eingestellt 2022**. Soll: 20T-realisierte Vol von ASHR, Flag `realized` | Preis 2013+ |

Nicht mischen: Shanghai-Composite ohne A-Share-Zugang \neq MSCI AC Asia. ASHR ist das ehrliche Onshore-Beta.
Japan optional Chip `EWJ` + `JNIV` — nicht Pflicht.

---

## 1. Vol-Chart (Poster, X richtig)

Poster-Fehler: 35 Jahre auf einer Breite, Events als Blasen, aktuelle 14,25 klebt rechts ohne Fenster.

Soll:

- X = Handelstage im Fenster `{1Y,3Y,5Y,10Y,MAX}` mit MAX = max(1999, Serienstart).
- Y = Vol-Index, **linear 0–90**, gleiche Skala in jedem Fenster (kein Auto-Zoom auf 12–18, sonst wirkt 14,3 „hoch“).
- Bänder (nur US-VIX/VXN kalibriert, EU/ASHR als „analog, nicht identisch“):

```
>40  Extreme Fear — nicht „Buy“ im Scorer, nur Label
30–40 Fear
20–30 Normal
<20  Complacency
```

Dashboard-Score bleibt \(s(z)\), nicht diese Eimer.

Marken nur bei lokalen Maxima \(V_t=\max(V_{t-20\ldots t+20})\) und \(V>35\), Text außerhalb der Plotfläche oder Hover — nicht 8 Overlaps wie 2008/2020.

Print 03.09.2026: VIX **14,3** (Board) / Poster **14,25** am 14.08.2026. VXN **20,16** (03.09.). Nasdaq-Angst ≠ S&P-Angst.

---

## 2. Preis-Chart + Click-Factpack

Ein Chart pro Markt: Kerzen oder Linie (log optional), Volumen-Subpane, RSI(14)+MACD(12,26,9) wie Aktien-Sektion 9.

**Keine** PE-Linie auf der Preis-Achse.

Click auf Tag \(t\) öffnet Factpack:

| Feld | Quelle | Formel |
|------|--------|--------|
| PE ttm | FMP `key-metrics` ETF oder Index | Preis / EPS ttm |
| PE fwd | FMP analyst-estimates Index/ETF | Preis / EPS NTM |
| EPS YoY | FMP income-growth oder index earnings | \((E_t-E_{t-4q})/E_{t-4q}\) |
| PEG ttm | | \(\mathrm{PE}_{ttm}/(g_{\mathrm{EPS}}\cdot 100)\) wenn \(g>0\) sonst n/a |
| PEG fwd | | \(\mathrm{PE}_{fwd}/(g_{\mathrm{cons}}\cdot 100)\) |
| RSI, MACD | OHLCV lokal | wie `technicalIndicators` Analyze |
| Volume | ETF | |

\(g\) in Prozent (17,8 nicht 0,178). PEG>3 bei positivem \(g\) = teuer je Wachstumseinheit — genau die Frage „wie viel zahlt man growth-adjusted“.

Index-PEG ist grob (S&P-Gewichte \neq SPY-Steuer). Label `ETF-Proxy`.

---

## 3. Leverage-Streifen (nur wo Serie existiert)

| Markt | Serie | Score |
|-------|-------|-------|
| US | FINRA Margin Debit, Mrd. $, YoY + vs. 5J-\(z\) | Jul 26 **1 417** |
| EU | EZB BSI Loans NFC oder weglassen | kein FINRA-Clone |
| CN | nicht erfinden | Streifen aus |

Ein Mini-Pane unter SPY, nicht unter ASHR. \(z(\mathrm{YoY})>1\) = Hebel hoch.

---

## API

`GET /api/analyze-recession/markets?window=5Y`

```
{ asOf, window,
  markets: [{ id, etf, volId, volKind: "implied"|"realized",
              ohlcv: [...], vol: [...],
              snapshot: { pe, peFwd, peg, pegFwd, epsYoy, rsi, macdHist } }] }
```

Cache 6 h. OHLCV FMP daily ab 1999, Vol FRED/Yahoo. Factpack lazy per Click `?date=`.

UI: Tabs SPY | QQQ | VGK | ASHR, Fenster-Chips 1/3/5/10/MAX, Vol-Pane mit Bändern, Preis+Volumen+RSI/MACD, Click-Drawer.
