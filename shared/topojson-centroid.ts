/**
 * Landesmitte aus einem TopoJSON-Atlas (world-atlas countries-110m).
 * Die Mitte ist der Flächenschwerpunkt des größten Außenrings.
 * Kein fester Koordinatenersatz, wenn die Geometrie fehlt.
 */

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

function decodeArc(topology: CountryTopology, index: number): LonLat[] {
  const negative = index < 0;
  const arc = topology.arcs[negative ? ~index : index];
  if (!arc) return [];
  const transform = topology.transform;
  let x = 0;
  let y = 0;
  const points: LonLat[] = [];
  for (const pair of arc) {
    x += pair[0];
    y += pair[1];
    if (transform) {
      points.push({ lon: x * transform.scale[0] + transform.translate[0], lat: y * transform.scale[1] + transform.translate[1] });
    } else {
      points.push({ lon: x, lat: y });
    }
  }
  if (negative) points.reverse();
  return points;
}

function stitch(topology: CountryTopology, indexes: readonly number[]): LonLat[] {
  const line: LonLat[] = [];
  for (const index of indexes) {
    const points = decodeArc(topology, index);
    if (line.length > 0 && points.length > 0) points.shift();
    line.push(...points);
  }
  return line;
}

function asIndexList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== "number")) return null;
  return value as number[];
}

function outerRings(topology: CountryTopology, geometry: TopologyGeometry): LonLat[][] {
  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.arcs) || geometry.arcs.length === 0) return [];
    const ring = asIndexList(geometry.arcs[0]);
    return ring ? [stitch(topology, ring)] : [];
  }
  if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.arcs)) return [];
    const rings: LonLat[][] = [];
    for (const polygon of geometry.arcs) {
      if (!Array.isArray(polygon) || polygon.length === 0) continue;
      const ring = asIndexList(polygon[0]);
      if (ring) rings.push(stitch(topology, ring));
    }
    return rings;
  }
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries ?? []).flatMap(child => outerRings(topology, child));
  }
  return [];
}

function openCount(ring: readonly LonLat[]): number {
  const n = ring.length;
  if (n > 1 && ring[0].lon === ring[n - 1].lon && ring[0].lat === ring[n - 1].lat) return n - 1;
  return n;
}

function ringArea(ring: readonly LonLat[]): number {
  const n = openCount(ring);
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    area += a.lon * b.lat - b.lon * a.lat;
  }
  return area / 2;
}

function ringCentroid(ring: readonly LonLat[]): LonLat | null {
  const n = openCount(ring);
  if (n === 0) return null;
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const cross = a.lon * b.lat - b.lon * a.lat;
    twice += cross;
    cx += (a.lon + b.lon) * cross;
    cy += (a.lat + b.lat) * cross;
  }
  const area = twice / 2;
  if (area === 0) {
    let lon = 0;
    let lat = 0;
    for (let i = 0; i < n; i++) {
      lon += ring[i].lon;
      lat += ring[i].lat;
    }
    return { lon: lon / n, lat: lat / n };
  }
  return { lon: cx / (3 * twice), lat: cy / (3 * twice) };
}

function largestRingCentroid(rings: readonly LonLat[][]): LonLat | null {
  let best: LonLat[] | null = null;
  let bestArea = 0;
  let seen = false;
  for (const ring of rings) {
    const area = Math.abs(ringArea(ring));
    if (!seen || area > bestArea) {
      best = ring.slice();
      bestArea = area;
      seen = true;
    }
  }
  if (!best) return null;
  return ringCentroid(best);
}

/** Schlüssel sind die Atlas-Id und dieselbe Id auf drei Stellen aufgefüllt. */
export function countryCentroids(topology: CountryTopology, objectName = "countries"): Map<string, LonLat> {
  const collection = topology.objects[objectName];
  const out = new Map<string, LonLat>();
  for (const geometry of collection?.geometries ?? []) {
    if (geometry.id == null) continue;
    const centroid = largestRingCentroid(outerRings(topology, geometry));
    if (!centroid || !Number.isFinite(centroid.lon) || !Number.isFinite(centroid.lat)) continue;
    const id = String(geometry.id);
    out.set(id, centroid);
    out.set(id.padStart(3, "0"), centroid);
  }
  return out;
}
