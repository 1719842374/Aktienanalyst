import type { StockAnalysis, PeerCompany } from "@shared/schema";

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

// Find the "best" value in a column: lowest for valuation metrics, highest for growth
function findBest(values: (number | null)[], lowerIsBetter: boolean): number | null {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  return lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
}

export default function PeerComparison({ data }: { data: StockAnalysis }) {
  const pc = data.peerComparison;
  if (!pc || !pc.peers || pc.peers.length === 0) return null;

  const { subject, peers, peerAvg } = pc;

  // All companies (subject + peers) for best-value calculation
  const allCompanies: PeerCompany[] = [subject, ...peers];

  // Columns definition with best-value logic
  const cols: {
    key: keyof PeerCompany;
    label: string;
    lowerIsBetter: boolean;
    decimals: number;
    suffix: string;
  }[] = [
    { key: "pe", label: "P/E", lowerIsBetter: true, decimals: 1, suffix: "" },
    { key: "peg", label: "PEG", lowerIsBetter: true, decimals: 2, suffix: "" },
    { key: "ps", label: "P/S", lowerIsBetter: true, decimals: 1, suffix: "" },
    { key: "pb", label: "P/B", lowerIsBetter: true, decimals: 1, suffix: "" },
    { key: "epsGrowth1Y", label: "EPS 1Y", lowerIsBetter: false, decimals: 1, suffix: "%" },
    { key: "epsGrowth5Y", label: "EPS 5Y", lowerIsBetter: false, decimals: 1, suffix: "%" },
  ];

  // Precompute best values per column
  const bestValues: Map<string, number | null> = new Map();
  for (const col of cols) {
    const vals = allCompanies.map(c => (c as any)[col.key] as number | null);
    bestValues.set(col.key, findBest(vals, col.lowerIsBetter));
  }

  // Check if a value is the best in its column
  function isBest(key: string, val: number | null | undefined): boolean {
    if (val == null || isNaN(val) || !isFinite(val) || val <= 0) return false;
    const best = bestValues.get(key);
    if (best == null) return false;
    return Math.abs(val - best) < 0.01;
  }

  // Cell className
  function cellClass(key: string, val: number | null | undefined, isSubject: boolean): string {
    const base = "py-1.5 px-1.5 text-right font-mono tabular-nums";
    if (isBest(key, val)) return `${base} text-emerald-400 font-semibold`;
    if (isSubject) return `${base}`;
    return `${base} text-foreground/70`;
  }

  // Premium/discount of subject vs peer avg
  function premiumPct(subjectVal: number | null, avgVal: number | null): string | null {
    if (subjectVal == null || avgVal == null || avgVal === 0) return null;
    const diff = ((subjectVal - avgVal) / avgVal) * 100;
    return diff > 0 ? `+${diff.toFixed(0)}%` : `${diff.toFixed(0)}%`;
  }

  function premiumColor(subjectVal: number | null, avgVal: number | null, lowerIsBetter: boolean): string {
    if (subjectVal == null || avgVal == null || avgVal === 0) return "text-foreground/40";
    const diff = ((subjectVal - avgVal) / avgVal) * 100;
    const isCheap = lowerIsBetter ? diff < -5 : diff > 5;
    const isExpensive = lowerIsBetter ? diff > 5 : diff < -5;
    if (isCheap) return "text-emerald-400";
    if (isExpensive) return "text-red-400";
    return "text-foreground/50";
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground mb-1">
        Bewertungsvergleich mit {peers.length} direkten Wettbewerbern —{" "}
        <span className="text-emerald-400">■</span> bester Wert je Kennzahl
      </div>

      {/* Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Ticker</th>
              <th className="text-right py-2 px-1.5 text-muted-foreground font-medium">Mkt Cap</th>
              {cols.map(c => (
                <th key={c.key} className="text-right py-2 px-1.5 text-muted-foreground font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {/* Subject row (highlighted) */}
            <tr className="bg-primary/5 font-semibold">
              <td className="py-1.5 px-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-primary">{subject.ticker}</span>
                  <span className="text-[9px] px-1 py-px rounded bg-primary/15 text-primary/80">Analyse</span>
                </div>
              </td>
              <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">{fmtCap(subject.marketCap)}</td>
              {cols.map(c => {
                const val = (subject as any)[c.key] as number | null;
                return (
                  <td key={c.key} className={cellClass(c.key, val, true)}>
                    {val != null ? `${fmt(val, c.decimals)}${c.suffix}` : "—"}
                  </td>
                );
              })}
            </tr>

            {/* Peer rows */}
            {peers.map((p, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="py-1.5 px-2 text-foreground/80">{p.ticker}</td>
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-foreground/60">{fmtCap(p.marketCap)}</td>
                {cols.map(c => {
                  const val = (p as any)[c.key] as number | null;
                  return (
                    <td key={c.key} className={cellClass(c.key, val, false)}>
                      {val != null ? `${fmt(val, c.decimals)}${c.suffix}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Peer Average row */}
            <tr className="border-t-2 border-border bg-muted/10 font-medium">
              <td className="py-2 px-2 text-muted-foreground">Ø Peers ({peers.length})</td>
              <td className="py-2 px-1.5 text-right text-muted-foreground">—</td>
              {cols.map(c => {
                const avgVal = (peerAvg as any)[c.key] as number | null;
                return (
                  <td key={c.key} className="py-2 px-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {avgVal != null ? `${fmt(avgVal, c.decimals)}${c.suffix}` : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Premium/Discount Summary Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {cols.map(c => {
          const sVal = (subject as any)[c.key] as number | null;
          const aVal = (peerAvg as any)[c.key] as number | null;
          const prem = premiumPct(sVal, aVal);
          const color = premiumColor(sVal, aVal, c.lowerIsBetter);
          if (!prem) return (
            <div key={c.key} className="rounded-lg border border-border/30 bg-muted/20 p-1.5 text-center">
              <div className="text-[10px] text-muted-foreground">{c.label}</div>
              <div className="text-xs font-mono text-foreground/30">—</div>
            </div>
          );
          const bgColor = color.includes("emerald") ? "bg-emerald-500/8 border-emerald-500/20" :
            color.includes("red") ? "bg-red-500/8 border-red-500/20" : "bg-muted/20 border-border/30";
          return (
            <div key={c.key} className={`rounded-lg border p-1.5 text-center ${bgColor}`}>
              <div className="text-[10px] text-muted-foreground">{c.label}</div>
              <div className={`text-sm font-mono font-bold ${color}`}>{prem}</div>
              <div className={`text-[9px] ${color}`}>
                {color.includes("emerald") ? (c.lowerIsBetter ? "Discount" : "Stärker") :
                 color.includes("red") ? (c.lowerIsBetter ? "Premium" : "Schwächer") : "Fair"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
