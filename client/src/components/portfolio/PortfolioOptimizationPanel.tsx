/**
 * PortfolioOptimizationPanel — EIN Block für CAPM-Zielgewichte + Kelly,
 * automatisch ab 2 offenen Positionen (Auftrag 10.08.2026, "Portfolio-Engine
 * – eine Optimierung ab 2 Positionen").
 *
 * Ersetzt die vormals getrennten Bloecke "Kandidaten (manuelle Eingabe)" und
 * "CAPM/Kelly-Kennzahlen" in PortfolioPage.tsx -- liest AUSSCHLIESSLICH aus
 * den echten Investments-Positionen (+ optionalen Overrides pro Zeile), keine
 * zweite, parallel gepflegte Kandidaten-Tabelle mehr.
 */
import { useMemo } from "react";
import { Info, AlertTriangle } from "lucide-react";
import { computePortfolioFromPositions, MIN_POSITIONS_FOR_OPTIMIZATION, type EnginePositionInput } from "@/lib/portfolio/engine";
import type { PortfolioPosition } from "@/lib/portfolio/positions";
import type { PricePoint } from "@/lib/portfolio/covariance";

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}
function fmtEur(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}
function fmtSharpe(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return x.toFixed(3);
}

const MODE_LABELS: Record<string, string> = {
  A: "Modus A — Max-Sharpe (w ∝ Σ⁻¹μ̃, long-only)",
  B: "Modus B — Risk-Parity (w_i ∝ 1/σ_i)",
  C: "Modus C — Score-Tilt (Risk-Parity-Basis × Score)",
  "kelly-only": "Kelly-only (kein Basket-Optimierer)",
};

export default function PortfolioOptimizationPanel({
  positions,
  lastPriceByTicker,
  historicalPricesByTicker,
  rf,
  capital,
  maxWeight,
  kellyFraction,
  kellyMaxF,
}: {
  positions: PortfolioPosition[];
  lastPriceByTicker: Record<string, number | null | undefined>;
  historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined>;
  rf: number;
  capital: number;
  maxWeight: number;
  kellyFraction: number;
  kellyMaxF: number;
}) {
  const openPositions = useMemo(() => positions.filter(p => p.status === "open" && p.side === "long"), [positions]);

  const enginePositions: EnginePositionInput[] = useMemo(() => openPositions.map(p => ({
    ticker: p.ticker.toUpperCase(),
    qty: p.qty,
    entryPrice: p.entryPrice,
    lastPrice: lastPriceByTicker[p.ticker.toUpperCase()],
    side: p.side,
    muOverride: p.muOverride,
    sigmaOverride: p.sigmaOverride,
    scoreOverride: p.scoreOverride,
  })), [openPositions, lastPriceByTicker]);

  const historicalPricesForEngine: Record<string, PricePoint[] | undefined> = useMemo(() => {
    const map: Record<string, PricePoint[] | undefined> = {};
    for (const p of openPositions) {
      map[p.ticker.toUpperCase()] = historicalPricesByTicker[p.ticker.toUpperCase()];
    }
    return map;
  }, [openPositions, historicalPricesByTicker]);

  const result = useMemo(() => computePortfolioFromPositions({
    positions: enginePositions,
    historicalPricesByTicker: historicalPricesForEngine,
    rf, capital, maxWeight, kellyFraction, kellyMaxF,
  }), [enginePositions, historicalPricesForEngine, rf, capital, maxWeight, kellyFraction, kellyMaxF]);

  if (result.status === "insufficient_positions") {
    return (
      <div className="bg-muted/20 rounded-xl border border-dashed border-border p-6 text-center">
        <Info className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Mindestens {MIN_POSITIONS_FOR_OPTIMIZATION} offene Long-Positionen für die automatische CAPM/Kelly-Optimierung erforderlich
          (aktuell: {openPositions.length}).
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">Positionen oben in „Investments" hinzufügen.</p>
      </div>
    );
  }

  if (result.status === "insufficient_history") {
    return (
      <div className="bg-amber-500/5 rounded-xl border border-dashed border-amber-500/30 p-6 text-center">
        <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-500">Nicht genug Kurs-Historie für eine belastbare Optimierung.</p>
        {result.flags.map((f, i) => (
          <p key={i} className="text-xs text-muted-foreground mt-1">{f}</p>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Optimierung — CAPM + Kelly (automatisch ab {MIN_POSITIONS_FOR_OPTIMIZATION} Positionen)</h3>
        <p className="text-[10px] text-muted-foreground">{result.mode ? MODE_LABELS[result.mode] : "—"}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Sharpe_p (optimiert)</div>
          <div className="text-xl font-bold tabular-nums">{fmtSharpe(result.sharpePortfolio)}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Sharpe_equal (1/n)</div>
          <div className="text-xl font-bold tabular-nums">{fmtSharpe(result.sharpeEqualWeight)}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Δ vs. Equal-Weight</div>
          <div className={`text-xl font-bold tabular-nums ${(result.deltaVsEqual ?? 0) > 0 ? "text-emerald-500" : (result.deltaVsEqual ?? 0) < 0 ? "text-red-500" : ""}`}>
            {fmtSharpe(result.deltaVsEqual)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border/50">
              <th className="text-left py-2 px-2">Ticker</th>
              <th className="text-right py-2 px-2">μ</th>
              <th className="text-right py-2 px-2">σ</th>
              <th className="text-right py-2 px-2">w% CAPM (Ziel)</th>
              <th className="text-right py-2 px-2">w% Ist (Marktwert)</th>
              <th className="text-right py-2 px-2">Basket-€</th>
              <th className="text-right py-2 px-2">Sharpe_i</th>
              <th className="text-right py-2 px-2">Kelly %</th>
              <th className="text-right py-2 px-2">Kelly-€</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(row => (
              <tr key={row.ticker} className="border-b border-border/30">
                <td className="py-2 px-2 font-mono font-medium">{row.ticker}</td>
                <td className="py-2 px-2 text-right tabular-nums">
                  {fmtPct(row.mu)}{row.muSource === "override" && <span className="text-primary ml-1" title="manueller Override">*</span>}
                </td>
                <td className="py-2 px-2 text-right tabular-nums">
                  {fmtPct(row.sigma)}{row.sigmaSource === "override" && <span className="text-primary ml-1" title="manueller Override">*</span>}
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtPct(row.weightCapm)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{fmtPct(row.weightMarket)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtEur(row.basketAmount)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtSharpe(row.sharpeSingle)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtPct(row.kelly?.fCapped)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmtEur(row.kelly?.amountEuro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground">
        <span className="text-primary">*</span> manueller Override (statt aus Kurs-Historie berechnet) · <strong>w% CAPM</strong> = Zielstruktur des risikobehafteten Portfolios (Summe 100%) · <strong>Kelly %/€</strong> = separater Kapitaleinsatz-Hinweis pro Titel bezogen auf Gesamtkapital K, ersetzt NICHT die CAPM-Diversifikation.
      </p>

      {result.flags.length > 0 && (
        <ul className="text-[10px] text-muted-foreground space-y-0.5 border-t border-border/30 pt-2">
          {result.flags.map((f, i) => (
            <li key={i} className="flex items-start gap-1">
              <span className="text-amber-500/70 shrink-0">⚠</span> {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
