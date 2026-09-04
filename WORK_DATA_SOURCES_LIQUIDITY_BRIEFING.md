# WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md

> Stand Recherche: 04.09.2026 | Status: **Quellenkatalog** (keine Live-Verdrahtung)
> Deckt die 5 Tickets: Velocity prüfen · Realzins Asien · V+π · Spillover · EM-Fokus
> Prints sind Snapshot-Werte zum Recherchedatum — Fetch immer live, nie diese Zahl hardcoden.

API-Basis FRED: `https://api.stlouisfed.org/fred/series/observations?series_id={ID}&api_key=`

---

## 0. Tote / unbrauchbare Serien (nicht fetchen)

| ID | Grund |
|----|-------|
| `MYAGM2JPM189S` / `MYAGM2JPM189N` | FRED-IFS Japan-M2 endet **Feb 2017** |
| `MABMM301JPM189S` | OECD Japan-M3 auf FRED endet **Nov 2023** |
| `MABMM301EZM189S` | OECD EZ-M3 auf FRED oft **Nov 2023** |
| beliebiges `DFII*` außer US | kein asiatisches TIPS-Äquivalent auf FRED |
| Tweet-Text | nie Nenner von V, r, π, s(z) |

Japan-M2 und EZ-M3 **direkt** BoJ / EZB, nicht über die toten FRED-Spiegel.

---

## 1. Velocity — Ticket „Formel implementieren / prüfen“

\[
V = \mathrm{NGDP}/M
\]

US liefert V fertig. EZ/JP: beide Seiten fetchen, Quotient im Code.

### 1.1 USA (C2 lebt schon teilweise)

| Größe | Serie | Frequenz | Print 04.09.2026-Recherche | Release |
|-------|-------|----------|----------------------------|---------|
| Velocity | FRED `M2V` | Q, SA | **1.415** Q2 2026 (Q1 1.413, Q4-25 1.409, Q2-25 1.395) | 26.08.2026; next **30.09.2026** |
| M2 | FRED `M2SL` + H.6 | M | Jul 2026 **23 218.0** Mrd. $; Jun **23 115.2** | H.6 25.08.2026 |
| NGDP | FRED `GDP` | Q | Zähler von `M2V` (nicht separat nötig wenn M2V da) | mit GDP |
| Real-GDP YoY | FRED `GDPC1` | Q | EMG-Input | |
| CPI YoY | FRED `CPIAUCSL` | M | EMG-Input | |

Identität FRED: `M2V = GDP / average(M2SL)` im Quartal. Peak ~**2.19** (1997), Trog ~**1.13** (2020-Q2).

EMG (bereits `excessMoneyGrowth()` in `liquidity-regime-math.ts`):

\[
\mathrm{EMG}=\Delta M_2-\Delta\mathrm{RGDP}-\pi
\]

Fetch-Fenster ≥ **20 Quartale** `M2V`/`GDP` und ≥ **24 Monate** M2/CPI — sonst bleibt EMG `null` (historischer Offset-Bug).

Stablecoin-Anteil an M2 (nur BTC-Kontext, **nicht** Researcher-V): DefiLlama ~**309.8** Mrd. $ / 23 220 ≈ **1.33 %** (03.09.2026).

### 1.2 Eurozone

| Größe | Quelle | Print |
|-------|--------|-------|
| M3 Bestand | EZB Pressemitteilung „Geldmengenentwicklung“ | Jul 2026 **17 614** Mrd. € |
| M3 YoY | dieselbe | Jul **+3.4 %** (Jun +3.3, 3M-Schnitt +3.2) |
| M2 Bestand | dieselbe Tabelle | Jul **16 436** Mrd. €, YoY +3.3 % |
| M1 | dieselbe | Jul **11 293** Mrd. €, YoY +3.1 % |
| V | Code: `NGDP_EA / M3` | keine offizielle M3V-Serie |

URL-Muster: `https://www.ecb.europa.eu/press/pr/stats/md/` (Jul-Paket 27.08.2026).
SDMX: `https://data-api.ecb.europa.eu` — BSI-M3 Outstanding. Cache `liqidx_EU__m3` 24 h.

### 1.3 Japan

| Größe | Quelle | Print |
|-------|--------|-------|
| M2 avg outstanding | BoJ Money Stock | Jul 2026 **1 297 007.4** Mrd. Yen (Jun 1 296 125) |
| M2 YoY | BoJ | Jul **+2.2 %** |
| Monetary Base avg | BoJ MB | Jul **554.926 Bio. Yen**, YoY **−13.8 %** |
| V | Code: NGDP / M2 | keine M2V auf FRED |

URL: `https://www.boj.or.jp/en/statistics/money/ms/` — Jul-PDF 12.08.2026 `ms2607.pdf`.
BoJ Time-Series Search für Historie (nicht FRED-IFS).

---

## 2. Realzins — Ticket „Quellen Asien“

