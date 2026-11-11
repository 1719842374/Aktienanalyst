/**
 * S15: 404 lädt die Analyse höchstens einmal pro Ticker und Sitzung neu,
 * danach genau ein Enrich-Retry. res.ok bleibt lokal, apiRequest global unverändert.
 * Grund-Feld llmSkipReason: 402/429 → „KI-Limit erreicht“.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-catalyst-enrich-reload.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBiasDecision } from "../shared/bias-fixes";
import {
  LLM_LIMIT_MESSAGE,
  NETWORK_MESSAGE,
  RELOAD_MESSAGE,
  TIMEOUT_MESSAGE,
  browserReloadSession,
  memoryReloadSession,
  reloadedNotice,
  runCatalystEnrich,
  storageReloadSession,
  type EnrichResponse,
} from "../client/src/lib/catalystEnrichFlow";
import {
  assignOpenRouterLimit,
  catalystEnrichSkipBody,
  openRouterLimitReason,
  takeOpenRouterLimit,
  type LlmSkipSink,
} from "../server/llm-openrouter";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const catalysts = [{ name: "Azure", pos: 60, bruttoUpside: 10, einpreisungsgrad: 20, nettoUpside: 8, gb: 4.8, timeline: "12M" }];
const freshDashboard = {
  ticker: "MSFT",
  currentPrice: 420.5,
  growthThesis: "These nach Reload",
  catalysts,
};

function okBody(extra: Record<string, unknown> = {}): EnrichResponse {
  return { ok: true, status: 200, body: { catalysts, ...extra } };
}

async function main() {
  console.log("\n1) Grund-Feld 402/429");
  check("402", openRouterLimitReason(402) === "402");
  check("429", openRouterLimitReason(429) === "429");
  check("String 402", openRouterLimitReason("402") === "402");
  check("500 ist kein Limit", openRouterLimitReason(500) === null);
  check("ohne Status kein Limit", openRouterLimitReason(undefined) === null);
  const sink: LlmSkipSink = { llmSkipReason: "429" };
  assignOpenRouterLimit(sink, 402);
  check("Sink übernimmt 402", sink.llmSkipReason === "402");
  assignOpenRouterLimit(sink, 500);
  check("anderer Status löscht den Grund", sink.llmSkipReason === null);
  const slot: LlmSkipSink = { llmSkipReason: null };
  assignOpenRouterLimit(slot, 429);
  check("take liest 429 und leert", takeOpenRouterLimit(slot) === "429" && slot.llmSkipReason === null);
  check("take danach leer", takeOpenRouterLimit(slot) === null);
  const withReason = catalystEnrichSkipBody(catalysts, "402");
  check("Skip-Body trägt llmSkipReason", withReason._llmSkipped === true && withReason.modelUsed === null && withReason.llmSkipReason === "402" && withReason.catalysts === catalysts);
  const without = catalystEnrichSkipBody(catalysts, null);
  check("ohne 402/429 kein Grund-Feld", without._llmSkipped === true && !("llmSkipReason" in without));

  console.log("\n2) 404 → Reload einmal → Retry → Erfolg, ganzes Dashboard");
  const session = memoryReloadSession();
  let dashboard: unknown = { ticker: "MSFT", currentPrice: 1, growthThesis: "alt", catalysts: [] };
  let reloads = 0;
  let enrichCalls = 0;
  const notices: string[] = [];
  const at = new Date(2026, 10, 11, 18, 5, 9);
  const first = await runCatalystEnrich({
    ticker: "msft",
    session,
    now: () => at,
    onNotice: (n) => notices.push(n.text),
    request: async () => {
      enrichCalls += 1;
      if (enrichCalls === 1) return { ok: false, status: 404, body: { error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" } };
      return okBody({ growthThesis: "These nach Reload", growthThesisGeneratedAt: "2026-11-11T18:05:00.000Z", execSummary: { fazit: "neu" } });
    },
    reloadDashboard: async () => {
      reloads += 1;
      dashboard = freshDashboard;
      return dashboard;
    },
  });
  check("ein Reload", reloads === 1, String(reloads));
  check("ein Retry (2 Enrich-Calls)", enrichCalls === 2, String(enrichCalls));
  check("Erfolg", first.kind === "success");
  check("sichtbar: wird neu geladen", notices.includes(RELOAD_MESSAGE));
  check("Stand hh:mm", reloadedNotice(at) === "Analyse neu geladen (Stand 18:05)" && notices.includes("Analyse neu geladen (Stand 18:05)"));
  check("ganzes Dashboard ersetzt", JSON.stringify(dashboard) === JSON.stringify(freshDashboard));
  if (first.kind === "success") {
    check("Retry-Katalysatoren", first.catalysts === catalysts);
    check("These aus dem Retry", first.growthThesis === "These nach Reload");
  }

  console.log("\n3) zweiter 404 derselben Sitzung ohne weiteren Reload");
  let secondReloads = 0;
  const second = await runCatalystEnrich({
    ticker: "MSFT",
    session,
    request: async () => ({ ok: false, status: 404, body: { error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" } }),
    reloadDashboard: async () => {
      secondReloads += 1;
      return freshDashboard;
    },
  });
  check("kein zweites Neuladen", secondReloads === 0, String(secondReloads));
  check("ehrliche Meldung", second.kind === "error" && second.message === "Keine Analyse im Cache — zuerst /api/analyze aufrufen", second.kind === "error" ? second.message : second.kind);
  check("sagt nicht, dass neu geladen wird", second.kind === "error" && !second.message.includes("wird neu geladen"));

  console.log("\n4) Retry selbst 404: kein drittes Laden");
  const sessionB = memoryReloadSession();
  let loads = 0;
  let calls = 0;
  const retryMiss = await runCatalystEnrich({
    ticker: "SAP",
    session: sessionB,
    request: async () => {
      calls += 1;
      return { ok: false, status: 404, body: { error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" } };
    },
    reloadDashboard: async () => {
      loads += 1;
      return freshDashboard;
    },
  });
  check("SAP nur ein Reload", loads === 1, String(loads));
  check("danach ein Retry und Stopp", calls === 2, String(calls));
  check("Retry-404 ehrlich", retryMiss.kind === "error" && retryMiss.message.startsWith("Keine Analyse im Cache"));

  console.log("\n5) anderer Ticker darf einmal");
  let vowLoads = 0;
  await runCatalystEnrich({
    ticker: "VOW3",
    session,
    request: async () => ({ ok: false, status: 404, body: { error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" } }),
    reloadDashboard: async () => {
      vowLoads += 1;
      return { ticker: "VOW3", currentPrice: 12, growthThesis: "vw", catalysts: [] };
    },
  });
  check("VOW3 einmal, MSFT nicht nochmal", vowLoads === 1);

  console.log("\n6) KI-Limit 402/429/_llmSkipped");
  for (const sample of [
    { ok: false, status: 402, body: { error: "payment" } },
    { ok: false, status: 429, body: { error: "rate" } },
    { ok: true, status: 200, body: { _llmSkipped: true, catalysts, llmSkipReason: "402" } },
    { ok: true, status: 200, body: { _llmSkipped: true, catalysts } },
  ] as EnrichResponse[]) {
    let n = 0;
    const out = await runCatalystEnrich({
      ticker: "MSFT",
      session: memoryReloadSession(),
      request: async () => sample,
      reloadDashboard: async () => { n += 1; return freshDashboard; },
    });
    check(`Limit ${sample.status} ohne Reload`, out.kind === "llm-limit" && out.message === LLM_LIMIT_MESSAGE && n === 0, out.kind === "llm-limit" ? out.message : out.kind);
  }

  console.log("\n7) 5xx zeigt json.error");
  const serverErr = await runCatalystEnrich({
    ticker: "MSFT",
    session: memoryReloadSession(),
    request: async () => ({ ok: false, status: 500, body: { error: "Internal server error" } }),
    reloadDashboard: async () => freshDashboard,
  });
  check("5xx", serverErr.kind === "error" && serverErr.message === "Internal server error", serverErr.kind === "error" ? serverErr.message : serverErr.kind);

  console.log("\n8) Netzwerk und Timeout");
  const timeout = await runCatalystEnrich({
    ticker: "MSFT",
    session: memoryReloadSession(),
    request: async () => { throw new Error("Timeout: Server hat nicht innerhalb von 120s geantwortet"); },
    reloadDashboard: async () => freshDashboard,
  });
  const abort = await runCatalystEnrich({
    ticker: "MSFT",
    session: memoryReloadSession(),
    request: async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    },
    reloadDashboard: async () => freshDashboard,
  });
  const network = await runCatalystEnrich({
    ticker: "MSFT",
    session: memoryReloadSession(),
    request: async () => { throw new TypeError("fetch failed"); },
    reloadDashboard: async () => freshDashboard,
  });
  check("Timeout-Text", timeout.kind === "error" && timeout.message === TIMEOUT_MESSAGE, timeout.kind === "error" ? timeout.message : timeout.kind);
  check("Abort", abort.kind === "error" && abort.message === TIMEOUT_MESSAGE, abort.kind === "error" ? abort.message : abort.kind);
  check("Netzwerk", network.kind === "error" && network.message === NETWORK_MESSAGE, network.kind === "error" ? network.message : network.kind);

  console.log("\n9) Normalpfad ohne Reload");
  let normalReloads = 0;
  const normal = await runCatalystEnrich({
    ticker: "MSFT",
    session: memoryReloadSession(),
    request: async () => okBody({ growthThesis: "live", growthThesisGeneratedAt: null, execSummary: { fazit: "ok" } }),
    reloadDashboard: async () => { normalReloads += 1; return freshDashboard; },
  });
  check("kein Reload", normalReloads === 0 && normal.kind === "success");
  if (normal.kind === "success") check("execSummary durchgereicht", (normal.execSummary as { fazit?: string })?.fazit === "ok");

  console.log("\n10) Sitzung übersteht ein neues Gate auf demselben Speicher");
  const bag = new Map<string, string>();
  const storage = {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => { bag.set(k, v); },
  };
  const gateA = storageReloadSession(storage);
  let persistedLoads = 0;
  await runCatalystEnrich({
    ticker: "AAPL",
    session: gateA,
    request: async () => ({ ok: false, status: 404, body: { error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" } }),
    reloadDashboard: async () => { persistedLoads += 1; return { ticker: "AAPL" }; },
  });
  const gateB = storageReloadSession(storage);
  await runCatalystEnrich({
    ticker: "aapl",
    session: gateB,
    request: async () => ({ ok: false, status: 404, body: { error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" } }),
    reloadDashboard: async () => { persistedLoads += 1; return { ticker: "AAPL" }; },
  });
  check("zweiter Gate-Zugriff lädt nicht nochmal", persistedLoads === 1, String(persistedLoads));
  check("Browser-Sitzung ist eine Funktion", typeof browserReloadSession === "function");

  console.log("\n11) Kette im Quelltext, apiRequest unangetastet");
  const route = readFileSync("server/analyze-route.ts", "utf8");
  const analyzeCall = route.slice(route.indexOf("// ── 11. Catalysts"), route.indexOf("// Fallback: template catalysts"));
  const enrich = route.slice(route.indexOf('app.post("/api/catalyst-enrich"'), route.indexOf('app.post("/api/risk-explanations"'));
  const section = readFileSync("client/src/components/sections/CatalystsSection.tsx", "utf8");
  const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
  const qc = readFileSync("client/src/lib/queryClient.ts", "utf8");
  const apiFn = qc.slice(qc.indexOf("export async function apiRequest"), qc.indexOf("type UnauthorizedBehavior"));
  const llm = readFileSync("server/llm-openrouter.ts", "utf8");
  check("Analyze-Pfad ohne Skip-Sink", !analyzeCall.includes("llmSkip") && analyzeCall.includes("if (llmResult)"));
  check("404-Text unverändert", enrich.includes('return res.status(404).json({ error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" })'));
  check("Enrich reicht den Grund durch", enrich.includes("catalystEnrichSkipBody(a.catalysts, llmSkip.llmSkipReason)"));
  check("kein Disk-Lese-Fallback im Enrich", !enrich.includes("diskCacheGet"));
  check("Catch schreibt den Grund", llm.includes("assignOpenRouterLimit(sink, status)"));
  check("Sektion nutzt den Flow und prüft res.ok lokal", section.includes("runCatalystEnrich(") && section.includes("ok: res.ok"));
  check("alter Token-Budget-Text weg", !section.includes("Token-Budget erschöpft"));
  check("Dashboard ersetzt über startAnalyze, gleiche Flags", dash.includes("onReloadAnalysis={() => startAnalyze({ ticker: data.ticker, llm: useLLMRef.current, force: false })}"));
  check("onSuccess setzt das ganze Ergebnis", dash.includes("setData(result);"));
  check("apiRequest wirft bei Status nicht", apiFn.includes("return res;") && !apiFn.includes("throwIfResNotOk"));

  console.log("\n12) Pins");
  const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
  check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
  check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");
  const msft = buildBiasDecision(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")));
  check("Buffett MSFT 5.6381", msft.overallScore.toFixed(4) === "5.6381", String(msft.overallScore));

  if (failed > 0) {
    console.error(`\n${failed} Checks fehlgeschlagen`);
    process.exit(1);
  }
  console.log("\nS15 catalyst enrich reload: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
