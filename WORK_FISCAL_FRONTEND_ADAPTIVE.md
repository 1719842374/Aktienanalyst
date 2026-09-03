# WORK_FISCAL_FRONTEND_ADAPTIVE.md

> Stand: 03.09.2026 | Status: **SPEC / SOLL** — Adaptive Schicht **nicht** live
> Companion: `WORK_STABLECOIN_TBILL_GENIUS.md` (D4 Basis live), `WORK_RESEARCHER_LIQUIDITY_REGIME.md` (C2 live)
> Live-Demo: https://aktienanalyst.onrender.com/#/btc Sektion 14
> Repo: `server/stablecoin-liquidity.ts`, `server/liquidity-regime-math.ts`, `client/src/lib/btcAnalysis.ts`

---

## 0. Ziel und Nicht-Ziel

**Ziel:** Scoring-Logik für den Kanal

`Stablecoin-MCap → T-Bill-Nachfrage` **gegen** `Treasury-Nettoangebot (Bills)` **plus** `Fed (QT/QE/RMP + Effektivzins)` **plus** `TGA-Cash`

Akteur ist die **Behörde**, nicht die Person:

| Buch | Behörde | Instrument | Vorzeichen Liquidität |
|------|---------|------------|------------------------|
| Fiskal Angebot | Treasury Fiscal Service / QRA-Desk | Netto-**Emission** T-Bills | mehr Bills → Front-End locker, Stable-Bid wird absorbiert |
| Fiskal Nachfrage | dieselbe Behörde, Buyback-Desk | Rückkauf Coupons 10–30y | Duration-Easing, **kein** Bill-Sog |
| Fiskal Cash | TGA (`WTREGEN` / DTS) | Staats-Cash bei der Fed | TGA ↑ = Liquidität raus |
| Geldpolitik | Fed | WALCL, SOMA Bills vs Notes/Bonds, DFF, RRP | QT / RMP / QE + Zinsänderung |

**Nicht-Ziel:**

- Score aus FOMC-/Treasury-**Presse**, Reden, „Bessent bullish“
- `geniusActScore = 1.2` als Impact
- Kalenderfenster `2026-09-09`…`2026-11-04` als Classifier
- GIS kippen, nur weil eine Headline da ist

**Satz Ist:** Live cached das Repo nur veröffentlichte Zeitreihen beim **Request**. Eine Ankündigung allein ändert den Score nicht. Die invertierte `s(z)`-Schicht ist **nicht verdrahtet**.

---

## 1. Ist vs Soll (eine Tabelle)

| Ereignis | Live-Repo jetzt | Nach dieser Spec |
|----------|-----------------|------------------|
| TGA-Stand (DTS / `WTREGEN`) | C2 FRED beim GET `/api/researcher/liquidity`, Cache **6 h** (`macro_v2__US`) | derselbe Abruf + `z(ΔTGA_4w)` in `S_F*` |
| Fed-Bilanz / RRP (H.4.1 Do) | C2 `WALCL` `RRPONTSYD` | `z(ΔNL_13w)`, SOMA Bills vs Notes **getrennt** |
| Leitzins-Beschluss | BTC-GIS: Niveau `FFR ≧ 5` → −1, `FFR < 3` → +1 | erst `DFF`, `Δi_90`, `s(-z_Δi)` |
| FOMC-/Treasury-Presse | wird nicht gelesen | bleibt ungelesen |
| GENIUS / Buyback-Rede | Sektion 14: Literal `1.2`; `BESSENT_WINDOW` Kalender | Score nur `D_30`, `N^b`, durchgeführte Ops |
| QRA-PDF | nicht angebunden | Quartals-JSON + Identität, **kein** Score-Input |
| Cron 22:00 ET | **fehlt** | optional, Request-Cache reicht für v1 |
| Webhook treasury.gov / federalreserve.gov | **fehlt** | bewusst nicht |

---

## 2. Zahlen, Daten, Fakten (Stand Prüfung 03.09.2026)

### 2.1 Stablecoin-Kanal (D4, live DefiLlama)

Quelle: `https://stablecoins.llama.fi/stablecoins?includePrices=true`, `pegType=peggedUSD`.

