# WORK_RECESSION_SOURCES.md

> Soll zu [`server/recession.ts`](./server/recession.ts) · 05.09.2026
> Zwei Bücher, drei Regionen. Keine Ticker-Map, keine April-Essays im Scorer.

Korrektur = wie teuer/gehebelt die **Finanzmärkte** sind.
Rezession = wie nah die **Realwirtschaft** an Kontraktion ist.
Sie korrelieren über den Zinskanal, sind aber nicht derselbe Score.

---

## Brücke (warum 80 % Korrektur und 25 % Rezession gleichzeitig Sinn haben)

```
Schock (Hormuz, Zoll, Krieg)
  → Energie, Dünger, Fracht
  → CPI / Breakeven
  → 10J-Rendite ↑  und/oder Leitzins bleibt hoch
  → WACC ↑  → Multiples ↓     = Korrektur-Buch  (jetzt)
  → Capex ↓  → Wachstum ↓  → ALQ ↑  = Rezessions-Buch (nachlaufend)
```

Währungsabwertung kann Aktien-Indizes in Lokalwährung oben halten,
während die Realwirtschaft schon weich ist. Deshalb **nicht** einen
Misch-P aus Buffett und Sahm bilden.

12M-Korrektur darf hoch sein, 12M-Rezession niedrig — das ist teures
Beta bei noch festem Arbeitsmarkt. Handlung trennt die zwei:

- Korrektur hoch, Rezession niedrig → Duration/Beta kürzen, nicht gleich
  Rezessions-Portfolio (Staples-only).
- Beide hoch → defensiv + Liquidität.
- Korrektur niedrig, Rezession hoch → Value/Quality, nicht Cash-only.

Schock-Text (Hormuz) nur als **Kanal** (Energie→Zins→WACC), nicht als
dritter Score der in P eingeht.

---

## US — Serien statt Scrape/Proxy

| Slot heute | Soll-Serie | URL / ID | Hinweis |
|------------|------------|----------|--------|
| Sahm | `SAHMREALTIME` | fred/SAHMREALTIME | Wert behalten; Score = s(z) 20J, nicht nur ≥0.5 |
| Kurve | `T10Y2Y`, Zusatz `T10Y3M` | fred/T10Y2Y | Niveau + 12M-Δ |
| PMI | **nicht** Chicago als ISM | `INDPRO` YoY + `TCU` (Auslastung) oder S&P Global PMI falls lizenziert | ISM ist proprietary; FRED `NAPM` tot seit 2001 |
| Durable | `DGORDER` YoY | fred/DGORDER | bleibt |
| M2 | `M2SL` YoY | fred/M2SL | bleibt |
| Spreads | `BAA10Y` | fred/BAA10Y | bleibt |
| CSI | `UMCSENT` | fred/UMCSENT | FMP-Macro nur Fallback |
| Buffett | `DDDM01USA156NWDB` **oder** Wilshire/`WILL5000PR` / `GDP` | fred/DDDM01USA156NWDB | World-Bank jährlich, lag; besser: MarketCap/GDP selbst |
| CAPE | Shiller `ie_data.xls` | econ.yale.edu/~shiller/data | kein FRED-offiziell |
| Margin | FINRA Rule 4521 xlsx | finra.org/.../margin-statistics | Jul 2026 **1,417 Mrd. $** ≈ 1.42 T — nicht `$2026T` |
| Google | SerpApi oder raus | trends | ohne Key: available=false |
| VIX | `VIXCLS` | fred/VIXCLS | ein Sentiment-Slot |
| AD-Line | `ADVN`/`DECL` nicht zuverlässig auf FRED | Stooq/NYSE oder **streichen** | Default −2 verboten |
| CNN F&G | cnn dataviz JSON | production.dataviz.cnn.io | Crypto-F&G nur Flag `proxy` |
| AAII/PC/II | AAII CSV / CBOE daily | oder **ein** VIX-Proxy Gewicht 1 | nicht dreimal |
| NY-Fed | `RECPROUSM156N` | fred/RECPROUSM156N | **Einheit %**, kein ×10 |
| Öl-Kanal | `DCOILWTICO`, `GASREGW` | FRED | Schock-Monitor, nicht P-Summand |
| 10J / BE | `DGS10`, `T10YIE` | FRED | Brücke Korrektur↔Rezession |
| Weekly nowcast | `WEI` (Lewis-Mertens-Stock) | fred | Leading-Zusatz |

