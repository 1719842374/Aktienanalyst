/**
 * BTC-Kurs: Kauf/Verkauf bleiben senkrechte Linien.
 * Die farbigen Kreise auf der Kurslinie kamen nur aus dem Mobile-Zweig
 * `{narrow && <ReferenceDot y={s.price} r={TA_SIGNAL_DOT_R}>}` in
 * Section10TechnicalChart (useIsNarrow, max-width 639px). Desktop hat
 * diese Punkte nie gezeichnet. Sie dürfen auf keinem Viewport zurück.
 *
 * Run: npx tsx script/test-btc-signal-markers.ts
 */
import { readFileSync } from "node:fs";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const src = readFileSync(new URL("../client/src/pages/BTCDashboard.tsx", import.meta.url), "utf8");
const start = src.indexOf("{/* Buy/Sell signal markers");
const end = src.indexOf("{/* Measurement markers");
const block = start >= 0 && end > start ? src.slice(start, end) : "";

check("Signal-Marker-Block ist vorhanden", block.length > 0);
check(
  "Signale bleiben eine ReferenceLine für jeden sichtbaren Punkt",
  block.includes("showSignals && visibleSignals.map") && block.includes("<ReferenceLine"),
);
check(
  "Linie ist auf Desktop und Mobile dieselbe (Farbe, Strich, Breite, Deckkraft)",
  block.includes('stroke={s.type === "BUY" ? "#22c55e" : "#ef4444"}')
    && block.includes('strokeDasharray="2 2"')
    && block.includes("strokeWidth={narrow ? 1 : 0.8}")
    && block.includes("opacity={0.5}"),
);
check(
  "kein Element im Signal-Block hängt nur am Mobile-Zweig",
  !block.includes("{narrow &&"),
  "narrow && zeichnet auf dem Handy zusätzliche Marker",
);
check(
  "keine ReferenceDot-Kreise auf dem Kurs",
  !src.includes("<ReferenceDot") && !src.includes("TA_SIGNAL_DOT_R"),
  "ReferenceDot / TA_SIGNAL_DOT_R setzt die roten und grünen Punkte",
);
check(
  "Kurslinie selbst hat keine Punkt-Marker",
  /dataKey="price"[\s\S]{0,180}dot=\{false\}/.test(src),
);
check(
  "Signale bleiben in Tooltip und Tabelle",
  src.includes('s.type === "BUY" ? "▲ BUY"') && src.includes("Letzte Signale"),
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nbtc signal markers ok");
