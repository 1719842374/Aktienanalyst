import type { CSSProperties } from "react";
import {
  EARNINGS_LAMP_CONFIG,
  earningsLampPaint,
  type EarningsLamp,
  type EarningsMarker,
} from "@shared/earnings-markers";
import { useEarningsMarkers } from "@/hooks/useEarningsMarkers";

export function EarningsAmpelBlock({ ticker }: { ticker: string }) {
  const query = useEarningsMarkers(ticker);
  if (query.isPending) return <EarningsAmpelView markers={[]} notice="n/a — wird geladen" />;
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : "Abruf fehlgeschlagen";
    return <EarningsAmpelView markers={[]} notice={`n/a — ${message}`} />;
  }
  return <EarningsAmpelView markers={query.data?.markers ?? []} notice={query.data?.note ?? null} />;
}

export function EarningsAmpelView({ markers, notice }: { markers: readonly EarningsMarker[]; notice?: string | null }) {
  const rows = [...markers].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const latest = rows[0] ?? null;
  return (
    <section className="bg-card text-card-foreground border border-card-border rounded-lg min-w-0 max-w-full overflow-hidden" data-testid="earnings-ampel">
      <div className="px-3 py-3 sm:px-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Earnings-Ampel</h2>
          <p className="text-[10px] text-muted-foreground break-words" data-testid="earnings-ampel-mode">
            Modus {EARNINGS_LAMP_CONFIG.mode}. Konsens {EARNINGS_LAMP_CONFIG.colorConsensus ? "eingefärbt" : "ungefärbt"}. Unter {EARNINGS_LAMP_CONFIG.sueMinQuarters} Quartalen Totzone EPS ±{EARNINGS_LAMP_CONFIG.epsDeadZonePct} %, Umsatz ±{EARNINGS_LAMP_CONFIG.revenueDeadZonePct} %.
          </p>
        </div>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          <Lamp title="EPS" lamp={latest?.epsLamp ?? "na"} shown={latest?.epsShown ?? "kein Konsens"} sue={latest?.epsSue ?? null} />
          <Lamp title="Umsatz" lamp={latest?.revenueLamp ?? "na"} shown={latest?.revenueShown ?? "kein Konsens"} sue={latest?.revenueSue ?? null} />
        </div>
        {notice ? <p className="text-[10px] text-muted-foreground break-words">{notice}</p> : null}
        <div className="overflow-x-auto" data-testid="earnings-ampel-table-scroll">
          <table className="w-full text-xs">
            <thead className="hidden sm:table-header-group">
              <tr className="text-left text-[10px] uppercase text-muted-foreground">
                <th className="py-1 pr-2">Quartal</th>
                <th className="py-1 pr-2">Umsatz Ist</th>
                <th className="py-1 pr-2">Umsatz Konsens</th>
                <th className="py-1 pr-2">Umsatz</th>
                <th className="py-1 pr-2">EPS Ist</th>
                <th className="py-1 pr-2">EPS Konsens</th>
                <th className="py-1">EPS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.date} className="block sm:table-row border-t border-border/60" data-testid="earnings-ampel-row">
                  <td className="flex sm:table-cell justify-between py-0.5 sm:py-1.5 sm:pr-2 font-mono">{row.date}</td>
                  <Num label="Umsatz Ist" lamp={row.revenueLamp} text={cellText(row.revenueActual, row.revenueLamp, row.revenueShown)} />
                  <Num label="Umsatz Konsens" lamp={EARNINGS_LAMP_CONFIG.colorConsensus ? row.revenueLamp : "na"} text={num(row.revenueEstimate)} plain />
                  <Num label="Umsatz" lamp={row.revenueLamp} text={row.revenueShown} sue={row.revenueSue} />
                  <Num label="EPS Ist" lamp={row.epsLamp} text={cellText(row.epsActual, row.epsLamp, row.epsShown)} />
                  <Num label="EPS Konsens" lamp={EARNINGS_LAMP_CONFIG.colorConsensus ? row.epsLamp : "na"} text={num(row.epsEstimate)} plain />
                  <Num label="EPS" lamp={row.epsLamp} text={row.epsShown} sue={row.epsSue} />
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="text-xs text-muted-foreground pt-2">{notice || "n/a — keine Quartale"}</p> : null}
        </div>
      </div>
    </section>
  );
}

function cellText(value: number | null, lamp: EarningsLamp, shown: string): string {
  if (lamp === "na") return EARNINGS_LAMP_CONFIG.naText;
  return value == null ? EARNINGS_LAMP_CONFIG.naText : num(value);
}

function num(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return EARNINGS_LAMP_CONFIG.naText;
  return String(value).replace(".", ",");
}

function Lamp({ title, lamp, shown, sue }: { title: string; lamp: EarningsLamp; shown: string; sue: number | null }) {
  return (
    <div className="rounded-md border border-border p-3" data-testid={title === "EPS" ? "earnings-ampel-eps" : "earnings-ampel-revenue"}>
      <div className="text-[10px] uppercase text-muted-foreground">{title}</div>
      <div className="mt-1"><Swatch lamp={lamp} text={shown} sue={sue} /></div>
    </div>
  );
}

function Num({ label, lamp, text, sue, plain }: { label: string; lamp: EarningsLamp; text: string; sue?: number | null; plain?: boolean }) {
  const field = label.toLowerCase().replace(" ", "-");
  return (
    <td data-ampel-cell={field} data-lamp={plain ? "na" : lamp} className="flex sm:table-cell justify-between gap-2 py-0.5 sm:py-1.5 sm:pr-2">
      <span className="sm:hidden text-[10px] uppercase text-muted-foreground">{label}</span>
      <Swatch lamp={plain ? "na" : lamp} text={text} sue={sue} />
    </td>
  );
}

function Swatch({ lamp, text, sue }: { lamp: EarningsLamp; text: string; sue?: number | null }) {
  if (lamp === "na") return <span className="text-muted-foreground">{text}</span>;
  const paint = earningsLampPaint(lamp);
  const style = {
    ["--ampel-ink" as string]: paint.lightInk,
    ["--ampel-ink-dark" as string]: paint.darkInk,
    ["--ampel-wash" as string]: paint.lightWash,
    ["--ampel-wash-dark" as string]: paint.darkWash,
  } as CSSProperties;
  return (
    <span className="earnings-ampel-value inline-block rounded-sm px-1" style={style} title={sue != null ? `SUE ${sue.toFixed(2)}` : undefined}>
      {paint.symbol} {text}
    </span>
  );
}
