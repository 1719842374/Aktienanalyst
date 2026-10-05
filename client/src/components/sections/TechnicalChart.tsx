import { useState, useMemo, useCallback } from "react";
import type { StockAnalysis, TradingSignal } from "../../../../shared/schema";
import { SectionCard } from "../SectionCard";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, Area, CartesianGrid,
} from "recharts";
import { useIsNarrow } from "@/hooks/use-mobile";
import { TA_OSC_MIN_PX, axisTick, narrowPriceTicks, taChartMinWidth, xAxisIntervalProps } from "@/lib/taChartScale";
import {
  buildFullSeries, buildWindowSeries, firstFiniteIndex, sliceBars,
  type WindowPoint, type WindowSeries,
} from "@/lib/taWindowSeries";
import { TaPlotScroll, TaVolumeBand } from "./TaPlotFrame";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, Eye, EyeOff, Ruler, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

// Preset-Schnitte in Handelstagen — identisch zum bisherigen IST (slice vom letzten Bar).
const TIME_RANGE_CUTOFF = {
  "3M": 63, "6M": 126, "1Y": 252, "2Y": 504, "3Y": 756, "5Y": 1260, "10Y": 2520,
} as const;
type TimeRange = keyof typeof TIME_RANGE_CUTOFF;

const EMPTY_WINDOW_HINT = "Keine Bars in diesem Fenster";

function clampIsoDate(value: string, minDate: string, maxDate: string): string {
  if (value < minDate) return minDate;
  if (value > maxDate) return maxDate;
  return value;
}

const DATE_INPUT_CLASS =
  "h-9 sm:h-7 w-full min-w-0 max-w-full rounded border border-border bg-background px-1.5 text-[10px] text-foreground scheme-light dark:scheme-dark";

/** Vergleichs-Strokes. Kurs A bleibt die bestehende Preis-Farbe (primary). */
const STROKE_B = "#a78bfa";
const STROKE_C = "#34d399";

/** Abstand zwischen gestapelten Kurs-Bändern. Klein, aber sichtbar — die Trennung ist die Bandhöhe, nicht eine gemeinsame Y. */
const BAND_GAP_PX = 8;

/**
 * Preiszonen-Höhe je Band.
 * 1 Band = bisherige Ein-Chart-Höhe. 2 Bänder teilen sie. 3 Bänder: Summe +40–70px gegenüber Eng-Desktop (380).
 */
function priceBandClass(count: number): string {
  if (count >= 3) return "h-[120px] sm:h-[144px]";
  if (count === 2) return "h-[156px] sm:h-[186px]";
  return "h-[320px] sm:h-[380px]";
}

function bandAxisDate(date: string, from: string, to: string): string {
  const p = date.split("-");
  const span = new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime();
  return span > 400 * 86400000 ? `${p[1]}/${p[0].slice(2)}` : `${p[1]}/${p[2]}`;
}

function maProbeAttrs(points: WindowPoint[]): Record<string, string> {
  const idx = (key: keyof WindowPoint) => {
    const i = firstFiniteIndex(points, key);
    return i < 0 ? "" : String(i);
  };
  return {
    "data-n": String(points.length),
    "data-first-ma200": idx("ma200"),
    "data-first-ma50": idx("ma50"),
    "data-first-ma20": idx("ma20"),
    "data-first-ema26": idx("ema26"),
  };
}

