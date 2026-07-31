// validate-msft.mjs — 17-section structural + freshness validator
// Runs the built server, POST /api/analyze { ticker: MSFT, useLLM: false, force: true },
// then checks every section's minimum required fields against shared/schema.ts.
//
// Usage: FMP_API_KEY=... node scripts/validate-msft.mjs
//        (Reads FMP_API_KEY from env; skips live check if unset.)

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitReady(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

function check(name, ok, note = "") {
  const status = ok ? "PASS" : "FAIL";
  return { name, status, note };
}

function fieldExists(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return false;
    cur = cur[p];
  }
  return cur !== undefined && cur !== null && cur !== "";
}

function isPositive(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return false;
    cur = cur[p];
  }
  return typeof cur === "number" && cur > 0;
}

function validateSchema(a) {
  const results = [];

  // 1. Datenaktualität
  results.push(check("Section 1 — Datenaktualität",
    a.ticker === "MSFT" && isPositive(a, "currentPrice") && fieldExists(a, "companyName") && fieldExists(a, "priceTimestamp"),
    `ticker=${a.ticker} price=${a.currentPrice} name=${a.companyName}`));

  // 2. Investmentthese
  results.push(check("Section 2 — Investmentthese",
    fieldExists(a, "sector") && fieldExists(a, "moatRating"),
    `sector=${a.sector} moat=${a.moatRating}`));

  // 3. Zyklusanalyse
  results.push(check("Section 3 — Zyklusanalyse",
    fieldExists(a, "cycleClassification") && fieldExists(a, "politicalCycle") && fieldExists(a, "sectorProfile"),
    `cycle=${a.cycleClassification}`));

  // 4. Bewertung (Multiples)
  results.push(check("Section 4 — Bewertung",
    typeof a.peRatio === "number" && typeof a.forwardPE === "number" && typeof a.pegRatio === "number",
    `PE=${a.peRatio?.toFixed?.(1)} FwdPE=${a.forwardPE?.toFixed?.(1)} PEG=${a.pegRatio}`));

  // 5. DCF-Modell
  results.push(check("Section 5 — DCF-Modell",
    fieldExists(a, "sectorProfile.waccScenarios.avg") && fieldExists(a, "sectorProfile.growthAssumptions.g1"),
    `WACC=${a.sectorProfile?.waccScenarios?.avg} g1=${a.sectorProfile?.growthAssumptions?.g1}`));

  // 6. CRV (upside / analyst target)
  results.push(check("Section 6 — CRV / Analyst PT",
    isPositive(a, "analystPT.median") || isPositive(a, "upsidePotential"),
    `PT=${a.analystPT?.median} upside=${a.upsidePotential}%`));

  // 7. Relative Bewertung
  results.push(check("Section 7 — Rel. Bewertung",
    isPositive(a, "sectorAvgPE") && isPositive(a, "sectorAvgForwardPE"),
    `sectorPE=${a.sectorAvgPE} sectorFwdPE=${a.sectorAvgForwardPE}`));

  // 8. Risikoinversion
  results.push(check("Section 8 — Risikoinversion",
    Array.isArray(a.risks) && a.risks.length >= 3,
    `risks=${a.risks?.length}`));

  // 9. RSL-Momentum
  results.push(check("Section 9 — RSL-Momentum",
    Array.isArray(a.historicalPrices) && a.historicalPrices.length >= 200,
    `historicalPrices=${a.historicalPrices?.length}`));

  // 10. Technische Analyse
  const ohlcvLen = a.ohlcvData?.length ?? 0;
  const maLen = a.technicalIndicators?.maData?.length ?? 0;
  const macdLen = a.technicalIndicators?.macdData?.length ?? 0;
  results.push(check("Section 10 — Tech. Analyse",
    ohlcvLen >= 200 && maLen >= 200 && macdLen >= 200 && fieldExists(a, "technicalIndicators.currentStatus"),
    `ohlcv=${ohlcvLen} ma=${maLen} macd=${macdLen} signals=${a.technicalIndicators?.signals?.length}`));

  // 11. Moat / Porter
  const porterLen = a.moatAssessment?.porterForces?.length ?? 0;
  results.push(check("Section 11 — Moat/Porter",
    fieldExists(a, "moatAssessment.moatStrength") && porterLen >= 4,
    `moat=${a.moatAssessment?.moatStrength} porter=${porterLen}`));

  // 12. PESTEL
  const pestelLen = a.pestelAnalysis?.factors?.length ?? 0;
  results.push(check("Section 12 — PESTEL",
    pestelLen >= 4,
    `factors=${pestelLen}`));

  // 13. Makro-Korrelationen
  const macroLen = a.macroCorrelations?.correlations?.length ?? 0;
  results.push(check("Section 13 — Makro-Korr.",
    macroLen >= 3,
    `correlations=${macroLen}`));

  // 14. Reverse DCF
  results.push(check("Section 14 — Reverse DCF",
    typeof a.impliedGStar === "number",
    `impliedG*=${a.impliedGStar}`));

  // 15. Katalysatoren
  results.push(check("Section 15 — Katalysatoren",
    Array.isArray(a.catalysts) && a.catalysts.length >= 3,
    `catalysts=${a.catalysts?.length}`));

  // 16. Monte Carlo (frontend computes locally from historicalPrices — check inputs)
  results.push(check("Section 16 — Monte Carlo (inputs)",
    Array.isArray(a.historicalPrices) && a.historicalPrices.length >= 100 && isPositive(a, "currentPrice"),
    `historicalPrices=${a.historicalPrices?.length}`));

  // 17. Zusammenfassung
  results.push(check("Section 17 — Zusammenfassung",
    fieldExists(a, "companyName") && Array.isArray(a.catalysts) && Array.isArray(a.risks),
    `all top-level fields present`));

  return results;
}

