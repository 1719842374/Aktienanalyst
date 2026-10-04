/**
 * Offen_WORK_RECESSION_2008_DRIVERS_LLM.md
 * Target + z matrix. callLLMJson only when set A is not empty.
 * A missing series stays empty. No invented driver score.
 * Run: npx tsx script/test-recession-drivers.ts
 */
import { readFileSync } from "node:fs";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";
import {
  DRIVER_CACHE_MS,
  DRIVER_SERIES,
  DRIVER_SYSTEM_PROMPT,
  INFLATION_TARGET_PCT,
  NEWS_CACHE_MS,
  Z_CLIP,
  Z_EPSILON,
  assessDrivers,
  buildDriverUserPrompt,
  driverFazitSections,
  fetchDriverObservations,
  headlinesWithinDays,
  lowTercileCutoff,
  measureDrivers,
  newsQueryFor,
  parseFredCsv,
  zScore,
  type DriverCache,
  type DriverLlm,
} from "../server/recession-drivers";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = new Date("2026-02-15T00:00:00.000Z");
const FORBIDDEN = ["Hormuz", "Dünger", "Private-Credit", "Private Credit"];

function monthly(start: string, values: number[]): { date: string; value: number }[] {
  const d = new Date(`${start}T00:00:00Z`);
  return values.map(value => {
    const date = d.toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return { date, value };
  });
}

