/**
 * BTC Miner-Zone Metriken — Rechenlogik nach WORK_BTC_MINER.md §2 + §3.
 *
 * Reine, unit-testbare Funktionen ohne Fetch/DOM-Abhängigkeiten.
 * Datenquellen (Hashrate/Difficulty/Puell) liefert das Backend
 * (server/btc-miner.ts, mempool.space); die BTC-Preishistorie kommt aus der
 * bestehenden BTC-Pipeline (chartData in BTCAnalysis) — KEIN Perplexity-
 * Finance-Connector nötig.
 *
 * MPI (Miner Position Index, §2.6) ist bewusst NICHT berechnet: die dafür
 * nötigen Miner-to-Exchange-Flows erfordern CryptoQuant/Glassnode-API-Keys.
 * classifyMinerZone behandelt mpiZone='neutral' als "kein Signal" (±0 Punkte),
 * es wird also nichts mit einem Fake-Default verfälscht.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export type RibbonSignal = 'capitulation' | 'buy' | 'neutral';
export type MinerZone = 'capitulation' | 'transition' | 'profitable' | 'euphoria';
export type DifficultyZone = 'compressed' | 'neutral' | 'expanded';
export type MpiZone = 'distribution' | 'neutral' | 'accumulation';

export interface FleetAssumptions {
  /** Strompreis $/kWh — typ. 0.04–0.08 institutionell */
  electricityUsdPerKwh: number;
  /** Flotten-Effizienz J/TH — aktuelle Gen ~20–30, Misch-Flotte ~30–50 */
  efficiencyJPerTh: number;
  /** Sonstige Opex auf Energiekosten (0.10–0.20) */
  otherOpexPct: number;
}

/** Default = Antminer-S19-XP-Klasse, institutioneller Strompreis (wie server/btc-miner.ts REF_MINER) */
export const DEFAULT_FLEET: FleetAssumptions = {
  electricityUsdPerKwh: 0.05,
  efficiencyJPerTh: 21.5,
  otherOpexPct: 0.15,
};

/** Post-2024-Halving Block-Subvention */
export const BLOCK_REWARD_BTC = 3.125;
export const DAILY_BLOCKS = 144;

export interface MinerZoneInput {
  spotPrice: number;
  breakeven: number;
  puell: number | null;
  hashRibbonSignal: RibbonSignal;
  difficultyCompression: DifficultyZone;
  mpiZone: MpiZone;
}

export interface MinerZoneResult {
  zone: MinerZone;
  /** 0 = max. Kapitulation, 100 = max. Profit/Euphorie */
  score: number;
  flags: string[];
}

export interface MinerSeriesPoint {
  date: string;
  spot: number | null;
  breakeven: number;
  hashrate: number;
  ma30: number | null;
  ma60: number | null;
  ribbonSignal: RibbonSignal;
  /** = ma30 an Buy-Signal-Tagen, sonst null — für Scatter-Marker im gemeinsamen Datensatz */
  buyMarker: number | null;
  puell: number | null;
  zone: MinerZone | null;
}

// ─── §2.1 Hash Ribbons — Signal pro Tag ──────────────────────────────────────
/**
 * Kapitulation: MA30 < MA60 UND beide fallend.
 * Buy-Signal:   MA30 kreuzt MA60 von unten (Golden Cross der Hashrate).
 * Für Indizes < 60 (MA60-Warm-up) gibt es kein Signal.
 */
export function calcRibbonSignals(
  ma30: (number | null)[],
  ma60: (number | null)[]
): RibbonSignal[] {
  const out: RibbonSignal[] = [];
  for (let i = 0; i < ma30.length; i++) {
    let signal: RibbonSignal = 'neutral';
    const cur30 = ma30[i];
    const cur60 = ma60[i];
    const prev30 = i > 0 ? ma30[i - 1] : null;
    const prev60 = i > 0 ? ma60[i - 1] : null;
    if (i >= 60 && cur30 != null && cur60 != null && prev30 != null && prev60 != null) {
      const bothFalling = cur30 < prev30 && cur60 < prev60;
      if (cur30 < cur60 && bothFalling) signal = 'capitulation';
      // Golden Cross: vorher MA30 < MA60, jetzt MA30 >= MA60
      if (prev30 < prev60 && cur30 >= cur60) signal = 'buy';
    }
    out.push(signal);
  }
  return out;
}

// ─── §2.3 Hashprice (USD / TH/s / Tag) ───────────────────────────────────────
export function calcHashpriceUsd(params: {
  btcPrice: number;
  hashrateEHs: number;
  blockRewardBtc?: number;
  dailyFeesBtc?: number;
}): number {
  const reward = params.blockRewardBtc ?? BLOCK_REWARD_BTC;
  const dailyIssuanceUsd = (reward * DAILY_BLOCKS + (params.dailyFeesBtc ?? 0)) * params.btcPrice;
  const hashrateTHs = params.hashrateEHs * 1e6; // EH/s → TH/s
  return hashrateTHs > 0 ? dailyIssuanceUsd / hashrateTHs : 0;
}

