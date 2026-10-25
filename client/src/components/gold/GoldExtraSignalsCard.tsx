import React from "react";
import type { GoldAnalysis } from "../../../../shared/gold-schema";

// F10-20 / F10-24: Zusatzschicht nur Anzeige. GIS und adaptiver Score bleiben unverändert.
function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const text = (value * 100).toFixed(digits);
  return value > 0 ? `+${text} %` : `${text} %`;
}

function bn(millions: number | null | undefined): string {
  if (millions == null || !Number.isFinite(millions)) return "n/a";
  return `${(millions / 1000).toLocaleString("de-DE", { maximumFractionDigits: 0 })} Mrd. USD`;
}

const STRESS_TEXT: Record<string, string> = {
  na: "n/a", below: "Preis unter AISC", stress: "Stresszone (< AISC × 1,10)", watch: "Beobachten (< AISC × 1,15)", ok: "komfortabel über AISC",
};

export function GoldExtraSignalsCard({ data }: { data: Pick<GoldAnalysis, "extraSignals"> }) {
  const extra = data.extraSignals;
  const aisc = extra?.aiscMargin;
  const fiscal = extra?.fiscalDeficit;
  const tone = (dir: "positive" | "negative" | "na" | undefined) =>
    dir === "positive" ? "text-emerald-500" : dir === "negative" ? "text-red-500" : "text-muted-foreground";
  const aiscDir = aisc?.margin == null ? "na" : aisc.stress === "ok" ? "positive" : "negative";
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="gold-extra-signals">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground tracking-tight">Zusatzsignale (ohne Score)</h2>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Nur Anzeige: fließt nicht in GIS, adaptiven Score oder Gates. Fehlende Daten stehen als n/a.
        </p>
        {extra ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">Signal</th>
                  <th className="text-right py-2 font-medium">Wert</th>
                  <th className="text-right py-2 font-medium">Einordnung</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50 align-top" data-testid="gold-extra-aisc-margin">
                  <td className="py-2 pr-2">
                    <div className="font-medium text-foreground">AISC-Marge</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      (Preis − AISC) / AISC · AISC {aisc?.aisc != null ? `$${aisc.aisc.toFixed(0)}` : "n/a"}{aisc?.quarter ? ` (${aisc.quarter})` : ""}
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{pct(aisc?.margin)}</td>
                  <td className={`py-2 text-right ${tone(aiscDir)}`}>{aisc?.margin == null ? aisc?.note ?? "n/a" : STRESS_TEXT[aisc.stress]}</td>
                </tr>
                <tr className="border-b border-border/50 align-top" data-testid="gold-extra-fiscal-deficit">
                  <td className="py-2 pr-2">
                    <div className="font-medium text-foreground">US-Fiskaldefizit (12M)</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {bn(fiscal?.deficit12m)} vs. {bn(fiscal?.deficit12mPrior)} · {fiscal?.source ?? "FRED MTSDS133FMS"}{fiscal?.latestMonth ? ` bis ${fiscal.latestMonth.slice(0, 7)}` : ""}
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{pct(fiscal?.growth)}</td>
                  <td className={`py-2 text-right ${tone(fiscal?.direction)}`}>
                    {fiscal?.direction === "positive" ? "Defizit wächst (positiv für Gold)" : fiscal?.direction === "negative" ? "Defizit schrumpft" : fiscal?.note ?? "n/a"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground" data-testid="gold-extra-missing">n/a — Zusatzsignale nicht geladen</div>
        )}
      </div>
    </div>
  );
}
