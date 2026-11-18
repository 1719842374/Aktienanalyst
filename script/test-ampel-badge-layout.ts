/**
 * Bounding-Box der Ampel-Badge gegen Achsenlabels.
 * Kegel aus: 0 px² Überlappung bei 1440 Light und Dark.
 * 375: nach Kegel an→aus bleibt der rechte Abstand ~4 px und wandert nicht mit scrollLeft.
 * Kegel an: Badge im Toolbar-Slot, 0 px², unter 640 eigene Zeile, keine Seiten-Überbreite.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-ampel-badge-layout.ts
 */
import path from "node:path";
import { createRequire } from "node:module";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core") as typeof import("playwright-core");

const repo = process.cwd();
const chrome = "/usr/bin/google-chrome";
const port = 4179;

type Measure = {
  overlapPx2: number;
  overlapTexts: string[];
  rightInset: number | null;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  pageScrollWidth: number;
  innerWidth: number;
  badgeInSlot: boolean;
  slotOwnRow: boolean;
  slotBasisFull: boolean;
  scrollEnd: boolean;
  insets: { atCurrent: number; atStart: number; atEnd: number };
};

const failed: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near4(px: number): boolean {
  return px >= 3 && px <= 6;
}

const MEASURE_JS = `(() => {
  const area = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w <= 0 || h <= 0) return 0;
    return w * h;
  };
  const scroller = document.querySelector('[data-testid="chart-price-scroll"]');
  const badge = document.querySelector('[data-testid="chart-ampel-label"]');
  const slot = document.querySelector('[data-testid="ta-ampel-toolbar-slot"]');
  const cone = document.querySelector('[data-testid="button-scenario-cone"]');
  if (!scroller || !badge) throw new Error("Chart oder Badge fehlt");
  const br = badge.getBoundingClientRect();
  const ticks = Array.from(document.querySelectorAll(".recharts-cartesian-axis-tick-value")).map(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, text: (node.textContent || "").trim() };
  });
  let overlapPx2 = 0;
  const overlapTexts = [];
  for (const tick of ticks) {
    const hit = area(br, tick);
    if (hit > 0) {
      overlapPx2 += hit;
      overlapTexts.push(tick.text + ":" + hit.toFixed(1));
    }
  }
  const readInset = () => {
    const b = badge.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return s.right - b.right;
  };
  const atCurrent = readInset();
  const prev = scroller.scrollLeft;
  scroller.scrollLeft = 0;
  const atStart = readInset();
  scroller.scrollLeft = scroller.scrollWidth;
  const atEnd = readInset();
  scroller.scrollLeft = prev;
  const slotBox = slot ? slot.getBoundingClientRect() : null;
  const coneBox = cone ? cone.getBoundingClientRect() : null;
  return {
    overlapPx2,
    overlapTexts,
    rightInset: atCurrent,
    scrollLeft: scroller.scrollLeft,
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    badgeInSlot: !!(slot && slot.contains(badge)),
    slotOwnRow: !!(slotBox && coneBox && slotBox.top >= coneBox.bottom - 1),
    slotBasisFull: !!(slot && slot.className.indexOf("basis-full") >= 0),
    scrollEnd: scroller.getAttribute("data-scroll-end") === "1",
    insets: { atCurrent, atStart, atEnd },
  };
})()`;

async function measure(page: import("playwright-core").Page): Promise<Measure> {
  return page.evaluate(MEASURE_JS) as Promise<Measure>;
}

async function ready(page: import("playwright-core").Page) {
  await page.waitForFunction(`() => {
    const badge = document.querySelector('[data-testid="chart-ampel-label"]');
    const ticks = Array.from(document.querySelectorAll(".recharts-cartesian-axis-tick-value"));
    return !!badge && ticks.some(t => (t.textContent || "").indexOf("%") >= 0);
  }`, { timeout: 30000 });
}

