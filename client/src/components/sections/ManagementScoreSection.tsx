/**
 * ManagementScoreSection.tsx
 *
 * Management-Execution-Score (1-10) — Auftrag 05.08.2026.
 * Lazy-Load-Panel analog zum bestehenden Regulatory-Exposure-Muster in
 * PestelSection.tsx: eigener KI-Button, eigener Request, kein automatischer
 * Aufruf bei jedem /api/analyze (spart teure Executive-Comp/Insider-Trading/
 * LLM-Calls).
 *
 * Score_1-10 = 10 × (0.30·S_Delivery + 0.25·S_Segment + 0.20·S_Capital
 *              + 0.15·S_Credibility + 0.10·S_QualNews)
 */
import { useState } from "react";
import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Info } from "lucide-react";

interface Props { data: StockAnalysis }

interface SubScoreResult {
  score: number;
  flags: string[];
  [key: string]: any;
}

interface NewsAdjustment {
  type: string;
  delta: number;
  rationale: string;
  sourceUrl?: string | null;
}

interface ManagementScoreBreakdown {
  score1to10: number;
  delivery: SubScoreResult;
  segment: SubScoreResult & { deltaSharePp: number | null; growthGapPp: number | null };
  capital: SubScoreResult;
  credibility: SubScoreResult;
  qualNews: SubScoreResult & { qualBase: number; totalAdjustment: number; adjustments: NewsAdjustment[] };
  allFlags: string[];
}

interface ManagementScoreResult {
  breakdown: ManagementScoreBreakdown;
  dataAsOf: {
    segmentFiscalYear: string | null;
    roicFiscalYear: string | null;
    compensationYear: number | null;
    insiderTradingWindowDays: number;
    generatedAt: string;
  };
  llmModelUsed: string | null;
  deliveryDataQuality: {
    availableInputs: number;
    totalInputs: number;
    isBelastbar: boolean;
    warning: string | null;
  };
}

const BAUSTEINE: { key: keyof ManagementScoreBreakdown; label: string; weight: string; frage: string }[] = [
  { key: "delivery", label: "Delivery", weight: "30%", frage: "Werden die operativen Ziele geliefert?" },
  { key: "segment", label: "Segment-Shift", weight: "25%", frage: "Materialisiert sich das neue Geschäftsmodell?" },
  { key: "capital", label: "Kapitalallokation", weight: "20%", frage: "Wird Kapital effizient eingesetzt?" },
  { key: "credibility", label: "Glaubwürdigkeit", weight: "15%", frage: "Sind die Zahlen cash- und bilanzgestützt?" },
  { key: "qualNews", label: "Qual + News", weight: "10%", frage: "Governance-/Vergütungs-Warnsignale?" },
];

