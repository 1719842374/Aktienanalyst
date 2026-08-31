/**
 * CompanyNode.tsx
 * ---------------
 * Statische Karte für eine einzelne Firma innerhalb einer Value-Chain-Stage
 * (KEIN React-Flow-Node — Sprint D6a, siehe Kommentar in StageNode.tsx für
 * die Begründung/Vorgeschichte der @xyflow/react-Entfernung).
 *
 * Zeigt: Ticker, Name, Marktkapitalisierung, 1J-Performance, Valuation-Flag,
 * 13F-Badge, sowie CAPEX-Intensity mit Farbe (capexColorClass, unverändert
 * aus valueChainTypes.ts übernommen — Rang 6).
 */

import { memo } from "react";
import type { CompanyNodeData, ValuationFlag } from "@/lib/valueChainTypes";
import { formatCapexIntensity, capexColorClass, capexBorderClass } from "@/lib/valueChainTypes";

function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

function formatPerf(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

const valuationColors: Record<ValuationFlag, string> = {
  cheap: "bg-emerald-500/20 text-emerald-300",
  fair: "bg-slate-500/20 text-slate-300",
  expensive: "bg-rose-500/20 text-rose-300",
  "n/a": "bg-slate-700/40 text-slate-500",
};

interface CompanyNodeProps {
  data: CompanyNodeData;
  /** Optionaler Klick-Handler (z.B. Navigation zu /#/?ticker=XYZ) */
  onClick?: (ticker: string) => void;
}

function CompanyNodeComponent({ data, onClick }: CompanyNodeProps) {
  const perfColor =
    data.performance1Y == null
      ? "text-slate-400"
      : data.performance1Y >= 0
        ? "text-emerald-400"
        : "text-rose-400";

  const flag = data.valuationFlag ?? "n/a";
  const capexBorder = capexBorderClass(data.capexIntensity);

  return (
    <div
      className={`min-w-[160px] max-w-[220px] rounded-lg border ${capexBorder} bg-slate-900/80 px-3 py-2 shadow-md backdrop-blur-sm hover:border-cyan-500/60 transition-colors cursor-pointer`}
      onClick={() => onClick?.(data.ticker)}
    >
      <div className="flex items-center gap-2">
        {data.logoUrl ? (
          <img
            src={data.logoUrl}
            alt=""
            className="h-6 w-6 rounded-full object-contain bg-white/10"
          />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold text-slate-300">
            {data.ticker.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-white truncate">{data.ticker}</span>
            {data.starInvestorFlag && (
              <span className="text-[10px] text-amber-400" title="Star Investor 13F">
                ★
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 truncate">{data.name}</div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className="text-slate-300">{formatMarketCap(data.marketCap)}</span>
        <span className={perfColor}>{formatPerf(data.performance1Y)}</span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <span className={`rounded px-1.5 py-0.5 text-[9px] ${valuationColors[flag]}`}>
          {flag}
        </span>
        {data.institutionalHolders13F != null && data.institutionalHolders13F > 0 && (
          <span className="text-[9px] text-slate-500">
            13F: {data.institutionalHolders13F}
          </span>
        )}
        <span className={`text-[9px] font-medium ${capexColorClass(data.capexIntensity)}`}>
          CAPEX {formatCapexIntensity(data.capexIntensity)}
        </span>
      </div>
    </div>
  );
}

export const CompanyNode = memo(CompanyNodeComponent);
