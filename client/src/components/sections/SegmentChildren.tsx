import { Children, isValidElement, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  SEGMENT_CHILDREN_ROUTE,
  type SegmentChildrenResult,
} from "@shared/segment-children";

export type RequestFn = (method: string, url: string, data?: unknown) => Promise<Response>;

export interface ChildEstimateContext {
  parentRevenue: number | null;
  parentYoy: number | null;
  fiscalYear: string | null;
  currency: string | null;
  regions: { name: string; revenue: number | null; growth: number | null }[];
}

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

export function childSourceDomain(text: string | null | undefined): string | null {
  const match = text?.match(/https?:\/\/([^/\s]+)/i);
  return match ? match[1].replace(/^www\./, "") : null;
}

export function visibleBasis(text: string, max = VISIBLE_BASIS_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const space = slice.lastIndexOf(" ");
  const end = space >= 24 ? space : max;
  return `${clean.slice(0, end).trimEnd()}…`;
}

export async function requestChildRefill(
  input: {
    ticker: string;
    parent: string;
    kind: "product" | "geographic";
    child: string;
    knownChildren: string[];
  } & ChildEstimateContext,
  request: RequestFn = (method, url, data) => apiRequest(method, url, data),
): Promise<{ child?: SegmentChildrenResult["children"][number]; error?: string }> {
  const response = await request("POST", `${SEGMENT_CHILDREN_ROUTE}/${encodeURIComponent(input.ticker)}`, input);
  const body = await response.json().catch(() => null) as { child?: SegmentChildrenResult["children"][number]; error?: unknown } | null;
  if (!response.ok || !body?.child) {
    const reason = body && typeof body.error === "string" && body.error.trim()
      ? body.error.trim()
      : "n/a — KI-Schätzung fehlgeschlagen";
    return { error: reason };
  }
  return { child: body.child };
}

export function SegmentChildrenList({
  data,
  onEstimate,
  estimating,
}: {
  data: SegmentChildrenResult;
  onEstimate?: (name: string) => void;
  estimating?: string | null;
}) {
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
          {childSourceDomain(child.basis) ? (
            <span className="font-mono text-muted-foreground" data-testid="segment-child-domain">{childSourceDomain(child.basis)}</span>
          ) : child.source === "KI" && !child.basis ? (
            <span className="text-muted-foreground" data-testid="segment-child-source-missing">n/a — ohne Quelle</span>
          ) : null}
          {child.source === "KI" ? (
            <button
              type="button"
              className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-violet-700 dark:text-violet-200"
              disabled={estimating === child.name}
              onClick={(event) => {
                event.stopPropagation();
                onEstimate?.(child.name);
              }}
              data-testid="segment-child-source"
            >
              {estimating === child.name ? "…" : "KI-Schätzung"}
            </button>
          ) : (
            <span className="text-muted-foreground" data-testid="segment-child-source">{child.source}</span>
          )}
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
  context,
}: {
  ticker: string;
  parent: string;
  kind: "product" | "geographic";
  request?: RequestFn;
  context?: ChildEstimateContext;
}) {
  const [estimating, setEstimating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<Record<string, SegmentChildrenResult["children"][number]>>({});
  const query = useQuery({
    queryKey: [SEGMENT_CHILDREN_ROUTE, ticker, kind, parent],
    enabled: parent.trim().length > 0,
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: () => fetchSegmentChildren({ ticker, parent, kind }, request),
  });
  if (query.isLoading) return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-loading">Untersegmente …</p>;
  if (query.isError || !query.data) {
    const raw = query.error instanceof Error && query.error.message.trim()
      ? query.error.message.trim()
      : "n/a — Untersegmente nicht erreichbar";
    const message = /serverseitigen Liste/.test(raw) ? `${raw} Bitte die Schätzung erneut auslösen.` : raw;
    return <p className="pl-4 text-[10px] text-muted-foreground" data-testid="segment-children-empty">{message}</p>;
  }
  const data: SegmentChildrenResult = {
    ...query.data,
    children: query.data.children.map((child) => filled[child.name] ?? child),
  };
  return (
    <>
      <SegmentChildrenList
        data={data}
        estimating={estimating}
        onEstimate={(name) => {
          if (estimating) return;
          setEstimating(name);
          setError(null);
          const facts = context ?? { parentRevenue: null, parentYoy: null, fiscalYear: null, currency: null, regions: [] };
          void requestChildRefill({
            ticker,
            parent,
            kind,
            child: name,
            knownChildren: data.children.map((child) => child.name),
            ...facts,
          }, request).then((result) => {
            if (result.child) setFilled((current) => ({ ...current, [result.child!.name]: result.child! }));
            else setError(result.error ?? "n/a — KI-Schätzung fehlgeschlagen");
          }).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "n/a — KI-Schätzung fehlgeschlagen");
          }).finally(() => setEstimating(null));
        }}
      />
      {error ? <p className="pl-4 text-[10px] text-red-500" data-testid="segment-child-estimate-error">{error}</p> : null}
    </>
  );
}
