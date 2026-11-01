import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  goldCrossBacktestHttpFailure,
  goldCrossBacktestTransportFailure,
  type GoldCrossBacktest,
  type GoldCrossHorizonResult,
  type GoldCrossSideResult,
} from "@shared/gold-backtest-cross";

const HORIZON_LABELS: Record<string, string> = {
  oneMonth: "1 Monat",
  oneQuarter: "1 Quartal",
  oneYear: "1 Jahr",
};

function horizonLabel(row: GoldCrossHorizonResult): string {
  return HORIZON_LABELS[row.name] ?? row.name;
}

function deNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

function returnText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const text = `${deNumber(value * 100, 1)} %`;
  return value > 0 ? `+${text}` : text;
}

function hitText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${deNumber(value * 100, 0)} %`;
}

function zText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const text = deNumber(value, 2);
  return value > 0 ? `+${text}` : text;
}

function percentileText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return deNumber(value, 0);
}

function dateText(iso: string | null): string {
  if (!iso) return "n/a";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function SideBlock({ title, side, testId }: { title: string; side: GoldCrossSideResult; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-[11px] font-medium text-foreground">
        {title}
        <span className="ml-2 font-mono tabular-nums text-muted-foreground">
          {side.events} {side.events === 1 ? "Ereignis" : "Ereignisse"}
          {side.lastDate ? ` · zuletzt ${dateText(side.lastDate)}` : ""}
        </span>
      </div>
      <ul className="mt-1 space-y-1">
        {side.horizons.map((row) => (
          <li key={row.name} className="text-[10px] leading-relaxed text-muted-foreground">
            <span className="text-foreground/80">{horizonLabel(row)} ({row.sessions}T)</span>
            <span className="block font-mono tabular-nums">
              {`Treffer ${hitText(row.hitRate)} · Ø ${returnText(row.meanForwardReturn)} · z ${zText(row.zScore)} · P${percentileText(row.percentile)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GoldCrossBacktestView({ data }: { data: GoldCrossBacktest | null | undefined }) {
  const ready = data?.available === true;
  return (
    <section className="bg-card border border-card-border rounded-lg px-4 py-2.5" data-testid="gold-cross-backtest">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-xs font-medium text-foreground">MA-Cross-Backtest</h2>
        <span className="text-[10px] text-muted-foreground">nur Anzeige, kein Score</span>
      </div>
      {!data && <p className="mt-1 text-[11px] text-muted-foreground">lädt …</p>}
      {data && !ready && (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="gold-cross-backtest-status">
          n/a{data.unavailableReason ? ` · ${data.unavailableReason}` : ""}
        </p>
      )}
      {data && ready && (
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SideBlock title="Golden Cross" side={data.golden} testId="gold-cross-backtest-golden" />
          <SideBlock title="Death Cross" side={data.death} testId="gold-cross-backtest-death" />
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {data?.source ?? "Yahoo GC=F"}
        {data?.from && data.to ? ` · ${dateText(data.from)}–${dateText(data.to)}` : ""}
        {data ? ` · MA${data.fastWindow}/${data.slowWindow}` : ""}
        {" · Signifikanz: z und Perzentil gegen alle Forward-Returns desselben Horizonts · kein Score"}
      </p>
    </section>
  );
}

export function GoldCrossBacktestCard() {
  const { data } = useQuery<GoldCrossBacktest>({
    queryKey: ["/api/gold/backtest-cross"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/gold/backtest-cross");
        if (!res.ok) return goldCrossBacktestHttpFailure(res.status, await res.text());
        return await res.json() as GoldCrossBacktest;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return goldCrossBacktestTransportFailure(message);
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  return <GoldCrossBacktestView data={data} />;
}
