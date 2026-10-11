import { readFileSync } from "node:fs";

// The gradient Area and the price Line share dataKey "close". Without
// tooltipType="none" on the Area, Recharts lists the Gold row twice.
const src = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf8");
let fail = 0;
function check(name: string, ok: boolean) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const area = src.match(/<Area[\s\S]*?\/>/)?.[0] ?? "";
check("the gradient Area uses dataKey close", area.includes('dataKey="close"'));
check("the gradient Area is hidden from the tooltip", area.includes('tooltipType="none"'));
const closeLines = src.match(/<Line[\s\S]*?\/>/g)?.filter(l => l.includes('dataKey="close"')) ?? [];
check("exactly one close Line feeds the tooltip", closeLines.length === 1 && !closeLines[0].includes('tooltipType="none"'));
check("the Gold label and cross note stay", src.includes('name === "close" ? "Gold"') && src.includes(" · Golden Cross") && src.includes(" · Death Cross"));
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("all passed");
