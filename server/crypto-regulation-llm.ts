/**
 * OpenRouter-Auftrag fuer Sektion 14.
 * Gleicher JSON-Aufruf wie der Researcher (callLLMJson, Modellkette, 6h-Cache),
 * aber nur Krypto-Regulierungen und der Liquiditaetstracker.
 * Kein Gesetzesname und keine Person im Auftrag. Gemessene Serien stehen nur
 * als Kontext. Der Score liest sie nicht aus der Modellantwort.
 */

export interface PolicyScanMeasuredInput {
  asOf: string;
  jurisdiction: string;
  stablecoinMcapUsd: number | null;
  mcapChange30dUsd: number | null;
  defiTvlUsd: number | null;
  defiTvlChange30dUsd: number | null;
  tgaBn: number | null;
  dgs10: number | null;
  m2Bn: number | null;
}

export const POLICY_SCAN_SYSTEM_PROMPT =
  "Du antwortest nur mit JSON. Erfinde keine gemessenen Zahlen und keine URLs. regulations fuellen, auch ohne URL, dann confidence estimated. instruments nur mit https und Datum.";

export function buildPolicyScanPrompt(measured: PolicyScanMeasuredInput): string {
  const m = measured;
  return `Heute ist ${m.asOf}. Jurisdiktion: ${m.jurisdiction}. Thema: Krypto-Liquidität.
Zwei Aufgaben, nichts anderes. Der Auftrag nennt kein Gesetz und keine Person. Du suchst die aktuellen Regeln selbst.

1. Krypto-Regulierungen.
Welche Gesetze, Verordnungen und Aufsichtsregeln ändern heute die Krypto-Liquidität in dieser Jurisdiktion?
Amt nur legislature oder regulator. instrumentType nur statute.
Status nur proposed, advanced, enacted, implementing, rejected, expired oder uncertain.
Jedes Vorhaben steht in regulations, auch ohne Quelle. Höchstens sechs Einträge. Ohne https-Beleg und Datum: confidence estimated. estimated ist unbestätigt und geht nicht in den Score.
Nur mit Quelle, https-Adresse und Datum zusätzlich in instruments. Erfinde keine Belege und keine URLs.
officeHolder ist optionaler Anzeigetext. Die Regel hängt am Amt, nicht am Namen.
In summary keinen Gesetzesnamen als Tatsache, wenn der Eintrag nur estimated ist. Kennzeichne ihn dann als unbestätigt.
Leer lassen ist falsch, wenn dir Regeln zu dieser Jurisdiktion bekannt sind: dann regulations mit confidence estimated.

2. Liquiditätstracker.
Diese Serien sind gemessen. Erfinde sie nicht und überschreibe sie nicht. Gib sie nicht als eigene Zahlen zurück.
- DeFi-TVL USD, alle Ketten: ${m.defiTvlUsd ?? "unbekannt"}
- DeFi-TVL Änderung 30 Tage USD: ${m.defiTvlChange30dUsd ?? "unbekannt"}
- Stablecoin-Marktkapitalisierung USD: ${m.stablecoinMcapUsd ?? "unbekannt"}
- Stablecoin-Änderung 30 Tage USD: ${m.mcapChange30dUsd ?? "unbekannt"}
- TGA Mrd. USD: ${m.tgaBn ?? "unbekannt"}
- M2 Mrd. USD: ${m.m2Bn ?? "unbekannt"}
- lange Rendite, 10Y Prozent: ${m.dgs10 ?? "unbekannt"}

Erkläre den Druck auf diesen Liquiditätstracker nur über die Kanäle cryptoLiquidity, m2, longYield und tBillDemand, jeweils up, down oder unclear.
Reserveanteile nur mit Beleg in instruments: magnitude.kind = "share", issuer USDT oder USDC, Wert 0 bis 1. Ohne Beleg bleibt der Anteil leer und geht nicht in die T-Bill-Nachfrage.
Gesetzes-Score nur mit Beleg in instruments: magnitude.kind = "score", Wert 0 bis 1.5. Ohne Beleg kein Score.
expectedMoveBp ist die erwartete Änderung der 10-Jahres-Rendite in Basispunkten, negativ wenn die Rendite sinkt.
halfLifeDays nur wenn kein decisionDate bekannt ist.
Ein abgelehntes oder ausgelaufenes Vorhaben hat status rejected oder expired.

Schreibe summary als zwei deutsche Sätze: welche Krypto-Regulierungen die Liquidität heute ändern.

JSON:
{"summary":"","regulations":[{"id":"kurz","title":"Name der Regel","office":"legislature|regulator","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","confidence":"cited|estimated","channels":{"cryptoLiquidity":"up|down|unclear","tBillDemand":"up|down|unclear","longYield":"up|down|unclear","m2":"up|down|unclear"},"note":"ein Satz"}],"instruments":[{"id":"kurz","title":"","jurisdiction":"${m.jurisdiction}","office":"legislature|regulator","instrumentType":"statute","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","officeHolder":"","effectiveFrom":"YYYY-MM-DD","effectiveTo":"YYYY-MM-DD","decisionDate":"YYYY-MM-DD","halfLifeDays":90,"expectedMoveBp":0,"channels":{"cryptoLiquidity":"up|down|unclear","tBillDemand":"up|down|unclear","longYield":"up|down|unclear","m2":"up|down|unclear"},"magnitude":{"kind":"share|score","value":0,"unit":"","issuer":""},"evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}]}`;
}

export interface PolicyScanCacheShape {
  llmAvailable: boolean;
  error?: string;
  summary: string | null;
  instruments: unknown[];
  regulations?: unknown[];
  _fallback?: boolean;
}

/** Leere Ablehnung und fehlender Schlüssel werden nicht fuer 6h gespeichert. */
export function policyScanIsCacheable(result: PolicyScanCacheShape): boolean {
  if (!result.llmAvailable || result.error || result._fallback) return false;
  if (typeof result.summary !== "string" || !result.summary.trim()) return false;
  const notes = Array.isArray(result.regulations) ? result.regulations.length : 0;
  const kept = Array.isArray(result.instruments) ? result.instruments.length : 0;
  return notes + kept > 0;
}
