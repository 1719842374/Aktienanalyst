/**
 * Sec14 FRED-Messkarten: die fuenfte Karte TGA erscheint, wenn measured.tgaBn gesetzt ist.
 * Milliarden wie M2 (Wert in Mrd. USD → formatUsdCompact). Die vier bestehenden Karten bleiben gleich.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-measured-fred-cards.ts
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeasuredFredCards } from "../client/src/components/btc/StablecoinLiquidityPanel";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const live = {
  policyRate: 3.88,
  realYield10y: 2.91,
  dgs10: 5.26,
  m2Bn: 23340,
  tgaBn: 977.084,
};

const html = renderToStaticMarkup(createElement(MeasuredFredCards, { measured: live }));

const labels = ["Leitzins", "Realzins 10Y", "10-Jahres-Rendite", "M2", "TGA"];
let cursor = -1;
for (const label of labels) {
  const at = html.indexOf(`>${label}<`);
  ok(`${label} steht im Messraster`, at > cursor, `index ${at}`);
  cursor = at;
}

ok("Leitzins bleibt 3.88%", html.includes("3.88%"));
ok("Realzins 10Y bleibt 2.91%", html.includes("2.91%"));
ok("10-Jahres-Rendite bleibt 5.26%", html.includes("5.26%"));
ok("M2 bleibt $23.34 Bio.", html.includes("$23.34 Bio."));
ok("TGA formatiert Milliarden wie M2", html.includes("$977.08 Mrd."));
ok("fuenf FRED-Unterzeilen", (html.match(/FRED, gemessen/g) ?? []).length === 5);

const withoutTga = renderToStaticMarkup(createElement(MeasuredFredCards, {
  measured: { policyRate: 3.88, realYield10y: 2.91, dgs10: 5.26, m2Bn: 23340, tgaBn: null },
}));
ok("TGA-Slot bleibt sichtbar ohne Wert", withoutTga.includes(">TGA<") && withoutTga.includes("n/v"));

const panel = readFileSync(new URL("../client/src/components/btc/StablecoinLiquidityPanel.tsx", import.meta.url), "utf8");
ok("Policy-Scan rendert MeasuredFredCards", panel.includes("<MeasuredFredCards"));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nmeasured FRED cards ok");
