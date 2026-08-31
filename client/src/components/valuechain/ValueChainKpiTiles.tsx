/**
 * ValueChainKpiTiles.tsx
 * ----------------------
 * Sprint D6b: KPI-Kachel-Reihe unten (analog Referenzbild "Werthebel /
 * Wertrealisierung / Reifegrad"), ABER mit echten, aus der
 * /api/valuechain-Antwort abgeleiteten Kennzahlen statt erfundener
 * KI-Marketing-Zahlen:
 *
 * 1. Aggregierte Marktkapitalisierung — Summe über alle Stages
 * 2. Ø CAPEX-Intensität nach Stage — horizontale Balken, eine Zeile pro Stage
 * 3. Datenabdeckung — Anteil Firmen mit capexIntensity !== null, als Ring
 *
 * Alle drei Werte werden aus `ValueChainResponse` berechnet, keine
 * hartcodierten Branchen-Fälle.
 */

import type { ValueChainStage } from "@/lib/valueChainTypes";
import { formatCapexIntensity } from "@/lib/valueChainTypes";

function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

const BAR_COLOR: Record<string, string> = {
  upstream: "bg-sky-400",
  midstream: "bg-cyan-400",
  downstream: "bg-emerald-400",
};

interface ValueChainKpiTilesProps {
  stages: ValueChainStage[];
}

export function ValueChainKpiTiles({ stages }: ValueChainKpiTilesProps) {
  const totalMarketCap = stages.reduce((sum, s) => sum + (s.aggregatedMarketCap ?? 0), 0);

  const capexStages = stages.filter((s) => s.avgCapexIntensity != null);
  const maxCapex = Math.max(0.01, ...capexStages.map((s) => s.avgCapexIntensity ?? 0));

  const allCompanies = stages.flatMap((s) => s.companies);
  const totalCompanies = allCompanies.length;
  const withCapex = allCompanies.filter((c) => c.capexIntensity != null).length;
  const coveragePct = totalCompanies > 0 ? Math.round((withCapex / totalCompanies) * 100) : 0;

  // SVG-Fortschrittsring (reines SVG, keine neue Abhängigkeit)
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - coveragePct / 100);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="valuechain-kpi-tiles">
      {/* Kachel 1: Aggregierte Marktkapitalisierung */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Aggregierte Marktkapitalisierung
        </div>
        <div className="mt-2 text-2xl font-bold text-white">{formatMarketCap(totalMarketCap)}</div>
        <div className="mt-1 text-[11px] text-slate-500">
          Summe über {stages.length} {stages.length === 1 ? "Stage" : "Stages"} · {totalCompanies} Firmen
        </div>
      </div>

      {/* Kachel 2: Ø CAPEX-Intensität nach Stage */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Ø CAPEX-Intensität nach Stage
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {stages.length === 0 && (
            <div className="text-[11px] text-slate-500">Keine Stage-Daten verfügbar</div>
          )}
          {stages.map((s) => {
            const val = s.avgCapexIntensity;
            const pct = val != null ? Math.min(100, (val / maxCapex) * 100) : 0;
            return (
              <div key={s.stageId} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-[10px] text-slate-400">{s.stageName}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${BAR_COLOR[s.stageType] ?? "bg-slate-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-[10px] text-slate-300">
                  {formatCapexIntensity(val)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kachel 3: Datenabdeckung (echte Vollständigkeit, kein erfundener Score) */}
      <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
            <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="8" />
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="#34d399"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
            {coveragePct}%
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Datenabdeckung
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {withCapex} von {totalCompanies} Firmen mit CAPEX-Daten
          </div>
        </div>
      </div>
    </div>
  );
}
