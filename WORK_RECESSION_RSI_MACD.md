# WORK_RECESSION_RSI_MACD.md

Stand Doku: **05.09.2026 11:48 CEST**.
Vorhaben: drei Regionen-Charts im bestehenden `#/recession` mit Wilder-RSI, MACD 12/26/9, Kombi-Label und Swing-Divergenz.
**Nicht** Teil der 17 Indikatoren / fünf P-Kacheln.

Eltern-Spec Charts/VIX/PEG: [WORK_RECESSION_MARKET_CHARTS.md](./WORK_RECESSION_MARKET_CHARTS.md).
Hub: [docs/Doc_Soll_vs_Ist/README.md](./docs/Doc_Soll_vs_Ist/README.md).

---

## 0. Ist vs Soll

| Teil | Soll | Ist 05.09. |
|------|------|------------|
| 3 Regionen-Buttons US/EU/AS | ein Chart je Region | Engine + Panel-Komponente da |
| RSI(14) Wilder-Serie | Chart Y 0–100, Linien 70/30 | `shared/tech-rsi.ts` + API |
| MACD 12/26/9 + Hist | ComposedChart | API + Panel |
| Kombi-Label | 5 Zustände | `combineRsiMacd` |
| Divergenz | 4 Arten, 90 Sessions | `detectRsiDivergence` |
| Route | GET markets | `registerRecessionMarketRoutes` in `routes-register.ts` |
| Sektion im Dashboard | Karte nach S7 | **Panel existiert, Import in `RecessionDashboard.tsx` noch nicht auf main verifiziert** |
| VIX-Pane Y 0–90 | Poster-X + Fenster | **offen** (nur Spec) |
| PEG-Click | Factpack | **offen** |
| FINRA-Hebel unter SPY | Jul 26 1 417 Mrd. $ | **offen** |
| Input in 17er-Score | verboten | eingehalten |

Ampel: Engine `🟡` (Code da, Dashboard-Draht + VIX/PEG offen).

---

## 1. Universum (drei Charts, nicht vier Tabs)

| Region | Button | ETF | Angst-Index (noch offen) |
|--------|--------|-----|--------------------------|
| US | `US · SPY` | **SPY** | FRED `VIXCLS` — Board 05.09. **14,3**; Poster 14,25 am 14.08. |
| Europa | `Europa · VGK` | **VGK** | VSTOXX `^V2TX`, nicht FRED |
| Asien | `Asien · ASHR` | **ASHR** | CBOE `VXFXICLS` tot seit 2022 → 20T-realisiert |

Nasdaq `QQQ` + `VXNCLS` **20,16** (03.09.) nur optionaler Schalter *im* US-Chart, kein viertes Regionen-Tab.
FXI ≠ Shanghai.

Fenster: `1Y=252`, `3Y=756`, `5Y=1260`, `10Y=2520`, `MAX=7000` Handelstage + Warmup 80.

---

## 2. Formeln

### 2.1 RSI Wilder 14

Erster Block SMA der Gains/Losses über 14 Änderungen, danach:

\[
\bar G_t=\frac{13\bar G_{t-1}+G_t}{14},\quad
\bar L_t=\frac{13\bar L_{t-1}+L_t}{14},\quad
RSI=100-\frac{100}{1+\bar G/\bar L}
\]

\(\bar L=0\Rightarrow RSI=100\). Weniger als 15 Closes → `null`.
Zone-Label: \(\ge 70\) overbought, \(\le 30\) oversold, sonst neutral. **Nicht** der Score.

### 2.2 MACD 12 / 26 / 9

\[
EMA_n:\quad k=\frac{2}{n+1},\quad
EMA_t=k\,P_t+(1-k)\,EMA_{t-1}
\]

Seed = SMA der ersten \(n\) Werte.

\[
MACD=EMA_{12}-EMA_{26},\quad
Signal=EMA_9(MACD),\quad
H=MACD-Signal
\]

### 2.3 Kombi (letzter + vorletzter Balken)

\[
\begin{aligned}
\text{oversold\_turn} &\iff RSI\le 35 \land MACD>Signal \land (H>0 \lor H\text{ kreuzt }\uparrow)\\
\text{overbought\_fade} &\iff RSI\ge 65 \land MACD<Signal \land (H<0 \lor H\text{ kreuzt }\downarrow)\\
\text{aligned\_up} &\iff RSI>50 \land MACD>Signal \land H>0\\
\text{aligned\_down} &\iff RSI<50 \land MACD<Signal \land H<0\\
\text{mixed} &\iff \text{sonst}
\end{aligned}
\]

RSI 28 ohne MACD-Kreuz bleibt `mixed`.

### 2.4 Divergenz (letzte zwei Swings)

Fenster 90 Sessions, Swing-Order 5, Mindestabstand 8 Balken.
Preis-Δ \(>0{,}3\,\%\), RSI-Δ \(>2\) Punkte, sonst `none`.

| kind | Preis | RSI |
|------|-------|-----|
| `regular_bull` | tieferes Tief | höheres Tief |
| `regular_bear` | höheres Hoch | tieferes Hoch |
| `hidden_bull` | höheres Tief | tieferes Tief |
| `hidden_bear` | tieferes Hoch | höheres Hoch |

Regular = Dreh-Kandidat. Hidden = Trendfortsetzung. Ohne MACD-Kreuz nicht traden.

---

## 3. Live-Zahlen 04.–05.09.2026 (Kontext, nicht Fixture)

