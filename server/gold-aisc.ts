/**
 * Future_10 §5 (Ticket B1): Quartals-AISC aus server/data/gold-aisc.json für den Gold-Chart.
 *
 * Kette: server/data/gold-aisc.json -> loadGoldAiscSeries() -> gold-routes.ts buildGoldAnalysis
 * -> Response-Feld `aiscLine` (GET /api/analyze-gold) -> GoldDashboard useQuery -> GoldPriceChart.
 *
 * Nur Anzeige. `aisc: null` an scoreGoldAdaptive, GIS und getTechnicalScore bleiben unverändert (B2).
 * Ungültige oder fehlende Datei: null (Chart zeigt „AISC n/a“), nie Ersatzwerte.
 */
import fs from "fs";
import path from "path";
import type { GoldAiscSeries } from "../shared/schema";
import { buildGoldAiscSeries, validateGoldAiscFile, type GoldAiscFile } from "../shared/gold-aisc";

export const GOLD_AISC_FILE = path.join("server", "data", "gold-aisc.json");

let cached: { mtimeMs: number; series: GoldAiscSeries | null } | null = null;

/** Liest und prüft die Datei (cwd = Repo-Wurzel wie bei cache-seed.json; Docker: /app). Cache bis zur nächsten Änderung. */
export function loadGoldAiscSeries(file: string = path.join(process.cwd(), GOLD_AISC_FILE)): GoldAiscSeries | null {
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.series;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as GoldAiscFile;
    const errors = validateGoldAiscFile(parsed);
    if (errors.length > 0) {
      console.warn(`[GOLD-AISC] ${file} ungültig, keine AISC-Linie: ${errors.slice(0, 5).join("; ")}`);
      cached = { mtimeMs, series: null };
      return null;
    }
    const series = buildGoldAiscSeries(parsed);
    cached = { mtimeMs, series };
    return series;
  } catch (err: any) {
    console.warn(`[GOLD-AISC] ${file} nicht lesbar, keine AISC-Linie: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}
