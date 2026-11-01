/**
 * FW-14 (Future_Work.md §4.1, Z.112–116): QE/QT-Regime-Bänder für den BTC-Chart — reine Anzeige.
 * Regel und Schwellen kommen unverändert aus BTC_LIQUIDITY_CONFIG.walcl (13W-Änderung > +1,5 % = QE,
 * < −1,0 % = QT, sonst neutral), damit Band und Liquiditätsblock dieselbe Einordnung zeigen.
 * Kein Gate BTC_QE_QT_REGIME, kein Einfluss auf GIS/Score.
 */
import { BTC_LIQUIDITY_CONFIG } from "./btc-liquidity";

export type QeQtRegime = "qe" | "qt" | "neutral";

export interface QeQtSegment { x1: string; x2: string; regime: QeQtRegime }

export const QE_QT_COLORS: Record<QeQtRegime, string> = { qe: "#22c55e", qt: "#ef4444", neutral: "#9ca3af" };
export const QE_QT_LABELS: Record<QeQtRegime, string> = { qe: "QE (Bilanz wächst)", qt: "QT (Bilanz schrumpft)", neutral: "neutral" };

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * 13W-Änderung je Kurstag aus der (auf Kurstage vorwärts gefüllten) WALCL-Reihe in Bio. USD.
 * Vergleichswert = letzter WALCL-Wert an oder vor Datum − 91 Tage. Fehlt er → null (kein Band).
 */
export function walcl13wChangeByDate(rows: ReadonlyArray<{ date: string; walcl?: number | null }>): { date: string; changePct: number | null }[] {
  const pts = rows.filter(r => r.walcl != null && Number.isFinite(r.walcl) && (r.walcl as number) > 0)
    .map(r => ({ date: r.date, v: r.walcl as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const lookbackDays = BTC_LIQUIDITY_CONFIG.walcl.lookbackObs * 7;
  let j = -1;
  return pts.map(p => {
    const cutoff = ms(p.date) - lookbackDays * DAY;
    while (j + 1 < pts.length && ms(pts[j + 1].date) <= cutoff) j++;
    if (j < 0 || cutoff - ms(pts[j].date) > 14 * DAY) return { date: p.date, changePct: null };
    return { date: p.date, changePct: (p.v / pts[j].v - 1) * 100 };
  });
}

export function qeQtRegimeOf(changePct: number | null): QeQtRegime | null {
  if (changePct == null || !Number.isFinite(changePct)) return null;
  const c = BTC_LIQUIDITY_CONFIG.walcl;
  return changePct > c.upPct ? "qe" : changePct < c.downPct ? "qt" : "neutral";
}

/** Zusammenhängende Regime-Abschnitte (x1/x2 = Kurstage), für ReferenceArea auf der Datumsachse. */
export function qeQtSegments(rows: ReadonlyArray<{ date: string; walcl?: number | null }>): QeQtSegment[] {
  const out: QeQtSegment[] = [];
  for (const { date, changePct } of walcl13wChangeByDate(rows)) {
    const regime = qeQtRegimeOf(changePct);
    const last = out[out.length - 1];
    if (regime == null) continue;
    if (last && last.regime === regime) last.x2 = date;
    else out.push({ x1: last ? last.x2 : date, x2: date, regime });
  }
  return out;
}
