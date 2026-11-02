/**
 * Gold Sektion 9 — Spot vs. Miner-Breakeven (AISC).
 * Layout wie BTC Section 13. Schwellen kommen aus GoldAnalysis.aiscZone
 * (GET /api/analyze-gold), sie werden hier nicht neu gerechnet.
 * Euphorie (P90) ist nicht freigegeben und wird nicht gezeichnet.
 */
import { useMemo, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { formatCurrency } from "@/lib/formatters";
import { useIsNarrow } from "@/hooks/use-mobile";
import type { ReactNode } from "react";
import type { GoldAnalysis } from "../../../../shared/gold-schema";
import type { GoldAiscCompanyCode, GoldAiscSeries, GoldMinerZone, GoldMinerZoneName } from "../../../../shared/schema";
import { GOLD_MINER_P_HIGH_RANK, GOLD_MINER_P_LOW_RANK, GOLD_MINER_ZONE_MIN_OBS, goldMinerPriceDomain } from "../../../../shared/gold-miner-zone";
import { GOLD_AISC_FORMULA, goldAiscCovering, goldAiscNaReason } from "../../../../shared/gold-aisc";

/** Dieselben Presets wie der Aktien-TA-Chart und der Gold-Preis-Chart. Tagesfenster = GOLD_RANGE_DAYS, Anker = letzter Punkt. */
const RANGES = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"] as const;
type MinerRange = (typeof RANGES)[number];
const RANGE_DAYS: Record<Exclude<MinerRange, "Max">, number> = {
  "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "3Y": 1095, "5Y": 1825, "10Y": 3653,
};
const DATE_INPUT_CLASS =
  "h-8 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[10px] text-foreground scheme-light dark:scheme-dark";

const ZONE_FILL: Record<GoldMinerZoneName, string> = {
  capitulation: "rgba(239, 68, 68, 0.18)",
  transition: "rgba(234, 179, 8, 0.12)",
  profitable: "rgba(34, 197, 94, 0.10)",
  euphoria: "rgba(168, 85, 247, 0.12)",
};

const ZONE_LABEL: Record<GoldMinerZoneName, string> = {
  capitulation: "Kapitulation",
  transition: "Übergang",
  profitable: "Profitabel",
  euphoria: "Euphorie",
};

const ZONE_BADGE_CLASS: Record<GoldMinerZoneName, string> = {
  capitulation: "bg-red-500/15 text-red-500 border-red-500/30",
  transition: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  profitable: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  euphoria: "bg-purple-500/15 text-purple-500 border-purple-500/30",
};

const ZONE_TEXT: Record<GoldMinerZoneName, string> = {
  capitulation: "text-red-500",
  transition: "text-amber-500",
  profitable: "text-emerald-500",
  euphoria: "text-purple-500",
};

const COMPANY_ORDER: readonly GoldAiscCompanyCode[] = ["NEM", "B", "AEM"];
const tooltipStyle = { fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 };

function MetricCard({ testId, label, value, subValue, color, title, extra }: {
  testId: string;
  label: string;
  value: string;
  subValue?: string;
  color?: string;
  title?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3" data-testid={testId} title={title}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-base md:text-lg font-bold font-mono tabular-nums mt-1 ${color || "text-foreground"}`}>{value}</div>
      {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
      {extra}
    </div>
  );
}

function quarterLabel(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return m ? `Q${m[2]}/${m[1]}` : quarter;
}

function companyLine(latest: NonNullable<GoldMinerZone["latest"]>): { text: string; title?: string } {
  const byCompany = new Map(latest.perCompany.map(row => [row.company, row.aisc]));
  const text = COMPANY_ORDER.map(code => {
    const value = byCompany.get(code);
    return value == null ? `${code} n/a` : `${code} ${formatCurrency(value, 0)}`;
  }).join(" · ");
  const reported = latest.perCompany.length;
  return {
    text: `${text} · ${quarterLabel(latest.quarter)}`,
    title: reported > 0 && reported < 3 ? `Ø aus ${reported} Firmen` : undefined,
  };
}

function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

export function GoldMinerBreakevenSection({ data }: { data: GoldAnalysis }) {
  const narrow = useIsNarrow();
  const fetching = useIsFetching({ queryKey: ["/api/analyze-gold"] });
  const [range, setRange] = useState<MinerRange>("1Y");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [rangeHint, setRangeHint] = useState<string | null>(null);
  const zone = data.aiscZone;
  const line = data.aiscLine ?? null;
  const heights = narrow
    ? { spot: 220, multiple: 170, margin: 150 }
    : { spot: 260, multiple: 200, margin: 180 };
  const yWidth = narrow ? 44 : 70;
  const legendStyle = { fontSize: narrow ? 10 : 11 };

  const view = useMemo(() => {
    const points = zone?.points ?? [];
    if (points.length === 0) return { points, segments: [] as GoldMinerZone["segments"], empty: false };
    const end = points[points.length - 1].date;
    const visible = custom && custom.from <= custom.to
      ? points.filter(point => point.date >= custom.from && point.date <= custom.to)
      : range === "Max"
        ? points
        : points.filter(point => point.date >= shiftDays(end, RANGE_DAYS[range]));
    if (visible.length === 0) return { points: [], segments: [] as GoldMinerZone["segments"], empty: true };
    const rows = visible;
    const first = rows[0].date;
    const last = rows[rows.length - 1].date;
    const dates = rows.map(point => point.date);
    const has = new Set(dates);
    const snap = (date: string, forward: boolean) => {
      if (has.has(date)) return date;
      if (forward) return dates.find(item => item >= date) ?? last;
      for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= date) return dates[i];
      return first;
    };
    const segments: GoldMinerZone["segments"] = [];
    for (const seg of zone?.segments ?? []) {
      if (seg.x2 < first || seg.x1 > last) continue;
      const x1 = snap(seg.x1 < first ? first : seg.x1, true);
      const x2 = snap(seg.x2 > last ? last : seg.x2, false);
      if (x1 > x2) continue;
      const prev = segments[segments.length - 1];
      if (prev && prev.zone === seg.zone) prev.x2 = x2;
      else segments.push({ x1, x2, zone: seg.zone });
    }
    return { points: rows, segments, empty: false };
  }, [zone, range, custom]);

  const priceDomain = useMemo(() => goldMinerPriceDomain(view.points), [view.points]);
  const multipleDomain = useMemo(() => {
    const values = view.points.map(point => point.multiple).filter((value): value is number => value != null && value > 0);
    for (const extra of [1, zone?.thresholds.low, zone?.thresholds.high]) {
      if (extra != null && extra > 0) values.push(extra);
    }
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.08, 0.05);
    return [Math.max(0, min - pad), max + pad] as [number, number];
  }, [view.points, zone]);
  const latest = zone?.latest ?? null;
  const offline = zone === undefined;
  const na = !offline && (zone == null || zone.naReason != null || latest == null);
  const naText = zone?.naReason ? `n/a — ${zone.naReason}` : "n/a";
  const companies = latest ? companyLine(latest) : null;
  const seriesFrom = zone?.points[0]?.date ?? "";
  const seriesTo = zone?.points.length ? zone.points[zone.points.length - 1].date : "";
  const fromDisplay = custom?.from ?? view.points[0]?.date ?? seriesFrom;
  const toDisplay = custom?.to ?? (view.points.length ? view.points[view.points.length - 1].date : seriesTo);
  const applyCustom = (from: string, to: string) => {
    if (!from || !to) return;
    if (from > to) {
      setRangeHint("Von liegt nach Bis — Eingabe ignoriert.");
      return;
    }
    setRangeHint(null);
    setCustom({ from, to });
  };
  const latestStep = line?.quarters.find(step => step.quarter === latest?.quarter) ?? null;
  const gapPoint = view.points.find(point => point.aisc == null) ?? null;
  const chartRows = view.points.map(point => ({
    ...point,
    minerAisc: point.aisc,
    marginUp: point.marginPct != null && point.marginPct >= 0 ? point.marginPct * 100 : null,
    marginDown: point.marginPct != null && point.marginPct < 0 ? point.marginPct * 100 : null,
  }));

  return (
    <div data-testid="gold-miner-section" id="gold-miner-breakeven">
      <SectionCard number={9} title="Miner-Breakeven (AISC): Profitabilität & Kapitulation">
        {fetching > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Lade AISC-Daten …
          </div>
        )}

        {offline ? (
          <div className="flex items-center gap-2 text-sm text-amber-500 py-2" data-testid="gold-miner-offline">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            AISC n/a — Offline-Daten, keine Minendaten in dieser Antwort
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 min-w-0">
                {latest && (
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-bold border w-fit ${ZONE_BADGE_CLASS[latest.zone]}`}
                    data-testid="gold-miner-zone-badge"
                  >
                    {ZONE_LABEL[latest.zone]}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">
                  Kapitulations-Score:{" "}
                  <span className="font-mono font-bold text-foreground">
                    {latest ? `${Math.round(latest.score)}/100` : "—"}
                  </span>
                  <span className="text-xs ml-1">(0 = max. Kapitulation, 100 = max. Euphorie)</span>
                </span>
              </div>
              <div className="flex min-w-0 max-w-full flex-col gap-2 sm:items-end">
                <div className="flex max-w-full flex-wrap gap-1" data-testid="gold-miner-ranges">
                  {RANGES.map(item => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => { setRange(item); setCustom(null); setRangeHint(null); }}
                      className={`min-h-8 shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                        range === item && !custom ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted/50"
                      }`}
                      data-testid={`button-gold-miner-range-${item}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-1 sm:flex sm:gap-2" data-testid="gold-miner-dates">
                  <label className="flex min-w-0 flex-col gap-0.5 sm:w-[9.5rem]">
                    <span className="text-[10px] leading-none text-muted-foreground">Von</span>
                    <input
                      type="date"
                      min={seriesFrom}
                      max={seriesTo}
                      value={fromDisplay}
                      onChange={event => applyCustom(event.target.value, toDisplay)}
                      data-testid="input-gold-miner-from"
                      className={DATE_INPUT_CLASS}
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-0.5 sm:w-[9.5rem]">
                    <span className="text-[10px] leading-none text-muted-foreground">Bis</span>
                    <input
                      type="date"
                      min={seriesFrom}
                      max={seriesTo}
                      value={toDisplay}
                      onChange={event => applyCustom(fromDisplay, event.target.value)}
                      data-testid="input-gold-miner-to"
                      className={DATE_INPUT_CLASS}
                    />
                  </label>
                </div>
              </div>
            </div>
            {rangeHint && <div className="text-xs text-amber-500" data-testid="gold-miner-range-hint">{rangeHint}</div>}
            {view.empty && <div className="text-xs text-amber-500" data-testid="gold-miner-range-empty">Keine Punkte in diesem Fenster</div>}

            {na && (
              <div className="flex items-center gap-2 text-sm text-amber-500" data-testid="gold-miner-na">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {naText}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                testId="gold-miner-card-multiple"
                label="Spot/AISC-Multiple"
                value={latest ? `${latest.multiple.toFixed(2)}×` : "—"}
                subValue={latest && zone
                  ? `P20 (pLowRank=${zone.thresholds.pLowRank}) ${zone.thresholds.low == null ? "—" : `${zone.thresholds.low.toFixed(1)}×`} · P50 (pHighRank=${zone.thresholds.pHighRank}) ${zone.thresholds.high == null ? "—" : `${zone.thresholds.high.toFixed(1)}×`} · minObs=${GOLD_MINER_ZONE_MIN_OBS}, ${zone.thresholds.obs} Tage`
                  : naText}
                color={latest?.zone === "capitulation" ? "text-red-500" : undefined}
              />
              <MetricCard
                testId="gold-miner-card-aisc"
                label="AISC Ø (NEM/B/AEM)"
                value={latest ? formatCurrency(latest.aisc, 0) : "—"}
                subValue={companies?.text ?? naText}
                title={`${GOLD_AISC_FORMULA}${companies?.title ? ` ${companies.title}` : ""}`}
                color={latest && latest.spot < latest.aisc ? "text-red-500" : undefined}
                extra={latestStep ? (
                  <div className="mt-1 text-[10px] leading-snug text-muted-foreground" data-testid="gold-miner-aisc-sources">
                    <div>Formel: {GOLD_AISC_FORMULA}</div>
                    <div className="mt-0.5">
                      {COMPANY_ORDER.map((code, index) => {
                        const row = latestStep.values.find(value => value.company === code);
                        const node = row
                          ? <a key={code} className="underline" href={row.sourceUrl} target="_blank" rel="noreferrer" title={row.sourceTitle} data-testid={`gold-miner-source-${code}`}>{code} {row.sourceDate}</a>
                          : <span key={code}>{code} n/a — nicht belegt</span>;
                        return index === 0 ? node : <span key={`${code}-sep`}> · {node}</span>;
                      })}
                    </div>
                  </div>
                ) : undefined}
              />
              <MetricCard
                testId="gold-miner-card-margin"
                label="Marge"
                value={latest ? `${formatCurrency(latest.marginUsd, 0)} / oz` : "—"}
                subValue={latest ? `${(latest.marginPct * 100).toFixed(0)} % vom Spot` : naText}
                color={latest && latest.marginUsd < 0 ? "text-red-500" : undefined}
              />
              <MetricCard
                testId="gold-miner-card-score"
                label="Kapitulations-Score"
                value={latest ? `${Math.round(latest.score)}/100` : "—"}
                subValue={latest ? ZONE_LABEL[latest.zone] : naText}
                color={latest ? ZONE_TEXT[latest.zone] : undefined}
              />
            </div>

            <div data-testid="gold-miner-chart-spot">
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Spot vs. Miner-Breakeven (AISC) — Zonen: Kapitulation (rot) · Übergang (gelb) · Profitabel (grün)
              </div>
              <ResponsiveContainer width="100%" height={heights.spot}>
                <ComposedChart data={chartRows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={narrow ? 44 : 70}
                    domain={priceDomain ?? ["auto", "auto"]}
                    tickFormatter={(value: number) => (value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`)}
                  />
                  <Tooltip content={props => <MinerTip {...props} line={line} />} />
                  <Legend wrapperStyle={legendStyle} />
                  {view.segments.map((seg, index) => (
                    <ReferenceArea key={`${seg.zone}-${seg.x1}-${index}`} x1={seg.x1} x2={seg.x2} fill={ZONE_FILL[seg.zone]} strokeOpacity={0} />
                  ))}
                  <Line type="monotone" dataKey="spot" name="Gold Spot ($/oz)" stroke="#3B82F6" dot={false} strokeWidth={1.8} connectNulls />
                  <Line type="stepAfter" dataKey="minerAisc" name="AISC Ø Minen ($/oz)" stroke="#F97316" dot={false} strokeWidth={1.5} strokeDasharray="6 4" connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div data-testid="gold-miner-chart-multiple">
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Spot/AISC-Multiple — P20 = Perzentil pLowRank={zone?.thresholds.pLowRank ?? GOLD_MINER_P_LOW_RANK}, P50 = Perzentil pHighRank={zone?.thresholds.pHighRank ?? GOLD_MINER_P_HIGH_RANK} (PERCENTILE.INC, Historie seit {zone?.thresholds.since ?? "n/a"})
              </div>
              <ResponsiveContainer width="100%" height={heights.multiple}>
                <ComposedChart data={chartRows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} />
                  <YAxis tick={{ fontSize: 10 }} width={yWidth} domain={multipleDomain ?? ["auto", "auto"]} tickFormatter={(value: number) => `${value.toFixed(1)}×`} />
                  <Tooltip content={props => <MinerTip {...props} line={line} />} />
                  <Legend wrapperStyle={legendStyle} />
                  <ReferenceLine y={1} stroke="#EF4444" label={{ value: "Spot = AISC", fontSize: 10, fill: "#EF4444", position: "insideTopLeft" }} />
                  {zone?.thresholds.low != null && (
                    <ReferenceLine y={zone.thresholds.low} stroke="#EF4444" strokeDasharray="4 3" label={{ value: `P20 pLowRank=${zone.thresholds.pLowRank} = ${zone.thresholds.low.toFixed(2)}×`, fontSize: 10, fill: "#EF4444", position: "insideBottomLeft" }} />
                  )}
                  {zone?.thresholds.high != null && (
                    <ReferenceLine y={zone.thresholds.high} stroke="#F59E0B" strokeDasharray="4 3" label={{ value: `P50 pHighRank=${zone.thresholds.pHighRank} = ${zone.thresholds.high.toFixed(2)}×`, fontSize: 10, fill: "#F59E0B", position: "insideTopRight" }} />
                  )}
                  <Line type="monotone" dataKey="multiple" name="Spot/AISC" stroke="#a855f7" dot={false} strokeWidth={1.8} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div data-testid="gold-miner-chart-margin">
              <div className="text-xs font-semibold text-muted-foreground mb-1">Marge (Spot − AISC) / Spot</div>
              <ResponsiveContainer width="100%" height={heights.margin}>
                <ComposedChart data={chartRows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} />
                  <YAxis tick={{ fontSize: 10 }} width={yWidth} tickFormatter={(value: number) => `${Math.round(value)}%`} />
                  <Tooltip content={props => <MinerTip {...props} line={line} />} />
                  <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.45} />
                  <Area type="monotone" dataKey="marginUp" name="Marge über Breakeven" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} strokeWidth={1.4} connectNulls={false} />
                  <Area type="monotone" dataKey="marginDown" name="Marge unter Breakeven" stroke="#ef4444" fill="#ef4444" fillOpacity={0.25} strokeWidth={1.4} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/20 border border-border rounded-lg p-3 space-y-1">
              <div className="font-semibold text-foreground">AISC und Zonen</div>
              <div>
                AISC = All-in Sustaining Cost je Unze (by-product), Ø Newmont, Barrick, Agnico Eagle aus Quartalsberichten
                (Quelle je Wert in server/data/gold-aisc.json). {GOLD_AISC_FORMULA}
                Zonen-Schwellen sind Perzentile der eigenen Multiple-Historie, keine festen Zahlen.
                Kein Einfluss auf GIS/Score (inScore false). Der Kapitulations-Score ist der Perzentil-Rang des aktuellen Multiples in dieser Historie
                (unter 1× auf höchstens 10 gekappt); eine längere Historie verschiebt nur die Stichprobe.
              </div>
              {gapPoint && (
                <div data-testid="gold-miner-aisc-gap">AISC n/a am {gapPoint.date}: {goldAiscNaReason(line, gapPoint.date)}</div>
              )}
              <div>
                Historie: {zone?.thresholds.obs ?? 0} Tage seit {zone?.thresholds.since ?? "n/a"}.
                Parameter: method={line?.method ?? "mean"}, minCompanies={line?.minCompanies ?? "n/a"}, lagDays={line?.lagDays ?? "n/a"},
                pLowRank={zone?.thresholds.pLowRank ?? GOLD_MINER_P_LOW_RANK}, pHighRank={zone?.thresholds.pHighRank ?? GOLD_MINER_P_HIGH_RANK},
                minObs={GOLD_MINER_ZONE_MIN_OBS}.
                <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-500">teilw. nicht point-in-time</span>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

type MinerTipRow = {
  date: string;
  spot: number;
  aisc: number | null;
  multiple: number | null;
};

function MinerTip({ active, payload, line }: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: MinerTipRow }>;
  line: GoldAiscSeries | null;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const step = goldAiscCovering(line, row.date);
  const reason = row.aisc == null ? goldAiscNaReason(line, row.date) : null;
  const present = new Set(step?.values.map(value => value.company) ?? []);
  return (
    <div style={tooltipStyle} className="max-w-sm space-y-0.5 p-2">
      <div className="font-mono">{row.date}</div>
      <div>Spot {formatCurrency(row.spot, 0)}</div>
      <div>AISC Ø {row.aisc == null ? "n/a" : formatCurrency(row.aisc, 0)}{step?.quarter ? ` · ${quarterLabel(step.quarter)}` : ""}</div>
      {row.multiple != null && <div>Multiple {row.multiple.toFixed(2)}×</div>}
      {reason && <div>{reason}</div>}
      {step?.values.map(value => (
        <div key={value.company}>{value.company} {formatCurrency(value.aisc, 0)} · Quelle {value.sourceDate} · {value.sourceTitle}</div>
      ))}
      {COMPANY_ORDER.filter(code => step != null && !present.has(code)).map(code => (
        <div key={code}>{code} n/a — Quartal nicht belegt, nicht interpoliert</div>
      ))}
      <div>{GOLD_AISC_FORMULA}</div>
    </div>
  );
}
