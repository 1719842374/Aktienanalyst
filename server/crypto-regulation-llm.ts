/**
 * OpenRouter-Auftrag fuer Sektion 14.
 * Der Server misst zuerst. Das Modell schreibt danach und darf nur die
 * gemessenen Niveaus und Richtungen zitieren. Kein Jahresnarrativ, keine
 * Stablecoin-Marktkapitalisierung und kein DeFi-TVL als Liquiditaetsthese.
 */
import type { OfficialNotice } from "./crypto-regulation-sources";
import { fallbackScanSummary, isRefusalSummary } from "./crypto-regulation-sources";
import {
  allowedMeasuredNumbers,
  measuredViews,
  proseNumbersAreMeasured,
  type PolicyWindows,
  type SeriesDirectionReading,
} from "./policy-scan-windows";

export interface PolicyScanMeasuredInput {
  asOf: string;
  jurisdiction: string;
  policyRate: SeriesDirectionReading;
  realYield10y: SeriesDirectionReading;
  dgs10: SeriesDirectionReading;
  m2Bn: SeriesDirectionReading;
  tgaBn: SeriesDirectionReading;
}

export interface PolicyNote {
  summary: string;
  ratesView: string;
  liquidityView: string;
  fiscalView: string;
  keyDrivers: string[];
  btcImplication: string;
}

export const POLICY_SCAN_SYSTEM_PROMPT =
  "Du antwortest nur mit JSON. Erfinde keine Zahlen und keine URLs. Jede Zahl im Text muss aus den gemessenen Niveaus und Richtungen stammen. Titel nur aus den Amtshinweisen oder der Websuche dieser Anfrage, jeweils mit https und Datum. Kanäle nur up oder down, und nur wenn das Dokument den Kanal stützt. Die Richtung ist die Wirkung auf den Kanal. Eine Regel allein setzt keinen Kanal auf down. cryptoLiquidity ist up, wenn das Dokument einen Weg für die Stablecoin-Ausgabe, für Reserven oder für Dollar-Liquidität auf der Chain öffnet, legitimiert oder erweitert, auch als Lizenz- oder Umsetzungsrahmen. cryptoLiquidity ist down, wenn das Dokument selbst verbietet, deckelt, die Verzinsung streicht oder den Zugang zu Finanzierung kappt. inflation ist up, wenn der Text selbst den Preisdruck hebt, und down, wenn er ihn senkt. Ein Lizenz- oder Umsetzungsrahmen allein setzt inflation nicht. policyRate, realYield und longYield sind up, wenn der Text das Zinsniveau hebt, und down, wenn er es senkt. Amt und Typ allein setzen keinen Kanal. unclear nicht setzen. instruments nur mit https und Datum. Keine Magnitude, kein Score und kein Reserveanteil ohne Beleg im Dokument.";

function noticeBlock(notices: OfficialNotice[]): string {
  if (notices.length === 0) return "keine";
  return notices.map((n, i) =>
    `${i + 1}. ${n.date} | ${n.office} | ${n.instrumentType} | ${n.title} | ${n.url} | ${n.snippet || "ohne Kurztext"}`,
  ).join("\n");
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unbekannt";
  return String(Math.round(value * 100) / 100);
}

function seriesLine(label: string, reading: SeriesDirectionReading, unit: string): string {
  return `- ${label}: Niveau ${fmt(reading.latest)} ${unit}, vor etwa einem Jahr ${fmt(reading.level1y)} (${reading.direction1y}), vor etwa zwei Jahren ${fmt(reading.level2y)} (${reading.direction2y})`;
}

