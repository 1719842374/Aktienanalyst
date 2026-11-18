/**
 * Aktienanalyse: ab lg haben alle Sektionen die Breite der Main-Spalte
 * (bisher nur Sektion 12 via Ausbruch aus max-w-5xl).
 * Unter lg bleibt die Spalte die volle Main-Breite, Padding p-3 sm:p-4.
 * Run: npx tsx script/test-dashboard-column-width.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");

const columnAt = dash.indexOf('data-testid="analysis-column"');
assert.ok(columnAt > 0, "Analyse-Spalte hat data-testid=analysis-column");

const columnOpen = dash.slice(dash.lastIndexOf("<div", columnAt), dash.indexOf(">", columnAt) + 1);
assert.match(
  columnOpen,
  /className="relative p-3 sm:p-4 space-y-3"/,
  "Analyse-Spalte füllt die Main-Spalte, ohne max-w-5xl",
);
assert.doesNotMatch(columnOpen, /max-w-5xl|mx-auto|100vw|w-full|min-w-0/);

const columnBody = dash.slice(columnAt, dash.indexOf("<PodcastTranscript"));
assert.match(columnBody, /<ExecSummaryCard /);
assert.match(columnBody, /<YahooNoValuationCard /);
assert.match(columnBody, /<SectionErrorBoundary /);
assert.equal(
  (columnBody.match(/setSectionRef\(/g) ?? []).length,
  20,
  "Sektionen 1–20 liegen in derselben Spalte",
);

const overlayAt = dash.indexOf("Loading overlay when re-analyzing");
assert.ok(overlayAt > columnAt && overlayAt < columnAt + 800);
const overlay = dash.slice(overlayAt, overlayAt + 500);
assert.match(overlay, /-mx-3 sm:-mx-4/, "Lade-Overlay hebt nur das Spalten-Padding auf");
assert.doesNotMatch(overlay, /100vw|lg:w-|lg:ml-|lg:max-w-none/);

const wideAt = dash.indexOf('data-testid="section-12-wide"');
assert.ok(wideAt > columnAt, "section-12-wide bleibt erhalten");
const wideOpen = dash.slice(dash.lastIndexOf("<div", wideAt), dash.indexOf(">", wideAt) + 1);
assert.match(wideOpen, /className="min-w-0 max-w-full"/);
assert.doesNotMatch(wideOpen, /lg:w-|lg:ml-|lg:mr-|lg:max-w-none|100vw/);
assert.doesNotMatch(dash, /lg:w-\[calc\(100vw-13rem-2rem\)\]/);
assert.doesNotMatch(dash, /übrigen Sektionen bleiben max-w-5xl/);

const etfAt = dash.indexOf("ETF/Index – nicht im Aktien-Dashboard");
assert.ok(etfAt > 0 && etfAt < columnAt, "ETF-Hinweis bleibt vor der Analyse-Spalte");
const etfRegion = dash.slice(dash.indexOf("data && isEtfOrFund(data) ? ("), etfAt);
assert.match(etfRegion, /className="max-w-5xl mx-auto p-3 sm:p-4"/, "ETF-Hinweis ist keine Analyse-Sektion");
assert.equal(dash.split("max-w-5xl").length - 1, 1, "max-w-5xl nur noch am ETF-Hinweis");

console.log("test-dashboard-column-width: OK");
