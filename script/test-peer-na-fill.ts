/**
 * Peer-Set KI: OpenRouter nennt nur Ticker. Kennzahlen kommen von FMP.
 * Fehlt FMP, wird die Zeile nicht mit Modellzahlen gefüllt.
 * Lauf: npx tsx script/test-peer-na-fill.ts
 */
import { buildPeerNaFillPrompt, requestPeerNaFills } from "../server/peer-na-fill";
import {
  PEER_NA_INCOMPLETE_ERROR,
  validatePeerNaTickers,
  type PeerNaFill,
} from "../shared/peer-na-fill";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function fmpRow(ticker: string, pe: number, name: string): PeerNaFill {
  return {
    ticker,
    name,
    suggestedBy: "ki",
    marketCap: 100e9,
    pe,
    peg: 1.2,
    ps: 8,
    pb: 6,
    epsGrowth1Y: 12,
    epsGrowth5Y: 10,
    revenueGrowth: 9,
    roic: 18,
    roic5Y: 16,
    roicFiscalYear: "2025",
  };
}

console.log("\n=== Ticker-Validierung ignoriert Modell-Kennzahlen ===");
{
  const tickers = validatePeerNaTickers("NVO", ["SNY"], {
    fills: [
      { ticker: "LLY", name: "Erfunden", pe: 999, marketCap: 1, roic: 80 },
      { ticker: "nvo" },
      { ticker: "SNY" },
      { ticker: "LLY" },
      "PFE",
    ],
  });
  check("nur neue Ticker, Subjekt und Fact-Peer weg", JSON.stringify(tickers) === JSON.stringify(["LLY", "PFE"]), JSON.stringify(tickers));
}

console.log("\n=== Prompt verlangt keine Kennzahlen ===");
{
  const prompt = buildPeerNaFillPrompt(
    { ticker: "NVO", companyName: "Novo Nordisk", sector: "Healthcare", industry: "Drug Manufacturers" },
    ["SNY"],
    2,
  );
  check("JSON-Beispiel enthält nur ticker", prompt.includes('{"fills":[{"ticker":"LLY"}]}'));
  check("Prompt verbietet Kennzahlen", prompt.includes("Keine Kennzahlen"));
  check("Prompt nennt die Lücke", prompt.includes("Es fehlen 2"));
}

console.log("\n=== Fail-closed und FMP-Zahlen ===");
{
  let llmCalls = 0;
  let fmpCalls = 0;
  const noLlm = await requestPeerNaFills({
    ticker: "NVO",
    existingPeers: ["SNY"],
    relativeApplies: false,
  }, {
    isLLMAvailable: () => false,
    callLLMJson: async () => { llmCalls++; return { data: { fills: [] }, modelUsed: "x" }; },
    loadFmpPeerMetrics: async () => { fmpCalls++; return []; },
  });
  check("ohne LLM kein Aufruf", llmCalls === 0 && fmpCalls === 0 && !noLlm.ok);
  if (!noLlm.ok) check("503 LLM_UNAVAILABLE", noLlm.status === 503 && noLlm.code === "LLM_UNAVAILABLE");

  const full = await requestPeerNaFills({ ticker: "NVO", existingPeers: ["SNY", "PFE", "MRK"] }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => { throw new Error("should not be called"); },
    loadFmpPeerMetrics: async () => { throw new Error("should not be called"); },
  });
  check("volles Fact-Set: keine KI", !full.ok && full.code === "BAD_REQUEST");

  let fmpTickers: string[] = [];
  const mixed = await requestPeerNaFills({
    ticker: "NVO",
    existingPeers: ["SNY"],
    relativeApplies: false,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      data: {
        fills: [
          { ticker: "LLY", name: "Nicht FMP", pe: 999, marketCap: 5, roic: 77 },
          { ticker: "NOPE", pe: 50 },
        ],
      },
      modelUsed: "mock",
    }),
    loadFmpPeerMetrics: async (tickers) => {
      fmpTickers = tickers;
      return [fmpRow("LLY", 22.4, "Eli Lilly")];
    },
  });
  check("FMP sieht die KI-Ticker, nicht die Modellzahlen", JSON.stringify(fmpTickers) === JSON.stringify(["LLY", "NOPE"]), JSON.stringify(fmpTickers));
  check("ein FMP-Treffer bei zwei fehlenden Zeilen ist unvollständig", !mixed.ok);
  if (!mixed.ok) {
    check("INCOMPLETE_FILL ohne Teilübernahme", mixed.status === 422 && mixed.code === "INCOMPLETE_FILL" && mixed.error === PEER_NA_INCOMPLETE_ERROR);
    check("keine fills im Fehler", !("fills" in mixed));
  }

  const ok = await requestPeerNaFills({
    ticker: "NVO",
    existingPeers: ["SNY", "PFE"],
    relativeApplies: false,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      data: { fills: [{ ticker: "LLY", pe: 999, name: "Erfunden" }] },
      modelUsed: "mock",
    }),
    loadFmpPeerMetrics: async () => [fmpRow("LLY", 22.4, "Eli Lilly")],
  });
  check("ein fehlender Slot wird mit FMP geschlossen", ok.ok === true);
  if (ok.ok) {
    check("P/E ist der FMP-Wert, nicht 999", ok.fills[0].pe === 22.4);
    check("Name kommt von FMP", ok.fills[0].name === "Eli Lilly");
    check("Zeile ist als KI-Vorschlag markiert", ok.fills[0].suggestedBy === "ki");
    check("Relativ-Score wird nur durchgereicht", ok.relativeApplies === false);
    check("Hinweis trennt KI-Namen und FMP-Zahlen", ok.note.includes("FMP"));
  }

  const emptyFmp = await requestPeerNaFills({
    ticker: "NVO",
    existingPeers: ["SNY", "PFE"],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({ data: { fills: [{ ticker: "ZZZZ", pe: 40, marketCap: 9e11 }] }, modelUsed: "mock" }),
    loadFmpPeerMetrics: async () => [],
  });
  check("ohne FMP-Zeile keine erfundenen Zahlen", !emptyFmp.ok && emptyFmp.code === "INCOMPLETE_FILL");
}

console.log(failed === 0 ? "\n✅ peer-na-fill Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
