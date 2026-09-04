# WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md

> Stand: 04.09.2026 | Addendum zu WORK_RESEARCHER_LIQUIDITY_INDEX.md
> Regel: **gleiche zwei Bücher überall**. Nur Behörde + Serie wechselt. Cache der Zeitreihe, nicht der Rede.

---

## 0. Übertragbare Einheit

Jedes Region-Paket hat genau zwei Bücher. Programme (NGEU, CHIPS, GX) sind **nicht** der Index — die sitzen im Capex-Tab als Text. Der Index cached nur **Bestände und Flüsse**.

```
Buch M  Geld  = Zentralbank kauft/lässt Staats- und Policy-Papiere
Buch F  Fiskal = Debt-Management-Office emittiert / kauft zurück / hält Cash bei der CB
```

Vorzeichen (überall gleich):

| Fluss | Behörde | Wirkung auf LI |
|-------|---------|----------------|
| CB Netto-Kauf Policy-Portfolio | Fed / EZB / BoJ | plus (Duration + Reserven) |
| CB Netto-Tilgung / QT-Runoff | dieselben | minus |
| Fiskal Netto-Emission Bills/Bonds | Treasury / Kommission+Agentur / MoF | minus auf Front-End-Slot |
| Fiskal Rückkauf Coupons | Buyback-Desk / Finanzagentur / MoF | plus Duration, **nicht** Bill-Sog |
| Staatscash bei CB ↑ | TGA / Gov deposits EZB / MoF deposits BoJ | minus |

`x_t` ist immer `Δ` oder YoY der **gecachten Serie**. `s(z)` regional. Kein GENIUS, kein Personenname.

---

## 1. Mapping Behörde → Serie → Cache

### USA

| Buch | Amt | Was | Quelle | Cache-Key | TTL |
|------|-----|-----|--------|-----------|-----|
| M Assets | Fed | WALCL | FRED | `liqidx_US__WALCL` | 6 h |
| M Bills vs Notes | Fed SOMA | WSHOBL / WSHOTSL | FRED | `liqidx_US__soma` | 6 h |
| M Drain | Fed | RRPONTSYD | FRED | im C2-Bundle | 6 h |
| F Cash | Fiscal Service / TGA | WTREGEN + DTS | FRED/Fiscal Data | `liqidx_US__tga` | 12 h |
| F Angebot | Fiscal Service | MSPD Bills + Auktionen | Fiscal Data | `liqidx_US__mspd` | 24 h |
| F Rückkauf | Buyback-Desk | Ops accepted | Fiscal Data | `liqidx_US__buybacks` | 12 h |
| F Soll | QRA-Desk | Implied Bills 409 | JSON bis nextRelease | `fiscal__qra_2026Q3` | bis 04.11.2026 |

### Eurozone

| Buch | Amt | Was | Quelle | Cache-Key | TTL |
|------|-----|-----|--------|-----------|-----|
| M Assets | EZB / Eurosystem | Total assets + WFS | ECB Data Portal `https://data-api.ecb.europa.eu` | `liqidx_EU__assets` | 6 h nach WFS |
| M Policy-Portfolio | EZB | APP + PEPP holdings | ECB APP/PEPP Tabellen + EDP | `liqidx_EU__app_pepp` | 24 h |
| M Drain | EZB | Deposit facility stock (WFS 2.2) | EDP / WFS | `liqidx_EU__df` | 6 h |
| M Satz | EZB | ECBDFR `Δ_90` | FRED/EDP | `liqidx_EU__ecbdfr` | 12 h |
| C Geld | EZB | M3 YoY | EDP / FRED MABMM301 | `liqidx_EU__m3` | 24 h |
| F Cash | NCBs | Central-gov deposits | WFS / EDP | `liqidx_EU__govdep` | 6 h |
| F Angebot EU-Level | Kommission Debt Management | EU-Bonds + EU-Bills Funding Plan | Commission funding-plans (JSON/PDF-Anker) | `liqidx_EU__eubonds` | bis nächster Plan |
| F Angebot DE (optional Chip) | Bundesrepublik Finanzagentur | Bund-Auktionen netto | Finanzagentur Ergebnislisten | `liqidx_EU__bund` | 24 h |

Fakten zum Cachen, nicht als Schwelle:

- APP holdings Jul 2026: **2 093.3 Mrd. €**, Monat `Δ` **−27.2** Mrd. € (PSPP allein −24.3).
- PEPP book end-Jul: **1 294.7 Mrd. €**, Jul Netto **−24.8** Mrd. €; weekly book 28.08.2026 **1 284.9** Mrd. €.
- PEPP-Reinvest Ende 2024 eingestellt, APP-Reinvest seit Jul 2023 aus — der Index sieht das als anhaltend negatives `ΔPortfolio`, nicht als hardcodiertes Regime-Datum.
- M3 Jul 2026: Level **17 614** Mrd. €, YoY **3.4 %**.
- Kommission H2-2026: **80 Mrd. €** EU-Bonds Jul–Dez, plus EU-Bills-Auktionen mittwochs — das ist Fiskal-Angebot Buch F, **kein** EZB-QE.

