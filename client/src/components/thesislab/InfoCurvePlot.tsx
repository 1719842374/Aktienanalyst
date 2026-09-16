import type { Ampel, CurvePoint } from "@/lib/thesisLabTypes";

const STROKE: Record<Ampel, string> = {
  green: "#34d399",
  yellow: "#fbbf24",
  red: "#f43f5e",
  gray: "#94a3b8",
};

export function InfoCurvePlot({
  points,
  ampel,
  height = 168,
}: {
  points: CurvePoint[];
  ampel: Ampel;
  height?: number;
}) {
  const w = 560;
  const h = height;
  const pad = { l: 36, r: 12, t: 14, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  if (!points.length) return null;

  const x = (i: number) => pad.l + (innerW * i) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + innerH * (1 - v / 100);

  const line = (key: "pricedInPct" | "attention") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Informationskurve">
      <rect x={0} y={0} width={w} height={h} fill="transparent" />
      {[0, 25, 50, 70, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} stroke="rgba(148,163,184,0.18)" />
          <text x={4} y={y(g) + 3} fill="#64748b" fontSize="9">
            {g}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={w - pad.r} y1={y(70)} y2={y(70)} stroke="#f43f5e" strokeDasharray="3 3" strokeOpacity={0.5} />
      <line x1={pad.l} x2={w - pad.r} y1={y(40)} y2={y(40)} stroke="#34d399" strokeDasharray="3 3" strokeOpacity={0.45} />
      <path d={line("attention")} fill="none" stroke="#38bdf8" strokeWidth={1.6} strokeDasharray="4 3" />
      <path d={line("pricedInPct")} fill="none" stroke={STROKE[ampel]} strokeWidth={2.4} />
      {points.map((p, i) => (
        <g key={p.t}>
          <circle cx={x(i)} cy={y(p.pricedInPct)} r={3.2} fill={STROKE[ampel]} />
          <text x={x(i)} y={h - 8} textAnchor="middle" fill="#94a3b8" fontSize="9">
            {p.t}
          </text>
        </g>
      ))}
      <text x={pad.l} y={12} fill={STROKE[ampel]} fontSize="10">
        Einpreisung %
      </text>
      <text x={pad.l + 92} y={12} fill="#38bdf8" fontSize="10">
        Aufmerksamkeit
      </text>
    </svg>
  );
}
