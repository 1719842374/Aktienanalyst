// Gemeinsamer In-Memory-Cache fuer den Thesis-Strength-Endpunkt. Die
// Invalidierung wird nach erfolgreichem KI-Enrich aus analyze-route.ts genutzt.
export const thesisStrengthCache = new Map<string, { data: any; time: number }>();

// Kurze, deterministische Signatur als Cache-Diskriminator: Anzahl,
// generic-Verteilung und Reihenfolge/Namen der uebergebenen Katalysatoren.
export function catalystSignature(catalysts: any[] | undefined): string {
  if (!Array.isArray(catalysts) || catalysts.length === 0) return "none";
  const genericCount = catalysts.filter(c => c?.generic === true).length;
  const namesHash = catalysts.map(c => String(c?.name ?? "")).join("|");
  let hash = 0;
  for (let i = 0; i < namesHash.length; i++) {
    hash = (hash * 31 + namesHash.charCodeAt(i)) | 0;
  }
  return `${catalysts.length}_${genericCount}_${hash}`;
}

// Entfernt alle Signatur-Varianten eines Tickers nach einer Katalysator-Aenderung.
export function invalidateThesisStrengthCache(ticker: string): void {
  const prefix = `${String(ticker).toUpperCase()}::`;
  for (const key of Array.from(thesisStrengthCache.keys())) {
    if (key.startsWith(prefix)) thesisStrengthCache.delete(key);
  }
}
