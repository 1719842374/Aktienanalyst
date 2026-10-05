/**
 * Buffett-Quote ohne feste Schwellen und ohne feste Auslandsquote.
 *
 * B = M / BIP = π × Q, mit π = Gewinn / BIP und Q = M / Gewinn.
 * Der Zehnjahresgewinn hält ein einzelnes Rezessionsquartal aus dem Multiple.
 * Q* ist der Median von Q bis zum festen Stichprobenende, gerechnet aus der
 * Reihe, nicht als eingesetzte Zahl.
 * Der Auslandsanteil s ist der Anteil des VGR-Gewinns aus dem Ausland.
 * Er skaliert die Quote, er steckt nicht im Multiple.
 * Das Zinsmodell ist Gordon: Ausschüttung / (Rendite − Gewinnwachstum),
 * alles gemessen. Ist der Nenner zu klein, bleibt das Modell leer.
 */

export const SMOOTH_QUARTERS = 40;
export const Q_STAR_END = "2019-12-31";
/** Unter dieser Spanne ist 1/(r−g) numerisch unbrauchbar. Keine Bewertungsschwelle. */
export const MIN_DISCOUNT_GAP = 0.005;

export interface BuffettObservation {
  date: string;
  marketCapBn: number;
  gdpBn: number;
  afterTaxProfitBn: number | null;
  domesticProfitBn: number | null;
  foreignProfitBn: number | null;
  dividendBn: number | null;
  yieldPct: number | null;
}

export interface BuffettPoint {
  date: string;
  rawPct: number | null;
  /** Quote nach Abzug des gemessenen Auslandsgewinnanteils. */
  geoPct: number | null;
  /** Q* × aktueller Zehnjahresgewinn / BIP. Steigt mit dem Gewinn, nicht mit dem Multiple. */
  justifiedPct: number | null;
  foreignShare: number | null;
  multiple: number | null;
  qStar: number | null;
  /** (Q / Q* − 1) in Prozentpunkten der Relation. Das ist der Bewertungsteil. */
  gapPct: number | null;
  yieldPct: number | null;
  profitCagrPct: number | null;
  payout: number | null;
  gordonMultiple: number | null;
  gordonPct: number | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function windowNumbers(
  rows: BuffettObservation[],
  end: number,
  pick: (row: BuffettObservation) => number | null,
): number[] | null {
  if (end + 1 < SMOOTH_QUARTERS) return null;
  const out: number[] = [];
  for (let i = end - SMOOTH_QUARTERS + 1; i <= end; i++) {
    const value = pick(rows[i]);
    if (value == null || !Number.isFinite(value)) return null;
    out.push(value);
  }
  return out;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildBuffettSeries(rows: BuffettObservation[]): BuffettPoint[] {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const draft: Array<Omit<BuffettPoint, "qStar" | "justifiedPct" | "gapPct" | "gordonPct"> & {
    earningsBn: number | null;
    gordonMultiple: number | null;
  }> = [];

  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    const earnings = windowNumbers(ordered, i, item => item.afterTaxProfitBn);
    const earningsBn = earnings ? mean(earnings) : null;
    const rawPct = row.gdpBn > 0 && Number.isFinite(row.marketCapBn)
      ? (row.marketCapBn / row.gdpBn) * 100
      : null;
    const multiple = earningsBn != null && earningsBn > 0 ? row.marketCapBn / earningsBn : null;

    const domestic = windowNumbers(ordered, i, item => item.domesticProfitBn);
    const foreign = windowNumbers(ordered, i, item => item.foreignProfitBn);
    let foreignShare: number | null = null;
    if (domestic && foreign) {
      const domesticSum = domestic.reduce((sum, value) => sum + value, 0);
      const foreignSum = foreign.reduce((sum, value) => sum + value, 0);
      const total = domesticSum + foreignSum;
      foreignShare = total > 0 ? foreignSum / total : null;
    }
    const geoPct = rawPct != null && foreignShare != null ? rawPct * (1 - foreignShare) : null;

    const dividends = windowNumbers(ordered, i, item => item.dividendBn);
    const payout = dividends && earningsBn != null && earningsBn > 0 ? mean(dividends) / earningsBn : null;
    const earlier = i >= SMOOTH_QUARTERS ? draft[i - SMOOTH_QUARTERS]?.earningsBn ?? null : null;
    let profitCagrPct: number | null = null;
    if (earningsBn != null && earlier != null && earlier > 0 && earningsBn > 0) {
      profitCagrPct = (Math.pow(earningsBn / earlier, 1 / 10) - 1) * 100;
    }
    const yieldPct = row.yieldPct != null && Number.isFinite(row.yieldPct) ? row.yieldPct : null;
    let gordonMultiple: number | null = null;
    if (payout != null && payout > 0 && profitCagrPct != null && yieldPct != null) {
      const gap = yieldPct / 100 - profitCagrPct / 100;
      if (gap > MIN_DISCOUNT_GAP) gordonMultiple = payout / gap;
    }

    draft.push({
      date: row.date,
      rawPct: rawPct == null ? null : round1(rawPct),
      geoPct: geoPct == null ? null : round1(geoPct),
      foreignShare: foreignShare == null ? null : round3(foreignShare),
      multiple: multiple == null ? null : round1(multiple),
      yieldPct: yieldPct == null ? null : round1(yieldPct),
      profitCagrPct: profitCagrPct == null ? null : round1(profitCagrPct),
      payout: payout == null ? null : round3(payout),
      gordonMultiple: gordonMultiple == null ? null : round1(gordonMultiple),
      earningsBn,
    });
  }

  const qStar = median(
    draft
      .filter(point => point.date <= Q_STAR_END && point.multiple != null)
      .map(point => point.multiple as number),
  );

  return draft.map(point => {
    const earningsBn = point.earningsBn;
    const row = ordered.find(item => item.date === point.date);
    const justified = qStar != null && earningsBn != null && row && row.gdpBn > 0
      ? (qStar * earningsBn / row.gdpBn) * 100
      : null;
    const gapPct = qStar != null && qStar > 0 && point.multiple != null
      ? (point.multiple / qStar - 1) * 100
      : null;
    const gordonPct = point.gordonMultiple != null && earningsBn != null && row && row.gdpBn > 0
      ? (point.gordonMultiple * earningsBn / row.gdpBn) * 100
      : null;
    return {
      date: point.date,
      rawPct: point.rawPct,
      geoPct: point.geoPct,
      justifiedPct: justified == null ? null : round1(justified),
      foreignShare: point.foreignShare,
      multiple: point.multiple,
      qStar: qStar == null ? null : round1(qStar),
      gapPct: gapPct == null ? null : round1(gapPct),
      yieldPct: point.yieldPct,
      profitCagrPct: point.profitCagrPct,
      payout: point.payout,
      gordonMultiple: point.gordonMultiple,
      gordonPct: gordonPct == null ? null : round1(gordonPct),
    };
  });
}
