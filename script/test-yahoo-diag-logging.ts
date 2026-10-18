/**
 * Diagnose-Logging server/yahoo-fetcher.ts ([YAHOO-DIAG]).
 * Gemockte Yahoo-Antworten: leeres Cookie, getcrumb 429/HTML, Throw, quoteSummary 401/429/leeres result/Throw, Erfolg.
 * Prüft je Szenario: (a) Rückgabe deepEqual zur Version auf main 2b3bf0e6 (null bleibt null),
 * (b) pro Stufe genau eine [YAHOO-DIAG]-Zeile mit Ticker/Stufe/Status, Text ≤ 200 Zeichen,
 * (c) keine Cookie-/Crumb-Werte in irgendeiner Log-Ausgabe, (d) Rejected-Gründe geloggt.
 * Offline (globales fetch gemockt). Ausführen: npx tsx script/test-yahoo-diag-logging.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

process.env.YAHOO_MIN_INTERVAL_MS = "0";
const LEGACY_REF = "2b3bf0e6";
const LEGACY_PATH = "server/__yahoo-fetcher-legacy.test-tmp.ts";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

// Geheimnisse, die nie im Log stehen dürfen
const COOKIE_A3 = "d=AQABBSECRETCOOKIEVALUE1234&S=AQAAAsecretS567";
const COOKIE_B = "secretB0987654321zz";
const CRUMB = "Xy7SecretCrumb1";
const SECRETS = [COOKIE_A3, "AQABBSECRETCOOKIEVALUE1234", "AQAAAsecretS567", COOKIE_B, CRUMB, "abcdefghijklmnopqrstuvwxyz", "cc-session"];

type Scn = {
  name: string;
  cookie: "ok" | "empty" | "throw" | "consent";
  crumb?: { status: number; text: string } | "throw";
  qs?: { status: number; body: any } | "throw" | "badjson";
  chart: "ok" | "404";
  expectStages: Record<string, RegExp>; // Stufe → erwartete Zeile (genau eine)
  expectNull: boolean;
};

function fakeResp(status: number, opts: { setCookie?: string[]; text?: string; json?: any; badJson?: boolean; location?: string; redirectedTo?: string } = {}) {
  const text = opts.text ?? (opts.json !== undefined ? JSON.stringify(opts.json) : "");
  return {
    status, ok: status >= 200 && status < 300,
    redirected: !!opts.redirectedTo, url: opts.redirectedTo ?? "",
    headers: { getSetCookie: () => opts.setCookie ?? [], get: (h: string) => (h.toLowerCase() === "set-cookie" ? (opts.setCookie ?? []).join(", ") || null : h.toLowerCase() === "location" ? opts.location ?? null : null) },
    text: async () => text,
    json: async () => { if (opts.badJson) throw new SyntaxError("Unexpected token < in JSON"); return JSON.parse(text); },
  } as unknown as Response;
}

const day = 86400;
const now = Math.floor(Date.now() / 1000);
const CHART_OK = { chart: { result: [{ timestamp: [now - 2 * day, now - day], indicators: { quote: [{ open: [10, 11], high: [11, 12], low: [9, 10], close: [10.5, 11.5], volume: [100, 200] }] } }] } };
const QS_OK = { quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 101.5 }, currency: "EUR", marketCap: { raw: 5e10 }, longName: "Test AG", exchangeName: "XETRA" }, summaryDetail: { trailingPE: { raw: 20 } }, defaultKeyStatistics: { trailingEps: { raw: 5.07 } } }], error: null } };

function installFetch(s: Scn) {
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.startsWith("https://fc.yahoo.com")) {
      if (s.cookie === "throw") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      if (s.cookie === "consent") return fakeResp(302, { location: `https://consent.yahoo.com/v2/collectConsent?sessionId=3_cc-session_${CRUMB}` });
      return fakeResp(404, { setCookie: s.cookie === "ok" ? [`A3=${COOKIE_A3}; Expires=Mon, 18 Oct 2027 00:00:00 GMT; Domain=.yahoo.com; Secure`, `B=${COOKIE_B}; Path=/`] : [] });
    }
    if (url.includes("/v1/test/getcrumb")) {
      if (s.crumb === "throw") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      const c = s.crumb ?? { status: 200, text: CRUMB };
      return fakeResp(c.status, { text: c.text, redirectedTo: (c as any).redirectedTo });
    }
    if (url.includes("/v10/finance/quoteSummary/")) {
      if (s.qs === "throw") throw new TypeError(`fetch failed for ${url} with Cookie: A3=${COOKIE_A3}`);
      if (s.qs === "badjson") return fakeResp(200, { text: "<html>oops</html>", badJson: true });
      const q = s.qs ?? { status: 200, body: QS_OK };
      return fakeResp(q.status, { json: q.body });
    }
    if (url.includes("/v8/finance/chart/")) return s.chart === "ok" ? fakeResp(200, { json: CHART_OK }) : fakeResp(404, { text: "Not Found" });
    throw new Error(`unerwartete URL im Test: ${url}`);
  }) as typeof fetch;
}

const scenarios: Scn[] = [
  { name: "leeres Cookie (kein Set-Cookie), Chart 404", cookie: "empty", chart: "404", expectNull: true,
    expectStages: { cookie: /stage=cookie status=404 kein Set-Cookie/, quoteSummary: /stage=quoteSummary status=- übersprungen/, chart: /stage=chart status=- rejected: Yahoo chart API HTTP 404/ } },
  { name: "Consent-Wall: fc.yahoo.com 302 → consent.yahoo.com (Query mit Session nicht geloggt)", cookie: "consent", chart: "404", expectNull: true,
    expectStages: { cookie: /stage=cookie status=302 kein Set-Cookie von fc\.yahoo\.com → consent\.yahoo\.com\/v2\/collectConsent \[Consent-Wall\] → quoteSummary null$/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "Consent-Wall bei getcrumb (Redirect auf guce.yahoo.com, HTML)", cookie: "ok", crumb: { status: 200, text: "<!DOCTYPE html><title>Yahoo ist Teil der Yahoo Markenfamilie</title>", redirectedTo: "https://guce.yahoo.com/consent?gcrumb=abcdefghijklmnopqrstuvwxyz&lang=de-DE" } as any, chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /stage=crumb status=200 Crumb ungültig → guce\.yahoo\.com\/consent \[Consent-Wall\] \(Länge \d+\): <!DOCTYPE html>/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "fc.yahoo.com wirft", cookie: "throw", chart: "404", expectNull: true,
    expectStages: { cookie: /stage=cookie status=- Fehler: TypeError: fetch failed \(ECONNRESET\)/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "getcrumb 429", cookie: "ok", crumb: { status: 429, text: "Too Many Requests" }, chart: "404", expectNull: true,
    expectStages: { cookie: /stage=cookie status=404 ok \(2 Set-Cookie\)/, crumb: /stage=crumb status=429 getcrumb nicht ok \[429 Rate-Limit\] \(Länge 17\): Too Many Requests/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "getcrumb 401 mit crumb-förmigem Body", cookie: "ok", crumb: { status: 401, text: CRUMB }, chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /stage=crumb status=401 getcrumb nicht ok \[401 Auth: Cookie\/Crumb abgelehnt\] \(Länge 15\): \*\*\*/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "getcrumb 200 mit HTML statt Crumb", cookie: "ok", crumb: { status: 200, text: "<html><body>Will be right back</body></html>" }, chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /stage=crumb status=200 Crumb ungültig .*Will be right back/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "getcrumb Timeout (Throw)", cookie: "ok", crumb: "throw", chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /stage=crumb status=- Fehler: TimeoutError: The operation was aborted due to timeout/, quoteSummary: /übersprungen/, chart: /rejected/ } },
  { name: "quoteSummary 401 (Body nennt Crumb)", cookie: "ok", qs: { status: 401, body: { finance: { result: null, error: { code: "Unauthorized", description: `Invalid Crumb ${CRUMB}` } } } }, chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /stage=crumb status=200 ok \(Länge 15\)/, quoteSummary: /stage=quoteSummary status=401 nicht ok \[401 Auth: Cookie\/Crumb abgelehnt\]: .*Unauthorized.*Invalid Crumb \*\*\*/, chart: /rejected/ } },
  { name: "quoteSummary 429", cookie: "ok", qs: { status: 429, body: { error: "Too Many Requests" } }, chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /ok/, quoteSummary: /stage=quoteSummary status=429 nicht ok \[429 Rate-Limit\]: .*Too Many Requests/, chart: /rejected/ } },
  { name: "quoteSummary 200, result leer", cookie: "ok", qs: { status: 200, body: { quoteSummary: { result: [], error: { code: "Not Found", description: "Quote not found for ticker symbol: TEST.DE" } } } }, chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /ok/, quoteSummary: /stage=quoteSummary status=200 result leer: .*Quote not found/, chart: /rejected/ } },
  { name: "quoteSummary wirft (URL mit crumb + Cookie im Fehlertext)", cookie: "ok", qs: "throw", chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /ok/, quoteSummary: /stage=quoteSummary status=- rejected: TypeError: fetch failed for .*crumb=\*\*\*/, chart: /rejected/ } },
  { name: "quoteSummary kaputtes JSON (Reject)", cookie: "ok", qs: "badjson", chart: "404", expectNull: true,
    expectStages: { cookie: /ok/, crumb: /ok/, quoteSummary: /stage=quoteSummary status=- rejected: SyntaxError: Unexpected token/, chart: /rejected/ } },
  { name: "quoteSummary 401, Chart ok → Snapshot ohne Fundamentaldaten", cookie: "ok", qs: { status: 401, body: { finance: { error: { code: "Unauthorized" } } } }, chart: "ok", expectNull: false,
    expectStages: { cookie: /ok/, crumb: /ok/, quoteSummary: /status=401 nicht ok \[401 Auth/ } },
  { name: "leeres Cookie, Chart ok → Snapshot ohne Fundamentaldaten", cookie: "empty", chart: "ok", expectNull: false,
    expectStages: { cookie: /kein Set-Cookie/, quoteSummary: /übersprungen/ } },
  { name: "Erfolg", cookie: "ok", chart: "ok", expectNull: false,
    expectStages: { cookie: /ok \(2 Set-Cookie\)/, crumb: /ok \(Länge 15\)/, quoteSummary: /stage=quoteSummary status=200 ok$/ } },
];

