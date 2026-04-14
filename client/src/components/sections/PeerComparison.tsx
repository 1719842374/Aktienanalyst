import type { StockAnalysis } from "@shared/schema";

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v) || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function fmtCap(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

// Premium/Discount color: negative = green (cheap), positive = red (expensive)
function premiumClass(subject: number | null, peerAvg: number | null): string {
  if (subject == null || peerAvg == null || peerAvg === 0) return "";
  const diff = ((subject - peerAvg) / peerAvg) * 100;
  if (diff < -20) return "text-emerald-400 font-semibold";
  if (diff < -5) return "text-emerald-400/80";
  if (diff > 20) return "text-red-400 font-semibold";
  if (diff > 5) return "text-red-400/80";
  return "text-foreground/60";
}

function premiumLabel(subject: number | null, peerAvg: number | null): string {
  if (subject == null || peerAvg == null || peerAvg === 0) return "";
  const diff = ((subject - peerAvg) / peerAvg) * 100;
  if (diff > 0) return `+${diff.toFixed(0)}%`;
  return `${diff.toFixed(0)}%`;
}

export default function PeerComparison({ data }: { data: StockAnalysis }) {
  const pc = data.peerComparison;
  if (!pc || !pc.peers || pc.peers.length === 0) return null;

  const { subject, peers, peerAvg } = pc;

  const metrics: {
    key: string;
    label: string;
    subjectVal: number | null;
    avgVal: number | null;
    peerVals: (number | null)[];
    lowerIsBetter: boolean;
    decimals: number;
  }[] = [
    {
      key: "pe",
      label: "P/E",
      subjectVal: subject.pe,
      avgVal: peerAvg.pe,
      peerVals: peers.map((p) => p.pe),
      lowerIsBetter: true,
      decimals: 1,
    },
    {
      key: "peg",
      label: "PEG",
      subjectVal: subject.peg,
      avgVal: peerAvg.peg,
      peerVals: peers.map((p) => p.peg),
      lowerIsBetter: true,
      decimals: 2,
    },
    {
      key: "ps",
      label: "P/S",
      subjectVal: subject.ps,
      avgVal: peerAvg.ps,
      peerVals: peers.map((p) => p.ps),
      lowerIsBetter: true,
      decimals: 1,
    },
    {
      key: "pb",
      label: "P/B",
      subjectVal: subject.pb,
      avgVal: peerAvg.pb,
      peerVals: peers.map((p) => p.pb),
      lowerIsBetter: true,
      decimals: 1,
    },
    {
      key: "epsGrowth",
      label: "EPS Growth",
      subjectVal: subject.epsGrowth,
      avgVal: peerAvg.epsGrowth,
      peerVals: peers.map((p) => p.epsGrowth),
      lowerIsBetter: false,
      decimals: 1,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground mb-1">
        Bewertungsvergleich mit {peers.length} direkten Wettbewerbern — via
        Perplexity Finance API
      </div>

      {/* Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">
                Unternehmen
              </th>
              <th className="text-right py-2 px-1.5 text-muted-foreground font-medium">
                Mkt Cap
              </th>
              <th className="text-right py-2 px-1.5 text-muted-foreground font-medium">
                P/E
              </th>
              <th className="text-right py-2 px-1.5 text-muted-foreground font-medium">
                PEG
              </th>
              <th className="text-right py-2 px-1.5 text-muted-foreground font-medium">
                P/S
              </th>
              <th className="text-right py-2 px-1.5 text-muted-foreground font-medium">
                P/B
              </th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">
                EPS Gr.
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {/* Subject row (highlighted) */}
            <tr className="bg-primary/5 font-semibold">
              <td className="py-2 px-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-primary">{subject.ticker}</span>
                  <span className="text-[9px] px-1 py-px rounded bg-primary/15 text-primary/80">
                    Analyse
                  </span>
                </div>
              </td>
              <td className="py-2 px-1.5 text-right font-mono tabular-nums">
                {fmtCap(subject.marketCap)}
              </td>
              <td
                className={`py-2 px-1.5 text-right font-mono tabular-nums ${premiumClass(subject.pe, peerAvg.pe)}`}
              >
                {fmt(subject.pe)}
              </td>
              <td
                className={`py-2 px-1.5 text-right font-mono tabular-nums ${premiumClass(subject.peg, peerAvg.peg)}`}
              >
                {fmt(subject.peg, 2)}
              </td>
              <td
                className={`py-2 px-1.5 text-right font-mono tabular-nums ${premiumClass(subject.ps, peerAvg.ps)}`}
              >
                {fmt(subject.ps)}
              </td>
              <td
                className={`py-2 px-1.5 text-right font-mono tabular-nums ${premiumClass(subject.pb, peerAvg.pb)}`}
              >
                {fmt(subject.pb)}
              </td>
              <td className="py-2 px-2 text-right font-mono tabular-nums">
                {subject.epsGrowth != null ? `${fmt(subject.epsGrowth)}%` : "—"}
              </td>
            </tr>

            {/* Peer rows */}
            {peers.map((p, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="py-1.5 px-2 text-foreground/80">{p.ticker}</td>
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-foreground/60">
                  {fmtCap(p.marketCap)}
                </td>
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-foreground/70">
                  {fmt(p.pe)}
                </td>
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-foreground/70">
                  {fmt(p.peg, 2)}
                </td>
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-foreground/70">
                  {fmt(p.ps)}
                </td>
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-foreground/70">
                  {fmt(p.pb)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-foreground/70">
                  {p.epsGrowth != null ? `${fmt(p.epsGrowth)}%` : "—"}
                </td>
              </tr>
            ))}

            {/* Peer Average row */}
            <tr className="border-t-2 border-border bg-muted/10 font-medium">
              <td className="py-2 px-2 text-muted-foreground">
                Ø Peers ({peers.length})
              </td>
              <td className="py-2 px-1.5 text-right text-muted-foreground">
                —
              </td>
              <td className="py-2 px-1.5 text-right font-mono tabular-nums text-muted-foreground">
                {fmt(peerAvg.pe)}
              </td>
              <td className="py-2 px-1.5 text-right font-mono tabular-nums text-muted-foreground">
                {fmt(peerAvg.peg, 2)}
              </td>
              <td className="py-2 px-1.5 text-right font-mono tabular-nums text-muted-foreground">
                {fmt(peerAvg.ps)}
              </td>
              <td className="py-2 px-1.5 text-right font-mono tabular-nums text-muted-foreground">
                {fmt(peerAvg.pb)}
              </td>
              <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">
                {peerAvg.epsGrowth != null ? `${fmt(peerAvg.epsGrowth)}%` : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Premium/Discount Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {metrics
          .filter((m) => m.subjectVal != null && m.avgVal != null)
          .map((m) => {
            const diff =
              m.avgVal! !== 0
                ? ((m.subjectVal! - m.avgVal!) / m.avgVal!) * 100
                : 0;
            const isCheap = m.lowerIsBetter ? diff < 0 : diff > 0;
            const isExpensive = m.lowerIsBetter ? diff > 0 : diff < 0;
            const bgColor = isCheap
              ? "bg-emerald-500/8 border-emerald-500/20"
              : isExpensive
                ? "bg-red-500/8 border-red-500/20"
                : "bg-muted/30 border-border/50";
            const textColor = isCheap
              ? "text-emerald-400"
              : isExpensive
                ? "text-red-400"
                : "text-foreground/50";
            const label = isCheap
              ? "Discount"
              : isExpensive
                ? "Premium"
                : "Fair";

            return (
              <div
                key={m.key}
                className={`rounded-lg border p-2 text-center ${bgColor}`}
              >
                <div className="text-[10px] text-muted-foreground mb-0.5">
                  {m.label}
                </div>
                <div className={`text-sm font-mono font-bold ${textColor}`}>
                  {diff > 0 ? "+" : ""}
                  {diff.toFixed(0)}%
                </div>
                <div className={`text-[9px] ${textColor}`}>{label}</div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
