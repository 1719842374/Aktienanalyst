import type { SankeyModel } from "@shared/statement-sankey";

/**
 * Zweite Ansicht zu den Abschlüssen: Zu- und Abflüsse als Balken.
 * Breite folgt dem Betrag. 375 px scrollt horizontal, 1440 px nutzt die Breite.
 */
export function StatementSankey({ model }: { model: SankeyModel }) {
  const max = model.links.reduce((m, l) => Math.max(m, l.value), 0);
  return (
    <div className="min-w-0" data-testid="statement-sankey">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{model.title}</div>
      {model.links.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">{model.notes[0] ?? "n/a — keine Flüsse"}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[320px] space-y-1">
            {model.links.map(link => (
              <div key={`${link.source}->${link.target}`} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-2 text-[10px]">
                <span className="truncate" title={link.source}>{link.source}</span>
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${max > 0 ? (link.value / max) * 100 : 0}%` }} />
                </div>
                <span className="truncate text-right" title={link.target}>{link.target}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {model.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {model.notes.map(n => <li key={n} className="text-[9px] text-muted-foreground">{n}</li>)}
        </ul>
      )}
    </div>
  );
}