| Größe | Wert | Typ |
|-------|------|-----|
| Total MCap `M_t` | 309.99 Mrd. $ | Live-API |
| USDT | 183.27 Mrd. $ | Live-API |
| USDC | 73.69 Mrd. $ | Live-API |
| Constituents | 335 | Live-API |
| `M_{t-30}` | 306.41 Mrd. $ | Live-API |
| `ΔM_30` | 3.58 Mrd. $ | berechnet |
| `m = 0.75·0.70 + 0.55·0.30` | 0.69 | **hardcodiert** |
| `D_30 = ΔM_30 · m` | 2.47 Mrd. $ | Hybrid |
| `geniusActScore` | 1.2 / 1.5 | **hardcodiert**, `asOf=2026-08-24` |
| Tether-Quote / Circle-Quote | 75 % / 55 % | **hardcodiert** |

Bestand nur USDT+USDC mit denselben Quoten:

```
B_hat = 183.27·0.75 + 73.69·0.55
      = 137.4525 + 40.5295
      = 178.0 Mrd. $
```

### 2.2 MSPD Marketable Bills (Fiscal Data)

Endpoint:
`GET https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/mspd/mspd_table_1`
Filter **beide**: `security_class_desc=Bills` **und** `security_type_desc=Marketable`.
Filter nur `security_type_desc:eq:Bills` → **0 Zeilen**.

| record_date | total_mil_amt | Mrd. $ |
|-------------|---------------|--------|
| 2026-07-31 | 6 988 890.9629 | 6 988.891 |
| 2026-06-30 | 6 690 688.6431 | 6 690.689 |

```
N^b_Jul = 6988.891 − 6690.689 = 298.202 Mrd. $
```

Juli-Nettoangebot Bills ≈ **+298 Mrd. $**. `D_30 = 2.47` ist zwei Größenordnungen kleiner.

Anteil Bills an Total Marketable 31.07.2026:

```
6988.891 / 31455.078 ≈ 0.222  →  22.2 %
```

(Total Marketable MSPD 31.07.2026: 31 455.078 Mrd. $.)

### 2.3 QRA Q3 2026 (Dokument, kein Live)

Quelle: Quarterly Refunding Documents, Release 03./05.08.2026.
Nächste QRA: **04.11.2026**.

| Feld | Mrd. $ |
|------|--------|
| Net Marketable Borrowing `B_net` | 739 |
| Net Coupon Issuance `C` | 375 |
| Assumed Buybacks `K` | 45 |
| Implied Change in Bills `ΔB` | 409 |
| TGA-Annahme Ende Jun | 919 |
| TGA-Annahme Ende Sep | 950 |
| TGA-Annahme Ende Dez | 850 |

Identität (Pflichtgate ±1 Mrd.):

```
ΔB = B_net − C + K
409 = 739 − 375 + 45
739 − 375 = 364
364 + 45 = 409
```

Linearisiert auf 30 Tage (nur Soll-Spalte):

```
N^{b,QRA}_30 = 409 · (30 / 91)
30 / 91 ≈ 0.32967
409 · 0.32967 ≈ 134.8 Mrd. $
```

TGA-Soll Jun→Sep: `950 − 919 = +31` Mrd. $ (Liquidität raus laut Plan).

Live-TGA DTS 01.09.2026 Opening Balance TGA: **1 023.554 Mrd. $** — nicht 950.

### 2.4 H.4.1 / FRED SOMA (26.08.2026)

| Serie | FRED-ID | Wert |
|-------|---------|------|
| SOMA UST total | `WSHOTSL` | 4 546.169 Mrd. $ (4 546 169 Mio.) |
| SOMA Bills | `WSHOBL` | 541.995 Mrd. $ (541 995 Mio.) |
| SOMA Notes+Bonds (Diff) | `WSHOTSL − WSHOBL` | 4 004.174 Mrd. $ |
| Bills WoW | `WSHOBL` | +4.243 Mrd. $ (19.08. 537.752 → 26.08. 541.995) |
| Bills YoY | H.4.1 Text | ca. +346 Mrd. $ |
| Notes/Bonds nominal Woche | H.4.1 | **0** |
| Reserve Bank Credit | H.4.1 | ca. 6 695 Mrd. $ |

