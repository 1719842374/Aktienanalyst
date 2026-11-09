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
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const reason = body && typeof body.error === "string" && body.error.trim()
      ? body.error.trim()
      : `n/a — Untersegmente nicht erreichbar`;
    throw new Error(reason);
  }
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

const VISIBLE_BASIS_MAX = 80;

export function visibleBasis(text: string, max = VISIBLE_BASIS_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const space = slice.lastIndexOf(" ");
  const end = space >= 24 ? space : max;
  return `${clean.slice(0, end).trimEnd()}…`;
}

export function SegmentChildrenList({ data }: { data: SegmentChildrenResult }) {
  if (data.children.length === 0) {
    return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-empty">{data.reason ?? "n/a"}</p>;
  }
  return (
    <div className="max-w-full overflow-x-hidden pl-4 space-y-0.5" data-testid="segment-children">
      {data.reason ? <p className="text-[10px] text-muted-foreground" data-testid="segment-children-note">{data.reason}</p> : null}
      {data.children.map((child) => (
        <div key={`${child.parent}:${child.name}`} className="flex max-w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 overflow-x-hidden text-[10px]" data-testid="segment-child">
          <span className="min-w-0 break-words">{child.name}</span>
          <span className="font-mono tabular-nums text-muted-foreground" data-testid="segment-child-share">
            {child.shareOfParentPct != null ? `${child.shareOfParentPct.toFixed(1)} %` : "n/a"}
          </span>
          {child.growthPct != null && (
            <span className="font-mono tabular-nums text-muted-foreground" data-testid="segment-child-growth">
              {`${child.growthPct > 0 ? "+" : ""}${child.growthPct.toFixed(1)}%`}
            </span>
          )}
          {child.basis ? (
            <span className="min-w-0 break-words text-muted-foreground" title={child.basis}>
              {visibleBasis(child.basis)}
            </span>
          ) : null}
          <span
            className={child.source === "KI"
              ? "rounded border border-violet-500/40 bg-violet-500/10 px-1 text-violet-700 dark:text-violet-200"
              : "text-muted-foreground"}
            data-testid="segment-child-source"
          >
            {child.source === "KI" ? "KI-Schätzung" : child.source}
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
  if (query.isError || !query.data) {
    const message = query.error instanceof Error && query.error.message.trim()
      ? query.error.message.trim()
      : "n/a — Untersegmente nicht erreichbar";
    return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-empty">{message}</p>;
  }
  return <SegmentChildrenList data={query.data} />;
}
