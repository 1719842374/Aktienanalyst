/**
 * Sektion 14. DefiLlama-Karten bleiben. Der Politik-Button nutzt denselben
 * JSON-Call wie der Researcher, ohne dessen Textbausteine. Ohne
 * OPENROUTER_API_KEY bleibt der Button aus.
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
  llmAvailable?: boolean;
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
  statute: {
    score: number | null;
    scoreMax: number;
    status: string;
    kennzeichnung: string;
  };
  reserveEstimates: {
    tetherTBillShare: number;
    usdcTBillShare: number;
    asOfDate: string;
    source: string;
    kennzeichnung: string;
    usedInDemand: false;
  };
  defiTvl?: {
    available: boolean;
    tvlUsd: number | null;
    change30dUsd: number | null;
    error?: string;
  };
  _servedFromDiskCacheAfterLiveFailure?: boolean;
  _liveFetchError?: string;
}

interface PolicyScanInstrument {
  id: string;
  office: string;
  instrumentType: string;
  status: string;
  officeHolder?: string;
  channels: Record<string, string>;
  evidence: { source: string; url: string; date: string }[];
}

interface PolicyScanResponse {
  llmAvailable: boolean;
  fromCache: boolean;
  modelUsed: string | null;
  error?: string;
  instruments: PolicyScanInstrument[];
  dropped: number;
  effects: {
    treasuryBuybackCapBn: number | null;
    treasuryDurationActive: boolean;
    statuteScore: number | null;
    statuteResidual: number | null;
    statuteContribution: number;
    reserveShares: { tether: number | null; usdc: number | null; evidenced: boolean };
    tBillDemandUsd: number | null;
  };
  priced: {
    id: string;
    pricedInPct: number | null;
    halfLifeDays: number | null;
    residual: number | null;
    clockStart: string | null;
  }[];
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

const OFFICE_LABEL: Record<string, string> = {
  treasury: "Treasury",
  central_bank: "Zentralbank",
  legislature: "Gesetzgeber",
  regulator: "Aufsicht",
};

export function StablecoinLiquidityPanel() {
  const { data, loading, error, reload } = useStablecoinLiquidity();
  const [scan, setScan] = useState<PolicyScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const runScan = async (force: boolean) => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await apiRequest("POST", "/api/analyze-btc/policy-scan", { jurisdiction: "US", force }, 120000);
      const json = (await res.json().catch(() => ({}))) as PolicyScanResponse;
      if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
      setScan(json);
      if (json.error && json.instruments.length === 0) setScanError(json.error);
    } catch (err: any) {
      setScanError(err?.message || "Politik-Scan nicht verfügbar");
    } finally {
      setScanning(false);
    }
  };

  const llmOn = data?.llmAvailable === true;
  const demandUsd = scan?.effects.tBillDemandUsd ?? null;
  const statuteScore = scan?.effects.statuteScore ?? data?.statute.score ?? null;
  const statuteResidual = scan?.effects.statuteResidual ?? null;

  const kiButton = (
    <button
      type="button"
      data-testid="button-policy-scan"
      disabled={scanning}
      onClick={() => runScan(true)}
      className="h-8 shrink-0 px-2 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 border bg-violet-500/15 text-violet-400 border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-70"
      title={llmOn ? "Politikinstrumente mit Beleg abrufen" : "Nutzt OPENROUTER_API_KEY auf dem Server"}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1h-4v-1c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"/>
        <path d="M10 10.5v2.5h4v-2.5"/>
        <path d="M10 15h4"/>
        <path d="M11 15v2"/>
        <path d="M13 15v2"/>
      </svg>
      <span>KI</span>
      {(llmOn || scanning) && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
    </button>
  );

  return (
    <SectionCard number={14} title="Krypto-Liquidität" actions={kiButton}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Der KI-Abruf sucht Politik, die Liquidität in Krypto ändert. On-Chain-TVL und
          Stablecoin-Marktkapitalisierung kommen gemessen von DefiLlama. Das Modell schreibt
          diese Zahlen nicht um.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Lade Krypto-Liquidität von DefiLlama…
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
                Zahlen angezeigt.
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

            {data.defiTvl?.available && (
              <div className="grid grid-cols-2 gap-2.5">
                <MiniCard label="DeFi-TVL" value={formatUsdCompact(data.defiTvl.tvlUsd)} sub="DefiLlama, alle Ketten" />
                <MiniCard label="TVL-Δ (30T)" value={formatUsdCompact(data.defiTvl.change30dUsd)} sub="gemessen" />
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
              <div className="text-xs font-medium mb-2">T-Bill-Nachfrage (30 Tage)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <MiniCard
                  label="MCap-Δ (30T)"
                  value={formatUsdCompact(data.tBillDemand.mcapChange30dUsd)}
                  sub="DefiLlama, gemessen"
                />
                <MiniCard
                  label="Gesch. T-Bill-Nachfrage"
                  value={formatUsdCompact(demandUsd)}
                  sub={demandUsd == null ? "wartet auf Beleg" : "aus belegten Anteilen"}
                />
              </div>
              <RuleBasedBadge text={`${data.tBillDemand.kennzeichnung} ${data.tBillDemand.note}`} />
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="text-xs font-medium mb-2">Gesetzesbeitrag</div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-mono font-bold tabular-nums" data-testid="text-statute-score">
                  {statuteScore == null ? "—" : statuteScore.toFixed(1)}
                  <span className="text-sm text-muted-foreground"> / {data.statute.scoreMax.toFixed(1)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {scan
                    ? `Beitrag ${scan.effects.statuteContribution.toFixed(3)}${statuteResidual == null ? "" : ` · Rest ${statuteResidual.toFixed(3)}`}`
                    : data.statute.status}
                </div>
              </div>
              <RuleBasedBadge text={data.statute.kennzeichnung} />
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="text-xs font-medium mb-2">Reserveanteile (Schätzung, nicht im Bedarf)</div>
              <div className="grid grid-cols-2 gap-2.5">
                <MiniCard label="Tether (USDT)" value={formatPct(data.reserveEstimates.tetherTBillShare)} sub={`Schätzung ${data.reserveEstimates.asOfDate}`} />
                <MiniCard label="Circle (USDC)" value={formatPct(data.reserveEstimates.usdcTBillShare)} sub={`Schätzung ${data.reserveEstimates.asOfDate}`} />
              </div>
              <RuleBasedBadge
                text={`${data.reserveEstimates.kennzeichnung} Stand ${data.reserveEstimates.asOfDate}. Quelle: ${data.reserveEstimates.source}.`}
              />
            </div>

            {scanError && (
              <div className="text-xs text-amber-600 dark:text-amber-400">{scanError}</div>
            )}

            {scan && scan.effects.treasuryBuybackCapBn != null && (
              <div className="text-xs text-muted-foreground" data-testid="text-treasury-cap">
                Treasury-Cap {scan.effects.treasuryBuybackCapBn} Mrd.
                {scan.effects.treasuryDurationActive ? " · Duration an" : " · unter 4 Mrd."}
              </div>
            )}

            {scan && scan.instruments.length > 0 && (
              <div className="border-t border-border/60 pt-3 space-y-2" data-testid="list-policy-instruments">
                <div className="text-xs font-medium">Instrumente{scan.fromCache ? " · Cache" : ""}{scan.modelUsed ? ` · ${scan.modelUsed}` : ""}</div>
                {scan.instruments.map(inst => {
                  const priced = scan.priced.find(p => p.id === inst.id);
                  const channels = Object.entries(inst.channels).map(([k, v]) => `${k}: ${v}`).join(", ");
                  return (
                    <div key={inst.id} className="rounded-md border border-border bg-muted/20 p-3 text-[11px] space-y-1">
                      <div className="font-medium">
                        {OFFICE_LABEL[inst.office] ?? inst.office} · {inst.instrumentType} · {inst.status}
                        {inst.officeHolder ? ` · ${inst.officeHolder}` : ""}
                      </div>
                      {channels && <div className="text-muted-foreground">{channels}</div>}
                      <div className="text-muted-foreground">
                        Eingepreist {priced?.pricedInPct == null ? "—" : `${priced.pricedInPct}%`}
                        {" · "}Halbwertzeit {priced?.halfLifeDays == null ? "—" : `${priced.halfLifeDays} Tage`}
                        {" · "}Rest {priced?.residual == null ? "—" : priced.residual.toFixed(3)}
                      </div>
                      {inst.evidence[0] && (
                        <a className="underline text-foreground/80" href={inst.evidence[0].url} target="_blank" rel="noreferrer">
                          {inst.evidence[0].source} · {inst.evidence[0].date}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
