# WORK_TEIL0-6.md — Vollständige Detailtiefe TEIL 0–6

> Restore aus Commit 975dbe93 + dokumentiertem Stand  
> Stand: 28.07.2026  
> Zugehörig: WORK.md (Index) · WORK_TEIL7_SCORING.md (TEIL 7) · WORK2.md (TEIL 8)

---

# TEIL 0 — PLATFORM-REALITÄT & SOFORT-FIXES (Stand 25.07.2026)

> Alle früheren Annahmen zu "Railway" sind falsch — das Projekt läuft NICHT auf Railway.

## 0.1 — Produktive Deployments

```
Plattform 1: Perplexity Computer (pplx.app) [PRIMÄR] — https://aktienanalyst-pro.pplx.app
Plattform 2: Render (Docker) [SEKUNDÄR] — https://aktienanalyst.onrender.com
```

## 0.2–0.7 — Railway raus · Env Vars · Quota Guard · Health-Check · Mega-File-Splits · Checkliste

Siehe vorherige Version / Index WORK.md.

---

# TEIL 1 — BTC DASHBOARD RESTORE

```
BTCDashboard.tsx (Shell) + btc/Sections1to6 · Sections7to12 · Section13Miner
case 13: return <Section13Miner ... />
```

Gute Commits: `33c8e77`, `5bf8a2d`, `bafff3c`

---

# TEIL 2–5 — Bugs · Katalysatoren · OpenRouter · FMP

Siehe Detail in Datei / Index. Kern: calcROIC, toUSD, catalystTarget, 3-Modell-Fallback.

---

# TEIL 6 — FEATURE-ROADMAP

## 6.1–6.3 Grundregeln · Sections · Thesis/Kelly

---

## 6.4 BTC Section 13 — Miner-Profitabilität, Kapitulationszonen & Chart-Spezifikation

> **Nur Dokumentation.** Keine Änderungen am BTC-Dashboard-Code.

### 6.4.1 Indikatoren-Übersicht

| # | Indikator | Kapitulation | Profitabel |
|---|-----------|--------------|------------|
| 1 | Hash Ribbons (MA30/MA60 Hashrate) | MA30 < MA60, beide fallend | MA30 kreuzt MA60 von unten |
| 2 | Puell Multiple | < 0.5 | 0.5–1.2; > 4 überhitzt |
| 3 | Hashprice (USD/TH/Tag) | unter Betriebskosten | klar über Breakeven |
| 4 | Mining Breakeven | Spot < Breakeven | Spot > Breakeven × 1.2 |
| 5 | Difficulty Ribbon | Compression | Expansion nach Compression |
| 6 | Miner Netflows / MPI | Spike dann Austrocknen | Netflows negativ (HODL) |
| 7 | Realized Price Kontext | Konvergenz Spot/Realized/Breakeven | Spot klar darüber |

---

### 6.4.2 Einfluss des Halvings auf Hashrate (detailliert)

```
Zeitachse eines Halving-Zyklus (schematisch):

 t=0  HALVING
      Block-Subsidy: 6.25 → 3.125 BTC (Beispiel 2024)
      Sofort: USD-Einnahmen pro TH/s (Hashprice) ≈ −50 %,
              sofern der Spotpreis nicht gleichzeitig +100 % macht.

 t=0…+2 Wochen
      Difficulty bleibt zunächst HOCH (nächste Adjustment erst nach 2016 Blöcken).
      → Miner mit hoher Effizienz (moderne ASICs) bleiben knapp profitabel.
      → Miner mit alter Hardware (hohe J/TH) fallen unter Breakeven.
      → Erste Abschaltungen → Hashrate beginnt zu sinken.

 t=+2…+8 Wochen  (Anpassungsphase = Kapitulationsfenster)
      Difficulty Adjustment alle ~14 Tage nach unten.
      Hashrate fällt weiter, solange Spot nicht steigt.
      Hash Ribbon: MA30 rutscht unter MA60, beide fallend → Capitulation-Regime.
      Puell Multiple oft < 0.5 (Emission in USD historisch extrem niedrig).
      Miner-Netflows: Zwangsverkäufe (Reserven → Börse), dann Austrocknen.

 t=+2…+6 Monate
      Schwache Hände (ineffiziente Miner) sind draußen.
      Difficulty / Hashrate stabilisieren sich auf neuem, niedrigerem Niveau.
      Breakeven-Linie sinkt nach (günstigere Marginale Kosten).
      Hash-Ribbon-Crossover: MA30 kreuzt MA60 von unten → historisches Buy-Signal.
      Rote Kapitulationszone endet, grüne Recovery beginnt.

Spätere Phase des Zyklus:
      Spot steigt → Hashprice steigt → neue/effizientere Kapazität kommt online
      → Hashrate und Difficulty expandieren wieder (grüner Expansion-Regime).
```

