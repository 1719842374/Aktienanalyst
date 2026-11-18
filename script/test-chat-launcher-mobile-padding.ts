/**
 * KI-Chat-Launcher verdeckt mobil das Seitenende nicht mehr.
 * Ursache: ChatWidget rendert den Launcher `fixed bottom-4 right-4 h-11` (16 px + 44 px = 60 px über dem
 * Viewport-Rand); die Scroll-Container (<main> in Dashboard/BTC/Gold/Recession) hatten unten kein Polster,
 * dadurch lag die letzte Zeile am Seitenende unter dem Button.
 * Fix: <main> bekommt mobil `pb-16` (64 px ≥ 60 px), ab `sm` wie bisher `pb-0`. Button unverändert.
 * Statischer Klassen-Check (kein Layout-Rendering in Node möglich); Pixel-Nachweis per Screenshots im PR.
 * Ausführen: npx tsx script/test-chat-launcher-mobile-padding.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const px = (cls: string, prefix: string) => {
  const m = cls.match(new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`));
  return m ? Number(m[1]) * 4 : null; // Tailwind-Skala: 1 = 4 px
};

const widget = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
const launcher = widget.match(/className="([^"]*)"\s*\n\s*data-testid="chat-launcher"/)![1];
assert.ok(/(^|\s)fixed(\s|$)/.test(launcher));
const covered = px(launcher, "bottom")! + px(launcher, "h")!;
assert.equal(covered, 60, `Launcher-Position/Größe unverändert (bottom-4 + h-11): ${launcher}`);

for (const page of ["Dashboard", "BTCDashboard", "GoldDashboard", "RecessionDashboard"]) {
  const src = readFileSync(`client/src/pages/${page}.tsx`, "utf8");
  const main = src.match(/<main[\s\S]*?className="([^"]*)"/);
  assert.ok(main, `${page}: <main> gefunden`);
  const cls = main![1].split(/\s+/);
  const pb = cls.map(c => c.match(/^pb-(\d+)$/)).find(Boolean);
  assert.ok(pb && Number(pb[1]) * 4 >= covered, `${page}: mobiles pb ≥ ${covered}px, ist „${main![1]}“`);
  assert.ok(cls.includes("sm:pb-0"), `${page}: ab sm unverändert (sm:pb-0)`);
  console.log(`  ✅ ${page}: <main> pb-${pb![1]} (${Number(pb![1]) * 4}px ≥ ${covered}px) sm:pb-0`);
}
console.log("chat launcher mobile padding: OK");
