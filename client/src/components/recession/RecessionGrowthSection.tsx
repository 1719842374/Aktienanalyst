/**
 * Gewinnwachstum und Growth Gap auf /recession.
 * Chart aus GET /api/recession/earnings-growth/:index, Gap-Karten aus
 * GET /api/recession/growth-gap/:index. Nur Anzeige, kein Score.
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { SectionCard } from "@/components/SectionCard";
import { usePublishChatSection } from "@/lib/chatSectionData";
import { useRecessionGrowth } from "@/hooks/useRecessionGrowth";
import type { ChatFactValue } from "@shared/chat-context";
import {
  GROWTH_BOOKS,
  GROWTH_GAP_PARAMS,
  GROWTH_INDEXES,
  REALIZED_FORMULA,
  sliceGrowthChart,
  type GapDirection,
  type GapReading,
  type GrowthIndex,
  type GrowthRange,
  type NaReading,
  type RecessionGrowthBody,
} from "@shared/recession-growth";

function deNum(v: number, digits: number): string {
  const sign = v < 0 ? "−" : "";
  return sign + Math.abs(v).toFixed(digits).replace(".", ",");
}

function signedPct(v: number): string {
  if (v > 0) return `+${deNum(v, 1)} %`;
  return `${deNum(v, 1)} %`;
}

function holdingWeightPct(weight: number, indexWeight: number): string {
  const asPct = indexWeight > 1 ? weight : weight * 100;
  return `${deNum(asPct, 2)} %`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function gatewayErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = /^(\d+)/.exec(message)?.[1];
  return status
    ? `n/a — Datenquelle nicht erreichbar (HTTP ${status})`
    : "n/a — Datenquelle nicht erreichbar";
}

function gapMeaning(direction: GapDirection): string {
  switch (direction) {
    case "positiv":
      return "Markt erwartet mehr Wachstum als zuletzt realisiert";
    case "negativ":
      return "Markt erwartet weniger als zuletzt realisiert";
    case "nahe_null":
      return "Erwartung und Realität im Takt";
    default: {
      const neverDir: never = direction;
      return neverDir;
    }
  }
}

function chatFacts(body: RecessionGrowthBody): Record<string, ChatFactValue> {
  const facts: Record<string, ChatFactValue> = { index: body.etf };
  if (body.stats.available) {
    facts.realisiertPct = round1(body.stats.realizedPct);
    facts.median10y = round1(body.stats.median10y);
    facts.realisiertZ = round1(body.stats.z);
    facts.realisiertPerzentil = round1(body.stats.percentile);
    facts.abstandMedianPp = round1(body.stats.distanceToMedianPp);
  } else {
    facts.realisiert = body.stats.reason;
  }
  if (body.forward.available) facts.forwardPct = round1(body.forward.gFwdPct);
  else facts.forward = body.forward.reason;
  if (body.growthGap.available) {
    facts.growthGapPp = round1(body.growthGap.gapPp);
    facts.growthGapZ = round1(body.growthGap.z);
    facts.growthGapWarnung = body.growthGap.warn;
  } else {
    facts.growthGap = body.growthGap.reason;
  }
  facts.gStar = body.gStar.available ? round1(body.gStar.gStarPct) : body.gStar.reason;
  facts.impliedGap = body.impliedGap.available ? round1(body.impliedGap.gapPp) : body.impliedGap.reason;
  facts.fazit = body.fazit.text;
  if (body.consensusTrace) facts.konsensSpur = body.consensusTrace.slice(0, 400);
  if (body.vix.available) {
    facts.vixZ = round1(body.vix.z);
    facts.vixSchock = body.vix.shock;
  } else {
    facts.vix = body.vix.reason;
  }
  facts.llm = body.llm.reason;
  return facts;
}

export function RecessionGrowthSection({ number }: { number: number }) {
  const [index, setIndex] = useState<GrowthIndex>("SPY");
  const [range, setRange] = useState<GrowthRange>("10Y");
  const { plot, gap } = useRecessionGrowth(index);
  const series = plot.data ?? null;
  const gaps = gap.data ?? plot.data ?? null;
  const asOf = series?.chart.length ? series.chart[series.chart.length - 1].date : "";
  const visible = useMemo(
    () => (series && asOf ? sliceGrowthChart(series.chart, range, asOf) : []),
    [series, range, asOf],
  );

  usePublishChatSection("recession", "gewinn", gaps ? chatFacts(gaps) : null);

  const book = GROWTH_BOOKS[index];
  const stats = gaps?.stats;
  const showCone = !!stats && stats.available && visible.some(p => p.yoyPct != null);

  return (
    <SectionCard
      number={number}
      title="Gewinnwachstum & Growth Gap"
      subtitle={`${book.label} (${book.etf}) · Index-Kurs, EPS-YoY, Forward, g* · nur Anzeige, kein Score`}
    >
      <div className="space-y-3" data-testid="recession-growth">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" data-testid="recession-growth-regions">
            {GROWTH_INDEXES.map(id => (
              <button
                key={id}
                type="button"
                aria-pressed={index === id}
                data-testid={`button-growth-region-${id}`}
                onClick={() => setIndex(id)}
                className={`min-h-9 rounded-md border px-3 text-[11px] font-medium sm:min-h-7 sm:text-[10px] ${
                  index === id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted/50"
                }`}
              >
                {GROWTH_BOOKS[id].label} <span className="opacity-70">({id})</span>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5" data-testid="recession-growth-ranges">
            {GROWTH_GAP_PARAMS.ranges.map(r => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                data-testid={`button-growth-range-${r}`}
                onClick={() => setRange(r)}
                className={`min-h-9 rounded-md border px-2.5 text-[11px] font-medium sm:min-h-7 sm:text-[10px] ${
                  range === r ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted/50"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <StatusLine query={plot} label="Kurs und YoY" testId="recession-growth-plot-status" />

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground" data-testid="recession-growth-legend">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#38bdf8]" />Index-Kurs</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#a78bfa]" />EPS YoY</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 border-t border-dashed border-[#eab308]" />Median {GROWTH_GAP_PARAMS.medianWindowYears}J</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 border-t border-dashed border-[#64748b]" />±{GROWTH_GAP_PARAMS.coneSigma}σ</span>
          {gaps?.forward.available && (
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 border-t border-dashed border-[#10b981]" />Forward</span>
          )}
        </div>

        {series && visible.length > 0 && (
          <div className="h-[260px] w-full" data-testid="recession-growth-chart">
            <ResponsiveContainer>
              <ComposedChart data={visible} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis yAxisId="px" tick={{ fontSize: 10 }} width={48} domain={["auto", "auto"]} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} width={40} domain={["auto", "auto"]} />
                <Tooltip
                  content={({ active, label, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as { close?: number; yoyPct?: number | null } | undefined;
                    return (
                      <div className="rounded border border-border bg-card px-2 py-1 text-[10px] text-foreground">
                        <div>{String(label ?? "")}</div>
                        <div>Kurs {row?.close != null ? deNum(row.close, 2) : "n/a"}</div>
                        <div>EPS YoY {row?.yoyPct != null ? signedPct(row.yoyPct) : "n/a — kein Druck in der Haltefrist"}</div>
                      </div>
                    );
                  }}
                />
                {showCone && stats.available && (
                  <>
                    <ReferenceLine yAxisId="pct" y={stats.median10y} stroke="#eab308" strokeDasharray="4 4" />
                    <ReferenceLine yAxisId="pct" y={stats.coneLow} stroke="#64748b" strokeDasharray="2 4" />
                    <ReferenceLine yAxisId="pct" y={stats.coneHigh} stroke="#64748b" strokeDasharray="2 4" />
                  </>
                )}
                {gaps?.forward.available && (
                  <ReferenceLine yAxisId="pct" y={gaps.forward.gFwdPct} stroke="#10b981" strokeDasharray="6 3" />
                )}
                {gaps?.gStar.available && (
                  <ReferenceLine yAxisId="pct" y={gaps.gStar.gStarPct} stroke="#f97316" strokeDasharray="6 3" />
                )}
                <Line yAxisId="px" type="monotone" dataKey="close" name="Kurs" stroke="#38bdf8" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line yAxisId="pct" type="stepAfter" dataKey="yoyPct" name="EPS YoY" stroke="#a78bfa" dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {series?.priceError && (
          <p className="text-[11px] text-muted-foreground" data-testid="recession-growth-price-na">{series.priceError}</p>
        )}
        {series?.realizedError && (
          <p className="text-[11px] text-muted-foreground" data-testid="recession-growth-realized-na">{series.realizedError}</p>
        )}

        <p className="text-[10px] text-muted-foreground">
          YoY bleibt der letzte Druck (Quartal {GROWTH_GAP_PARAMS.quarterMaxAgeDays} Tage, Jahr {GROWTH_GAP_PARAMS.annualMaxAgeDays} Tage), danach eine Lücke. Kein Verlauf zwischen den Terminen.
          {stats?.available ? ` Median ${GROWTH_GAP_PARAMS.medianWindowYears}J und ±${GROWTH_GAP_PARAMS.coneSigma}σ gelten für das Fenster bis ${stats.asOf}.` : ""}
        </p>

        <StatusLine query={gap} label="Growth Gap" testId="recession-growth-gap-status" />

        {gaps && (
          <>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2" data-testid="recession-growth-fazit">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fazit</div>
              <p className="break-words text-sm text-foreground">{gaps.fazit.text}</p>
              <p className="break-words text-[11px] text-muted-foreground">{gaps.fazit.formula}</p>
            </div>
            {gaps.forward.lines && gaps.forward.lines.length > 0 && (
              <div className="rounded-md border border-border px-3 py-2" data-testid="recession-growth-holdings">
                <p className="text-[10px] text-muted-foreground">
                  t = Tage bis FY-Ende + 182. Technische Stabilisierung: Gewicht = Index-Gewicht × min(1, t/365) × Huber(MAD-z). g ist ungedämpft.
                </p>
                <ul className="mt-1 space-y-1">
                  {gaps.forward.lines.map(line => (
                    <li key={line.symbol} className="break-words text-[11px] text-foreground" data-testid={`recession-growth-holding-${line.symbol}`}>
                      {line.symbol}
                      {" · g "}
                      {line.gAnnPct != null ? signedPct(line.gAnnPct) : (line.excludeReason ?? "n/a")}
                      {" · Gewicht "}
                      {line.weight != null ? holdingWeightPct(line.weight, line.indexWeight) : `raus (Index ${holdingWeightPct(line.indexWeight, line.indexWeight)})`}
                      {" · t "}
                      {line.tDays != null ? `${Math.round(line.tDays)} Tage` : "n/a"}
                      {" · Quelle "}
                      {line.source ?? "n/a"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {gaps.forward.available && gaps.forward.coverageWarn && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-foreground" data-testid="recession-growth-coverage">
                {gaps.forward.coverageWarn}
              </p>
            )}
            {!gaps.forward.available && gaps.forward.reason.includes("minCoverage") && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-foreground" data-testid="recession-growth-coverage">
                {gaps.forward.reason}
              </p>
            )}
            {gaps.growthGap.available && gaps.growthGap.warn && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-foreground" data-testid="recession-growth-warn">
                Warnung: |Growth Gap| ≥ {GROWTH_GAP_PARAMS.coneSigma}σ. {gapMeaning(gaps.growthGap.direction)}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Reading
                testId="recession-growth-realized"
                label="Realisiertes EPS-YoY"
                value={gaps.stats.available ? signedPct(gaps.stats.realizedPct) : gaps.stats.reason}
                detail={gaps.stats.available
                  ? `${REALIZED_FORMULA} · ${gaps.realizedSource} · Stand ${gaps.stats.asOf} · Median ${signedPct(gaps.stats.median10y)} · Abstand ${signedPct(gaps.stats.distanceToMedianPp)} · Perzentil ${deNum(gaps.stats.percentile, 1)} % · z ${deNum(gaps.stats.z, 2)}`
                  : "n/a"}
              />
              <Reading
                testId="recession-growth-forward"
                label="g_fwd (Forward-Konsens)"
                value={gaps.forward.available ? signedPct(gaps.forward.gFwdPct) : gaps.forward.reason}
                detail={gaps.forward.available
                  ? `${gaps.forward.formula} · Stand ${gaps.forward.asOf} · ${gaps.forward.source}`
                  : "n/a"}
              />
              <GapCard
                testId="recession-growth-gap"
                label="Growth Gap (g_fwd − g_realized)"
                gap={gaps.growthGap}
                formula="g_fwd − g_realized"
                naLead={gaps.forward.available ? "g_fwd ist gesetzt. g_realized fehlt, die Differenz bleibt n/a." : undefined}
              />
              <GapCard testId="recession-growth-implied" label="Implied Gap" gap={gaps.impliedGap} formula="g* − g_realized" />
              <Reading
                testId="recession-growth-gstar"
                label="g* (Reverse DCF)"
                value={gaps.gStar.available ? signedPct(gaps.gStar.gStarPct) : gaps.gStar.reason}
                detail={gaps.gStar.available ? gaps.gStar.source : "n/a"}
              />
              <Reading
                testId="recession-growth-shock"
                label="Störereignis"
                value={gaps.vix.available
                  ? `VIX ${deNum(gaps.vix.latest, 1)} · z ${deNum(gaps.vix.z, 2)}${gaps.vix.shock ? " · Spike" : ""}`
                  : gaps.vix.reason}
                detail={gaps.llm.reason}
              />
            </div>
          </>
        )}

        {gaps?.consensusTrace && (
          <p className="break-words text-[10px] text-muted-foreground" data-testid="recession-growth-trace">{gaps.consensusTrace}</p>
        )}

        <p className="text-[10px] text-muted-foreground" data-testid="recession-growth-sources">
          {(gaps?.sources.length ? gaps.sources : series?.sources ?? []).join(" · ") || "Quellen werden mit der Antwort geladen"}
        </p>
      </div>
    </SectionCard>
  );
}

function StatusLine({ query, label, testId }: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: RecessionGrowthBody | null | undefined };
  label: string;
  testId: string;
}) {
  if (query.isPending) return <p className="text-sm text-muted-foreground" data-testid={testId}>{label} wird geladen …</p>;
  if (query.isError) return <p className="text-sm text-foreground" role="status" data-testid={testId}>{label}: {gatewayErrorText(query.error)}</p>;
  if (!query.data) return <p className="text-sm text-foreground" role="status" data-testid={testId}>{label}: n/a — keine Daten</p>;
  return null;
}

function Reading({ testId, label, value, detail }: { testId: string; label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/30 px-3 py-2" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-words text-sm font-semibold text-foreground">{value}</div>
      <div className="break-words text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function GapCard({ testId, label, gap, formula, naLead }: {
  testId: string;
  label: string;
  gap: GapReading;
  formula: string;
  naLead?: string;
}) {
  const na = gap as NaReading;
  const naValue = naLead ? `${naLead} ${na.reason}` : na.reason;
  return (
    <Reading
      testId={testId}
      label={label}
      value={gap.available ? signedPct(gap.gapPp) : naValue}
      detail={gap.available
        ? `${formula} · z ${deNum(gap.z, 2)} · ${gapMeaning(gap.direction)}${gap.warn ? " · Warnung" : ""}`
        : formula}
    />
  );
}
