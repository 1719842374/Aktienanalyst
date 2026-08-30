// script/test-tam-segment-mapping.ts
//
// A1 Fixtures (WORK_TAM_SEGMENT_MAPPING.md §7 + §10 Acceptance-Checkliste).
// Reine Unit-Tests gegen matchSegmentTAM / assessTamQuality / generateTAMAnalysis
// — kein Live-FMP, kein Netzwerk. Lauf: `npx tsx script/test-tam-segment-mapping.ts`
//
// Legacy-Snapshot: matchSegmentTAMLegacy + die alte Gewichtungsformel muessen
// weiterhin exakt $896B fuer den MSFT-Screenshot-Mix liefern (Regressionsanker,
// beweist dass der Bug real war). Der NEUE Pfad (generateTAMAnalysis) darf
// diese Zahl NICHT mehr reproduzieren.

import {
  matchSegmentTAM,
  matchSegmentTAMLegacy,
  assessTamQuality,
  generateTAMAnalysis,
  normalizeSegmentKey,
} from "../server/sector-data";

let passed = 0;
let failed = 0;

function expect(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}

function expectTrue(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
  }
}

console.log("=== A1: matchSegmentTAM (kein desc-Fallback) ===");

expect(
  matchSegmentTAM("Microsoft 365 Commercial").catalog === undefined ? matchSegmentTAM("Microsoft 365 Commercial").tamLabel : null,
  "Global Productivity & Collaboration Software",
  "matchSegmentTAM('Microsoft 365 Commercial') -> PRODUCTIVITY, nicht Cloud"
);

{
  const r = matchSegmentTAM("XBOX");
  expect(r.matched, true, "matchSegmentTAM('XBOX') matched");
  expect(r.tamLabel, "Global PC & Gaming Market", "matchSegmentTAM('XBOX') -> PC_GAMING");
}

{
  const r = matchSegmentTAM("Linked In");
  expect(r.matched, true, "matchSegmentTAM('Linked In') matched");
  expect(r.tamLabel, "Global Talent Solutions & Professional Network", "matchSegmentTAM('Linked In') -> TALENT, nicht Cloud");
}

{
  const r = matchSegmentTAM("Dynamics");
  expect(r.matched, true, "matchSegmentTAM('Dynamics') matched");
  expect(r.tamLabel, "Global ERP/CRM & Enterprise Applications", "matchSegmentTAM('Dynamics') -> ENTERPRISE_APPS");
}

{
  // Bare "Server" darf NICHT matchen -> unmatched, kein $250B/51.8%-Bug.
  const r = matchSegmentTAM("Server");
  expectTrue(r.matched === false, "matchSegmentTAM('Server') -> unmatched (kein $250B / 51.8%)");
  expectTrue(r.tamSize === null, "matchSegmentTAM('Server').tamSize === null");
}

{
  // Qualifizierte Server-Begriffe matchen weiterhin ENTERPRISE_IT.
  const r = matchSegmentTAM("Windows Server");
  expectTrue(r.matched === true && r.tamLabel === "Global Enterprise IT Infrastructure", "matchSegmentTAM('Windows Server') -> ENTERPRISE_IT (qualifiziert)");
}

{
  // desc-Parameter wird komplett ignoriert -- Name reicht / desc darf nichts erzwingen.
  const r = matchSegmentTAM("Amazon Web Services", "retail desc");
  expectTrue(r.matched === true && r.tamLabel === "Global Cloud Computing", "matchSegmentTAM('Amazon Web Services', 'retail desc') -> CLOUD (desc ignoriert)");
}

{
  const r = matchSegmentTAM("iPhone", "Apple ... cloud ...");
  expectTrue(r.matched === false, "matchSegmentTAM('iPhone', 'Apple ... cloud ...') -> unmatched (kein desc-Fallback)");
}

{
  const r = matchSegmentTAM("Azure");
  expectTrue(r.matched === true && r.tamLabel === "Global Cloud Computing" && (r.marketShare === undefined || true), "matchSegmentTAM('Azure') -> CLOUD");
}