`WSHOBL` 26.08.2026 = **541995** (Mio. $) — Fixture.

Das ist **RMP / Bill-Reinvestment**, kein klassisches QE (Notes/Bonds-Aufbau).

### 2.5 Zins

| Serie | Stand | Quelle |
|-------|-------|--------|
| `DFF` Effektivzins | 3.63 % (01.09.2026) | FRED |
| BTC-GIS Macro heute | Schwelle Niveau 5 % / 3 % | `btcAnalysis.ts` |

### 2.6 Buyback-Desk (Behörde, nicht Person)

Angekündigt 19.08.2026: Long-End Liquidity Support Buybacks ab **09.09.2026**, Cap ≥ **4 Mrd. $**/Op., Fenster bis **04.11.2026**.

Live-Code: `BESSENT_WINDOW = { from: "2026-09-09", to: "2026-11-04", capBn: 4 }` in `liquidity-regime-math.ts`.
Am 03.09.2026: `buybackCapLongBn` = `null`, `bessentPutActive = false`.

Soll: Cap/Volumen aus **Buybacks-Operations-API**, nicht aus diesem Literal.

### 2.7 FrontEndImpulse Größenordnung (Juli, illustrativ)

```
FE_Jul ≈ D_30 + F^{Fed,b} − N^b_Jul
      ≈ 2.5 + 20 − 298
      = 22.5 − 298
      = −275.5 Mrd. $
```

Stable-Kanal gegen Treasury-Angebot **irrelevant**. Residual = Angebot.

---

## 3. Ankündigung vs. Zahl (verbindlich)

| Input | Score? | Begründung |
|-------|--------|------------|
| FOMC-Statement-Text | nein | Sentiment |
| `DFF` nach Settlement | ja | Zeitreihe |
| QRA-Satz „TGA auf 850“ | nein (nur Soll-Spalte) | Dokument |
| `WTREGEN` / DTS Opening | ja | Zeitreihe |
| Pressemitteilung Buyback-Cap | nein | Ankündigung |
| akzeptiertes Volumen letzter Op. | ja | Operations-API |
| GENIUS-Rede | nein | Person/News |
| DefiLlama `ΔM_30` | ja | Zeitreihe |

Beispiel Zins, warum Headlines nicht „sofort“ kippen:

```
DFF_t     = 3.63 %
DFF_neu   = 3.38 %     (hypothetisches Settlement −25 bp)
Δi_1d    = 3.38 − 3.63 = −0.25 pp
```

Der Score nutzt `Δi_90 = DFF_t − DFF_{t-90}`, nicht `Δi_1d`.
Wenn `Δi_90` schon ≈ −25 bp (eingepreist):

```
z_Δi ≈ 0  ⇒  s(-z) ≈ 50
```

Nur wenn `Δi_90` weit außerhalb der 5y-Verteilung liegt, läuft `s` Richtung 80/20.

---

## 4. Adaptive Formel (Soll — invertierte Logik)

Methodik-Konstanten (erlaubt): Fensterspanne `H`, Clip `|z|=2`, GIS-Gewicht `0.15`, QRA-Toleranz `1` Mrd., `ε = 1e-9`.

Keine Markt-Schwellen: kein `−50 bp ⇒ 80`, kein `QE ⇔ Δ>40`, kein Score `62` im Fenster.

### 4.1 Kern

```
μ_t = (1/H) Σ_{k=1..H} x_{t-k}
σ_t = sqrt( 1/(H-1) Σ (x_{t-k} − μ_t)^2 )
z_t = (x_t − μ_t) / (σ_t + ε)
s(z) = 50 + 50 * clip(z/2, −1, 1)
```

Rechenweg `s`:

```
z = 0  →  50 + 50*0     = 50
z = +2 →  50 + 50*1     = 100
z = −2 →  50 + 50*(-1)  = 0
z = +1 →  50 + 50*0.5   = 75
```

`H`:

| Serie | H | H_min |
|-------|---|-------|
| `Δi_90` (`DFF`) | 5 Jahre täglich | 250 Punkte |
| `FE` / `N^b` (MSPD) | 24 Monate | 12 Punkte |
| Buybacks `K_30` | 24 Monate | 8 Ops |
| `ΔNL_13w` | 104 Wochen | 26 Punkte |

