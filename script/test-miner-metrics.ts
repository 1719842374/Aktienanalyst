/**
 * Unit-Tests für die Miner-Zone-Rechenlogik (WORK_BTC_MINER.md §2 + §3).
 * Läuft ohne Netzwerk — reine Funktionstests mit synthetischen Serien.
 *
 * Ausführen: npx tsx script/test-miner-metrics.ts
 * Exit-Code 0 = alle Tests bestanden, 1 = Fehler.
 */
import {
  calcRibbonSignals, calcBreakevenPrice, calcHashpriceUsd,
  classifyMinerZone, buildMinerZoneSeries, buildZoneSegments,
  difficultyZoneFromCompression, DEFAULT_FLEET,
} from "../client/src/lib/btc/minerMetrics";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── §2.1 Hash Ribbons ────────────────────────────────────────────────────────
console.log("\n§2.1 calcRibbonSignals");
{
  // 100 Tage: erst fallend (Kapitulation), dann steigend bis Golden Cross
  const n = 130;
  const hashrate: number[] = [];
  for (let i = 0; i < n; i++) {
    // 70 Tage fallend von 700 → 550, dann 60 Tage steil steigend auf 800
    hashrate.push(i < 70 ? 700 - i * (150 / 70) : 550 + (i - 70) * (250 / 60));
  }
  const ma = (w: number) => hashrate.map((_, i) => {
    const s = hashrate.slice(Math.max(0, i - w + 1), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  const ma30 = ma(30);
  const ma60 = ma(60);
  const signals = calcRibbonSignals(ma30, ma60);

  check("Warm-up (< Tag 60) ist neutral", signals.slice(0, 60).every(s => s === "neutral"));
  check("Kapitulation wird im Abschwung erkannt", signals.slice(65, 75).includes("capitulation"));
  const buyIdx = signals.indexOf("buy");
  check("Golden Cross erzeugt genau ein Buy-Signal", buyIdx > 70, `buyIdx=${buyIdx}`);
  check("Nach dem Cross kein weiteres Buy", signals.slice(buyIdx + 1).every(s => s !== "buy"));
}

// ─── §2.3 Hashprice ───────────────────────────────────────────────────────────
console.log("\n§2.3 calcHashpriceUsd");
{
  // 3.125 BTC × 144 Blöcke × $100k / (1000 EH/s × 1e6 TH) = $0.045/TH/Tag
  const hp = calcHashpriceUsd({ btcPrice: 100000, hashrateEHs: 1000 });
  check("Hashprice-Formel korrekt ($0.045 bei $100k/1000EH)", Math.abs(hp - 0.045) < 1e-9, `got ${hp}`);
  check("Hashrate 0 → 0 (kein NaN/Infinity)", calcHashpriceUsd({ btcPrice: 100000, hashrateEHs: 0 }) === 0);
}

// ─── §2.4 Breakeven ───────────────────────────────────────────────────────────
console.log("\n§2.4 calcBreakevenPrice");
{
  const be = calcBreakevenPrice({ hashrateEHs: 900, assumptions: DEFAULT_FLEET });
  // Handrechnung bei 900 EH/s, 21.5 J/TH, $0.05/kWh, +15% Opex:
  // kWh/TH/Tag = 21.5/1000 × 24 = 0.516
  // cost/TH/Tag = 0.516 × $0.05 × 1.15 = $0.029670
  // btc/TH/Tag = (3.125 × 144) / 900e6 = 5e-7
  // breakeven = 0.029670 / 5e-7 = $59,340
  // WICHTIG: Der Spec-Code in WORK_BTC_MINER §2.4 hat ein doppeltes /1000
  // (liefert $59 statt $59.340) — dieser Test sichert die korrigierte Formel ab.
  const expected = ((21.5 / 1000) * 24) * 0.05 * 1.15 / ((3.125 * 144) / (900 * 1e6));
  check("Breakeven entspricht korrigierter §2.4-Formel exakt", Math.abs(be - expected) < 1e-6, `got ${be}, want ${expected}`);
  check("1000×-Spec-Bug gefixt: Breakeven ≈ $59.340 (nicht $59)", Math.abs(be - 59340) < 1, `got ${be.toFixed(0)}`);
  check("Breakeven positiv und plausibel (10k–200k bei aktuellen Netzwerten)", be > 10000 && be < 200000, `got ${be.toFixed(0)}`);
  check("Hashrate 0 → 0 (kein Infinity)", calcBreakevenPrice({ hashrateEHs: 0, assumptions: DEFAULT_FLEET }) === 0);
  // Höherer Strompreis → höherer Breakeven (Monotonie)
  const beExpensive = calcBreakevenPrice({ hashrateEHs: 900, assumptions: { ...DEFAULT_FLEET, electricityUsdPerKwh: 0.10 } });
  check("Strompreis ↑ → Breakeven ↑", beExpensive > be);
}

// ─── §2.5 Difficulty-Zone-Mapping ────────────────────────────────────────────
console.log("\n§2.5 difficultyZoneFromCompression");
{
  check("0.9 → compressed", difficultyZoneFromCompression(0.9) === "compressed");
  check("0.5 → neutral", difficultyZoneFromCompression(0.5) === "neutral");
  check("0.2 → expanded", difficultyZoneFromCompression(0.2) === "expanded");
}

// ─── §3 classifyMinerZone ─────────────────────────────────────────────────────
console.log("\n§3 classifyMinerZone");
{
  // Max-Kapitulation: Spot unter Breakeven, Puell < 0.5, Ribbon-Kapitulation, compressed, distribution
  const cap = classifyMinerZone({
    spotPrice: 30000, breakeven: 40000, puell: 0.4,
    hashRibbonSignal: "capitulation", difficultyCompression: "compressed", mpiZone: "distribution",
  });
  check("Volle Kapitulation → zone=capitulation, score=0", cap.zone === "capitulation" && cap.score === 0, JSON.stringify(cap));
  check("Alle 5 Kapitulations-Flags gesetzt", cap.flags.length === 5, cap.flags.join(","));

  // Euphorie: hoher Premium, Puell > 4, Buy-Signal, Akkumulation
  const eup = classifyMinerZone({
    spotPrice: 120000, breakeven: 40000, puell: 4.5,
    hashRibbonSignal: "buy", difficultyCompression: "neutral", mpiZone: "accumulation",
  });
  check("Euphorie-Setup → zone=euphoria (score>80)", eup.zone === "euphoria" && eup.score > 80, JSON.stringify(eup));

  // Neutral-profitabel
  const prof = classifyMinerZone({
    spotPrice: 55000, breakeven: 40000, puell: 1.2,
    hashRibbonSignal: "neutral", difficultyCompression: "neutral", mpiZone: "neutral",
  });
  check("Moderater Premium → zone=profitable", prof.zone === "profitable", JSON.stringify(prof));

  // Puell null = kein Signal (kein Fake-Default)
  const noPuell = classifyMinerZone({
    spotPrice: 55000, breakeven: 40000, puell: null,
    hashRibbonSignal: "neutral", difficultyCompression: "neutral", mpiZone: "neutral",
  });
  check("Puell=null verändert Score nicht (65 = 50+15 Premium)", noPuell.score === 65, `got ${noPuell.score}`);

  // Übergang: Spot ≈ Breakeven, Ribbon-Kapitulation
  const trans = classifyMinerZone({
    spotPrice: 40000, breakeven: 40000, puell: 0.9,
    hashRibbonSignal: "capitulation", difficultyCompression: "neutral", mpiZone: "neutral",
  });
  check("Spot≈Breakeven + Ribbon-Kapitulation → transition (score 35)", trans.zone === "transition" && trans.score === 35, JSON.stringify(trans));
}

// ─── Serien-Builder + Segmente ────────────────────────────────────────────────
console.log("\nbuildMinerZoneSeries + buildZoneSegments");
{
  const n = 90;
  const dates = Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1 + i)).toISOString().split("T")[0]);
  const hashrate = Array.from({ length: n }, () => 900);
  const flat = hashrate.map(() => 900);
  const priceByDate = new Map<string, number>();
  // Erste Hälfte tief unter Breakeven (~$59k bei 900 EH), zweite Hälfte weit darüber
  dates.forEach((d, i) => priceByDate.set(d, i < n / 2 ? 20000 : 120000));
  const puellByDate = new Map<string, number>();
  dates.forEach((d, i) => puellByDate.set(d, i < n / 2 ? 0.4 : 1.5));

  const series = buildMinerZoneSeries({
    dates, hashrateEH: hashrate, ma30: flat, ma60: flat,
    priceByDate, puellByDate, assumptions: DEFAULT_FLEET,
  });
  check("Serie hat volle Länge", series.length === n);
  check("Erste Hälfte klassifiziert als capitulation", series[10].zone === "capitulation", String(series[10].zone));
  check("Zweite Hälfte klassifiziert als profitable", series[n - 5].zone === "profitable", String(series[n - 5].zone));

  const segments = buildZoneSegments(series);
  check("Genau 2 zusammenhängende Zonen-Segmente", segments.length === 2, `got ${segments.length}`);
  check("Segment 1 = capitulation, Segment 2 = profitable",
    segments[0]?.zone === "capitulation" && segments[1]?.zone === "profitable");
}

// ─── Ergebnis ─────────────────────────────────────────────────────────────────
console.log(failed === 0 ? "\n✅ Alle Miner-Metrics-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
