import { formatAgeHours } from "../client/src/components/recession/recessionDashboardShared";

let fail = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
}
check("0h", formatAgeHours(0), "vor <1 h");
check("0.4h", formatAgeHours(0.4), "vor <1 h");
check("NaN", formatAgeHours(Number.NaN), "vor <1 h");
check("1h", formatAgeHours(1), "vor 1 h");
check("3.7h", formatAgeHours(3.7), "vor 3 h");
check("24h", formatAgeHours(24), "vor 1 T");
check("26h", formatAgeHours(26), "vor 1 T 2 h");
check("47.9h", formatAgeHours(47.9), "vor 1 T 23 h");
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("all passed");