`n < H_min` → `available: false`, Slot-Anzeige `50` + Flag. **Kein** Regime raten.

Inverse-Vol-Mix zweier Slots `a,b`:

```
S = (σ_a^{-1} S_a + σ_b^{-1} S_b) / (σ_a^{-1} + σ_b^{-1})
```

Prior-Gewichte `0.45 / 0.35 / 0.20` nur bis 12 Monate Live-Varianz von `S_M, S_F*, S_D`.

### 4.2 Ticket A — NetBillSupply

Monat (Historie + z):

```
N^b_Δm = O^b_m − O^b_{m-1}
```

30-Tage Live (Auktionen):

```
N^b_30 = G^b_30 − M^b_30
```

- `G`: Summe Offering aller Bill/CMB mit `auction_date ∈ [t-30, t]`
- `M`: fällige Bills im Fenster (`maturity_date` / `est_pub_held_mat_by_type_amt`)

Fallback:

```
N^b_30 ≈ N^b_Δm * (30 / d_m)
```

Kennzeichnung `scaled-from-monthly`. Nie QRA als Live.

QRA nur Anker:

```
N^{b,QRA}_30 = ΔB_implied * 30/91
```

UI: Live vs. 134.8. Identität prüft Snapshot, fließt nicht in `s(z)`.

### 4.3 Ticket B — QRA-JSON + Buybacks ohne Kalender-Score

`server/qra-snapshot.ts` (Soll):

```ts
export const QRA_SNAPSHOT = {
  asOf: "2026-08-05",
  nextRelease: "2026-11-04",
  quarter: "2026Q3",
  sourceUrl: "https://home.treasury.gov/policy-issues/financing-the-government/quarterly-refunding/most-recent-quarterly-refunding-documents",
  kennzeichnung: "QRA-Tabelle, keine Live-Messung",
  netMarketableBorrowingBn: 739,
  netCouponIssuanceBn: 375,
  assumedBuybacksBn: 45,
  impliedBillChangeBn: 409,
  tgaEndJunBn: 919,
  tgaEndSepBn: 950,
  tgaEndDecBn: 850,
  couponSizesUnchanged: true,
} as const;

export function qraIdentityHolds(s = QRA_SNAPSHOT, tol = 1): boolean {
  const implied = s.netMarketableBorrowingBn - s.netCouponIssuanceBn + s.assumedBuybacksBn;
  return Math.abs(implied - s.impliedBillChangeBn) <= tol;
}
```

LLM **nur** PDF/HTML → dieses Schema + Gate. Personennamen ignorieren. Fail → altes JSON, Flag `stale`.

Buybacks adaptiv (Operations-API, Sektor 10–30y, 24 Monate):

```
1_desk = 1{d_last ≤ 14} * 1{K_30 > median(K_30^{(h)})}
x^D_t = K_30
S_D   = s(z_K)
```

`BESSENT_WINDOW` wird Display-Hint („letzte Veröffentlichung Cap=4 ab 09.09.“), **kein** Input von `classifyPolicy` für `S`.

### 4.4 Ticket C — FrontEndImpulse

```
FE_30 = D_30 + F^{Fed,b}_30 − N^b_30
F^{Fed,b}_30 = WSHOBL_t − WSHOBL_{t-4w}   // ~28 Tage, kennzeichnen
```

Ohne `N^b` → `FE = null` (nicht `2.47 − 0`).

```
S_F  = s(z_FE)                         // 24 MSPD-Monate FE_Δm
S_F* = (σ_FE^{-1} s(z_FE) + σ_TGA^{-1} s(-z_ΔTGA4w))
       / (σ_FE^{-1} + σ_TGA^{-1})
```

Minus vor `z_ΔTGA`: TGA-Anstieg = Liquidität raus.

GENIUS:

```
L_GENIUS ∈ {0,1}     // in Kraft seit 07/2025 → 1
```

Wirkung nur über `D_30` in `FE`. `1.2` entfällt.

### 4.5 Geldpolitik `S_M`

