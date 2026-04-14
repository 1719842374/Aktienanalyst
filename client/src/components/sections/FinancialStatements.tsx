import type { StockAnalysis } from "../../../../shared/schema";
import { SectionCard } from "../SectionCard";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Shield, DollarSign } from "lucide-react";

interface Props { data: StockAnalysis }

const fmt = (v: number, decimals = 1) => {
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(decimals)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(decimals)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(decimals)}M`;
  return `$${v.toFixed(0)}`;
};

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const pctColor = (v: number, invert = false) => {
  const good = invert ? v < 0 : v > 0;
  return good ? 'text-emerald-500' : v === 0 ? 'text-muted-foreground' : 'text-red-500';
};

export function FinancialStatements({ data }: Props) {
  const fs = data.financialStatements;
  if (!fs) return null;

  const { incomeStatement: is, balanceSheet: bs, cashFlow: cf, health, healthReasons } = fs;
  const healthColor = health === 'Excellent' ? 'text-emerald-500' : health === 'Good' ? 'text-emerald-400' :
    health === 'Moderate' ? 'text-amber-500' : health === 'Weak' ? 'text-orange-500' : 'text-red-500';
  const healthBg = health === 'Excellent' ? 'bg-emerald-500/10 border-emerald-500/30' :
    health === 'Good' ? 'bg-emerald-500/10 border-emerald-500/20' :
    health === 'Moderate' ? 'bg-amber-500/10 border-amber-500/20' :
    health === 'Weak' ? 'bg-orange-500/10 border-orange-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <SectionCard id={0} title="FINANCIAL STATEMENTS" subtitle="Income • Balance Sheet • Cash Flow">
      {/* Health Badge */}
      <div className={`rounded-lg p-3 border ${healthBg} flex items-start gap-3`}>
        <Shield className={`w-5 h-5 ${healthColor} flex-shrink-0 mt-0.5`} />
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${healthColor}`}>Finanzgesundheit: {health}</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {healthReasons.map((r, i) => (
              <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                {r.includes('→ Pricing') || r.includes('→ Cash') || r.includes('niedrige Verschuldung') || r.includes('Starke') ?
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0" /> :
                  r.includes('→ Margendruck') || r.includes('→ Cash-Burn') || r.includes('→ Zinsrisiko') || r.includes('→ Insolvenz') || r.includes('Rücklauf') ?
                  <AlertTriangle className="w-2.5 h-2.5 text-red-500 flex-shrink-0" /> :
                  <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
                }
                {r}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Income Statement */}
        <div className="bg-muted/10 rounded-lg p-3 border border-border/30">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Income Statement (TTM)
          </h4>
          <div className="space-y-1.5 text-[10px]">
            <Row label="Revenue" value={fmt(is.revenue)} sub={pct(is.revenueGrowth)} subColor={pctColor(is.revenueGrowth)} />
            <Row label="Gross Profit" value={fmt(is.grossProfit)} sub={`${is.grossMargin.toFixed(1)}% Marge`} subColor={is.grossMargin > 40 ? 'text-emerald-500' : is.grossMargin > 20 ? 'text-amber-500' : 'text-red-500'} />
            <Row label="Operating Income" value={fmt(is.operatingIncome)} sub={`${is.operatingMargin.toFixed(1)}% Marge`} subColor={is.operatingMargin > 20 ? 'text-emerald-500' : is.operatingMargin > 10 ? 'text-amber-500' : 'text-red-500'} />
            <Row label="Net Income" value={fmt(is.netIncome)} sub={`${is.netMargin.toFixed(1)}% Marge`} subColor={is.netMargin > 15 ? 'text-emerald-500' : is.netMargin > 5 ? 'text-amber-500' : 'text-red-500'} />
            <Row label="EBITDA" value={fmt(is.ebitda)} sub={`${is.ebitdaMargin.toFixed(1)}% Marge`} subColor={is.ebitdaMargin > 25 ? 'text-emerald-500' : 'text-muted-foreground'} />
            <Row label="EPS" value={`$${is.eps.toFixed(2)}`} sub={`5Y CAGR ${is.epsGrowth.toFixed(1)}%`} subColor={pctColor(is.epsGrowth)} />
          </div>
        </div>

        {/* Balance Sheet */}
        <div className="bg-muted/10 rounded-lg p-3 border border-border/30">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <Shield className="w-3 h-3" /> Balance Sheet
          </h4>
          <div className="space-y-1.5 text-[10px]">
            <Row label="Total Assets" value={fmt(bs.totalAssets)} />
            <Row label="Total Equity" value={fmt(bs.totalEquity)} sub={`${bs.totalAssets > 0 ? ((bs.totalEquity / bs.totalAssets) * 100).toFixed(0) : 0}% der Assets`} />
            <Row label="Total Debt" value={fmt(bs.totalDebt)} subColor="text-red-500" />
            <Row label="Cash & Equiv." value={fmt(bs.cashEquivalents)} subColor="text-emerald-500" />
            <Row label="Net Debt" value={fmt(bs.netDebt)} sub={bs.netDebt < 0 ? 'Netto-Cash' : 'Netto-Verschuldet'} subColor={bs.netDebt < 0 ? 'text-emerald-500' : 'text-amber-500'} />
            <Row label="Debt/Equity" value={bs.debtToEquity.toFixed(2)} sub={bs.debtToEquity < 0.5 ? 'Konservativ' : bs.debtToEquity < 1.5 ? 'Moderat' : 'Hoch'} subColor={bs.debtToEquity < 0.5 ? 'text-emerald-500' : bs.debtToEquity < 1.5 ? 'text-amber-500' : 'text-red-500'} />
          </div>
        </div>

        {/* Cash Flow */}
        <div className="bg-muted/10 rounded-lg p-3 border border-border/30">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Cash Flow (TTM)
          </h4>
          <div className="space-y-1.5 text-[10px]">
            <Row label="Operating CF" value={fmt(cf.operatingCashFlow)} />
            <Row label="CapEx" value={`-${fmt(Math.abs(cf.capex))}`} subColor="text-red-500" />
            <Row label="Free Cash Flow" value={fmt(cf.fcf)} sub={`${cf.fcfMargin.toFixed(1)}% Marge`} subColor={cf.fcf > 0 ? 'text-emerald-500' : 'text-red-500'} bold />
            <Row label="FCF / Share" value={`$${cf.fcfPerShare.toFixed(2)}`} />
            <div className="pt-1 border-t border-border/20 mt-1">
              <div className="text-[9px] text-muted-foreground">
                FCF Yield: {data.marketCap > 0 ? ((cf.fcf / data.marketCap) * 100).toFixed(1) : 'N/A'}%
                {data.marketCap > 0 && (cf.fcf / data.marketCap) * 100 > 5 && ' (Attraktiv)'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Margin Waterfall */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Margen-Wasserfall</h4>
        <div className="flex items-end gap-1 h-16">
          <WaterfallBar label="Brutto" value={is.grossMargin} maxVal={80} color="bg-emerald-500/60" />
          <WaterfallBar label="EBITDA" value={is.ebitdaMargin} maxVal={80} color="bg-blue-500/60" />
          <WaterfallBar label="Operativ" value={is.operatingMargin} maxVal={80} color="bg-amber-500/60" />
          <WaterfallBar label="Netto" value={is.netMargin} maxVal={80} color="bg-primary/60" />
          <WaterfallBar label="FCF" value={cf.fcfMargin} maxVal={80} color="bg-cyan-500/60" />
        </div>
      </div>
    </SectionCard>
  );
}

function Row({ label, value, sub, subColor, bold }: { label: string; value: string; sub?: string; subColor?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={`font-mono tabular-nums ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
        {sub && <span className={`ml-1.5 text-[9px] ${subColor || 'text-muted-foreground'}`}>{sub}</span>}
      </div>
    </div>
  );
}

function WaterfallBar({ label, value, maxVal, color }: { label: string; value: number; maxVal: number; color: string }) {
  const height = Math.max(4, Math.min(100, (Math.abs(value) / maxVal) * 100));
  return (
    <div className="flex-1 flex flex-col items-center gap-0.5">
      <span className={`text-[9px] font-mono tabular-nums ${value > 0 ? '' : 'text-red-500'}`}>{value.toFixed(0)}%</span>
      <div className="w-full bg-muted/20 rounded-sm relative" style={{ height: '48px' }}>
        <div className={`absolute bottom-0 w-full ${color} rounded-sm transition-all`} style={{ height: `${height}%` }} />
      </div>
      <span className="text-[8px] text-muted-foreground">{label}</span>
    </div>
  );
}
