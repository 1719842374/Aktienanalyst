import { useState } from "react";
import { SectionCard } from "@/components/SectionCard";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  useRecessionMarketCharts,
  useRecessionMarketFactpack,
} from "@/hooks/useRecessionMarketCharts";
import {
  CHART_BOOKS,
  MARKET_WINDOWS,
  VOL_Y_MAX,
  pegDisplaySuffix,
  valuationGapText,
  volBandLabel,
  type ChartMarketId,
  type MarketChart,
  type MarketFactpack,
  type MarketWindow,
} from "@shared/recession-market-charts";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  ComposedChart,
  Bar,
  Cell,
} from "recharts";

function fmt(n: number | null | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

function DayTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: { name: string; value: string }[];
}) {
  if (!active || !label) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-1 text-[11px] shadow-sm">
      <div className="font-mono mb-0.5">{label}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{r.name}</span>
          <span className="font-mono">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function VolTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !label) return null;
  const value = payload?.[0]?.value;
  const n = typeof value === "number" ? value : null;
  return (
    <DayTooltip
      active
      label={label}
      rows={[
        { name: "Vol", value: n == null ? "n/a" : n.toFixed(2) },
        { name: "Band", value: volBandLabel(n) },
      ]}
    />
  );
}

function chartClickDate(state: { activeLabel?: string | number } | null): string | null {
  const label = state?.activeLabel;
  return typeof label === "string" && label ? label : null;
}

function valuationFigure(
  n: number | null | undefined,
  digits: number,
  missing: string | null | undefined,
  marker: string,
): string {
  if (n != null && Number.isFinite(n)) return fmt(n, digits);
  return valuationGapText(missing, marker);
}

function SnapshotRow({ market }: { market: MarketChart }) {
  const s = market.snapshot;
  const pegNote = s.pegKind === "formula" && s.peg != null && s.peg > 3 ? " · teuer je Wachstumseinheit" : "";
  const yoy = s.epsYoy == null ? valuationGapText(s.missing, "EPS YoY fehlt:") : `${fmt(s.epsYoy, 1)}%`;
  return (
    <>
      <p className="text-[11px] text-muted-foreground font-mono break-words" data-testid="market-snapshot">
        {market.valuationLabel} · PE {valuationFigure(s.pe, 1, s.missing, "PE fehlt:")} · fwd {valuationFigure(s.peFwd, 1, s.missing, "fwd fehlt:")} · EPS YoY {yoy} · PEG {valuationFigure(s.peg, 2, s.missing, "PEG fehlt:")}
        {pegDisplaySuffix(s.pegKind)}
        {pegNote} · PEG fwd {valuationFigure(s.pegFwd, 2, s.missing, "PEG fwd fehlt:")}
        {pegDisplaySuffix(s.pegFwdKind)} · RSI {fmt(s.rsi, 1)} · MACD H {fmt(s.macdHist, 2)}
      </p>
      {s.missing && (
        <p className="text-[10px] text-muted-foreground break-words" data-testid="snapshot-missing">
          {s.missing}
        </p>
      )}
    </>
  );
}