**Warum Hashrate dem Preis hinterherläuft**

1. **Subsidy-Schock ist sofort** — Hashprice fällt am Halving-Tag diskret.  
2. **Difficulty ist träge** — nur alle 2016 Blöcke (~14 Tage). Zwischen Adjustments  
   bleibt der „Schwierigkeitsdruck“ hoch, obwohl die Belohnung schon halbiert ist.  
3. **CapEx ist versunken** — Miner schalten erst ab, wenn laufende Kosten (Strom)  
   nicht mehr gedeckt sind; Hardware-Abschreibung ist Sunk Cost.  
4. **Heterogene Flotte** — moderne 15–25 J/TH bleiben länger online als 60–100 J/TH.  
   Die marginale Hashrate (die zuletzt abschaltet) bestimmt den Breakeven der Flotte.

**Messbare Signale im Dashboard**

| Phase | Hashrate | Difficulty | Hash Ribbon | Puell | Spot vs Breakeven |
|-------|----------|------------|-------------|-------|-------------------|
| Pre-Halving Peak | hoch, steigend | hoch | Expansion | oft > 1 | profitabel |
| Post-Halving Schock | beginnt zu fallen | noch hoch | Übergang | fällt scharf | oft unprofitabel |
| Kapitulation | fallend | fallend (Adjustments) | MA30 < MA60 | < 0.5 | Spot ≤ Breakeven |
| Recovery | Bodenbildung | stabil/leicht ↑ | MA30×MA60 von unten | 0.5–1 | Spot > Breakeven |
| Expansion | steigend | steigend | MA30 > MA60 | 1–2+ | klar profitabel |

---

### 6.4.3 Breakeven-Berechnung (vollständige Formel)

#### Physik / Ökonomie

```
1) Energieverbrauch eines Miners pro TH und Tag:
   kWh_per_TH_day = (efficiency_J_per_TH / 1000) * 24
   // efficiency z.B. 25 J/TH → 0.025 kWh/TH/h × 24 = 0.6 kWh/TH/Tag

2) Stromkosten pro TH und Tag:
   cost_per_TH_day_USD = kWh_per_TH_day * power_price_USD_per_kWh
   // z.B. 0.6 * 0.06 = 0.036 USD/TH/Tag

3) Netzwerk-Hashprice (USD pro TH und Tag):
   // Tägliche Miner-Einnahmen (Subsidy + Fees) / Network-Hashrate in TH
   daily_issuance_BTC = block_reward_BTC * 144          // ~144 Blöcke/Tag
   daily_issuance_USD = daily_issuance_BTC * spot_USD
   // + Fees optional
   network_TH = hashrate_EH * 1e6                       // 1 EH/s = 1e6 TH/s
   hashprice_USD_per_TH_day = daily_issuance_USD / network_TH

4) Breakeven-Spotpreis:
   // Der BTC-Preis, bei dem hashprice = cost_per_TH_day
   // hashprice ∝ spot  (bei fester Hashrate/Difficulty/Reward)
   // → breakeven_spot = spot * (cost_per_TH_day / hashprice)
   //
   // Äquivalent ohne Umweg über aktuellen Spot:
   // breakeven_spot = cost_per_TH_day * network_TH / daily_issuance_BTC
```

#### TypeScript (Dokumentation)

