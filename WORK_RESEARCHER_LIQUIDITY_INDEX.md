# WORK_RESEARCHER_LIQUIDITY_INDEX.md

> Stand: 04.09.2026 | Status: **SPEC** — Index nicht live
> Ort: Researcher → Tab *Country Macro Pulse* → Widget statt nur US-C2
> Companion: `WORK_RESEARCHER_LIQUIDITY_REGIME.md` (Ist US), `WORK_FISCAL_FRONTEND_ADAPTIVE.md` (US-Bill-Detail)

---

## 0. Was der User will

Ein **Liquidity Index** im Researcher für **USA, Europa, Asien**.

- Gleiche Formel in allen Regionen.
- Werte kommen aus Zeitreihen + eigener Historie (`s(z)`), nicht aus Kalender, Personen, GENIUS, News.
- GENIUS/T-Bill-Stablecoin bleibt BTC-Sektion 14. Hier geht es um **regionales Zentralbank- + Fiskal-Plumbing**.

Ist heute: `LiquidityPanel` ignoriert die Region, ruft immer `/api/researcher/liquidity` (US-FRED). EU/ASIA sehen denselben US-Score.

---

## 1. Index-Definition (eine Formel, drei Kataloge)

Vier Kanäle, alle optional. Fehlt eine Serie → Slot `available:false`, Mix nur über die restlichen.

| Kanal | Ökonomie | x_t (Rohimpuls) | Vorzeichen locker |
|-------|-----------|-----------------|-------------------|
| A Plumbing | CB-Bilanz minus Absorptionsfazilität minus Gov-Cash bei der CB | `Δ` über ~13 Wochen bzw. 3 Monate | plus |
| B Zins | Effektiv- oder Einlagesatz | `Δi_90` | **minus** (Senkung = locker) |
| C Geldmenge | M2 oder M3 YoY minus Trend der eigenen Serie | `z(M_yoy)` | plus |
| D Fiskal-Angebot | Netto kurzlaufende Staatsemission, falls Serie existiert | `Δ` Bestand Bills/Bills-Äquivalent | **minus** (mehr Angebot = lockerer Front-End / Score runter für „knapp“) |

Kanal D ist in EU/ASIA oft dünn. Dann läuft der Index auf A+B+C. Das ist adaptiv, kein Fake-US-TGA.

Kern unverändert:

```
μ, σ aus rollender Historie H derselben Serie
z = (x − μ) / (σ + 1e-9)
s(z) = 50 + 50 * clip(z/2, −1, 1)
```

```
LI = Σ_k w_k s_k    /    Σ_k w_k
w_k = 1/σ_k     falls available
w_k = 0          sonst
```

Prior, nur bis genug Varianz da ist: A 0.40, B 0.25, C 0.20, D 0.15.

Labels (Anzeige, nicht Score):

```
expansiv     LI ≥ 70
neutral      40 ≤ LI < 70
restriktiv   LI < 40
```

QT/QE/RMP werden **gefunden**, nicht datiert:

```
QT_like   ⇔  z(ΔAssets) < −1.0
QE_like   ⇔  z(ΔAssets) > +1.5  und ΔAssets > 0
RMP_like  ⇔  (US) z(ΔSOMA_Bills) > 1.5 und z(ΔSOMA_Notes) ≤ 0.5
```

Kein `QT_END = 2025-12-01`, kein `BESSENT_WINDOW`.

---

## 2. Serienkatalog (Konfiguration, nicht Meinung)

Nur FRED-CSV wie C2 (`fredgraph.csv?id=`). Einheiten in der Tabelle, Scoring immer auf **Veränderung oder YoY**, nie auf das Niveau in Heimatwährung — sonst ist Japan (100 Mio. Yen) nicht mit der Fed vergleichbar.

### 2.1 USA

| Kanal | Serie | ID | Einheit | x_t |
|-------|-------|----|---------|-----|
| A Assets | Fed total assets | `WALCL` | Mio. $ | `Δ_13w` in Mrd. |
| A Drain | ON RRP | `RRPONTSYD` | Mrd. $ | in `NL` |
| A GovCash | TGA | `WTREGEN` | Mio. $ | in `NL`; extra `z(−ΔTGA_4w)` |
| A Net | | | | `NL = WALCL_bn − RRP − TGA` |
| B | Effektivzins | `DFF` | % | `Δ_90d` |
| C | M2 | `M2SL` | Mrd. $ | YoY % |
| D optional | SOMA Bills | `WSHOBL` | Mio. $ | `Δ_4w` |
| D optional | Marketable Bills | MSPD Table 1 Bills | Mio. $ | `Δ_1m` |

