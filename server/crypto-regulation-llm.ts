/**
 * OpenRouter-Auftrag fuer Sektion 14.
 * Gleicher JSON-Client wie der Researcher, zusaetzlich mit Websuche.
 * Der Auftrag nennt kein Gesetz. Titel kommen aus den Amtshinweisen oder
 * aus der Websuche. Gemessene Serien schreibt das Modell nicht um.
 */
import type { OfficialNotice } from "./crypto-regulation-sources";

export interface PolicyScanMeasuredInput {
  asOf: string;
  jurisdiction: string;
  stablecoinMcapUsd: number | null;
  mcapChange30dUsd: number | null;
  defiTvlUsd: number | null;
  defiTvlChange30dUsd: number | null;
  tgaBn: number | null;
  dgs10: number | null;
  policyRate: number | null;
  realYield10y: number | null;
  m2Bn: number | null;
}

export const POLICY_SCAN_SYSTEM_PROMPT =
  "Du antwortest nur mit JSON. Erfinde keine gemessenen Zahlen und keine URLs. Jeder Amtshinweis wird eine regulation mit genau diesem Titel. Eine Ablehnung ohne Titel ist ungueltig. confidence estimated nur ohne URL. instruments nur mit https und Datum aus den Hinweisen oder der Websuche.";

function noticeBlock(notices: OfficialNotice[]): string {
  if (notices.length === 0) return "keine";
  return notices.map((n, i) =>
    `${i + 1}. ${n.date} | ${n.office} | ${n.instrumentType} | ${n.title} | ${n.url} | ${n.snippet || "ohne Kurztext"}`,
  ).join("\n");
}

export function buildPolicyScanPrompt(measured: PolicyScanMeasuredInput, notices: OfficialNotice[] = []): string {
  const m = measured;
  return `Heute ist ${m.asOf}. Jurisdiktion: ${m.jurisdiction}. Thema: Krypto-Liquidität.
Zwei Aufgaben, nichts anderes. Der Auftrag nennt kein Gesetz und keine Person. Titel suchst du in den Amtshinweisen und in der Websuche.

1. Krypto-Regulierungen und Fiskalprogramm.
Finde neue Gesetze, Aufsichtsregeln und Fiskalprogramme, die heute die Krypto-Liquidität, M2, den Leitzins, den Realzins oder die 10-Jahres-Rendite ändern.
Amt: legislature, regulator, treasury oder central_bank.
instrumentType: statute für Gesetze und Aufsichtsregeln, fiscal_program für Fiskalprogramme, debt_operation für Schuldenoperationen der Finanzverwaltung.
Status nur proposed, advanced, enacted, implementing, rejected, expired oder uncertain.
Jeder Amtshinweis unten wird genau eine regulation mit demselben Titel. Höchstens acht Einträge.
Zusätzliche Titel nur aus der Websuche dieser Anfrage. Ohne https-Beleg und Datum: confidence estimated und im summary als unbestätigt.
Erfinde keine Belege und keine URLs. Eine Ablehnung ohne Titel ist ungültig.
officeHolder ist optionaler Anzeigetext. Die Regel hängt am Amt, nicht am Namen.
Ein abgelehntes oder ausgelaufenes Vorhaben hat status rejected oder expired.

Amtshinweise:
${noticeBlock(notices)}

2. Liquiditätstracker.
Diese Serien sind gemessen. Erfinde sie nicht und überschreibe sie nicht. Gib sie nicht als eigene Zahlen zurück.
- DeFi-TVL USD, alle Ketten: ${m.defiTvlUsd ?? "unbekannt"}
- DeFi-TVL Änderung 30 Tage USD: ${m.defiTvlChange30dUsd ?? "unbekannt"}
- Stablecoin-Marktkapitalisierung USD: ${m.stablecoinMcapUsd ?? "unbekannt"}
- Stablecoin-Änderung 30 Tage USD: ${m.mcapChange30dUsd ?? "unbekannt"}
- TGA Mrd. USD: ${m.tgaBn ?? "unbekannt"}
- M2 Mrd. USD: ${m.m2Bn ?? "unbekannt"}
- Leitzins, Federal Funds Prozent: ${m.policyRate ?? "unbekannt"}
- Realzins 10-Jahres Prozent: ${m.realYield10y ?? "unbekannt"}
- 10-Jahres-Rendite Prozent: ${m.dgs10 ?? "unbekannt"}

Erkläre den Druck nur über die Kanäle cryptoLiquidity, m2, longYield, tBillDemand, policyRate und realYield, jeweils up, down oder unclear.
Ein Fiskalprogramm, das die lange Rendite senkt, ist fiscal_program mit longYield down.
Reserveanteile nur mit Beleg in instruments: magnitude.kind = "share", issuer USDT oder USDC, Wert 0 bis 1. Ohne Beleg bleibt der Anteil leer und geht nicht in die T-Bill-Nachfrage.
Gesetzes-Score nur mit Beleg in instruments: magnitude.kind = "score", Wert 0 bis 1.5. Ohne Beleg kein Score.
expectedMoveBp ist die erwartete Änderung der 10-Jahres-Rendite in Basispunkten, negativ wenn die Rendite sinkt.
halfLifeDays nur wenn kein decisionDate bekannt ist.

Schreibe summary als zwei deutsche Sätze: welche Krypto-Regulierungen und Fiskalprogramme die Liquidität, M2, den Leitzins, den Realzins oder die 10-Jahres-Rendite heute ändern.

JSON:
{"summary":"","regulations":[{"id":"kurz","title":"Titel aus Amtshinweis oder Websuche","office":"legislature|regulator|treasury|central_bank","instrumentType":"statute|fiscal_program|debt_operation","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","confidence":"cited|estimated","channels":{"cryptoLiquidity":"up|down|unclear","tBillDemand":"up|down|unclear","longYield":"up|down|unclear","m2":"up|down|unclear","policyRate":"up|down|unclear","realYield":"up|down|unclear"},"note":"ein Satz","evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}],"instruments":[{"id":"kurz","title":"","jurisdiction":"${m.jurisdiction}","office":"legislature|regulator|treasury|central_bank","instrumentType":"statute|fiscal_program|debt_operation","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","officeHolder":"","effectiveFrom":"YYYY-MM-DD","effectiveTo":"YYYY-MM-DD","decisionDate":"YYYY-MM-DD","halfLifeDays":90,"expectedMoveBp":0,"channels":{"cryptoLiquidity":"up|down|unclear","tBillDemand":"up|down|unclear","longYield":"up|down|unclear","m2":"up|down|unclear","policyRate":"up|down|unclear","realYield":"up|down|unclear"},"magnitude":{"kind":"share|score","value":0,"unit":"","issuer":""},"evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}]}`;
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
