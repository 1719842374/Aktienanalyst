import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface SegmentGapItem {
  parent: string;
  kind: "product" | "geographic";
  name: string;
  shareOfParentPct: number | null;
  growthPct: number | null;
  basis: string;
}

interface SegmentGapResult {
  items: SegmentGapItem[];
  reason: string | null;
}

export type GapRequest = (method: string, url: string, data?: unknown) => Promise<Response>;

export function SegmentGapPanel({
  ticker,
  request = apiRequest,
}: {
  ticker: string;
  request?: GapRequest;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["/api/segment-gaps", ticker],
    enabled: open && ticker.trim().length > 0,
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: async (): Promise<SegmentGapResult> => {
      const response = await request("POST", "/api/segment-gaps", { ticker });
      const body = await response.json().catch(() => null) as (SegmentGapResult & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error || "n/a — fehlende Segmente nicht erreichbar");
      return { items: body?.items ?? [], reason: body?.reason ?? null };
    },
  });
  return (
    <div className="mt-3" data-testid="segment-gaps">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300"
        aria-pressed={open}
        data-testid="segment-gap-toggle"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Fehlende Segmente/Regionen ausblenden" : "Fehlende Segmente/Regionen anzeigen"}
      </button>
      {open && query.isLoading ? <p className="mt-1 text-[10px] text-muted-foreground">Fehlende Segmente …</p> : null}
      {open && query.isError ? (
        <p className="mt-1 text-[10px] text-red-500" data-testid="segment-gap-error">
          {query.error instanceof Error ? query.error.message : "n/a — fehlende Segmente nicht erreichbar"}
        </p>
      ) : null}
      {open && query.data ? <SegmentGapList data={query.data} /> : null}
    </div>
  );
}

export function SegmentGapList({ data }: { data: SegmentGapResult }) {
  if (data.items.length === 0) {
    return <p className="mt-1 text-[10px] text-muted-foreground" data-testid="segment-gap-empty">{data.reason ?? "n/a"}</p>;
  }
  return (
    <div className="mt-1 space-y-0.5" data-testid="segment-gap-list">
      {data.reason ? <p className="text-[10px] text-muted-foreground">{data.reason}</p> : null}
      {data.items.map((item) => (
        <GapRow key={`${item.kind}:${item.parent}:${item.name}`} item={item} />
      ))}
    </div>
  );
}

function GapRow({ item }: { item: SegmentGapItem }) {
  const share = item.shareOfParentPct != null ? `${item.shareOfParentPct.toFixed(1)} %` : "n/a";
  const growth = item.growthPct != null ? `${item.growthPct > 0 ? "+" : ""}${item.growthPct.toFixed(1)}%` : "n/a";
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[10px]" data-testid="segment-gap-row">
      <span>{item.parent} / {item.name}</span>
      <span className="font-mono" data-testid="segment-gap-share">{share}</span>
      <span className="font-mono" data-testid="segment-gap-growth">{growth}</span>
      {item.basis ? <span className="text-muted-foreground">{item.basis}</span> : <span>n/a — ohne Quelle</span>}
      <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-violet-700 dark:text-violet-200">KI-Schätzung</span>
    </div>
  );
}