// ─── §2.4 Mining Breakeven / Cost-of-Production ──────────────────────────────
/**
 * Leistung pro TH   = (J/TH) W  (J/TH ≈ W pro TH/s bei Dauerbetrieb)
 * kWh pro TH pro Tag = (J/TH) / 1000 * 24
 * cost_per_TH_day    = kWh/TH/Tag * Strompreis * (1 + Opex)
 * btc_per_TH_day     = tägliche Coins / Netz-TH
 * breakeven ($/BTC)  = cost_per_TH_day / btc_per_TH_day
 *
 * HINWEIS: Der Code-Block in WORK_BTC_MINER.md §2.4 enthält ein doppeltes
 * /1000 (kwhPerThDay = eff/1000*24/1000) — das ist ein 1000×-Fehler, der
 * Breakeven-Werte von ~$59 statt ~$59.000 liefert. Verifiziert über den
 * Plausibilitätstest in script/test-miner-metrics.ts und die Kommentarzeilen
 * derselben Spec ("powerKW_per_TH = efficiencyJPerTh / 1000; dailyKwh_per_TH
 * = powerKW_per_TH * 24" — dort korrekt ohne zweite Division).
 */
export function calcBreakevenPrice(params: {
  hashrateEHs: number;
  assumptions: FleetAssumptions;
  blockRewardBtc?: number;
  dailyFeesBtc?: number;
}): number {
  const { assumptions } = params;
  const kwhPerThDay = (assumptions.efficiencyJPerTh / 1000) * 24;
  const costPerThDay =
    kwhPerThDay * assumptions.electricityUsdPerKwh * (1 + assumptions.otherOpexPct);
  const dailyCoins = (params.blockRewardBtc ?? BLOCK_REWARD_BTC) * DAILY_BLOCKS + (params.dailyFeesBtc ?? 0);
  const hashrateTHs = params.hashrateEHs * 1e6;
  if (hashrateTHs <= 0) return 0;
  const btcPerThDay = dailyCoins / hashrateTHs;
  if (btcPerThDay <= 0) return 0;
  return costPerThDay / btcPerThDay;
}

// ─── §2.5 Difficulty-Compression (0–1, Backend) → Zonen-Label ────────────────
/**
 * server/btc-miner.ts liefert Compression als 0–1-Wert mit INVERTIERTER
 * Semantik gegenüber §2.5 der Spec: 1 = maximal komprimiert (bullish).
 * Mapping: >0.7 komprimiert, <0.4 gespreizt, sonst neutral.
 */
export function difficultyZoneFromCompression(compression: number): DifficultyZone {
  if (compression > 0.7) return 'compressed';
  if (compression < 0.4) return 'expanded';
  return 'neutral';
}

// ─── §3 Aggregierter Kapitulations-Score & Zonen-Logik ───────────────────────
export function classifyMinerZone(i: MinerZoneInput): MinerZoneResult {
  const flags: string[] = [];
  let score = 50;

  // Spot vs Breakeven
  const premium = i.breakeven > 0 ? (i.spotPrice - i.breakeven) / i.breakeven : 0;
  if (premium < -0.05) { score -= 25; flags.push('SPOT_BELOW_BREAKEVEN'); }
  else if (premium > 0.20) { score += 15; flags.push('SPOT_ABOVE_BREAKEVEN'); }

  // Puell — null = keine Daten = kein Signal
  if (i.puell != null) {
    if (i.puell < 0.5) { score -= 20; flags.push('PUELL_CAPITULATION'); }
    else if (i.puell > 4) { score += 20; flags.push('PUELL_EUPHORIA'); }
  }

  // Hash Ribbon
  if (i.hashRibbonSignal === 'capitulation') { score -= 15; flags.push('HASH_RIBBON_CAPITULATION'); }
  if (i.hashRibbonSignal === 'buy') { score += 20; flags.push('HASH_RIBBON_BUY'); }

  // Difficulty Compression
  if (i.difficultyCompression === 'compressed') { score -= 10; flags.push('DIFFICULTY_COMPRESSION'); }

  // MPI — 'neutral' wenn keine Datenquelle vorhanden (±0)
  if (i.mpiZone === 'distribution') { score -= 10; flags.push('MINER_DISTRIBUTION'); }
  if (i.mpiZone === 'accumulation') { score += 10; flags.push('MINER_ACCUMULATION'); }

  score = Math.max(0, Math.min(100, score));

  const zone: MinerZone =
    score < 30 ? 'capitulation' :
    score < 45 ? 'transition' :
    score > 80 ? 'euphoria' : 'profitable';

  return { zone, score, flags };
}

