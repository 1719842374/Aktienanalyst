import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ComposedChart, Bar, Cell,
} from "recharts";

type RegionId = "US" | "EU" | "AS";
type WindowId = "1Y" | "3Y" | "5Y" | "10Y" | "MAX";
type Combo =
  | "oversold_turn" | "overbought_fade" | "aligned_up" | "aligned_down" | "mixed" | "n/a";
type DivKind = "regular_bull" | "regular_bear" | "hidden_bull" | "hidden_bear" | "none";

interface MarketPoint {
  date: string;
  close: number;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

interface VolPoint {
  date: string;
  value: number;
}

interface MarketPayload {
  region: RegionId;
  label: string;
  etf: string;
  window: string;
  asOf: string | null;
  rsi: number | null;
  rsiZone: "overbought" | "oversold" | "neutral" | "n/a";
  macd: number | null;
  signal: number | null;
  hist: number | null;
  combo: Combo;
  divergence?: {
    kind: DivKind;
    lookback: number;
    from: string | null;
    to: string | null;
    price1: number;
    price2: number;
    rsi1: number;
    rsi2: number;
  };
  series: MarketPoint[];
  volId?: string;
  volKind?: "implied" | "realized";
  volYMax?: number;
  volLatest?: number | null;
  volBand?: string;
  volNote?: string | null;
  vol?: VolPoint[];
}

const REGIONS: { id: RegionId; name: string }[] = [
  { id: "US", name: "US · SPY" },
  { id: "EU", name: "Europa · VGK" },
  { id: "AS", name: "Asien · ASHR" },
];

const WINDOWS: WindowId[] = ["1Y", "3Y", "5Y", "10Y", "MAX"];

function zoneColor(z: MarketPayload["rsiZone"]) {
  if (z === "overbought") return "text-red-500";
  if (z === "oversold") return "text-emerald-500";
  return z === "neutral" ? "text-foreground" : "text-muted-foreground";
}

function zoneDe(z: MarketPayload["rsiZone"]) {
  if (z === "overbought") return "Überkauft (≥70)";
  if (z === "oversold") return "Überverkauft (≤30)";
  if (z === "neutral") return "Neutral (30–70)";
  return "n/a";
}

function comboDe(c: Combo) {
  if (c === "oversold_turn") return "RSI tief + MACD dreht hoch — konstruktiv";
  if (c === "overbought_fade") return "RSI hoch + MACD dreht runter — Vorsicht";
  if (c === "aligned_up") return "RSI>50 und MACD>Signal — aligned up";
  if (c === "aligned_down") return "RSI<50 und MACD<Signal — aligned down";
  if (c === "mixed") return "RSI und MACD ziehen nicht zusammen";
  return "n/a";
}

function divDe(d: NonNullable<MarketPayload["divergence"]>) {
  if (d.kind === "none") return "Keine RSI-Divergenz in den letzten " + d.lookback + " Sessions.";
  const span = d.from && d.to ? ` (${d.from} → ${d.to})` : "";
  if (d.kind === "regular_bull") {
    return `Regular Bull: Preis tieferes Tief, RSI höheres Tief${span}.`;
  }
  if (d.kind === "regular_bear") {
    return `Regular Bear: Preis höheres Hoch, RSI tieferes Hoch${span}.`;
  }
  if (d.kind === "hidden_bull") {
    return `Hidden Bull: Preis höheres Tief, RSI tieferes Tief${span}.`;
  }
  return `Hidden Bear: Preis tieferes Hoch, RSI höheres Hoch${span}.`;
}

function volTitle(data: MarketPayload) {
  if (data.volKind === "realized") return "Realisierte Vol 20T (ASHR), %";
  if (data.region === "EU") return "VSTOXX (analog), Index";
  return "VIX (FRED VIXCLS), Index";
}

export function RegionRsiPanel() {
  const [region, setRegion] = useState<RegionId>("US");
  const [window, setWindow] = useState<WindowId>("5Y");

  const q = useQuery({
    queryKey: ["recession-markets", region, window],
    queryFn: async () => {
      const res = await fetch(`/api/analyze-recession/markets?region=${region}&window=${window}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<MarketPayload>;
    },
    staleTime: 30 * 60 * 1000,
  });

  const rsiSeries = (q.data?.series || []).filter(p => p.rsi != null);
  const macdSeries = (q.data?.series || []).filter(p => p.macd != null && p.signal != null);
  const volSeries = q.data?.vol || [];
  const div = q.data?.divergence;
  const yMax = q.data?.volYMax ?? 90;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map(r => (
          <button
            key={r.id}
            onClick={() => setRegion(r.id)}
            className={`px-2.5 py-1 text-[11px] rounded-md border ${
              region === r.id
                ? "bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {r.name}
          </button>
        ))}
        <span className="mx-1 w-px bg-border self-stretch" />
        {WINDOWS.map(w => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            className={`px-2 py-1 text-[11px] rounded-md border ${
              window === w
                ? "bg-muted border-foreground/20"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {w}
          </button>
        ))}
      </div>

      {q.isLoading && <p className="text-xs text-muted-foreground">RSI/MACD/Vol aus ETF-OHLCV …</p>}
      {q.error && (
        <p className="text-xs text-red-500">
          {(q.error as Error).message}. Braucht FMP-Historie für {region === "US" ? "SPY" : region === "EU" ? "VGK" : "ASHR"}.
        </p>
      )}

      {q.data && (
        <>
          <div className="flex flex-wrap items-baseline gap-3 text-sm">
            <span className="font-medium">{q.data.label}</span>
            <span className={`font-mono text-lg ${zoneColor(q.data.rsiZone)}`}>
              RSI(14) {q.data.rsi != null ? q.data.rsi.toFixed(1) : "n/a"}
            </span>
            <span className="text-xs text-muted-foreground">{zoneDe(q.data.rsiZone)}</span>
            {q.data.macd != null && q.data.signal != null && (
              <span className="font-mono text-xs text-muted-foreground">
                MACD {q.data.macd.toFixed(2)} / Sig {q.data.signal.toFixed(2)}
                {q.data.hist != null ? ` / H ${q.data.hist.toFixed(2)}` : ""}
              </span>
            )}
            {q.data.volLatest != null && (
              <span className="font-mono text-xs">
                Vol {q.data.volLatest.toFixed(1)} · {q.data.volBand || "n/a"}
              </span>
            )}
            {q.data.asOf && <span className="text-xs text-muted-foreground">Stand {q.data.asOf}</span>}
          </div>
          <p className="text-xs">{comboDe(q.data.combo)}</p>
          {div && (
            <p className={`text-xs ${div.kind === "none" ? "text-muted-foreground" : "text-foreground"}`}>
              {divDe(div)}
            </p>
          )}

          <div>
            <p className="text-[11px] text-muted-foreground mb-1">
              {volTitle(q.data)} · Y linear 0–{yMax} · Fenster {q.data.window}
              {q.data.volId ? ` · ${q.data.volId}` : ""}
            </p>
            {q.data.volNote && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-1">{q.data.volNote}</p>
            )}
            {volSeries.length > 0 ? (
              <div className="h-[150px] w-full">
                <ResponsiveContainer>
                  <LineChart data={volSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                    <YAxis domain={[0, yMax]} tick={{ fontSize: 10 }} width={32} />
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(v: number) => [Number(v).toFixed(2), q.data?.volId || "Vol"]}
                    />
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
              Bänder (US-kalibriert, EU/AS analog): &gt;40 Extreme Fear · 30–40 Fear · 20–30 Normal · &lt;20 Complacency. Kein 17er-Score.
            </p>
          </div>

          <div className="h-[160px] w-full">
            <ResponsiveContainer>
              <LineChart data={rsiSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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

          <div className="h-[140px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={macdSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, name: string) => [Number(v).toFixed(3), name]} />
                <ReferenceLine y={0} stroke="#888" />
                <Bar dataKey="hist" name="Hist">
                  {macdSeries.map((p, i) => (
                    <Cell key={i} fill={(p.hist ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="macd" name="MACD" stroke="#38bdf8" dot={false} strokeWidth={1.2} />
                <Line type="monotone" dataKey="signal" name="Signal" stroke="#a78bfa" dot={false} strokeWidth={1.2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Divergenz: letzte zwei Swings (Order 5, Gap ≥8, 90 Sessions). Regular = Trendwende-Kandidat, Hidden = Trendfortsetzung. Kein 17er-Score.
          </p>
        </>
      )}
    </div>
  );
}
