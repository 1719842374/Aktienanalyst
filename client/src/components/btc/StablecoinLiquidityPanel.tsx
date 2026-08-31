/**
 * Sprint D4 — Stablecoin Liquidity Channel (additive neue Sektion im
 * BTC-Dashboard, siehe WORK_STABLECOIN_TBILL_GENIUS.md Abschnitt 3).
 *
 * Zeigt:
 *  - Stablecoin Total/USDT/USDC Market Cap (LIVE von DefiLlama)
 *  - Geschätzte T-Bill-Nachfrage (Rule-based Formel, klar gekennzeichnet)
 *  - GENIUS Act Impact Score (manuell gepflegte Policy-Konstante, klar gekennzeichnet)
 *
 * Daten: GET /api/analyze-btc/stablecoin-liquidity (server/stablecoin-liquidity.ts).
 * Bei API-Fehler zeigt die Sektion einen expliziten "nicht verfügbar"-Zustand
 * statt geschätzter/erratener Zahlen (Zahlen-Prinzip).
 *
 * Diese Komponente ist rein additiv: Sie ersetzt keine bestehende Section und
 * wird in BTCDashboard.tsx nur zusätzlich eingebunden.
 */
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/SectionCard";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Info, RefreshCw } from "lucide-react";

export interface StablecoinAggregateDto {
  symbol: string;
  name: string;
  circulatingUsd: number;
  circulatingPrevDayUsd: number | null;
  circulatingPrevWeekUsd: number | null;
  circulatingPrevMonthUsd: number | null;
}

export interface StablecoinLiquidityApiResponse {
  fetchedAt: string;
  stablecoins: {
    available: boolean;
    totalMarketCapUsd: number | null;
    totalMarketCapPrevMonthUsd: number | null;
    usdt: StablecoinAggregateDto | null;
    usdc: StablecoinAggregateDto | null;
    constituentCount: number | null;
    error?: string;
  };
  tBillDemand: {
    available: boolean;
    kennzeichnung: string;
    mcapChange30dUsd: number | null;
    dynamicMultiplier: number | null;
    estimatedTBillDemandUsd: number | null;
    note: string;
  };
  genius: {
    score: number;
    scoreMax: number;
    status: string;
    asOfDate: string;
    source: string;
    kennzeichnung: string;
  };
  policyConstants: {
    tetherTBillShare: number;
    usdcTBillShare: number;
    weightTether: number;
    weightCircle: number;
    asOfDate: string;
    source: string;
    kennzeichnung: string;
  };
  _servedFromDiskCacheAfterLiveFailure?: boolean;
  _liveFetchError?: string;
}

function formatUsdCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/v";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)} Bio.`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)} Mrd.`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)} Mio.`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/v";
  return `${(value * 100).toFixed(0)}%`;
}

function useStablecoinLiquidity() {
  const [dataState, setDataState] = useState<StablecoinLiquidityApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await apiRequest("GET", "/api/analyze-btc/stablecoin-liquidity", undefined, 20000);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as StablecoinLiquidityApiResponse;
        if (!cancelled) { setDataState(json); setError(null); }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Stablecoin-Liquiditätsdaten nicht verfügbar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  };

  useEffect(() => load(), []);

  return { data: dataState, loading, error, reload: load };
}

function MiniCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-mono font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RuleBasedBadge({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1.5 mt-2">
      <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
      <span>{text}</span>
    </div>
  );
}

