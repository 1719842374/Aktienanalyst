/**
 * Fiscal-Frontend fixtures — reine Formeln, kein Netz.
 * Spec: Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md Abschnitt 8.
 * Run: bun script/test-fiscal-frontend.ts
 */
import { qraIdentityHolds, QRA_SNAPSHOT } from "../server/qra-snapshot";
import {
  WSHOBL_FIXTURE_2026_08_26_MIO,
  adaptiveFiscal,
  frontEndImpulse,
  macroFiscalGis,
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

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
