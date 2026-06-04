import { useState, useMemo, useCallback } from "react";
import type { StockAnalysis, MADataPoint, MACDDataPoint, OHLCVPoint } from "../../../../shared/schema";
import { SectionCard } from "../SectionCard";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, Area, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, Eye, EyeOff, Ruler, X, ChevronLeft, ChevronRight } from "lucide-react";

interface Props { data: StockAnalysis; }

const MA_LINES = [
  { key: "ma200", label: "MA200 (SMA)", color: "#ef4444", defaultOn: true },
  { key: "ma100", label: "MA100 (SMA)", color: "#f97316", defaultOn: false },
  { key: "ma50",  label: "MA50 (SMA)",  color: "#eab308", defaultOn: true },
  { key: "ma20",  label: "MA20 (SMA)",  color: "#84cc16", defaultOn: false },
  { key: "ema26", label: "EMA26",        color: "#06b6d4", defaultOn: false },
  { key: "ema12", label: "EMA12",        color: "#8b5cf6", defaultOn: false },
  { key: "ema9",  label: "EMA9",         color: "#ec4899", defaultOn: false },
] as const;
type MAKey = typeof MA_LINES[number]["key"];

const SIGNALS_PAGE_SIZE = 10;

// ─── RSI (Wilder, period=14) ────────────────────────────────────────────────
function calcRSI(closes: number[], period = 14): (number | undefined)[] {
  const rsi: (number | undefined)[] = [];
  if (closes.length < period + 1) return closes.map(() => undefined);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = 0; i < period; i++) rsi.push(undefined);
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }
  return rsi;
}

// ─── Bollinger Bands (period=20, k=2) ───────────────────────────────────────
function calcBollinger(closes: number[], period = 20, k = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return { bbMid: undefined, bbUpper: undefined, bbLower: undefined };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return { bbMid: mean, bbUpper: mean + k * std, bbLower: mean - k * std };
  });
}

