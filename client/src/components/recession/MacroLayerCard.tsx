import React from "react";
import type { MacroLayer } from "@shared/macro-layer";

function fmt(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toFixed(d);
}

function signed(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
}

function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "n/a" : `${v}%`;
}

const REGIME_LABEL: Record<string, string> = {
  restrictive: "restriktiv",
  easing: "lockernd",
  neutral: "neutral",
};

/** F9-16: Transparenz, welche Gewichte angepasst wurden (Muster GoldAdaptiveLayersCard). */
export function MacroLayerCard({ layer, loading, error, fallback }: {
  layer: MacroLayer | null | undefined;
  loading: boolean;
  error: boolean;
  fallback: boolean;
}) {
  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden" data-testid="macro-layer-card">
      <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">Makro-Ebene (Future_9) – Zusatzsicht</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground" data-testid="macro-layer-impact">
          kein Einfluss auf die P-Werte oben
        </span>
        {layer && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-border font-mono" data-testid="macro-layer-source">
            Gewichte: {layer.weightSource === "openrouter" ? `KI (OpenRouter${layer.ai.model ? `, ${layer.ai.model}` : ""}${layer.ai.cached ? ", Cache" : ""})` : "deterministisch"}
          </span>
        )}
      </div>
      <div className="p-3 space-y-3 text-[11px]">
        {fallback ? (
          <p className="text-muted-foreground" data-testid="macro-layer-na">n/a – Live-Daten nicht verfügbar (statischer Fallback), Makro-Ebene wird nicht gerechnet.</p>
        ) : loading ? (
          <p className="text-muted-foreground">Makro-Ebene wird berechnet …</p>
        ) : error || !layer ? (
          <p className="text-muted-foreground" data-testid="macro-layer-na">n/a – Makro-Ebene nicht abrufbar.</p>
        ) : !layer.available ? (
          <p className="text-muted-foreground" data-testid="macro-layer-na">n/a – {layer.notes.join(" ")}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([["Rezession 12M", layer.recession], ["Korrektur 12M", layer.correction]] as const).map(([label, g]) => (
                <div key={label} className="rounded-md border border-border p-2" data-testid={`macro-layer-p-${label.startsWith("Rez") ? "recession" : "correction"}`}>
                  <div className="text-muted-foreground">{label}</div>
                  <div className="font-mono tabular-nums">
                    Makro-Ebene <b>{pct(g.layer)}</b> · bestehende Formel {pct(g.reference)}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono break-words">{g.formula}</div>
                </div>
              ))}
            </div>
            <div className="text-muted-foreground" data-testid="macro-layer-habitat">
              Habitat: <b className="text-foreground">{layer.habitat.regime ? REGIME_LABEL[layer.habitat.regime] : "n/a"}</b>
              {" · "}Realzins DFII10 {fmt(layer.habitat.realYield)} % (z20J {signed(layer.habitat.realYieldZ)}{layer.habitat.realYieldAsOf ? `, ${layer.habitat.realYieldAsOf}` : ""})
              {" · "}Fed Funds 12M {signed(layer.habitat.fedFundsChange12mPp)} pp
              {" · "}Konzentration {fmt(layer.habitat.concentration)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left py-1 pr-2 font-normal">Dimension</th>
                    <th className="text-right px-1 font-normal">Score</th>
                    <th className="text-right px-1 font-normal">Basis</th>
                    <th className="text-right px-1 font-normal">×Habitat</th>
                    <th className="text-right px-1 font-normal">×Stärke</th>
                    <th className="text-right px-1 font-normal">Quant</th>
                    <th className="text-right px-1 font-normal">KI</th>
                    <th className="text-right pl-1 font-normal">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {layer.dimensions.map(d => (
                    <tr key={d.id} className={`border-b border-border/50 ${d.available ? "" : "text-muted-foreground"}`} data-testid={`macro-layer-dim-${d.id}`}>
                      <td className="py-1 pr-2 font-sans" title={d.note}>
                        {d.label}{d.adjusted ? <span className="ml-1 text-amber-500" title="Gewicht angepasst">●</span> : null}
                        <div className="text-[10px] text-muted-foreground">{d.available ? d.indicators.join(", ") : d.note}</div>
                      </td>
                      <td className="text-right px-1">{signed(d.score)}</td>
                      <td className="text-right px-1">{fmt(d.baseWeight)}</td>
                      <td className="text-right px-1">{d.habitatMultiplier === 1 ? "1.00" : <span className="text-amber-500">{fmt(d.habitatMultiplier)}</span>}</td>
                      <td className="text-right px-1">{fmt(d.strengthMultiplier)}</td>
                      <td className="text-right px-1">{fmt(d.quantWeight)}</td>
                      <td className="text-right px-1">{d.aiWeight == null ? "–" : <span className={layer.ai.clamped.includes(d.id) ? "text-red-500" : "text-amber-500"}>{fmt(d.aiWeight)}</span>}</td>
                      <td className="text-right pl-1 font-bold">{fmt(d.finalWeight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {layer.ai.status === "ok" && layer.ai.reason && (
              <p className="text-muted-foreground" data-testid="macro-layer-ai-reason">
                KI-Begründung{layer.ai.riskFlag === 1 ? " (Risiko-Flag)" : ""}: {layer.ai.reason}
                {layer.ai.clamped.length ? ` · auf ±25 % geklemmt: ${layer.ai.clamped.join(", ")}` : ""}
              </p>
            )}
            <ul className="text-[10px] text-muted-foreground list-disc pl-4 space-y-0.5">
              {[...layer.notes, ...layer.habitat.notes].map((n, i) => <li key={i}>{n}</li>)}
              {layer.unmapped.length > 0 && <li data-testid="macro-layer-unmapped">Nicht zugeordnet (nicht in der Makro-Ebene): {layer.unmapped.join(", ")}</li>}
              <li>● = Gewicht weicht von der Basis ab. Final = Basis × Habitat × (0,7 + Stärke × 0,6){layer.weightSource === "openrouter" ? ", dann KI ±25 %" : ""}. Dimension ohne Daten: n/a, nicht in der Summe.</li>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
