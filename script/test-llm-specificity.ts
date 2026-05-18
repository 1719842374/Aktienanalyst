/**
 * LLM Specificity Regression Test
 *
 * Tests that LLM-generated content in Section 8 (Risk Deep-Dive)
 * and Section 15 (Catalyst Deep-Dive) is company-specific and not generic.
 *
 * Run with: npx tsx script/test-llm-specificity.ts [ticker] [port]
 * Example:  npx tsx script/test-llm-specificity.ts IFX.DE 5000
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Generic/empty output detected (regression)
 *   2 = Server error / LLM credits exhausted
 */

const ticker = process.argv[2] || "MSFT";
const port   = parseInt(process.argv[3] || "5000", 10);
const BASE   = `http://localhost:${port}`;

// Generic phrases that indicate the LLM didn't use company context
const GENERIC_PHRASES = [
  "das unternehmen",
  "the company",
  "dieses unternehmen",
  "im allgemeinen",
  "generisch",
  "placeholder",
  "example",
  "lorem ipsum",
  "1-2 saetze",
  "1-2 sätze",
  "kontext: kurze",
  "begründung der pos%",
];

// Company-specific keywords per ticker (at least one must appear)
const TICKER_KEYWORDS: Record<string, string[]> = {
  "IFX.DE":  ["infineon", "halbleiter", "semiconductor", "automotive", "ev", "chip", "infineon technologies", "ifx"],
  "MSFT":    ["microsoft", "azure", "cloud", "copilot", "office", "openai", "windows"],
  "AAPL":    ["apple", "iphone", "app store", "services", "wearables", "mac", "ios"],
  "NVDA":    ["nvidia", "gpu", "cuda", "data center", "ai training", "blackwell", "hopper"],
  "TSLA":    ["tesla", "ev", "electric vehicle", "autopilot", "energy storage", "fsd", "cybertruck"],
  "AMZN":    ["amazon", "aws", "prime", "marketplace", "logistics", "alexa"],
  "SAP.DE":  ["sap", "erp", "s/4hana", "cloud erp", "enterprise"],
};

function containsGenericPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of GENERIC_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

function isCompanySpecific(text: string, ticker: string): boolean {
  const keywords = TICKER_KEYWORDS[ticker.toUpperCase()] || [ticker.toLowerCase().replace(/\.[a-z]+$/, '')];
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

interface TestResult {
  name: string;
  pass: boolean;
  details: string;
}

async function runTests(): Promise<void> {
  console.log(`\n🔍 LLM Specificity Test — ${ticker} on localhost:${port}`);
  console.log("=".repeat(60));

  // Step 1: Fetch analysis
  console.log("\n📡 Fetching analysis (useLLM=true)...");
  let data: any;
  try {
    const resp = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, useLLM: true, force: true }),
      signal: AbortSignal.timeout(120_000),
    });
    data = await resp.json();
  } catch (e: any) {
    console.error("❌ Fetch failed:", e.message);
    process.exit(2);
  }

  if (data?.errorCode) {
    console.error(`❌ API error: ${data.errorCode} — ${data.error?.slice(0, 100)}`);
    process.exit(2);
  }

  console.log(`✅ Received data for ${data.companyName} (${data.ticker})`);
  console.log(`   llmMode=${data.llmMode}, sector=${data.sector}, price=$${data.currentPrice}`);

  const results: TestResult[] = [];

  // ─── PROMPT INPUT CHECKS ────────────────────────────────────────
  results.push({
    name: "Revenue is non-zero",
    pass: (data.revenue || 0) > 0,
    details: `revenue=$${((data.revenue || 0) / 1e9).toFixed(1)}B`,
  });
  results.push({
    name: "Sector is not misclassified as 'Financial Services' for tech tickers",
    pass: !["ifx.de", "nvda", "msft", "aapl", "tsla"].includes(ticker.toLowerCase()) || data.sector !== "Financial Services",
    details: `sector=${data.sector}`,
  });
  results.push({
    name: "analystPTMedian is non-zero (or price used as fallback)",
    pass: (data.analystPTMedian || 0) > 0,
    details: `analystPTMedian=$${data.analystPTMedian}`,
  });
  results.push({
    name: "Description is non-empty",
    pass: (data.description || "").length > 50,
    details: `description=${data.description?.slice(0, 60)}...`,
  });

  // ─── CATALYST DEEP-DIVE CHECKS ───────────────────────────────────
  const cats = data.catalysts || [];
  const withDeepDive = cats.filter((c: any) => c.deepDive);
  results.push({
    name: `Catalyst deep-dives generated (${withDeepDive.length}/${cats.length})`,
    pass: withDeepDive.length > 0,
    details: `${withDeepDive.length} of ${cats.length} catalysts have deepDive`,
  });

  for (const [i, cat] of cats.slice(0, 3).entries()) {
    const dd = cat.deepDive;
    if (!dd) {
      results.push({ name: `K${i+1} '${cat.name.slice(0,25)}' deepDive exists`, pass: false, details: "No deepDive object" });
      continue;
    }

    const kontext = dd.unternehmenskontext || "";
    const generic = containsGenericPhrase(kontext);
    results.push({
      name: `K${i+1} unternehmenskontext not generic`,
      pass: !generic,
      details: generic ? `Contains generic phrase: "${generic}"` : kontext.slice(0, 80),
    });
    results.push({
      name: `K${i+1} unternehmenskontext is company-specific`,
      pass: isCompanySpecific(kontext, ticker),
      details: `Checked for keywords: ${(TICKER_KEYWORDS[ticker.toUpperCase()] || []).slice(0,3).join(", ")}`,
    });
    results.push({
      name: `K${i+1} bewertungsauswirkung is non-empty`,
      pass: (dd.bewertungsauswirkung || "").length > 20,
      details: dd.bewertungsauswirkung?.slice(0, 60) || "EMPTY",
    });
  }

  // ─── RISK EXPLANATION CHECKS ─────────────────────────────────────
  const risks = data.risks || [];
  const withExpl = risks.filter((r: any) => r.explanation);
  results.push({
    name: `Risk explanations generated (${withExpl.length}/${risks.length})`,
    pass: withExpl.length > 0,
    details: `${withExpl.length} of ${risks.length} risks have explanation`,
  });

  for (const risk of withExpl.slice(0, 2)) {
    const e = risk.explanation;
    const kontext = e?.kontext || "";
    const generic = containsGenericPhrase(kontext);
    results.push({
      name: `Risk '${risk.name.slice(0,25)}' kontext not generic`,
      pass: !generic,
      details: generic ? `Contains: "${generic}"` : kontext.slice(0, 80),
    });
    results.push({
      name: `Risk '${risk.name.slice(0,25)}' is company-specific`,
      pass: isCompanySpecific(kontext, ticker),
      details: kontext.slice(0, 80),
    });
  }

  // ─── PRINT RESULTS ───────────────────────────────────────────────
  console.log("\n📊 Test Results:");
  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`  ${icon} [${status}] ${r.name}`);
    if (!r.pass || process.env.VERBOSE) {
      console.log(`         → ${r.details}`);
    }
    r.pass ? passed++ : failed++;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`📈 Results: ${passed}/${results.length} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\n⚠️  REGRESSION DETECTED — LLM output may be generic or missing company context");
    console.log("   Check: OPENROUTER credits, sector classification, analystPT parsing\n");
    process.exit(1);
  } else {
    console.log("\n🎉 All checks passed — LLM output is company-specific\n");
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error("Unhandled error:", e);
  process.exit(2);
});
