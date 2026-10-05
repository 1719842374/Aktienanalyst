import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorFromResponse } from "@/lib/apiError";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import {
  CartesianGrid, Customized, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type RegionId = "US" | "EU" | "CN";
type RangeId = "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y" | "Max";

interface TrendPoint {
  date: string;
  ratio: number;
  trend: number;
  plus1: number;
  plus2: number;
  minus1: number;
  minus2: number;
  premiumPct: number;
  zScore: number;
}

interface BuffettPayload {
  region: RegionId;
  asOf: string | null;
  note: string;
  latest: TrendPoint | null;
  points: TrendPoint[];
}

const REGIONS: { id: RegionId; name: string }[] = [
  { id: "US", name: "US" },
  { id: "EU", name: "Europa" },
  { id: "CN", name: "China" },
];

const RANGES: RangeId[] = ["6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"];
const RANGE_DAYS: Record<Exclude<RangeId, "Max">, number> = {
  "6M": 183,
  "1Y": 365,
  "2Y": 730,
  "3Y": 1096,
  "5Y": 1826,
  "10Y": 3652,
};

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const RATIO = "#1473fc";
const TREND = "#7a7a7a";
const PLUS_1 = "#f47c12";
const PLUS_2 = "#d12b3e";
const MINUS_1 = "#8fc97a";
const MINUS_2 = "#1c7b54";

function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day}. ${MONTHS[month - 1]} ${year}`;
}

function sliceWindow(points: TrendPoint[], range: RangeId): TrendPoint[] {
  if (range === "Max" || points.length === 0) return points;
  const end = Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
  const start = end - RANGE_DAYS[range] * 86_400_000;
  return points.filter(point => Date.parse(`${point.date}T00:00:00Z`) >= start);
}

function yDomain(rows: TrendPoint[], range: RangeId): [number, number] {
  const maxRatio = Math.max(...rows.map(row => row.ratio));
  if (range === "Max" && maxRatio >= 180) {
    const peak = Math.max(...rows.map(row => Math.max(row.ratio, row.plus2)));
    return [0, Math.max(250, Math.ceil(peak / 50) * 50)];
  }
  const values = rows.flatMap(row => [row.ratio, row.plus2, row.minus2]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(4, (max - min) * 0.08);
  const low = Math.max(0, Math.floor((min - pad) / 10) * 10);
  const high = Math.ceil((max + pad) / 10) * 10;
  return [low, high === low ? low + 10 : high];
}

function axisTicks(rows: TrendPoint[], range: RangeId, wide: boolean): string[] {
  if (rows.length === 0) return [];
  const startYear = Number(rows[0].date.slice(0, 4));
  const endYear = Number(rows[rows.length - 1].date.slice(0, 4));
  const endMonth = Number(rows[rows.length - 1].date.slice(5, 7));
  const targets: string[] = [];
  if (range === "Max") {
    const step = wide ? 5 : 10;
    const first = Math.ceil(startYear / step) * step;
    for (let year = first; year <= endYear; year += step) targets.push(`${year}-01-01`);
  } else if (range === "10Y" || range === "5Y" || range === "3Y") {
    for (let year = startYear; year <= endYear; year += 1) targets.push(`${year}-01-01`);
  } else {
    const step = range === "6M" ? 1 : range === "1Y" ? 2 : 6;
    let year = startYear;
    let month = Number(rows[0].date.slice(5, 7));
    while (year < endYear || (year === endYear && month <= endMonth)) {
      targets.push(`${year}-${String(month).padStart(2, "0")}-01`);
      month += step;
      while (month > 12) {
        month -= 12;
        year += 1;
      }
    }
  }
  const ticks: string[] = [];
  for (const target of targets) {
    const hit = rows.find(row => row.date >= target);
    if (hit && !ticks.includes(hit.date)) ticks.push(hit.date);
  }
  return ticks;
}

function tickLabel(date: string, range: RangeId): string {
  if (range === "6M" || range === "1Y" || range === "2Y") {
    return `${date.slice(5, 7)}.${date.slice(2, 4)}`;
  }
  return date.slice(0, 4);
}

interface AxisMap {
  scale?: (value: string | number) => number;
}

function ChartOverlay(props: {
  xAxisMap?: Record<string, AxisMap>;
  yAxisMap?: Record<string, AxisMap>;
  rows: TrendPoint[];
  range: RangeId;
  wide: boolean;
}) {
  const xAxis = Object.values(props.xAxisMap ?? {})[0];
  const yAxis = Object.values(props.yAxisMap ?? {})[0];
  const rows = props.rows;
  if (!xAxis?.scale || !yAxis?.scale || rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const x = xAxis.scale(last.date);
  const y = yAxis.scale(last.ratio);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const boxW = props.wide ? 292 : 214;
  const boxH = 62;
  const boxX = Math.max(8, x - boxW - (props.wide ? 72 : 28));
  const boxY = 8;
  const ratioText = `${Math.round(last.ratio)}% Marktwert zum BIP,`;
  const side = last.premiumPct >= 0 ? "über" : "unter";
  const premiumText = `${Math.abs(Math.round(last.premiumPct))}% ${side} der langfristigen Trendlinie`;
  const zSide = last.zScore > 0.05 ? "über" : last.zScore < -0.05 ? "unter" : "auf";
  const zText = zSide === "auf"
    ? "auf der Trendlinie"
    : `${Math.abs(last.zScore).toFixed(1)} Standardabweichungen ${zSide} der Trendlinie`;
  const x1 = boxX + boxW - 2;
  const y1 = boxY + 18;
  const midX = (x1 + x) / 2;
  const midY = (y1 + y) / 2;

  const showLabels = props.range !== "6M" && props.range !== "1Y";
  const anchor = rows[Math.min(rows.length - 1, Math.floor(rows.length * 0.58))];
  const labelX = xAxis.scale(anchor.date);
  const labels: { key: keyof TrendPoint; text: string; fill: string; pill?: boolean }[] = [
    { key: "plus2", text: "+ 2 Std.-Abw.", fill: PLUS_2 },
    { key: "plus1", text: "+ 1 Std.-Abw.", fill: PLUS_1 },
    { key: "trend", text: "Langfristiger Trend", fill: "#4b5563", pill: true },
    { key: "minus1", text: "− 1 Std.-Abw.", fill: "#4d7c0f" },
    { key: "minus2", text: "− 2 Std.-Abw.", fill: MINUS_2 },
  ];
  const placed: { y: number }[] = [];

  return (
    <g>
      {showLabels && labels.map(label => {
        const value = anchor[label.key];
        if (typeof value !== "number") return null;
        const ly = yAxis.scale!(value);
        if (!Number.isFinite(ly) || placed.some(item => Math.abs(item.y - ly) < 14)) return null;
        placed.push({ y: ly });
        const text = label.text;
        if (label.pill) {
          return (
            <g key={label.key}>
              <rect x={labelX - 62} y={ly - 9} width={124} height={16} rx={2} fill="#f3f4f6" stroke="#d1d5db" />
              <text x={labelX} y={ly + 3} textAnchor="middle" fill={label.fill} fontSize={10} fontWeight={600}>
                {text}
              </text>
            </g>
          );
        }
        return (
          <text
            key={label.key}
            x={labelX}
            y={ly + 3}
            textAnchor="middle"
            fill={label.fill}
            fontSize={11}
            fontWeight={600}
            stroke="#ffffff"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {text}
          </text>
        );
      })}
      <line x1={x1} y1={y1} x2={x - 8} y2={y} stroke={RATIO} strokeWidth={1.6} />
      <polygon
        points={`${x},${y} ${x - 9},${y - 4} ${x - 9},${y + 4}`}
        fill={RATIO}
      />
      <g data-testid="text-buffett-callout">
        <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={2} fill="#ffffff" stroke={RATIO} strokeWidth={1.6} />
        <text x={boxX + 10} y={boxY + 16} fill={RATIO} fontSize={12} fontWeight={700}>{longDate(last.date)}</text>
        <text x={boxX + 10} y={boxY + 33} fill={RATIO} fontSize={12}>{ratioText}</text>
        <text x={boxX + 10} y={boxY + 50} fill={RATIO} fontSize={12}>{premiumText}</text>
      </g>
      <text
        x={midX}
        y={midY - 6}
        textAnchor="middle"
        fill={RATIO}
        fontSize={11}
        stroke="#ffffff"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {zText}
      </text>
    </g>
  );
}

export function BuffettRatioPanel() {
  const [region, setRegion] = useState<RegionId>("US");
  const [range, setRange] = useState<RangeId>("Max");
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const query = useQuery({
    queryKey: ["recession-buffett", region],
    queryFn: async () => {
      const res = await fetch(`/api/analyze-recession/buffett?region=${region}`);
      if (!res.ok) throw await apiErrorFromResponse(res);
      return await res.json() as BuffettPayload;
    },
  });

  const all = query.data?.points ?? [];
  const chart = sliceWindow(all, range);
  const domain = chart.length > 0 ? yDomain(chart, range) : [0, 250] as [number, number];
  const ticks = axisTicks(chart, range, wide);
  const yTicks = range === "Max" && domain[0] === 0 && domain[1] === 250
    ? [0, 50, 100, 150, 200, 250]
    : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setRegion(item.id)}
            data-testid={`button-buffett-${item.id}`}
            className={`px-2.5 py-1 text-[11px] rounded-md border ${
              region === item.id
                ? "bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="flex min-h-9 max-w-full flex-wrap gap-1.5 sm:gap-1" data-testid="row-buffett-presets">
        {RANGES.map(item => (
          <button
            key={item}
            type="button"
            onClick={() => setRange(item)}
            data-testid={`button-buffett-range-${item}`}
            className={`min-h-9 shrink-0 rounded-md border px-2.5 text-[11px] font-medium transition-colors sm:text-[10px] ${
              range === item ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted/50"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {query.isLoading && <p className="text-xs text-muted-foreground">Lade Marktquote…</p>}
      {query.error && (
        <ApiErrorBanner
          error={query.error}
          block={!query.data}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
          testId="text-buffett-error"
        />
      )}

      {query.data && (
        <>
          {chart.length > 1 ? (
            <div className="h-[360px] w-full rounded-md border border-neutral-200 bg-white p-1 sm:h-[460px]" data-testid="chart-buffett">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    ticks={ticks}
                    interval={0}
                    tickFormatter={value => tickLabel(String(value), range)}
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={{ stroke: "#9ca3af" }}
                    tickLine={{ stroke: "#9ca3af" }}
                    minTickGap={8}
                  />
                  <YAxis
                    domain={domain}
                    ticks={yTicks}
                    tickFormatter={value => `${value}%`}
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={{ stroke: "#9ca3af" }}
                    tickLine={{ stroke: "#9ca3af" }}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderColor: "#d1d5db" }}
                    labelFormatter={value => longDate(String(value))}
                    formatter={(value: number, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                  />
                  <Line type="linear" dataKey="plus2" name="+ 2 Std.-Abw." stroke={PLUS_2} dot={false} strokeWidth={1.4} strokeDasharray="6 4" isAnimationActive={false} />
                  <Line type="linear" dataKey="plus1" name="+ 1 Std.-Abw." stroke={PLUS_1} dot={false} strokeWidth={1.4} strokeDasharray="6 4" isAnimationActive={false} />
                  <Line type="linear" dataKey="trend" name="Langfristiger Trend" stroke={TREND} dot={false} strokeWidth={1.5} strokeDasharray="6 4" isAnimationActive={false} />
                  <Line type="linear" dataKey="minus1" name="− 1 Std.-Abw." stroke={MINUS_1} dot={false} strokeWidth={1.5} strokeDasharray="6 4" isAnimationActive={false} />
                  <Line type="linear" dataKey="minus2" name="− 2 Std.-Abw." stroke={MINUS_2} dot={false} strokeWidth={1.5} strokeDasharray="6 4" isAnimationActive={false} />
                  <Line type="linear" dataKey="ratio" name="Marktwert zum BIP" stroke={RATIO} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                  <Customized component={(overlay: { xAxisMap?: Record<string, AxisMap>; yAxisMap?: Record<string, AxisMap> }) => (
                    <ChartOverlay {...overlay} rows={chart} range={range} wide={wide} />
                  )} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="text-buffett-empty">
              In diesem Fenster liegt kein Verlauf.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground leading-relaxed">{query.data.note}</p>
        </>
      )}
    </div>
  );
}
