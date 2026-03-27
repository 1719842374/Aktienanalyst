import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { gbmMonteCarlo, calculateGBMParams, type GBMMonteCarloResult } from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign } from "../../lib/formatters";
import { useMemo, useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { Settings2, RotateCcw, Play, AlertTriangle } from "lucide-react";

interface Props { data: StockAnalysis }

interface MCInputs {
  mu: number;
  sigma: number;
  iterations: number;
  tradingDays: number;
}

function MCInputField({ label, value, onChange, suffix, min, max, step = 0.01, tooltip }: {
  label: string; value: number; onChange: (v: number) => void;
  suffix?: string; min?: number; max?: number; step?: number; tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-muted-foreground w-24 flex-shrink-0" title={tooltip}>{label}</label>
      <div className="relative flex-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          min={min}
          max={max}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono tabular-nums text-right pr-6 focus:outline-none focus:ring-1 focus:ring-primary/50"
          data-testid={`input-mc-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function Section12({ data }: Props) {
  // Calculate historical params from price data
  const historicalParams = useMemo(() => {
    const prices = data.historicalPrices.map(p => p.close);
    return calculateGBMParams(prices);
  }, [data.historicalPrices]);

  const defaultInputs: MCInputs = {
    mu: historicalParams.mu,
    sigma: historicalParams.sigma,
    iterations: 10000,
    tradingDays: 252,
  };

  const [inputs, setInputs] = useState<MCInputs>(defaultInputs);
  const [showInputs, setShowInputs] = useState(false);
  const [result, setResult] = useState<GBMMonteCarloResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [runCount, setRunCount] = useState(0);

  const isModified = JSON.stringify(inputs) !== JSON.stringify(defaultInputs);

  const resetInputs = useCallback(() => {
    setInputs(defaultInputs);
  }, [defaultInputs]);

  const runSimulation = useCallback(() => {
    setRunCount(c => c + 1);
  }, []);

  useEffect(() => {
    setProgress(0);
    setResult(null);

    const timer = setTimeout(() => {
      setProgress(50);
      const r = gbmMonteCarlo({
        currentPrice: data.currentPrice,
        mu: inputs.mu,
        sigma: inputs.sigma,
        iterations: inputs.iterations,
        tradingDays: inputs.tradingDays,
      }, data.analystPT.median);
      setProgress(100);
      setResult(r);
    }, 100);

    return () => clearTimeout(timer);
  }, [data, inputs.mu, inputs.sigma, inputs.iterations, inputs.tradingDays, runCount]);

  const horizonLabel = inputs.tradingDays === 252 ? "1 Jahr" : inputs.tradingDays === 126 ? "6 Monate" : `${inputs.tradingDays} Tage`;

  return (
    <SectionCard number={12} title="MONTE CARLO SIMULATION (GBM)">
      {/* GBM Formula Reference */}
      <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/50 font-mono">
        <span className="font-semibold text-foreground">Geometrische Brownsche Bewegung:</span>{" "}
        S(t+Δt) = S(t) · exp((μ - σ²/2)·Δt + σ·√Δt·Z), Z ~ N(0,1), Δt = 1/252
      </div>

      {/* Parameter Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowInputs(!showInputs)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors border ${
            showInputs ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted/30 hover:bg-muted/50 border-border/50'
          }`}
          data-testid="button-mc-toggle-inputs"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Parameter anpassen
        </button>
        {isModified && (
          <button
            onClick={resetInputs}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs bg-muted/30 hover:bg-muted/50 border border-border/50 text-muted-foreground"
            data-testid="button-mc-reset"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
        {isModified && (
          <span className="text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded">custom params</span>
        )}
      </div>

      {showInputs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-muted/20 rounded-lg border border-border/50">
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Drift & Volatilität</div>
            <MCInputField
              label="μ (Drift p.a.)"
              value={inputs.mu}
              onChange={(v) => setInputs(p => ({ ...p, mu: v }))}
              suffix=""
              min={-1}
              max={2}
              step={0.01}
              tooltip="Annualisierte erwartete Rendite aus historischen Log-Returns"
            />
            <MCInputField
              label="σ (Vol. p.a.)"
              value={inputs.sigma}
              onChange={(v) => setInputs(p => ({ ...p, sigma: v }))}
              suffix=""
              min={0.01}
              max={3}
              step={0.01}
              tooltip="Annualisierte historische Volatilität"
            />
            <div className="text-[9px] text-muted-foreground pl-1">
              Berechnet aus {data.historicalPrices.length} historischen Datenpunkten
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Simulation</div>
            <MCInputField
              label="Iterationen"
              value={inputs.iterations}
              onChange={(v) => setInputs(p => ({ ...p, iterations: Math.max(1000, Math.min(50000, Math.round(v))) }))}
              suffix=""
              min={1000}
              max={50000}
              step={1000}
              tooltip="Anzahl der Simulationspfade"
            />
            <MCInputField
              label="Horizont (Tage)"
              value={inputs.tradingDays}
              onChange={(v) => setInputs(p => ({ ...p, tradingDays: Math.max(21, Math.min(756, Math.round(v))) }))}
              suffix="d"
              min={21}
              max={756}
              step={21}
              tooltip="Simulationshorizont in Handelstagen (252 = 1 Jahr)"
            />
            <button
              onClick={runSimulation}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors mt-1"
              data-testid="button-mc-run"
            >
              <Play className="w-3 h-3" />
              Simulation starten
            </button>
          </div>
        </div>
      )}

      {/* Current Parameters Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <ParamCard label="Startkurs" value={formatCurrency(data.currentPrice)} />
        <ParamCard label="μ (Drift)" value={formatNumber(inputs.mu, 4)} />
        <ParamCard label="σ (Vol.)" value={formatNumber(inputs.sigma, 4)} />
        <ParamCard label="Iterationen" value={inputs.iterations.toLocaleString()} />
        <ParamCard label="Horizont" value={horizonLabel} />
      </div>

      {!result ? (
        <div className="flex flex-col items-center py-8 gap-3">
          <div className="w-48 h-2 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">Running GBM simulation... {progress}%</span>
        </div>
      ) : (
        <>
          {/* === DOWNSIDE PROBABILITY — PROMINENTLY DISPLAYED === */}
          <div className="rounded-lg border-2 border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${result.downsideProb > 0.5 ? 'text-red-500' : 'text-amber-500'}`} />
              <span className="text-xs font-bold uppercase tracking-wider">Downside-Wahrscheinlichkeit</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className={`rounded-lg p-3 border ${result.downsideProb > 0.5 ? 'bg-red-500/10 border-red-500/20' : 'bg-muted/30 border-border/50'}`}>
                <div className="text-[10px] text-muted-foreground">P(Verlust)</div>
                <div className="text-[10px] text-muted-foreground">S(T) &lt; S(0)</div>
                <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${result.downsideProb > 0.5 ? 'text-red-500' : result.downsideProb > 0.35 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {formatPercentNoSign(result.downsideProb * 100, 1)}
                </div>
              </div>
              <div className={`rounded-lg p-3 border ${result.downsideProb10 > 0.3 ? 'bg-red-500/10 border-red-500/20' : 'bg-muted/30 border-border/50'}`}>
                <div className="text-[10px] text-muted-foreground">P(≥10% Verlust)</div>
                <div className="text-[10px] text-muted-foreground">S(T) &lt; 0.9·S(0)</div>
                <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${result.downsideProb10 > 0.3 ? 'text-red-500' : result.downsideProb10 > 0.15 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {formatPercentNoSign(result.downsideProb10 * 100, 1)}
                </div>
              </div>
              <div className={`rounded-lg p-3 border ${result.downsideProb20 > 0.2 ? 'bg-red-500/10 border-red-500/20' : 'bg-muted/30 border-border/50'}`}>
                <div className="text-[10px] text-muted-foreground">P(≥20% Verlust)</div>
                <div className="text-[10px] text-muted-foreground">S(T) &lt; 0.8·S(0)</div>
                <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${result.downsideProb20 > 0.2 ? 'text-red-500' : result.downsideProb20 > 0.1 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {formatPercentNoSign(result.downsideProb20 * 100, 1)}
                </div>
              </div>
            </div>

            {/* Visual probability bar */}
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>Downside ({formatPercentNoSign(result.downsideProb * 100, 0)})</span>
                <span>Upside ({formatPercentNoSign((1 - result.downsideProb) * 100, 0)})</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden flex">
                <div
                  className="bg-red-500/60 transition-all"
                  style={{ width: `${result.downsideProb * 100}%` }}
                />
                <div
                  className="bg-emerald-500/60 transition-all"
                  style={{ width: `${(1 - result.downsideProb) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Results KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ResultCard label="Mean" value={formatCurrency(result.mean)} sub={`${result.expectedReturn >= 0 ? '+' : ''}${formatNumber(result.expectedReturn * 100, 1)}%`} />
            <ResultCard label="P10 (Bearish)" value={formatCurrency(result.p10)} color="text-red-500" />
            <ResultCard label="P50 (Median)" value={formatCurrency(result.p50)} color="text-primary" />
            <ResultCard label="P90 (Bullish)" value={formatCurrency(result.p90)} color="text-emerald-500" />
          </div>

          {/* Extended percentiles */}
          <div className="grid grid-cols-4 gap-2 text-xs">
            <PercentileCard label="P5" value={formatCurrency(result.p5)} pct={((result.p5 / data.currentPrice - 1) * 100)} />
            <PercentileCard label="P25" value={formatCurrency(result.p25)} pct={((result.p25 / data.currentPrice - 1) * 100)} />
            <PercentileCard label="P75" value={formatCurrency(result.p75)} pct={((result.p75 / data.currentPrice - 1) * 100)} />
            <PercentileCard label="P95" value={formatCurrency(result.p95)} pct={((result.p95 / data.currentPrice - 1) * 100)} />
          </div>

          {/* Histogram */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.histogram} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <XAxis
                  dataKey="bin"
                  tick={{ fontSize: 9, fill: 'hsl(215 20% 65%)' }}
                  interval={Math.floor(result.histogram.length / 6)}
                  axisLine={{ stroke: 'hsl(215 20% 25%)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'hsl(215 20% 65%)' }}
                  axisLine={false}
                  tickLine={false}
                  width={35}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(217 33% 17%)',
                    border: '1px solid hsl(215 20% 25%)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: 'hsl(210 40% 96%)',
                  }}
                />
                <ReferenceLine
                  x={`$${data.currentPrice.toFixed(0)}`}
                  stroke="hsl(217 91% 60%)"
                  strokeDasharray="3 3"
                  label={{ value: 'Current', fill: 'hsl(217 91% 60%)', fontSize: 10 }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]} fillOpacity={0.7}>
                  {result.histogram.map((entry, index) => {
                    const binPrice = parseFloat(entry.bin.replace('$', ''));
                    const isBelow = binPrice < data.currentPrice;
                    return (
                      <Cell key={index} fill={isBelow ? 'hsl(0 84% 60%)' : 'hsl(142 71% 45%)'} fillOpacity={0.6} />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Additional metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-muted/30 rounded-md p-3 border border-border/50">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">P(reach Analyst PT)</div>
              <div className="text-[10px] text-muted-foreground">≥ {formatCurrency(data.analystPT.median)}</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-1">{formatPercentNoSign(result.analystPTProb * 100, 1)}</div>
            </div>
            <div className="bg-muted/30 rounded-md p-3 border border-border/50">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg. Max Drawdown</div>
              <div className="text-[10px] text-muted-foreground">Pfad-Durchschnitt</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-1 text-red-500">
                -{formatPercentNoSign(result.maxDrawdownMean * 100, 1)}
              </div>
            </div>
            <div className="bg-muted/30 rounded-md p-3 border border-border/50">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Expected Return</div>
              <div className="text-[10px] text-muted-foreground">{horizonLabel}</div>
              <div className={`text-sm font-bold font-mono tabular-nums mt-1 ${result.expectedReturn >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {result.expectedReturn >= 0 ? '+' : ''}{formatPercentNoSign(result.expectedReturn * 100, 1)}
              </div>
            </div>
          </div>
        </>
      )}

      <RechenWeg title="GBM Monte Carlo Rechenweg" steps={[
        `Geometrische Brownsche Bewegung (Itô-Kalkül):`,
        `dS = μ·S·dt + σ·S·dW, W = Wiener Prozess`,
        `Diskrete Approximation: S(t+Δt) = S(t) · exp((μ - σ²/2)·Δt + σ·√Δt·Z)`,
        `Z ~ N(0,1) via Box-Muller Transformation`,
        `Parameter:`,
        `  μ = ${inputs.mu} (annualisierter Drift aus log-Returns)`,
        `  σ = ${inputs.sigma} (annualisierte Volatilität)`,
        `  Δt = 1/252 (ein Handelstag)`,
        `  N = ${inputs.iterations} Pfade × ${inputs.tradingDays} Tage`,
        `Downside-Wahrscheinlichkeit = #{S_T < S_0} / N = ${result ? formatPercentNoSign(result.downsideProb * 100, 1) : '...'}`,
      ]} />
    </SectionCard>
  );
}

function ParamCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-2 border border-border/50 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold font-mono tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ResultCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-3 border border-border/50">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-base font-bold font-mono tabular-nums mt-1 ${color || ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-mono tabular-nums">{sub}</div>}
    </div>
  );
}

function PercentileCard({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="bg-muted/20 rounded-md p-2 border border-border/30 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold font-mono tabular-nums">{value}</div>
      <div className={`text-[10px] font-mono tabular-nums ${pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </div>
    </div>
  );
}
