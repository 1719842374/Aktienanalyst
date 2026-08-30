/**
 * SectorRotationPanel — Sprint C1 P1 (Tabelle).
 * Spec WORK_SEKTORROTATIONS_RAT.md §3.3 Block 1 + §6 Quellenzeile.
 * P2 Donut / P3 Zyklus-Karten: nicht in diesem Slice.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Valuation = "Teuer" | "Angemessen" | "Attraktiv" | "n.v.";

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
  phase: string;
  phaseConfidence: number;
  sectors: SectorRow[];
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
      )}

      {data && (
        <div className="text-[10px] text-foreground/40" data-testid="text-sector-rotation-source">
          FMP + ETF-Proxies · Stand {data.asOf}
        </div>
      )}
    </div>
  );
}
