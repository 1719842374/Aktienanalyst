import { useEffect, useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { segmentGapKey, type SegmentGapItem, type SegmentGapResult } from "@shared/segment-gap";

export type GapRequest = (method: string, url: string, data?: unknown) => Promise<Response>;

const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

export function SegmentGapPanel({
  ticker,
  products = [],
  regions = [],
  request = apiRequest,
  onResult,
}: {
  ticker: string;
  products?: readonly { name: string; revenue?: number | null }[];
  regions?: readonly { name: string; revenue?: number | null }[];
  request?: GapRequest;
  onResult?: (data: SegmentGapResult | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = JSON.stringify({
    products: products.slice(0, 24).map((row) => ({ name: row.name, revenue: typeof row.revenue === "number" ? row.revenue : null })),
    regions: regions.slice(0, 24).map((row) => ({ name: row.name, revenue: typeof row.revenue === "number" ? row.revenue : null })),
  });
  const query = useQuery({
    queryKey: ["/api/segment-gaps", ticker, shown],
    enabled: open && ticker.trim().length > 0,
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: async ({ queryKey }): Promise<SegmentGapResult> => {
      const asked = typeof queryKey[1] === "string" ? queryKey[1] : "";
      const parents = JSON.parse(typeof queryKey[2] === "string" ? queryKey[2] : "{}") as { products?: unknown; regions?: unknown };
      const response = await request("POST", "/api/segment-gaps", {
        ticker: asked,
        products: parents.products ?? [],
        regions: parents.regions ?? [],
      });
      const body = await response.json().catch(() => null) as (SegmentGapResult & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error || "n/a — fehlende Segmente nicht erreichbar");
      return {
        items: body?.items ?? [],
        reason: body?.reason ?? null,
        promptVersion: body?.promptVersion ?? null,
        cached: body?.cached === true,
        queried: typeof body?.queried === "number" ? body.queried : null,
        total: typeof body?.total === "number" ? body.total : null,
      };
    },
  });
  useIsoLayoutEffect(() => {
    if (!onResult) return;
    if (!open) {
      onResult(null);
      return;
    }
    onResult(query.data ?? null);
  }, [open, query.data, onResult, ticker]);
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
      {open && query.data && typeof query.data.queried === "number" && typeof query.data.total === "number" ? (
        <p className="mt-1 text-[10px] text-muted-foreground" data-testid="segment-gap-coverage">
          abgefragt {query.data.queried} von {query.data.total}
        </p>
      ) : null}
      {open && query.isLoading ? <p className="mt-1 text-[10px] text-muted-foreground">Fehlende Segmente …</p> : null}
      {open && query.isError ? (
        <p className="mt-1 text-[10px] text-red-500" data-testid="segment-gap-error">
          {query.error instanceof Error ? query.error.message : "n/a — fehlende Segmente nicht erreichbar"}
        </p>
      ) : null}
      {open && query.data && query.data.items.length === 0 ? (
        <p className="mt-1 text-[10px] text-muted-foreground" data-testid="segment-gap-empty">{query.data.reason ?? "n/a"}</p>
      ) : null}
      {open && query.data && query.data.items.length > 0 && query.data.reason ? (
        <p className="mt-1 max-w-full break-words text-[10px] text-muted-foreground" data-testid="segment-gap-reason">{query.data.reason}</p>
      ) : null}
    </div>
  );
}

export function SegmentGapUnderParent({
  parent,
  kind,
  items,
}: {
  parent: string;
  kind: "product" | "geographic";
  items: readonly SegmentGapItem[];
}) {
  const key = segmentGapKey(parent);
  const rows = items.filter((item) => item.kind === kind && segmentGapKey(item.parent) === key);
  if (rows.length === 0) return null;
  return (
    <div className="mt-0.5 max-w-full space-y-0.5 overflow-x-hidden pl-4" data-testid={`segment-gap-under-${parent}`}>
      {rows.map((item) => (
        <GapRow key={`${item.kind}:${item.parent}:${item.name}`} item={item} />
      ))}
    </div>
  );
}

export function SegmentGapList({ data }: { data: SegmentGapResult }) {
  if (data.items.length === 0) {
    return <p className="mt-1 text-[10px] text-muted-foreground" data-testid="segment-gap-empty">{data.reason ?? "n/a"}</p>;
  }
  const parents = new Map<string, SegmentGapItem[]>();
  for (const item of data.items) {
    const bucket = parents.get(`${item.kind}:${item.parent}`) ?? [];
    bucket.push(item);
    parents.set(`${item.kind}:${item.parent}`, bucket);
  }
  return (
    <div className="mt-1 max-w-full space-y-1 overflow-x-hidden" data-testid="segment-gap-list">
      {typeof data.queried === "number" && typeof data.total === "number" ? (
        <p className="text-[10px] text-muted-foreground" data-testid="segment-gap-coverage">abgefragt {data.queried} von {data.total}</p>
      ) : null}
      {data.reason ? <p className="break-words text-[10px] text-muted-foreground">{data.reason}</p> : null}
      {Array.from(parents.entries()).map(([bucket, rows]) => (
        <div key={bucket}>
          <div className="text-[10px] font-medium">{rows[0]?.parent}</div>
          <SegmentGapUnderParent parent={rows[0]?.parent ?? ""} kind={rows[0]?.kind ?? "product"} items={rows} />
        </div>
      ))}
    </div>
  );
}

function GapRow({ item }: { item: SegmentGapItem }) {
  const shareValue = item.shareOfParentPct;
  const valued = shareValue != null && shareValue > 0;
  const share = valued
    ? `${shareValue.toFixed(1)} %`
    : (item.shareNote && item.shareNote.trim() ? item.shareNote : "n/a — ohne Quelle");
  const growth = item.growthPct != null
    ? `${item.growthPct > 0 ? "+" : ""}${item.growthPct.toFixed(1)}%`
    : valued ? "n/a" : "";
  const estimate = item.shareOrigin === "estimate" && valued;
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 overflow-x-hidden text-[10px]" data-testid="segment-gap-row" data-parent={item.parent}>
      <span className="min-w-0 break-words">{item.name}</span>
      <span
        className={estimate ? "font-mono text-violet-700 dark:text-violet-300" : "font-mono"}
        data-testid="segment-gap-share"
      >
        {share}
      </span>
      {growth ? <span className="font-mono" data-testid="segment-gap-growth">{growth}</span> : null}
      {item.basis && item.basis !== share ? <span className="min-w-0 break-words text-muted-foreground">{item.basis}</span> : !item.basis && valued ? <span>n/a — ohne Quelle</span> : null}
      <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-violet-700 dark:text-violet-200">{valued ? "KI-Schätzung" : "KI-Vorschlag"}</span>
    </div>
  );
}
