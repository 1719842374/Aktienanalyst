/**
 * Sektion 14. Ruhezustand: nur gemessene DefiLlama-Karten.
 * Der violette KI-Chip ruft mit force denselben OpenRouter-Weg wie der
 * Researcher auf, nur fuer Krypto-Regulierungen und den Liquiditaetstracker.
 * Jeder Klick zeigt ein Analysefeld: Zusammenfassung, Modell, oder den Fehler.
 * Ohne OPENROUTER_API_KEY bleibt der Klick moeglich und zeigt den Fehler.
 */
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/SectionCard";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";

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
    mcapChange30dUsd: number | null;
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
  summary: string | null;
  error?: string;
  instruments: PolicyScanInstrument[];
  dropped: number;
  effects: {
    treasuryBuybackCapBn: number | null;
    treasuryDurationActive: boolean;
  };
  priced: {
    id: string;
    pricedInPct: number | null;
    halfLifeDays: number | null;
    residual: number | null;
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
        if (!cancelled) setError(err?.message || "Krypto-Liquiditätsdaten nicht verfügbar");
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

const OFFICE_LABEL: Record<string, string> = {
  treasury: "Treasury",
  central_bank: "Zentralbank",
  legislature: "Gesetzgeber",
  regulator: "Aufsicht",
};

const CHANNEL_LABEL: Record<string, string> = {
  cryptoLiquidity: "Krypto-Liquidität",
  tBillDemand: "T-Bill-Nachfrage",
  longYield: "lange Rendite",
  m2: "M2",
  duration: "Duration",
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
      const json = (await res.json().catch(() => ({}))) as PolicyScanResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const instruments = Array.isArray(json.instruments) ? json.instruments : [];
      setScan({ ...json, instruments, summary: json.summary ?? null, dropped: json.dropped ?? 0 });
      if (json.error && instruments.length === 0) setScanError(json.error);
    } catch (err: any) {
      setScan(null);
      setScanError(err?.message || "Krypto-Regulierungsanalyse nicht verfügbar");
    } finally {
      setScanning(false);
    }
  };

  const llmOn = data?.llmAvailable === true;
  const showAnalysis = scan != null && !scanError;

  const kiButton = (
    <button
      type="button"
      data-testid="button-policy-scan"
      disabled={scanning}
      onClick={() => runScan(true)}
      className="h-8 shrink-0 px-2.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1.5 border bg-violet-500/15 text-violet-400 border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-70"
      title={llmOn ? "Krypto-Regulierungen über OpenRouter abrufen" : "Startet den OpenRouter-Abruf. Fehlt der Schlüssel, erscheint der Fehler hier."}
    >
      {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      <span>KI</span>
      {(llmOn || scanning) && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
    </button>
  );

  return (
    <SectionCard number={14} title="Krypto-Liquidität" actions={kiButton}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Der KI-Abruf sucht nur Krypto-Regulierungen und liest den Liquiditätstracker.
          DeFi-TVL, die 30-Tage-Änderung, Stablecoin-Marktkapitalisierung, TGA, M2 und die
          lange Rendite bleiben gemessen. Das Modell schreibt diese Zahlen nicht um.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Lade Liquiditätstracker von DefiLlama…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/25 rounded-md p-3">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Liquiditätstracker nicht verfügbar</div>
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

            <div>
              <div className="text-xs font-medium mb-2">Liquiditätstracker</div>
              {data.defiTvl?.available && (
                <div className="grid grid-cols-2 gap-2.5 mb-2.5">
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
                <MiniCard
                  label="Stablecoin-Δ (30T)"
                  value={formatUsdCompact(data.tBillDemand?.mcapChange30dUsd ?? null)}
                  sub="DefiLlama, gemessen"
                />
              </div>
            </div>
          </>
        )}

        {scanning && (
          <div
            className="flex items-center gap-2 text-xs text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-md p-3"
            data-testid="text-policy-scan-loading"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            KI-Analyse läuft…
          </div>
        )}

        {scanError && !scanning && (
          <div
            className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-md p-3"
            data-testid="text-policy-scan-error"
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">KI-Analyse</div>
              <div className="mt-0.5">{scanError}</div>
            </div>
          </div>
        )}

        {!scanning && !scan && !scanError && (
          <div className="text-[11px] text-muted-foreground border border-dashed border-violet-500/30 rounded-md px-3 py-2">
            Noch keine KI-Analyse. Der violette Button startet den Abruf für Krypto-Regulierungen.
          </div>
        )}

        {showAnalysis && scan && (
          <div className="border-t border-border/60 pt-3 space-y-2" data-testid="panel-policy-analysis">
            <div className="text-xs font-medium">Krypto-Regulierungen</div>
            <div className="text-[10px] text-muted-foreground" data-testid="text-policy-scan-meta">
              {scan.modelUsed ?? "kein Modell"}
              {" · "}
              {scan.fromCache ? "Cache" : "frisch"}
              {" · "}
              verworfen {scan.dropped}
              {" · "}
              {scan.instruments.length} belegt
            </div>
            <p className="text-xs leading-relaxed" data-testid="text-policy-summary">
              {scan.summary?.trim()
                ? scan.summary
                : "Die Analyse ist gelaufen. Keine belegte Krypto-Regulierung wurde behalten."}
            </p>
            {scan.effects?.treasuryBuybackCapBn != null && (
              <div className="text-xs text-muted-foreground" data-testid="text-treasury-cap">
                Treasury-Cap {scan.effects.treasuryBuybackCapBn} Mrd.
                {scan.effects.treasuryDurationActive ? " · Duration an" : " · unter 4 Mrd."}
              </div>
            )}
            {scan.instruments.length === 0 && (
              <div className="text-[11px] text-muted-foreground" data-testid="text-policy-empty">
                Kein Instrument mit Quelle, https-Adresse und Datum.
              </div>
            )}
            {scan.instruments.length > 0 && (
              <div className="space-y-2" data-testid="list-policy-instruments">
                {scan.instruments.map(inst => {
                  const priced = scan.priced.find(p => p.id === inst.id);
                  const channels = Object.entries(inst.channels)
                    .map(([k, v]) => `${CHANNEL_LABEL[k] ?? k}: ${v}`)
                    .join(", ");
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
          </div>
        )}
      </div>
    </SectionCard>
  );
}
