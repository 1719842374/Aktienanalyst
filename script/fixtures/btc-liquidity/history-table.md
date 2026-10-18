### Vorher/Nachher BTC-Score (Skript script/btc-liquidity-history.ts)

| Zeile | QE 2020 2020-06-30 | QT 2022 2022-10-31 | jetzt (rekonstr.) 2026-10-18 | heute (App-Pfad) 2026-10-18 |
|---|---|---|---|---|
| BTC-Kurs (letzter Punkt ≤ Stichtag) | $9,185 | $20,816 | $81,752 | $81,752 |
| MVRV Z-Score: Score (Wert) | +0.0 (-0.08) | +1.0 (-0.71) | +0.0 (-0.37) | +0.0 (-0.37) |
| RSI (Weekly): Score (Wert) | +0.0 (55.0) | +0.0 (42.3) | +0.0 (52.0) | +0.0 (52.0) |
| Fear & Greed: Score (Wert) | +0.0 (44 (Fear)) | +0.0 (31 (Fear)) | +0.0 (53 (Neutral)) | +0.0 (53 (Neutral)) |
| Hashrate Trend ²: Score (Wert) | +1.0 (114 EH/s (+8.1% 90d)) | +1.0 (248 EH/s (+16.7% 90d)) | +0.5 (943 EH/s (+3.5% 90d)) | +0.5 (943 EH/s (+3.5% 90d)) |
| ETF Net Flows ³: Score (Wert) | -1.0 (-10.0% 7d (Starker Outflow-Proxy)) | +0.5 (+7.8% 7d (Inflow-Signal)) | +0.5 (+4.6% 7d (Inflow-Signal)) | +0.5 (+4.6% 7d (Inflow-Signal)) |
| Macro (Fed/M2) ⁴: Score (Wert) | +1.0 (FFR 0.05%) | +1.0 (FFR 2.56%) | +0.0 (FFR 3.75%) | +0.8 (S 69.1) |
| DXY ⁵: Score (Wert) | +0.0 (103.03) | -1.0 (109.48) | +0.0 (103.23) | +0.0 (103.23) |
| Gewicht je Alt-Indikator vorher → nachher | ×1 → ×0,85 | ×1 → ×0,85 | ×1 → ×0,85 | ×1 → ×0,85 |
| Liquidität WALCL: Score (Wert, Stand) | +1.0 (7.08 Bio. $ (13W +34.79 %); 2020-06-24; Anteil 45.0 %) | -1.0 (8.72 Bio. $ (13W -1.88 %); 2022-10-26; Anteil 45.0 %) | +0.0 (6.76 Bio. $ (13W +0.19 %); 2026-10-14; Anteil 45.0 %) | +0.0 (6.76 Bio. $ (13W +0.19 %); 2026-10-14; Anteil 45.0 %) |
| Liquidität BILLS: Score (Wert, Stand) | +0.0 (2.66 Bio. $, Anteil 15.5 % (4Q -0.08 pp, P58); 2020-01-01; Anteil 20.0 %) | -1.0 (3.52 Bio. $, Anteil 15.1 % (4Q -4.55 pp, P17); 2022-04-01; Anteil 20.0 %) | +0.5 (6.69 Bio. $, Anteil 21.7 % (4Q +1.39 pp, P74); 2026-04-01; Anteil 20.0 %) | +0.5 (6.69 Bio. $, Anteil 21.7 % (4Q +1.39 pp, P74); 2026-04-01; Anteil 20.0 %) |
| Liquidität DGS10: Score (Wert, Stand) | +0.0 (0.64 % (3M -6 bp); 2020-06-29; Anteil 35.0 %) | -1.0 (4.02 % (3M +135 bp); 2022-10-28; Anteil 35.0 %) | -1.0 (5.10 % (3M +53 bp); 2026-10-15; Anteil 35.0 %) | -1.0 (5.10 % (3M +53 bp); 2026-10-15; Anteil 35.0 %) |
| Liquiditätsblock L (Abdeckung) | +0.450 (100 %) | -1.000 (100 %) | -0.250 (100 %) | -0.250 (100 %) |
| **GIS vorher** | **+0.1000** | **+0.3750** | **+0.1250** | **+0.2395** |
| **GIS nachher** | **+0.1525** | **+0.1687** | **+0.0688** | **+0.1661** |
| Δ GIS | +0.0525 | -0.2063 | -0.0562 | -0.0734 |
| Power-Law-Signal | +0.5 | +0.5 | +0.5 | +0.5 |
| Zyklus-Signal ¹ | +0.5 (-46 M) | +0.5 (-18 M) | -0.5 (30 M) | -0.5 (30 M) |
| **GWS vorher** | **+0.3800** | **+0.4625** | **+0.1875** | **+0.2218** |
| **GWS nachher** | **+0.3958** | **+0.4006** | **+0.1706** | **+0.1998** |
| Δ GWS | +0.0158 | -0.0619 | -0.0169 | -0.0220 |
| Vorher = main 35ead515 (GIS & GWS identisch) | ✅ | ✅ | ✅ | ✅ |

¹ Zyklus: analyzeBTC rechnet fest mit Halving 2024-04-20; für 2020/2022 ergibt das negative Monate → Zyklus-Signal historisch NICHT aussagekräftig (bestehendes Verhalten, unverändert).
² Hashrate: mempool /all auf 90 T. vor Stichtag geschnitten (Proxy für /3m).
³ ETF: Farside-Historie nicht rekonstruierbar → analyzeBTC-eigener 7d-Momentum-Proxy (in allen Spalten, auch heute).
⁴ Macro: historisch und „jetzt (rekonstr.)“ FFR-Regel (fiscal-frontend nicht point-in-time); „heute (App-Pfad)“ mit aufgezeichneter fiscal-frontend-Antwort.
⁵ DXY: FRED DEXUSEU als EUR/USD-Proxy für Binance EURUSDT in derselben Formel.
Alle Reihen point-in-time mit Veröffentlichungsverzug (WALCL/DGS10/DEXUSEU +1 T., FEDFUNDS +32 T., Z.1 +165 T.); FRED-Revisionen (ALFRED) nicht nachgebildet.
BTC-Kurs: blockchain.info market-price (timespan=all, 4-Tage-Raster) bis Stichtag; CoinGecko-Spot nicht historisch → letzter Punkt.
Fixtures: blockchain = https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true @ 2026-10-18T20:28:28.582Z; fng = https://api.alternative.me/fng/?limit=0&format=json @ 2026-10-18T20:28:29.502Z; hashrate = https://mempool.space/api/v1/mining/hashrate/all @ 2026-10-18T20:28:29.978Z; FEDFUNDS = https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&cosd=2015-01-01 @ 2026-10-18T20:28:31.179Z; DEXUSEU = https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXUSEU&cosd=2015-01-01 @ 2026-10-18T20:28:32.744Z; WALCL = https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL&cosd=2002-12-01 @ 2026-10-18T20:28:33.363Z; DGS10 = https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2015-01-01 @ 2026-10-18T20:28:33.910Z; BOGZ1FL313161110Q = https://fred.stlouisfed.org/graph/fredgraph.csv?id=BOGZ1FL313161110Q&cosd=1990-01-01 @ 2026-10-18T20:28:34.518Z; BOGZ1FL313161275Q = https://fred.stlouisfed.org/graph/fredgraph.csv?id=BOGZ1FL313161275Q&cosd=1990-01-01 @ 2026-10-18T20:28:35.115Z; fiscalFrontend = buildFiscalFrontendResponse() @ 2026-10-18T20:28:35.155Z
