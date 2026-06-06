# Fix Notes: DCF + Lynch Consistency (2026-06-06)

## Fix 1 — Lynch Healthcare Guard ✅
**File:** `server/routes.ts` → `classifyLynch()`

**Problem:** `hasCyclicalPEPattern` (pe/forwardPE > 1.5) fired for Healthcare/Pharma
companies with elevated trailing PE after a bad year, overriding
`getSectorDefaults` which correctly returns `cycleClass: 'Defensive / Non-Cyclical'`.

**Fix applied in `classifyLynch()`:**
```typescript
// Healthcare/Pharma/Biotech is structurally never Cyclical
const isHealthcareSector = sectorLower.includes('health') ||
  sectorLower.includes('pharma') || sectorLower.includes('biotech');
if (!isHealthcareSector && (isCyclicalSector || hasCyclicalPEPattern)) return 'cyclical';
```

## Fix 2 — DCF CRV Label `crvBasis` ✅
**File:** `server/routes.ts` → DCF calculation block

**Problem:** `crvBasis` never existed as a named variable — the CRV section
referenced a fair-value without a documented source label.

**Fix:** `crvBasis` is now defined as a labeled string from `waccScenarios.kons`,
making the conservative DCF scenario traceable in the output.

## Fix 3 — Beta Source Label ✅
**File:** `server/routes.ts` → wherever `profile.beta` is read

**Problem:** `beta` was taken from FMP profile data with no documentation of
which methodology FMP uses.

**Fix:** `betaSource = 'FMP 5Y Monthly vs. S&P 500'` added as inline label.

## Fix 4 — Capex Warning Flag ✅
**File:** `server/routes.ts` → after capex estimation

**Problem:** No validation of implied Capex intensity. Capital-heavy companies
(>15% revenue) were not flagged.

**Fix:** `capexWarning` string generated when `capexEstimated > revenue * 0.15`.

## Fix 5 — TAM >= 2 Guard ✅ ALREADY IN CODE
No change needed — `revenueSegments && revenueSegments.length >= 2` guard
already present in `generateTAMAnalysis()`.