// Legacy-Version (main) als Vergleich, temporär neben die neue Datei gelegt (gleiche relative Imports)
const legacySrc = execSync(`git show ${LEGACY_REF}:server/yahoo-fetcher.ts`, { encoding: "utf8" });
writeFileSync(LEGACY_PATH, legacySrc);
const realFetch = globalThis.fetch;
const realWarn = console.warn, realLog = console.log, realError = console.error;
try {
  const neu = await import("../server/yahoo-fetcher");
  const alt = await import("../server/__yahoo-fetcher-legacy.test-tmp");

  for (const s of scenarios) {
    const ticker = "TEST.DE";
    // Alt
    installFetch(s); alt.clearYahooCache();
    const altLines: string[] = [];
    console.warn = (...a: any[]) => { altLines.push(a.join(" ")); }; console.log = console.warn; console.error = console.warn;
    const altVal = await alt.getYahooSnapshot(ticker);
    // Neu
    installFetch(s); neu.clearYahooCache();
    const lines: string[] = [];
    console.warn = (...a: any[]) => { lines.push(a.join(" ")); }; console.log = console.warn; console.error = console.warn;
    const neuVal = await neu.getYahooSnapshot(ticker);
    console.warn = realWarn; console.log = realLog; console.error = realError;

    // (a) Rückgabe unverändert — außer currency/name/exchange (Ersatz aus Chart-Meta #264 bzw. Börsen-Suffix außerhalb .DE).
    // Die prüfen script/test-dcf-fx.ts und die #264-Tests.
    const dcfFx = (v: any) => { if (!v) return v; const { currency: _c, name: _n, exchange: _e, currencySource: _s, ...rest } = v; return rest; };
    assert.deepEqual(dcfFx(neuVal), dcfFx(altVal), `${s.name}: Rückgabe weicht ab`);
    if (neuVal && altVal?.currency) assert.equal(neuVal.currency, altVal.currency, `${s.name}: Währung aus quoteSummary weicht ab`);
    // Stabschef 18.10.2026 (4): .DE ohne Chart-Meta (Mock-Chart hat keine meta) → Währung null wie #264, kein Suffix.
    if (neuVal && !altVal?.currency) assert.equal(neuVal.currency, null, `${s.name}: .DE ohne Meta → Währung null erwartet`);
    assert.equal(neuVal === null, s.expectNull, `${s.name}: null erwartet=${s.expectNull}`);
    if (!s.expectNull) assert.equal(neuVal!.fundamentalsAvailable, s.name === "Erfolg");

    // (b) genau eine Zeile je Stufe, Format
    const diag = lines.filter((l) => l.startsWith("[YAHOO-DIAG] "));
    assert.equal(diag.length, lines.length, `${s.name}: andere Log-Zeilen: ${lines.filter((l) => !l.startsWith("[YAHOO-DIAG]")).join(" | ")}`);
    for (const l of diag) {
      assert.match(l, /^\[YAHOO-DIAG\] TEST\.DE stage=(cookie|crumb|quoteSummary|chart) status=(\d{3}|-) /);
      const text = l.replace(/^\[YAHOO-DIAG\] \S+ stage=\S+ status=\S+ /, "");
      assert.ok(text.length <= 200, `${s.name}: Text > 200`);
    }
    const stages = diag.map((l) => /stage=(\S+)/.exec(l)![1]);
    assert.deepEqual([...stages].sort(), Object.keys(s.expectStages).sort(), `${s.name}: Stufen ${stages.join(",")}`);
    for (const [st, re] of Object.entries(s.expectStages)) {
      const hit = diag.filter((l) => l.includes(`stage=${st} `));
      assert.equal(hit.length, 1, `${s.name}: Stufe ${st} ${hit.length}×`);
      assert.match(hit[0], re, `${s.name}: ${hit[0]}`);
    }
    // (c) keine Geheimnisse
    for (const l of [...lines, ...altLines.filter(() => false)]) for (const sec of SECRETS) assert.ok(!l.includes(sec), `${s.name}: Geheimnis im Log: ${l}`);
    realLog(`     ${s.name}: ${diag.join("  ‖  ")}`);
  }
  ok(`${scenarios.length} Szenarien: Rückgabe deepEqual main ${LEGACY_REF} (null bleibt null)`);
  ok("pro Stufe genau eine [YAHOO-DIAG]-Zeile mit Ticker, Stufe, HTTP-Status, Text ≤ 200; Rejected-Gründe (quoteSummary/chart) geloggt");
  ok("keine Cookie-/Crumb-Werte im Log (auch nicht aus Fehlertexten/Response-Bodies)");

  // Maskierung direkt
  const m = neu.maskYahooSecrets(`url ?crumb=${CRUMB}&x=1 token=ABCDEFGHIJKLMNOPQRST raw ${CRUMB} Cookie: A3=${COOKIE_A3}; B=${COOKIE_B}`, [CRUMB, `A3=${COOKIE_A3}; B=${COOKIE_B}`]);
  for (const sec of SECRETS) assert.ok(!m.includes(sec), m);
  assert.ok(m.includes("crumb=***") && m.includes("token=***"));
  ok("maskYahooSecrets: bekannte Werte, crumb=, Cookie:, lange Token → ***");

  // Text-Kürzung auf 200
  installFetch({ name: "lang", cookie: "ok", qs: { status: 503, body: { msg: "x ".repeat(500) } }, chart: "404", expectStages: {}, expectNull: true });
  neu.clearYahooCache();
  const long: string[] = [];
  console.warn = (...a: any[]) => { long.push(a.join(" ")); };
  await neu.getYahooSnapshot("LONG.DE");
  console.warn = realWarn;
  const qsLine = long.find((l) => l.includes("stage=quoteSummary"))!;
  assert.ok(qsLine.replace(/^\[YAHOO-DIAG\] \S+ stage=\S+ status=\S+ /, "").length <= 200);
  ok("Fehlertext auf 200 Zeichen gekürzt");
} finally {
  globalThis.fetch = realFetch;
  console.warn = realWarn; console.log = realLog; console.error = realError;
  if (existsSync(LEGACY_PATH)) unlinkSync(LEGACY_PATH);
}
console.log(`\n${n} Checks grün`);
