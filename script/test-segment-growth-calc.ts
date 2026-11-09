/**
 * Generische Segment-YoY-Lücken. Kein Ticker-Zweig.
 * Ausführen: npx tsx script/test-segment-growth-calc.ts
 */
import {
  annotateMissingSegmentGrowth,
  annotationByName,
  reconcileStatementRevenue,
  roundGrowthPct,
  snapshotsFromFmpRows,
  type SegmentSnapshot,
  type StatementYear,
} from "../shared/segment-growth-calc";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const serverNow = { name: "Server", revenue: 130 };
const serverPrev = { name: "Server", revenue: 100 };
const linkedInNow = { name: "LinkedIn", revenue: 11 };
const linkedInPrev = { name: "LinkedIn", revenue: 10 };
const windowsNow = { name: "Windows", revenue: 9 };
const windowsPrev = { name: "Windows", revenue: 10 };

function annualPair(now: SegmentSnapshot["rows"], prev: SegmentSnapshot["rows"]): SegmentSnapshot[] {
  return [
    { periodKey: "2025-06-30", rows: now },
    { periodKey: "2024-06-30", rows: prev },
  ];
}

console.log("\nexakter Jahresname bleibt Fakt, nicht berechnet");
{
  const rows = annotateMissingSegmentGrowth({
    annual: annualPair([serverNow, linkedInNow], [serverPrev, linkedInPrev]),
  });
  check("Server fehlt in den Lücken", !rows.some((r) => r.name === "Server"));
  check("LinkedIn fehlt in den Lücken", !rows.some((r) => r.name === "LinkedIn"));
  check("Formel rundet auf eine Dezimale", roundGrowthPct(130, 100) === 30);
}

console.log("\nNamensähnlichkeit und Merge");
{
  const rows = annotateMissingSegmentGrowth({
    annual: annualPair(
      [serverNow, { name: "Search advertising", revenue: 15 }, { name: "Windows and Devices", revenue: 172 }],
      [serverPrev, { name: "Search and news advertising", revenue: 14 }, { name: "Windows", revenue: 100 }, { name: "Devices", revenue: 70 }],
    ),
  });
  const search = annotationByName(rows, "Search advertising");
  const win = annotationByName(rows, "Windows and Devices");
  check("Search advertising berechnet", search?.basis === "berechnet" && search.method === "adaptive-name", JSON.stringify(search));
  check("Search Wachstum 15/14", search?.growth === roundGrowthPct(15, 14), String(search?.growth));
  check("Search nennt Formel und Quelle", !!search?.formula?.includes("15") && !!search.source?.includes("Namensähnlichkeit"));
  check("Windows and Devices ist Merge", win?.basis === "berechnet" && win.method === "merge", JSON.stringify(win));
  check("Merge-Wachstum 172/(100+70)", win?.growth === roundGrowthPct(172, 170), String(win?.growth));
  check("Merge-Formel nennt beide Vorperioden", !!win?.formula?.includes("Windows") && !!win.formula.includes("Devices"));
}

console.log("\nUmsatznähe nur innerhalb des Bandes aus den gematchten YoY");
{
  const wide = annotateMissingSegmentGrowth({
    annual: annualPair(
      [serverNow, linkedInNow, windowsNow, { name: "XBOX", revenue: 22 }, { name: "Search advertising", revenue: 15.2 }],
      [serverPrev, linkedInPrev, windowsPrev, { name: "Gaming", revenue: 20 }, { name: "Search and news advertising", revenue: 14 }],
    ),
  });
  const xbox = annotationByName(wide, "XBOX");
  check("XBOX trifft Gaming über Umsatznähe oder Name", xbox?.basis === "berechnet", JSON.stringify(xbox));
  if (xbox?.method === "revenue-proximity") {
    check("XBOX Wachstum 22/20", xbox.growth === roundGrowthPct(22, 20), String(xbox.growth));
  } else {
    check("XBOX hat eine Formel", !!xbox?.formula, xbox?.method);
  }
  const tight = annotateMissingSegmentGrowth({
    annual: annualPair(
      [
        { name: "Alpha", revenue: 110 },
        { name: "Beta", revenue: 110 },
        { name: "Gamma", revenue: 50 },
      ],
      [
        { name: "Alpha", revenue: 100 },
        { name: "Beta", revenue: 100 },
        { name: "Legacy", revenue: 10 },
      ],
    ),
  });
  const gamma = annotationByName(tight, "Gamma");
  check("außerhalb des engen Bandes bleibt n/a", gamma?.basis === "n/a", JSON.stringify(gamma));
  check("n/a nennt den Grund", !!gamma?.reason?.startsWith("n/a"));
}

console.log("\nzwei Lücken werden nicht über das Residuum aufgelöst");
{
  const rows = annotateMissingSegmentGrowth({
    annual: annualPair(
      [{ name: "Alpha", revenue: 100 }, { name: "One", revenue: 30 }, { name: "Two", revenue: 20 }],
      [{ name: "Alpha", revenue: 90 }, { name: "OtherA", revenue: 5 }, { name: "OtherB", revenue: 4 }],
    ),
    statements: [
      { periodKey: "2025-06-30", income: 160 },
      { periodKey: "2024-06-30", income: 110 },
    ],
  });
  const one = annotationByName(rows, "One");
  const two = annotationByName(rows, "Two");
  check("One bleibt n/a", one?.basis === "n/a", JSON.stringify(one));
  check("Two bleibt n/a", two?.basis === "n/a", JSON.stringify(two));
  check("Grund nennt mehrere Lücken", !!one?.reason?.includes("nicht auflösbar"), one?.reason ?? "");
}