export function buildPolicyScanPrompt(measured: PolicyScanMeasuredInput, notices: OfficialNotice[] = []): string {
  const m = measured;
  const m2Bio = m.m2Bn.latest == null ? "unbekannt" : fmt(m.m2Bn.latest / 1000);
  return `Heute ist ${m.asOf}. Jurisdiktion: ${m.jurisdiction}. Thema: Druck auf die Krypto-Liquidität und die Folge für BTC.
Der Auftrag nennt kein Gesetz, keine Person und kein festes Jahresnarrativ. Titel suchst du in den Amtshinweisen und in der Websuche dieser Anfrage.

Gemessene FRED-Serien. Nur diese Niveaus und Richtungen darfst du zitieren. Erfinde keine weiteren Zahlen und überschreibe die Messung nicht. Ist die Richtung unbekannt, schreib unbekannt und rate nicht.
${seriesLine("Leitzins (DFF), Prozent", m.policyRate, "Prozent")}
${seriesLine("Realzins 10-Jahres (DFII10), Prozent", m.realYield10y, "Prozent")}
${seriesLine("10-Jahres-Rendite (DGS10), Prozent", m.dgs10, "Prozent")}
${seriesLine("M2 (M2SL), Milliarden USD", m.m2Bn, "Milliarden USD")}
- M2 in Billionen USD, nur das Niveau: ${m2Bio}
${seriesLine("TGA (WTREGEN), Milliarden USD", m.tgaBn, "Milliarden USD")}

1. Analystennotiz.
summary: höchstens vier deutsche Sätze.
Satz 1 und 2: Leitzins, Realzins zehn Jahre, Zehnjahresrendite, M2 und TGA mit Niveau und Richtung über ein Jahr und über zwei Jahre, nur aus der Messung.
Satz 3 und 4: welche belegten Regeln den Druck auf die Krypto-Liquidität ändern, und was das für BTC bedeutet.
ratesView, liquidityView und fiscalView: je ein deutscher Satz. ratesView nur Leitzins, Realzins und Zehnjahresrendite. liquidityView nur M2. fiscalView nur TGA und belegte Regeln, ohne erfundene Beträge.
keyDrivers: bis zu drei kurze Treiber, nur aus der Messung oder aus belegten Regeln.
btcImplication: ein Satz zur Folge für BTC.

2. Regeln.
Finde Gesetze, Aufsichtsregeln und Fiskalprogramme, die den Druck auf die Krypto-Liquidität, M2, den Leitzins, den Realzins, die Zehnjahresrendite oder die T-Bill-Nachfrage ändern.
Amt: legislature, regulator, treasury oder central_bank.
instrumentType: statute für Gesetze und Aufsichtsregeln, fiscal_program für Fiskalprogramme, debt_operation für Schuldenoperationen.
Status nur proposed, advanced, enacted, implementing, rejected, expired oder uncertain.
Jeder Amtshinweis wird genau eine regulation mit demselben Titel, mit https und Datum. Höchstens acht Einträge.
Weitere Titel nur aus der Websuche dieser Anfrage, ebenfalls mit https und Datum. Allgemeine Nachrichtenseiten, darunter tagesschau.de, sind keine Belege. Die einzige zusätzliche Krypto-Quelle ist blocktrainer.de, und nur mit einer https-Adresse, die in dieser Anfrage wirklich vorkommt. Erfinde keine Adresse und keine Schlagzeile.
Pro Eintrag nur die Kanäle, die das Dokument stützt. Erlaubte Kanäle: cryptoLiquidity, inflation, m2, longYield, policyRate, realYield, tBillDemand. Werte nur up oder down. unclear nicht setzen und fehlende Kanäle weglassen.
Die Richtung ist die Wirkung des Dokuments auf diesen Kanal. Eine Regel allein setzt keinen Kanal auf down.
cryptoLiquidity ist up, wenn das Dokument einen Weg für die Stablecoin-Ausgabe, für Reserven oder für Dollar-Liquidität auf der Chain öffnet, legitimiert oder erweitert. Ein Lizenz- oder Umsetzungsrahmen ist diese Öffnung.
cryptoLiquidity ist down, wenn das Dokument selbst verbietet, deckelt, die Verzinsung streicht oder den Zugang zu Finanzierung kappt.
inflation ist up, wenn der Text selbst den Preisdruck hebt, und down, wenn er ihn senkt. Ein Lizenz- oder Umsetzungsrahmen allein setzt inflation nicht.
policyRate, realYield und longYield sind up, wenn der Text das Zinsniveau hebt, und down, wenn er es senkt.
Für die übrigen Kanäle gilt dieselbe Regel: up oder down nur als Wirkung, die der Text selbst stützt. Amt und Typ allein setzen keinen Kanal. Lies den Hinweis.
instruments nur mit https und Datum. Keine Magnitude, kein Score und kein Reserveanteil, wenn das Dokument sie nicht nennt.
Eine Ablehnung ohne Titel ist ungültig.

Amtshinweise:
${noticeBlock(notices)}

JSON:
{"summary":"","ratesView":"","liquidityView":"","fiscalView":"","keyDrivers":[],"btcImplication":"","regulations":[{"id":"kurz","title":"Titel aus Amtshinweis oder Websuche","office":"legislature|regulator|treasury|central_bank","instrumentType":"statute|fiscal_program|debt_operation","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","channels":{"cryptoLiquidity":"up|down"},"note":"ein Satz","evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}],"instruments":[{"id":"kurz","title":"","jurisdiction":"${m.jurisdiction}","office":"legislature|regulator|treasury|central_bank","instrumentType":"statute|fiscal_program|debt_operation","status":"proposed|advanced|enacted|implementing|rejected|expired|uncertain","channels":{"cryptoLiquidity":"up|down"},"evidence":[{"source":"","url":"https://","date":"YYYY-MM-DD"}]}]}`;
}

