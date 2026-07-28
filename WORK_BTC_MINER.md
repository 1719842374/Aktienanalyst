# WORK_BTC_MINER.md — Section 13 Miner-Zone: Profitabilität, Kapitulation & Chart-Logik

> Stand: 28.07.2026  
> Ergänzung zu TEIL 1 (BTC Dashboard) / Section 13  
> Ziel: Kapitulationszonen (rot) und profitable Zonen (grün) visualisieren — analog zur BTC Technischen Analyse  
> Regel: Nur Dokumentation. Implementierung lokal → PR → Review.

---

## 1. Konzept: Was die Kapitulationszone bedeutet

Nach jedem **Halving** halbiert sich die Block-Subvention → Hashprice fällt abrupt, wenn der Kurs nicht mitzieht. Ineffiziente Miner (ältere ASICs) werden unprofitabel, schalten ab oder verkaufen BTC-Reserven. Difficulty passt sich verzögert an (alle 2016 Blöcke).

**Leselogik des Charts:**

```
Kurs (blau) fällt nach Halving oft schneller/tiefer als die Miner-Kostenlinie (orange, gestrichelt).
Im Überschneidungsbereich (ROT) sind viele Miner unprofitabel.
Sobald genug draus sind → Difficulty/Hashrate fällt → Kostenlinie sinkt nach.
Hash-Ribbon-Crossover (MA30 kreuzt MA60 von unten) markiert historisch das Ende der Kapitulation.
```

| Zone | Bedingung | Farbe | Bedeutung |
|------|-----------|-------|-----------|
| **Kapitulation** | Spot < Breakeven UND/ODER Puell < 0.5 UND/ODER Hash Ribbon bearish | 🔴 rot | Miner unprofitabel, Zwangsverkäufe, Konsolidierungs-Maximum im Bärenmarkt |
| **Übergang** | Spot ≈ Breakeven ±10 % ODER Ribbon-Crossover | 🟡 gelb | Kapitulation endet, schwache Hände raus |
| **Profitabel** | Spot > Breakeven × 1.2 UND Puell > 0.8 UND Ribbon bullish | 🟢 grün | Miner profitabel, Hashrate stabil/steigend |

---

## 2. Indikatoren (7 Stück)

### 2.1 Hash Ribbons (Capriole)

Vergleicht MA30 und MA60 der Hashrate.

```ts
export interface HashRibbonPoint {
  date: string;
  hashrate: number;       // EH/s
  ma30: number;
  ma60: number;
  signal: 'capitulation' | 'buy' | 'neutral';
}

/**
 * Kapitulation: MA30 < MA60 UND beide fallend
 * Buy-Signal: MA30 kreuzt MA60 von unten (Golden Cross der Hashrate)
 */
export function calcHashRibbons(
  series: { date: string; hashrate: number }[]
): HashRibbonPoint[] {
  const out: HashRibbonPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const window30 = series.slice(Math.max(0, i - 29), i + 1);
    const window60 = series.slice(Math.max(0, i - 59), i + 1);
    const ma30 = window30.reduce((s, d) => s + d.hashrate, 0) / window30.length;
    const ma60 = window60.reduce((s, d) => s + d.hashrate, 0) / window60.length;

    let signal: HashRibbonPoint['signal'] = 'neutral';
    if (i >= 60) {
      const prev = out[i - 1];
      const bothFalling = ma30 < (prev?.ma30 ?? ma30) && ma60 < (prev?.ma60 ?? ma60);
      if (ma30 < ma60 && bothFalling) signal = 'capitulation';
      // Golden Cross: vorher MA30 < MA60, jetzt MA30 >= MA60
      if (prev && prev.ma30 < prev.ma60 && ma30 >= ma60) signal = 'buy';
    }
    out.push({ date: series[i].date, hashrate: series[i].hashrate, ma30, ma60, signal });
  }
  return out;
}
```

### 2.2 Puell Multiple