async function scenario(
  page: import("playwright-core").Page,
  label: string,
  width: number,
  theme: "light" | "dark",
) {
  console.log(`\n${label} ${width}px ${theme}`);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  if (theme === "dark") {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
  }
  await ready(page);
  const coneOff = await measure(page);
  console.log(`  kegel-aus ${JSON.stringify({ overlapPx2: +coneOff.overlapPx2.toFixed(2), overlapTexts: coneOff.overlapTexts, rightInset: +coneOff.rightInset!.toFixed(2), scrollLeft: coneOff.scrollLeft, scrollWidth: coneOff.scrollWidth, clientWidth: coneOff.clientWidth })}`);

  if (width >= 1440) {
    check(`${label} Kegel aus Überlappung 0 px²`, coneOff.overlapPx2 < 0.5, `${coneOff.overlapPx2.toFixed(2)} px² [${coneOff.overlapTexts.join(", ")}]`);
    check(`${label} Kegel aus Chart füllt den Viewport`, coneOff.scrollWidth === coneOff.clientWidth, `scroll ${coneOff.scrollWidth} client ${coneOff.clientWidth}`);
  }

  await page.click('[data-testid="button-scenario-cone"]');
  await page.waitForSelector('[data-testid="ta-ampel-toolbar-slot"] [data-testid="chart-ampel-label"]', { timeout: 15000 });
  await page.waitForFunction(`() => {
    const ticks = Array.from(document.querySelectorAll(".recharts-cartesian-axis-tick-value"));
    return ticks.some(t => (t.textContent || "").indexOf("%") >= 0);
  }`, { timeout: 15000 });
  const coneOn = await measure(page);
  console.log(`  kegel-an ${JSON.stringify({ overlapPx2: +coneOn.overlapPx2.toFixed(2), badgeInSlot: coneOn.badgeInSlot, slotOwnRow: coneOn.slotOwnRow, scrollEnd: coneOn.scrollEnd, scrollWidth: coneOn.scrollWidth, clientWidth: coneOn.clientWidth, pageScrollWidth: coneOn.pageScrollWidth, innerWidth: coneOn.innerWidth, scrollLeft: coneOn.scrollLeft })}`);
  check(`${label} Kegel an Badge im Toolbar-Slot`, coneOn.badgeInSlot);
  check(`${label} Kegel an Überlappung 0 px²`, coneOn.overlapPx2 < 0.5, `${coneOn.overlapPx2.toFixed(2)} px²`);
  check(`${label} Kegel an keine Seiten-Überbreite`, coneOn.pageScrollWidth <= coneOn.innerWidth + 1, `page ${coneOn.pageScrollWidth} viewport ${coneOn.innerWidth}`);
  check(`${label} Kegel an scrollt ans Ende`, coneOn.scrollEnd);
  if (width < 640) {
    check(`${label} Kegel an eigene Zeile unter 640`, coneOn.slotOwnRow && coneOn.slotBasisFull, `ownRow=${coneOn.slotOwnRow} basis-full=${coneOn.slotBasisFull}`);
  } else {
    check(`${label} Kegel an Chart-scrollWidth = Viewport`, coneOn.scrollWidth === coneOn.clientWidth, `scroll ${coneOn.scrollWidth} client ${coneOn.clientWidth}`);
  }

  await page.click('[data-testid="button-scenario-cone"]');
  await page.waitForFunction(`() => {
    return !document.querySelector('[data-testid="ta-ampel-toolbar-slot"]')
      && !!document.querySelector('[data-testid="chart-ampel-label"]');
  }`, { timeout: 15000 });
  const after = await measure(page);
  console.log(`  kegel-an-aus ${JSON.stringify({ overlapPx2: +after.overlapPx2.toFixed(2), overlapTexts: after.overlapTexts, rightInset: +after.rightInset!.toFixed(2), scrollLeft: after.scrollLeft, insets: { atCurrent: +after.insets.atCurrent.toFixed(2), atStart: +after.insets.atStart.toFixed(2), atEnd: +after.insets.atEnd.toFixed(2) }, scrollWidth: after.scrollWidth, clientWidth: after.clientWidth })}`);

  if (width < 640) {
    const drift = Math.max(after.insets.atCurrent, after.insets.atStart, after.insets.atEnd)
      - Math.min(after.insets.atCurrent, after.insets.atStart, after.insets.atEnd);
    check(`${label} nach an→aus rechter Abstand ~4 px`, near4(after.insets.atCurrent), `${after.insets.atCurrent.toFixed(2)} px, scrollLeft ${after.scrollLeft}`);
    check(`${label} Badge wandert nicht mit dem Chart-Scroll`, drift <= 1 && near4(after.insets.atStart) && near4(after.insets.atEnd), `Drift ${drift.toFixed(2)} px Start ${after.insets.atStart.toFixed(2)} Ende ${after.insets.atEnd.toFixed(2)}`);
  } else {
    check(`${label} nach an→aus Überlappung 0 px²`, after.overlapPx2 < 0.5, `${after.overlapPx2.toFixed(2)} px² [${after.overlapTexts.join(", ")}]`);
  }
}

async function main() {
  let vite: ViteDevServer | null = null;
  let browser: import("playwright-core").Browser | null = null;
  try {
    vite = await createServer({
      configFile: false,
      root: path.resolve(repo, "script/ampel-badge-layout"),
      plugins: [react()],
      resolve: {
        alias: {
          "@": path.resolve(repo, "client/src"),
          "@shared": path.resolve(repo, "shared"),
        },
      },
      css: { postcss: path.resolve(repo, "postcss.config.js") },
      server: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        fs: { allow: [repo] },
      },
      logLevel: "error",
    });
    await vite.listen();
    browser = await chromium.launch({
      executablePath: chrome,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    page.on("pageerror", err => console.log("  pageerror", err.message));
    await scenario(page, "Light", 1440, "light");
    await scenario(page, "Dark", 1440, "dark");
    await scenario(page, "Light", 375, "light");
    await scenario(page, "Dark", 375, "dark");
  } finally {
    await browser?.close();
    await vite?.close();
  }
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed`);
    for (const row of failed) console.error(`  - ${row}`);
    process.exit(1);
  }
  console.log("\nampel badge layout ok");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
