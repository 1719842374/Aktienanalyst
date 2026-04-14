import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis, RevenueSegment } from "../../../../shared/schema";
import { calculateFCFFDCF, type FCFFDCFParams, calculateCatalystUpside } from "../../lib/calculations";
import { formatPercentNoSign, formatNumber, formatCurrency, formatLargeNumber } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section2({ data }: Props) {
  // Use backend catalysts directly
  const catalysts = data.catalysts;

  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;

  // Compute conservative FCFF DCF (same defaults as Section5/Section11/Section13)
  // Use operatingIncome (EBIT) not EBITDA for DCF margin
  const ebitMarginDefault = data.operatingIncome > 0 && data.revenue > 0
    ? +((data.operatingIncome / data.revenue) * 100).toFixed(1)
    : data.ebitda > 0 && data.revenue > 0
      ? +((data.ebitda / data.revenue) * 100 * 0.6).toFixed(1)
      : 15;
  const fsCapex = data.financialStatements?.cashFlow?.capex;
  const capexDefault = fsCapex && fsCapex > 0 && data.revenue > 0
    ? +Math.max(2, Math.min(25, (fsCapex / data.revenue) * 100)).toFixed(1)
    : data.revenue > 0 && data.ebitda > 0 && data.operatingIncome > 0
      ? +Math.max(2, Math.min(20, ((data.ebitda - data.operatingIncome) / data.revenue) * 100)).toFixed(1)
      : 5;
  const revenueGrowthDefault = sp.growthAssumptions.g1 || 10;
  const rf = 4.2, erp = 5.5, taxR = 21, rd = 5.0;
  const debtRatioVal = data.totalDebt > 0 ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0) : 10;
  const evFrac = (100 - debtRatioVal) / 100;
  const dvFrac = debtRatioVal / 100;
  const targetWACC = sp.waccScenarios.avg;
  const debtCostPart = dvFrac * rd * (1 - taxR / 100);
  const impliedBeta = Math.max(0.5, Math.min(1.8,
    (targetWACC - debtCostPart - evFrac * rf) / (evFrac * erp)
  ));
  const dcfBeta = +Math.min(impliedBeta, data.beta5Y + 0.1).toFixed(2);

  const baseDCF = useMemo(() => calculateFCFFDCF({
    revenueBase: data.revenue,
    revenueGrowthP1: revenueGrowthDefault,
    revenueGrowthP2: Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1)),
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: +Math.max(8, ebitMarginDefault * 0.9).toFixed(1),
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxR,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rf,
    beta: dcfBeta,
    erp,
    debtRatio: debtRatioVal,
    costOfDebt: rd,
    terminalG: sp.growthAssumptions.terminal || 2.5,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    fcfHaircut: data.fcfHaircut,
    actualEPS: data.epsTTM,
    forwardEPS: data.epsConsensusNextFY,
  }), [data, sp, netDebt]);

  // Catalyst base: use DCF perShare, but if it's unreasonably low, fall back to analyst PT median
  const catalystDCFBase = baseDCF.perShare > data.currentPrice * 0.05
    ? baseDCF.perShare
    : (data.analystPT.median > 0 ? data.analystPT.median : data.currentPrice);
  const catalystBaseFallback = catalystDCFBase !== baseDCF.perShare;

  const { totalUpside, adjustedTarget } = useMemo(
    () => calculateCatalystUpside(catalysts, catalystDCFBase),
    [catalysts, catalystDCFBase]
  );

  return (
    <SectionCard number={2} title="INVESTMENTTHESE & KATALYSATOREN">
      {/* Part A: Company thesis */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Company Description</h3>
          <p className="text-xs text-foreground/80 leading-relaxed max-h-[200px] overflow-y-auto">{data.description}</p>
        </div>

        {/* === Aktuelle Nachrichten mit Sentiment === */}
        {data.newsItems && data.newsItems.length > 0 && (() => {
          const bullish = data.newsItems.filter(n => n.sentiment === 'bullish').length;
          const bearish = data.newsItems.filter(n => n.sentiment === 'bearish').length;
          const neutral = data.newsItems.length - bullish - bearish;
          const avgScore = data.newsItems.reduce((s, n) => s + (n.sentimentScore || 0), 0) / data.newsItems.length;
          const overallSentiment = avgScore > 0.15 ? 'bullish' : avgScore < -0.15 ? 'bearish' : 'neutral';
          const sentimentColor = overallSentiment === 'bullish' ? 'text-emerald-400' : overallSentiment === 'bearish' ? 'text-red-400' : 'text-foreground/50';
          const sentimentBg = overallSentiment === 'bullish' ? 'bg-emerald-500/10 border-emerald-500/20' : overallSentiment === 'bearish' ? 'bg-red-500/10 border-red-500/20' : 'bg-card/50 border-border/50';

          return (
          <div className={`rounded-lg border p-3 mb-3 ${sentimentBg}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">📰</span>
                <span className="text-sm font-semibold text-foreground">Aktuelle Nachrichten</span>
                <span className="text-xs text-foreground/50">({data.newsItems.length})</span>
              </div>
              <div className="flex items-center gap-2">
                {bullish > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">▲ {bullish} bullish</span>}
                {bearish > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">▼ {bearish} bearish</span>}
                {neutral > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/40">● {neutral} neutral</span>}
              </div>
            </div>
            <div className="space-y-1">
              {data.newsItems.map((news, idx) => {
                const sc = news.sentiment;
                const dotColor = sc === 'bullish' ? 'bg-emerald-400' : sc === 'bearish' ? 'bg-red-400' : 'bg-foreground/30';
                const textColor = sc === 'bullish' ? 'text-emerald-300/90' : sc === 'bearish' ? 'text-red-300/90' : 'text-foreground/70';
                const scoreStr = news.sentimentScore != null ? (news.sentimentScore > 0 ? `+${(news.sentimentScore * 100).toFixed(0)}` : `${(news.sentimentScore * 100).toFixed(0)}`) : '';

                return (
                <a
                  key={idx}
                  href={news.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug line-clamp-2 group-hover:text-primary transition-colors ${textColor}`}>
                      {news.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-foreground/40">{news.source}</span>
                      <span className="text-[10px] text-foreground/30">·</span>
                      <span className="text-[10px] text-foreground/40">{news.relativeTime}</span>
                      {scoreStr && (
                        <span className={`text-[9px] px-1 py-px rounded font-mono ${sc === 'bullish' ? 'bg-emerald-500/15 text-emerald-400' : sc === 'bearish' ? 'bg-red-500/15 text-red-400' : 'bg-foreground/5 text-foreground/40'}`}>
                          {scoreStr}
                        </span>
                      )}
                      {news.matchedCatalyst && (
                        <span className="text-[9px] px-1.5 py-px rounded bg-primary/10 text-primary/70 truncate max-w-[140px]" title={news.matchedCatalyst}>
                          → K{(news.matchedCatalystIdx ?? 0) + 1}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-foreground/20 group-hover:text-primary text-xs mt-0.5">↗</span>
                </a>
              );
              })}
            </div>
          </div>
          );
        })()}

        {/* Peter Lynch Classification */}
        {(() => {
          // Classify stock using Peter Lynch's framework
          const epsGr = data.epsGrowth5Y;
          const pe = data.peRatio;
          const rev = data.revenue;
          const revGrowth = data.sectorProfile.growthAssumptions.g1;
          const fcfM = data.fcfMargin;
          const moat = data.moatRating;
          const beta = data.beta5Y;
          const cycle = data.cycleClassification?.toLowerCase() || '';

          let lynchType = '';
          let lynchColor = '';
          let lynchDesc = '';
          let lynchBuyTip = '';

          if (cycle.includes('cyclical') || cycle.includes('zyklisch')) {
            lynchType = 'Zykliker';
            lynchColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            lynchDesc = 'Gewinne schwanken mit dem Konjunkturzyklus. Typisch f\u00fcr Energie, Rohstoffe, Automobil, Chemie.';
            lynchBuyTip = 'Attraktiv bei NIEDRIGEM P/E am Gewinnhoch \u2014 Lynch kauft Zykliker wenn Gewinne am Boden sind und P/E HOCH erscheint (da Gewinne bald steigen). Aktuell P/E ' + formatNumber(pe, 1) + (pe < 15 ? ' \u2014 m\u00f6glicherweise Gewinnh\u00f6chststand, VORSICHT' : pe > 40 ? ' \u2014 Gewinntief m\u00f6glich, k\u00f6nnte Einstieg sein' : ' \u2014 Zyklusmitte') + '.';
          } else if (epsGr > 20 && revGrowth > 15) {
            lynchType = 'Fast Grower';
            lynchColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            lynchDesc = 'Hohes Gewinnwachstum (>' + formatNumber(epsGr, 0) + '% p.a.). Aggressives Wachstum in expandierendem Markt.';
            lynchBuyTip = 'Attraktiv solange PEG < 1.5 und Wachstum nachhaltig. Aktuell PEG ' + formatNumber(data.pegRatio, 2) + (data.pegRatio < 1 ? ' \u2014 UNTERBEWERTET relativ zum Wachstum' : data.pegRatio < 1.5 ? ' \u2014 fair bewertet' : ' \u2014 bereits eingepreist, Vorsicht') + '.';
          } else if (epsGr > 8 && epsGr <= 20 && moat !== 'None') {
            lynchType = 'Stalwart';
            lynchColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20';
            lynchDesc = 'Gro\u00dfes, etabliertes Unternehmen mit solidem Wachstum (' + formatNumber(epsGr, 0) + '% p.a.). Defensive Qualit\u00e4t.';
            const cUp = ((baseDCF.perShare / data.currentPrice - 1) * 100);
            lynchBuyTip = 'Attraktiv bei 30-50% Discount zum Fair Value. Verkaufen bei +30-50% Gain. Aktuell ' + (cUp > 30 ? formatNumber(cUp, 0) + '% DCF-Upside \u2014 Einstieg m\u00f6glich' : cUp > 0 ? formatNumber(cUp, 0) + '% DCF-Upside \u2014 halten' : 'am/\u00fcber Fair Value \u2014 Gewinne mitnehmen') + '.';
          } else if (epsGr <= 5 && fcfM > 10) {
            lynchType = 'Slow Grower';
            lynchColor = 'text-slate-400 bg-slate-500/10 border-slate-500/20';
            lynchDesc = 'Geringe Wachstumsdynamik (' + formatNumber(epsGr, 0) + '% p.a.), aber stabile Dividenden/Cash Flows.';
            lynchBuyTip = 'Nur f\u00fcr Dividendenstrategie. Kaufen bei hoher Dividendenrendite und stabilen FCFs.';
          } else if (epsGr < 0 || (pe > 0 && pe < 5) || fcfM < 2) {
            lynchType = 'Turnaround';
            lynchColor = 'text-red-400 bg-red-500/10 border-red-500/20';
            lynchDesc = 'Unternehmen in Schwierigkeiten oder Restrukturierung. Hohes Risiko, hohe Chance.';
            lynchBuyTip = 'Nur bei klarem Restrukturierungsplan und ausreichend Liquidit\u00e4t. Position klein halten.';
          } else {
            lynchType = 'Asset Play';
            lynchColor = 'text-purple-400 bg-purple-500/10 border-purple-500/20';
            lynchDesc = 'Verborgene Verm\u00f6genswerte nicht im Kurs reflektiert.';
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

        {/* Revenue Segments (Umsatzanteil nach Produkten/Segmenten) */}
        {data.revenueSegments && data.revenueSegments.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Umsatzanteil nach Segmenten</h3>
            <div className="space-y-1.5">
              {data.revenueSegments.map((seg, i) => (
                <div key={i} className="relative">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium truncate mr-2">{seg.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {seg.growth !== undefined && seg.growth !== null && (
                        <span className={`text-[10px] font-mono tabular-nums ${seg.growth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {seg.growth >= 0 ? '+' : ''}{formatNumber(seg.growth, 1)}%
                        </span>
                      )}
                      <span className="font-mono tabular-nums text-muted-foreground w-12 text-right">{formatNumber(seg.percentage, 1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-all duration-500"
                      style={{ width: `${Math.min(100, seg.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Geographic Segments (Umsatzanteil nach Regionen) */}
        {data.geoSegments && data.geoSegments.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Umsatzanteil nach Regionen</h3>
            <div className="space-y-1.5">
              {data.geoSegments.map((seg, i) => (
                <div key={i} className="relative">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium truncate mr-2">{seg.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {seg.growth !== undefined && seg.growth !== null && (
                        <span className={`text-[10px] font-mono tabular-nums ${seg.growth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {seg.growth >= 0 ? '+' : ''}{formatNumber(seg.growth, 1)}%
                        </span>
                      )}
                      <span className="font-mono tabular-nums text-muted-foreground w-12 text-right">{formatNumber(seg.percentage, 1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500/60 transition-all duration-500"
                      style={{ width: `${Math.min(100, seg.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Growth Thesis & Catalyst Reasoning (expanded) */}
        <div className="bg-muted/30 rounded-md p-3 border border-border/50">
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Investment These & Katalysatoren-Logik</h3>
          <p className="text-xs text-foreground/80 leading-relaxed">{data.growthThesis}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MiniCard label="Moat Assessment" value={data.moatRating} badge />
          <MiniCard label="FCF Strength" value={`${formatPercentNoSign(data.fcfMargin)} margin • ${formatLargeNumber(data.fcfTTM)} TTM`} />
        </div>

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
                  <span className="text-primary font-semibold">„</span>{excerpt}<span className="text-primary font-semibold">“</span>
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
                      <span className="font-medium">{c.name}</span>
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
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(c.bruttoUpside, 1)}%</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums">{c.einpreisungsgrad}%</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(c.nettoUpside, 2)}%</td>
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
                <span className="font-mono tabular-nums font-semibold">{formatCurrency(baseDCF.perShare)}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-muted-foreground">
                  Kat.-adj. Zielwert = {catalystBaseFallback ? 'Analyst PT' : 'Kons. DCF'} × (1 + {formatNumber(totalUpside, 2)}%)
                  {catalystBaseFallback && <span className="text-amber-500 ml-1">⚠</span>}
                </span>
                <span className={`font-mono tabular-nums font-semibold ${isBelowKurs ? 'text-red-500' : 'text-primary'}`}>
                  {formatCurrency(adjustedTarget)}
                </span>
              </div>
              <div className={`flex items-center justify-between text-[10px] mt-0.5 ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                <span>vs. Kurs ({formatCurrency(data.currentPrice)})</span>
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
