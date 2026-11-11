import * as rsmNs from "react-simple-maps";

type MapsApi = typeof import("react-simple-maps");

/**
 * tsx lädt das CJS-Build und sieht die benannten Exporte nur unter default.
 * Der Bundler sieht sie auf dem Namespace. Dieselbe Komponente in beiden Fällen.
 */
function resolveMaps(ns: MapsApi): MapsApi {
  const withDefault = ns as MapsApi & { default?: MapsApi };
  return withDefault.default ?? ns;
}

const maps = resolveMaps(rsmNs as unknown as MapsApi);

export const ComposableMap = maps.ComposableMap;
export const Geographies = maps.Geographies;
export const Geography = maps.Geography;
export const Marker = maps.Marker;
export const useMapContext = maps.useMapContext;
