/**
 * Section 13 — Miner-Zone: Profitabilität & Kapitulation
 *
 * Native Umsetzung des Konzepts aus WORK_BTC_MINER.md (§1–§4) im Stil der
 * bestehenden BTC-Dashboard-Sektionen (SectionCard + Recharts, analog
 * Section10TechnicalChart). Rechenlogik: client/src/lib/btc/minerMetrics.ts.
 *
 * Daten: POST /api/btc-miner (server/btc-miner.ts, mempool.space) + BTC-Preis-
 * historie aus der bestehenden BTC-Pipeline (chartData) — kein Perplexity-
 * Finance-Connector. Lazy: fetcht selbstständig beim Mount (1h-Cache im Backend).
 */
import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/SectionCard";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import type { BTCAnalysis } from "@/lib/btcAnalysis";
import {
  buildMinerZoneSeries, buildZoneSegments, classifyMinerZone,
  calcBreakevenPrice, calcHashpriceUsd, difficultyZoneFromCompression,
  DEFAULT_FLEET, ZONE_FILL, ZONE_LABEL,
  type FleetAssumptions, type MinerSeriesPoint, type MinerZoneResult,
} from "@/lib/btc/minerMetrics";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Legend, Scatter,
} from "recharts";
import { RefreshCw, AlertTriangle } from "lucide-react";

// ─── Backend-Antwort (server/btc-miner.ts MinerData, relevante Felder) ────────
interface MinerApiData {
  hashrateHistory: { date: string; hashrateEH: number }[];
  ma30: (number | null)[];
  ma60: (number | null)[];
  dates: string[];
  inCapitulation: boolean;
  crossoverSignal: boolean;
  currentHashrateEH: number;
  breakevenPrice: number;
  puellMultiple: number | null;
  puellHistory: { date: string; value: number }[];
  difficultyRibbonCompression: number;
  lastUpdated: string;
}

// ─── Lokale Style-Helfer (analog BTCDashboard-Pattern) ────────────────────────
const tooltipStyle = { fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 };

