import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { Fragment, useMemo, useState } from "react";
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, ReferenceDot, ComposedChart, Bar,
} from "recharts";
import {
  CheckCircle2, AlertTriangle, Eye, EyeOff, TrendingUp, TrendingDown,
} from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { TaStatusPill } from "@/components/sections/TaStatusPill";
import { TaPlotScroll, TaVolumeBand } from "@/components/sections/TaPlotFrame";
import { useIsNarrow } from "@/hooks/use-mobile";
import { TA_OSC_MIN_PX, axisTick, narrowPriceTicks, taChartMinWidth, xAxisIntervalProps } from "@/lib/taChartScale";
import { buildGoldTechnical, describeRelativeRsi, volumeLegendText, type GoldTechPoint } from "./goldTechnical";

/**
 * Gold Section 2 im Design von BTC Section 11 „Technische Analyse“
 * (Future_10 §4 / §7, Philip LOCKED): vier JA/NEIN-Karten, Kaufsignal-Box,
 * MA200-Break-Warnung, Cross-Banner, Zeitfenster 3M–5Y, MA/EMA-Chips,
 * Signale, Volumen, Makro-Overlays (nur echte FRED-Daten), Messen, MACD, RSI.
 * 50-DMA und Golden/Death-Marker aus #201 (goldChartMa.ts) bleiben.
 */

interface Props { data: GoldAnalysis }

// Farben und Labels 1:1 aus BTCDashboard MA_LINES.
const MA_LINES = [
  { key: "ma200", label: "MA200 (SMA)", color: "#ef4444", defaultOn: true },
  { key: "ma100", label: "MA100 (SMA)", color: "#f97316", defaultOn: false },
  { key: "ma50", label: "MA50 (SMA)", color: "#eab308", defaultOn: true },
  { key: "ma20", label: "MA20 (SMA)", color: "#84cc16", defaultOn: false },
  { key: "ema26", label: "EMA26", color: "#06b6d4", defaultOn: false },
  { key: "ema12", label: "EMA12", color: "#8b5cf6", defaultOn: false },
  { key: "ema9", label: "EMA9", color: "#ec4899", defaultOn: false },
] as const;

// Makro-Overlays (Future_10 §7). Real10Y Standard AN, Rest manuell.
const MACRO = [
  { key: "real10y", label: "Real10Y", name: "Real10Y (DFII10)", color: "#38bdf8", defaultOn: true, unit: "%", width: 44, step: false, title: "Realzins (DFII10, FRED)" },
  { key: "m2Yoy", label: "M2 YoY", name: "M2 YoY (M2SL)", color: "#a78bfa", defaultOn: false, unit: "%", width: 44, step: true, title: "US-M2-Wachstum YoY (FRED M2SL)" },
  { key: "dxy", label: "DXY", name: "DXY (DTWEXBGS)", color: "#34d399", defaultOn: false, unit: "", width: 44, step: false, title: "Broad Dollar Index (FRED DTWEXBGS)" },
  { key: "t10yie", label: "Breakeven", name: "Breakeven (T10YIE)", color: "#f472b6", defaultOn: false, unit: "%", width: 44, step: false, title: "10J-Breakeven-Inflation (FRED T10YIE)" },
  { key: "walcl", label: "WALCL", name: "Fed-Bilanz (WALCL)", color: "#e2e8f0", defaultOn: false, unit: "T", width: 54, step: true, title: "Fed-Bilanzsumme in Bio. USD (FRED WALCL)" },
] as const;

type MAKey = typeof MA_LINES[number]["key"];
type MacroKey = typeof MACRO[number]["key"];
type TimeRange = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y";

const fmtMacro = (key: MacroKey, v: number) =>
  key === "walcl" ? `$${v.toFixed(2)}T` : key === "dxy" ? v.toFixed(1) : `${v.toFixed(2)}%`;