```ts
/**
 * Puell = Tagesemission_USD / MA365(Tagesemission_USD)
 * < 0.5  → Kapitulationszone
 * > 4.0  → überhitzt / Top-Zone
 */
export function calcPuellMultiple(
  dailyIssuanceUsd: { date: string; value: number }[]
): { date: string; puell: number; zone: 'capitulation' | 'neutral' | 'euphoria' }[] {
  return dailyIssuanceUsd.map((d, i) => {
    const window = dailyIssuanceUsd.slice(Math.max(0, i - 364), i + 1);
    const ma365 = window.reduce((s, x) => s + x.value, 0) / window.length;
    const puell = ma365 > 0 ? d.value / ma365 : 1;
    const zone =
      puell < 0.5 ? 'capitulation' :
      puell > 4.0 ? 'euphoria' : 'neutral';
    return { date: d.date, puell, zone };
  });
}

// dailyIssuanceUsd ≈ (Block-Reward × 144 Blöcke/Tag × BTC-Preis)
// Post-Halving 2024: Reward = 3.125 BTC
```

### 2.3 Hashprice (USD / TH/s / Tag)

```ts
/**
 * Hashprice = (Block-Reward_USD + Fees_USD) / totale Hashrate_TH
 * Direktester Profitabilitätsindikator pro Hash-Einheit.
 */
export function calcHashprice(params: {
  btcPrice: number;
  blockRewardBtc: number;   // 3.125 nach 2024-Halving
  dailyFeesBtc: number;
  hashrateEHs: number;      // Exahash/s
}): number {
  const dailyIssuanceUsd = (params.blockRewardBtc * 144 + params.dailyFeesBtc) * params.btcPrice;
  const hashrateTHs = params.hashrateEHs * 1e6; // EH/s → TH/s
  return hashrateTHs > 0 ? dailyIssuanceUsd / hashrateTHs : 0;
}
```

### 2.4 Mining Breakeven / Cost-of-Production

```ts
export interface MinerFleetAssumptions {
  electricityUsdPerKwh: number;  // typ. 0.04–0.08 institutionell
  efficiencyJPerTh: number;      // aktuelle Gen ~20–30, alt 60–100+
  otherOpexPct: number;          // 0.10–0.20 auf Energiekosten
}

/**
 * Breakeven-Preis ($/BTC):
 * Energie pro TH/Tag = efficiencyJPerTh * 86400 / 1e6  (J→kWh: /3.6e6 … vereinfacht)
 *
 * Praktische Formel (üblich in der Industry):
 *   powerKW_per_TH = efficiencyJPerTh / 1000   (J/TH ≈ W/TH bei 1s)
 *   dailyKwh_per_TH = powerKW_per_TH * 24
 *   cost_per_TH_day = dailyKwh_per_TH * electricityUsdPerKwh * (1 + otherOpexPct)
 *   breakeven = cost_per_TH_day / hashprice_per_BTC_equivalent
 *
 * Einfacher Proxy (Capriole-Stil):
 *   breakevenBtcPrice ≈ (electricityUsdPerKwh * efficiencyJPerTh * networkDifficultyFactor) / reward
 */
export function calcBreakevenPrice(params: {
  electricityUsdPerKwh: number;
  efficiencyJPerTh: number;     // z.B. 25 für S21-Klasse, 50 für Mix-Flotte
  hashrateEHs: number;
  blockRewardBtc: number;
  dailyFeesBtc?: number;
  otherOpexPct?: number;
}): number {
  const opex = params.otherOpexPct ?? 0.15;
  // kWh pro TH pro Tag: (J/TH) / 1000 = W/TH; * 24 / 1000 = kWh/TH/Tag
  const kwhPerThDay = (params.efficiencyJPerTh / 1000) * 24 / 1000;
  const costPerThDay = kwhPerThDay * params.electricityUsdPerKwh * (1 + opex);

  const dailyCoins = params.blockRewardBtc * 144 + (params.dailyFeesBtc ?? 0);
  const hashrateTHs = params.hashrateEHs * 1e6;
  // Anteil eines TH am täglichen Reward
  const btcPerThDay = dailyCoins / hashrateTHs;
  if (btcPerThDay <= 0) return Infinity;
  return costPerThDay / btcPerThDay; // $/BTC
}
```

