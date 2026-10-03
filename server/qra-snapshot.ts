/**
 * QRA Q3 2026 — Quartals-JSON. Anker, kein Live-Score.
 * Spec: Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md §4.3
 */
export const QRA_SNAPSHOT = {
  asOf: "2026-08-05",
  nextRelease: "2026-11-04",
  quarter: "2026Q3",
  sourceUrl: "https://home.treasury.gov/policy-issues/financing-the-government/quarterly-refunding/most-recent-quarterly-refunding-documents",
  kennzeichnung: "QRA-Tabelle, keine Live-Messung",
  netMarketableBorrowingBn: 739,
  netCouponIssuanceBn: 375,
  assumedBuybacksBn: 45,
  impliedBillChangeBn: 409,
  tgaEndJunBn: 919,
  tgaEndSepBn: 950,
  tgaEndDecBn: 850,
  couponSizesUnchanged: true,
} as const;

export function qraIdentityHolds(s = QRA_SNAPSHOT, tol = 1): boolean {
  const implied = s.netMarketableBorrowingBn - s.netCouponIssuanceBn + s.assumedBuybacksBn;
  return Math.abs(implied - s.impliedBillChangeBn) <= tol;
}
