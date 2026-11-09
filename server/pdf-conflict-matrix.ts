/**
 * Konfliktmatrix block for the PDF export (server/pdf-export.ts), placed above the FAZIT box like the UI.
 * Rules come from shared/conflict-matrix.ts (same as SummarySection). Display only, no score impact.
 */
import { conflictMatrixFromAnalysis, type ConflictMatrix, type ConflictSignal } from "../shared/conflict-matrix";

const COLOR: Record<ConflictSignal, string> = { positiv: "#22c55e", neutral: "#9ca3af", negativ: "#ef4444", "n/a": "#6b7280" };
const ICON: Record<ConflictSignal, string> = { positiv: "▲", neutral: "●", negativ: "▼", "n/a": "–" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderConflictMatrixHtml(m: ConflictMatrix): string {
  const cells = m.cells.map(c => `<td style="width:20%;vertical-align:top;border:1px solid ${COLOR[c.signal]}55;padding:4px">
  <div style="font-size:7px;color:#9aa3b5;text-transform:uppercase">${esc(c.label)}</div>
  <div style="font-size:9px;font-weight:700;color:${COLOR[c.signal]}">${ICON[c.signal]} ${c.signal}</div>
  <div style="font-size:7.5px;color:#c0c5d5">${esc(c.value)}</div>
</td>`).join("");
  const line = `${m.divergent ? "⚠ " : ""}${esc(m.summary)}`;
  return `<!-- KONFLIKTMATRIX (shared/conflict-matrix.ts) -->
<div class="sub">Konfliktmatrix</div>
<table data-testid="pdf-conflict-matrix"><tr>${cells}</tr></table>
<div class="row" data-testid="pdf-conflict-divergence"><span class="row-label">Divergenz</span><span class="row-val" style="color:${m.divergent ? "#f59e0b" : "#9aa3b5"}">${line}</span></div>
<div class="para" style="font-size:7px;color:#7a8296">Nur Darstellung, Fazit-Rating unverändert. n/a zählt nicht.</div>
`;
}

export function conflictMatrixHtmlForAnalysis(data: unknown): string {
  try {
    return renderConflictMatrixHtml(conflictMatrixFromAnalysis(data));
  } catch {
    return "";
  }
}
