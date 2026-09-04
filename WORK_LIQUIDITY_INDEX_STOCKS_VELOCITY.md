# WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md

> Stand: 04.09.2026 | Addendum Front-End
> 1:1-Map: Aktien `calcImpliedGStar` / `calcEinpreisungsgrad` / WACC-Halbwertszeit
>          ↔ Region `r*`, Velocity, Fiscal-PV, `T½`

---

## 0. Front-End je Region (Stock, nicht nur Flow)

Widget-Zeile über dem LI, drei Regionen gleiche Felder:

| Feld | Formel | Rolle |
|------|--------|-------|
| Debt/GDP | `D/Y` | Stock Fiskal |
| Bond market size | Marketable outstanding, Heimatwährung + %GDP | Größe Buch F |
| Realzins `r` | 10y Linker oder `i_10 − π_yoy` | WACC-Analog |
| Fiscal trend | `s(z(Δ(D/Y)_{4q}))` und/oder `s(z(N^{net}))` | Buch F Richtung |
| Geldtrend | `s(-z(Δi_90))` mix `s(z(ΔPolicyPortfolio))` | Buch M Richtung |
| Velocity `V` | `NGDP / M` | Transmissions-Multiplikator |
| Einpreisung `π` | unten, 1:1 zu Katalysator-EPR | wie viel Programm schon in `r` und `V` sitzt |
| Halbwertszeit `T½` | `ln2 / ln(1+r)` × Velocity-Faktor | 1:1 zu DCF-Jahre bis 50 % PV |

Niveaus **nicht** in `s(z)` mischen (JP Debt/GDP ~250 vs US ~120). Scoring nur auf `Δ` und `z`. Niveau = Anzeige.

---

## 1. 1:1 Aktien ↔ Region

Live-Aktien (`catalyst-engine.ts`):

```
EV = Price × Shares + NetDebt
g* = calcImpliedGStar(Price, FCF, WACC)     // was der Kurs an Wachstum verlangt
EPR = calcEinpreisungsgrad(BruttoUpside, …) // Anteil Katalysator im Kurs
```

PV-Gewicht eines Cashflows nach n Jahren: `(1+WACC)^{-n}`.
Halbwertszeit der Diskontierung (exakt dieselbe Gleichung):

```
(1+WACC)^{-T½} = 1/2
T½ = ln(2) / ln(1+WACC)
```

Beispiel WACC 8 %:

```
ln(1.08) ≈ 0.0770
T½ = 0.6931 / 0.0770 ≈ 9.00 Jahre
```

Region, **identische** Zeile, `WACC ↔ r` (Realzins 10y):

```
T½^{rate} = ln(2) / ln(1 + max(r, 0.001))
```

`r = 1.5 %` → `ln(1.015)≈0.0149` → `T½ ≈ 46.5 J` (Fiskalimpulse leben lang in Bonds).
`r = 2.0 %` → `T½ ≈ 35.0 J`.

Das ist die Abbildung „eins zu eins“. Kein zweites Halbwertszeit-Modell.

---

## 2. Velocity — Formel die schon im Repo liegt, plus Definition

C2 Ist:

```
V = M2V                  // FRED-Level, US
ΔV_4q = V_t − V_{t-4}
EMG = ΔM2 − ΔRGDP − ΔCPI
```

Soll, regionenfest, Quantitätsgleichung:

```
V = NGDP / M             // M = M2 US/JP, M3 EZ
```

US darf weiter `M2V` nutzen (ist genau das). EZ/JP: NGDP / M3 bzw. M2 selbst rechnen, wenn keine offizielle V-Serie.

Friedman-Identität, schon als EMG im Code:

```
ΔNGDP ≈ ΔM + ΔV
EMG = ΔM − ΔRGDP − π ≈ ΔM − ΔNGDP = −ΔV   (approx)
```

Lesart: EMG > 0 und V fällt → Geld sitzt in Assets (Impulse **eingepreist in Preisen**, nicht in Gütern). EMG > 0 und V steigt → Impuls läuft in NGDP/CPI (weniger „im Kurs“, mehr in der Realwirtschaft).

---

## 3. Velocity-adjustierte Halbwertszeit

Asset-Preis-Halbwertszeit des Fiskalimpulses:

```
T½ = T½^{rate} · (V̄ / V_t)
```

`V̄` = Median der eigenen 10y-Serie, nicht eine globale Konstante.

- `V_t < V̄` (Geld liegt): Impuls bleibt länger in Bonds/Equities → `T½` hoch
- `V_t > V̄` (Geld rotiert): Impuls verbrennt schneller in NGDP → `T½` runter

Clip `V̄/V` auf `[0.5, 2]`, sonst sprengt eine V-Delle die Skala.

Das ist der einzige Extra-Faktor gegenüber der Aktienformel. WACC hat kein V; Staaten haben eine Geldmenge.

---

## 4. Einpreisung `π` — Reverse-DCF des Programms