Stand geprüft 03./04.09.2026: `DFF` 3.63 %, `WSHOBL` 26.08. 541995 Mio. $, MSPD Bills 31.07. 6988.891 Mrd. $, Δ Juli **+298.202** Mrd. $.

C2 bleibt US-Unterblock. `LI_US` darf C2-Plumbing als Kanal A wiederverwenden.

### 2.2 Europa (Eurozone, nicht „EU-27 Fiskal“)

| Kanal | Serie | ID / Quelle | Hinweis |
|-------|-------|-------------|--------|
| A Assets | Eurosystem total assets | FRED `ECBASSETS` falls live, sonst ECB SDW weekly financial statement | QT = APP/PEPP-Runoff zeigt sich als `ΔAssets < 0` |
| A Drain | Deposit facility Bestand | ECB WFS liability 2.2 | Analog RRP: Liquidität geparkt |
| A GovCash | Central-gov deposits at Eurosystem | ECB WFS / SDW | Analog TGA |
| B | Deposit facility rate | `ECBDFR` | `Δ_90d`, nicht das Niveau |
| C | M3 YoY | `MABMM301EZM189S` oder ECB MD | Juli 2026 M3 YoY **3.4 %**, Level **17 614** Mrd. € |
| D | Netto Bund/OATs Bills wo API stabil | erst v2 | bis dahin `available:false` |

Fakten EZB-Umfeld 2026 (Anzeige, nicht Schwelle): Eurosystem-Assets aus Peak ~8.8 Bio. € (2022) Richtung ~6.1–6.3 Bio. €; Excess Liquidity Ende 2025 ca. 2.46 Bio. €. Index sieht nur `z(Δ)`, nicht „wir sind im QT weil 2022“.

### 2.3 Asien (Anker Japan; China nur Geldmenge)

Researcher-Tab ASIA = **Yen-Block + optional CN M2**. Nicht Fed-TGA umetikettieren.

| Kanal | Serie | ID | Stand |
|-------|-------|----|-------|
| A Assets | BoJ total assets | `JPNASSETS` | Aug 2026: **6 446 620** × 100 Mio. Yen = 644.66 Bio. Yen |
| B | BoJ policy / uncollateralized ON | `IRSTCI01JPM156N` oder BoJ target | `Δ_90d` |
| C JP | Japan M2 YoY | `MYAGM2JPM189S` / `MABMM201JPM189S` | |
| C CN optional | China M2 YoY | `MYAGM2CNM189S` | nur zweiter Chip, Gewicht ≤ 0.10 |
| D | JGB Bills / BoJ JGB holdings Δ | v2 | |

`JPNASSETS` Einheit **100 Millionen Yen**. Im Fetch: `assetsYenTn = value / 10000` (644.66). Scoring auf `Δ`/`z`, nie Rohlevel gegen `WALCL` mischen.

---

## 3. Adaptive Entdeckung — was nicht mehr im Code steht

| Hardcode Ist | Ersatz |
|--------------|--------|
| `QT_END = 2025-12-01` | `z(ΔAssets)` |
| `BESSENT_WINDOW` 09.09.–04.11. | US-only Desk-Volumen in Fiscal-Frontend; **nicht** im regionalen LI |
| `policyScore` 25/55/90 | entfällt im LI |
| `geniusActScore = 1.2` | nicht im Researcher-Index |
| `FFR > 5 ⇒ −1` | `s(-z_Δi)` |
| EU = US-Score | eigener Katalog |
| ASIA = US-Score | `JPNASSETS` + JP-Zins + M2 |

Erlaubt als Konstante: `H`, Clip `|z|=2`, Prior-Gewichte, `H_min`, Region→Serien-Map.

---

## 4. Ist Researcher vs Soll Widget

```
Ist  LiquidityPanel()
     GET /api/researcher/liquidity          // immer US
     regimeScore C2, Label Bessent

Soll LiquidityIndexPanel({ region })
     GET /api/researcher/liquidity?region=US|EU|ASIA
     LI, Slots A–D, available-Maske, Quellenzeile
```

`client/src/pages/Researcher.tsx`: Region-State existiert schon. Panel bekommt `region`.

`MacroPanel`:

```tsx
<LiquidityIndexPanel region={region} />
```

Heute übergibt MacroPanel die Region nicht.

Cache-Key: `liqidx_v1__{region}`, TTL 6 h, analog C2.