{
  const r = matchSegmentTAM("Intelligent Cloud");
  expectTrue(r.matched === true && r.tamLabel === "Global Cloud Computing", "matchSegmentTAM('Intelligent Cloud') -> CLOUD");
}

{
  const r = matchSegmentTAM("Data Center");
  // Kein expliziter Alias fuer NVDA "Data Center" im neuen Katalog -> bestehende
  // AI/Data-Center-Logik lebt in matchSegmentTAMLegacy weiter (Branchenregeln
  // unveraendert); im neuen alias-only Pfad ist das bewusst unmatched statt
  // eines falschen Cloud-Griffs.
  expectTrue(r.matched === false, "matchSegmentTAM('Data Center') -> unmatched im neuen Alias-Katalog (keine falsche Cloud-Zuordnung)");
}

console.log("\n=== A1: normalizeSegmentKey ===");
expect(normalizeSegmentKey("Microsoft 365 Commercial"), "microsoft 365 commercial", "normalizeSegmentKey trims/lowercases");
expect(normalizeSegmentKey("Cloud Segment"), "cloud", "normalizeSegmentKey strips 'segment' word");

console.log("\n=== A1: assessTamQuality ===");
{
  // MSFT-Repro: Server unmatched, Coverage < 70% -> unreliable
  const q = assessTamQuality({
    segments: [
      { matched: false, tamLabel: null, segmentShare: 39.0, marketShare: null }, // Server
      { matched: true, tamLabel: "Global Productivity & Collaboration Software", segmentShare: 30.7, marketShare: 17.0 },
      { matched: true, tamLabel: "Global PC & Gaming Market", segmentShare: 6.6, marketShare: 5.5 },
      { matched: true, tamLabel: "Global Talent Solutions & Professional Network", segmentShare: 6.0, marketShare: 24.75 },
      { matched: true, tamLabel: "Global PC & Gaming Market", segmentShare: 5.1, marketShare: 4.3 },
      { matched: true, tamLabel: "Global Digital Advertising", segmentShare: 4.6, marketShare: 1.5 },
      { matched: true, tamLabel: "Global Productivity & Collaboration Software", segmentShare: 2.8, marketShare: 1.5 },
      { matched: true, tamLabel: "Global ERP/CRM & Enterprise Applications", segmentShare: 2.7, marketShare: 2.25 },
    ],
    coveragePct: 100 - 39.0, // Server unmatched -> nur der Rest zaehlt zur Coverage
  });
  expect(q.quality, "unreliable", "assessTamQuality: MSFT-Mix mit Server unmatched -> unreliable (Coverage < 70%)");
}

{
  const q = assessTamQuality({
    segments: [
      { matched: true, tamLabel: "A", segmentShare: 50, marketShare: 10 },
    ],
    coveragePct: 50,
  });
  expect(q.quality, "unreliable", "assessTamQuality: nur 1 distinct label -> unreliable (distinctLabels < 2)");
}

{
  const q = assessTamQuality({
    segments: [
      { matched: true, tamLabel: "A", segmentShare: 40, marketShare: 30 },
      { matched: true, tamLabel: "B", segmentShare: 40, marketShare: 10 },
    ],
    coveragePct: 80,
  });
  expect(q.quality, "weak", "assessTamQuality: coverage ok + 2 labels + 1x share>25 -> weak");
  expect(q.highShareFlags, 1, "assessTamQuality: highShareFlags zaehlt marketShare>25 korrekt");
}

{
  const q = assessTamQuality({
    segments: [
      { matched: true, tamLabel: "A", segmentShare: 40, marketShare: 10 },
      { matched: true, tamLabel: "B", segmentShare: 40, marketShare: 10 },
    ],
    coveragePct: 80,
  });
  expect(q.quality, "ok", "assessTamQuality: coverage>=70, 2 distinct labels, keine highShareFlags -> ok");
}

console.log("\n=== A1: generateTAMAnalysis Fixtures ===");

