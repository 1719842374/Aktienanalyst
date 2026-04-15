import type { StockAnalysis } from "@shared/schema";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null || isNaN(v) || !isFinite(v)) return "—";
  return v.toFixed(dec);
}
function fmtB(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}
function fmtP(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export async function exportAnalysisPdf(data: StockAnalysis) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 15;
  const maxY = 275;

  function checkPage(needed = 20) {
    if (y + needed > maxY) { doc.addPage(); y = 15; }
  }

  function heading(text: string, num?: number) {
    checkPage(15);
    doc.setFillColor(20, 30, 50);
    doc.rect(margin, y, w - 2 * margin, 8, "F");
    doc.setTextColor(100, 180, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`${num ? num + "  " : ""}${text}`, margin + 3, y + 5.5);
    y += 11;
    doc.setTextColor(220, 220, 230);
  }

  function subheading(text: string) {
    checkPage(10);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(160, 170, 190);
    doc.text(text, margin, y + 3);
    y += 6;
  }

  function textLine(label: string, value: string, indent = 0) {
    checkPage(6);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 155, 165);
    doc.text(label, margin + indent, y + 3);
    doc.setTextColor(220, 225, 235);
    doc.setFont("helvetica", "bold");
    doc.text(value, w - margin, y + 3, { align: "right" });
    y += 5;
  }

  function table(headers: string[], rows: string[][], colWidths?: number[]) {
    checkPage(10 + rows.length * 5);
    autoTable(doc, {
      startY: y,
      head: [headers],
      body: rows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 6.5, textColor: [200, 205, 215], fillColor: [15, 22, 40], cellPadding: 1.5, lineColor: [40, 50, 70], lineWidth: 0.1 },
      headStyles: { fillColor: [25, 35, 55], textColor: [130, 170, 220], fontStyle: "bold", fontSize: 6 },
      alternateRowStyles: { fillColor: [18, 26, 45] },
      columnStyles: colWidths ? Object.fromEntries(colWidths.map((cw, i) => [i, { cellWidth: cw }])) : {},
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ========== HEADER ==========
  doc.setFillColor(12, 18, 35);
  doc.rect(0, 0, w, 297, "F");

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 180, 255);
  doc.text("Stock Analyst Pro", margin, y + 5);
  doc.setFontSize(8);
  doc.setTextColor(120, 130, 150);
  doc.text(`Report: ${data.ticker} — ${data.companyName}`, margin, y + 11);
  doc.text(`${new Date().toLocaleDateString("de-DE")} | Alle Werte in USD`, w - margin, y + 11, { align: "right" });
  y += 18;

  // ========== CONSISTENCY WARNINGS ==========
  if (data.consistencyWarnings?.length) {
    for (const w of data.consistencyWarnings) {
      checkPage(8);
      const color = w.severity === "critical" ? [220, 60, 60] : w.severity === "warning" ? [220, 160, 40] : [80, 140, 220];
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setFillColor(color[0] / 8, color[1] / 8, color[2] / 8 + 10);
      doc.roundedRect(margin, y, doc.internal.pageSize.getWidth() - 2 * margin, 7, 1, 1, "FD");
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(`⚠ ${w.title}: ${w.detail}`, margin + 2, y + 4.5);
      y += 9;
    }
  }

  // ========== S1: DATENAKTUALITÄT ==========
  heading("DATENAKTUALITÄT & PLAUSIBILITÄT", 1);
  textLine("Kurs", `$${data.currentPrice?.toFixed(2) || "—"}`);
  textLine("Market Cap", fmtB(data.marketCap));
  textLine("P/E (TTM)", fmt(data.peRatio));
  textLine("Forward P/E", fmt(data.forwardPE));
  textLine("PEG", fmt(data.pegRatio, 2));
  textLine("EV/EBITDA", fmt(data.evEbitda));
  textLine("Beta (5Y)", fmt(data.beta5Y, 2));
  textLine("FCF TTM", fmtB(data.fcfTTM));
  textLine("FCF Margin", `${fmt(data.fcfMargin)}%`);
  textLine("EPS Growth 5Y", `${fmt(data.epsGrowth5Y)}%`);

  subheading("Analysten-Ratings");
  textLine("Median PT", `$${data.analystPT?.median?.toFixed(2) || "—"}`);
  textLine("PT Upside", fmtP(data.analystPT?.median && data.currentPrice ? ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100 : null));

  // ========== S2: INVESTMENTTHESE ==========
  heading("INVESTMENTTHESE & KATALYSATOREN", 2);
  checkPage(15);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 185, 195);
  const thesisLines = doc.splitTextToSize(data.growthThesis || "", w - 2 * margin - 4);
  doc.text(thesisLines, margin + 2, y + 3);
  y += thesisLines.length * 3.5 + 4;

  // Catalysts table
  if (data.catalysts?.length) {
    subheading("Katalysatoren");
    table(
      ["#", "Name", "Timeline", "PoS%", "Brutto↑", "Einpr%", "GB%"],
      data.catalysts.map((c, i) => [
        `K${i + 1}`, c.name, c.timeline, `${c.pos}%`, `+${fmt(c.bruttoUpside)}%`,
        `${c.einpreisungsgrad}%`, `${fmt(c.gb, 2)}%`,
      ]),
    );
  }

  // ========== S4: BEWERTUNG ==========
  heading("BEWERTUNGSKENNZAHLEN", 4);
  const sp = data.sectorProfile;
  if (sp?.waccScenarios) {
    table(
      ["Szenario", "WACC"],
      [
        ["Konservativ", `${sp.waccScenarios.kons}%`],
        ["Average", `${sp.waccScenarios.avg}%`],
        ["Optimistisch", `${sp.waccScenarios.opt}%`],
      ],
    );
  }

  // ========== S5: DCF ==========
  heading("DCF-MODELL (FCFF)", 5);
  textLine("EBIT-Margin", `${fmt(data.operatingIncome && data.revenue ? (data.operatingIncome / data.revenue) * 100 : null)}%`);
  textLine("Revenue", fmtB(data.revenue));
  textLine("Operating Income (EBIT)", fmtB(data.operatingIncome));
  textLine("EBITDA", fmtB(data.ebitda));
  textLine("Shares Outstanding", `${data.sharesOutstanding ? (data.sharesOutstanding / 1e6).toFixed(0) + "M" : "—"}`);

  // ========== S7: REL. BEWERTUNG ==========
  heading("RELATIVE BEWERTUNG", 7);
  textLine("P/E vs Sektor", `${fmt(data.peRatio)} vs ${fmt(data.sectorAvgPE)}`);
  textLine("EV/EBITDA vs Sektor", `${fmt(data.evEbitda)} vs ${fmt(data.sectorAvgEVEBITDA)}`);

  // Peer comparison
  if (data.peerComparison?.peers?.length) {
    subheading("Peer-Vergleich");
    table(
      ["Ticker", "P/E", "PEG", "P/S", "P/B", "EPS 1Y", "EPS 5Y"],
      [
        [data.peerComparison.subject.ticker, fmt(data.peerComparison.subject.pe), fmt(data.peerComparison.subject.peg, 2), fmt(data.peerComparison.subject.ps), fmt(data.peerComparison.subject.pb), fmtP(data.peerComparison.subject.epsGrowth1Y), fmtP(data.peerComparison.subject.epsGrowth5Y)],
        ...data.peerComparison.peers.map(p => [p.ticker, fmt(p.pe), fmt(p.peg, 2), fmt(p.ps), fmt(p.pb), fmtP(p.epsGrowth1Y), fmtP(p.epsGrowth5Y)]),
        ["Ø Peers", fmt(data.peerComparison.peerAvg.pe), fmt(data.peerComparison.peerAvg.peg, 2), fmt(data.peerComparison.peerAvg.ps), fmt(data.peerComparison.peerAvg.pb), fmtP(data.peerComparison.peerAvg.epsGrowth1Y), fmtP(data.peerComparison.peerAvg.epsGrowth5Y)],
      ],
    );
  }

  // ========== S8: RISIKOINVERSION ==========
  heading("RISIKOINVERSION", 8);
  if (data.risks?.length) {
    table(
      ["Risiko", "Kategorie", "EW%", "Impact%", "Exp. Damage"],
      data.risks.map(r => [r.name, r.category, `${r.probability}%`, `${r.impact}%`, `${fmt(r.expectedDamage, 2)}%`]),
    );
  }

  // ========== S9: RSL ==========
  heading("RSL-MOMENTUM", 9);
  if (data.rsl) {
    textLine("RSL-Wert", fmt(data.rsl.value, 2));
    textLine("Kurs", `$${data.currentPrice?.toFixed(2)}`);
    textLine("26-Wochen-Durchschnitt", `$${data.rsl.avg26w?.toFixed(2) || "—"}`);
  }

  // ========== S15: KATALYSATOREN (Anti-Bias) ==========
  heading("KURSANSTIEG-KATALYSATOREN (Anti-Bias)", 15);
  if (data.catalysts?.length) {
    const totalGB = data.catalysts.reduce((s, c) => s + c.gb, 0);
    textLine("Total Catalyst Upside (Σ GB)", `+${fmt(totalGB, 2)}%`);
  }

  // ========== S16: MONTE CARLO ==========
  heading("MONTE CARLO SIMULATION", 16);
  if (data.monteCarloResults) {
    const mc = data.monteCarloResults;
    textLine("Mean", `$${fmt(mc.mean, 2)} (${fmtP(mc.mean && data.currentPrice ? ((mc.mean - data.currentPrice) / data.currentPrice) * 100 : null)})`);
    textLine("Median (P50)", `$${fmt(mc.median, 2)}`);
    textLine("P10 (Bearish)", `$${fmt(mc.p10, 2)}`);
    textLine("P90 (Bullish)", `$${fmt(mc.p90, 2)}`);
    textLine("P(Verlust)", `${fmt(mc.probLoss)}%`);
    textLine("P(≥10% Verlust)", `${fmt(mc.probLoss10)}%`);
    textLine("P(≥20% Verlust)", `${fmt(mc.probLoss20)}%`);
  }

  // ========== S17: ZUSAMMENFASSUNG ==========
  heading("ZUSAMMENFASSUNG", 17);
  textLine("Sektor", `${data.sector} / ${data.industry}`);
  textLine("Moat", data.moatRating || "—");
  textLine("FCF Margin", `${fmt(data.fcfMargin)}%`);
  textLine("RSL", fmt(data.rsl?.value, 1));

  // Footer
  checkPage(10);
  y += 5;
  doc.setDrawColor(40, 50, 70);
  doc.line(margin, y, w - margin, y);
  y += 4;
  doc.setFontSize(6);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(100, 110, 130);
  doc.text("Stock Analyst Pro — Erstellt mit Perplexity Computer", margin, y + 2);
  doc.text("Quellen: Yahoo Finance, Polygon API, Damodaran (NYU Stern), SEC EDGAR", margin, y + 5.5);
  doc.text(`Generiert: ${new Date().toLocaleString("de-DE")}`, w - margin, y + 2, { align: "right" });

  // Save — use blob URL approach for iframe compatibility
  const filename = `${data.ticker}_Analyse_${new Date().toISOString().slice(0, 10)}.pdf`;
  try {
    // Try standard save first
    doc.save(filename);
  } catch {
    // Fallback: open in new tab
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }
}
