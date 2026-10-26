/**
 * F3-04 — Google Trends retry with bounded exponential backoff.
 * Chain: RecessionDashboard → POST /api/analyze-recession → scoreGoogleTrends (server/recession.ts)
 * → server/cache/google-trends-retry.ts → SerpApi; miss → google-trends-cache (48 h last good) → googleReading(null) = N/A.
 * Negative control: on main (73eff97e) the retry module is missing and scoreGoogleTrends makes one call → exit 1.
 * Run: npx tsx script/test-google-trends-retry.ts
 */
import { readFileSync } from "node:fs";
import { googleReading } from "../server/recession";

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

const OK_BODY = JSON.stringify({
  search_metadata: { status: "Success" },
  interest_over_time: { timeline_data: [{ values: [{ extracted_value: 50 }] }, { values: [{ extracted_value: 60 }] }] },
});
const EMPTY_BODY = JSON.stringify({ search_metadata: { status: "Success" }, interest_over_time: { timeline_data: [] } });

async function main() {
  let mod: typeof import("../server/cache/google-trends-retry") | null = null;
  try {
    mod = await import("../server/cache/google-trends-retry");
  } catch (err: any) {
    check("retry module server/cache/google-trends-retry.ts exists", false, String(err?.message ?? err).slice(0, 120));
  }

  const src = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function scoreGoogleTrends"), src.indexOf("function scoreGoogleTrends") + 2500);
  check("scoreGoogleTrends calls SerpApi through fetchGoogleTrendsWithRetry", body.includes("fetchGoogleTrendsWithRetry("));
  check("scoreGoogleTrends no longer makes a single bare fetchUrl call", !/parseSerpApiGoogleTrends\(fetchUrl\(/.test(body));

  // No score effect: zones/weights of googleReading are unchanged.
  const r = googleReading(59.1, "x");
  check("googleReading(59.1) unchanged: rawScore 0, weight 1.7, max 11.9", r.rawScore === 0 && r.weight === 1.7 && r.maxWeighted === 11.9);
  const n = googleReading(null);
  check("final failure → N/A, closed slot (weight 0, available false)", n.value === "N/A" && n.weight === 0 && n.available === false && n.source === "Google Trends (N/A)");

  if (!mod) {
    console.log(`\n${total - failed}/${total} passed`);
    process.exit(1);
  }
  const { fetchGoogleTrendsWithRetry, resetGoogleTrendsRetryState, GOOGLE_TRENDS_MAX_ATTEMPTS, GOOGLE_TRENDS_BACKOFF_CAP_MS, GOOGLE_TRENDS_COOLDOWN_MS } = mod;

  // [status, body, retryAfter?, attemptDurationMs?] — duration advances the fake clock (min(duration, timeout)).
  const timeouts: number[] = [];
  function run(statuses: Array<[number, string, string?, number?]>, clock = { t: 0 }) {
    let i = 0;
    const sleeps: number[] = [];
    timeouts.length = 0;
    const out = fetchGoogleTrendsWithRetry(
      (timeoutMs: number) => {
        const [status, b, retryAfter, dur] = statuses[Math.min(i, statuses.length - 1)];
        i++;
        timeouts.push(timeoutMs);
        if (dur) clock.t += Math.min(dur, timeoutMs ?? dur);
        return { status, body: b, ...(retryAfter ? { retryAfter } : {}) };
      },
      ms => { sleeps.push(ms); clock.t += ms; },
      () => clock.t,
    );
    return { out, calls: i, sleeps };
  }

  check("budget: max 3 attempts, cap ≤ 4 s", GOOGLE_TRENDS_MAX_ATTEMPTS === 3 && GOOGLE_TRENDS_BACKOFF_CAP_MS <= 4000);

  resetGoogleTrendsRetryState();
  let res = run([[200, OK_BODY]]);
  check("200 first try → value, 1 call, no sleep", res.out.parsed?.value === 55 && res.calls === 1 && res.sleeps.length === 0);

  resetGoogleTrendsRetryState();
  res = run([[429, ""], [429, ""], [200, OK_BODY]]);
  check("429, 429, 200 → value after 3 calls", res.out.parsed?.value === 55 && res.calls === 3, JSON.stringify(res));
  check("backoff 1000 ms then 2000 ms", JSON.stringify(res.sleeps) === "[1000,2000]", JSON.stringify(res.sleeps));

  resetGoogleTrendsRetryState();
  const clock = { t: 0 };
  res = run([[429, ""]], clock);
  check("429 × 3 → null, exactly 3 calls, no 4th", res.out.parsed === null && res.calls === 3 && res.out.reason === "http-429");
  res = run([[200, OK_BODY]], clock);
  check("next request inside cooldown → 0 SerpApi calls (no retry storm)", res.calls === 0 && res.out.reason === "cooldown");
  clock.t += GOOGLE_TRENDS_COOLDOWN_MS;
  res = run([[200, OK_BODY]], clock);
  check("after 15 min cooldown → SerpApi asked again", res.calls === 1 && res.out.parsed?.value === 55);

  resetGoogleTrendsRetryState();
  res = run([[0, ""], [503, ""], [200, OK_BODY]]);
  check("timeout (0) and 503 are retried", res.calls === 3 && res.out.parsed != null);

  resetGoogleTrendsRetryState();
  res = run([[200, EMPTY_BODY]]);
  check("200 with empty timeline → no retry (quota), null", res.calls === 1 && res.out.parsed === null && res.out.reason === "empty");
  res = run([[200, OK_BODY]]);
  check("empty result sets no cooldown", res.calls === 1);

  resetGoogleTrendsRetryState();
  res = run([[401, '{"error":"Invalid API key"}']]);
  check("401 → no retry, null", res.calls === 1 && res.out.parsed === null && res.out.reason === "http-401");

  // F3-04b — total budget 15 s incl. backoff, Retry-After inside the budget only.
  const budget = (mod as any).GOOGLE_TRENDS_TOTAL_BUDGET_MS;
  check("total budget constant is 15 s", budget === 15_000, String(budget));

  resetGoogleTrendsRetryState();
  let bc = { t: 0 };
  res = run([[0, "", undefined, 60_000]], bc);
  check("timeouts: elapsed never exceeds 15 s budget", bc.t <= 15_000, `elapsed=${bc.t}`);
  check("first attempt timeout ≤ 12 s, later ones shrink to remaining budget", timeouts[0] === 12_000 && timeouts.every(t => t <= 15_000) && (timeouts.length < 2 || timeouts[1] <= 15_000 - 12_000 - res.sleeps[0]), JSON.stringify({ timeouts, sleeps: res.sleeps }));
  check("budget exhausted → null + cooldown", res.out.parsed === null && run([[200, OK_BODY]], bc).out.reason === "cooldown");

  for (const dur of [4_000, 5_500, 9_000, 11_000, 14_000]) {
    resetGoogleTrendsRetryState();
    bc = { t: 0 };
    run([[503, "", undefined, dur]], bc);
    const sum = timeouts.reduce((a, b) => a + b, 0);
    check(`budget holds for ${dur} ms attempts (elapsed ${bc.t} ms, timeouts sum ${sum})`, bc.t <= 15_000 && timeouts.every(t => t >= 1000));
  }

  resetGoogleTrendsRetryState();
  res = run([[429, "", "3"], [200, OK_BODY]]);
  check("Retry-After: 3 (seconds) on 429 honoured inside budget", res.calls === 2 && JSON.stringify(res.sleeps) === "[3000]" && res.out.parsed?.value === 55, JSON.stringify(res.sleeps));

  resetGoogleTrendsRetryState();
  bc = { t: Date.parse("2026-10-25T12:00:00Z") };
  res = run([[503, "", "Sun, 25 Oct 2026 12:00:05 GMT"], [200, OK_BODY]], bc);
  check("Retry-After HTTP-date on 503 honoured (5 s)", res.calls === 2 && JSON.stringify(res.sleeps) === "[5000]" && res.out.parsed != null, JSON.stringify(res.sleeps));

  resetGoogleTrendsRetryState();
  bc = { t: 0 };
  res = run([[429, "", "60"], [200, OK_BODY]], bc);
  check("Retry-After 60 s > budget → no retry, no sleep", res.calls === 1 && res.sleeps.length === 0 && res.out.parsed === null, JSON.stringify(res));
  check("Retry-After over budget → cooldown applies", run([[200, OK_BODY]], bc).out.reason === "cooldown");

  // Re-entrancy guard: a nested call while one is in flight makes no SerpApi call.
  resetGoogleTrendsRetryState();
  let nested: string | null = null;
  fetchGoogleTrendsWithRetry(() => {
    nested = fetchGoogleTrendsWithRetry(() => ({ status: 200, body: OK_BODY }), () => {}).reason;
    return { status: 200, body: OK_BODY };
  }, () => {});
  check("parallel/nested request while in flight → busy, no extra call", nested === "busy");

  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
}
main();
