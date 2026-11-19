/**
 * Layout des bestehenden Leertexts „Keine Ergebnisse“ auf #/screener.
 * Chrome misst die echte Seite. Der Fetch-Stub liefert nur das Fixture.
 *
 *   npx tsx script/test-screener-empty-layout.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const { chromium } = createRequire(new URL("../package.json", import.meta.url))("playwright-core") as typeof import("playwright-core");

const port = 5196;
const repo = new URL("..", import.meta.url).pathname;
const payload = {
  lastUpdated: "2026-11-08T22:48:28.000Z",
  totalInvestors: 2,
  totalHoldings: 2,
  screenedStocks: ["AAA", "BBB"].map((ticker) => ({
    ticker,
    name: `${ticker} Co`,
    price: 20,
    marketCap: 2e9,
    pe: 14,
    forwardPE: 12,
    sector: "Technology",
    beta: 1,
    investorCount: 1,
    investors: ["Fund"],
    totalValue: 5,
    targetPrice: 24,
    upside: 4,
    downside: 2,
    crv: 2,
    crvPass: false,
    yearHigh: 25,
    yearLow: 15,
    fcfMargin: 10,
  })),
};

function startVite(): ChildProcess {
  return spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      /* vite still starting */
    }
    await delay(250);
  }
  throw new Error("vite did not accept connections");
}

type TextMeasure = {
  text: string | null;
  calls: number;
  rows: number;
  scroller: { clientWidth: number; scrollWidth: number } | null;
  textBox: { left: number; right: number; width: number; fullyInsideViewport: boolean; fullyInsideScroller: boolean } | null;
};

async function measure(width: number): Promise<{ filled: TextMeasure; empty: TextMeasure; reset: TextMeasure }> {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/screener")) calls.push(request.url());
  });
  await page.route("**/api/screener*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  }));
  await page.goto(`http://127.0.0.1:${port}/#/screener`, { waitUntil: "domcontentloaded" });
  await page.getByText("AAA", { exact: true }).first().waitFor();

  const read = async (): Promise<TextMeasure> => page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("td, p"));
    const empty = nodes.find((node) => node.textContent === "Keine Ergebnisse");
    const scroller = document.querySelector(".overflow-x-auto");
    const scrollerBox = scroller?.getBoundingClientRect() ?? null;
    const range = empty ? document.createRange() : null;
    if (empty && range) range.selectNodeContents(empty);
    const rect = range?.getBoundingClientRect() ?? null;
    return {
      text: empty?.textContent ?? null,
      calls: 0,
      rows: document.body.innerText.includes("AAA") ? 1 : 0,
      scroller: scroller ? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth } : null,
      textBox: rect ? {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        fullyInsideViewport: rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5 && rect.width > 0,
        fullyInsideScroller: scrollerBox
          ? rect.left >= scrollerBox.left - 0.5 && rect.right <= scrollerBox.right + 0.5
          : false,
      } : null,
    };
  }).then((value) => ({ ...value, calls: calls.length, rows: value.rows }));

  const filled = await read();
  await page.getByTestId("screener-industry").fill("software");
  await page.getByText("Keine Ergebnisse").waitFor();
  const empty = await read();
  await page.getByTestId("screener-industry").fill("");
  await page.getByText("AAA", { exact: true }).first().waitFor();
  const reset = await read();
  await browser.close();
  return { filled, empty, reset };
}

const vite = startVite();
try {
  await waitForServer();
  for (const width of [375, 1280]) {
    const result = await measure(width);
    console.log(JSON.stringify({ width, result }));
    assert.equal(result.filled.rows, 1);
    assert.equal(result.filled.calls, 1);
    assert.equal(result.empty.text, "Keine Ergebnisse");
    assert.equal(result.empty.textBox?.fullyInsideViewport, true);
    assert.equal(result.empty.textBox?.fullyInsideScroller, true);
    assert.equal(result.empty.calls, 1);
    assert.equal(result.reset.rows, 1);
    assert.equal(result.reset.calls, 1);
    assert.equal(result.reset.text, null);
    if (width === 375) {
      assert.ok((result.filled.scroller?.scrollWidth ?? 0) > (result.filled.scroller?.clientWidth ?? 0));
    }
  }
  console.log("screener empty layout: OK");
} finally {
  vite.kill("SIGTERM");
}
