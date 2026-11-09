import { Children, isValidElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  SEGMENT_CHILDREN_ROUTE,
  type SegmentChildrenResult,
} from "@shared/segment-children";

export type RequestFn = (method: string, url: string) => Promise<Response>;

export function segmentChildrenUrl(ticker: string, parent: string, kind: "product" | "geographic"): string {
  const params = new URLSearchParams({ parent, kind });
  return `${SEGMENT_CHILDREN_ROUTE}/${encodeURIComponent(ticker)}?${params.toString()}`;
}

export async function fetchSegmentChildren(
  input: { ticker: string; parent: string; kind: "product" | "geographic" },
  request: RequestFn = (method, url) => apiRequest(method, url),
): Promise<SegmentChildrenResult> {
  const response = await request("GET", segmentChildrenUrl(input.ticker, input.parent, input.kind));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as SegmentChildrenResult;
}

export function SegmentLine({
  name,
  open,
  onToggle,
  children,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const panel = items.filter((item) => isValidElement(item) && item.type === SegmentChildrenPanel);
  const row = items.filter((item) => !(isValidElement(item) && item.type === SegmentChildrenPanel));
  return (
    <div className="relative">
      <button
        type="button"
        className="mb-0.5 block w-full text-left"
        aria-expanded={open}
        aria-label={`${name} Untersegmente`}
        data-testid={`segment-toggle-${name}`}
        onClick={onToggle}
      >
        {row}
      </button>
      {panel}
    </div>
  );
}

export function SegmentChildrenList({ data }: { data: SegmentChildrenResult }) {
  if (data.children.length === 0) {
    return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-empty">{data.reason ?? "n/a"}</p>;
  }
  return (
    <div className="pl-4 space-y-0.5" data-testid="segment-children">
      {data.reason ? <p className="text-[10px] text-muted-foreground" data-testid="segment-children-note">{data.reason}</p> : null}
      {data.children.map((child) => (
        <div key={`${child.parent}:${child.name}`} className="flex items-center gap-2 text-[10px]" data-testid="segment-child">
          <span className="truncate">{child.name}</span>
          {child.shareOfParentPct != null && (
            <span className="font-mono tabular-nums text-muted-foreground">{child.shareOfParentPct.toFixed(1)} %</span>
          )}
          {child.basis ? <span className="text-muted-foreground">{child.basis}</span> : null}
          <span
            className={child.source === "KI"
              ? "rounded border border-violet-500/40 bg-violet-500/10 px-1 text-violet-700 dark:text-violet-200"
              : "text-muted-foreground"}
            data-testid="segment-child-source"
          >
            {child.source}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SegmentChildrenPanel({
  ticker,
  parent,
  kind,
  request,
}: {
  ticker: string;
  parent: string;
  kind: "product" | "geographic";
  request?: RequestFn;
}) {
  const query = useQuery({
    queryKey: [SEGMENT_CHILDREN_ROUTE, ticker, kind, parent],
    enabled: parent.trim().length > 0,
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: () => fetchSegmentChildren({ ticker, parent, kind }, request),
  });
  if (query.isLoading) return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-loading">Untersegmente …</p>;
  if (query.isError || !query.data) return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-empty">n/a — Untersegmente nicht erreichbar</p>;
  return <SegmentChildrenList data={query.data} />;
}
