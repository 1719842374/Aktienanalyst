import { axisTicks, tickLabel } from "../client/src/components/recession/buffettChartScale.ts";

let failed = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log("  OK ", name);
  else {
    failed += 1;
    console.log("  FAIL", name, detail);
  }
}

function years(stamps: number[]): number[] {
  return stamps.map(stamp => new Date(stamp).getUTCFullYear());
}

const rows = [
  { date: "1950-10-01" },
  { date: "2010-01-01" },
  { date: "2020-06-01" },
  { date: "2026-10-05" },
];

const narrow = years(axisTicks(rows, "Max", false));
ok("schmale Achse endet im Jahr des letzten Kurses", narrow[narrow.length - 1] === 2026, JSON.stringify(narrow));
ok("2010 bleibt, 2020 rückt zugunsten von 2026 weg", narrow.includes(2010) && !narrow.includes(2020), JSON.stringify(narrow));
ok("1960 klebt nicht an 1950", narrow.includes(1970) && !narrow.includes(1960), JSON.stringify(narrow));
ok("das letzte Label ist 2026", tickLabel(axisTicks(rows, "Max", false).at(-1)!, "Max") === "2026");

const wide = years(axisTicks(rows, "Max", true));
ok("breite Achse endet 2026 und behält 2020", wide.at(-1) === 2026 && wide.includes(2020) && !wide.includes(2025), JSON.stringify(wide));

const decade = years(axisTicks([
  { date: "2016-10-05" },
  { date: "2026-10-05" },
], "10Y", false));
ok("10Y beschriftet 2026 nur einmal", decade.filter(year => year === 2026).length === 1 && decade.at(-1) === 2026, JSON.stringify(decade));

const half = axisTicks([
  { date: "2026-04-06" },
  { date: "2026-10-05" },
], "6M", true).map(stamp => tickLabel(stamp, "6M"));
ok("6M reicht bis zum letzten Monat", half.at(-1) === "10.26" && half.includes("05.26"), JSON.stringify(half));

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