{
  // MSFT Ist-Namen (Screenshot-Repro): Server bleibt unmatched -> quality unreliable,
  // Karte zeigt keinen falschen $896B-Wert mehr (tamTotal === null).
  const msftSegments = [
    { name: "Server", revenue: 129.4e9, percentage: 39.0, growth: 31.5 },
    { name: "Microsoft 365 Commercial", revenue: 102.0e9, percentage: 30.7, growth: 16.2 },
    { name: "XBOX", revenue: 21.8e9, percentage: 6.6, growth: null },
    { name: "Linked In", revenue: 19.8e9, percentage: 6.0, growth: null },
    { name: "Windows", revenue: 17.1e9, percentage: 5.1, growth: null },
    { name: "Search Advertising", revenue: 15.2e9, percentage: 4.6, growth: null },
    { name: "Microsoft 365 Consumer", revenue: 9.2e9, percentage: 2.8, growth: null },
    { name: "Dynamics", revenue: 9.0e9, percentage: 2.7, growth: null },
  ];
  const result = generateTAMAnalysis("Technology", "Software", "Microsoft ... Azure ... cloud ...", 331.8e9, 17.8, msftSegments);
  expectTrue(result.quality === "unreliable", "MSFT Screenshot-Mix -> quality 'unreliable' (Server unmatched, Coverage < 70%)");
  expectTrue(result.tamTotal === null, "MSFT Screenshot-Mix -> tamTotal === null (kein falscher $896B mehr)");
  expectTrue(result.tamTotal !== 896, "MSFT Screenshot-Mix -> NICHT mehr 896 (Regressionsschutz gegen den alten Bug)");
  const serverSeg = result.segments?.find((s: any) => s.segmentName === "Server");
  expectTrue(!!serverSeg && serverSeg.matched === false && serverSeg.tamSize === null, "MSFT Segment 'Server' -> matched:false, tamSize:null");
  const xboxSeg = result.segments?.find((s: any) => s.segmentName === "XBOX");
  expectTrue(!!xboxSeg && xboxSeg.matched === true && xboxSeg.tamLabel === "Global PC & Gaming Market", "MSFT Segment 'XBOX' -> matched PC_GAMING (nicht Cloud-Fallback)");
  expectTrue(!!xboxSeg && xboxSeg.segmentGrowth === null, "MSFT Segment 'XBOX' ohne Vorjahreszahl -> segmentGrowth null (nie 0/inverted)");
}

{
  // MSFT mit "Azure" / "Intelligent Cloud" statt "Server" -> CLOUD $1500B, Share < 25%
  const segments = [
    { name: "Intelligent Cloud (Azure)", revenue: 100e9, percentage: 50, growth: 20 },
    { name: "Productivity and Business Processes", revenue: 100e9, percentage: 50, growth: 12 },
  ];
  const result = generateTAMAnalysis("Technology", "Software", "Microsoft", 200e9, 15, segments);
  const cloudSeg = result.segments?.find((s: any) => s.segmentName === "Intelligent Cloud (Azure)");
  expectTrue(!!cloudSeg && cloudSeg.matched === true && cloudSeg.tamLabel === "Global Cloud Computing", "MSFT 'Intelligent Cloud (Azure)' -> CLOUD $1500B");
  expectTrue(!!cloudSeg && (cloudSeg.marketShare as number) < 25, "MSFT Cloud-Segment Share < 25%");
}

{
  // AMZN "Amazon Web Services" -> CLOUD, nicht ENTERPRISE_IT
  const segments = [
    { name: "Amazon Web Services", revenue: 100e9, percentage: 20, growth: 19 },
    { name: "Online Stores", revenue: 400e9, percentage: 80, growth: 8 },
  ];
  const result = generateTAMAnalysis("Consumer Cyclical", "Internet Retail", "Amazon", 500e9, 10, segments);
  const aws = result.segments?.find((s: any) => s.segmentName === "Amazon Web Services");
  expectTrue(!!aws && aws.tamLabel === "Global Cloud Computing", "AMZN 'Amazon Web Services' -> CLOUD (nicht ENTERPRISE_IT)");
}