\[
r^{\mathrm{US}}=\texttt{DFII10},\qquad r^{\mathrm{JP}}=i_{10}-\pi_{\mathrm{CPI}}\ \texttt{(ex\_post)},\qquad r^{\mathrm{CN}}\ \mathrm{Gewicht}\le 0.10
\]

| Region | Serie | Freq | Print | Rolle |
|--------|-------|------|-------|-------|
| US Linker | FRED `DFII10` | D | **2.42 %** am 28.08.2026 (27.: 2.34) | WACC-Analog, T½ |
| US 10y nom. | FRED `DGS10` | D | ~4.8 % Anfang Sep (Intraweek-Hoch 4.81) | Spillover-Spread |
| US BEI | FRED `T10YIE` = DGS10−DFII10 | D | |
| JP 10y | FRED `IRLTLT01JPM156N` | M | **2.670 %** Jun 2026 (Mai 2.650, Apr 2.515) | Nominal |
| JP 10y daily | MoF constant-maturity | D | der FRED-Monat hinkt | bevorzugter Live-Input |
| JP CPI | FRED `JPNCPIALLMINMEI` | M | Index; YoY selbst | Nenner Real |
| JP CPI annual | FRED `FPCPITOTLZGJPN` | J | nur Fallback, zu langsam |
| CN 10y | Markt/Bloomberg; kein robustes FRED-DFII | D | **1.69 %** um 02.09.2026 | EM-Chip |
| CN CPI | FRED `CHNCPIALLMINMEI` | M | Index → YoY | |
| IN 2y | Markt | M | Mai 2026 **6.42 %** | Briefing, nicht T½-Anker |

Overlay, **nicht** Cache-Pflicht: Nakajima natural-rate JP — short real Apr 2026 **−0.67 %**, long real **+0.51 %**, r* long Q3 **0.72 %**.

T½-Fixture (nicht hardcoden, nur Test):

```
r = 0.0242  →  ln(1.0242)≈0.02391  →  T½ = 0.693147/0.02391 ≈ 29.0 J
r = 0.08     →  T½ ≈ 9.00 J          // bitgleich Aktien-WACC 8 %
r = 0.009    →  T½ ≈ 77 J            // JP ex-post — Clip V-Faktor [0.5, 2]
```

---

## 3. Buch M / Buch F — Bestände für Index + Spillover

### 3.1 USA (schon C2-nah)

| Größe | Serie | Print / Hinweis |
|-------|-------|-----------------|
| Fed Assets | `WALCL` | H.4.1 Donnerstag |
| SOMA Bills | `WSHOBL` | Fixture Spec: 26.08.2026 = **541 995** Mio. $ |
| SOMA Notes/Bonds | `WSHOTSL` − `WSHOBL` | QE-Gate, nicht WALCL allein |
| RRP | `RRPONTSYD` | Mrd. $ |
| TGA | `WTREGEN` | DTS täglich |
| Leitzins | `DFF` | Niveau nicht scorenen, Δ 90T |
| Debt/GDP | `GFDEGDQ188S` | Stock-Anzeige |
| Marketable Bills | FiscalData MSPD / Auctions | Fixture Jul: 6988.891 − 6690.689 = **298.202** Mrd. |

FiscalData: `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/`

### 3.2 Eurozone Buch M

Quelle: EZB APP- / PEPP-Seiten, Update 04.08.2026 (Jul-Bestände).

| Programm | Bestand Ende Jun | Netto Jul | Bestand Ende Jul |
|----------|------------------|-----------|------------------|
| APP total | 2 120.466 Mrd. € | **−27.170** | **2 093.295** |
| dav. PSPP | 1 706.087 | −24.306 | 1 681.781 |
| PEPP holdings (book) | 1 319.479 | **−24.821** | **1 294.658** |
| PEPP weekly (28.08.) | — | — | 1 284.914 amortised |

URLs:
- `https://www.ecb.europa.eu/mopo/implement/app/html/index.en.html`
- `https://www.ecb.europa.eu/mopo/implement/pepp/html/index.en.html`

Reinvest APP aus seit Jul 2023, PEPP aus seit Ende 2024 — Index sieht nur z(Δ), kein Kalender-Hardcode.

Buch F EZ: EU Funding Plan H2-2026 **80 Mrd. €** Bonds + EU-Bills mittwochs = Angebot, **nie** Buch M.
Gov-Deposits Eurosystem = TGA-Analog (WFS, Cache 6 h).

### 3.3 Japan Buch M / F

| Größe | Quelle | Print |
|-------|--------|-------|
| BoJ Assets | FRED `JPNASSETS` | Aug 2026 **644.66** Bio. Yen (6 446 620 × 100 Mio.) |
| JGB in BoJ | BoJ BS | ~519 Bio.; T-Bills in BoJ **0** |
| Outright JGB-Käufe | BoJ | Aug **2 321** / Jul **2 339** Mrd. Yen |
| MoF Netto-Emission | MoF JGB/T-Bill | Buch F |

---

## 4. Spillover-Serien (Briefing-Zahlen-Events)

Event wenn \(|z|\ge 1\) der eigenen 5y-Historie — kein LLM-`high`.

