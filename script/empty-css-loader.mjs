const MAP_STUB = `
export function ComposableMap() { return null; }
export function Geographies() { return null; }
export function Geography() { return null; }
export function Marker() { return null; }
export function useMapContext() { return {}; }
export default {};
`;

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default {}", shortCircuit: true };
  }
  if (url.includes("react-simple-maps")) {
    return { format: "module", source: MAP_STUB, shortCircuit: true };
  }
  return nextLoad(url, context);
}