function FactpackBody({ pack, loading, error }: { pack: MarketFactpack | undefined; loading: boolean; error: unknown }) {
  if (loading) return <p className="text-xs text-muted-foreground">Factpack …</p>;
  if (error) return <p className="text-xs text-red-500">{error instanceof Error ? error.message : "Factpack fehlgeschlagen"}</p>;
  if (!pack) return null;
  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: "PE ttm", value: valuationFigure(pack.pe, 2, pack.note, "PE fehlt:") },
    { label: "PE fwd", value: valuationFigure(pack.peFwd, 2, pack.note, "fwd fehlt:") },
    { label: "EPS YoY", value: pack.epsYoy == null ? valuationGapText(pack.note, "EPS YoY fehlt:") : `${fmt(pack.epsYoy, 2)} %` },
    { label: "PEG ttm", value: `${valuationFigure(pack.peg, 2, pack.note, "PEG fehlt:")}${pegDisplaySuffix(pack.pegKind)}`, warn: pack.pegExpensive },
    { label: "PEG fwd", value: `${valuationFigure(pack.pegFwd, 2, pack.note, "PEG fwd fehlt:")}${pegDisplaySuffix(pack.pegFwdKind)}`, warn: pack.pegFwdExpensive },
    { label: "Konsens-Wachstum", value: pack.gCons == null ? "n/a" : `${fmt(pack.gCons, 2)} %` },
    { label: "RSI(14)", value: fmt(pack.rsi, 1) },
    { label: "MACD", value: fmt(pack.macd, 3) },
    { label: "Signal", value: fmt(pack.macdSignal, 3) },
    { label: "MACD Hist", value: fmt(pack.macdHist, 3) },
    { label: "Volumen", value: fmtVol(pack.volume) },
    { label: "Close", value: fmt(pack.close, 2) },
  ];
  return (
    <div className="space-y-2" data-testid="factpack-body">
      <p className="text-[11px] tracking-wide text-muted-foreground">{pack.valuationLabel}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={`font-mono text-right ${r.warn ? "text-red-500" : ""}`}>
              {r.value}
              {r.warn ? " · teuer" : ""}
            </dd>
          </div>
        ))}
      </dl>
      {pack.note && <p className="text-[11px] text-muted-foreground">{pack.note}</p>}
      <p className="text-[10px] text-muted-foreground">
        PEG = PE / g, g in Prozent. PEG &gt; 3 bei positivem g = teuer je Wachstumseinheit. Keine PE-Linie auf der Preisachse.
      </p>
    </div>
  );
}