// ─── Serien-Builder: pro Tag Zone bestimmen (für Chart-Bänder) ────────────────
/**
 * Joint Hashrate-Serie (Backend) mit Preis- und Puell-Historie per Datum und
 * klassifiziert jeden Tag nach §3. Difficulty-Compression und MPI gehen pro Tag
 * als 'neutral' ein (Tages-Historie dafür nicht verfügbar) — die Zonen-Bänder
 * folgen damit §1: Spot vs Breakeven, Puell, Hash-Ribbon.
 */
export function buildMinerZoneSeries(params: {
  dates: string[];
  hashrateEH: number[];
  ma30: (number | null)[];
  ma60: (number | null)[];
  priceByDate: Map<string, number>;
  puellByDate: Map<string, number>;
  assumptions: FleetAssumptions;
}): MinerSeriesPoint[] {
  const { dates, hashrateEH, ma30, ma60, priceByDate, puellByDate, assumptions } = params;
  const ribbonSignals = calcRibbonSignals(ma30, ma60);
  const out: MinerSeriesPoint[] = [];

  // Forward-Fill: Preis- und Hashrate-Quellen haben teils versetzte Datums-
  // raster (Blockchain.com vs. mempool.space) — fehlende Einzeltage würden
  // sonst die Zonen-Bänder in hunderte 1-Tages-Segmente zerhacken.
  let lastSpot: number | null = null;
  let lastPuell: number | null = null;
  for (let idx = 0; idx < dates.length; idx++) {
    const date = dates[idx];
    const hashrate = hashrateEH[idx] ?? 0;
    const spotRaw = priceByDate.get(date) ?? null;
    if (spotRaw != null) lastSpot = spotRaw;
    const spot = spotRaw ?? lastSpot;
    const puellRaw = puellByDate.get(date) ?? null;
    if (puellRaw != null) lastPuell = puellRaw;
    const puell = puellRaw ?? lastPuell;
    // Breakeven auf MA30-Basis: tägliche Hashrate schwankt stark (Rauschen),
    // ökonomisch relevant ist die nachhaltige Hashrate — glättet die Kostenlinie
    // im Chart und stabilisiert die Zonen-Klassifikation.
    const breakeven = calcBreakevenPrice({ hashrateEHs: ma30[idx] ?? hashrate, assumptions });
    const ribbonSignal = ribbonSignals[idx] ?? 'neutral';

    let zone: MinerZone | null = null;
    if (spot != null && breakeven > 0) {
      zone = classifyMinerZone({
        spotPrice: spot,
        breakeven,
        puell,
        hashRibbonSignal: ribbonSignal,
        difficultyCompression: 'neutral',
        mpiZone: 'neutral',
      }).zone;
    }

    out.push({
      date,
      spot,
      breakeven,
      hashrate,
      ma30: ma30[idx] ?? null,
      ma60: ma60[idx] ?? null,
      ribbonSignal,
      buyMarker: ribbonSignal === 'buy' ? (ma30[idx] ?? null) : null,
      puell,
      zone,
    });
  }
  return out;
}

// ─── Zonen-Glättung (Anti-Flacker für Chart-Bänder) ─────────────────────────
/**
 * Tages-Zonen flippen durch das verrauschte Ribbon-Signal häufig hin und her
 * (»274 Mini-Segmente« im ersten Playwright-Test). Für die Chart-Bänder wird
 * die Mehrheits-Zone über ein rollierendes Fenster verwendet — die
 * Einzeltages-Klassifikation (latest) bleibt ungeglättet.
 */
export function smoothZones(
  zones: (MinerZone | null)[],
  window = 7
): (MinerZone | null)[] {
  return zones.map((z, i) => {
    if (z == null) return null;
    const slice = zones.slice(Math.max(0, i - window + 1), i + 1).filter((x): x is MinerZone => x != null);
    if (slice.length === 0) return z;
    const counts = new Map<MinerZone, number>();
    for (const s of slice) counts.set(s, (counts.get(s) ?? 0) + 1);
    let best: MinerZone = z;
    let bestCount = -1;
    for (const [zone, count] of counts) {
      if (count > bestCount) { best = zone; bestCount = count; }
    }
    return best;
  });
}

// ─── Zonen-Segmente für Recharts ReferenceAreas ───────────────────────────────
export interface ZoneSegment {
  x1: string;
  x2: string;
  zone: MinerZone;
}

/** Gruppiert aufeinanderfolgende Tage gleicher Zone zu Segmenten (mit Glättung). */
export function buildZoneSegments(series: MinerSeriesPoint[], smoothWindow = 7): ZoneSegment[] {
  const smoothed = smoothZones(series.map(p => p.zone), smoothWindow);
  const segments: ZoneSegment[] = [];
  let current: ZoneSegment | null = null;
  for (let i = 0; i < series.length; i++) {
    const zone = smoothed[i];
    if (zone == null) { current = null; continue; }
    if (current && current.zone === zone) {
      current.x2 = series[i].date;
    } else {
      current = { x1: series[i].date, x2: series[i].date, zone };
      segments.push(current);
    }
  }
  return segments;
}

