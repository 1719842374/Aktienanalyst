/**
 * BtcMinerSection.tsx
 * Renders 4 miner-profitability cards by fetching /api/btc-miner directly.
 *
 * Cards:
 *  1. Hash Ribbons — MA30 vs MA60 of hashrate + capitulation flag
 *  2. Puell Multiple — daily emission USD / 365d MA
 *  3. Difficulty Ribbon Compression — gauge (0–1)
 *  4. Breakeven Price — vs current BTC spot price
 *
 * All data comes from the existing server/btc-miner.ts backend.
 * No changes to btcAnalysis.ts required for this component.
 */

import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";

// ── Types (mirror of server/btc-miner.ts MinerData) ─────────────────────────
interface HashratePoint {
  date: string;
  hashrateEH: number;
}

interface MinerData {
  hashrateHistory: HashratePoint[];
  ma30: (number | null)[];
  ma60: (number | null)[];
  dates: string[];
  inCapitulation: boolean;
  crossoverSignal: boolean;
  currentHashrateEH: number;
  breakevenPrice: number;
  hashprice: number; // BTC/TH/s/day — multiply by btcPrice for USD
  puellMultiple: number | null;
  puellHistory: { date: string; value: number }[];
  difficultyHistory: { date: string; difficulty: number }[];
  difficultyRibbonCompression: number;
  lastUpdated: string;
}

