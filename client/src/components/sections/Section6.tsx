import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import {
  calculateFCFFDCF, buildDefaultDCFParams,
  worstCaseM1, worstCaseM1Label, worstCaseM2, worstCaseM3,
  calculateCRV, calculateRiskAdjustedCRV, calculateCatalystUpside, selectCatalystBase,
  computeHardenedCRV, LYNCH_CLASS_BASE_DRAWDOWN,
} from "../../lib/calculations";
import { formatCurrency, formatNumber, getCRVColor, getCRVBgColor } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section6({ data }: Props) {
  const sp = data.sectorProfile;
  const haircut = data.fcfHaircut;

  // === SINGLE SOURCE OF TRUTH: identical defaults as Section5 / Section13 ===
  // DCF-Parameter: via buildDefaultDCFParams (selbe Basis wie Section5 + SummarySection)
  // and a different capex proxy. Now both sections share buildDefaultDCFParams().
  const baseParams = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);

  const conservativeDCF = useMemo(() => calculateFCFFDCF(baseParams), [baseParams]);

  const optimisticDCF = useMemo(() => calculateFCFFDCF({
    ...baseParams,
    revenueGrowthP1: baseParams.revenueGrowthP1 * 1.5,
    revenueGrowthP2: baseParams.revenueGrowthP2 * 1.4,
    // Math.abs: bei negativer Marge soll das Optimistic-Szenario die Marge VERBESSERN,
    // nicht verschlechtern (×1.15 würde eine negative Marge weiter ins Minus drücken)
    ebitMargin: baseParams.ebitMargin + Math.abs(baseParams.ebitMargin) * 0.15,
    ebitMarginTerminal: baseParams.ebitMarginTerminal + Math.abs(baseParams.ebitMarginTerminal) * 0.1,
    erp: baseParams.erp - 1,
  }), [baseParams]);

  // Worst Case methods
  const sectorDD = data.sectorMaxDrawdown || 35;
  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, sectorDD);
  // M2: größter Einzelrisiko-Impact (brutto) aus der Risikoinversion, Fallback 35% — identisch mit Section17
  const m2Impact = data.risks?.length ? Math.max(...data.risks.map(r => Math.abs(r.impact))) : 35;
  const m2 = worstCaseM2(data.currentPrice, m2Impact);
  const m3 = worstCaseM3(data.currentPrice, sectorDD, data.lynchClass);
  const worstCase = Math.min(m1, m2, m3);

  // M1-Label: direkt aus worstCaseM1Label() — Label und Berechnung bleiben synchron
  const m1Label = worstCaseM1Label(data.beta5Y, sectorDD);

  // === Risk-Adjusted DCF ===
  const risks = data.risks ?? [];
  const totalExpectedDamage = risks.reduce((s, r) => s + r.expectedDamage, 0);
  // Geclampt auf ≥ 0: Summe der Expected Damages kann > 100% sein → sonst negativer Fair Value
  const riskDiscountFactor = Math.max(0, 1 - totalExpectedDamage / 100);
  const raConservativeFV = conservativeDCF.perShare * riskDiscountFactor;
  const raOptimisticFV = optimisticDCF.perShare * riskDiscountFactor;

  // Catalyst-adj target
  const catalysts = data.catalysts;
  const _rawUpsideS6 = (catalysts || []).reduce((s, c) => s + c.gb, 0);
  const _baseInfoS6 = selectCatalystBase(conservativeDCF.perShare, _rawUpsideS6, data.currentPrice, data.analystPT.median);
  const catalystDCFBase = _baseInfoS6.base;
  const { adjustedTarget } = calculateCatalystUpside(catalysts, catalystDCFBase);
  const raAdjustedTarget = adjustedTarget * riskDiscountFactor;

  // === BASE CRV ===
  const crvConservative = calculateCRV(conservativeDCF.perShare, worstCase, data.currentPrice);
  const crvOptimistic = calculateCRV(optimisticDCF.perShare, worstCase, data.currentPrice);
  const crvCatalyst = calculateCRV(adjustedTarget, worstCase, data.currentPrice);

  // === RISK-ADJUSTED CRV ===
  const raCrvConservative = calculateRiskAdjustedCRV(conservativeDCF.perShare, worstCase, data.currentPrice, totalExpectedDamage);
  const raCrvOptimistic = calculateRiskAdjustedCRV(optimisticDCF.perShare, worstCase, data.currentPrice, totalExpectedDamage);
  const raCrvCatalyst = calculateRiskAdjustedCRV(adjustedTarget, worstCase, data.currentPrice, totalExpectedDamage);

  // DCF bei CRV 3:1 — CRV = (FV - WC) / (P - WC) = 3 aufgelöst nach P: P = (FV + 2·WC) / 3
  const dcfBeiCRV3 = (conservativeDCF.perShare + 2 * worstCase) / 3;
  const raDcfBeiCRV3 = (raConservativeFV + 2 * worstCase) / 3;

  const baseCRVs = [
    { label: "Conservative", value: crvConservative, fairValue: conservativeDCF.perShare },
    { label: "Optimistic", value: crvOptimistic, fairValue: optimisticDCF.perShare },
    { label: "Catalyst-Adjusted", value: crvCatalyst, fairValue: adjustedTarget },
  ];

  const riskAdjCRVs = [
    { label: "Conservative", value: raCrvConservative, fairValue: raConservativeFV },
    { label: "Optimistic", value: raCrvOptimistic, fairValue: raOptimisticFV },
    { label: "Catalyst-Adjusted", value: raCrvCatalyst, fairValue: raAdjustedTarget },
  ];

  // === CRV-Härtung gegen DCF-Extrapolation (Auftrag 09.08.2026, "NVO-Muster") ===
  // Generisch: WACC-Floor, Terminal-Value-Guard, Margin-Stress, struktureller
  // Worst-Case-Floor, Divergenz-Flag DCF vs. Markt. Base-CRV bleibt oben
  // unveraendert sichtbar -- dies ist der zusaetzliche, entscheidungsrelevante
  // gehaertete Ausweis (Ticket Teil F: "Base-CRV weiter zeigen, aber
  // entscheidungsrelevante CRV = CRV aus gehaertetem FV/WC").
  const hardenedCRV = useMemo(() => computeHardenedCRV({
    price: data.currentPrice,
    conservativeDCF: { perShare: conservativeDCF.perShare, wacc: conservativeDCF.wacc, enterpriseValue: conservativeDCF.enterpriseValue, pvTerminal: conservativeDCF.pvTerminal },
    sector: data.sector,
    industry: data.sectorProfile?.sector ?? data.sector,
    ebitMarginPct: baseParams.ebitMargin,
    marginDeltaYoYPp: data.scoring?.gateInputs?.marginDeltaYoYPp ?? null,
    fcfMarginYoYPp: data.fcfMarginYoyPp ?? null,
    govExposurePct: data.governmentExposure ?? null,
    moatRating: data.moatRating,
    betaAdjDrawdownPct: (1 - m1 / data.currentPrice) * 100,
    sectorDrawdownPct: sectorDD,
    analystPTMedian: data.analystPT?.median ?? data.currentPrice,
  }), [conservativeDCF, data, baseParams, m1, sectorDD]);

  return (
    <SectionCard number={6} title="RISIKOADJUSTIERTES CRV">
      {/* Worst Case Methods */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Worst Case Methods</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Method</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Formel</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Ergebnis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              <tr>
                <td className="py-2 px-2 font-medium">M1: β-Adj. Drawdown</td>
                {/* M1-Label aus worstCaseM1Label() — immer synchron mit der Implementierung */}
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground text-[10px]">
                  {formatCurrency(data.currentPrice)} × (1 − {m1Label})
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m1)}</td>
              </tr>
              <tr>
                <td className="py-2 px-2 font-medium">M2: Most Likely Risk</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(data.currentPrice)} × (1 − {formatNumber(m2Impact, 0)}%)
                  <span className="text-[9px] ml-1">{data.risks?.length ? '(max. Risiko-Impact)' : '(Fallback)'}</span>
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m2)}</td>
              </tr>
              <tr>
                <td className="py-2 px-2 font-medium">M3: Klassifikation + Sektor-Drawdown</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {data.lynchClass && LYNCH_CLASS_BASE_DRAWDOWN[data.lynchClass] != null
                    ? <>{formatCurrency(data.currentPrice)} × (1 − [0.55×{LYNCH_CLASS_BASE_DRAWDOWN[data.lynchClass]}% + 0.45×{sectorDD}%] = {(0.55 * LYNCH_CLASS_BASE_DRAWDOWN[data.lynchClass] + 0.45 * sectorDD).toFixed(1)}%)</>
                    : <>{formatCurrency(data.currentPrice)} × (1 − {sectorDD}%)</>}
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m3)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td colSpan={2} className="py-2 px-2 font-bold">Worst Case = min(M1, M2, M3)</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-bold text-red-500">{formatCurrency(worstCase)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/50">
          <span className="font-semibold">Max Drawdown Reference:</span> {data.maxDrawdownHistory} ({data.maxDrawdownYear})
        </div>
      </div>

      {/* === BASE CRV (without risk discount) === */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">CRV — Base (ohne Risiko-Abschlag)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {baseCRVs.map((crv, i) => (
            <CRVCard key={i} label={crv.label} value={crv.value} fairValue={crv.fairValue} worstCase={worstCase} />
          ))}
        </div>
      </div>

      {/* === RISK-ADJUSTED CRV === */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
          CRV — Risikoadjustiert (nach Expected Damage)
        </h3>
        <div className="text-[10px] text-muted-foreground mb-2">
          Fair Values abgeschlagen um Total Expected Damage von <span className="font-semibold text-red-400">{formatNumber(totalExpectedDamage, 1)}%</span> (Σ EW% × Impact% aus Risikoinversion)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {riskAdjCRVs.map((crv, i) => (
            <CRVCard key={i} label={crv.label} value={crv.value} fairValue={crv.fairValue} worstCase={worstCase} riskAdj />
          ))}
        </div>
      </div>

      {/* === GEHÄRTETE CRV (gegen Low-WACC/High-TV/High-Margin-Extrapolation) === */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
          CRV — Gehärtet (WACC-Floor, TV-Guard, Margin-Stress, Structural-WC)
        </h3>
        <div className="text-[10px] text-muted-foreground mb-2">
          Entscheidungsrelevante CRV nach Härtung gegen DCF-Extrapolation — schützt vor optisch attraktiven CRVs bei Low-Beta/Low-WACC/High-Terminal-Value-Setups.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CRVCard label="Raw (unbereinigt)" value={hardenedCRV.crvRaw} fairValue={hardenedCRV.fvRaw} worstCase={data.currentPrice * (1 - Math.min((1 - m1 / data.currentPrice) * 100, sectorDD) / 100)} />
          <CRVCard label="Gehärtet" value={hardenedCRV.crvHardened} fairValue={hardenedCRV.fvHardened} worstCase={hardenedCRV.wcUsed} />
          <CRVCard label="Stress (+ Margin-Stress)" value={hardenedCRV.crvStress} fairValue={hardenedCRV.fvStress} worstCase={hardenedCRV.wcUsed} />
        </div>
        {hardenedCRV.flags.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {hardenedCRV.flags.map((flag, i) => (
              <div key={i} className="text-[10px] text-amber-500 bg-amber-500/10 rounded-md px-2 py-1 border border-amber-500/20">
                ⚠ {flag}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          <div className="bg-muted/30 rounded-md p-2 border border-border/50">
            <div className="text-muted-foreground">WACC (Modell → verwendet)</div>
            <div className="font-mono font-semibold">{formatNumber(hardenedCRV.waccModel, 2)}% → {formatNumber(hardenedCRV.waccUsed, 2)}%</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 border border-border/50">
            <div className="text-muted-foreground">TV / EV</div>
            <div className="font-mono font-semibold">{formatNumber(hardenedCRV.tvOverEv * 100, 1)}%</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 border border-border/50">
            <div className="text-muted-foreground">Margin-Stress</div>
            <div className="font-mono font-semibold">−{formatNumber(hardenedCRV.marginStressPp, 1)}pp</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 border border-border/50">
            <div className="text-muted-foreground">Structural-WC-Floor</div>
            <div className="font-mono font-semibold">{hardenedCRV.structuralFloorPct > 0 ? `${formatNumber(hardenedCRV.structuralFloorPct, 0)}%` : "—"}</div>
          </div>
        </div>
        {hardenedCRV.divergenceFlag && (
          <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 rounded-md p-2 border border-red-500/20">
            <span className="font-semibold">DCF vs. Markt Divergenz:</span> DCF-Upside {formatNumber(hardenedCRV.dcfUpsidePct, 0)}% vs. Analyst-Upside {formatNumber(hardenedCRV.analystUpsidePct, 0)}% — das Fazit darf nicht allein auf dem unbereinigten Base-CRV beruhen.
          </div>
        )}
      </div>

      {/* DCF bei CRV 3:1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`rounded-lg p-3 border-2 ${data.currentPrice <= dcfBeiCRV3 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">DCF bei CRV 3:1 — Base</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{formatCurrency(dcfBeiCRV3)}</div>
          <div className={`text-xs font-bold mt-0.5 ${data.currentPrice <= dcfBeiCRV3 ? 'text-emerald-500' : 'text-red-500'}`}>
            {data.currentPrice <= dcfBeiCRV3 ? 'Kurs UNTER Max-Entry ✔' : 'Kurs ÜBER Max-Entry ⚠'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            = ({formatCurrency(conservativeDCF.perShare)} + 2 × {formatCurrency(worstCase)}) / 3
          </div>
        </div>
        <div className={`rounded-lg p-3 border-2 ${data.currentPrice <= raDcfBeiCRV3 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">DCF bei CRV 3:1 — Risikoadj.</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{formatCurrency(raDcfBeiCRV3)}</div>
          <div className={`text-xs font-bold mt-0.5 ${data.currentPrice <= raDcfBeiCRV3 ? 'text-emerald-500' : 'text-red-500'}`}>
            {data.currentPrice <= raDcfBeiCRV3 ? 'Kurs UNTER Max-Entry ✔' : 'Kurs ÜBER Max-Entry ⚠'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            = ({formatCurrency(raConservativeFV)} + 2 × {formatCurrency(worstCase)}) / 3
          </div>
        </div>
      </div>

      <RechenWeg title="CRV Rechenweg (FCFF-basiert)" steps={[
        `=== BASE CRV ===`,
        `CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)`,
        `Conservative CRV = (${formatCurrency(conservativeDCF.perShare)} - ${formatCurrency(worstCase)}) / (${formatCurrency(data.currentPrice)} - ${formatCurrency(worstCase)}) = ${formatNumber(crvConservative, 2)}:1`,
        ``,
        `=== RISIKOADJUSTIERT ===`,
        `Total Expected Damage = ${formatNumber(totalExpectedDamage, 2)}%`,
        `Risk-Adj. Fair Value = ${formatCurrency(conservativeDCF.perShare)} × (1 - ${formatNumber(totalExpectedDamage, 1)}%) = ${formatCurrency(raConservativeFV)}`,
        `Risk-Adj. CRV = (${formatCurrency(raConservativeFV)} - ${formatCurrency(worstCase)}) / (${formatCurrency(data.currentPrice)} - ${formatCurrency(worstCase)}) = ${formatNumber(raCrvConservative, 2)}:1`,
        ``,
        `DCF bei CRV 3:1 (Base) = (${formatCurrency(conservativeDCF.perShare)} + 2 × ${formatCurrency(worstCase)}) / 3 = ${formatCurrency(dcfBeiCRV3)}`,
        `DCF bei CRV 3:1 (Risk-Adj.) = (${formatCurrency(raConservativeFV)} + 2 × ${formatCurrency(worstCase)}) / 3 = ${formatCurrency(raDcfBeiCRV3)}`,
        ``,
        `=== M1 FORMEL (Implementierung) ===`,
        `effectiveDrawdown = min(beta × sectorDD, sectorDD × 1.5), gecapped bei 65%`,
        `M1 = ${formatCurrency(data.currentPrice)} × (1 - ${m1Label})`,
      ]} />
    </SectionCard>
  );
}

function CRVCard({ label, value, fairValue, worstCase, riskAdj }: {
  label: string; value: number; fairValue: number; worstCase: number; riskAdj?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 border ${getCRVBgColor(value)}`}>
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
        {label} {riskAdj && <span className="text-amber-500">(RA)</span>}
      </div>
      <div className={`text-xl font-bold font-mono tabular-nums mt-1 ${getCRVColor(value)}`}>
        {isFinite(value) && !isNaN(value) ? `${formatNumber(value, 1)}:1` : "n/a"}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        Fair: {formatCurrency(fairValue)} | WC: {formatCurrency(worstCase)}
      </div>
      <div className={`text-[10px] mt-1 font-medium ${
        value >= 2.5 ? "text-emerald-500" :
        value >= 2.0 ? "text-amber-500" : "text-red-500"
      }`}>
        {!isFinite(value) || isNaN(value) ? "–" : value >= 2.5 ? "Attractive" : value >= 2.0 ? "Acceptable" : "Unfavorable"}
      </div>
    </div>
  );
}
