import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { calculateWACC } from "../../lib/calculations";
import { formatPercentNoSign, formatNumber } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section4({ data }: Props) {
  const sp = data.sectorProfile;
  const rfr = 4.2;
  const mrp = 5.5;
  const cod = 4.8;
  const taxRate = 0.21;
  const debtRatio = data.totalDebt / (data.marketCap + data.totalDebt);

  // Use sector profile WACC scenarios as reference
  const waccFromProfile = sp.waccScenarios;

  const scenarios = useMemo(() => [
    { name: "Conservative", beta: data.beta5Y * 1.1, dr: debtRatio * 1.1, rfr: rfr + 0.5, profileWACC: waccFromProfile.kons },
    { name: "Average", beta: data.beta5Y, dr: debtRatio, rfr, profileWACC: waccFromProfile.avg },
    { name: "Optimistic", beta: data.beta5Y * 0.9, dr: debtRatio * 0.9, rfr: rfr - 0.3, profileWACC: waccFromProfile.opt },
  ], [data.beta5Y, debtRatio, waccFromProfile]);

  const waccResults = scenarios.map((s) => ({
    ...s,
    wacc: calculateWACC(s.beta, s.rfr, mrp, s.dr, cod, taxRate),
  }));

  const pegCalc = useMemo(() => {
    const pe = data.peRatio;
    const growth = data.epsGrowth5Y;
    const peg = growth !== 0 ? pe / growth : 0;
    return {
      pe, growth, peg,
      steps: [
        `PEG = P/E ÷ EPS Growth Rate`,
        `PEG = ${formatNumber(pe, 1)} ÷ ${formatNumber(growth, 1)}`,
        `PEG = ${formatNumber(peg, 2)}`,
        peg < 1 ? `→ PEG < 1.0: Potentially undervalued relative to growth` :
        peg < 2 ? `→ PEG 1.0-2.0: Fairly valued` :
        `→ PEG > 2.0: Premium valuation relative to growth`,
      ],
    };
  }, [data.peRatio, data.epsGrowth5Y]);

  return (
    <SectionCard number={4} title="BEWERTUNGSKENNZAHLEN">
      {/* WACC Table */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">WACC Scenarios (Damodaran)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Scenario</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Beta</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rf Rate</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">D/V</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">WACC (calc)</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">WACC (Profil)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {waccResults.map((s, i) => (
                <tr key={i} className={i === 1 ? "bg-primary/5" : ""}>
                  <td className="py-2 px-2 font-medium">{s.name}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatNumber(s.beta)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatPercentNoSign(s.rfr, 1)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatPercentNoSign(s.dr * 100, 1)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold">{formatPercentNoSign(s.wacc, 2)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-primary">{formatPercentNoSign(s.profileWACC, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <RechenWeg title="WACC Rechenweg" steps={[
          `WACC = E/V × Re + D/V × Rd × (1 - T)`,
          `Re = Rf + β × MRP = ${rfr}% + ${formatNumber(data.beta5Y)} × ${mrp}% = ${formatPercentNoSign(rfr + data.beta5Y * mrp, 2)}`,
          `D/V = ${formatPercentNoSign(debtRatio * 100, 1)}`,
          `WACC (Avg) = ${formatPercentNoSign((1 - debtRatio) * 100, 1)} × ${formatPercentNoSign(rfr + data.beta5Y * mrp, 2)} + ${formatPercentNoSign(debtRatio * 100, 1)} × ${cod}% × (1 - ${taxRate * 100}%)`,
          `WACC (Avg) = ${formatPercentNoSign(waccResults[1].wacc, 2)}`,
          `Sector Profile WACC: Kons ${waccFromProfile.kons}% | Avg ${waccFromProfile.avg}% | Opt ${waccFromProfile.opt}%`,
        ]} />
      </div>

      {/* WACC Sensitivity */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">WACC Sensitivity to Interest Rates</h3>
        <div className="grid grid-cols-3 gap-2">
          {[-100, 0, 100].map((bp) => {
            const adjRfr = rfr + bp / 100;
            const adjWacc = calculateWACC(data.beta5Y, adjRfr, mrp, debtRatio, cod + bp / 200, taxRate);
            return (
              <div key={bp} className="bg-muted/30 rounded-md p-2.5 border border-border/50 text-center">
                <div className="text-[10px] text-muted-foreground">{bp >= 0 ? "+" : ""}{bp}bp</div>
                <div className="text-sm font-semibold font-mono tabular-nums mt-0.5">{formatPercentNoSign(adjWacc, 2)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PEG Calculation */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">PEG Ratio</h3>
        <div className="flex items-center gap-4">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground">P/E</div>
            <div className="text-lg font-semibold font-mono tabular-nums">{formatNumber(pegCalc.pe, 1)}</div>
          </div>
          <span className="text-lg text-muted-foreground">÷</span>
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground">EPS Growth</div>
            <div className="text-lg font-semibold font-mono tabular-nums">{formatNumber(pegCalc.growth, 1)}%</div>
          </div>
          <span className="text-lg text-muted-foreground">=</span>
          <div className={`rounded-md p-3 border ${pegCalc.peg < 1 ? "bg-emerald-500/10 border-emerald-500/20" : pegCalc.peg < 2 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20"}`}>
            <div className="text-[10px] text-muted-foreground">PEG</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${pegCalc.peg < 1 ? "text-emerald-500" : pegCalc.peg < 2 ? "text-amber-500" : "text-red-500"}`}>
              {formatNumber(pegCalc.peg, 2)}
            </div>
          </div>
        </div>
        <RechenWeg title="PEG Rechenweg" steps={pegCalc.steps} />
      </div>
    </SectionCard>
  );
}
