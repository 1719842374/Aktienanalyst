/**
 * Executive Summary card — mounts above S1 (WORK_EXEC_SUMMARY.md).
 * KI an: data.growthThesis (S2) 1:1, kein Umformulieren.
 * Ampel: shared buildFazitSignal (identical to S17).
 */
import { useMemo } from "react";
import { SectionCard } from "@/components/SectionCard";
import type { StockAnalysis } from "../../../shared/schema";
import { buildFazitSignal, prepareFazitMetrics } from "@/lib/fazit-signal";

export type ExecSummaryView = {
  headline?: string;
  callLine?: string;
  porterLine?: string;
  pestelLine?: string;
  pro?: Array<{ text: string; src?: string }>;
  contra?: Array<{ text: string; src?: string }>;
  fazit?: { lage?: string; bruch?: string; handlung?: string };
  crvLine?: string;
  posLine?: string;
  crossLine?: string;
  thesisLine?: string;
  upsideLine?: string;
  riskLine?: string;
};

export function ExecSummaryCard({ data }: {
  data: StockAnalysis & {
    execSummary?: ExecSummaryView | null;
    growthThesis?: string | null;
    growthThesisGeneratedAt?: string | null;
  };
}) {
  const s = data?.execSummary;

  const fazit = useMemo(() => {
    if (!data) return null;
    try {
      const metrics = prepareFazitMetrics(data);
      return buildFazitSignal({ data, ...metrics });
    } catch {
      return null;
    }
  }, [data]);

  const downsideRisks = useMemo(() => {
    const risks = Array.isArray(data?.risks) ? [...data.risks] : [];
    return risks
      .map(r => ({
        name: r.name,
        ed: (r as any).expectedDamagePct ?? r.expectedDamage ?? 0,
      }))
      .filter(r => Number.isFinite(r.ed))
      .sort((a, b) => b.ed - a.ed)
      .slice(0, 3);
  }, [data?.risks]);

  if (!s || !fazit) return null;

  const thesis = (typeof data.growthThesis === "string" && data.growthThesis.trim().length >= 80)
    ? data.growthThesis.trim()
    : (typeof s.thesisLine === "string" && s.thesisLine.trim().length >= 80 ? s.thesisLine.trim() : "");

  return (
    <SectionCard number={0} title="Executive Summary" defaultOpen>
      <div className="space-y-3 text-sm" data-testid="exec-summary-card">
        <div className={`rounded-md border px-3 py-2 flex items-center justify-between gap-2 ${fazit.ratingBg}`}>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Ampel (S17)</span>
          <span className={`text-sm font-bold ${fazit.ratingColor}`} data-testid="exec-summary-ampel">{fazit.rating}</span>
        </div>

        {s.headline && (
          <p className="font-semibold text-foreground tracking-tight" data-testid="exec-summary-headline">
            {s.headline}
          </p>
        )}
        {s.upsideLine && (
          <p className="text-xs text-emerald-400/90 font-medium" data-testid="exec-summary-upside">{s.upsideLine}</p>
        )}
        {thesis ? (
          <div className="rounded-md border border-border/50 bg-muted/20 p-3" data-testid="exec-summary-thesis">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Investmentthese (S2, 1:1)
            </div>
            <p className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">{thesis}</p>
            {data.growthThesisGeneratedAt && (
              <div className="text-[10px] text-muted-foreground mt-2">
                Stand: {data.growthThesisGeneratedAt}
              </div>
            )}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Pro</div>
            <ul className="space-y-1 text-foreground/90">
              {(s.pro || []).map((l, i) => (
                <li key={`pro-${i}`} className="leading-snug flex items-start gap-1.5">
                  <span className="text-emerald-500 flex-shrink-0 mt-0.5">+</span>
                  <span>
                    {l.text}
                    {l.src ? <span className="text-muted-foreground"> · {l.src}</span> : null}
                  </span>
                </li>
              ))}
              {(s.pro || []).length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Contra</div>
            <ul className="space-y-1 text-foreground/90">
              {(s.contra || []).map((l, i) => (
                <li key={`contra-${i}`} className="leading-snug flex items-start gap-1.5">
                  <span className="text-red-500 flex-shrink-0 mt-0.5">{"\u2212"}</span>
                  <span>
                    {l.text}
                    {l.src ? <span className="text-muted-foreground"> · {l.src}</span> : null}
                  </span>
                </li>
              ))}
              {(s.contra || []).length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
        </div>

        {(downsideRisks.length > 0 || s.riskLine) && (
          <div data-testid="exec-summary-downside">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Was schiefgehen kann</div>
            {s.riskLine && <p className="text-xs text-foreground/85 mb-1">{s.riskLine}</p>}
            <ul className="space-y-0.5">
              {downsideRisks.map((r, i) => (
                <li key={`risk-${i}`} className="text-xs text-foreground/80 flex items-start gap-1.5">
                  <span className="text-red-500 flex-shrink-0 mt-0.5">{"\u2212"}</span>
                  <span>{r.name} · ED {r.ed.toFixed(2)} %</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={`rounded-lg border-2 p-3 ${fazit.ratingBg}`} data-testid="exec-summary-fazit-ampel">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Fazit / Ampel</div>
            <span className={`text-sm font-bold ${fazit.ratingColor}`}>{fazit.rating}</span>
          </div>
          {fazit.positive.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider mb-1">Positive Faktoren ({fazit.positive.length})</div>
              <ul className="space-y-0.5">
                {fazit.positive.map((p, i) => (
                  <li key={`fp-${i}`} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <span className="text-emerald-500 flex-shrink-0 mt-0.5">+</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fazit.negative.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">Negative Faktoren ({fazit.negative.length})</div>
              <ul className="space-y-0.5">
                {fazit.negative.map((n, i) => (
                  <li key={`fn-${i}`} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <span className="text-red-500 flex-shrink-0 mt-0.5">{"\u2212"}</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fazit.neutral.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Neutral ({fazit.neutral.length})</div>
              <ul className="space-y-0.5">
                {fazit.neutral.map((n, i) => (
                  <li key={`fneu-${i}`} className="text-xs text-foreground/60 flex items-start gap-1.5">
                    <span className="text-muted-foreground flex-shrink-0 mt-0.5">{"\u25cf"}</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="border-t border-border/30 pt-2 mt-1 text-[10px] text-muted-foreground">
            Signal-Score: {fazit.positive.length} positiv / {fazit.negative.length} negativ / {fazit.neutral.length} neutral = <span className={`font-semibold ${fazit.ratingColor}`}>{fazit.rating}</span>
          </div>
        </div>

        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Lage / Bruch / Handlung</div>
          {s.fazit?.lage && <p className="leading-relaxed text-foreground/90">{s.fazit.lage}</p>}
          {s.fazit?.bruch && <p className="leading-relaxed text-foreground/90">{s.fazit.bruch}</p>}
          {s.fazit?.handlung && <p className="leading-relaxed text-foreground/90">{s.fazit.handlung}</p>}
          {s.posLine && <p className="leading-relaxed text-foreground/90">{s.posLine}</p>}
          {s.crvLine && <p className="leading-relaxed text-foreground/90">{s.crvLine}</p>}
          {s.crossLine ? <p className="leading-relaxed text-foreground/90">{s.crossLine}</p> : null}
          {s.callLine && <p className="leading-relaxed text-muted-foreground">{s.callLine}</p>}
        </div>
        {(s.porterLine || s.pestelLine) && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            {s.porterLine && <div>{s.porterLine}</div>}
            {s.pestelLine && <div>{s.pestelLine}</div>}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
