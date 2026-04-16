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
function pct(v: number | null | undefined, d = 1): string { return v != null && isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—"; }

export async function exportAnalysisPdf(data: StockAnalysis) {
  const doc = new jsPDF("portrait", "mm", "a4");
  const W = doc.internal.pageSize.getWidth();
  const M = 12;
  let y = 12;
  const maxY = 280;

  const bg = () => { doc.setFillColor(12, 18, 35); doc.rect(0, 0, W, 297, "F"); };
  bg();

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
    // Truncate value if too long
    const maxValWidth = W - M - (M + indent) - 5;
    let displayVal = val;
    while (doc.getTextWidth(displayVal) > maxValWidth && displayVal.length > 5) {
      displayVal = displayVal.substring(0, displayVal.length - 2) + "…";
    }
    doc.text(displayVal, W - M, y + 3, { align: "right" });
    y += 4.5;
  }
  function para(text: string | undefined, maxLines = 6) {
    if (!text) return;
    np(12);
    doc.setFontSize(6.5); doc.setFont("helvetica","normal"); doc.setTextColor(170,175,185);
    const lines = doc.splitTextToSize(text, W - 2 * M - 2);
    const display = lines.slice(0, maxLines);
    for (const line of display) {
      np(4);
      doc.text(line, M + 1, y + 2.5);
      y += 3;
    }
    y += 2;
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

  // ====================== S2: INVESTMENTTHESE & KATALYSATOREN ======================
  sec(2, "INVESTMENTTHESE & KATALYSATOREN");

  // Company description
  if ((data as any).description) {
    sub("Unternehmensbeschreibung");
    para((data as any).description, 8);
  }

  sub("Investmentthese");
  para(data.growthThesis, 8);
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

  // ====================== NEWS ======================
  if ((data as any).newsItems?.length) {
    sub("Nachrichten");
    const newsItems = (data as any).newsItems as { title: string; source: string; relativeTime: string; lang?: string }[];
    tbl(
      ["#", "Nachricht", "Quelle", "Alter", "Spr."],
      newsItems.slice(0, 10).map((n, i) => [
        `${i+1}`, n.title.substring(0, 55), n.source.substring(0, 18), n.relativeTime, (n.lang || "en").toUpperCase()
      ])
    );
  }

  // ====================== S3: ZYKLUSANALYSE ======================
  sec(3, "ZYKLUS- & STRUKTURANALYSE");
  row("Zyklusklassifikation", data.cycleClassification || "—");
  row("Politischer Zyklus", data.politicalCycle || "—");
  if ((data as any).structuralTrends?.length) {
    sub("Strukturelle Trends");
    for (const t of (data as any).structuralTrends.slice(0, 4)) {
      para(`• ${typeof t === "string" ? t : (t.name || t.trend || JSON.stringify(t)).substring(0, 120)}`);
    }
  }

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
  row("P/E (TTM)", f(data.peRatio));
  row("Forward P/E", f(data.forwardPE));
  row("EV/EBITDA", f(data.evEbitda));

  // ====================== S5: DCF-MODELL ======================
  sec(5, "DCF-MODELL (FCFF)");
  const opM = data.operatingIncome && data.revenue ? (data.operatingIncome/data.revenue*100) : null;
  row("Revenue", fB(data.revenue));
  row("Operating Income (EBIT)", fB(data.operatingIncome));
  row("EBIT-Margin", `${f(opM)}%`);
  row("EBITDA", fB(data.ebitda));
  row("FCF TTM", fB(data.fcfTTM));
  row("Shares Outstanding", data.sharesOutstanding ? `${(data.sharesOutstanding/1e6).toFixed(0)}M` : "—");
  const nd = data.totalDebt && data.cashEquivalents ? data.totalDebt - data.cashEquivalents : null;
  row("Net Debt", fB(nd));

  // DCF Scenarios
  if (data.sectorProfile?.waccScenarios) {
    const waccS = data.sectorProfile.waccScenarios;
    const fcf = data.fcfTTM || 0;
    const shares = data.sharesOutstanding || 1;
    const growth = data.epsGrowth5Y || 5;
    const netDebt = nd || 0;

    sub("DCF-Szenarien (5Y-Projektion, Gordon Growth)");

    const dcfCalc = (wacc: number, g: number, tg: number) => {
      let totalPV = 0;
      let lastFCF = fcf;
      for (let yr = 1; yr <= 5; yr++) {
        lastFCF *= (1 + g / 100);
        totalPV += lastFCF / Math.pow(1 + wacc / 100, yr);
      }
      const tv = lastFCF * (1 + tg / 100) / (wacc / 100 - tg / 100);
      totalPV += tv / Math.pow(1 + wacc / 100, 5);
      return (totalPV - netDebt) / shares;
    };

    const tg = 2.5; // Terminal growth
    const konsFV = dcfCalc(waccS.kons, growth * 0.7, tg);
    const avgFV = dcfCalc(waccS.avg, growth, tg);
    const optFV = dcfCalc(waccS.opt, growth * 1.2, tg);

    tbl(
      ["Szenario", "WACC", "Wachstum", "Fair Value/Aktie", "vs. Kurs"],
      [
        ["Konservativ", `${waccS.kons}%`, `${f(growth*0.7)}%`, `$${f(konsFV, 2)}`, pct(data.currentPrice ? (konsFV/data.currentPrice-1)*100 : null)],
        ["Base Case", `${waccS.avg}%`, `${f(growth)}%`, `$${f(avgFV, 2)}`, pct(data.currentPrice ? (avgFV/data.currentPrice-1)*100 : null)],
        ["Optimistisch", `${waccS.opt}%`, `${f(growth*1.2)}%`, `$${f(optFV, 2)}`, pct(data.currentPrice ? (optFV/data.currentPrice-1)*100 : null)],
      ]
    );

    // Katalysatoren DCF vs Kurs
    if (data.currentPrice) {
      const totalGB = data.catalysts?.reduce((s, c) => s + c.gb, 0) || 0;
      const katalFV = avgFV * (1 + totalGB / 100);
      row("DCF Base Case Fair Value", `$${f(avgFV, 2)}`);
      row("+ Katalysatoren-Upside", `+${f(totalGB, 2)}% → $${f(katalFV, 2)}`);
      row("Aktueller Kurs", `$${data.currentPrice.toFixed(2)}`);
      const diff = (avgFV / data.currentPrice - 1) * 100;
      row("DCF vs Kurs", `${pct(diff)} ${diff > 10 ? "(Unterbewertet)" : diff < -10 ? "(Überbewertet)" : "(Fair bewertet)"}`);
    }
  }

  // ====================== S6: CRV ======================
  sec(6, "RISIKOADJUSTIERTES CRV");
  row("Max Drawdown (hist.)", `${data.maxDrawdownHistory || "—"} (${data.maxDrawdownYear || "?"})`);

  if (data.currentPrice && data.analystPT?.high && data.analystPT?.low) {
    const worstCase = data.currentPrice * (1 - (data.maxDrawdownHistory ? parseFloat(String(data.maxDrawdownHistory)) / 100 : 0.3));
    const bestCase = data.analystPT.high;
    const fairValue = data.analystPT.median || data.currentPrice;
    const crv = (fairValue - worstCase) > 0 ? (bestCase - data.currentPrice) / (data.currentPrice - worstCase) : 0;
    row("Best Case (PT High)", `$${f(bestCase, 2)}`);
    row("Worst Case (hist. DD)", `$${f(worstCase, 2)}`);
    row("CRV", f(crv, 2));
    row("Bewertung", crv > 3 ? "Exzellent" : crv > 2 ? "Gut" : crv > 1 ? "Akzeptabel" : "Schlecht");
  }

  // ====================== S7: RELATIVE BEWERTUNG ======================
  sec(7, "RELATIVE BEWERTUNG");
  row("P/E vs Sektor", `${f(data.peRatio)} vs ${f(data.sectorAvgPE)}`);
  row("EV/EBITDA vs Sektor", `${f(data.evEbitda)} vs ${f(data.sectorAvgEVEBITDA)}`);

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
    row("Bewertung", data.rsl.value > 110 ? "Strong — Starkes Momentum" : data.rsl.value > 105 ? "Neutral" : "Weak — DCF-Wachstum -5-10% adjustiert");
    if (data.rsl.value < 105) {
      para("⚠ RSL < 105: DCF-Wachstumsrate automatisch um 5-10% nach unten adjustiert.");
    }
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

  // Technical values
  if (data.technicals) {
    const t = data.technicals;
    if (t.ma200) row("MA200 (SMA)", `$${f(t.ma200, 2)}`);
    if (t.ma50) row("MA50 (SMA)", `$${f(t.ma50, 2)}`);
    if (t.macdValue != null) row("MACD", f(t.macdValue, 4));
    if (t.macdSignal != null) row("Signal", f(t.macdSignal, 4));
  }

  // 5-Year Chart (text-based with key price points)
  if (data.historicalPrices?.length) {
    sub("Kursverlauf (5 Jahre)");
    const prices = data.historicalPrices;
    const now = prices[prices.length - 1];
    const oneYearAgo = prices[Math.max(0, prices.length - 252)];
    const twoYearsAgo = prices[Math.max(0, prices.length - 504)];
    const threeYearsAgo = prices[Math.max(0, prices.length - 756)];
    const fiveYearsAgo = prices[Math.max(0, prices.length - 1260)];
    const allCloses = prices.map(p => p.close).filter(c => c > 0);
    const high52w = Math.max(...allCloses.slice(-252));
    const low52w = Math.min(...allCloses.slice(-252));
    const highAll = Math.max(...allCloses);
    const lowAll = Math.min(...allCloses);

    tbl(
      ["Zeitpunkt", "Kurs", "Veränd. gg. heute"],
      [
        ["Heute", `$${f(now?.close, 2)}`, "—"],
        ["Vor 1 Jahr", `$${f(oneYearAgo?.close, 2)}`, pct(now?.close && oneYearAgo?.close ? (now.close/oneYearAgo.close-1)*100 : null)],
        ["Vor 2 Jahren", `$${f(twoYearsAgo?.close, 2)}`, pct(now?.close && twoYearsAgo?.close ? (now.close/twoYearsAgo.close-1)*100 : null)],
        ["Vor 3 Jahren", `$${f(threeYearsAgo?.close, 2)}`, pct(now?.close && threeYearsAgo?.close ? (now.close/threeYearsAgo.close-1)*100 : null)],
        ["Vor 5 Jahren", `$${f(fiveYearsAgo?.close, 2)}`, pct(now?.close && fiveYearsAgo?.close ? (now.close/fiveYearsAgo.close-1)*100 : null)],
      ]
    );
    row("52W-Hoch", `$${f(high52w, 2)}`);
    row("52W-Tief", `$${f(low52w, 2)}`);
    row("All-Time High", `$${f(highAll, 2)}`);
    row("All-Time Low", `$${f(lowAll, 2)}`);

    // Draw mini sparkline chart
    try {
      np(30);
      const chartW = W - 2 * M;
      const chartH = 22;
      const chartX = M;
      const chartY = y;

      // Background
      doc.setFillColor(18, 26, 45);
      doc.rect(chartX, chartY, chartW, chartH, "F");

      // Use last 1260 trading days (~5Y)
      const chartData = allCloses.slice(-1260);
      if (chartData.length > 10) {
        const cMin = Math.min(...chartData) * 0.98;
        const cMax = Math.max(...chartData) * 1.02;
        const cRange = cMax - cMin || 1;

        // Draw price line
        doc.setDrawColor(80, 160, 240);
        doc.setLineWidth(0.3);
        const step = chartW / (chartData.length - 1);
        for (let i = 1; i < chartData.length; i++) {
          const x1 = chartX + (i - 1) * step;
          const y1 = chartY + chartH - ((chartData[i-1] - cMin) / cRange) * chartH;
          const x2 = chartX + i * step;
          const y2 = chartY + chartH - ((chartData[i] - cMin) / cRange) * chartH;
          doc.line(x1, y1, x2, y2);
        }

        // Y-axis labels
        doc.setFontSize(5); doc.setTextColor(100, 110, 130);
        doc.text(`$${f(cMax, 0)}`, chartX + 1, chartY + 3);
        doc.text(`$${f(cMin, 0)}`, chartX + 1, chartY + chartH - 1);

        // X-axis labels
        const dates = prices.slice(-1260);
        if (dates.length > 0) {
          doc.text(dates[0]?.date?.substring(0, 7) || "", chartX, chartY + chartH + 3);
          doc.text(dates[dates.length - 1]?.date?.substring(0, 7) || "", chartX + chartW - 12, chartY + chartH + 3);
        }
      }
      y = chartY + chartH + 6;
    } catch (e) {
      // Chart drawing failed, skip silently
    }
  }

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
    if (pestel.factors?.length) {
      sub("PESTEL-Faktoren");
      tbl(
        ["Faktor", "Typ", "Impact", "Bewertung"],
        pestel.factors.slice(0, 6).map((f: any) => [
          (f.name || f.factor || "").substring(0, 30),
          f.type || "—",
          f.impact || "—",
          f.assessment || f.rating || "—",
        ])
      );
    }
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
    if (data.reverseDCF.impliedGrowth != null && data.currentPrice) {
      const ig = data.reverseDCF.impliedGrowth;
      const ag = data.epsGrowth5Y || 5;
      if (ig < 0) {
        para("⚠ WARNUNG: Inverse DCF impliziert negatives Wachstum — Markt preist Schrumpfung ein. Kurs könnte bereits überbewertet sein.");
      } else if (ig > ag * 1.5) {
        para(`⚠ WARNUNG: Impliziertes Wachstum (${f(ig)}%) liegt deutlich über dem tatsächlichen (${f(ag)}%). Der Markt preist zu viel Optimismus ein.`);
      }
    }
  }

  // ====================== S15: KATALYSATOREN (Anti-Bias) ======================
  sec(15, "KURSANSTIEG-KATALYSATOREN (Anti-Bias)");
  if (data.catalysts?.length) {
    for (const c of data.catalysts) {
      np(12);
      // Catalyst name + scores
      doc.setFontSize(7); doc.setFont("helvetica","bold"); doc.setTextColor(200,205,215);
      doc.text(c.name.substring(0, 60), M, y + 3);
      doc.setTextColor(80,160,240);
      doc.text(`PoS ${c.pos}% | GB ${f(c.gb,2)}%`, W - M, y + 3, { align: "right" });
      y += 5;
      if (c.context) para(`  ${c.context.substring(0, 250)}`);
    }

    // Downside catalysts
    sub("Downside-Katalysatoren");
    if (data.risks?.length) {
      for (const r of data.risks.slice(0, 3)) {
        para(`• ${r.name}: EW ${r.ew || r.probability}% × Impact ${r.impact}% = ${f(r.expectedDamage, 2)}% Schaden`);
      }
    }
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
    if (mc.p5) row("P5 (Extremes Downside)", `$${f(mc.p5, 2)}`);
    if (mc.p95) row("P95 (Extremes Upside)", `$${f(mc.p95, 2)}`);
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
  row("EV/EBITDA", f(data.evEbitda));
  row("FCF Margin", `${f(data.fcfMargin)}%`);
  row("Moat", data.moatRating || "—");
  row("RSL", data.rsl?.value ? f(data.rsl.value, 1) : "—");
  row("Max Drawdown", `${data.maxDrawdownHistory || "—"}`);
  row("EPS Growth 5Y", `${f(data.epsGrowth5Y)}%`);
  row("Kaufsignal", allBuy ? "JA ✓" : "NEIN ✗");
  row("Analyst Median PT", `$${data.analystPT?.median?.toFixed(2) || "—"} (${pct(ptUp)})`);

  if (data.catalysts?.length) {
    const totalGB = data.catalysts.reduce((s, c) => s + c.gb, 0);
    row("Katalysatoren-Upside (Σ GB)", `+${f(totalGB, 2)}%`);
  }
  if (data.risks?.length) {
    const totalDamage = data.risks.reduce((s, r) => s + (r.expectedDamage || 0), 0);
    row("Risiko Exp. Damage", `−${f(totalDamage, 2)}%`);
  }

  // ======= FAZIT — prominent =======
  np(35);
  y += 3;
  doc.setDrawColor(40, 50, 70);
  doc.line(M, y, W - M, y);
  y += 5;

  // Build automated verdict
  let positives = 0, negatives = 0;
  const posList: string[] = [], negList: string[] = [];
  if (data.peRatio && data.sectorAvgPE && data.peRatio < data.sectorAvgPE) { positives++; posList.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — Discount`); }
  else if (data.peRatio && data.sectorAvgPE && data.peRatio > data.sectorAvgPE * 1.2) { negatives++; negList.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — deutliche Premium`); }
  if (data.pegRatio && data.pegRatio < 1) { positives++; posList.push(`PEG ${f(data.pegRatio,2)} < 1 — unterbewertet`); }
  else if (data.pegRatio && data.pegRatio > 2) { negatives++; negList.push(`PEG ${f(data.pegRatio,2)} > 2 — teuer`); }
  if (data.fcfMargin && data.fcfMargin > 15) { positives++; posList.push(`FCF Margin ${f(data.fcfMargin)}% — stark`); }
  else if (data.fcfMargin && data.fcfMargin < 5) { negatives++; negList.push(`FCF Margin ${f(data.fcfMargin)}% — schwach`); }
  if (data.rsl?.value && data.rsl.value > 110) { positives++; posList.push(`RSL ${f(data.rsl.value)} — starkes Momentum`); }
  else if (data.rsl?.value && data.rsl.value < 95) { negatives++; negList.push(`RSL ${f(data.rsl.value)} — schwaches Momentum`); }
  if (data.catalysts?.length) { const gb = data.catalysts.reduce((s,c) => s+c.gb, 0); if (gb > 10) { positives++; posList.push(`Katalysatoren-Upside +${f(gb,2)}%`); } }
  if (allBuy) { positives++; posList.push("Alle Kaufsignal-Bedingungen erfüllt"); }
  else { negatives++; negList.push("Kaufsignal: Nicht alle Bedingungen erfüllt"); }
  if (data.risks?.length) { const td = data.risks.reduce((s,r) => s+(r.expectedDamage||0), 0); if (td > 20) { negatives++; negList.push(`Hohe Risiko-Exposure: ${f(td,1)}%`); } }

  const verdict = positives > negatives + 1 ? "ATTRAKTIV" : positives > negatives ? "LEICHT ATTRAKTIV" : positives === negatives ? "NEUTRAL" : negatives > positives + 1 ? "UNATTRAKTIV" : "VORSICHT";
  const vColor = verdict.includes("ATTRAKTIV") ? [80,200,80] : verdict === "NEUTRAL" ? [150,160,180] : [200,80,80];

  // Large verdict box
  doc.setFillColor(vColor[0]/10, vColor[1]/10, vColor[2]/10 + 10);
  doc.setDrawColor(vColor[0], vColor[1], vColor[2]);
  doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, "FD");
  doc.setFontSize(14); doc.setFont("helvetica","bold");
  doc.setTextColor(vColor[0], vColor[1], vColor[2]);
  doc.text(verdict, W / 2, y + 8, { align: "center" });
  doc.setFontSize(7); doc.setFont("helvetica","normal"); doc.setTextColor(170,175,185);
  doc.text(`${data.companyName} (${data.ticker}) — ${positives} positive, ${negatives} negative Faktoren`, W / 2, y + 14, { align: "center" });
  y += 22;

  if (posList.length) {
    sub("Positive Faktoren");
    for (const p of posList) {
      np(4);
      doc.setFontSize(6.5); doc.setTextColor(80,200,80); doc.setFont("helvetica","normal");
      doc.text(`+ ${p}`, M + 2, y + 2.5);
      y += 3.5;
    }
  }
  if (negList.length) {
    sub("Negative Faktoren");
    for (const n of negList) {
      np(4);
      doc.setFontSize(6.5); doc.setTextColor(200,80,80); doc.setFont("helvetica","normal");
      doc.text(`− ${n}`, M + 2, y + 2.5);
      y += 3.5;
    }
  }

  // ====================== FOOTER ======================
  np(12);
  y += 3;
  doc.setDrawColor(40, 50, 70);
  doc.line(M, y, W - M, y);
  y += 3;
  doc.setFontSize(5.5); doc.setFont("helvetica","italic"); doc.setTextColor(90,100,120);
  doc.text("Stock Analyst Pro — Erstellt mit Perplexity Computer", M, y + 2);
  doc.text("Quellen: Perplexity Finance API, Damodaran (NYU Stern), SEC EDGAR, Google News (EN/DE)", M, y + 5);
  doc.text(`Generiert: ${new Date().toLocaleString("de-DE")} | ${doc.getNumberOfPages()} Seiten`, W - M, y + 2, { align: "right" });

  // Save
  const filename = `${data.ticker}_Analyse_${new Date().toISOString().slice(0,10)}.pdf`;
  try { doc.save(filename); } catch {
    const blob = doc.output('blob');
    window.open(URL.createObjectURL(blob), '_blank');
  }
}
