import { SectionCard } from "../SectionCard";
import { YahooNoValuationCard } from "../YahooNoValuationCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis, RevenueSegment } from "../../../../shared/schema";
import { calculateFCFFDCF, buildDefaultDCFParams, calculateCatalystUpside, selectCatalystBase } from "../../lib/calculations";
import { buildBiasDecision } from "../../../../shared/bias-fixes";
import { formatPercentNoSign, formatNumber, formatCurrency, formatLargeNumber, statementCurrency } from "../../lib/formatters";
import { useEffect, useMemo, useRef, useState } from "react";
import { catalystDisplayName, formatSignedPct } from "../../../../shared/catalyst-event";
import { annotationByName } from "../../../../shared/segment-growth-calc";
import { outlineStillCurrent } from "../../../../shared/segment-children";
import { useSegmentGrowth } from "../../hooks/useSegmentGrowth";
import { NewsHeader, SentimentNewsList, newsBoxClass, newsSentimentCounts } from "../news/SentimentNewsList";
import { SegmentGrowthReadout } from "./SegmentGrowthReadout";
import { SegmentSupplementView } from "./SegmentSupplementView";
import { SegmentChildrenPanel, SegmentLine } from "./SegmentChildren";
import { apiRequest } from "../../lib/queryClient";

interface OutlineItem {
  name: string;
  shareOfParentPct: number | null;
  growthPct: number | null;
  basis: string;
  origin: "KI";
}

interface Props { data: StockAnalysis }

// ─── Peter Lynch Classifier ──────────────────────────────────────────────────
// Explicitly checks for TRUE cyclicals only.
// Strings like "Non-Cyclical", "Defensive / Non-Cyclical" must NOT trigger Zykliker.

/** Returns true only for genuinely cyclical cycleClassification strings */
function isTrueCyclical(cycle: string): boolean {
  const c = cycle.toLowerCase().trim();
  // Exclude defensive / non-cyclical strings that contain "cyclical" as substring
  if (c.includes('non-cyclical') || c.includes('non cyclical')) return false;
  if (c.includes('defensive')) return false;
  if (c.includes('pharma') || c.includes('healthcare') || c.includes('health care')) return false;
  if (c.includes('utility') || c.includes('utilities')) return false;
  if (c.includes('consumer staples')) return false;
  if (c.includes('telecom')) return false;
  // Only true cyclical patterns
  return (
    c === 'cyclical' ||
    c === 'zykliker' ||
    c === 'zyklisch' ||
    c.startsWith('cyclical ') ||
    c.startsWith('zyklisch') ||
    c.includes('true cyclical') ||
    c.includes('commodity') ||
    c.includes('energy cyclical') ||
    c.includes('materials') ||
    c.includes('basic materials')
  );
}

/** Cyclical ticker whitelist — sectors: energy, materials, auto, chemicals, airlines, steel */
const CYCLICAL_TICKERS = new Set([
  'XOM','CVX','COP','SLB','HAL','MPC','VLO','PSX','OXY','DVN','FANG',
  'FCX','NUE','X','CLF','AA','NEM','GOLD','AEM','WPM',
  'F','GM','STLA','TM','HMC',
  'DOW','LYB','CE','EMN','HUN','ALB',
  'DAL','UAL','AAL','LUV','JBLU','HA',
  'RIO','BHP','VALE','MT','SCCO',
  'CAT','DE','CMI','PCAR','TEX',
  'CF','MOS','NTR',
]);

export function OutlineRows({
  ticker,
  kind,
  items,
  note,
  open,
  setOpen,
}: {
  ticker: string;
  kind: "product" | "geographic";
  items: OutlineItem[];
  /** Grund aus /api/segment-outline, z. B. „n/a — Fremdmarke verworfen: …“, auch wenn Items übrig bleiben. */
  note?: string | null;
  open: Record<string, boolean>;
  setOpen: (next: Record<string, boolean>) => void;
}) {
  return (
    <div className="mt-2 space-y-1.5" data-testid={`segment-outline-${kind}`}>
      {note ? <p className="text-[10px] text-muted-foreground" data-testid={`segment-outline-note-${kind}`}>{note}</p> : null}
      {items.map((item) => (
        <SegmentLine key={item.name} name={item.name} open={open[item.name] === true} onToggle={() => setOpen({ ...open, [item.name]: !open[item.name] })}>
          <div className="mb-0.5 flex items-center justify-between text-xs">
            <span className="mr-2 truncate font-medium">{item.name}</span>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {item.shareOfParentPct != null ? `${formatNumber(item.shareOfParentPct, 1)}%` : "n/a"}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground" title={item.basis}>
                {item.growthPct != null ? `${item.growthPct > 0 ? "+" : ""}${formatNumber(item.growthPct, 1)}%` : "n/a"}
              </span>
              <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[10px] text-violet-700 dark:text-violet-200">KI-Schätzung</span>
            </div>
          </div>
          {item.shareOfParentPct != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-violet-500/60" style={{ width: `${Math.min(100, item.shareOfParentPct)}%` }} />
            </div>
          )}
          {open[item.name] === true && (
            <SegmentChildrenPanel ticker={ticker} parent={item.name} kind={kind} />
          )}
        </SegmentLine>
      ))}
    </div>
  );
}