---

## 5. Dateien

| Datei | Änderung |
|-------|----------|
| `server/liquidity-index-math.ts` | **neu** `zScore`, `sOfZ`, `mixInverseVol`, `labelFromLi` |
| `server/liquidity-index-catalog.ts` | **neu** `CATALOG[region]` Serien-IDs + Einheit + sign |
| `server/liquidity-index.ts` | **neu** Fetch FRED je Katalog, Cache |
| `server/researcher-routes.ts` | `GET /api/researcher/liquidity?region=` → Index; US darf C2-Payload *plus* `liquidityIndex` liefern |
| `client/.../LiquidityPanel.tsx` | Prop `region`, Titel „Liquidity Index · USA|EZ|JP“, Slots statt Bessent-Zeile |
| `client/.../MacroPanel.tsx` | `region` durchreichen |
| `client/src/pages/Researcher.tsx` | `<MacroPanel data={...} region={region} />` |
| `script/test-liquidity-index.ts` | `s(0)=50`, Mix bei einem fehlenden Slot, JPNASSETS Einheit |

C2-Datei `liquidity-regime-math.ts` nicht zerlegen, bis US-Tests grün bleiben. LI ist additiv.

Sector/Screener: erst wenn `LI.available` und Region passt, Tiebreak aus `WORK_FISCAL_FRONTEND` §4 Researcher — nicht in v1 Pflicht.

---

## 6. Payload

```ts
type Region = "US" | "EU" | "ASIA";

interface LiquidityIndex {
  region: Region;
  asOf: string;                 // min der Slot-asOf
  li: number;                   // 0–100
  label: "expansiv" | "neutral" | "restriktiv";
  slots: {
    plumbing: { score: number; available: boolean; x: number | null; series: string[] };
    rate:     { score: number; available: boolean; delta90bp: number | null; series: string };
    money:    { score: number; available: boolean; yoyPct: number | null; series: string };
    fiscal:   { score: number; available: boolean; netBn: number | null; series: string[] };
  };
  discovered: { qtLike: boolean; qeLike: boolean; rmpLike: boolean };
  source: string;
  _cached?: boolean;
}
```

EU ohne Kanal D: `slots.fiscal.available=false`, `li` nur A+B+C. UI zeigt „Fiskal-Angebot n/v“, **kein** US-298.

---

## 7. Zahlen zum Einordnen (nicht als Schwelle)

| Region | Größe | Wert | Datum |
|--------|-------|------|-------|
| US | DFF | 3.63 % | 01.09.2026 |
| US | SOMA Bills | 542.0 Mrd. $ | 26.08.2026 |
| US | Marketable Bills Δ | +298.2 Mrd. $ | Jul 2026 |
| EZ | M3 Level | 17 614 Mrd. € | Jul 2026 |
| EZ | M3 YoY | 3.4 % | Jul 2026 |
| EZ | M3 vs US M2-Wachstum | EZ langsamer als US M2 ~5.5 % (Mitte 2026) | |
| JP | BoJ Assets | 644.66 Bio. Yen | Aug 2026 |

Cross-Region-Vergleich nur über `LI` und `z`, nie über Roh-Bilanz in Heimatwährung.

---

## 8. DoD

1. Region-Toggle US/EU/ASIA ändert Serienliste und `asOf`, nicht nur das Label.
2. `s(0)=50`, `s(±2)=100/0`.
3. Eine tote FRED-ID → nur dieser Slot down, LI bleibt berechnet.
4. Kein String `Bessent` oder `GENIUS` im Index-Payload.
5. `JPNASSETS` Aug 2026 Fixture 6446620 → 644.66 Bio. Yen.
6. Bestehende `test-liquidity-regime.ts` bleibt grün.
7. Macro-LLM (`POST /api/researcher/macro`) unverändert — Index ist das Zahlenwidget daneben.

---

## 9. Reihenfolge

1. Math + Catalog + Tests (ohne Fetch).
2. Fetch US auf bestehendem C2-Set → `LI_US` neben `regimeScore`.
3. Panel bekommt `region`; EU/ASIA zunächst A+B+C.
4. Fiscal-Frontend (MSPD/`WSHOBL`) nur in `slots.fiscal` US wenn available.
5. Optional Sector-Tiebreak.

---

**Ende.** Researcher-Index = regionale Zeitreihen + `s(z)`. US-Bill-Detail und GENIUS bleiben Spezialkanäle, nicht die Definition von „Europa“ oder „Asien“.