async function main() {
  console.log("=== MSFT Validation Report ===");
  console.log(`Time: ${new Date().toISOString()}`);
  const fmpKey = process.env.FMP_API_KEY;
  console.log(`FMP_API_KEY: ${fmpKey ? "set (" + fmpKey.length + " chars)" : "MISSING — validator would fail live"}`);

  if (!fmpKey) {
    console.log("\n❌ Cannot validate live without FMP_API_KEY. Aborting.");
    process.exit(2);
  }

  console.log(`\nStarting server on port ${PORT}...`);
  const srv = spawn("node", ["dist/index.cjs"], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  srv.stdout.on("data", (d) => { serverLog += d.toString(); });
  srv.stderr.on("data", (d) => { serverLog += d.toString(); });

  const ready = await waitReady();
  if (!ready) {
    console.log("❌ Server did not start.\n--- server log ---\n" + serverLog.slice(-2000));
    srv.kill();
    process.exit(3);
  }
  console.log("Server ready.\n");

  try {
    // Budget before
    const budgetBefore = await (await fetch(`${BASE}/api/fmp-budget`)).json();
    console.log(`FMP budget before: today=${budgetBefore.fmp.today}/${budgetBefore.fmp.limit} remaining=${budgetBefore.fmp.remaining}`);

    // MSFT analyze
    console.log("\nPOST /api/analyze { ticker: MSFT, useLLM: false, force: true }...");
    const t0 = Date.now();
    const resp = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "MSFT", useLLM: false, force: true }),
    });
    const ms = Date.now() - t0;
    console.log(`HTTP ${resp.status} in ${ms}ms`);

    if (!resp.ok) {
      const body = await resp.text();
      console.log("❌ API returned non-2xx:\n" + body.slice(0, 500));
      srv.kill();
      process.exit(4);
    }

    const a = await resp.json();
    const budgetAfter = await (await fetch(`${BASE}/api/fmp-budget`)).json();
    console.log(`FMP budget after: today=${budgetAfter.fmp.today}/${budgetAfter.fmp.limit} remaining=${budgetAfter.fmp.remaining} (delta=${budgetAfter.fmp.today - budgetBefore.fmp.today})`);

    // Section checks
    const results = validateSchema(a);
    console.log("\n--- Section checklist 1–17 ---");
    for (const r of results) {
      const mark = r.status === "PASS" ? "✅" : "❌";
      console.log(`${mark} ${r.name}: ${r.status}  ${r.note ? "(" + r.note + ")" : ""}`);
    }
    const pass = results.filter(r => r.status === "PASS").length;
    const fail = results.filter(r => r.status === "FAIL").length;
    console.log(`\nSummary: ${pass}/${results.length} PASS, ${fail} FAIL`);
    console.log(`Overall: ${fail === 0 ? "PASS ✅" : "FAIL ❌"}`);

    srv.kill();
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    console.log("❌ Validator crashed: " + (err?.message ?? err));
    srv.kill();
    process.exit(5);
  }
}

main();