| x | Serie | Richtung |
|---|-------|----------|
| `ΔNL_13w` | `WALCL − RRPONTSYD − WTREGEN` | plus = locker |
| `Δi_90` | `DFF_t − DFF_{t-90}` | minus = locker → `s(-z)` |
| `ΔB^n_13w` | `WSHOTSL − WSHOBL` | plus = Duration-QE |

```
S_M = (σ_NL^{-1} s(z_NL) + σ_i^{-1} s(-z_Δi) + σ_n^{-1} s(z_n))
      / (σ_NL^{-1} + σ_i^{-1} + σ_n^{-1})
```

Labels (Anzeige, nicht Score-Basis):

```
QE  ⇔  z(ΔB^n_13w) > 1.5  ∧  ΔB^n_13w > 0
RMP ⇔  z(ΔWSHOBL_13w) > 1.5  ∧  z(ΔB^n_13w) ≤ 0.5
```

SOMA-Bills +346 Mrd. YoY darf **nicht** QE heißen. Schwelle `40` Mrd. entfällt.

### 4.6 Gesamt + GIS

```
S = (σ_M^{-1} S_M + σ_F^{-1} S_F* + σ_D^{-1} S_D)
    / (σ_M^{-1} + σ_F^{-1} + σ_D^{-1})

score_MacroFiscal = clip( (S − 50) / 25, −1, 1 )
```

```
S=75   →  25/25 = +1.0
S=62.5 →  12.5/25 = +0.5
S=50   →  0
S=25   →  −1.0
```

Gewicht des Slots bleibt **0.15**. GWS / Monte Carlo unverändert.
Altes `FFR ≧ 5` in `btcAnalysis.ts` wird erst ersetzt, wenn `FE.available === true`.

---

## 5. Betroffene Dateien und Verknüpfungen

### 5.1 Ist (nicht zerlegen)

| Datei | Rolle live |
|-------|------------|
| `server/stablecoin-liquidity.ts` | DefiLlama + `RULE_BASED_POLICY_CONSTANTS` + `D_30` |
| `server/btc-routes.ts` | `GET /api/analyze-btc/stablecoin-liquidity` (5 min RAM + Disk `stablecoin_liquidity__GENIUS`); `GET /api/analyze-btc/macro-history` (`DFII10`, `M2SL`) |
| `client/src/components/btc/StablecoinLiquidityPanel.tsx` | Sektion 14 UI, Rule-based-Badges |
| `client/src/pages/BTCDashboard.tsx` | bindet Panel additiv, GIS aus `analyzeBTC()` |
| `client/src/lib/btcAnalysis.ts` | GIS-Indikator `Macro (Fed/M2)`, Gewicht 0.15, FFR-Niveau |
| `server/liquidity-regime.ts` | FRED-Fetch C2, 30-Monats-Fenster |
| `server/liquidity-regime-math.ts` | `NL`, `plumbingScore`, `classifyPolicy`, **`BESSENT_WINDOW`** |
| `client/src/components/researcher/LiquidityPanel.tsx` | Researcher C2 UI, Label `Treasury-Twist (Bessent)` |
| `server/disk-cache.ts` | `diskResearcherGet/Set` |
| `script/test-liquidity-regime.ts` | C2 + Bessent-Fenster-Fixtures |
| `WORK_STABLECOIN_TBILL_GENIUS.md` | D4 Spec (Kopf „adaptiv“, Code = Basis) |
| `WORK_RESEARCHER_LIQUIDITY_REGIME.md` | C2 Spec |

Datenfluss Ist:

```
Browser /#/btc
  → StablecoinLiquidityPanel
      → GET /api/analyze-btc/stablecoin-liquidity
          → fetchStablecoinMarketSnapshot() DefiLlama
          → estimateTBillDemand() × hartes m=0.69
          → genius.score = 1.2
  → analyzeBTC() (Client)
      → GET /api/analyze-btc/macro-history   (DFII10, M2)
      → FFR/DXY/ETF → GIS
      → KEIN genius, KEIN NL, KEIN N^b

Browser /#/researcher Liquidity
  → GET /api/researcher/liquidity
      → WALCL/RRP/TGA/M2 → computeLiquidityMetrics()
      → classifyPolicy(BESSENT_WINDOW Kalender)
      → NICHT in BTC-GIS
```

### 5.2 Soll (additiv, keine bestehenden Routen brechen)

