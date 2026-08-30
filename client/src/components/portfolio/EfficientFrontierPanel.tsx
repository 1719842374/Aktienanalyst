/**
 * EfficientFrontierPanel — Phase 5 (WORK_RESEARCHER_PORTFOLIO_TEIL2 Kapitel N,
 * PORTFOLIO_PHASE5_FRONTIER.md).
 *
 * Wiederverwendbares Risiko/Rendite-Scatter (Recharts ScatterChart) für P1
 * (manuelles Portfolio), P2 (Watchlist-Portfolio) und P3 (Researcher-
 * Portfolios). Rein additiv -- ersetzt keine bestehende Komponente, wird von
 * PortfolioOverview.tsx / WatchlistPortfolioPanel.tsx / ResearcherPortfoliosPanel.tsx
 * jeweils als zusätzlicher Abschnitt eingebunden.
 *
 * Datenquelle für μ (erwartete Rendite je Ticker): historische annualisierte
 * Rendite aus buildCovariance() (covariance.ts) -- dieselbe Quelle, die
 * engine.ts bereits für EngineRow.mu (Historie-Fall) verwendet. KEIN neuer
 * Renditeschätzer, keine geschätzten Platzhalterwerte (Zahlen-Prinzip).
 *
 * Performance: die eigentliche Frontier-Berechnung (computeEfficientFrontier)
 * läuft in einem useMemo, das nur bei Änderung von tickers/historicalPrices/
 * currentWeights neu rechnet -- kein Neurechnen bei jedem Tastendruck in
 * einer übergeordneten Policy-Eingabe.
 */
import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import { Info } from "lucide-react";
import { buildCovariance, type PricePoint } from "@/lib/portfolio/covariance";
import { computeEfficientFrontier, computePortfolioPoint, type FrontierPoint } from "@/lib/portfolio/frontier";

const MIN_TICKERS_FOR_FRONTIER = 3;

function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

interface ReferencePoint {
  key: string;
  label: string;
  color: string;
  risk: number;
  return: number;
  weights: Record<string, number>;
}

function TopWeightsTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as (FrontierPoint & { label?: string }) | undefined;
  if (!point) return null;
  const topWeights = Object.entries(point.weights)
    .sort((a, b) => b[1] - a[1])
    .filter(([, w]) => w > 0.001)
    .slice(0, 3);
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-[11px] shadow-lg">
      {point.label && <p className="mb-1 font-semibold">{point.label}</p>}
      <p className="text-muted-foreground">Risiko: {formatPct(point.risk)} · Rendite: {formatPct(point.return)}</p>
      {point.sharpe != null && <p className="text-muted-foreground">Sharpe: {point.sharpe.toFixed(2)}</p>}
      {topWeights.length > 0 && (
        <div className="mt-1 border-t border-border/50 pt-1">
          <p className="text-muted-foreground">Top-Gewichte:</p>
          {topWeights.map(([ticker, w]) => (
            <p key={ticker} className="font-mono">{ticker}: {formatPct(w)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EfficientFrontierPanel({
  tickers,
  historicalPricesByTicker,
  currentWeights,
  riskFreeRate = 0.03,
}: {
  /** Ticker im aktuellen Portfolio/Basket (P1: offene Positionen, P2: Watchlist,
   * P3: Researcher-Region). */
  tickers: string[];
  /** Historische Tagespreise je Ticker, wie an buildCovariance()/engine.ts übergeben. */
  historicalPricesByTicker: Record<string, PricePoint[] | undefined>;
  /** Optionale Ist-/CAPM-Ziel-Gewichte je Ticker (0..1). Wenn vorhanden, werden
   * die entsprechenden Referenzpunkte auf dem Chart markiert. Equal-Weight
   * (1/n) wird immer berechnet, sobald genug Ticker vorhanden sind. */
  currentWeights?: Record<string, { market?: number | null; capm?: number | null }>;
  /** Risikofreier Zins für die Sharpe-Ratio-Anzeige im Tooltip. Default 3%. */
  riskFreeRate?: number;
}) {
  const uniqueTickers = useMemo(
    () => Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(Boolean))),
    [tickers],
  );

  const covariance = useMemo(
    () => buildCovariance(historicalPricesByTicker),
    [historicalPricesByTicker],
  );

  const frontierTickers = covariance.tickersAligned;

  const expectedReturns = useMemo(() => {
    const map: Record<string, number> = {};
    frontierTickers.forEach((t, i) => { map[t] = covariance.mu[i]; });
    return map;
  }, [frontierTickers, covariance.mu]);

  const frontierPoints = useMemo(() => {
    if (frontierTickers.length < MIN_TICKERS_FOR_FRONTIER) return [];
    return computeEfficientFrontier(frontierTickers, expectedReturns, covariance.Sigma, riskFreeRate, 30);
  }, [frontierTickers, expectedReturns, covariance.Sigma, riskFreeRate]);

  const referencePoints = useMemo<ReferencePoint[]>(() => {
    if (frontierTickers.length < MIN_TICKERS_FOR_FRONTIER) return [];
    const out: ReferencePoint[] = [];

    if (currentWeights) {
      const marketWeights: Record<string, number> = {};
      let hasAllMarket = true;
      for (const t of frontierTickers) {
        const w = currentWeights[t]?.market;
        if (w == null) { hasAllMarket = false; break; }
        marketWeights[t] = w;
      }
      if (hasAllMarket) {
        const pt = computePortfolioPoint(frontierTickers, marketWeights, expectedReturns, covariance.Sigma, riskFreeRate);
        if (pt) out.push({ key: "ist", label: "Ist-Portfolio", color: "#f59e0b", risk: pt.risk, return: pt.return, weights: marketWeights });
      }

      const capmWeights: Record<string, number> = {};
      let hasAllCapm = true;
      for (const t of frontierTickers) {
        const w = currentWeights[t]?.capm;
        if (w == null) { hasAllCapm = false; break; }
        capmWeights[t] = w;
      }
      if (hasAllCapm) {
        const pt = computePortfolioPoint(frontierTickers, capmWeights, expectedReturns, covariance.Sigma, riskFreeRate);
        if (pt) out.push({ key: "capm", label: "CAPM-Ziel-Portfolio", color: "#6366f1", risk: pt.risk, return: pt.return, weights: capmWeights });
      }
    }

    // Equal-Weight (1/n) -- trivial, immer berechenbar sobald genug Ticker da sind.
    const equalWeights: Record<string, number> = {};
    frontierTickers.forEach(t => { equalWeights[t] = 1 / frontierTickers.length; });
    const equalPt = computePortfolioPoint(frontierTickers, equalWeights, expectedReturns, covariance.Sigma, riskFreeRate);
    if (equalPt) out.push({ key: "equal", label: "Equal-Weight", color: "#10b981", risk: equalPt.risk, return: equalPt.return, weights: equalWeights });

    return out;
  }, [frontierTickers, currentWeights, expectedReturns, covariance.Sigma, riskFreeRate]);

  if (uniqueTickers.length < MIN_TICKERS_FOR_FRONTIER) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="status-frontier-minimum-tickers">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Mindestens 3 Ticker für eine sinnvolle Effizienzlinie nötig.</p>
      </div>
    );
  }

  if (frontierTickers.length < MIN_TICKERS_FOR_FRONTIER || frontierPoints.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground" data-testid="status-frontier-insufficient-data">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Nicht genug belastbare Kurs-Historie für eine Effizienzlinie.</p>
          {covariance.flags.map((flag, i) => <p key={i}>{flag}</p>)}
        </div>
      </div>
    );
  }

  const chartData = frontierPoints.map(p => ({ ...p, riskPct: p.risk * 100, returnPct: p.return * 100 }));
  const referenceData = referencePoints.map(p => ({ ...p, riskPct: p.risk * 100, returnPct: p.return * 100, label: p.label, weights: p.weights }));

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4" data-testid="panel-efficient-frontier">
      <div>
        <h3 className="text-sm font-semibold">Effizienzlinie</h3>
        <p className="text-[10px] text-muted-foreground">
          Long-only Minimum-Varianz-Frontier ({frontierTickers.length} Ticker mit ausreichender Historie) ·
          Risiko (Std.-Abw. p.a.) vs. erwartete Rendite (p.a., historisches μ)
        </p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            type="number"
            dataKey="riskPct"
            name="Risiko"
            unit="%"
            tick={{ fontSize: 9 }}
            label={{ value: "Risiko (σ, % p.a.)", position: "insideBottom", offset: -5, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="returnPct"
            name="Rendite"
            unit="%"
            tick={{ fontSize: 9 }}
            width={44}
            label={{ value: "Erw. Rendite (% p.a.)", angle: -90, position: "insideLeft", fontSize: 10 }}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip content={<TopWeightsTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Legend wrapperStyle={{ fontSize: "10px" }} />
          <Line
            data={chartData}
            type="monotone"
            dataKey="returnPct"
            xAxisId={0}
            yAxisId={0}
            stroke="#94a3b8"
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            name="Effizienzlinie"
            legendType="line"
            isAnimationActive={false}
          />
          <Scatter data={chartData} name="Frontier-Punkte" fill="#94a3b8" shape="circle" legendType="none" isAnimationActive={false} />
          {referenceData.map(ref => (
            <Scatter
              key={ref.key}
              data={[ref]}
              name={ref.label}
              fill={ref.color}
              shape="star"
              legendType="star"
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