function daily(start: string, days: number, valueAt: (i: number) => number): { date: string; value: number }[] {
  const d = new Date(`${start}T00:00:00Z`);
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < days; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: valueAt(i) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function coreCpi(yoyPct: number): { date: string; value: number }[] {
  const values: number[] = [];
  for (let i = 0; i < 134; i++) values.push(100 * Math.pow(1 + yoyPct / 100, i / 12));
  return monthly("2015-01-01", values);
}

function flatLevel(value: number, last = value): { date: string; value: number }[] {
  const values = Array.from({ length: 122 }, () => value);
  values[values.length - 1] = last;
  return monthly("2016-01-01", values);
}

console.log("\n=== z = (x - μ) / (σ + ε), clip |z| = 2, inflation target 2% ===");
{
  check("inflation target is the 2% parameter", INFLATION_TARGET_PCT === 2);
  check("clip constant is 2", Z_CLIP === 2);
  const sample = [0, 2];
  const x = 1 + 1.4 * (1 + Z_EPSILON);
  const z = zScore(x, sample);
  check("constructed z is 1.4", z != null && Math.abs(z - 1.4) < 1e-9, String(z));
  check("z clips at 2", zScore(100, sample) === Z_CLIP);
  check("z clips at -2", zScore(-100, sample) === -Z_CLIP);
  check("a one-point sample is empty", zScore(1, [1]) === null);
  check("low-rate tercile cutoff is the top of the bottom third", lowTercileCutoff([0, 1, 2, 3, 4, 5, 6, 7, 8]) === 2);
  check(
    "whitelist is the spec series",
    DRIVER_SERIES.join(" ") === "DCOILWTICO DCOILBRENTEU PNGASUSUSDM WPU065 PWHEAMTUSDM T10YIE DGS10 DFII10 DFF WALCL WTREGEN BAA10Y T10Y2Y DRTSCIS PCEPILFE CPILFESL",
  );
}

console.log("\n=== CPI 2.1%, every |z| < 1 → 0 calls, UI unauffällig ===");
{
  let calls = 0;
  let newsFetches = 0;
  const llm: DriverLlm = async () => {
    calls++;
    return { data: { items: [] } };
  };
  const observations = {
    CPILFESL: coreCpi(2.1),
    DCOILWTICO: flatLevel(70),
    BAA10Y: flatLevel(1.7),
    WPU065: flatLevel(200),
    WTREGEN: flatLevel(300),
    PCEPILFE: null,
  };
  const measured = measureDrivers(observations, NOW);
  const cpi = measured.find(s => s.id === "CPILFESL");
  const wti = measured.find(s => s.id === "DCOILWTICO");
  check("CPI YoY is about 2.1 and above the 2% target", cpi != null && Math.abs(cpi.value - 2.1) < 0.05 && cpi.aboveTarget === true, JSON.stringify(cpi));
  check("CPI |z| stays under 1", cpi != null && Math.abs(cpi.z) < 1, String(cpi?.z));
  check("WTI |z| stays under 1", wti != null && Math.abs(wti.z) < 1, String(wti?.z));
  check("no measured series carries a score", measured.every(s => !("rawScore" in s) && !("score" in s)));
  const result = await assessDrivers({
    observations,
    now: NOW,
    newsPack: [{ title: "Hormuz blockade", pubDate: "2026-02-14T00:00:00.000Z" }],
    callLLMJson: llm,
    fetchNews: async () => {
      newsFetches++;
      return [];
    },
  });
  check("zero LLM calls", result.llmCalls === 0 && calls === 0, `llmCalls=${result.llmCalls} calls=${calls}`);
  check("news is not fetched when A is empty", newsFetches === 0);
  check("UI status is unauffällig", result.status === "unauffällig");
  check("one number line for the missed inflation target", result.lines.some(l => l.includes("CPILFESL") && l.includes("2,1") && l.includes("2 %")), result.lines.join(" | "));
  check("the Hormuz headline is not a driver", result.cards.length === 0 && !JSON.stringify(result).includes("Hormuz"));
  const sections = driverFazitSections(result);
  check("fazit card title is unauffällig", sections.length === 1 && sections[0].title === "unauffällig", JSON.stringify(sections));
}

console.log("\n=== CPI 2.1% + WTI z = 1.4 → one call, reason only from the pack ===");
{
  const quote = "Refinery outage lifts WTI";
  let calls = 0;
  let seen: { prompt: string; systemPrompt?: string; temperature?: number } | null = null;
  const llm: DriverLlm = async opts => {
    calls++;
    seen = opts;
    return {
      data: {
        items: [{
          id: "DCOILWTICO",
          order1: "Raffinerie fällt aus",
          order2: "CPILFESL folgt der Energie",
          order3: "",
          shareClaim: quote,
          score: 9,
        }],
      },
    };
  };
  const observations = {
    CPILFESL: coreCpi(2.1),
    DCOILWTICO: flatLevel(70, 70 + 1.4 * Z_EPSILON),
  };
  const wti = measureDrivers(observations, NOW).find(s => s.id === "DCOILWTICO");
  check("WTI z is 1.4", wti != null && Math.abs(wti.z - 1.4) < 1e-6, String(wti?.z));
  check("WTI is in A", wti?.inA === true);
  const result = await assessDrivers({
    observations,
    now: NOW,
    newsPack: [{ title: quote, pubDate: "2026-02-14T00:00:00.000Z" }],
    callLLMJson: llm,
  });
  check("exactly one call", result.llmCalls === 1 && calls === 1, `llmCalls=${result.llmCalls}`);
  check("temperature is 0.2", seen?.temperature === 0.2, String(seen?.temperature));
  check("system prompt is the spec text", seen?.systemPrompt === DRIVER_SYSTEM_PROMPT);
  const blob = `${seen?.systemPrompt ?? ""}\n${seen?.prompt ?? ""}`;
  check("prompt has no mandatory Hormuz, Dünger, or Private Credit", FORBIDDEN.every(w => !blob.includes(w)), blob);
  check("snap is only set A", seen != null && seen.prompt.includes("DCOILWTICO") && !seen.prompt.includes("CPILFESL"), seen?.prompt);
  check("reason is the pack quote", result.cards.length === 1 && result.cards[0].reason === quote, JSON.stringify(result.cards));
  check("a series outside A is not in the card", !result.cards[0].text.includes("CPILFESL"));
  check("the card does not invent a score", !("score" in result.cards[0]) && !result.cards[0].text.includes("score"));
  check("UI is a driver card, not unauffällig", result.status === "drivers" && driverFazitSections(result)[0].title.startsWith("Driver"));
}

console.log("\n=== headline outside the pack does not become the reason ===");
{
  const llm: DriverLlm = async () => ({
    data: { items: [{ id: "DCOILWTICO", order1: "Hormuz blockade", shareClaim: "Hormuz blockade" }] },
  });
  const result = await assessDrivers({
    observations: { DCOILWTICO: flatLevel(70, 70 + 1.4 * Z_EPSILON) },
    now: NOW,
    newsPack: [{ title: "Refinery outage lifts WTI", pubDate: "2026-02-14T00:00:00.000Z" }],
    callLLMJson: llm,
  });
  check("uncited headline stays offen", result.cards[0]?.reason === "auffällig, Grund offen" && result.cards[0]?.text === "auffällig, Grund offen", result.cards[0]?.text);
  check("the card does not copy the uncited headline", !JSON.stringify(result.cards).includes("Hormuz"));
}

console.log("\n=== Hormuz headline + WTI z = 0.2 → no driver ===");
{
  let calls = 0;
  const result = await assessDrivers({
    observations: { DCOILWTICO: flatLevel(70, 70 + 0.2 * Z_EPSILON) },
    now: NOW,
    newsPack: [{ title: "Hormuz blockade cuts oil", pubDate: "2026-02-14T00:00:00.000Z" }],
    callLLMJson: async () => {
      calls++;
      return { data: { items: [] } };
    },
  });
  const wti = measureDrivers({ DCOILWTICO: flatLevel(70, 70 + 0.2 * Z_EPSILON) }, NOW).find(s => s.id === "DCOILWTICO");
  check("WTI z is 0.2", wti != null && Math.abs(wti.z - 0.2) < 1e-6, String(wti?.z));
  check("no call and no driver card", calls === 0 && result.llmCalls === 0 && result.cards.length === 0 && result.status === "unauffällig");
}

console.log("\n=== a missing series stays empty; stale news is not a quote ===");
{
  const measured = measureDrivers({ CPILFESL: [], DCOILWTICO: null, BAA10Y: undefined, NOT_A_SERIES: flatLevel(1) }, NOW);
  check("missing and unknown series are absent", measured.length === 0);
  const empty = await assessDrivers({
    observations: { CPILFESL: [], DCOILWTICO: null },
    now: NOW,
    callLLMJson: async () => {
      throw new Error("should not be called");
    },
  });
  check("nothing measured stays empty and does not say unauffällig", empty.status === "empty" && empty.cards.length === 0 && empty.llmCalls === 0);
  check("html is not a FRED series", parseFredCsv("<html><body>nope</body></html>").length === 0);
  const fetched = await fetchDriverObservations(NOW, async url => {
    if (String(url).includes("DCOILWTICO")) throw new Error("down");
    if (String(url).includes("CPILFESL")) {
      return { ok: true, text: async () => "DATE,CPILFESL\n2024-01-01,100\n" };
    }
    return { ok: false, text: async () => "" };
  });
  check("a failed series is absent", fetched.DCOILWTICO == null);
  check("a short print is stored but not scored", fetched.CPILFESL?.length === 1 && measureDrivers({ CPILFESL: fetched.CPILFESL }, NOW).length === 0);
  const old = headlinesWithinDays([{ title: "old", pubDate: "2025-12-01T00:00:00.000Z" }], NOW, 7);
  check("a headline older than 7 days drops out", old.length === 0);
  const undated = headlinesWithinDays([{ title: "no date" }], NOW, 7);
  check("an undated headline drops out", undated.length === 0);
}

console.log("\n=== DFF is the low-rate tercile plus z of the 90-day change; no fertilizer path ===");
{
  const calm = daily("2016-02-16", 3652, () => 0.25);
  const calmDff = measureDrivers({ DFF: calm }, NOW).find(s => s.id === "DFF");
  check("a flat funds rate is not in A", calmDff != null && calmDff.inA === false && Math.abs(calmDff.z) < 1, JSON.stringify(calmDff));

  const jumped = daily("2016-02-16", 3652, i => (i === 3651 ? 5 : 1));
  const hot = measureDrivers({ DFF: jumped }, NOW).find(s => s.id === "DFF");
  check("a 90-day funds jump is in A", hot != null && hot.inA === true && hot.aboveTarget === true, JSON.stringify(hot));

  let prompt = "";
  await assessDrivers({
    observations: { WPU065: flatLevel(200, 200 + 1.4 * Z_EPSILON) },
    now: NOW,
    newsPack: [{ title: "Chemical prices jump", pubDate: "2026-02-14T00:00:00.000Z" }],
    callLLMJson: async opts => {
      prompt = opts.prompt;
      return { data: { items: [{ id: "WPU065", shareClaim: "Chemical prices jump" }] } };
    },
  });
  check("chemicals use the same matrix and the prompt has no Dünger", prompt.includes("WPU065") && !prompt.includes("Dünger") && !DRIVER_SYSTEM_PROMPT.includes("Dünger"));
  const q = newsQueryFor(["DCOILWTICO", "WPU065"]);
  check("news query is 7 days and names no event", q.includes("when:7d") && FORBIDDEN.every(w => !q.includes(w)), q);
  const built = buildDriverUserPrompt(
    [{ id: "DCOILWTICO", asOf: "2026-02-01", value: 70, z: 1.4, aboveTarget: false, inA: true, label: "unter Ziel, aber unüblich", line: null }],
    [{ title: "Refinery outage lifts WTI" }],
  );
  check("user prompt carries snap and the pack only", built.includes("SNAP:") && built.includes("NEWS_PACK:") && !built.includes("1.4") && !built.includes("rawScore"));
}

console.log("\n=== cache: 7 days for drivers, 24h for news, trigger is a FRED change ===");
{
  check("driver cache is 7 days", DRIVER_CACHE_MS === 7 * 24 * 60 * 60 * 1000);
  check("news cache is 24 hours", NEWS_CACHE_MS === 24 * 60 * 60 * 1000);
  const cache: DriverCache = { drivers: null, news: null };
  let calls = 0;
  let newsFetches = 0;
  const observations = { DCOILWTICO: flatLevel(70, 70 + 1.4 * Z_EPSILON) };
  const run = (now: Date, obs = observations) => assessDrivers({
    observations: obs,
    now,
    cache,
    fetchNews: async ids => {
      newsFetches++;
      check("news fetch receives only A", ids.join(",") === "DCOILWTICO");
      return [{ title: "Refinery outage lifts WTI", pubDate: now.toISOString() }];
    },
    callLLMJson: async () => {
      calls++;
      return { data: { items: [{ id: "DCOILWTICO", shareClaim: "Refinery outage lifts WTI" }] } };
    },
  });
  await run(new Date("2026-02-15T00:00:00.000Z"));
  await run(new Date("2026-02-15T06:00:00.000Z"));
  check("the same FRED print does not call again", calls === 1 && newsFetches === 1, `calls=${calls} news=${newsFetches}`);
  const moved = { DCOILWTICO: flatLevel(70, 80) };
  await run(new Date("2026-02-15T12:00:00.000Z"), moved);
  check("a new print calls again and reuses the 24h news cache", calls === 2 && newsFetches === 1, `calls=${calls} news=${newsFetches}`);
  await run(new Date("2026-02-23T00:00:00.000Z"), moved);
  check("the driver cache expires after 7 days", calls === 3, `calls=${calls}`);
}

console.log("\n=== server/recession.ts keeps the 17 scores and drops the Hormuz card ===");
{
  const src = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsB2.tsx", import.meta.url), "utf8");
  check("Hormuz is gone from server/recession.ts", !src.includes("Hormuz"));
  check("NY Fed weight stays 0.30", src.includes("export const NY_FED_ANCHOR_WEIGHT = 0.3"));
  check("schemaVersion stays 1", src.includes("export const RECESSION_SCHEMA_VERSION = 1"));
  check("activity slot stays unscored", src.includes('weight: 0') && src.includes("available: false"));
  check("Sahm still scores from unemployment", src.includes("scoreSahmFromUnemployment") && src.includes("sahmIndicatorFromScore"));
  check("SerpApi Google Trends call stays", src.includes("serpapi.com/search.json"));
  check(
    "P_korr12 reads the oil-bridge z and a missing z stays unknown",
    src.includes("oilShockFromZ(bridge.oil.zOil)") && src.includes("if (zWti4w == null || !Number.isFinite(zWti4w)) return null"),
  );
  check("fazit uses the driver sections", src.includes("driverFazitSections"));
  check("static geopolitik card is gone", !src.includes("Geopolitik & Makro"));
  check("section 9 can show unauffällig or a driver card", ui.includes('data-testid="text-recession-drivers"') && ui.includes("unauffällig"));
  const fb = JSON.stringify(RECESSION_FALLBACK_DATA);
  check("fallback no longer renders the Hormuz essay", !fb.includes("Hormuz"));
  check("fallback summary still says Hohes Risiko", fb.includes("Hohes Risiko"));
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