function MarketPanes({
  market,
  logScale,
  onPickDate,
}: {
  market: MarketChart;
  logScale: boolean;
  onPickDate: (date: string) => void;
}) {
  const price = market.ohlcv;
  const rsi = price.filter((p) => p.rsi != null);
  const macd = price.filter((p) => p.macd != null && p.signal != null);
  const yMax = market.volYMax ?? VOL_Y_MAX;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] text-muted-foreground mb-1">
          {market.volId} · {market.volKind === "realized" ? "realisiert" : "implizit"} · Y linear 0–{yMax}
          {market.bandsAnalog ? " · Bänder analog, nicht identisch" : " · US-kalibriert"}
        </p>
        {market.volNote && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-1">{market.volNote}</p>
        )}
        {market.vol.length > 0 ? (
          <div className="h-[180px] w-full" data-testid="vol-chart">
            <ResponsiveContainer>
              <ComposedChart data={market.vol} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis domain={[0, yMax]} tick={{ fontSize: 10 }} width={32} allowDataOverflow />
                <Tooltip content={<VolTooltip />} />
                <ReferenceArea y1={40} y2={yMax} fill="#ef4444" fillOpacity={0.06} />
                <ReferenceArea y1={30} y2={40} fill="#f97316" fillOpacity={0.06} />
                <ReferenceArea y1={20} y2={30} fill="#94a3b8" fillOpacity={0.06} />
                <ReferenceArea y1={0} y2={20} fill="#10b981" fillOpacity={0.06} />
                <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="4 4" />
                <ReferenceLine y={30} stroke="#f97316" strokeDasharray="4 4" />
                <ReferenceLine y={20} stroke="#10b981" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="value" stroke="#6366f1" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Keine Vol-Serie für dieses Fenster.</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">
          &gt;40 Extreme Fear (kein Buy-Label im Scorer) · 30–40 Fear · 20–30 Normal · &lt;20 Complacency.
          Dashboard-Score bleibt s(z), nicht diese Eimer.
        </p>
        {market.marks.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1 max-h-16 overflow-y-auto" data-testid="vol-marks">
            {market.marks.map((m) => (
              <li key={m.date} className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1">
                {m.date} · {m.value.toFixed(1)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-[11px] text-muted-foreground mb-1">
          {market.etf} Close{logScale ? " · log" : ""} · Klick öffnet das Factpack. Keine PE-Achse.
        </p>
        {price.length > 0 ? (
          <div className="h-[220px] w-full" data-testid="price-chart">
            <ResponsiveContainer>
              <LineChart
                data={price}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                onClick={(state) => {
                  const date = chartClickDate(state);
                  if (date) onPickDate(date);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis
                  scale={logScale ? "log" : "linear"}
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 10 }}
                  width={48}
                />
                <Tooltip
                  content={({ active, label, payload }) => (
                    <DayTooltip
                      active={active}
                      label={typeof label === "string" ? label : undefined}
                      rows={[{ name: "Close", value: fmt(payload?.[0]?.value as number | undefined, 2) }]}
                    />
                  )}
                />
                <Line type="monotone" dataKey="close" stroke="#38bdf8" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Keine Kurse für dieses Fenster.</p>
        )}
      </div>

      {price.length > 0 && (
        <div className="h-[80px] w-full" data-testid="volume-chart">
          <ResponsiveContainer>
            <BarChartSafe data={price} onPickDate={onPickDate} />
          </ResponsiveContainer>
        </div>
      )}

      {rsi.length > 0 && (
        <div className="h-[120px] w-full" data-testid="rsi-chart">
          <ResponsiveContainer>
            <LineChart
              data={rsi}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              onClick={(state) => {
                const date = chartClickDate(state);
                if (date) onPickDate(date);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} />
              <Tooltip
                content={({ active, label, payload }) => (
                  <DayTooltip
                    active={active}
                    label={typeof label === "string" ? label : undefined}
                    rows={[{ name: "RSI(14)", value: fmt(payload?.[0]?.value as number | undefined, 1) }]}
                  />
                )}
              />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" />
              <ReferenceLine y={30} stroke="#10b981" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="rsi" stroke="#f97316" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {macd.length > 0 && (
        <div className="h-[130px] w-full" data-testid="macd-chart">
          <ResponsiveContainer>
            <ComposedChart
              data={macd}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              onClick={(state) => {
                const date = chartClickDate(state);
                if (date) onPickDate(date);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip
                content={({ active, label, payload }) => (
                  <DayTooltip
                    active={active}
                    label={typeof label === "string" ? label : undefined}
                    rows={(payload ?? []).map((p) => ({
                      name: String(p.name ?? p.dataKey ?? ""),
                      value: fmt(typeof p.value === "number" ? p.value : null, 3),
                    }))}
                  />
                )}
              />
              <ReferenceLine y={0} stroke="#888" />
              <Bar dataKey="hist" name="Hist" isAnimationActive={false}>
                {macd.map((p) => (
                  <Cell key={p.date} fill={(p.hist ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="macd" name="MACD" stroke="#38bdf8" dot={false} strokeWidth={1.2} isAnimationActive={false} />
              <Line type="monotone" dataKey="signal" name="Signal" stroke="#a78bfa" dot={false} strokeWidth={1.2} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {market.id === "SPY" && market.leverage && (
        <div data-testid="leverage-strip">
          <p className="text-[11px] mb-1">
            FINRA Margin Debit {fmt(market.leverage.billions, 0)} {market.leverage.unit}
            {" · "}YoY {market.leverage.yoyPct == null ? "n/a" : `${fmt(market.leverage.yoyPct, 1)} %`}
            {" · "}z(5J) {fmt(market.leverage.z5y, 2)}
            {market.leverage.high ? " · Hebel hoch" : ""}
            {" · "}{market.leverage.asOf}
          </p>
          <div className="h-[90px] w-full">
            <ResponsiveContainer>
              <LineChart data={market.leverage.points} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={32} />
                <YAxis tick={{ fontSize: 10 }} width={40} domain={["auto", "auto"]} />
                <Tooltip
                  content={({ active, label, payload }) => (
                    <DayTooltip
                      active={active}
                      label={typeof label === "string" ? label : undefined}
                      rows={[{ name: "Mrd. $", value: fmt(payload?.[0]?.value as number | undefined, 0) }]}
                    />
                  )}
                />
                <Line type="monotone" dataKey="billions" stroke="#eab308" dot={false} strokeWidth={1.4} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-muted-foreground">z(YoY) &gt; 1 = Hebel hoch. Nur SPY — nicht unter ASHR, kein EU-Klon.</p>
        </div>
      )}
      {market.id === "SPY" && !market.leverage && market.leverageNote && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="leverage-note">{market.leverageNote}</p>
      )}
    </div>
  );
}

function BarChartSafe({
  data,
  onPickDate,
}: {
  data: MarketChart["ohlcv"];
  onPickDate: (date: string) => void;
}) {
  return (
    <ComposedChart
      data={data}
      margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
      onClick={(state) => {
        const date = chartClickDate(state);
        if (date) onPickDate(date);
      }}
    >
      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
      <YAxis tick={{ fontSize: 10 }} width={48} />
      <Tooltip
        content={({ active, label, payload }) => (
          <DayTooltip
            active={active}
            label={typeof label === "string" ? label : undefined}
            rows={[{ name: "Volumen", value: fmtVol(payload?.[0]?.value as number | undefined) }]}
          />
        )}
      />
      <Bar dataKey="volume" fill="#64748b" isAnimationActive={false} />
    </ComposedChart>
  );
}

function ChartsBody() {
  const [tab, setTab] = useState<ChartMarketId>("SPY");
  const [window, setWindow] = useState<MarketWindow>("5Y");
  const [logScale, setLogScale] = useState(false);
  const [clickDate, setClickDate] = useState<string | null>(null);
  const q = useRecessionMarketCharts(window);
  const market = q.data?.markets.find((m) => m.id === tab) ?? null;
  const factpack = useRecessionMarketFactpack(clickDate ? tab : null, clickDate, window);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {CHART_BOOKS.map((b) => (
          <button
            key={b.id}
            type="button"
            data-testid={`tab-${b.id.toLowerCase()}`}
            onClick={() => {
              setTab(b.id);
              setClickDate(null);
            }}
            className={`px-2.5 py-1 text-[11px] rounded-md border ${
              tab === b.id
                ? "bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {b.etf}
          </button>
        ))}
        <span className="mx-1 w-px bg-border self-stretch" />
        {MARKET_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            data-testid={`window-${w}`}
            onClick={() => {
              setWindow(w);
              setClickDate(null);
            }}
            className={`px-2 py-1 text-[11px] rounded-md border ${
              window === w
                ? "bg-muted border-foreground/20"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {w === "1Y" ? "1" : w === "3Y" ? "3" : w === "5Y" ? "5" : w === "10Y" ? "10" : "MAX"}
          </button>
        ))}
        <button
          type="button"
          data-testid="price-log-toggle"
          onClick={() => setLogScale((v) => !v)}
          className={`px-2 py-1 text-[11px] rounded-md border ${
            logScale ? "bg-muted border-foreground/20" : "border-border text-muted-foreground hover:bg-muted/40"
          }`}
        >
          log
        </button>
      </div>

      {q.isLoading && <p className="text-xs text-muted-foreground">Vier Märkte, Vol und OHLCV …</p>}
      {q.error && (
        <ApiErrorBanner
          error={q.error}
          block={!q.data}
          onRetry={() => q.refetch()}
          retrying={q.isFetching}
          testId="text-market-charts-error"
        />
      )}

      {market && (
        <>
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-medium">{market.name}</span>
            <span className="text-xs text-muted-foreground">{market.etf}</span>
            {q.data?.asOf && <span className="text-xs text-muted-foreground">Stand {q.data.asOf}</span>}
            <span className="text-xs text-muted-foreground">Fenster {q.data?.window}</span>
          </div>
          <SnapshotRow market={market} />
          <MarketPanes market={market} logScale={logScale} onPickDate={setClickDate} />
        </>
      )}

      <Drawer open={clickDate != null} onOpenChange={(open) => { if (!open) setClickDate(null); }}>
        <DrawerContent className="max-h-[85vh] overflow-y-auto px-4 pb-6">
          <DrawerHeader>
            <DrawerTitle>
              {tab} · {clickDate}
            </DrawerTitle>
            <DrawerDescription>Factpack zum Handelstag. Bewertung nur hier, nicht als zweite Achse.</DrawerDescription>
          </DrawerHeader>
          <div data-testid="factpack-drawer">
            <FactpackBody pack={factpack.data} loading={factpack.isLoading} error={factpack.error} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export function RecessionMarketChartsSection({ number = 9 }: { number?: number }) {
  return (
    <SectionCard number={number} title="Vier Märkte — Vol, Preis, Factpack" subtitle="SPY · QQQ · VGK · ASHR">
      <ChartsBody />
    </SectionCard>
  );
}
