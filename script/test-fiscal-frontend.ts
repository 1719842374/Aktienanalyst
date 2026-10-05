/**
 * Fiscal-Frontend fixtures — reine Formeln, kein Netz.
 * Spec: Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md Abschnitt 8.
 * Run: bun script/test-fiscal-frontend.ts
 */
import { readFileSync } from "node:fs";
import { macroIndicatorFromFiscal } from "../client/src/lib/btcAnalysis";
import { qraIdentityHolds, QRA_SNAPSHOT } from "../server/qra-snapshot";
import {
  WSHOBL_FIXTURE_2026_08_26_MIO,
  adaptiveFiscal,
  frontEndImpulse,
  macroFiscalGis,
  monthlyFrontEndBn,
  netBillSupplyFromStock,
  qraBillAnchor30,
  sOfZ,
} from "../server/fiscal-frontend-math";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("Fiscal-Frontend fixtures");

const nbJul = netBillSupplyFromStock(6988.891, 6690.689);
ok("6988.891 − 6690.689 = 298.202", Math.abs(nbJul - 298.202) < 1e-6, String(nbJul));

ok("739 − 375 + 45 = 409", QRA_SNAPSHOT.netMarketableBorrowingBn - QRA_SNAPSHOT.netCouponIssuanceBn + QRA_SNAPSHOT.assumedBuybacksBn === 409);
ok("qraIdentityHolds() === true", qraIdentityHolds() === true);

const anchor = qraBillAnchor30(409);
ok("409 * 30/91 ∈ [134.7, 134.9]", anchor >= 134.7 && anchor <= 134.9, String(anchor));

ok("s(0)=50", sOfZ(0) === 50, String(sOfZ(0)));
ok("s(2)=100", sOfZ(2) === 100, String(sOfZ(2)));
ok("s(-2)=0", sOfZ(-2) === 0, String(sOfZ(-2)));
ok("s(1)=75", sOfZ(1) === 75, String(sOfZ(1)));

ok("clip((75-50)/25) = 1", macroFiscalGis(75) === 1, String(macroFiscalGis(75)));
ok("clip((62.5-50)/25) = 0.5", macroFiscalGis(62.5) === 0.5, String(macroFiscalGis(62.5)));

const missing = frontEndImpulse({ d30: 2.47, fedBills: null, netSupply: null });
ok("frontEnd ohne N^b und Fed: available === false", missing.available === false && missing.fe30 == null, JSON.stringify(missing));

const feJul = frontEndImpulse({ d30: 2.5, fedBills: 20, netSupply: 298 });
ok("frontEnd 2.5+20−298 ≈ −275.5", feJul.available === true && feJul.fe30 != null && Math.abs(feJul.fe30 - (-275.5)) < 1e-9, String(feJul.fe30));

ok("WSHOBL Fixture 2026-08-26 = 541995 Mio.", WSHOBL_FIXTURE_2026_08_26_MIO === 541995);

const empty = {
  nl13w: [] as number[],
  di90: [] as number[],
  notes13w: [] as number[],
  bills13w: [] as number[],
  feMonthly: [] as number[],
  tga4w: [] as number[],
  buybackK30: [] as { date: string; k30Bn: number }[],
};
const before = adaptiveFiscal({ asOf: "2026-09-08", ...empty });
const after = adaptiveFiscal({ asOf: "2026-09-09", ...empty });
ok(
  "Score ändert sich nicht, wenn asOf von 2026-09-08 auf 2026-09-09 springt (ohne Ops)",
  before.deskFlag === after.deskFlag
    && before.s === after.s
    && before.macroFiscal === after.macroFiscal
    && before.sM.score === after.sM.score
    && before.sF.score === after.sF.score
    && before.sD.score === after.sD.score
    && before.deskFlag === 0,
  JSON.stringify({ before, after }),
);