### Asien (Anker Japan)

| Buch | Amt | Was | Quelle | Cache-Key | TTL |
|------|-----|-----|--------|-----------|-----|
| M Assets | BoJ | JPNASSETS | FRED | `liqidx_ASIA__jpnassets` | 24 h (Monatsserie) |
| M JGB-Kauf | BoJ Markets | Outright JGB purchases | BoJ Time-Series / Ops | `liqidx_ASIA__jgb_px` | 24 h |
| M Satz | BoJ | Policy / ON `Δ_90` | FRED IRSTCI01JP | `liqidx_ASIA__rate` | 12 h |
| C Geld | BoJ | M2 YoY | FRED/BoJ | `liqidx_ASIA__m2` | 24 h |
| F Angebot | MoF Debt Management | JGB + T-Bill Emission netto | MoF / BoJ issuance stats | `liqidx_ASIA__jgb_iss` | 24 h |
| F Cash | MoF bei BoJ | Gov current deposits falls Serie | BoJ accounts | `liqidx_ASIA__govdep` | 24 h |
| C optional | PBoC | China M2 YoY | FRED | `liqidx_ASIA__cn_m2` | 24 h, Gewicht ≤ 0.10 |

Fakten:

- `JPNASSETS` Aug 2026: **6 446 620** × 100 Mio. Yen = **644.66 Bio. Yen** (Newsletter: Total Assets 644, JGBs 519, T-Bills bei der BoJ **0.0**).
- Outright JGB-Käufe Aug 2026: **2 321.2** Mrd. Yen nach 2 338.6 im Juli — Bestandskäufe laufen, Tempo weit unter Peak Jan 2023 (23 690).
- MoF plant/emittiert JGBs (FY2025 ~177 Bio. Yen geplant) — Buch F, getrennt von BoJ-Käufen.

China: v1 nur M2-Chip. PBoC-OMOs und MoF-Bond-Auctions erst wenn eine stabile öffentliche Serie ohne Scrape-Zerbrechlichkeit da ist. Kein Fake-TGA.

---

## 2. Eine Fetch-Schicht, drei Kataloge

```ts
// server/liquidity-index-catalog.ts
export type Book = "M" | "F";
export interface SeriesSpec {
  book: Book;
  role: "assets" | "policyPortfolio" | "drain" | "govCash" | "netIssuance" | "buybacks" | "rate" | "money";
  id: string;           // FRED id oder EDP key oder Fiscal-Data path
  unit: "bnUSD" | "bnEUR" | "tnJPY" | "pct";
  sign: 1 | -1;         // + = locker wenn x steigt
  ttlHours: number;
  cacheKey: string;
}
```

`liquidity-index.ts`:

1. `specs = CATALOG[region]`
2. je Spec: Disk-Cache hit → sonst Fetch → `diskResearcherSet(cacheKey)`
3. `x_t` bauen (Δ 13w / 90d / 1m je Rolle)
4. `s(z)` nur wenn Historie ≥ `H_min`
5. Inverse-Vol-Mix über available Slots

Capex-Programme (NGEU-Auszahlung, IRA, GX) **nicht** in diesen Mix. Die bleiben `POST /api/researcher/capex`. Höchstens Badge: „Funding-Umfeld = slots.fiscal“.

---

## 3. Entdeckung Anleihenkäufe (ohne Datumsliste)

```
cbBuying  ⇔  z(Δ policyPortfolio) > 1.0  ∧  Δ > 0
cbQT      ⇔  z(Δ policyPortfolio) < -1.0 ∧  Δ < 0
fiscalFlood ⇔ z(Δ netIssuance) > 1.0
```

Juli-EZ-Beispiel, nur zur Fixture:

```
ΔAPP_Jul  = -27.17 Mrd. €
ΔPEPP_Jul = -24.82 Mrd. €
ΔM_Jul    = -52.0 Mrd. €   // Policy-Portfolio
```

Ob das `z < -1` ist, entscheidet die 24-Monats-Verteilung von `ΔAPP+ΔPEPP`, nicht der Satz „QT seit 2023“.

US analog: SOMA Notes `Δ` vs Bills `Δ` trennt QE von RMP.
JP analog: Outright JGB `Δ` vs `JPNASSETS Δ`.

---

## 4. DoD Übertragbarkeit

1. Derselbe Mixer läuft auf `CATALOG.US`, `.EU`, `.ASIA` ohne if-Regime.
2. EU-LI ändert sich, wenn APP/PEPP-Monatsbestand kommt — nicht wenn ein EZB-Statement gecrawlt wird.
3. ASIA-LI ändert sich mit `JPNASSETS` / JGB-Purchases / MoF-Issuance, nicht mit US-TGA.
4. Kommission 80 Mrd. EU-Bonds landet in Buch F, nicht in Buch M.
5. Payload enthält `books.M` und `books.F` mit `available` je Slot.
6. Kein `Bessent`, kein `GENIUS` in diesem Index.

API: `GET /api/researcher/liquidity?region=US|EU|ASIA` liest nur diese Cache-Keys.