| Datei | Aktion |
|-------|--------|
| `server/fiscal-frontend-math.ts` | **neu** reine Funktionen: `zScore`, `sOfZ`, `netBillSupplyFromStock`, `frontEndImpulse`, `inverseVolMix`, `macroFiscalGis`, `qraIdentityHolds` |
| `server/fiscal-frontend.ts` | **neu** Fetch: MSPD Bills, Auctions, `WSHOBL`/`WSHOTSL`/`DFF`, Buybacks-Ops, DTS TGA; baut Historie + Cache |
| `server/qra-snapshot.ts` | **neu** Quartals-JSON + Identität |
| `script/test-fiscal-frontend.ts` | **neu** Fixtures Abschnitt 8 |
| `server/btc-routes.ts` | additiv `GET /api/analyze-btc/fiscal-frontend` **oder** Response von `stablecoin-liquidity` um `netBillSupply`, `frontEndImpulse`, `qra`, `adaptiveScore` erweitern |
| `server/stablecoin-liquidity.ts` | `genius` → `{ legal: 1, rulemakingNote }`; `D_30` bleibt; Quoten vorerst Policy + Badge |
| `server/liquidity-regime-math.ts` | `classifyPolicy` Twin: Desk-Flag aus Ops; `BESSENT_WINDOW` nur Hint; QE über `z(ΔB^n)` sobald Historie da |
| `server/liquidity-regime.ts` | Fetch-Fenster `DFF` 5y, `WSHOBL`/`WSHOTSL` 2y (heute nur 30 Monate WALCL-Set) |
| `client/.../StablecoinLiquidityPanel.tsx` | Karten `D_30`, `N^b_30`, `FE_30`, QRA-Soll, `S` + `available`-Flags |
| `client/src/lib/btcAnalysis.ts` | Macro-Slot **erst** ersetzen wenn `FE.available` | nicht in demselben PR wie Fetch |
| `WORK.md` / `WORK_IST_VS_SOLL.md` | Index + Ampel |

Nicht anfassen in diesem Ticket: Miner Sektion 13, Scoring-Gates Aktien, inverted DCF, News-Sentiment, Portfolio F.2.

---

## 6. APIs und Cache-Konfiguration

| Kanal | URL / Serie | TTL Soll | Cache-Key |
|-------|-------------|----------|-----------|
| Stables | `https://stablecoins.llama.fi/stablecoins?includePrices=true` | 5 min RAM + Disk (Ist) | `stablecoin_liquidity__GENIUS` |
| MSPD Bills | `.../v1/debt/mspd/mspd_table_1?filter=security_class_desc:eq:Bills` + Marketable | 24 h | `fiscal__mspd_bills` |
| Auctions | `.../v1/accounting/od/auctions_query` | 12 h | `fiscal__auctions_bills_30d` |
| DTS TGA | `.../v1/accounting/dts/operating_cash_balance` | 12 h | `fiscal__dts_tga` |
| TGA Woche | FRED `WTREGEN` | 6 h (Ist C2) | `macro_v2__US` |
| SOMA Bills | FRED `WSHOBL` csv `fredgraph.csv?id=WSHOBL` | 6 h nach Do | `fiscal__wshobl` |
| SOMA UST | FRED `WSHOTSL` | 6 h | `fiscal__wshotsl` |
| NL | `WALCL`, `RRPONTSYD`, `WTREGEN` | 6 h Ist | `macro_v2__US` |
| Zins | FRED `DFF` (5y `cosd`) | 12 h | `fiscal__dff_5y` |
| Buybacks | Fiscal Data Buybacks Operations | 12 h | `fiscal__buybacks_ops` |
| QRA JSON | Datei + `nextRelease` | bis 04.11.2026 | `fiscal__qra_2026Q3` |

FRED-Pattern wie `liquidity-regime.ts` / `btc-macro.ts`:

```
https://fred.stlouisfed.org/graph/fredgraph.csv?id=WSHOBL&cosd=YYYY-MM-DD
```

Kein API-Key. Timeout 15 s. HTML/`<!DOCTYPE` → leere Serie, `available:false`.

Fiscal Data: Query-Parameter `page[size]` URL-encoden (`page%5Bsize%5D`). Ohne Quotes scheitert curl an `[` `]`.

