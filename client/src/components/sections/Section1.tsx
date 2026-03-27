import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { formatCurrency, formatLargeNumber, formatPercentNoSign, formatNumber } from "../../lib/formatters";

interface Props { data: StockAnalysis }

export function Section1({ data }: Props) {
  const ptUpside = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;

  return (
    <SectionCard number={1} title="DATENAKTUALITÄT & PLAUSIBILITÄT">
      {/* Currency Conversion Banner */}
      {data.currencyInfo?.converted && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
          <span className="text-base flex-shrink-0">💱</span>
          <div className="text-xs">
            <span className="font-semibold text-blue-400">Währungsumrechnung aktiv</span>
            <span className="text-foreground/70 ml-1">
              — Finanzdaten in {data.currencyInfo.reportedCurrency} gemeldet, umgerechnet zu USD
              ({data.currencyInfo.fxPair} = {data.currencyInfo.fxRate.toFixed(4)}).
              Alle Bewertungen und DCF-Berechnungen in USD.
            </span>
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPI label="Price" value={formatCurrency(data.currentPrice)} sub={new Date(data.priceTimestamp).toLocaleString()} />
        <KPI label="Market Cap" value={formatLargeNumber(data.marketCap)} />
        <KPI label="Beta (5Y)" value={formatNumber(data.beta5Y)} />
        <KPI label="P/E" value={formatNumber(data.peRatio, 1)} sub={`Fwd: ${formatNumber(data.forwardPE, 1)}`} />
        <KPI label="EV/EBITDA" value={formatNumber(data.evEbitda, 1)} />
      </div>

      {/* EPS Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Metric</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            <Row label="EPS TTM" value={`$${formatNumber(data.epsTTM)}`} />
            <Row label="EPS adj. FY" value={`$${formatNumber(data.epsAdjFY)}`} />
            <Row label="EPS Consensus Next FY" value={`$${formatNumber(data.epsConsensusNextFY)}`} />
            <Row label="EPS Growth 5Y" value={formatPercentNoSign(data.epsGrowth5Y)} />
          </tbody>
        </table>
      </div>

      {/* Analyst Ratings */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Analyst Ratings</h3>
        <div className="flex items-center gap-4 mb-2">
          <RatingBadge label="Buy" count={data.ratings.buy} color="bg-emerald-500/15 text-emerald-500" />
          <RatingBadge label="Hold" count={data.ratings.hold} color="bg-amber-500/15 text-amber-500" />
          <RatingBadge label="Sell" count={data.ratings.sell} color="bg-red-500/15 text-red-500" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border/50">
              <Row label="Median PT" value={formatCurrency(data.analystPT.median)} />
              <Row label="High PT" value={formatCurrency(data.analystPT.high)} />
              <Row label="Low PT" value={formatCurrency(data.analystPT.low)} />
              <Row label="PT Upside" value={`${ptUpside >= 0 ? "+" : ""}${ptUpside.toFixed(1)}%`}
                valueClass={ptUpside >= 0 ? "text-emerald-500" : "text-red-500"} />
              <Row label="# Analysts" value={data.analystPT.count.toString()} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Valuation Metrics */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Valuation Metrics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border/50">
              <Row label="P/E" value={formatNumber(data.peRatio, 1)} />
              <Row label="Forward P/E" value={formatNumber(data.forwardPE, 1)} />
              <Row label="PEG" value={formatNumber(data.pegRatio)} />
              <Row label="EV/EBITDA" value={formatNumber(data.evEbitda, 1)} />
              <Row label="FCF TTM" value={formatLargeNumber(data.fcfTTM)} />
              <Row label="FCF Margin" value={formatPercentNoSign(data.fcfMargin)} />
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-3 border border-border/50">
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <tr>
      <td className="py-1.5 px-2 text-muted-foreground">{label}</td>
      <td className={`py-1.5 px-2 text-right font-mono tabular-nums font-medium ${valueClass || "text-foreground"}`}>{value}</td>
    </tr>
  );
}

function RatingBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${color}`}>
      {label} <span className="font-mono tabular-nums font-bold">{count}</span>
    </span>
  );
}