export function GoldPriceChart({ data }: Props) {
  const narrow = useIsNarrow();
  const tech = useMemo(() => buildGoldTechnical(data.historicalPrices ?? []), [data.historicalPrices]);
  const fullChart = tech.points;

  const [visibleMAs, setVisibleMAs] = useState<Set<MAKey>>(() => new Set(MA_LINES.filter(m => m.defaultOn).map(m => m.key)));
  const [visibleMacro, setVisibleMacro] = useState<Set<MacroKey>>(() => new Set(MACRO.filter(m => m.defaultOn).map(m => m.key)));
  const [showSignals, setShowSignals] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>("1Y");
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureStart, setMeasureStart] = useState<{ date: string; price: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ date: string; price: number } | null>(null);

  const filteredData = useMemo(() => {
    if (fullChart.length === 0) return [];
    const daysCutoff: Record<TimeRange, number> = { "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "3Y": 1095, "5Y": 1825 };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysCutoff[timeRange]);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return fullChart.filter(d => d.date >= cutoffStr);
  }, [fullChart, timeRange]);

  // Downsampling wie BTC (max ~500 Punkte). Cross-Tage bleiben erhalten,
  // damit die #201-Marker nicht aus dem Plot fallen.
  const chartData = useMemo(() => {
    if (filteredData.length <= 500) return filteredData;
    const step = Math.ceil(filteredData.length / 500);
    const result = filteredData.filter((d, i) => i % step === 0 || d.cross || d.volSpike || d.volDivergence);
    if (result[result.length - 1] !== filteredData[filteredData.length - 1]) result.push(filteredData[filteredData.length - 1]);
    return result;
  }, [filteredData]);

  const hasMacro = useMemo(() => {
    const out = {} as Record<MacroKey, boolean>;
    for (const m of MACRO) out[m.key] = chartData.some(d => d[m.key] != null);
    return out;
  }, [chartData]);

  const macroDomain = useMemo(() => {
    const out = {} as Record<MacroKey, [number, number]>;
    for (const m of MACRO) {
      const vals = chartData.map(d => d[m.key]).filter((v): v is number => v != null);
      if (vals.length === 0) { out[m.key] = [0, 1]; continue; }
      const min = Math.min(...vals), max = Math.max(...vals);
      const padding = Math.max((max - min) * 0.15, m.key === "dxy" ? 1 : 0.2);
      out[m.key] = [+(min - padding).toFixed(2), +(max + padding).toFixed(2)];
    }
    return out;
  }, [chartData]);

  const activeMacro = MACRO.filter(m => visibleMacro.has(m.key) && hasMacro[m.key]);

  const chartDataWithVol = useMemo(() => {
    const rawVols = chartData.map(d => d.volume ?? 0);
    const maxVol = Math.max(...rawVols, 0);
    return chartData.map((d, i) => ({
      ...d,
      _volNorm: maxVol > 0 ? (d.volume ?? 0) / maxVol : 0,
      _volUp: i === 0 ? true : d.price >= chartData[i - 1].price,
    }));
  }, [chartData]);
  const hasVolume = chartDataWithVol.some(d => d._volNorm > 0);

  // #208 Server-Signale (technicalSignals). Marker nur, wenn das Server-Signal
  // verfuegbar ist UND echtes Volumen im Chart liegt — sonst N/A-Hinweis.
  const serverSig = (id: string) => data.technicalSignals?.find(s => s.id === id) ?? null;
  const sigSpike = serverSig("technical.volumeSpike");
  const sigDiv = serverSig("technical.volumeDivergence");
  const sigRsi = serverSig("technical.rsi");
  const spikeOn = hasVolume && !!sigSpike?.available;
  const divOn = hasVolume && !!sigDiv?.available;
  const volMarkers = chartDataWithVol.filter(d => (spikeOn && d.volSpike) || (divOn && d.volDivergence));
  const sigNote = (label: string, sig: typeof sigSpike, on: boolean) =>
    on ? volumeLegendText(label, sig!.detail) : `${label}: N/A — ${!hasVolume ? "kein echtes Volumen" : sig ? volumeLegendText("", sig.detail).replace(/^: /, "") : "Server-Signal fehlt"}`;
  const relRsi = describeRelativeRsi(tech.rsiPercentile, tech.rsiHistoryDays, sigRsi?.available ? sigRsi.z : null);

  const visibleSignals = useMemo(() => {
    if (!showSignals || chartData.length === 0) return [];
    const startDate = chartData[0].date;
    return tech.signals.filter(s => s.date >= startDate);
  }, [tech.signals, chartData, showSignals]);

  const toggleSet = <K,>(setter: React.Dispatch<React.SetStateAction<Set<K>>>, key: K) =>
    setter(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const bc = tech.bullConditions;
  const isBuySignal = bc.priceAboveMA200 && bc.ma50AboveMA200 && bc.macdAboveZero && bc.macdRising;

  const yDomain = useMemo(() => {
    let minVal = Infinity, maxVal = -Infinity;
    for (const d of chartData) {
      if (d.price > 0) { minVal = Math.min(minVal, d.price); maxVal = Math.max(maxVal, d.price); }
      for (const ma of MA_LINES) {
        if (!visibleMAs.has(ma.key)) continue;
        const v = d[ma.key];
        if (v && v > 0) { minVal = Math.min(minVal, v); maxVal = Math.max(maxVal, v); }
      }
    }
    if (!isFinite(minVal) || !isFinite(maxVal) || maxVal <= 0) return [0, 5000] as [number, number];
    const padding = (maxVal - minVal) * 0.05;
    return [Math.max(0, minVal - padding), maxVal + padding] as [number, number];
  }, [chartData, visibleMAs]);

  const formatDate = (date: string) => {
    const parts = date.split("-");
    if (timeRange === "2Y" || timeRange === "3Y" || timeRange === "5Y") return `${parts[1]}/${parts[0].slice(2)}`;
    return `${parts[1]}/${parts[2]}`;
  };
  const formatDateFull = (date: string) =>
    new Date(date + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  const formatYAxis = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`);

  // Cross-Banner wie BTC: letztes Cross der letzten 2 Jahre + drohendes Death Cross.
  const crossInfo = useMemo(() => {
    if (fullChart.length < 2) return null;
    let lastCross: { type: "golden" | "death"; date: string } | null = null;
    const lookback = Math.min(730, fullChart.length - 1);
    for (let i = fullChart.length - 1; i >= fullChart.length - lookback; i--) {
      const cur = fullChart[i], prev = fullChart[i - 1];
      if (cur.ma50 && cur.ma200 && prev.ma50 && prev.ma200) {
        if (cur.ma50 > cur.ma200 && prev.ma50 <= prev.ma200) { lastCross = { type: "golden", date: cur.date }; break; }
        if (cur.ma50 < cur.ma200 && prev.ma50 >= prev.ma200) { lastCross = { type: "death", date: cur.date }; break; }
      }
    }
    const latest = fullChart[fullChart.length - 1];
    const prev30 = fullChart.length > 30 ? fullChart[fullChart.length - 31] : null;
    if (latest?.ma50 && latest?.ma200 && prev30?.ma50 && prev30?.ma200) {
      const gap = latest.ma50 - latest.ma200;
      const gapPrev = prev30.ma50 - prev30.ma200;
      const gapPct = (gap / latest.ma200) * 100;
      const isConverging = gap > 0 && gap < gapPrev;
      const priceBelowBoth = latest.price < latest.ma50 && latest.price < latest.ma200;
      if (priceBelowBoth && isConverging && gapPct < 25) {
        return { type: "imminent_death" as const, date: lastCross?.date || "", lastCross, gapPct };
      }
    }
    return lastCross ? { ...lastCross, lastCross, gapPct: undefined } : null;
  }, [fullChart]);

  // Mobile: höchstens eine volle rechte Achse (BTC-Regel), Rest im Tooltip.
  const primaryMacro = narrow ? activeMacro[0]?.key ?? null : null;
  const macroAxisHidden = (key: MacroKey) => narrow && primaryMacro !== key;
  const visibleRightWidth = primaryMacro ? MACRO.find(m => m.key === primaryMacro)!.width : 0;
  const desktopRightAxes = narrow ? 0 : activeMacro.reduce((s, m) => s + m.width, 0);
  const plotMinWidth = narrow ? taChartMinWidth(55, visibleRightWidth, 8) : taChartMinWidth(55, desktopRightAxes, 106);
  const hiddenMacroSeries = narrow ? activeMacro.filter(m => m.key !== primaryMacro) : [];
  const priceMargin = narrow ? { top: 5, right: 8, left: 0, bottom: 5 } : { top: 5, right: 106, left: 0, bottom: 5 };
  const xTick = axisTick(narrow, 9, "var(--muted-foreground)");
  const xInterval = xAxisIntervalProps(narrow, Math.floor(chartData.length / 8));
  const chipCls = "inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-0 sm:py-0.5 sm:text-[10px]";

  if (fullChart.length === 0) {
    return (
      <SectionCard number={2} title="Gold-Preis-Chart · Technische Analyse">
        <div className="text-xs text-muted-foreground text-center py-8">Keine Preisdaten verfügbar</div>
      </SectionCard>
    );
  }

  const usd = (v: number | null) => (v != null ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "");

  return (
    <SectionCard number={2} title="Gold-Preis-Chart · Technische Analyse">
      <div data-testid="gold-ta">
      {/* Status bar — 4 pills (BTC-Komponente) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" data-testid="gold-ta-pills">
        <TaStatusPill label="Kurs > MA200" value={bc.priceAboveMA200} detail={tech.currentMA200 ? `MA200: ${usd(tech.currentMA200)}` : ""} />
        <TaStatusPill label="MA50 > MA200" value={bc.ma50AboveMA200} detail={tech.currentMA50 ? `MA50: ${usd(tech.currentMA50)}` : ""} />
        <TaStatusPill label="MACD > 0" value={bc.macdAboveZero} detail={tech.currentMACD !== null ? `MACD: ${tech.currentMACD.toFixed(2)}` : ""} />
        <TaStatusPill label="MACD steigend" value={bc.macdRising} detail={tech.currentSignal !== null ? `Signal: ${tech.currentSignal.toFixed(2)}` : ""} />
      </div>

      {/* Buy/Sell verdict */}
      <div className={`rounded-lg p-3 mb-4 border ${isBuySignal ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`} data-testid="gold-ta-verdict">
        <div className="flex items-center gap-2">
          {isBuySignal ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
          <span className="text-xs font-semibold">
            {isBuySignal
              ? "BUY-Bedingungen erfüllt: Kurs > MA200 AND MA50 > MA200 AND MACD > 0 + steigend"
              : "KEIN Kaufsignal – nicht alle Bedingungen erfüllt"}
          </span>
        </div>
        {!isBuySignal && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Fehlend: {[
              !bc.priceAboveMA200 && "Kurs < MA200",
              !bc.ma50AboveMA200 && "MA50 < MA200",
              !bc.macdAboveZero && "MACD < 0",
              !bc.macdRising && "MACD fallend",
            ].filter(Boolean).join(" | ")}
          </div>
        )}
        {!bc.priceAboveMA200 && (
          <div className="mt-1 text-[10px] text-red-400 font-medium">
            ⚠ MA200-Break-Warnung: Historischer Max-Drawdown zzgl. 15-20% (defensiv) bzw. 35-50% (Beta &gt;1.5) einkalkulieren
          </div>
        )}
      </div>

      {/* Golden / Death / drohendes Death Cross */}
      {crossInfo && (() => {
        if (crossInfo.type === "imminent_death") {
          const gapStr = crossInfo.gapPct !== undefined ? crossInfo.gapPct.toFixed(1) : "?";
          const lastCrossDate = crossInfo.lastCross?.date ? formatDateFull(crossInfo.lastCross.date) : null;
          return (
            <div className="rounded-lg p-3 mb-3 border flex items-center gap-3 bg-red-500/10 border-red-500/30" data-testid="gold-cross-banner">
              <div className="text-2xl font-bold text-red-500 animate-pulse">⚠</div>
              <div>
                <div className="text-sm font-bold text-red-500">
                  DROHENDES DEATH CROSS
                  <span className="text-xs font-normal text-muted-foreground ml-1.5">(MA50/MA200-Abstand: {gapStr}% — konvergierend)</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  MA50 fällt Richtung MA200 — Kurs unter beiden MAs. Bei Kreuzung = Death Cross (bärisches Struktursignal).
                  {lastCrossDate && crossInfo.lastCross?.type === "golden" ? ` Letztes Golden Cross am ${lastCrossDate} wird zunehmend neutralisiert.` : ""}
                </div>
              </div>
            </div>
          );
        }
        const isGolden = crossInfo.type === "golden";
        const crossDateObj = new Date(crossInfo.date + "T00:00:00");
        const dateStr = formatDateFull(crossInfo.date);
        const daysAgo = Math.round((Date.now() - crossDateObj.getTime()) / (1000 * 60 * 60 * 24));
        const isRecent = daysAgo <= 60;
        return (
          <div className={`rounded-lg p-3 mb-3 border flex items-center gap-3 ${isGolden ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`} data-testid="gold-cross-banner">
            <div className={`text-2xl font-bold ${isGolden ? "text-emerald-500" : "text-red-500"}`}>{isGolden ? "\u2726" : "\u2715"}</div>
            <div>
              <div className={`text-sm font-bold ${isGolden ? "text-emerald-500" : "text-red-500"}`}>
                {isGolden ? "GOLDEN CROSS" : "DEATH CROSS"}
                <span className="text-xs font-normal text-muted-foreground ml-1.5">
                  ({dateStr}{isRecent ? " — kürzlich" : ` — vor ${daysAgo} Tagen`})
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {isGolden
                  ? `MA50 kreuzte MA200 von unten nach oben am ${dateStr} — bullisches Trendsignal.${!isRecent ? ` Strukturelles Signal aktiv seit ${daysAgo} Tagen.` : ""}`
                  : `MA50 kreuzte MA200 von oben nach unten am ${dateStr} — bärisches Trendsignal.${!isRecent ? ` Struktureller Abwärtstrend seit ${daysAgo} Tagen.` : ""}`}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Controls — Preset → MAs → Signale/Volumen */}
      <div className="mb-3 flex max-w-full flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <div className="flex max-w-full flex-wrap gap-1.5 sm:flex-nowrap sm:gap-0 sm:overflow-hidden sm:rounded-md sm:border sm:border-border" data-testid="gold-presets">
          {(["3M", "6M", "1Y", "2Y", "3Y", "5Y"] as const).map(r => (
            <button
              key={r}
              onClick={() => { setTimeRange(r); setMeasureStart(null); setMeasureEnd(null); }}
              className={`min-h-9 shrink-0 rounded-md border border-border px-2.5 text-[11px] font-medium transition-colors sm:min-h-0 sm:rounded-none sm:border-0 sm:py-1 sm:text-[10px] ${
                timeRange === r ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex max-w-full flex-wrap gap-1.5 sm:gap-1">
          {MA_LINES.map(ma => (
            <button
              key={ma.key}
              onClick={() => toggleSet(setVisibleMAs, ma.key)}
              className={`${chipCls} font-mono ${visibleMAs.has(ma.key) ? "border-current opacity-100" : "border-border opacity-40 hover:opacity-60"}`}
              style={{ color: ma.color }}
              data-testid={ma.key === "ma50" ? "gold-ma50-legend" : undefined}
            >
              {visibleMAs.has(ma.key) ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
              {ma.label}
            </button>
          ))}
        </div>
        <div className="flex max-w-full flex-wrap gap-1.5 sm:contents">
          <button
            onClick={() => setShowSignals(!showSignals)}
            className={`${chipCls} ${showSignals ? "border-primary text-primary" : "border-border text-muted-foreground opacity-50"}`}
          >
            {showSignals ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            Signale
          </button>
          <button
            onClick={() => setShowVolume(!showVolume)}
            disabled={!hasVolume}
            title={hasVolume ? "Volumen ein-/ausblenden" : "Kein echtes Volumen von der Preisquelle (FMP GCUSD) — nicht erfunden"}
            className={`${chipCls} ${showVolume && hasVolume ? "border-sky-500 text-sky-400" : "border-border text-muted-foreground opacity-50"}`}
            data-testid="toggle-gold-volume"
          >
            {showVolume && hasVolume ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            Volumen{hasVolume ? "" : " (N/A)"}
          </button>
        </div>
      </div>

      {/* Makro-Overlays (nur Serien mit echten FRED-Werten) + Messen */}
      <div className="mb-3 flex max-w-full flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1">
        {MACRO.some(m => hasMacro[m.key]) && (
          <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:contents">
            <span className="self-center text-[11px] text-muted-foreground sm:mr-1 sm:text-[9px]">Makro:</span>
            {MACRO.filter(m => hasMacro[m.key]).map(m => {
              const on = visibleMacro.has(m.key);
              return (
                <button
                  key={m.key}
                  onClick={() => toggleSet(setVisibleMacro, m.key)}
                  className={`${chipCls} font-mono ${on ? "border-current" : "border-border opacity-40 hover:opacity-60 text-muted-foreground"}`}
                  style={on ? { color: m.color } : undefined}
                  title={`${m.title} ein-/ausblenden`}
                  data-testid={`toggle-gold-${m.key.toLowerCase()}`}
                >
                  {on ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:contents">
          <span className="mx-1 hidden self-center text-muted-foreground/30 sm:inline">|</span>
          <button
            onClick={() => { setIsMeasuring(!isMeasuring); setMeasureStart(null); setMeasureEnd(null); }}
            className={`${chipCls} ${isMeasuring ? "border-amber-500 text-amber-500 bg-amber-500/10" : "border-border text-muted-foreground opacity-60 hover:opacity-80"}`}
            data-testid="toggle-measure-gold"
          >
            📐 Messen
          </button>
          {measureStart && measureEnd && (
            <button
              onClick={() => { setMeasureStart(null); setMeasureEnd(null); }}
              className={`${chipCls} border-border text-muted-foreground opacity-60 hover:opacity-80`}
            >
              ✕ Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {measureStart && measureEnd && (() => {
        const priceDiff = measureEnd.price - measureStart.price;
        const pctChange = (priceDiff / measureStart.price) * 100;
        const isGain = priceDiff >= 0;
        return (
          <div className={`rounded-lg px-3 py-2 mb-2 border flex items-center gap-3 text-xs ${isGain ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
            <div className="text-[10px] text-muted-foreground">{formatDateFull(measureStart.date)} → {formatDateFull(measureEnd.date)}</div>
            <div className={`font-bold font-mono tabular-nums ${isGain ? "text-emerald-500" : "text-red-500"}`}>
              {isGain ? "+" : ""}{pctChange.toFixed(2)}% {isGain ? "↑" : "↓"}
            </div>
            <div className={`font-mono tabular-nums text-[10px] ${isGain ? "text-emerald-400" : "text-red-400"}`}>
              ({isGain ? "+" : "-"}${Math.abs(priceDiff).toLocaleString("en-US", { maximumFractionDigits: 2 })})
            </div>
            <div className="text-[9px] text-muted-foreground ml-auto">
              A: ${measureStart.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} → B: ${measureEnd.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
          </div>
        );
      })()}

      <TaPlotScroll minWidth={plotMinWidth} testId="gold-ta-plot-scroll">
        <div className={`h-[380px] sm:h-[420px] md:h-[460px] w-full shrink-0 ${isMeasuring ? "cursor-crosshair" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartDataWithVol}
              margin={priceMargin}
              onClick={(e: any) => {
                if (!isMeasuring || !e?.activePayload?.[0]?.payload) return;
                const point = e.activePayload[0].payload as GoldTechPoint;
                const clicked = { date: point.date, price: point.price };
                if (!measureStart || (measureStart && measureEnd)) { setMeasureStart(clicked); setMeasureEnd(null); }
                else setMeasureEnd(clicked);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={xTick} {...xInterval} axisLine={{ stroke: "var(--border)" }} />
              <YAxis
                domain={yDomain}
                tick={xTick}
                tickFormatter={formatYAxis}
                width={55}
                axisLine={{ stroke: "var(--border)" }}
                {...(narrow ? { ticks: narrowPriceTicks(yDomain[0], yDomain[1], 5) } : {})}
              />
              <YAxis yAxisId="vol" hide domain={[0, 1]} orientation="right" />
              {activeMacro.map(m => (
                <YAxis
                  key={`ax-${m.key}`}
                  yAxisId={m.key}
                  orientation="right"
                  domain={macroDomain[m.key]}
                  hide={macroAxisHidden(m.key)}
                  tickFormatter={(v: number) => (m.key === "walcl" ? `$${v.toFixed(1)}T` : m.key === "dxy" ? v.toFixed(0) : `${v.toFixed(1)}%`)}
                  tick={macroAxisHidden(m.key) ? false : { fontSize: narrow ? 10 : 9, fill: m.color }}
                  width={macroAxisHidden(m.key) ? 0 : m.width}
                  axisLine={macroAxisHidden(m.key) ? false : { stroke: m.color }}
                  tickLine={false}
                  {...(narrow ? { tickCount: 4 } : {})}
                />
              ))}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const pt = chartDataWithVol.find(d => d.date === label);
                  return (
                    <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                      <div className="font-semibold mb-1">{formatDateFull(String(label))}</div>
                      {payload.filter((p: any) => p.dataKey !== "_volNorm").map((p: any) => {
                        const macro = MACRO.find(m => m.key === p.dataKey);
                        return (
                          <div key={p.dataKey} className="flex justify-between gap-3">
                            <span style={{ color: p.color }}>{p.name}</span>
                            <span className="font-mono tabular-nums">
                              {macro ? fmtMacro(macro.key, Number(p.value)) : `$${Number(p.value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                            </span>
                          </div>
                        );
                      })}
                      {(pt?.volume ?? 0) > 0 && (
                        <div className="flex justify-between gap-3"><span className="text-sky-400">Volumen</span><span className="font-mono">{(pt!.volume ?? 0).toLocaleString("en-US")}</span></div>
                      )}
                      {pt?.cross && (
                        <div className={`mt-1 pt-1 border-t border-border ${pt.cross === "golden" ? "text-emerald-400" : "text-red-400"}`}>
                          {pt.cross === "golden" ? "✦ Golden Cross" : "✕ Death Cross"}
                        </div>
                      )}
                      {visibleSignals.filter(s => s.date === label).map((s, i) => (
                        <div key={i} className={`mt-1 pt-1 border-t border-border ${s.type === "BUY" ? "text-green-400" : "text-red-400"}`}>
                          {s.type === "BUY" ? "▲ BUY" : "▼ SELL"}: {s.reason}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />

              {/* Fair Value (bestehend) */}
              <ReferenceLine y={data.fairValue.fvAdj} stroke="#a855f7" strokeDasharray="5 5" strokeOpacity={0.5} ifOverflow="hidden" />

              {showVolume && hasVolume && !narrow && (
                <Bar yAxisId="vol" dataKey="_volNorm" name="Volumen" isAnimationActive={false} maxBarSize={6}
                  shape={(props: any) => {
                    const { x, y, width, height, payload } = props;
                    const fillColor = payload._volUp ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)";
                    return <rect x={x} y={y} width={Math.max(width, 1)} height={Math.abs(height)} fill={fillColor} />;
                  }}
                />
              )}

              {/* Volumen-Spike/-Divergenz-Marker als Grundlinie im Volumenband (Desktop), nicht auf dem Kurs. */}
              {showVolume && !narrow && volMarkers.map(d => (
                <ReferenceDot
                  key={`vm-${d.date}`}
                  yAxisId="vol"
                  x={d.date}
                  y={0.02}
                  r={3}
                  fill={d.volSpike && spikeOn ? "#f59e0b" : "#c084fc"}
                  stroke="#0a0a0a"
                  strokeWidth={0.5}
                  ifOverflow="discard"
                />
              ))}

              <Line type="monotone" dataKey="price" name="Gold Kurs" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />

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
                  connectNulls
                  isAnimationActive={false}
                />
              ))}

              {activeMacro.map(m => (
                <Line
                  key={m.key}
                  yAxisId={m.key}
                  type={m.step ? "stepAfter" : "monotone"}
                  dataKey={m.key}
                  name={m.name}
                  stroke={m.color}
                  strokeWidth={1.25}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}

              {/* #201 Golden/Death-Marker auf der 50-DMA (nicht auf dem Kurs). */}
              {visibleMAs.has("ma50") && chartDataWithVol.filter(p => p.cross && p.ma50 != null).map(p => (
                <ReferenceDot
                  key={`${p.cross}-${p.date}`}
                  x={p.date}
                  y={p.ma50 as number}
                  r={4}
                  fill={p.cross === "golden" ? "#10b981" : "#ef4444"}
                  stroke="#0a0a0a"
                  strokeWidth={1}
                  ifOverflow="discard"
                  label={{ value: p.cross === "golden" ? "GC" : "DC", position: "top", fontSize: 8, fill: p.cross === "golden" ? "#10b981" : "#ef4444", fontWeight: 700 }}
                />
              ))}

              {/* Signale als senkrechte Linien — keine Punkte auf dem Kurs (BTC-Mobile-Regel). */}
              {showSignals && visibleSignals.map((s, i) => (
                <Fragment key={`sig-${i}`}>
                  <ReferenceLine x={s.date} stroke={s.type === "BUY" ? "#22c55e" : "#ef4444"} strokeDasharray="2 2" strokeWidth={narrow ? 1 : 0.8} opacity={0.5} />
                </Fragment>
              ))}

              {measureStart && <ReferenceLine x={measureStart.date} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" />}
              {measureEnd && <ReferenceLine x={measureEnd.date} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" />}
              {measureStart && measureEnd && (
                <ReferenceArea
                  x1={measureStart.date < measureEnd.date ? measureStart.date : measureEnd.date}
                  x2={measureStart.date < measureEnd.date ? measureEnd.date : measureStart.date}
                  fill="#f59e0b" fillOpacity={0.08} stroke="#f59e0b" strokeOpacity={0.3} strokeDasharray="3 3"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {narrow && showVolume && hasVolume && (
          <TaVolumeBand data={chartDataWithVol} leftAxisWidth={55} rightAxisWidth={visibleRightWidth} marginRight={8} />
        )}
        {narrow && showVolume && volMarkers.length > 0 && (
          <div className="h-[14px] w-full" data-testid="gold-vol-marker-strip">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartDataWithVol} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" hide />
                <YAxis width={55} tick={false} axisLine={false} tickLine={false} domain={[0, 1]} />
                {visibleRightWidth > 0 && <YAxis yAxisId="align" orientation="right" width={visibleRightWidth} tick={false} axisLine={false} tickLine={false} />}
                {volMarkers.map(d => (
                  <ReferenceDot key={`vmm-${d.date}`} x={d.date} y={0.5} r={2.5} fill={d.volSpike && spikeOn ? "#f59e0b" : "#c084fc"} stroke="none" ifOverflow="discard" />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {showVolume && (
          <div className="sticky left-0 mt-1 flex max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground" style={narrow ? { maxWidth: "calc(100vw - 3rem)" } : undefined} data-testid="gold-vol-signals">
            <span className="inline-flex min-w-0 max-w-full items-start gap-1 break-words"><span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: spikeOn ? "#f59e0b" : "transparent", border: "1px solid #f59e0b" }} />{sigNote("Volumen-Spike (>1,5× Ø20T)", sigSpike, spikeOn)}</span>
            <span className="inline-flex min-w-0 max-w-full items-start gap-1 break-words"><span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: divOn ? "#c084fc" : "transparent", border: "1px solid #c084fc" }} />{sigNote("Volumen-Divergenz", sigDiv, divOn)}</span>
          </div>
        )}
        {hiddenMacroSeries.length > 0 && (
          <div className="sticky left-0 mt-1 flex max-w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="gold-macro-axis-note">
            <span>Ohne eigene Achse — Wert im Tooltip:</span>
            {hiddenMacroSeries.map(series => (
              <span key={series.key} className="inline-flex items-center gap-1 font-medium" style={{ color: series.color }}>
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: series.color }} />
                {series.label}
              </span>
            ))}
          </div>
        )}

        {/* MACD(12,26,9) */}
        <div className="mb-1 mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-medium text-muted-foreground sm:flex-nowrap">
          MACD(12,26,9)
          <span className="text-[9px] opacity-60">= EMA₁₂ - EMA₂₆ | Signal = EMA₉(MACD) | Histogram = MACD - Signal</span>
        </div>
        <div className="h-[160px] min-h-10 w-full shrink-0 sm:h-[180px]" style={{ minHeight: TA_OSC_MIN_PX }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartDataWithVol} margin={narrow ? { top: 5, right: 8, left: 0, bottom: 5 } : { top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={xTick} {...xInterval} axisLine={{ stroke: "var(--border)" }} />
              <YAxis tick={xTick} width={55} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v: number) => v.toFixed(0)} {...(narrow ? { tickCount: 5 } : {})} />
              {narrow && visibleRightWidth > 0 && (
                <YAxis yAxisId="align" orientation="right" width={visibleRightWidth} tick={false} axisLine={false} tickLine={false} />
              )}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                      <div className="font-semibold mb-1">{formatDateFull(String(label))}</div>
                      {payload.map((p: any) => (
                        <div key={p.dataKey} className="flex justify-between gap-3">
                          <span style={{ color: p.color }}>{p.name}</span>
                          <span className="font-mono tabular-nums">{Number(p.value).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={0.5} />
              <Bar
                dataKey="histogram"
                name="Histogram"
                isAnimationActive={false}
                shape={(props: any) => {
                  const { x, y, width, height, payload } = props;
                  const isPositive = (payload?.histogram ?? 0) >= 0;
                  return <rect x={x} y={y} width={Math.max(width, 1)} height={Math.abs(height)} fill={isPositive ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)"} />;
                }}
              />
              <Line type="monotone" dataKey="macd" name="MACD" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="signal" name="Signal" stroke="#f97316" strokeWidth={1} strokeDasharray="3 2" dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RSI(14) */}
        <div className="mt-3 min-h-10 shrink-0" style={{ minHeight: TA_OSC_MIN_PX }}>
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-muted-foreground sm:flex-nowrap">
            <span className="font-medium">RSI(14)</span>
            <span className="opacity-60">= Relative Strength Index | Überkauft &gt; 70 | Überverkauft &lt; 30 | Wilder Smoothing</span>
            {(() => {
              const lastRSI = chartDataWithVol.length > 0 ? chartDataWithVol[chartDataWithVol.length - 1]?.rsi14 : null;
              if (lastRSI === null || lastRSI === undefined) return null;
              const color = lastRSI > 70 ? "text-red-400" : lastRSI < 30 ? "text-emerald-400" : "text-blue-400";
              const label = lastRSI > 70 ? "Überkauft" : lastRSI < 30 ? "Überverkauft" : "Neutral";
              return <span className={`ml-auto font-mono font-semibold ${color}`}>{lastRSI.toFixed(1)} — {label}</span>;
            })()}
            <span className="font-mono text-[10px] text-indigo-300" data-testid="gold-rsi-relative" title={relRsi.title}>
              {relRsi.label}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={chartDataWithVol} margin={narrow ? { top: 2, right: 8, left: 0, bottom: 2 } : { top: 2, right: 10, left: 0, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} tick={{ fontSize: narrow ? 10 : 9, fill: "rgba(255,255,255,0.4)" }} tickLine={false} axisLine={false} width={narrow ? 55 : 28} />
              {narrow && visibleRightWidth > 0 && (
                <YAxis yAxisId="align" orientation="right" width={visibleRightWidth} tick={false} axisLine={false} tickLine={false} />
              )}
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" }}
                formatter={(value: number) => [value?.toFixed(1), "RSI(14)"]}
                labelFormatter={(label) => label}
              />
              <ReferenceArea y1={70} y2={100} fill="rgba(239,68,68,0.08)" />
              <ReferenceArea y1={0} y2={30} fill="rgba(34,197,94,0.08)" />
              <ReferenceLine y={70} stroke="rgba(239,68,68,0.5)" strokeDasharray="3 2" strokeWidth={1} />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" strokeWidth={1} />
              <ReferenceLine y={30} stroke="rgba(34,197,94,0.5)" strokeDasharray="3 2" strokeWidth={1} />
              <Line type="monotone" dataKey="rsi14" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </TaPlotScroll>

      {/* Legende: Fair Value + #201-Cross-Marker */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1" data-testid="gold-cross-legend">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Golden
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Death (auf MA50)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 rounded-full" style={{ borderTop: "1px dashed #a855f7" }} /> Fair Value (adj.)
        </span>
      </div>

      {visibleSignals.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-medium text-muted-foreground mb-2">Letzte Signale ({visibleSignals.length} im Zeitraum)</div>
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
                      <span className={`inline-flex items-center gap-0.5 font-semibold ${s.type === "BUY" ? "text-green-500" : "text-red-500"}`}>
                        {s.type === "BUY" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {s.type}
                      </span>
                    </td>
                    <td className={`py-1 pr-2 ${s.reason.includes("Death") ? "font-bold text-red-500" : s.reason.includes("Golden Cross") ? "font-bold text-emerald-500" : s.reason.includes("Bearish") ? "text-red-500" : s.reason.includes("Bullish") ? "text-emerald-500" : ""}`}>
                      {s.reason}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">${s.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3 p-2 rounded bg-muted/30 text-[9px] text-muted-foreground leading-relaxed">
        <span className="font-semibold">Anti-Bias Protokoll:</span> Kauf nur wenn: Kurs &gt; MA200 AND MA50 &gt; MA200 AND MACD &gt; 0 + steigend.
        Bei MA200-Break: historischen Max-Drawdown +15-20% (defensiv) bzw. +35-50% (Beta &gt;1.5) als Downside einplanen.
        MACD = EMA₁₂ − EMA₂₆, Signal = EMA₉(MACD), Histogram = MACD − Signal; α = 2/(Period+1).
        Makro-Overlays nur aus FRED (DFII10, M2SL, DTWEXBGS, T10YIE, WALCL); fehlt eine Reihe, fehlt ihr Chip. Reine Chart-Anzeige, kein Einfluss auf GIS/Technik-Score.
      </div>
      </div>
    </SectionCard>
  );
}
