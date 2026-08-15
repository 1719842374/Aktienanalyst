import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { calculateWACC } from "../../lib/calculations";
import { formatPercentNoSign, formatNumber } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section4({ data }: Props) {
  const sp = data.sectorProfile;
  const rfr = 4.2;
  const mrp = 5.5;
  const cod = 5.0;
  const taxRate = 0.21;
  const debtRatio = (data.marketCap + data.totalDebt) > 0 ? data.totalDebt / (data.marketCap + data.totalDebt) : 0;

  // Use sector profile WACC scenarios as reference
  const waccFromProfile = sp.waccScenarios;

  // Mirror the DCF-Modell beta (sector-WACC anchored, see Section2/Section5)
  const debtRatioVal = data.totalDebt > 0 ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0) : 10;
  const evFrac = (100 - debtRatioVal) / 100;
  const dvFrac = debtRatioVal / 100;
  const debtCostPart = dvFrac * cod * (1 - taxRate);
  const impliedBeta = Math.max(0.5, Math.min(1.8,
    (waccFromProfile.avg - debtCostPart - evFrac * rfr) / (evFrac * mrp)
  ));
  const dcfBeta = +Math.min(impliedBeta, data.beta5Y + 0.1).toFixed(2);

  const scenarios = useMemo(() => [
    { name: "Conservative", beta: data.beta5Y * 1.1, dr: debtRatio * 1.1, rfr: rfr + 0.5, profileWACC: waccFromProfile.kons },
    { name: "Average", beta: data.beta5Y, dr: debtRatio, rfr, profileWACC: waccFromProfile.avg },
    { name: "Optimistic", beta: data.beta5Y * 0.9, dr: debtRatio * 0.9, rfr: rfr - 0.3, profileWACC: waccFromProfile.opt },
  ], [data.beta5Y, debtRatio, waccFromProfile]);

  const waccResults = scenarios.map((s) => ({
    ...s,
    wacc: calculateWACC(s.beta, s.rfr, mrp, s.dr, cod, taxRate),
  }));

  /**
   * PEG — WORK_SECTION4_DATA_BUGS.md §3 (P0)
   *
   * Regel: Eine Formel = dieselben Inputs in der Box. Nie Zähler/Nenner aus
   * Trailing-Pfad und Ergebnis aus Server-Lynch/Forward-pegRatio mischen
   * (Bug: BN zeigte 88.3 ÷ 10.9 = 0.04; AMZN 31.7 ÷ 57.2% = 0.36).
   *
   * Primary (Anzeige): Trailing PEG = peRatio ÷ epsGrowth5Y_%
   * Secondary (nur Hinweis): data.pegRatio wenn Lynch/Forward und abweichend.
   */
  const pegCalc = useMemo(() => {
    const pe = data.peRatio;
    const growth = data.epsGrowth5Y;

    // growth <= 0 oder pe <= 0 → n/a (kein Fake-0.04)
    const trailingOk = typeof pe === "number" && pe > 0
      && typeof growth === "number" && growth > 0 && isFinite(pe) && isFinite(growth);
    const trailingPeg = trailingOk ? pe / growth : null;

    // Sanity: extrem niedriger PEG bei hohem P/E und moderatem Wachstum → Flag
    // (früher oft Symptom der Pfad-Vermischung)
    const inconsistencyFlag = trailingPeg != null
      && trailingPeg < 0.1
      && pe > 20
      && growth < 30;

    // Server/Lynch-PEG nur als Zusatz, wenn klar abweichend und dokumentiert
    const serverPeg = typeof data.pegRatio === "number" && data.pegRatio > 0 && isFinite(data.pegRatio)
      ? data.pegRatio
      : null;
    const serverDiffers = trailingPeg != null && serverPeg != null
      && Math.abs(serverPeg - trailingPeg) > 0.05;

    const lynchLabel = data.lynchClass === "cyclical"    ? "Zykliker (Mid-Cycle PE)" :
                       data.lynchClass === "fast_grower" ? "Fast Grower (Forward PE)" :
                       data.lynchClass === "slow_grower" ? "Slow Grower (PEGY)" :
                       data.lynchClass === "turnaround"  ? "Turnaround (Forward PE)" :
                       data.lynchClass === "stalwart"    ? "Stalwart (5Y CAGR)" : null;

    const steps: string[] = trailingPeg === null
      ? [
          "Trailing PEG = P/E (TTM) / EPS Growth 5Y (%)",
          `PEG nicht aussagekraeftig — P/E (${formatNumber(pe, 1)}) oder Wachstum (${formatNumber(growth, 1)}%) <= 0 / fehlend`,
        ]
      : [
          "Trailing PEG = P/E (TTM) / EPS Growth 5Y (%)",
          `PEG = ${formatNumber(pe, 1)} / ${formatNumber(growth, 1)} = ${formatNumber(trailingPeg, 2)}`,
          trailingPeg < 1 ? "-> PEG unter 1.0: Unterbewertet relativ zum Wachstum" :
          trailingPeg < 1.5 ? "-> PEG 1.0–1.5: Fair bewertet" :
          trailingPeg < 2 ? "-> PEG 1.5–2.0: Leichte Praemie" :
          "-> PEG ueber 2.0: Hohe Bewertungsprämie zum Wachstum",
        ];

    if (inconsistencyFlag) {
      steps.push("Sanity: PEG unter 0.1 bei P/E ueber 20 und Growth unter 30 % — Dateninkonsistenz pruefen");
    }
    if (serverDiffers) {
      steps.push(
        lynchLabel
          ? `Hinweis Server/Lynch (${lynchLabel}): PEG ${formatNumber(serverPeg, 2)}` +
            (data.lynchPEGBasis ? ` — ${data.lynchPEGBasis}` : " (andere Inputs als Trailing; nicht in der Box oben)")
          : `Hinweis Server-PEG: ${formatNumber(serverPeg, 2)} (Forward/Lynch-Pfad; Box oben = nur Trailing)`
      );
    }

    return {
      pe,
      growth,
      peg: trailingPeg,
      mode: "trailing" as const,
      inconsistencyFlag,
      serverPeg: serverDiffers ? serverPeg : null,
      steps,
    };
  }, [data.peRatio, data.epsGrowth5Y, data.pegRatio, data.lynchClass, data.lynchPEGBasis]);

  return (
    <SectionCard number={4} title="BEWERTUNGSKENNZAHLEN">
      {/* WACC Table */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">WACC Scenarios (Damodaran)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Scenario</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Beta</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rf Rate</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">D/V</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">WACC Live (CAPM)</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">WACC Sektor-Ref.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {waccResults.map((s, i) => (
                <tr key={i} className={i === 1 ? "bg-primary/5" : ""}>
                  <td className="py-2 px-2 font-medium">{s.name}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatNumber(s.beta)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatPercentNoSign(s.rfr, 1)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatPercentNoSign(s.dr * 100, 1)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold">{formatPercentNoSign(s.wacc, 2)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-primary">{formatPercentNoSign(s.profileWACC, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* WACC-Methoden-Erklärung */}
        <div className="text-[10px] text-muted-foreground bg-muted/20 rounded px-2 py-1.5 mt-2 space-y-0.5">
          <div><span className="font-semibold text-foreground/70">WACC Live (CAPM)</span> — Echtzeit-Berechnung aus aktuellem Markt-Beta ({formatNumber(data.beta5Y, 2)}), Rf={rfr}%, MRP={mrp}%. Wird für die WACC-Sensitivitäts-Tabelle (unten) genutzt.</div>
          <div><span className="font-semibold text-foreground/70">WACC Sektor-Ref.</span> — Sektor-Heuristik (Damodaran-Datenbank, sektoradjustiertes Beta). <span className="text-primary/80">Diese Werte nutzt das DCF-Modell (Section 5) und Risk Inversion (Section 8)</span> — bewusst konservativer als Markt-Beta, da implizites Beta aus Sektor-Medianrenditen abgeleitet.</div>
          <div className="text-amber-400/70">Abweichung zwischen beiden Spalten ist methodisch, kein Fehler — aber Analyst sollte die Wahl transparent dokumentieren.</div>
        </div>
        <RechenWeg title="WACC Rechenweg" steps={[
          `WACC = E/V × Re + D/V × Rd × (1 - T)`,
          `Re (Live CAPM) = Rf + β × MRP = ${rfr}% + ${formatNumber(data.beta5Y)} × ${mrp}% = ${formatPercentNoSign(rfr + data.beta5Y * mrp, 2)}`,
          `Re (Sektor-Ref.) = aus Damodaran-Sektordatenbank (sektoradjustiertes Beta = ${formatNumber(dcfBeta, 2)})`,
          `D/V = ${formatPercentNoSign(debtRatio * 100, 1)}`,
          `WACC Live (Avg) = ${formatPercentNoSign((1 - debtRatio) * 100, 1)} × ${formatPercentNoSign(rfr + data.beta5Y * mrp, 2)} + ${formatPercentNoSign(debtRatio * 100, 1)} × ${cod}% × (1 - ${taxRate * 100}%) = ${formatPercentNoSign(waccResults[1].wacc, 2)}`,
          `WACC Sektor-Ref. (Avg) = ${waccFromProfile.avg}% (DCF-Basis: Section 5 startet hier)`,
        ]} />
        {dcfBeta && Math.abs(dcfBeta - data.beta5Y) > 0.1 && (
          <div className="text-[10px] text-amber-400/80 mt-1">
            {`DCF-Modell nutzt adjustiertes β=${dcfBeta.toFixed(2)} — WACC-Tabelle zeigt Markt-β=${data.beta5Y?.toFixed(2)}`}
          </div>
        )}
      </div>

      {/* WACC Sensitivity */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">WACC Sensitivity to Interest Rates</h3>
        <div className="grid grid-cols-3 gap-2">
          {[-100, 0, 100].map((bp) => {
            const adjRfr = rfr + bp / 100;
            const adjWacc = calculateWACC(data.beta5Y, adjRfr, mrp, debtRatio, cod + bp / 200, taxRate);
            return (
              <div key={bp} className="bg-muted/30 rounded-md p-2.5 border border-border/50 text-center">
                <div className="text-[10px] text-muted-foreground">{bp >= 0 ? "+" : ""}{bp}bp</div>
                <div className="text-sm font-semibold font-mono tabular-nums mt-0.5">{formatPercentNoSign(adjWacc, 2)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PEG Calculation — Inputs = Ergebnis (Trailing) */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          PEG Ratio <span className="font-normal normal-case tracking-normal">(Trailing: P/E TTM / EPS Growth 5Y)</span>
        </h3>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground">P/E (TTM)</div>
            <div className="text-lg font-semibold font-mono tabular-nums">{formatNumber(pegCalc.pe, 1)}</div>
          </div>
          <span className="text-lg text-muted-foreground">/</span>
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground">EPS Growth 5Y</div>
            <div className="text-lg font-semibold font-mono tabular-nums">{formatNumber(pegCalc.growth, 1)}%</div>
          </div>
          <span className="text-lg text-muted-foreground">=</span>
          <div className={`rounded-md p-3 border ${pegCalc.peg === null ? "bg-muted/30 border-border/50" : pegCalc.peg < 1 ? "bg-emerald-500/10 border-emerald-500/20" : pegCalc.peg < 2 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20"}`}>
            <div className="text-[10px] text-muted-foreground">PEG</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${pegCalc.peg === null ? "text-muted-foreground" : pegCalc.peg < 1 ? "text-emerald-500" : pegCalc.peg < 2 ? "text-amber-500" : "text-red-500"}`}>
              {pegCalc.peg === null ? "n/a" : formatNumber(pegCalc.peg, 2)}
            </div>
          </div>
        </div>
        {pegCalc.inconsistencyFlag && (
          <div className="text-[10px] text-amber-400/90 mt-1.5">
            {"Sanity-Flag: PEG unter 0.1 bei P/E ueber 20 und Growth unter 30 % — Dateninkonsistenz pruefen"}
          </div>
        )}
        {pegCalc.serverPeg != null && (
          <div className="text-[10px] text-muted-foreground mt-1">
            Server/Lynch-PEG (andere Inputs): <span className="font-mono">{formatNumber(pegCalc.serverPeg, 2)}</span> — nicht mit der Trailing-Box vermischt
          </div>
        )}
        <RechenWeg title="PEG Rechenweg" steps={pegCalc.steps} />
      </div>
    </SectionCard>
  );
}