const feMonth = monthlyFrontEndBn(
  [
    { date: "2026-06-30", value: 6690.689 },
    { date: "2026-07-31", value: 6988.891 },
  ],
  [
    { date: "2026-07-03", value: 521995 },
    { date: "2026-07-31", value: 541995 },
  ],
);
ok(
  "FE_Δm Juli = 20 − 298.202, ohne D_30",
  feMonth.length === 1 && Math.abs(feMonth[0] - (20 - 298.202)) < 1e-6,
  JSON.stringify(feMonth),
);

const shortFe = adaptiveFiscal({
  asOf: "2026-09-08",
  ...empty,
  feMonthly: Array.from({ length: 12 }, (_, i) => i),
  tga4w: Array.from({ length: 27 }, (_, i) => i),
});
ok("S_F* bleibt zu bei 11 Vormonaten", shortFe.sF.available === false && shortFe.sF.display === 50);

const longFe = adaptiveFiscal({
  asOf: "2026-09-08",
  ...empty,
  feMonthly: Array.from({ length: 13 }, (_, i) => i - 6),
  tga4w: Array.from({ length: 27 }, (_, i) => (i % 5) - 2),
});
const longFeNext = adaptiveFiscal({
  asOf: "2026-09-09",
  ...empty,
  feMonthly: Array.from({ length: 13 }, (_, i) => i - 6),
  tga4w: Array.from({ length: 27 }, (_, i) => (i % 5) - 2),
});
ok("S_F* verfügbar ab 12 Vormonaten und 26 TGA-Punkten", longFe.sF.available === true && longFe.sF.score != null);
ok(
  "S_F* ändert sich nicht, wenn asOf ohne Ops springt",
  longFe.sF.score === longFeNext.sF.score && longFe.s === longFeNext.s && longFe.deskFlag === 0,
);

const ffrHigh = macroIndicatorFromFiscal(5.1, { frontEndImpulse: { available: false }, adaptiveScore: { macroFiscal: 1 } });
const ffrLow = macroIndicatorFromFiscal(2.5, null);
const ffrMid = macroIndicatorFromFiscal(4, { frontEndImpulse: { available: true }, adaptiveScore: { macroFiscal: null } });
const fiscalOn = macroIndicatorFromFiscal(5.5, {
  frontEndImpulse: { available: true },
  adaptiveScore: { macroFiscal: 0.5, displayS: 62.5 },
});
const clipped = macroIndicatorFromFiscal(2, {
  frontEndImpulse: { available: true },
  adaptiveScore: { macroFiscal: 2, displayS: 100 },
});
ok("ohne FE bleibt FFR > 5 bei −1", ffrHigh.fromFiscal === false && ffrHigh.score === -1 && ffrHigh.value.startsWith("FFR "));
ok("ohne FE bleibt FFR < 3 bei +1", ffrLow.fromFiscal === false && ffrLow.score === 1);
ok("FE ohne MacroFiscal lässt das FFR-Niveau stehen", ffrMid.fromFiscal === false && ffrMid.score === 0);
ok("FE.available ersetzt den Slot durch score_MacroFiscal", fiscalOn.fromFiscal === true && fiscalOn.score === 0.5 && fiscalOn.value === "S 62.5");
ok("GIS-Overlay bleibt in [−1, 1]", clipped.score === 1 && clipped.score >= -1 && clipped.score <= 1);

const analysisSrc = readFileSync(new URL("../client/src/lib/btcAnalysis.ts", import.meta.url), "utf8");
ok(
  "Macro-Gewicht bleibt 0.15, GWS und Monte Carlo unverändert",
  analysisSrc.includes('name: "Macro (Fed/M2)"')
    && analysisSrc.includes("weight: 0.15")
    && analysisSrc.includes("const gwsValue = gis * 0.30 + powerSignal * 0.50 + cycleSignal * 0.20")
    && analysisSrc.includes("const ST = S0 * Math.exp((mu - (sigmaAdj * sigmaAdj) / 2) * T + sigmaAdj * Math.sqrt(T) * Z)"),
);

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