FINRA Jul-26 Debit: **1 417 225 Mio. $**. YoY vs Jul-25 1 022 548 → +38,6 %.
Score auf **YoY und vs. 5J-z**, nicht auf das Wort „overvalued“ im Meta-Tag.

---

## EU / Asien — gleiches Raster, andere Ämter

Nicht US-TGA nach Europa kopieren. Zwei Bücher, regionale Kataloge.

| Buch | US | Eurozone | JP |
|------|----|----------|----|
| ALQ / Sahm-Analog | `UNRATE` / `SAHMREALTIME` | Eurostat `une_rt_m` EA20, Schwelle 0.5 pp selbst rechnen | `LRUNTTTTJPM156S` |
| Kurve | `T10Y2Y` | `IRLTLT01EZM156N` minus 2J Bund/`IR3TIB01EZM156N` | `IRLTLT01JPM156N` |
| Aktivität | `INDPRO` | Eurostat `sts_inpr_m` / ECB SDMX | `JPNPROINDMISMEI` |
| Geld | `M2SL` | ECB `BSI.M.U2.Y.V.M30` | BoJ M2 |
| Spreads | `BAA10Y` | iBoxx/ICE EUR HY OAS oder `BAMLHE00EHYIOAS` | JGB-Corp wenn da |
| Bewertung | Buffett US, CAPE US | STOXX 600 PE (Stooxx/FMP) | TOPIX/CAPE JP |
| VIX-Analog | `VIXCLS` | `V2TX` (VSTOXX, nicht FRED-frei) | `JNVI` |

Gewicht US-Kern 0.70, EZ 0.20, JP 0.10 solange UI ein Dashboard bleibt.
Oder drei Kacheln wie Liquidity-Index.

---

## Neun Soll-Punkte — verdrahten

1. `available:false` → weder Netto noch Max. PMI-N/A darf nicht −3 sein.
2. AD live oder löschen.
3. Sentiment = VIX + max. ein Crowd-Bein (CNN *oder* VIX-Proxy, nicht AAII+PC+II+VIX).
4. `nyFedAnchorPct = RECPROUSM156N` (0.76), **nicht** ×10. Anker-Gewicht 0.30 bleibt Modellparameter.
5. Sahm/Kurve: \(s(z)\) über 20J derselben Serie (wie Fiscal-Frontend). 0.5 pp bleibt Label, nicht einziger Sprung.
6. `generateFazit` Quant + Handlung aus den zwei P. Geo/PC-Essay nur wenn Briefing-Cache `updated_at` ≤ 30 Tage, sonst Abschnitt aus.
7. FINRA-XLS, Einheit Mrd. $, YoY. `$2026T` verwerfen.
8. Slot-Name `Aktivität (IP / Auslastung)` oder N/A. Nie „ISM“ ohne ISM-Zahl.
9. Response `asOf` + `schemaVersion`. UI „Stand“ nur bei `asOf === heute`.

---

## Handlung (zwei P, ein Text)

```
WENN P_korr12 ≥ 65 UND P_rez12 < 40
  → Beta/Duration runter; kein volles Rezessions-Portfolio
WENN P_korr12 ≥ 65 UND P_rez12 ≥ 40
  → defensiv + Cash/Bills + Gold-Kanal wenn Öl-Schock-Flag
WENN P_korr12 < 50 UND P_rez12 ≥ 40
  → Konjunktur weich, Multiples nicht das Problem → Quality/Value
SONST Standard-Risiko
```

Öl-Schock-Flag: `z(Δ WTI 4w) > 1.5` aus `DCOILWTICO`, nicht Hormuz-String.
