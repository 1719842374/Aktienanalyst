/**
 * P1: POST /api/segment-tam-estimate muss currency, fiscalYear, totalRevenue
 * und supplementGrowth an den Prompt weiterreichen. Ungültiges bleibt n/a.
 * Die Historie im Prompt ist auf HISTORY_PROMPT_MAX Zeichen begrenzt.
 * Aufruf: npx tsx script/test-segment-n34.ts
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { registerSegmentTamEstimateRoute } from "../server/segment-tam-estimate-route";

const tamNa = await import("../server/tam-na-fill");
const HISTORY_PROMPT_MAX = typeof (tamNa as { HISTORY_PROMPT_MAX?: unknown }).HISTORY_PROMPT_MAX === "number"
  ? (tamNa as { HISTORY_PROMPT_MAX: number }).HISTORY_PROMPT_MAX
  : 1200;

delete process.env.OPENROUTER_API_KEY;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const prompts: string[] = [];
const app = express();
app.use(express.json({ limit: "1mb" }));
registerSegmentTamEstimateRoute(app, {
  isLLMAvailable: () => true,
  callLLMJson: async (opts) => {
    prompts.push(opts.prompt);
    return {
      modelUsed: "mock-model",
      data: {
        fills: [{
          segmentName: "Data Center",
          tamSize: 500,
          tamSource: "NVIDIA Annual Report 2025",
          formula: "Marktgröße aus dem Bericht",
          rationale: "belegte TAM-Zahl",
        }],
      },
    };
  },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;

async function post(body: unknown): Promise<{ status: number; json: { error?: string; fills?: unknown[] } }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/segment-tam-estimate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { error?: string; fills?: unknown[] };
  return { status: res.status, json };
}

const segment = {
  segmentName: "Data Center",
  segmentRevenue: 63.9,
  segmentShare: 88,
  segmentGrowth: 68.2,
  matched: true,
  tamSize: null,
  tamCAGR: null,
};

try {
  const ok = await post({
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    currency: "usd",
    fiscalYear: 2025,
    totalRevenue: 130500000000,
    supplementGrowth: [{
      name: "Data Center",
      nextYearGrowthPct: 68.2,
      observations: 3,
      source: "FMP revenue-product-segmentation",
    }],
    segments: [segment],
  });
  const prompt = prompts[0] ?? "";
  gap("route-status", ok.status === 200, `status=${ok.status} error=${ok.json.error ?? ""}`);
  gap("route-currency", prompt.includes("Währung der Segmentumsätze: USD"), prompt.slice(0, 400) || "kein Prompt");
  gap("route-year", prompt.includes("Geschäftsjahr: 2025"), prompt.includes("Geschäftsjahr") ? "Jahr fehlt oder anders" : "kein Geschäftsjahr");
  gap("route-revenue", prompt.includes("Gesamtumsatz: 130500000000"), "Gesamtumsatz nicht weitergereicht");
  gap("route-history", prompt.includes("FMP-Segmenthistorie Data Center: Median YoY 68.2%"), "Historie nicht im Prompt");

  prompts.length = 0;
  const bad = await post({
    ticker: "NVDA",
    currency: "dollar",
    fiscalYear: "soon",
    totalRevenue: "viel",
    supplementGrowth: "nope",
    segments: [segment],
  });
  const empty = prompts[0] ?? "";
  gap("invalid-stays-empty", bad.status === 200
    && empty.includes("Währung der Segmentumsätze: n/a")
    && empty.includes("Geschäftsjahr: n/a")
    && empty.includes("Gesamtumsatz: n/a")
    && !empty.includes("FMP-Segmenthistorie")
    && !empty.includes("soon")
    && !empty.includes("viel")
    && !empty.includes("dollar"),
  empty.slice(0, 500) || `status=${bad.status}`);

  prompts.length = 0;
  const longName = `Data Center ${"X".repeat(400)}`;
  const huge = await post({
    ticker: "NVDA",
    currency: "USD",
    fiscalYear: "2025",
    totalRevenue: 1,
    supplementGrowth: Array.from({ length: 40 }, (_, i) => ({
      name: i === 0 ? "Data Center" : `${longName} ${i}`,
      nextYearGrowthPct: 10 + i,
      observations: 2,
      source: "S".repeat(500),
    })),
    segments: [segment],
  });
  const capped = prompts[0] ?? "";
  const historyStart = capped.indexOf("FMP-Segmenthistorie");
  const historyEnd = capped.indexOf("Währung der Segmentumsätze");
  const history = historyStart >= 0 && historyEnd > historyStart ? capped.slice(historyStart, historyEnd).trim() : "";
  gap(
    "history-char-limit",
    huge.status === 200 && history.length > 0 && history.length <= HISTORY_PROMPT_MAX && !capped.includes("X".repeat(200)),
    `len=${history.length} limit=${HISTORY_PROMPT_MAX}`,
  );
} finally {
  server.close();
}

if (gaps.length > 0) {
  console.error(`n34 FAIL ${gaps.length}: ${gaps.join(" | ")}`);
  process.exit(1);
}
console.log("n34 PASS");
