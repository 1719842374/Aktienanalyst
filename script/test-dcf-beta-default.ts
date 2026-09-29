/**
 * DCF-β default = Markt-β (clamped). Sektor-Anker is opt-in.
 *
 * Teil 1–3 (Formel) laufen mit `npx tsx script/test-dcf-beta-default.ts`
 * bis zum UI-Teil. Der UI-Teil braucht automatisches JSX und jsdom:
 *
 *   npx esbuild script/test-dcf-beta-default.ts --bundle --platform=node \
 *     --format=esm --jsx=automatic --external:jsdom --alias:@shared=./shared \
 *     --outfile=script/.dcf-beta-test.mjs
 *   node script/.dcf-beta-test.mjs
 *
 * Teil 4 rendert Section 5 und Section 4 und klickt Markt-β | Sektor-Anker,
 * den manuellen Beta-Input und den WACC-Override.
 */
import type { StockAnalysis } from "../shared/schema";
import {
  DCF_BETA_MAX,
  DCF_BETA_MIN,
  betaForDcfSource,
  buildDefaultDCFParams,
  calculateFCFFDCF,
  clampDcfBeta,
  dcfBetaDivergedFromMarket,
  marketBetaForDcf,
  sectorImpliedBeta,
  sectorImpliedBetaFromAnalysis,
} from "../shared/valuation-signal";

let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function closeTo(actual: number, expected: number, eps = 1e-9): boolean {
  return Math.abs(actual - expected) < eps;
}

