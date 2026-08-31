import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import {
  calculateReverseDCF, calculateFCFFDCF, buildDefaultDCFParams,
  allocateProgramToFcf, capOverlays, forwardDcfWithFiscal,
  type FiscalProgramForFcf,
} from "../../lib/calculations";
import { formatNumber, formatPercentNoSign } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function ReverseDCFSection({ data }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;

  // WACC: identisch mit Section 17 (SummarySection) — CAPM-WACC des DCF-Modells
  // via buildDefaultDCFParams, damit g* in Sektion 14 und 17 übereinstimmt.
  const baseParams = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);
  const dcfWacc = useMemo(() => calculateFCFFDCF(baseParams).wacc, [baseParams]);

  const result = useMemo(() => calculateReverseDCF({
    currentPrice: data.currentPrice,
    fcfBase: data.fcfTTM,
    wacc: dcfWacc,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    fcfHaircut: data.fcfHaircut ?? 0,
    sectorG1: sp.growthAssumptions?.g1 ?? 0,
    epsGrowthNext5Y: data.epsGrowth5Y ?? 0,
  }), [data, sp, netDebt, dcfWacc]);

  // === Sprint D1 §4 (WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md) — g*-Gap-Analyse, NUR Punkt A+D ("Hoch") ===
  // gap = g* (Markt-implizit, bleibt clean/ohne Fiscal-Overlay) − eigene g1 (unser Modell,
  // inkl. Lynch-Klassen-Defaults via buildDefaultDCFParams/baseParams). Reine Anzeige/Warnung —
  // KEINE automatische Ueberschreibung der User-Wachstumsannahmen (Ticket-Regel, Spec §4.3).
  const gStarGap = useMemo(() => {
    const gap = result.impliedGrowth - baseParams.revenueGrowthP1;
    let flag: "aligned" | "market_more_optimistic" | "extreme";
    if (Math.abs(gap) <= 3) flag = "aligned";
    else if (gap > 3 && gap <= 10) flag = "market_more_optimistic";
    else if (gap > 10) flag = "extreme";
    else flag = "aligned"; // Markt implizit vorsichtiger als unser Modell — kein Warn-Flag nötig
    return { gap, flag };
  }, [result.impliedGrowth, baseParams.revenueGrowthP1]);

  const ratingColor =
    result.rating === "realistic" ? "text-emerald-500" :
    result.rating === "sportlich" ? "text-amber-500" :
    result.rating === "negativ" ? "text-blue-400" :
    "text-red-500";
  const ratingBg =
    result.rating === "realistic" ? "bg-emerald-500/10 border-emerald-500/20" :
    result.rating === "sportlich" ? "bg-amber-500/10 border-amber-500/20" :
    result.rating === "negativ" ? "bg-blue-500/10 border-blue-500/20" :
    "bg-red-500/10 border-red-500/20";

  const ratingLabel =
    result.rating === "realistic" ? "Realistic" :
    result.rating === "sportlich" ? "Ambitious (sportlich)" :
    result.rating === "negativ" ? "Negativ / FCF-negativ" :
    "Unrealistic";

  // === WORK_REVERSE_DCF_BRIDGE.md Teil 3 — additiver Fiscal-Overlay-Block ===
  // g* (result.impliedGrowth) bleibt hiervon vollständig unberührt — dieser Block
  // berechnet NUR einen separaten Forward-DCF-Vergleich (FV base vs FV fiscal-adjusted).
  // Rendert NICHTS, wenn kein Catalyst mit type: 'fiscal' und addressableVolume gesetzt ist
  // (kein leerer Platzhalter, siehe Aufgabenstellung).
  const fiscalOverlayView = useMemo(() => {
    const fiscalCatalysts = (data.catalysts ?? []).filter(
      c => c.type === 'fiscal' && typeof c.addressableVolume === 'number' && c.addressableVolume > 0
    );
    if (fiscalCatalysts.length === 0) return null;

    const fcf0 = data.fcfTTM * (1 - (data.fcfHaircut ?? 0) / 100);
    const baseGrowthDecimal = (sp.growthAssumptions?.g1 ?? 5) / 100;
    const waccDecimal = dcfWacc / 100;

    const rawOverlays = fiscalCatalysts.flatMap(c => {
      const program: FiscalProgramForFcf = {
        id: c.name,
        volumeUsdBn: (c.addressableVolume ?? 0) / 1e9,
        startYear: c.startYear ?? new Date().getUTCFullYear(),
        endYear: c.endYear ?? new Date().getUTCFullYear() + 4,
        source: c.source,
      };
      return allocateProgramToFcf({
        program,
        companyShare: 0.10, // konservativer Default (Guardrail §3.2: ≤ 5–15 %)
        fcfMargin: 0.15,
        probability: c.probability ?? (c.confidence === 'high' ? 0.75 : c.confidence === 'medium' ? 0.5 : 0.25),
      });
    });
    const cappedOverlays = capOverlays(fcf0, rawOverlays, 0.30);

    const base = forwardDcfWithFiscal({
      fcf0,
      baseGrowth: baseGrowthDecimal,
      wacc: waccDecimal,
      overlays: [],
      netDebt,
      shares: data.sharesOutstanding,
    });
    const withFiscal = forwardDcfWithFiscal({
      fcf0,
      baseGrowth: baseGrowthDecimal,
      wacc: waccDecimal,
      overlays: cappedOverlays,
      netDebt,
      shares: data.sharesOutstanding,
    });

    return { base, withFiscal, programCount: fiscalCatalysts.length };
  }, [data.catalysts, data.fcfTTM, data.fcfHaircut, data.sharesOutstanding, sp, dcfWacc, netDebt]);

  return (
    <SectionCard number={14} title="REVERSE DCF">
      {result.rating === "unrealistic" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <div className="text-xs font-bold text-red-500">WARNUNG: Implizierte Wachstumsrate unrealistisch</div>
            <div className="text-[11px] text-red-400 mt-0.5">
              Der Markt preist g* = {formatPercentNoSign(result.impliedGrowth)} ein —
              über {formatPercentNoSign(result.referenceGrowth * 1.5)} (1,5× Referenzwachstum für diesen Sektor/Titel).
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Implied Perpetual Growth Rate g*</div>
          <div className={`text-3xl font-bold font-mono tabular-nums ${ratingColor}`}>
            {formatPercentNoSign(result.impliedGrowth)}
          </div>
          <div className={`inline-block mt-2 px-2.5 py-1 rounded-md text-xs font-semibold border ${ratingBg} ${ratingColor}`}>
            {ratingLabel}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5">
            Referenzwachstum: {formatPercentNoSign(result.referenceGrowth)}
            {" "}(max Sektor g1 / EPS-Konsens 5J / 3%)
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50 text-xs space-y-1.5">
            <div className="font-semibold text-muted-foreground">Formula</div>
            <div className="font-mono tabular-nums">EV = FCF / (WACC - g*)</div>
            <div className="font-mono tabular-nums">g* = WACC - FCF / EV</div>
          </div>

          <div className="bg-muted/30 rounded-md p-3 border border-border/50 text-xs text-muted-foreground">
            <span className="font-semibold">Difference to Inverted DCF:</span> The Reverse DCF asks "what growth rate does the market price imply?" while the Inverted DCF applies risk-adjusted parameters to find a fair value.
          </div>
        </div>
      </div>

      {/* Sprint D1 §4 (WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md) — g*-Gap-Analyse (Punkt A+D, "Hoch"-Priorität).
          g* selbst bleibt unveraendert clean (oben, kein Fiscal-Overlay) — dieser Block vergleicht
          NUR zur Anzeige g* gegen unser eigenes Modell-g1 (inkl. Lynch-Klassen-Defaults). Keine
          automatische Ueberschreibung der User-Wachstumsannahmen. */}
      <div className={`rounded-md p-3 border text-xs mt-4 ${
        gStarGap.flag === "extreme" ? "bg-red-500/10 border-red-500/30" :
        gStarGap.flag === "market_more_optimistic" ? "bg-amber-500/10 border-amber-500/30" :
        "bg-muted/30 border-border/50"
      }`} data-testid="gstar-gap-analysis">
        <div className={`font-semibold uppercase tracking-wider text-[10px] mb-1 ${
          gStarGap.flag === "extreme" ? "text-red-500" :
          gStarGap.flag === "market_more_optimistic" ? "text-amber-500" :
          "text-muted-foreground"
        }`}>
          g*-Gap-Analyse: Markt- vs. Modell-Wachstum
        </div>
        <div className="text-muted-foreground">
          Markt preist g* = {formatPercentNoSign(result.impliedGrowth)} ein vs. unser Modell g1 = {formatPercentNoSign(baseParams.revenueGrowthP1)}
          {data.lynchClass ? ` (Lynch-Klasse "${data.lynchClass}")` : ""}.
          {" "}Gap = {gStarGap.gap >= 0 ? "+" : ""}{formatPercentNoSign(gStarGap.gap)}
          {" "}{gStarGap.flag === "extreme"
            ? "— Markt preist deutlich mehr Wachstum ein als unser Modell annimmt (Gap > 10pp)."
            : gStarGap.flag === "market_more_optimistic"
            ? "— Markt ist optimistischer als unser Modell (Gap 3–10pp)."
            : "— Markt- und Modell-Wachstum sind im Rahmen üblicher Schwankung (|Gap| ≤ 3pp)."}
        </div>
      </div>

      {fiscalOverlayView && (
        <div className="bg-muted/30 rounded-md p-3 border border-border/50 text-xs space-y-1.5 mt-4">
          <div className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
            Forward DCF — Fiscal-Overlay ({fiscalOverlayView.programCount} Programm{fiscalOverlayView.programCount === 1 ? "" : "e"}, Cap 30% FCF₀)
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[10px] text-muted-foreground">FV (base)</div>
              <div className="font-mono tabular-nums text-base font-semibold">${formatNumber(fiscalOverlayView.base.fairValuePerShare)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">FV (fiscal-adjusted)</div>
              <div className="font-mono tabular-nums text-base font-semibold text-emerald-500">${formatNumber(fiscalOverlayView.withFiscal.fairValuePerShare)}</div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground pt-1">
            g* bleibt unverändert clean (Reverse-DCF ohne Fiscal-Overlay, siehe oben). Overlay wirkt ausschließlich auf diesen separaten Forward-DCF-Pfad, probability-gewichtet, niemals auf g* selbst (WORK_REVERSE_DCF_BRIDGE.md §3.4).
          </div>
        </div>
      )}

      <RechenWeg title="Reverse DCF Rechenweg" steps={[
        `EV = Price × Shares + Net Debt`,
        `EV = $${formatNumber(data.currentPrice)} × ${formatNumber(data.sharesOutstanding / 1e9, 2)}B + $${formatNumber(netDebt / 1e9, 2)}B`,
        `EV = $${formatNumber((data.currentPrice * data.sharesOutstanding + netDebt) / 1e9, 2)}B`,
        ...(data.fcfHaircut ? [`FCF (nach ${data.fcfHaircut}% Haircut) = $${formatNumber(data.fcfTTM * (1 - (data.fcfHaircut ?? 0) / 100) / 1e9, 2)}B`] : []),
        `WACC = ${formatPercentNoSign(dcfWacc)} (CAPM-WACC des DCF-Modells, Sektion 5 — identisch mit Sektion 17)`,
        `g* = WACC - FCF/EV = ${formatPercentNoSign(dcfWacc)} - $${formatNumber(data.fcfTTM * (1 - (data.fcfHaircut ?? 0) / 100) / 1e9, 2)}B / $${formatNumber((data.currentPrice * data.sharesOutstanding + netDebt) / 1e9, 2)}B`,
        `g* = ${formatPercentNoSign(result.impliedGrowth)}`,
        `Referenzwachstum = max(Sektor g1 ${formatPercentNoSign(sp.growthAssumptions?.g1 ?? 0)}, EPS-5J ${formatPercentNoSign(data.epsGrowth5Y ?? 0)}, 3%) = ${formatPercentNoSign(result.referenceGrowth)}`,
        `Rating: g* ${result.rating === "unrealistic" ? ">" : result.rating === "sportlich" ? ">" : "≤"} ${result.rating === "unrealistic" ? "1,5×" : result.rating === "sportlich" ? "1×" : "1×"} Referenz → ${ratingLabel}`,
        ``,
        `=== g*-Gap-Analyse (Sprint D1 §4) ===`,
        `Unser Modell g1 = ${formatPercentNoSign(baseParams.revenueGrowthP1)}${data.lynchClass ? ` (Lynch-Klasse "${data.lynchClass}", buildDefaultDCFParams)` : ""}`,
        `Gap = g* - eigene g1 = ${formatPercentNoSign(result.impliedGrowth)} - ${formatPercentNoSign(baseParams.revenueGrowthP1)} = ${gStarGap.gap >= 0 ? "+" : ""}${formatPercentNoSign(gStarGap.gap)}`,
        `Flag: ${gStarGap.flag} (aligned: |Gap|≤3pp, market_more_optimistic: 3–10pp, extreme: >10pp)`,
      ]} />
    </SectionCard>
  );
}
