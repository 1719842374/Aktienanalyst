import React from "react";
import { PRIOR_KIND_LABEL, type RecessionAdaptiveView } from "@shared/recession-adaptive-weights-view";

function plain(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function sourceLabel(source: RecessionAdaptiveView["source"]): string {
  return source === "ki" ? "KI" : "quantitativ";
}

/**
 * Future_9 §8. Zeigt Basis- und angepasste Gewichte.
 * Die Live-P der fünf Untergruppen steht weiter in den Gauges und in
 * „Prozentschätzungen“. Diese Karte ersetzt sie nicht.
 */
export function RecessionAdaptiveWeightsCard({ view }: { view: RecessionAdaptiveView | null | undefined }) {
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="recession-adaptive-weights">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Adaptive Makro-Gewichte</h2>
          {view && (
            <div
              className="ml-auto shrink-0 px-2.5 py-1 rounded-md text-xs font-bold font-mono border border-border bg-muted/40"
              data-testid="recession-adaptive-source"
            >
              Quelle {sourceLabel(view.source)}
            </div>
          )}
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="recession-adaptive-live-note">
          Die Live-P der fünf Untergruppen bleibt unverändert. Diese Karte zeigt nur die adaptive Schicht.
          Fehlt eine Reihe, steht n/a mit Grund. Es wird keine 0 eingesetzt.
        </p>
        {!view ? (
          <div className="text-xs text-muted-foreground" data-testid="recession-adaptive-missing">
            n/a — adaptive Gewichte nicht im Payload
          </div>
        ) : (
          <>
            <div className="text-[11px] text-muted-foreground" data-testid="recession-adaptive-regime">{view.regimeDetail}</div>
            <div className="text-[11px] text-muted-foreground" data-testid="recession-adaptive-concentration">{view.concentrationDetail}</div>
            <div className="text-[11px] text-muted-foreground" data-testid="recession-adaptive-reason">{view.reason}</div>
            <div className="text-[11px] text-muted-foreground space-y-1" data-testid="recession-adaptive-priors">
              <div className="font-medium text-foreground">{PRIOR_KIND_LABEL}</div>
              {view.priors.map(prior => (
                <div key={prior.id} data-testid={`recession-adaptive-prior-${prior.id}`}>
                  {prior.label}: {prior.value}. {prior.reason}
                </div>
              ))}
            </div>
            <div className="sm:hidden space-y-3">
              {view.layers.map(layer => (
                <div key={layer.id} className="border-b border-border/50 pb-2" data-testid={`recession-adaptive-layer-${layer.id}`}>
                  <div className="font-medium text-xs text-foreground">{layer.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{layer.detail}</div>
                  <dl className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <dt className="text-muted-foreground">Basis</dt>
                      <dd className="font-mono tabular-nums">{plain(layer.baseWeight)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Quantitativ</dt>
                      <dd className="font-mono tabular-nums">{plain(layer.quantitativeWeight)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Angepasst</dt>
                      <dd className="font-mono tabular-nums" data-testid={`recession-adaptive-adjusted-${layer.id}`}>{plain(layer.adjustedWeight)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 font-medium">Dimension</th>
                    <th className="text-right py-2 font-medium">Basis</th>
                    <th className="text-right py-2 font-medium">Quantitativ</th>
                    <th className="text-right py-2 font-medium">Angepasst</th>
                  </tr>
                </thead>
                <tbody>
                  {view.layers.map(layer => (
                    <tr key={layer.id} className="border-b border-border/50 align-top" data-testid={`recession-adaptive-layer-desktop-${layer.id}`}>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-foreground">{layer.label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{layer.detail}</div>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap">{plain(layer.baseWeight)}</td>
                      <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap">{plain(layer.quantitativeWeight)}</td>
                      <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap">{plain(layer.adjustedWeight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-muted/30 rounded-md p-3 border border-border space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Schatten-P, nicht live</div>
              <ul className="space-y-1">
                {view.shadow.map(row => (
                  <li
                    key={row.name}
                    className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 text-[11px]"
                    data-testid={`recession-adaptive-shadow-${row.name}`}
                  >
                    <span className="text-foreground">{row.label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      P alt {row.pAlt}% · P neu {row.pNeu == null ? `n/a — ${row.detail}` : `${row.pNeu}%`}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-[11px] font-mono text-muted-foreground">{view.formula}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