function analysis(overrides: Partial<StockAnalysis> & { sectorWaccAvg?: number } = {}): StockAnalysis {
  const sectorWaccAvg = overrides.sectorWaccAvg ?? 8;
  const prices = Array.from({ length: 70 }, (_, i) => ({
    date: `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
    close: 100,
    volume: 1,
  }));
  return {
    ticker: "BETA",
    companyName: "Beta Fixture",
    industry: "Software",
    sector: "Technology",
    description: "Software platform",
    currentPrice: 100,
    beta5Y: 1.4,
    totalDebt: 20e9,
    cashEquivalents: 5e9,
    marketCap: 80e9,
    revenue: 50e9,
    ebitda: 15e9,
    operatingIncome: 12e9,
    sharesOutstanding: 1e9,
    epsTTM: 5,
    epsConsensusNextFY: 6,
    fcfTTM: 8e9,
    fcfHaircut: 0,
    governmentExposure: 0,
    peRatio: 20,
    epsGrowth5Y: 12,
    lynchClass: "stalwart",
    historicalPrices: prices,
    financialStatements: {
      cashFlow: { operatingCashFlow: 10e9, capex: 2e9, fcf: 8e9, fcfMargin: 16, fcfPerShare: 8 },
    },
    sectorProfile: {
      sector: "Technology",
      waccScenarios: { kons: sectorWaccAvg + 1.5, avg: sectorWaccAvg, opt: sectorWaccAvg - 1.5 },
      growthAssumptions: { g1: 10, g2: 6, terminal: 2.5 },
    },
    ...overrides,
  } as unknown as StockAnalysis;
}

// Debt 20 / (80+20) = 20%. Same constants as sectorImpliedBeta().
// Replicated here so a drift in the helper fails the test.
function handImplied(targetWacc: number): number {
  const evFrac = 0.8;
  const dvFrac = 0.2;
  const debtCostPart = dvFrac * 5 * (1 - 21 / 100);
  const raw = (targetWacc - debtCostPart - evFrac * 4.2) / (evFrac * 5.5);
  return +Math.max(0.5, Math.min(1.8, raw)).toFixed(2);
}

console.log("\n=== 1. Markt-β default, Sektor-Anker nur als Option ===");
{
  const data = analysis({ beta5Y: 1.4, sectorWaccAvg: 8 });
  const params = buildDefaultDCFParams(data);
  const sector = sectorImpliedBetaFromAnalysis(data);
  const hand = handImplied(8);
  const oldDefault = +Math.min(sector, data.beta5Y + 0.1).toFixed(2);

  check("implied β matches the hand formula", closeTo(sector, hand), `sector=${sector} hand=${hand}`);
  check("market β and sector β differ", Math.abs(params.beta - sector) > 0.1, `default=${params.beta} sector=${sector}`);
  check("buildDefaultDCFParams.beta is clamped market β", closeTo(params.beta, 1.4), `beta=${params.beta}`);
  check("default is not the old min(implied, beta+0.1)", !closeTo(params.beta, oldDefault), `old=${oldDefault} now=${params.beta}`);
  check("Sektor-Anker mode returns implied β", closeTo(betaForDcfSource("sector", params.beta, sector), sector));
  check("Markt mode returns market β", closeTo(betaForDcfSource("market", params.beta, sector), params.beta));
}

{
  const data = analysis({ beta5Y: 1.2, sectorWaccAvg: 12 });
  const params = buildDefaultDCFParams(data);
  const sector = sectorImpliedBetaFromAnalysis(data);
  const oldCapped = +Math.min(sector, 1.2 + 0.1).toFixed(2);
  check("high sector WACC matches the hand formula and sits above 1.7", closeTo(handImplied(12), sector) && sector > 1.7, `sector=${sector}`);
  check("default stays at market 1.20, not the old cap 1.30", closeTo(params.beta, 1.2) && !closeTo(params.beta, oldCapped), `beta=${params.beta} old=${oldCapped}`);
}

console.log("\n=== 2. Clamp on the market value ===");
check("beta 0.2 → 0.50", closeTo(marketBetaForDcf(0.2), DCF_BETA_MIN));
check("beta 2.4 → 1.80", closeTo(marketBetaForDcf(2.4), DCF_BETA_MAX));
check("beta 1.25 stays 1.25", closeTo(marketBetaForDcf(1.25), 1.25));
check("non-finite beta falls back inside the band", closeTo(clampDcfBeta(Number.NaN), 1));
check("buildDefault uses the clamp", closeTo(buildDefaultDCFParams(analysis({ beta5Y: 2.4 })).beta, 1.8));
check("100% debt does not produce NaN sector β", Number.isFinite(sectorImpliedBeta({ targetWacc: 9, debtRatioPct: 100 })));
check("divergence flag ignores 2-decimal noise", dcfBetaDivergedFromMarket(1.4, 1.4) === false && dcfBetaDivergedFromMarket(1.1, 1.4) === true);

console.log("\n=== 3. WACC override still bypasses CAPM ===");
{
  const params = buildDefaultDCFParams(analysis({ beta5Y: 1.4, sectorWaccAvg: 8 }));
  const viaCapm = calculateFCFFDCF(params);
  const sectorBeta = sectorImpliedBetaFromAnalysis(analysis({ beta5Y: 1.4, sectorWaccAvg: 8 }));
  const viaSector = calculateFCFFDCF({ ...params, beta: sectorBeta });
  const viaOverride = calculateFCFFDCF({ ...params, beta: sectorBeta, waccOverride: 9 });
  check("switching β changes CAPM WACC", Math.abs(viaCapm.wacc - viaSector.wacc) > 0.5, `marketWacc=${viaCapm.wacc} sectorWacc=${viaSector.wacc}`);
  check("waccOverride wins over β", closeTo(viaOverride.wacc, 9), `wacc=${viaOverride.wacc}`);
  check("override step says CAPM is ignored", viaOverride.steps.some((s) => s.includes("WACC-Override") && viaOverride.steps.some((t) => t.includes("ignoriert"))));
}

async function runUi() {
  console.log("\n=== 4. Section 5 / Section 4 interaction ===");
  let JSDOM: typeof import("jsdom").JSDOM;
  try {
    ({ JSDOM } = await import("jsdom"));
  } catch {
    failed++;
    console.log("  ❌ jsdom fehlt — UI-Klicks nicht gelaufen");
    return;
  }

  const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  };
  define("window", w);
  define("document", w.document);
  define("navigator", w.navigator);
  define("HTMLElement", w.HTMLElement);
  define("HTMLInputElement", w.HTMLInputElement);
  define("Element", w.Element);
  define("Node", w.Node);
  define("DocumentFragment", w.DocumentFragment);
  define("getComputedStyle", w.getComputedStyle.bind(w));
  define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  define("cancelAnimationFrame", (id: number) => clearTimeout(id));
  define("IS_REACT_ACT_ENVIRONMENT", true);

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Section5 } = await import("../client/src/components/sections/Section5");
  const { Section4 } = await import("../client/src/components/sections/Section4");

  const data = analysis({ beta5Y: 1.4, sectorWaccAvg: 8 });
  const sectorLabel = sectorImpliedBetaFromAnalysis(data).toFixed(2);
  const host = w.document.getElementById("root")!;
  const root = createRoot(host);

  await React.act(async () => {
    root.render(React.createElement(Section5, { data }));
  });

  const dcfBetaLabel = () =>
    [...w.document.querySelectorAll("span")].find((s) => s.textContent === "β (DCF): ")?.nextElementSibling?.textContent ?? "";
  const waccLabel = () =>
    [...w.document.querySelectorAll("span")].find((s) => s.textContent === "WACC: ")?.parentElement?.textContent ?? "";
  const bodyText = () => w.document.body.textContent ?? "";

  check("initial β(DCF) is market 1.40", dcfBetaLabel() === "1.40", `got ${dcfBetaLabel()}`);
  check("Markt-β is the pressed default", w.document.querySelector("[data-testid='toggle-beta-mode-market']")?.getAttribute("aria-pressed") === "true");
  check("Sektor-Anker is not pressed", w.document.querySelector("[data-testid='toggle-beta-mode-sector']")?.getAttribute("aria-pressed") === "false");
  check("adopt button hidden while β matches market", w.document.querySelector("[data-testid='button-adopt-market-beta']") == null);
  check("old Sektor-Anker-as-default story is gone", !bodyText().includes("glättet") && bodyText().includes("β(DCF)-Default = Markt-β"));

  const waccAtMarket = waccLabel();
  await React.act(async () => {
    w.document.querySelector<HTMLButtonElement>("[data-testid='toggle-beta-mode-sector']")!.click();
  });
  check(`Sektor-Anker sets implied β ${sectorLabel}`, dcfBetaLabel() === sectorLabel, `got ${dcfBetaLabel()}`);
  check("WACC moves when β source changes", waccLabel() !== waccAtMarket, `before=${waccAtMarket} after=${waccLabel()}`);
  check("adopt button appears off the market default", w.document.querySelector("[data-testid='button-adopt-market-beta']") != null);
  check("hint says default is Markt-β and sector is chosen", bodyText().includes("Default ist das Markt-β") && bodyText().includes("Sektor-Anker ist gewählt") && bodyText().includes("keine Vorgabe"));

  await React.act(async () => {
    w.document.querySelector<HTMLButtonElement>("[data-testid='button-adopt-market-beta']")!.click();
  });
  check("Markt-β übernehmen restores 1.40", dcfBetaLabel() === "1.40", `got ${dcfBetaLabel()}`);
  check("adopt button hides again", w.document.querySelector("[data-testid='button-adopt-market-beta']") == null);

  await React.act(async () => {
    w.document.querySelector<HTMLButtonElement>("[data-testid='toggle-dcf-editor']")!.click();
  });
  const betaInput = () => w.document.querySelector<HTMLInputElement>("[data-testid='input-dcf-beta']");
  check("Beta input stays in the editor", betaInput() != null && betaInput()!.value === "1.4");

  await React.act(async () => {
    const input = betaInput()!;
    const proto = w.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(input, "0.95");
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
  });
  check("manual beta is kept", dcfBetaLabel() === "0.95", `got ${dcfBetaLabel()}`);
  check("adopt offered after a manual divergence", w.document.querySelector("[data-testid='button-adopt-market-beta']") != null);

  await React.act(async () => {
    w.document.querySelector<HTMLButtonElement>("[data-testid='button-adopt-market-beta']")!.click();
  });
  check("adopt after a manual edit returns to market β", dcfBetaLabel() === "1.40" && betaInput()!.value === "1.4");

  const capmGrid = () => betaInput()!.closest(".grid") as HTMLElement;
  await React.act(async () => {
    w.document.querySelector<HTMLButtonElement>("[data-testid='toggle-wacc-override']")!.click();
  });
  const waccDuringOverride = waccLabel();
  check("WACC override chip is active", waccDuringOverride.includes("Override"), waccDuringOverride);
  check("CAPM grid is disabled while override is on", capmGrid().className.includes("pointer-events-none"));
  check("β-Quelle toggle is disabled while override is on", (w.document.querySelector("[data-testid='beta-source-toggle']") as HTMLElement).className.includes("pointer-events-none"));

  await React.act(async () => {
    const input = betaInput()!;
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "0.70");
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
  });
  check("override WACC ignores a beta edit", waccLabel() === waccDuringOverride, `before=${waccDuringOverride} after=${waccLabel()}`);

  await React.act(async () => {
    root.render(React.createElement(Section4, { data }));
  });
  const section4 = w.document.body.textContent ?? "";
  check("Section 4 no longer says the DCF always uses the sector anchor", !section4.includes("DCF-Modell nutzt adjustiertes") && !section4.includes("Diese Werte nutzt das DCF-Modell"));
  check("Section 4 says DCF default is Markt-β", section4.includes("Das DCF-Modell startet mit demselben Markt-β") && section4.includes("nicht als Default"));
  check("Section 4 live table still shows market β 1.40", section4.includes("1.40"));

  await React.act(async () => {
    root.unmount();
  });
}

await runUi();

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
