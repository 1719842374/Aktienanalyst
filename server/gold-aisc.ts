/**
 * Future_10 §5 (Ticket B1): Quartals-AISC aus server/data/gold-aisc.json für den Gold-Chart.
 *
 * Kette: server/data/gold-aisc.json -> loadGoldAiscSeries() -> gold-routes.ts buildGoldAnalysis
 * -> Response-Feld `aiscLine` (GET /api/analyze-gold) -> GoldDashboard useQuery -> GoldPriceChart.
 *
 * Nur Anzeige. `aisc: null` an scoreGoldAdaptive, GIS und getTechnicalScore bleiben unverändert (B2).
 * Ungültige oder fehlende Datei: null (Chart zeigt „AISC n/a“), nie Ersatzwerte.
 *
 * Prod: Die JSON-Datei wird importiert, esbuild bündelt sie in dist/index.cjs. Damit hängt die Linie
 * nicht vom cwd des Prozesses ab (vorher fs relativ zu process.cwd(): aus anderem cwd -> ENOENT -> null).
 */
import fs from "fs";
import path from "path";
import type { GoldAiscSeries } from "../shared/schema";
import { buildGoldAiscSeries, validateGoldAiscFile, type GoldAiscFile } from "../shared/gold-aisc";
import bundledGoldAisc from "./data/gold-aisc.json";

export const GOLD_AISC_FILE = path.join("server", "data", "gold-aisc.json");

let cached: { mtimeMs: number; series: GoldAiscSeries | null } | null = null;
let bundled: { series: GoldAiscSeries | null } | null = null;

/** Prüft die Daten und baut die Reihe; ungültig -> null + Warnung. */
function seriesFrom(parsed: GoldAiscFile, label: string): GoldAiscSeries | null {
  const errors = validateGoldAiscFile(parsed);
  if (errors.length > 0) {
    console.warn(`[GOLD-AISC] ${label} ungültig, keine AISC-Linie: ${errors.slice(0, 5).join("; ")}`);
    return null;
  }
  return buildGoldAiscSeries(parsed);
}

/**
 * Ohne Argument: die gebündelte server/data/gold-aisc.json (cwd-unabhängig, einmal geprüft).
 * Mit Pfad: Datei per fs lesen und prüfen (Tests/Werkzeuge), Cache bis zur nächsten Änderung.
 */
export function loadGoldAiscSeries(file?: string): GoldAiscSeries | null {
  if (file === undefined) {
    if (!bundled) bundled = { series: seriesFrom(bundledGoldAisc as GoldAiscFile, GOLD_AISC_FILE) };
    return bundled.series;
  }
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.series;
    const series = seriesFrom(JSON.parse(fs.readFileSync(file, "utf-8")) as GoldAiscFile, file);
    cached = { mtimeMs, series };
    return series;
  } catch (err: any) {
    console.warn(`[GOLD-AISC] ${file} nicht lesbar, keine AISC-Linie: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}