### 2.5 Difficulty Ribbon Compression

```ts
/**
 * Mehrere MAs der Difficulty (9, 14, 25, 40, 60, 90, 128, 200).
 * Starke Compression = Difficulty stagniert/fällt → ineffiziente Miner geben auf.
 */
export function calcDifficultyRibbonCompression(
  difficulty: { date: string; value: number }[],
  windows = [9, 14, 25, 40, 60, 90, 128, 200]
): { date: string; compression: number; zone: 'compressed' | 'neutral' | 'expanded' }[] {
  return difficulty.map((d, i) => {
    const mas = windows.map(w => {
      const slice = difficulty.slice(Math.max(0, i - w + 1), i + 1);
      return slice.reduce((s, x) => s + x.value, 0) / slice.length;
    });
    const max = Math.max(...mas);
    const min = Math.min(...mas);
    // Compression-Ratio: 0 = total flat, 1 = stark gespreizt
    const compression = max > 0 ? (max - min) / max : 0;
    const zone =
      compression < 0.02 ? 'compressed' :
      compression > 0.08 ? 'expanded' : 'neutral';
    return { date: d.date, compression, zone };
  });
}
```

### 2.6 Miner Position Index (MPI) / Netflows

```ts
/**
 * MPI ≈ Miner-to-Exchange-Flows / MA(Flows)
 * Hoch in Kapitulation (Zwangsverkäufe), dann abruptes Austrocknen.
 * Daten: CryptoQuant / Glassnode miner_to_exchange
 */
export function calcMinerPositionIndex(
  minerToExchangeBtc: { date: string; value: number }[],
  maWindow = 365
): { date: string; mpi: number; zone: 'distribution' | 'neutral' | 'accumulation' }[] {
  return minerToExchangeBtc.map((d, i) => {
    const window = minerToExchangeBtc.slice(Math.max(0, i - maWindow + 1), i + 1);
    const ma = window.reduce((s, x) => s + x.value, 0) / window.length;
    const mpi = ma > 0 ? d.value / ma : 1;
    const zone =
      mpi > 2.0 ? 'distribution' :
      mpi < 0.5 ? 'accumulation' : 'neutral';
    return { date: d.date, mpi, zone };
  });
}
```

### 2.7 Kontext: MVRV / Realized Price

Kein reiner Miner-Indikator, aber: Realized Price konvergiert in Bärenmarkt-Tiefs oft mit Miner-Produktionskosten → beide Linien im Chart als Kontext-Band.

---

## 3. Aggregierte Kapitulations-Score & Zonen-Logik

```ts
export interface MinerZoneInput {
  spotPrice: number;
  breakeven: number;
  puell: number;
  hashRibbonSignal: 'capitulation' | 'buy' | 'neutral';
  difficultyCompression: 'compressed' | 'neutral' | 'expanded';
  mpiZone: 'distribution' | 'neutral' | 'accumulation';
  hashprice: number;
  hashpriceMa90: number;
}

export type MinerZone = 'capitulation' | 'transition' | 'profitable' | 'euphoria';

export function classifyMinerZone(i: MinerZoneInput): {
  zone: MinerZone;
  score: number; // 0 = max Kapitulation, 100 = max Profit/Euphorie
  flags: string[];
} {
  const flags: string[] = [];
  let score = 50;

  // Spot vs Breakeven
  const premium = i.breakeven > 0 ? (i.spotPrice - i.breakeven) / i.breakeven : 0;
  if (premium < -0.05) { score -= 25; flags.push('SPOT_BELOW_BREAKEVEN'); }
  else if (premium > 0.20) { score += 15; flags.push('SPOT_ABOVE_BREAKEVEN'); }

  // Puell
  if (i.puell < 0.5) { score -= 20; flags.push('PUELL_CAPITULATION'); }
  else if (i.puell > 4) { score += 20; flags.push('PUELL_EUPHORIA'); }

  // Hash Ribbon
  if (i.hashRibbonSignal === 'capitulation') { score -= 15; flags.push('HASH_RIBBON_CAPITULATION'); }
  if (i.hashRibbonSignal === 'buy') { score += 20; flags.push('HASH_RIBBON_BUY'); }

  // Difficulty Compression
  if (i.difficultyCompression === 'compressed') { score -= 10; flags.push('DIFFICULTY_COMPRESSION'); }

  // MPI
  if (i.mpiZone === 'distribution') { score -= 10; flags.push('MINER_DISTRIBUTION'); }
  if (i.mpiZone === 'accumulation') { score += 10; flags.push('MINER_ACCUMULATION'); }

  score = Math.max(0, Math.min(100, score));

  const zone: MinerZone =
    score < 30 ? 'capitulation' :
    score < 45 ? 'transition' :
    score > 80 ? 'euphoria' : 'profitable';

  return { zone, score, flags };
}
```

