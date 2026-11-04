import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { StockAnalysis, TradingSignal } from "../../../../shared/schema";
import { SectionCard } from "../SectionCard";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, ReferenceDot, Customized, Area, CartesianGrid,
} from "recharts";
import { useIsNarrow } from "@/hooks/use-mobile";
import { TA_OSC_MIN_PX, TA_PRICE_AXIS_LEFT_PX, TA_PRICE_AXIS_RIGHT_PX, TA_PRICE_MARGIN_RIGHT_PX, axisTick, narrowPriceTicks, taChartMinWidth, xAxisIntervalProps } from "@/lib/taChartScale";
import {
  buildFullSeries, buildWindowSeries, firstFiniteIndex, sliceBars,
  type WindowPoint, type WindowSeries,
} from "@/lib/taWindowSeries";
import { TIME_RANGE_CUTOFF, slicePresetWindow, type TimeRange } from "@/lib/taRangeCutoff";
import { TaPlotScroll, TaVolumeBand } from "./TaPlotFrame";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, Eye, EyeOff, Ruler, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useDividendHistory } from "@/lib/useDividendHistory";
import { dividendOverlaySeries, dividendCurrencyCheck, dividendMarkerLines, attractiveYieldBand, isAttractiveDividendYield, DIV_ATTRACTIVE_YIELD_PCT, DIVIDEND_YIELD_FORMULA, dividendSourceCaption, peerDividendYieldOnDates, type DividendHistoryResponse, type DividendOverlaySeries, type PeerDividendYieldPoint } from "@shared/dividends";
import { chartListingPrice, formatChartPrice } from "@/lib/chartListingPrice";
import { useMarketCreditSpread } from "@/lib/useMarketCreditSpread";
import { creditOverlaySeries, creditStressHint, marketSpreadLabel, ISSUER_BOND_NA_NOTE, CREDIT_STRESS_HINT, type CreditOverlayPoint, type CreditSpreadResponse } from "@shared/credit";
import { useMarketTreasury10Y } from "@/lib/useMarketTreasury10Y";
import { treasury10YOverlaySeries, treasury10YWindowChange, TREASURY10Y_LABEL, type Treasury10YOverlayPoint, type Treasury10YResponse } from "@shared/treasury10y";
import { useMarketReal10Y } from "@/lib/useMarketReal10Y";
import { REAL10Y_OVERLAY, formatReal10yTick, formatReal10yValue, real10yDomain, type Real10YMacroHistory } from "@/lib/real10yOverlay";
import {
  CONE_EDGE_LABEL, CONE_FORMULA, CONE_HORIZON_NAME, CONE_LEGEND, CONE_PARAMS, CONE_PROBABILITY_HINT, CONE_SOURCE, CONE_STYLE, attachConeSeries, coneDomainValues, coneHorizonLabel, coneIntervalLegend, coneMoveColor, coneMoveDirection, conePriceMovePct, formatConeMovePct, scenarioConeFromAnalysis, separateLabelYs,
  type ConeMonteCarlo,
  type ConePlotFields, type LabelBox, type ScenarioCone,
} from "@/lib/scenarioCone";
import { useEarningsYield, usePeerPriceBars, useRoicSeries } from "@/lib/useFundamentalSeries";
import { FUNDAMENTAL_PEER_ROW_CLASS } from "@/lib/fundamentalOverlayLayout";
import { EARNINGS_YIELD_FORMULA, ROIC_FORMULA, estimateBadge, joinFundamentalsOntoPrices, latestFinite, percentAxisDomain, type FundJoinPoint } from "@shared/earnings-yield-roic";
import {
  paintPhaseRows, TA_PHASE_BADGE, TA_PHASE_STROKE,
  type TaPhase,
} from "@shared/ta-phase";
import {
  ampelFactorsFromAnalysis, symmetricAmpelSeries,
  type SymmetricSnapshot,
} from "@shared/symmetric-ampel";

export type { TimeRange };

/** Rendering context handed to `extraPanes` — same X data as MACD/RSI (WORK_RECESSION_TA_CHART). */
export interface TaPaneContext {
  points: WindowPoint[];
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
}

interface Props {
  data: StockAnalysis;
  /** Defaults keep the stock Section 12 exactly as before. */
  sectionNumber?: number;
  title?: string;
  subtitle?: string;
  /** Rendered above the score box (e.g. recession status banner + region switch). */
  headerSlot?: ReactNode;
  /** Extra toggle chips appended to the indicator row. */
  extraChips?: ReactNode;
  /** Synced sub-panes rendered between price pane and MACD (single-window layout). */
  extraPanes?: (ctx: TaPaneContext) => ReactNode;
  rangePresets?: readonly TimeRange[];
  defaultRange?: TimeRange;
  /**
   * S18-Ziehung aus Dashboard: Endkurse und der Horizont aus dem Ergebnis.
   * null = keine Ziehung, der Kegel bleibt beim Katalysator-Horizont und die PoS ist die Log-Regression.
   */
  monteCarlo?: ConeMonteCarlo | null;
}

const STOCK_RANGE_PRESETS = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y"] as const;

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

const EMPTY_WINDOW_HINT = "Keine Bars in diesem Fenster";

/**
 * Sichtbare Plot-Skala des Szenario-Kegels.
 * conePlotScale > 1 verlängert den Scroll-Inhalt. ResponsiveContainer zeichnet
 * den Kegel zuerst in die bisherige Viewport-Breite; der ResizeObserver setzt
 * danach die Pixelbreite auf die verlängerte Fläche. scrollLeft bleibt 0, der
 * Vorlauf liegt außerhalb des sichtbaren Bereichs — der Kegel ist kurz da und
 * verschwindet, auch wenn Earnings Yield oder der Zeitraum den Chart neu zeichnet.
 * Skala 1 hält Historie und Kegel auf derselben Kategorie-Achse im Viewport.
 */
