/**
 * StageColumn.tsx
 * ---------------
 * Sprint D6b: gestufte/isometrisch wirkende Kartenspalte für EINE
 * Value-Chain-Stage (upstream/midstream/downstream), angelehnt an das vom
 * Nutzer vorgegebene Referenzbild ("KI-Wertschöpfungskette"-Dashboard) —
 * ABER adaptiv aus den echten API-Stages generiert, NICHT die 7 fixen
 * KI-Stufen aus dem Referenzbild. Reines CSS/Tailwind, kein SVG-Canvas,
 * keine neue Abhängigkeit (kein @xyflow/react, kein Animations-Framework).
 *
 * Stufen-Effekt: jede Spalte erhält einen index-abhängigen `translateY`
 * (via inline style, da Tailwind keine dynamischen arbitrary values aus
 * Variablen generieren kann) — Spalte 0 (upstream) unten, letzte Spalte
 * (downstream) oben, analog zum "von links unten nach rechts oben"-Verlauf
 * im Referenzbild. Firmenanzahl pro Stage ist beliebig (0..n) und bricht
 * das Layout nicht, da die Karten in einer normalen vertikalen Liste
 * innerhalb der Spalte gestapelt werden (kein festes Karten-Limit).
 */

import type { ValueChainStage } from "@/lib/valueChainTypes";
import { formatCapexIntensity, capexColorClass, capexBorderClass } from "@/lib/valueChainTypes";

function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

const STAGE_ACCENT: Record<string, { dot: string; text: string; ring: string }> = {
  upstream: { dot: "bg-sky-400", text: "text-sky-300", ring: "ring-sky-500/30" },
  midstream: { dot: "bg-cyan-400", text: "text-cyan-300", ring: "ring-cyan-500/30" },
  downstream: { dot: "bg-emerald-400", text: "text-emerald-300", ring: "ring-emerald-500/30" },
};

interface StageColumnProps {
  stage: ValueChainStage;
  /** Position der Stage innerhalb der Sequenz (0-basiert), bestimmt Stufenhöhe */
  index: number;
  /** Gesamtanzahl Stages (für relative Stufenhöhen-Berechnung) */
  total: number;
  onCompanyClick?: (ticker: string) => void;
}

export function StageColumn({ stage, index, total, onCompanyClick }: StageColumnProps) {
  const accent = STAGE_ACCENT[stage.stageType] ?? STAGE_ACCENT.midstream;
  // Stufeneffekt: NUR ein kleiner Top-Versatz für die Spaltenüberschrift
  // (max. 40px, gedeckelt und über `total` normalisiert), damit die
  // Firmenkarten-Liste selbst IMMER am gleichen Startpunkt beginnt — sonst
  // würden Stages mit wenigen Firmen (z.B. Downstream mit 1 Firma) bei
  // einer Ganzspalten-translateY weit aus dem Sichtbereich rutschen, wenn
  // eine Nachbarspalte sehr viele Firmen hat (nicht adaptiv, siehe Bugfix
  // Sprint D6b QA). Dadurch bleibt der Stufen-Look erkennbar, ohne dass
  // Spalten mit unterschiedlicher Firmenanzahl das Layout brechen.
  const stepOffset = total > 1 ? Math.round((index / (total - 1)) * 40) : 0;

  return (
    <div
      className="relative flex min-w-[240px] flex-1 flex-col gap-3 md:min-w-0"
      data-testid={`stage-column-${stage.stageType}`}
    >
      {/* Stufen-Spacer: schiebt nur die Kopfzeile visuell hoch/runter,
          NICHT die scrollbare Firmenliste darunter. */}
      <div style={{ height: `${40 - stepOffset}px` }} className="hidden md:block" aria-hidden="true" />
      {/* Verbindungslinie zur nächsten Stage (dekorativ, CSS-Gradient) */}
      {index < total - 1 && (
        <div
          className="pointer-events-none absolute right-[-1.25rem] hidden h-px w-8 bg-gradient-to-r from-cyan-400/60 to-transparent md:block"
          style={{ top: `${40 - stepOffset + 24}px` }}
          aria-hidden="true"
        />
      )}

      {/* Stage-Beschriftung */}
      <div className={`rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 ring-1 ${accent.ring}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${accent.text}`}>
            {index + 1}. {stage.stageName}
          </span>
        </div>
        {stage.description && (
          <p className="mt-1 text-[11px] leading-snug text-slate-400">{stage.description}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
          <span>{stage.companyCount ?? stage.companies.length} Firmen</span>
          <span>·</span>
          <span>{formatMarketCap(stage.aggregatedMarketCap)}</span>
          {stage.avgCapexIntensity != null && (
            <>
              <span>·</span>
              <span className={capexColorClass(stage.avgCapexIntensity)}>
                Ø CAPEX {formatCapexIntensity(stage.avgCapexIntensity)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Firmenkarten: variable Anzahl, kein festes Limit → bricht bei 0..n nicht */}
      {stage.companies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-slate-500">
          Keine Firmen in dieser Stage
        </div>
      ) : (
        <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
          {stage.companies.map((c) => {
            const border = capexBorderClass(c.capexIntensity);
            return (
              <button
                key={c.ticker}
                type="button"
                onClick={() => onCompanyClick?.(c.ticker)}
                className={`group flex items-center justify-between gap-2 rounded-lg border ${border} bg-slate-900/70 px-3 py-2 text-left shadow-[0_4px_14px_-6px_rgba(0,0,0,0.6)] transition-transform hover:-translate-y-0.5 hover:bg-slate-800/80`}
                data-testid={`company-card-${c.ticker}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-white">{c.ticker}</span>
                    {c.starInvestorFlag && (
                      <span className="text-[10px] text-amber-400" title="Star Investor 13F">★</span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">{c.name}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-[10px] text-slate-300">{formatMarketCap(c.marketCap)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${capexColorClass(c.capexIntensity)} bg-black/30`}>
                    CAPEX {formatCapexIntensity(c.capexIntensity)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
