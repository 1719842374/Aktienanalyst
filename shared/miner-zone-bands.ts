/**
 * Gemeinsame Zonen-Bänder für BTC Section 13 und Gold Sektion 9.
 *
 * Geteilt ist die Darstellung der drei Zeit-Zonen über die ganze Reihe:
 * Mehrheits-Glättung (Fenster 7, Gleichstand = zuerst gesehene Zone),
 * die Segmente für die Recharts-Bänder und die Farben aus WORK_BTC_MINER.md §4.
 * Die Tageszone (latest) bleibt ungeglättet; geglättet werden nur die Bänder.
 *
 * Nicht geteilt, weil die Eingänge verschieden sind:
 * - Breakeven: BTC aus Hashrate, Block-Reward und Strom (`calcBreakevenPrice`).
 *   Gold ist der Quartals-AISC (Ø NEM/B/AEM), keine Hashprice.
 * - Score: BTC ist die Punktetabelle in `classifyMinerZone` (Puell, Hash Ribbon,
 *   Difficulty, MPI). Gold hat diese Reihen nicht. Der Gold-Score ist der
 *   Perzentil-Rang des Spot/AISC-Multiples in `buildGoldMinerZone`.
 */
export type MinerBandZone = "capitulation" | "transition" | "profitable" | "euphoria";

export const MINER_ZONE_SMOOTH_WINDOW = 7;

/** Farben nach WORK_BTC_MINER.md §4. Alpha sitzt im rgba, beide Charts nutzen denselben Wert. */
export const MINER_ZONE_BAND_FILL: Record<MinerBandZone, string> = {
  capitulation: "rgba(239, 68, 68, 0.18)",
  transition: "rgba(234, 179, 8, 0.12)",
  profitable: "rgba(34, 197, 94, 0.10)",
  euphoria: "rgba(168, 85, 247, 0.12)",
};

export interface MinerZoneBandSegment<T extends string = MinerBandZone> {
  x1: string;
  x2: string;
  zone: T;
}

/**
 * Mehrheits-Zone über ein Fenster. null bleibt null.
 * Gleichstand: die zuerst im Fenster gesehene Zone (Einfügereihenfolge, `>`).
 */
export function smoothMinerZoneBands<T extends string>(
  zones: readonly (T | null)[],
  window = MINER_ZONE_SMOOTH_WINDOW,
): (T | null)[] {
  return zones.map((z, i) => {
    if (z == null) return null;
    const slice = zones.slice(Math.max(0, i - window + 1), i + 1).filter((x): x is T => x != null);
    if (slice.length === 0) return z;
    const counts = new Map<T, number>();
    for (const s of slice) counts.set(s, (counts.get(s) ?? 0) + 1);
    let best: T = z;
    let bestCount = -1;
    counts.forEach((count, zone) => {
      if (count > bestCount) {
        best = zone;
        bestCount = count;
      }
    });
    return best;
  });
}

/** Aufeinanderfolgende Tage derselben geglätteten Zone, eine Fläche je Abschnitt. */
export function buildMinerZoneBandSegments<T extends string>(
  dates: readonly string[],
  smoothed: readonly (T | null)[],
): MinerZoneBandSegment<T>[] {
  const segments: MinerZoneBandSegment<T>[] = [];
  let current: MinerZoneBandSegment<T> | null = null;
  for (let i = 0; i < dates.length; i++) {
    const zone = smoothed[i];
    if (zone == null) {
      current = null;
      continue;
    }
    if (current && current.zone === zone) current.x2 = dates[i];
    else {
      current = { x1: dates[i], x2: dates[i], zone };
      segments.push(current);
    }
  }
  return segments;
}
