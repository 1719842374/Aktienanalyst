/**
 * Fixtures Abschnitt 8 — Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md
 * Run: bun script/test-fiscal-frontend.ts
 */
import { BESSENT_WINDOW, classifyPolicy } from "../server/liquidity-regime-math";
import { QRA_SNAPSHOT, qraIdentityHolds } from "../server/qra-snapshot";
import {
  WSHOBL_2026_08_26_MIO,
  assembleFiscalFrontend,
  deskFromOps,
  frontEndImpulse,
  macroFiscalGis,
  netBillSupplyFromAuctions,
  netBillSupplyFromStock,
  qraBillChange30,
  sOfZ,
  type FiscalRawInputs,
} from "../server/fiscal-frontend-math";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function near(actual: number, expected: number, tol = 1e-9): boolean {
  return Math.abs(actual - expected) <= tol;
}

console.log("fiscal-frontend fixtures");

const nb = netBillSupplyFromStock(6988.891, 6690.689);
ok("1 6988.891 − 6690.689 = 298.202", near(nb, 298.202, 1e-6), String(nb));

ok("2 739 − 375 + 45 = 409", QRA_SNAPSHOT.netMarketableBorrowingBn - QRA_SNAPSHOT.netCouponIssuanceBn + QRA_SNAPSHOT.assumedBuybacksBn === 409);
ok("2 qraIdentityHolds", qraIdentityHolds() === true);

const qra30 = qraBillChange30(409);
ok("3 409 * 30/91 in [134.7, 134.9]", qra30 >= 134.7 && qra30 <= 134.9, String(qra30));

ok("4 s(0)=50", sOfZ(0) === 50);
ok("4 s(2)=100", sOfZ(2) === 100);
ok("4 s(-2)=0", sOfZ(-2) === 0);
ok("4 s(1)=75", sOfZ(1) === 75);

ok("5 clip((75-50)/25)=1", macroFiscalGis(75) === 1);
ok("5 clip((62.5-50)/25)=0.5", macroFiscalGis(62.5) === 0.5);

const missing = frontEndImpulse({ d30: 2.47, fedBills: null, netSupply: null });
ok("6 FE ohne N^b und ohne Fed nicht available", missing.available === false && missing.value == null);

const july = frontEndImpulse({ d30: 2.5, fedBills: 20, netSupply: 298 });
ok("7 FE 2.5+20−298 ≈ −275.5", july.available && july.value != null && near(july.value, -275.5), String(july.value));

ok("8 WSHOBL 2026-08-26 = 541995 Mio", WSHOBL_2026_08_26_MIO === 541995);

function raw(asOf: string): FiscalRawInputs {
  return {
    asOf,
    fetchedAt: `${asOf}T00:00:00.000Z`,
    deltaMcapUsd: null,
    mspd: [],
    auctions: [],
    wshobl: [],
    wshotsl: [],
    dff: [],
    walcl: [],
    rrp: [],
    tga: [],
    buybacks: [],
    tgaOpeningMil: null,
    liveVarianceMonths: 0,
    genius: { legal: 1, rulemakingNote: "L=1" },
  };
}

const before = assembleFiscalFrontend(raw("2026-09-08"));
const after = assembleFiscalFrontend(raw("2026-09-09"));
ok(
  "9 Score ändert sich nicht, wenn asOf ohne Ops ins Fenster springt",
  before.adaptiveScore.display === after.adaptiveScore.display
    && before.desk.flag === 0
    && after.desk.flag === 0
    && before.adaptiveScore.s === after.adaptiveScore.s,
  `before=${before.adaptiveScore.display}/${before.desk.flag} after=${after.adaptiveScore.display}/${after.desk.flag}`,
);
ok("9 classifyPolicy liest das Fenster nicht", classifyPolicy({ asOf: "2026-09-09" }).treasuryDurationActive === false);
ok("9 Fenster bleibt Hint", BESSENT_WINDOW.from === "2026-09-09" && BESSENT_WINDOW.to === "2026-11-04" && BESSENT_WINDOW.capBn === 4);
ok(
  "9 Desk ohne Ops bleibt 0 im Fenster",
  deskFromOps({ asOf: "2026-09-09", lastOpDate: null, k30: null, historyK30: [] }) === 0,
);

const auctionNet = netBillSupplyFromAuctions([
  {
    auctionDate: "2026-09-10",
    maturityDate: "2026-11-01",
    offeringUsd: 100e9,
    acceptedUsd: 100e9,
    isBillOrCmb: true,
  },
  {
    auctionDate: "2026-08-01",
    maturityDate: "2026-09-15",
    offeringUsd: 40e9,
    acceptedUsd: 40e9,
    isBillOrCmb: true,
  },
], "2026-10-03");
ok(
  "Auctions: Offering im Fenster minus fälliges total_accepted",
  auctionNet != null && near(auctionNet.gBn, 100) && near(auctionNet.mBn, 40) && near(auctionNet.n30Bn, 60),
  JSON.stringify(auctionNet),
);

console.log("\nBestehende C2-Fixtures separat: bun script/test-liquidity-regime.ts");

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
