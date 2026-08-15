/**
 * MacroPanel (unchanged logic, extracted).
 */
import {
  ChevronRight, Flame, ArrowUp, ArrowDown, Minus, Activity
} from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  Buy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Avoid: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

// ============================================================
// Tab 1: Macro Pulse
// ============================================================

export function MacroPanel({ data }: { data: any }) {
  const llm = data.llmSynthesis;
  const indicators = data.indicators || [];
  return (
    <div className="space-y-4">
      {llm && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-4">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">Macro Synthesis</div>
          <p className="text-xs text-foreground/85 leading-relaxed">{llm.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <MacroBlock label="Risk-Free Rate" content={llm.riskFreeRateView} />
            <MacroBlock label="Liquidität" content={llm.liquidityView} />
            <MacroBlock label="Fiskalpolitik" content={llm.fiscalView} />
          </div>
          {Array.isArray(llm.keyDrivers) && llm.keyDrivers.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1.5">Key Drivers</div>
              <ul className="space-y-1">
                {llm.keyDrivers.map((d: string, i: number) => (
                  <li key={i} className="text-[11px] text-foreground/75 flex gap-2">
                    <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" />{d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(llm.investmentImplications) && llm.investmentImplications.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1.5">Investment Implications</div>
              <ul className="space-y-1">
                {llm.investmentImplications.map((d: string, i: number) => (
                  <li key={i} className="text-[11px] text-foreground/75 flex gap-2">
                    <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" />{d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {llm.actionRecommendation && (
            <div className="mt-4 p-2.5 rounded border border-border/30 bg-background/40 flex items-start gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${ACTION_COLORS[llm.actionRecommendation] || ""}`}>
                {llm.actionRecommendation}
              </span>
              <span className="text-[11px] text-foreground/75 flex-1">{llm.actionRationale}</span>
            </div>
          )}
        </div>
      )}

      {llm && Array.isArray(llm.keyEvents) && llm.keyEvents.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.04] to-orange-500/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <h2 className="text-xs font-semibold text-foreground/90">Aktuelle Key Events & Geopolitik</h2>
            <span className="text-[10px] text-foreground/40">({llm.keyEvents.length} Events autonom erkannt)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {llm.keyEvents.map((ev: any, i: number) => (
              <KeyEventCard key={i} ev={ev} />
            ))}
          </div>
        </div>
      )}

      {indicators.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-card/20 p-3">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">Real Macro Data ({indicators.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-foreground/50 border-b border-border/30">
                  <th className="text-left font-medium py-1.5 px-2">Country</th>
                  <th className="text-left font-medium py-1.5 px-2">Indicator</th>
                  <th className="text-right font-medium py-1.5 px-2">Latest</th>
                  <th className="text-right font-medium py-1.5 px-2">Previous</th>
                  <th className="text-right font-medium py-1.5 px-2 hidden sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {indicators.map((i: any, idx: number) => (
                  <tr key={idx} className="border-b border-border/10 hover:bg-muted/10">
                    <td className="py-1.5 px-2 text-foreground/80">{i.country}</td>
                    <td className="py-1.5 px-2 text-foreground/70">{i.category}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground/90">{i.latestValue} {i.unit}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground/50">{i.previousValue}</td>
                    <td className="py-1.5 px-2 text-right text-foreground/40 hidden sm:table-cell">{i.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MacroBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/30 p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1">{label}</div>
      <p className="text-[11px] text-foreground/80 leading-relaxed">{content}</p>
    </div>
  );
}

const CATEGORY_BADGES: Record<string, string> = {
  "Geopolitik": "bg-red-500/15 text-red-300 border-red-400/30",
  "Geldpolitik": "bg-blue-500/15 text-blue-300 border-blue-400/30",
  "Fiskalpolitik": "bg-indigo-500/15 text-indigo-300 border-indigo-400/30",
  "Konjunktur": "bg-teal-500/15 text-teal-300 border-teal-400/30",
  "Zentralbank": "bg-blue-500/15 text-blue-300 border-blue-400/30",
  "Wahl/Politik": "bg-purple-500/15 text-purple-300 border-purple-400/30",
  "Lieferkette": "bg-orange-500/15 text-orange-300 border-orange-400/30",
  "Energie/Rohstoffe": "bg-amber-500/15 text-amber-300 border-amber-400/30",
  "Naturkatastrophe": "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  "Tech/Regulierung": "bg-cyan-500/15 text-cyan-300 border-cyan-400/30",
  "Sonstiges": "bg-foreground/10 text-foreground/60 border-border/40",
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

function ImpactBadge({ label, value }: { label: string; value: string }) {
  const safe = value ?? "neutral";
  const isUp = /steigend|positiv/i.test(safe);
  const isDown = /fallend|negativ/i.test(safe);
  const isMixed = /gemischt/i.test(safe);
  const isEquity = label === "Aktien";
  let color = "text-foreground/50";
  let Icon = Minus;
  if (isEquity) {
    if (isUp) { color = "text-emerald-400"; Icon = ArrowUp; }
    else if (isDown) { color = "text-red-400"; Icon = ArrowDown; }
    else if (isMixed) { color = "text-amber-400"; Icon = Activity; }
  } else {
    if (isUp) { color = "text-red-300"; Icon = ArrowUp; }
    else if (isDown) { color = "text-emerald-300"; Icon = ArrowDown; }
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] uppercase tracking-wider text-foreground/40">{label}</span>
      <Icon className={`w-2.5 h-2.5 ${color}`} />
      <span className={`text-[10px] font-medium ${color}`}>{safe}</span>
    </div>
  );
}

function KeyEventCard({ ev }: { ev: any }) {
  const catClass = CATEGORY_BADGES[ev.category] || CATEGORY_BADGES.Sonstiges;
  const sevClass = SEVERITY_DOT[ev.severity] || "bg-foreground/30";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3 hover:bg-background/60 transition-colors">
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${sevClass}`} title={`Severity: ${ev.severity}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-foreground/90 leading-tight">{ev.title}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${catClass}`}>{ev.category}</span>
            {ev.timeframe && <span className="text-[9px] text-foreground/50">· {ev.timeframe}</span>}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-foreground/75 leading-relaxed mb-2">{ev.description}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b border-border/20">
        <ImpactBadge label="Inflation" value={ev.inflationImpact} />
        <ImpactBadge label="Zinsen" value={ev.rateImpact} />
        <ImpactBadge label="Aktien" value={ev.equityImpact} />
      </div>
      {ev.rationale && (
        <p className="text-[10px] text-foreground/60 italic leading-relaxed mb-2">{ev.rationale}</p>
      )}
      {Array.isArray(ev.affectedSectors) && ev.affectedSectors.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ev.affectedSectors.slice(0, 6).map((s: string, i: number) => (
            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/[0.06] text-foreground/65 border border-border/30">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
