/**
 * Segmentliste: vorhandene YoY-/BERECHNET-Funktion und Untersegmente.
 * Kein Live-FMP und kein Live-LLM.
 */
import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
import {
  annotateMissingSegmentGrowth,
  annotationByName,
  snapshotsFromFmpRows,
} from "../shared/segment-growth-calc";
import { SegmentGrowthReadout } from "../client/src/components/sections/SegmentGrowthReadout";
import {
  childrenFromFmpRows,
  childrenFromKiPayload,
  resolveSegmentChildren,
} from "../shared/segment-children";
import { SegmentChildrenList } from "../client/src/components/sections/SegmentChildren";
import { loadSegmentChildren, registerSegmentGrowthRoute } from "../server/segment-growth-route";

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

const fact = html(React.createElement(SegmentGrowthReadout, { fact: 31.5, annotation: null }));
assert.match(fact, /\+31\.5%/);
assert.doesNotMatch(fact, /berechnet/);

const calculated = annotateMissingSegmentGrowth({
  annual: snapshotsFromFmpRows([
    { fiscalYear: "2024", date: "2024-06-30", data: { "Search advertising": 15, Server: 100 } },
    { fiscalYear: "2023", date: "2023-06-30", data: { "Search and news advertising": 14, Server: 90 } },
  ]),
});
const search = annotationByName(calculated, "Search advertising");
assert.equal(search?.basis, "berechnet");
const badge = html(React.createElement(SegmentGrowthReadout, { fact: null, annotation: search }));
assert.match(badge, /berechnet/);
assert.match(badge, /class="[^"]*text-emerald-500/);

const missing = annotateMissingSegmentGrowth({
  annual: snapshotsFromFmpRows([
    { fiscalYear: "2024", data: { Neu: 10, Alt: 20 } },
  ]),
});
const neu = annotationByName(missing, "Neu");
assert.equal(neu?.basis, "n/a");
assert.match(neu?.reason ?? "", /n\/a/);
const missingHtml = html(React.createElement(SegmentGrowthReadout, { fact: null, annotation: neu }));
assert.match(missingHtml, />n\/a</);

const renamed = annotateMissingSegmentGrowth({
  annual: snapshotsFromFmpRows([
    { fiscalYear: "2024", data: { "Windows and Devices": 172, Server: 100 } },
    { fiscalYear: "2023", data: { Windows: 100, Devices: 70, Server: 90 } },
  ]),
});
const win = annotationByName(renamed, "Windows and Devices");
assert.equal(win?.basis, "berechnet");
assert.equal(win?.method, "merge");

const fmpChildren = childrenFromFmpRows([
  {
    fiscalYear: "2024",
    reportedCurrency: "USD",
    data: { Server: { Azure: 80, "Server products": 49 } },
  },
], "Server");
assert.equal(fmpChildren.length, 2);
assert.equal(fmpChildren.every((row) => row.source === "FMP"), true);
assert.equal(childrenFromFmpRows([{ fiscalYear: "2024", data: { Server: 129 } }], "Server").length, 0);

const kiChildren = childrenFromKiPayload("Server", {
  children: [{ name: "Azure", shareOfParentPct: 60, source: "FMP" }],
});
assert.equal(kiChildren.length, 1);
assert.equal(kiChildren[0].source, "KI");
assert.notEqual(kiChildren[0].source, "FMP");

const fromFmp = resolveSegmentChildren("Server", fmpChildren, kiChildren);
assert.equal(fromFmp.children[0].source, "FMP");
const fromKi = resolveSegmentChildren("Server", [], kiChildren);
assert.equal(fromKi.children[0].source, "KI");
const fromNone = resolveSegmentChildren("Server", [], []);
assert.equal(fromNone.children.length, 0);
assert.match(fromNone.reason ?? "", /weder FMP noch KI/);

const kiHtml = html(React.createElement(SegmentChildrenList, { data: fromKi }));
assert.match(kiHtml, /data-testid="segment-child-source">KI/);
assert.doesNotMatch(kiHtml, /Override/);
assert.doesNotMatch(kiHtml, />FMP</);
const fmpHtml = html(React.createElement(SegmentChildrenList, { data: fromFmp }));
assert.match(fmpHtml, /data-testid="segment-child-source">FMP/);
const noneHtml = html(React.createElement(SegmentChildrenList, { data: fromNone }));
assert.match(noneHtml, /weder FMP noch KI/);

let kiCalls = 0;
const loadedFmp = await loadSegmentChildren("MSFT", "Server", "product", {
  fmpAvailable: () => true,
  raw: async () => [{ fiscalYear: "2024", data: { Server: { Azure: 80 } } }],
  ki: async () => {
    kiCalls += 1;
    return { children: [{ name: "Sollte nicht", shareOfParentPct: 10 }] };
  },
});
assert.equal(loadedFmp.children[0].source, "FMP");
assert.equal(kiCalls, 0);

const loadedKi = await loadSegmentChildren("MSFT", "Server", "product", {
  fmpAvailable: () => true,
  raw: async () => [{ fiscalYear: "2024", data: { Server: 129 } }],
  ki: async () => ({ children: [{ name: "Azure", shareOfParentPct: 62 }] }),
});
assert.equal(loadedKi.children[0].source, "KI");
assert.equal(loadedKi.children[0].name, "Azure");

const loadedNone = await loadSegmentChildren("MSFT", "Server", "product", {
  fmpAvailable: () => true,
  raw: async () => [{ fiscalYear: "2024", data: { Server: 129 } }],
  ki: async () => ({ children: [] }),
});
assert.equal(loadedNone.children.length, 0);
assert.match(loadedNone.reason ?? "", /n\/a/);

const app = express();
registerSegmentGrowthRoute(app, {
  fmpAvailable: () => true,
  raw: async () => [{ fiscalYear: "2024", data: { "United States": { Commercial: 100, Consumer: 70 } } }],
  ki: async () => null,
});
const server = app.listen(0);
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/segment-children/MSFT?parent=${encodeURIComponent("United States")}&kind=geographic`);
  assert.equal(response.status, 200);
  const body = await response.json() as { children: { name: string; source: string }[] };
  assert.equal(body.children.length, 2);
  assert.equal(body.children.every((row) => row.source === "FMP"), true);
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

console.log("segment children: OK");
