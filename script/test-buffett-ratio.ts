import { buildBuffettSeries, type BuffettObservation } from "../server/buffett-ratio";

function quarters(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  while (true) {
    const date = `${year}-${String(month).padStart(2, "0")}-01`;
    if (date > to) break;
    out.push(date);
    month += 3;
    if (month > 10) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function row(
  date: string,
  marketCapBn: number,
  gdpBn: number,
  profit: number | null,
  extras: Partial<BuffettObservation> = {},
): BuffettObservation {
  return {
    date,
    marketCapBn,
    gdpBn,
    afterTaxProfitBn: profit,
    domesticProfitBn: extras.domesticProfitBn ?? null,
    foreignProfitBn: extras.foreignProfitBn ?? null,
    dividendBn: extras.dividendBn ?? null,
    yieldPct: extras.yieldPct ?? null,
  };
}

let failed = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log("  OK ", name);
  else {
    failed += 1;
    console.log("  FAIL", name, detail);
  }
}

const levelShift = quarters("1980-01-01", "2029-10-01").map(date => {
  const high = date >= "2020-01-01";
  const profit = high ? 20 : 10;
  return row(date, profit * 20, 100, profit, {
    domesticProfitBn: profit * 0.8,
    foreignProfitBn: profit * 0.2,
  });
});
const shifted = buildBuffettSeries(levelShift);
const shiftedEnd = shifted[shifted.length - 1];
ok("doppelter Gewinnanteil bei gleichem Multiple lässt den Abstand bei null", shiftedEnd.gapPct === 0, JSON.stringify(shiftedEnd));
ok("Rohquote und gerechtfertigte Quote steigen mit dem Gewinn", shiftedEnd.rawPct === 400 && shiftedEnd.justifiedPct === 400, JSON.stringify(shiftedEnd));
ok("Auslandsanteil kommt aus den Gewinnreihen", shiftedEnd.foreignShare === 0.2 && shiftedEnd.geoPct === 320, JSON.stringify(shiftedEnd));

const bubble = quarters("1980-01-01", "2024-01-01").map(date => {
  const rich = date > "2019-12-31";
  return row(date, rich ? 300 : 100, 100, 10);
});
const bubbled = buildBuffettSeries(bubble);
const bubbledEnd = bubbled[bubbled.length - 1];
ok("Q* bleibt der Median bis 2019", bubbledEnd.qStar === 10, JSON.stringify(bubbledEnd));
ok("ein höheres Multiple bleibt als Abstand sichtbar", bubbledEnd.multiple === 30 && bubbledEnd.gapPct === 200 && bubbledEnd.justifiedPct === 100, JSON.stringify(bubbledEnd));
ok("ohne Auslandsgewinn bleibt die geografische Quote leer", bubbledEnd.geoPct == null);

const crashDates = quarters("2000-01-01", "2024-10-01");
const crash = crashDates.map((date, index) => {
  const profit = index === crashDates.length - 1 ? 1 : 10;
  return row(date, 200, 100, profit);
});
const crashed = buildBuffettSeries(crash);
const crashedEnd = crashed[crashed.length - 1];
ok("ein eingebrochenes Quartal zieht das Multiple nicht auf den Spot-Gewinn", crashedEnd.multiple != null && crashedEnd.multiple < 25, JSON.stringify(crashedEnd));

const gordon = quarters("1990-01-01", "2024-01-01").map(date => row(date, 200, 100, 10, {
  dividendBn: 5,
  yieldPct: 5,
}));
const gordonEnd = buildBuffettSeries(gordon).at(-1)!;
ok("Gordon-Multiple aus Ausschüttung, Rendite und Wachstum", gordonEnd.profitCagrPct === 0 && gordonEnd.payout === 0.5 && gordonEnd.gordonMultiple === 10, JSON.stringify(gordonEnd));

const stuck = quarters("1990-01-01", "2024-01-01").map(date => row(date, 200, 100, 10, {
  dividendBn: 5,
  yieldPct: 0,
}));
ok("ohne positiven Abstand zwischen Rendite und Wachstum bleibt Gordon leer", buildBuffettSeries(stuck).at(-1)!.gordonMultiple == null);

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
