declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): {
    type: "FeatureCollection";
    features: Array<{
      id?: string | number;
      geometry: import("geojson").Geometry | null;
    }>;
  };
}
