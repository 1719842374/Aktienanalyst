/**
 * KI-Chatbot-Widget (WORK_DASHBOARD_FEATURES_2026-10.md §4): Fenster-Geometrie, localStorage-Form,
 * statische Prüfung der Fenster-Controls und Einbindung nur im Aktien-Dashboard.
 * Ausführen: npx tsx script/test-chat-widget.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHAT_WINDOW_MIN, chatWindowStorageKey, clampChatWindow, defaultChatWindow, moveChatWindow, parseChatWindow,
  resizeChatWindow, serializeChatWindow,
} from "../client/src/lib/chatWindowGeometry";

let n = 0;
const ok = (s: string) => { n++; console.log(`  ✅ ${s}`); };

for (const [vw, vh] of [[375, 812], [1440, 900]]) {
  const d = defaultChatWindow(vw, vh);
  assert.ok(d.x >= 0 && d.x + d.w <= vw && d.y >= 0 && d.y + d.h <= vh, `${vw}`);
  assert.ok(d.x + d.w >= vw - 20, "unten rechts");
  ok(`Standard ${vw}×${vh}: unten rechts, im Viewport (${d.w}×${d.h})`);
}
const vw = 1440, vh = 900;
const s0 = { ...defaultChatWindow(vw, vh), open: true };
const m = moveChatWindow(s0, -5000, -5000, vw, vh); assert.equal(m.x, 0); assert.equal(m.y, 0);
const m2 = moveChatWindow(s0, 5000, 5000, vw, vh); assert.equal(m2.x, vw - s0.w); assert.equal(m2.y, vh - 40);
ok("Verschieben: Fenster bleibt im Viewport, Titelleiste erreichbar");
const r = resizeChatWindow({ ...s0, x: 100, y: 100 }, "se", 120, 80, vw, vh); assert.equal(r.w, s0.w + 120); assert.equal(r.h, s0.h + 80);
const rmin = resizeChatWindow(s0, "se", -5000, -5000, vw, vh); assert.equal(rmin.w, CHAT_WINDOW_MIN.w); assert.equal(rmin.h, CHAT_WINDOW_MIN.h);
const rw = resizeChatWindow({ ...s0, x: 500 }, "w", -100, 0, vw, vh); assert.equal(rw.x, 400); assert.equal(rw.w, s0.w + 100); assert.equal(rw.x + rw.w, 500 + s0.w);
ok("Größe ändern: Ecke/Rand, Minimum, linke Kante hält rechte Kante fest");
const stored = serializeChatWindow({ ...r, minimized: true });
const back = parseChatWindow(stored, vw, vh); assert.deepEqual(back, { ...r, minimized: true });
ok("localStorage: Position/Größe/Zustand Rundreise identisch");
assert.deepEqual(parseChatWindow("kaputt", vw, vh), defaultChatWindow(vw, vh));
assert.deepEqual(parseChatWindow(null, vw, vh), defaultChatWindow(vw, vh));
const shrunk = parseChatWindow(serializeChatWindow({ ...s0, x: 1200, w: 600 }), 375, 812); assert.ok(shrunk.x + shrunk.w <= 375);
ok("kaputter/fehlender Speicher → Standard; großer Speicherstand auf 375 px eingepasst");
assert.equal(chatWindowStorageKey("stock"), "chatWidget:v1:stock"); assert.notEqual(chatWindowStorageKey("btc"), chatWindowStorageKey("stock"));
ok("Speicherschlüssel je Dashboard getrennt");
assert.deepEqual(clampChatWindow(s0, vw, vh), s0); ok("clamp idempotent");

const w = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
for (const id of ["chat-back", "chat-minimize", "chat-maximize", "chat-close", "chat-resize-se", "chat-titlebar", "chat-section-select", "chat-bind-visible"]) assert.ok(w.includes(`"${id}"`), id);
assert.ok(w.includes("Was sollen wir erkunden?"));
assert.ok(!/Geben Sie @|Perplexity/.test(w)); ok("Fenster-Controls, Resize-Griff, Sektionsbindung vorhanden; keine Mockup-Fremdtexte");
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
assert.ok(dash.includes("<ChatWidget") && dash.includes('dashboard="stock"') && dash.includes("buildStockChatContext(data)"));
for (const f of ["client/src/pages/Dashboard.tsx", "client/src/pages/BTCDashboard.tsx", "client/src/pages/GoldDashboard.tsx", "client/src/pages/RecessionDashboard.tsx"]) assert.ok(readFileSync(f, "utf8").includes("<ChatWidget"), f);
ok("in allen vier Dashboards eingehängt (PR 2: BTC/Gold/Rezession)");
console.log(`\n${n} Checks grün.`);
