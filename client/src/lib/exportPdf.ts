import type { StockAnalysis } from "@shared/schema";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function f(v: number | null | undefined, d = 1): string { return v != null && isFinite(v) ? v.toFixed(d) : "—"; }
function fB(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v/1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v/1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v/1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

export async function exportAnalysisPdf(data: StockAnalysis) {
  const doc = new jsPDF("portrait", "mm", "a4");
  const W = doc.internal.pageSize.getWidth();
  const M = 12;
  let y = 12;
  const maxY = 280;

  const bg = () => { doc.setFillColor(12, 18, 35); doc.rect(0, 0, W, 297, "F"); };
  bg(); // First page background

  function np(needed = 15) { if (y + needed > maxY) { doc.addPage(); bg(); y = 12; } }
  function sec(num: number, title: string) {
    np(14);
    doc.setFillColor(20, 30, 50);
    doc.rect(M, y, W - 2 * M, 7, "F");
    doc.setTextColor(80, 160, 240);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(`${num}  ${title}`, M + 2, y + 5);
    y += 10;
  }
  function sub(t: string) { np(8); doc.setFontSize(7); doc.setFont("helvetica","bold"); doc.setTextColor(130,145,170); doc.text(t, M, y+3); y += 5; }
  function row(label: string, val: string, indent = 0) {
    np(5);
    doc.setFontSize(7); doc.setFont("helvetica","normal"); doc.setTextColor(130,135,150);
    doc.text(label, M + indent, y + 3);
    doc.setTextColor(210,215,225); doc.setFont("helvetica","bold");
    doc.text(val, W - M, y + 3, { align: "right" });
    y += 4.5;
  }
  function para(text: string | undefined) {
    if (!text) return;
    np(12);
    doc.setFontSize(6.5); doc.setFont("helvetica","normal"); doc.setTextColor(170,175,185);
    const lines = doc.splitTextToSize(text, W - 2 * M - 2);
    doc.text(lines, M + 1, y + 2.5);
    y += lines.length * 3 + 3;
  }
  function tbl(headers: string[], rows: string[][]) {
    np(8 + rows.length * 4.5);
    autoTable(doc, {
      startY: y, head: [headers], body: rows,
      margin: { left: M, right: M },
      styles: { fontSize: 6, textColor: [190, 195, 210], fillColor: [15, 22, 40], cellPadding: 1.5, lineColor: [35, 45, 65], lineWidth: 0.1 },
      headStyles: { fillColor: [25, 35, 55], textColor: [110, 155, 210], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [18, 26, 45] },
    });
    y = (doc as any).lastAutoTable.finalY + 3;
  }

  // ====================== HEADER ======================
  doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(80,160,240);
  doc.text("Stock Analyst Pro", M, y + 4);
  doc.setFontSize(7); doc.setTextColor(100,110,130);
  doc.text(`${data.ticker} — ${data.companyName} | ${data.sector} / ${data.industry}`, M, y + 9);
  doc.text(`${new Date().toLocaleDateString("de-DE")} | Alle Werte in ${data.currency || "USD"}`, W - M, y + 9, { align: "right" });
  y += 14;

  // Warnings
  if (data.consistencyWarnings?.length) {
    for (const w of data.consistencyWarnings) {
      np(7);
      const c = w.severity === "critical" ? [200,50,50] : w.severity === "warning" ? [200,150,30] : [60,120,200];
      doc.setFillColor(c[0]/8, c[1]/8, c[2]/8+10);
      doc.setDrawColor(c[0], c[1], c[2]);
      doc.roundedRect(M, y, W-2*M, 6, 1, 1, "FD");
      doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(c[0],c[1],c[2]);
      doc.text(`⚠ ${w.title}: ${w.detail.substring(0,120)}`, M+2, y+4);
      y += 8;
    }
  }

  // ====================== S1: DATENAKTUALITÄT ======================
  sec(1, "DATENAKTUALITÄT & PLAUSIBILITÄT");
  row("Kurs", `$${data.currentPrice?.toFixed(2) || "—"}`);
  row("Market Cap", fB(data.marketCap));
  row("P/E (TTM)", f(data.peRatio));
  row("Forward P/E", f(data.forwardPE));
  row("PEG", f(data.pegRatio, 2));
  row("EV/EBITDA", f(data.evEbitda));
  row("Beta (5Y)", f(data.beta5Y, 2));
  row("FCF TTM", fB(data.fcfTTM));
  row("FCF Margin", `${f(data.fcfMargin)}%`);
  row("EPS Growth 5Y", `${f(data.epsGrowth5Y)}%`);
  sub("Analysten");
  row("Median PT", `$${data.analystPT?.median?.toFixed(2) || "—"}`);
  row("High / Low PT", `$${data.analystPT?.high?.toFixed(2) || "—"} / $${data.analystPT?.low?.toFixed(2) || "—"}`);
  const ptUp = data.analystPT?.median && data.currentPrice ? ((data.analystPT.median - data.currentPrice)/data.currentPrice*100) : null;
  row("PT Upside", ptUp != null ? `${ptUp > 0 ? "+" : ""}${f(ptUp)}%` : "—");

  // ====================== S2: INVESTMENTTHESE ======================
  sec(2, "INVESTMENTTHESE & KATALYSATOREN");
  para(data.growthThesis);
  row("Peter Lynch", data.catalystReasoning?.lynchClassification || "—");
  row("Moat", data.moatRating || "—");
  row("FCF Strength", `${f(data.fcfMargin)}% Margin • ${fB(data.fcfTTM)} TTM`);
  row("Gov. Exposure", `${data.governmentExposure || 0}%`);

  if (data.catalysts?.length) {
    sub("Katalysatoren");
    tbl(
      ["#", "Name", "Timeline", "PoS%", "Brutto↑", "Einpr%", "Netto↑", "GB%"],
      data.catalysts.map((c, i) => [
        `K${i+1}`, c.name.substring(0,35), c.timeline,
        `${c.pos}%`, `+${f(c.bruttoUpside)}%`, `${c.einpreisungsgrad}%`,
        `+${f(c.nettoUpside,2)}%`, `${f(c.gb,2)}%`,
      ])
    );
    const totalGB = data.catalysts.reduce((s, c) => s + c.gb, 0);
    row("Total Upside (Σ GB)", `+${f(totalGB, 2)}%`);
  }

  // ====================== S3: ZYKLUSANALYSE ======================
  sec(3, "ZYKLUS- & STRUKTURANALYSE");
  row("Zyklusklassifikation", data.cycleClassification || "—");
  row("Politischer Zyklus", data.politicalCycle || "—");

  // ====================== S4: BEWERTUNG ======================
  sec(4, "BEWERTUNGSKENNZAHLEN");
  const sp = data.sectorProfile;
  if (sp?.waccScenarios) {
    tbl(["Szenario", "WACC"], [
      ["Konservativ", `${sp.waccScenarios.kons}%`],
      ["Average", `${sp.waccScenarios.avg}%`],
      ["Optimistisch", `${sp.waccScenarios.opt}%`],
    ]);
  }
  row("PEG Ratio", f(data.pegRatio, 2));

  // ====================== S5: DCF-MODELL ======================
  sec(5, "DCF-MODELL (FCFF)");
  const opM = data.operatingIncome && data.revenue ? (data.operatingIncome/data.revenue*100) : null;
  row("Revenue", fB(data.revenue));
  row("Operating Income (EBIT)", fB(data.operatingIncome));
  row("EBIT-Margin", `${f(opM)}%`);
  row("EBITDA", fB(data.ebitda));
  row("Shares Outstanding", data.sharesOutstanding ? `${(data.sharesOutstanding/1e6).toFixed(0)}M` : "—");
  row("Net Debt", fB(data.totalDebt && data.cashEquivalents ? data.totalDebt - data.cashEquivalents : null));

  // ====================== S6: CRV ======================
  sec(6, "RISIKOADJUSTIERTES CRV");
  row("Max Drawdown (hist.)", `${data.maxDrawdownHistory || "—"} (${data.maxDrawdownYear || "?"})`);

  // ====================== S7: RELATIVE BEWERTUNG ======================
  sec(7, "RELATIVE BEWERTUNG");
  row("P/E vs Sektor", `${f(data.peRatio)} vs ${f(data.sectorAvgPE)}`);
  row("EV/EBITDA vs Sektor", `${f(data.evEbitda)} vs ${f(data.sectorAvgEVEBITDA)}`);

  // Peer Comparison
  if (data.peerComparison?.peers?.length) {
    sub("Peer-Vergleich");
    const pc = data.peerComparison;
    tbl(
      ["Ticker", "P/E", "PEG", "P/S", "P/B", "EPS 1Y", "EPS 5Y"],
      [
        [pc.subject.ticker, f(pc.subject.pe), f(pc.subject.peg,2), f(pc.subject.ps), f(pc.subject.pb), pc.subject.epsGrowth1Y!=null?`${f(pc.subject.epsGrowth1Y)}%`:"—", pc.subject.epsGrowth5Y!=null?`${f(pc.subject.epsGrowth5Y)}%`:"—"],
        ...pc.peers.map(p => [p.ticker, f(p.pe), f(p.peg,2), f(p.ps), f(p.pb), p.epsGrowth1Y!=null?`${f(p.epsGrowth1Y)}%`:"—", p.epsGrowth5Y!=null?`${f(p.epsGrowth5Y)}%`:"—"]),
        [`Ø Peers (${pc.peers.length})`, f(pc.peerAvg.pe), f(pc.peerAvg.peg,2), f(pc.peerAvg.ps), f(pc.peerAvg.pb), pc.peerAvg.epsGrowth1Y!=null?`${f(pc.peerAvg.epsGrowth1Y)}%`:"—", pc.peerAvg.epsGrowth5Y!=null?`${f(pc.peerAvg.epsGrowth5Y)}%`:"—"],
      ]
    );
    if (pc.sectorMedian) {
      row("Sektor-Median P/E", f(pc.sectorMedian.pe));
      row("Sektor-Median PEG", f(pc.sectorMedian.peg, 2));
    }
  }

  // ====================== S8: RISIKOINVERSION ======================
  sec(8, "INVERSION — RISIKOEINPREISUNG");
  if (data.risks?.length) {
    tbl(
      ["Risiko", "Kat.", "EW%", "Impact%", "Exp.Damage"],
      data.risks.map(r => [r.name.substring(0,40), r.category, `${r.ew||r.probability}%`, `${r.impact}%`, `${f(r.expectedDamage,2)}%`])
    );
    const totalDamage = data.risks.reduce((s, r) => s + (r.expectedDamage || 0), 0);
    row("Total Expected Damage", `${f(totalDamage, 2)}%`);
  }

  // ====================== S9: RSL ======================
  sec(9, "RSL-MOMENTUM");
  if (data.rsl?.value) {
    row("RSL-Wert", f(data.rsl.value, 2));
    row("26-Wochen-Durchschnitt", `$${data.rsl.avg26w?.toFixed(2) || "—"}`);
    row("Bewertung", data.rsl.value > 110 ? "Strong" : data.rsl.value > 105 ? "Neutral" : "Weak");
  } else {
    para("RSL-Daten nicht verfügbar (gecachte Daten ohne Preishistorie).");
  }

  // ====================== S10: TECHNISCHE ANALYSE ======================
  sec(10, "TECHNISCHE ANALYSE");
  row("Kurs > MA200", data.technicals?.priceAboveMA200 ? "JA ✓" : "NEIN ✗");
  row("MA50 > MA200", data.technicals?.ma50AboveMA200 ? "JA ✓" : "NEIN ✗");
  row("MACD > 0", data.technicals?.macdAboveZero ? "JA ✓" : "NEIN ✗");
  row("MACD steigend", data.technicals?.macdRising ? "JA ✓" : "NEIN ✗");
  const allBuy = data.technicals?.priceAboveMA200 && data.technicals?.ma50AboveMA200 && data.technicals?.macdAboveZero && data.technicals?.macdRising;
  row("Kaufsignal", allBuy ? "JA — alle Bedingungen erfüllt" : "NEIN — nicht alle Bedingungen erfüllt");

  // ====================== S11: MOAT & PORTER ======================
  sec(11, "MOAT & PORTER'S FIVE FORCES");
  row("Moat Rating", data.moatRating || "—");
  if (data.moatAssessment?.moatSources?.length) {
    sub("Moat-Quellen");
    for (const s of data.moatAssessment.moatSources.slice(0, 4)) {
      para(`• ${s}`);
    }
  }
  if (data.moatAssessment?.porterScores) {
    sub("Porter's Five Forces");
    const ps = data.moatAssessment.porterScores;
    tbl(
      ["Force", "Bewertung", "Score"],
      Object.entries(ps).map(([k, v]: [string, any]) => [v.name || k, v.rating || "—", `${v.score || "—"}/5`])
    );
  }

  // ====================== S12: PESTEL ======================
  sec(12, "PESTEL-ANALYSE");
  const pestel = data.pestelAnalysis;
  if (pestel) {
    row("Gesamt-Exposure", pestel.overallExposure || "—");
    row("Geopolitischer Score", `${pestel.geopoliticalScore || "—"} / 10`);
    para(pestel.macroSummary);
    if (pestel.interestRateOutlook) row("Zinsen-Ausblick", pestel.interestRateOutlook.substring(0, 80));
  }

  // ====================== S13: MAKRO-KORRELATIONEN ======================
  sec(13, "MAKRO-KORRELATIONEN");
  const mc2 = data.macroCorrelations;
  if (mc2) {
    row("Makro-Sensitivität", mc2.overallMacroSensitivity || "—");
    para(mc2.keyInsight);
    if (mc2.correlations?.length) {
      tbl(
        ["Indikator", "Korrelation", "Stärke"],
        mc2.correlations.slice(0, 8).map((c: any) => [c.indicator || c.name, c.correlation || c.direction, c.strength])
      );
    }
  }

  // ====================== S14: REVERSE DCF ======================
  sec(14, "REVERSE DCF");
  if (data.reverseDCF) {
    row("Implied Growth Rate g*", `${f(data.reverseDCF.impliedGrowth, 2)}%`);
    row("Bewertung", data.reverseDCF.assessment || "—");
  }

  // ====================== S15: KATALYSATOREN (Anti-Bias) ======================
  sec(15, "KURSANSTIEG-KATALYSATOREN (Anti-Bias)");
  if (data.catalysts?.length) {
    for (const c of data.catalysts) {
      row(`${c.name}`, `PoS ${c.pos}% | GB ${f(c.gb,2)}%`);
      if (c.context) para(`  ${c.context.substring(0, 200)}`);
    }
    sub("Downside-Katalysatoren");
    para("Anti-Bias-Protokoll: Kein selektiver Upside ohne symmetrischen Downside.");
  }

  // ====================== S16: MONTE CARLO ======================
  sec(16, "MONTE CARLO SIMULATION (GBM)");
  const mc = data.monteCarloResults;
  if (mc && mc.mean) {
    row("Mean", `$${f(mc.mean, 2)}`);
    row("Median (P50)", `$${f(mc.median, 2)}`);
    row("P10 (Bearish)", `$${f(mc.p10, 2)}`);
    row("P90 (Bullish)", `$${f(mc.p90, 2)}`);
    row("P(Verlust)", `${f(mc.probLoss)}%`);
    row("P(≥10% Verlust)", `${f(mc.probLoss10)}%`);
    row("P(≥20% Verlust)", `${f(mc.probLoss20)}%`);
  } else {
    para("Monte Carlo Ergebnisse nicht verfügbar.");
  }

  // ====================== S17: ZUSAMMENFASSUNG & FAZIT ======================
  sec(17, "ZUSAMMENFASSUNG & FAZIT");
  row("Ticker", `${data.ticker} — ${data.companyName}`);
  row("Sektor", `${data.sector} / ${data.industry}`);
  row("Kurs", `$${data.currentPrice?.toFixed(2) || "—"}`);
  row("P/E (TTM)", f(data.peRatio));
  row("PEG", f(data.pegRatio, 2));
  row("FCF Margin", `${f(data.fcfMargin)}%`);
  row("Moat", data.moatRating || "—");
  row("RSL", data.rsl?.value ? f(data.rsl.value, 1) : "—");
  row("Max Drawdown", `${data.maxDrawdownHistory || "—"}`);
  row("EPS Growth 5Y", `${f(data.epsGrowth5Y)}%`);

  // Catalyst summary
  if (data.catalysts?.length) {
    const totalGB = data.catalysts.reduce((s, c) => s + c.gb, 0);
    row("Catalyst Upside (Σ GB)", `+${f(totalGB, 2)}%`);
  }

  // Fazit
  np(20);
  sub("FAZIT");

  // Build automated verdict
  let positives = 0, negatives = 0;
  const posList: string[] = [], negList: string[] = [];
  if (data.peRatio && data.sectorAvgPE && data.peRatio < data.sectorAvgPE) { positives++; posList.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — Discount`); }
  else if (data.peRatio && data.sectorAvgPE) { negatives++; negList.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — Premium`); }
  if (data.pegRatio && data.pegRatio < 1) { positives++; posList.push(`PEG ${f(data.pegRatio,2)} < 1 — unterbewertet`); }
  if (data.fcfMargin && data.fcfMargin > 15) { positives++; posList.push(`FCF Margin ${f(data.fcfMargin)}% — stark`); }
  if (data.rsl?.value && data.rsl.value < 105) { negatives++; negList.push(`RSL ${f(data.rsl.value)} — schwaches Momentum`); }
  if (data.catalysts?.length) { const gb = data.catalysts.reduce((s,c) => s+c.gb, 0); if (gb > 5) { positives++; posList.push(`Katalysatoren-Upside +${f(gb,2)}%`); } }

  const verdict = positives > negatives ? "ATTRAKTIV" : positives === negatives ? "NEUTRAL" : "VORSICHT";
  doc.setFontSize(10); doc.setFont("helvetica","bold");
  doc.setTextColor(verdict === "ATTRAKTIV" ? 80 : verdict === "VORSICHT" ? 200 : 150, verdict === "ATTRAKTIV" ? 200 : verdict === "VORSICHT" ? 80 : 160, verdict === "ATTRAKTIV" ? 80 : verdict === "VORSICHT" ? 80 : 180);
  doc.text(verdict, W / 2, y + 4, { align: "center" });
  y += 8;

  doc.setFontSize(6.5); doc.setFont("helvetica","normal"); doc.setTextColor(160,165,175);
  const verdictText = `${data.companyName} (${data.ticker}) zeigt ${positives} positive und ${negatives} negative Faktoren.`;
  doc.text(verdictText, W / 2, y + 2, { align: "center" });
  y += 6;

  if (posList.length) {
    sub("Positive Faktoren");
    for (const p of posList) para(`+ ${p}`);
  }
  if (negList.length) {
    sub("Negative Faktoren");
    for (const n of negList) para(`− ${n}`);
  }

  // ====================== FOOTER ======================
  np(12);
  y += 3;
  doc.setDrawColor(40, 50, 70);
  doc.line(M, y, W - M, y);
  y += 3;
  doc.setFontSize(5.5); doc.setFont("helvetica","italic"); doc.setTextColor(90,100,120);
  doc.text("Stock Analyst Pro — Erstellt mit Perplexity Computer", M, y + 2);
  doc.text("Quellen: Yahoo Finance, Polygon API, Damodaran (NYU Stern), SEC EDGAR, Google News", M, y + 5);
  doc.text(`Generiert: ${new Date().toLocaleString("de-DE")} | ${doc.getNumberOfPages()} Seiten`, W - M, y + 2, { align: "right" });

  // Save
  const filename = `${data.ticker}_Analyse_${new Date().toISOString().slice(0,10)}.pdf`;
  try { doc.save(filename); } catch {
    const blob = doc.output('blob');
    window.open(URL.createObjectURL(blob), '_blank');
  }
}
