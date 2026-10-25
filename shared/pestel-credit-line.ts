/**
 * F1-24 — PESTEL „Economic“: Kreditrisiko-Zeile aus dem Markt-Spread Baa (FRED BAA10Y).
 * Future_1 §11 (Z.362, 388): „Credit unter PESTEL, Unterpunkt Economic“.
 *
 * Pure Anzeige-Logik über die bestehende Antwort von GET /api/credit-spread/market
 * (server/credit-route.ts, Hook client/src/lib/useMarketCreditSpread.ts).
 * Kein Input für pestelDampeningFactor, geopoliticalScore, overallExposure oder einen Score.
 * Fehlen Daten → n/a mit Grund, nie ein Ersatzwert.
 */
import type { CreditSpreadResponse } from "./schema";
import { CREDIT_SOURCE_LABEL, ISSUER_BOND_NA_NOTE, creditStressHint } from "./credit";

export const PESTEL_CREDIT_DISPLAY_NOTE = "Nur Anzeige. Fließt nicht in PESTEL-Exposure, Dämpfungsfaktor oder Score ein.";

export type PestelCreditLine =
  | { status: "loading"; text: string }
  | { status: "na"; text: string; reason: string }
  | {
      status: "ok";
      text: string;
      valuePct: number;
      asOf: string;
      change3MPp: number | null;
      stressHint: string | null;
    };

/** Die PESTEL-Kategorie, unter der die Zeile steht (category-Feld der Analyse, englisch). */
export function isEconomicCategory(category: string | null | undefined): boolean {
  return String(category ?? "").trim().toLowerCase() === "economic";
}

export function pestelCreditLine(
  resp: CreditSpreadResponse | null | undefined,
  state: { loading?: boolean; error?: boolean } = {},
): PestelCreditLine {
  if (state.loading && !resp) return { status: "loading", text: "Markt-Spread Baa: lädt …" };
  if (state.error) return na("Abruf /api/credit-spread/market fehlgeschlagen");
  if (!resp) return na("keine Antwort von /api/credit-spread/market");
  const pts = Array.isArray(resp.points) ? resp.points : [];
  if (pts.length === 0) return na(resp.note || "FRED nicht erreichbar oder leer");
  const last = pts[pts.length - 1];
  if (!Number.isFinite(last.value)) return na("letzter FRED-Wert ungültig");
  const change = resp.stress && resp.stress.asOf === last.date ? resp.stress.change3MPp : null;
  const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} bp`;
  return {
    status: "ok",
    text:
      `Kreditrisiko (Markt): Spread Baa − 10J ${last.value.toFixed(2)} % (Stand ${last.date})` +
      (change != null ? `, 3M ${bp(change)}` : ", 3M-Änderung n/a (zu wenig Historie)") +
      `. Quelle ${CREDIT_SOURCE_LABEL}, alle US-Unternehmen.`,
    valuePct: last.value,
    asOf: last.date,
    change3MPp: change,
    stressHint: creditStressHint(resp.stress),
  };
}

function na(reason: string): PestelCreditLine {
  return { status: "na", text: `Kreditrisiko (Markt): n/a – ${reason}`, reason };
}

export { ISSUER_BOND_NA_NOTE };
