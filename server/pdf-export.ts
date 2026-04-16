/**
 * LLM-based PDF Export: Server-side HTML generation + Playwright PDF rendering
 * 
 * Flow: Analysis data → Claude generates structured HTML → Playwright renders to PDF
 */
import { chromium } from 'playwright-core';

// ===== Formatting helpers =====
function f(v: number | null | undefined, d = 1): string { return v != null && isFinite(v) ? v.toFixed(d) : "—"; }
function fB(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v/1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v/1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v/1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}
function pct(v: number | null | undefined, d = 1): string { return v != null && isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—"; }
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ===== DCF calculator =====
function dcfCalc(data: any, wacc: number, gr: number): number {
  const fcf = data.fcfTTM || 0;
  const shares = data.sharesOutstanding || 1;
  const nd = (data.totalDebt || 0) - (data.cashEquivalents || 0);
  const tg = 2.5;
  let pv = 0, last = fcf;
  for (let yr = 1; yr <= 5; yr++) { last *= (1 + gr / 100); pv += last / Math.pow(1 + wacc / 100, yr); }
  pv += (last * (1 + tg / 100) / (wacc / 100 - tg / 100)) / Math.pow(1 + wacc / 100, 5);
  return (pv - nd) / shares;
}

// ===== Build Fazit signals (same logic as Section13.tsx) =====
function buildFazit(data: any) {
  const sp = data.sectorProfile;
  const wS = sp?.waccScenarios;
  const g = data.epsGrowth5Y || 5;
  const konsDCF = wS ? dcfCalc(data, wS.kons, g * 0.7) : 0;
  const stressDCF = wS ? dcfCalc(data, wS.kons * 1.2, g * 0.3) : 0;
  const konsUpside = data.currentPrice ? (konsDCF / data.currentPrice - 1) * 100 : 0;
  const stressDown = data.currentPrice ? (stressDCF / data.currentPrice - 1) * 100 : 0;
  const totalGB = data.catalysts?.reduce((s: number, c: any) => s + c.gb, 0) || 0;
  const totalExpDmg = data.risks?.reduce((s: number, r: any) => s + (r.expectedDamage || 0), 0) || 0;
  const riskFactor = 1 - totalExpDmg / 100;
  const ddPct = parseFloat(String(data.maxDrawdownHistory)) || 30;
  const sectorDD = data.sectorMaxDrawdown || 35;
  const price = data.currentPrice || 0;
  const worstCase = price ? Math.min(
    price * (1 - Math.min(0.9, (data.beta5Y || 1) * 0.5)),
    price * (1 - sectorDD / 100),
    price * (1 - ddPct / 100)
  ) : 0;
  const crvCons = price && (price - worstCase) > 0 ? (konsDCF - worstCase) / (price - worstCase) : 0;
  const raCrvCons = price && (price - worstCase) > 0 ? (konsDCF * riskFactor - worstCase) / (price - worstCase) : 0;
  const dcfBeiCRV3 = (konsDCF + 3 * worstCase) / 4;
  const rsl = data.rsl?.value || 0;
  const t = data.technicals || {};
  const allBuy = t.priceAboveMA200 && t.ma50AboveMA200 && t.macdAboveZero && t.macdRising;
  const ptUp = data.analystPT?.median && price ? ((data.analystPT.median - price) / price * 100) : 0;

  const pos: string[] = [], neg: string[] = [], neut: string[] = [];

  // S1: P/E
  if (data.peRatio > 0 && data.sectorAvgPE > 0) {
    const prem = ((data.peRatio / data.sectorAvgPE) - 1) * 100;
    if (prem < -20) pos.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — ${f(Math.abs(prem),0)}% Discount`);
    else if (prem > 30) neg.push(`P/E ${f(data.peRatio)} vs Sektor ${f(data.sectorAvgPE)} — ${f(prem,0)}% Premium`);
  }
  if (totalGB > 10) pos.push(`Katalysatoren-Upside +${f(totalGB,1)}% (${data.catalysts?.length||0} Treiber)`);
  if (data.cycleClassification) neut.push(`Zyklusklassifikation: ${data.cycleClassification}`);
  if (data.pegRatio && data.pegRatio < 1) pos.push(`PEG ${f(data.pegRatio,2)} < 1 — unterbewertet`);
  else if (data.pegRatio && data.pegRatio > 2) neg.push(`PEG ${f(data.pegRatio,2)} > 2 — teuer`);
  if (konsUpside > 30) pos.push(`Kons. DCF +${f(konsUpside,0)}% Upside`);
  else if (konsUpside < -10) neg.push(`Kons. DCF zeigt ${f(konsUpside,0)}% Downside — Überbewertung`);
  if (crvCons >= 2.5) pos.push(`CRV Base ${f(crvCons,1)}:1 — attraktiv`);
  else if (crvCons < 2.0) neg.push(`CRV Base nur ${f(crvCons,1)}:1 — unzureichend`);
  if (raCrvCons < 1.5) neg.push(`CRV Risikoadj. nur ${f(raCrvCons,1)}:1 — Risiken nicht eingepreist`);
  if (price && price <= dcfBeiCRV3) pos.push(`Kurs UNTER Max-Entry ($${f(dcfBeiCRV3,2)})`);
  else if (price) neg.push(`Kurs ($${price.toFixed(2)}) ÜBER Max-Entry ($${f(dcfBeiCRV3,2)}) bei CRV 3:1`);
  if (totalExpDmg > 15) neg.push(`Expected Damage ${f(totalExpDmg,1)}% — erhebliche Risiko-Exposition`);
  else if (totalExpDmg < 8) pos.push(`Expected Damage nur ${f(totalExpDmg,1)}%`);
  if (rsl > 110) pos.push(`RSL ${f(rsl,0)} — starkes Momentum`);
  else if (rsl > 0 && rsl < 105) neg.push(`RSL ${f(rsl,0)} — schwaches Momentum`);
  if (allBuy) pos.push(`Technisch: BUY-Signal`);
  else {
    const bears: string[] = [];
    if (!t.priceAboveMA200) bears.push('Kurs < MA200');
    if (!t.ma50AboveMA200) bears.push('Death Cross');
    if (bears.length >= 2) neg.push(`Technisch: KEIN Buy-Signal (${bears.join(', ')})`);
  }
  if (data.moatAssessment?.overallRating === 'Wide') pos.push(`Breiter Moat — Wettbewerbsvorteil`);
  if (data.fcfMargin && data.fcfMargin > 20) pos.push(`Starke FCF-Marge ${f(data.fcfMargin,1)}%`);
  if (ptUp > 20) pos.push(`Analysten sehen ${f(ptUp,0)}% Upside`);
  if (data.macroCorrelations?.overallMacroSensitivity === 'Hoch') neg.push(`Hohe Makro-Sensitivität`);
  if (data.governmentExposure > 20) neg.push(`Staatsabhängigkeit ${data.governmentExposure}% — FCF-Haircut`);
  if (stressDown < -30) neg.push(`Macro-Stress: ${f(stressDown,0)}% Downside`);

  const score = pos.length - neg.length;
  let verdict = score >= 4 ? "ATTRAKTIV" : score >= 2 ? "LEICHT ATTRAKTIV" : score >= -1 ? "NEUTRAL" : score >= -3 ? "UNATTRAKTIV" : "STARK UNATTRAKTIV";

  return { pos, neg, neut, score, verdict, konsDCF, worstCase, crvCons, raCrvCons, dcfBeiCRV3, totalGB, totalExpDmg, allBuy, ptUp };
}

// ===== Generate HTML =====
export function generateAnalysisHTML(data: any): string {
  const sp = data.sectorProfile;
  const wS = sp?.waccScenarios;
  const g = data.epsGrowth5Y || 5;
  const fs = data.financialStatements || {};
  const inc = fs.incomeStatement || {};
  const bal = fs.balanceSheet || {};
  const cf = fs.cashFlow || {};
  const fazit = buildFazit(data);
  const nd = (data.totalDebt || 0) - (data.cashEquivalents || 0);
  const ptUp = data.analystPT?.median && data.currentPrice ? ((data.analystPT.median - data.currentPrice) / data.currentPrice * 100) : null;

  // DCF scenarios
  const konsFV = wS ? dcfCalc(data, wS.kons, g * 0.7) : 0;
  const baseFV = wS ? dcfCalc(data, wS.avg, g) : 0;
  const optFV = wS ? dcfCalc(data, wS.opt, g * 1.2) : 0;

  // CRITICAL: 'UNATTRAKTIV' and 'STARK UNATTRAKTIV' must be RED, not green
  const verdictColor = (fazit.verdict === 'ATTRAKTIV' || fazit.verdict === 'LEICHT ATTRAKTIV') ? '#22c55e' : fazit.verdict === 'NEUTRAL' ? '#eab308' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 9px; line-height: 1.4; color: #c8cdd5; background: #0c1223; }
  .page { page-break-after: always; }
  h1 { font-size: 18px; color: #50a0f0; margin-bottom: 2px; }
  .subtitle { font-size: 9px; color: #646e82; margin-bottom: 10px; }
  .sec-header { background: #141e32; padding: 4px 8px; margin: 10px 0 6px; border-left: 3px solid #50a0f0; }
  .sec-header span { font-size: 10px; font-weight: 700; color: #50a0f0; }
  .sub { font-size: 9px; font-weight: 700; color: #6490be; margin: 6px 0 3px; }
  .row { display: flex; justify-content: space-between; padding: 1.5px 0; border-bottom: 1px solid #1a2540; }
  .row-label { color: #7880a0; font-size: 8.5px; }
  .row-val { color: #d0d5e0; font-weight: 600; font-size: 8.5px; text-align: right; }
  .para { font-size: 8px; color: #9aa0b0; margin: 2px 0 4px 4px; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin: 3px 0; font-size: 8px; }
  th { background: #162034; color: #6495cc; font-weight: 600; padding: 3px 5px; text-align: left; border-bottom: 1px solid #243050; font-size: 7.5px; }
  td { padding: 2.5px 5px; border-bottom: 1px solid #1a2540; color: #b0b5c5; }
  tr:nth-child(even) td { background: #111b2c; }
  .pos { color: #22c55e; } .neg { color: #ef4444; } .neut { color: #94a3b8; }
  .verdict-box { border: 2px solid ${verdictColor}; background: ${verdictColor}10; border-radius: 8px; padding: 12px; text-align: center; margin: 10px 0; }
  .verdict-text { font-size: 16px; font-weight: 800; color: ${verdictColor}; }
  .verdict-sub { font-size: 9px; color: #a0a5b5; margin-top: 4px; }
  .warn { background: #2a1a10; border: 1px solid #c89630; border-radius: 4px; padding: 3px 6px; margin: 3px 0; font-size: 8px; color: #c89630; }
  .cat-name { font-weight: 700; color: #c8cde0; font-size: 8.5px; }
  .cat-meta { color: #50a0f0; font-size: 8px; float: right; }
  .cat-text { font-size: 7.5px; color: #8890a5; margin: 2px 0 6px 8px; line-height: 1.5; }
  .footer { border-top: 1px solid #2a3550; margin-top: 10px; padding-top: 4px; font-size: 7px; color: #505868; font-style: italic; }
  .chart-placeholder { background: #0f1628; border: 1px solid #1e2a42; border-radius: 4px; padding: 6px; margin: 4px 0; font-size: 8px; color: #6a7090; }
  .factor-list { margin: 2px 0 4px 8px; }
  .factor-list li { list-style: none; font-size: 8px; padding: 1px 0; }
</style>
</head>
<body>

<!-- HEADER -->
<h1>Stock Analyst Pro</h1>
<div class="subtitle">${esc(data.ticker)} — ${esc(data.companyName)} | ${esc(data.sector)} / ${esc(data.industry)} &nbsp;&nbsp; ${new Date().toLocaleDateString('de-DE')} | Alle Werte in ${data.currency || 'USD'}</div>

${data.consistencyWarnings?.length ? data.consistencyWarnings.map((w: any) => `<div class="warn">⚠ ${esc(w.title)}: ${esc(w.detail.substring(0,120))}</div>`).join('') : ''}

<!-- S1: DATENAKTUALITÄT -->
<div class="sec-header"><span>1 &nbsp; DATENAKTUALITÄT & PLAUSIBILITÄT</span></div>
<table>
<tr><td class="row-label">Kurs</td><td class="row-val">$${data.currentPrice?.toFixed(2)||'—'}</td><td class="row-label">Market Cap</td><td class="row-val">${fB(data.marketCap)}</td></tr>
<tr><td class="row-label">P/E (TTM)</td><td class="row-val">${f(data.peRatio)}</td><td class="row-label">Forward P/E</td><td class="row-val">${f(data.forwardPE)}</td></tr>
<tr><td class="row-label">PEG</td><td class="row-val">${f(data.pegRatio,2)}</td><td class="row-label">EV/EBITDA</td><td class="row-val">${f(data.evEbitda)}</td></tr>
<tr><td class="row-label">Beta (5Y)</td><td class="row-val">${f(data.beta5Y,2)}</td><td class="row-label">FCF TTM</td><td class="row-val">${fB(data.fcfTTM)}</td></tr>
<tr><td class="row-label">FCF Margin</td><td class="row-val">${f(data.fcfMargin)}%</td><td class="row-label">EPS Growth 5Y</td><td class="row-val">${f(data.epsGrowth5Y)}%</td></tr>
</table>
<div class="row"><span class="row-label">Analysten-Konsens</span><span class="row-val">Median $${data.analystPT?.median?.toFixed(2)||'—'} | High $${data.analystPT?.high?.toFixed(2)||'—'} | Low $${data.analystPT?.low?.toFixed(2)||'—'} | Upside ${pct(ptUp)}</span></div>

<!-- S2: INVESTMENTTHESE -->
<div class="sec-header"><span>2 &nbsp; INVESTMENTTHESE & KATALYSATOREN</span></div>
${data.description ? `<div class="sub">Unternehmensbeschreibung</div><div class="para">${esc(data.description.substring(0,500))}${data.description.length > 500 ? '…' : ''}</div>` : ''}
<div class="sub">Investmentthese</div>
<div class="para">${esc(data.growthThesis || '')}</div>
<div class="row"><span class="row-label">Peter Lynch</span><span class="row-val">${data.catalystReasoning?.lynchClassification || '—'}</span></div>
<div class="row"><span class="row-label">Moat</span><span class="row-val">${data.moatRating || '—'}</span></div>
<div class="row"><span class="row-label">FCF Strength</span><span class="row-val">${f(data.fcfMargin)}% Margin · ${fB(data.fcfTTM)} TTM</span></div>
<div class="row"><span class="row-label">Gov. Exposure</span><span class="row-val">${data.governmentExposure || 0}%</span></div>

${data.catalysts?.length ? `
<div class="sub">Katalysatoren-Übersicht</div>
<table>
<tr><th>#</th><th>Name</th><th>Timeline</th><th>PoS%</th><th>Brutto↑</th><th>Einpr%</th><th>Netto↑</th><th>GB%</th></tr>
${data.catalysts.map((c: any, i: number) => `<tr><td>K${i+1}</td><td>${esc(c.name.substring(0,40))}</td><td>${c.timeline}</td><td>${c.pos}%</td><td>+${f(c.bruttoUpside)}%</td><td>${c.einpreisungsgrad}%</td><td>+${f(c.nettoUpside,2)}%</td><td>${f(c.gb,2)}%</td></tr>`).join('')}
</table>
<div class="row"><span class="row-label">Total Catalyst Upside (Σ GB)</span><span class="row-val pos">+${f(fazit.totalGB,2)}%</span></div>

<div class="sub">Katalysatoren-Details (KI-Analyse)</div>
${data.catalysts.map((c: any, i: number) => `
<div style="margin: 4px 0;">
  <span class="cat-name">K${i+1}: ${esc(c.name)}</span>
  <span class="cat-meta">PoS ${c.pos}% | Brutto +${f(c.bruttoUpside)}% | Einpr. ${c.einpreisungsgrad}% | GB ${f(c.gb,2)}%</span>
  ${c.context ? `<div class="cat-text">${esc(c.context)}</div>` : ''}
</div>`).join('')}
` : ''}

${data.newsItems?.length ? `
<div class="sub">Aktuelle Nachrichten (EN/DE)</div>
<table>
<tr><th>#</th><th>Nachricht</th><th>Quelle</th><th>Alter</th><th>Spr.</th></tr>
${data.newsItems.slice(0,10).map((n: any, i: number) => `<tr><td>${i+1}</td><td>${esc((n.title||'').substring(0,55))}</td><td>${esc((n.source||'').substring(0,18))}</td><td>${n.relativeTime||''}</td><td>${(n.lang||'en').toUpperCase()}</td></tr>`).join('')}
</table>` : ''}

<!-- S3: ZYKLUSANALYSE -->
<div class="sec-header"><span>3 &nbsp; ZYKLUS- & STRUKTURANALYSE</span></div>
<div class="row"><span class="row-label">Zyklusklassifikation</span><span class="row-val">${data.cycleClassification || '—'}</span></div>
<div class="row"><span class="row-label">Politischer Zyklus</span><span class="row-val">${data.politicalCycle || '—'}</span></div>
${data.structuralTrends?.length ? `<div class="sub">Strukturelle Trends</div>${data.structuralTrends.map((t: any) => `<div class="para">· ${typeof t === 'string' ? esc(t) : esc(t.name || '')}</div>`).join('')}` : ''}

<!-- S4: BEWERTUNG -->
<div class="sec-header"><span>4 &nbsp; BEWERTUNGSKENNZAHLEN</span></div>
${wS ? `<table><tr><th>Szenario</th><th>WACC</th><th>Kommentar</th></tr>
<tr><td>Konservativ</td><td>${wS.kons}%</td><td>Risikopuffer für Downside</td></tr>
<tr><td>Base Case</td><td>${wS.avg}%</td><td>Marktkonsens-Niveau</td></tr>
<tr><td>Optimistisch</td><td>${wS.opt}%</td><td>Best-Case bei Zinssenkungen</td></tr></table>` : ''}
<div class="row"><span class="row-label">PEG Ratio</span><span class="row-val">${f(data.pegRatio,2)}</span></div>
<div class="row"><span class="row-label">P/E vs Sektor</span><span class="row-val">${f(data.peRatio)} vs ${f(data.sectorAvgPE)}</span></div>
<div class="row"><span class="row-label">EV/EBITDA vs Sektor</span><span class="row-val">${f(data.evEbitda)} vs ${f(data.sectorAvgEVEBITDA)}</span></div>

<!-- S5: DCF -->
<div class="sec-header"><span>5 &nbsp; DCF-MODELL (FCFF, WACC via CAPM, Gordon Growth)</span></div>
<table>
<tr><td class="row-label">Revenue</td><td class="row-val">${fB(data.revenue)}</td><td class="row-label">Gross Margin</td><td class="row-val">${f(inc.grossMargin)}%</td></tr>
<tr><td class="row-label">EBIT</td><td class="row-val">${fB(data.operatingIncome)}</td><td class="row-label">EBIT-Margin</td><td class="row-val">${f(inc.operatingMargin)}%</td></tr>
<tr><td class="row-label">EBITDA</td><td class="row-val">${fB(data.ebitda)}</td><td class="row-label">Net Margin</td><td class="row-val">${f(inc.netMargin)}%</td></tr>
<tr><td class="row-label">FCF TTM</td><td class="row-val">${fB(data.fcfTTM)}</td><td class="row-label">Net Debt</td><td class="row-val">${fB(nd)}</td></tr>
</table>
${wS ? `<div class="sub">DCF-Szenarien (5Y → Gordon Growth Terminal Value)</div>
<table><tr><th>Szenario</th><th>WACC</th><th>Wachstum</th><th>Fair Value/Aktie</th><th>vs. Kurs</th></tr>
<tr><td>Konservativ</td><td>${wS.kons}%</td><td>${f(g*0.7)}%</td><td>$${f(konsFV,2)}</td><td>${pct(data.currentPrice ? (konsFV/data.currentPrice-1)*100 : null)}</td></tr>
<tr><td>Base Case</td><td>${wS.avg}%</td><td>${f(g)}%</td><td>$${f(baseFV,2)}</td><td>${pct(data.currentPrice ? (baseFV/data.currentPrice-1)*100 : null)}</td></tr>
<tr><td>Optimistisch</td><td>${wS.opt}%</td><td>${f(g*1.2)}%</td><td>$${f(optFV,2)}</td><td>${pct(data.currentPrice ? (optFV/data.currentPrice-1)*100 : null)}</td></tr>
</table>
<div class="row"><span class="row-label">Katalysatoren-adj. Zielwert</span><span class="row-val">$${f(konsFV * (1 + fazit.totalGB/100), 2)} (Kons. DCF × (1 + ${f(fazit.totalGB,1)}%))</span></div>
<div class="row"><span class="row-label">DCF vs Kurs</span><span class="row-val">${pct(data.currentPrice ? (konsFV/data.currentPrice-1)*100 : null)} ${data.currentPrice && konsFV < data.currentPrice * 0.9 ? '→ Überbewertet' : data.currentPrice && konsFV > data.currentPrice * 1.1 ? '→ Unterbewertet' : '→ Fair'}</span></div>` : ''}

<!-- S6: CRV -->
<div class="sec-header"><span>6 &nbsp; RISIKOADJUSTIERTES CRV</span></div>
<div class="row"><span class="row-label">Max Drawdown (hist.)</span><span class="row-val">${String(data.maxDrawdownHistory||'—').replace('%','')}% (${data.maxDrawdownYear||'?'})</span></div>
<div class="row"><span class="row-label">Worst Case = min(M1,M2,M3)</span><span class="row-val">$${f(fazit.worstCase,2)}</span></div>
<div class="row"><span class="row-label">Fair Value (Kons. DCF)</span><span class="row-val">$${f(fazit.konsDCF,2)}</span></div>
<div class="row"><span class="row-label">CRV Base</span><span class="row-val">${f(fazit.crvCons,1)}:1</span></div>
<div class="row"><span class="row-label">CRV Risikoadjustiert</span><span class="row-val">${f(fazit.raCrvCons,1)}:1</span></div>
<div class="row"><span class="row-label">Max-Entry (CRV 3:1)</span><span class="row-val">$${f(fazit.dcfBeiCRV3,2)}</span></div>

<!-- S7: RELATIVE BEWERTUNG -->
<div class="sec-header"><span>7 &nbsp; RELATIVE BEWERTUNG (Peer Comparison)</span></div>
${data.peerComparison?.peers?.length ? `<table>
<tr><th>Ticker</th><th>P/E</th><th>PEG</th><th>P/S</th><th>P/B</th><th>EPS 1Y</th><th>EPS 5Y</th></tr>
<tr style="font-weight:600"><td>${data.peerComparison.subject.ticker}</td><td>${f(data.peerComparison.subject.pe)}</td><td>${f(data.peerComparison.subject.peg,2)}</td><td>${f(data.peerComparison.subject.ps)}</td><td>${f(data.peerComparison.subject.pb)}</td><td>${data.peerComparison.subject.epsGrowth1Y!=null?f(data.peerComparison.subject.epsGrowth1Y)+'%':'—'}</td><td>${data.peerComparison.subject.epsGrowth5Y!=null?f(data.peerComparison.subject.epsGrowth5Y)+'%':'—'}</td></tr>
${data.peerComparison.peers.map((p: any) => `<tr><td>${p.ticker}</td><td>${f(p.pe)}</td><td>${f(p.peg,2)}</td><td>${f(p.ps)}</td><td>${f(p.pb)}</td><td>${p.epsGrowth1Y!=null?f(p.epsGrowth1Y)+'%':'—'}</td><td>${p.epsGrowth5Y!=null?f(p.epsGrowth5Y)+'%':'—'}</td></tr>`).join('')}
<tr style="font-weight:600;border-top:2px solid #243050"><td>Ø Peers (${data.peerComparison.peers.length})</td><td>${f(data.peerComparison.peerAvg.pe)}</td><td>${f(data.peerComparison.peerAvg.peg,2)}</td><td>${f(data.peerComparison.peerAvg.ps)}</td><td>${f(data.peerComparison.peerAvg.pb)}</td><td>${data.peerComparison.peerAvg.epsGrowth1Y!=null?f(data.peerComparison.peerAvg.epsGrowth1Y)+'%':'—'}</td><td>${data.peerComparison.peerAvg.epsGrowth5Y!=null?f(data.peerComparison.peerAvg.epsGrowth5Y)+'%':'—'}</td></tr>
</table>` : '<div class="para">Keine Peer-Daten verfügbar.</div>'}

<!-- S8: RISIKOINVERSION -->
<div class="sec-header"><span>8 &nbsp; INVERSION — RISIKOEINPREISUNG</span></div>
${data.risks?.length ? `<table>
<tr><th>Risiko</th><th>Kategorie</th><th>EW%</th><th>Impact%</th><th>Exp. Damage</th></tr>
${data.risks.map((r: any) => `<tr><td>${esc(r.name.substring(0,42))}</td><td>${r.category}</td><td>${r.ew||r.probability}%</td><td>${r.impact}%</td><td>${f(r.expectedDamage,2)}%</td></tr>`).join('')}
</table>
<div class="row"><span class="row-label">Total Expected Damage</span><span class="row-val neg">${f(fazit.totalExpDmg,2)}%</span></div>` : ''}

<!-- S9: RSL -->
<div class="sec-header"><span>9 &nbsp; RSL-MOMENTUM</span></div>
${data.rsl?.value ? `
<div class="row"><span class="row-label">RSL-Wert</span><span class="row-val">${f(data.rsl.value,2)}</span></div>
<div class="row"><span class="row-label">26-Wochen-Durchschnitt</span><span class="row-val">$${data.rsl.avg26w?.toFixed(2)||'—'}</span></div>
<div class="row"><span class="row-label">Bewertung</span><span class="row-val">${data.rsl.value > 110 ? 'Strong' : data.rsl.value > 105 ? 'Neutral' : 'Weak — DCF Growth -5-10%'}</span></div>
` : '<div class="para">RSL-Daten nicht verfügbar.</div>'}

<!-- S10: TECHNISCHE ANALYSE -->
<div class="sec-header"><span>10 &nbsp; TECHNISCHE ANALYSE</span></div>
<table>
<tr><th>Bedingung</th><th>Status</th><th>Wert</th></tr>
<tr><td>Kurs > MA200</td><td>${data.technicals?.priceAboveMA200 ? '<span class="pos">JA ✓</span>' : '<span class="neg">NEIN ✗</span>'}</td><td>${data.technicals?.ma200 ? '$'+f(data.technicals.ma200,2) : '—'}</td></tr>
<tr><td>MA50 > MA200</td><td>${data.technicals?.ma50AboveMA200 ? '<span class="pos">JA ✓</span>' : '<span class="neg">NEIN ✗</span>'}</td><td>${data.technicals?.ma50 ? '$'+f(data.technicals.ma50,2) : '—'}</td></tr>
<tr><td>MACD > 0</td><td>${data.technicals?.macdAboveZero ? '<span class="pos">JA ✓</span>' : '<span class="neg">NEIN ✗</span>'}</td><td>${data.technicals?.macdValue != null ? f(data.technicals.macdValue,4) : '—'}</td></tr>
<tr><td>MACD steigend</td><td>${data.technicals?.macdRising ? '<span class="pos">JA ✓</span>' : '<span class="neg">NEIN ✗</span>'}</td><td>${data.technicals?.macdSignal != null ? f(data.technicals.macdSignal,4) : '—'}</td></tr>
</table>
<div class="row"><span class="row-label">Kaufsignal</span><span class="row-val">${fazit.allBuy ? '<span class="pos">JA — alle Bedingungen erfüllt ✓</span>' : '<span class="neg">NEIN — nicht alle Bedingungen erfüllt ✗</span>'}</span></div>

${(() => {
  // Generate 5-Year SVG Chart with MA200 + MA50
  const prices = data.historicalPrices || [];
  if (prices.length < 100) return '<div class="para">Chart nicht verf\u00fcgbar (zu wenig Preisdaten).</div>';
  const chartData = prices.slice(-1260); // 5Y
  const closes = chartData.map((p: any) => p.close).filter((c: number) => c > 0);
  if (closes.length < 50) return '';
  const svgW = 700, svgH = 180, padL = 45, padR = 10, padT = 15, padB = 25;
  const cW = svgW - padL - padR, cH = svgH - padT - padB;
  const cMin = Math.min(...closes) * 0.97, cMax = Math.max(...closes) * 1.03;
  const cRange = cMax - cMin || 1;
  const toX = (i: number) => padL + (i / (closes.length - 1)) * cW;
  const toY = (v: number) => padT + cH - ((v - cMin) / cRange) * cH;

  // Build price polyline
  const pricePts = closes.map((c: number, i: number) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(' ');

  // MA200
  let ma200Pts = '';
  if (closes.length > 200) {
    const pts: string[] = [];
    for (let i = 199; i < closes.length; i++) {
      const ma = closes.slice(i - 199, i + 1).reduce((a: number, b: number) => a + b, 0) / 200;
      pts.push(`${toX(i).toFixed(1)},${toY(ma).toFixed(1)}`);
    }
    ma200Pts = pts.join(' ');
  }

  // MA50
  let ma50Pts = '';
  if (closes.length > 50) {
    const pts: string[] = [];
    for (let i = 49; i < closes.length; i++) {
      const ma = closes.slice(i - 49, i + 1).reduce((a: number, b: number) => a + b, 0) / 50;
      pts.push(`${toX(i).toFixed(1)},${toY(ma).toFixed(1)}`);
    }
    ma50Pts = pts.join(' ');
  }

  // X-axis dates
  const dates = chartData.map((p: any) => p.date || '');
  const firstDate = dates[0]?.substring(0, 7) || '';
  const midDate = dates[Math.floor(dates.length / 2)]?.substring(0, 7) || '';
  const lastDate = dates[dates.length - 1]?.substring(0, 7) || '';

  return `
<div class="sub">5-Jahres-Chart (Kurs + MA200 + MA50)</div>
<svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#0f1628;border-radius:4px;margin:4px 0;">
  <!-- Grid lines -->
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+cH}" stroke="#1e2a42" stroke-width="0.5"/>
  <line x1="${padL}" y1="${padT+cH}" x2="${padL+cW}" y2="${padT+cH}" stroke="#1e2a42" stroke-width="0.5"/>
  ${[0,0.25,0.5,0.75,1].map(frac => `<line x1="${padL}" y1="${(padT + cH * (1-frac)).toFixed(1)}" x2="${padL+cW}" y2="${(padT + cH * (1-frac)).toFixed(1)}" stroke="#1a2540" stroke-width="0.3"/>`).join('')}
  <!-- Y-axis labels -->
  <text x="${padL-3}" y="${padT+5}" fill="#5a6580" font-size="7" text-anchor="end">$${Math.round(cMax)}</text>
  <text x="${padL-3}" y="${padT+cH/2+3}" fill="#5a6580" font-size="7" text-anchor="end">$${Math.round((cMax+cMin)/2)}</text>
  <text x="${padL-3}" y="${padT+cH}" fill="#5a6580" font-size="7" text-anchor="end">$${Math.round(cMin)}</text>
  <!-- X-axis labels -->
  <text x="${padL}" y="${svgH-5}" fill="#5a6580" font-size="7">${firstDate}</text>
  <text x="${padL+cW/2}" y="${svgH-5}" fill="#5a6580" font-size="7" text-anchor="middle">${midDate}</text>
  <text x="${padL+cW}" y="${svgH-5}" fill="#5a6580" font-size="7" text-anchor="end">${lastDate}</text>
  <!-- Price line -->
  <polyline points="${pricePts}" fill="none" stroke="#3c82dc" stroke-width="1" stroke-linejoin="round"/>
  <!-- MA200 -->
  ${ma200Pts ? `<polyline points="${ma200Pts}" fill="none" stroke="#dca028" stroke-width="1.2" stroke-linejoin="round"/>` : ''}
  <!-- MA50 -->
  ${ma50Pts ? `<polyline points="${ma50Pts}" fill="none" stroke="#dc4646" stroke-width="1" stroke-linejoin="round"/>` : ''}
  <!-- Legend -->
  <line x1="${padL+10}" y1="${svgH-15}" x2="${padL+22}" y2="${svgH-15}" stroke="#3c82dc" stroke-width="1.5"/>
  <text x="${padL+25}" y="${svgH-12}" fill="#7888a8" font-size="6.5">Kurs</text>
  <line x1="${padL+55}" y1="${svgH-15}" x2="${padL+67}" y2="${svgH-15}" stroke="#dca028" stroke-width="1.5"/>
  <text x="${padL+70}" y="${svgH-12}" fill="#7888a8" font-size="6.5">MA200</text>
  <line x1="${padL+105}" y1="${svgH-15}" x2="${padL+117}" y2="${svgH-15}" stroke="#dc4646" stroke-width="1.5"/>
  <text x="${padL+120}" y="${svgH-12}" fill="#7888a8" font-size="6.5">MA50</text>
</svg>`;
})()}

<!-- S11: MOAT & PORTER -->
<div class="sec-header"><span>11 &nbsp; MOAT & PORTER'S FIVE FORCES</span></div>
<div class="row"><span class="row-label">Moat Rating</span><span class="row-val">${data.moatRating || '—'}</span></div>
${data.moatAssessment?.moatSources?.length ? `<div class="sub">Moat-Quellen</div>${data.moatAssessment.moatSources.slice(0,5).map((s: string) => `<div class="para">· ${esc(s)}</div>`).join('')}` : ''}
${data.moatAssessment?.porterForces?.length ? `<div class="sub">Porter's Five Forces</div><table><tr><th>Force</th><th>Bewertung</th><th>Score</th></tr>
${data.moatAssessment.porterForces.map((pf: any) => `<tr><td>${esc(pf.name||'')}</td><td>${pf.rating||'—'}</td><td>${pf.score||'—'}/5</td></tr>`).join('')}</table>` : ''}

<!-- S12: PESTEL -->
<div class="sec-header"><span>12 &nbsp; PESTEL-ANALYSE</span></div>
${data.pestelAnalysis ? `
<div class="row"><span class="row-label">Gesamt-Exposure</span><span class="row-val">${data.pestelAnalysis.overallExposure||'—'}</span></div>
<div class="row"><span class="row-label">Geopolitischer Score</span><span class="row-val">${data.pestelAnalysis.geopoliticalScore||'—'} / 10</span></div>
<div class="para">${esc(data.pestelAnalysis.macroSummary||'')}</div>
${data.pestelAnalysis.factors?.length ? `<div class="sub">PESTEL-Faktoren</div>
${data.pestelAnalysis.factors.slice(0,6).map((cat: any) => {
  if (!cat?.category) return '';
  const label = (cat.categoryDE || cat.category || '').replace(/[^\x20-\x7E\u00C0-\u024F\u00DF]/g, '').trim();
  return `<div style="margin:3px 0"><strong style="color:#6490be">[${label.charAt(0)}] ${label}</strong></div>
${(cat.factors||[]).slice(0,3).map((ff: any) => `<div class="para">${esc(ff.name||'')}: ${esc(ff.description||ff.stockCorrelationNote||'')} [Impact: ${ff.impact}, Severity: ${ff.severity}]</div>`).join('')}`;
}).join('')}` : ''}` : ''}

<!-- S13: MAKRO-KORRELATIONEN -->
<div class="sec-header"><span>13 &nbsp; MAKRO-KORRELATIONEN</span></div>
${data.macroCorrelations ? `
<div class="row"><span class="row-label">Makro-Sensitivität</span><span class="row-val">${data.macroCorrelations.overallMacroSensitivity||'—'}</span></div>
<div class="para">${esc(data.macroCorrelations.keyInsight||'')}</div>
${data.macroCorrelations.correlations?.length ? `<table><tr><th>Indikator</th><th>Korrelation</th><th>Stärke</th></tr>
${data.macroCorrelations.correlations.slice(0,8).map((c: any) => `<tr><td>${esc(c.indicator||c.name||'')}</td><td>${c.correlation||c.direction||''}</td><td>${c.strength||''}</td></tr>`).join('')}</table>` : ''}` : ''}

<!-- S14: REVERSE DCF -->
<div class="sec-header"><span>14 &nbsp; REVERSE DCF</span></div>
${data.reverseDCF ? `
<div class="row"><span class="row-label">Implied Growth Rate g*</span><span class="row-val">${f(data.reverseDCF.impliedGrowth,2)}%</span></div>
<div class="row"><span class="row-label">Bewertung</span><span class="row-val">${data.reverseDCF.assessment||'—'}</span></div>
` : '<div class="para">Reverse DCF nicht verfügbar.</div>'}

<!-- S15: KATALYSATOREN (Anti-Bias) -->
<div class="sec-header"><span>15 &nbsp; KURSANSTIEG-KATALYSATOREN (Anti-Bias)</span></div>
${data.catalysts?.length ? data.catalysts.map((c: any) => `
<div style="margin:4px 0">
  <span class="cat-name">${esc(c.name)}</span>
  <span class="cat-meta">PoS ${c.pos}% | GB ${f(c.gb,2)}%</span>
  ${c.context ? `<div class="cat-text">${esc(c.context)}</div>` : ''}
</div>`).join('') : ''}
<div class="sub">Downside-Katalysatoren (Anti-Bias)</div>
<div class="para">Anti-Bias-Protokoll: Kein selektiver Upside ohne symmetrischen Downside.</div>
${data.risks?.slice(0,3).map((r: any) => `<div class="para neg">· ${esc(r.name)}: EW ${r.ew||r.probability}% × Impact ${r.impact}% = ${f(r.expectedDamage,2)}% Schaden</div>`).join('')}

<!-- S16: MONTE CARLO -->
<div class="sec-header"><span>16 &nbsp; MONTE CARLO SIMULATION (GBM)</span></div>
${data.monteCarloResults?.mean ? `<table>
<tr><td class="row-label">Mean</td><td class="row-val">$${f(data.monteCarloResults.mean,2)}</td><td class="row-label">Median</td><td class="row-val">$${f(data.monteCarloResults.median,2)}</td></tr>
<tr><td class="row-label">P10 (Bearish)</td><td class="row-val">$${f(data.monteCarloResults.p10,2)}</td><td class="row-label">P90 (Bullish)</td><td class="row-val">$${f(data.monteCarloResults.p90,2)}</td></tr>
<tr><td class="row-label">P(Verlust)</td><td class="row-val">${f(data.monteCarloResults.probLoss)}%</td><td class="row-label">P(≥20% Verlust)</td><td class="row-val">${f(data.monteCarloResults.probLoss20)}%</td></tr>
</table>` : '<div class="para">Monte Carlo Ergebnisse nicht verfügbar.</div>'}

<!-- S17: ZUSAMMENFASSUNG & FAZIT -->
<div class="sec-header"><span>17 &nbsp; ZUSAMMENFASSUNG & FAZIT</span></div>
<table>
<tr><td class="row-label">Kurs</td><td class="row-val">$${data.currentPrice?.toFixed(2)||'—'}</td><td class="row-label">P/E</td><td class="row-val">${f(data.peRatio)}</td></tr>
<tr><td class="row-label">PEG</td><td class="row-val">${f(data.pegRatio,2)}</td><td class="row-label">EV/EBITDA</td><td class="row-val">${f(data.evEbitda)}</td></tr>
<tr><td class="row-label">FCF Margin</td><td class="row-val">${f(data.fcfMargin)}%</td><td class="row-label">Moat</td><td class="row-val">${data.moatRating||'—'}</td></tr>
<tr><td class="row-label">Kaufsignal</td><td class="row-val">${fazit.allBuy ? 'JA ✓' : 'NEIN ✗'}</td><td class="row-label">Kat. Upside</td><td class="row-val">+${f(fazit.totalGB,2)}%</td></tr>
</table>

<!-- FAZIT BOX -->
<div class="verdict-box">
  <div class="verdict-text">FAZIT: ${fazit.verdict}</div>
  <div class="verdict-sub">${esc(data.companyName)} (${data.ticker}) — ${fazit.pos.length} positive, ${fazit.neg.length} negative, ${fazit.neut.length} neutrale Faktoren</div>
</div>

<div class="row"><span class="row-label">Signal-Score</span><span class="row-val">${fazit.pos.length} positiv / ${fazit.neg.length} negativ / ${fazit.neut.length} neutral = ${fazit.verdict}</span></div>

${fazit.pos.length ? `<div class="sub">Positive Faktoren (${fazit.pos.length})</div><ul class="factor-list">${fazit.pos.map(p => `<li class="pos">+ ${esc(p)}</li>`).join('')}</ul>` : ''}
${fazit.neg.length ? `<div class="sub">Negative Faktoren (${fazit.neg.length})</div><ul class="factor-list">${fazit.neg.map(n => `<li class="neg">− ${esc(n)}</li>`).join('')}</ul>` : ''}
${fazit.neut.length ? `<div class="sub">Neutral (${fazit.neut.length})</div><ul class="factor-list">${fazit.neut.map(n => `<li class="neut">● ${esc(n)}</li>`).join('')}</ul>` : ''}

<!-- FOOTER -->
<div class="footer">
  <div>Stock Analyst Pro — Erstellt mit Perplexity Computer</div>
  <div>Quellen: Perplexity Finance API, Damodaran (NYU Stern), SEC EDGAR, Google News (EN/DE)</div>
  <div style="float:right">Generiert: ${new Date().toLocaleString('de-DE')}</div>
</div>

</body></html>`;
}

// ===== Render HTML to PDF with Playwright =====
export async function renderHTMLtoPDF(html: string): Promise<Buffer> {
  const browserPath = '/home/user/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