function MinerMetricCard({ label, value, subValue, color }: {
  label: string; value: string; subValue?: string; color?: string;
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${color || "text-foreground"}`}>{value}</div>
      {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}

const ZONE_BADGE_CLASS: Record<string, string> = {
  capitulation: "bg-red-500/15 text-red-500 border-red-500/30",
  transition: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  profitable: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  euphoria: "bg-purple-500/15 text-purple-500 border-purple-500/30",
};

const FLAG_TEXT: Record<string, string> = {
  SPOT_BELOW_BREAKEVEN: "Spot unter Miner-Breakeven — Mining unprofitabel",
  SPOT_ABOVE_BREAKEVEN: "Spot deutlich über Breakeven — Miner profitabel",
  PUELL_CAPITULATION: "Puell < 0.5 — historische Kapitulationszone",
  PUELL_EUPHORIA: "Puell > 4.0 — überhitzte Emissionszone",
  HASH_RIBBON_CAPITULATION: "Hash Ribbon: MA30 < MA60, beide fallend — Kapitulation aktiv",
  HASH_RIBBON_BUY: "Hash Ribbon Buy — MA30 kreuzte MA60 von unten (Golden Cross)",
  DIFFICULTY_COMPRESSION: "Difficulty Ribbon komprimiert — ineffiziente Miner geben auf",
  MINER_DISTRIBUTION: "MPI hoch — Miner verkaufen (Zwangsverkäufe)",
  MINER_ACCUMULATION: "MPI niedrig — Miner akkumulieren",
};

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
export function Section13Miner({ data }: { data: BTCAnalysis }) {
  const [minerData, setMinerData] = useState<MinerApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<FleetAssumptions>(DEFAULT_FLEET);

  // Lazy-Fetch beim Mount — Preishistorie mitschicken für Puell (365d-Warm-up nötig)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const history = data.chartData?.prices5Y?.length
          ? data.chartData.prices5Y
          : data.chartData?.prices3Y ?? [];
        const res = await apiRequest("POST", "/api/btc-miner", {
          btcPriceHistory: history,
          btcPrice: data.btcPrice,
        }, 45000);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as MinerApiData;
        if (!cancelled) { setMinerData(json); setError(null); }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Miner-Daten nicht verfügbar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [data.btcPrice]);

  // ── Serien + Zonen-Klassifikation (reagiert auf Fleet-Annahmen) ──
  const series: MinerSeriesPoint[] = useMemo(() => {
    if (!minerData) return [];
    const priceByDate = new Map<string, number>();
    const priceSrc = data.chartData?.prices5Y?.length
      ? data.chartData.prices5Y
      : data.chartData?.prices3Y ?? [];
    for (const p of priceSrc) priceByDate.set(p.date, p.price);
    const puellByDate = new Map<string, number>();
    for (const p of minerData.puellHistory ?? []) puellByDate.set(p.date, p.value);
    return buildMinerZoneSeries({
      dates: minerData.dates,
      hashrateEH: minerData.hashrateHistory.map(h => h.hashrateEH),
      ma30: minerData.ma30,
      ma60: minerData.ma60,
      priceByDate,
      puellByDate,
      assumptions,
    });
  }, [minerData, data.chartData, assumptions]);

  const zoneSegments = useMemo(() => buildZoneSegments(series), [series]);

  // ── Aktuelle Zonen-Klassifikation (voller §3-Input inkl. Difficulty) ──
  const latest: MinerZoneResult | null = useMemo(() => {
    if (!minerData || series.length === 0) return null;
    const breakevenNow = calcBreakevenPrice({
      hashrateEHs: minerData.currentHashrateEH, assumptions,
    });
    const lastSignal = [...series].reverse().find(p => p.ribbonSignal !== 'neutral');
    const ribbonNow = minerData.crossoverSignal ? 'buy'
      : minerData.inCapitulation ? 'capitulation'
      : (lastSignal && series.indexOf(lastSignal) >= series.length - 7 ? lastSignal.ribbonSignal : 'neutral');
    return classifyMinerZone({
      spotPrice: data.btcPrice,
      breakeven: breakevenNow,
      puell: minerData.puellMultiple,
      hashRibbonSignal: ribbonNow,
      difficultyCompression: difficultyZoneFromCompression(minerData.difficultyRibbonCompression),
      mpiZone: 'neutral',
    });
  }, [minerData, series, assumptions, data.btcPrice]);

  const breakevenNow = minerData
    ? calcBreakevenPrice({ hashrateEHs: minerData.currentHashrateEH, assumptions })
    : 0;
  const hashpriceNow = minerData
    ? calcHashpriceUsd({ btcPrice: data.btcPrice, hashrateEHs: minerData.currentHashrateEH })
    : 0;

  // ── Render ──
  if (loading) {
    return (
      <SectionCard number={13} title="Miner-Zone: Profitabilität & Kapitulation">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Lade Miner-Daten von mempool.space …
        </div>
      </SectionCard>
    );
  }

  if (error || !minerData || !latest) {
    return (
      <SectionCard number={13} title="Miner-Zone: Profitabilität & Kapitulation">
        <div className="flex items-center gap-2 text-sm text-amber-500 py-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Miner-Daten aktuell nicht verfügbar{error ? ` — ${error}` : ""}. Quelle: mempool.space.
        </div>
      </SectionCard>
    );
  }

  const ribbonStatus = minerData.crossoverSignal
    ? { text: "BUY (Golden Cross)", color: "text-emerald-500" }
    : minerData.inCapitulation
      ? { text: "Kapitulation", color: "text-red-500" }
      : { text: "Expansion", color: "text-emerald-500" };

  return (
    <SectionCard number={13} title="Miner-Zone: Profitabilität & Kapitulation">
      {/* Zone-Badge + Score */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-bold border ${ZONE_BADGE_CLASS[latest.zone]}`}>
          {ZONE_LABEL[latest.zone]}
        </span>
        <span className="text-sm text-muted-foreground">
          Kapitulations-Score: <span className="font-mono font-bold text-foreground">{latest.score}/100</span>
          <span className="text-xs ml-1">(0 = max. Kapitulation, 100 = max. Euphorie)</span>
        </span>
      </div>

      {/* Metrik-Karten */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MinerMetricCard
          label="Puell Multiple"
          value={minerData.puellMultiple != null ? minerData.puellMultiple.toFixed(2) : "—"}
          subValue="< 0.5 Kapitulation · > 4.0 Euphorie"
          color={minerData.puellMultiple != null
            ? (minerData.puellMultiple < 0.5 ? "text-red-500" : minerData.puellMultiple > 4 ? "text-purple-500" : undefined)
            : undefined}
        />
        <MinerMetricCard
          label="Miner-Breakeven"
          value={breakevenNow > 0 ? formatCurrency(breakevenNow) : "—"}
          subValue={`Spot ${breakevenNow > 0 ? (data.btcPrice / breakevenNow).toFixed(1) : "—"}× Breakeven`}
          color={breakevenNow > 0 && data.btcPrice < breakevenNow ? "text-red-500" : undefined}
        />
        <MinerMetricCard
          label="Hashprice"
          value={hashpriceNow > 0 ? `$${hashpriceNow.toFixed(4)}` : "—"}
          subValue="USD / TH/s / Tag"
        />
        <MinerMetricCard
          label="Hash Ribbon"
          value={ribbonStatus.text}
          subValue={`Hashrate ${minerData.currentHashrateEH.toFixed(0)} EH/s`}
          color={ribbonStatus.color}
        />
      </div>

      {/* Fleet-Annahmen (konfigurierbar, WORK_BTC_MINER §7) */}
      <div className="flex flex-wrap items-end gap-4 bg-muted/20 border border-border rounded-lg p-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
            Strompreis $/kWh
          </label>
          <input
            type="number" step="0.01" min="0.01" max="0.30"
            value={assumptions.electricityUsdPerKwh}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) setAssumptions(a => ({ ...a, electricityUsdPerKwh: v }));
            }}
            className="w-24 bg-background border border-border rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
            Flotten-Effizienz J/TH
          </label>
          <input
            type="number" step="1" min="10" max="120"
            value={assumptions.efficiencyJPerTh}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) setAssumptions(a => ({ ...a, efficiencyJPerTh: v }));
            }}
            className="w-24 bg-background border border-border rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <div className="text-xs text-muted-foreground pb-1">
          Default: S21/S19-XP-Klasse (21.5 J/TH) · institutionell (0.05 $/kWh) · +15 % Opex
        </div>
      </div>

      {/* Panel 1: Spot vs Breakeven mit Zonen-Bändern */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1">
          Spot vs. Miner-Breakeven — Zonen: 🔴 Kapitulation · 🟡 Übergang · 🟢 Profitabel
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} />
            <YAxis
              tick={{ fontSize: 10 }} width={70}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: string) =>
                [typeof value === 'number' ? formatCurrency(value) : value, name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {zoneSegments.map((seg, idx) => (
              <ReferenceArea key={idx} x1={seg.x1} x2={seg.x2} fill={ZONE_FILL[seg.zone]} strokeOpacity={0} />
            ))}
            <Line type="monotone" dataKey="spot" name="BTC Spot ($)" stroke="#3B82F6" dot={false} strokeWidth={1.8} connectNulls />
            <Line type="monotone" dataKey="breakeven" name="Miner Breakeven ($)" stroke="#F97316" dot={false} strokeWidth={1.5} strokeDasharray="6 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Panel 2: Hash Ribbons */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1">
          Hash Ribbons (Capriole) — ▲ = Buy-Signal (MA30 kreuzt MA60 von unten)
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} />
            <YAxis tick={{ fontSize: 10 }} width={55} domain={['auto', 'auto']}
              tickFormatter={(v: number) => `${v.toFixed(0)}`} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: string) =>
                [typeof value === 'number' ? `${value.toFixed(1)} EH/s` : value, name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="hashrate" name="Hashrate (EH/s)" stroke="#64748B" dot={false} strokeWidth={1} opacity={0.6} />
            <Line type="monotone" dataKey="ma30" name="MA30" stroke="#22C55E" dot={false} strokeWidth={1.8} connectNulls />
            <Line type="monotone" dataKey="ma60" name="MA60" stroke="#EF4444" dot={false} strokeWidth={1.8} connectNulls />
            {/* buyMarker ist Teil des gemeinsamen Datensatzes — ein separater data-Prop
                würde die Kategorie-X-Achse des ComposedChart überschreiben und die
                Linien unsichtbar machen (im Playwright-Test verifiziert). */}
            <Scatter dataKey="buyMarker" name="Hash Ribbon Buy" fill="#22C55E" shape="triangle" legendType="triangle" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Panel 3: Puell Multiple */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1">
          Puell Multiple — Tagesemission (USD) / MA365
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} />
            <YAxis tick={{ fontSize: 10 }} width={45} domain={[0, 'auto']} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: string) =>
                [typeof value === 'number' ? value.toFixed(3) : value, name]}
            />
            <ReferenceLine y={0.5} stroke="#EF4444" strokeDasharray="4 3"
              label={{ value: "Kapitulation 0.5", fontSize: 10, fill: "#EF4444", position: "insideBottomLeft" }} />
            <ReferenceLine y={4.0} stroke="#F59E0B" strokeDasharray="4 3"
              label={{ value: "Euphorie 4.0", fontSize: 10, fill: "#F59E0B", position: "insideTopLeft" }} />
            <Line type="monotone" dataKey="puell" name="Puell Multiple" stroke="#A855F7" dot={false} strokeWidth={1.8} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Aktive Flags */}
      {latest.flags.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">Aktive Signale</div>
          <ul className="space-y-1">
            {latest.flags.map(f => (
              <li key={f} className="text-xs text-foreground flex items-start gap-2">
                <span className="text-muted-foreground mt-0.5">•</span>
                <span><span className="font-mono text-[10px] text-muted-foreground">{f}</span> — {FLAG_TEXT[f] ?? f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Zyklischer Ablauf (WORK_BTC_MINER §6) + Datenhinweise */}
      <div className="text-xs text-muted-foreground bg-muted/20 border border-border rounded-lg p-3 space-y-1">
        <div className="font-semibold text-foreground">Leselogik (Halving-Zyklus)</div>
        <div>
          Halving → Block-Reward ÷2 → Hashprice bricht ein → Spot fällt unter Breakeven + Puell &lt; 0.5 +
          MA30 &lt; MA60 = <span className="text-red-500 font-medium">Kapitulationszone</span> → schwache Miner offline →
          Difficulty sinkt → Breakeven-Linie folgt nach unten → MA30 kreuzt MA60 von unten =
          <span className="text-emerald-500 font-medium"> Hash Ribbon Buy</span> — Bärenmarkt-Tief historisch oft nahe.
        </div>
        <div className="pt-1">
          Quellen: Hashrate/Difficulty mempool.space · Preis: bestehende BTC-Pipeline (Blockchain.com) ·
          MPI (Miner-Netflows) nicht verfügbar — erfordert CryptoQuant/Glassnode-API (geht neutral in den Score ein).
          Stand: {new Date(minerData.lastUpdated).toLocaleString("de-DE")}
        </div>
      </div>
    </SectionCard>
  );
}
