import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis, RevenueSegment } from "../../../../shared/schema";
import { calculateFCFFDCF, buildDefaultDCFParams, calculateCatalystUpside, selectCatalystBase } from "../../lib/calculations";
import { formatPercentNoSign, formatNumber, formatCurrency, formatLargeNumber } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

/** Returns true only for genuinely cyclical cycleClassification strings */
function isTrueCyclical(cycle: string): boolean {
  const c = cycle.toLowerCase().trim();
  if (c.includes('non-cyclical') || c.includes('non cyclical')) return false;
  if (c.includes('defensive')) return false;
  if (c.includes('pharma') || c.includes('healthcare') || c.includes('health care')) return false;
  if (c.includes('utility') || c.includes('utilities')) return false;
  if (c.includes('consumer staples')) return false;
  if (c.includes('telecom')) return false;
  return (
    c === 'cyclical' ||
    c === 'zykliker' ||
    c === 'zyklisch' ||
    c.startsWith('cyclical ') ||
    c.startsWith('zyklisch') ||
    c.includes('true cyclical') ||
    c.includes('commodity') ||
    c.includes('energy cyclical') ||
    c.includes('materials') ||
    c.includes('basic materials')
  );
}

const CYCLICAL_TICKERS = new Set([
  'XOM','CVX','COP','SLB','HAL','MPC','VLO','PSX','OXY','DVN','FANG',
  'FCX','NUE','X','CLF','AA','NEM','GOLD','AEM','WPM',
  'F','GM','STLA','TM','HMC',
  'DOW','LYB','CE','EMN','HUN','ALB',
  'DAL','UAL','AAL','LUV','JBLU','HA',
  'RIO','BHP','VALE','MT','SCCO',
  'CAT','DE','CMI','PCAR','TEX',
  'CF','MOS','NTR',
]);

export function Section2({ data }: Props) {
  const catalysts = data.catalysts;
  const params = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);
  const baseDCF = useMemo(() => calculateFCFFDCF(params), [params]);
  const _rawUpsideS2 = (data.catalysts || []).reduce((s, c) => s + c.gb, 0);
  const _baseInfoS2 = selectCatalystBase(baseDCF.perShare, _rawUpsideS2, data.currentPrice, data.analystPT.median);
  const catalystDCFBase = _baseInfoS2.base;
  const catalystBaseFallback = _baseInfoS2.source !== "dcf";
  const { totalUpside, adjustedTarget } = useMemo(
    () => calculateCatalystUpside(catalysts, catalystDCFBase),
    [catalysts, catalystDCFBase]
  );

  return (
    <SectionCard number={3} title="INVESTMENTTHESE & KATALYSATOREN">
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Company Description</h3>
          <p className="text-xs text-foreground/80 leading-relaxed max-h-[200px] overflow-y-auto">{data.description}</p>
        </div>
        <div className="bg-muted/30 rounded-md p-3 border border-border/50">
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Investment These & Katalysatoren-Logik</h3>
          <p className="text-xs text-foreground/80 leading-relaxed">{data.growthThesis}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Moat Assessment</div>
            <div className="text-xs text-foreground/80 mt-1">{data.moatRating}</div>
          </div>
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">FCF Strength</div>
            <div className="text-xs text-foreground/80 mt-1">{formatPercentNoSign(data.fcfMargin)} margin • {formatLargeNumber(data.fcfTTM)} TTM</div>
          </div>
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Katalysatoren (Company-Specific)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Catalyst</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">GB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {catalysts.map((c, i) => (
                <tr key={i}>
                  <td className="py-1.5 px-2 font-medium">{c.name}</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold">{formatNumber(c.gb, 2)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-2 px-2">Total Upside (Σ GB)</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(totalUpside, 2)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="bg-primary/5 rounded-md p-3 border border-primary/10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Conservative DCF (base, WACC {baseDCF.wacc.toFixed(1)}%)</span>
          <span className="font-mono tabular-nums font-semibold">{formatCurrency(baseDCF.perShare)}</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-muted-foreground">
            Kat.-adj. Zielwert = {catalystBaseFallback ? 'Analyst PT' : 'Kons. DCF'} × (1 + {formatNumber(totalUpside, 2)}%)
          </span>
          <span className="font-mono tabular-nums font-semibold text-primary">{formatCurrency(adjustedTarget)}</span>
        </div>
      </div>
      <RechenWeg title="DCF Rechenweg" steps={baseDCF.steps} />
    </SectionCard>
  );
}
