/**
 * PortfolioAdvancedPanel — Black-Litterman + Portfolio-Monte-Carlo.
 *
 * Sprint D2 (SPRINT_D2_BLACK_LITTERMAN_PORTFOLIO_MC.md, Spec §16.9-16.11).
 * Rein additiv: neue Karte im bestehenden Portfolio-Bereich, ersetzt KEINE
 * bestehende Komponente (PortfolioOptimizationPanel/EfficientFrontierPanel
 * bleiben unverändert). Nutzt ausschließlich bereits vorhandene Bausteine:
 * - `buildCovariance()` (covariance.ts) für Σ/μ/σ
 * - `EngineResult.rows[].weightCapm` (engine.ts, bereits berechnet vom
 *   Aufrufer/PortfolioPage) für die CAPM-Zielgewichte
 * - `computeReverseOptimization`/`computeBlackLitterman` (blackLitterman.ts, NEU)
 * - `runPortfolioMonteCarlo`/`comparePortfolioWeightings` (portfolioMonteCarlo.ts, NEU)
 *
 * τ/Ω/λ/Iterationen sind UI-Regler (Policy-Parameter) -- niemals fest
 * verdrahtet, siehe Regression-Guard "Policy-Parameter niemals hardcoded".
 * Views (Q) kommen optional aus `viewsByTicker` (z.B. vom Aufrufer aus
 * DCF-Upside/Thesis-Strength abgeleitet) -- fehlt ein Ticker darin, bekommt
 * er schlicht KEINEN View (kein Platzhalter, Zahlen-Prinzip).
 */
import { useMemo, useState } from "react";
import { Info, AlertTriangle, Sparkles } from "lucide-react";
import { buildCovariance, type PricePoint } from "@/lib/portfolio/covariance";
import {
  computeReverseOptimization,
  computeBlackLitterman,
  DEFAULT_BL_POLICY,
  type ViewInput,
  type ViewInfluenceLevel,
} from "@/lib/portfolio/blackLitterman";
import { comparePortfolioWeightings, type PortfolioMonteCarloResult } from "@/lib/portfolio/portfolioMonteCarlo";

const MIN_TICKERS = 2;
const DEFAULT_MC_ITERATIONS = 5000;
const DEFAULT_MC_TRADING_DAYS = 252;

function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

const INFLUENCE_STYLE: Record<ViewInfluenceLevel, string> = {
  keine: "text-muted-foreground bg-muted/30",
  schwach: "text-emerald-500 bg-emerald-500/10",
  mittel: "text-amber-500 bg-amber-500/10",
  stark: "text-red-500 bg-red-500/10",
};

export interface PortfolioAdvancedPanelProps {
  /** Ticker im aktuellen Basket (P1 offene Positionen / P2 Watchlist / P3 Researcher). */
  tickers: string[];
  historicalPricesByTicker: Record<string, PricePoint[] | undefined>;
  /** Ist-Gewichte (Marktwert), Ticker -> Gewicht 0..1. */
  weightsCurrent: Record<string, number>;
  /** CAPM-Zielgewichte (aus engine.ts EngineRow.weightCapm), Ticker -> Gewicht 0..1. */
  weightsCapmTarget: Record<string, number>;
  /** Optionale View-Renditen je Ticker (aus Analyse: DCF-Upside/Thesis-Strength o.ä.),
   * NICHT von dieser Komponente erzeugt -- fehlt ein Ticker, gibt es keinen View für ihn. */
  viewsByTicker?: Record<string, { q: number; confidence?: "hoch" | "mittel" | "niedrig" } | undefined>;
}

