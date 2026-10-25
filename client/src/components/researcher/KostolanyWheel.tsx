/**
 * KostolanyWheel — FW-04 (reine Anzeige). Zeigt das Server-Zusatzfeld `kostolany`
 * aus /api/researcher/sector-rotation. Keine eigene Berechnung, kein Einfluss auf
 * Sektor-Score/Empfehlungen. Fehlende Daten → n/a. Schwellen = Vorschlag (shared/kostolany.ts).
 */
import {
  KOSTOLANY_ORDER, KOSTOLANY_PHASES, KOSTOLANY_THRESHOLDS,
  type KostolanyPhase, type KostolanyResult,
} from "../../../../shared/kostolany";

// Ei-Anordnung: A-Phasen links aufsteigend, B-Phasen rechts absteigend (0° = oben, im Uhrzeigersinn).
const PHASE_ANGLE: Record<KostolanyPhase, number> = { B1: 30, B2: 90, B3: 150, A1: 210, A2: 270, A3: 330 };
const PHASE_COLOR: Record<KostolanyPhase, string> = {
  A1: "#22c55e", A2: "#84cc16", A3: "#f59e0b", B1: "#f97316", B2: "#ef4444", B3: "#0ea5e9",
};
const C = 110, RO = 96, RI = 58;

function pt(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}
function seg(deg: number): string {
  const s = deg - 29, e = deg + 29;
  const o1 = pt(RO, s), o2 = pt(RO, e), i2 = pt(RI, e), i1 = pt(RI, s);
  return `M ${o1.x} ${o1.y} A ${RO} ${RO} 0 0 1 ${o2.x} ${o2.y} L ${i2.x} ${i2.y} A ${RI} ${RI} 0 0 0 ${i1.x} ${i1.y} Z`;
}
const na = (v: number | null | undefined, d = 2, suf = "") =>
  v == null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(d)}${suf}`;
const sgn = (v: number | null | undefined, d = 2, suf = "") =>
  v == null || !Number.isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}${suf}`;

export function KostolanyWheel({ data }: { data: KostolanyResult | null | undefined }) {
  const k = data ?? null;
  const phase = k?.phase ?? null;
  const info = phase ? KOSTOLANY_PHASES[phase] : null;
  const inp = k?.inputs;
  const T = KOSTOLANY_THRESHOLDS;

  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4" data-testid="kostolany-wheel">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-foreground/40">Kostolany-Rad (Zinsen × Kurstrend)</div>
        <div className="text-[9px] text-foreground/40">nur Anzeige</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-4 items-center">
        <svg viewBox="0 0 220 220" className="w-full max-w-[220px] mx-auto h-auto">
          {KOSTOLANY_ORDER.map(p => {
            const active = p === phase;
            const lp = pt((RO + RI) / 2, PHASE_ANGLE[p]);
            return (
              <g key={p} data-testid={`kostolany-seg-${p}`}>
                <path d={seg(PHASE_ANGLE[p])} fill={PHASE_COLOR[p]} opacity={active ? 1 : 0.22}
                  stroke={active ? "white" : "none"} strokeWidth={active ? 2 : 0} />
                <text x={lp.x} y={lp.y + 4} textAnchor="middle" fontSize="12" fontWeight={active ? 700 : 500}
                  fill="white" opacity={active ? 1 : 0.7}>{p}</text>
              </g>
            );
          })}
          <text x={C} y={C - 4} textAnchor="middle" fontSize="11" fill="hsl(var(--foreground))" opacity={0.85}
            data-testid="kostolany-phase">{phase ?? "n/a"}</text>
          <text x={C} y={C + 12} textAnchor="middle" fontSize="8" fill="hsl(var(--foreground))" opacity={0.5}>
            {info ? info.action : "keine Daten"}
          </text>
        </svg>
        <div className="space-y-2 text-[11px]">
          <div>
            <div className="font-semibold text-foreground/85" data-testid="kostolany-phase-name">
              {info ? info.name : "Phase n/a"}
            </div>
            <div className="text-foreground/60 text-[10px] mt-0.5">
              {info ? `${info.text} Lesart: ${info.action} · Stil ${info.style}.` : "Zins- oder Kursreihe nicht verfügbar."}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
            <span className="text-foreground/45">Zinstrend</span>
            <span data-testid="kostolany-rate-trend">{k?.rateTrend ?? "n/a"}</span>
            <span className="text-foreground/45">Leitzins ({inp?.policySeries ?? "FEDFUNDS"})</span>
            <span>{na(inp?.policyLast, 2, " %")} · Δ6M {sgn(inp?.policyDelta, 2, " pp")}</span>
            <span className="text-foreground/45">10J (DGS10)</span>
            <span>{na(inp?.dgs10Last, 2, " %")} · Δ6M {sgn(inp?.dgs10Delta, 2, " pp")}</span>
            <span className="text-foreground/45">Kurstrend</span>
            <span data-testid="kostolany-price-trend">{k?.priceTrend ?? "n/a"}</span>
            <span className="text-foreground/45">S&amp;P 500 vs SMA200</span>
            <span>{na(inp?.priceLast, 0)} / {na(inp?.sma200, 0)} · {sgn(inp?.priceVsSma != null ? inp.priceVsSma * 100 : null, 1, " %")}</span>
          </div>
          {k?.notes && k.notes.length > 0 && (
            <div className="text-[9px] text-amber-300/80">{k.notes.join(" · ")}</div>
          )}
          <div className="text-[9px] text-foreground/40 leading-relaxed" data-testid="kostolany-source">
            Quelle: {inp?.priceSource ?? "Kurs n/a"} · FRED {inp?.policySeries ?? "Leitzins n/a"} ({inp?.policyDate ?? "n/a"}), DGS10 ({inp?.dgs10Date ?? "n/a"}) ·
            Schwellen (Vorschlag): Zins Δ6M ±{T.policyRateDeltaPp} pp (DGS10-Tie-Break ±{T.dgs10DeltaPp}), Kurs vs SMA{T.smaDays} ±{T.priceTrendPct * 100} % / stark ±{T.priceStrongPct * 100} %.
          </div>
        </div>
      </div>
    </div>
  );
}