Env: keine neuen Keys. OpenRouter nur optionaler QRA-Extrakt (`OPENROUTER_API_KEY` existiert schon).

---

## 7. Frontend — Sektion 14 Soll-Layout

Bestehende MiniCards behalten (MCap live + Rule-based-Badge).
Neu darunter, nur wenn Endpoint liefert:

```
Netto Bill-Angebot (30T / Monat)     N^b          Quelle MSPD|Auctions|scaled
Fed SOMA-Bills Δ ~28T                F^{Fed,b}    WSHOBL
Front-End-Impuls                     FE_30        oder „n/v“
Adaptive Note S / S_M / S_F* / S_D   0–100        available-Flags
QRA-Anker                            Implied 409  Stand 2026-08-05, nicht Live
GENIUS Legal                         L=1          kein 1.2
Desk-Flag                            1_desk       aus Ops, nicht aus Kalender
```

Gelbe Badges bleiben überall, wo Policy/QRA/skaliert. Rote Box bei `available:false` — keine interpolierte FE.

Researcher-LiquidityPanel: Label von „Treasury-Twist (Bessent)“ → „Treasury Buyback-Desk (Ops-API)“ sobald Flag aus Ops kommt. Kalenderhint klein darunter bis 04.11.2026.

---

## 8. Tests / DoD

`bun script/test-fiscal-frontend.ts`

1. `6988.891 − 6690.689 = 298.202`
2. `739 − 375 + 45 = 409` und `qraIdentityHolds() === true`
3. `409 * 30/91` ∈ `[134.7, 134.9]`
4. `s(0)=50`, `s(2)=100`, `s(-2)=0`, `s(1)=75`
5. `clip((75-50)/25) = 1`, `clip((62.5-50)/25) = 0.5`
6. `frontEndImpulse({ d30: 2.47, fedBills: null, netSupply: null }).available === false`
7. `frontEndImpulse({ d30: 2.5, fedBills: 20, netSupply: 298 }) ≈ −275.5`
8. `WSHOBL` Fixture-Kommentar 2026-08-26 = 541995 Mio.
9. Score ändert sich **nicht**, nur weil `asOf` von `2026-09-08` auf `2026-09-09` springt (ohne Ops-Input)
10. Bestehende `script/test-liquidity-regime.ts` bleibt grün (Kalender-Tests C2 v1 unangetastet, bis Twin existiert)

GIS-DoD (zweiter PR): Overlay-Betrag `∈ [-1,1]`, Gewicht `0.15`, GWS/MC bitgleich.

---

## 9. Implementierungsreihenfolge

| Step | Inhalt | GIS anfassen? |
|------|--------|----------------|
| 0 | Diese WORK + Index | nein |
| 1 | `fiscal-frontend-math.ts` + Tests (rein, keine API) | nein |
| 2 | MSPD + `WSHOBL` Fetch + `N^b` + `FE` Route | nein |
| 3 | Panel-Karten `N^b` / `FE` / QRA-Soll | nein |
| 4 | `DFF` 5y + `S_M` + Buybacks-Ops `S_D` | nein |
| 5 | `S` anzeigen in Sektion 14 | nein |
| 6 | `btcAnalysis.ts` Macro-Slot nur bei `FE.available` | ja, klein |
| 7 | Optional Cron / QRA-LLM | nein |

C2 `BESSENT_WINDOW` erst in Step 4 entkoppeln, nicht vorher — sonst werden bestehende Fixtures rot.

---

## 10. Explizit nicht automatisiert

- Fed-/Treasury-News-URLs
- Webhooks
- Personennamen im Score
- `geniusActScore`-Drift per LLM
- QE aus steigendem `WALCL` ohne Split Bills vs Notes

Request-Cache (Ist) darf v1 bleiben: Daten aktualisieren sich, **wenn** die Route getroffen wird. Cron ist Komfort, keine Voraussetzung für Korrektheit.

---

**Ende der Spec.** Alleinige Arbeitsgrundlage für NetBillSupply + QRA-Anker + FrontEndImpulse + adaptives `s(z)`. D4-Live-MCaps und C2-FRED bleiben die Rohquellen.
