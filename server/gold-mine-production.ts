/**
 * USGS-Weltproduktion für den Gold-Layer der Researcher-Karte.
 * Die JSON-Datei wird importiert, damit esbuild sie in dist/index.cjs bündelt.
 * Koordinaten kommen aus dem Atlas. Fehlt ein Land dort, bleibt es ohne Bubble.
 */
import { GEO_MAP_COUNTRIES } from "@shared/geo-map";
import {
  type GoldMapProductionInput,
  type GoldProductionPlacement,
  type GoldProductionTable,
} from "@shared/gold-mine-production";
import { countryCentroids, type CountryTopology } from "@shared/topojson-centroid";
import bundledGoldMineProduction from "./data/gold-mine-production.json";
import worldAtlas from "world-atlas/countries-110m.json";

/** null nur, wenn die gebündelte Tabelle selbst fehlt. Ein leerer Atlas liefert die Tabelle ohne Punkte. */
export function loadGoldMapProduction(): GoldMapProductionInput | null {
  const table = bundledGoldMineProduction as GoldProductionTable;
  if (!table || !Array.isArray(table.rows) || typeof table.unit !== "string" || typeof table.source !== "string" || typeof table.sourceUrl !== "string") {
    return null;
  }
  let centroids = new Map<string, { lon: number; lat: number }>();
  try {
    centroids = countryCentroids(worldAtlas as unknown as CountryTopology);
  } catch {
    centroids = new Map();
  }
  const placements: GoldProductionPlacement[] = [];
  for (const row of table.rows) {
    const iso2 = row.iso2?.trim().toUpperCase();
    const isoNum = row.isoNum?.trim();
    if (!iso2 || !isoNum) continue;
    const centroid = centroids.get(isoNum) ?? centroids.get(isoNum.padStart(3, "0"));
    if (!centroid) continue;
    const known = GEO_MAP_COUNTRIES.find(country => country.iso2 === iso2);
    placements.push({
      iso2,
      isoNum,
      name: known?.name ?? row.country,
      lat: centroid.lat,
      lon: centroid.lon,
    });
  }
  return { table, placements };
}
