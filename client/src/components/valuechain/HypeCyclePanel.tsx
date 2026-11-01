import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { HypeAssessment } from "@shared/hype-cycle";
import { HYPE_WEIGHTS } from "@shared/hype-cycle";

/**
 * Proxy-Hype für die geladene Kette. Abruf erst auf Knopfdruck, damit kein stiller FMP-Lauf startet.
 */
export function HypeCyclePanel({ tickers }: { tickers: string[] }) {
  const [data, setData] = useState<HypeAssessment & { skipped?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/valuechain/hype", { tickers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err: any) {
      setError(err?.message || "n/a — Hype-Abruf fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-6 min-w-0 rounded-xl border border-white/10 bg-slate-900/40 p-4" data-testid="hype-cycle-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Proxy-Hype-Cycle</h2>
        <button
          type="button"
          onClick={load}
          disabled={loading || tickers.length === 0}
          className="min-h-9 rounded border border-cyan-500/40 px-2 text-[11px] text-cyan-200 disabled:opacity-40 sm:min-h-7"
          data-testid="button-hype-load"
        >
          {loading ? "Lädt…" : "Hype aus FMP-Historie"}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        Gewichte: News {HYPE_WEIGHTS.newsVolume}, CAPEX {HYPE_WEIGHTS.capexMaterial}, Bewertung {HYPE_WEIGHTS.valuationVsHistory}, Revisionen {HYPE_WEIGHTS.analystRevisions}, Guidance {HYPE_WEIGHTS.guidanceStrength}, Narrativ {HYPE_WEIGHTS.narrative}. Fehlende Signale zählen nicht als 0.
      </p>
      {tickers.length === 0 && <p className="mt-2 text-[11px] text-slate-400">n/a — keine Firmen in der Kette</p>}
      {error && <p className="mt-2 text-[11px] text-amber-300">{error}</p>}
      {data && (
        <div className="mt-3 space-y-2">
          {data.notes.map(n => <p key={n} className="text-[10px] text-slate-400">{n}</p>)}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[11px] text-slate-200">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1 pr-2">Ticker</th>
                  <th className="py-1 pr-2">Phase</th>
                  <th className="py-1 pr-2">Teil-z</th>
                  <th className="py-1">Gewicht verwendet</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map(c => (
                  <tr key={c.ticker} className="border-t border-white/5" data-testid={`hype-row-${c.ticker}`}>
                    <td className="py-1 pr-2 font-mono">{c.ticker}</td>
                    <td className="py-1 pr-2">{c.phase ?? c.phaseReason}</td>
                    <td className="py-1 pr-2 font-mono">{c.compositeZ == null ? "n/a" : c.compositeZ.toFixed(2)}</td>
                    <td className="py-1 font-mono">{c.weightUsed.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
