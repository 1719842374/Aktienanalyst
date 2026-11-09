import type { ConflictMatrixOf, ConflictSignal } from "../../lib/conflictMatrix";

const STYLE: Record<ConflictSignal, string> = {
  positiv: "bg-emerald-500/10 border-emerald-500/30 text-emerald-500",
  neutral: "bg-muted/30 border-border text-muted-foreground",
  negativ: "bg-red-500/10 border-red-500/30 text-red-500",
  "n/a": "bg-muted/10 border-border/50 text-muted-foreground/60",
};
const ICON: Record<ConflictSignal, string> = { positiv: "▲", neutral: "●", negativ: "▼", "n/a": "–" };

export const CONFLICT_MATRIX_NOTE = "Nur Darstellung: fünf Dimensionen nebeneinander, Divergenz explizit. Rating und Score im Fazit unverändert. n/a zählt nicht.";

/** Konfliktmatrix above the Fazit. Display only; the rating below is unchanged. `note` defaults to the stock text. */
export function ConflictMatrixPanel({ matrix, note = CONFLICT_MATRIX_NOTE }: { matrix: ConflictMatrixOf; note?: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-2" data-testid="conflict-matrix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Konfliktmatrix</h3>
        <span
          className={`text-[11px] font-semibold ${matrix.divergent ? "text-amber-500" : "text-muted-foreground"}`}
          data-testid="conflict-matrix-summary"
        >
          {matrix.divergent ? "⚠ " : ""}{matrix.summary}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {matrix.cells.map(c => (
          <div key={c.id} className={`rounded-md border p-2 ${STYLE[c.signal]}`} data-testid={`conflict-cell-${c.id}`} title={c.basis}>
            <div className="text-[10px] font-medium uppercase tracking-wider text-foreground/70">{c.label}</div>
            <div className="text-sm font-bold mt-0.5">{ICON[c.signal]} {c.signal}</div>
            <div className="text-[10px] font-mono tabular-nums text-foreground/70 mt-0.5">{c.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {note}
      </p>
    </div>
  );
}
