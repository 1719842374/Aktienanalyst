/**
 * Ist/Soll-Screenshots der Gold-Sektion 9 bei 375 und 1440.
 * Die Seite ist das echte Gold-Dashboard; /api/analyze-gold wird mit der
 * echten AISC-Datei und den Yahoo-GC=F-Schlüssen beantwortet.
 * Ausführen: npx tsx script/preview-gold-miner-shots.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildGoldAiscSeries, type GoldAiscFile } from "../shared/gold-aisc";
import { buildGoldMinerZone } from "../shared/gold-miner-zone";
import { GOLD_FALLBACK_DATA } from "../client/src/lib/goldFallbackData";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core") as typeof import("playwright-core");

const spot = JSON.parse(readFileSync(path.join(root, "script/fixtures/gold-spot-gc-f-2016-2026.json"), "utf8")) as {
  points: { date: string; close: number }[];
};
const aiscFile = JSON.parse(readFileSync(path.join(root, "server/data/gold-aisc.json"), "utf8")) as GoldAiscFile;
const full = buildGoldAiscSeries(aiscFile);
const sollZone = buildGoldMinerZone(spot.points, full);
const istLine = {
  ...full,
  quarters: full.quarters.filter(q => q.quarter >= "2024-Q1"),
  gaps: full.gaps.filter(gap => gap.includes("2024") || gap.includes("2025") || gap.includes("2026")),
};
const istZone = buildGoldMinerZone(spot.points, istLine);

function body(zone: typeof sollZone, line: typeof full) {
  return JSON.stringify({
    ...GOLD_FALLBACK_DATA,
    aiscZone: zone,
    aiscLine: line,
    aiscZoneSpotSource: "Yahoo GC=F (Futures)",
  });
}

const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find(p => {
  try { readFileSync(p); return true; } catch { return false; }
});
if (!chrome) throw new Error("Chrome fehlt");

const outDir = "/opt/cursor/artifacts/screenshots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const shots: Array<{ name: "ist" | "soll"; zone: typeof sollZone; line: typeof full }> = [
  { name: "ist", zone: istZone, line: istLine },
  { name: "soll", zone: sollZone, line: full },
];

for (const shot of shots) {
  for (const width of [1440, 375] as const) {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 900 : 1000 } });
    await page.route("**/api/analyze-gold**", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: body(shot.zone, shot.line),
    }));
    await page.goto("http://127.0.0.1:5000/#/gold", { waitUntil: "domcontentloaded", timeout: 60000 });
    const section = page.locator("[data-testid='gold-miner-section']");
    await section.waitFor({ state: "visible", timeout: 60000 });
    await page.waitForSelector("[data-testid='gold-miner-chart-spot'] .recharts-line", { timeout: 30000 });
    await section.scrollIntoViewIfNeeded();
    const text = await section.innerText();
    const areas = await page.locator("[data-testid='gold-miner-chart-spot'] .recharts-reference-area").count();
    console.log(`${shot.name} ${width}: areas=${areas} since=${shot.zone?.thresholds.since} obs=${shot.zone?.thresholds.obs} score=${shot.zone?.latest?.score.toFixed(2)}`);
    console.log(text.split("\n").slice(0, 12).join(" | "));
    const file = path.join(outDir, `gold-miner-${shot.name}-${width}.png`);
    await section.screenshot({ path: file });
    const box = await section.boundingBox();
    const overflow = await page.evaluate((w) => {
      const el = document.querySelector("[data-testid='gold-miner-section']") as HTMLElement | null;
      return { sw: el?.scrollWidth ?? 0, cw: el?.clientWidth ?? 0, win: w };
    }, width);
    console.log(`  saved ${file} box=${box?.width}x${box?.height} scroll=${overflow.sw} client=${overflow.cw}`);
    if (overflow.sw > width + 2) console.log("  WARN horizontal overflow");
    await page.close();
  }
}
await browser.close();
console.log("shots done");