const CONE_VIEWPORT_SCALE = 1;

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
function priceDomain(points: WindowPoint[], visible: Set<MAKey>, showBB: boolean, extra?: readonly number[]): [number, number] {
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
  if (extra) {
    for (const v of extra) {
      if (v != null && isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  const pad = min === max ? (Math.abs(min) * 0.05 || 1) : (max - min) * 0.05;
  return [min - pad, max + pad];
}

export function TechnicalChart({
  data,
  sectionNumber = 12,
  title = "Technische Analyse",
  subtitle = "Interactive Chart – MA / MACD / RSI / BB / Volume",
  headerSlot,
  extraChips,
  extraPanes,
  rangePresets = STOCK_RANGE_PRESETS,
  defaultRange = "1Y",
  monteCarlo = null,
}: Props) {
  const narrow = useIsNarrow();
  const stockPlotMinWidth = taChartMinWidth(TA_PRICE_AXIS_LEFT_PX, TA_PRICE_AXIS_RIGHT_PX, TA_PRICE_MARGIN_RIGHT_PX);
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
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultRange);
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
  // Dividend overlay (Future_1 §11.1): fetched only while the toggle is on.
  const [showDividend, setShowDividend] = useState(false);
  // Toggles are component state; Dashboard keeps <TechnicalChart> mounted across ticker switches (no key), so
  // "on" from the previous ticker leaked into the next one. Reset per ticker → default always off.
  useEffect(() => { setShowDividend(false); }, [data.ticker]);
  const dividendQuery = useDividendHistory(data.ticker, showDividend);
  // Credit overlay (JOB A1): Markt-Spread Baa (FRED BAA10Y), nur geladen solange der Chip an ist.
  // Reine Anzeige — kein Score, kein Fazit-Zählfaktor. Default aus, Reset je Ticker wie Div. Yield.
  const [showCredit, setShowCredit] = useState(false);
  useEffect(() => { setShowCredit(false); }, [data.ticker]);
  const creditQuery = useMarketCreditSpread(showCredit);
  // 10Y-Treasury-Overlay (A3): FRED DGS10, nur geladen solange der Chip an ist. Gleiches Muster wie Credit:
  // reine Anzeige, kein Score, kein Fazit-Zählfaktor. Default aus, Reset je Ticker.
  const [showT10y, setShowT10y] = useState(false);
  useEffect(() => { setShowT10y(false); }, [data.ticker]);
  const t10yQuery = useMarketTreasury10Y(showT10y);
  // Real10Y-Overlay (FRED DFII10): 1:1 der BTC-Chip „Makro → Real10Y“ (Quelle /api/analyze-btc/real10y-history, nur DFII10,
  // Farbe/Achse/Domain aus lib/real10yOverlay). Reine Anzeige, kein Score. Default AN (Philip 18.10.: Overlay auf dem
  // Aktien-Dashboard immer sichtbar), bei Tickerwechsel wieder AN; Fehler/fehlende Daten → n/a-Zeile, kein Ersatzwert.
  const [showReal10y, setShowReal10y] = useState(true);
  useEffect(() => { setShowReal10y(true); }, [data.ticker]);
  // Startdatum = ältester Kurstag der Historie (stabil je Ticker → ein Abruf, unabhängig vom Fenster).
  const real10yStart = useMemo(() => oldestOhlcvDate(ohlcv), [ohlcv]);
  const real10yQuery = useMarketReal10Y(real10yStart, showReal10y);
  // Szenario-Kegel: nur Anzeige. Default aus, Reset je Ticker — aus = keine Serie und keine Achsenänderung.
  const [showCone, setShowCone] = useState(false);
  useEffect(() => { setShowCone(false); }, [data.ticker]);
  // Earnings Yield und ROIC 5Y: nur Anzeige, Default aus, Reset je Ticker. Kein Score.
  const [showEy, setShowEy] = useState(false);
  const [showRoic, setShowRoic] = useState(false);
  const [showPeerFund, setShowPeerFund] = useState(false);
  const [peerMode, setPeerMode] = useState<"price" | "roic">("roic");
  const [peerDraft, setPeerDraft] = useState("");
  const [peerQuery, setPeerQuery] = useState("");
  useEffect(() => {
    setShowEy(false);
    setShowRoic(false);
    setShowPeerFund(false);
    setPeerDraft("");
    setPeerQuery("");
  }, [data.ticker]);
  const peerOn = showPeerFund && peerQuery.length > 0;
  // Tooltip zeigt EY und ROIC des Haupttitels, sobald der Peer-Vergleich an ist.
  // Die Linien bleiben an den Chips. Vorher lief der Abruf nur bei showEy/showRoic,
  // der Tooltip druckte dann „n/a — kein Wert“, während der Peer einen Wert hatte.
  const fundActive = showEy || showRoic || peerOn;
  const eyQuery = useEarningsYield(data.ticker, fundActive);
  const roicQuery = useRoicSeries(data.ticker, fundActive);
  const peerFrom = oldestOhlcvDate(ohlcv);
  const peerTo = newestOhlcvDate(ohlcv);
  const peerRoicQuery = useRoicSeries(peerQuery, peerOn);
  const peerPriceQuery = usePeerPriceBars(peerQuery, peerOn, peerFrom ?? "", peerTo ?? "");
  const peerDivQuery = useDividendHistory(peerQuery, showDividend && peerOn);

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
      <SectionCard number={sectionNumber} title={title} subtitle="Chart & Signale">
        {headerSlot}
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
    return slicePresetWindow(ohlcv, timeRange);
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
  const isHistoryTruncated = !customA && timeRange !== "Max" && ti.maData.length > 0 && ti.maData.length < rangeCutoff * 0.95;
  // Calendar span of the loaded series. Session count / 252 under-counts a
  // listing whose vendor only printed a sale on some days; the from/to dates
  // are that same span.
  const actualYearsAvailable = (() => {
    const first = ti.maData[0]?.date;
    const last = ti.maData[ti.maData.length - 1]?.date;
    if (!first || !last) return 0;
    const ms = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`);
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return +(ms / (365.25 * 86400000)).toFixed(1);
  })();
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
  const ampelFactors = useMemo(() => ampelFactorsFromAnalysis(data), [data]);
  const symmetric = useMemo(
    () => symmetricAmpelSeries(fullSeries.points, ampelFactors),
    [fullSeries, ampelFactors],
  );
  const phaseByDateMap = symmetric.phases;
  const aBuilt = useMemo(() => buildWindowSeries(fullSeries, aBars), [fullSeries, aBars]);
  const scenarioCone = useMemo(() => {
    if (!showCone) return null;
    const last = aBuilt.points[aBuilt.points.length - 1];
    if (!last || !Number.isFinite(last.close) || last.close <= 0) return null;
    return scenarioConeFromAnalysis(data, { date: last.date, close: last.close }, monteCarlo);
  }, [showCone, data, aBuilt.points, monteCarlo]);
  const aAligned = useMemo(() => padConeCategories(aBuilt.points, scenarioCone), [aBuilt.points, scenarioCone]);
  const lineEndPhase = aBuilt.points.length ? (phaseByDateMap.get(aBuilt.points[aBuilt.points.length - 1].date) ?? null) : null;
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
  // JOB 22: Kurs-Symbol aus der Listing-Währung (SHEL.L → £).
  // SAP.DE / VOW3.DE: nach der USD-Bewertung die Achse wieder in Euro (factor = 1/FX).
  const listingPrice = chartListingPrice(data);
  const ccy = listingPrice.symbol;
  const priceFactor = listingPrice.factor;
  const px = (value: number, digits = 2) => formatChartPrice(ccy, value, priceFactor, digits);

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
  const ampelBadge = <ChartAmpelBadge snap={symmetric.last} lineEndPhase={lineEndPhase} buyScore={buyScore} />;

  // Leeres Fenster lässt die Controls stehen, damit Von/Bis korrigierbar bleiben.
  // Jedes Band rechnet Y aus der eigenen Serie — keine gemeinsame Absolute-Y, kein closeB.
  const chartEmpty = aBuilt.points.length === 0;
  // Dividend yield TTM as overlay in the window-A price chart (own right % axis), not a separate pane.
  const dividendSeries = useMemo<DividendOverlaySeries | null>(
    () => (showDividend && dividendQuery.data && dividendQuery.data.events.length > 0 ? dividendOverlaySeries(aBuilt.points, dividendQuery.data.events) : null),
    [showDividend, dividendQuery.data, aBuilt.points],
  );
  // Currency guard: dividend currency (stated by FMP/Yahoo) vs analysis price currency. Mismatch → n/a, no FX.
  const dividendCcy = dividendCurrencyCheck(dividendQuery.data?.currency, data.currency);
  const dividendOverlay = dividendCcy !== "mismatch" && dividendSeries && dividendSeries.points.some(p => p.yieldPct != null) ? dividendSeries : null;
  const peerDividend = useMemo<{ points: PeerDividendYieldPoint[]; sourceText: string } | null>(() => {
    if (!showDividend || !peerOn || !dividendOverlay) return null;
    const dates = aBuilt.points.map(p => p.date);
    if (peerDivQuery.isLoading && !peerDivQuery.data) {
      return {
        points: dates.map(date => ({ date, yieldPct: null, ttmDividend: null, note: "n/a — Peer-Dividende wird geladen" })),
        sourceText: dividendSourceCaption(null),
      };
    }
    if (peerDivQuery.isError && !peerDivQuery.data) {
      return {
        points: dates.map(date => ({ date, yieldPct: null, ttmDividend: null, note: "n/a — Peer-Dividenden-Abruf fehlgeschlagen" })),
        sourceText: dividendSourceCaption(null),
      };
    }
    const history = peerDivQuery.data;
    const bars = peerPriceQuery.data?.bars ?? [];
    const priceNote = peerPriceQuery.isError
      ? "n/a — Peer-Kurs-Abruf fehlgeschlagen"
      : (peerPriceQuery.isLoading && bars.length === 0 ? "n/a — Peer-Kurs wird geladen" : (peerPriceQuery.data?.note ?? null));
    return {
      points: peerDividendYieldOnDates(dates, bars, history?.events ?? [], history?.events?.length ? priceNote : (history?.note ?? priceNote)),
      sourceText: dividendSourceCaption(history?.source),
    };
  }, [showDividend, peerOn, dividendOverlay, aBuilt.points, peerDivQuery.isLoading, peerDivQuery.isError, peerDivQuery.data, peerPriceQuery.data, peerPriceQuery.isError, peerPriceQuery.isLoading]);
  const creditSeries = useMemo<CreditOverlayPoint[] | null>(
    () => (showCredit && creditQuery.data && creditQuery.data.points.length > 0 ? creditOverlaySeries(aBuilt.points, creditQuery.data.points) : null),
    [showCredit, creditQuery.data, aBuilt.points],
  );
  const creditOverlay = creditSeries && creditSeries.some(p => p.spreadPct != null) ? creditSeries : null;
  const creditLabel = marketSpreadLabel(data.ticker);
  const t10ySeries = useMemo<Treasury10YOverlayPoint[] | null>(
    () => (showT10y && t10yQuery.data && t10yQuery.data.points.length > 0 ? treasury10YOverlaySeries(aBuilt.points, t10yQuery.data.points) : null),
    [showT10y, t10yQuery.data, aBuilt.points],
  );
  const t10yOverlay = t10ySeries && t10ySeries.some(p => p.yieldPct != null) ? t10ySeries : null;
  const real10ySeries = useMemo<Real10YOverlayPoint[] | null>(
    () => (showReal10y ? real10yOverlaySeries(aBuilt.points, real10yQuery.data) : null),
    [showReal10y, real10yQuery.data, aBuilt.points],
  );
  const real10yOverlay = real10ySeries && real10ySeries.some(p => p.real10y != null) ? real10ySeries : null;
  const fundOverlay = useMemo<FundJoinPoint[] | null>(() => {
    if (!fundActive) return null;
    const eyLoaded = !!eyQuery.data;
    const eyEmpty = eyLoaded && eyQuery.data!.quarters.length === 0 && eyQuery.data!.ttmPrints.length === 0 && eyQuery.data!.annualEps.length === 0;
    const joined = joinFundamentalsOntoPrices(aBuilt.points.map(p => p.date), {
      earningsYield: null,
      epsQuarters: fundActive ? (eyQuery.data?.quarters ?? []) : null,
      ttmPrints: fundActive ? (eyQuery.data?.ttmPrints ?? []) : null,
      annualEps: fundActive ? (eyQuery.data?.annualEps ?? []) : null,
      priceCurrency: data.currency ?? null,
      priceFx: data.currencyInfo?.converted && eyQuery.data?.fxHistory && eyQuery.data.fxHistory.length > 0
        ? {
            from: data.currencyInfo.reportedCurrency,
            to: data.currencyInfo.tradingCurrency,
            rate: data.currencyInfo.fxRate,
            history: eyQuery.data.fxHistory,
          }
        : null,
      roic: fundActive ? (roicQuery.data?.points ?? null) : null,
      roicSeriesNote: !fundActive
        ? null
        : roicQuery.isError
          ? "n/a — ROIC-Abruf fehlgeschlagen"
          : (roicQuery.data?.note ?? (roicQuery.isLoading ? "n/a — ROIC wird geladen" : "n/a — keine ROIC-Punkte")),
      peerRoic: peerRoicQuery.data?.points ?? null,
      peerRoicSeriesNote: peerOn
        ? (peerRoicQuery.isError ? "n/a — Peer-ROIC-Abruf fehlgeschlagen" : (peerRoicQuery.data?.note ?? (peerRoicQuery.isLoading ? "n/a — Peer-ROIC wird geladen" : null)))
        : null,
      peerBars: peerPriceQuery.data?.bars ?? null,
      peerPriceSeriesNote: peerPriceQuery.isError
        ? "n/a — Peer-Kurs-Abruf fehlgeschlagen"
        : (peerPriceQuery.data?.note ?? (peerPriceQuery.isLoading ? "n/a — Peer-Kurs wird geladen" : null)),
      subjectCloses: aBuilt.points.map(p => p.close),
      showEarningsYield: showEy,
      showRoic,
      showPeerRoic: peerOn,
      showPeerPrice: peerOn,
      resolveEarningsYield: fundActive,
      resolveRoic: fundActive,
    });
    return joined.map(point => {
      let earningsYieldKnown = point.earningsYieldKnown;
      let earningsYieldNote = point.earningsYieldNote;
      let roicKnown = point.roicKnown;
      let roicNote = point.roicNote;
      if (eyQuery.isLoading && !eyQuery.data) {
        earningsYieldKnown = null;
        earningsYieldNote = "n/a — Earnings Yield wird geladen";
      } else if (eyQuery.isError && !eyQuery.data) {
        earningsYieldKnown = null;
        earningsYieldNote = "n/a — Earnings-Yield-Abruf fehlgeschlagen";
      } else if (eyEmpty && eyQuery.data?.note) {
        earningsYieldKnown = null;
        earningsYieldNote = eyQuery.data.note;
      } else if (earningsYieldKnown != null && earningsYieldNote && !earningsYieldNote.includes("Quelle:") && eyQuery.data?.source) {
        earningsYieldNote = `${earningsYieldNote} · Quelle: ${eyQuery.data.source}`;
      }
      if (roicQuery.isLoading && !roicQuery.data) {
        roicKnown = null;
        roicNote = "n/a — ROIC wird geladen";
      } else if (roicQuery.isError && !roicQuery.data) {
        roicKnown = null;
        roicNote = "n/a — ROIC-Abruf fehlgeschlagen";
      }
      return {
        ...point,
        earningsYieldPct: showEy ? earningsYieldKnown : null,
        earningsYieldKnown,
        earningsYieldNote,
        roicPct: showRoic ? roicKnown : null,
        roicKnown,
        roicNote,
        peerRoicPct: peerMode === "roic" ? point.peerRoicKnown : null,
        peerPriceIndexed: peerMode === "price" ? point.peerPriceIndexed : null,
      };
    });
  }, [fundActive, showEy, showRoic, peerOn, peerMode, eyQuery.data, eyQuery.isError, eyQuery.isLoading, roicQuery.data, roicQuery.isError, roicQuery.isLoading, peerRoicQuery.data, peerRoicQuery.isError, peerRoicQuery.isLoading, peerPriceQuery.data, peerPriceQuery.isError, peerPriceQuery.isLoading, aBuilt.points, data.currency, data.currencyInfo]);

  const formatDate = (date: string) => {
    const p = date.split("-");
    const presetLong = timeRange==="2Y"||timeRange==="3Y"||timeRange==="5Y"||timeRange==="10Y"||timeRange==="Max";
    const customLong = !!customA && (new Date(customA.to + "T00:00:00").getTime() - new Date(customA.from + "T00:00:00").getTime()) > 400 * 86400000;
    const long = customA ? customLong : presetLong;
    return long
      ? `${p[1]}/${p[0].slice(2)}`
      : `${p[1]}/${p[2]}`;
  };
  const formatDateFull = (date: string) =>
    new Date(date + "T00:00:00").toLocaleDateString("de-DE", { day:"2-digit", month:"short", year:"numeric" });


  return (
    <SectionCard number={sectionNumber} title={title} subtitle={subtitle}>
      {headerSlot}

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

      {symmetric.last && (
        <div
          className="mb-3 text-[10px] leading-snug text-muted-foreground break-words"
          data-testid="symmetric-ampel-facts"
          data-color={symmetric.last.color ?? ""}
          data-meaning={symmetric.last.meaning ?? ""}
          title={symmetric.last.summary}
        >
          {symmetric.last.summary}
        </div>
      )}

      {/* ── Status pills (4 Bedingungen) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatusPill label="Kurs > MA200" value={cs.priceAboveMA200} detail={cs.ma200Value ? `MA200: ${px(cs.ma200Value)}` : ""} />
        <StatusPill label="MA50 > MA200"  value={cs.ma50AboveMA200}  detail={cs.ma50Value  ? `MA50: ${px(cs.ma50Value)}`   : ""} />
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
            {rangePresets.map(r => (
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
            <button type="button" onClick={() => setShowDividend(v => !v)} data-testid="button-dividend" aria-pressed={showDividend}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showDividend ? "border-teal-500 text-teal-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showDividend ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Div. Yield
            </button>
            <button type="button" onClick={() => setShowCredit(v => !v)} data-testid="button-credit" aria-pressed={showCredit}
              aria-label={creditLabel}
              title={`${creditLabel}. FRED BAA10Y, kein Score-Einfluss. ${ISSUER_BOND_NA_NOTE}`}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showCredit ? "border-rose-500 text-rose-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showCredit ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Markt-Spread Baa
            </button>
            <button type="button" onClick={() => setShowT10y(v => !v)} data-testid="button-t10y" aria-pressed={showT10y}
              aria-label={TREASURY10Y_LABEL}
              title={`${TREASURY10Y_LABEL}. FRED DGS10, eigene rechte %-Achse, kein Score-Einfluss.`}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showT10y ? "border-indigo-500 text-indigo-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showT10y ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              10J-Treasury
            </button>
            <button type="button" onClick={() => setShowReal10y(v => !v)} data-testid="button-real10y" aria-pressed={showReal10y}
              aria-label={REAL10Y_OVERLAY.lineName}
              title={`${REAL10Y_OVERLAY.chipTitle}. ${REAL10Y_OVERLAY.sourceLabel}, kein Score-Einfluss.`}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] font-mono transition-colors sm:min-h-7 sm:text-[10px] ${
                showReal10y ? REAL10Y_OVERLAY.chipOnClass : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showReal10y ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              {REAL10Y_OVERLAY.label}
            </button>
            <button type="button" onClick={() => setShowCone(v => !v)} data-testid="button-scenario-cone" aria-pressed={showCone}
              aria-label="Szenario-Kegel"
              title="Szenario-Kegel ab dem letzten Close. Nur Anzeige, kein Score. Standard aus."
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showCone ? "border-slate-400 text-slate-300" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showCone ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Szenario-Kegel
            </button>
            <button type="button" onClick={() => setShowEy(v => !v)} data-testid="button-earnings-yield" aria-pressed={showEy}
              title={`Earnings Yield = ${EARNINGS_YIELD_FORMULA}, rechte %-Achse, kein Score-Einfluss.${eyQuery.data?.source ? ` Quelle: ${eyQuery.data.source}.` : ""}`}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showEy ? "border-sky-500 text-sky-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showEy ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Earnings Yield
            </button>
            <button type="button" onClick={() => setShowRoic(v => !v)} data-testid="button-roic-5y" aria-pressed={showRoic}
              title={`${roicQuery.data?.label ?? "ROIC"} = ${roicQuery.data?.formula ?? ROIC_FORMULA}, rechte %-Achse, kein Score-Einfluss.${roicQuery.data?.source ? ` Quelle: ${roicQuery.data.source}.` : ""}`}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showRoic ? "border-lime-500 text-lime-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showRoic ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              {roicQuery.data?.label ?? "ROIC"}
            </button>
            <button type="button" onClick={() => setShowPeerFund(v => !v)} data-testid="button-fund-peer" aria-pressed={showPeerFund}
              title="Peer als Kurs (Median-Index, linke Achse) oder ROIC (rechte Achse). Kein Score-Einfluss."
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                showPeerFund ? "border-orange-400 text-orange-400" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              {showPeerFund ? <Eye className="w-2.5 h-2.5"/> : <EyeOff className="w-2.5 h-2.5"/>}
              Peer
            </button>
            <button type="button" onClick={() => { setMeasureMode(v => !v); setMeasurePoints([]); }}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
                measureMode ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}>
              <Ruler className="w-2.5 h-2.5"/>
              Messen
            </button>
            {extraChips}
          </div>
          {showPeerFund && (
            <div className={FUNDAMENTAL_PEER_ROW_CLASS} data-testid="row-fund-peer">
              <input
                type="text"
                value={peerDraft}
                onChange={e => setPeerDraft(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === "Enter") setPeerQuery(peerDraft.trim().toUpperCase()); }}
                placeholder="Peer-Ticker"
                aria-label="Peer-Ticker"
                data-testid="input-fund-peer"
                className="h-9 w-full min-w-0 rounded border border-border bg-background px-2 text-[11px] sm:h-7 sm:w-28"
              />
              <button type="button" data-testid="button-fund-peer-add" onClick={() => setPeerQuery(peerDraft.trim().toUpperCase())}
                className="h-9 shrink-0 rounded border border-border px-2 text-[11px] sm:h-7">
                Übernehmen
              </button>
              <div className="flex min-w-0 gap-1">
                <button type="button" data-testid="button-fund-peer-roic" aria-pressed={peerMode === "roic"} onClick={() => setPeerMode("roic")}
                  className={`h-9 flex-1 rounded border px-2 text-[11px] sm:h-7 sm:flex-none ${peerMode === "roic" ? "border-lime-500 text-lime-500" : "border-border text-muted-foreground"}`}>
                  ROIC
                </button>
                <button type="button" data-testid="button-fund-peer-price" aria-pressed={peerMode === "price"} onClick={() => setPeerMode("price")}
                  className={`h-9 flex-1 rounded border px-2 text-[11px] sm:h-7 sm:flex-none ${peerMode === "price" ? "border-orange-400 text-orange-400" : "border-border text-muted-foreground"}`}>
                  Kurs
                </button>
              </div>
            </div>
          )}
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
                {measurePoints.length===1 && <span className="ml-1.5 font-mono text-foreground">A: {formatDateFull(measurePoints[0].date)} — {px(measurePoints[0].close)}</span>}
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-muted-foreground">{formatDateFull(measurement.a.date)} → {formatDateFull(measurement.b.date)}</span>
                <span className={`font-bold font-mono text-sm ${measurement.isGain?"text-emerald-500":"text-red-500"}`}>
                  {measurement.isGain?"+":""}{measurement.diff.toFixed(2)} ({measurement.isGain?"+":""}{measurement.pct.toFixed(2)}%) {measurement.isGain?"↑":"↓"}
                </span>
                <span className="text-muted-foreground font-mono">{px(measurement.a.close)} → {px(measurement.b.close)}</span>
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
        <TaPlotScroll minWidth={stockPlotMinWidth} testId="chart-price-scroll" widthScale={CONE_VIEWPORT_SCALE} scrollToEnd={showCone} overlay={ampelBadge}>
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
                dividend={dividendOverlay}
                peerDividend={peerDividend?.points ?? null}
                peerDividendSource={peerDividend?.sourceText ?? null}
                credit={creditOverlay}
                creditLabel={creditLabel}
                t10y={t10yOverlay}
                real10y={real10yOverlay}
                ccy={ccy}
                priceFactor={priceFactor}
                cone={scenarioCone}
                fund={fundOverlay}
                phases={phaseByDateMap}
              />
            </div>
            {narrow && showVolume && (
              <TaVolumeBand data={aAligned} leftAxisWidth={52} marginRight={10} />
            )}
            {extraPanes?.({ points: aAligned, tickFormatter: formatDate, formatDateFull })}
            {showMacd && (
              <MacdPane points={aAligned} tickFormatter={formatDate} formatDateFull={formatDateFull} compact={false} testId="chart-macd" title="MACD(12,26,9)" hint="= EMA₁₂ - EMA₂₆ | Signal = EMA₉(MACD) | Histogram = MACD - Signal" />
            )}
            {showRsi && (
              <RsiPane points={aAligned} tickFormatter={formatDate} formatDateFull={formatDateFull} compact={false} testId="chart-rsi" title="RSI(14)" hint="| <30 überverkauft · >70 überkauft" />
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
              ccy={ccy}
              priceFactor={priceFactor}
              cone={scenarioCone}
              widthScale={CONE_VIEWPORT_SCALE}
              scrollToEnd={showCone}
              alignedPoints={aAligned}
              testId="chart-band-a"
              macdTestId="chart-macd"
              rsiTestId="chart-rsi"
              dividend={dividendOverlay}
              peerDividend={peerDividend?.points ?? null}
              peerDividendSource={peerDividend?.sourceText ?? null}
              credit={creditOverlay}
              creditLabel={creditLabel}
              t10y={t10yOverlay}
              real10y={real10yOverlay}
              fund={fundOverlay}
              measureMode={measureMode}
              onPlotClick={handleChartClick}
              measurePoints={measurePoints}
              measurement={measurement}
              phases={phaseByDateMap}
              overlay={ampelBadge}
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
              ccy={ccy}
              priceFactor={priceFactor}
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
              ccy={ccy}
              priceFactor={priceFactor}
              testId="chart-band-c"
              macdTestId="chart-macd-c"
              rsiTestId="chart-rsi-c"
            />
          )}
        </div>
      )}

      {showCone && scenarioCone && (
        <div
          className="mt-1 text-[10px] text-muted-foreground break-words"
          data-testid="scenario-cone-status"
          data-anchor={scenarioCone.anchorPrice}
          data-anchor-date={scenarioCone.anchorDate}
          data-sigma={scenarioCone.sigmaDaily ?? ""}
          data-horizon={scenarioCone.horizonDays}
          data-short={scenarioCone.shortHistory ? "1" : "0"}
          data-drift={scenarioCone.driftPerDay ?? ""}
          data-formula={CONE_FORMULA}
          title={`${CONE_SOURCE}. ${CONE_FORMULA}`}
        >
          Szenario-Kegel ab letztem Close <span className="font-mono">{px(scenarioCone.anchorPrice)}</span>
          {" "}({scenarioCone.anchorDate}) · Horizont {scenarioCone.horizonDays} Handelstage
          {scenarioCone.sigmaDaily != null && <> · σ<sub>η</sub> <span className="font-mono">{scenarioCone.sigmaDaily.toFixed(4)}</span></>}
          {scenarioCone.driftPerDay != null && <> · b <span className="font-mono">{scenarioCone.driftPerDay.toFixed(6)}</span></>}
          {scenarioCone.shortHistory && <> · Regressionsfenster kürzer als {CONE_PARAMS.regressionWindowDays} Tage</>}
          {scenarioCone.bandReason && <> · {scenarioCone.bandReason}</>}
          {" "}· 50%-Band und 80%-Band
          {" "}· {coneIntervalLegend("outer")} · {coneIntervalLegend("inner")}
          {" "}· {scenarioCone.markers.map(m => `${m.price != null ? `${px(m.price)} · ` : ""}${m.caption}${m.sourceLabel ? ` · ${m.sourceLabel}` : ""}${m.formula ? ` · ${m.formula}` : ""}${m.posReason ? ` (${m.posReason})` : ""}`).join(" · ")}
          {" "}· {CONE_SOURCE}
          {" "}· nur Anzeige, kein Score
          <div data-testid="cone-legend" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: CONE_STYLE.outerFill, opacity: CONE_STYLE.outerFillOpacity }} />{coneIntervalLegend("outer")}</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: CONE_STYLE.innerFill, opacity: CONE_STYLE.innerFillOpacity }} />{coneIntervalLegend("inner")}</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ background: CONE_STYLE.midline }} />{CONE_LEGEND.midline}</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-3 border-t border-dashed" style={{ borderColor: CONE_STYLE.forecastStart }} />{CONE_LEGEND.forecastStart}</span>
          </div>
          <div data-testid="cone-probability-hint">{CONE_PROBABILITY_HINT}</div>
        </div>
      )}

      {showDividend && showKursA && !chartEmpty && (
        <DividendOverlayStatus
          series={dividendOverlay}
          history={dividendQuery.data}
          loading={dividendQuery.isLoading}
          failed={dividendQuery.isError}
          formatDateFull={formatDateFull}
          currencyCheck={dividendCcy}
          priceCurrency={data.currency}
          peerCaption={peerDividend ? `Peer Div. Yield · Formel: ${DIVIDEND_YIELD_FORMULA} · Quelle: ${peerDividend.sourceText}. Kein Score-Einfluss.` : null}
        />
      )}

      {showCredit && showKursA && !chartEmpty && (
        <CreditOverlayStatus
          series={creditOverlay}
          response={creditQuery.data ?? undefined}
          loading={creditQuery.isLoading}
          failed={creditQuery.isError}
          label={creditLabel}
          formatDateFull={formatDateFull}
        />
      )}

      {showT10y && showKursA && !chartEmpty && (
        <Treasury10YOverlayStatus
          series={t10yOverlay}
          response={t10yQuery.data ?? undefined}
          loading={t10yQuery.isLoading}
          failed={t10yQuery.isError}
          formatDateFull={formatDateFull}
        />
      )}

      {showReal10y && showKursA && !chartEmpty && (
        <Real10YOverlayStatus
          series={real10yOverlay}
          response={real10yQuery.data ?? undefined}
          loading={real10yQuery.isLoading}
          failed={real10yQuery.isError}
          formatDateFull={formatDateFull}
        />
      )}

      {(showEy || showRoic || showPeerFund) && showKursA && !chartEmpty && (
        <FundamentalOverlayStatus
          showEy={showEy}
          showRoic={showRoic}
          showPeer={showPeerFund}
          peerMode={peerMode}
          peerTicker={peerQuery}
          eyLoading={eyQuery.isLoading}
          roicLoading={roicQuery.isLoading}
          peerLoading={peerRoicQuery.isLoading || peerPriceQuery.isLoading}
          eyNote={eyQuery.data?.note ?? null}
          roicNote={roicQuery.data?.note ?? null}
          eySource={eyQuery.data?.source ?? null}
          roicSource={roicQuery.data?.source ?? null}
          peerRoicSource={peerRoicQuery.data?.source ?? null}
          roicLabel={roicQuery.data?.label ?? "ROIC"}
          roicFormula={roicQuery.data?.formula ?? ROIC_FORMULA}
          peerRoicFormula={peerRoicQuery.data?.formula ?? ROIC_FORMULA}
          eyLatest={latestOverlayPct(fundOverlay, "earningsYieldPct", "earningsYieldNote") ?? { value: null, note: eyQuery.data?.note ?? null }}
          roicLatest={latestOverlayPct(fundOverlay, "roicPct", "roicNote") ?? latestFinite(roicQuery.data?.points)}
          peerRoicLatest={latestOverlayPct(fundOverlay, "peerRoicKnown", "peerRoicNote") ?? latestFinite(peerRoicQuery.data?.points)}
          peerPriceNote={peerPriceQuery.data?.note ?? null}
        />
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
                    <td className="py-1 text-right font-mono tabular-nums">{px(s.price)}</td>
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

function padConeCategories(points: WindowPoint[], cone: ScenarioCone | null): WindowPoint[] {
  if (!cone || cone.points.length < 2) return points;
  const tail: WindowPoint[] = [];
  for (let i = 1; i < cone.points.length; i++) {
    tail.push({
      date: cone.points[i].date,
      close: Number.NaN,
      volume: 0,
      _volNorm: 0,
      _volUp: false,
      _signals: null,
    });
  }
  return points.concat(tail);
}

const CONE_TIP_KEYS = new Set(["coneP10", "coneP50", "coneP90", "coneInnerLow", "coneInnerHigh", "coneBull", "coneBase", "coneBear"]);

function markerFill(id: string): string {
  if (id === "bull") return CONE_STYLE.bull;
  if (id === "base") return CONE_STYLE.base;
  return CONE_STYLE.bear;
}

type ChartAxis = {
  scale?: (value: number | string) => number;
  niceTicks?: number[];
  tick?: { fontSize?: number } | boolean;
};

/** Geschlossene Fläche zwischen zwei Kegellinien. Koordinaten aus den Achsen, keine zweite Skala. */
function coneBandPath(
  xScale: (value: number | string) => number,
  yScale: (value: number | string) => number,
  cone: ScenarioCone,
  low: (point: ScenarioCone["points"][number]) => number,
  high: (point: ScenarioCone["points"][number]) => number,
): string {
  const forward: string[] = [];
  const back: Array<[number, number]> = [];
  for (const point of cone.points) {
    const x = xScale(point.date);
    const yHi = yScale(high(point));
    const yLo = yScale(low(point));
    if (!Number.isFinite(x) || !Number.isFinite(yHi) || !Number.isFinite(yLo)) continue;
    forward.push(`${forward.length === 0 ? "M" : "L"}${x.toFixed(2)},${yHi.toFixed(2)}`);
    back.push([x, yLo]);
  }
  if (forward.length < 2) return "";
  const reverse = [...back].reverse().map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`);
  return `${forward.join("")}${reverse.join("")}Z`;
}

function ConeBandFill({
  xAxisMap,
  yAxisMap,
  cone,
}: {
  xAxisMap?: Record<string, ChartAxis>;
  yAxisMap?: Record<string, ChartAxis>;
  cone: ScenarioCone;
}) {
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  const priceAxis = yAxisMap?.price;
  if (!xAxis?.scale || !priceAxis?.scale || cone.points.length < 2) return null;
  const outer = coneBandPath(xAxis.scale, priceAxis.scale, cone, point => point.p10, point => point.p90);
  const inner = coneBandPath(xAxis.scale, priceAxis.scale, cone, point => point.innerLow, point => point.innerHigh);
  if (!outer && !inner) return null;
  return (
    <g data-testid="cone-band-fill" pointerEvents="none">
      {outer ? <path data-testid="cone-band-outer" d={outer} fill={CONE_STYLE.outerFill} fillOpacity={CONE_STYLE.outerFillOpacity} stroke="none" /> : null}
      {inner ? <path data-testid="cone-band-inner" d={inner} fill={CONE_STYLE.innerFill} fillOpacity={CONE_STYLE.innerFillOpacity} stroke="none" /> : null}
    </g>
  );
}

/** Größer als die Achsen-Ticks, damit PoS und die Prozentänderung am Horizont lesbar bleiben. */
const CONE_HORIZON_LABEL_PX = 13;

function coneMoveParts(anchor: number, price: number): { text: string; color: string; direction: "up" | "down" | "flat" } | null {
  const pct = conePriceMovePct(anchor, price);
  const direction = coneMoveDirection(pct);
  if (pct == null || direction == null) return null;
  return { text: formatConeMovePct(pct), color: coneMoveColor(direction), direction };
}

/**
 * Kegel-Labels am Horizont-Ende. Stehen sie sich oder dem Dividenden-Label
 * „4 % attraktiv“ zu nahe, verschiebt separateLabelYs sie um den Fehlbetrag
 * aus Label-Höhe und Pixelabstand. Der Punkt bleibt auf dem Kurs.
 */
function ConeEndLabels({
  xAxisMap,
  yAxisMap,
  cone,
  priceFontPx,
  labelShift,
  formatPx,
  priceSymbol,
  priceFactor,
}: {
  xAxisMap?: Record<string, ChartAxis>;
  yAxisMap?: Record<string, ChartAxis>;
  cone: ScenarioCone;
  priceFontPx: number;
  labelShift: Record<string, number>;
  formatPx: (value: number, digits?: number) => string;
  priceSymbol: string;
  priceFactor: number;
}) {
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  const priceAxis = yAxisMap?.price;
  const end = cone.points[cone.points.length - 1];
  if (!xAxis?.scale || !priceAxis?.scale || !end || !(priceFontPx > 0)) return null;
  const dotX = xAxis.scale(end.date);
  if (!Number.isFinite(dotX)) return null;
  const markers = cone.markers.filter(m => m.price != null && Number.isFinite(m.price));
  const bands = [
    { id: "p90", y: end.p90, name: CONE_EDGE_LABEL.p90 },
    { id: "p75", y: end.innerHigh, name: CONE_EDGE_LABEL.p75 },
    { id: "p50", y: end.p50, name: CONE_EDGE_LABEL.p50 },
    { id: "p25", y: end.innerLow, name: CONE_EDGE_LABEL.p25 },
    { id: "p10", y: end.p10, name: CONE_EDGE_LABEL.p10 },
  ];
  return (
    <g data-testid="cone-marker-labels">
      <title>{`${CONE_SOURCE}. ${CONE_FORMULA}`}</title>
      {bands.map(b => {
        const anchorY = priceAxis.scale!(b.y);
        const move = coneMoveParts(cone.anchorPrice, b.y);
        if (!Number.isFinite(anchorY) || !move) return null;
        return (
          <text
            key={b.id}
            data-testid={`cone-label-${b.id}`}
            x={dotX - priceFontPx}
            y={anchorY + (labelShift[b.id] ?? 0)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={CONE_HORIZON_LABEL_PX}
            fontWeight={600}
          >
            <tspan fill={CONE_STYLE.band}>{b.name}</tspan>
            <tspan fill={move.color} data-direction={move.direction}>{` ${formatPx(b.y)} ${move.text}`}</tspan>
          </text>
        );
      })}
      {markers.map(m => {
        const price = m.price as number;
        const anchorY = priceAxis.scale!(price);
        const line = coneHorizonLabel({
          name: CONE_HORIZON_NAME[m.id],
          probability: m.probability,
          price,
          anchor: cone.anchorPrice,
          symbol: priceSymbol,
          factor: priceFactor,
        });
        if (!Number.isFinite(anchorY) || !line) return null;
        return (
          <text
            key={m.id}
            data-testid={`cone-label-${m.id}`}
            x={dotX - priceFontPx}
            y={anchorY + (labelShift[m.id] ?? 0)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={CONE_HORIZON_LABEL_PX}
            fontWeight={600}
          >
            <title>{[m.caption, m.formula, m.posReason].filter(Boolean).join(" · ")}</title>
            <tspan fill={markerFill(m.id)} data-testid={`cone-pos-${m.id}`}>{line.lead}</tspan>
            <tspan fill={coneMoveColor(line.direction)} data-direction={line.direction}>{line.move}</tspan>
          </text>
        );
      })}
    </g>
  );
}

/** Gemessene Boxen: Kegel-Labels weichen Dividenden-Text aus, Abstand = Fehlbetrag aus Höhe und Pixelabstand. */
function measureConeLabelShift(root: HTMLElement, prev: Record<string, number>): Record<string, number> | null {
  const coneNodes = Array.from(root.querySelectorAll<SVGTextElement>("[data-testid^='cone-label-']"));
  if (coneNodes.length === 0) return Object.keys(prev).length ? {} : null;
  const boxes: LabelBox[] = [];
  const current = new Map<string, number>();
  for (const n of coneNodes) {
    const b = n.getBoundingClientRect();
    if (!(b.height > 0) || !(b.width > 0)) continue;
    const id = (n.getAttribute("data-testid") || "").replace("cone-label-", "");
    const yPx = b.y + b.height / 2;
    current.set(id, yPx);
    boxes.push({ id, xPx: b.x, widthPx: b.width, yPx, heightPx: b.height });
  }
  let fixedN = 0;
  root.querySelectorAll("text").forEach(n => {
    if (n.getAttribute("data-testid")?.startsWith("cone-label-")) return;
    const b = n.getBoundingClientRect();
    if (!(b.height > 0) || !(b.width > 0)) return;
    const hits = boxes.some(c => c.xPx < b.x + b.width && b.x < c.xPx + c.widthPx);
    if (!hits) return;
    boxes.push({
      id: `fixed-${fixedN++}`,
      xPx: b.x,
      widthPx: b.width,
      yPx: b.y + b.height / 2,
      heightPx: b.height,
      fixed: true,
    });
  });
  const placed = separateLabelYs(boxes);
  const next: Record<string, number> = {};
  let changed = false;
  const pixel = 1 / (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
  for (const p of placed) {
    if (p.id.startsWith("fixed-")) continue;
    const now = current.get(p.id);
    if (now == null) continue;
    const delta = p.yPx - now;
    next[p.id] = (prev[p.id] ?? 0) + delta;
    if (Math.abs(delta) > pixel) changed = true;
  }
  return changed ? next : null;
}

function ConePriceWithMove({ anchor, price, formatPx }: { anchor: number; price: number; formatPx: (value: number, digits?: number) => string }) {
  const move = coneMoveParts(anchor, price);
  if (!move) return <span className="font-mono">{formatPx(price)}</span>;
  return (
    <span className="font-mono">
      {formatPx(price)}{" "}
      <span data-testid="cone-move" data-direction={move.direction} style={{ color: move.color }}>{move.text}</span>
    </span>
  );
}

function ConeTooltipRows({ p, formatPx, cone, priceSymbol, priceFactor }: { p: ConePlotFields; formatPx: (value: number, digits?: number) => string; cone: ScenarioCone; priceSymbol: string; priceFactor: number }) {
  if (p.coneP50 == null && p.coneBull == null && p.coneBase == null && p.coneBear == null) return null;
  const anchor = cone.anchorPrice;
  const row = (color: string, name: string, value: number | null | undefined) => (
    value != null && Number.isFinite(value)
      ? <div key={name} className="flex justify-between gap-3"><span style={{ color }}>{name}</span><ConePriceWithMove anchor={anchor} price={value} formatPx={formatPx} /></div>
      : null
  );
  const scenarioRow = (id: "bull" | "base" | "bear", value: number | null | undefined, caption: string | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return null;
    const marker = cone.markers.find(m => m.id === id);
    const line = marker && coneHorizonLabel({
      name: CONE_HORIZON_NAME[id],
      probability: marker.probability,
      price: value,
      anchor,
      symbol: priceSymbol,
      factor: priceFactor,
    });
    if (!marker || !line) return null;
    return (
      <div key={id} className="flex justify-between gap-3" title={[caption, marker.formula, marker.posReason].filter(Boolean).join(" · ") || undefined} data-testid={`cone-tip-${id}`}>
        <span style={{ color: markerFill(id) }}>{line.lead}</span>
        <span className="font-mono" data-testid="cone-move" data-direction={line.direction} style={{ color: coneMoveColor(line.direction) }}>{line.move}</span>
      </div>
    );
  };
  return (
    <>
      <div data-testid="cone-tooltip-formula" className="mt-1 max-w-[260px] whitespace-normal text-muted-foreground" title={CONE_FORMULA}>
        <div>{CONE_SOURCE}</div>
        <div>{CONE_FORMULA}</div>
        <div>{coneIntervalLegend("outer")} · {coneIntervalLegend("inner")}</div>
      </div>
      {row(CONE_STYLE.outerStroke, CONE_EDGE_LABEL.p10, p.coneP10)}
      {row(CONE_STYLE.innerStroke, CONE_EDGE_LABEL.p25, p.coneInnerLow)}
      {row(CONE_STYLE.midline, CONE_LEGEND.midline, p.coneP50)}
      {row(CONE_STYLE.innerStroke, CONE_EDGE_LABEL.p75, p.coneInnerHigh)}
      {row(CONE_STYLE.outerStroke, CONE_EDGE_LABEL.p90, p.coneP90)}
      {scenarioRow("bull", p.coneBull, p.coneBullLabel)}
      {scenarioRow("base", p.coneBase, p.coneBaseLabel)}
      {scenarioRow("bear", p.coneBear, p.coneBearLabel)}
    </>
  );
}

function PricePane({
  points, signals, closeStroke, closeName, tickFormatter, formatDateFull,
  visibleMAs, showVolume, showBollinger, showSignals, dense,
  onPlotClick, measurePoints, measurement, dividend, peerDividend = null, peerDividendSource = null, credit, creditLabel, t10y, real10y, ccy = "$",
  priceFactor = 1, cone = null, fund = null, phases = null,
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
  dividend?: DividendOverlaySeries | null;
  /** Peer-Dividendenrendite auf denselben Kurstagen, zweite Linie der Div.-Yield-Achse. */
  peerDividend?: PeerDividendYieldPoint[] | null;
  peerDividendSource?: string | null;
  /** JOB A1: Markt-Spread Baa je Kurstag (eigene rechte %-Achse). */
  credit?: CreditOverlayPoint[] | null;
  creditLabel?: string;
  /** A3: 10J-Treasury-Rendite (FRED DGS10) je Kurstag (eigene rechte %-Achse). */
  t10y?: Treasury10YOverlayPoint[] | null;
  /** Real10Y (FRED DFII10) je Kurstag, wie BTC-Chart (eigene rechte %-Achse). */
  real10y?: Real10YOverlayPoint[] | null;
  /** JOB 22: Kurs-Symbol (Listing-Währung). */
  ccy?: string;
  /** Datenwert × factor = Beschriftung. 1 = Kerzen schon in der Anzeigewährung. */
  priceFactor?: number;
  /** Szenario-Kegel. null = Chart-Daten und Preisdomäne unverändert. */
  cone?: ScenarioCone | null;
  /** Earnings Yield / ROIC / Peer, nur Anzeige. null = keine zusätzliche Serie. */
  fund?: FundJoinPoint[] | null;
  /** Phasenfarbe der Kurslinie. null = eine Farbe, wie bisher. */
  phases?: Map<string, TaPhase | null> | null;
}) {
  const narrow = useIsNarrow();
  const conePrices = cone ? coneDomainValues(cone) : undefined;
  const peerIndexed = (fund ?? []).map(p => p.peerPriceIndexed).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const domainExtra = [...(conePrices ?? []), ...peerIndexed];
  const [yMin, yMax] = priceDomain(points, visibleMAs, showBollinger, domainExtra.length ? domainExtra : undefined);
  const chartData = useMemo(() => {
    const base = withFundOverlay(withReal10YOverlay(withTreasury10YOverlay(withCreditOverlay(withDividendOverlay(points, dividend, peerDividend), credit), t10y), real10y), fund);
    return cone ? attachConeSeries(base, cone) : base;
  }, [points, dividend, peerDividend, credit, t10y, real10y, cone, fund]);
  const painted = useMemo(() => (phases ? paintPhaseRows(chartData, phases) : null), [chartData, phases]);
  const plotData = painted ?? chartData;
  const real10yAxisDomain = useMemo(() => real10yDomain(real10y ? real10y.map(p => p.real10y) : []), [real10y]);
  const creditMax = credit ? Math.max(0, ...credit.map(p => p.spreadPct ?? 0)) : 0;
  const t10yMax = t10y ? Math.max(0, ...t10y.map(p => p.yieldPct ?? 0)) : 0;
  const rightAxis = !!dividend || !!credit || !!t10y || !!real10y || !!fund;
  const fundDomain = percentAxisDomain((fund ?? []).flatMap(p => [p.earningsYieldPct, p.roicPct, p.peerRoicPct]));
  const peerDivMax = peerDividend ? Math.max(0, ...peerDividend.map(p => p.yieldPct ?? 0)) : 0;
  const divMax = dividend ? Math.max(0, ...dividend.points.map(p => p.yieldPct ?? 0), peerDivMax) : 0;
  const divAxisMax = Math.max(1, Math.ceil(divMax * 1.15));
  // F1-14: Band ab 4 % auf der Dividendenachse (nur Anzeige). Achse wird dafür nicht gestreckt.
  const divBand = dividend ? attractiveYieldBand(divAxisMax) : null;
  const formatPx = (value: number, digits = 2) => formatChartPrice(ccy, value, priceFactor, digits);
  const tick = axisTick(narrow, dense ? 8 : 9, "var(--muted-foreground)");
  const xInterval = xAxisIntervalProps(narrow, Math.max(0, Math.floor(chartData.length / (dense ? 5 : 8))));
  const plotRef = useRef<HTMLDivElement>(null);
  const [labelShift, setLabelShift] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const root = plotRef.current;
    if (!root || !cone) {
      setLabelShift(prev => Object.keys(prev).length ? {} : prev);
      return;
    }
    const next = measureConeLabelShift(root, labelShift);
    if (next) setLabelShift(next);
  }, [cone, dividend, divBand, narrow, dense, chartData, yMin, yMax, labelShift]);
  return (
    <div ref={plotRef} className="h-full w-full">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={plotData}
        margin={dense ? { top: 2, right: rightAxis ? 0 : 10, left: 0, bottom: 0 } : { top: 5, right: rightAxis ? 0 : 10, left: 0, bottom: 5 }}
        onClick={onPlotClick}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis dataKey="date" type="category" tickFormatter={tickFormatter} tick={tick} {...xInterval} axisLine={{ stroke: "var(--border)" }} padding={{ left: 0, right: 0 }} />
        <YAxis yAxisId="price" domain={[yMin, yMax]} tick={tick} tickFormatter={(v: number) => formatPx(v, 0)} width={52} axisLine={{ stroke: "var(--border)" }} {...(narrow ? { ticks: narrowPriceTicks(yMin, yMax, 5) } : {})} />
        {/* Domain [0, 6.67]: höchster Volumen-Balken ≈ 15% der Bandhöhe, eigene Achse, nicht in der Preis-Y. */}
        <YAxis yAxisId="vol" hide domain={[0, 6.67]} orientation="right" />
        {dividend && (
          <YAxis
            yAxisId="div"
            orientation="right"
            domain={[0, divAxisMax]}
            width={DIV_AXIS_W}
            tick={{ fontSize: narrow ? 10 : 9, fill: DIV_COLOR }}
            tickFormatter={(v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`}
            axisLine={{ stroke: DIV_COLOR }}
            tickLine={false}
            tickCount={narrow ? 4 : 5}
          />
        )}
        {credit && (
          <YAxis
            yAxisId="credit"
            orientation="right"
            domain={[0, Math.max(1, Math.ceil(creditMax * 1.15))]}
            width={CREDIT_AXIS_W}
            tick={{ fontSize: narrow ? 10 : 9, fill: CREDIT_COLOR }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            axisLine={{ stroke: CREDIT_COLOR }}
            tickLine={false}
            tickCount={narrow ? 4 : 5}
          />
        )}
        {t10y && (
          <YAxis
            yAxisId="t10y"
            orientation="right"
            domain={[0, Math.max(1, Math.ceil(t10yMax * 1.15))]}
            width={T10Y_AXIS_W}
            tick={{ fontSize: narrow ? 10 : 9, fill: T10Y_COLOR }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            axisLine={{ stroke: T10Y_COLOR }}
            tickLine={false}
            tickCount={narrow ? 4 : 5}
          />
        )}
        {real10y && (
          <YAxis
            yAxisId="real10y"
            orientation="right"
            domain={real10yAxisDomain}
            tickFormatter={formatReal10yTick}
            tick={{ fontSize: narrow ? 10 : 9, fill: REAL10Y_OVERLAY.color }}
            width={REAL10Y_OVERLAY.axisWidth}
            axisLine={{ stroke: REAL10Y_OVERLAY.color }}
            {...(narrow ? { tickCount: 4 } : {})}
          />
        )}
        {fund && (
          <YAxis
            yAxisId="fund"
            orientation="right"
            domain={fundDomain}
            width={40}
            tick={{ fontSize: narrow ? 10 : 9, fill: "#0ea5e9" }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            axisLine={{ stroke: "#0ea5e9" }}
            tickLine={false}
            tickCount={narrow ? 4 : 5}
          />
        )}
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
          const bbWidth = dp.bbUpper != null && dp.bbLower != null ? formatPx(dp.bbUpper - dp.bbLower) : null;
          const dv = dp as WindowPoint & DividendFields;
          const phase = (dp as { _phase?: TaPhase | null })._phase ?? null;
          const phaseStroke = phase ? TA_PHASE_STROKE[phase] : closeStroke;
          return (
            <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px] min-w-[160px]">
              <div className="font-semibold mb-1">{formatDateFull(dp.date)}</div>
              {dp.close != null && Number.isFinite(dp.close) && (
                <div className="flex justify-between gap-3">
                  <span style={{ color: phaseStroke }}>{closeName}</span>
                  <span className="font-mono">{formatPx(dp.close)}</span>
                </div>
              )}
              {phase && (
                <div className="font-semibold" style={{ color: phaseStroke }}>Ampel: {PHASE_MEANING[phase]}</div>
              )}
              {showVolume && dp.volume > 0 && <div className="flex justify-between gap-3"><span className="text-sky-400">Volumen</span><span className="font-mono">{(dp.volume / 1e6).toFixed(2)}M</span></div>}
              {showBollinger && dp.bbUpper != null && (
                <>
                  <div className="flex justify-between gap-3"><span className="text-violet-400">BB Upper</span><span className="font-mono">{formatPx(dp.bbUpper)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-violet-300">BB Mid</span><span className="font-mono">{dp.bbMid != null ? formatPx(dp.bbMid) : ""}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-violet-400">BB Lower</span><span className="font-mono">{dp.bbLower != null ? formatPx(dp.bbLower) : ""}</span></div>
                  {bbWidth && <div className="flex justify-between gap-3"><span className="text-muted-foreground">BB Breite</span><span className="font-mono">{bbWidth}</span></div>}
                </>
              )}
              {dividend && <DividendTooltipRows p={dv} formatDateFull={formatDateFull} peerSource={peerDividendSource} />}
              {credit && <CreditTooltipRows p={dp as WindowPoint & CreditFields} label={creditLabel} formatDateFull={formatDateFull} />}
              {t10y && <Treasury10YTooltipRows p={dp as WindowPoint & Treasury10YFields} formatDateFull={formatDateFull} />}
              {real10y && <Real10YTooltipRow p={dp as WindowPoint & Real10YFields} />}
              {cone && <ConeTooltipRows p={dp as WindowPoint & ConePlotFields} formatPx={formatPx} cone={cone} priceSymbol={ccy} priceFactor={priceFactor} />}
              {fund && (dp.close != null && Number.isFinite(dp.close)
                ? <FundTooltipRows p={dp as WindowPoint & FundFields} />
                : <FundLastIstRows series={fund} formatDateFull={formatDateFull} />)}
              {payload.filter((p: any) => p.yAxisId === "price" && !["close", "bbUpper", "bbMid", "bbLower", "_peerPx", "_phA", "_phN", "_phV", "_phBase"].includes(p.dataKey) && !CONE_TIP_KEYS.has(p.dataKey)).map((p: any) => (
                <div key={p.dataKey} className="flex justify-between gap-3">
                  <span style={{ color: p.color }}>{p.name}</span>
                  <span className="font-mono">{formatPx(Number(p.value))}</span>
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
        {cone && (
          <>
            <Customized component={(overlay: { xAxisMap?: Record<string, ChartAxis>; yAxisMap?: Record<string, ChartAxis> }) => (
              <ConeBandFill {...overlay} cone={cone} />
            )} />
            <ReferenceLine yAxisId="price" x={cone.anchorDate} stroke={CONE_STYLE.forecastStart} strokeDasharray={CONE_STYLE.forecastDash} strokeWidth={CONE_STYLE.forecastWidth} />
            <Line yAxisId="price" type="monotone" dataKey="coneP90" name={coneIntervalLegend("outer")} stroke={CONE_STYLE.outerStroke} strokeWidth={1.25} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="coneP10" name={coneIntervalLegend("outer")} stroke={CONE_STYLE.outerStroke} strokeWidth={1.25} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="coneInnerHigh" name={coneIntervalLegend("inner")} stroke={CONE_STYLE.innerStroke} strokeWidth={1.25} strokeDasharray="2 2" dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="coneInnerLow" name={coneIntervalLegend("inner")} stroke={CONE_STYLE.innerStroke} strokeWidth={1.25} strokeDasharray="2 2" dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="coneP50" name={CONE_LEGEND.midline} stroke={CONE_STYLE.midline} strokeWidth={CONE_STYLE.midlineWidth} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            {cone.markers.map((m) => m.price == null ? null : (
              <ReferenceDot
                key={m.id}
                yAxisId="price"
                x={cone.points[cone.points.length - 1]?.date}
                y={m.price}
                r={3.5}
                fill={markerFill(m.id)}
                stroke="var(--card)"
              />
            ))}
            <Customized component={(overlay: { xAxisMap?: Record<string, ChartAxis>; yAxisMap?: Record<string, ChartAxis> }) => (
              <ConeEndLabels
                {...overlay}
                cone={cone}
                priceFontPx={typeof tick.fontSize === "number" ? tick.fontSize : 0}
                labelShift={labelShift}
                formatPx={formatPx}
                priceSymbol={ccy}
                priceFactor={priceFactor}
              />
            )} />
          </>
        )}
        {painted ? (
          <>
            <Line yAxisId="price" type="monotone" dataKey="_phBase" name={closeName} stroke={closeStroke} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="_phA" name="ATTRAKTIV" stroke={TA_PHASE_STROKE.ATTRAKTIV} strokeWidth={2.25} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="_phN" name="NEUTRAL" stroke={TA_PHASE_STROKE.NEUTRAL} strokeWidth={2.25} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line yAxisId="price" type="monotone" dataKey="_phV" name="VORSICHTIG" stroke={TA_PHASE_STROKE.VORSICHTIG} strokeWidth={2.25} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
          </>
        ) : (
          <Line yAxisId="price" type="monotone" dataKey="close" name={closeName} stroke={closeStroke} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        )}
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
        {dividend && divBand && (
          <>
            <ReferenceArea yAxisId="div" y1={divBand.y1} y2={divBand.y2} fill={DIV_ATTRACTIVE_FILL} ifOverflow="hidden" />
            <ReferenceLine yAxisId="div" y={DIV_ATTRACTIVE_YIELD_PCT} stroke={DIV_ATTRACTIVE_STROKE} strokeDasharray="4 3" strokeWidth={0.8} opacity={0.8}
              label={narrow || dense ? undefined : { value: `${DIV_ATTRACTIVE_YIELD_PCT} % attraktiv`, position: "insideTopRight", fontSize: DIV_ATTRACTIVE_LABEL_PX, fill: DIV_ATTRACTIVE_STROKE }} />
          </>
        )}
        {dividend && (
          <Line
            yAxisId="div"
            type="stepAfter"
            dataKey="_divYield"
            name="Div. Yield TTM"
            stroke={DIV_COLOR}
            strokeWidth={1.5}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: any) => {
              const pl = props?.payload as DividendFields | undefined;
              if (!pl?._divRaw && !pl?._divSpecial?.length) return <g key={props.key} />;
              // Marks a visibly corrected point (amber) or a window with a special dividend (violet).
              return <circle key={props.key} cx={props.cx} cy={props.cy} r={2.5} fill={pl._divSpecial?.length ? "#a855f7" : "#f59e0b"} stroke="none" />;
            }}
          />
        )}
        {dividend && peerDividend && (
          <Line
            yAxisId="div"
            type="stepAfter"
            dataKey="_peerDivYield"
            name="Peer Div. Yield"
            stroke="#0f766e"
            strokeWidth={1.25}
            strokeDasharray="4 2"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
        {credit && (
          <Line yAxisId="credit" type="stepAfter" dataKey="_credit" name={creditLabel ?? "Markt-Spread Baa"} stroke={CREDIT_COLOR} strokeWidth={1.5} strokeDasharray="5 2" dot={false} connectNulls={false} isAnimationActive={false} />
        )}
        {t10y && (
          <Line yAxisId="t10y" type="stepAfter" dataKey="_t10y" name={TREASURY10Y_LABEL} stroke={T10Y_COLOR} strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls={false} isAnimationActive={false} />
        )}
        {real10y && (
          <Line
            yAxisId="real10y"
            type="monotone"
            dataKey="_real10y"
            name={REAL10Y_OVERLAY.lineName}
            stroke={REAL10Y_OVERLAY.color}
            strokeWidth={REAL10Y_OVERLAY.strokeWidth}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
        {fund && (
          <Line yAxisId="fund" type="monotone" dataKey="_ey" name="Earnings Yield" stroke="#0ea5e9" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
        )}
        {fund && (
          <Line yAxisId="fund" type="stepAfter" dataKey="_roic" name="ROIC" stroke="#84cc16" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls={false} isAnimationActive={false} />
        )}
        {fund && (
          <Line yAxisId="fund" type="stepAfter" dataKey="_peerRoic" name="Peer-ROIC" stroke="#84cc16" strokeWidth={1.25} strokeDasharray="2 2" dot={false} connectNulls={false} isAnimationActive={false} />
        )}
        {fund && (
          <Line yAxisId="price" type="monotone" dataKey="_peerPx" name="Peer-Kurs (Median-Index)" stroke="#fb923c" strokeWidth={1.25} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
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
    </div>
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

export interface MacroPaneLine {
  key: string;
  name: string;
  color: string;
  /** stepAfter for monthly/annual prints, monotone for daily. */
  step?: boolean;
}

/**
 * Generic synced sub-pane — same frame as MacdPane/RsiPane (caption, height,
 * axes, tooltip) so recession overlays look like the stock Section 12.
 */
export function MacroPane({
  data, lines, tickFormatter, formatDateFull, testId, title, hint, refLines = [], digits = 2, unit = "",
}: {
  data: Array<{ date: string } & Record<string, number | string | null | undefined>>;
  lines: MacroPaneLine[];
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
  testId: string;
  title: string;
  hint?: string;
  refLines?: { y: number; color: string; label?: string; dashed?: boolean }[];
  digits?: number;
  unit?: string;
}) {
  const narrow = useIsNarrow();
  const tick = axisTick(narrow, 9, "var(--muted-foreground)");
  return (
    <>
      <OscCaption title={title} hint={hint} compact={false} />
      <div className="h-[110px] sm:h-[130px] min-h-10 w-full shrink-0" style={{ minHeight: TA_OSC_MIN_PX }} data-testid={testId}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="date" tickFormatter={tickFormatter} tick={tick} {...xAxisIntervalProps(narrow, Math.max(0, Math.floor(data.length / 8)))} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={tick} width={52} axisLine={{ stroke: "var(--border)" }} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v.toFixed(digits > 1 ? 1 : digits)}${unit}`} {...(narrow ? { tickCount: 5 } : {})} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                  <div className="font-semibold mb-1">{formatDateFull(String(label ?? ""))}</div>
                  {payload.map((p: any) => <div key={p.dataKey} className="flex justify-between gap-3"><span style={{ color: p.color }}>{p.name}</span><span className="font-mono">{p.value == null ? "n/a" : `${Number(p.value).toFixed(digits)}${unit}`}</span></div>)}
                </div>
              );
            }} />
            {refLines.map(r => (
              <ReferenceLine key={`${r.y}-${r.label ?? ""}`} y={r.y} stroke={r.color} strokeWidth={0.75} strokeDasharray={r.dashed === false ? undefined : "4 3"}
                label={r.label ? { value: r.label, position: "insideTopLeft", fontSize: 8, fill: r.color } : undefined} />
            ))}
            {lines.map(l => (
              <Line key={l.key} type={l.step ? "stepAfter" : "monotone"} dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
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
  testId, macdTestId, rsiTestId, measureMode, onPlotClick, measurePoints, measurement, dividend, peerDividend = null, peerDividendSource = null, credit, creditLabel, t10y, real10y, fund, ccy,
  priceFactor = 1, cone = null, widthScale = 1, scrollToEnd = false, alignedPoints, phases = null, overlay = null,
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
  dividend?: DividendOverlaySeries | null;
  peerDividend?: PeerDividendYieldPoint[] | null;
  peerDividendSource?: string | null;
  credit?: CreditOverlayPoint[] | null;
  creditLabel?: string;
  t10y?: Treasury10YOverlayPoint[] | null;
  real10y?: Real10YOverlayPoint[] | null;
  fund?: FundJoinPoint[] | null;
  ccy?: string;
  priceFactor?: number;
  cone?: ScenarioCone | null;
  widthScale?: number;
  scrollToEnd?: boolean;
  alignedPoints?: WindowPoint[];
  phases?: Map<string, TaPhase | null> | null;
  overlay?: ReactNode;
}) {
  const narrow = useIsNarrow();
  const empty = series.points.length === 0;
  const compact = count > 1;
  const aligned = alignedPoints ?? series.points;
  return (
    <TaPlotScroll minWidth={taChartMinWidth(TA_PRICE_AXIS_LEFT_PX, TA_PRICE_AXIS_RIGHT_PX, TA_PRICE_MARGIN_RIGHT_PX)} testId={`${testId}-scroll`} widthScale={widthScale} scrollToEnd={scrollToEnd} overlay={overlay}>
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
              dividend={dividend}
              peerDividend={peerDividend}
              peerDividendSource={peerDividendSource}
              credit={credit}
              creditLabel={creditLabel}
              t10y={t10y}
              real10y={real10y}
              fund={fund}
              ccy={ccy}
              priceFactor={priceFactor}
              cone={cone}
              phases={phases}
            />
          )}
        </div>
      </div>
      {narrow && showVolume && !empty && (
        <TaVolumeBand data={aligned} leftAxisWidth={52} marginRight={10} />
      )}
      {!empty && showMacd && (
        <MacdPane points={aligned} tickFormatter={tickFormatter} formatDateFull={formatDateFull} compact={compact} testId={macdTestId} title={`${label} · MACD(12,26,9)`} />
      )}
      {!empty && showRsi && (
        <RsiPane points={aligned} tickFormatter={tickFormatter} formatDateFull={formatDateFull} compact={compact} testId={rsiTestId} title={`${label} · RSI(14)`} />
      )}
    </div>
    </TaPlotScroll>
  );
}

const PHASE_MEANING: Record<TaPhase, string> = {
  ATTRAKTIV: "Attraktiv",
  NEUTRAL: "Neutral",
  VORSICHTIG: "Unattraktiv",
};

function ChartAmpelBadge({ snap, lineEndPhase, buyScore }: {
  snap: SymmetricSnapshot | null;
  lineEndPhase: TaPhase | null;
  buyScore: number;
}) {
  const phase = snap?.paint ?? null;
  const meaning = snap?.meaning ?? null;
  const lineAgrees = phase == null || lineEndPhase == null || phase === lineEndPhase;
  return (
    <div
      className={`pointer-events-none absolute right-1 top-1 z-10 max-w-[calc(100%-4.5rem)] truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${
        phase ? TA_PHASE_BADGE[phase] : "border-border bg-background/85 text-muted-foreground"
      }`}
      data-testid="chart-ampel-label"
      data-phase={snap?.color ?? ""}
      data-meaning={meaning ?? ""}
      data-buyscore={buyScore}
      data-consistent={lineAgrees ? "1" : "0"}
      data-line-end={lineEndPhase ?? ""}
      data-adjusted={snap?.adjusted ?? ""}
      title={snap?.summary}
    >
      {meaning ? `Ampel: ${meaning}` : "Ampel: n/a"}
    </div>
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

// ─── Dividend overlay helpers ───

const DIV_COLOR = "#14b8a6";
const DIV_AXIS_W = 36;
/** F1-14: Band „Yield ≥ 4 % attraktiv“ — grün, sehr transparent, damit Kurs und andere Overlays lesbar bleiben. */
const DIV_ATTRACTIVE_FILL = "rgba(34,197,94,0.07)";
const DIV_ATTRACTIVE_STROKE = "#22c55e";
/** Schriftgröße des F1-14-Labels. Dieselbe Zeilenhöhe geht in die Kegel-Kollision ein. */
const DIV_ATTRACTIVE_LABEL_PX = 8;

type DividendFields = {
  _divYield?: number | null;
  _divTtm?: number | null;
  _divRaw?: number | null;
  _divDropped?: string[];
  _divSpecial?: string[];
  _divAdded?: string[];
  _peerDivYield?: number | null;
  _peerDivNote?: string | null;
};

/** Adds the overlay fields to each price point by date. No dividend series and no peer → points unchanged. */
export function withDividendOverlay(
  points: WindowPoint[],
  series: DividendOverlaySeries | null | undefined,
  peer?: PeerDividendYieldPoint[] | null,
): Array<WindowPoint & DividendFields> {
  if (!series && !peer) return points;
  const byDate = new Map((series?.points ?? []).map(p => [p.date, p]));
  const peerByDate = new Map((peer ?? []).map(p => [p.date, p]));
  return points.map(pt => {
    const d = series ? byDate.get(pt.date) : undefined;
    const peerHit = peer ? peerByDate.get(pt.date) : undefined;
    const peerFields = peer
      ? { _peerDivYield: peerHit?.yieldPct ?? null, _peerDivNote: peerHit?.note ?? (peerHit ? null : "n/a — kein Peer-Dividendenpunkt an diesem Tag") }
      : {};
    if (!series) return { ...pt, ...peerFields };
    if (!d) return { ...pt, _divYield: null, ...peerFields };
    return {
      ...pt,
      _divYield: d.yieldPct,
      _divTtm: d.ttmDividend,
      _divRaw: d.rawYieldPct,
      _divDropped: d.droppedExDates,
      _divSpecial: d.specialExDates,
      _divAdded: d.addedExDates,
      ...peerFields,
    };
  });
}

function PeerDividendTooltipRows({ p, source }: { p: DividendFields; source?: string | null }) {
  if (p._peerDivYield === undefined && p._peerDivNote === undefined) return null;
  const text = p._peerDivYield != null && Number.isFinite(p._peerDivYield)
    ? `${p._peerDivYield.toFixed(2)} %`
    : (p._peerDivNote?.trim() ? p._peerDivNote : "n/a — Peer-Dividendenrendite fehlt");
  return (
    <>
      <div className="flex justify-between gap-3" data-testid="tooltip-peer-div-yield"><span className="text-teal-700">Peer Div. Yield</span><span className="font-mono">{text}</span></div>
      <div className="text-muted-foreground">Formel: {DIVIDEND_YIELD_FORMULA}</div>
      <div className="text-muted-foreground" data-testid="tooltip-peer-div-source">Quelle: {source ?? dividendSourceCaption(null)}</div>
    </>
  );
}

function DividendTooltipRows({ p, formatDateFull, peerSource = null }: { p: DividendFields; formatDateFull: (d: string) => string; peerSource?: string | null }) {
  return (
    <>
      {p._divYield == null ? (
        <div className="flex justify-between gap-3"><span style={{ color: DIV_COLOR }}>Div. Yield TTM</span><span className="font-mono">n/a</span></div>
      ) : (
        <>
          <div className="flex justify-between gap-3"><span style={{ color: DIV_COLOR }}>Div. Yield TTM</span><span className="font-mono">{p._divYield.toFixed(2)}%</span></div>
          {isAttractiveDividendYield(p._divYield) && <div className="text-green-500" data-testid="dividend-tooltip-attractive">≥ {DIV_ATTRACTIVE_YIELD_PCT} % attraktiv</div>}
          {p._divTtm != null && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Dividende 12M je Aktie</span><span className="font-mono">{p._divTtm.toFixed(2)}</span></div>}
          {dividendMarkerLines({ yieldPct: p._divYield, rawYieldPct: p._divRaw, droppedExDates: p._divDropped, addedExDates: p._divAdded, specialExDates: p._divSpecial }, formatDateFull).map(l => (
            <div key={l.text} className={`${l.cls} max-w-[240px] whitespace-normal`} data-testid="dividend-tooltip-marker">{l.text}</div>
          ))}
        </>
      )}
      <PeerDividendTooltipRows p={p} source={peerSource} />
    </>
  );
}

function DividendOverlayStatus({ series, history, loading, failed, formatDateFull, currencyCheck = "unknown", priceCurrency, peerCaption = null }: {
  currencyCheck?: "ok" | "mismatch" | "unknown";
  priceCurrency?: string;
  series: DividendOverlaySeries | null;
  history: DividendHistoryResponse | undefined;
  loading: boolean;
  failed: boolean;
  formatDateFull: (d: string) => string;
  peerCaption?: string | null;
}) {
  const base = "mt-1 text-[10px] text-muted-foreground break-words";
  if (loading) return <div className={base} data-testid="dividend-overlay-loading">Div. Yield: Dividendenhistorie wird geladen …</div>;
  if (failed) return <div className={base} data-testid="dividend-overlay-empty">Div. Yield: n/a — Dividendenhistorie nicht erreichbar.</div>;
  if (!history || history.events.length === 0) return <div className={base} data-testid="dividend-overlay-empty">Div. Yield: n/a — keine Dividendenhistorie (FMP/Yahoo), z. B. kein Dividendenzahler.</div>;
  if (currencyCheck === "mismatch") return <div className={base} data-testid="dividend-overlay-currency">Div. Yield: n/a — Dividende in {history.currency}, Kurs in {priceCurrency}; keine FX-Umrechnung.</div>;
  if (!series) return <div className={base} data-testid="dividend-overlay-empty">Div. Yield: n/a — Dividendenhistorie deckt dieses Fenster nicht mit 12 Monaten ab.</div>;
  const last = [...series.points].reverse().find(p => p.yieldPct != null);
  const src = history.source === "fmp" ? "FMP" : "Yahoo (Fallback)";
  return (
    <div className={base} data-testid="dividend-overlay-status">
      <span style={{ color: DIV_COLOR }} className="font-medium">Div. Yield TTM</span> (rechte Achse) = Σ Dividenden 12M / Kurs
      {last && <> · aktuell <span className="font-mono">{last.yieldPct!.toFixed(2)}%</span> ({last.ttmDividend?.toFixed(2)} je Aktie)</>}
      {" "}· {series.paymentsPerYear}× jährlich · Quelle {src}
      {series.points.some(p => isAttractiveDividendYield(p.yieldPct)) && <> · <span className="text-green-500" data-testid="dividend-overlay-attractive">grünes Band = Yield ≥ {DIV_ATTRACTIVE_YIELD_PCT} % (attraktiv, nur Anzeige)</span></>}
      {currencyCheck === "ok" ? <> · Währung {history.currency} = Kurs</> : <> · Dividendenwährung von der Quelle nicht angegeben (Annahme: Kurswährung)</>}
      {series.correctedBars > 0 && <> · <span className="text-amber-500">{series.correctedBars} Punkt(e) geglättet</span> (Ex-Tag-Verschiebung, Rohwert im Tooltip)</>}
      {series.specialExDates.length > 0 && <> · <span className="text-violet-400">Sonderdividende {series.specialExDates.map(formatDateFull).join(", ")}</span></>}
      {" "}· KPI „Div. Yield“ in Sektion 1 zeigt denselben TTM-Wert (GJ-Wert von FMP als Zusatzzeile).
      {peerCaption && <div data-testid="dividend-overlay-peer">{peerCaption}</div>}
    </div>
  );
}

// ─── Credit overlay helpers (JOB A1) ───

type FundFields = {
  _ey?: number | null;
  _eyKnown?: number | null;
  _eyNote?: string | null;
  _roic?: number | null;
  _roicKnown?: number | null;
  _roicNote?: string | null;
  _peerRoic?: number | null;
  _peerRoicKnown?: number | null;
  _peerRoicNote?: string | null;
  _peerPx?: number | null;
  _peerPxRaw?: number | null;
  _peerPxNote?: string | null;
};

function withFundOverlay<T extends WindowPoint>(points: T[], series: FundJoinPoint[] | null | undefined): Array<T & FundFields> {
  if (!series) return points;
  const byDate = new Map(series.map(p => [p.date, p]));
  return points.map(pt => {
    const f = byDate.get(pt.date);
    return {
      ...pt,
      _ey: f?.earningsYieldPct ?? null,
      _eyKnown: f?.earningsYieldKnown ?? null,
      _eyNote: f?.earningsYieldNote ?? null,
      _roic: f?.roicPct ?? null,
      _roicKnown: f?.roicKnown ?? null,
      _roicNote: f?.roicNote ?? null,
      _peerRoic: f?.peerRoicPct ?? null,
      _peerRoicKnown: f?.peerRoicKnown ?? null,
      _peerRoicNote: f?.peerRoicNote ?? null,
      _peerPx: f?.peerPriceIndexed ?? null,
      _peerPxRaw: f?.peerPriceRaw ?? null,
      _peerPxNote: f?.peerPriceNote ?? null,
    };
  });
}

function fmtPctOrNote(v: number | null | undefined, note: string | null | undefined): string {
  if (v != null && Number.isFinite(v)) return `${v.toFixed(1)} %`;
  return note && note.trim() ? note : "n/a — kein Wert";
}

function EstimateBadge({ note }: { note: string | null | undefined }) {
  if (!estimateBadge(note)) return null;
  return <div className="text-amber-400" data-testid="badge-schaetzung">Schätzung · {note}</div>;
}

const LAST_IST_LABEL = "letzter Ist-Wert";

function lastFiniteFund<K extends "earningsYieldPct" | "roicPct" | "peerRoicKnown" | "peerPriceRaw">(
  series: FundJoinPoint[],
  key: K,
): FundJoinPoint | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i][key];
    if (typeof value === "number" && Number.isFinite(value)) return series[i];
  }
  return null;
}

/**
 * Prognosepunkte haben keinen Ist-Wert. Statt „n/a — kein Wert“ der letzte
 * bekannte Punkt mit Datum. Fehlt der Wert auch in der Historie, bleibt die Zeile weg.
 */
function FundLastIstRows({ series, formatDateFull }: { series: FundJoinPoint[]; formatDateFull: (date: string) => string }) {
  const rows: { key: string; label: string; className: string; text: string; date: string; formula: string | null }[] = [];
  const ey = lastFiniteFund(series, "earningsYieldPct");
  if (ey?.earningsYieldPct != null) {
    rows.push({ key: "ey", label: "Earnings Yield", className: "text-sky-500", text: `${ey.earningsYieldPct.toFixed(1)} %`, date: ey.date, formula: EARNINGS_YIELD_FORMULA });
  }
  const roic = lastFiniteFund(series, "roicPct");
  if (roic?.roicPct != null) {
    rows.push({ key: "roic", label: "ROIC", className: "text-lime-500", text: `${roic.roicPct.toFixed(1)} %`, date: roic.date, formula: ROIC_FORMULA });
  }
  const peer = lastFiniteFund(series, "peerRoicKnown");
  if (peer?.peerRoicKnown != null) {
    rows.push({ key: "peer-roic", label: "Peer-ROIC", className: "text-lime-500", text: `${peer.peerRoicKnown.toFixed(1)} %`, date: peer.date, formula: ROIC_FORMULA });
  }
  const peerPx = lastFiniteFund(series, "peerPriceRaw");
  if (peerPx?.peerPriceRaw != null) {
    rows.push({ key: "peer-px", label: "Peer-Kurs", className: "text-orange-400", text: peerPx.peerPriceRaw.toFixed(2), date: peerPx.date, formula: null });
  }
  if (rows.length === 0) return null;
  return (
    <div className="mt-1 pt-1 border-t border-border max-w-[280px] whitespace-normal" data-testid="fund-last-ist">
      {rows.map(row => (
        <div key={row.key}>
          <div className="flex justify-between gap-3"><span className={row.className}>{row.label}</span><span className="font-mono">{row.text}</span></div>
          <div className="text-muted-foreground">{LAST_IST_LABEL} · {formatDateFull(row.date)}</div>
          {row.formula ? <div className="text-muted-foreground">Formel: {row.formula}</div> : null}
        </div>
      ))}
    </div>
  );
}

function FundTooltipRows({ p }: { p: FundFields }) {
  const ey = p._eyKnown ?? null;
  const roic = p._roicKnown ?? null;
  return (
    <div className="mt-1 pt-1 border-t border-border max-w-[280px] whitespace-normal">
      <div className="flex justify-between gap-3" data-testid="tooltip-earnings-yield"><span className="text-sky-500">Earnings Yield</span><span className="font-mono">{fmtPctOrNote(ey, ey != null ? null : p._eyNote)}</span></div>
      {ey != null && p._eyNote ? <div className="text-muted-foreground">{p._eyNote}</div> : null}
      <EstimateBadge note={ey != null ? p._eyNote : null} />
      <div className="text-muted-foreground">Formel: {EARNINGS_YIELD_FORMULA}</div>
      <div className="flex justify-between gap-3" data-testid="tooltip-roic"><span className="text-lime-500">ROIC</span><span className="font-mono">{fmtPctOrNote(roic, roic != null ? null : p._roicNote)}</span></div>
      {roic != null && p._roicNote ? <div className="text-muted-foreground">{p._roicNote}</div> : null}
      <EstimateBadge note={roic != null ? p._roicNote : null} />
      {p._roicNote?.includes("Formel:") ? null : <div className="text-muted-foreground">Formel: {ROIC_FORMULA}</div>}
      <div className="flex justify-between gap-3"><span className="text-lime-500">Peer-ROIC</span><span className="font-mono">{fmtPctOrNote(p._peerRoicKnown, p._peerRoicKnown != null ? null : p._peerRoicNote)}</span></div>
      {p._peerRoicKnown != null && p._peerRoicNote ? <div className="text-muted-foreground">{p._peerRoicNote}</div> : null}
      <div className="flex justify-between gap-3"><span className="text-orange-400">Peer-Kurs</span><span className="font-mono">{p._peerPxRaw != null ? p._peerPxRaw.toFixed(2) : fmtPctOrNote(null, p._peerPxNote)}</span></div>
    </div>
  );
}

function latestOverlayPct(
  series: FundJoinPoint[] | null,
  valueKey: "earningsYieldPct" | "roicPct" | "peerRoicKnown",
  noteKey: "earningsYieldNote" | "roicNote" | "peerRoicNote",
): { value: number | null; note: string | null } | null {
  if (!series || series.length === 0) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i][valueKey];
    if (value != null && Number.isFinite(value)) return { value, note: series[i][noteKey] ?? null };
  }
  for (let i = series.length - 1; i >= 0; i--) {
    const note = series[i][noteKey];
    if (note) return { value: null, note };
  }
  return { value: null, note: null };
}

function FundamentalOverlayStatus({
  showEy, showRoic, showPeer, peerMode, peerTicker, eyLoading, roicLoading, peerLoading, eyNote, roicNote, eySource, roicSource, peerRoicSource, roicLabel, roicFormula, peerRoicFormula, eyLatest, roicLatest, peerRoicLatest, peerPriceNote,
}: {
  showEy: boolean;
  showRoic: boolean;
  showPeer: boolean;
  peerMode: "price" | "roic";
  peerTicker: string;
  eyLoading: boolean;
  roicLoading: boolean;
  peerLoading: boolean;
  eyNote: string | null;
  roicNote: string | null;
  eySource: string | null;
  roicSource: string | null;
  peerRoicSource: string | null;
  roicLabel: string;
  roicFormula: string;
  peerRoicFormula: string;
  eyLatest: { value: number | null; note: string | null };
  roicLatest: { value: number | null; note: string | null };
  peerRoicLatest: { value: number | null; note: string | null };
  peerPriceNote: string | null;
}) {
  const base = "mt-1 text-[10px] text-muted-foreground break-words";
  const ey = !showEy ? null : eyLoading ? "wird geladen …" : eyLatest.value != null ? `${eyLatest.value.toFixed(1)} %` : (eyLatest.note ?? eyNote ?? "n/a — keine Earnings-Yield-Punkte");
  const roic = !showRoic ? null : roicLoading ? "wird geladen …" : roicLatest.value != null ? `${roicLatest.value.toFixed(1)} %` : (roicLatest.note ?? roicNote ?? "n/a — keine ROIC-Punkte");
  let peerRoic: string | null = null;
  let peerPrice: string | null = null;
  if (showPeer) {
    if (!peerTicker) {
      peerRoic = "n/a — Peer-Ticker fehlt";
      peerPrice = "n/a — Peer-Ticker fehlt";
    } else if (peerLoading) {
      peerRoic = "wird geladen …";
      peerPrice = "wird geladen …";
    } else {
      peerRoic = peerRoicLatest.value != null ? `${peerTicker} ROIC ${peerRoicLatest.value.toFixed(1)} %` : (peerRoicLatest.note ?? `n/a — kein ROIC für ${peerTicker}`);
      peerPrice = `${peerPriceNote ?? `${peerTicker} Kurs als Median-Index auf der linken Achse`} · Linie: ${peerMode === "price" ? "Kurs" : "ROIC"}`;
    }
  }
  const sourceText = (source: string | null) => source ? ` Quelle: ${source}.` : "";
  return (
    <div className={base} data-testid="fundamental-overlay-status">
      {ey != null && <div data-testid="status-earnings-yield">Earnings Yield: {ey}. Formel: {EARNINGS_YIELD_FORMULA}.{eyLatest.note ? ` ${eyLatest.note}` : ""}{eyLatest.value != null && eyNote ? ` ${eyNote}` : ""}{sourceText(eySource)} Kein Score-Einfluss.</div>}
      {roic != null && <div data-testid="status-roic">{roicLabel}: {roic}. Formel: {roicFormula}.{roicLatest.note ? ` ${roicLatest.note}` : ""}{roicLatest.value != null && roicNote ? ` ${roicNote}` : ""}{sourceText(roicSource)} Kein Score-Einfluss.</div>}
      {peerRoic != null && <div data-testid="status-fund-peer">Peer-ROIC: {peerRoic}. Formel: {peerRoicFormula}.{sourceText(peerRoicSource)} Kein Score-Einfluss.</div>}
      {peerPrice != null && <div data-testid="status-fund-peer-price">Peer-Kurs: {peerPrice}. Kein Score-Einfluss.</div>}
    </div>
  );
}

const CREDIT_COLOR = "#f43f5e";
const CREDIT_AXIS_W = 40;

type CreditFields = { _credit?: number | null; _creditDate?: string | null };

/** Adds the Baa market spread to each price point by date. No series → points unchanged. */
export function withCreditOverlay<T extends WindowPoint>(points: T[], series: CreditOverlayPoint[] | null | undefined): Array<T & CreditFields> {
  if (!series) return points;
  const byDate = new Map(series.map(p => [p.date, p]));
  return points.map(pt => {
    const c = byDate.get(pt.date);
    return { ...pt, _credit: c?.spreadPct ?? null, _creditDate: c?.spreadDate ?? null };
  });
}

function CreditTooltipRows({ p, label, formatDateFull }: { p: CreditFields; label?: string; formatDateFull: (d: string) => string }) {
  return (
    <div className="mt-1 pt-1 border-t border-border max-w-[240px] whitespace-normal">
      <div className="flex justify-between gap-3">
        <span style={{ color: CREDIT_COLOR }}>Markt-Spread Baa</span>
        <span className="font-mono">{p._credit != null ? `${p._credit.toFixed(2)}% (${Math.round(p._credit * 100)} bp)` : "n/a"}</span>
      </div>
      {p._creditDate && <div className="text-muted-foreground">FRED-Datum {formatDateFull(p._creditDate)} · FRED BAA10Y</div>}
      {label && <div className="text-muted-foreground">{label}</div>}
    </div>
  );
}

function CreditOverlayStatus({ series, response, loading, failed, label, formatDateFull }: {
  series: CreditOverlayPoint[] | null;
  response: CreditSpreadResponse | undefined;
  loading: boolean;
  failed: boolean;
  label: string;
  formatDateFull: (d: string) => string;
}) {
  const base = "mt-1 text-[10px] text-muted-foreground break-words";
  if (loading) return <div className={base} data-testid="credit-overlay-loading">Markt-Spread Baa: FRED wird geladen …</div>;
  if (failed || !response || response.points.length === 0) return <div className={base} data-testid="credit-overlay-empty">Markt-Spread Baa: n/a — FRED BAA10Y nicht erreichbar. {ISSUER_BOND_NA_NOTE}</div>;
  if (!series) return <div className={base} data-testid="credit-overlay-empty">Markt-Spread Baa: n/a — FRED-Historie deckt dieses Fenster nicht ab. {ISSUER_BOND_NA_NOTE}</div>;
  const last = [...series].reverse().find(p => p.spreadPct != null);
  // Nur bei steigendem Spread (3M-Änderung > 0 und > P80, siehe shared/credit.ts). Kein Score, kein Fazit-Faktor.
  const hint = creditStressHint(response.stress);
  return (
    <div className={base} data-testid="credit-overlay-status">
      <span style={{ color: CREDIT_COLOR }} className="font-medium">{label}</span> (rechte Achse, %)
      {last && last.spreadDate && <> · aktuell <span className="font-mono">{last.spreadPct!.toFixed(2)}% ({Math.round(last.spreadPct! * 100)} bp)</span> per {formatDateFull(last.spreadDate)}</>}
      {" "}· Quelle <a className="underline" href={response.sourceUrl} target="_blank" rel="noreferrer">{response.source}</a> · kein Score-Einfluss
      {" "}· {ISSUER_BOND_NA_NOTE}
      {hint && (
        <div className="mt-0.5 font-medium text-amber-600 dark:text-amber-400" data-testid="credit-stress-hint" title={hint}>
          ⚠ {CREDIT_STRESS_HINT}
          <span className="ml-1 font-normal text-muted-foreground">{hint.slice(CREDIT_STRESS_HINT.length + 2)}</span>
        </div>
      )}
    </div>
  );
}

// ─── 10Y-Treasury overlay helpers (A3) ───

const T10Y_COLOR = "#6366f1";
const T10Y_AXIS_W = 40;

type Treasury10YFields = { _t10y?: number | null; _t10yDate?: string | null };

/** Adds the 10Y Treasury yield (FRED DGS10) to each price point by date. No series → points unchanged. */
export function withTreasury10YOverlay<T extends WindowPoint>(points: T[], series: Treasury10YOverlayPoint[] | null | undefined): Array<T & Treasury10YFields> {
  if (!series) return points;
  const byDate = new Map(series.map(p => [p.date, p]));
  return points.map(pt => {
    const y = byDate.get(pt.date);
    return { ...pt, _t10y: y?.yieldPct ?? null, _t10yDate: y?.yieldDate ?? null };
  });
}

function Treasury10YTooltipRows({ p, formatDateFull }: { p: Treasury10YFields; formatDateFull: (d: string) => string }) {
  return (
    <div className="mt-1 pt-1 border-t border-border max-w-[240px] whitespace-normal">
      <div className="flex justify-between gap-3">
        <span style={{ color: T10Y_COLOR }}>10J-Treasury</span>
        <span className="font-mono">{p._t10y != null ? `${p._t10y.toFixed(2)}%` : "n/a"}</span>
      </div>
      {p._t10yDate && <div className="text-muted-foreground">FRED-Datum {formatDateFull(p._t10yDate)} · FRED DGS10</div>}
    </div>
  );
}

function Treasury10YOverlayStatus({ series, response, loading, failed, formatDateFull }: {
  series: Treasury10YOverlayPoint[] | null;
  response: Treasury10YResponse | undefined;
  loading: boolean;
  failed: boolean;
  formatDateFull: (d: string) => string;
}) {
  const base = "mt-1 text-[10px] text-muted-foreground break-words";
  if (loading) return <div className={base} data-testid="t10y-overlay-loading">10J-Treasury: FRED wird geladen …</div>;
  if (failed || !response || response.points.length === 0) return <div className={base} data-testid="t10y-overlay-empty">10J-Treasury: n/a — FRED DGS10 nicht erreichbar.</div>;
  if (!series) return <div className={base} data-testid="t10y-overlay-empty">10J-Treasury: n/a — FRED-Historie deckt dieses Fenster nicht ab.</div>;
  const last = [...series].reverse().find(p => p.yieldPct != null);
  // Zinsrichtung im Fenster A: erster vs. letzter vorhandener DGS10-Wert (nur Vorzeichen, keine Schwelle).
  const chg = treasury10YWindowChange(series);
  return (
    <div className={base} data-testid="t10y-overlay-status">
      <span style={{ color: T10Y_COLOR }} className="font-medium">{TREASURY10Y_LABEL}</span> (rechte Achse, %)
      {last && last.yieldDate && <> · aktuell <span className="font-mono">{last.yieldPct!.toFixed(2)}%</span> per {formatDateFull(last.yieldDate)}</>}
      {chg && (
        <> · im Fenster <span className="font-mono" data-testid="t10y-window-change">{chg.changeBp >= 0 ? "+" : ""}{chg.changeBp} bp</span> ({chg.direction}, {chg.first.toFixed(2)}% → {chg.last.toFixed(2)}%)</>
      )}
      {" "}· Quelle <a className="underline" href={response.sourceUrl} target="_blank" rel="noreferrer">{response.source}</a> · kein Score-Einfluss
    </div>
  );
}

// ─── Real10Y overlay helpers (FRED DFII10, aus dem BTC-Chart übernommen) ───

export type Real10YOverlayPoint = { date: string; real10y: number | null };
type Real10YFields = { _real10y?: number | null };

/** Ältester Kurstag der Historie (YYYY-MM-DD) als startDate der Makro-Route; keine Historie → null (kein Abruf). */
export function oldestOhlcvDate(ohlcv: ReadonlyArray<{ date: string }> | null | undefined): string | null {
  let min: string | null = null;
  for (const b of ohlcv ?? []) if (b?.date && /^\d{4}-\d{2}-\d{2}/.test(b.date) && (min == null || b.date < min)) min = b.date.slice(0, 10);
  return min;
}

export function newestOhlcvDate(ohlcv: ReadonlyArray<{ date: string }> | null | undefined): string | null {
  let max: string | null = null;
  for (const b of ohlcv ?? []) if (b?.date && /^\d{4}-\d{2}-\d{2}/.test(b.date) && (max == null || b.date > max)) max = b.date.slice(0, 10);
  return max;
}

/**
 * Real10Y je Kurstag: exakter Datums-Treffer in `real10yByDate`, sonst null — dieselbe Zuordnung wie der BTC-Chart
 * (client/src/lib/btcAnalysis.ts: `real10y: real10yByDate[d.date] ?? null`). Keine Antwort → null (n/a).
 */
export function real10yOverlaySeries(points: ReadonlyArray<{ date: string }>, macro: Real10YMacroHistory | null | undefined): Real10YOverlayPoint[] | null {
  const byDate = macro?.real10yByDate;
  if (!byDate || Object.keys(byDate).length === 0) return null;
  return points.map(p => {
    const v = byDate[p.date];
    return { date: p.date, real10y: typeof v === "number" && Number.isFinite(v) ? v : null };
  });
}

/** Adds Real10Y to each price point by date (`_real10y`). No series → points unchanged. */
export function withReal10YOverlay<T extends WindowPoint>(points: T[], series: Real10YOverlayPoint[] | null | undefined): Array<T & Real10YFields> {
  if (!series) return points;
  const byDate = new Map(series.map(p => [p.date, p.real10y]));
  return points.map(pt => ({ ...pt, _real10y: byDate.get(pt.date) ?? null }));
}

function Real10YTooltipRow({ p }: { p: Real10YFields }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: REAL10Y_OVERLAY.color }}>{REAL10Y_OVERLAY.lineName}</span>
      <span className="font-mono">{p._real10y != null ? formatReal10yValue(p._real10y) : "n/a"}</span>
    </div>
  );
}

