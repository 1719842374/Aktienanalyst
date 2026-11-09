import {
  AlertTriangle, Activity, TrendingDown, BarChart3, Gauge, Info, RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  type RecessionAnalysis, type IndicatorResult,
  displayedNyFedAnchorPct,
  getProbColor, getProbBg, getProbLabel, getScoreColor, getScoreBg, getGaugeColor,
} from "./recessionDashboardShared";

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-lg text-center space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <AlertTriangle className="w-12 h-12 text-orange-500 opacity-60" />
            <Activity className="w-5 h-5 text-primary absolute -bottom-1 -right-1" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Rezessions- & Korrektur-Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Zwei Bücher: Rezession der Realwirtschaft und Korrektur der Finanzmärkte.
            Berechnet Wahrscheinlichkeiten über 3, 6 und 12 Monate.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-left text-xs">
          <div className="p-3 rounded-lg bg-card border border-card-border">
            <div className="font-semibold text-foreground mb-1">Rezessions-Buch</div>
            <div className="text-muted-foreground">Sahm, Zinskurve, Aktivität (IP), WEI, Durable Goods, M2, Kredit, Konsum</div>
          </div>
          <div className="p-3 rounded-lg bg-card border border-card-border">
            <div className="font-semibold text-foreground mb-1">Korrektur-Buch</div>
            <div className="text-muted-foreground">Buffett (Wilshire/GDP), Shiller CAPE (Multpl), VIX und ein Crowd-Bein. Margin bleibt ohne 5J-Historie unbewertet</div>
          </div>
        </div>

        <button
          onClick={onStart}
          className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
        >
          Analyse starten
        </button>

        <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground/50">
          <Info className="w-3 h-3" />
          Anti-Bias: Formel-Ergebnis ist mathematisch bindend
        </div>
      </div>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <div>
          <div className="text-sm font-medium">Analysiere die beiden Bücher...</div>
          <div className="text-xs text-muted-foreground mt-1">FRED, Multpl und CNN werden abgefragt. Margin liest keine xlsx</div>
        </div>
      </div>
    </div>
  );
}

export function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-3 max-w-sm">
        <div className="text-red-500 text-xl">⚠</div>
        <div className="text-sm font-medium">Analyse fehlgeschlagen</div>
        <div className="text-xs text-muted-foreground">{error.message}</div>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-2 mx-auto"
        >
          <RefreshCw className="w-3 h-3" />
          Erneut versuchen
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Section 1: Current Assessment with Gauges
// ============================================================
export function CurrentAssessment({ data }: { data: RecessionAnalysis }) {
  const keySubgroups = data.subgroups;

  return (
    <div className="space-y-4">
      {/* Probability Gauges Grid */}
      {/* flex-wrap + centred last row: 5 subgroups must not leave a hole in a 3-col grid */}
      <div className="flex flex-wrap justify-center gap-3" data-testid="grid-current-assessment">
        {keySubgroups.map((sg) => (
          <div
            key={sg.name}
            className={`basis-full sm:basis-[calc(50%-0.375rem)] lg:basis-[calc(33.333%-0.5rem)] xl:basis-[calc(20%-0.6rem)] min-w-0 p-4 rounded-lg border ${getProbBg(sg.probability)} flex flex-col items-center`}
          >
            <div className="text-xs font-medium text-muted-foreground mb-1">{sg.label}</div>
            <div className="text-[10px] text-muted-foreground/70 mb-2">Horizont: {sg.horizon}</div>
            <GaugeMini value={sg.probability} />
            <div className={`text-2xl font-bold tabular-nums mt-2 ${getProbColor(sg.probability)}`}>
              {sg.probability}%
            </div>
            <div className={`text-xs font-medium ${getProbColor(sg.probability)}`}>
              {getProbLabel(sg.probability)}
            </div>
          </div>
        ))}
      </div>

      {/* Indicator Summary Bar */}
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-muted-foreground">
            Bearish: {data.indicators.filter(i => i.weightedScore > 0).length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
          <span className="text-muted-foreground">
            Neutral: {data.indicators.filter(i => i.weightedScore === 0).length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">
            Bullish: {data.indicators.filter(i => i.weightedScore < 0).length}
          </span>
        </div>
      </div>
    </div>
  );
}

export function GaugeMini({ value }: { value: number }) {
  const color = getGaugeColor(value);
  const data = [
    { name: "value", val: value },
    { name: "remaining", val: 100 - value },
  ];

  return (
    <div className="w-20 h-12 relative">
      <ResponsiveContainer width="100%" height={48}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="90%"
            startAngle={180}
            endAngle={0}
            innerRadius={28}
            outerRadius={38}
            paddingAngle={0}
            dataKey="val"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="hsl(var(--muted))" opacity={0.3} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// Section 2: NY Fed Reference
// ============================================================
export function NYFedReference({ data }: { data: RecessionAnalysis }) {
  const anchorPct = displayedNyFedAnchorPct(
    data.nyFedValue,
    data.subgroups.find(s => s.name === "recession_full")?.nyFedAnchor,
  );
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
        <Gauge className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium">NY Fed Rezessionswahrscheinlichkeit (RECPROUSM156N)</div>
          <div className="text-xs text-muted-foreground mt-1">
            {data.nyFedValue !== null && anchorPct != null
              ? `Aktueller Wert: ${data.nyFedValue.toFixed(2)}% — Anker: ${anchorPct.toFixed(2)}%`
              : "Daten nicht verfügbar"
            }
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Wird als 30%-Anker in die 12M-Rezessionsschätzung integriert (Formel: P×0.7 + Anker×0.3)
          </div>
        </div>
      </div>
      {data.nyFedValue !== null && (
        <div className="text-xs text-muted-foreground">
          Quelle: <a href="https://fred.stlouisfed.org/series/RECPROUSM156N" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">fred.stlouisfed.org</a>
        </div>
      )}
    </div>
  );
}
