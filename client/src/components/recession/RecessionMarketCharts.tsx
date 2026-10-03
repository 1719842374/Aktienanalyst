import { useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ComposedChart, Bar, Cell,
} from "recharts";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useRecessionMarketCharts, useRecessionMarketFactpack } from "@/hooks/useRecessionMarketCharts";
import {
  RECESSION_CHART_MARKETS,
  MARKET_WINDOWS,
  type MarketWindow,
  type RecessionChartMarket,
  type RecessionChartMarketId,
  type RecessionFactpack,
  type RecessionOhlcvBar,
} from "@shared/recession-market-charts";

function fmt(n: number | null | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function billionsLabel(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${Math.round(n).toLocaleString("de-DE")} Mrd. $`;
}

function pegNote(flag: boolean): string {
  return flag ? "teuer je Wachstumseinheit" : "";
}

function FactRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-mono">
        {value}
        {hint ? <span className="block text-[10px] font-sans text-amber-600 dark:text-amber-400">{hint}</span> : null}
      </span>
    </div>
  );
}

function VolTooltip({
  active,
  payload,
  label,
  volId,
  marks,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  volId: string;
  marks: { date: string }[];
}) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value);
  const marked = marks.some(m => m.date === label);
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1 text-[11px] shadow-sm">
      <div>{label}</div>
      <div className="font-mono">{volId} {Number.isFinite(value) ? value.toFixed(2) : "n/a"}</div>
      {marked ? <div>Lokales Maximum</div> : null}
    </div>
  );
}

function PriceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RecessionOhlcvBar }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const bar = payload[0]?.payload;
  if (!bar) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1 text-[11px] shadow-sm">
      <div>{label}</div>
      <div className="font-mono">Close {fmt(bar.close, 2)}</div>
      <div className="font-mono">Volumen {bar.volume != null ? Math.round(bar.volume).toLocaleString("de-DE") : "n/a"}</div>
      <div className="font-mono">RSI {fmt(bar.rsi, 1)} · Hist {fmt(bar.hist, 3)}</div>
    </div>
  );
}

export function RecessionMarketCharts() {
  const [marketId, setMarketId] = useState<RecessionChartMarketId>("spy");
  const [window, setWindow] = useState<MarketWindow>("5Y");
  const [logPrice, setLogPrice] = useState(false);
  const [clickDate, setClickDate] = useState<string | null>(null);

  const q = useRecessionMarketCharts(window);
  const market: RecessionChartMarket | undefined = q.data?.markets.find(m => m.id === marketId);
  const factpackQ = useRecessionMarketFactpack(clickDate ? marketId : null, clickDate, window);
  const clickedBar = market?.ohlcv.find(b => b.date === clickDate) ?? null;

  function onChartClick(state: { activeLabel?: string | number } | null) {
    const label = state?.activeLabel;
    if (typeof label === "string" && label) setClickDate(label);
  }

  const pack: RecessionFactpack | null = factpackQ.data?.factpack ?? null;
  const macdSeries = (market?.ohlcv || []).filter(p => p.macd != null && p.signal != null);

  return (
    <div className="space-y-3" data-testid="recession-market-charts">
      <div className="flex flex-wrap gap-1.5">
        {RECESSION_CHART_MARKETS.map(m => (
          <button
            key={m.id}
            type="button"
            data-testid={`button-market-${m.id}`}
            onClick={() => { setMarketId(m.id); setClickDate(null); }}
            className={`px-2.5 py-1 text-[11px] rounded-md border ${
              marketId === m.id
                ? "bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {m.etf}
            <span className="hidden sm:inline"> · {m.label}</span>
          </button>
        ))}
        <span className="mx-1 w-px bg-border self-stretch" />
        {MARKET_WINDOWS.map(w => (
          <button
            key={w}
            type="button"
            data-testid={`button-window-${w}`}
            onClick={() => { setWindow(w); setClickDate(null); }}
            className={`px-2 py-1 text-[11px] rounded-md border ${
              window === w
                ? "bg-muted border-foreground/20"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {w}
          </button>
        ))}
        <button
          type="button"
          data-testid="button-price-log"
          onClick={() => setLogPrice(v => !v)}
          className={`px-2 py-1 text-[11px] rounded-md border ${
            logPrice ? "bg-muted border-foreground/20" : "border-border text-muted-foreground hover:bg-muted/40"
          }`}
        >
          {logPrice ? "Log" : "Linear"}
        </button>
      </div>

      {q.isLoading && <p className="text-xs text-muted-foreground">Lade ETF-OHLCV, Vol und Snapshot …</p>}
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
          <div className="flex flex-wrap items-baseline gap-3 text-sm">
            <span className="font-medium">{market.indexName} · {market.etf}</span>
            <span className="font-mono text-xs">
              {market.volId} {market.volLatest != null ? market.volLatest.toFixed(1) : "n/a"}
              {market.volBand ? ` · ${market.volBand}` : ""}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{market.volKind}</span>
            {q.data?.asOf && <span className="text-xs text-muted-foreground">Stand {q.data.asOf}</span>}
          </div>
          {market.volNote && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">{market.volNote}</p>
          )}

          <div data-testid="chart-vol">
            <p className="text-[11px] text-muted-foreground mb-1">
              Vol · Y linear 0–{market.volYMax} · Handelstage im Fenster {window}
              {market.bandScope === "analog" ? " · Bänder analog, nicht identisch" : " · Bänder US-kalibriert"}
            </p>
            {market.vol.length > 0 ? (
              <div className="h-[160px] w-full">
                <ResponsiveContainer>
                  <LineChart data={market.vol} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                    <YAxis domain={[0, market.volYMax]} tick={{ fontSize: 10 }} width={32} allowDataOverflow />
                    <Tooltip content={<VolTooltip volId={market.volId} marks={market.volMarks} />} />
                    <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="4 4" />
                    <ReferenceLine y={30} stroke="#f97316" strokeDasharray="4 4" />
                    <ReferenceLine y={20} stroke="#10b981" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="value" stroke="#6366f1" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keine Vol-Serie für dieses Fenster.</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              &gt;40 Extreme Fear · 30–40 Fear · 20–30 Normal · &lt;20 Complacency. Kein Dashboard-Score — der bleibt s(z).
            </p>
            {market.volMarks.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1" data-testid="vol-marks">
                Lokale Maxima (V&gt;35, ±20 Handelstage), außerhalb der Fläche:{" "}
                {market.volMarks.map(m => `${m.date} ${m.value.toFixed(1)}`).join(" · ")}
              </p>
            )}
          </div>

          <div data-testid="chart-price">
            <p className="text-[11px] text-muted-foreground mb-1">
              Preis {market.etf} ({logPrice ? "log" : "linear"}) · Klick öffnet das Factpack · keine PE-Achse
            </p>
            {market.ohlcv.length > 0 ? (
              <div className="h-[180px] w-full cursor-pointer">
                <ResponsiveContainer>
                  <LineChart data={market.ohlcv} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={onChartClick}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      width={48}
                      scale={logPrice ? "log" : "auto"}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={<PriceTooltip />} />
                    <Line type="monotone" dataKey="close" stroke="#f97316" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keine Kurse für dieses Fenster.</p>
            )}
          </div>

          <div data-testid="chart-volume" className="h-[80px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={market.ohlcv} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} onClick={onChartClick}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="volume" name="Volumen" fill="#94a3b8" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div data-testid="chart-rsi" className="h-[140px] w-full">
            <ResponsiveContainer>
              <LineChart data={market.ohlcv.filter(p => p.rsi != null)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={onChartClick}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [Number(v).toFixed(1), "RSI(14)"]} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" />
                <ReferenceLine y={30} stroke="#10b981" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="rsi" stroke="#f97316" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div data-testid="chart-macd" className="h-[140px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={macdSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={onChartClick}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, name: string) => [Number(v).toFixed(3), name]} />
                <ReferenceLine y={0} stroke="#888" />
                <Bar dataKey="hist" name="Hist">
                  {macdSeries.map((p, i) => (
                    <Cell key={`${p.date}-${i}`} fill={(p.hist ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="macd" name="MACD" stroke="#38bdf8" dot={false} strokeWidth={1.2} />
                <Line type="monotone" dataKey="signal" name="Signal" stroke="#a78bfa" dot={false} strokeWidth={1.2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">
            RSI(14) und MACD(12,26,9) aus ETF-OHLCV. Bewertung nur im Klick-Factpack, Label ETF-Proxy.
          </p>

          {market.id === "spy" && (
            <div data-testid="chart-leverage">
              <p className="text-[11px] text-muted-foreground mb-1">
                FINRA Margin Debit · nur US · z(YoY) &gt; 1 = Hebel hoch
              </p>
              {market.leverage ? (
                <>
                  <p className="text-sm">
                    <span className="font-mono">{billionsLabel(market.leverage.latestBillions)}</span>
                    <span className="text-xs text-muted-foreground">
                      {" "}· {market.leverage.asOf || "n/a"}
                      {" "}· YoY {fmt(market.leverage.yoyPercent, 1)} %
                      {" "}· z 5J {fmt(market.leverage.z5y, 2)}
                    </span>
                    {market.leverage.elevated && (
                      <span className="ml-2 text-xs text-red-500">Hebel hoch</span>
                    )}
                  </p>
                  <div className="h-[100px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={market.leverage.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                        <YAxis tick={{ fontSize: 10 }} width={40} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`${Number(v).toFixed(0)} Mrd. $`, "Debit"]} />
                        <Line type="monotone" dataKey="billions" stroke="#0ea5e9" dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{market.leverageNote || "Streifen aus — keine FINRA-Serie."}</p>
              )}
            </div>
          )}
        </>
      )}

      <Sheet open={clickDate != null} onOpenChange={(open) => { if (!open) setClickDate(null); }}>
        <SheetContent className="overflow-y-auto" data-testid="drawer-factpack">
          <SheetHeader>
            <SheetTitle>Factpack · ETF-Proxy</SheetTitle>
            <SheetDescription>
              {market?.etf} · {clickDate}
              {clickedBar ? ` · Close ${fmt(clickedBar.close, 2)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {factpackQ.isLoading && <p className="text-xs text-muted-foreground mt-4">Factpack wird geladen …</p>}
          {factpackQ.error && (
            <div className="mt-4">
              <ApiErrorBanner
                error={factpackQ.error}
                block
                onRetry={() => factpackQ.refetch()}
                retrying={factpackQ.isFetching}
                testId="text-factpack-error"
              />
            </div>
          )}
          {pack && (
            <div className="mt-4" data-testid="factpack-fields">
              <FactRow label="Preis" value={fmt(pack.price, 2)} />
              <FactRow label="Volumen" value={pack.volume != null ? Math.round(pack.volume).toLocaleString("de-DE") : "n/a"} />
              <FactRow label="PE ttm" value={fmt(pack.pe, 2)} hint={pack.epsBasis === "annual" ? "Jahres-EPS" : "Preis / EPS ttm"} />
              <FactRow label="PE fwd" value={fmt(pack.peFwd, 2)} hint="Preis / EPS NTM" />
              <FactRow label="EPS YoY" value={pack.epsYoy != null ? `${fmt(pack.epsYoy, 1)} %` : "n/a"} hint="g in Prozent" />
              <FactRow label="PEG ttm" value={fmt(pack.peg, 2)} hint={pegNote(pack.pegExpensive)} />
              <FactRow label="PEG fwd" value={fmt(pack.pegFwd, 2)} hint={pegNote(pack.pegFwdExpensive)} />
              <FactRow label="g Konsens" value={pack.gCons != null ? `${fmt(pack.gCons, 1)} %` : "n/a"} />
              <FactRow label="RSI(14)" value={fmt(pack.rsi, 1)} />
              <FactRow label="MACD Hist" value={fmt(pack.macdHist, 3)} />
              <FactRow label="MACD / Signal" value={`${fmt(pack.macd, 3)} / ${fmt(pack.signal, 3)}`} />
              <p className="text-[11px] text-muted-foreground mt-3">
                ETF-Proxy. Index-PEG ist grob (Indexgewichte ≠ ETF). PEG &gt; 3 bei positivem g = teuer je Wachstumseinheit.
                {pack.note ? ` ${pack.note}` : ""}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