function Real10YOverlayStatus({ series, response, loading, failed, formatDateFull }: {
  series: Real10YOverlayPoint[] | null;
  response: Real10YMacroHistory | undefined;
  loading: boolean;
  failed: boolean;
  formatDateFull: (d: string) => string;
}) {
  const base = "mt-1 text-[10px] text-muted-foreground break-words";
  if (loading) return <div className={base} data-testid="real10y-overlay-loading">Real10Y: FRED wird geladen …</div>;
  if (failed || !response?.real10yByDate || Object.keys(response.real10yByDate).length === 0) {
    return <div className={base} data-testid="real10y-overlay-empty">Real10Y: n/a — {REAL10Y_OVERLAY.sourceLabel} nicht erreichbar.</div>;
  }
  if (!series) return <div className={base} data-testid="real10y-overlay-empty">Real10Y: n/a — FRED-Historie deckt dieses Fenster nicht ab.</div>;
  const last = [...series].reverse().find(p => p.real10y != null);
  return (
    <div className={base} data-testid="real10y-overlay-status">
      <span style={{ color: REAL10Y_OVERLAY.color }} className="font-medium">{REAL10Y_OVERLAY.lineName}</span> (rechte Achse, %)
      {last && <> · im Fenster zuletzt <span className="font-mono">{formatReal10yValue(last.real10y!)}</span> am {formatDateFull(last.date)}</>}
      {" "}· Quelle <a className="underline" href={REAL10Y_OVERLAY.sourceUrl} target="_blank" rel="noreferrer">{REAL10Y_OVERLAY.sourceLabel}</a> · kein Score-Einfluss
    </div>
  );
}
