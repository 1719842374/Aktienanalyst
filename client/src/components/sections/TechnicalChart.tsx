import { useState, useMemo } from "react";
import type { StockAnalysis, MADataPoint, MACDDataPoint, TradingSignal } from "../../../../shared/schema";
import { SectionCard } from "../SectionCard";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  Tooltip, Legend, ReferenceLine, Area, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

interface Props {
  data: StockAnalysis;
}

// MA line configs
const MA_LINES = [
  { key: "ma200", label: "MA200 (SMA)", color: "#ef4444", defaultOn: true },
  { key: "ma100", label: "MA100 (SMA)", color: "#f97316", defaultOn: false },
  { key: "ma50", label: "MA50 (SMA)", color: "#eab308", defaultOn: true },
  { key: "ma20", label: "MA20 (SMA)", color: "#84cc16", defaultOn: false },
  { key: "ema26", label: "EMA26", color: "#06b6d4", defaultOn: false },
  { key: "ema12", label: "EMA12", color: "#8b5cf6", defaultOn: false },
  { key: "ema9", label: "EMA9", color: "#ec4899", defaultOn: false },
] as const;

type MAKey = typeof MA_LINES[number]["key"];

export function TechnicalChart({ data }: Props) {
  const ti = data.technicalIndicators;
  const ohlcv = data.ohlcvData;

  const [visibleMAs, setVisibleMAs] = useState<Set<MAKey>>(() => {
    const initial = new Set<MAKey>();
    MA_LINES.forEach(ma => { if (ma.defaultOn) initial.add(ma.key); });
    return initial;
  });
  const [showSignals, setShowSignals] = useState(true);
  const [timeRange, setTimeRange] = useState<"3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y">("1Y");

  if (!ti || !ohlcv || ohlcv.length === 0) {
    return (
      <SectionCard id={10} title="Technische Analyse" subtitle="Chart & Signale">
        <div className="text-center text-muted-foreground text-xs py-8">
          Keine OHLCV-Daten verfügbar
        </div>
      </SectionCard>
    );
  }

  // Filter MA data to match selected time range
  const filteredData = useMemo(() => {
    const cutoff = timeRange === "3M" ? 63 : timeRange === "6M" ? 126 : timeRange === "1Y" ? 252 : timeRange === "2Y" ? 504 : timeRange === "3Y" ? 756 : 1260;
    const maSlice = ti.maData.slice(-Math.min(cutoff, ti.maData.length));
    const macdSlice = ti.macdData.slice(-Math.min(cutoff, ti.macdData.length));
    return { ma: maSlice, macd: macdSlice };
  }, [ti.maData, ti.macdData, timeRange]);

  // Merge MA and MACD data for display
  const chartData = useMemo(() => {
    return filteredData.ma.map((d, i) => {
      const macd = filteredData.macd[i] || {};
      return {
        date: d.date,
        close: d.close,
        ma200: d.ma200,
        ma100: d.ma100,
        ma50: d.ma50,
        ma20: d.ma20,
        ema26: d.ema26,
        ema12: d.ema12,
        ema9: d.ema9,
        macd: macd.macd,
        signal: macd.signal,
        histogram: macd.histogram,
      };
    });
  }, [filteredData]);

  // Filter signals within the displayed time range
  const visibleSignals = useMemo(() => {
    if (!showSignals || chartData.length === 0) return [];
    const startDate = chartData[0].date;
    return ti.signals.filter(s => s.date >= startDate);
  }, [ti.signals, chartData, showSignals]);

  const toggleMA = (key: MAKey) => {
    setVisibleMAs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cs = ti.currentStatus;

  // Y-axis domain for price chart
  const priceMin = Math.min(...chartData.map(d => {
    let min = d.close;
    MA_LINES.forEach(ma => {
      const v = d[ma.key as keyof typeof d] as number | undefined;
      if (v && visibleMAs.has(ma.key) && v < min) min = v;
    });
    return min;
  }));
  const priceMax = Math.max(...chartData.map(d => {
    let max = d.close;
    MA_LINES.forEach(ma => {
      const v = d[ma.key as keyof typeof d] as number | undefined;
      if (v && visibleMAs.has(ma.key) && v > max) max = v;
    });
    return max;
  }));
  const pricePadding = (priceMax - priceMin) * 0.05;

  // Format date for axis — show year for longer timeframes
  const formatDate = (date: string) => {
    const parts = date.split("-");
    if (timeRange === "2Y" || timeRange === "3Y" || timeRange === "5Y") {
      return `${parts[1]}/${parts[0].slice(2)}`; // MM/YY
    }
    return `${parts[1]}/${parts[2]}`; // MM/DD
  };

  const formatDateFull = (date: string) => {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <SectionCard id={10} title="Technische Analyse" subtitle="Interactive Chart – MA & MACD">
      {/* Status bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatusPill
          label="Kurs > MA200"
          value={cs.priceAboveMA200}
          detail={cs.ma200Value ? `MA200: $${cs.ma200Value.toFixed(2)}` : ""}
        />
        <StatusPill
          label="MA50 > MA200"
          value={cs.ma50AboveMA200}
          detail={cs.ma50Value ? `MA50: $${cs.ma50Value.toFixed(2)}` : ""}
        />
        <StatusPill
          label="MACD > 0"
          value={cs.macdAboveZero}
          detail={cs.macdValue !== undefined ? `MACD: ${cs.macdValue.toFixed(4)}` : ""}
        />
        <StatusPill
          label="MACD steigend"
          value={cs.macdRising}
          detail={cs.signalValue !== undefined ? `Signal: ${cs.signalValue.toFixed(4)}` : ""}
        />
      </div>

      {/* Buy/Sell verdict */}
      <div className={`rounded-lg p-3 mb-4 border ${cs.buySignal
        ? "bg-green-500/10 border-green-500/30"
        : "bg-amber-500/10 border-amber-500/30"
      }`}>
        <div className="flex items-center gap-2">
          {cs.buySignal ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          )}
          <span className="text-xs font-semibold">
            {cs.buySignal
              ? "BUY-Bedingungen erfüllt: Kurs > MA200 AND MA50 > MA200 AND MACD > 0 + steigend"
              : "KEIN Kaufsignal – nicht alle Bedingungen erfüllt"}
          </span>
        </div>
        {!cs.buySignal && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Fehlend: {[
              !cs.priceAboveMA200 && "Kurs < MA200",
              !cs.ma50AboveMA200 && "MA50 < MA200",
              !cs.macdAboveZero && "MACD < 0",
              !cs.macdRising && "MACD fallend",
            ].filter(Boolean).join(" | ")}
          </div>
        )}
        {!cs.priceAboveMA200 && (
          <div className="mt-1 text-[10px] text-red-400 font-medium">
            ⚠ MA200-Break-Warnung: Historischer Max-Drawdown zzgl. 15-20% (defensiv) bzw. 35-50% (Beta &gt;1.5) einkalkulieren
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Time range */}
        <div className="flex rounded-md border border-border overflow-hidden">
          {(["3M", "6M", "1Y", "2Y", "3Y", "5Y"] as const).map(r => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                timeRange === r ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"
              }`}
              data-testid={`button-range-${r}`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* MA toggles */}
        <div className="flex flex-wrap gap-1">
          {MA_LINES.map(ma => (
            <button
              key={ma.key}
              onClick={() => toggleMA(ma.key)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                visibleMAs.has(ma.key)
                  ? "border-current opacity-100"
                  : "border-border opacity-40 hover:opacity-60"
              }`}
              style={{ color: ma.color }}
              data-testid={`toggle-${ma.key}`}
            >
              {visibleMAs.has(ma.key) ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
              {ma.label}
            </button>
          ))}
        </div>

        {/* Signal toggle */}
        <button
          onClick={() => setShowSignals(!showSignals)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
            showSignals ? "border-primary text-primary" : "border-border text-muted-foreground opacity-50"
          }`}
          data-testid="toggle-signals"
        >
          {showSignals ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
          Signale
        </button>
      </div>

      {/* Golden Cross / Death Cross — only show if crossover happened within last 30 trading days */}
      {(() => {
        // Detect recent crossover by scanning MA data
        const maData = ti.maData;
        let recentCrossType: 'golden' | 'death' | null = null;
        let crossDate = '';
        if (maData.length >= 2) {
          // Look at last 30 data points for a crossover
          const lookback = Math.min(30, maData.length - 1);
          for (let i = maData.length - 1; i >= maData.length - lookback; i--) {
            const cur = maData[i];
            const prev = maData[i - 1];
            if (cur.ma50 && cur.ma200 && prev.ma50 && prev.ma200) {
              if (cur.ma50 > cur.ma200 && prev.ma50 <= prev.ma200) {
                recentCrossType = 'golden';
                crossDate = cur.date;
                break;
              }
              if (cur.ma50 < cur.ma200 && prev.ma50 >= prev.ma200) {
                recentCrossType = 'death';
                crossDate = cur.date;
                break;
              }
            }
          }
        }
        if (!recentCrossType) return null;
        const isGolden = recentCrossType === 'golden';
        const dateStr = new Date(crossDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
        return (
          <div className={`rounded-lg p-3 mb-3 border flex items-center gap-3 ${isGolden
            ? "bg-emerald-500/10 border-emerald-500/30"
            : "bg-red-500/10 border-red-500/30"
          }`}>
            <div className={`text-2xl font-bold ${isGolden ? "text-emerald-500" : "text-red-500"}`}>
              {isGolden ? "\u2726" : "\u2715"}
            </div>
            <div>
              <div className={`text-sm font-bold ${isGolden ? "text-emerald-500" : "text-red-500"}`}>
                {isGolden ? "GOLDEN CROSS" : "DEATH CROSS"} <span className="text-xs font-normal text-muted-foreground">({dateStr})</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                MA50 kreuzte MA200 {isGolden ? 'von unten nach oben' : 'von oben nach unten'} am {dateStr} {isGolden ? '\u2014 bullisches Trendsignal' : '\u2014 b\u00e4risches Trendsignal'}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Price Chart with MAs */}
      <div className="h-[320px] sm:h-[380px] w-full" data-testid="chart-price-ma">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              interval={Math.floor(chartData.length / 8)}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              domain={[priceMin - pricePadding, priceMax + pricePadding]}
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={52}
              axisLine={{ stroke: "var(--border)" }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                    <div className="font-semibold mb-1">{formatDateFull(label)}</div>
                    {payload.map((p: any) => (
                      <div key={p.dataKey} className="flex justify-between gap-3">
                        <span style={{ color: p.color }}>{p.name}</span>
                        <span className="font-mono tabular-nums">${Number(p.value).toFixed(2)}</span>
                      </div>
                    ))}
                    {/* Show signals for this date */}
                    {visibleSignals.filter(s => s.date === label).map((s, i) => (
                      <div key={i} className={`mt-1 pt-1 border-t border-border ${s.type === "buy" ? "text-green-400" : "text-red-400"}`}>
                        {s.type === "buy" ? "▲ BUY" : "▼ SELL"}: {s.reason}
                      </div>
                    ))}
                  </div>
                );
              }}
            />

            {/* Price line */}
            <Line
              type="monotone"
              dataKey="close"
              name="Kurs"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />

            {/* MA lines */}
            {MA_LINES.map(ma => visibleMAs.has(ma.key) && (
              <Line
                key={ma.key}
                type="monotone"
                dataKey={ma.key}
                name={ma.label}
                stroke={ma.color}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray={ma.key.startsWith("ema") ? "4 2" : undefined}
                connectNulls={true}
                isAnimationActive={false}
              />
            ))}

            {/* Buy/Sell signal markers as reference lines */}
            {showSignals && visibleSignals.map((s, i) => (
              <ReferenceLine
                key={`sig-${i}`}
                x={s.date}
                stroke={s.type === "buy" ? "#22c55e" : "#ef4444"}
                strokeDasharray="2 2"
                strokeWidth={0.8}
                opacity={0.5}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* MACD Chart */}
      <div className="mt-2 text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
        MACD(12,26,9)
        <span className="text-[9px] opacity-60">= EMA₁₂ - EMA₂₆ | Signal = EMA₉(MACD) | Histogram = MACD - Signal</span>
      </div>
      <div className="h-[140px] sm:h-[160px] w-full" data-testid="chart-macd">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              interval={Math.floor(chartData.length / 8)}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              width={52}
              axisLine={{ stroke: "var(--border)" }}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                    <div className="font-semibold mb-1">{formatDateFull(label)}</div>
                    {payload.map((p: any) => (
                      <div key={p.dataKey} className="flex justify-between gap-3">
                        <span style={{ color: p.color }}>{p.name}</span>
                        <span className="font-mono tabular-nums">{Number(p.value).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={0.5} />

            {/* Histogram */}
            <Bar
              dataKey="histogram"
              name="Histogram"
              isAnimationActive={false}
              shape={(props: any) => {
                const { x, y, width, height, payload } = props;
                const isPositive = (payload?.histogram ?? 0) >= 0;
                return (
                  <rect
                    x={x}
                    y={isPositive ? y : y}
                    width={Math.max(width, 1)}
                    height={Math.abs(height)}
                    fill={isPositive ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)"}
                  />
                );
              }}
            />

            {/* MACD line */}
            <Line
              type="monotone"
              dataKey="macd"
              name="MACD"
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              connectNulls={true}
              isAnimationActive={false}
            />

            {/* Signal line */}
            <Line
              type="monotone"
              dataKey="signal"
              name="Signal"
              stroke="#f97316"
              strokeWidth={1}
              strokeDasharray="3 2"
              dot={false}
              connectNulls={true}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Signals Table */}
      {visibleSignals.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-medium text-muted-foreground mb-2">
            Letzte Signale ({visibleSignals.length} im Zeitraum)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Datum</th>
                  <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Signal</th>
                  <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Grund</th>
                  <th className="text-right py-1 font-medium text-muted-foreground">Kurs</th>
                </tr>
              </thead>
              <tbody>
                {visibleSignals.slice(-10).reverse().map((s, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono tabular-nums">{s.date}</td>
                    <td className="py-1 pr-2">
                      <span className={`inline-flex items-center gap-0.5 font-semibold ${
                        s.type === "buy" ? "text-green-500" : "text-red-500"
                      }`}>
                        {s.type === "buy" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {s.type === "buy" ? "BUY" : "SELL"}
                      </span>
                    </td>
                    <td className={`py-1 pr-2 ${s.reason.includes('Death') ? 'font-bold text-red-500' : s.reason.includes('Golden Cross') ? 'font-bold text-emerald-500' : s.reason.includes('Bearish') ? 'text-red-500' : s.reason.includes('Bullish') ? 'text-emerald-500' : ''}`}>
                      {s.reason}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">${s.price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Anti-bias disclaimer */}
      <div className="mt-3 p-2 rounded bg-muted/30 text-[9px] text-muted-foreground leading-relaxed">
        <span className="font-semibold">Anti-Bias Protokoll:</span> Kauf nur wenn: Kurs &gt; MA200 AND MA50 &gt; MA200 AND MACD &gt; 0 + steigend.
        Bei MA200-Break: historischen Max-Drawdown +15-20% (defensiv) bzw. +35-50% (Beta &gt;1.5) als Downside einplanen.
        MACD = EMA₁₂ − EMA₂₆, Signal = EMA₉(MACD), Histogram = MACD − Signal; α = 2/(Period+1).
        RSL berechnet exklusiv aus 26-Wochen-Durchschnitt (≈130 Handelstage).
      </div>
    </SectionCard>
  );
}

// Status pill component
function StatusPill({ label, value, detail }: { label: string; value: boolean; detail: string }) {
  return (
    <div className={`rounded-lg p-2 border text-center ${
      value ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
    }`}>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        {value ? (
          <CheckCircle2 className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
        <span className={`text-[10px] font-semibold ${value ? "text-green-500" : "text-red-500"}`}>
          {value ? "JA" : "NEIN"}
        </span>
      </div>
      <div className="text-[9px] font-medium">{label}</div>
      {detail && <div className="text-[8px] text-muted-foreground mt-0.5 font-mono tabular-nums">{detail}</div>}
    </div>
  );
}