console.log("\neine Lücke, Residuum im Band");
{
  const rows = annotateMissingSegmentGrowth({
    annual: annualPair(
      [{ name: "Alpha", revenue: 110 }, { name: "Beta", revenue: 90 }, { name: "Neu", revenue: 22 }],
      [{ name: "Alpha", revenue: 100 }, { name: "Beta", revenue: 80 }],
    ),
    statements: [
      { periodKey: "2025-06-30", income: 230 },
      { periodKey: "2024-06-30", income: 200 },
    ],
  });
  const neu = annotationByName(rows, "Neu");
  // implied prior = 200 - 100 - 80 = 20; 22/20 - 1 = 10%
  check("eine Lücke wird Residuum, wenn das Band passt", neu?.method === "residual-identity" && neu.growth === roundGrowthPct(22, 20), JSON.stringify(neu));
  check("Residuum-Formel nennt die Differenz", !!neu?.formula?.includes("Residuum"), neu?.formula ?? "");
}

console.log("\nQuartale / TTM, wenn das Jahr den Namen nicht führt");
{
  const quarters: SegmentSnapshot[] = [];
  for (let i = 0; i < 8; i++) {
    const year = i < 4 ? 2025 : 2024;
    const q = (i % 4) + 1;
    quarters.push({
      periodKey: `${year}-0${q}-01`,
      rows: [{ name: "XBOX", revenue: i < 4 ? 6 : 5 }],
    });
  }
  quarters.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  const rows = annotateMissingSegmentGrowth({
    annual: [{ periodKey: "2025-06-30", rows: [{ name: "XBOX", revenue: 24 }, { name: "Server", revenue: 10 }] }],
    quarterly: quarters,
  });
  const xbox = annotationByName(rows, "XBOX");
  check("TTM-Wachstum aus 4×6 gegen 4×5", xbox?.method === "ttm" && xbox.growth === roundGrowthPct(24, 20), JSON.stringify(xbox));
  check("Quelle nennt TTM", !!xbox?.source?.includes("TTM"));
}

console.log("\nnur ein Segmentjahr: Residuum ohne Vorperiode bleibt n/a mit Grund");
{
  const statements: StatementYear[] = [
    { periodKey: "2025-06-30", income: 100, cashflow: 100, balance: 900 },
    { periodKey: "2024-06-30", income: 80 },
  ];
  const reconciled = reconcileStatementRevenue(statements[0]);
  check("Ausreißer der Bilanz fällt aus dem MAD-Band", reconciled != null && reconciled.value === 100, JSON.stringify(reconciled));
  const rows = annotateMissingSegmentGrowth({
    annual: [{ periodKey: "2025-06-30", rows: [{ name: "Only", revenue: 90 }] }],
    statements,
  });
  const only = annotationByName(rows, "Only");
  const other = annotationByName(rows, "Other / nicht segmentiert");
  check("einziges Segment ohne Vorperiode ist n/a", only?.basis === "n/a", JSON.stringify(only));
  check("Grund nennt das eine Jahr", !!only?.reason?.includes("nur ein Segmentjahr"), only?.reason ?? "");
  check("Other nennt das fehlende Residuum_t−1", !!other?.reason?.includes("Residuum_t−1"), other?.reason ?? "");
}

console.log("\nOther-Wachstum aus zwei Jahren Statements und Segmenten");
{
  const rows = annotateMissingSegmentGrowth({
    annual: annualPair(
      [{ name: "Alpha", revenue: 90 }],
      [{ name: "Alpha", revenue: 70 }],
    ),
    statements: [
      { periodKey: "2025-06-30", income: 100 },
      { periodKey: "2024-06-30", income: 80 },
    ],
  });
  const other = annotationByName(rows, "Other / nicht segmentiert");
  check("Other berechnet", other?.basis === "berechnet" && other.method === "residual-bucket", JSON.stringify(other));
  check("Other 10/10 = 0", other?.growth === 0, String(other?.growth));
  check("Other-Formel zeigt beide Residuen", !!other?.formula?.includes("Residuum_t") && !!other.source?.includes("income"));
}

console.log("\nFMP-Shape");
{
  const snaps = snapshotsFromFmpRows([
    { fiscalYear: 2025, date: "2025-06-30", data: { XBOX: 22, fiscalYear: 2025 } },
    { fiscalYear: 2024, date: "2024-06-30", data: { Gaming: 20, Server: 10 } },
    { fiscalYear: 2025, date: "2025-06-30", symbol: "X", data: { XBOX: 22, Server: 130 } },
  ]);
  check("Duplikat-Periode behält die vollständigere Zeile", snaps[0]?.rows.length === 2, JSON.stringify(snaps[0]));
  check("Metadaten sind kein Segment", !snaps.some((s) => s.rows.some((r) => r.name === "fiscalYear" || r.name === "symbol")));
}

console.log(failed === 0 ? "\n✅ Segment-Wachstums-Lücken" : `\n❌ ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
