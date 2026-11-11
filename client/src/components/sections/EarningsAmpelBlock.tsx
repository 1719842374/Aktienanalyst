import type { CSSProperties } from "react";
import { EARNINGS_LAMP_CONFIG } from "@shared/earnings-markers";
import {
  buildEarningsAmpel,
  earningsAmpelCellPaint,
  earningsAmpelColor,
  earningsAmpelLabel,
  earningsAmpelSymbol,
  earningsAmpelThresholdLine,
  formatAmpelNumber,
  formatAmpelPct,
  type EarningsAmpelLamp,
  type EarningsAmpelMetric,
  type EarningsAmpelModel,
  type EarningsAmpelQuarter,
} from "@shared/earnings-ampel";
import { useEarningsMarkers } from "@/hooks/useEarningsMarkers";

export function EarningsAmpelBlock({ ticker }: { ticker: string }) {
  const query = useEarningsMarkers(ticker);
  if (query.isPending) {
    return <EarningsAmpelView model={buildEarningsAmpel([])} notice="n/a — wird geladen" />;
  }
  if (query.isError) {
    const raw = query.error instanceof Error ? query.error.message : "Abruf fehlgeschlagen";
    const clean = raw.replace(/\s+/g, " ").trim();
    const notice = clean.startsWith("<") || clean.length > 180
      ? "n/a — Abruf fehlgeschlagen"
      : `n/a — Abruf fehlgeschlagen (${clean})`;
    return <EarningsAmpelView model={buildEarningsAmpel([])} notice={notice} />;
  }
  return (
    <EarningsAmpelView
      model={buildEarningsAmpel(query.data?.markers ?? [])}
      notice={query.data?.note ?? null}
    />
  );
}

export function EarningsAmpelView({ model, notice }: { model: EarningsAmpelModel; notice?: string | null }) {
  const fallback = notice?.trim() || "n/a — keine Quartale";
  return (
    <section className="bg-card text-card-foreground border border-card-border rounded-lg min-w-0 max-w-full overflow-hidden" data-testid="earnings-ampel">
      <div className="px-3 py-3 sm:px-4 space-y-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Earnings-Ampel</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5 break-words" data-testid="earnings-ampel-thresholds">
            {earningsAmpelThresholdLine()}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1 break-words">
            Klassifikation aus buildEarningsMarkers. Modus {EARNINGS_LAMP_CONFIG.mode === "sue" ? "SUE" : "feste Totzone"}. Punktfarbe ist Umsatz, sonst EPS, nie eine Mischfarbe.
          </p>
        </div>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          <Lamp testId="earnings-ampel-eps" title="EPS" metric={model.latest?.eps ?? null} quarter={model.latest?.date ?? null} fallbackReason={fallback} />
          <Lamp testId="earnings-ampel-revenue" title="Umsatz" metric={model.latest?.revenue ?? null} quarter={model.latest?.date ?? null} fallbackReason={fallback} />
        </div>
        {model.latest && notice ? <p className="text-[10px] text-muted-foreground break-words">{notice}</p> : null}
        <div className="overflow-x-auto min-w-0" data-testid="earnings-ampel-table-scroll">
          <table className="w-full text-xs border-collapse">
            <thead className="hidden sm:table-header-group">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Quartal</th>
                <th className="py-1 pr-3 font-medium">Umsatz Ist</th>
                <th className="py-1 pr-3 font-medium">Umsatz Schätzung</th>
                <th className="py-1 pr-3 font-medium">Umsatz Δ</th>
                <th className="py-1 pr-3 font-medium">Umsatz</th>
                <th className="py-1 pr-3 font-medium">EPS Ist</th>
                <th className="py-1 pr-3 font-medium">EPS Schätzung</th>
                <th className="py-1 pr-3 font-medium">EPS Δ</th>
                <th className="py-1 font-medium">EPS</th>
              </tr>
            </thead>
            <tbody>
              {model.quarters.map(quarter => (
                <QuarterRow key={quarter.date} quarter={quarter} />
              ))}
            </tbody>
          </table>
          {model.quarters.length === 0 ? <p className="text-xs text-muted-foreground pt-2">{fallback}</p> : null}
        </div>
      </div>
    </section>
  );
}

function Lamp({ testId, title, metric, quarter, fallbackReason }: {
  testId: string;
  title: string;
  metric: EarningsAmpelMetric | null;
  quarter: string | null;
  fallbackReason: string;
}) {
  const lamp = metric?.lamp ?? "na";
  const reason = metric?.reason ?? fallbackReason;
  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-3" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}{quarter ? ` · ${quarter}` : ""}</div>
      <div className="mt-2 flex items-center gap-2 min-w-0">
        <LampDot lamp={lamp} />
        <span className="text-sm font-semibold text-foreground">{earningsAmpelLabel(lamp)}</span>
        {metric?.surprisePct != null ? <span className="text-xs tabular-nums text-muted-foreground">{formatAmpelPct(metric.surprisePct)}</span> : null}
      </div>
      {lamp === "na" ? <p className="mt-1 text-xs text-muted-foreground break-words">{reason}</p> : null}
    </div>
  );
}

