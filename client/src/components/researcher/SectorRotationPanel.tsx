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
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip as PieTooltip, ResponsiveContainer } from "recharts";
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

          {/* Block 4: Sektorradar (Donut) */}
          <div className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Sektorradar</div>
            <div className="h-[220px]" data-testid="chart-sector-radar-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    {donutData.map(d => <Cell key={d.id} fill={d.color} />)}
                  </Pie>
                  <PieTooltip
                    content={({ payload }) => {
                      const d = payload?.[0]?.payload;
                      if (!d) return null;
                      return (
                        <div className="rounded-md border border-border/50 bg-popover px-2.5 py-1.5 text-[10px] shadow-lg">
                          <div className="font-semibold text-foreground/90">{d.name}</div>
                          <div className="text-foreground/60 mt-0.5">Risiko: {d.risk} · {d.valuation}</div>
                          <div className="text-foreground/60">Attraktivität: {fmtNum(d.attractiveness, 1)} · Phase-Fit: {d.phaseFit}</div>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
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