```ts
export interface BreakevenInput {
  hashrateEh: number;          // Network Hashrate in EH/s
  blockRewardBtc: number;      // z.B. 3.125 nach 2024-Halving
  priceUsd: number;            // aktueller Spot (nur für Ratio)
  powerCostUsdPerKwh?: number; // default 0.06
  efficiencyJPerTh?: number;   // default 25 (moderne Flotte)
  feesBtcPerDay?: number;      // optionale Gebühren-Einnahmen, default 0
}

export interface BreakevenResult {
  costPerThDay: number;        // USD/TH/Tag Betriebskosten
  hashpriceUsdPerThDay: number;
  breakevenUsd: number;        // Spot-Preis, bei dem Margin = 0
  spotVsBreakeven: number;     // Spot / Breakeven
  zone: 'unprofitable' | 'marginal' | 'profitable';
}

export function calcBreakevenPoint(i: BreakevenInput): BreakevenResult {
  const power = i.powerCostUsdPerKwh ?? 0.06;
  const eff = i.efficiencyJPerTh ?? 25;
  const fees = i.feesBtcPerDay ?? 0;

  // 1–2) Kosten pro TH/Tag
  const kWhPerThDay = (eff / 1000) * 24;
  const costPerThDay = kWhPerThDay * power;

  // 3) Hashprice
  const dailyIssuanceBtc = i.blockRewardBtc * 144 + fees;
  const networkTh = i.hashrateEh * 1_000_000; // EH/s → TH/s
  const hashpriceUsdPerThDay =
    networkTh > 0 ? (dailyIssuanceBtc * i.priceUsd) / networkTh : 0;

  // 4) Breakeven-Spot
  // cost = (dailyIssuanceBtc * breakeven) / networkTh
  // → breakeven = cost * networkTh / dailyIssuanceBtc
  const breakevenUsd =
    dailyIssuanceBtc > 0 ? (costPerThDay * networkTh) / dailyIssuanceBtc : 0;

  const ratio = breakevenUsd > 0 ? i.priceUsd / breakevenUsd : 1;
  const zone =
    ratio < 1.0 ? 'unprofitable' :
    ratio < 1.2 ? 'marginal'     : 'profitable';

  return { costPerThDay, hashpriceUsdPerThDay, breakevenUsd, spotVsBreakeven: ratio, zone };
}

/** Serie über Zeit — blockRewardBtc springt am Halving-Datum */
export function calcBreakevenSeries(
  points: {
    date: string;
    hashrateEh: number;
    priceUsd: number;
    blockRewardBtc: number;
  }[],
  opts?: { powerCostUsdPerKwh?: number; efficiencyJPerTh?: number }
): BreakevenResult[] {
  return points.map(p =>
    calcBreakevenPoint({
      hashrateEh: p.hashrateEh,
      blockRewardBtc: p.blockRewardBtc,
      priceUsd: p.priceUsd,
      powerCostUsdPerKwh: opts?.powerCostUsdPerKwh,
      efficiencyJPerTh: opts?.efficiencyJPerTh,
    })
  );
}
```

#### Zahlenbeispiel (illustrativ)

```
Annahmen nach 2024-Halving:
  blockReward   = 3.125 BTC
  hashrate      = 600 EH/s = 6e8 TH/s
  power         = 0.06 $/kWh
  efficiency    = 25 J/TH   (moderne Flotte)
  fees          = 0

  kWh/TH/Tag    = 0.025 * 24 = 0.60 kWh
  cost/TH/Tag   = 0.60 * 0.06 = 0.036 USD

  dailyIssuance = 3.125 * 144 = 450 BTC/Tag
  breakeven     = 0.036 * 6e8 / 450 ≈ 48 000 USD

  → Bei Spot 40 000: ratio 0.83 → unprofitable (rote Zone)
  → Bei Spot 60 000: ratio 1.25 → profitable (grüne Zone)

Alte Hardware 80 J/TH, gleicher Strom:
  cost/TH/Tag   = (0.08)*24*0.06 = 0.115 USD
  breakeven     = 0.115 * 6e8 / 450 ≈ 153 000 USD
  → Bei Spot 60k klar unprofitabel → Abschaltung → Hashrate fällt
```

#### Einfluss Halving auf Breakeven (direkt)

