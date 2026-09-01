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

// Feste Palette aggressiv→defensiv, Reihenfolge exakt wie ETF_PROXY_MAP in
// server/sector-rotation-math.ts (Technologie..Versorger). Spec §3.2.
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

// Icon je Sektor fuer den 3D-Ring (Bild-Referenz: Icon direkt im Segment).
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

function fmtPct(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number | null, d = 1): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return x.toFixed(d);
}

// ─── 3D-Ring-Sektorradar (Bild-Referenz "Sektorrotations-Rat") ────────────
// Format 1:1 wie die Design-Vorlage: dicke Ring-Segmente mit isometrischem
// Tiefen-Effekt (Gradient hell->dunkel + Schatten-Boden-Ellipse), Icon +
// Label direkt im Segment. Reines SVG, keine neue Lib, Farben frei waehlbar
// (nicht 1:1 Board-Farben, aber gleiches raeumliches Format).
const RING_CENTER = 150;
const RING_OUTER = 130;
const RING_INNER = 78;
const RING_DEPTH = 14; // Extrusions-Tiefe (Boden-Versatz nach unten)
const GAP_DEG = 1.4; // kleiner Spalt zwischen Segmenten

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

  // Deckflaeche (Top-Face) — die eigentliche Ring-Kachel
  const top = [
    `M ${oStart.x} ${oStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x} ${oEnd.y}`,
    `L ${iEnd.x} ${iEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x} ${iStart.y}`,
    "Z",
  ].join(" ");

  // Aussenwand (Extrusion nach unten) — erzeugt den 3D-Tiefen-Eindruck nur
  // am unteren Aussenbogen, analog zur Board-Illustration.
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

        {/* Boden-Schatten-Ellipse fuer den isometrischen Eindruck */}
        <ellipse cx={RING_CENTER} cy={RING_CENTER + RING_DEPTH + 2} rx={RING_OUTER} ry={RING_OUTER * 0.34} fill="black" opacity={0.18} />

        {/* Aussenwaende zuerst (liegen "unter" den Deckflaechen) */}
        {sectors.map((s, i) => {
          const start = i * step;
          const end = start + step;
          const { wall } = ringSegmentPath(RING_CENTER, RING_CENTER, RING_OUTER, RING_INNER, start, end, RING_DEPTH);
          return <path key={`wall-${s.id}`} d={wall} fill={s.color} opacity={hoverId && hoverId !== s.id ? 0.25 : 0.55} />;
        })}

        {/* Deckflaechen (Top-Faces) mit Hover-Interaktion */}
        {sectors.map((s, i) => {
          const start = i * step;
          const end = start + step;
          const { top } = ringSegmentPath(RING_CENTER, RING_CENTER, RING_OUTER, RING_INNER, start, end, RING_DEPTH);
          return (
            <path
              key={`top-${s.id}`}
              d={top}
              fill={`url(#ring-grad-${s.id})`}
              stroke="var(--card)"
              strokeWidth={1.5}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHoverId(s.id)}
              onMouseLeave={() => setHoverId(null)}
              data-testid={`sector-radar-segment-${s.id}`}
            />
          );
        })}

        {/* Icon + Label je Segment (Bild-Referenz: Icon zentriert im Segment) */}
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

      {/* Zentrale Info: Hover-Detail oder neutraler Hinweis */}
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

  // P2: Donut-Segmente aus den bereits gelieferten Sektor-Zeilen -- kein
  // zweiter Score, keine Neuberechnung, nur Visualisierung der API-Werte.
  const donutData = useMemo(
    () => (data?.sectors || []).map(s => ({
      id: s.id,
      name: s.label,
      value: 1, // gleich große Segmente (9 feste Slices), Farbe traegt die Info
      risk: s.risk,
      valuation: s.valuation,
      attractiveness: s.attractiveness,
      phaseFit: s.phaseFit,
      color: SECTOR_COLORS[s.id] || FALLBACK_COLOR,
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
          {/* Block 2: Zykluseinordnung */}
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

          {/* Block 4: Sektorradar — 3D-Ring im Format der Design-Vorlage */}
          <div className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Sektorradar</div>
            <SectorRadarRing sectors={donutData} />
            <div className="flex items-center justify-between text-[9px] text-foreground/40 mt-1 px-1">
              <span>AGGRESSIV / ZYKLISCH</span>
              <span>DEFENSIV</span>
            </div>
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
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-left" data-testid="table-sector-rotation">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-foreground/40 border-b border-border/40">
                <th className="px-2 py-1.5 font-medium">Sektor</th>
                <th className="px-2 py-1.5 font-medium">ETF</th>
                <th className="px-2 py-1.5 font-medium">Risiko 1–5</th>
                <th className="px-2 py-1.5 font-medium">Bewertung</th>
                <th className="px-2 py-1.5 font-medium">Attraktivität</th>
                <th className="px-2 py-1.5 font-medium">6M</th>
                <th className="px-2 py-1.5 font-medium">Phase-Fit</th>
              </tr>
            </thead>
            <tbody>
              {(data.sectors || []).map(s => (
                <tr key={s.id} className="border-b border-border/20 text-[11px]">
                  <td className="px-2 py-1.5 font-medium text-foreground/90">{s.label}</td>
                  <td className="px-2 py-1.5 font-mono text-foreground/60">{s.etf}</td>
                  <td className="px-2 py-1.5 tabular-nums">{s.risk}</td>
                  <td className={`px-2 py-1.5 ${VAL_CLASS[s.valuation] || ""}`}>{s.valuation}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtNum(s.attractiveness, 1)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtPct(s.return6M)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{s.phaseFit}</td>
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
