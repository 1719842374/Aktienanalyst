/**
 * Landesmitte aus einem TopoJSON-Atlas (world-atlas countries-110m).
 * Der Punkt ist der sphärische Schwerpunkt (d3.geoCentroid). Liegt er
 * außerhalb, etwa weil ein Archipel die Mitte ins Meer setzt, gilt der
 * sphärische Schwerpunkt des größten Teilpolygons, das ihn enthält.
 * Ein flacher Schwerpunkt über die Datumsgrenze wird nicht verwendet.
 * Kein fester Koordinatenersatz für ein einzelnes Land.
 */
import type { Geometry, Polygon, Position } from "geojson";
import { geoArea, geoCentroid, geoContains } from "d3-geo";
import { feature } from "topojson-client";

export interface TopologyArcPoint {
  0: number;
  1: number;
}

export interface TopologyTransform {
  scale: [number, number];
  translate: [number, number];
}

export interface TopologyGeometry {
  type: string;
  id?: string | number;
  arcs?: unknown;
  geometries?: TopologyGeometry[];
}

export interface CountryTopology {
  arcs: TopologyArcPoint[][];
  transform?: TopologyTransform;
  objects: Record<string, { type: string; geometries?: TopologyGeometry[] }>;
}

export interface LonLat {
  lon: number;
  lat: number;
}

function assertNever(value: never): never {
  throw new Error(`unbehandelte Geometrie: ${String(value)}`);
}

function wrapLon(lon: number): number {
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped === 0 ? 0 : wrapped;
}

function asLonLat(point: [number, number]): LonLat | null {
  const lon = wrapLon(point[0]);
  const lat = point[1];
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  return { lon, lat };
}

function sphericalCentroid(geometry: Geometry): LonLat | null {
  return asLonLat(geoCentroid(geometry));
}

function contains(geometry: Geometry, point: LonLat): boolean {
  return geoContains(geometry, [point.lon, point.lat]);
}

function polygonsOf(geometry: Geometry): Polygon[] {
  switch (geometry.type) {
    case "Polygon":
      return [geometry];
    case "MultiPolygon":
      return geometry.coordinates.map(coordinates => ({ type: "Polygon", coordinates }));
    case "GeometryCollection":
      return geometry.geometries.flatMap(polygonsOf);
    case "Point":
    case "MultiPoint":
    case "LineString":
    case "MultiLineString":
      return [];
    default:
      return assertNever(geometry);
  }
}

function meanPosition(points: readonly Position[]): LonLat | null {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const lon = point[0] * Math.PI / 180;
    const lat = point[1] * Math.PI / 180;
    const cos = Math.cos(lat);
    x += cos * Math.cos(lon);
    y += cos * Math.sin(lon);
    z += Math.sin(lat);
  }
  if (x === 0 && y === 0 && z === 0) return null;
  return asLonLat([
    Math.atan2(y, x) * 180 / Math.PI,
    Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
  ]);
}

/** Schwerpunkt eines Dreiecks im Ring, das im Land liegt. Größte Kugelfläche gewinnt. */
function interiorPoint(polygon: Polygon, country: Geometry): LonLat | null {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 3) return null;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const n = closed ? ring.length - 1 : ring.length;
  if (n < 3) return null;
  let best: LonLat | null = null;
  let bestArea = 0;
  let seen = false;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const c = ring[(i + 2) % n];
    const mean = meanPosition([a, b, c]);
    if (!mean || !contains(country, mean)) continue;
    const area = Math.abs(geoArea({ type: "Polygon", coordinates: [[a, b, c, a]] }));
    if (!seen || area > bestArea) {
      best = mean;
      bestArea = area;
      seen = true;
    }
  }
  return best;
}

function pointInCountry(geometry: Geometry): LonLat | null {
  const whole = sphericalCentroid(geometry);
  if (whole && contains(geometry, whole)) return whole;
  const polygons = polygonsOf(geometry)
    .map(polygon => ({ polygon, area: geoArea(polygon) }))
    .sort((a, b) => b.area - a.area);
  for (const item of polygons) {
    const centroid = sphericalCentroid(item.polygon);
    if (centroid && contains(geometry, centroid)) return centroid;
  }
  for (const item of polygons) {
    const inside = interiorPoint(item.polygon, geometry);
    if (inside) return inside;
  }
  return null;
}

/** Schlüssel sind die Atlas-Id und dieselbe Id auf drei Stellen aufgefüllt. */
export function countryCentroids(topology: CountryTopology, objectName = "countries"): Map<string, LonLat> {
  const object = topology.objects[objectName];
  const out = new Map<string, LonLat>();
  if (!object) return out;
  const collection = feature(topology, object);
  for (const entry of collection.features) {
    if (entry.id == null || !entry.geometry) continue;
    const point = pointInCountry(entry.geometry);
    if (!point) continue;
    const id = String(entry.id);
    out.set(id, point);
    out.set(id.padStart(3, "0"), point);
  }
  return out;
}
