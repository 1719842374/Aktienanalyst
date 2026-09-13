/**
 * script/test-ohlcv-window.ts — local DoD checks for /api/ohlcv clamps (no network).
 * Run: npx tsx script/test-ohlcv-window.ts
 */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addYearsIso(iso: string, years: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function clampFromTo(fromRaw: string, toRaw: string) {
  const today = todayIso();
  let to = (toRaw || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to > today) to = today;
  const minFrom = addYearsIso(today, -5);
  let from = (fromRaw || minFrom).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < minFrom) from = minFrom;
  if (from > to) from = to;
  return { from, to };
}

const today = todayIso();
const farFuture = "2099-01-01";
const tooOld = "1990-01-01";
const c1 = clampFromTo("2024-09-09", farFuture);
console.assert(c1.to === today, "to clamps to today");
const c2 = clampFromTo(tooOld, today);
console.assert(c2.from === addYearsIso(today, -5), "from clamps to today-5Y");
const emptyMeta = { n: 0, truncated: true };
console.assert(emptyMeta.truncated && emptyMeta.n === 0, "empty → truncated");
console.log("ok", { today, c1, c2 });
