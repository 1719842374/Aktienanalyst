import type { AssetConflictMatrix } from "@shared/asset-conflict-matrix";
import { ASSET_CONFLICT_NOTE } from "@shared/asset-conflict-matrix";
import { ConflictMatrixPanel } from "./ConflictMatrixPanel";
import { SummaryRow } from "./SummarySection";

/**
 * Konfliktmatrix plus Detail-Tabelle for BTC, Gold and Recession. Reuses the stock ConflictMatrixPanel and the
 * stock summary table rows (SummaryRow, Metric / Value / Assessment). Display only.
 */
export function AssetConflictSummary({ matrix }: { matrix: AssetConflictMatrix }) {
  return (
    <div className="space-y-3" data-testid="asset-conflict-summary">
      <ConflictMatrixPanel matrix={matrix} note={ASSET_CONFLICT_NOTE} />
      <div className="overflow-x-auto" data-testid="asset-conflict-table">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Metric</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value</th>
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Assessment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {matrix.cells.map(c => (
              <SummaryRow key={c.id} label={c.label} value={c.value} note={`${c.signal} · ${c.basis}`} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
