import { useEffect, useMemo, useRef, useState } from "react";
import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { TAM_NA_SHARE_WARN, countKiFilledCells, countScopeRestNa, deriveOutperforming, deriveTamShare, factTamCagr, factTamSize, kiFillMetaLine, type TamNaFill, type TamNaSegmentRef } from "../../../../shared/tam-na-fill";
import { PEER_NA_INCOMPLETE_ERROR, PEER_NA_NOTE, peerFillClosesGap, peersNeeded, type PeerNaFill } from "../../../../shared/peer-na-fill";
import { formatNumber } from "../../lib/formatters";
import { apiRequest } from "../../lib/queryClient";
import { TrendingUp, TrendingDown, Globe, BarChart3, Sparkles, Loader2 } from "lucide-react";
import PeerComparison from "./PeerComparison";
import EpsGrowthChart from "./EpsGrowthChart";

interface Props { data: StockAnalysis; onPeerOverridesChange?: (overrides: { add: string[]; remove: string[] }) => void }

export function Section7({ data, onPeerOverridesChange }: Props) {
  // Use TTM sector avg for TTM stock P/E, and forward sector avg for forward stock P/E
  // Fallback: if backend didn't ship sectorAvgForwardPE (older cached payloads), fall back to TTM to avoid NaN
  const sectorFwdPE = data.sectorAvgForwardPE > 0 ? data.sectorAvgForwardPE : data.sectorAvgPE;
  const trailingPEPremium = data.sectorAvgPE > 0 ? ((data.peRatio / data.sectorAvgPE) - 1) * 100 : 0;
  const fwdPEPremium = sectorFwdPE > 0 ? ((data.forwardPE / sectorFwdPE) - 1) * 100 : 0;
  const evEbitdaPremium = data.sectorAvgEVEBITDA > 0 ? ((data.evEbitda / data.sectorAvgEVEBITDA) - 1) * 100 : 0;

  // Revenue growth vs sector (use TAM CAGR as sector growth proxy)
  const companyGrowth = data.tamAnalysis?.companyGrowth ?? 0;
  const sectorGrowth = data.tamAnalysis?.tamCAGR ?? 5;

  // Discount panel shows Forward P/E values → base decision on fwdPEPremium
  const isDiscount = fwdPEPremium < 0;
  const moatMaxPremium = data.moatRating === "Wide" ? 30 : data.moatRating === "Narrow-Wide" ? 20 : data.moatRating === "Narrow" ? 15 : 0;
  const moatJustified = isDiscount ? 0 : Math.min(trailingPEPremium, moatMaxPremium);
  const speculative = trailingPEPremium - moatJustified;

  const metrics = [
    { label: "P/E (TTM)", stock: data.peRatio, sector: data.sectorAvgPE, premium: trailingPEPremium, desc: "Aktuell" },
    { label: "Forward P/E", stock: data.forwardPE, sector: sectorFwdPE, premium: fwdPEPremium, desc: "Erwartet" },
    { label: "EV/EBITDA", stock: data.evEbitda, sector: data.sectorAvgEVEBITDA, premium: evEbitdaPremium, desc: "" },
    { label: "PEG", stock: data.pegRatio, sector: data.sectorAvgPEG, premium: data.sectorAvgPEG > 0 ? ((data.pegRatio / data.sectorAvgPEG) - 1) * 100 : 0, desc: "" },
    { label: "Revenue Growth", stock: companyGrowth, sector: sectorGrowth, premium: companyGrowth - sectorGrowth, desc: "YoY vs. Branche", isGrowth: true },
  ] as const;

  const tam = data.tamAnalysis;
  const [tamAiFills, setTamAiFills] = useState<Record<string, TamNaFill> | null>(null);
  const [tamAiLoading, setTamAiLoading] = useState(false);
  const [tamAiError, setTamAiError] = useState<string | null>(null);
  const tamAiRequest = useRef(0);
  const [peerKiFills, setPeerKiFills] = useState<PeerNaFill[] | null>(null);
  const [peerKiLoading, setPeerKiLoading] = useState(false);
  const [peerKiError, setPeerKiError] = useState<string | null>(null);
  const peerKiRequest = useRef(0);
  const factPeerCount = data.peerSet?.peerCount ?? data.peerComparison?.peers?.length ?? 0;
  const peerGap = peersNeeded(factPeerCount);

  const tamSegmentSig = useMemo(() => {
    const segs = tam?.segments;
    if (!segs || segs.length === 0) return "";
    return segs.map((s) => `${s.segmentName}:${s.segmentRevenue}:${s.matched === false ? 0 : 1}:${s.segmentGrowth ?? ""}`).join("|");
  }, [tam]);

  useEffect(() => {
    tamAiRequest.current += 1;
    setTamAiFills(null);
    setTamAiError(null);
    setTamAiLoading(false);
  }, [data.ticker, tamSegmentSig]);

  useEffect(() => {
    peerKiRequest.current += 1;
    setPeerKiFills(null);
    setPeerKiError(null);
    setPeerKiLoading(false);
  }, [data.ticker, factPeerCount]);

  const tamNaRefs = useMemo(() => {
    const out: TamNaSegmentRef[] = [];
    const seen = new Set<string>();
    for (const s of tam?.segments ?? []) {
      const ref = toTamNaRef(s);
      if (!ref || seen.has(ref.segmentName)) continue;
      seen.add(ref.segmentName);
      out.push(ref);
    }
    return out;
  }, [tam]);
  const scopeNaCount = useMemo(() => countScopeRestNa(tamNaRefs, null), [tamNaRefs]);
  const kiCellCount = useMemo(
    () => (tamAiFills ? countKiFilledCells(tamNaRefs, Object.values(tamAiFills)) : 0),
    [tamNaRefs, tamAiFills],
  );

  async function fillTamNa() {
    if (!tam?.segments || tamAiLoading || scopeNaCount === 0 || tamAiFills) return;
    const requestId = ++tamAiRequest.current;
    setTamAiLoading(true);
    setTamAiError(null);
    try {
      const res = await apiRequest("POST", `/api/analyze/${encodeURIComponent(data.ticker)}/tam-na-fill`, {
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        description: data.description,
        coveragePct: typeof tam.coveragePct === "number" ? tam.coveragePct : null,
        segments: tam.segments.map((s) => ({
          segmentName: s.segmentName,
          segmentRevenue: s.segmentRevenue,
          segmentShare: s.segmentShare,
          segmentGrowth: typeof s.segmentGrowth === "number" && Number.isFinite(s.segmentGrowth) ? s.segmentGrowth : null,
          matched: s.matched === false ? false : true,
          tamSize: typeof s.tamSize === "number" && Number.isFinite(s.tamSize) ? s.tamSize : null,
          tamCAGR: typeof s.tamCAGR === "number" && Number.isFinite(s.tamCAGR) ? s.tamCAGR : null,
        })),
      });
      let json: { fills?: TamNaFill[]; error?: string } | null = null;
      try { json = await res.json(); } catch { json = null; }
      if (requestId !== tamAiRequest.current) return;
      const incomplete = "KI-Schätzung unvollständig — nichts übernommen";
      if (!res.ok || !json || !Array.isArray(json.fills) || json.fills.length === 0) {
        setTamAiError(json?.error || incomplete);
        return;
      }
      if (countScopeRestNa(tamNaRefs, json.fills) !== 0) {
        setTamAiError(json.error || incomplete);
        return;
      }
      const known = new Set(tamNaRefs.map((s) => s.segmentName));
      const next: Record<string, TamNaFill> = {};
      for (const fill of json.fills) {
        if (!fill || !known.has(fill.segmentName)) continue;
        next[fill.segmentName] = fill;
      }
      if (countScopeRestNa(tamNaRefs, Object.values(next)) !== 0) {
        setTamAiError(incomplete);
        return;
      }
      setTamAiFills(next);
    } catch (err: unknown) {
      if (requestId !== tamAiRequest.current) return;
      const msg = err instanceof Error ? err.message : "";
      setTamAiError(msg || "KI-Schätzung fehlgeschlagen. Tabelle unverändert.");
    } finally {
      if (requestId === tamAiRequest.current) setTamAiLoading(false);
    }
  }

  async function fillPeerNa() {
    if (peerKiLoading || peerGap === 0 || peerKiFills) return;
    const requestId = ++peerKiRequest.current;
    setPeerKiLoading(true);
    setPeerKiError(null);
    const existingPeers = (data.peerComparison?.peers ?? []).map((p) => p.ticker);
    try {
      const res = await apiRequest("POST", `/api/analyze/${encodeURIComponent(data.ticker)}/peer-na-fill`, {
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        description: data.description,
        existingPeers,
        relativeApplies: data.peerSet?.relativeApplies ?? null,
      });
      let json: { fills?: PeerNaFill[]; error?: string; note?: string } | null = null;
      try { json = await res.json(); } catch { json = null; }
      if (requestId !== peerKiRequest.current) return;
      const fills = Array.isArray(json?.fills) ? json.fills : [];
      if (!res.ok || fills.length === 0 || !peerFillClosesGap(fills, existingPeers.length)) {
        setPeerKiError(json?.error || PEER_NA_INCOMPLETE_ERROR);
        return;
      }
      const known = new Set(existingPeers.map((t) => t.toUpperCase()));
      const next = fills.filter((row) => row?.ticker && !known.has(row.ticker.toUpperCase()) && row.suggestedBy === "ki");
      if (!peerFillClosesGap(next, existingPeers.length)) {
        setPeerKiError(PEER_NA_INCOMPLETE_ERROR);
        return;
      }
      setPeerKiFills(next.slice(0, peerGap));
    } catch (err: unknown) {
      if (requestId !== peerKiRequest.current) return;
      const msg = err instanceof Error ? err.message : "";
      setPeerKiError(msg || "KI-Schätzung fehlgeschlagen. Tabelle unverändert.");
    } finally {
      if (requestId === peerKiRequest.current) setPeerKiLoading(false);
    }
  }

  return (
    <SectionCard number={9} title="RELATIVE BEWERTUNG">
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
              // For valuation metrics with negative stock value (loss-making): premium meaningless
              const stockInvalid = !isGrowthRow && m.stock <= 0;
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
                    {stockInvalid ? <span className="text-muted-foreground">n/a</span> : <>{isGrowthRow ? (m.stock >= 0 ? '+' : '') : ''}{formatNumber(m.stock, 1)}{isGrowthRow ? '%' : ''}</>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">
                    {isGrowthRow ? (m.sector >= 0 ? '+' : '') : ''}{formatNumber(m.sector, 1)}{isGrowthRow ? '%' : ''}
                  </td>
                  <td className={`py-2 px-2 text-right font-mono tabular-nums font-medium ${stockInvalid ? 'text-muted-foreground' : premiumColor}`}>
                    {stockInvalid ? '—' : <>{m.premium >= 0 ? '+' : ''}{formatNumber(m.premium, 1)}{isGrowthRow ? ' Pkt.' : '%'}</>}
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
      {tam && (tam.tamTotal !== null && tam.tamTotal !== undefined ? tam.tamTotal > 0 : (tam.segments && tam.segments.length > 0)) && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-3 h-3" />
            TAM & Marktposition
          </h3>
          {/* A1 Qualitaetstor: bei quality==='unreliable' (Coverage < 70% oder < 2
              unterschiedliche TAM-Labels) zeigen wir KEINE falsche Konzernzahl
              mehr (z.B. den $896B-Bug), sondern einen erklaerenden Banner. */}
          {tam.quality === 'unreliable' || tam.tamTotal === null || tam.tamTotal === undefined ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5 mb-3 text-[10.5px] text-amber-600 dark:text-amber-400 leading-relaxed">
              Segment-TAM nicht belastbar genug fuer eine Gesamtkennzahl
              {typeof tam.coveragePct === 'number' ? ` (nur ${formatNumber(tam.coveragePct, 0)}% des Umsatzes zuordenbar` : ''}
              {typeof tam.distinctLabels === 'number' ? `, ${tam.distinctLabels} unterschiedliche(r) Markt(-e))` : ')'}
              . Einzelsegmente unten, sofern zuordenbar.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="bg-muted/20 rounded-md p-2.5 border border-border/30">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">TAM</div>
                <div className="text-sm font-bold font-mono tabular-nums mt-0.5">${formatNumber(tam.tamTotal, 0)}B</div>
                <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{tam.tamLabel}</div>
              </div>
              <div className="bg-muted/20 rounded-md p-2.5 border border-border/30">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Branchen-CAGR</div>
                <div className="text-sm font-bold font-mono tabular-nums mt-0.5">{tam.tamCAGR !== null && tam.tamCAGR !== undefined ? `${tam.tamCAGR}%` : 'n/a'}</div>
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
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  Marktanteil (TAM)
                  {tam.shareWarning && (
                    <span title="Mindestens ein Segment-Marktanteil > 25% — Wert mit Vorsicht interpretieren" className="text-amber-500">⚠</span>
                  )}
                </div>
                <div className="text-sm font-bold font-mono tabular-nums mt-0.5">{tam.marketShare === null || tam.marketShare === undefined ? 'n/a' : (tam.marketShare < 0.01 ? '<0.01' : formatNumber(tam.marketShare, 2)) + '%'}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">${formatNumber(tam.companyRevenue, 1)}B / ${formatNumber(tam.tamTotal, 0)}B</div>
              </div>
            </div>
          )}

          {/* Per-segment TAM breakdown (when segments available) */}
          {tam.segments && tam.segments.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3" />
                  Segment-TAM-Analyse
                </div>
                <button
                  type="button"
                  onClick={() => { if (!tamAiLoading) void fillTamNa(); }}
                  disabled={tamAiLoading || scopeNaCount === 0 || !!tamAiFills}
                  title={tamAiFills
                    ? "KI ✓"
                    : scopeNaCount === 0
                      ? "Keine N/A-Zellen"
                      : "N/A mit KI schätzen. Catalog-Coverage bleibt unverändert."}
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal transition-colors disabled:opacity-50 ${
                    tamAiFills
                      ? "border-violet-400/40 bg-violet-500/20 text-violet-700 hover:bg-violet-500/30 dark:text-violet-200"
                      : "border-violet-500/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
                  }`}
                  data-testid="button-tam-na-fill"
                >
                  {tamAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {tamAiFills ? (
                    <span>KI ✓</span>
                  ) : (
                    <>
                      <span className="sm:hidden">KI-N/A</span>
                      <span className="hidden sm:inline">N/A mit KI schätzen</span>
                    </>
                  )}
                </button>
                {tamAiFills && (
                  <button
                    type="button"
                    onClick={() => { setTamAiFills(null); setTamAiError(null); }}
                    className="inline-flex items-center rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:bg-muted/40"
                    title="KI-Schätzungen aus dieser Sitzung entfernen"
                    data-testid="button-tam-na-fill-clear"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground" data-testid="text-tam-na-legend">
                Violett/KI = Schätzung · Anteil am TAM & vs. TAM immer Formel
              </div>
              {tamAiFills && (
                <div className="text-[10px] text-violet-700 dark:text-violet-300" data-testid="text-tam-na-coverage-note">
                  {kiFillMetaLine(kiCellCount, tam.coveragePct)}
                </div>
              )}
              {tamAiError && (
                <div className="text-[10px] text-red-500" data-testid="text-tam-na-fill-error">
                  {tamAiError}
                </div>
              )}
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
                    {tam.segments.map((seg: any, i: number) => {
                      const row = tamRowView(seg, tamAiFills?.[seg.segmentName]);
                      return (
                      <tr key={i} className="hover:bg-muted/10">
                        <td className="py-1.5 pr-2 font-medium">
                          {seg.segmentName}
                          {seg.shareWarning && !row.shareIsKi && (
                            <span title="Marktanteil > 25% des zugeordneten TAM — mit Vorsicht interpretieren" className="text-amber-500 ml-1">⚠</span>
                          )}
                          {row.shareIsKi && row.shareWarning && (
                            <span title="Marktanteil > 25% des KI-TAM — mit Vorsicht interpretieren" className="text-amber-500 ml-1">⚠</span>
                          )}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">${formatNumber(seg.segmentRevenue, 1)}B</td>
                        <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-muted-foreground">{formatNumber(seg.segmentShare, 1)}%</td>
                        {row.growth === null ? (
                          <td
                            className="py-1.5 px-1.5 text-right font-mono tabular-nums text-muted-foreground/60"
                            title="Keine Vorjahreszahl fuer dieses Segment berichtet"
                          >
                            n/a
                          </td>
                        ) : (
                          <td className={`py-1.5 px-1.5 text-right font-mono tabular-nums font-medium ${row.growth >= 0 ? 'text-emerald-500' : 'text-red-500'} ${row.growthIsKi ? 'bg-violet-500/10' : ''}`} title={row.growthIsKi ? "N/A ersetzt durch KI" : undefined}>
                            {row.growth >= 0 ? '+' : ''}{formatNumber(row.growth, 1)}%
                            {row.growthIsKi && <KiBadge testId={`badge-growth-ki-${i}`} />}
                          </td>
                        )}
                        {row.tamIsKi && row.tamSize != null ? (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums bg-violet-500/10 text-violet-700 dark:text-violet-200" title="N/A ersetzt durch KI" data-testid={`cell-tam-ki-size-${i}`}>
                            ${formatNumber(row.tamSize, 0)}B
                            <KiBadge testId={`badge-tam-ki-${i}`} />
                          </td>
                        ) : row.tamSize === null ? (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-muted-foreground/60" title="Kein TAM-Markt zugeordnet">n/a</td>
                        ) : (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">${formatNumber(row.tamSize, 0)}B</td>
                        )}
                        {row.cagrIsKi ? (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums bg-violet-500/10 text-violet-700 dark:text-violet-200" title="N/A ersetzt durch KI">
                            {row.tamCagr}%
                            <KiBadge />
                          </td>
                        ) : row.unmatched ? (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-muted-foreground/60">n/a</td>
                        ) : (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-primary">{seg.tamCAGR}%</td>
                        )}
                        {row.shareIsKi && row.marketShare != null ? (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums bg-violet-500/10 text-violet-700 dark:text-violet-200" title="N/A ersetzt durch KI">
                            {formatNumber(row.marketShare, 1)}%
                            <KiBadge />
                          </td>
                        ) : row.unmatched ? (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-muted-foreground/60">n/a</td>
                        ) : (
                          <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">{formatNumber(seg.marketShare, 1)}%</td>
                        )}
                        <td className={`py-1.5 pl-1.5 text-center ${row.vsIsKi ? 'bg-violet-500/10' : ''}`} title={row.vsIsKi ? "N/A ersetzt durch KI" : undefined}>
                          {row.vs === null ? (
                            <span className="text-muted-foreground/60">n/a</span>
                          ) : row.vs ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-500 font-medium">
                              <TrendingUp className="w-2.5 h-2.5" /> Über
                              {row.vsIsKi && <KiBadge />}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium">
                              <TrendingDown className="w-2.5 h-2.5" /> Unter
                              {row.vsIsKi && <KiBadge />}
                            </span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Weighted verdict — nur wenn das Qualitaetstor eine belastbare
                  Gewichtung zugelassen hat (tamCAGR/outperforming nicht null). */}
              {tam.tamCAGR !== null && tam.tamCAGR !== undefined && tam.outperforming !== null && tam.outperforming !== undefined ? (
                <div className={`flex items-center gap-1.5 text-[10px] ${tam.outperforming ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {tam.outperforming ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  <span className="font-medium">
                    Gewichteter Branchen-CAGR: {formatNumber(tam.tamCAGR, 1)}% — Unternehmen {tam.outperforming ? 'outperformed' : 'underperformed'}
                    {' '}({tam.companyGrowth >= 0 ? '+' : ''}{formatNumber(tam.companyGrowth, 1)}% vs. {formatNumber(tam.tamCAGR, 1)}%)
                  </span>
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground/70 italic">
                  Kein belastbarer gewichteter Branchen-CAGR (Segment-TAM-Abdeckung zu gering).
                </div>
              )}
              {/* QS: umsatzgewichtetes Wachstum aus den ECHTEN Segment-Raten —
                  muss plausibel zum oben gezeigten Revenue Growth passen. */}
              {typeof tam.segmentWeightedGrowth === 'number' && isFinite(tam.segmentWeightedGrowth) && (
                <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-1">
                  <span>
                    Segment-gewichtetes Wachstum:{' '}
                    <span className={`font-mono tabular-nums font-medium ${tam.segmentWeightedGrowth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {tam.segmentWeightedGrowth >= 0 ? '+' : ''}{formatNumber(tam.segmentWeightedGrowth, 1)}%
                    </span>
                  </span>
                  <span className="text-muted-foreground/60">
                    (vs. Revenue Growth {tam.companyGrowth >= 0 ? '+' : ''}{formatNumber(tam.companyGrowth, 1)}%
                    {typeof tam.segmentGrowthCoveragePct === 'number' && tam.segmentGrowthCoveragePct < 99.5
                      ? `, Abdeckung ${formatNumber(tam.segmentGrowthCoveragePct, 0)}% des Umsatzes`
                      : ''})
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* Fallback: single growth comparison bar — nur wenn tamCAGR/outperforming
               belastbar sind (Pfad A liefert quality:'weak', aber tamCAGR ist dort
               immer eine Zahl, nie null; Guard bleibt trotzdem defensiv). */
            tam.tamCAGR !== null && tam.tamCAGR !== undefined && tam.outperforming !== null && tam.outperforming !== undefined ? (
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
                  {tam.tamCAGR >= 0 ? '+' : ''}{formatNumber(tam.tamCAGR, 1)}%
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
            ) : (
              <div className="text-[10px] text-muted-foreground/70 italic">Kein belastbarer Branchenvergleich verfügbar.</div>
            )
          )}

          {/* TAM source — dedupliziert (mehrere Segmente koennen dieselbe Quelle teilen) */}
          <div className="text-[9px] text-muted-foreground/50 mt-2 italic">
            TAM-Schätzung: {Array.from(new Set(String(tam.tamSource).split(',').map(s => s.trim()).filter(Boolean))).join(', ')}
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
          <>
          {/* PREMIUM: Show moat-justified vs speculative split */}
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
          {speculative > 15 && fwdPEPremium < 5 && (
            <div className="mt-2 text-[10px] text-amber-500/70 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
              ⚠ <span className="font-semibold">Trailing vs. Forward:</span> Das Trailing-KGV zeigt +{formatNumber(speculative, 0)}% spekulative Prämie, aber das Forward-P/E liegt bei nur {fwdPEPremium >= 0 ? '+' : ''}{formatNumber(fwdPEPremium, 1)}% zum Sektor.
              Mögliche Ursache: temporär gedrückte Gewinne (Sonderfaktoren, Investitionsphase). Der Premium Breakdown basiert auf TTM — bei normalisierten Earnings kann die Bewertung deutlich günstiger sein.
            </div>
          )}
          </>
        )}
      </div>

      {/* EPS Growth Chart */}
      {data.peerComparison?.epsHistory && data.peerComparison.epsHistory.length > 3 && (
        <div className="mt-4 pt-4 border-t border-border">
          <EpsGrowthChart data={data} />
        </div>
      )}

      {/* Peer Comparison. Banner und KI-Ticker kommen vom Server. Kennzahlen der KI-Zeilen sind FMP. */}
      {(data.peerSet?.banner || peerGap > 0 || (data.peerComparison && data.peerComparison.peers.length > 0) || (peerKiFills && peerKiFills.length > 0)) && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Peer-Vergleich (Wettbewerber)</h3>
            <button
              type="button"
              onClick={() => { if (!peerKiLoading) void fillPeerNa(); }}
              disabled={peerKiLoading || peerGap === 0 || !!peerKiFills}
              title={peerKiFills
                ? "KI ✓"
                : peerGap === 0
                  ? "Keine N/A-Zellen"
                  : "N/A mit KI schätzen. Nur Ticker. Kennzahlen kommen von FMP."}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal transition-colors disabled:opacity-50 ${
                peerKiFills
                  ? "border-violet-400/40 bg-violet-500/20 text-violet-700 hover:bg-violet-500/30 dark:text-violet-200"
                  : "border-violet-500/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
              }`}
              data-testid="button-peer-na-fill"
            >
              {peerKiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {peerKiFills ? (
                <span>KI ✓</span>
              ) : (
                <>
                  <span className="sm:hidden">KI-N/A</span>
                  <span className="hidden sm:inline">N/A mit KI schätzen</span>
                </>
              )}
            </button>
            {peerKiFills && (
              <button
                type="button"
                onClick={() => { setPeerKiFills(null); setPeerKiError(null); }}
                className="inline-flex items-center rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:bg-muted/40"
                title="KI-Vorschläge aus dieser Sitzung entfernen"
                data-testid="button-peer-na-fill-clear"
              >
                Clear
              </button>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mb-2" data-testid="text-peer-na-legend">
            Violett/KI = vorgeschlagener Ticker · Kennzahlen nur FMP · zählt nicht in den Relativ-Score
          </div>
          {peerKiFills && (
            <div className="text-[10px] text-violet-700 dark:text-violet-300 mb-2" data-testid="text-peer-na-note">
              {`KI-Vorschlag: ${peerKiFills.length} Ticker · ${PEER_NA_NOTE}`}
            </div>
          )}
          {peerKiError && (
            <div className="text-[10px] text-red-500 mb-2" data-testid="text-peer-na-fill-error">
              {peerKiError}
            </div>
          )}
          {data.peerSet?.banner && (
            <div
              className="mb-2 text-[11px] text-amber-700 dark:text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5"
              role="status"
              data-testid="peer-set-incomplete-banner"
            >
              {data.peerSet.banner}
            </div>
          )}
          {((data.peerComparison && data.peerComparison.peers.length > 0) || (peerKiFills && peerKiFills.length > 0)) && (
            <PeerComparison data={data} onOverridesChange={onPeerOverridesChange} kiPeers={peerKiFills ?? []} />
          )}
        </div>
      )}
    </SectionCard>
  );
}

function toTamNaRef(s: {
  segmentName?: string;
  segmentRevenue?: number;
  segmentGrowth?: number | null;
  matched?: boolean;
  tamSize?: number | null;
  tamCAGR?: number | null;
}): TamNaSegmentRef | null {
  const name = typeof s.segmentName === "string" ? s.segmentName.trim() : "";
  if (!name) return null;
  if (!(typeof s.segmentRevenue === "number" && Number.isFinite(s.segmentRevenue) && s.segmentRevenue >= 0)) return null;
  return {
    segmentName: name,
    segmentRevenue: s.segmentRevenue,
    segmentGrowth: typeof s.segmentGrowth === "number" && Number.isFinite(s.segmentGrowth) ? s.segmentGrowth : null,
    matched: s.matched,
    tamSize: typeof s.tamSize === "number" && Number.isFinite(s.tamSize) ? s.tamSize : null,
    tamCAGR: typeof s.tamCAGR === "number" && Number.isFinite(s.tamCAGR) ? s.tamCAGR : null,
  };
}

function tamRowView(seg: {
  segmentName: string;
  segmentRevenue: number;
  segmentGrowth?: number | null;
  segmentShare?: number;
  matched?: boolean;
  tamSize?: number | null;
  tamCAGR?: number | null;
  marketShare?: number | null;
  shareWarning?: boolean;
}, fill: TamNaFill | undefined) {
  const ref = toTamNaRef(seg);
  const unmatched = seg.matched === false;
  const factGrowth = typeof seg.segmentGrowth === "number" && Number.isFinite(seg.segmentGrowth) ? seg.segmentGrowth : null;
  const kiGrowth = factGrowth == null && fill && typeof fill.segmentGrowth === "number" && Number.isFinite(fill.segmentGrowth)
    ? fill.segmentGrowth
    : null;
  const growth = factGrowth ?? kiGrowth;
  const factTam = ref ? factTamSize(ref) : null;
  const factCagr = ref ? factTamCagr(ref) : null;
  const kiTam = unmatched && fill && typeof fill.tamSize === "number" && Number.isFinite(fill.tamSize) && fill.tamSize > 0
    ? fill.tamSize
    : null;
  const kiCagr = unmatched && fill && typeof fill.tamCAGR === "number" && Number.isFinite(fill.tamCAGR) ? fill.tamCAGR : null;
  const tamSize = factTam ?? kiTam;
  const tamCagr = factCagr ?? kiCagr;
  const marketShare = kiTam != null ? deriveTamShare(seg.segmentRevenue, kiTam) : seg.marketShare;
  const vs = deriveOutperforming(growth, tamCagr);
  return {
    unmatched,
    growth,
    growthIsKi: kiGrowth != null,
    tamSize,
    tamIsKi: kiTam != null,
    tamCagr,
    cagrIsKi: kiCagr != null,
    marketShare,
    shareIsKi: kiTam != null,
    shareWarning: kiTam != null ? (marketShare ?? 0) > TAM_NA_SHARE_WARN : !!seg.shareWarning,
    vs,
    vsIsKi: vs != null && (kiGrowth != null || kiCagr != null),
  };
}

function KiBadge({ testId }: { testId?: string }) {
  return (
    <span
      className="ml-1 inline-flex items-center rounded border border-violet-500/40 bg-violet-500/15 px-1 align-middle text-[8px] font-bold uppercase tracking-wide text-violet-300"
      title="N/A ersetzt durch KI"
      aria-label="N/A ersetzt durch KI"
      data-testid={testId}
    >
      KI
    </span>
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