Angekündigter Fiskalstock `F` (Capex-Tab: Rest-NGEU, unspent IRA, GX …) ist **Input**, nicht Score.

Barwert heute, gleiche Diskontierung wie DCF:

```
PV(F) = Σ_k F_k / (1+r)^{t_k}
      ≈ F_rest · 2^{-t_mid / T½}
```

Was der Markt schon genommen hat — zwei Observablen, kein Sentiment:

**A. Realzins-Kanal (Preis = g*):**

```
Δr_{since legislated}  gegen  σ(Δr) der Region
z_r = Δr / σ
```

Steigendes `r` nach Legislatur = Angebot/Defizit teilweise im Bondpreis.

**B. Velocity/EMG-Kanal (Absorption):**

```
ΔM_obs  vs  φ F / M
A = clip( ΔM_obs / max(φ F/M, ε) , 0, 1 )
```

`φ` Start 0.3 (Teil des Programms wird monetär sichtbar). Fehlt `ΔM` → Kanal B `available:false`.

Mischung, analog EPR-Gewichtung:

```
π = 0.6 · s_to_unit(z_r) + 0.4 · A
s_to_unit(z) = clip( (s(z) − 50)/50 , 0, 1 )   // nur die Seite „Preis hat reagiert“
```

`π = 0` nichts im Realzins/Geld; `π = 1` Impuls in `r` oder `M` aufgebraucht.
Rest-PV für die Anzeige:

```
F_unpriced = PV(F) · (1 − π)
```

Capex-Tab zeigt `F` und Status legislated/funded. Index zeigt `π` und `F_unpriced`. Keine Doppelzählung in `LI`.

---

## 5. Serienkatalog Stock-Felder

| Region | Debt/GDP | Bond market | Realzins | V / M | NGDP |
|--------|----------|-------------|----------|-------|------|
| US | FRED `GFDEGDQ188S` | MSPD marketable total | `DFII10` (bevorzugt) sonst `DGS10−CPIAUCSL YoY` | `M2V` / `M2SL` | `GDP` |
| EZ | Eurostat gov debt %GDP / FRED `GGGDTPEZA188N` | Debt securities EA (EDP) | DE 10y real oder `IRLTLT01EZM156N − CP HP` | `NGDP/M3` | EDP GDP |
| JP | FRED Japan debt/GDP | JGB outstanding MoF/BoJ | JGB10 − JP CPI | `NGDP/M2` | JP GDP |

Bond-Marktgröße immer **doppelt**: Absolut (Bn Heimat) und `/GDP`. Cross-Region nur über %GDP und `z`.

Fiscal trend x: `Δ(D/Y)` 4Q und/oder Nettoemission/GDP.
Geldtrend x: `−Δi_90` und `ΔPolicyPortfolio` inverse-vol, wie Index-Kanäle B und A.

---

## 6. Payload-Zusatz (Front-End)

```ts
interface RegionalStocks {
  debtGdpPct: number | null;
  bondMarketBn: number | null;     // Heimat
  bondMarketGdpPct: number | null;
  realRatePct: number | null;      // r, WACC-Analog
  tHalfYears: number | null;       // ln2/ln(1+r) * Vbar/V
  velocity: number | null;
  velocityZ: number | null;
  excessMoneyGrowth: number | null;
  fiscalTrend: number | null;      // s(z) 0–100
  moneyTrend: number | null;       // s(z) 0–100
  pricedIn: number | null;         // π 0–1
  unpricedPvBn: number | null;
  available: { debt: boolean; bonds: boolean; real: boolean; vel: boolean; pi: boolean };
}
```

UI: eine Zeile Stocks, eine Zeile Trends, eine Zeile `π | T½ | V`. Gelb wenn `available.pi=false` (kein F aus Capex-Cache).

---

## 7. DoD 1:1

1. Fixture: `r=0.08` → `T½^{rate}=ln2/ln(1.08)` ∈ `[8.99, 9.01]` — dieselbe Zahl wie Aktien-WACC 8 %.
2. `r=0.02` → `T½^{rate}` ∈ `[34.9, 35.1]`.
3. `V=V̄` → Velocity-Faktor 1, `T½=T½^{rate}`.
4. `V=0.5 V̄` nach Clip-Floor 0.5 → Faktor 2.
5. EMG-Formel bitgleich `excessMoneyGrowth()` aus `liquidity-regime-math.ts`.
6. `g*` / Aktien-EPR unverändert — dieser Block importiert sie nicht.
7. JP Debt/GDP-Niveau ändert `LI` nicht, nur `Δ(D/Y)` und Anzeige.

---

**Satz:** Realzins = WACC, `T½ = ln2/ln(1+r)`, Velocity streckt/staucht nur die Halbwertszeit, `π` ist der regionale `Einpreisungsgrad`. Fiskalprogramme bleiben Capex-Input, nicht LI-Hardcode.
