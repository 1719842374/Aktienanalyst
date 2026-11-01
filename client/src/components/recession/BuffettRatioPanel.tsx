import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublishChatSection } from "@/lib/chatSectionData";
import { apiErrorFromResponse } from "@/lib/apiError";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import {
  CartesianGrid, Customized, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { TradeBalanceResponse } from "@shared/trade-balance";
import { axisTicks, lastPointLabel, proxySuffix, tickLabel, type BuffettRangeId } from "./buffettChartScale";

type RegionId = "US" | "EU" | "CN";
type RangeId = BuffettRangeId;

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
  /** #245: Proxy-Symbol bei fortgeschriebenen Punkten */
  proxy?: string;
  /** F1-74: „etf“, wenn der Punkt aus einem ETF-Kurs geschätzt ist (EU/CN) */
  proxyKind?: "etf";
}

interface BuffettPayload {
  region: RegionId;
  asOf: string | null;
  note: string;
  latest: TrendPoint | null;
  points: TrendPoint[];
  /** F1-31: gesetzt, wenn der Zähler aus FRED (Quartalswerte) statt aus dem Wilshire 5000 kommt. */
  fallback?: { source: string; reason: string; frequency: "quarterly"; asOf: string | null } | null;
  /** F1-71/F1-74: nur EU/CN – Schätzung ab der letzten Weltbank-Quote (Anker) mit Index- oder ETF-Kurs. */
  benchmark?: {
    symbol: string; name: string; kind: "index" | "etf"; currency: "EUR" | "USD"; estimate: true;
    anchorYear: number; anchorDate: string; anchorQuote: number; gdpSeries: string; gdpAsOf: string; skipped: string[];
  } | null;
  benchmarkUnavailable?: string | null;
}

function pctDe(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
}