export default function PortfolioAdvancedPanel({
  tickers,
  historicalPricesByTicker,
  weightsCurrent,
  weightsCapmTarget,
  viewsByTicker,
}: PortfolioAdvancedPanelProps) {
  // Policy-Regler -- alle als UI-State, niemals hardcodiert.
  const [lambda, setLambda] = useState(DEFAULT_BL_POLICY.lambda);
  const [tau, setTau] = useState(DEFAULT_BL_POLICY.tau);
  const [omegaScale, setOmegaScale] = useState(1); // Multiplikator auf die view-eigene Ω-Basis
  const [useViews, setUseViews] = useState(true);
  const [iterations, setIterations] = useState(DEFAULT_MC_ITERATIONS);
  const [tradingDays, setTradingDays] = useState(DEFAULT_MC_TRADING_DAYS);

  const uniqueTickers = useMemo(
    () => Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(Boolean))),
    [tickers],
  );

  const covariance = useMemo(() => buildCovariance(historicalPricesByTicker), [historicalPricesByTicker]);
  const covTickers = covariance.tickersAligned;

  const marketWeightsAligned = useMemo(
    () => covTickers.map(t => weightsCurrent[t] ?? null),
    [covTickers, weightsCurrent],
  );
  const capmWeightsAligned = useMemo(
    () => covTickers.map(t => weightsCapmTarget[t] ?? null),
    [covTickers, weightsCapmTarget],
  );

  const hasCompleteMarketWeights = marketWeightsAligned.every(w => w != null);
  const hasCompleteCapmWeights = capmWeightsAligned.every(w => w != null);

  // Reverse Optimization Π: bevorzugt aus Ist-Gewichten (Markt-Equilibrium-
  // Annahme), fällt auf CAPM-Zielgewichte zurück, falls Ist-Gewichte
  // unvollständig sind (z.B. P2/P3 Watchlist-Baskets ohne echten Marktwert).
  const referenceWeights = hasCompleteMarketWeights
    ? (marketWeightsAligned as number[])
    : hasCompleteCapmWeights
      ? (capmWeightsAligned as number[])
      : null;
  const referenceWeightsSource = hasCompleteMarketWeights ? "Ist-Gewichte" : hasCompleteCapmWeights ? "CAPM-Zielgewichte" : null;

  const reverseOpt = useMemo(() => {
    if (!referenceWeights || covTickers.length < MIN_TICKERS) return null;
    return computeReverseOptimization(covTickers, covariance.Sigma, referenceWeights, lambda);
  }, [covTickers, covariance.Sigma, referenceWeights, lambda]);

  const views: ViewInput[] = useMemo(() => {
    if (!useViews || !viewsByTicker) return [];
    const out: ViewInput[] = [];
    for (const t of covTickers) {
      const v = viewsByTicker[t];
      if (v == null || !Number.isFinite(v.q)) continue; // kein Raten bei fehlender Analyse
      // Ω aus Konfidenz abgeleitet (Basis-Varianz × Skalierungsfaktor-Regler):
      // hohe Konfidenz -> kleines Ω (starker View), niedrige Konfidenz -> großes Ω.
      const confidenceBaseOmega = v.confidence === "hoch" ? 0.01 : v.confidence === "niedrig" ? 0.10 : 0.04;
      out.push({ ticker: t, q: v.q, omega: confidenceBaseOmega * omegaScale });
    }
    return out;
  }, [useViews, viewsByTicker, covTickers, omegaScale]);

  const blResult = useMemo(() => {
    if (!reverseOpt || reverseOpt.pi.length === 0) return null;
    return computeBlackLitterman(covTickers, covariance.Sigma, reverseOpt.pi, views, tau);
  }, [covTickers, covariance.Sigma, reverseOpt, views, tau]);

  const mcComparison = useMemo(() => {
    if (covTickers.length < MIN_TICKERS || !hasCompleteMarketWeights || !hasCompleteCapmWeights) return null;
    return comparePortfolioWeightings({
      tickers: covTickers,
      mu: covariance.mu,
      sigma: covariance.sigma,
      Sigma: covariance.Sigma,
      weightsCurrent: marketWeightsAligned as number[],
      weightsCapmTarget: capmWeightsAligned as number[],
      iterations,
      tradingDays,
    });
  }, [covTickers, covariance.mu, covariance.sigma, covariance.Sigma, marketWeightsAligned, capmWeightsAligned, hasCompleteMarketWeights, hasCompleteCapmWeights, iterations, tradingDays]);

  if (uniqueTickers.length < MIN_TICKERS) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="status-advanced-minimum-tickers">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Mindestens {MIN_TICKERS} Ticker für Black-Litterman/Portfolio-Monte-Carlo nötig.</p>
      </div>
    );
  }

  if (covTickers.length < MIN_TICKERS) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground" data-testid="status-advanced-insufficient-history">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Nicht genug belastbare Kurs-Historie.</p>
          {covariance.flags.map((f, i) => <p key={i}>{f}</p>)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* === Policy-Regler (τ/Ω/λ, MC-Iterationen) === */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Black-Litterman & Portfolio-Monte-Carlo — Policy</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">λ (Risikoaversion)</label>
            <input type="number" step="0.1" min="0.1" value={lambda} onChange={e => setLambda(Number(e.target.value) || DEFAULT_BL_POLICY.lambda)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" data-testid="input-bl-lambda" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">τ (0,01–0,05)</label>
            <input type="number" step="0.005" min="0.001" max="0.5" value={tau} onChange={e => setTau(Number(e.target.value) || DEFAULT_BL_POLICY.tau)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" data-testid="input-bl-tau" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ω-Skalierung</label>
            <input type="number" step="0.1" min="0.05" value={omegaScale} onChange={e => setOmegaScale(Number(e.target.value) || 1)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" data-testid="input-bl-omega-scale" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">MC-Pfade</label>
            <input type="number" step="500" min="500" max="20000" value={iterations} onChange={e => setIterations(Math.max(500, Number(e.target.value) || DEFAULT_MC_ITERATIONS))}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" data-testid="input-mc-iterations" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Horizont (Handelstage)</label>
            <input type="number" step="21" min="21" max="1260" value={tradingDays} onChange={e => setTradingDays(Math.max(21, Number(e.target.value) || DEFAULT_MC_TRADING_DAYS))}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" data-testid="input-mc-trading-days" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={useViews} onChange={e => setUseViews(e.target.checked)} data-testid="checkbox-use-views" />
          Views aus Analyse-Daten einbeziehen ({views.length} aktiv von {viewsByTicker ? Object.keys(viewsByTicker).length : 0} verfügbar)
        </label>
      </div>

      {/* === Black-Litterman === */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="panel-black-litterman">
        <div>
          <h3 className="text-sm font-semibold">Black-Litterman — E[R]_BL</h3>
          <p className="text-[10px] text-muted-foreground">
            Reverse Optimization Π = λΣw (Basis: {referenceWeightsSource ?? "—"}) · E[R]_BL = [(τΣ)⁻¹+PᵀΩ⁻¹P]⁻¹·[(τΣ)⁻¹Π+PᵀΩ⁻¹Q]
          </p>
        </div>

        {!referenceWeights && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600">Weder vollständige Ist-Gewichte noch CAPM-Zielgewichte für alle Ticker mit Historie verfügbar — keine Π-Berechnung möglich.</p>
          </div>
        )}

        {blResult && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">View-Einfluss:</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${INFLUENCE_STYLE[blResult.viewInfluence]}`} data-testid="badge-view-influence">
                {blResult.viewInfluence}
              </span>
              <span className="text-[10px] text-muted-foreground">({blResult.viewsUsed} View(s) aktiv)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border/50">
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-right py-2 px-2">Π (Equilibrium)</th>
                    <th className="text-right py-2 px-2">E[R]_BL</th>
                    <th className="text-right py-2 px-2">|Δ|</th>
                  </tr>
                </thead>
                <tbody>
                  {blResult.tickers.map((t, i) => (
                    <tr key={t} className="border-b border-border/30">
                      <td className="py-2 px-2 font-mono font-medium">{t}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtPct(blResult.pi[i])}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtPct(blResult.expectedReturns[i])}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{fmtPct(blResult.deltaVsPi[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {blResult.flags.length > 0 && (
              <ul className="text-[10px] text-muted-foreground space-y-0.5 border-t border-border/30 pt-2">
                {blResult.flags.map((f, i) => <li key={i} className="flex items-start gap-1"><span className="text-amber-500/70 shrink-0">⚠</span> {f}</li>)}
              </ul>
            )}
          </>
        )}
      </div>

      {/* === Portfolio-Monte-Carlo === */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="panel-portfolio-mc">
        <div>
          <h3 className="text-sm font-semibold">Portfolio-Monte-Carlo — Cholesky-korrelierte Multi-Asset-GBM</h3>
          <p className="text-[10px] text-muted-foreground">{iterations} Pfade × {tradingDays} Handelstage · Ist-Gewichte vs. CAPM-Zielgewichte (gleiche μ/Σ)</p>
        </div>

        {!mcComparison && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600">Für den Vergleichslauf werden vollständige Ist- UND CAPM-Zielgewichte für alle Ticker mit Historie benötigt.</p>
          </div>
        )}

        {mcComparison && (
          <div className="grid md:grid-cols-2 gap-4">
            <McResultCard title="Ist-Gewichte" result={mcComparison.current} />
            <McResultCard title="CAPM-Ziel-Gewichte" result={mcComparison.capmTarget} />
          </div>
        )}
      </div>
    </div>
  );
}

function McResultCard({ title, result }: { title: string; result: PortfolioMonteCarloResult }) {
  if (result.status !== "ok") {
    return (
      <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">{title}</p>
        {result.flags.map((f, i) => <p key={i}>{f}</p>)}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2" data-testid={`mc-result-${title === "Ist-Gewichte" ? "current" : "capm"}`}>
      <p className="text-xs font-semibold">{title}</p>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="E[R]_P" value={fmtPct(result.expectedReturn)} />
        <Metric label="σ_P" value={fmtPct(result.stdDev)} />
        <Metric label="VaR 5%" value={fmtPct(result.var5)} negative />
        <Metric label="CVaR 5%" value={fmtPct(result.cvar5)} negative />
        <Metric label="P(R_P<0)" value={fmtPct(result.probNegative, 1)} />
        <Metric label="maxDD (mean)" value={fmtPct(result.maxDrawdownMean, 1)} negative />
      </div>
    </div>
  );
}

function Metric({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${negative ? "text-red-500" : ""}`}>{value}</div>
    </div>
  );
}
