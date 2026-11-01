/**
 * WORK_RECESSION_TA_CHART — Technische Analyse im Rezessions-Dashboard.
 * Reuses the stock Section 12 (TechnicalChart) unchanged in look; adds the
 * recession banner, region switch and macro sub-panes via optional props.
 * Display only — no score effect.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { TechnicalChart, MacroPane, type TaPaneContext } from "@/components/sections/TechnicalChart";
import { SectionCard } from "@/components/SectionCard";
import {
  RECESSION_TA_BOOKS,
  asOfJoin,
  maxAgeFor,
  type MacroSeriesId,
  type RecessionTaRegion,
  type RecessionTaResponse,
} from "@shared/recession-ta";
import { bannerProbabilities, recessionTaAsStock } from "@/lib/recessionTaModel";
import type { IndicatorResult, SubgroupResult } from "./recessionDashboardShared";
import { getProbColor } from "./recessionDashboardShared";

type OverlayKey = MacroSeriesId | "buffett";

const OVERLAY_META: Record<OverlayKey, { chip: string; on: string; color: string }> = {
  vol: { chip: "VIX", on: "border-orange-500 text-orange-500", color: "#f97316" },
  curve: { chip: "Yield Curve", on: "border-cyan-500 text-cyan-500", color: "#06b6d4" },
  spread: { chip: "Credit Spread", on: "border-rose-500 text-rose-500", color: "#f43f5e" },
  buffett: { chip: "Buffett", on: "border-yellow-500 text-yellow-500", color: "#eab308" },
};

const REF_LINES: Partial<Record<OverlayKey, { y: number; color: string; label?: string }[]>> = {
  vol: [{ y: 20, color: "#94a3b8", label: "20" }, { y: 30, color: "#f97316", label: "30 Fear" }],
  curve: [{ y: 0, color: "#ef4444", label: "Inversion" }],
  buffett: [{ y: 100, color: "#94a3b8", label: "100%" }],
};

interface BuffettPayload {
  points?: { date: string; ratio: number }[];
}

function chipClass(on: boolean, onClass: string, disabled: boolean) {
  return `inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11px] transition-colors sm:min-h-7 sm:text-[10px] ${
    disabled ? "border-border text-muted-foreground opacity-30 cursor-not-allowed"
      : on ? onClass : "border-border text-muted-foreground opacity-50 hover:opacity-80"
  }`;
}

function findIndicator(indicators: IndicatorResult[] | undefined, name: string) {
  return indicators?.find(i => i.name === name && i.available !== false) ?? null;
}

export function RecessionTaSection({
  number,
  subgroups,
  topDrivers,
  indicators,
}: {
  number: number;
  subgroups?: SubgroupResult[];
  topDrivers?: string[];
  indicators?: IndicatorResult[];
}) {
  const [region, setRegion] = useState<RecessionTaRegion>("US");
  const [on, setOn] = useState<Record<OverlayKey, boolean>>({ vol: true, curve: true, spread: false, buffett: false });
  const book = RECESSION_TA_BOOKS[region];

  const ta = useQuery({
    queryKey: ["recession-ta", region],
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/analyze-recession/ta?region=${region}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as RecessionTaResponse;
    },
  });
  const buffett = useQuery({
    queryKey: ["recession-buffett", book.buffettRegion],
    enabled: on.buffett,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/analyze-recession/buffett?region=${book.buffettRegion}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as BuffettPayload;
    },
  });

  const stock = useMemo(() => (ta.data ? recessionTaAsStock(ta.data) : null), [ta.data]);
  const seriesById = useMemo(() => {
    const m = new Map<MacroSeriesId, RecessionTaResponse["series"][number]>();
    for (const s of ta.data?.series ?? []) if (!s.error && s.points.length) m.set(s.id, s);
    return m;
  }, [ta.data]);
  const buffettPoints = useMemo(
    () => (buffett.data?.points ?? []).map(p => ({ date: p.date, value: p.ratio })).filter(p => Number.isFinite(p.value)),
    [buffett.data],
  );

  const available = (k: OverlayKey) => (k === "buffett" ? buffett.isLoading || !on.buffett || buffettPoints.length > 0 : seriesById.has(k));
  const labelFor = (k: OverlayKey) => (k === "buffett" ? "Buffett (TMC/BIP)" : seriesById.get(k)?.label ?? book.series[k]?.label ?? OVERLAY_META[k].chip);

  const probs = bannerProbabilities({ subgroups, topDrivers });
  const lastRsi = useMemo(() => {
    const t = stock?.technicalIndicators;
    if (!t || !ta.data) return null;
    // RSI(14) is computed by the chart; derive the badge from the same closes.
    const c = ta.data.ohlcv.map(b => b.close);
    if (c.length < 15) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
    let ag = g / 14, al = l / 14;
    for (let i = 15; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      ag = (ag * 13 + Math.max(d, 0)) / 14;
      al = (al * 13 + Math.max(-d, 0)) / 14;
    }
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }, [stock, ta.data]);

  const badges = [
    { k: "Sahm", v: findIndicator(indicators, "Sahm-Regel")?.value },
    { k: "Buffett", v: findIndicator(indicators, "Buffett Indikator (TMC/GDP)")?.value },
    { k: "CAPE", v: findIndicator(indicators, "Shiller CAPE")?.value },
    { k: `RSI ${book.etf}`, v: lastRsi != null ? lastRsi.toFixed(1) : null },
    { k: "CSI", v: findIndicator(indicators, "Konsumklima (CSI)")?.value },
  ];

  const header = (
    <div className="mb-3 flex flex-col gap-2" data-testid="recession-ta-header">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 p-2.5" data-testid="recession-ta-banner">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Status</span>
        <span className="text-xs">
          REZESSION 12M{" "}
          <b className={probs.recession12m != null ? getProbColor(probs.recession12m) : "text-muted-foreground"}>
            {probs.recession12m != null ? `${Math.round(probs.recession12m)}%` : "n/a"}
          </b>
        </span>
        <span className="text-xs">
          KORREKTUR 12M{" "}
          <b className={probs.correction12m != null ? getProbColor(probs.correction12m) : "text-muted-foreground"}>
            {probs.correction12m != null ? `${Math.round(probs.correction12m)}%` : "n/a"}
          </b>
        </span>
        {probs.drivers.length > 0 && (
          <span className="min-w-0 text-[10px] text-muted-foreground">Top-Treiber: {probs.drivers.join(" · ")}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5" data-testid="recession-ta-regions">
          {(Object.keys(RECESSION_TA_BOOKS) as RecessionTaRegion[]).map(r => (
            <button key={r} type="button" onClick={() => setRegion(r)} aria-pressed={region === r} data-testid={`button-ta-region-${r}`}
              className={`min-h-9 rounded-md border px-3 text-[11px] font-medium transition-colors sm:min-h-7 sm:text-[10px] ${
                region === r ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted/50"
              }`}>
              {RECESSION_TA_BOOKS[r].label} <span className="opacity-70">({RECESSION_TA_BOOKS[r].etf})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" data-testid="recession-ta-badges">
          {badges.map(b => (
            <span key={b.k} className="rounded-full border border-border px-2 py-0.5 text-[9px] text-muted-foreground">
              {b.k}: <span className="font-mono text-foreground">{b.v ?? "n/a"}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  const chips = (
    <>
      {(Object.keys(OVERLAY_META) as OverlayKey[]).map(k => {
        const disabled = !available(k);
        const active = on[k] && !disabled;
        return (
          <button key={k} type="button" disabled={disabled} aria-pressed={active} data-testid={`button-ta-${k}`}
            title={disabled ? `${labelFor(k)}: n/a für ${book.label}` : `${labelFor(k)} — kein Score-Einfluss`}
            onClick={() => setOn(s => ({ ...s, [k]: !s[k] }))}
            className={chipClass(active, OVERLAY_META[k].on, disabled)}>
            {active ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            {k === "vol" ? (region === "US" ? "VIX" : region === "EU" ? "VSTOXX" : "Vol 20T") : OVERLAY_META[k].chip}
          </button>
        );
      })}
    </>
  );

  const panes = ({ points, tickFormatter, formatDateFull }: TaPaneContext) => {
    const dates = points.map(p => p.date);
    const out: JSX.Element[] = [];
    const push = (k: OverlayKey, pts: { date: string; value: number }[], maxAge: number, step: boolean, unit: string, hint: string) => {
      const vals = asOfJoin(dates, pts, maxAge);
      if (!vals.some(v => v != null)) return; // n/a in window → hide, chart stays
      out.push(
        <MacroPane key={k} testId={`chart-ta-${k}`} title={labelFor(k)} hint={hint}
          data={dates.map((d, i) => ({ date: d, [k]: vals[i] }))}
          lines={[{ key: k, name: labelFor(k), color: OVERLAY_META[k].color, step }]}
          refLines={REF_LINES[k]} unit={unit}
          tickFormatter={tickFormatter} formatDateFull={formatDateFull} />,
      );
    };
    for (const k of ["vol", "curve", "spread"] as const) {
      const s = seriesById.get(k);
      if (on[k] && s) push(k, s.points, maxAgeFor(s.frequency), s.frequency === "monthly", s.unit, `| ${s.source}`);
    }
    if (on.buffett && buffettPoints.length) push("buffett", buffettPoints, 400, true, "%", "| Marktwert / BIP");
    return out;
  };

  if (!stock || !ta.data?.ohlcv.length) {
    return (
      <SectionCard number={number} title="Technische Analyse" subtitle={`Rezessions-Signale – ${book.label} (${book.etf})`}>
        {header}
        <div className="py-8 text-center text-xs text-muted-foreground" data-testid="recession-ta-empty">
          {ta.isLoading ? "Lade Kursdaten…" : `Keine OHLCV-Daten für ${book.etf}${ta.data?.ohlcvError ? ` (${ta.data.ohlcvError})` : ""}`}
        </div>
      </SectionCard>
    );
  }

  return (
    <TechnicalChart
      key={region}
      data={stock}
      sectionNumber={number}
      title="Technische Analyse"
      subtitle={`Rezessions-Signale – ${book.label} (${book.etf}) · MA / MACD / RSI / VIX / Zinskurve / Spread`}
      headerSlot={header}
      extraChips={chips}
      extraPanes={panes}
      rangePresets={["1Y", "3Y", "5Y", "10Y", "Max"]}
      defaultRange="5Y"
    />
  );
}