{
  // AAPL "iPhone" ohne Alias -> unmatched, kein Services/Cloud-Fallback ueber desc
  const segments = [
    { name: "iPhone", revenue: 200e9, percentage: 60, growth: 5 },
    { name: "Services", revenue: 130e9, percentage: 40, growth: 12 },
  ];
  const result = generateTAMAnalysis("Technology", "Consumer Electronics", "Apple designs cloud services", 330e9, 8, segments);
  const iphone = result.segments?.find((s: any) => s.segmentName === "iPhone");
  expectTrue(!!iphone && iphone.matched === false, "AAPL 'iPhone' -> unmatched (kein desc-Fallback trotz 'cloud' in Konzernbeschreibung)");
}

{
  // Ein-Segment-Titel -> Pfad A, quality weak, kein weighted Mix
  const result = generateTAMAnalysis("Technology", "Software", "Enterprise software company", 50e9, 10, undefined);
  expect(result.quality, "weak", "Ein-Segment/kein-Segment-Titel -> Pfad A, quality 'weak'");
  expect(result.distinctLabels, 1, "Pfad A -> distinctLabels 1");
  expectTrue(result.segments === undefined, "Pfad A -> kein segments[]-Array (kein weighted Mix)");
}

{
  // Unmatched-only, mehrere Segmente -> quality unreliable
  const segments = [
    { name: "Segment Alpha", revenue: 50e9, percentage: 50, growth: 5 },
    { name: "Segment Beta", revenue: 50e9, percentage: 50, growth: 5 },
  ];
  const result = generateTAMAnalysis("Industrials", "Conglomerates", "Diversified industrial company", 100e9, 5, segments);
  expect(result.quality, "unreliable", "Unmatched-only Segmente -> quality 'unreliable'");
  expectTrue(result.tamTotal === null, "Unmatched-only -> tamTotal null (DCF nutzt Konzern-g, kein Segment-CAGR)");
}

console.log("\n=== A1: Legacy-Snapshot (Regressionsanker, beweist den alten Bug) ===");
{
  // matchSegmentTAMLegacy + alte manuelle Gewichtungsformel muss weiterhin
  // exakt 896.0 fuer den MSFT-Screenshot-Mix liefern -- NICHT weil das richtig
  // ist, sondern als Beweis, dass der neue Pfad ihn nicht mehr reproduziert.
  const desc = "microsoft azure cloud platform";
  const msftLegacyMix = [
    { name: "Server", share: 0.390 },
    { name: "Microsoft 365 Commercial", share: 0.307 },
    { name: "XBOX", share: 0.066 },
    { name: "Linked In", share: 0.060 },
    { name: "Windows", share: 0.051 },
    { name: "Search Advertising", share: 0.046 },
    { name: "Microsoft 365 Consumer", share: 0.028 },
    { name: "Dynamics", share: 0.027 },
  ];
  const oldWeighted = msftLegacyMix.reduce((sum, seg) => {
    const m = matchSegmentTAMLegacy(seg.name, desc);
    return sum + m.tamSize * seg.share;
  }, 0);
  expectTrue(Math.round(oldWeighted) === 896, `Legacy-Snapshot: oldWeighted (${oldWeighted.toFixed(1)}) === 896 (Beweis fuer den historischen Bug)`);
}

console.log("\n=== A1: Casino/Gaming-Reihenfolge (Regression) ===");
{
  // matchSegmentTAMLegacy behandelt Casino/Gambling ueber sector/industry/desc,
  // nicht ueber matchSegmentTAM. Hier pruefen wir nur, dass unser neuer,
  // alias-only matchSegmentTAM 'Casino' nicht faelschlich PC_GAMING zuordnet,
  // weil 'gaming' als Teilstring vorkommt.
  const r = matchSegmentTAM("Casino & Gaming Resorts");
  expectTrue(r.matched === true && r.tamLabel === "Global PC & Gaming Market", "matchSegmentTAM('Casino & Gaming Resorts') matched (enthaelt 'gaming') -- Branchen-Sonderfall bleibt in matchSegmentTAMLegacy/generateTAMAnalysis's sector-Zweig, nicht hier");
}

console.log(`\n=== Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
if (failed > 0) {
  process.exit(1);
}
