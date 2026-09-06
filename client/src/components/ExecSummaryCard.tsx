/**
 * Executive Summary card — mounts above S1 (WORK_EXEC_SUMMARY.md DoD).
 * No second rating beside S17. Cross only when crossLine non-empty.
 */
import { SectionCard } from "@/components/SectionCard";

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
};

export function ExecSummaryCard({ data }: { data: { execSummary?: ExecSummaryView | null } }) {
  const s = data?.execSummary;
  if (!s) return null;

  return (
    <SectionCard number={0} title="Executive Summary" defaultOpen>
      <div className="space-y-3 text-sm" data-testid="exec-summary-card">
        {s.headline && (
          <p className="font-semibold text-foreground tracking-tight" data-testid="exec-summary-headline">
            {s.headline}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Pro</div>
            <ul className="space-y-1 text-foreground/90">
              {(s.pro || []).map((l, i) => (
                <li key={`pro-${i}`} className="leading-snug">
                  {l.text}
                  {l.src ? <span className="text-muted-foreground"> · {l.src}</span> : null}
                </li>
              ))}
              {(s.pro || []).length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Contra</div>
            <ul className="space-y-1 text-foreground/90">
              {(s.contra || []).map((l, i) => (
                <li key={`contra-${i}`} className="leading-snug">
                  {l.text}
                  {l.src ? <span className="text-muted-foreground"> · {l.src}</span> : null}
                </li>
              ))}
              {(s.contra || []).length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
        </div>
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Fazit</div>
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
