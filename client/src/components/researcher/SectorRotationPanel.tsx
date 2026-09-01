/**
 * SectorRotationPanel — Sprint C1 P0-P3.
 * Spec WORK_SEKTORROTATIONS_RAT.md §3.3 alle 4 Bloecke + §6 Quellenzeile.
 * P0/P1 (Engine/Route/Tabelle) siehe Commit 9aa6f9a.
 * P2 (Sektorradar-Donut) + P3 (Zyklus-Ring + 4 Empfehlungskarten) hier ergaenzt
 * -- rein additiv im Client, KEIN neues API-Feld (Response deckt §3.4 bereits
 * vollstaendig ab: risk/valuation/attractiveness/phaseFit/pe/pe10y/return6M/
 * phase/phaseConfidence/recommendations/dataQuality). Server/Engine unveraendert.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Loader2, RefreshCw,
  Monitor, Radio, ShoppingBag, Factory, Landmark, Fuel, HeartPulse, ShoppingCart, Plug,
} from "lucide-react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { apiRequest } from "@/lib/queryClient";

type Valuation = "Teuer" | "Angemessen" | "Attraktiv" | "n.v.";
type CyclePhase = "Frühzyklus" | "Hochkonjunktur" | "Spätkonjunktur" | "Abschwung";

interface SectorRow {
  id: string;
  label: string;
  etf: string;
  risk: 1 | 2 | 3 | 4 | 5;
  valuation: Valuation;
  pe: number | null;
  pe10y: number | null;
  attractiveness: number;
  return6M: number | null;
  phaseFit: number;
}

interface SectorRotationPayload {
  asOf: string;
  phase: CyclePhase;
  phaseConfidence: number;
  sectors: SectorRow[];
  recommendations?: Record<CyclePhase, string[]>;
  dataQuality?: { etfCoverage: number; pe10yCoverage: number; source: string };
  _cached?: boolean;
  _cacheAge?: number;
}

const VAL_CLASS: Record<string, string> = {
  Teuer: "text-rose-300",
  Angemessen: "text-amber-300",
  Attraktiv: "text-emerald-300",
  "n.v.": "text-foreground/40",
};

const SECTOR_COLORS: Record<string, string> = {
  technology: "#e11d48",
  communication: "#f43f5e",
  discretionary: "#f97316",
  industrials: "#f59e0b",
  financials: "#eab308",
  energy: "#84cc16",
  healthcare: "#22c55e",
  staples: "#14b8a6",
  utilities: "#3b82f6",
};
const FALLBACK_COLOR = "#64748b";

const SECTOR_ICONS: Record<string, typeof Monitor> = {
  technology: Monitor,
  communication: Radio,
  discretionary: ShoppingBag,
  industrials: Factory,
  financials: Landmark,
  energy: Fuel,
  healthcare: HeartPulse,
  staples: ShoppingCart,
  utilities: Plug,
};

const PHASE_ORDER: CyclePhase[] = ["Frühzyklus", "Hochkonjunktur", "Spätkonjunktur", "Abschwung"];
const PHASE_DESCRIPTION: Record<CyclePhase, string> = {
  Frühzyklus: "Erholung nach Rezession — Wachstumserwartungen, Investitionen und Risikobereitschaft steigen.",
  Hochkonjunktur: "Expansion & starkes Wachstum — Gewinne breit hoch, Zinsen moderat steigend, Bewertungen teurer.",
  Spätkonjunktur: "Abschwächung & Unsicherheit — Gewinnwachstum verlangsamt, Inflation/Zinsen hoch.",
  Abschwung: "Rezession / Kontraktion — Nachfrage & Gewinne fallen, Risikoaversion steigt.",
};

const PHASE_BAR_COLORS: Record<CyclePhase, string> = {
  Frühzyklus: "#22c55e",
  Hochkonjunktur: "#eab308",
  Spätkonjunktur: "#f97316",
  Abschwung: "#ef4444",
};

function phaseFitFillPct(phaseFit: number): number {
  return clampPct(((phaseFit - 1) / 4) * 100);
}

function clampPct(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

function SectorCycleProgressBar({
  phase,
  phaseFit,
  compact = false,
}: {
  phase: CyclePhase;
  phaseFit?: number;
  compact?: boolean;
}) {
  const activeIdx = PHASE_ORDER.indexOf(phase);
  const segW = 100 / PHASE_ORDER.length;
  const hasFit = phaseFit != null && Number.isFinite(phaseFit);
  const fitIsGood = hasFit ? phaseFit! >= 3 : true;
  const markerIdx = hasFit && !fitIsGood && activeIdx >= 0
    ? (activeIdx + Math.floor(PHASE_ORDER.length / 2)) % PHASE_ORDER.length
    : activeIdx;
  const markerLeftPct = markerIdx >= 0 ? markerIdx * segW + segW / 2 : 0;
  const markerColorClass = !hasFit || fitIsGood ? "bg-primary" : "bg-foreground/40";
  const markerTitle = hasFit
    ? `Phase-Fit ${phaseFit} -- ${fitIsGood ? "passt zur aktuellen Phase" : "passt NICHT zur aktuellen Phase"} (${phase})`
    : `Aktuelle Phase: ${phase}`;

  return (
    <div className="w-full" data-testid="bar-cycle-progress">
      {compact ? (
      <div className="relative h-4 px-1.5 overflow-x-hidden">
        <div className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-3 flex rounded-full overflow-hidden">
        {PHASE_ORDER.map(p => (
          <div
            key={p}
            className="h-full"
            style={{ width: `${segW}%`, backgroundColor: PHASE_BAR_COLORS[p], opacity: p === phase ? 1 : 0.35 }}
          />
        ))}
        </div>
        <div
          className={`absolute top-1/2 w-2 h-2 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 ${markerColorClass}`}
          style={{ left: `clamp(6px, ${markerLeftPct}%, calc(100% - 6px))` }}
          title={markerTitle}
          data-testid="marker-cycle-current-phase"
        />
      </div>
      ) : (
      <div className="relative h-2 rounded-full overflow-hidden flex">
        {PHASE_ORDER.map(p => (
          <div
            key={p}
            className="h-full"
            style={{ width: `${segW}%`, backgroundColor: PHASE_BAR_COLORS[p], opacity: p === phase ? 1 : 0.35 }}
          />
        ))}
        <div
          className={`absolute -top-1 w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 ${markerColorClass}`}
          style={{ left: `${markerLeftPct}%` }}
          title={markerTitle}
          data-testid="marker-cycle-current-phase"
        />
      </div>
      )}
      {hasFit && (
        <div className={`mt-0.5 text-[8px] leading-tight ${fitIsGood ? "text-emerald-400/80" : "text-foreground/40"}`}>
          {fitIsGood ? "passt zur Phase" : "passt nicht"}
        </div>
      )}
      {!compact && (
        <div className="flex justify-between mt-1">
          {PHASE_ORDER.map(p => (
            <span
              key={p}
              className={`text-[8px] leading-tight ${p === phase ? "text-foreground/80 font-semibold" : "text-foreground/30"}`}
              style={{ width: `${segW}%` }}
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtPct(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number | null, d = 1): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return x.toFixed(d);
}

const RING_CENTER = 150;
const RING_OUTER = 130;
const RING_INNER = 78;
const RING_DEPTH = 14;
const GAP_DEG = 1.4;

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function ringSegmentPath(
  cx: number, cy: number, rOuter: number, rInner: number,
  startDeg: number, endDeg: number, depth: number
): { top: string; wall: string } {
  const s = startDeg + GAP_DEG / 2;
  const e = endDeg - GAP_DEG / 2;
  const largeArc = e - s > 180 ? 1 : 0;
  const oStart = polar(cx, cy, rOuter, s);
  const oEnd = polar(cx, cy, rOuter, e);
  const iStart = polar(cx, cy, rInner, s);
  const iEnd = polar(cx, cy, rInner, e);
  const top = [
    `M ${oStart.x} ${oStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x} ${oEnd.y}`,
    `L ${iEnd.x} ${iEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x} ${iStart.y}`,
    "Z",
  ].join(" ");
  const oStartD = { x: oStart.x, y: oStart.y + depth };
  const oEndD = { x: oEnd.x, y: oEnd.y + depth };
  const wall = [
    `M ${oStart.x} ${oStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x} ${oEnd.y}`,
    `L ${oEndD.x} ${oEndD.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${oStartD.x} ${oStartD.y}`,
    "Z",
  ].join(" ");
  return { top, wall };
}

interface RingSectorDatum {
  id: string;
  name: string;
  color: string;
  risk: number;
  valuation: string;
  attractiveness: number;
  phaseFit: number;
}

const RADAR_AXES = [
  "Wachstumspotenzial",
  "Zyklussensitivit\u00e4t",
  "Bewertung",
  "Risiko",
  "Defensivit\u00e4t",
] as const;

type RadarCategory = "AGGRESSIV" | "ZYKLISCH" | "DEFENSIV";
const CATEGORY_COLORS: Record<RadarCategory, string> = {
  AGGRESSIV: "#e11d48",
  ZYKLISCH: "#eab308",
  DEFENSIV: "#22c55e",
};

const VALUATION_SCORE: Record<string, number> = {
  Attraktiv: 100,
  Angemessen: 60,
  Teuer: 20,
  "n.v.": 50,
};

export interface RadarSectorDatum {
  id: string;
  name: string;
  risk: number;
  valuation: string;
  return6M: number | null;
  phaseFit: number;
  category: RadarCategory;
}

function categoryFromRisk(risk: number): RadarCategory {
  if (risk >= 4) return "AGGRESSIV";
  if (risk <= 2) return "DEFENSIV";
  return "ZYKLISCH";
}

function sectorToRadarAxisValues(s: RadarSectorDatum): Record<(typeof RADAR_AXES)[number], number> {
  const riskPct = clampPct(((s.risk - 1) / 4) * 100);
  return {
    Wachstumspotenzial: clampPct(50 + (s.return6M ?? 0) * 100),
    "Zyklussensitivit\u00e4t": riskPct,
    Bewertung: VALUATION_SCORE[s.valuation] ?? 50,
    Risiko: riskPct,
    "Defensivit\u00e4t": clampPct(100 - riskPct),
  };
}

function buildRadarChartData(sectors: RadarSectorDatum[]): Array<Record<string, number | string>> {
  const byCategory: Record<RadarCategory, RadarSectorDatum[]> = { AGGRESSIV: [], ZYKLISCH: [], DEFENSIV: [] };
  for (const s of sectors) byCategory[s.category].push(s);
  return RADAR_AXES.map(axis => {
    const row: Record<string, number | string> = { axis };
    (Object.keys(byCategory) as RadarCategory[]).forEach(cat => {
      const list = byCategory[cat];
      row[`__names__${cat}`] = list.map(s => s.name).join(", ") || "\u2014";
      if (list.length === 0) { row[cat] = 0; return; }
      const avg = list.reduce((sum, s) => sum + sectorToRadarAxisValues(s)[axis], 0) / list.length;
      row[cat] = Math.round(avg * 10) / 10;
    });
    return row;
  });
}

function RadarTooltipContent({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border/60 bg-card px-2.5 py-2 text-[10px] shadow-lg">
      <div className="font-semibold text-foreground/80 mb-1">{label}</div>
      {payload.map((entry: any) => {
        const cat = entry.dataKey as RadarCategory;
        const names = entry.payload?.[`__names__${cat}`];
        return (
          <div key={cat} className="mb-0.5">
            <span style={{ color: entry.color }} className="font-medium">{cat}</span>
            <span className="text-foreground/60"> {fmtNum(entry.value, 1)}</span>
            {names && <div className="text-foreground/40 text-[9px]">{names}</div>}
          </div>
        );
      })}
    </div>
  );
}

function SectorRadar2D({ sectors }: { sectors: RadarSectorDatum[] }) {
  const chartData = useMemo(() => buildRadarChartData(sectors), [sectors]);
  const categoryCounts = useMemo(() => {
    const counts: Record<RadarCategory, number> = { AGGRESSIV: 0, ZYKLISCH: 0, DEFENSIV: 0 };
    sectors.forEach(s => { counts[s.category] += 1; });
    return counts;
  }, [sectors]);
  return (
    <div data-testid="chart-sector-radar-2d">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="70%">
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9, fill: "hsl(var(--foreground))", opacity: 0.85 }} />
            {(Object.keys(CATEGORY_COLORS) as RadarCategory[]).map(cat => (
              <Radar
                key={cat}
                name={`${cat} (${categoryCounts[cat]})`}
                dataKey={cat}
                stroke={CATEGORY_COLORS[cat]}
                fill={CATEGORY_COLORS[cat]}
                fillOpacity={0.18}
                strokeWidth={1.5}
              />
            ))}
            <Tooltip content={<RadarTooltipContent />} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SectorRadarRing({ sectors }: { sectors: RingSectorDatum[] }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const n = sectors.length;
  const step = n > 0 ? 360 / n : 0;
  const hoverDatum = sectors.find(s => s.id === hoverId) || null;
  const midAngleFor = (i: number) => i * step + step / 2;
  return (
    <div className="relative" data-testid="chart-sector-radar-donut">
      <svg viewBox="0 0 300 300" className="w-full h-auto max-h-[260px]">
        <defs>
          {sectors.map(s => (
            <linearGradient key={s.id} id={`ring-grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={hoverId && hoverId !== s.id ? 0.35 : 1} />
              <stop offset="100%" stopColor={s.color} stopOpacity={hoverId && hoverId !== s.id ? 0.2 : 0.75} />
            </linearGradient>
          ))}
        </defs>
        <ellipse cx={RING_CENTER} cy={RING_CENTER + RING_DEPTH + 2} rx={RING_OUTER} ry={RING_OUTER * 0.34} fill="black" opacity={0.18} />
        {sectors.map((s, i) => {
          const start = i * step;
          const end = start + step;
          const { wall } = ringSegmentPath(RING_CENTER, RING_CENTER, RING_OUTER, RING_INNER, start, end, RING_DEPTH);
          return <path key={`wall-${s.id}`} d={wall} fill={s.color} opacity={hoverId && hoverId !== s.id ? 0.25 : 0.55} />;
        })}
        {sectors.map((s, i) => {
          const start = i * step;
          const end = start + step;
          const { top } = ringSegmentPath(RING_CENTER, RING_CENTER, RING_OUTER, RING_INNER, start, end, RING_DEPTH);
          return (
            <path
              key={`top-${s.id}`}
              d={top}
              fill={`url(#ring-grad-${s.id})`}
              stroke="hsl(var(--card))"
              strokeWidth={1.5}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHoverId(s.id)}
              onMouseLeave={() => setHoverId(null)}
              data-testid={`sector-radar-segment-${s.id}`}
            />
          );
        })}
        {sectors.map((s, i) => {
          const mid = midAngleFor(i);
          const iconR = (RING_OUTER + RING_INNER) / 2;
          const pos = polar(RING_CENTER, RING_CENTER, iconR, mid);
          const Icon = SECTOR_ICONS[s.id];
          return (
            <g key={`label-${s.id}`} opacity={hoverId && hoverId !== s.id ? 0.45 : 1} className="pointer-events-none">
              {Icon && (
                <foreignObject x={pos.x - 9} y={pos.y - 9} width={18} height={18}>
                  <Icon className="w-[18px] h-[18px] text-white drop-shadow-sm" strokeWidth={2} />
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center px-4">
          {hoverDatum ? (
            <>
              <div className="text-[11px] font-semibold text-foreground/90">{hoverDatum.name}</div>
              <div className="text-[9px] text-foreground/60 mt-0.5">Risiko {hoverDatum.risk} · {hoverDatum.valuation}</div>
              <div className="text-[9px] text-foreground/60">Attr. {fmtNum(hoverDatum.attractiveness, 1)} · Fit {hoverDatum.phaseFit}</div>
            </>
          ) : (
            <div className="text-[9px] text-foreground/40 uppercase tracking-wider">Sektorradar</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SectorRotationPanel() {
  const [data, setData] = useState<SectorRotationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await apiRequest("GET", `/api/researcher/sector-rotation${q}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Sektorrotation fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(false); }, []);

  const dq = data?.dataQuality;
  const peGap = (dq?.pe10yCoverage ?? 9) < 9;

  const donutData = useMemo(
    () => (data?.sectors || []).map(s => ({
      id: s.id,
      name: s.label,
      value: 1,
      risk: s.risk,
      valuation: s.valuation,
      attractiveness: s.attractiveness,
      phaseFit: s.phaseFit,
      color: SECTOR_COLORS[s.id] || FALLBACK_COLOR,
    })),
    [data]
  );

  const radarSectorData: RadarSectorDatum[] = useMemo(
    () => (data?.sectors || []).map(s => ({
      id: s.id,
      name: s.label,
      risk: s.risk,
      valuation: s.valuation,
      return6M: s.return6M,
      phaseFit: s.phaseFit,
      category: categoryFromRisk(s.risk),
    })),
    [data]
  );

  const recommendations = data?.recommendations;
  const activePhase = data?.phase;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-foreground/80">Sektorrotation — Risiko & Bewertung</div>
          {data && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              Phase {data.phase} · Konfidenz {Math.round((data.phaseConfidence || 0) * 100)}%
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1"
          data-testid="button-refresh-sector-rotation"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Aktualisieren
        </button>
      </div>

      {peGap && data && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-200/90">
            PE-10J unvollständig ({dq?.pe10yCoverage}/9). Fehlende Werte → Fallback-Label, pe10yCoverage sinkt.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-300">{error}</div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-10 text-[11px] text-foreground/50 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Lade ETF-Proxies…
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Zykluseinordnung</div>
            <div className="space-y-1.5">
              {PHASE_ORDER.map(p => {
                const isActive = p === activePhase;
                return (
                  <div
                    key={p}
                    className={`rounded-md border p-2 transition-colors ${
                      isActive
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/30 bg-transparent opacity-50"
                    }`}
                    data-testid={`cycle-phase-${p}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-semibold ${isActive ? "text-primary" : "text-foreground/70"}`}>
                        {p}
                      </span>
                      {isActive && (
                        <span className="text-[10px] text-primary/80 font-mono">
                          {Math.round((data.phaseConfidence || 0) * 100)}%
                        </span>
                      )}
                    </div>
                    {isActive && (
                      <p className="text-[10px] text-foreground/60 mt-1 leading-relaxed">{PHASE_DESCRIPTION[p]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border/40 bg-card/30 p-3 lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">Sektorradar — 2D & 3D</div>
              {data && (
                <div className="text-[9px] text-foreground/40">Zyklusposition: {data.phase}</div>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1">2D-Radar (5 Achsen)</div>
                <SectorRadar2D sectors={radarSectorData} />
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1">3D-Ring</div>
                <SectorRadarRing sectors={donutData} />
                <div className="flex items-center justify-between text-[9px] text-foreground/40 mt-1 px-1">
                  <span>AGGRESSIV / ZYKLISCH</span>
                  <span>DEFENSIV</span>
                </div>
              </div>
            </div>
            {data && (
              <div className="mt-3 pt-3 border-t border-border/30" data-testid="cycle-progress-ring-block">
                <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1.5">Zyklusfortschritt (Gesamt)</div>
                <SectorCycleProgressBar phase={data.phase} />
              </div>
            )}
          </div>
        </div>
      )}

      {data && recommendations && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Explizite Empfehlung nach Phase</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {PHASE_ORDER.map(p => {
              const isActive = p === activePhase;
              const picks = recommendations[p] || [];
              return (
                <div
                  key={p}
                  className={`rounded-lg border p-2.5 ${
                    isActive ? "border-primary/50 bg-primary/10" : "border-border/30 bg-card/20"
                  }`}
                  data-testid={`recommendation-card-${p}`}
                >
                  <div className={`text-[10px] font-semibold ${isActive ? "text-primary" : "text-foreground/70"}`}>
                    {p}{isActive && " · aktuell"}
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {picks.map(label => (
                      <li key={label} className="text-[10px] text-foreground/60 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0" />
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && (
        <div>
        <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Risiko & Bewertung</div>
        <div className="overflow-x-auto rounded-lg border border-border/40 p-1">
          <table className="w-full text-left border-separate border-spacing-0" data-testid="table-sector-rotation">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-foreground/40 border-b border-border/40">
                <th className="px-3 py-2.5 font-medium">Sektor</th>
                <th className="px-3 py-2.5 font-medium">ETF</th>
                <th className="px-3 py-2.5 font-medium">Risiko 1–5</th>
                <th className="px-3 py-2.5 font-medium">Bewertung</th>
                <th className="px-3 py-2.5 font-medium">Attraktivität</th>
                <th className="px-3 py-2.5 font-medium">6M</th>
                <th className="px-3 py-2.5 font-medium">Phase-Fit</th>
                <th className="px-3 py-2.5 font-medium">Zyklusfortschritt</th>
              </tr>
            </thead>
            <tbody>
              {(data.sectors || []).map(s => (
                <tr key={s.id} className="border-b border-border/20 text-[11px]">
                  <td className="px-3 py-3 font-medium text-foreground/90">{s.label}</td>
                  <td className="px-3 py-3 font-mono text-foreground/60">{s.etf}</td>
                  <td className="px-3 py-3 tabular-nums">{s.risk}</td>
                  <td className={`px-3 py-3 ${VAL_CLASS[s.valuation] || ""}`}>{s.valuation}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtNum(s.attractiveness, 1)}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtPct(s.return6M)}</td>
                  <td className="px-3 py-3 tabular-nums">{s.phaseFit}</td>
                  <td className="px-3 py-3 min-w-[160px] overflow-x-hidden" data-testid={`cycle-progress-row-${s.id}`}>
                    {data && <SectorCycleProgressBar phase={data.phase} phaseFit={s.phaseFit} compact />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {data && (
        <div className="text-[10px] text-foreground/40" data-testid="text-sector-rotation-source">
          FMP + ETF-Proxies · Stand {data.asOf}
        </div>
      )}
    </div>
  );
}
