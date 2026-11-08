import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  SEGMENT_SUPPLEMENT_ROUTE,
  type OfficialSegment,
  type SegmentSupplement,
} from "@shared/segment-supplement";

export type RequestFn = (method: string, url: string, data?: unknown) => Promise<Response>;

export class UnregisteredRouteError extends Error {
  readonly code = "unregistered-route" as const;
  constructor(route: string) {
    super(`n/a — Route nicht registriert: ${route}`);
    this.name = "UnregisteredRouteError";
  }
}

export function isUnregisteredRoute(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "unregistered-route";
}

export async function readApiJson(res: Response, route: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const missing = res.status === 404
      && !!body
      && typeof body === "object"
      && (body as { error?: unknown }).error === "not_found";
    if (missing) throw new UnregisteredRouteError(route);
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json") || text.trim().startsWith("<")) throw new UnregisteredRouteError(route);
  return JSON.parse(text) as unknown;
}

export async function fetchSegmentSupplement(
  input: { ticker: string; segments: OfficialSegment[] },
  request: RequestFn = apiRequest,
): Promise<SegmentSupplement & { ticker: string }> {
  const res = await request("POST", SEGMENT_SUPPLEMENT_ROUTE, {
    ticker: input.ticker,
    segments: input.segments,
  });
  return await readApiJson(res, SEGMENT_SUPPLEMENT_ROUTE) as SegmentSupplement & { ticker: string };
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} %`;
}

/** Eingerückte Ergänzung. Die Balken der Elternsegmente zeichnet Section2. */
export function SegmentSupplementBody({ data }: { data: SegmentSupplement }) {
  const share = data.reportedSharePct == null ? (data.reportedShareReason ?? "n/a") : `${data.reportedSharePct.toFixed(1)} %`;
  return (
    <div className="mt-2 space-y-1 min-w-0" data-testid="segment-supplement">
      <p className="text-[10px] text-muted-foreground" data-testid="segment-reported-share">
        Top-Level-Summe {share}. Unverändert, ohne Unterposten.
      </p>
      <p className="text-[10px] text-muted-foreground">{data.undisclosedNote}</p>
      {data.childShareNotes.map((note) => (
        <p key={note} className="text-[10px] text-muted-foreground" data-testid="segment-child-share-note">{note}</p>
      ))}
      {data.growth.map((row) => (
        <div key={row.name} className="pl-4 text-[10px]" data-testid={`segment-growth-${row.name}`}>
          <span className="text-muted-foreground">{row.name}, nächstes Jahr: </span>
          {row.nextYearGrowthPct == null ? (
            <span>{row.label}</span>
          ) : (
            <span
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1 text-amber-700 dark:text-amber-300"
              title={row.label}
              data-testid="segment-growth-override"
            >
              Override {signed(row.nextYearGrowthPct)}
              {row.source ? ` · Quelle: ${row.source}` : ""}
            </span>
          )}
        </div>
      ))}
      {data.subItems.map((item) => (
        <div key={`${item.parent}:${item.name}`} className="pl-8 text-[10px]" data-testid="segment-subitem">
          <span className="text-muted-foreground">└ {item.parent} / {item.name}: </span>
          <span
            className="rounded border border-amber-500/40 bg-amber-500/10 px-1"
            title={item.note ?? item.label}
            data-testid="segment-subitem-label"
          >
            {item.label}
            {item.shareOfParentPct == null ? "" : ` ${item.shareOfParentPct.toFixed(1)} % vom Elternsegment`}
            {` · Quelle: ${item.source}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SegmentSupplementView({
  ticker,
  segments,
  request,
}: {
  ticker: string;
  segments: OfficialSegment[];
  request?: RequestFn;
}) {
  const query = useQuery({
    queryKey: [SEGMENT_SUPPLEMENT_ROUTE, ticker, segments.map((segment) => `${segment.name}:${segment.percentage ?? ""}:${segment.reportedGrowthPct ?? ""}`).join("|")],
    enabled: segments.length > 0,
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: () => fetchSegmentSupplement({ ticker, segments }, request),
  });
  if (segments.length === 0) return null;
  if (query.isLoading) {
    return <p className="mt-1 text-[10px] text-muted-foreground" data-testid="segment-supplement-loading">Segment-Ergänzung …</p>;
  }
  if (isUnregisteredRoute(query.error) || !query.data) {
    if (query.isError && !isUnregisteredRoute(query.error)) {
      return <p className="mt-1 text-[10px] text-muted-foreground" data-testid="segment-supplement-error">n/a — Segment-Ergänzung nicht erreichbar</p>;
    }
    return null;
  }
  return <SegmentSupplementBody data={query.data} />;
}