function monthDe(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/**
 * F1-38: Zeile Handelsbilanz/BIP (eigene Route /api/analyze-recession/trade-balance). US mit Wert / lädt /
 * US n/a mit Grund / EU, CN n/a (Reihe nur für die USA). Nur Anzeige, kein Score.
 */
export function tradeBalanceLine(
  region: RegionId,
  state: { data: TradeBalanceResponse | null | undefined; loading: boolean; error: unknown },
): string {
  const label = "Handelsbilanz/BIP (FRED BOPGSTB)";
  if (region !== "US") return `${label}: n/a — Reihe gilt nur für die USA`;
  if (state.loading) return `${label}: wird geladen …`;
  const t = state.data?.value;
  if (!t) return `${label}: n/a — ${state.data?.reason ?? (state.error ? errorReason(state.error) : "keine Daten")}`;
  const ago = t.pctYearAgo != null && t.asOfYearAgo ? ` · Vorjahr ${pctDe(t.pctYearAgo)} (bis ${monthDe(t.asOfYearAgo)})` : " · Vorjahr n/a";
  return `${label}: ${pctDe(t.pct)} — 12 Monate ${monthDe(t.from)} bis ${monthDe(t.asOf)}, ${t.ttmBn.toFixed(0).replace("-", "−")} Mrd. $ ÷ BIP ${t.gdpBn.toFixed(0)} Mrd. $ (Quartal ab ${t.gdpDate})${ago} · nur Anzeige, kein Score`;
}

/** F1-34: Grund aus dem 502-Body sichtbar machen, nicht nur im eingeklappten Detail. */
function errorReason(error: unknown): string {
  const message = String((error as { message?: unknown } | null)?.message ?? "").trim();
  return message || "Datenquelle nicht erreichbar";
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

function yDomain(rows: TrendPoint[], range: RangeId, fallback = false): [number, number] {
  const ratios = rows.map(row => row.ratio);
  const maxRatio = Math.max(...ratios);
  const minRatio = Math.min(...ratios);
  // F1-31: nur beim FRED-Ersatz (Financial Accounts, über 250 %) die Obergrenze in 50er-Schritten erweitern; Wilshire-Achse unverändert.
  if (range === "Max" && maxRatio >= 180) return [0, fallback ? Math.max(250, Math.ceil(maxRatio / 50) * 50) : 250];
  const near = rows
    .flatMap(row => [row.ratio, row.plus1, row.plus2, row.trend, row.minus1, row.minus2])
    .filter(value => value >= minRatio - 25 && value <= maxRatio + 25);
  const min = Math.min(...near);
  const max = Math.max(...near);
  const pad = Math.max(3, (max - min) * 0.12);
  const low = Math.max(0, Math.floor((min - pad) / 10) * 10);
  const high = Math.ceil((max + pad) / 10) * 10;
  return [low, high === low ? low + 20 : high];
}

function yTicksFor(domain: [number, number], range: RangeId): number[] {
  if (range === "Max" && domain[0] === 0 && domain[1] >= 250 && domain[1] % 50 === 0) {
    return Array.from({ length: domain[1] / 50 + 1 }, (_, i) => i * 50);
  }
  const span = domain[1] - domain[0];
  const step = span <= 40 ? 5 : span <= 90 ? 10 : span <= 180 ? 20 : 50;
  const ticks: number[] = [];
  for (let value = domain[0]; value <= domain[1] + 0.001; value += step) ticks.push(value);
  return ticks;
}

function AxisTick({
  x = 0,
  y = 0,
  payload,
  index = 0,
  visibleTicksCount = 0,
  range,
}: {
  x?: number;
  y?: number;
  payload?: { value: number };
  index?: number;
  visibleTicksCount?: number;
  range: RangeId;
}) {
  if (!payload) return null;
  const last = index === visibleTicksCount - 1;
  return (
    <text
      x={x}
      y={y}
      dy={14}
      textAnchor={last ? "end" : "middle"}
      fill="#6b7280"
      fontSize={11}
    >
      {tickLabel(payload.value, range)}
    </text>
  );
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
  const x = xAxis.scale(Date.parse(`${last.date}T00:00:00Z`));
  const rawY = yAxis.scale(last.ratio);
  const y = Math.max(6, rawY);
  if (!Number.isFinite(x) || !Number.isFinite(rawY)) return null;

  const boxW = props.wide ? 292 : 236;
  const boxH = 62;
  const boxX = Math.max(8, x - boxW - (props.wide ? 128 : 16));
  const boxY = 8;
  // #245/JOB 22: Leerzeichen am Zeilenende, damit der Callout-Text (textContent, Screenreader) nicht
  // „2026250%“ bzw. „BIP,86%“ zusammenklebt; sichtbar ändert sich nichts.
  const ratioText = `${Math.round(last.ratio)}% Marktwert zum BIP, `;
  const side = last.premiumPct >= 0 ? "über" : "unter";
  const premiumText = `${Math.abs(Math.round(last.premiumPct))}% ${side} der langfristigen Trendlinie`;
  const zSide = last.zScore > 0.05 ? "über" : last.zScore < -0.05 ? "unter" : "auf";
  const zText = zSide === "auf"
    ? "auf der Trendlinie"
    : `${Math.abs(last.zScore).toFixed(1)} Standardabweichungen ${zSide} der Trendlinie`;
  const x1 = boxX + boxW - 2;
  const y1 = boxY + 18;
  const showCallout = props.range === "Max";
  // JOB 23: bei 375 px reicht die Callout-Box (boxX..boxX+boxW) bis an den Punkt, das Label unter dem Punkt lag
  // dahinter. Überlappt die Box horizontal mit dem Label, steht es unter Box + z-Zeile (boxY + boxH + 32).
  const calloutCoversLabel = showCallout && boxX + boxW > x - 80;
  const lastLabelY = calloutCoversLabel
    ? Math.max(y + 18, boxY + boxH + 32)
    : showCallout || y < 24 ? y + 18 : y - 9;

  const showLabels = props.range !== "6M" && props.range !== "1Y";
  const startStamp = Date.parse(`${rows[0].date}T00:00:00Z`);
  const endStamp = Date.parse(`${rows[rows.length - 1].date}T00:00:00Z`);
  const labelStamp = startStamp + (endStamp - startStamp) * 0.46;
  let anchor = rows[0];
  let bestGap = Infinity;
  for (const row of rows) {
    const gap = Math.abs(Date.parse(`${row.date}T00:00:00Z`) - labelStamp);
    if (gap < bestGap) {
      bestGap = gap;
      anchor = row;
    }
  }
  const labelX = xAxis.scale(Date.parse(`${anchor.date}T00:00:00Z`));
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
      {/* JOB 18: Punkt + Kurzlabel am letzten Datenpunkt (alle Zeitfenster; Max zusätzlich mit Callout) */}
      <g data-testid="buffett-last-point">
        <circle cx={x} cy={y} r={4} fill={RATIO} stroke="#ffffff" strokeWidth={1.5} />
        {/* #245/JOB 22: Label auch im Max-Fenster; dort unter dem Punkt, damit es nicht in den Callout-Pfeil läuft. */}
        {lastPointLabel(last) && (
          <text
            data-testid="buffett-last-point-label"
            x={x - 8}
            y={lastLabelY}
            textAnchor="end"
            fill={RATIO}
            fontSize={props.wide ? 12 : 11}
            fontWeight={700}
            stroke="#ffffff"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {lastPointLabel(last)}
          </text>
        )}
      </g>
      {showCallout && (
        <g>
          <line x1={x1} y1={y1} x2={x - 8} y2={y} stroke={RATIO} strokeWidth={1.6} />
          <polygon points={`${x},${y} ${x - 9},${y - 4} ${x - 9},${y + 4}`} fill={RATIO} />
          <g data-testid="text-buffett-callout">
            <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={2} fill="#ffffff" stroke={RATIO} strokeWidth={1.6} />
            <text x={boxX + 10} y={boxY + 16} fill={RATIO} fontSize={props.wide ? 12 : 11} fontWeight={700}>{longDate(last.date)}{last.proxy ? (last.proxyKind === "etf" ? ` (ETF-Proxy ${last.proxy})` : ` (via ${last.proxy})`) : ""}{" "}</text>
            <text x={boxX + 10} y={boxY + 33} fill={RATIO} fontSize={props.wide ? 12 : 11}>{ratioText}</text>
            <text x={boxX + 10} y={boxY + 50} fill={RATIO} fontSize={props.wide ? 12 : 11}>{premiumText}{" "}</text>
          </g>
          <text
            x={boxX + 10}
            y={boxY + boxH + 16}
            textAnchor="start"
            fill={RATIO}
            fontSize={props.wide ? 12 : 10}
            stroke="#ffffff"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {zText}
          </text>
        </g>
      )}
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
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetch(`/api/analyze-recession/buffett?region=${region}`);
      if (!res.ok) throw await apiErrorFromResponse(res);
      return await res.json() as BuffettPayload;
    },
  });

  // F1-38: Handelsbilanz/BIP nur für US laden (eigene Route, Buffett-Antwort unverändert).
  const tradeQuery = useQuery({
    queryKey: ["recession-trade-balance"],
    enabled: region === "US",
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/analyze-recession/trade-balance");
      if (!res.ok) throw await apiErrorFromResponse(res);
      return await res.json() as TradeBalanceResponse;
    },
  });

  const all = query.data?.points ?? [];

  // PR 3 (Chat-Kontext): letzter angezeigter Punkt aus der bestehenden Query — keine neue Abfrage.
  const bl = query.data?.latest ?? (all.length ? all[all.length - 1] : null);
  const b1 = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  usePublishChatSection("recession", "buffett", query.data ? {
    region, stand: query.data.asOf, datum: bl?.date ?? null, marktwertZuBipPct: b1(bl?.ratio), trendPct: b1(bl?.trend),
    abweichungVomTrendPct: b1(bl?.premiumPct), zScore: b1(bl?.zScore), plus1Sigma: b1(bl?.plus1), plus2Sigma: b1(bl?.plus2),
    proxy: bl?.proxy ?? null, hinweisQuelle: query.data.note ? query.data.note.slice(0, 400) : null,
    _auffaelligkeiten: [
      bl && bl.zScore >= 2 ? "Bewertung ≥ +2σ über dem Trend" : bl && bl.zScore >= 1 ? "Bewertung ≥ +1σ über dem Trend" : "",
      bl && bl.zScore <= -1 ? "Bewertung ≤ −1σ unter dem Trend" : "",
      bl?.proxy ? (bl.proxyKind === "etf" ? `Schätzung über ETF-Proxy ${bl.proxy}` : `letzter Punkt fortgeschrieben via ${bl.proxy}`) : "",
      query.data.benchmark ? `Schätzung ab Anker ${query.data.benchmark.anchorDate}` : "",
    ].filter(Boolean).join("; ") || null,
  } : null);
  const chart = sliceWindow(all, range).map(point => ({
    ...point,
    t: Date.parse(`${point.date}T00:00:00Z`),
  }));
  const domain = chart.length > 0 ? yDomain(chart, range, !!query.data?.fallback) : [0, 250] as [number, number];
  const ticks = axisTicks(chart, range, wide);
  const yTicks = yTicksFor(domain, range);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => { setRegion(item.id); setRange("Max"); }}
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
      {query.error && !query.data && (
        <p className="text-xs text-muted-foreground" data-testid="text-buffett-error-reason">
          n/a — {errorReason(query.error)}
        </p>
      )}
      {query.data?.fallback && (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300"
          data-testid="text-buffett-fallback"
        >
          Ersatzquelle: {query.data.fallback.source}
          {query.data.fallback.asOf ? `, letztes Quartal ${longDate(query.data.fallback.asOf)}` : ""}.
          {" "}Wilshire 5000 nicht verfügbar ({query.data.fallback.reason}). Niveau nicht mit der Wilshire-Linie vergleichbar.
        </p>
      )}

      {query.data?.benchmark && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="text-buffett-benchmark">
          {query.data.benchmark.kind === "etf" && (
            <span
              className="rounded border border-violet-500/50 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300"
              data-testid="badge-buffett-etf-proxy"
            >
              ETF-Proxy
            </span>
          )}
          <span>
            Schätzung ab {longDate(query.data.benchmark.anchorDate)} über {query.data.benchmark.name} ({query.data.benchmark.symbol}),
            geeicht auf die Weltbank-Quote {query.data.benchmark.anchorYear} ({query.data.benchmark.anchorQuote.toFixed(1).replace(".", ",")} %).
          </span>
        </p>
      )}
      {query.data?.benchmarkUnavailable && (
        <p className="text-[11px] leading-snug text-muted-foreground" data-testid="text-buffett-benchmark-unavailable">
          Benchmark-Schätzung n/a — {query.data.benchmarkUnavailable}
        </p>
      )}

      {query.data && (
        <>
          {chart.length > 1 ? (
            <div>
              {range !== "Max" && (
                <p className="mb-1 text-[12px] leading-snug text-[#1473fc]" data-testid="text-buffett-callout">
                  {longDate(chart[chart.length - 1].date)}{proxySuffix(chart[chart.length - 1])}
                  {" · "}
                  {Math.round(chart[chart.length - 1].ratio)}% Marktwert zum BIP,{" "}
                  {Math.abs(Math.round(chart[chart.length - 1].premiumPct))}% {chart[chart.length - 1].premiumPct >= 0 ? "über" : "unter"} der langfristigen Trendlinie
                  {" · "}
                  {Math.abs(chart[chart.length - 1].zScore).toFixed(1)} Standardabweichungen {chart[chart.length - 1].zScore >= 0 ? "über" : "unter"} der Trendlinie
                </p>
              )}
            <div className="h-[360px] w-full rounded-md border border-neutral-200 bg-white p-1 sm:h-[460px]" data-testid="chart-buffett">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 10, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={chart.length > 1 ? [chart[0].t, chart[chart.length - 1].t] : ["dataMin", "dataMax"]}
                    ticks={ticks}
                    interval={0}
                    tick={(props) => <AxisTick {...props} range={range} />}
                    axisLine={{ stroke: "#9ca3af" }}
                    tickLine={{ stroke: "#9ca3af" }}
                    minTickGap={8}
                  />
                  <YAxis
                    domain={domain}
                    ticks={yTicks}
                    allowDataOverflow
                    tickFormatter={value => `${value}%`}
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={{ stroke: "#9ca3af" }}
                    tickLine={{ stroke: "#9ca3af" }}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderColor: "#d1d5db" }}
                    labelFormatter={(value, payload) => {
                      const iso = new Date(Number(value)).toISOString().slice(0, 10);
                      const row = (payload?.[0]?.payload ?? null) as TrendPoint | null;
                      return `${longDate(iso)}${proxySuffix(row)}`;
                    }}
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
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="text-buffett-empty">
              In diesem Fenster liegt kein Verlauf.
            </p>
          )}
          <p className="text-[11px] leading-snug text-muted-foreground" data-testid="text-buffett-trade-balance">
            {tradeBalanceLine(region, { data: tradeQuery.data, loading: tradeQuery.isLoading, error: tradeQuery.error })}
          </p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{query.data.note}</p>
        </>
      )}
    </div>
  );
}