interface Props {
  btcPrice: number; // pass current BTC price for hashprice USD calc
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${fmt(n, 0)}`;
}

function scoreColor(value: number, invert = false): string {
  const v = invert ? -value : value;
  if (v >= 0.7) return "text-green-400";
  if (v >= 0.4) return "text-yellow-400";
  if (v >= 0.0) return "text-orange-400";
  return "text-red-400";
}

// ── Gauge component (Difficulty Ribbon Compression) ──────────────────────────
function CompressionGauge({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    pct >= 70 ? "#22c55e" : pct >= 40 ? "#eab308" : pct >= 20 ? "#f97316" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-40 h-20 overflow-hidden">
        {/* Background arc */}
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <path
            d="M 10 100 A 90 90 0 0 1 190 100"
            fill="none"
            stroke="#334155"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <path
            d="M 10 100 A 90 90 0 0 1 190 100"
            fill="none"
            stroke={color}
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 283} 283`}
          />
          <text
            x="100"
            y="95"
            textAnchor="middle"
            fill={color}
            fontSize="22"
            fontWeight="bold"
          >
            {pct.toFixed(0)}%
          </text>
        </svg>
      </div>
      <div className="text-xs text-slate-400">
        {pct >= 70
          ? "Stark komprimiert → Kaufzone"
          : pct >= 40
          ? "Mäßige Kompression"
          : pct >= 20
          ? "Ribbons weiten sich"
          : "Ribbons weit → Kein Signal"}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function BtcMinerSection({ btcPrice }: Props) {
  const [data, setData] = useState<MinerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/btc-miner");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mr-3" />
        Lade Miner-Daten von mempool.space…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 text-sm">
        ⚠ Miner-Daten nicht verfügbar: {error ?? "Keine Daten"}
      </div>
    );
  }

  // ── Build Hash Ribbon chart data ──────────────────────────────────────────
  const hashRibbonData = data.dates
    .map((date, i) => ({
      date,
      hashrate: data.hashrateHistory[i]?.hashrateEH ?? null,
      ma30: data.ma30[i] ?? null,
      ma60: data.ma60[i] ?? null,
    }))
    .filter((_, i) => i >= 59) // skip until ma60 has values
    .slice(-365); // last 12 months

  // ── Puell chart (last 2Y) ─────────────────────────────────────────────────
  const puellData = data.puellHistory.slice(-730);

  // ── Hashprice in USD ─────────────────────────────────────────────────────
  const hashpriceUSD = data.hashprice * btcPrice;

  // ── Capitulation badge ──────────────────────────────────────────────────
  const capBadge = data.inCapitulation ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
      ⚠ Kapitulation aktiv — MA30 &lt; MA60
    </span>
  ) : data.crossoverSignal ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/20 text-green-400 border border-green-500/30">
      ✓ Hash Ribbon Buy Signal (MA30 kreuzte MA60)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700 text-slate-300">
      Neutral — kein aktives Signal
    </span>
  );

  // ── Puell zone badge ─────────────────────────────────────────────────────
  const puellBadge = () => {
    const v = data.puellMultiple;
    if (v === null) return null;
    if (v < 0.5)
      return <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">Kapitulationszone (&lt;0.5) — historisch bullisch</span>;
    if (v > 4)
      return <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">Überhitzungszone (&gt;4) — Vorsicht</span>;
    if (v > 2)
      return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">Erhöhte Miner-Einnahmen</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">Neutrale Zone</span>;
  };

  return (
    <div className="space-y-4">
      {/* ── Row 1: Hash Ribbons + Puell Multiple ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Card 1 — Hash Ribbons */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-white">Hash Ribbons</h3>
              <p className="text-xs text-slate-400">
                MA30 vs MA60 der Netzwerk-Hashrate (EH/s) — Quelle: mempool.space
              </p>
            </div>
            {capBadge}
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-slate-400">Aktuelle Hashrate</span>
              <div className="text-white font-semibold">{data.currentHashrateEH.toFixed(0)} EH/s</div>
            </div>
            <div>
              <span className="text-slate-400">Hashprice</span>
              <div className="text-white font-semibold">${hashpriceUSD.toFixed(3)}/TH/d</div>
            </div>
          </div>
          {hashRibbonData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={hashRibbonData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(0, 7)}
                  interval={Math.floor(hashRibbonData.length / 6)}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 11 }}
                  formatter={(val: number, name: string) => [`${val?.toFixed(1)} EH/s`, name]}
                  labelFormatter={(l: string) => l}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="ma30" name="MA30" stroke="#f97316" dot={false} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="ma60" name="MA60" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="hashrate" name="Hashrate" stroke="#64748b" dot={false} strokeWidth={1} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-slate-500 text-xs text-center py-8">Nicht genug Daten für Hash-Ribbon-Chart (mind. 60 Datenpunkte)</div>
          )}
          <p className="text-xs text-slate-500">
            Kapitulation: MA30 fällt unter MA60 → ineffiziente Miner schalten ab.<br />
            Kaufsignal: MA30 kreuzt MA60 von unten → historisch starkes Einstiegssignal.
          </p>
        </div>

        {/* Card 2 — Puell Multiple */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-white">Puell Multiple</h3>
              <p className="text-xs text-slate-400">
                Tägliche Emission (USD) ÷ 365d-MA — Miner-Einnahmen relativ zum Mittel
              </p>
            </div>
            {puellBadge()}
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-slate-400">Aktuell</span>
              <div className={`font-bold text-lg ${
                data.puellMultiple === null ? "text-slate-400" :
                data.puellMultiple < 0.5 ? "text-green-400" :
                data.puellMultiple > 4 ? "text-red-400" : "text-white"
              }`}>
                {data.puellMultiple !== null ? data.puellMultiple.toFixed(2) : "N/A"}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Benötigt</span>
              <div className="text-slate-300 text-xs mt-1">BTC-Preishistorie (365d+)</div>
            </div>
          </div>
          {puellData.length > 10 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={puellData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(0, 7)}
                  interval={Math.floor(puellData.length / 6)}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 11 }}
                  formatter={(val: number) => [val.toFixed(3), "Puell Multiple"]}
                />
                {/* Kapitulationszone */}
                <ReferenceLine y={0.5} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "0.5 Kap.", fill: "#22c55e", fontSize: 10 }} />
                {/* Überhitzungszone */}
                <ReferenceLine y={4} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "4.0 Hot", fill: "#ef4444", fontSize: 10 }} />
                <Line type="monotone" dataKey="value" name="Puell" stroke="#a855f7" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-slate-500 text-xs text-center py-8">
              {data.puellMultiple === null
                ? "Puell Multiple benötigt BTC-Preishistorie (365 Tage+). Wird berechnet, sobald btcPriceHistory übergeben wird."
                : "Zu wenige Historien-Datenpunkte für Chart"}
            </div>
          )}
          <p className="text-xs text-slate-500">
            &lt;0.5 = Kapitulationszone (Kaufsignal) · 0.5–2 = normal · &gt;4 = Überhitzung
          </p>
        </div>
      </div>

      {/* ── Row 2: Difficulty Ribbon Compression + Breakeven Price ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Card 3 — Difficulty Ribbon Compression */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Difficulty Ribbon Compression</h3>
            <p className="text-xs text-slate-400">
              MAs 9–200 Tage der Mining-Difficulty. Kompression = ineffiziente Miner geben auf.
            </p>
          </div>
          <CompressionGauge value={data.difficultyRibbonCompression} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/40 rounded-lg p-2">
              <div className="text-slate-400">Kompression Score</div>
              <div className="text-white font-semibold">{(data.difficultyRibbonCompression * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-slate-700/40 rounded-lg p-2">
              <div className="text-slate-400">Difficulty Datenpunkte</div>
              <div className="text-white font-semibold">{data.difficultyHistory.length}</div>
            </div>
          </div>
          <div className="text-xs text-slate-500 space-y-1">
            <div>• &gt;70%: Stark komprimiert → historisch gute Einstiegszone</div>
            <div>• 40–70%: Moderate Kompression → Netzwerk konsolidiert</div>
            <div>• &lt;40%: Ribbons weit → kein Kaufsignal</div>
          </div>
          <p className="text-xs text-slate-500">
            Quelle: mempool.space difficulty-adjustments (Variationskoeffizient der MAs 9–200d)
          </p>
        </div>

        {/* Card 4 — Miner Breakeven Price */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Miner Breakeven-Preis</h3>
            <p className="text-xs text-slate-400">
              Antminer S19 XP (140 TH/s, 21.5 J/TH) bei $0.05/kWh — institutioneller Referenz-Miner
            </p>
          </div>

          {/* Big number comparison */}
          <div className="flex gap-4">
            <div className="flex-1 bg-slate-700/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-400 mb-1">BTC Spot</div>
              <div className="text-xl font-bold text-white">${fmt(btcPrice, 0)}</div>
            </div>
            <div className="flex items-center text-slate-500 text-xl">vs</div>
            <div className="flex-1 bg-slate-700/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-400 mb-1">Breakeven</div>
              <div className={`text-xl font-bold ${
                btcPrice > data.breakevenPrice * 1.2 ? "text-green-400" :
                btcPrice > data.breakevenPrice ? "text-yellow-400" : "text-red-400"
              }`}>${fmt(data.breakevenPrice, 0)}</div>
            </div>
          </div>

          {/* Margin indicator */}
          {data.breakevenPrice > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Mining-Marge</span>
                <span className={btcPrice > data.breakevenPrice ? "text-green-400" : "text-red-400"}>
                  {btcPrice > data.breakevenPrice
                    ? `+${(((btcPrice - data.breakevenPrice) / data.breakevenPrice) * 100).toFixed(1)}% profitabel`
                    : `${(((btcPrice - data.breakevenPrice) / data.breakevenPrice) * 100).toFixed(1)}% unter Break-Even`}
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    btcPrice > data.breakevenPrice ? "bg-green-500" : "bg-red-500"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(5, (btcPrice / (data.breakevenPrice * 2)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/40 rounded-lg p-2">
              <div className="text-slate-400">Hashprice (USD)</div>
              <div className="text-white font-semibold">${hashpriceUSD.toFixed(4)}/TH/d</div>
            </div>
            <div className="bg-slate-700/40 rounded-lg p-2">
              <div className="text-slate-400">Netzwerk-Hashrate</div>
              <div className="text-white font-semibold">{data.currentHashrateEH.toFixed(0)} EH/s</div>
            </div>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <div>• Spot &gt; 1.2× Breakeven: Miner profitabel, Selling-Druck gering</div>
            <div>• Spot 1.0–1.2× Breakeven: Marginal profitabel, schwache Miner unter Druck</div>
            <div>• Spot &lt; Breakeven: Miner-Kapitulation wahrscheinlich</div>
          </div>
          <p className="text-xs text-slate-500">
            Formel: (Energiekosten/Tag) ÷ (TH/Netzwerk × 144 Blöcke × 3.125 BTC)
          </p>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="text-xs text-slate-500 text-right">
        Letzte Aktualisierung: {new Date(data.lastUpdated).toLocaleString("de-DE")} ·
        Quellen: mempool.space API (Hashrate, Difficulty) · Berechnet: Breakeven, MA30/60
      </div>
    </div>
  );
}