function QuarterRow({ quarter }: { quarter: EarningsAmpelQuarter }) {
  return (
    <tr className="block sm:table-row border-t border-border/60 py-2 sm:py-0" data-testid="earnings-ampel-row">
      <td className="flex sm:table-cell items-baseline justify-between gap-3 py-0.5 sm:py-1.5 sm:pr-3 font-mono sm:whitespace-nowrap text-foreground">
        <span className="sm:hidden text-[10px] uppercase tracking-wide text-muted-foreground">Quartal</span>
        <span>{quarter.date}</span>
      </td>
      <ValueCell metricLabel="Umsatz" field="actual" metric={quarter.revenue} />
      <ValueCell metricLabel="Umsatz" field="estimate" metric={quarter.revenue} />
      <ValueCell metricLabel="Umsatz" field="surprise" metric={quarter.revenue} />
      <td className="flex sm:table-cell items-start justify-between gap-3 py-0.5 sm:py-1.5 sm:pr-3">
        <span className="sm:hidden text-[10px] uppercase tracking-wide text-muted-foreground">Umsatz</span>
        <MetricLamp metric={quarter.revenue} />
      </td>
      <ValueCell metricLabel="EPS" field="actual" metric={quarter.eps} />
      <ValueCell metricLabel="EPS" field="estimate" metric={quarter.eps} />
      <ValueCell metricLabel="EPS" field="surprise" metric={quarter.eps} />
      <td className="flex sm:table-cell items-start justify-between gap-3 py-0.5 sm:py-1.5">
        <span className="sm:hidden text-[10px] uppercase tracking-wide text-muted-foreground">EPS</span>
        <MetricLamp metric={quarter.eps} />
      </td>
    </tr>
  );
}

type ValueField = "actual" | "estimate" | "surprise";

function ValueCell({ metricLabel, field, metric }: {
  metricLabel: "EPS" | "Umsatz";
  field: ValueField;
  metric: EarningsAmpelMetric;
}) {
  const caption = valueCaption(metricLabel, field, metric);
  const hideConsensusColor = field === "estimate" && !EARNINGS_LAMP_CONFIG.colorConsensus;
  const paintLamp: EarningsAmpelLamp = hideConsensusColor ? "na" : caption.lamp;
  const paint = paintLamp === "na" ? null : earningsAmpelCellPaint(paintLamp);
  const fieldName = `${metricLabel === "EPS" ? "eps" : "revenue"}-${field}`;
  const heading = field === "actual" ? `${metricLabel} Ist` : field === "estimate" ? `${metricLabel} Schätzung` : `${metricLabel} Δ`;
  return (
    <td
      data-ampel-cell={fieldName}
      data-lamp={paintLamp}
      className="flex sm:table-cell items-baseline justify-between gap-3 py-0.5 sm:py-1.5 sm:pr-3 sm:align-top min-w-0"
    >
      <span className="sm:hidden text-[10px] uppercase tracking-wide text-muted-foreground">{heading}</span>
      {paint ? (
        <span
          title={field === "surprise" && metric.sue != null ? `SUE ${metric.sue.toFixed(2)}` : undefined}
          className="earnings-ampel-value inline-block max-w-full rounded-sm px-1 py-0.5 tabular-nums whitespace-normal sm:whitespace-nowrap"
          style={{
            ["--ampel-color" as string]: paint.color,
            ["--ampel-ink" as string]: paint.lightInk,
            ["--ampel-ink-dark" as string]: paint.darkInk,
            ["--ampel-wash" as string]: paint.lightWash,
            ["--ampel-wash-dark" as string]: paint.darkWash,
          }}
        >
          {earningsAmpelSymbol(paintLamp)} {field === "surprise" && metric.shown ? metric.shown : caption.text}
        </span>
      ) : (
        <span className="tabular-nums text-foreground whitespace-normal break-words text-right sm:text-left sm:max-w-[11rem]">{caption.text}</span>
      )}
    </td>
  );
}

function valueCaption(label: "EPS" | "Umsatz", field: ValueField, metric: EarningsAmpelMetric): { text: string; lamp: EarningsAmpelLamp } {
  const raw = field === "actual" ? metric.actual : field === "estimate" ? metric.estimate : metric.surprisePct;
  const missing = raw == null || !Number.isFinite(raw) || (field === "estimate" && raw === 0);
  if (missing) {
    const text = metric.reason
      ?? (field === "actual"
        ? `n/a — ${label}-Ist fehlt`
        : field === "estimate"
          ? `n/a — ${label}-Schätzung fehlt oder ist 0`
          : `n/a — ${label}-Surprise nicht berechenbar`);
    return { text, lamp: "na" };
  }
  const formatted = field === "surprise" ? formatAmpelPct(raw) : formatAmpelNumber(raw);
  if (metric.lamp === "na") return { text: formatted, lamp: "na" };
  return { text: formatted, lamp: metric.lamp };
}

function MetricLamp({ metric }: { metric: EarningsAmpelMetric }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end sm:justify-start gap-x-1.5 gap-y-0.5 min-w-0 max-w-full text-right sm:text-left">
      <LampDot lamp={metric.lamp} />
      <span className="text-foreground break-words">{metric.reason ?? earningsAmpelLabel(metric.lamp)}</span>
    </span>
  );
}

function LampDot({ lamp }: { lamp: EarningsAmpelMetric["lamp"] }) {
  const color = earningsAmpelColor(lamp);
  const style: CSSProperties | undefined = color ? { backgroundColor: color } : undefined;
  return (
    <span
      data-lamp={lamp}
      className="inline-block h-3.5 w-3.5 rounded-full border border-black/25 shrink-0"
      style={style}
      aria-hidden="true"
    />
  );
}
