import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { RevenueSegment } from "@shared/schema";
import type { SegmentSupplement } from "@shared/segment-supplement";

/**
 * Unterposten und Wachstumsschätzung unter den gemeldeten Segmenten.
 * Die Balken darüber bleiben die FMP-/SEC-Summe. Alles Geschätzte ist als Override markiert.
 */
export function SegmentSupplementView({ ticker, segments }: { ticker: string; segments: RevenueSegment[] }) {
  const official = segments.map(s => ({
    name: s.name,
    percentage: Number.isFinite(s.percentage) ? s.percentage : null,
    growthPct: s.growth ?? s.yoyChangePercent ?? null,
  }));
  const q = useQuery({
    queryKey: ["segment-supplement", ticker, official.map(s => s.name).join("|")],
    enabled: official.length > 0,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/segment-supplement", { ticker, segments: official });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SegmentSupplement>;
    },
  });
  if (official.length === 0) return null;
  const data = q.data;
  return (
    <div className="mt-2 space-y-1 min-w-0" data-testid="segment-supplement">
      {q.isError && <p className="text-[10px] text-muted-foreground">n/a — Segment-Ergänzung nicht erreichbar</p>}
      {data && <p className="text-[10px] text-muted-foreground">{data.undisclosedNote}</p>}
      {data?.growth.map(g => (
        <div key={g.name} className="pl-4 text-[10px]" data-testid={`segment-growth-${g.name}`}>
          <span className="text-muted-foreground">{g.name}, nächstes Jahr: </span>
          {g.nextYearGrowthPct == null ? (
            <span>{g.label}</span>
          ) : (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 text-amber-700 dark:text-amber-300" title={g.label}>
              Override {g.nextYearGrowthPct >= 0 ? "+" : ""}{g.nextYearGrowthPct.toFixed(1)} %
            </span>
          )}
        </div>
      ))}
      {data?.subItems.map(item => (
        <div key={`${item.parent}:${item.name}`} className="pl-8 text-[10px]" data-testid="segment-subitem">
          <span className="text-muted-foreground">└ {item.parent} / {item.name}: </span>
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1" title={item.label}>
            {item.shareOfParentPct == null ? item.label : `Override ${item.shareOfParentPct.toFixed(1)} % vom Elternsegment`}
          </span>
        </div>
      ))}
    </div>
  );
}
