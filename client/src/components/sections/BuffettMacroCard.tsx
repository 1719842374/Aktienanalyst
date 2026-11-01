/**
 * Offen_WORK_BUFFETT_ASIA_10Y §1 — kompakte Makro-Karte unter Sektion 12.
 * Gleiche Quelle wie das Rezessions-Panel (GET /api/analyze-recession/buffett, US).
 * Nur Kontext, fließt in keinen Score ein.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { buffettZone, formatSigma } from "@shared/buffett-zone";

interface Latest { date: string; ratio: number; trend: number; premiumPct: number; zScore: number }
interface Payload { asOf: string | null; latest: Latest | null; fallback?: { source: string } | null }

const TONE: Record<string, string> = {
  red: "border-red-500/40 bg-red-500/10 text-red-500",
  orange: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-500",
};

export function BuffettMacroCard() {
  const q = useQuery({
    queryKey: ["recession-buffett", "US"],
    staleTime: 15 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const res = await fetch("/api/analyze-recession/buffett?region=US");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body?.reason ?? body?.error ?? `HTTP ${res.status}`));
      return body as Payload;
    },
  });
  const l = q.data?.latest ?? null;
  const zone = buffettZone(l?.zScore);
  const asOf = q.data?.asOf ? new Date(q.data.asOf + "T00:00:00").toLocaleDateString("de-DE") : null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3" data-testid="card-buffett-macro">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Makro-Kontext: Buffett-Indikator (US, Marktwert / BIP)</span>
        <span className="text-[9px] text-muted-foreground">kein Score-Einfluss</span>
      </div>
      {q.isLoading ? (
        <div className="text-[11px] text-muted-foreground">Lade…</div>
      ) : !l || !zone ? (
        <div className="text-[11px] text-muted-foreground" data-testid="buffett-macro-na">
          n/a{q.error ? ` — ${String((q.error as Error).message).slice(0, 160)}` : ""}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="buffett-macro-ok">
          <span className="font-mono text-lg font-bold tabular-nums">{Math.round(l.ratio)} %</span>
          <span className="text-[11px] text-muted-foreground">
            Trend {Math.round(l.trend)} % · Abweichung <b className="font-mono text-foreground">{formatSigma(l.zScore)}</b>
            {" "}({l.premiumPct >= 0 ? "+" : ""}{Math.round(l.premiumPct)} % zum Trend)
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE[zone.tone]}`} data-testid="buffett-macro-zone">
            {zone.label}
          </span>
          <span className="text-[9px] text-muted-foreground">
            Stand {asOf}{q.data?.fallback ? ` · Ersatzquelle ${q.data.fallback.source}` : ""} ·{" "}
            <Link href="/recession" className="underline">Verlauf</Link>
          </span>
        </div>
      )}
    </div>
  );
}