| Kanal | Messung | Print-Beispiel 04.09.2026 |
|-------|---------|---------------------------|
| US→Asia Carry | `DGS10` − CN 10y | **4.81 − 1.69 = 312 bp** (äußerer Rekord ~315) |
| US→EZ | `DFII10` vs. DE 10y `IRLTLT01DEM156N` | US real 2.42 % |
| EZ→World QT | ΔAPP+ΔPEPP Jul | **−27.2 + −24.8 = −52.0** Mrd. € |
| FX | `DEXJPUS`, `DEXUSEU`, `DEXCHUS` | FRED daily |

---

## 5. EM-Fokus (Briefing-Kasten, Index-Gewicht ≤ 0.10)

| Land | Geld | Print | Fiskal/Handel |
|------|------|-------|----------------|
| CN | M2 YoY | Jul 2026 **+7.7 %** | Property/Stimulus; Exportkontrollen |
| CN | 7d RR | ~1.3–1.4 % (ING-Pfad) | |
| CN | 10y | **1.69 %** | Spread vs UST 312 bp |
| IN | 2y G-Sec | Mai **6.42 %** | Union Budget / PLI |
| KR/TW | — | — | Semi + Exportregeln (Handel-Filter) |

CN-M2: NBS/PBoC Release, nicht tote FRED-IFS.
IN: RBI DBIE + CCIL G-Sec.

---

## 6. π / Halbwertszeit — Inputs, keine neuen Serien

| Input | Quelle |
|-------|--------|
| r | §2 |
| V, V̄ | §1, Median 10y derselben Serie |
| F Rest-Stock | Capex-Cache (NGEU-Rest, IRA unspent, GX) |
| ΔM | §1 M2/M3 |
| φ | Modellparameter **0.3**, keine Marktmeinung |

\[
T_{1/2}=\frac{\ln 2}{\ln(1+\max(r,0.001))}\cdot\operatorname{clip}(\bar V/V,0.5,2)
\]

\[
\pi=0.6\cdot\mathbf{1}_{z(\Delta r)}+0.4\cdot A_{\Delta M/(\varphi F/M)}
\]

π **nicht** in LI addieren.

---

## 7. Cache-Keys und TTL

| Key | Inhalt | TTL |
|-----|--------|-----|
| `liqidx_v1__US` | WALCL/RRP/TGA/DFF/M2V/DFII10/MSPD | 6 h (H.4.1-Tag 24 h ok) |
| `liqidx_v1__EU` | APP+PEPP, M3, WFS-Deposits | APP/PEPP 24 h, WFS 6 h |
| `liqidx_v1__ASIA` | JPNASSETS, BoJ M2, JGB10, CPI | M2 monatlich, Assets wöchentlich |
| `briefing_v2__{Berlin-date}` | liest die drei Keys, schreibt nicht | 6 h / 18:00 Berlin |
| QRA-Snapshot | nur US-Frontend | bis `nextRelease` |

---

## 8. X-Bot — Allowlist, kein Score

Nur Release-Pager: Post enthält Link auf `.gov` / `boj.or.jp` / `ecb.europa.eu` / `mof.go.jp` → Cache-Key invalidieren.

| Account | Ping für |
|---------|-----------|
| `@federalreserve` | H.6, H.4.1 |
| `@NewYorkFed` | SOMA, RRP |
| `@USTreasury` | QRA, Refunding, Buybacks |
| `@ecb` | M3, APP/PEPP-Tabelle |
| `@EU_Commission` | Funding Plan / Bills |
| `@Bank_of_Japan_e` | Money Stock PDF (Muster: „Money Stock (July)“ + `ms2607.pdf`) |
| `@MOF_Japan_eng` | JGB-Auktion |
| `@RBI` | IN G-Sec / Policy |

Verboten: Post-Text → severity, π, s(z), Personen-Namen.

Beispiel (kein Score): `@Bank_of_Japan_e` 12.08.2026 „Money Stock (July) https://www.boj.or.jp/en/statistics/money/ms/ms2607.pdf“ → Refresh `liqidx_v1__ASIA`.

---

## 9. DoD Quellen

1. Kein Fetch von IDs aus §0.
2. Fixture `M2V` Q2 2026 = **1.415** (±0.001).
3. Fixture APP Jul Netto = **−27.170** Mrd. €.
4. Fixture PEPP Jul Netto = **−24.821** Mrd. €.
5. Fixture `DFII10` 28.08.2026 = **2.42**.
6. Fixture `IRLTLT01JPM156N` Jun 2026 = **2.670**.
7. Fixture Bills-MSPD Jul Diff = **298.202**.
8. `T½(0.08)` ∈ [8.99, 9.01].
9. X-Bot-Test: Tweet ohne Amts-URL ändert keinen Cache.

---

**Satz:** Zahl = FRED / EZB-HTML / BoJ-PDF / FiscalData. X = Klingel. Snapshot-Prints in dieser Datei sind Testhaken, keine Runtime-Konstanten.
