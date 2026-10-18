/**
 * JOB D: fehlendes Analysten-Kursziel (FMP ohne Targets → Server setzt analystPT.median = 0, analyze-route.ts:855 `?? 0`).
 * (1) Fazit S17: PT ≤ 0/null/NaN zählt nicht mehr als „-100 % unter Kurs“.
 * (2) computeDcfVsMarketDivergence: ohne PT kein Divergenz-Flag (kein künstlicher Analysten-Upside -100 %).
 * (3) Deep-Dive-Prompt: kein „Analyst PT: $0.00“, Kurs/PT in Listing-Währung, sobald sie übergeben wird.
 * (4) Exec-Summary-Fazit: kein „0 Dollar“-Satz, Währungswort aus data.currency.
 * (D2) bias-fixes buildBiasDecision: PT 0 zählt nicht als Ziel → Fallback Kurs, kein künstlicher dcf_divergence-Trigger.
 * (D3) Exec-Summary-DCF: biasFix.decisionPerShare (> 0, endlich) auch ohne switched, sonst bestehender dcfFairValue-Fallback.
 * Server-Score: buildScoringForAnalysis/runScoringPipeline lesen kein Kursziel (statischer Nachweis unten) und
 * die gehärtete Server-CRV (crvBase/maxEntryCrv3) ist mit PT 0 identisch zu vorher.
 * Fixture: script/fixtures/analysis-MSFT.json (live /api/analyze 11.10.2026).
 * Optional echte Prod-Antworten: JOBD_LIVE_DIR=<dir mit SHEL.L.json …> zeigt den Exec-Fazit-Text.
 * Run: npx tsx script/test-fazit-pt-missing.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { prepareFazitMetrics, buildFazitSignal } from "../client/src/lib/fazit-signal";
import { statementCurrency } from "../client/src/lib/formatters";
import { computeDcfVsMarketDivergence, computeHardenedCRV } from "../shared/valuation-signal";
import { deepDiveAnalystPtText, deepDivePricePrefix } from "../server/llm-openrouter";
import { buildFazit, currencyWord, hasAnalystTarget } from "../server/exec-summary";
import { buildExecSummaryInputFromAnalysis, statementCurrencyForExec } from "../server/exec-summary-attach";
import { buildBiasDecision, applyBiasFix } from "../shared/bias-fixes";

let fail = 0;
const check = (n: string, ok: boolean, info = "") => { console.log(`${ok ? "✅" : "❌"} ${n}${info ? `  (${info})` : ""}`); if (!ok) fail++; };

// Monte Carlo im Fazit nutzt Math.random → fester Seed pro Lauf, damit Vergleiche nur die PT-Änderung messen.
const realRandom = Math.random;
function seeded<T>(fn: () => T): T {
  let s = 42;
  Math.random = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  try { return fn(); } finally { Math.random = realRandom; }
}
function fazit(d: any) { return seeded(() => { const m = prepareFazitMetrics(d); return buildFazitSignal({ data: d, ...m }); }); }
const all = (f: any) => [...f.positive, ...f.negative, ...f.neutral] as string[];

// ── (1) Fazit-Faktor ──
const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const base = fazit(msft);
check("MSFT mit echtem PT 560: Faktor bleibt (+5 % → neutral)", all(base).some(x => /Analysten-Kursziel \+\d+% über Kurs/.test(x)), all(base).filter(x => /Analyst/.test(x)).join("; "));
for (const [label, pt] of [["0", 0], ["null", null], ["NaN", NaN], ["-5", -5]] as const) {
  const d = { ...msft, analystPT: { ...msft.analystPT, median: pt } };
  const f = fazit(d);
  check(`PT ${label}: kein „unter Kurs“-Negativpunkt`, !f.negative.some(x => /Analysten-Kursziel/.test(x)), f.negative.filter(x => /Analyst/.test(x)).join("; "));
  check(`PT ${label}: Hinweis „Kein Analysten-Kursziel“ nur neutral (zählt nicht)`, f.neutral.some(x => /Kein Analysten-Kursziel/.test(x)));
}
{
  // Ohne Ziel darf der Score nicht schlechter sein als bei PT = Kurs (dort entfällt der Faktor ebenfalls, ptUps = 0).
  const noPt = fazit({ ...msft, analystPT: { ...msft.analystPT, median: 0 } });
  const atPx = fazit({ ...msft, analystPT: { ...msft.analystPT, median: msft.currentPrice } });
  check("PT 0 ergibt denselben Score wie PT = Kurs (kein Strafpunkt)", noPt.score === atPx.score, `${noPt.score} vs ${atPx.score}`);
  // Vorher-Logik zum Vergleich: (0 - P)/P = -100 % → negative.push → Score -1.
  const oldPtUps = ((0 - msft.currentPrice) / msft.currentPrice) * 100;
  check("Vorher-Formel ergab -100 % (Grund für den alten Strafpunkt)", Math.round(oldPtUps) === -100);
}

// ── (2) Divergenz-Flag ──
const dv0 = computeDcfVsMarketDivergence(200, 0, 100);
check("Divergenz: DCF +100 %, PT 0 → kein Flag", !dv0.divergenceFlag && !dv0.analystPTAvailable, JSON.stringify(dv0));
check("Divergenz: PT NaN/null → kein Flag", !computeDcfVsMarketDivergence(200, NaN, 100).divergenceFlag && !computeDcfVsMarketDivergence(200, null as any, 100).divergenceFlag);
check("Divergenz: echter PT = Kurs (Analyst-Upside 0 %) → Flag bleibt (Regression)", computeDcfVsMarketDivergence(200, 100, 100).divergenceFlag);
check("Divergenz: NVO-Fixture 117.49/47.00/47.26 → Flag bleibt", computeDcfVsMarketDivergence(117.49, 47.0, 47.26).divergenceFlag);
check("Divergenz: hoher Analyst-Upside → kein Flag (Regression)", !computeDcfVsMarketDivergence(100, 90, 47.26).divergenceFlag);
{
  // Fazit-Downgrade: mit PT 0 darf ATTRAKTIV/LEICHT ATTRAKTIV nicht mehr über das Flag herabgestuft werden.
  const d = { ...msft, analystPT: { ...msft.analystPT, median: 0 } };
  const f = fazit(d);
  check("Fazit mit PT 0: kein Divergenz-Downgrade, kein ⚠-Divergenzsatz", !f.dcfDivergenceDowngraded && !/weicht stark vom Analysten-Konsens/.test(f.fazitSatz));
}

// Server-CRV (analyze-route.ts:2247 ruft computeHardenedCRV): PT 0 ändert crv/fv/wc nicht, nur das Flag fällt weg.
const hcIn = {
  price: 100, conservativeDCF: { perShare: 220, wacc: 6, enterpriseValue: 1000, pvTerminal: 800 }, sector: "Technology", industry: "Software",
  ebitMarginPct: 30, marginDeltaYoYPp: null, fcfMarginYoYPp: null, govExposurePct: null, moatRating: "Wide", betaAdjDrawdownPct: 30, sectorDrawdownPct: 35,
};
const hc0 = computeHardenedCRV({ ...hcIn, analystPTMedian: 0 });
const hcP = computeHardenedCRV({ ...hcIn, analystPTMedian: 100 });
check("Server-CRV: crvHardened/fvHardened/wcUsed bei PT 0 = bei PT 100", hc0.crvHardened === hcP.crvHardened && hc0.fvHardened === hcP.fvHardened && hc0.wcUsed === hcP.wcUsed, `${hc0.crvHardened.toFixed(3)} / ${hcP.crvHardened.toFixed(3)}`);
check("Server-CRV: Flag „DCF_vs_Markt_Divergenz“ nur noch mit echtem PT", !hc0.flags.some(f => /DCF_vs_Markt_Divergenz/.test(f)) && hcP.flags.some(f => /DCF_vs_Markt_Divergenz/.test(f)));

// Statischer Nachweis: der Server-finalScore-Pfad liest kein Kursziel und kein Divergenz-Flag.
for (const p of ["server/scoring-integration.ts", "server/scoring-gates.ts"]) {
  const src = readFileSync(p, "utf8");
  check(`${p}: kein analystPT/priceTarget/divergence`, !/analystPT|priceTarget|divergence/i.test(src));
}

// ── (3) Deep-Dive-Prompt ──
check("Deep-Dive: PT 0 → „N/A“ statt „$0.00“", deepDiveAnalystPtText(0) === "N/A" && deepDiveAnalystPtText(NaN) === "N/A" && deepDiveAnalystPtText(null) === "N/A");
check("Deep-Dive: USD/ohne Währung unverändert „$560.00“", deepDiveAnalystPtText(560) === "$560.00" && deepDiveAnalystPtText(560, "USD") === "$560.00");
check("Deep-Dive: Listing-Währung „GBP 45.00“ / „CAD 120.00“", deepDiveAnalystPtText(45, "GBP") === "GBP 45.00" && deepDivePricePrefix("CAD") === "CAD ");
{
  const src = readFileSync("server/llm-openrouter.ts", "utf8");
  check("llm-openrouter.ts: kein ungeschütztes „Analyst PT: $${analystPT.toFixed(2)}“ mehr", !src.includes("Analyst PT: $${analystPT.toFixed(2)}"));
}

// ── (4) Exec-Summary-Fazit ──
check("currencyWord: USD/leer → Dollar, GBP → Pfund, EUR → Euro, CAD → CAD", currencyWord("USD") === "Dollar" && currencyWord(undefined) === "Dollar" && currencyWord("GBP") === "Pfund" && currencyWord("EUR") === "Euro" && currencyWord("CAD") === "CAD");
check("hasAnalystTarget: 0/NaN/null → false, 45 → true", !hasAnalystTarget(0) && !hasAnalystTarget(NaN) && !hasAnalystTarget(null) && hasAnalystTarget(45));
const fzL = buildFazit({ ticker: "SHEL.L", companyName: "Shell", price: 39.38, analystPtMedian: 0, dcfConservative: 49.5, maxEntryCrv3: 30, currency: "GBP", statementCurrency: "GBP" });
check("Exec .L ohne PT: kein „0 Dollar“, kein „Dollar“, Satz „kein Analystenziel“", !/Dollar/.test(`${fzL.lage} ${fzL.bruch} ${fzL.handlung}`) && /Ein Analystenziel liegt nicht vor\./.test(fzL.lage) && /Pfund/.test(fzL.lage), fzL.lage);
const fzT = buildFazit({ ticker: "RY.TO", companyName: "Royal Bank", price: 280.01, analystPtMedian: 0, dcfConservative: 89.9, currency: "CAD", statementCurrency: "USD" });
check("Exec .TO ohne PT: Kurs in CAD, kein Analystenziel-Satz mit Zahl", /280,01 CAD Kurs/.test(fzT.lage) && !/Analystenziel liegt bei/.test(fzT.lage), fzT.lage);
const fzU = buildFazit({ ticker: "MSFT", companyName: "Microsoft", price: 535.07, analystPtMedian: 560, dcfConservative: 400 });
check("Exec USD ohne currency-Feld: unverändert „Dollar“", /bei 560 Dollar\./.test(fzU.lage) && /400 Dollar gegenüber 535,07 Dollar Kurs/.test(fzU.lage), fzU.lage);
for (const [t, c] of [["SHEL.L", "GBP"], ["SHEL.L", "GBp"], ["RY.TO", "CAD"], ["SAP.DE", "EUR"], ["AAPL", "USD"], ["NPN.JO", "ZAR"], ["X.TA", "ILA"]]) {
  check(`statementCurrencyForExec = client statementCurrency (${t}, ${c})`, statementCurrencyForExec({ ticker: t, currency: c }) === statementCurrency({ ticker: t, currency: c }));
}
const inp = buildExecSummaryInputFromAnalysis({ ticker: "SHEL.L", currency: "GBP", currentPrice: 39.38, analystPT: { median: 0 } });
check("Attach: currency/statementCurrency aus der Analyse", inp.currency === "GBP" && inp.statementCurrency === "GBP" && inp.analystPtMedian === 0);

// ── (D2) bias-fixes: dcf_divergence-Trigger ──
const divTrig = (d: any) => buildBiasDecision(d).triggers.find(t => t.id === "dcf_divergence")!;
{
  const t0 = divTrig({ ...msft, analystPT: { ...msft.analystPT, median: 0 } });
  const tPx = divTrig({ ...msft, analystPT: { ...msft.analystPT, median: msft.currentPrice } });
  const tNaN = divTrig({ ...msft, analystPT: { ...msft.analystPT, median: NaN } });
  check("Bias: PT 0 verhält sich wie PT = Kurs (Fallback, kein -100 %)", t0.active === tPx.active && t0.detail === tPx.detail, `${t0.detail} / ${tPx.detail}`);
  check("Bias: PT 0 = PT NaN (bestehender Fallback)", t0.active === tNaN.active && t0.detail === tNaN.detail);
  const b0 = buildBiasDecision({ ...msft, analystPT: { ...msft.analystPT, median: 0 } });
  const dcfUp = (b0.unadjustedPerShare / msft.currentPrice - 1) * 100;
  check("Bias: PT 0 → Δ = |DCF-Upside − 0| (nicht |DCF-Upside + 100|)", t0.detail === `Δ ${Math.abs(dcfUp).toFixed(1)} Pp (Schwelle 80)`, t0.detail);
  const tReal = divTrig(msft);
  const exp = Math.abs(dcfUp - (msft.analystPT.median / msft.currentPrice - 1) * 100);
  check("Bias: echter PT 560 unverändert genutzt", tReal.detail === `Δ ${exp.toFixed(1)} Pp (Schwelle 80)`, tReal.detail);
  check("Bias: PT 0 → kein Red Flag „DCF-Upside weicht stark vom Analysten-Upside ab“ (MSFT-Fixture, |DCF-Up| < 80)", Math.abs(dcfUp) < 80 && !b0.redFlags.some(r => /Analysten-Upside/.test(r)));
}
{
  // Statischer Nachweis: Server-finalScore entsteht vor applyBiasFix und liest biasFix nicht.
  const route = readFileSync("server/analyze-route.ts", "utf8");
  // Seit #252: „scoring = yahooOnly ? undefined : buildScoringForAnalysis(“ → Zuweisung mit optionalem Ternary-Guard matchen.
  const iScore = route.search(/\bscoring\s*=\s*(?:[\w.!]+\s*\?\s*undefined\s*:\s*)?buildScoringForAnalysis\(/);
  const iBias = route.indexOf("applyBiasFix(analysis);");
  check("analyze-route: buildScoringForAnalysis läuft vor applyBiasFix", iScore > 0 && iBias > iScore);
  for (const p of ["server/scoring-integration.ts", "server/scoring-gates.ts"]) {
    check(`${p}: liest bias-fixes/biasFix nicht`, !/bias-fixes|biasFix|buildBiasDecision/.test(readFileSync(p, "utf8")));
  }
}

// ── (D3) Exec-Summary-DCF aus biasFix.decisionPerShare ──
{
  const dcfOf = (a: any) => buildExecSummaryInputFromAnalysis(a).dcfConservative;
  const baseA = { ticker: "SHEL.L", currency: "GBP", currentPrice: 39.38, dcfFairValue: 20.18 };
  check("D3: nicht switched + decisionPerShare 58.55 → Exec-DCF 58.55 (nicht dcfFairValue 20.18)", dcfOf({ ...baseA, biasFix: { switched: false, decisionPerShare: 58.55 } }) === 58.55);
  check("D3: switched → decisionPerShare (Regression)", dcfOf({ ...baseA, biasFix: { switched: true, decisionPerShare: 49.45 } }) === 49.45);
  check("D3: decisionPerShare 0 (emptyPayload) → Fallback dcfFairValue", dcfOf({ ...baseA, biasFix: { switched: false, decisionPerShare: 0 } }) === 20.18);
  check("D3: decisionPerShare NaN/null → Fallback dcfFairValue", dcfOf({ ...baseA, biasFix: { switched: false, decisionPerShare: NaN } }) === 20.18 && dcfOf({ ...baseA, biasFix: { decisionPerShare: null } }) === 20.18);
  check("D3: ohne biasFix → Fallback dcfFairValue (Regression)", dcfOf(baseA) === 20.18);
  const m = applyBiasFix(JSON.parse(JSON.stringify(msft)));
  check("D3: MSFT-Fixture nach applyBiasFix → Exec-DCF = biasFix.decisionPerShare", dcfOf(m) === m.biasFix.decisionPerShare, `${dcfOf(m)} / ${m.biasFix.decisionPerShare} (switched ${m.biasFix.switched})`);
}

// Optional: echte Prod-Antworten (nicht im Repo, nur Anzeige + gleiche Assertions)
const live = process.env.JOBD_LIVE_DIR;
if (live) {
  for (const t of ["SHEL.L", "BP.L", "ULVR.L", "RY.TO", "AAPL", "MSFT"]) {
    const p = `${live}/${t}.json`;
    if (!existsSync(p)) continue;
    const a = JSON.parse(readFileSync(p, "utf8"));
    const fz = buildFazit(buildExecSummaryInputFromAnalysis(a));
    const txt = `${fz.lage} ${fz.bruch} ${fz.handlung}`;
    const pt = a.analystPT?.median;
    check(`LIVE ${t} (PT ${pt}, ${a.currency}): kein „0 Dollar“${a.currency !== "USD" ? ", Kurs nicht in Dollar" : ""}`,
      !/\b0 Dollar/.test(txt) && (a.currency === "USD" || !/Kurs\./.test(fz.lage) || !/Dollar Kurs/.test(fz.lage)), fz.lage);
    if (!(pt > 0)) check(`LIVE ${t}: Bias-Trigger dcf_divergence ohne PT nur bei |DCF-Upside| ≥ 80`, divTrig(a).active === Math.abs((buildBiasDecision(a).unadjustedPerShare / a.currentPrice - 1) * 100) >= 80, divTrig(a).detail);
    { const b = applyBiasFix(JSON.parse(JSON.stringify(a))); const dcf = buildExecSummaryInputFromAnalysis(b).dcfConservative;
      check(`LIVE ${t}: Exec-DCF = biasFix.decisionPerShare (switched ${b.biasFix.switched})`, dcf === b.biasFix.decisionPerShare, String(dcf)); }
    const before = a.execSummary?.fazit?.lage;
    if (before) console.log(`   vorher (Prod): ${before}`);
  }
}

console.log(fail ? `\n${fail} FAIL` : "\nalle PASS");
process.exit(fail ? 1 : 0);