export function StablecoinLiquidityPanel() {
  const { data, loading, error, reload } = useStablecoinLiquidity();

  return (
    <SectionCard number={14} title="Stablecoin Liquidity Channel (GENIUS Act)">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Stablecoin-Marktkapitalisierung als struktureller Treiber für die T-Bill-Nachfrage
          (Sprint D4). Live-Marktkapitalisierung von DefiLlama; T-Bill-Holding-Anteile und der
          GENIUS-Act-Score sind manuell gepflegte, klar gekennzeichnete Policy-Konstanten — keine
          Live-Messung.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Lade Stablecoin-Daten von DefiLlama…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/25 rounded-md p-3">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Stablecoin-Daten nicht verfügbar</div>
              <div className="text-muted-foreground mt-0.5">{error}</div>
              <button
                onClick={reload}
                className="mt-2 text-[11px] underline hover:no-underline text-foreground/80"
              >
                Erneut versuchen
              </button>
            </div>
          </div>
        )}

        {!loading && !error && data && !data.stablecoins.available && (
          <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/25 rounded-md p-3">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">DefiLlama-API aktuell nicht erreichbar</div>
              <div className="text-muted-foreground mt-0.5">
                {data.stablecoins.error || "Unbekannter Fehler"} — es werden bewusst keine geschätzten
                Zahlen angezeigt (Zahlen-Prinzip).
              </div>
            </div>
          </div>
        )}

        {!loading && !error && data && data.stablecoins.available && (
          <>
            {data._servedFromDiskCacheAfterLiveFailure && (
              <div className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1.5">
                Live-Abruf aktuell fehlgeschlagen ({data._liveFetchError || "unbekannt"}) — zeige letzten
                erfolgreichen Cache-Stand.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <MiniCard
                label="Stablecoin Total MCap"
                value={formatUsdCompact(data.stablecoins.totalMarketCapUsd)}
                sub={`${data.stablecoins.constituentCount ?? "?"} Coins (peggedUSD)`}
              />
              <MiniCard
                label="USDT (Tether)"
                value={formatUsdCompact(data.stablecoins.usdt?.circulatingUsd ?? null)}
                sub="DefiLlama, live"
              />
              <MiniCard
                label="USDC (Circle)"
                value={formatUsdCompact(data.stablecoins.usdc?.circulatingUsd ?? null)}
                sub="DefiLlama, live"
              />
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="text-xs font-medium mb-2">Geschätzte T-Bill-Nachfrage (30 Tage)</div>
              {data.tBillDemand.available ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <MiniCard
                    label="MCap-Δ (30T)"
                    value={formatUsdCompact(data.tBillDemand.mcapChange30dUsd)}
                  />
                  <MiniCard
                    label="Multiplikator"
                    value={data.tBillDemand.dynamicMultiplier !== null ? data.tBillDemand.dynamicMultiplier.toFixed(2) : "n/v"}
                    sub="gewichtet, Rule-based"
                  />
                  <MiniCard
                    label="Gesch. T-Bill-Nachfrage"
                    value={formatUsdCompact(data.tBillDemand.estimatedTBillDemandUsd)}
                  />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  Nicht verfügbar: {data.tBillDemand.note}
                </div>
              )}
              <RuleBasedBadge text={`${data.tBillDemand.kennzeichnung}. ${data.tBillDemand.note}`} />
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="text-xs font-medium mb-2">GENIUS Act Impact Score</div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-mono font-bold tabular-nums">
                  {data.genius.score.toFixed(1)}
                  <span className="text-sm text-muted-foreground"> / {data.genius.scoreMax.toFixed(1)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{data.genius.status}</div>
              </div>
              <RuleBasedBadge
                text={`${data.genius.kennzeichnung}. Stand ${data.genius.asOfDate}. Quelle: ${data.genius.source}.`}
              />
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="text-xs font-medium mb-2">T-Bill-Holding-Anteile (Policy-Konstanten)</div>
              <div className="grid grid-cols-2 gap-2.5">
                <MiniCard label="Tether (USDT)" value={formatPct(data.policyConstants.tetherTBillShare)} sub="Rule-based" />
                <MiniCard label="Circle (USDC)" value={formatPct(data.policyConstants.usdcTBillShare)} sub="Rule-based" />
              </div>
              <RuleBasedBadge
                text={`Rule-based Schätzung, Stand ${data.policyConstants.asOfDate}, Quelle: ${data.policyConstants.source}. Keine Live-Messung — Tether/Circle veröffentlichen keine strukturierte Live-API für die Reserve-Zusammensetzung.`}
              />
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