/** Eigene Y je Band: Close + gerade sichtbare MAs/BB. Keine gemeinsame Absolute-Y. */
function priceDomain(points: WindowPoint[], visible: Set<MAKey>, showBB: boolean): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const d of points) {
    let lo = d.close;
    let hi = d.close;
    for (const ma of MA_LINES) {
      if (!visible.has(ma.key)) continue;
      const v = d[ma.key];
      if (v != null && isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (showBB && d.bbLower != null && d.bbLower < lo) lo = d.bbLower;
    if (showBB && d.bbUpper != null && d.bbUpper > hi) hi = d.bbUpper;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  const pad = min === max ? (Math.abs(min) * 0.05 || 1) : (max - min) * 0.05;
  return [min - pad, max + pad];
}

export function TechnicalChart({ data }: Props) {
  const narrow = useIsNarrow();
  const stockPlotMinWidth = taChartMinWidth(52, 0, 10);
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
  // Immer an, solange der Nutzer sie nicht ausblendet — Ein-Band bleibt MACD/RSI wie nach #97.
  const [showMacd, setShowMacd] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>("1Y");
  // null = Preset-Slice (IST). Gesetzt, sobald Von/Bis A vom Kalender kommt.
  const [customA, setCustomA] = useState<{ from: string; to: string } | null>(null);
  // Default: nur Kurs A an. B/C aus = heutiges Ein-Kurs-Chart. Aus blendet nur den Plot.
  const [showKursA, setShowKursA] = useState(true);
  const [showKursB, setShowKursB] = useState(false);
  const [showKursC, setShowKursC] = useState(false);
  const [fromB, setFromB] = useState("");
  const [toB, setToB] = useState("");
  const [fromC, setFromC] = useState("");
  const [toC, setToC] = useState("");
  const [seedSpan, setSeedSpan] = useState("");
  const [rangeHint, setRangeHint] = useState<string | null>(null);
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
      <SectionCard number={12} title="Technische Analyse" subtitle="Chart & Signale">
        <div className="text-center text-muted-foreground text-xs py-8">Keine OHLCV-Daten verfügbar</div>
      </SectionCard>
    );
  }

  // Kalender-Clamp auf die geladene OHLCV-Spanne (nicht auf das Preset-Label).
  let minDate = ohlcv[0].date;
  let maxDate = ohlcv[0].date;
  for (let i = 1; i < ohlcv.length; i++) {
    const d = ohlcv[i].date;
    if (d < minDate) minDate = d;
    else if (d > maxDate) maxDate = d;
  }

  // ── Time-range slice (Fenster A) ────────────────────────────────────────────
  // Preset: Ende = letzter Bar, Start = cutoff (IST). Custom-A: Datum ∈ [from, to].
  const rangeCutoff = TIME_RANGE_CUTOFF[timeRange];
  const aBars = useMemo(() => {
    if (customA && customA.from <= customA.to) {
      return ohlcv.filter(d => d.date >= customA.from && d.date <= customA.to);
    }
    return ohlcv.slice(-Math.min(rangeCutoff, ohlcv.length));
  }, [ohlcv, customA, rangeCutoff]);

  // WORK_DATA_PROVIDERS.md §4: Chart-Domain muss an tatsaechlich geladene
  // Min/Max-Daten gebunden sein, nicht an das Button-Label. Wenn der gewaehlte
  // Timeframe mehr Handelstage verlangt als tatsaechlich vorhanden (z.B. FMP-
  // Plan-Downgrade auf Free/Starter mit nur 5 Jahren Historie, oder ein sehr
  // junger Börsengang), zeigen wir einen klaren Hinweis statt den Button-Wert
  // ("10Y") so zu tun als waere er erfuellt. Aktuell liefert der produktive
  // FMP-Plan verifiziert 10+ Jahre plus Indikator-Warmup (indicatorWarmupFromDate) — dieser
  // Hinweis ist ein Sicherheitsnetz fuer den Fall, dass sich das aendert, nicht
  // ein aktiv beobachtetes Problem.
  // Toleranz 95%: Handelstage pro Kalenderjahr schwanken leicht (Feiertage,
  // Boersenferien), ein exaktes "< cutoff" wuerde bei z.B. 2513 von 2520
  // Punkten (99.7%, faktisch volle 10 Jahre) einen falschen Alarm ausloesen.
  const isHistoryTruncated = !customA && ti.maData.length > 0 && ti.maData.length < rangeCutoff * 0.95;
  const actualYearsAvailable = ti.maData.length > 0 ? +(ti.maData.length / 252).toFixed(1) : 0;
  const hasEnoughForMA200 = ti.maData.length >= 200;

  const fromADisplay = customA?.from
    ?? aBars[0]?.date
    ?? minDate;
  const toADisplay = customA?.to
    ?? aBars[aBars.length - 1]?.date
    ?? maxDate;

  // B/C einmal auf das aktuelle Fenster A setzen (bzw. in die OHLCV-Spanne klemmen).
  // Preset-Wechsel ändert nur A — seedSpan hängt an min/max der Historie, nicht am Preset.
  const spanKey = `${minDate}|${maxDate}`;
  if (seedSpan !== spanKey && fromADisplay && toADisplay && fromADisplay <= toADisplay) {
    const keepOrReseed = (from: string, to: string) => {
      if (!from || !to) return { from: fromADisplay, to: toADisplay };
      const cFrom = clampIsoDate(from, minDate, maxDate);
      const cTo = clampIsoDate(to, minDate, maxDate);
      if (cFrom > cTo) return { from: fromADisplay, to: toADisplay };
      return { from: cFrom, to: cTo };
    };
    const nextB = keepOrReseed(fromB, toB);
    const nextC = keepOrReseed(fromC, toC);
    setFromB(nextB.from);
    setToB(nextB.to);
    setFromC(nextC.from);
    setToC(nextC.to);
    setSeedSpan(spanKey);
  }

  const fromBValue = fromB || fromADisplay;
  const toBValue = toB || toADisplay;
  const fromCValue = fromC || fromADisplay;
  const toCValue = toC || toADisplay;

  const bBars = useMemo(() => sliceBars(ohlcv, fromBValue, toBValue), [ohlcv, fromBValue, toBValue]);
  const cBars = useMemo(() => sliceBars(ohlcv, fromCValue, toCValue), [ohlcv, fromCValue, toCValue]);
  // Indikatoren einmal auf der vollen Historie, je Band nur ausgeschnitten — nicht auf dem Slice neu rechnen.
  const fullSeries = useMemo(() => buildFullSeries(ohlcv), [ohlcv]);
  const aBuilt = useMemo(() => buildWindowSeries(fullSeries, aBars), [fullSeries, aBars]);
  const bBuilt = useMemo(() => buildWindowSeries(fullSeries, bBars), [fullSeries, bBars]);
  const cBuilt = useMemo(() => buildWindowSeries(fullSeries, cBars), [fullSeries, cBars]);
  const visibleKursCount = (showKursA ? 1 : 0) + (showKursB ? 1 : 0) + (showKursC ? 1 : 0);
  // ≥2 Kurse an → versetzte Bänder (else-Zweig). Nur A an → singleALayout, kein Versatz.
  const singleALayout = showKursA && !showKursB && !showKursC;

  const rejectInvertedRange = () => {
    const msg = "Von liegt nach Bis — Eingabe ignoriert.";
    setRangeHint(msg);
    toast({ title: "Zeitraum ungültig", description: msg });
  };

  const applyWindowA = (nextFromRaw: string, nextToRaw: string) => {
    if (!nextFromRaw || !nextToRaw) return;
    const from = clampIsoDate(nextFromRaw, minDate, maxDate);
    const to = clampIsoDate(nextToRaw, minDate, maxDate);
    if (from > to) {
      rejectInvertedRange();
      return;
    }
    setCustomA({ from, to });
    setSignalPage(0);
    setRangeHint(null);
  };

  const applyWindowB = (nextFromRaw: string, nextToRaw: string) => {
    if (!nextFromRaw || !nextToRaw) return;
    const from = clampIsoDate(nextFromRaw, minDate, maxDate);
    const to = clampIsoDate(nextToRaw, minDate, maxDate);
    if (from > to) {
      rejectInvertedRange();
      return;
    }
    setFromB(from);
    setToB(to);
    setRangeHint(null);
  };

  const applyWindowC = (nextFromRaw: string, nextToRaw: string) => {
    if (!nextFromRaw || !nextToRaw) return;
    const from = clampIsoDate(nextFromRaw, minDate, maxDate);
    const to = clampIsoDate(nextToRaw, minDate, maxDate);
    if (from > to) {
      rejectInvertedRange();
      return;
    }
    setFromC(from);
    setToC(to);
    setRangeHint(null);
  };

  const bWindowEmpty = showKursB && fromBValue <= toBValue && bBuilt.points.length === 0;
  const cWindowEmpty = showKursC && fromCValue <= toCValue && cBuilt.points.length === 0;

  // Signalliste einmal, Zeitraum A (nicht je Band eine Tabelle). Marker auf B/C nutzen deren eigene Serie.
  const allVisibleSignals = useMemo(() => {
    if (!showSignals || aBuilt.signals.length === 0) return [];
    return [...aBuilt.signals].reverse();
  }, [aBuilt.signals, showSignals]);

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

  // Leeres Fenster lässt die Controls stehen, damit Von/Bis korrigierbar bleiben.
  // Jedes Band rechnet Y aus der eigenen Serie — keine gemeinsame Absolute-Y, kein closeB.
  const chartEmpty = aBuilt.points.length === 0;

  const formatDate = (date: string) => {
    const p = date.split("-");
    const presetLong = timeRange==="2Y"||timeRange==="3Y"||timeRange==="5Y"||timeRange==="10Y";
    const customLong = !!customA && (new Date(customA.to + "T00:00:00").getTime() - new Date(customA.from + "T00:00:00").getTime()) > 400 * 86400000;
    const long = customA ? customLong : presetLong;
    return long
      ? `${p[1]}/${p[0].slice(2)}`
      : `${p[1]}/${p[2]}`;
  };
  const formatDateFull = (date: string) =>
    new Date(date + "T00:00:00").toLocaleDateString("de-DE", { day:"2-digit", month:"short", year:"numeric" });


  return (
    <SectionCard number={12} title="Technische Analyse" subtitle="Interactive Chart – MA / MACD / RSI / BB / Volume">

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

      {/* ── Controls ──
          Mobile: Preset → Kurs A/B/C → Date-Blöcke nur aktiver Kurse → Indikatoren.
          Desktop (sm+): Zeile 1 Presets | Kurse, Zeile 2 Dates aktiver Fenster | Indikatoren. */}
      <div className="mb-3 flex min-w-0 max-w-full flex-col gap-2 overflow-x-hidden sm:gap-3" data-testid="controls-ta">
        <div className="flex min-w-0 max-w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" data-testid="controls-row-presets">
          {/* Time range — setzt nur Fenster A (Ende = letzter Bar, Start = cutoff) */}
          <div className="flex min-h-9 max-w-full flex-wrap gap-1.5 sm:gap-1" data-testid="row-presets">
            {(["3M","6M","1Y","2Y","3Y","5Y","10Y"] as const).map(r => (
              <button key={r} type="button" onClick={() => { setTimeRange(r); setCustomA(null); setRangeHint(null); setSignalPage(0); }}
                className={`min-h-9 shrink-0 rounded-md border px-2.5 text-[11px] font-medium transition-colors sm:text-[10px] ${
                  timeRange===r && !customA ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted/50"
                }`}>
                {r}
              </button>
            ))}
          </div>
          <div className="flex w-full min-w-0 gap-1.5 sm:w-auto sm:gap-1" data-testid="row-kurs-toggles">
            <button
              type="button"
              onClick={() => setShowKursA(v => !v)}
              data-testid="button-kurs-a"
              aria-pressed={showKursA}
              className={`inline-flex min-h-9 flex-1 shrink-0 items-center justify-center rounded border px-2.5 text-[11px] font-medium transition-colors sm:flex-none sm:text-[10px] ${
                showKursA
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Kurs A
            </button>
            <button
              type="button"
              onClick={() => setShowKursB(v => !v)}
              data-testid="button-kurs-b"
              aria-pressed={showKursB}
              className={`inline-flex min-h-9 flex-1 shrink-0 items-center justify-center rounded border px-2.5 text-[11px] font-medium transition-colors sm:flex-none sm:text-[10px] ${
                showKursB ? "" : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
              style={showKursB ? { backgroundColor: STROKE_B, borderColor: STROKE_B, color: "#1e1b4b" } : undefined}
            >
              Kurs B
            </button>
            <button
              type="button"
              onClick={() => setShowKursC(v => !v)}
              data-testid="button-kurs-c"
              aria-pressed={showKursC}
              className={`inline-flex min-h-9 flex-1 shrink-0 items-center justify-center rounded border px-2.5 text-[11px] font-medium transition-colors sm:flex-none sm:text-[10px] ${
                showKursC ? "" : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
              style={showKursC ? { backgroundColor: STROKE_C, borderColor: STROKE_C, color: "#052e16" } : undefined}
            >
              Kurs C
            </button>
          </div>
        </div>

        <div className="flex min-w-0 max-w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3" data-testid="controls-row-indicators">
          <div className="flex min-w-0 w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
            {showKursA && (
              <WindowDates
                tag="A"
                from={fromADisplay}
                to={toADisplay}
                minDate={minDate}
                maxDate={maxDate}
                onFrom={value => applyWindowA(value, toADisplay)}
                onTo={value => applyWindowA(fromADisplay, value)}
                testFrom="input-window-a-from"
                testTo="input-window-a-to"
              />
            )}
            {showKursB && (
              <WindowDates
                tag="B"
                from={fromBValue}
                to={toBValue}
                minDate={minDate}
                maxDate={maxDate}
                onFrom={value => applyWindowB(value, toBValue)}
                onTo={value => applyWindowB(fromBValue, value)}
                testFrom="input-window-b-from"
                testTo="input-window-b-to"
              />
            )}
            {showKursC && (
              <WindowDates
                tag="C"
                from={fromCValue}
                to={toCValue}
                minDate={minDate}
                maxDate={maxDate}
                onFrom={value => applyWindowC(value, toCValue)}
                onTo={value => applyWindowC(fromCValue, value)}
                testFrom="input-window-c-from"
                testTo="input-window-c-to"
              />
            )}
          </div>

          <div className="flex min-w-0 max-w-full flex-wrap gap-1.5 sm:gap-1" data-testid="row-indicators">
            {MA_LINES.map(ma => (
              <button key={ma.key} type="button" onClick={() => toggleMA(ma.key)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] font-mono transition-colors sm:min-h-7 sm:text-[10px] ${
                  visibleMAs.has(ma.key) ? "border-current opacity-100" : "border-border opacity-40 hover:opacity-60"
                }`}
                style={{ color: ma.color }}>
                {visibleMAs.has(ma.key) ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
                {ma.label}
              </button>
            ))}
            <button type="button" onClick={() => setShowBollinger(v => !v)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showBollinger ? "border-violet-400 text-violet-400" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showBollinger ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              BB(20,2)
            </button>
            <button type="button" onClick={() => setShowVolume(v => !v)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showVolume ? "border-sky-400 text-sky-400" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showVolume ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Volumen
            </button>
            <button type="button" onClick={() => setShowSignals(v => !v)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showSignals ? "border-primary text-primary" : "border-border text-muted-foreground opacity-50"
              }`}>
              {showSignals ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Signale
            </button>
            <button type="button" onClick={() => setShowMacd(v => !v)} data-testid="button-macd" aria-pressed={showMacd}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showMacd ? "border-blue-500 text-blue-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showMacd ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              MACD
            </button>
            <button type="button" onClick={() => setShowRsi(v => !v)} data-testid="button-rsi" aria-pressed={showRsi}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showRsi ? "border-amber-500 text-amber-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showRsi ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              RSI(14)
            </button>
            <button type="button" onClick={() => { setMeasureMode(v => !v); setMeasurePoints([]); }}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                measureMode ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              <Ruler className="w-2.5 h-2.5"/>
              Messen
            </button>
          </div>
        </div>

        {/* WORK_DATA_PROVIDERS.md §4: Hinweis wenn weniger Historie geladen wurde
            als der gewaehlte Timeframe verlangt — Chart-Domain bindet sich immer
            an die tatsaechlichen Daten, aber der Nutzer soll das sehen koennen. */}
        {(isHistoryTruncated || (data.historyDataSource && data.historyDataSource !== "fmp") || data.historyTruncated) && (
          <div className="flex min-w-0 max-w-full flex-wrap gap-1">
            {isHistoryTruncated && (
              <span
                className="px-2 py-1 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                title={`Nur ${actualYearsAvailable} Jahre Historie verfügbar (angefragt: ${timeRange}). Quelle: ${data.historyDataSource ?? "fmp"}.`}
              >
                Historie: {actualYearsAvailable}J verfügbar
              </span>
            )}
            {/* Sprint B1 (WORK_DATA_PROVIDERS.md §4/§7): dataSource klein sichtbar,
                zeigt ob ein Alt-Provider (Yahoo/Stooq) die FMP-Historie ergaenzt hat. */}
            {data.historyDataSource && data.historyDataSource !== "fmp" && (
              <span
                className="px-2 py-1 rounded text-[10px] font-medium bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30"
                title="Kurshistorie kombiniert aus FMP (primär) und einem Alt-Provider (füllt ältere Lücken)."
              >
                Quelle: {data.historyDataSource}
              </span>
            )}
            {data.historyTruncated && (
              <span
                className="px-2 py-1 rounded text-[10px] font-medium bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
                title="Auch nach Alt-Provider-Fallback ist die angeforderte Zeitspanne nicht vollständig abgedeckt — Daten werden ehrlich angezeigt, nicht künstlich verlängert."
              >
                Historie unvollständig
              </span>
            )}
          </div>
        )}
      </div>

      {(rangeHint || bWindowEmpty || cWindowEmpty || (showKursA && customA && chartEmpty)) && (
        <div className="mb-3 -mt-1 flex flex-col gap-0.5 min-w-0" data-testid="hint-chart-windows">
          {rangeHint && <span className="text-[10px] text-amber-600 dark:text-amber-400">{rangeHint}</span>}
          {showKursA && customA && chartEmpty && <span className="text-[10px] text-amber-600 dark:text-amber-400">Fenster A: {EMPTY_WINDOW_HINT}</span>}
          {bWindowEmpty && <span className="text-[10px] text-amber-600 dark:text-amber-400">Fenster B: {EMPTY_WINDOW_HINT}</span>}
          {cWindowEmpty && <span className="text-[10px] text-amber-600 dark:text-amber-400">Fenster C: {EMPTY_WINDOW_HINT}</span>}
        </div>
      )}

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
        if (!lastCrossType) {
          // WORK_DATA_PROVIDERS.md §4: explizite Meldung statt stillem Wegfall,
          // wenn der Grund fuer den fehlenden Banner zu wenig Historie ist
          // (< 200 Handelstage fuer MA200) — unterscheidet sich von "es gab
          // in der sichtbaren Historie einfach keinen Cross".
          if (!hasEnoughForMA200) {
            return (
              <div className="rounded-lg p-3 mb-3 border bg-muted/30 border-border text-xs text-muted-foreground">
                Historie zu kurz für MA200 / Golden-Death-Cross ({ti.maData.length} von 200 benötigten Handelstagen verfügbar).
              </div>
            );
          }
          return null;
        }
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

      {visibleKursCount === 0 ? (
        <div className="text-center text-muted-foreground text-xs py-8" data-testid="hint-kurs-off">Kein Kurs eingeblendet</div>
      ) : singleALayout && chartEmpty ? (
        <div className="text-center text-muted-foreground text-xs py-8" data-testid="hint-window-empty">{EMPTY_WINDOW_HINT}</div>
      ) : singleALayout ? (
        <TaPlotScroll minWidth={stockPlotMinWidth} testId="chart-price-scroll">
          <div className="w-full">
            <div className={`${priceBandClass(1)} w-full shrink-0 ${measureMode?'cursor-crosshair':''}`} data-testid="chart-price-ma" {...maProbeAttrs(aBuilt.points)}>
              <PricePane
                points={aBuilt.points}
                signals={aBuilt.signals}
                closeStroke="hsl(var(--primary))"
                closeName="Kurs"
                tickFormatter={formatDate}
                formatDateFull={formatDateFull}
                visibleMAs={visibleMAs}
                showVolume={showVolume}
                showBollinger={showBollinger}
                showSignals={showSignals}
                dense={false}
                onPlotClick={handleChartClick}
                measurePoints={measurePoints}
                measurement={measurement}
              />
            </div>
            {narrow && showVolume && (
              <TaVolumeBand data={aBuilt.points} leftAxisWidth={52} marginRight={10} />
            )}
            {showMacd && (
              <MacdPane points={aBuilt.points} tickFormatter={formatDate} formatDateFull={formatDateFull} compact={false} testId="chart-macd" title="MACD(12,26,9)" hint="= EMA₁₂ - EMA₂₆ | Signal = EMA₉(MACD) | Histogram = MACD - Signal" />
            )}
            {showRsi && (
              <RsiPane points={aBuilt.points} tickFormatter={formatDate} formatDateFull={formatDateFull} compact={false} testId="chart-rsi" title="RSI(14)" hint="| <30 überverkauft · >70 überkauft" />
            )}
          </div>
        </TaPlotScroll>
      ) : (
        <div
          className="w-full min-w-0 max-w-full flex flex-col overflow-x-hidden"
          style={{ gap: BAND_GAP_PX }}
          data-testid="chart-price-bands"
        >
          {showKursA && (
            <BandStack
              label="Fenster A"
              labelClassName="text-primary"
              series={aBuilt}
              closeStroke="hsl(var(--primary))"
              closeName="Kurs"
              tickFormatter={formatDate}
              formatDateFull={formatDateFull}
              visibleMAs={visibleMAs}
              showVolume={showVolume}
              showBollinger={showBollinger}
              showSignals={showSignals}
              showMacd={showMacd}
              showRsi={showRsi}
              count={visibleKursCount}
              testId="chart-band-a"
              macdTestId="chart-macd"
              rsiTestId="chart-rsi"
              measureMode={measureMode}
              onPlotClick={handleChartClick}
              measurePoints={measurePoints}
              measurement={measurement}
            />
          )}
          {showKursB && (
            <BandStack
              label="Fenster B"
              labelClassName=""
              labelColor={STROKE_B}
              series={bBuilt}
              closeStroke={STROKE_B}
              closeName="Fenster B"
              tickFormatter={(d: string) => bandAxisDate(d, fromBValue, toBValue)}
              formatDateFull={formatDateFull}
              visibleMAs={visibleMAs}
              showVolume={showVolume}
              showBollinger={showBollinger}
              showSignals={showSignals}
              showMacd={showMacd}
              showRsi={showRsi}
              count={visibleKursCount}
              testId="chart-band-b"
              macdTestId="chart-macd-b"
              rsiTestId="chart-rsi-b"
            />
          )}
          {showKursC && (
            <BandStack
              label="Fenster C"
              labelClassName=""
              labelColor={STROKE_C}
              series={cBuilt}
              closeStroke={STROKE_C}
              closeName="Fenster C"
              tickFormatter={(d: string) => bandAxisDate(d, fromCValue, toCValue)}
              formatDateFull={formatDateFull}
              visibleMAs={visibleMAs}
              showVolume={showVolume}
              showBollinger={showBollinger}
              showSignals={showSignals}
              showMacd={showMacd}
              showRsi={showRsi}
              count={visibleKursCount}
              testId="chart-band-c"
              macdTestId="chart-macd-c"
              rsiTestId="chart-rsi-c"
            />
          )}
        </div>
      )}

      {/* ── Signals Table with Pagination ── */}
      {allVisibleSignals.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-medium text-muted-foreground">
              Letzte Signale Fenster A ({allVisibleSignals.length} im Zeitraum)
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

type MeasureHit = {
  a: { date: string; close: number };
  b: { date: string; close: number };
  diff: number;
  pct: number;
  isGain: boolean;
};

function WindowDates({
  tag, from, to, minDate, maxDate, onFrom, onTo, testFrom, testTo,
}: {
  tag: string;
  from: string;
  to: string;
  minDate: string;
  maxDate: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  testFrom: string;
  testTo: string;
}) {
  return (
    <div className="w-full min-w-0 sm:w-auto" data-testid={`dates-${tag}`}>
      <div className="mb-1 text-[10px] leading-none text-muted-foreground">{tag}</div>
      <div className="grid min-w-0 grid-cols-2 gap-1 sm:flex sm:gap-2">
        <label className="flex min-w-0 flex-col gap-0.5 overflow-hidden sm:w-[9.5rem]">
          <span className="text-[10px] leading-none text-muted-foreground">Von</span>
          <input
            type="date"
            min={minDate}
            max={maxDate}
            value={from}
            onChange={e => onFrom(e.target.value)}
            data-testid={testFrom}
            className={DATE_INPUT_CLASS}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 overflow-hidden sm:w-[9.5rem]">
          <span className="text-[10px] leading-none text-muted-foreground">Bis</span>
          <input
            type="date"
            min={minDate}
            max={maxDate}
            value={to}
            onChange={e => onTo(e.target.value)}
            data-testid={testTo}
            className={DATE_INPUT_CLASS}
          />
        </label>
      </div>
    </div>
  );
}

function PricePane({
  points, signals, closeStroke, closeName, tickFormatter, formatDateFull,
  visibleMAs, showVolume, showBollinger, showSignals, dense,
  onPlotClick, measurePoints, measurement,
}: {
  points: WindowPoint[];
  signals: TradingSignal[];
  closeStroke: string;
  closeName: string;
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
  visibleMAs: Set<MAKey>;
  showVolume: boolean;
  showBollinger: boolean;
  showSignals: boolean;
  dense: boolean;
  onPlotClick?: (e: any) => void;
  measurePoints?: { date: string; close: number }[];
  measurement?: MeasureHit | null;
}) {
  const narrow = useIsNarrow();
  const [yMin, yMax] = priceDomain(points, visibleMAs, showBollinger);
  const tick = axisTick(narrow, dense ? 8 : 9, "var(--muted-foreground)");
  const xInterval = xAxisIntervalProps(narrow, Math.max(0, Math.floor(points.length / (dense ? 5 : 8))));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={points}
        margin={dense ? { top: 2, right: 10, left: 0, bottom: 0 } : { top: 5, right: 10, left: 0, bottom: 5 }}
        onClick={onPlotClick}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis dataKey="date" type="category" tickFormatter={tickFormatter} tick={tick} {...xInterval} axisLine={{ stroke: "var(--border)" }} padding={{ left: 0, right: 0 }} />
        <YAxis yAxisId="price" domain={[yMin, yMax]} tick={tick} tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={52} axisLine={{ stroke: "var(--border)" }} {...(narrow ? { ticks: narrowPriceTicks(yMin, yMax, 5) } : {})} />
        {/* Domain [0, 6.67]: höchster Volumen-Balken ≈ 15% der Bandhöhe, eigene Achse, nicht in der Preis-Y. */}
        <YAxis yAxisId="vol" hide domain={[0, 6.67]} orientation="right" />
        <Tooltip content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const dp = payload[0]?.payload as WindowPoint | undefined;
          if (!dp) return null;
          let sigs: TradingSignal[] = [];
          if (showSignals) {
            const idx = points.findIndex(d => d.date === dp.date);
            if (idx >= 0) {
              for (let off = -2; off <= 2; off++) {
                const nb = points[idx + off];
                if (nb?._signals) for (const s of nb._signals) if (!sigs.some(e => e.date === s.date && e.reason === s.reason)) sigs.push(s);
              }
            }
          }
          const bbWidth = dp.bbUpper != null && dp.bbLower != null ? (dp.bbUpper - dp.bbLower).toFixed(2) : null;
          return (
            <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px] min-w-[160px]">
              <div className="font-semibold mb-1">{formatDateFull(dp.date)}</div>
              <div className="flex justify-between gap-3"><span style={{ color: closeStroke }}>{closeName}</span><span className="font-mono">${dp.close.toFixed(2)}</span></div>
              {showVolume && dp.volume > 0 && <div className="flex justify-between gap-3"><span className="text-sky-400">Volumen</span><span className="font-mono">{(dp.volume / 1e6).toFixed(2)}M</span></div>}
              {showBollinger && dp.bbUpper != null && (
                <>
                  <div className="flex justify-between gap-3"><span className="text-violet-400">BB Upper</span><span className="font-mono">${dp.bbUpper.toFixed(2)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-violet-300">BB Mid</span><span className="font-mono">${dp.bbMid?.toFixed(2)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-violet-400">BB Lower</span><span className="font-mono">${dp.bbLower?.toFixed(2)}</span></div>
                  {bbWidth && <div className="flex justify-between gap-3"><span className="text-muted-foreground">BB Breite</span><span className="font-mono">${bbWidth}</span></div>}
                </>
              )}
              {payload.filter((p: any) => p.yAxisId === "price" && !["close", "bbUpper", "bbMid", "bbLower"].includes(p.dataKey)).map((p: any) => (
                <div key={p.dataKey} className="flex justify-between gap-3">
                  <span style={{ color: p.color }}>{p.name}</span>
                  <span className="font-mono">${Number(p.value).toFixed(2)}</span>
                </div>
              ))}
              {sigs.map((s, i) => (
                <div key={i} className={`mt-1 pt-1 border-t border-border font-semibold ${s.type === "buy" ? "text-green-400" : "text-red-400"}`}>
                  {s.type === "buy" ? "▲ BUY" : "▼ SELL"}: {s.reason}
                </div>
              ))}
            </div>
          );
        }} />
        {showVolume && !narrow && (
          <Bar yAxisId="vol" dataKey="_volNorm" name="Volumen" isAnimationActive={false} maxBarSize={8}
            shape={(props: any) => {
              const { x, y, width, height, payload } = props;
              const fillColor = payload._volUp ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
              return <rect x={x} y={y} width={Math.max(width, 1)} height={Math.abs(height)} fill={fillColor} />;
            }}
          />
        )}
        <Line yAxisId="price" type="monotone" dataKey="close" name={closeName} stroke={closeStroke} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        {MA_LINES.map(ma => visibleMAs.has(ma.key) && (
          <Line key={ma.key} yAxisId="price" type="monotone" dataKey={ma.key} name={ma.label} stroke={ma.color} strokeWidth={1.5} dot={false} strokeDasharray={ma.key.startsWith("ema") ? "4 2" : undefined} connectNulls isAnimationActive={false} />
        ))}
        {showBollinger && (
          <>
            <Area yAxisId="price" type="monotone" dataKey="bbUpper" name="BB Upper" stroke="#7c3aed" strokeWidth={1} strokeDasharray="3 2" fill="rgba(124,58,237,0.05)" dot={false} connectNulls isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="bbMid" name="BB Mid" stroke="#a78bfa" strokeWidth={1} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
            <Area yAxisId="price" type="monotone" dataKey="bbLower" name="BB Lower" stroke="#7c3aed" strokeWidth={1} strokeDasharray="3 2" fill="rgba(124,58,237,0.05)" dot={false} connectNulls isAnimationActive={false} legendType="none" />
          </>
        )}
        {showSignals && signals.map((s, i) => (
          <ReferenceLine key={`sig-${s.date}-${i}`} yAxisId="price" x={s.date} stroke={s.type === "buy" ? "#22c55e" : "#ef4444"} strokeDasharray="2 2" strokeWidth={narrow ? 1 : 0.8} opacity={0.5} />
        ))}
        {measurePoints && measurePoints.length >= 1 && (
          <ReferenceLine yAxisId="price" x={measurePoints[0].date} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "A", position: "top", fontSize: 10, fill: "#f59e0b", fontWeight: 700 }} />
        )}
        {measurement && (
          <>
            <ReferenceArea yAxisId="price" x1={measurement.a.date} x2={measurement.b.date} fill={measurement.isGain ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)"} stroke={measurement.isGain ? "#10b981" : "#ef4444"} strokeDasharray="4 3" strokeWidth={1} />
            <ReferenceLine yAxisId="price" x={measurement.b.date} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: "B", position: "top", fontSize: 10, fill: "#f59e0b", fontWeight: 700 }} />
          </>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function OscCaption({ title, hint, compact }: { title: string; hint?: string; compact: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground ${compact ? "mb-0.5 mt-1 text-[9px] leading-none" : "mb-1 mt-2 text-[10px]"}`}>
      <span className="truncate">{title}</span>
      {hint && !compact && <span className="truncate text-[9px] opacity-60">{hint}</span>}
    </div>
  );
}

function MacdPane({
  points, tickFormatter, formatDateFull, compact, testId, title, hint,
}: {
  points: WindowPoint[];
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
  compact: boolean;
  testId: string;
  title: string;
  hint?: string;
}) {
  const narrow = useIsNarrow();
  const tick = axisTick(narrow, compact ? 8 : 9, "var(--muted-foreground)");
  return (
    <>
      <OscCaption title={title} hint={hint} compact={compact} />
      <div className={`${compact ? "h-[72px] sm:h-[84px]" : "h-[130px] sm:h-[150px]"} min-h-10 w-full shrink-0`} style={{ minHeight: TA_OSC_MIN_PX }} data-testid={testId}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="date" tickFormatter={tickFormatter} tick={tick} {...xAxisIntervalProps(narrow, Math.max(0, Math.floor(points.length / (compact ? 4 : 8))))} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={tick} width={52} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v: number) => v.toFixed(compact ? 0 : 1)} {...(narrow ? { tickCount: 5 } : {})} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                  <div className="font-semibold mb-1">{formatDateFull(String(label ?? ""))}</div>
                  {payload.map((p: any) => <div key={p.dataKey} className="flex justify-between gap-3"><span style={{ color: p.color }}>{p.name}</span><span className="font-mono">{Number(p.value).toFixed(4)}</span></div>)}
                </div>
              );
            }} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={0.5} />
            <Bar dataKey="histogram" name="Histogram" isAnimationActive={false}
              shape={(props: any) => {
                const { x, y, width, height, payload } = props;
                return <rect x={x} y={y} width={Math.max(width, 1)} height={Math.abs(height)} fill={(payload?.histogram ?? 0) >= 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"} />;
              }}
            />
            <Line type="monotone" dataKey="macd" name="MACD" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="signal" name="Signal" stroke="#f97316" strokeWidth={1} strokeDasharray="3 2" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function RsiPane({
  points, tickFormatter, formatDateFull, compact, testId, title, hint,
}: {
  points: WindowPoint[];
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
  compact: boolean;
  testId: string;
  title: string;
  hint?: string;
}) {
  const narrow = useIsNarrow();
  const tick = axisTick(narrow, compact ? 8 : 9, "var(--muted-foreground)");
  return (
    <>
      <OscCaption title={title} hint={hint} compact={compact} />
      <div className={`${compact ? "h-[64px] sm:h-[72px]" : "h-[110px] sm:h-[130px]"} min-h-10 w-full shrink-0`} style={{ minHeight: TA_OSC_MIN_PX }} data-testid={testId}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="date" tickFormatter={tickFormatter} tick={tick} {...xAxisIntervalProps(narrow, Math.max(0, Math.floor(points.length / (compact ? 4 : 8))))} axisLine={{ stroke: "var(--border)" }} />
            <YAxis domain={[0, 100]} ticks={compact ? [30, 70] : [0, 30, 50, 70, 100]} tick={tick} width={52} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v: number) => v.toFixed(0)} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const rsiVal = payload[0]?.value;
              const zone = rsiVal == null ? "" : Number(rsiVal) >= 70 ? " — überkauft" : Number(rsiVal) <= 30 ? " — überverkauft" : "";
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                  <div className="font-semibold mb-1">{formatDateFull(String(label ?? ""))}</div>
                  <div className="flex justify-between gap-3"><span className="text-amber-400">RSI(14)</span><span className="font-mono">{Number(rsiVal).toFixed(2)}{zone}</span></div>
                </div>
              );
            }} />
            <ReferenceArea y1={70} y2={100} fill="rgba(239,68,68,0.07)" ifOverflow="hidden" />
            <ReferenceArea y1={0} y2={30} fill="rgba(34,197,94,0.07)" ifOverflow="hidden" />
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={0.8} opacity={0.7} label={compact ? undefined : { value: "70", position: "right", fontSize: 8, fill: "#ef4444" }} />
            <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="4 3" strokeWidth={0.5} opacity={0.4} />
            <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 3" strokeWidth={0.8} opacity={0.7} label={compact ? undefined : { value: "30", position: "right", fontSize: 8, fill: "#22c55e" }} />
            <Line type="monotone" dataKey="rsi" name="RSI(14)" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function BandStack({
  label, labelClassName, labelColor, series, closeStroke, closeName, tickFormatter, formatDateFull,
  visibleMAs, showVolume, showBollinger, showSignals, showMacd, showRsi, count,
  testId, macdTestId, rsiTestId, measureMode, onPlotClick, measurePoints, measurement,
}: {
  label: string;
  labelClassName: string;
  labelColor?: string;
  series: WindowSeries;
  closeStroke: string;
  closeName: string;
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
  visibleMAs: Set<MAKey>;
  showVolume: boolean;
  showBollinger: boolean;
  showSignals: boolean;
  showMacd: boolean;
  showRsi: boolean;
  count: number;
  testId: string;
  macdTestId: string;
  rsiTestId: string;
  measureMode?: boolean;
  onPlotClick?: (e: any) => void;
  measurePoints?: { date: string; close: number }[];
  measurement?: MeasureHit | null;
}) {
  const narrow = useIsNarrow();
  const empty = series.points.length === 0;
  const compact = count > 1;
  return (
    <TaPlotScroll minWidth={taChartMinWidth(52, 0, 10)} testId={`${testId}-scroll`}>
    <div className="w-full" data-testid={testId} {...maProbeAttrs(series.points)}>
      <div className={`${priceBandClass(count)} flex shrink-0 flex-col overflow-hidden ${measureMode ? "cursor-crosshair" : ""}`}>
        <div className={`shrink-0 text-[10px] font-medium leading-none ${labelClassName}`} style={labelColor ? { color: labelColor } : undefined}>{label}</div>
        <div className="min-h-0 w-full flex-1">
          {empty ? (
            <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-amber-600 dark:text-amber-400">
              {label}: {EMPTY_WINDOW_HINT}
            </div>
          ) : (
            <PricePane
              points={series.points}
              signals={series.signals}
              closeStroke={closeStroke}
              closeName={closeName}
              tickFormatter={tickFormatter}
              formatDateFull={formatDateFull}
              visibleMAs={visibleMAs}
              showVolume={showVolume}
              showBollinger={showBollinger}
              showSignals={showSignals}
              dense={compact}
              onPlotClick={onPlotClick}
              measurePoints={measurePoints}
              measurement={measurement}
            />
          )}
        </div>
      </div>
      {narrow && showVolume && !empty && (
        <TaVolumeBand data={series.points} leftAxisWidth={52} marginRight={10} />
      )}
      {!empty && showMacd && (
        <MacdPane points={series.points} tickFormatter={tickFormatter} formatDateFull={formatDateFull} compact={compact} testId={macdTestId} title={`${label} · MACD(12,26,9)`} />
      )}
      {!empty && showRsi && (
        <RsiPane points={series.points} tickFormatter={tickFormatter} formatDateFull={formatDateFull} compact={compact} testId={rsiTestId} title={`${label} · RSI(14)`} />
      )}
    </div>
    </TaPlotScroll>
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