/** Farben nach WORK_BTC_MINER.md §4 */
export const ZONE_FILL: Record<MinerZone, string> = {
  capitulation: 'rgba(239, 68, 68, 0.18)',
  transition: 'rgba(234, 179, 8, 0.12)',
  profitable: 'rgba(34, 197, 94, 0.10)',
  euphoria: 'rgba(168, 85, 247, 0.12)',
};

export const ZONE_LABEL: Record<MinerZone, string> = {
  capitulation: 'Miner-Kapitulation',
  transition: 'Übergang',
  profitable: 'Profitabel',
  euphoria: 'Euphorie',
};

// ─── Kapitulationszonen für Sektion 10 (Technische Analyse) ──────────────────
/**
 * Kapitulationsbedingung (Aufgabenspezifikation, exakt so) = TRUE wenn GLEICHZEITIG:
 *  - BTC Spot < Miner-Breakeven
 *  - Puell Multiple < 0.5
 *  - MA30(Hashrate) < MA60(Hashrate)  (Death Cross der Hash Ribbons)
 *
 * Bewusst STRIKTER als classifyMinerZone (§3, gewichteter Score): hier zählt
 * nur die reine boolesche UND-Verknüpfung der drei Rohsignale, ohne Score-
 * Gewichtung/Schwellen-Overlap. Separate, unit-testbare Funktion, damit die
 * bestehende classifyMinerZone-Logik (Section 13) unverändert bleibt.
 */
export interface CapitulationInput {
  date: string;
  spot: number | null;
  breakeven: number | null;
  puell: number | null;
  ma30: number | null;
  ma60: number | null;
}

export interface CapitulationPoint {
  date: string;
  capitulation: boolean;
}

/** Reine Tages-Klassifikation nach der exakten 3-fach-UND-Bedingung. */
export function calcCapitulationDay(p: CapitulationInput): boolean {
  if (p.spot == null || p.breakeven == null || p.puell == null || p.ma30 == null || p.ma60 == null) {
    return false;
  }
  return p.spot < p.breakeven && p.puell < 0.5 && p.ma30 < p.ma60;
}

/** Serie aller Tage → boolean (für Chart-Overlays und Segment-Bildung). */
export function calcCapitulationZones(points: CapitulationInput[]): CapitulationPoint[] {
  return points.map(p => ({ date: p.date, capitulation: calcCapitulationDay(p) }));
}

export interface CapitulationSegment {
  x1: string;
  x2: string;
}

/**
 * Gruppiert aufeinanderfolgende Kapitulationstage zu zusammenhängenden
 * Segmenten (analog buildZoneSegments, aber ohne Zonen-Glättung — die
 * Kapitulationsbedingung ist bereits eine strikte 3-fach-UND-Bedingung und
 * soll nicht weiter geglättet werden, um keine Tage fälschlich ein-/auszuschließen).
 */
export function buildCapitulationSegments(points: CapitulationPoint[]): CapitulationSegment[] {
  const segments: CapitulationSegment[] = [];
  let current: CapitulationSegment | null = null;
  for (const p of points) {
    if (!p.capitulation) { current = null; continue; }
    if (current) {
      current.x2 = p.date;
    } else {
      current = { x1: p.date, x2: p.date };
      segments.push(current);
    }
  }
  return segments;
}

/**
 * Ermittelt, ob die aktuellste (letzte) Kapitulationszone bereits beendet ist
 * (Spot > Breakeven UND Puell > 0.5 UND MA30 > MA60 am letzten Datenpunkt),
 * aber innerhalb der Serie mindestens eine Kapitulationszone existierte.
 * Wird genutzt, um die "Erwarteter Break-Even nach Konsolidierung"-Linie nur
 * dann zu zeigen, wenn eine Kapitulationsphase bereits durchlaufen und
 * beendet wurde (nicht während einer aktiven Kapitulation).
 */
export function isCapitulationResolved(points: CapitulationInput[]): boolean {
  if (points.length === 0) return false;
  const zones = calcCapitulationZones(points);
  const hadCapitulation = zones.some(z => z.capitulation);
  if (!hadCapitulation) return false;
  const last = points[points.length - 1];
  const lastZone = zones[zones.length - 1];
  if (lastZone.capitulation) return false; // noch aktive Kapitulation
  if (last.spot == null || last.breakeven == null || last.puell == null || last.ma30 == null || last.ma60 == null) {
    return false;
  }
  return last.spot > last.breakeven && last.puell > 0.5 && last.ma30 > last.ma60;
}