**Konsolidierungs-Maximum im Bärenmarkt** = Zone `capitulation` + Hash-Ribbon noch nicht auf `buy` + Difficulty compressed. Das ist die rote Markierung im Chart.

---

## 4. Chart-Visualisierung (wie BTC Technische Analyse)

### Layout (Recharts / Dual-Axis, analog bestehender TA-Charts)

```ts
export const minerZoneChartConfig = {
  // Panel 1 (Hauptchart) — analog Price+MA Chart
  main: {
    series: [
      { key: 'spot',        name: 'BTC Spot ($)',           color: '#3B82F6', yAxisId: 'left' },
      { key: 'breakeven',   name: 'Miner Breakeven ($)',     color: '#F97316', yAxisId: 'left', strokeDasharray: '6 4' },
      { key: 'realized',    name: 'Realized Price ($)',     color: '#94A3B8', yAxisId: 'left', strokeDasharray: '2 2' },
    ],
    // Hintergrund-Bänder
    referenceAreas: [
      {
        // dynamisch aus classifyMinerZone pro Timestamp
        when: 'zone === "capitulation"',
        fill: 'rgba(239, 68, 68, 0.18)',   // ROT
        label: 'Miner Kapitulation',
      },
      {
        when: 'zone === "transition"',
        fill: 'rgba(234, 179, 8, 0.12)',   // GELB
        label: 'Übergang',
      },
      {
        when: 'zone === "profitable"',
        fill: 'rgba(34, 197, 94, 0.10)',   // GRÜN
        label: 'Profitabel',
      },
    ],
  },

  // Panel 2 — Hash Ribbons
  hashRibbons: {
    series: [
      { key: 'hashrate', name: 'Hashrate (EH/s)', color: '#64748B' },
      { key: 'ma30',     name: 'MA30',            color: '#22C55E' },
      { key: 'ma60',     name: 'MA60',            color: '#EF4444' },
    ],
    markers: [
      { when: 'signal === "buy"',           shape: 'triangle', color: '#22C55E', label: 'Hash Ribbon Buy' },
      { when: 'signal === "capitulation"',  shape: 'circle',   color: '#EF4444', label: 'Capitulation' },
    ],
  },

  // Panel 3 — Puell + MPI
  oscillators: {
    series: [
      { key: 'puell', name: 'Puell Multiple', color: '#A855F7', yAxisId: 'left' },
      { key: 'mpi',   name: 'Miner Position Index', color: '#06B6D4', yAxisId: 'right' },
    ],
    referenceLines: [
      { y: 0.5,  label: 'Puell Kapitulation', stroke: '#EF4444' },
      { y: 4.0,  label: 'Puell Euphorie',     stroke: '#F59E0B' },
    ],
  },
};
```

### UI-Komponente (Skizze Section13Miner)

