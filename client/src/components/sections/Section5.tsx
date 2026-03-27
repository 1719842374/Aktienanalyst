import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { calculateFCFFDCF, type FCFFDCFParams, type FCFFDCFResult, calculateDCF, buildSensitivityMatrix } from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign } from "../../lib/formatters";
import { useMemo, useState, useCallback } from "react";
import { Settings2, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, Lock, Unlock } from "lucide-react";

interface Props { data: StockAnalysis }

function InputField({ label, value, onChange, suffix = "%", min, max, step = 0.5, width = "w-20" }: {
  label: string; value: number; onChange: (v: number) => void;
  suffix?: string; min?: number; max?: number; step?: number; width?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-muted-foreground flex-shrink-0 min-w-[80px]">{label}</label>
      <div className={`relative ${width}`}>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          min={min}
          max={max}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono tabular-nums text-right pr-6 focus:outline-none focus:ring-1 focus:ring-primary/50"
          data-testid={`input-dcf-${label.toLowerCase().replace(/[\s\/]/g, '-')}`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

export function Section5({ data }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const [showEditor, setShowEditor] = useState(false);
  const [showProjections, setShowProjections] = useState(false);
  const [waccOverrideEnabled, setWaccOverrideEnabled] = useState(false);
  const [waccOverrideValue, setWaccOverrideValue] = useState(9.0);

  // Derive sensible defaults from data
  const ebitMarginDefault = data.ebitda > 0 && data.revenue > 0
    ? +((data.ebitda / data.revenue) * 100).toFixed(1) // Use EBITDA as proxy for EBIT margin
    : 15;
  const capexDefault = data.revenue > 0 && data.fcfTTM > 0
    ? +Math.max(2, Math.min(15, ((data.ebitda - data.fcfTTM) / data.revenue) * 100)).toFixed(1)
    : 5;
  const revenueGrowthDefault = sp.growthAssumptions.g1 || 10;

  // Use sector WACC scenarios to back-derive a reasonable beta for DCF.
  // Reverse: beta = (targetWACC/E_V - D_V*Rd*(1-t)/E_V - Rf) / ERP
  const rf = 4.2;
  const erp = 5.5;
  const taxR = 21;
  const rd = 5.0;
  const debtRatioVal = data.totalDebt > 0 ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0) : 10;
  const evFrac = (100 - debtRatioVal) / 100;
  const dvFrac = debtRatioVal / 100;
  // Target WACC from sector avg scenario (e.g. Tech=9%, Defense=10%)
  const targetWACC = sp.waccScenarios.avg;
  // Solve: WACC = evFrac*(Rf + beta*ERP) + dvFrac*Rd*(1-t)
  // beta = (WACC - dvFrac*Rd*(1-t) - evFrac*Rf) / (evFrac*ERP)
  const debtCostPart = dvFrac * rd * (1 - taxR / 100);
  const impliedBeta = Math.max(0.5, Math.min(1.8,
    (targetWACC - debtCostPart - evFrac * rf) / (evFrac * erp)
  ));
  // Use implied beta (anchored to sector WACC) — capped at observed beta + 0.1
  const dcfBeta = +Math.min(impliedBeta, data.beta5Y + 0.1).toFixed(2);

  const defaultParams: FCFFDCFParams = {
    revenueBase: data.revenue,
    revenueGrowthP1: revenueGrowthDefault,
    revenueGrowthP2: Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1)),
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: +Math.max(8, ebitMarginDefault * 0.9).toFixed(1),
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxR,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rf,
    beta: dcfBeta,
    erp,
    debtRatio: debtRatioVal,
    costOfDebt: rd,
    terminalG: sp.growthAssumptions.terminal || 2.5,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    fcfHaircut: data.fcfHaircut,
    actualEPS: data.epsTTM,
    waccOverride: null,
  };

  const [params, setParams] = useState<FCFFDCFParams>(defaultParams);

  const updateParam = useCallback(<K extends keyof FCFFDCFParams>(key: K, value: FCFFDCFParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetParams = useCallback(() => {
    setParams(defaultParams);
    setWaccOverrideEnabled(false);
    setWaccOverrideValue(9.0);
  }, [defaultParams]);

  const isModified = JSON.stringify(params) !== JSON.stringify(defaultParams) || waccOverrideEnabled;

  // Merge WACC override into params
  const effectiveParams = useMemo(() => ({
    ...params,
    waccOverride: waccOverrideEnabled ? waccOverrideValue : null,
  }), [params, waccOverrideEnabled, waccOverrideValue]);

  // Calculate main FCFF DCF
  const mainResult = useMemo(() => calculateFCFFDCF(effectiveParams), [effectiveParams]);

  // Detect if WACC was capped (compare raw CAPM to final)
  const rawRe = params.riskFreeRate + params.beta * params.erp;
  const dvCalc = params.debtRatio / 100;
  const evCalc = 1 - dvCalc;
  const rawWaccCalc = evCalc * rawRe + dvCalc * params.costOfDebt * (1 - params.taxRate / 100);
  const waccWasCapped = !waccOverrideEnabled && Math.abs(mainResult.wacc - rawWaccCalc) > 0.01;

  // Build 3 scenarios: Conservative (main), Optimistic, Macro-Stress
  const optimisticParams = useMemo<FCFFDCFParams>(() => ({
    ...effectiveParams,
    revenueGrowthP1: effectiveParams.revenueGrowthP1 * 1.5,
    revenueGrowthP2: effectiveParams.revenueGrowthP2 * 1.4,
    ebitMargin: effectiveParams.ebitMargin * 1.15,
    ebitMarginTerminal: effectiveParams.ebitMarginTerminal * 1.1,
    riskFreeRate: effectiveParams.riskFreeRate,
    erp: effectiveParams.erp - 1, // Lower ERP → lower WACC
    waccOverride: waccOverrideEnabled ? Math.max(5, waccOverrideValue - 2) : null,
  }), [effectiveParams, waccOverrideEnabled, waccOverrideValue]);

  const stressParams = useMemo<FCFFDCFParams>(() => ({
    ...effectiveParams,
    revenueGrowthP1: Math.max(0, effectiveParams.revenueGrowthP1 * 0.3),
    revenueGrowthP2: Math.max(0, effectiveParams.revenueGrowthP2 * 0.3),
    ebitMargin: effectiveParams.ebitMargin * 0.7,
    ebitMarginTerminal: effectiveParams.ebitMarginTerminal * 0.75,
    erp: effectiveParams.erp + 2, // Higher ERP → higher WACC
    terminalG: Math.max(1, effectiveParams.terminalG - 0.5),
    waccOverride: waccOverrideEnabled ? waccOverrideValue + 2 : null,
  }), [effectiveParams, waccOverrideEnabled, waccOverrideValue]);

  const optResult = useMemo(() => calculateFCFFDCF(optimisticParams), [optimisticParams]);
  const stressResult = useMemo(() => calculateFCFFDCF(stressParams), [stressParams]);

  // Risk-adjusted DCF
  const riskAdjDCF = (mainResult.perShare + stressResult.perShare) / 2;
  const invertedBelowPrice = riskAdjDCF < data.currentPrice;
  const safetyMarginDCF = mainResult.perShare * 0.7;

  // Legacy sensitivity matrix (uses the old calculateDCF for simplicity)
  const sensitivityMatrix = useMemo(
    () => buildSensitivityMatrix({
      fcfBase: data.fcfTTM,
      haircut: params.fcfHaircut,
      wacc: mainResult.wacc,
      g1: params.revenueGrowthP1,
      g2: params.revenueGrowthP2,
      terminalG: params.terminalG,
      sharesOutstanding: data.sharesOutstanding,
      netDebt,
    }, data.sharesOutstanding),
    [params, data.sharesOutstanding, data.fcfTTM, netDebt, mainResult.wacc]
  );

  const scenarios = [
    { name: "Conservative", result: mainResult, color: "border-primary/20 bg-primary/5" },
    { name: "Optimistic", result: optResult, color: "border-emerald-500/20 bg-emerald-500/5" },
    { name: "Macro-Stress", result: stressResult, color: "border-red-500/20 bg-red-500/5" },
  ];

  return (
    <SectionCard number={5} title="DCF-MODELL (FCFF)">
      {/* Inverted DCF Warning */}
      {invertedBelowPrice && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <div className="text-xs font-bold text-red-500">AUTOMATISCHE WARNUNG: Inverted DCF &lt; aktueller Kurs</div>
            <div className="text-[11px] text-red-400 mt-0.5">
              Risk-adj. DCF ({formatCurrency(riskAdjDCF)}) liegt unter dem aktuellen Kurs ({formatCurrency(data.currentPrice)}). Anti-Bias-Protokoll: Symmetrische Downside-Betrachtung notwendig.
            </div>
          </div>
        </div>
      )}

      {/* Parameter Editor Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowEditor(!showEditor)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
            showEditor ? "bg-primary/10 border-primary/30 text-primary" : "border-border hover:bg-muted/50"
          }`}
          data-testid="toggle-dcf-editor"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Parameter anpassen
        </button>
        {isModified && (
          <button
            onClick={resetParams}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-amber-500 hover:bg-amber-500/10 border border-amber-500/20"
            data-testid="reset-dcf-params"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
        {isModified && <span className="text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded">custom</span>}
      </div>

      {/* Full Parameter Editor */}
      {showEditor && (
        <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-4">
          {/* Revenue & Growth */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Revenue & Wachstum</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              <InputField label="Revenue (Basis)" value={+(params.revenueBase / 1e9).toFixed(2)} onChange={(v) => updateParam('revenueBase', v * 1e9)} suffix="B" step={1} />
              <InputField label="Growth P1 (Y1-5)" value={params.revenueGrowthP1} onChange={(v) => updateParam('revenueGrowthP1', v)} min={-20} max={50} />
              <InputField label="Growth P2 (Y6-10)" value={params.revenueGrowthP2} onChange={(v) => updateParam('revenueGrowthP2', v)} min={-10} max={30} />
            </div>
          </div>

          {/* Margins & OpEx */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Margen & Investitionen</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              <InputField label="EBIT-Marge (aktuell)" value={params.ebitMargin} onChange={(v) => updateParam('ebitMargin', v)} min={-30} max={80} />
              <InputField label="EBIT-Marge (terminal)" value={params.ebitMarginTerminal} onChange={(v) => updateParam('ebitMarginTerminal', v)} min={-20} max={70} />
              <InputField label="Capex (% Rev)" value={params.capexPct} onChange={(v) => updateParam('capexPct', v)} min={0} max={40} />
              <InputField label="ΔWC (% ΔRev)" value={params.deltaWCPct} onChange={(v) => updateParam('deltaWCPct', v)} min={-20} max={30} step={1} />
              <InputField label="D&A (% Rev)" value={params.daRatio} onChange={(v) => updateParam('daRatio', v)} min={0} max={20} />
              <InputField label="Steuersatz" value={params.taxRate} onChange={(v) => updateParam('taxRate', v)} min={0} max={50} step={1} />
            </div>
          </div>

          {/* WACC Components */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                WACC-Komponenten
                <span className="ml-2 font-normal text-primary">
                  → WACC = {mainResult.wacc.toFixed(2)}% | Re = {mainResult.costOfEquity.toFixed(2)}%
                </span>
              </h4>
            </div>

            {/* WACC Override Toggle */}
            <div className="flex items-center gap-3 mb-3 p-2 rounded-md border border-dashed border-border bg-muted/5">
              <button
                onClick={() => {
                  const newEnabled = !waccOverrideEnabled;
                  setWaccOverrideEnabled(newEnabled);
                  if (newEnabled) {
                    // Pre-fill with current computed WACC
                    setWaccOverrideValue(+mainResult.wacc.toFixed(2));
                  }
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                  waccOverrideEnabled
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
                data-testid="toggle-wacc-override"
              >
                {waccOverrideEnabled ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {waccOverrideEnabled ? "WACC-Override aktiv" : "Manueller WACC-Override"}
              </button>
              {waccOverrideEnabled && (
                <div className="flex items-center gap-2">
                  <InputField
                    label="WACC direkt"
                    value={waccOverrideValue}
                    onChange={(v) => setWaccOverrideValue(v)}
                    min={1}
                    max={30}
                    step={0.25}
                    width="w-24"
                  />
                  <span className="text-[9px] text-amber-500/80">
                    Bypass CAPM — kein Sanity-Cap
                  </span>
                </div>
              )}
            </div>

            {/* WACC capping warning */}
            {waccWasCapped && (
              <div className="flex items-start gap-1.5 mb-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-amber-500">
                  WACC-Sanity-Cap aktiv: CAPM ergibt {rawWaccCalc.toFixed(2)}%, begrenzt auf {mainResult.wacc.toFixed(2)}% (Bounds: 3–20%).
                  Für vollen Bypass den manuellen WACC-Override aktivieren.
                </div>
              </div>
            )}

            <div className={`grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 ${waccOverrideEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
              <InputField label="Rf (risikolos)" value={params.riskFreeRate} onChange={(v) => updateParam('riskFreeRate', v)} min={0} max={10} step={0.1} />
              <InputField label="Beta" value={params.beta} onChange={(v) => updateParam('beta', v)} min={0.1} max={3.0} step={0.05} suffix="" />
              <InputField label="ERP" value={params.erp} onChange={(v) => updateParam('erp', v)} min={2} max={10} step={0.25} />
              <InputField label="D/V (FK-Quote)" value={params.debtRatio} onChange={(v) => updateParam('debtRatio', v)} min={0} max={80} step={5} />
              <InputField label="Rd (FK-Kosten)" value={params.costOfDebt} onChange={(v) => updateParam('costOfDebt', v)} min={0} max={15} step={0.25} />
              <InputField label="Terminal g" value={params.terminalG} onChange={(v) => updateParam('terminalG', v)} min={0} max={5} step={0.25} />
            </div>
          </div>

          {/* Equity Bridge */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Equity Bridge</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              <InputField label="Net Debt" value={+(params.netDebt / 1e9).toFixed(2)} onChange={(v) => updateParam('netDebt', v * 1e9)} suffix="B" step={0.5} />
              <InputField label="Minorities" value={+(params.minorityInterests / 1e9).toFixed(2)} onChange={(v) => updateParam('minorityInterests', v * 1e9)} suffix="B" step={0.1} />
              <InputField label="Shares Out." value={+(params.sharesOutstanding / 1e6).toFixed(0)} onChange={(v) => updateParam('sharesOutstanding', v * 1e6)} suffix="M" step={10} width="w-24" />
              <InputField label="FCF Haircut" value={params.fcfHaircut} onChange={(v) => updateParam('fcfHaircut', v)} min={0} max={30} step={1} />
            </div>
          </div>
        </div>
      )}

      {/* WACC Summary Bar */}
      <div className="flex flex-wrap gap-3 text-[10px]">
        <div className={`rounded px-2 py-1 border ${waccOverrideEnabled ? 'bg-amber-500/10 border-amber-500/30' : waccWasCapped ? 'bg-amber-500/5 border-amber-500/20' : 'bg-muted/30 border-border/50'}`}>
          <span className="text-muted-foreground">WACC: </span>
          <span className="font-mono font-semibold">{mainResult.wacc.toFixed(2)}%</span>
          {waccOverrideEnabled && <span className="ml-1 text-amber-500">(Override)</span>}
          {waccWasCapped && !waccOverrideEnabled && <span className="ml-1 text-amber-500">(Capped)</span>}
        </div>
        <div className="bg-muted/30 rounded px-2 py-1 border border-border/50">
          <span className="text-muted-foreground">Re (CAPM): </span>
          <span className="font-mono font-semibold">{mainResult.costOfEquity.toFixed(2)}%</span>
        </div>
        <div className="bg-muted/30 rounded px-2 py-1 border border-border/50">
          <span className="text-muted-foreground">β: </span>
          <span className="font-mono font-semibold">{params.beta.toFixed(2)}</span>
        </div>
        <div className="bg-muted/30 rounded px-2 py-1 border border-border/50">
          <span className="text-muted-foreground">EBIT-M: </span>
          <span className="font-mono font-semibold">{params.ebitMargin.toFixed(1)}%</span>
        </div>
        <div className="bg-muted/30 rounded px-2 py-1 border border-border/50">
          <span className="text-muted-foreground">Terminal g: </span>
          <span className="font-mono font-semibold">{params.terminalG}%</span>
        </div>
      </div>

      {/* Three scenario cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {scenarios.map(({ name, result, color }, i) => (
          <div key={i} className={`rounded-lg p-3 border ${color}`}>
            <div className="text-xs font-semibold mb-2">{name}</div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">WACC</span>
                <span className="font-mono tabular-nums">{result.wacc.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PV(FCFF)</span>
                <span className="font-mono tabular-nums">{formatCurrency(result.pvExplicit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PV(TV)</span>
                <span className="font-mono tabular-nums">{formatCurrency(result.pvTerminal)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-border/50">
                <span className="font-medium">Fair Value</span>
                <span className="font-mono tabular-nums font-bold text-sm">{formatCurrency(result.perShare)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">vs. Current</span>
                <span className={`font-mono tabular-nums font-medium ${result.perShare > data.currentPrice ? "text-emerald-500" : "text-red-500"}`}>
                  {result.perShare > 0 ? ((result.perShare / data.currentPrice - 1) * 100).toFixed(1) : "-100.0"}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Safety margin & Risk-adj DCF */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-muted/30 rounded-md p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">30% Safety Margin DCF</div>
          <div className="text-base font-bold font-mono tabular-nums mt-1">{formatCurrency(safetyMarginDCF)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">= Conservative DCF × 0.70</div>
        </div>
        <div className={`rounded-md p-3 border ${invertedBelowPrice ? "bg-red-500/10 border-red-500/20" : "bg-muted/30 border-border/50"}`}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Risk-Adj. DCF (Inverted)</div>
          <div className="text-base font-bold font-mono tabular-nums mt-1">{formatCurrency(riskAdjDCF)}</div>
          {invertedBelowPrice && (
            <div className="text-[10px] text-red-500 mt-0.5">⚠ Below current price — WARNUNG</div>
          )}
        </div>
        <div className="bg-muted/30 rounded-md p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">TV / EV Anteil</div>
          <div className="text-base font-bold font-mono tabular-nums mt-1">
            {mainResult.enterpriseValue > 0 ? ((mainResult.pvTerminal / mainResult.enterpriseValue) * 100).toFixed(0) : 0}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Terminal Value Anteil am EV</div>
        </div>
      </div>

      {/* FCFF Projection Table (collapsible) */}
      <div>
        <button
          onClick={() => setShowProjections(!showProjections)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid="toggle-projections"
        >
          {showProjections ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          FCFF-Projektionstabelle (10 Jahre)
        </button>
        {showProjections && (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-1.5 px-1 text-left font-medium text-muted-foreground">Year</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">Revenue</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">EBIT</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">NOPAT</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">+D&A</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">-Capex</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">-ΔWC</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">FCFF</th>
                  <th className="py-1.5 px-1 text-right font-medium text-muted-foreground">PV(FCFF)</th>
                </tr>
              </thead>
              <tbody>
                {mainResult.yearlyProjections.map((p) => (
                  <tr key={p.year} className={`border-b border-border/30 ${p.year === 6 ? "border-t border-primary/30" : ""}`}>
                    <td className="py-1 px-1 font-mono font-medium">Y{p.year}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums">{fmtB(p.revenue)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums">{fmtB(p.ebit)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums">{fmtB(p.nopat)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums text-emerald-500">{fmtB(p.da)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums text-red-400">{fmtB(p.capex)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums text-red-400">{fmtB(p.deltaWC)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums font-medium">{fmtB(p.fcff)}</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums text-primary">{fmtB(p.pvFCFF)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sensitivity Matrix */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Sensitivity Matrix (WACC × Growth)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 px-2 text-left text-muted-foreground font-medium"></th>
                <th className="py-2 px-2 text-center text-muted-foreground font-medium">g -2%</th>
                <th className="py-2 px-2 text-center text-muted-foreground font-medium">g Base</th>
                <th className="py-2 px-2 text-center text-muted-foreground font-medium">g +2%</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((wIdx) => (
                <tr key={wIdx} className="border-b border-border/50">
                  <td className="py-2 px-2 font-medium text-muted-foreground">
                    {sensitivityMatrix[wIdx * 3].waccLabel}
                  </td>
                  {[0, 1, 2].map((gIdx) => {
                    const val = sensitivityMatrix[wIdx * 3 + gIdx].value;
                    const isAbove = val > data.currentPrice;
                    return (
                      <td
                        key={gIdx}
                        className={`py-2 px-2 text-center font-mono tabular-nums font-medium ${
                          isAbove ? "text-emerald-500 bg-emerald-500/5" : "text-red-500 bg-red-500/5"
                        }`}
                      >
                        {formatCurrency(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rechenweg */}
      <RechenWeg title="FCFF-DCF Rechenweg (Conservative)" steps={mainResult.steps} />

      {/* Method disclaimer */}
      <div className="p-2 rounded bg-muted/30 text-[9px] text-muted-foreground leading-relaxed">
        <span className="font-semibold">Methodik:</span> FCFF = EBIT × (1 - Tax) + D&A - Capex - ΔWC | 
        Terminal Value = Gordon Growth Model: TV = FCFF₁₁ / (WACC - g) | 
        WACC = E/V × Re + D/V × Rd × (1-t) | Re = Rf + β × ERP (CAPM) | 
        Equity Value = EV - Net Debt - Minorities
      </div>
    </SectionCard>
  );
}

function fmtB(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}
