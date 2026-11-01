/**
 * F10-22: Quartalsmengen aus server/data/gold-mine-production.json.
 * z-Score über adaptiveZ (dieselbe Mindestlänge wie die Gold-Schicht). Kein GIS.
 */
import type { GoldMineProductionFile, GoldMineSupplyResponse } from "../shared/gold-mine-supply";
import { buildGoldMineSupply } from "../shared/gold-mine-supply";
import { Z_HISTORY_MIN, adaptiveZ } from "./gold-adaptive-score";
import bundled from "./data/gold-mine-production.json";

export function loadGoldMineSupply(file?: GoldMineProductionFile): GoldMineSupplyResponse {
  const parsed = (file ?? bundled) as GoldMineProductionFile;
  return buildGoldMineSupply(parsed, adaptiveZ, Z_HISTORY_MIN);
}