```tsx
// client/src/pages/btc/Section13Miner.tsx
// Struktur analog zu bestehenden TA-Sections (Price + Indikator-Panels)

export function Section13Miner({ data, minerData, loading, error }: Props) {
  // minerData = {
  //   series: Array<{ date, spot, breakeven, realized, hashrate, ma30, ma60,
  //                   puell, mpi, zone, hashRibbonSignal }>
  //   latest: MinerZoneInput & { zone, score, flags }
  // }

  return (
    <section>
      <Header title="Miner-Zone: Profitabilität & Kapitulation" />

      {/* Zone-Badge */}
      <ZoneBadge zone={minerData.latest.zone} score={minerData.latest.score} />

      {/* Panel 1: Spot vs Breakeven + farbige Zonen-Bänder */}
      <MinerMainChart series={minerData.series} />

      {/* Panel 2: Hash Ribbons mit Buy/Capitulation-Markern */}
      <HashRibbonChart series={minerData.series} />

      {/* Panel 3: Puell + MPI */}
      <MinerOscillatorChart series={minerData.series} />

      {/* Metrik-Karten */}
      <MetricRow>
        <MetricCard label="Puell" value={…} tone={puell < 0.5 ? 'danger' : 'neutral'} />
        <MetricCard label="Breakeven" value={…} />
        <MetricCard label="Hashprice $/TH/day" value={…} />
        <MetricCard label="Hash Ribbon" value={signal} />
      </MetricRow>

      <FlagsList flags={minerData.latest.flags} />
    </section>
  );
}
```

---

## 5. Datenquellen

| Serie | Quelle (Beispiele) |
|-------|--------------------|
| Hashrate | Blockchain.com Charts API, mempool.space, Glassnode |
| Difficulty | mempool.space `/api/v1/mining/difficulty-adjustments`, Node |
| BTC Price | FMP / Yahoo / bestehende BTC-Pipeline |
| Miner-to-Exchange Flows | CryptoQuant, Glassnode (API-Key) |
| Daily Fees | mempool.space, blockchain.com |
| Strompreis / Effizienz | Annahmen konfigurierbar (Default 0.06 $/kWh, 30 J/TH Mix) |

```ts
// server/btc/miner-metrics.ts (neu, < 80 KB)
export async function buildMinerSeries(from: string, to: string): Promise<MinerSeriesPoint[]> {
  // 1. Hashrate + Difficulty + Price parallel fetchen
  // 2. calcHashRibbons, calcPuellMultiple, calcBreakevenPrice, …
  // 3. classifyMinerZone pro Tag
  // 4. return series + latest
}
```

---

## 6. Zyklischer Ablauf (Halving → Kapitulation → Buy)

```
Halving
  → Block-Reward /2
  → Hashprice bricht ein (wenn Kurs nicht sofort kompensiert)
  → Spot fällt unter Breakeven  ──┐
  → Puell < 0.5                   ├── 🔴 KAPITULATIONSZONE
  → Hash Ribbon: MA30 < MA60      │
  → MPI hoch (Zwangsverkäufe)     │
  → Difficulty Compression        ─┘
  → schwache Miner offline
  → Difficulty/Hashrate sinkt
  → Breakeven-Linie folgt nach unten
  → MA30 kreuzt MA60 von unten  → 🟢 HASH RIBBON BUY
  → Konsolidierungs-Maximum vorbei, Bärenmarkt-Tief oft nahe
```

---

## 7. Umsetzungsschritte

- [ ] `client/src/lib/btc/minerMetrics.ts` — alle calc*-Funktionen (unit-testbar)
- [ ] `server/btc/miner-metrics.ts` — Daten-Fetch + `buildMinerSeries`
- [ ] `Section13Miner.tsx` — 3 Panels + ZoneBadge + MetricCards (analog TA-Sections)
- [ ] Chart: ReferenceAreas für rot/gelb/grün aus `zone`-Feld
- [ ] Konfigurierbare Fleet-Annahmen (Strompreis, J/TH) in UI
- [ ] Anbindung an bestehenden BTC-Dashboard Section-Switch (`case 13`)

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
