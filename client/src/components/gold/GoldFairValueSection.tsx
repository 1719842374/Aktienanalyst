import type { GoldAnalysis } from "../../../../shared/gold-schema";

interface Props { data: GoldAnalysis }

export function GoldFairValueSection({ data }: Props) {
  const fv = data.fairValue;
  const priceVsFV = ((data.spotPrice - fv.fvAdj) / fv.fvAdj) * 100;

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">4</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Fair Value (inflationsbereinigt)</h2>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-4">
        {/* 10-Step Calculation */}
        <div className="bg-muted/30 rounded-lg p-3 border border-border space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">10-Schritte-Berechnung</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <StepRow step={1} label="CPI heute" value={fv.cpiToday.toFixed(1)} />
            <StepRow step={2} label="FV₁₉₈₀ = 850 × (CPI/82.4)" value={`$${fv.fv1980.toLocaleString()}`} />
            <StepRow step={3} label="FV₂₀₁₁ = 1920 × (CPI/224.9)" value={`$${fv.fv2011.toLocaleString()}`} />
            <StepRow step={4} label="FV Basis = Ø(FV₁₉₈₀, FV₂₀₁₁)" value={`$${fv.fvBasis.toLocaleString()}`} />
            <StepRow step={5} label={`Premium (${fv.premiumReason})`} value={`${(fv.premium * 100).toFixed(0)}%`} />
            <StepRow step={6} label="FV adj. = Basis × (1+Premium)" value={`$${fv.fvAdj.toLocaleString()}`} highlight />
            <StepRow step={7} label="Support 1 (Preis × 0.90)" value={`$${fv.support1.toLocaleString()}`} />
            <StepRow step={8} label="Support 2 (FV Basis)" value={`$${fv.support2.toLocaleString()}`} />
            <StepRow step={9} label="Resistance 1 (Preis × 1.10)" value={`$${fv.resistance1.toLocaleString()}`} />
            <StepRow step={10} label="Resistance 2" value={`$${fv.resistance2.toLocaleString()}`} />
          </div>
        </div>

        {/* Fair Value Corridor Visual */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Fair-Value-Korridor</div>
          <FairValueBar
            spotPrice={data.spotPrice}
            support1={fv.support1}
            support2={fv.support2}
            fairValue={fv.fvAdj}
            resistance1={fv.resistance1}
            resistance2={fv.resistance2}
          />
        </div>

        {/* Price vs Fair Value */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${
          priceVsFV > 10
            ? "bg-red-500/10 border-red-500/20 text-red-400"
            : priceVsFV < -10
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
        }`}>
          <span className="font-medium">
            Spot vs. Fair Value: {priceVsFV >= 0 ? "+" : ""}{priceVsFV.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">
            {priceVsFV > 10
              ? "→ Über Fair Value (Vorsicht)"
              : priceVsFV < -10
                ? "→ Unter Fair Value (Aufwärtspotenzial)"
                : "→ Im Bereich der Fair Value"}
          </span>
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, label, value, highlight }: { step: number; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${highlight ? "font-bold text-amber-500" : ""}`}>
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-4">{step}.</span>
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${highlight ? "text-amber-500" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function FairValueBar({
  spotPrice,
  support1,
  support2,
  fairValue,
  resistance1,
  resistance2,
}: {
  spotPrice: number;
  support1: number;
  support2: number;
  fairValue: number;
  resistance1: number;
  resistance2: number;
}) {
  const min = Math.min(support2, support1, spotPrice) * 0.95;
  const max = Math.max(resistance2, resistance1, spotPrice) * 1.05;
  const range = max - min;
  const pct = (v: number) => ((v - min) / range) * 100;

  return (
    <div className="relative h-12 bg-muted/30 rounded-lg border border-border">
      {/* Support zone */}
      <div
        className="absolute h-full bg-red-500/10 rounded-l-lg"
        style={{ left: `${pct(min)}%`, width: `${pct(support1) - pct(min)}%` }}
      />
      {/* Fair Value zone */}
      <div
        className="absolute h-full bg-emerald-500/10"
        style={{ left: `${pct(support1)}%`, width: `${pct(resistance1) - pct(support1)}%` }}
      />
      {/* Resistance zone */}
      <div
        className="absolute h-full bg-red-500/10 rounded-r-lg"
        style={{ left: `${pct(resistance1)}%`, width: `${pct(max) - pct(resistance1)}%` }}
      />

      {/* Markers */}
      <Marker pct={pct(support2)} label={`S2: $${support2}`} color="text-red-400" />
      <Marker pct={pct(support1)} label={`S1: $${support1}`} color="text-red-400" />
      <Marker pct={pct(fairValue)} label={`FV: $${fairValue}`} color="text-amber-500" thick />
      <Marker pct={pct(resistance1)} label={`R1: $${resistance1}`} color="text-emerald-400" />
      <Marker pct={pct(resistance2)} label={`R2: $${resistance2}`} color="text-emerald-400" />

      {/* Spot Price marker */}
      <div
        className="absolute top-0 h-full flex flex-col items-center z-10"
        style={{ left: `${Math.min(98, Math.max(2, pct(spotPrice)))}%` }}
      >
        <div className="w-0.5 h-full bg-amber-500" />
        <div className="absolute -top-5 bg-amber-500 text-[9px] font-bold text-black px-1.5 py-0.5 rounded whitespace-nowrap">
          ${spotPrice.toFixed(0)}
        </div>
      </div>
    </div>
  );
}

function Marker({ pct, label, color, thick }: { pct: number; label: string; color: string; thick?: boolean }) {
  return (
    <div
      className="absolute top-0 h-full flex flex-col items-center"
      style={{ left: `${Math.min(98, Math.max(2, pct))}%` }}
    >
      <div className={`${thick ? "w-0.5" : "w-px"} h-full ${thick ? "bg-amber-500/50" : "bg-border"}`} />
      <div className={`absolute bottom-0 text-[8px] font-mono tabular-nums whitespace-nowrap ${color}`}>{label}</div>
    </div>
  );
}