function scoreColor(score01: number): string {
  if (score01 >= 0.75) return "text-emerald-400";
  if (score01 >= 0.45) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score01: number): string {
  if (score01 >= 0.75) return "bg-emerald-500/10 border-emerald-500/20";
  if (score01 >= 0.45) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function ScoreAmpel({ score1to10 }: { score1to10: number }) {
  const pct = score1to10 / 10;
  const color = scoreColor(pct);
  const label = score1to10 >= 8 ? "Starke Execution" : score1to10 >= 5.5 ? "Solide, mit Fragezeichen" : score1to10 >= 3.5 ? "Schwache Delivery / Warnsignale" : "Klare Underperformance";
  return (
    <div className={`rounded-lg p-4 border ${scoreBg(pct)} flex items-center gap-4`}>
      <div className={`text-4xl font-bold font-mono tabular-nums ${color}`}>{score1to10.toFixed(1)}</div>
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Management-Execution-Score / 10</div>
        <div className={`text-sm font-semibold ${color}`}>{label}</div>
      </div>
    </div>
  );
}

function SubScoreBar({ label, weight, score }: { label: string; weight: string; score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground/80">{label} <span className="text-muted-foreground">({weight})</span></span>
        <span className={`font-mono tabular-nums font-semibold ${scoreColor(score)}`}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${score >= 0.75 ? "bg-emerald-500" : score >= 0.45 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DeltaBadge({ label, value, suffix = "pp" }: { label: string; value: number | null; suffix?: string }) {
  if (value == null) return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Minus className="w-2.5 h-2.5" /> {label}: n/a
    </span>
  );
  const positive = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono tabular-nums ${positive ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground"}`}>
      {positive ? <TrendingUp className="w-2.5 h-2.5" /> : value < 0 ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
      {label}: {positive ? "+" : ""}{value.toFixed(1)}{suffix}
    </span>
  );
}

export function ManagementScoreSection({ data }: Props) {
  const [result, setResult] = useState<ManagementScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      // BUGFIX (06.08.2026, Auftrag "Segment-Matching & Management-Score hart
      // fixen"): prevPercentage fehlte hier komplett im Mapping — der Server-
      // seitige Fix aus dem vorherigen Ticket (fmp.ts liefert prevPercentage
      // korrekt) lief ins Leere, weil dieser Client-Request-Builder das Feld
      // nie an /api/management-score durchreichte. ΔShare war deshalb IMMER
      // n/a, unabhängig davon wie gut die Server-Logik war.
      const segments = (data.revenueSegments ?? []).map(s => ({
        name: s.name, revenue: s.revenue, percentage: s.percentage,
        growth: s.growth ?? null, prevRevenue: s.prevRevenue,
        prevPercentage: s.prevPercentage,
      }));
      // Pflicht-Debug-Log (Auftrag 06.08.2026): Rohsegmente vor dem Request,
      // damit sich "warum ist ΔShare n/a" direkt aus der Browser-Konsole
      // nachvollziehen laesst, ohne Server-Logs zu brauchen.
      console.log(`[MGMT-SCORE] ${data.ticker}: Rohsegmente vor Request`, segments.map(s => ({
        name: s.name, percentage: s.percentage, prevPercentage: s.prevPercentage, growth: s.growth,
      })));
      const overallMarginPct = data.financialStatements?.incomeStatement?.operatingMargin ?? null;
      const actualRevenueGrowthPct = data.financialStatements?.incomeStatement?.revenueGrowth ?? null;
      const peerTickers = (data.peerComparison?.peers ?? []).map(p => p.ticker);
      const newsHeadlines = (data.catalysts ?? []).map(c => c.name).filter(Boolean);

      const res = await apiRequest("POST", "/api/management-score", {
        ticker: data.ticker,
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        description: data.description,
        segments,
        totalRevenue: data.revenue,
        overallMarginPct,
        overallMarginTrend: null, // Trend-Klassifikation ueber 2+ Perioden noch nicht separat im Datenmodell — Server faellt auf neutral zurueck
        actualRevenueGrowthPct: actualRevenueGrowthPct,
        guidanceRevenueGrowthPct: null, // FMP-Analyst-Estimate-Proxy wird serverseitig ergaenzt, sobald verdrahtet — aktuell Fallback auf Trend
        revenueGrowthTrend: actualRevenueGrowthPct != null ? (actualRevenueGrowthPct > 5 ? "beschleunigend" : actualRevenueGrowthPct > 0 ? "stabil" : "verlangsamend") : null,
        marginTrend: null,
        epsOrFcfVsGuidancePct: null,
        roicPct: data.peerComparison?.subject?.roic ?? null,
        roic5YPct: data.peerComparison?.subject?.roic5Y ?? null,
        fcfMarginPct: data.fcfMargin ?? null,
        fcfMarginTrend: null,
        cashConversionRatio: null,
        reinvestmentEfficiency: null,
        workingCapitalTrend: null,
        accrualsLevel: null,
        revenueGrowthPrevYearPct: null,
        fcfMarginPrevYearPct: null,
        roicPrevYearPct: null,
        storyIsPositive: (actualRevenueGrowthPct ?? 0) > 10,
        peerTickers,
        newsHeadlines,
        force,
      }, 120000);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err?.message || "Analyse fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard number={18} title="MANAGEMENT-EXECUTION-SCORE">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-muted-foreground max-w-2xl">
            Bewertet Management-Delivery entlang 5 Bausteinen (Delivery, Segment-Shift, Kapitalallokation,
            Glaubwürdigkeit, Qual+News) inkl. Vergütungs-/Insider-Trading-Warnsignale aus SEC-Daten.
          </p>
          <button
            onClick={() => run(!!result)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors disabled:opacity-50 flex-shrink-0"
            data-testid="management-score-run"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Berechne …" : result ? "Neu berechnen" : "Management-Score berechnen"}
          </button>
        </div>

        {error && <p className="text-xs text-amber-500">{error}</p>}

        {result && (
          <div className="space-y-4">
            {result.deliveryDataQuality.warning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{result.deliveryDataQuality.warning}</span>
              </div>
            )}
            <ScoreAmpel score1to10={result.breakdown.score1to10} />

            {/* Datenaktualität — explizit pro Baustein, wie im Auftrag gefordert */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md p-2 border border-border/50">
              <span className="flex items-center gap-1"><Info className="w-3 h-3" /> Datenaktualität:</span>
              <span>Segment-FY: {result.dataAsOf.segmentFiscalYear ?? "n/a"}</span>
              <span>ROIC-FY: {data.peerComparison?.subject?.roicFiscalYear ?? "n/a"}</span>
              <span>Vergütungsjahr: {result.dataAsOf.compensationYear ?? "n/a"}</span>
              <span>Insider-Fenster: {result.dataAsOf.insiderTradingWindowDays} Tage</span>
              <span>Berechnet: {new Date(result.dataAsOf.generatedAt).toLocaleString("de-DE")}</span>
              {result.llmModelUsed && <span>LLM: {result.llmModelUsed}</span>}
            </div>

            {/* Breakdown pro Baustein */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Breakdown</h3>
              {BAUSTEINE.map(b => {
                const sub = result.breakdown[b.key] as SubScoreResult;
                return (
                  <div key={b.key as string} className="space-y-1">
                    <SubScoreBar label={b.label} weight={b.weight} score={sub.score} />
                    <div className="text-[10px] text-muted-foreground pl-0.5">{b.frage}</div>
                  </div>
                );
              })}
            </div>

            {/* Segment-Detail */}
            {result.breakdown.segment.deltaSharePp != null || result.breakdown.segment.growthGapPp != null ? (
              <div className="flex flex-wrap gap-3 bg-muted/20 rounded-md p-2.5 border border-border/50">
                <DeltaBadge label="ΔSegment-Anteil" value={result.breakdown.segment.deltaSharePp} />
                <DeltaBadge label="Growth-Gap (neu vs. alt)" value={result.breakdown.segment.growthGapPp} />
              </div>
            ) : null}

            {/* News-Adjustments */}
            {result.breakdown.qualNews.adjustments.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Governance-/Vergütungs-Signale</h3>
                {result.breakdown.qualNews.adjustments.map((adj, i) => (
                  <div key={i} className={`rounded-md border p-2.5 text-[11px] ${adj.delta < 0 ? "border-red-500/30 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold ${adj.delta < 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {adj.delta >= 0 ? "+" : ""}{adj.delta.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-foreground/70 mt-0.5">{adj.rationale}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Flags / Datenlücken-Transparenz */}
            {result.breakdown.allFlags.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Transparenz-Hinweise
                </h3>
                <ul className="space-y-1">
                  {result.breakdown.allFlags.map((f, i) => (
                    <li key={i} className="text-[10px] text-muted-foreground pl-3 border-l border-border/50">{f}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-[10px] text-muted-foreground pt-1">
              Gesamtformel: Score = 10 × (0.30·Delivery + 0.25·Segment + 0.20·Kapital + 0.15·Glaubwürdigkeit + 0.10·Qual+News) ·
              Quellen: FMP Governance-Executive-Compensation, Insider-Trading (Form 4), Analyst-Estimates — vor Anlageentscheidung gegenprüfen
            </div>
          </div>
        )}

        {!result && !loading && !error && (
          <p className="text-xs text-muted-foreground">
            Noch nicht berechnet — klicke oben, um Segment-, Delivery-, Kapitalallokations-, Glaubwürdigkeits- und
            Governance-Daten zu laden und den Score zu berechnen.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
