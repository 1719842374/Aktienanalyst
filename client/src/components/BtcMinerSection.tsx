/**
 * BtcMinerSection.tsx
 *
 * Section 13 für BTCDashboard: BTC-Miner-Dashboard
 *
 * Zeigt für die Top-Miner (MARA, CLSK, RIOT, IREN, BTBT, HUT, BITF, CIFR)
 * folgende Kennzahlen an, sofern vom Server geliefert:
 *   - Aktienkurs + 24h-Änderung
 *   - Hash Rate (EH/s)
 *   - BTC Holdings
 *   - Produktionskosten pro BTC (Cost of Mining)
 *   - EV/Hashrate-Multiplikator
 *   - Relative Stärke vs. BTC (30d)
 *
 * Die Daten kommen aus BTCAnalysis.minerData (optional), das der Server
 * via /api/btc-miner befüllt und in die BTC-Analyse einbettet.
 * Ist minerData leer oder undefined, zeigt die Section einen Lade-Hinweis.
 */

import { SectionCard } from "@/components/SectionCard";
import { TrendingUp, TrendingDown, Pickaxe } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MinerDataPoint {
  ticker: string;
  name: string;
  price: number;
  change24h: number;          // percent
  hashRateEH: number | null;  // EH/s
  btcHoldings: number | null;
  costPerBTC: number | null;  // USD
  evHashrate: number | null;  // M USD / EH
  relStrength30d: number | null; // percent vs BTC
}

interface BtcMinerSectionProps {
  miners: MinerDataPoint[] | undefined | null;
  btcPrice: number;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function fmt(n: number | null, prefix = "", suffix = "", decimals = 0): string {
  if (n === null || n === undefined || isNaN(n)) return "–";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: decimals })}${suffix}`;
}

function ChangeChip({ value }: { value: number | null }) {
  if (value === null || value === undefined || isNaN(value)) {
    return <span className="text-muted-foreground text-[10px]">–</span>;
  }
  const pos = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold ${
        pos ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {pos ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {pos ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

// Colour coding for cost-per-BTC vs. BTC price
function costColor(cost: number | null, btcPrice: number): string {
  if (cost === null) return "text-muted-foreground";
  const ratio = cost / btcPrice;
  if (ratio > 0.9) return "text-red-400";
  if (ratio > 0.7) return "text-amber-400";
  return "text-emerald-400";
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BtcMinerSection({ miners, btcPrice }: BtcMinerSectionProps) {
  if (!miners || miners.length === 0) {
    return (
      <SectionCard number={13} title="BTC-Miner Dashboard">
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-xs">
          <Pickaxe className="w-4 h-4 animate-pulse" />
          <span>Miner-Daten werden geladen…</span>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard number={13} title="BTC-Miner Dashboard">
      <div className="space-y-4">
        {/* Legende */}
        <div className="text-[10px] text-muted-foreground bg-muted/20 rounded p-2 border border-border leading-relaxed">
          <span className="font-semibold text-foreground">Kennzahlen:</span>{" "}
          Kurs &amp; 24h-Änderung aus Marktdaten · Hash Rate in EH/s · BTC Holdings (Bilanz) ·
          Produktionskosten/BTC (Cost of Mining) ·{" "}
          <span className="text-amber-400">EV/Hashrate</span> in Mio. USD pro EH/s ·
          Relative Stärke vs. BTC (30d, Outperformance = grün).
        </div>

        {/* Desktop table */}
        <div className="overflow-x-auto hidden sm:block">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-2 font-medium">Ticker</th>
                <th className="text-right py-2 px-2 font-medium">Kurs</th>
                <th className="text-right py-2 px-2 font-medium">24h</th>
                <th className="text-right py-2 px-2 font-medium">Hash Rate</th>
                <th className="text-right py-2 px-2 font-medium">BTC Held</th>
                <th className="text-right py-2 px-2 font-medium">Cost/BTC</th>
                <th className="text-right py-2 px-2 font-medium">EV/EH</th>
                <th className="text-right py-2 px-2 font-medium">vs. BTC 30d</th>
              </tr>
            </thead>
            <tbody>
              {miners.map((m) => (
                <tr key={m.ticker} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="py-2 px-2">
                    <div className="font-bold text-foreground">{m.ticker}</div>
                    <div className="text-[9px] text-muted-foreground">{m.name}</div>
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {fmt(m.price, "$", "", 2)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <ChangeChip value={m.change24h} />
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-blue-400">
                    {fmt(m.hashRateEH, "", " EH/s", 1)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-amber-400">
                    {fmt(m.btcHoldings, "₿ ", "", 0)}
                  </td>
                  <td className={`py-2 px-2 text-right font-mono tabular-nums font-semibold ${costColor(m.costPerBTC, btcPrice)}`}>
                    {fmt(m.costPerBTC, "$", "", 0)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-purple-400">
                    {fmt(m.evHashrate, "$", "M", 1)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <ChangeChip value={m.relStrength30d} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden grid grid-cols-1 gap-3">
          {miners.map((m) => (
            <div key={m.ticker} className="bg-muted/20 border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm text-foreground">{m.ticker}</span>
                  <span className="text-[10px] text-muted-foreground ml-1.5">{m.name}</span>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold tabular-nums text-sm">{fmt(m.price, "$", "", 2)}</div>
                  <ChangeChip value={m.change24h} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-muted/30 rounded p-1.5">
                  <div className="text-muted-foreground">Hash Rate</div>
                  <div className="font-mono font-semibold text-blue-400">{fmt(m.hashRateEH, "", " EH/s", 1)}</div>
                </div>
                <div className="bg-muted/30 rounded p-1.5">
                  <div className="text-muted-foreground">BTC Holdings</div>
                  <div className="font-mono font-semibold text-amber-400">{fmt(m.btcHoldings, "₿ ", "", 0)}</div>
                </div>
                <div className="bg-muted/30 rounded p-1.5">
                  <div className="text-muted-foreground">Cost/BTC</div>
                  <div className={`font-mono font-semibold ${costColor(m.costPerBTC, btcPrice)}`}>
                    {fmt(m.costPerBTC, "$", "", 0)}
                  </div>
                </div>
                <div className="bg-muted/30 rounded p-1.5">
                  <div className="text-muted-foreground">EV/EH</div>
                  <div className="font-mono font-semibold text-purple-400">{fmt(m.evHashrate, "$", "M", 1)}</div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">vs. BTC 30d:</span>
                <ChangeChip value={m.relStrength30d} />
              </div>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="text-[9px] text-muted-foreground bg-muted/10 border border-border/40 rounded p-2 leading-relaxed">
          <span className="font-semibold">Hinweis:</span> Börsenkurse sind Näherungswerte (Yahoo Finance / FMP).
          Hash Rate, BTC Holdings und Produktionskosten basieren auf den zuletzt veröffentlichten
          Quartalszahlen der Unternehmen und können von der aktuellen Realität abweichen.
          Kein Anlageberatung.
        </div>
      </div>
    </SectionCard>
  );
}
