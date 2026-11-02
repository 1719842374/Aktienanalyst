/**
 * QE/QT-Bänder aus der Fed-Bilanz. Rechnung: goldQeQtView (shared/gold-qe-qt.ts),
 * dieselbe Funktion wie der Gold-Chart. Hier nur Knopf, Flächen und die
 * Phasenzeile (Quelle + Datum). Kein Gate, kein Score.
 */
import { useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ReferenceArea } from "recharts";
import {
  goldQeQtView,
  type GoldQeQtView,
  type QeQtBand,
  type QeQtRegime,
  type WalclPoint,
} from "@shared/gold-qe-qt";

export const QE_QT_SOURCE = "FRED WALCL (H.4.1)";

export const QE_FILL: Record<QeQtRegime, string> = {
  expansion: "#22c55e",
  contraction: "#ef4444",
  neutral: "#94a3b8",
};

export const QE_LABEL: Record<QeQtRegime, string> = {
  expansion: "Ausweitung",
  contraction: "Abbau",
  neutral: "neutral",
};

const CHIP =
  "inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] font-mono transition-colors sm:min-h-0 sm:py-0.5 sm:text-[10px]";

export interface QeQtPhaseCaption {
  regime: QeQtRegime;
  label: string;
  from: string;
  to: string;
  source: string;
  /** Letztes WALCL-Beobachtungsdatum ≤ Phasenende. null = nur die Phasendaten. */
  asOf: string | null;
}

export function qeQtUnavailableText(reason: string | null, asset: "btc" | "gold"): string | null {
  if (!reason) return null;
  if (asset === "btc" && reason.includes("Gold-Historie")) return "n/a — WALCL fehlt in der BTC-Historie";
  return reason;
}

/** Letztes Beobachtungsdatum, das am Phasenende schon veröffentlicht ist. */
export function walclAsOfOn(observations: readonly { date: string }[] | undefined, to: string): string | null {
  if (!observations?.length || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  let hit: string | null = null;
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sorted) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (row.date > to) break;
    hit = row.date;
  }
  return hit;
}

export function qeQtPhaseCaptions(
  view: GoldQeQtView,
  source: string,
  observations?: readonly { date: string }[],
): QeQtPhaseCaption[] {
  return view.bands.map(band => ({
    regime: band.regime,
    label: QE_LABEL[band.regime],
    from: band.x1,
    to: band.x2,
    source,
    asOf: walclAsOfOn(observations, band.x2) ?? band.x2,
  }));
}

export function qeQtPhaseText(phase: QeQtPhaseCaption): string {
  return `${phase.label} ${phase.from}–${phase.to} · ${phase.source} · ${phase.asOf ?? phase.to}`;
}

export function useQeQtOverlay(
  points: readonly WalclPoint[],
  visibleDates: readonly string[],
  observations?: readonly { date: string }[],
): { view: GoldQeQtView; phases: QeQtPhaseCaption[] } {
  return useMemo(() => {
    const view = goldQeQtView(points, visibleDates);
    return { view, phases: qeQtPhaseCaptions(view, QE_QT_SOURCE, observations) };
  }, [points, visibleDates, observations]);
}

export function QeQtBandsToggle({
  view,
  show,
  onToggle,
  asset,
  testId = "toggle-qe-qt",
}: {
  view: GoldQeQtView;
  show: boolean;
  onToggle: () => void;
  asset: "btc" | "gold";
  testId?: string;
}) {
  const reason = qeQtUnavailableText(view.unavailableReason, asset);
  if (reason) {
    return (
      <span className={`${CHIP} cursor-not-allowed border-dashed border-border text-muted-foreground opacity-50`} title={reason} data-testid={`${testId}-na`}>
        QE/QT n/a
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${CHIP} ${show ? "border-emerald-500 text-emerald-400" : "border-border text-muted-foreground opacity-50"}`}
      title="Hintergrund nach dem Perzentil der eigenen 91-Tage-WALCL-Änderung. Grün Ausweitung, rot Abbau, grau dazwischen. Kein Gate, kein GIS."
      data-testid={testId}
      aria-pressed={show}
    >
      {show ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
      QE/QT-Bänder
    </button>
  );
}

/**
 * Flächen als Array, nicht als Komponente. Recharts erkennt ReferenceArea nur
 * als direktes Kind (findAllByType steigt nicht in eigene Komponenten).
 */
export function qeQtBandNodes(bands: readonly QeQtBand[], show: boolean) {
  if (!show || bands.length === 0) return null;
  return bands.map(band => (
    <ReferenceArea
      key={`qe-${band.x1}-${band.regime}`}
      x1={band.x1}
      x2={band.x2}
      fill={QE_FILL[band.regime]}
      fillOpacity={band.regime === "neutral" ? 0.05 : 0.14}
      stroke="none"
      ifOverflow="hidden"
    />
  ));
}

export function QeQtPhaseList({
  phases,
  unavailable,
  testId = "qe-qt-phases",
}: {
  phases: readonly QeQtPhaseCaption[];
  unavailable: string | null;
  testId?: string;
}) {
  if (unavailable) {
    return (
      <div className="mt-1 text-[10px] text-muted-foreground break-words" data-testid={testId}>
        {unavailable} · {QE_QT_SOURCE}
      </div>
    );
  }
  if (phases.length === 0) return null;
  return (
    <div className="mt-1 max-h-24 overflow-y-auto text-[10px] text-muted-foreground break-words" data-testid={testId}>
      {phases.map(phase => (
        <div key={`${phase.regime}-${phase.from}-${phase.to}`} data-testid="qe-qt-phase">
          {qeQtPhaseText(phase)}
        </div>
      ))}
    </div>
  );
}

/** Bitcoin schüttet keine Bardividende aus. Der Aktien-Chip bleibt unangetastet. */
export const BTC_DIVIDEND_NA =
  "n/a — Bitcoin schüttet keine Dividende aus (kein Emittent, keine Bardividende). Quelle: keine Dividendenereignisse; FMP /stable/dividends und Yahoo events=div gelten nur für Aktien.";

export function BtcDividendNa({ testId = "btc-dividend-na" }: { testId?: string }) {
  return (
    <span
      className={`${CHIP} cursor-not-allowed border-dashed border-border text-muted-foreground opacity-50`}
      title={BTC_DIVIDEND_NA}
      data-testid={testId}
    >
      Div. Yield n/a
    </span>
  );
}
