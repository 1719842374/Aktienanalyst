import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { formatNumber } from "../../lib/formatters";
import { TrendingUp, TrendingDown, Globe, BarChart3 } from "lucide-react";
import PeerComparison from "./PeerComparison";
import EpsGrowthChart from "./EpsGrowthChart";

interface Props { data: StockAnalysis }

export function Section7({ data }: Props) {
  // Use TTM sector avg for TTM stock P/E, and forward sector avg for forward stock P/E
  // Fallback: if backend didn't ship sectorAvgForwardPE (older cached payloads), fall back to TTM to avoid NaN
  const sectorFwdPE = data.sectorAvgForwardPE > 0 ? data.sectorAvgForwardPE : data.sectorAvgPE;
  const trailingPEPremium = data.sectorAvgPE > 0 ? ((data.peRatio / data.sectorAvgPE) - 1) * 100 : 0;
  const fwdPEPremium = sectorFwdPE > 0 ? ((data.forwardPE / sectorFwdPE) - 1) * 100 : 0;
  const evEbitdaPremium = data.sectorAvgEVEBITDA > 0 ? ((data.evEbitda / data.sectorAvgEVEBITDA) - 1) * 100 : 0;

  // Revenue growth vs sector (use TAM CAGR as sector growth proxy)
  const companyGrowth = data.tamAnalysis?.companyGrowth ?? 0;
  const sectorGrowth = data.tamAnalysis?.tamCAGR ?? 5;

  // Estimate moat-justified vs speculative premium/discount (based on trailing P/E)
  const isDiscount = trailingPEPremium < 0;
  const moatMaxPremium = data.moatRating === "Wide" ? 30 : data.moatRating === "Narrow-Wide" ? 20 : data.moatRating === "Narrow" ? 15 : 0;
  const moatJustified = isDiscount ? 0 : Math.min(trailingPEPremium, moatMaxPremium);
  const speculative = trailingPEPremium - moatJustified;

  const metrics = [
    { label: "P/E (TTM)", stock: data.peRatio, sector: data.sectorAvgPE, premium: trailingPEPremium, desc: "Aktuell" },
    { label: "Forward P/E", stock: data.forwardPE, sector: sectorFwdPE, premium: fwdPEPremium, desc: "Erwartet" },
    { label: "EV/EBITDA", stock: data.evEbitda, sector: data.sectorAvgEVEBITDA, premium: evEbitdaPremium, desc: "" },
    { label: "PEG", stock: data.pegRatio, sector: data.sectorAvgPEG, premium: ((data.pegRatio / data.sectorAvgPEG) - 1) * 100, desc: "" },
    { label: "Revenue Growth", stock: companyGrowth, sector: sectorGrowth, premium: companyGrowth - sectorGrowth, desc: "YoY vs. Branche", isGrowth: true },
  ] as const;

  const tam = data.tamAnalysis;

  return (
    <SectionCard number={7} title="RELATIVE BEWERTUNG">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Metric</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Stock</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Sector Avg</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Premium</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {metrics.map((m, i) => {
              const isGrowthRow = 'isGrowth' in m && m.isGrowth;
              // For valuation metrics (P/E, EV/EBITDA, PEG): lower = better (green), higher = worse (amber)
              // For growth metrics: higher = better (green), lower = worse (amber)
              const premiumColor = isGrowthRow
                ? (m.premium >= 0 ? 'text-emerald-500' : 'text-red-500')
                : (m.premium > 0 ? 'text-amber-500' : 'text-emerald-500');
              return (
                <tr key={i} className={i === 0 ? 'bg-muted/10' : ''}>
                  <td className="py-2 px-2">
                    <span className="font-medium">{m.label}</span>
                    {m.desc && <span className="text-[9px] text-muted-foreground ml-1">({m.desc})</span>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold">
                    {isGrowthRow ? (m.stock >= 0 ? '+' : '') : ''}{formatNumber(m.stock, 1)}{isGrowthRow ? '%' : ''}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">
                    {isGrowthRow ? '+' : ''}{formatNumber(m.sector, 1)}{isGrowthRow ? '%' : ''}
                  </td>
                  <td className={`py-2 px-2 text-right font-mono tabular-nums font-medium ${premiumColor}`}>
                    {m.premium >= 0 ? '+' : ''}{formatNumber(m.premium, 1)}{isGrowthRow ? ' Pkt.' : '%'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Visual bar comparing stock vs sector for Trailing P/E and Revenue Growth */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">P/E (TTM) vs. Sektor</h3>
          <div className="space-y-2">
            <BarRow label={data.ticker} value={data.peRatio} max={Math.max(data.peRatio, data.sectorAvgPE, 1) * 1.3} color="bg-primary" />
            <BarRow label="Sektor" value={data.sectorAvgPE} max={Math.max(data.peRatio, data.sectorAvgPE, 1) * 1.3} color="bg-muted-foreground/50" />
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Revenue Growth vs. Branche</h3>
          <div className="space-y-2">
            <BarRow label={data.ticker} value={companyGrowth} max={Math.max(Math.abs(companyGrowth), sectorGrowth, 1) * 1.5} color={companyGrowth >= sectorGrowth ? 'bg-emerald-500' : 'bg-red-500'} suffix="%" />
            <BarRow label="Branche" value={sectorGrowth} max={Math.max(Math.abs(companyGrowth), sectorGrowth, 1) * 1.5} color="bg-muted-foreground/50" suffix="%" />
          </div>
        </div>
      </div>

      {/* TAM Analysis */}
      {tam && tam.tamTotal > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-3 h-3" />
            TAM & Marktposition
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="bg-muted/20 rounded-md p-2.5 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">TAM</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-0.5">${formatNumber(tam.tamTotal, 0)}B</div>
              <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{tam.tamLabel}</div>
            </div>
            <div className="bg-muted/20 rounded-md p-2.5 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Branchen-CAGR</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-0.5">{tam.tamCAGR}%</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">p.a. (5Y Prognose)</div>
            </div>
            <div className="bg-muted/20 rounded-md p-2.5 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Unternehmens-Wachstum</div>
              <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${tam.companyGrowth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {tam.companyGrowth >= 0 ? '+' : ''}{formatNumber(tam.companyGrowth, 1)}%
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">Revenue YoY</div>
            </div>
            <div className="bg-muted/20 rounded-md p-2.5 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Marktanteil (TAM)</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-0.5">{tam.marketShare < 0.01 ? '<0.01' : formatNumber(tam.marketShare, 2)}%</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">${formatNumber(tam.companyRevenue, 1)}B / ${formatNumber(tam.tamTotal, 0)}B</div>
            </div>
          </div>

          {/* Per-segment TAM breakdown (when segments available) */}
          {tam.segments && tam.segments.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" />
                Segment-TAM-Analyse
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 pr-2 text-muted-foreground font-medium">Segment</th>
                      <th className="text-right py-1.5 px-1.5 text-muted-foreground font-medium">Rev.</th>
                      <th className="text-right py-1.5 px-1.5 text-muted-foreground font-medium">Anteil</th>
                      <th className="text-right py-1.5 px-1.5 text-muted-foreground font-medium">Wachstum</th>
                      <th className="text-right py-1.5 px-1.5 text-muted-foreground font-medium">TAM</th>
                      <th className="text-right py-1.5 px-1.5 text-muted-foreground font-medium">CAGR</th>
                      <th className="text-right py-1.5 px-1.5 text-muted-foreground font-medium">Anteil am TAM</th>
                      <th className="text-center py-1.5 pl-1.5 text-muted-foreground font-medium">vs. TAM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {tam.segments.map((seg: any, i: number) => (
                      <tr key={i} className="hover:bg-muted/10">
                        <td className="py-1.5 pr-2 font-medium">{seg.segmentName}</td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">${formatNumber(seg.segmentRevenue, 1)}B</td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-muted-foreground">{formatNumber(seg.segmentShare, 1)}%</td>
                        <td className={`py-1.5 px-1.5 text-right font-mono tabular-nums font-medium ${seg.segmentGrowth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {seg.segmentGrowth >= 0 ? '+' : ''}{formatNumber(seg.segmentGrowth, 1)}%
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">${formatNumber(seg.tamSize, 0)}B</td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-primary">{seg.tamCAGR}%</td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">{formatNumber(seg.marketShare, 1)}%</td>
                        <td className="py-1.5 pl-1.5 text-center">
                          {seg.outperforming ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-500 font-medium">
                              <TrendingUp className="w-2.5 h-2.5" /> Über
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium">
                              <TrendingDown className="w-2.5 h-2.5" /> Unter
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Weighted verdict */}
              <div className={`flex items-center gap-1.5 text-[10px] ${tam.outperforming ? 'text-emerald-500' : 'text-amber-500'}`}>
                {tam.outperforming ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span className="font-medium">
                  Gewichteter Branchen-CAGR: {formatNumber(tam.tamCAGR, 1)}% — Unternehmen {tam.outperforming ? 'outperformed' : 'underperformed'}
                  {' '}({tam.companyGrowth >= 0 ? '+' : ''}{formatNumber(tam.companyGrowth, 1)}% vs. {formatNumber(tam.tamCAGR, 1)}%)
                </span>
              </div>
            </div>
          ) : (
            /* Fallback: single growth comparison bar */
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Wachstum: Unternehmen vs. Branche</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-20 flex-shrink-0">{data.ticker}</span>
                <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden relative">
                  <div
                    className={`h-full rounded transition-all ${tam.outperforming ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                    style={{ width: `${Math.min(100, Math.max(2, Math.abs(tam.companyGrowth) / Math.max(tam.tamCAGR * 2, 1) * 100))}%` }}
                  />
                </div>
                <span className={`text-[10px] font-mono tabular-nums font-semibold w-14 text-right ${tam.companyGrowth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {tam.companyGrowth >= 0 ? '+' : ''}{formatNumber(tam.companyGrowth, 1)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-20 flex-shrink-0">Branche</span>
                <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden relative">
                  <div
                    className="h-full bg-primary/40 rounded transition-all"
                    style={{ width: `${Math.min(100, tam.tamCAGR / Math.max(tam.tamCAGR * 2, 1) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono tabular-nums font-semibold w-14 text-right text-primary">
                  +{formatNumber(tam.tamCAGR, 1)}%
                </span>
              </div>
              <div className={`flex items-center gap-1.5 text-[10px] mt-1 ${tam.outperforming ? 'text-emerald-500' : 'text-amber-500'}`}>
                {tam.outperforming ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span className="font-medium">
                  {tam.outperforming
                    ? `Wächst ${formatNumber(tam.companyGrowth - tam.tamCAGR, 1)} Pkt. schneller als die Branche`
                    : `Wächst ${formatNumber(tam.tamCAGR - tam.companyGrowth, 1)} Pkt. langsamer als die Branche`
                  }
                </span>
              </div>
            </div>
          )}

          {/* TAM source */}
          <div className="text-[9px] text-muted-foreground/50 mt-2 italic">
            TAM-Schätzung: {tam.tamSource}
          </div>
        </div>
      )}

      {/* Premium / Discount Breakdown */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          {isDiscount ? 'Discount-Analyse' : 'Premium Breakdown'}
        </h3>
        {isDiscount ? (
          /* DISCOUNT: Show discount assessment instead of moat/speculative split */
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-500/5 rounded-md p-3 border border-emerald-500/20">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Discount zum Sektor</div>
              <div className="text-sm font-bold font-mono tabular-nums text-emerald-500 mt-1">
                {formatNumber(fwdPEPremium, 1)}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Fwd P/E {formatNumber(data.forwardPE, 1)} vs. {formatNumber(sectorFwdPE, 1)}
              </div>
            </div>
            <div className={`rounded-md p-3 border ${
              fwdPEPremium < -50 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-emerald-500/5 border-emerald-500/20'
            }`}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Bewertung</div>
              <div className={`text-sm font-bold mt-1 ${
                fwdPEPremium < -70 ? 'text-amber-500' : fwdPEPremium < -30 ? 'text-emerald-500' : 'text-emerald-400'
              }`}>
                {fwdPEPremium < -70 ? 'Deep Value' : fwdPEPremium < -30 ? 'Unterbewertet' : 'Leicht günstig'}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {fwdPEPremium < -70
                  ? 'Extremer Discount — prüfe Risiken (Value Trap?)'
                  : fwdPEPremium < -30
                  ? 'Signifikanter Discount zum Sektor'
                  : 'Moderater Bewertungsvorteil'
                }
              </div>
            </div>
          </div>
        ) : (
          /* PREMIUM: Show moat-justified vs speculative split */
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-500/5 rounded-md p-3 border border-emerald-500/20">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Moat-Justified</div>
              <div className="text-sm font-bold font-mono tabular-nums text-emerald-500 mt-1">+{formatNumber(moatJustified, 1)}%</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Moat: {data.moatRating}</div>
            </div>
            <div className={`rounded-md p-3 border ${speculative > 15 ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Spekulativ</div>
              <div className={`text-sm font-bold font-mono tabular-nums mt-1 ${speculative > 15 ? 'text-red-500' : 'text-amber-500'}`}>
                {speculative >= 0 ? '+' : ''}{formatNumber(speculative, 1)}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {speculative > 30 ? 'Überbewertungsrisiko' : speculative > 15 ? 'Erhöhtes Risiko' : 'Im Rahmen'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* EPS Growth Chart */}
      {data.peerComparison?.epsHistory && data.peerComparison.epsHistory.length > 3 && (
        <div className="mt-4 pt-4 border-t border-border">
          <EpsGrowthChart data={data} />
        </div>
      )}

      {/* Peer Comparison Table */}
      {data.peerComparison && data.peerComparison.peers.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Peer-Vergleich (Wettbewerber)</h3>
          <PeerComparison data={data} />
        </div>
      )}
    </SectionCard>
  );
}

function BarRow({ label, value, max, color, suffix = '' }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = Math.max(0, Math.min(100, (Math.abs(value) / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
        <div className={`h-full ${color} rounded transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums font-semibold w-14 text-right">{value >= 0 && suffix ? '+' : ''}{formatNumber(value, 1)}{suffix}</span>
    </div>
  );
}
