/**
 * GET /api/regulatory/cached/:ticker — Cache-Miss ist kein Fehler.
 * Zwei Mounts (Sektion 13 Moat und Sektion 14 PESTEL, je über PolicyContextPanel)
 * dürfen nur einen Request auslösen.
 *
 * Auf main 38217e61 rot: Miss = 404, zwei Instanzen = zwei Requests.
 * Ausführen: npx tsx script/test-regulatory-cached-404.ts
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import * as esbuild from "esbuild";
import { persistAssessment } from "../server/regulatory-risks";
import { registerRegulatoryRisksRoute } from "../server/regulatory-risks-route";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core") as typeof import("playwright-core");

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((p) => {
  try { readFileSync(p); return true; } catch { return false; }
});

function round6(n: number): string {
  return n.toFixed(6);
}

async function main() {
  console.log("\nUrsache (Struktur, kein StrictMode)");
  const mainTsx = readFileSync("client/src/main.tsx", "utf8");
  const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
  const moat = readFileSync("client/src/components/sections/MoatPorterSection.tsx", "utf8");
  const pestel = readFileSync("client/src/components/sections/PestelSection.tsx", "utf8");
  const policy = readFileSync("client/src/components/sections/PolicyContextPanel.tsx", "utf8");
  check("main.tsx rendert <App /> ohne StrictMode", !mainTsx.includes("StrictMode"));
  check("Dashboard mountet Moat (13) und PESTEL (14) zusammen", dash.includes("<MoatPorterSection") && dash.includes("<PestelSection"));
  check("beide Sektionen rendern PolicyContextPanel", moat.includes("<PolicyContextPanel") && pestel.includes("<PolicyContextPanel"));
  check("PolicyContextPanel rendert RegulatoryPestelRisks", policy.includes("<RegulatoryPestelRisks"));

  console.log("\nRoute: Miss 200, Hit unverändert");
  const app = express();
  registerRegulatoryRisksRoute(app);
  const dir = mkdtempSync(path.join(tmpdir(), "reg404-"));
  writeFileSync(path.join(dir, "entry.tsx"), `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
    import { RegulatoryPestelRisks } from ${JSON.stringify(path.join(process.cwd(), "client/src/components/sections/RegulatoryPestelRisks.tsx"))};
    const ticker = new URLSearchParams(location.search).get("ticker") || "MSFT";
    const data = { ticker } as any;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
    createRoot(document.getElementById("root")!).render(
      React.createElement(QueryClientProvider, { client },
        React.createElement(React.Fragment, null,
          React.createElement(RegulatoryPestelRisks, { data }),
          React.createElement(RegulatoryPestelRisks, { data }),
        ),
      ),
    );
  `);
  await esbuild.build({
    absWorkingDir: process.cwd(),
    entryPoints: [path.join(dir, "entry.tsx")],
    bundle: true,
    format: "iife",
    outfile: path.join(dir, "app.js"),
    jsx: "automatic",
    platform: "browser",
    nodePaths: [path.join(process.cwd(), "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  app.get("/favicon.ico", (_req, res) => { res.status(204).end(); });
  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  app.get("/app.js", (_req, res) => {
    res.type("js").send(readFileSync(path.join(dir, "app.js")));
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  async function getJson(ticker: string) {
    const r = await fetch(`${base}/api/regulatory/cached/${encodeURIComponent(ticker)}`);
    const body = await r.json();
    return { status: r.status, body };
  }

  for (const ticker of ["MSFT", "SAP.DE", "SHEL.L"]) {
    const miss = await getJson(ticker);
    check(`${ticker} Miss HTTP 200`, miss.status === 200, `status ${miss.status}`);
    check(`${ticker} Miss { cached:false, ticker }`, miss.body?.cached === false && miss.body?.ticker === ticker, JSON.stringify(miss.body));
    check(`${ticker} Miss ohne error-Feld`, miss.body?.error == null, JSON.stringify(miss.body));
  }

  const marker = "REG404-POLITICAL-MARKER";
  persistAssessment({
    ticker: "REG404T",
    exposures: [],
    pestelRisks: { political: [marker], legal: [], badgeOnly: [] },
    gate: null,
  });
  const hit = await getJson("REG404T");
  check("Hit HTTP 200", hit.status === 200, `status ${hit.status}`);
  check("Hit liefert pestelRisks, nicht cached:false", hit.body?.cached !== false && hit.body?.pestelRisks?.political?.[0] === marker, JSON.stringify(hit.body?.pestelRisks ?? hit.body));

  console.log("\nZwei Mounts → genau 1 Request, Konsole ohne 404");
  if (!CHROME) {
    failed++;
    console.error("  ❌ Chrome fehlt — Browser-Dedupe nicht geprüft");
  } else {
    const browser = await chromium.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();

    async function load(ticker: string, waitMs: number) {
      const seen: { url: string; status: number }[] = [];
      const onResponse = (res: { url: () => string; status: () => number }) => {
        if (res.url().includes("/api/regulatory/cached/")) seen.push({ url: res.url(), status: res.status() });
      };
      page.on("response", onResponse);
      const console404: string[] = [];
      const onConsole = (m: { type: () => string; text: () => string }) => {
        const t = m.text();
        if (m.type() === "error" && /404|regulatory\/cached/.test(t)) console404.push(t);
      };
      page.on("console", onConsole);
      await page.goto(`${base}/?ticker=${encodeURIComponent(ticker)}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(waitMs);
      page.off("response", onResponse);
      page.off("console", onConsole);
      return { seen, console404, text: await page.locator("#root").innerText() };
    }

    const fresh = await load("MSFT", 9000);
    check("MSFT frisch: genau 1 Request", fresh.seen.length === 1, JSON.stringify(fresh.seen));
    check("MSFT frisch: kein 404", fresh.seen.every((s) => s.status === 200) && fresh.console404.length === 0, `req ${JSON.stringify(fresh.seen)} console ${fresh.console404.join(" | ")}`);
    check("MSFT frisch: Panel bleibt leer", !fresh.text.includes("PESTEL-Risks") && !fresh.text.includes(marker), JSON.stringify(fresh.text));

    const second = await load("REG404T", 500);
    check("zweiter Lauf Cache voll: genau 1 Request, HTTP 200", second.seen.length === 1 && second.seen[0]?.status === 200, JSON.stringify(second.seen));
    check("zweiter Lauf: Political-Zeile sichtbar", second.text.includes(marker), JSON.stringify(second.text));

    for (const ticker of ["SAP.DE", "SHEL.L"]) {
      const r = await load(ticker, 600);
      check(`${ticker}: genau 1 Request, kein 404`, r.seen.length === 1 && r.seen[0]?.status === 200 && r.console404.length === 0, JSON.stringify(r.seen));
      check(`${ticker}: ohne Cache kein Panel`, !r.text.includes("PESTEL-Risks"), JSON.stringify(r.text));
    }

    await browser.close();
  }

  console.log("\nScore-Pfad unberührt (Anzeige-Route)");
  const analyze = readFileSync("server/analyze-route.ts", "utf8");
  const routeSrc = readFileSync("server/regulatory-risks-route.ts", "utf8");
  check("analyze-route liest nicht /api/regulatory/cached", !analyze.includes("/api/regulatory/cached"));
  check("analyze-route liest nicht readPersistedAssessment", !analyze.includes("readPersistedAssessment"));
  check("cached-Route importiert kein Scoring", !/scoring-integration|bias-fixes|buildScoring/.test(routeSrc));
  const fix = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8"));
  const expect: Record<string, string> = {
    VWAGY: "4.735718",
    SAP: "5.174758",
    MSFT: "4.058138",
  };
  for (const [ticker, want] of Object.entries(expect)) {
    const got = round6(fix.expectOldHead[ticker].overallScore);
    check(`${ticker === "VWAGY" ? "VOW3 (VWAGY)" : ticker} overallScore ${want}`, got === want, got);
  }

  rmSync(path.join(process.cwd(), ".cache", "regulatory", "REG404T.json"), { force: true });
  rmSync(dir, { recursive: true, force: true });
  server.close();

  console.log(failed === 0 ? "\nAlle Regulatory-Cached-404-Checks grün" : `\n${failed} Check(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