export function segmentEstimateButtonVisible(segments: readonly unknown[] | null | undefined): boolean {
  return !segments || segments.length === 0;
}

/**
 * Berichtswährung aus GET /api/segment-growth (FMP income-statement reportedCurrency).
 * Solange die Anfrage läuft: Ladezustand. Danach die Währung oder n/a mit Grund.
 */
export function SegmentCurrencyLine({
  queried,
  loading,
  failed,
  currency,
}: {
  queried: boolean;
  loading: boolean;
  failed: boolean;
  currency: string | null;
}) {
  if (loading) {
    return <p className="text-[10px] text-muted-foreground" data-testid="segment-reported-currency" data-state="loading">Währung …</p>;
  }
  if (currency) {
    return <p className="text-[10px] text-muted-foreground" data-testid="segment-reported-currency" data-state="ready">{`Währung ${currency}`}</p>;
  }
  const reason = !queried
    ? "keine Segmente, Berichtswährung nicht abgefragt"
    : failed
      ? "Segmentdaten nicht erreichbar"
      : "Berichtswährung fehlt im Abschluss";
  return <p className="text-[10px] text-muted-foreground" data-testid="segment-reported-currency" data-state="na" title={reason}>{`Währung n/a — ${reason}`}</p>;
}

export function Section2({ data }: Props) {
  // Use backend catalysts directly
  const catalysts = data.catalysts;

  // === SINGLE SOURCE OF TRUTH: shared DCF defaults (same as Section5/Section6/SummarySection) ===
  // buildDefaultDCFParams liefert auch `rsl` mit → identischer Fair Value wie Section 5/6.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);

  const baseDCF = useMemo(() => calculateFCFFDCF(params), [params]);
  const bias = useMemo(() => buildBiasDecision(data), [data]);

  // Smart Catalyst-Base-Selektor auf der entscheidungsrelevanten DCF-Basis.
  const _rawUpsideS2 = bias.positiveGbSum;
  const _decisionS2 = Number.isFinite(bias.decisionPerShare) ? bias.decisionPerShare : baseDCF.perShare;
  const _baseInfoS2 = selectCatalystBase(_decisionS2, _rawUpsideS2, data.currentPrice, data.analystPT.median);
  const catalystDCFBase = _baseInfoS2.base;
  const catalystBaseFallback = _baseInfoS2.source !== "dcf";

  const { totalUpside, adjustedTarget } = useMemo(
    () => calculateCatalystUpside(catalysts, catalystDCFBase),
    [catalysts, catalystDCFBase]
  );

  return (
    <SectionCard number={3} title="INVESTMENTTHESE & KATALYSATOREN">
      {/* Part A: Company thesis */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Company Description</h3>
          <p className="text-xs text-foreground/80 leading-relaxed max-h-[200px] overflow-y-auto">{data.description}</p>
        </div>

        {/* === Aktuelle Nachrichten mit Sentiment === */}
        {data.newsItems && data.newsItems.length > 0 && (
          <div className={`rounded-lg border p-3 mb-3 ${newsBoxClass(newsSentimentCounts(data.newsItems).overall)}`}>
            <NewsHeader title="Aktuelle Nachrichten" items={data.newsItems} />
            <SentimentNewsList items={data.newsItems} />
          </div>
        )}

        {/* Peter Lynch Classification */}
        {(() => {
          const epsGr = data.epsGrowth5Y;
          const pe = data.peRatio;
          const revGrowth = data.sectorProfile.growthAssumptions.g1;
          const fcfM = data.fcfMargin;
          const moat = data.moatRating;
          const cycle = data.cycleClassification || '';
          const ticker = data.ticker?.toUpperCase() || '';

          // ── Determine if truly cyclical (fixes NVO/Pharma false-positive) ──
          const cyclical = isTrueCyclical(cycle) || CYCLICAL_TICKERS.has(ticker);

          // ── Defensive sector detection ──
          const cycleLower = cycle.toLowerCase();
          const isDefensiveSector =
            cycleLower.includes('non-cyclical') ||
            cycleLower.includes('defensive') ||
            cycleLower.includes('pharma') ||
            cycleLower.includes('healthcare') ||
            cycleLower.includes('health care') ||
            cycleLower.includes('consumer staples') ||
            cycleLower.includes('utility') ||
            cycleLower.includes('utilities');

          let lynchType = '';
          let lynchColor = '';
          let lynchDesc = '';
          let lynchBuyTip = '';

          if (cyclical) {
            // ── Zykliker ──
            lynchType = 'Zykliker';
            lynchColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            lynchDesc = 'Gewinne schwanken mit dem Konjunkturzyklus. Typisch für Energie, Rohstoffe, Automobil, Chemie.';
            lynchBuyTip = 'Attraktiv bei NIEDRIGEM P/E am Gewinnhoch — Lynch kauft Zykliker wenn Gewinne am Boden sind und P/E HOCH erscheint (da Gewinne bald steigen). Aktuell P/E ' + formatNumber(pe, 1) + (pe < 15 ? ' — möglicherweise Gewinnnhöchststand, VORSICHT' : pe > 40 ? ' — Gewinntief möglich, könnte Einstieg sein' : ' — Zyklusmitte') + '.';
          } else if (epsGr > 20 && revGrowth > 10) {
            // ── Fast Grower ── (threshold revGrowth >10, not 15, catches pharma/biotech growers)
            lynchType = 'Fast Grower';
            lynchColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            lynchDesc = 'Hohes Gewinnwachstum (>' + formatNumber(epsGr, 0) + '% p.a.). Aggressives Wachstum in expandierendem Markt.';
            lynchBuyTip = 'Attraktiv solange PEG < 1.5 und Wachstum nachhaltig. Aktuell PEG ' + formatNumber(data.pegRatio, 2) + (data.pegRatio < 1 ? ' — UNTERBEWERTET relativ zum Wachstum' : data.pegRatio < 1.5 ? ' — fair bewertet' : ' — bereits eingepreist, Vorsicht') + '.';
          } else if (epsGr > 8 && epsGr <= 20 && moat !== 'None') {
            // ── Stalwart ── (also covers pharma/healthcare with solid moat & moderate growth)
            lynchType = 'Stalwart';
            lynchColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20';
            lynchDesc = 'Großes, etabliertes Unternehmen mit solidem Wachstum (' + formatNumber(epsGr, 0) + '% p.a.). Defensive Qualität.' + (isDefensiveSector ? ' Nicht-zyklischer Sektor — weitgehend konjunkturunabhängig.' : '');
            const currentVsFair = baseDCF.perShare > 0
              ? (data.currentPrice / baseDCF.perShare - 1) * 100
              : null;
            lynchBuyTip = currentVsFair !== null && currentVsFair > 100
              ? 'Kurs ' + formatNumber(currentVsFair, 0) + '% über konservativem DCF-Fair Value — starke Wachstumserwartungen eingepreist. Sicherheitsmarge fehlt.'
              : currentVsFair !== null && currentVsFair > 30
              ? 'Kurs ' + formatNumber(currentVsFair, 0) + '% über konservativem DCF — limitierte Sicherheitsmarge. Wachstum muss sich bestätigen.'
              : 'Attraktiv bei 30-50% Discount zum Fair Value. Verkaufen bei +30-50% Gain.';
          } else if (epsGr > 0 && epsGr <= 8 && isDefensiveSector) {
            // ── Slow Grower (defensive) ── explicit branch for defensive sectors with low growth
            lynchType = 'Slow Grower';
            lynchColor = 'text-slate-400 bg-slate-500/10 border-slate-500/20';
            lynchDesc = 'Defensiver Sektor, geringes Wachstum (' + formatNumber(epsGr, 0) + '% p.a.). Stabile Dividenden und Cash Flows, konjunkturunabhängig.';
            lynchBuyTip = 'Nur für Dividendenstrategie. Kaufen bei hoher Dividendenrendite und stabilen FCFs.';
          } else if (epsGr <= 5 && fcfM > 10) {
            // ── Slow Grower (general) ──
            lynchType = 'Slow Grower';
            lynchColor = 'text-slate-400 bg-slate-500/10 border-slate-500/20';
            lynchDesc = 'Geringe Wachstumsdynamik (' + formatNumber(epsGr, 0) + '% p.a.), aber stabile Dividenden/Cash Flows.';
            lynchBuyTip = 'Nur für Dividendenstrategie. Kaufen bei hoher Dividendenrendite und stabilen FCFs.';
          } else if (epsGr < 0 || (pe > 0 && pe < 5) || fcfM < 2) {
            // ── Turnaround ──
            lynchType = 'Turnaround';
            lynchColor = 'text-red-400 bg-red-500/10 border-red-500/20';
            lynchDesc = 'Unternehmen in Schwierigkeiten oder Restrukturierung. Hohes Risiko, hohe Chance.';
            lynchBuyTip = 'Nur bei klarem Restrukturierungsplan und ausreichend Liquidität. Position klein halten.';
          } else {
            // ── Asset Play ──
            lynchType = 'Asset Play';
            lynchColor = 'text-purple-400 bg-purple-500/10 border-purple-500/20';
            lynchDesc = 'Verborgene Vermögenswerte nicht im Kurs reflektiert.';
            lynchBuyTip = 'Attraktiv wenn Summe der Einzelteile > Marktkapitalisierung.';
          }

          return (
            <div className={`rounded-md p-3 border ${lynchColor}`}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Peter Lynch Klassifikation</h3>
                <span className="text-xs font-bold">{lynchType}</span>
              </div>
              <p className="text-[10px] text-foreground/70 leading-relaxed">{lynchDesc}</p>
              <p className="text-[10px] text-foreground/80 leading-relaxed mt-1 font-medium">{lynchBuyTip}</p>
            </div>
          );
        })()}

        <SegmentEstimateBlock data={data} />


        {/* Growth Thesis & Catalyst Reasoning (expanded) */}
        <div className="bg-muted/30 rounded-md p-3 border border-border/50">
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Investment These & Katalysatoren-Logik</h3>
          <p className="text-xs text-foreground/80 leading-relaxed">{data.growthThesis}</p>
          {/* Auftrag 08.08.2026 ("Live-These + Thesis-Score + Katalysatoren"): Quellen-
              Hinweis + Timestamp unter der These, wie im Zielbild spezifiziert.
              Kein alter Cache-Text mehr ohne Kontext, wann/woraus generiert. */}
          {data.growthThesis && (
            <p className="text-[10px] text-muted-foreground/70 mt-1.5">
              Quellen: Segmente, Wachstum, Katalysatoren, Sektor
              {data.growthThesisGeneratedAt && (
                <> · Stand: {new Date(data.growthThesisGeneratedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</>
              )}
            </p>
          )}

          {/* Capex Fiscal Tailwind highlight */}
          {(() => {
            const capexCat = (data.catalysts || []).find(c => c.tags?.includes("capex-tailwind"));
            if (!capexCat) return null;
            const sector = capexCat.name.replace(/^Capex Tailwind:\s*/i, "").trim();
            const progMatch = capexCat.context?.match(/Programme:\s*([^\.,(]+)/i);
            const programmes = progMatch ? progMatch[1].trim() : sector;
            const contextSentences = (capexCat.context || "").match(/[^.!?]+[.!?]+/g) || [];
            const rationale = contextSentences[0]?.trim() || "";
            return (
              <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400">🏛 Fiskal-Rückenwind</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">{programmes}</span>
                  <span className="text-[9px] text-muted-foreground ml-auto">{capexCat.timeline} · PoS {capexCat.pos}%</span>
                </div>
                {rationale && (
                  <p className="text-[11px] text-foreground/80 leading-relaxed">{rationale}</p>
                )}
                {contextSentences.length > 1 && (
                  <p className="text-[11px] text-foreground/70 leading-relaxed mt-0.5">{contextSentences.slice(1, 3).join(" ").trim()}</p>
                )}
              </div>
            );
          })()}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MiniCard label="Moat Assessment" value={data.moatRating} badge />
          <MiniCard label="FCF Strength" value={data.fcfAvailable === false ? "n/a" : `${formatPercentNoSign(data.fcfMargin)} margin • ${formatLargeNumber(data.fcfTTM, statementCurrency(data))} TTM`} />
        </div>
        {data.alternativesMetricsNote && (
          <p className="text-[10px] text-muted-foreground leading-snug" data-testid="alternatives-metrics-note">
            {data.alternativesMetricsNote}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Gov. Exposure</div>
            <div className="text-sm font-semibold tabular-nums mt-0.5">{formatPercentNoSign(data.governmentExposure)}</div>
            {data.govExposureDetail && (
              <div className="text-[10px] text-muted-foreground mt-1">{data.govExposureDetail}</div>
            )}
            {data.governmentExposure > 20 && (
              <div className="text-[10px] text-amber-500 mt-1">⚠ FCF haircut of {data.fcfHaircut}% applied</div>
            )}
          </div>
          {data.fcfHaircut > 0 && (
            <div className="bg-amber-500/10 rounded-md p-3 border border-amber-500/20">
              <div className="text-[10px] text-amber-500 font-medium uppercase tracking-wider">FCF Haircut</div>
              <div className="text-sm font-semibold tabular-nums text-amber-500 mt-0.5">{data.fcfHaircut}%</div>
              <div className="text-[10px] text-amber-500/70 mt-1">Applied due to gov. exposure &gt;20%</div>
            </div>
          )}
        </div>

        {/* Structural Trends */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Structural Trends</h3>
          <div className="flex flex-wrap gap-2">
            {data.structuralTrends.map((trend, i) => (
              <span
                key={i}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary border border-primary/10"
              >
                {trend}
              </span>
            ))}
          </div>
        </div>

        {/* Key Projects from SEC 10-K */}
        {data.keyProjects && data.keyProjects.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Schlüsselprojekte & Katalysatoren (SEC 10-K)</h3>
            <div className="flex flex-wrap gap-2">
              {data.keyProjects.map((project, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20"
                >
                  {project}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* SEC Filing Excerpts */}
        {data.secFilingExcerpts && data.secFilingExcerpts.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Auszüge aus dem 10-K Filing</h3>
            <div className="space-y-1.5 bg-muted/10 rounded-lg p-3 border border-border/30">
              {data.secFilingExcerpts.map((excerpt, i) => (
                <div key={i} className="text-[10px] text-foreground/80 leading-relaxed">
                  <span className="text-primary font-semibold">„</span>{excerpt}<span className="text-primary font-semibold">"</span>
                </div>
              ))}
              <div className="text-[9px] text-muted-foreground/50 mt-1 italic">Quelle: SEC EDGAR 10-K Filing</div>
            </div>
          </div>
        )}

        {/* Recent News Headlines */}
        {data.newsHeadlines && data.newsHeadlines.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Aktuelle Nachrichten</h3>
            <div className="space-y-1">
              {data.newsHeadlines.map((headline, i) => (
                <div key={i} className="text-[10px] text-muted-foreground leading-relaxed">
                  • {headline}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Part B: Catalyst table */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Katalysatoren (Company-Specific)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Catalyst</th>
                <th className="text-left py-2 px-1 text-muted-foreground font-medium">Timeline</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">PoS%</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">Brutto↑</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">Einpr.%</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">Netto↑</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">GB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {catalysts.map((c, i) => {
                const hasSentiment = c.newsSentiment && c.newsSentiment !== 'neutral';
                const sentBg = c.newsSentiment === 'bullish' ? 'bg-emerald-500/5' : c.newsSentiment === 'bearish' ? 'bg-red-500/5' : c.newsSentiment === 'mixed' ? 'bg-amber-500/5' : '';
                const sentIcon = c.newsSentiment === 'bullish' ? '▲' : c.newsSentiment === 'bearish' ? '▼' : c.newsSentiment === 'mixed' ? '◆' : '';
                const sentColor = c.newsSentiment === 'bullish' ? 'text-emerald-400' : c.newsSentiment === 'bearish' ? 'text-red-400' : c.newsSentiment === 'mixed' ? 'text-amber-400' : '';
                const adjStr = c.posAdjustment && c.posAdjustment !== 0 ? (c.posAdjustment > 0 ? `+${c.posAdjustment}` : `${c.posAdjustment}`) : '';
                return (
                <tr key={i} className={`hover:bg-muted/20 ${sentBg}`}>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      {sentIcon && <span className={`text-[10px] ${sentColor}`} title={`News: ${c.newsSentiment} (${c.newsCount} Meldung${(c.newsCount||0) > 1 ? 'en' : ''})`}>{sentIcon}</span>}
                      <span className="font-medium">{catalystDisplayName(c)}</span>
                      {c.newsCount && c.newsCount > 0 && (
                        <span className={`text-[9px] px-1 py-px rounded ${sentColor} ${c.newsSentiment === 'bullish' ? 'bg-emerald-500/15' : c.newsSentiment === 'bearish' ? 'bg-red-500/15' : c.newsSentiment === 'mixed' ? 'bg-amber-500/15' : 'bg-foreground/5'}`}>
                          {c.newsCount}📰
                        </span>
                      )}
                    </div>
                    {/* Inline Top-2 linked news preview */}
                    {(() => {
                      const linked = (data.newsItems || []).filter(n => n.matchedCatalystIdx === i).slice(0, 2);
                      if (linked.length === 0) return null;
                      return (
                        <div className="mt-1 space-y-0.5 pl-3">
                          {linked.map((news, ni) => {
                            const sc = news.sentiment;
                            const clr = sc === 'bullish' ? 'text-emerald-400/70' : sc === 'bearish' ? 'text-red-400/70' : 'text-foreground/40';
                            const dot = sc === 'bullish' ? 'bg-emerald-400/60' : sc === 'bearish' ? 'bg-red-400/60' : 'bg-foreground/20';
                            return (
                              <a key={ni} href={news.url} target="_blank" rel="noopener noreferrer"
                                className="group flex items-center gap-1 hover:opacity-80 transition-opacity">
                                <span className={`shrink-0 w-1 h-1 rounded-full ${dot}`} />
                                <span className={`text-[9px] leading-tight truncate max-w-[260px] ${clr} group-hover:text-primary`}>
                                  {news.title}
                                </span>
                                <span className="text-[8px] text-foreground/25 shrink-0">{news.relativeTime}</span>
                              </a>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-1.5 px-1 text-muted-foreground">{c.timeline}</td>
                  <td className="py-1.5 px-1 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-mono tabular-nums">{c.pos}%</span>
                      {adjStr && (
                        <span className={`text-[9px] font-mono ${c.posAdjustment! > 0 ? 'text-emerald-400' : 'text-red-400'}`} title={`News-Adj: ${adjStr} (vorher ${c.posOriginal}%)`}>
                          ({adjStr})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`py-1.5 px-1 text-right font-mono tabular-nums ${c.bruttoUpside < 0 ? "text-red-500" : "text-emerald-500"}`}>{formatSignedPct(c.bruttoUpside, 1)}</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums">{c.einpreisungsgrad}%</td>
                  <td className={`py-1.5 px-1 text-right font-mono tabular-nums ${c.nettoUpside < 0 ? "text-red-500" : "text-emerald-500"}`}>{formatSignedPct(c.nettoUpside, 2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold">{formatNumber(c.gb, 2)}%</td>
                </tr>
              );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={6} className="py-2 px-2">Total Upside (Σ GB)</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(totalUpside, 2)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Control Calculation */}
      <div className="bg-primary/5 rounded-md p-3 border border-primary/10">
        {(() => {
          const catVsKurs = ((adjustedTarget / data.currentPrice - 1) * 100);
          const isBelowKurs = adjustedTarget < data.currentPrice;
          return (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Conservative DCF (base, WACC {baseDCF.wacc.toFixed(1)}%)</span>
                <span className="font-mono tabular-nums font-semibold">{formatCurrency(baseDCF.perShare, 2, statementCurrency(data))}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-muted-foreground">
                  Kat.-adj. Zielwert = {catalystBaseFallback ? 'Analyst PT' : 'Kons. DCF'} × (1 + {formatNumber(totalUpside, 2)}%)
                  {catalystBaseFallback && <span className="text-amber-500 ml-1">⚠</span>}
                </span>
                <span className={`font-mono tabular-nums font-semibold ${isBelowKurs ? 'text-red-500' : 'text-primary'}`}>
                  {formatCurrency(adjustedTarget, 2, catalystBaseFallback ? data.currency : statementCurrency(data))}
                </span>
              </div>
              <div className={`flex items-center justify-between text-[10px] mt-0.5 ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                <span>vs. Kurs ({formatCurrency(data.currentPrice, 2, data.currency)})</span>
                <span className="font-mono font-medium">{catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%</span>
              </div>
            </>
          );
        })()}
      </div>

      <RechenWeg
        title="DCF Rechenweg"
        steps={baseDCF.steps}
      />
    </SectionCard>
  );
}


export function SegmentEstimateBlock({ data }: Props) {
  const segmentGrowthQueried = (data.revenueSegments?.length ?? 0) > 0 || (data.geoSegments?.length ?? 0) > 0;
  const segmentGrowth = useSegmentGrowth(data.ticker, segmentGrowthQueried);
  const [openBusiness, setOpenBusiness] = useState<Record<string, boolean>>({});
  const [openGeo, setOpenGeo] = useState<Record<string, boolean>>({});
  const [businessOutline, setBusinessOutline] = useState<OutlineItem[] | null>(null);
  const [geoOutline, setGeoOutline] = useState<OutlineItem[] | null>(null);
  const [businessOutlineError, setBusinessOutlineError] = useState<string | null>(null);
  const [geoOutlineError, setGeoOutlineError] = useState<string | null>(null);
  const [businessOutlineNote, setBusinessOutlineNote] = useState<string | null>(null);
  const [geoOutlineNote, setGeoOutlineNote] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState<"product" | "geographic" | null>(null);
  const [geoFills, setGeoFills] = useState<Record<string, OutlineItem>>({});
  const tickerRef = useRef(data.ticker);
  const outlineTicket = useRef(0);
  tickerRef.current = data.ticker;

  useEffect(() => {
    setBusinessOutline(null);
    setGeoOutline(null);
    setBusinessOutlineError(null);
    setGeoOutlineError(null);
    setBusinessOutlineNote(null);
    setGeoOutlineNote(null);
    setOutlineLoading(null);
    setGeoFills({});
    setOpenBusiness({});
    setOpenGeo({});
    outlineTicket.current += 1;
  }, [data.ticker]);

  async function estimateOutline(kind: "product" | "geographic") {
    if (outlineLoading) return;
    const started = data.ticker;
    const ticket = ++outlineTicket.current;
    setOutlineLoading(kind);
    if (kind === "product") setBusinessOutlineError(null);
    else setGeoOutlineError(null);
    const current = () => outlineStillCurrent(started, tickerRef.current) && ticket === outlineTicket.current;
    const setError = (message: string) => {
      if (!current()) return;
      if (kind === "product") setBusinessOutlineError(message);
      else setGeoOutlineError(message);
    };
    try {
      const regionsKnown = kind === "geographic" && (data.geoSegments?.length ?? 0) > 0;
      const res = await apiRequest("POST", "/api/segment-outline", regionsKnown ? {
        ticker: started,
        kind,
        rows: (data.geoSegments ?? []).map((seg) => ({
          name: seg.name,
          revenue: seg.revenue,
          share: seg.percentage,
          growth: typeof seg.growth === "number" ? seg.growth : null,
        })),
        context: {
          currency: data.currency || null,
          fiscalYear: data.revenueSegments?.find((seg) => seg.fiscalYear)?.fiscalYear
            ?? data.geoSegments?.find((seg) => seg.fiscalYear)?.fiscalYear
            ?? null,
          totalRevenue: typeof data.revenue === "number" ? data.revenue : null,
          segments: (data.revenueSegments ?? []).map((seg) => ({
            name: seg.name,
            revenue: seg.revenue,
            growth: typeof (seg.growth ?? seg.yoyChangePercent) === "number" ? (seg.growth ?? seg.yoyChangePercent) : null,
          })),
        },
      } : { ticker: started, kind });
      if (!current()) return;
      const json = await res.json().catch(() => null) as { items?: OutlineItem[]; reason?: string; error?: string } | null;
      if (!res.ok || !json || !Array.isArray(json.items)) {
        setError(json?.reason || json?.error || "KI-Schätzung unvollständig — nichts übernommen");
        return;
      }
      if (regionsKnown) {
        const next: Record<string, OutlineItem> = {};
        for (const item of json.items) next[item.name] = item;
        setGeoFills(next);
        setGeoOutlineNote(json.reason ?? null);
        if (json.items.length === 0) setError(json.reason || "KI-Schätzung unvollständig — nichts übernommen");
        return;
      }
      if (json.items.length === 0) {
        setError(json.reason || json.error || "KI-Schätzung unvollständig — nichts übernommen");
        return;
      }
      if (kind === "product") {
        setBusinessOutline(json.items);
        setBusinessOutlineNote(json.reason ?? null);
      } else {
        setGeoOutline(json.items);
        setGeoOutlineNote(json.reason ?? null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "KI-Schätzung fehlgeschlagen");
    } finally {
      if (current()) setOutlineLoading(null);
    }
  }
  const reportedCurrency = segmentGrowth.data?.currency || null;
  return (
    <>
        <SegmentCurrencyLine
          queried={segmentGrowthQueried && (data.ticker ?? "").trim().length > 0}
          loading={segmentGrowth.isLoading}
          failed={segmentGrowth.isError}
          currency={reportedCurrency}
        />
        {/* Revenue Segments (Umsatzanteil nach Geschäftssegmenten / Business Segments)
            Segment-Fallback-Pipeline (2026-08): data.revenueSegments now comes from
            one of THREE sources (see server/analyze-route.ts step 7/7b + server/sec-segments.ts):
              1) FMP fmpSegments() — fastest, free, but empty for many tickers (e.g. IREN)
              2) curated static fallback (foreign ADRs FMP structurally never covers)
              3) SEC EDGAR 10-K/20-F full-text extraction via LLM (ticker-agnostic)
            data.revenueSegmentsSource / data.revenueSegmentsMessage tell the UI which
            case applies so we NEVER show a generic/empty placeholder (hard requirement:
            no "None"/"N/A"/empty bars — always a concrete number or a clear explanation). */}
        {data.revenueSegments && data.revenueSegments.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Umsatz nach Geschäftssegmenten (Business Segments)</h3>
              {(() => {
                const src = data.revenueSegmentsSource;
                const fy = data.revenueSegments!.find(s => s.fiscalYear)?.fiscalYear;
                const label = src === "sec" ? `Quelle: 10-K/20-F${fy ? ` ${fy}` : ""}`
                  : src === "fmp" ? "Quelle: FMP"
                  : src === "curated" ? "Quelle: Geschäftsbericht (kuratiert)"
                  : null;
                return label ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-medium">{label}</span>
                ) : null;
              })()}
            </div>
            {data.revenueSegments.length === 1 ? (
              // Pure Play: nur ein einziges Segment gemeldet — statt einer einsamen
              // 100%-Balke lieber der explizite Hinweistext (Anforderung #3A).
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                <span className="text-xs font-semibold">Pure Play: 100% {data.revenueSegments[0].name}</span>
                {data.revenueSegments[0].revenue > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-2 font-mono">({formatLargeNumber(data.revenueSegments[0].revenue)})</span>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {data.revenueSegments.map((seg, i) => (
                  <SegmentLine key={i} name={seg.name} open={openBusiness[seg.name] === true} onToggle={() => setOpenBusiness((current) => ({ ...current, [seg.name]: !current[seg.name] }))}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-medium truncate mr-2">{seg.name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {seg.revenue > 0 && (
                          <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70">{formatLargeNumber(seg.revenue)}</span>
                        )}
                        <SegmentGrowthReadout
                          fact={seg.growth ?? seg.yoyChangePercent}
                          annotation={annotationByName(segmentGrowth.data?.business, seg.name)}
                        />
                        <span className="font-mono tabular-nums text-muted-foreground w-12 text-right">{formatNumber(seg.percentage, 1)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all duration-500"
                        style={{ width: `${Math.min(100, seg.percentage)}%` }}
                      />
                    </div>
                    {openBusiness[seg.name] === true && (
                      <SegmentChildrenPanel
                        ticker={data.ticker}
                        parent={seg.name}
                        kind="product"
                        context={{
                          parentRevenue: seg.revenue > 0 ? seg.revenue : null,
                          parentYoy: typeof (seg.growth ?? seg.yoyChangePercent) === "number" ? (seg.growth ?? seg.yoyChangePercent) as number : null,
                          fiscalYear: seg.fiscalYear ?? data.revenueSegments?.find((row) => row.fiscalYear)?.fiscalYear ?? null,
                          currency: data.currency || null,
                          regions: (data.geoSegments ?? []).map((row) => ({
                            name: row.name,
                            revenue: row.revenue > 0 ? row.revenue : null,
                            growth: typeof row.growth === "number" ? row.growth : null,
                          })),
                        }}
                      />
                    )}
                  </SegmentLine>
                ))}
              </div>
            )}
            <SegmentSupplementView
              ticker={data.ticker}
              segments={data.revenueSegments.map((seg: RevenueSegment) => ({
                name: seg.name,
                percentage: Number.isFinite(seg.percentage) ? seg.percentage : null,
                reportedGrowthPct: typeof (seg.growth ?? seg.yoyChangePercent) === "number"
                  ? (seg.growth ?? seg.yoyChangePercent) as number
                  : null,
              }))}
            />
          </div>
        ) : (
          // Anforderung #1/#6: klare Meldung statt generischem/leerem Block, wenn
          // wirklich keine Business-Segment-Daten verfügbar sind (weder FMP noch
          // SEC EDGAR fanden welche). Wird nur gerendert wenn eine Meldung vom
          // Server gesetzt wurde — sonst (z.B. alter Cache-Eintrag ohne das Feld)
          // bleibt der Block ganz ausgeblendet statt "N/A" zu zeigen.
          (data.revenueSegmentsMessage || segmentEstimateButtonVisible(data.revenueSegments)) && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Umsatz nach Geschäftssegmenten (Business Segments)</h3>
              <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                <span className="text-xs text-muted-foreground italic">{data.revenueSegmentsMessage || "n/a — keine gemeldeten Segmente"}</span>
              </div>
              <button
                type="button"
                data-testid="button-segment-outline-product"
                disabled={outlineLoading !== null}
                onClick={() => { void estimateOutline("product"); }}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 disabled:opacity-50 dark:text-violet-300"
              >
                {outlineLoading === "product" ? "…" : businessOutline ? "erneut schätzen" : "N/A mit KI schätzen"}
              </button>
              {businessOutlineError && <p className="mt-1 text-[10px] text-red-500" data-testid="segment-outline-error-product">{businessOutlineError}</p>}
              {businessOutline && <OutlineRows ticker={data.ticker} kind="product" items={businessOutline} note={businessOutlineNote} open={openBusiness} setOpen={setOpenBusiness} />}
            </div>
          )
        )}

        {/* Geographic Segments. The server already removed name+revenue and
            non-geo duplicates. geoSegmentsNote is the spelled footnote when
            that removal happened. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Umsatz nach Regionen (Geographic Segments)</h3>
            {(data.geoSegments?.length ?? 0) > 0 && (
              <button
                type="button"
                data-testid="button-segment-outline-geo"
                disabled={outlineLoading !== null || data.geoSegments!.every((seg) => typeof seg.growth === "number")}
                title={data.geoSegments!.every((seg) => typeof seg.growth === "number") ? "Keine N/A-Zellen" : "N/A mit KI schätzen"}
                onClick={() => { void estimateOutline("geographic"); }}
                className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 disabled:opacity-50 dark:text-violet-300"
              >
                {outlineLoading === "geographic" ? "…" : "N/A mit KI schätzen"}
              </button>
            )}
          </div>
          {geoOutlineNote && (data.geoSegments?.length ?? 0) > 0 && (
            <p className="mb-1 text-[10px] text-muted-foreground" data-testid="segment-outline-note-geo">{geoOutlineNote}</p>
          )}
          {geoOutlineError && (data.geoSegments?.length ?? 0) > 0 && (
            <p className="mb-1 text-[10px] text-red-500" data-testid="segment-outline-error-geo">{geoOutlineError}</p>
          )}
          {!(data.geoSegments && data.geoSegments.length > 0) && (
            <>
              <button
                type="button"
                data-testid="button-segment-outline-geo"
                disabled={outlineLoading !== null}
                onClick={() => { void estimateOutline("geographic"); }}
                className="mb-2 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 disabled:opacity-50 dark:text-violet-300"
              >
                {outlineLoading === "geographic" ? "…" : geoOutline ? "erneut schätzen" : "N/A mit KI schätzen"}
              </button>
              {geoOutlineError && <p className="mb-1 text-[10px] text-red-500" data-testid="segment-outline-error-geo">{geoOutlineError}</p>}
              {geoOutline && <OutlineRows ticker={data.ticker} kind="geographic" items={geoOutline} note={geoOutlineNote} open={openGeo} setOpen={setOpenGeo} />}
            </>
          )}
          {data.geoSegments && data.geoSegments.length > 0 && (
            <div className="space-y-1.5">
              {[...data.geoSegments].sort((a, b) => b.percentage - a.percentage).map((seg, i) => (
                <SegmentLine key={i} name={seg.name} open={openGeo[seg.name] === true} onToggle={() => setOpenGeo((current) => ({ ...current, [seg.name]: !current[seg.name] }))}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium truncate mr-2">{seg.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {seg.revenue > 0 && (
                        <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70">{formatLargeNumber(seg.revenue)}</span>
                      )}
                      <SegmentGrowthReadout
                        fact={seg.growth}
                        annotation={annotationByName(segmentGrowth.data?.geographic, seg.name)}
                      />
                      {(() => {
                        const fill = geoFills[seg.name];
                        if (!fill) return null;
                        const growth = fill.growthPct != null ? ` ${fill.growthPct > 0 ? "+" : ""}${fill.growthPct.toFixed(1)}%` : " n/a";
                        return (
                          <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[10px] text-violet-700 dark:text-violet-200" data-testid={`region-ki-${seg.name}`}>
                            KI-Schätzung{growth}{fill.basis ? ` ${fill.basis}` : " n/a — ohne Quelle"}
                          </span>
                        );
                      })()}
                      <span className="font-mono tabular-nums text-muted-foreground w-12 text-right">{formatNumber(seg.percentage, 1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500/60 transition-all duration-500"
                      style={{ width: `${Math.min(100, seg.percentage)}%` }}
                    />
                  </div>
                  {openGeo[seg.name] === true && (
                    <SegmentChildrenPanel
                      ticker={data.ticker}
                      parent={seg.name}
                      kind="geographic"
                      context={{
                        parentRevenue: seg.revenue > 0 ? seg.revenue : null,
                        parentYoy: typeof seg.growth === "number" ? seg.growth : null,
                        fiscalYear: seg.fiscalYear ?? null,
                        currency: data.currency || null,
                        regions: (data.geoSegments ?? []).map((row) => ({
                          name: row.name,
                          revenue: row.revenue > 0 ? row.revenue : null,
                          growth: typeof row.growth === "number" ? row.growth : null,
                        })),
                      }}
                    />
                  )}
                </SegmentLine>
              ))}
            </div>
            )}
          {data.geoSegmentsNote && (
            <p className="mt-1.5 text-[10px] text-muted-foreground italic" data-testid="geo-segment-dedup-note">
              {data.geoSegmentsNote}
            </p>
          )}
        </div>
    </>
  );
}

export function YahooSection3({ data }: Props) {
  return (
    <>
      <YahooNoValuationCard number={3} title="INVESTMENTTHESE & KATALYSATOREN" data={data} />
      <SegmentEstimateBlock data={data} />
    </>
  );
}

function MiniCard({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-md p-3 border border-border/50">
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      {badge ? (
        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
          value === "Wide" ? "bg-emerald-500/15 text-emerald-500" :
          value === "Narrow" ? "bg-amber-500/15 text-amber-500" :
          "bg-red-500/15 text-red-500"
        }`}>{value}</span>
      ) : (
        <div className="text-xs text-foreground/80 mt-1 leading-relaxed">{value}</div>
      )}
    </div>
  );
}