function clipSentences(text: string, max: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  return parts.slice(0, max).join(" ");
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function acceptProse(text: string | null, allowed: number[], maxSentences: number): string | null {
  if (!text) return null;
  const clipped = clipSentences(text, maxSentences);
  if (!clipped) return null;
  return proseNumbersAreMeasured(clipped, allowed) ? clipped : null;
}

export function buildPolicyNote(
  model: Record<string, unknown> | null,
  windows: PolicyWindows,
): { note: PolicyNote; summarySource: "model" | "measured" | "measured+tail" } {
  const allowed = allowedMeasuredNumbers(windows);
  const views = measuredViews(windows);
  const rawSummary = asText(model?.summary);
  const refused = rawSummary != null && isRefusalSummary(rawSummary);
  const summaryAccepted = refused ? null : acceptProse(rawSummary, allowed, 4);
  let summary = summaryAccepted ?? views.lead;
  let summarySource: "model" | "measured" | "measured+tail" = summaryAccepted ? "model" : "measured";
  if (!summaryAccepted && rawSummary && !refused) {
    const tail = rawSummary.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).slice(2, 4).join(" ");
    if (tail && proseNumbersAreMeasured(tail, allowed)) {
      summary = clipSentences(`${views.lead} ${tail}`, 4);
      summarySource = "measured+tail";
    }
  }
  const driversRaw = Array.isArray(model?.keyDrivers) ? model.keyDrivers : [];
  const keyDrivers = driversRaw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(item => item.trim())
    .filter(item => proseNumbersAreMeasured(item, allowed))
    .slice(0, 3);
  return {
    summarySource,
    note: {
      summary,
      ratesView: acceptProse(asText(model?.ratesView), allowed, 2) ?? views.rates,
      liquidityView: acceptProse(asText(model?.liquidityView), allowed, 2) ?? views.liquidity,
      fiscalView: acceptProse(asText(model?.fiscalView), allowed, 2) ?? views.fiscal,
      keyDrivers: keyDrivers.length > 0 ? keyDrivers : views.drivers,
      btcImplication: acceptProse(asText(model?.btcImplication), allowed, 2) ?? views.btc,
    },
  };
}

/** Haengt den Amtshinweis an, wenn das Modell die Saetze 3 und 4 nicht geliefert hat. */
export function withNoticeFallback(summary: string, count: number): string {
  if (count <= 0) return summary;
  return clipSentences(`${summary} ${fallbackScanSummary(count)}`, 4);
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