export function TechnicalChart({ data }: Props) {
  const ti = data.technicalIndicators;
  const ohlcv = data.ohlcvData;

  const [visibleMAs, setVisibleMAs] = useState<Set<MAKey>>(() => {
    const s = new Set<MAKey>();
    MA_LINES.forEach(ma => { if (ma.defaultOn) s.add(ma.key); });
    return s;
  });
  const [showSignals,   setShowSignals]   = useState(true);
  const [showVolume,    setShowVolume]    = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [timeRange, setTimeRange] = useState<"3M"|"6M"|"1Y"|"2Y"|"3Y"|"5Y"|"10Y">("1Y");
  const [measureMode,   setMeasureMode]   = useState(false);
  const [measurePoints, setMeasurePoints] = useState<{date:string;close:number}[]>([]);
  const [signalPage,    setSignalPage]    = useState(0);

  const handleChartClick = useCallback((e: any) => {
    if (!measureMode || !e?.activePayload?.[0]) return;
    const p = e.activePayload[0].payload;
    if (!p?.date || p.close == null) return;
    setMeasurePoints(prev => prev.length >= 2 ? [{ date: p.date, close: p.close }] : [...prev, { date: p.date, close: p.close }]);
  }, [measureMode]);

  const measurement = useMemo(() => {
    if (measurePoints.length !== 2) return null;
    const [a, b] = measurePoints;
    const diff = b.close - a.close;
    return { a, b, diff, pct: (diff / a.close) * 100, isGain: diff >= 0 };
  }, [measurePoints]);

  if (!ti || !ohlcv || ohlcv.length === 0) {
    return (
      <SectionCard id={10} title="Technische Analyse" subtitle="Chart & Signale">
        <div className="text-center text-muted-foreground text-xs py-8">Keine OHLCV-Daten verfügbar</div>
      </SectionCard>
    );
  }

  // ── Time-range slice ────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    const cutoff = timeRange==="3M"?63:timeRange==="6M"?126:timeRange==="1Y"?252:timeRange==="2Y"?504:timeRange==="3Y"?756:timeRange==="5Y"?1260:2520;
    return {
      ma:   ti.maData.slice(-Math.min(cutoff, ti.maData.length)),
      macd: ti.macdData.slice(-Math.min(cutoff, ti.macdData.length)),
      ohlcv: ohlcv.slice(-Math.min(cutoff, ohlcv.length)),
    };
  }, [ti.maData, ti.macdData, ohlcv, timeRange]);

  // ── Bollinger + RSI (computed from filtered closes) ─────────────────────────
  const { bollingerArr, rsiArr } = useMemo(() => {
    const closes = filteredData.ma.map(d => d.close);
    return {
      bollingerArr: calcBollinger(closes),
      rsiArr:       calcRSI(closes),
    };
  }, [filteredData.ma]);

  // ── Merged chart data (date-keyed MACD + OHLCV + BB + RSI + signals) ────────
  const chartData = useMemo(() => {
    const macdByDate  = new Map<string, MACDDataPoint>();
    for (const m of filteredData.macd) macdByDate.set(m.date, m);

    const ohlcvByDate = new Map<string, OHLCVPoint>();
    for (const o of filteredData.ohlcv) ohlcvByDate.set(o.date, o);

    const chartDates = new Set(filteredData.ma.map(d => d.date));
    const signalsByDate = new Map<string, typeof ti.signals>();
    for (const s of ti.signals) {
      let tgt = s.date;
      if (!chartDates.has(tgt)) {
        const st = new Date(s.date + 'T00:00:00').getTime();
        let best = '', bestDist = Infinity;
        for (const d of filteredData.ma) {
          const dist = Math.abs(new Date(d.date + 'T00:00:00').getTime() - st);
          if (dist < bestDist) { bestDist = dist; best = d.date; }
        }
        if (bestDist <= 3 * 86400000) tgt = best; else continue;
      }
      const arr = signalsByDate.get(tgt) || [];
      arr.push(s);
      signalsByDate.set(tgt, arr);
    }

    // Normalise volume to 0-15% of price range for overlay rendering
    const allVols = filteredData.ohlcv.map(o => o.volume).filter(v => v > 0);
    const maxVol = allVols.length ? Math.max(...allVols) : 1;

    return filteredData.ma.map((d, i) => {
      const macd  = macdByDate.get(d.date)  || {};
      const ohlcvP = ohlcvByDate.get(d.date) || {} as Partial<OHLCVPoint>;
      const bb   = bollingerArr[i] || {};
      const rsi  = rsiArr[i];
      const vol  = (ohlcvP as OHLCVPoint).volume ?? 0;
      const prevClose = i > 0 ? filteredData.ma[i-1].close : d.close;
      return {
        date: d.date,
        close: d.close,
        ma200: d.ma200, ma100: d.ma100, ma50: d.ma50,
        ma20: d.ma20, ema26: d.ema26, ema12: d.ema12, ema9: d.ema9,
        macd:      (macd as MACDDataPoint).macd,
        signal:    (macd as MACDDataPoint).signal,
        histogram: (macd as MACDDataPoint).histogram,
        bbUpper: (bb as any).bbUpper,
        bbMid:   (bb as any).bbMid,
        bbLower: (bb as any).bbLower,
        rsi,
        // Volume normalised to price-chart scale (0–15% of price range)
        volume: vol,
        _volNorm: vol > 0 ? vol / maxVol : 0, // 0-1
        _volUp: d.close >= prevClose,
        _signals: signalsByDate.get(d.date) || null,
      };
    });
  }, [filteredData, ti.signals, bollingerArr, rsiArr]);

  // ── Visible signals + pagination ────────────────────────────────────────────
  const allVisibleSignals = useMemo(() => {
    if (!showSignals || chartData.length === 0) return [];
    const startDate = chartData[0].date;
    return [...ti.signals.filter(s => s.date >= startDate)].reverse(); // newest first
  }, [ti.signals, chartData, showSignals]);

  const totalSignalPages = Math.max(1, Math.ceil(allVisibleSignals.length / SIGNALS_PAGE_SIZE));
  const pagedSignals = allVisibleSignals.slice(signalPage * SIGNALS_PAGE_SIZE, (signalPage + 1) * SIGNALS_PAGE_SIZE);

  const toggleMA = (key: MAKey) => setVisibleMAs(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const cs = ti.currentStatus;

  // ── Buy-signal score (0-4) ──────────────────────────────────────────────────
  const buyScore = [
    cs.priceAboveMA200,
    cs.ma50AboveMA200,
    cs.macdAboveZero,
    cs.macdRising,
  ].filter(Boolean).length;

  const scoreColor = buyScore === 4 ? "text-green-500"
    : buyScore === 3 ? "text-yellow-400"
    : buyScore >= 1  ? "text-amber-500"
    : "text-red-500";
  const scoreBg = buyScore === 4 ? "bg-green-500/10 border-green-500/30"
    : buyScore === 3 ? "bg-yellow-400/10 border-yellow-400/30"
    : buyScore >= 1  ? "bg-amber-500/10 border-amber-500/30"
    : "bg-red-500/10 border-red-500/30";
  const scoreLabel = buyScore === 4 ? "Alle Kaufbedingungen erfüllt"
    : buyScore === 3 ? "3 / 4 Bedingungen – fast kaufbereit"
    : buyScore === 2 ? "2 / 4 Bedingungen – neutrales Umfeld"
    : buyScore === 1 ? "1 / 4 Bedingungen – klares Warnsignal"
    : "0 / 4 Bedingungen – kein Kaufsignal";

  // ── Y-axis domain for price chart ───────────────────────────────────────────
  const priceMin = Math.min(...chartData.map(d => {
    let min = d.close;
    MA_LINES.forEach(ma => { const v = d[ma.key as keyof typeof d] as number|undefined; if (v && visibleMAs.has(ma.key) && v < min) min = v; });
    if (showBollinger && d.bbLower != null && d.bbLower < min) min = d.bbLower;
    return min;
  }));
  const priceMax = Math.max(...chartData.map(d => {
    let max = d.close;
    MA_LINES.forEach(ma => { const v = d[ma.key as keyof typeof d] as number|undefined; if (v && visibleMAs.has(ma.key) && v > max) max = v; });
    if (showBollinger && d.bbUpper != null && d.bbUpper > max) max = d.bbUpper;
    return max;
  }));
  const priceRange = priceMax - priceMin;
  const pricePadding = priceRange * 0.05;

  const formatDate = (date: string) => {
    const p = date.split("-");
    return (timeRange==="2Y"||timeRange==="3Y"||timeRange==="5Y"||timeRange==="10Y")
      ? `${p[1]}/${p[0].slice(2)}`
      : `${p[1]}/${p[2]}`;
  };
  const formatDateFull = (date: string) =>
    new Date(date + "T00:00:00").toLocaleDateString("de-DE", { day:"2-digit", month:"short", year:"numeric" });

  return (
    <SectionCard id={10} title="Technische Analyse" subtitle="Interactive Chart – MA / MACD / RSI / BB / Volume">

      {/* ── Ampel-Score (0-4) ── */}
      <div className={`rounded-lg p-3 mb-3 border ${scoreBg}`}>
        <div className="flex items-center gap-3">
          {/* Score pill */}
          <div className={`text-2xl font-black font-mono ${scoreColor}`}>
            {buyScore}<span className="text-sm font-normal text-muted-foreground">/4</span>
          </div>
          <div className="flex-1">
            <div className={`text-xs font-semibold ${scoreColor}`}>{scoreLabel}</div>
            {/* Mini condition dots */}
            <div className="flex gap-2 mt-1 flex-wrap">
              {[
                { label: "Kurs > MA200", ok: cs.priceAboveMA200 },
                { label: "MA50 > MA200", ok: cs.ma50AboveMA200 },
                { label: "MACD > 0",     ok: cs.macdAboveZero },
                { label: "MACD ↑",       ok: cs.macdRising },
              ].map(c => (
                <span key={c.label} className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border ${
                  c.ok ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}>
                  {c.ok ? "✓" : "✗"} {c.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        {!cs.priceAboveMA200 && (
          <div className="mt-2 text-[9px] text-red-400 font-medium">
            ⚠ MA200-Break: historischer Max-Drawdown +15-20% (defensiv) bzw. +35-50% (Beta &gt;1.5) einkalkulieren
          </div>
        )}
      </div>

      {/* ── Status pills (4 Bedingungen) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatusPill label="Kurs > MA200" value={cs.priceAboveMA200} detail={cs.ma200Value ? `MA200: $${cs.ma200Value.toFixed(2)}` : ""} />
        <StatusPill label="MA50 > MA200"  value={cs.ma50AboveMA200}  detail={cs.ma50Value  ? `MA50: $${cs.ma50Value.toFixed(2)}`   : ""} />
        <StatusPill label="MACD > 0"      value={cs.macdAboveZero}   detail={cs.macdValue  !== undefined ? `MACD: ${cs.macdValue.toFixed(4)}`    : ""} />
        <StatusPill label="MACD steigend" value={cs.macdRising}      detail={cs.signalValue!== undefined ? `Signal: ${cs.signalValue.toFixed(4)}` : ""} />
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Time range */}
        <div className="flex rounded-md border border-border overflow-hidden">
          {(["3M","6M","1Y","2Y","3Y","5Y","10Y"] as const).map(r => (
            <button key={r} onClick={() => { setTimeRange(r); setSignalPage(0); }}
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                timeRange===r ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"
              }`}>
              {r}
            </button>
          ))}
        </div>

        {/* MA toggles */}
        <div className="flex flex-wrap gap-1">
          {MA_LINES.map(ma => (
            <button key={ma.key} onClick={() => toggleMA(ma.key)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                visibleMAs.has(ma.key) ? "border-current opacity-100" : "border-border opacity-40 hover:opacity-60"
              }`}
              style={{ color: ma.color }}>
              {visibleMAs.has(ma.key) ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              {ma.label}
            </button>
          ))}
        </div>

        {/* Bollinger toggle */}
        <button onClick={() => setShowBollinger(v => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
            showBollinger ? "border-violet-400 text-violet-400" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
          }`}>
          {showBollinger ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
          BB(20,2)
        </button>

        {/* Volume toggle */}
        <button onClick={() => setShowVolume(v => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
            showVolume ? "border-sky-400 text-sky-400" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
          }`}>
          {showVolume ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
          Volumen
        </button>

        {/* Signals toggle */}
        <button onClick={() => setShowSignals(v => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
            showSignals ? "border-primary text-primary" : "border-border text-muted-foreground opacity-50"
          }`}>
          {showSignals ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
          Signale
        </button>

        {/* Measure tool */}
        <button onClick={() => { setMeasureMode(v => !v); setMeasurePoints([]); }}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
            measureMode ? "border-amber-500 text-amber-500 bg-amber-500/10" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
          }`}>
          <Ruler className="w-2.5 h-2.5"/>
          Messen
        </button>
      </div>

      {/* Measure result bar */}
      {measureMode && (
        <div className={`rounded-lg p-2.5 mb-3 border text-[10px] flex items-center justify-between ${
          measurement
            ? measurement.isGain ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
            : "bg-amber-500/10 border-amber-500/30"
        }`}>
          <div className="flex items-center gap-2">
            <Ruler className="w-3.5 h-3.5 text-amber-500 shrink-0"/>
            {!measurement ? (
              <span className="text-muted-foreground">
                {measurePoints.length===0 ? "Klicke auf den Chart um Punkt A zu setzen" : "Klicke auf den Chart um Punkt B zu setzen"}
                {measurePoints.length===1 && <span className="ml-1.5 font-mono text-foreground">A: {formatDateFull(measurePoints[0].date)} — ${measurePoints[0].close.toFixed(2)}</span>}
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-muted-foreground">{formatDateFull(measurement.a.date)} → {formatDateFull(measurement.b.date)}</span>
                <span className={`font-bold font-mono text-sm ${measurement.isGain?"text-emerald-500":"text-red-500"}`}>
                  {measurement.isGain?"+":""}{measurement.diff.toFixed(2)} ({measurement.isGain?"+":""}{measurement.pct.toFixed(2)}%) {measurement.isGain?"↑":"↓"}
                </span>
                <span className="text-muted-foreground font-mono">${measurement.a.close.toFixed(2)} → ${measurement.b.close.toFixed(2)}</span>
              </div>
            )}
          </div>
          <button onClick={() => { setMeasurePoints([]); setMeasureMode(false); }} className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground shrink-0">
            <X className="w-3.5 h-3.5"/>
          </button>
        </div>
      )}

      {/* Golden / Death Cross banner */}
      {(() => {
        const maData = ti.maData;
        let lastCrossType: 'golden'|'death'|null = null, lastCrossDate = '';
        const lookback = Math.min(504, maData.length - 1);
        for (let i = maData.length - 1; i >= maData.length - lookback; i--) {
          const cur = maData[i], prev = maData[i-1];
          if (cur.ma50 && cur.ma200 && prev.ma50 && prev.ma200) {
            if (cur.ma50 > cur.ma200 && prev.ma50 <= prev.ma200) { lastCrossType='golden'; lastCrossDate=cur.date; break; }
            if (cur.ma50 < cur.ma200 && prev.ma50 >= prev.ma200) { lastCrossType='death';  lastCrossDate=cur.date; break; }
          }
        }
        if (!lastCrossType) return null;
        const isGolden = lastCrossType === 'golden';
        const crossDate = new Date(lastCrossDate + 'T00:00:00');
        const dateStr = crossDate.toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric'});
        const daysAgo = Math.round((Date.now() - crossDate.getTime()) / 86400000);
        return (
          <div className={`rounded-lg p-3 mb-3 border flex items-center gap-3 ${
            isGolden ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
          }`}>
            <div className={`text-2xl font-bold ${isGolden?"text-emerald-500":"text-red-500"}`}>{isGolden?"✦":"✕"}</div>
            <div>
              <div className={`text-sm font-bold ${isGolden?"text-emerald-500":"text-red-500"}`}>
                {isGolden?"GOLDEN CROSS":"DEATH CROSS"}
                <span className="text-xs font-normal text-muted-foreground ml-1.5">({dateStr} — vor {daysAgo} Tagen)</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {isGolden
                  ? `MA50 kreuzte MA200 von unten nach oben — bullisches Trendsignal. Aktiv seit ${daysAgo} Tagen.`
                  : `MA50 kreuzte MA200 von oben nach unten — bärisches Trendsignal. Struktureller Abwärtstrend seit ${daysAgo} Tagen.`}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Price Chart (MA + BB + Volume overlay) ── */}
      <div className={`h-[320px] sm:h-[380px] w-full ${measureMode?'cursor-crosshair':''}`} data-testid="chart-price-ma">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{top:5,right:10,left:0,bottom:5}} onClick={handleChartClick}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3}/>
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{fontSize:9,fill:"var(--muted-foreground)"}} interval={Math.floor(chartData.length/8)} axisLine={{stroke:"var(--border)"}}/>
            <YAxis yAxisId="price" domain={[priceMin-pricePadding, priceMax+pricePadding]} tick={{fontSize:9,fill:"var(--muted-foreground)"}} tickFormatter={(v:number)=>`$${v.toFixed(0)}`} width={52} axisLine={{stroke:"var(--border)"}}/>
            {/* Hidden right axis for volume normalisation */}
            <YAxis yAxisId="vol" hide domain={[0,1]} orientation="right"/>

            <Tooltip content={({ active, payload }) => {
              if (!active||!payload?.length) return null;
              const dp = payload[0]?.payload;
              if (!dp) return null;
              let sigs: any[] = [];
              if (showSignals) {
                const idx = chartData.findIndex(d => d.date===dp.date);
                if (idx>=0) {
                  for (let off=-2;off<=2;off++) {
                    const nb = chartData[idx+off];
                    if (nb?._signals) for (const s of nb._signals) if (!sigs.some(e=>e.date===s.date&&e.reason===s.reason)) sigs.push(s);
                  }
                }
              }
              const bbWidth = dp.bbUpper!=null&&dp.bbLower!=null ? (dp.bbUpper-dp.bbLower).toFixed(2) : null;
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px] min-w-[160px]">
                  <div className="font-semibold mb-1">{formatDateFull(dp.date)}</div>
                  <div className="flex justify-between gap-3"><span className="text-primary">Kurs</span><span className="font-mono">${dp.close.toFixed(2)}</span></div>
                  {showVolume && dp.volume>0 && <div className="flex justify-between gap-3"><span className="text-sky-400">Volumen</span><span className="font-mono">{(dp.volume/1e6).toFixed(2)}M</span></div>}
                  {showBollinger && dp.bbUpper!=null && (
                    <>
                      <div className="flex justify-between gap-3"><span className="text-violet-400">BB Upper</span><span className="font-mono">${dp.bbUpper.toFixed(2)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-violet-300">BB Mid</span><span className="font-mono">${dp.bbMid?.toFixed(2)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-violet-400">BB Lower</span><span className="font-mono">${dp.bbLower?.toFixed(2)}</span></div>
                      {bbWidth && <div className="flex justify-between gap-3"><span className="text-muted-foreground">BB Breite</span><span className="font-mono">${bbWidth}</span></div>}
                    </>
                  )}
                  {payload.filter((p:any)=>p.yAxisId==="price"&&!['close','bbUpper','bbMid','bbLower'].includes(p.dataKey)).map((p:any)=>(
                    <div key={p.dataKey} className="flex justify-between gap-3">
                      <span style={{color:p.color}}>{p.name}</span>
                      <span className="font-mono">${Number(p.value).toFixed(2)}</span>
                    </div>
                  ))}
                  {sigs.map((s,i) => (
                    <div key={i} className={`mt-1 pt-1 border-t border-border font-semibold ${s.type==="buy"?"text-green-400":"text-red-400"}`}>
                      {s.type==="buy"?"▲ BUY":"▼ SELL"}: {s.reason}
                    </div>
                  ))}
                </div>
              );
            }}/>

            {/* Volume overlay bars (normalised to 0–15% of price range) */}
            {showVolume && chartData.map((d, i) => {
              // Render via a transparent Bar + custom shape approach
              return null; // rendered below via <Bar>
            })}
            {showVolume && (
              <Bar yAxisId="vol" dataKey="_volNorm" name="Volumen" isAnimationActive={false} maxBarSize={8}
                shape={(props: any) => {
                  const { x, y, width, height, payload } = props;
                  // Scale vol bar to max 15% of chart height (chart height ~320px → 48px max)
                  const fillColor = payload._volUp ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
                  return <rect x={x} y={y} width={Math.max(width,1)} height={Math.abs(height)} fill={fillColor}/>;
                }}
              />
            )}

            {/* Price line */}
            <Line yAxisId="price" type="monotone" dataKey="close" name="Kurs" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false}/>

            {/* MA lines */}
            {MA_LINES.map(ma => visibleMAs.has(ma.key) && (
              <Line key={ma.key} yAxisId="price" type="monotone" dataKey={ma.key} name={ma.label} stroke={ma.color} strokeWidth={1.5} dot={false} strokeDasharray={ma.key.startsWith("ema")?"4 2":undefined} connectNulls isAnimationActive={false}/>
            ))}

            {/* Bollinger Bands */}
            {showBollinger && (
              <>
                <Area yAxisId="price" type="monotone" dataKey="bbUpper" name="BB Upper" stroke="#7c3aed" strokeWidth={1} strokeDasharray="3 2" fill="rgba(124,58,237,0.05)" dot={false} connectNulls isAnimationActive={false} legendType="none"/>
                <Line yAxisId="price" type="monotone" dataKey="bbMid"   name="BB Mid"   stroke="#a78bfa" strokeWidth={1} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false}/>
                <Area yAxisId="price" type="monotone" dataKey="bbLower" name="BB Lower" stroke="#7c3aed" strokeWidth={1} strokeDasharray="3 2" fill="rgba(124,58,237,0.05)" dot={false} connectNulls isAnimationActive={false} legendType="none"/>
              </>
            )}

            {/* Signal reference lines */}
            {showSignals && allVisibleSignals.map((s,i) => (
              <ReferenceLine key={`sig-${i}`} yAxisId="price" x={s.date} stroke={s.type==="buy"?"#22c55e":"#ef4444"} strokeDasharray="2 2" strokeWidth={0.8} opacity={0.5}/>
            ))}

            {/* Measurement overlay */}
            {measurePoints.length>=1 && (
              <ReferenceLine yAxisId="price" x={measurePoints[0].date} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5} label={{value:"A",position:"top",fontSize:10,fill:"#f59e0b",fontWeight:700}}/>
            )}
            {measurement && (
              <>
                <ReferenceArea yAxisId="price" x1={measurement.a.date} x2={measurement.b.date} fill={measurement.isGain?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)"} stroke={measurement.isGain?"#10b981":"#ef4444"} strokeDasharray="4 3" strokeWidth={1}/>
                <ReferenceLine yAxisId="price" x={measurement.b.date} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5} label={{value:"B",position:"top",fontSize:10,fill:"#f59e0b",fontWeight:700}}/>
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── MACD Chart ── */}
      <div className="mt-2 text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
        MACD(12,26,9) <span className="text-[9px] opacity-60">= EMA₁₂ - EMA₂₆ | Signal = EMA₉(MACD) | Histogram = MACD - Signal</span>
      </div>
      <div className="h-[130px] sm:h-[150px] w-full" data-testid="chart-macd">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{top:4,right:10,left:0,bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3}/>
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{fontSize:9,fill:"var(--muted-foreground)"}} interval={Math.floor(chartData.length/8)} axisLine={{stroke:"var(--border)"}}/>
            <YAxis tick={{fontSize:9,fill:"var(--muted-foreground)"}} width={52} axisLine={{stroke:"var(--border)"}} tickFormatter={(v:number)=>v.toFixed(1)}/>
            <Tooltip content={({ active, payload, label }) => {
              if (!active||!payload?.length) return null;
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                  <div className="font-semibold mb-1">{formatDateFull(label)}</div>
                  {payload.map((p:any) => <div key={p.dataKey} className="flex justify-between gap-3"><span style={{color:p.color}}>{p.name}</span><span className="font-mono">{Number(p.value).toFixed(4)}</span></div>)}
                </div>
              );
            }}/>
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={0.5}/>
            <Bar dataKey="histogram" name="Histogram" isAnimationActive={false}
              shape={(props:any) => {
                const {x,y,width,height,payload} = props;
                return <rect x={x} y={y} width={Math.max(width,1)} height={Math.abs(height)} fill={(payload?.histogram??0)>=0?"rgba(34,197,94,0.5)":"rgba(239,68,68,0.5)"}/>;
              }}
            />
            <Line type="monotone" dataKey="macd"   name="MACD"   stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false}/>
            <Line type="monotone" dataKey="signal" name="Signal" stroke="#f97316" strokeWidth={1} strokeDasharray="3 2" dot={false} connectNulls isAnimationActive={false}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── RSI(14) Chart ── */}
      <div className="mt-2 text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
        RSI(14)
        <span className="text-[9px] opacity-60">
          | &lt;30 überverkauft · &gt;70 überkauft
        </span>
      </div>
      <div className="h-[110px] sm:h-[130px] w-full" data-testid="chart-rsi">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{top:4,right:10,left:0,bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3}/>
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{fontSize:9,fill:"var(--muted-foreground)"}} interval={Math.floor(chartData.length/8)} axisLine={{stroke:"var(--border)"}}/>
            <YAxis domain={[0,100]} ticks={[0,30,50,70,100]} tick={{fontSize:9,fill:"var(--muted-foreground)"}} width={52} axisLine={{stroke:"var(--border)"}} tickFormatter={(v:number)=>v.toFixed(0)}/>
            <Tooltip content={({ active, payload, label }) => {
              if (!active||!payload?.length) return null;
              const rsiVal = payload[0]?.value;
              const zone = rsiVal==null ? '' : rsiVal >= 70 ? ' — überkauft 🔴' : rsiVal <= 30 ? ' — überverkauft 🟢' : '';
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                  <div className="font-semibold mb-1">{formatDateFull(label)}</div>
                  <div className="flex justify-between gap-3"><span className="text-amber-400">RSI(14)</span><span className="font-mono">{Number(rsiVal).toFixed(2)}{zone}</span></div>
                </div>
              );
            }}/>
            {/* Overbought / Oversold shading */}
            <ReferenceArea y1={70} y2={100} fill="rgba(239,68,68,0.07)" ifOverflow="hidden"/>
            <ReferenceArea y1={0}  y2={30}  fill="rgba(34,197,94,0.07)" ifOverflow="hidden"/>
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={0.8} opacity={0.7} label={{value:"70",position:"right",fontSize:8,fill:"#ef4444"}}/>
            <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="4 3" strokeWidth={0.5} opacity={0.4}/>
            <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 3" strokeWidth={0.8} opacity={0.7} label={{value:"30",position:"right",fontSize:8,fill:"#22c55e"}}/>
            <Line type="monotone" dataKey="rsi" name="RSI(14)" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Signals Table with Pagination ── */}
      {allVisibleSignals.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-medium text-muted-foreground">
              Letzte Signale ({allVisibleSignals.length} im Zeitraum)
            </div>
            {totalSignalPages > 1 && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <button
                  onClick={() => setSignalPage(p => Math.max(0, p-1))}
                  disabled={signalPage === 0}
                  className="p-0.5 rounded hover:bg-muted/60 disabled:opacity-30">
                  <ChevronLeft className="w-3.5 h-3.5"/>
                </button>
                <span className="font-mono tabular-nums px-1">Seite {signalPage+1} / {totalSignalPages}</span>
                <button
                  onClick={() => setSignalPage(p => Math.min(totalSignalPages-1, p+1))}
                  disabled={signalPage >= totalSignalPages-1}
                  className="p-0.5 rounded hover:bg-muted/60 disabled:opacity-30">
                  <ChevronRight className="w-3.5 h-3.5"/>
                </button>
              </div>
            )}
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
                {pagedSignals.map((s, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono tabular-nums">{s.date}</td>
                    <td className="py-1 pr-2">
                      <span className={`inline-flex items-center gap-0.5 font-semibold ${
                        s.type==="buy"?"text-green-500":"text-red-500"
                      }`}>
                        {s.type==="buy"?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}
                        {s.type==="buy"?"BUY":"SELL"}
                      </span>
                    </td>
                    <td className={`py-1 pr-2 ${
                      s.reason.includes('Death')        ? 'font-bold text-red-500'
                      : s.reason.includes('Golden Cross') ? 'font-bold text-emerald-500'
                      : s.reason.includes('Bearish')      ? 'text-red-500'
                      : s.reason.includes('Bullish')      ? 'text-emerald-500' : ''
                    }`}>{s.reason}</td>
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
        RSI(14) berechnet via Wilder-EMA. BB(20,2) = SMA₂₀ ± 2σ.
      </div>
    </SectionCard>
  );
}

function StatusPill({ label, value, detail }: { label: string; value: boolean; detail: string }) {
  return (
    <div className={`rounded-lg p-2 border text-center ${
      value ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
    }`}>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        {value ? <CheckCircle2 className="w-3 h-3 text-green-500"/> : <XCircle className="w-3 h-3 text-red-500"/>}
        <span className={`text-[10px] font-semibold ${value?"text-green-500":"text-red-500"}`}>{value?"JA":"NEIN"}</span>
      </div>
      <div className="text-[9px] font-medium">{label}</div>
      {detail && <div className="text-[8px] text-muted-foreground mt-0.5 font-mono tabular-nums">{detail}</div>}
    </div>
  );
}
