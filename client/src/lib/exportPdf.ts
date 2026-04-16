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
  const H = doc.internal.pageSize.getHeight();
  const M = 10;
  const cW = W - 2 * M;
  let y = 10;

  const bg = () => { doc.setFillColor(12, 18, 35); doc.rect(0, 0, W, H, "F"); };
  bg();

  function np(needed = 12) { if (y + needed > H - 10) { doc.addPage(); bg(); y = 10; } }

  function sec(num: number, title: string) {
    np(12);
    doc.setFillColor(20, 30, 50); doc.rect(M, y, cW, 6.5, "F");
    doc.setTextColor(80, 160, 240); doc.setFontSize(7.5); doc.setFont("helvetica", "bold");
    doc.text(`${num}  ${title}`, M + 2, y + 4.5);
    y += 9;
  }

  function sub(t: string) { np(6); doc.setFontSize(6.5); doc.setFont("helvetica","bold"); doc.setTextColor(100,140,190); doc.text(t, M, y+3); y += 5; }

  function row(label: string, val: string, indent = 0) {
    np(4.5);
    doc.setFontSize(6.5); doc.setFont("helvetica","normal"); doc.setTextColor(120,125,140);
    doc.text(label, M + indent, y + 3);
    doc.setTextColor(200,205,215); doc.setFont("helvetica","bold");
    const maxW = W - M - (M + indent) - 2;
    let v = val;
    while (doc.getTextWidth(v) > maxW && v.length > 3) v = v.slice(0, -2) + "…";
    doc.text(v, W - M, y + 3, { align: "right" });
    y += 4;
  }

  function para(text: string | undefined | null, maxChars = 600) {
    if (!text) return;
    np(8);
    const t = text.length > maxChars ? text.substring(0, maxChars) + "…" : text;
    doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.setTextColor(155,160,175);
    const lines = doc.splitTextToSize(t, cW - 4);
    for (const line of lines.slice(0, 12)) {
      np(3);
      doc.text(line, M + 2, y + 2);
      y += 2.8;
    }
    y += 1.5;
  }

  function tbl(headers: string[], rows: string[][], colWidths?: number[]) {
    const totalRows = rows.length;
    np(6 + Math.min(totalRows, 3) * 4);
    const opts: any = {
      startY: y, head: [headers], body: rows,
      margin: { left: M, right: M },
      styles: { fontSize: 5.5, textColor: [180,185,200], fillColor: [15,22,40], cellPadding: 1.2, lineColor: [30,40,60], lineWidth: 0.1, overflow: 'linebreak' },
      headStyles: { fillColor: [22,32,52], textColor: [100,145,200], fontStyle: "bold", fontSize: 5.5 },
      alternateRowStyles: { fillColor: [17,25,44] },
      didDrawPage: () => { bg(); },
    };
    if (colWidths) opts.columnStyles = Object.fromEntries(colWidths.map((w, i) => [i, { cellWidth: w }]));
    autoTable(doc, opts);
    y = (doc as any).lastAutoTable.finalY + 2;
  }

  // ====================== HEADER ======================
  doc.setFontSize(13); doc.setFont("helvetica","bold"); doc.setTextColor(80,160,240);
  doc.text("Stock Analyst Pro", M, y + 4);
  doc.setFontSize(6.5); doc.setTextColor(90,100,120); doc.setFont("helvetica","normal");
  doc.text(`${data.ticker} — ${data.companyName} | ${data.sector} / ${data.industry}`, M, y + 8);
  doc.text(`${new Date().toLocaleDateString("de-DE")} | Alle Werte in ${data.currency || "USD"}`, W - M, y + 8, { align: "right" });
  y += 12;

  // Warnings
  if (data.consistencyWarnings?.length) {
    for (const w of data.consistencyWarnings.slice(0, 3)) {
      np(6);
      const c = w.severity === "critical" ? [200,50,50] : w.severity === "warning" ? [200,150,30] : [60,120,200];
      doc.setFillColor(c[0]/8, c[1]/8, c[2]/8+10); doc.setDrawColor(c[0], c[1], c[2]);
      doc.roundedRect(M, y, cW, 5.5, 1, 1, "FD");
      doc.setFontSize(5.5); doc.setFont("helvetica","bold"); doc.setTextColor(c[0],c[1],c[2]);
      doc.text(`⚠ ${w.title}: ${w.detail.substring(0,110)}`, M+2, y+3.5);
      y += 7;
    }
  }

  // ==================== S1: DATENAKTUALITÄT ====================
  sec(1, "DATENAKTUALITÄT & PLAUSIBILITÄT");
  tbl(["Kennzahl", "Wert", "Kennzahl", "Wert"], [
    ["Kurs", `$${data.currentPrice?.toFixed(2) || "—"}`, "Market Cap", fB(data.marketCap)],
    ["P/E (TTM)", f(data.peRatio), "Forward P/E", f(data.forwardPE)],
    ["PEG", f(data.pegRatio, 2), "EV/EBITDA", f(data.evEbitda)],
    ["Beta (5Y)", f(data.beta5Y, 2), "FCF TTM", fB(data.fcfTTM)],
    ["FCF Margin", `${f(data.fcfMargin)}%`, "EPS Growth 5Y", `${f(data.epsGrowth5Y)}%`],
  ]);
  const ptUp = data.analystPT?.median && data.currentPrice ? ((data.analystPT.median - data.currentPrice)/data.currentPrice*100) : null;
  row("Analysten-Konsens", `Median $${data.analystPT?.median?.toFixed(2)||"—"} | High $${data.analystPT?.high?.toFixed(2)||"—"} | Low $${data.analystPT?.low?.toFixed(2)||"—"} | Upside ${pct(ptUp)}`);

  // ==================== S2: INVESTMENTTHESE & KATALYSATOREN ====================
  sec(2, "INVESTMENTTHESE & KATALYSATOREN");

  // Unternehmensbeschreibung
  if ((data as any).description) {
    sub("Unternehmensbeschreibung");
    para((data as any).description, 500);
  }

  // Investmentthese
  sub("Investmentthese");
  para(data.growthThesis, 500);
  row("Peter Lynch", data.catalystReasoning?.lynchClassification || "—");
  row("Moat", data.moatRating || "—");
  row("FCF Strength", `${f(data.fcfMargin)}% Margin • ${fB(data.fcfTTM)} TTM`);
  row("Gov. Exposure", `${data.governmentExposure || 0}%`);

  // Katalysatoren-Tabelle
  if (data.catalysts?.length) {
    sub("Katalysatoren-Übersicht");
    tbl(
      ["#", "Name", "Timeline", "PoS%", "Brutto↑", "Einpr%", "Netto↑", "GB%"],
      data.catalysts.map((c, i) => [
        `K${i+1}`, c.name.substring(0,32), c.timeline,
        `${c.pos}%`, `+${f(c.bruttoUpside)}%`, `${c.einpreisungsgrad}%`,
        `+${f(c.nettoUpside,2)}%`, `${f(c.gb,2)}%`,
      ])
    );
    const totalGB = data.catalysts.reduce((s, c) => s + c.gb, 0);
    row("Total Catalyst Upside (Σ GB)", `+${f(totalGB, 2)}%`);

    // VOLLSTÄNDIGE Katalysatoren-Texte (aufgeklappt)
    sub("Katalysatoren-Details (KI-Analyse)");
    for (let i = 0; i < data.catalysts.length; i++) {
      const c = data.catalysts[i];
      np(15);
      doc.setFontSize(6.5); doc.setFont("helvetica","bold"); doc.setTextColor(200,205,220);
      doc.text(`K${i+1}: ${c.name}`, M + 1, y + 3);
      doc.setTextColor(80,160,240);
      doc.text(`PoS ${c.pos}% | Brutto +${f(c.bruttoUpside)}% | Einpr. ${c.einpreisungsgrad}% | Netto +${f(c.nettoUpside,2)}% | GB ${f(c.gb,2)}%`, W - M, y + 3, { align: "right" });
      y += 5;
      if (c.context) {
        para(c.context, 800);
      }
    }
  }

  // Nachrichten
  if ((data as any).newsItems?.length) {
    sub("Aktuelle Nachrichten (EN/DE)");
    const news = (data as any).newsItems as any[];
    tbl(
      ["#", "Nachricht", "Quelle", "Alter", "Spr."],
      news.slice(0, 10).map((n: any, i: number) => [`${i+1}`, n.title?.substring(0, 52) || "", (n.source || "").substring(0, 16), n.relativeTime || "", (n.lang || "en").toUpperCase()]),
      [6, 75, 28, 22, 10]
    );
  }

  // ==================== S3: ZYKLUSANALYSE ====================
  sec(3, "ZYKLUS- & STRUKTURANALYSE");
  row("Zyklusklassifikation", data.cycleClassification || "—");
  row("Politischer Zyklus", data.politicalCycle || "—");
  if ((data as any).structuralTrends?.length) {
    sub("Strukturelle Trends");
    for (const t of (data as any).structuralTrends.slice(0, 4)) {
      para(`• ${typeof t === "string" ? t : (t.name || t.trend || "").substring(0, 150)}`);
    }
  }

  // ==================== S4: BEWERTUNGSKENNZAHLEN ====================
  sec(4, "BEWERTUNGSKENNZAHLEN");
  const sp = data.sectorProfile;
  if (sp?.waccScenarios) {
    tbl(["Szenario", "WACC", "Kommentar"], [
      ["Konservativ", `${sp.waccScenarios.kons}%`, "Risikopuffer für Downside"],
      ["Base Case", `${sp.waccScenarios.avg}%`, "Marktkonsens-Niveau"],
      ["Optimistisch", `${sp.waccScenarios.opt}%`, "Best-Case bei Zinssenkungen"],
    ]);
  }
  row("PEG Ratio", f(data.pegRatio, 2));
  row("P/E vs Sektor", `${f(data.peRatio)} vs ${f(data.sectorAvgPE)}`);
  row("EV/EBITDA vs Sektor", `${f(data.evEbitda)} vs ${f(data.sectorAvgEVEBITDA)}`);

  // ==================== S5: DCF-MODELL ====================
  sec(5, "DCF-MODELL (FCFF-basiert, WACC via CAPM, Gordon Growth Terminal Value)");
  const fs = data.financialStatements || {} as any;
  const inc = fs.incomeStatement || {};
  tbl(["Input", "Wert", "Input", "Wert"], [
    ["Revenue", fB(data.revenue), "Gross Margin", `${f(inc.grossMargin)}%`],
    ["EBIT (Op. Income)", fB(data.operatingIncome), "EBIT-Margin", `${f(inc.operatingMargin)}%`],
    ["EBITDA", fB(data.ebitda), "EBITDA-Margin", `${f(inc.ebitdaMargin)}%`],
    ["Net Income", fB(data.netIncome), "Net Margin", `${f(inc.netMargin)}%`],
    ["FCF TTM", fB(data.fcfTTM), "FCF/Aktie", fs.cashFlow?.fcfPerShare ? `$${f(fs.cashFlow.fcfPerShare,2)}` : "—"],
    ["Shares Outstanding", data.sharesOutstanding ? `${(data.sharesOutstanding/1e6).toFixed(0)}M` : "—", "Net Debt", fB(data.totalDebt && data.cashEquivalents ? data.totalDebt - data.cashEquivalents : null)],
  ]);

  // DCF Szenarien berechnen
  if (sp?.waccScenarios && data.fcfTTM && data.sharesOutstanding) {
    const wS = sp.waccScenarios;
    const fcf = data.fcfTTM;
    const shares = data.sharesOutstanding;
    const g = data.epsGrowth5Y || 5;
    const nd = (data.totalDebt || 0) - (data.cashEquivalents || 0);
    const tg = 2.5;

    const dcfCalc = (wacc: number, gr: number) => {
      let pv = 0, lastFCF = fcf;
      for (let yr = 1; yr <= 5; yr++) { lastFCF *= (1 + gr / 100); pv += lastFCF / Math.pow(1 + wacc / 100, yr); }
      pv += (lastFCF * (1 + tg / 100) / (wacc / 100 - tg / 100)) / Math.pow(1 + wacc / 100, 5);
      return (pv - nd) / shares;
    };

    const konsFV = dcfCalc(wS.kons, g * 0.7);
    const baseFV = dcfCalc(wS.avg, g);
    const optFV = dcfCalc(wS.opt, g * 1.2);

    sub("DCF-Szenarien (5Y-Projektion → Gordon Growth Terminal Value)");
    tbl(
      ["Szenario", "WACC", "FCF-Wachstum", "Terminal g", "Fair Value/Aktie", "vs. Kurs"],
      [
        ["Konservativ", `${wS.kons}%`, `${f(g*0.7)}%`, `${tg}%`, `$${f(konsFV,2)}`, pct(data.currentPrice ? (konsFV/data.currentPrice-1)*100 : null)],
        ["Base Case", `${wS.avg}%`, `${f(g)}%`, `${tg}%`, `$${f(baseFV,2)}`, pct(data.currentPrice ? (baseFV/data.currentPrice-1)*100 : null)],
        ["Optimistisch", `${wS.opt}%`, `${f(g*1.2)}%`, `${tg}%`, `$${f(optFV,2)}`, pct(data.currentPrice ? (optFV/data.currentPrice-1)*100 : null)],
      ]
    );

    // Katalysatoren-DCF vs Kurs
    if (data.currentPrice && data.catalysts?.length) {
      const totalGB = data.catalysts.reduce((s, c) => s + c.gb, 0);
      row("DCF Base Case Fair Value", `$${f(baseFV, 2)}`);
      row("+ Katalysatoren-Upside (Σ GB)", `+${f(totalGB)}% → $${f(baseFV * (1 + totalGB/100), 2)}`);
      row("Aktueller Kurs", `$${data.currentPrice.toFixed(2)}`);
      const diff = (baseFV / data.currentPrice - 1) * 100;
      row("DCF vs Kurs", `${pct(diff)} ${diff > 10 ? "→ Unterbewertet" : diff < -10 ? "→ Überbewertet" : "→ Fair bewertet"}`);
    }

    // Rechenweg
    sub("Rechenweg (Base Case)");
    para(`WACC = ${wS.avg}% | FCF₀ = ${fB(fcf)} | Wachstum = ${f(g)}% p.a. | Terminal Growth = ${tg}%\nFCF₁ = ${fB(fcf*(1+g/100))} | FCF₂ = ${fB(fcf*(1+g/100)**2)} | … | FCF₅ = ${fB(fcf*(1+g/100)**5)}\nTerminal Value = FCF₅ × (1+g_t) / (WACC - g_t) = ${fB(fcf*(1+g/100)**5 * (1+tg/100) / (wS.avg/100 - tg/100))}\nEnterprise Value = PV(FCFs) + PV(TV) - Net Debt (${fB(nd)}) → Fair Value/Aktie = $${f(baseFV, 2)}`, 800);
  }

  // ==================== S6: CRV ====================
  sec(6, "RISIKOADJUSTIERTES CRV");
  row("Max Drawdown (hist.)", `${data.maxDrawdownHistory || "—"}% (${data.maxDrawdownYear || "?"})`);
  if (data.currentPrice && data.analystPT?.high) {
    const ddPct = parseFloat(String(data.maxDrawdownHistory)) || 30;
    const worstCase = data.currentPrice * (1 - ddPct / 100);
    const bestCase = data.analystPT.high;
    const fairValue = data.analystPT.median || data.currentPrice;
    const crv = (data.currentPrice - worstCase) > 0 ? (bestCase - data.currentPrice) / (data.currentPrice - worstCase) : 0;
    row("Best Case (PT High)", `$${f(bestCase, 2)}`);
    row("Fair Value (PT Median)", `$${f(fairValue, 2)}`);
    row("Worst Case (hist. DD)", `$${f(worstCase, 2)}`);
    row("CRV (Fair Value - Worst) / (Kurs - Worst)", f(crv, 2));
    para(`Rechenweg: CRV = ($${f(fairValue,2)} - $${f(worstCase,2)}) / ($${data.currentPrice.toFixed(2)} - $${f(worstCase,2)}) = ${f(crv, 2)}`);
  }

  // ==================== S7: RELATIVE BEWERTUNG ====================
  sec(7, "RELATIVE BEWERTUNG (Peer Comparison)");
  if (data.peerComparison?.peers?.length) {
    const pc = data.peerComparison;
    tbl(
      ["Ticker", "P/E", "PEG", "P/S", "P/B", "EPS 1Y", "EPS 5Y"],
      [
        [pc.subject.ticker, f(pc.subject.pe), f(pc.subject.peg,2), f(pc.subject.ps), f(pc.subject.pb), pc.subject.epsGrowth1Y!=null?`${f(pc.subject.epsGrowth1Y)}%`:"—", pc.subject.epsGrowth5Y!=null?`${f(pc.subject.epsGrowth5Y)}%`:"—"],
        ...pc.peers.map(p => [p.ticker, f(p.pe), f(p.peg,2), f(p.ps), f(p.pb), p.epsGrowth1Y!=null?`${f(p.epsGrowth1Y)}%`:"—", p.epsGrowth5Y!=null?`${f(p.epsGrowth5Y)}%`:"—"]),
        [`Ø Peers (${pc.peers.length})`, f(pc.peerAvg.pe), f(pc.peerAvg.peg,2), f(pc.peerAvg.ps), f(pc.peerAvg.pb), pc.peerAvg.epsGrowth1Y!=null?`${f(pc.peerAvg.epsGrowth1Y)}%`:"—", pc.peerAvg.epsGrowth5Y!=null?`${f(pc.peerAvg.epsGrowth5Y)}%`:"—"],
      ]
    );
    if (pc.sectorMedian) { row("Sektor-Median P/E", f(pc.sectorMedian.pe)); row("Sektor-Median PEG", f(pc.sectorMedian.peg, 2)); }
  }

  // ==================== S8: RISIKOINVERSION ====================
  sec(8, "INVERSION — RISIKOEINPREISUNG");
  if (data.risks?.length) {
    tbl(
      ["Risiko", "Kategorie", "EW%", "Impact%", "Exp. Damage"],
      data.risks.map(r => [r.name.substring(0,38), r.category, `${r.ew||r.probability}%`, `${r.impact}%`, `${f(r.expectedDamage,2)}%`])
    );
    row("Total Expected Damage", `${f(data.risks.reduce((s,r)=>s+(r.expectedDamage||0),0), 2)}%`);
  }

  // ==================== S9: RSL ====================
  sec(9, "RSL-MOMENTUM");
  if (data.rsl?.value) {
    row("RSL-Wert", f(data.rsl.value, 2));
    row("26-Wochen-Durchschnitt", `$${data.rsl.avg26w?.toFixed(2) || "—"}`);
    row("Bewertung", data.rsl.value > 110 ? "Strong — Starkes Momentum" : data.rsl.value > 105 ? "Neutral" : "Weak — DCF-Wachstum adjustiert -5-10%");
  } else { para("RSL-Daten nicht verfügbar."); }

  // ==================== S10: TECHNISCHE ANALYSE + 5Y CHART ====================
  sec(10, "TECHNISCHE ANALYSE");
  const t = data.technicals || {} as any;
  tbl(["Bedingung", "Status", "Wert"], [
    ["Kurs > MA200", t.priceAboveMA200 ? "JA ✓" : "NEIN ✗", t.ma200 ? `MA200: $${f(t.ma200,2)}` : "—"],
    ["MA50 > MA200", t.ma50AboveMA200 ? "JA ✓" : "NEIN ✗", t.ma50 ? `MA50: $${f(t.ma50,2)}` : "—"],
    ["MACD > 0", t.macdAboveZero ? "JA ✓" : "NEIN ✗", t.macdValue != null ? `MACD: ${f(t.macdValue,4)}` : "—"],
    ["MACD steigend", t.macdRising ? "JA ✓" : "NEIN ✗", t.macdSignal != null ? `Signal: ${f(t.macdSignal,4)}` : "—"],
  ]);
  const allBuy = t.priceAboveMA200 && t.ma50AboveMA200 && t.macdAboveZero && t.macdRising;
  row("Kaufsignal", allBuy ? "JA — alle Bedingungen erfüllt ✓" : "NEIN — nicht alle Bedingungen erfüllt ✗");

  // 5-JAHRES CHART mit gleitenden Durchschnitten
  if (data.historicalPrices?.length && data.historicalPrices.length > 50) {
    sub("5-Jahres-Chart (Kurs + MA200 + MA50)");
    np(48);
    const chartX = M; const chartY = y; const chartW = cW; const chartH = 40;
    doc.setFillColor(15, 22, 40); doc.rect(chartX, chartY, chartW, chartH, "F");
    doc.setDrawColor(25, 35, 55); // Grid
    for (let g = 0; g <= 4; g++) { const gy = chartY + (chartH * g / 4); doc.line(chartX, gy, chartX + chartW, gy); }

    const prices = data.historicalPrices.slice(-1260); // 5Y
    const closes = prices.map(p => p.close).filter(c => c > 0);
    if (closes.length > 50) {
      const cMin = Math.min(...closes) * 0.97;
      const cMax = Math.max(...closes) * 1.03;
      const cRange = cMax - cMin || 1;
      const step = chartW / (closes.length - 1);

      const toY = (v: number) => chartY + chartH - ((v - cMin) / cRange) * chartH;

      // Price line (blue)
      doc.setDrawColor(60, 130, 220); doc.setLineWidth(0.2);
      for (let i = 1; i < closes.length; i++) {
        doc.line(chartX + (i-1)*step, toY(closes[i-1]), chartX + i*step, toY(closes[i]));
      }

      // MA200 (yellow/orange)
      if (closes.length > 200) {
        doc.setDrawColor(220, 160, 40); doc.setLineWidth(0.3);
        for (let i = 200; i < closes.length; i++) {
          const ma = closes.slice(i-200, i).reduce((a,b)=>a+b,0) / 200;
          const maPrev = closes.slice(i-201, i-1).reduce((a,b)=>a+b,0) / 200;
          doc.line(chartX + (i-1)*step, toY(maPrev), chartX + i*step, toY(ma));
        }
      }

      // MA50 (red)
      if (closes.length > 50) {
        doc.setDrawColor(220, 70, 70); doc.setLineWidth(0.25);
        for (let i = 50; i < closes.length; i++) {
          const ma = closes.slice(i-50, i).reduce((a,b)=>a+b,0) / 50;
          const maPrev = closes.slice(i-51, i-1).reduce((a,b)=>a+b,0) / 50;
          doc.line(chartX + (i-1)*step, toY(maPrev), chartX + i*step, toY(ma));
        }
      }

      // Y-axis labels
      doc.setFontSize(4.5); doc.setTextColor(80, 90, 110);
      doc.text(`$${f(cMax, 0)}`, chartX + 1, chartY + 3);
      doc.text(`$${f((cMax+cMin)/2, 0)}`, chartX + 1, chartY + chartH/2 + 1);
      doc.text(`$${f(cMin, 0)}`, chartX + 1, chartY + chartH - 1);

      // X-axis
      const first = prices[0]?.date?.substring(0, 7) || "";
      const last = prices[prices.length - 1]?.date?.substring(0, 7) || "";
      const mid = prices[Math.floor(prices.length/2)]?.date?.substring(0, 7) || "";
      doc.text(first, chartX, chartY + chartH + 3);
      doc.text(mid, chartX + chartW/2 - 5, chartY + chartH + 3);
      doc.text(last, chartX + chartW - 12, chartY + chartH + 3);

      // Legend
      const legY = chartY + chartH + 6;
      doc.setFontSize(4.5);
      doc.setDrawColor(60,130,220); doc.setLineWidth(0.5); doc.line(chartX, legY, chartX + 6, legY);
      doc.setTextColor(100,120,150); doc.text("Kurs", chartX + 8, legY + 1);
      doc.setDrawColor(220,160,40); doc.line(chartX + 22, legY, chartX + 28, legY);
      doc.text("MA200", chartX + 30, legY + 1);
      doc.setDrawColor(220,70,70); doc.line(chartX + 48, legY, chartX + 54, legY);
      doc.text("MA50", chartX + 56, legY + 1);

      y = legY + 4;
    }
  }

  // ==================== S11: MOAT & PORTER ====================
  sec(11, "MOAT & PORTER'S FIVE FORCES");
  row("Moat Rating", data.moatRating || "—");
  const moat = data.moatAssessment || {} as any;
  if (moat.moatSources?.length) {
    sub("Moat-Quellen");
    for (const s of moat.moatSources.slice(0, 5)) para(`• ${s}`);
  }
  if (moat.porterForces?.length) {
    sub("Porter's Five Forces");
    tbl(["Force", "Bewertung", "Score"], moat.porterForces.map((pf: any) => [pf.name || "—", pf.rating || "—", `${pf.score || "—"}/5`]));
  } else if (moat.porterScores && Object.keys(moat.porterScores).length) {
    sub("Porter's Five Forces");
    tbl(["Force", "Bewertung", "Score"], Object.entries(moat.porterScores).map(([k, v]: [string, any]) => [v.name || k, v.rating || "—", `${v.score || "—"}/5`]));
  }

  // ==================== S12: PESTEL ====================
  sec(12, "PESTEL-ANALYSE");
  const pestel = data.pestelAnalysis;
  if (pestel) {
    row("Gesamt-Exposure", pestel.overallExposure || "—");
    row("Geopolitischer Score", `${pestel.geopoliticalScore || "—"} / 10`);
    para(pestel.macroSummary);
    if (pestel.interestRateOutlook) row("Zinsen-Ausblick", pestel.interestRateOutlook.substring(0, 85));
    if (pestel.factors?.length) {
      sub("PESTEL-Faktoren");
      for (const cat of pestel.factors.slice(0, 6)) {
        if (typeof cat === 'object' && cat.category) {
          np(6);
          doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(140,155,180);
          doc.text(`${cat.icon || ""} ${cat.categoryDE || cat.category}`, M + 1, y + 2.5); y += 4;
          if (cat.factors?.length) {
            for (const ff of cat.factors.slice(0, 3)) {
              para(`${ff.name}: ${ff.description || ff.stockCorrelationNote || ""} [Impact: ${ff.impact}, Severity: ${ff.severity}]`, 250);
            }
          }
        }
      }
    }
  }

  // ==================== S13: MAKRO-KORRELATIONEN ====================
  sec(13, "MAKRO-KORRELATIONEN");
  const mc2 = data.macroCorrelations;
  if (mc2) {
    row("Makro-Sensitivität", mc2.overallMacroSensitivity || "—");
    para(mc2.keyInsight);
    if (mc2.correlations?.length) {
      tbl(["Indikator", "Korrelation", "Stärke"], mc2.correlations.slice(0, 8).map((c: any) => [c.indicator || c.name, c.correlation || c.direction, c.strength]));
    }
  }

  // ==================== S14: REVERSE DCF ====================
  sec(14, "REVERSE DCF");
  if (data.reverseDCF) {
    row("Implied Growth Rate g*", `${f(data.reverseDCF.impliedGrowth, 2)}%`);
    row("Bewertung", data.reverseDCF.assessment || "—");
    const ig = data.reverseDCF.impliedGrowth;
    const ag = data.epsGrowth5Y || 5;
    if (ig != null && ig > ag * 1.5) para(`⚠ Implied Growth (${f(ig)}%) > Actual (${f(ag)}%): Markt preist zu viel Optimismus ein.`);
    else if (ig != null && ig < 0) para(`⚠ Implied Growth negativ (${f(ig)}%): Markt preist Schrumpfung ein.`);
  }

  // ==================== S15: KATALYSATOREN (Anti-Bias) ====================
  sec(15, "KURSANSTIEG-KATALYSATOREN (Anti-Bias)");
  if (data.catalysts?.length) {
    for (const c of data.catalysts) {
      np(10);
      doc.setFontSize(6.5); doc.setFont("helvetica","bold"); doc.setTextColor(195,200,215);
      doc.text(c.name.substring(0, 55), M, y + 3);
      doc.setTextColor(80,160,240); doc.text(`PoS ${c.pos}% | GB ${f(c.gb,2)}%`, W - M, y + 3, { align: "right" });
      y += 5;
      if (c.context) para(`  ${c.context}`, 400);
    }
    sub("Downside-Katalysatoren (Anti-Bias)");
    para("Anti-Bias-Protokoll: Kein selektiver Upside ohne symmetrischen Downside.");
    if (data.risks?.length) {
      for (const r of data.risks.slice(0, 3)) para(`• ${r.name}: EW ${r.ew||r.probability}% × Impact ${r.impact}% = ${f(r.expectedDamage,2)}% Schaden`);
    }
  }

  // ==================== S16: MONTE CARLO ====================
  sec(16, "MONTE CARLO SIMULATION (GBM)");
  const mc = data.monteCarloResults;
  if (mc && mc.mean) {
    tbl(["Metrik", "Wert"], [
      ["Mean", `$${f(mc.mean,2)}`], ["Median (P50)", `$${f(mc.median,2)}`],
      ["P10 (Bearish)", `$${f(mc.p10,2)}`], ["P90 (Bullish)", `$${f(mc.p90,2)}`],
      ["P(Verlust)", `${f(mc.probLoss)}%`], ["P(≥20% Verlust)", `${f(mc.probLoss20)}%`],
    ]);
    para(`Formel: S_{t+Δt} = S_t × exp((μ − σ²/2)×Δt + σ×√Δt×Z), Z ~ N(0,1), 10.000 Simulationen, 252 Trading Days.`);
  } else { para("Monte Carlo Ergebnisse nicht verfügbar (benötigt ausreichend Preishistorie)."); }

  // ==================== S17: ZUSAMMENFASSUNG & FAZIT ====================
  sec(17, "ZUSAMMENFASSUNG & FAZIT");
  tbl(["Kennzahl", "Wert", "Kennzahl", "Wert"], [
    ["Kurs", `$${data.currentPrice?.toFixed(2)||"—"}`, "P/E (TTM)", f(data.peRatio)],
    ["PEG", f(data.pegRatio,2), "EV/EBITDA", f(data.evEbitda)],
    ["FCF Margin", `${f(data.fcfMargin)}%`, "Moat", data.moatRating || "—"],
    ["RSL", data.rsl?.value ? f(data.rsl.value,1) : "—", "Max Drawdown", `${data.maxDrawdownHistory||"—"}%`],
    ["EPS Growth 5Y", `${f(data.epsGrowth5Y)}%`, "Kaufsignal", allBuy ? "JA ✓" : "NEIN ✗"],
    ["Analyst PT", `$${data.analystPT?.median?.toFixed(2)||"—"} (${pct(ptUp)})`, "Kat. Upside", data.catalysts?.length ? `+${f(data.catalysts.reduce((s,c)=>s+c.gb,0),2)}%` : "—"],
  ]);

  // ======= FAZIT-BOX =======
  np(32);
  y += 2;
  let positives = 0, negatives = 0;
  const posList: string[] = [], negList: string[] = [];
  if (data.peRatio && data.sectorAvgPE && data.peRatio < data.sectorAvgPE) { positives++; posList.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — Discount`); }
  else if (data.peRatio && data.sectorAvgPE && data.peRatio > data.sectorAvgPE * 1.2) { negatives++; negList.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — Premium`); }
  if (data.pegRatio && data.pegRatio < 1) { positives++; posList.push(`PEG ${f(data.pegRatio,2)} < 1 — unterbewertet`); }
  else if (data.pegRatio && data.pegRatio > 2) { negatives++; negList.push(`PEG ${f(data.pegRatio,2)} > 2 — teuer`); }
  if (data.fcfMargin && data.fcfMargin > 15) { positives++; posList.push(`FCF Margin ${f(data.fcfMargin)}% — stark`); }
  if (data.rsl?.value && data.rsl.value > 110) { positives++; posList.push(`RSL ${f(data.rsl.value)} — starkes Momentum`); }
  else if (data.rsl?.value && data.rsl.value < 95) { negatives++; negList.push(`RSL ${f(data.rsl.value)} — schwaches Momentum`); }
  if (data.catalysts?.length) { const gb = data.catalysts.reduce((s,c)=>s+c.gb,0); if (gb > 10) { positives++; posList.push(`Katalysatoren-Upside +${f(gb,2)}%`); } }
  if (allBuy) { positives++; posList.push("Alle Kaufsignal-Bedingungen erfüllt"); } else { negatives++; negList.push("Kaufsignal nicht erfüllt"); }

  const verdict = positives > negatives + 1 ? "ATTRAKTIV" : positives > negatives ? "LEICHT ATTRAKTIV" : positives === negatives ? "NEUTRAL" : "UNATTRAKTIV";
  const vC = verdict.includes("ATTRAKTIV") ? [80,200,80] : verdict === "NEUTRAL" ? [150,160,180] : [200,80,80];

  doc.setFillColor(vC[0]/10, vC[1]/10, vC[2]/10+10);
  doc.setDrawColor(vC[0], vC[1], vC[2]);
  doc.roundedRect(M, y, cW, 16, 2, 2, "FD");
  doc.setFontSize(12); doc.setFont("helvetica","bold"); doc.setTextColor(vC[0], vC[1], vC[2]);
  doc.text(`FAZIT: ${verdict}`, W / 2, y + 7, { align: "center" });
  doc.setFontSize(6.5); doc.setFont("helvetica","normal"); doc.setTextColor(160,165,180);
  doc.text(`${data.companyName} (${data.ticker}) — ${positives} positive, ${negatives} negative Faktoren`, W / 2, y + 12.5, { align: "center" });
  y += 20;

  if (posList.length) {
    sub("Positive Faktoren");
    for (const p of posList) { np(3.5); doc.setFontSize(6); doc.setTextColor(80,200,80); doc.text(`+ ${p}`, M + 2, y + 2); y += 3.5; }
  }
  if (negList.length) {
    sub("Negative Faktoren");
    for (const n of negList) { np(3.5); doc.setFontSize(6); doc.setTextColor(200,80,80); doc.text(`− ${n}`, M + 2, y + 2); y += 3.5; }
  }

  // ======= FOOTER =======
  np(10); y += 2;
  doc.setDrawColor(40, 50, 70); doc.line(M, y, W - M, y); y += 3;
  doc.setFontSize(5); doc.setFont("helvetica","italic"); doc.setTextColor(80,90,110);
  doc.text("Stock Analyst Pro — Erstellt mit Perplexity Computer", M, y + 2);
  doc.text("Quellen: Perplexity Finance API, Damodaran (NYU Stern), SEC EDGAR, Google News (EN/DE)", M, y + 5);
  doc.text(`Generiert: ${new Date().toLocaleString("de-DE")} | ${doc.getNumberOfPages()} Seiten`, W - M, y + 2, { align: "right" });

  const filename = `${data.ticker}_Analyse_${new Date().toISOString().slice(0,10)}.pdf`;
  try { doc.save(filename); } catch { window.open(URL.createObjectURL(doc.output('blob')), '_blank'); }
}