```
Halving: blockReward × 0.5  →  dailyIssuance × 0.5  →  breakeven × 2

Wenn Hashrate und Effizienz konstant bleiben, verdoppelt sich der
Breakeven-Preis am Halving-Tag. Genau das erzeugt die Kapitulationslücke:
Spot müsste sich verdoppeln, um die Margin stabil zu halten — tut er meist nicht.

Danach: Hashrate fällt (ineffiziente Miner off) → networkTh ↓ → breakeven sinkt nach.
Der Anpassungsprozess ist die rote Zone im Chart.
```

---

### 6.4.4 Code-Logik Hash Ribbons / Puell / Zonen

```ts
function sma(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / window;
  });
}

export function calcHashRibbons(hashrate: number[]): HashRibbonSignal[] {
  const ma30 = sma(hashrate, 30);
  const ma60 = sma(hashrate, 60);
  return hashrate.map((_, i) => {
    const a = ma30[i], b = ma60[i];
    if (a == null || b == null)
      return { ma30: a ?? 0, ma60: b ?? 0, regime: 'neutral' as const, buySignal: false };
    const prevA = i > 0 ? ma30[i - 1] : null;
    const prevB = i > 0 ? ma60[i - 1] : null;
    const buySignal = prevA != null && prevB != null && prevA <= prevB && a > b;
    let regime: HashRibbonSignal['regime'] = 'neutral';
    if (a < b) regime = 'capitulation';
    else if (buySignal) regime = 'recovery';
    else if (a > b) regime = 'expansion';
    return { ma30: a, ma60: b, regime, buySignal };
  });
}

export function calcPuell(issuanceUsd: number[]): PuellResult[] {
  const ma365 = sma(issuanceUsd, 365);
  return issuanceUsd.map((iss, i) => {
    const m = ma365[i];
    if (m == null || m === 0) return { value: 1, zone: 'neutral' as const };
    const value = iss / m;
    return {
      value,
      zone: value < 0.5 ? 'capitulation' : value > 4 ? 'overheated' : 'neutral',
    };
  });
}
```

---

### 6.4.5 Chart-Visualisierung

```
Hauptpanel:
  · BTC Spot (blau)
  · Miner-Breakeven (orange, gestrichelt) — springt am Halving nach oben, sinkt mit Hashrate
  · Rote ReferenceAreas = Kapitulation (Spot < Breakeven ∪ Ribbon-Cap ∪ Puell < 0.5)
  · Grüne ReferenceAreas = Profitabel (Spot > Breakeven×1.2 ∧ Ribbon Expansion)
  · Marker = Hash-Ribbon Buy (MA30×MA60 von unten)

Panel 2: Puell + Linien 0.5 / 4.0
Panel 3: Hash Ribbon MA30 / MA60
```

---

### 6.4.6 Maximum der Bärenmarkt-Konsolidierung

```
Alle (oder die meisten) gleichzeitig:
1. Hash Ribbon Capitulation (MA30 < MA60, fallend)
2. Puell < 0.5
3. Spot ≤ Breakeven
4. Difficulty-Ribbon komprimiert
5. Miner-Netflows nach Spike austrocknend

→ Hash-Ribbon-Crossover = Ende der roten Zone / Start Recovery
```

### 6.4.7 Datenquellen & Umsetzung

| Serie | Quelle |
|-------|--------|
| Hashrate / Difficulty | mempool.space, Blockchain.com, CryptoQuant |
| Block Reward | Halving-Kalender (konstant zwischen Halvings) |
| Spot | FMP / Exchange |
| Strompreis / J/TH | UI-Slider (0.04–0.08 $/kWh, 15–100 J/TH) |

```
[ ] btcMiner.ts: calcBreakevenPoint, calcBreakevenSeries, calcHashRibbons, calcPuell, deriveMinerZones
[ ] Section13Miner Chart: ReferenceArea rot/grün, Breakeven-Linie, Ribbon-Marker
[ ] Slider: powerCost, efficiency
[ ] blockRewardBtc an Halving-Daten koppeln (Serie springt)
```

**Regel:** Nur Dokumentation. Implementierung lokal → PR → Review.

---

**Weiter:** TEIL 7 → [WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md) · TEIL 8 → [WORK2.md](./WORK2.md)