| Größe | Wert | Quelle |
|-------|------|--------|
| S&P 500 | 7 718,60 | Investing 05.09. |
| SPY Close 04.09. | 770,19 (−0,39 %) | Investing |
| RSI(14) SPY | **54,2** | Investing 04.09. 20:00 GMT |
| RSI(14) S&P | **54,1** | Investing 05.09. |
| MACD-Linie SPY | +0,72 (Buy-Label Vendor) | Investing |
| MACD-Linie S&P | +6,79 | andere Skala, nicht mit SPY addieren |
| VIX Board | **14,3** | `#/recession` 05.09. |
| VXN | **20,16** | FRED 03.09. |
| UNRATE Aug | 4,1 % | FRED |
| Sahm Board | −0,07 pp | `SAHMREALTIME` |

Erwartung Kombi US nach Deploy: RSI 54 ∈ (30,70) → kein Turn/Fade. `aligned_up` oder `mixed` je nach Vorzeichen \(H\) auf **FMP-SPY**, nicht Vendor-Screener „Strong Buy“.

---

## 4. API

`GET /api/analyze-recession/markets?region=US\|EU\|AS&window=5Y`

Cache-Key `v3:{region}:{window}`, TTL **6 h**. 503 wenn `!isFmpAvailable()`.

Response-Kern:

```
{
  region, label, etf, window, asOf,
  rsi, rsiZone, rsiPeriod: 14,
  macd, signal, hist, combo,
  divergence: { kind, lookback, from, to, price1, price2, rsi1, rsi2 },
  points, series: [{ date, close, volume, rsi, macd, signal, hist }]
}
```

OHLCV: `fmpHistoricalPrices(etf, from, to)` — `/historical-price-eod/full`.

---

## 5. Betroffene Dateien

### Neu / Kern

| Datei | Rolle |
|-------|-------|
| [`shared/tech-rsi.ts`](./shared/tech-rsi.ts) | `rsiWilder`, `rsiZone`, `macd1269`, `combineRsiMacd`, `detectRsiDivergence` |
| [`server/recession-markets.ts`](./server/recession-markets.ts) | `MARKET_BOOKS`, `buildRegionMarket`, GET-Handler |
| [`client/src/components/recession/RegionRsiPanel.tsx`](./client/src/components/recession/RegionRsiPanel.tsx) | Buttons, RSI-Chart, MACD-ComposedChart, Kombi+Div-Text |

### Verknüpft (Wiring)

| Datei | Rolle |
|-------|-------|
| [`server/routes-register.ts`](./server/routes-register.ts) | `registerRecessionMarketRoutes(app)` nach ValueChain |
| [`server/fmp.ts`](./server/fmp.ts) | `fmpHistoricalPrices`, `isFmpAvailable` |
| [`server/recession.ts`](./server/recession.ts) | 17er-POST unverändert — **keine** Import-Kante in den Scorer |
| [`client/src/pages/RecessionDashboard.tsx`](./client/src/pages/RecessionDashboard.tsx) | Soll: `import { RegionRsiPanel }` + Section nach S7 |
| [`server/gold-routes.ts`](./server/gold-routes.ts) | bestehendes `calculateRSI` (nur letzter Wert) — gleiche Wilder-Idee, nicht refactored |

### Spec-Nachbarn

| Datei | Bezug |
|-------|-------|
| [WORK_RECESSION_MARKET_CHARTS.md](./WORK_RECESSION_MARKET_CHARTS.md) | VIX-Pane, PEG-Click, FINRA |
| [WORK_RECESSION_FRED_SAHM.md](./WORK_RECESSION_FRED_SAHM.md) | Sahm \(s(z)\), nicht RSI |
| [WORK_RECESSION_RATE_OIL_BRIDGE.md](./WORK_RECESSION_RATE_OIL_BRIDGE.md) | Zins/Öl, anderes Buch |
| Aktien-Sektion 9 / BTC-Technicals | RSI+MACD-UI-Vorbild |

---

## 6. UI-Soll im Dashboard

Eine `SectionCard` nach S7 Prozentschätzungen:

```tsx
import { RegionRsiPanel } from "@/components/recession/RegionRsiPanel";
<SectionCard number={8} title="Markt-RSI / MACD nach Region">
  <RegionRsiPanel />
</SectionCard>
```

Folgende Karten +1 nummerieren. Lazy-Fetch erst wenn die Karte sichtbar — FMP-Budget.

Nicht: VIX-Poster, PE-Linie, 17er-Gewicht.

---

## 7. DoD

1. `rsiWilder([konstant], 14)` endet bei 50 nach Warmup (keine Drift).
2. \(z\)-unabhängig: RSI 54 ⇒ Zone `neutral`, nie raw +4 im Recession-Scorer.
3. `FE`/`Sahm`/`Buffett` unverändert wenn diese Route 500 liefert.
4. Drei `region`-Calls, drei ETF, kein shared VIX.
5. `divergence.kind==='none'` wenn \(<90\) Bars oder \(\Delta P\le 0{,}3\%\).
6. Cache-Key bricht bei Formel-Änderung (`v3`).
7. Dashboard zeigt Panel nur mit FMP; sonst Fehltext, kein Fallback-RSI 50 als Wahrheit.

---

## 8. Offen (nicht dieser Commit-Stand)

- VIX/VXN/VSTOXX-Pane Y 0–90, Fenster-X.
- PEG/PE Factpack-Click.
- FINRA-Margin-Streifen nur US.
- `RecessionDashboard.tsx` Import falls Deploy die Sektion nicht zeigt: 6 Zeilen wie §6.
- Gold-`calculateRSI` auf `rsiWilder` umbiegen (optional, kein Blocker).
