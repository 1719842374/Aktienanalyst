/**
 * ATTRAKTIV-Mail bleibt aus. Keine Env-Änderung, kein Adapter.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-attraktiv-mail-flag.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const { attraktivEmailStatus, buildAttraktivMail } = await import("../shared/attraktiv-notify.ts");
const off = attraktivEmailStatus({});
assert.equal(off.send, false);
assert.equal(off.flag, false);
assert.match(off.reason, /kein Versand-Adapter/);
const on = attraktivEmailStatus({ ATTRAKTIV_EMAIL_ENABLED: "true" });
assert.equal(on.send, false);
assert.equal(on.flag, true);
const mail = buildAttraktivMail({ to: "a@b.c", ticker: "MSFT", status: "ATTRAKTIV", score: 4.058138, reason: "DCF", link: null });
assert.equal(mail.mail?.score, 4.058138);
assert.match(readFileSync("server/attraktiv-notify-route.ts", "utf8"), /sent: false/);
assert.equal(existsSync(".env"), false);
const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("attraktiv mail flag: OK");
