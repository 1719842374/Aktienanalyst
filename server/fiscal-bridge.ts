/**
 * TEIL 2 — Fiscal Bridge: FiscalProgram, TTL, Invalidierung (WORK_REVERSE_DCF_BRIDGE.md §2.12–§2.13)
 *
 * Kernprinzip: TTL = passives Verfallen. Invalidierung = aktives, event-getriebenes
 * Entfernen oder Zurückstufen (§2.13). Beide Mechanismen zusammen verhindern, dass
 * ein Fiskalprogramm (Sondervermögen, Subvention, Beschaffungsprogramm, …) länger als
 * belastbar als "aktiv" gilt und in Forward-DCF/Gate-Milderung einfließt (siehe
 * client/src/lib/calculations.ts §3 für die Verwendung — dort NIEMALS auf g* selbst,
 * siehe WORK_REVERSE_DCF_BRIDGE.md §3.4).
 *
 * Lookahead-Sperre (hart, WORK_REVERSE_DCF_BRIDGE.md §2.12):
 *   publishedAt <= asOf ist Pflicht — ein Programm darf nie vor seinem tatsächlichen
 *   Ankündigungsdatum als aktiv gelten (Backtesting- und Live-Sicherheit).
 *
 * Speicherung: server/disk-cache.ts-Pattern (diskResearcherGet/diskResearcherSet).
 * Key-Schema (hier festgelegt, konsistent im gesamten Modul verwendet):
 *   fiscal__<programId>   — Einzelprogramm, uppercase programId analog capex__US Konvention
 * (Programme werden individuell adressiert, nicht als eine Liste pro Ticker/Region,
 * weil invalidateProgram/detectContradiction pro Programm-ID arbeiten — §2.13.2.)
 */
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";

// ─── §2.2 Datenmodell FiscalProgram ───────────────────────────────────────────

export type FiscalProgramStatus = 'announced' | 'legislated' | 'funded' | 'deploying' | 'expired';
export type FiscalConfidence = 'low' | 'medium' | 'high';

export interface FiscalProgram {
  id: string;
  name: string;
  /** Land/Region, z.B. "US", "EU", "DE" */
  region: string;
  /** Sektor-/Branchenschlüssel für Catalyst-/Sector-Map-Zuordnung (§2.13.1 I5) */
  sectorKeys?: string[];
  status: FiscalProgramStatus;
  confidence: FiscalConfidence;
  /** Adressierbares Programmvolumen in USD Mrd, null wenn (noch) nicht quantifizierbar */
  volumeUsdBn: number | null;
  /** Kalenderjahr Beginn/Ende der Mittelverwendung, null wenn unbekannt */
  startYear: number | null;
  endYear: number | null;
  source: { url: string; publishedAt: string; snippet: string };
  /** ISO-Zeitpunkt, ab dem der Cache-Eintrag als abgelaufen gilt (TTL, §2.12) */
  expiresAt: string;
}

// ─── §2.13.2 Invalidierungs-Vertrag ───────────────────────────────────────────

export type InvalidationReason =
  | 'denied'
  | 'defunded'
  | 'end_year'
  | 'contradiction'
  | 'sector_fix'
  | 'overflow'
  | 'ttl_gc'
  | 'manual';

export interface InvalidationEvent {
  programId: string;
  reason: InvalidationReason;
  at: string;                 // ISO as-of
  source?: { url: string; publishedAt: string; snippet: string };
  note?: string;
}

/**
 * Minimales Extraktions-Ergebnis, wie es aus einer neuen LLM-Discovery-Runde
 * zurückkommt und gegen den bestehenden Cache-Eintrag geprüft wird (§2.13.4).
 */
export interface ProgramExtraction {
  status: FiscalProgramStatus;
  volumeUsdBn: number | null;
  snippet: string;
}

// ─── §2.12 TTL-Tabelle ─────────────────────────────────────────────────────────
// TTL nach status/confidence — exakt wie WORK_REVERSE_DCF_BRIDGE.md §2.12 spezifiziert.
// "announced" unterscheidet nach confidence (low/high); alle anderen Status sind
// TTL-mäßig confidence-unabhängig. "expired" hat TTL 0 (sofort verfallen).
const TTL_DAYS_MS = 24 * 60 * 60 * 1000;

export function ttlDaysFor(status: FiscalProgramStatus, confidence: FiscalConfidence): number {
  if (status === 'expired') return 0;
  if (status === 'announced') return confidence === 'high' ? 14 : 3;
  // announced/medium fällt konservativ auf den low-Wert (kürzeste TTL der beiden
  // dokumentierten announced-Zeilen), da §2.12 nur low/high für announced nennt.
  if (status === 'legislated') return 30;
  if (status === 'funded') return 45;
  if (status === 'deploying') return 60;
  return 0;
}

/** Berechnet expiresAt (ISO) aus asOf + TTL-Tabelle für status/confidence. */
export function computeExpiresAt(asOf: string, status: FiscalProgramStatus, confidence: FiscalConfidence): string {
  const days = ttlDaysFor(status, confidence);
  const base = new Date(asOf).getTime();
  if (!isFinite(base)) return asOf;
  return new Date(base + days * TTL_DAYS_MS).toISOString();
}

/**
 * Aktivitäts-Check (§2.12): "Aktiv nur wenn expiresAt ≥ asOf ∧ publishedAt ≤ asOf
 * ∧ status ≠ expired ∧ endYear ok."
 * publishedAt ≤ asOf ist eine harte Lookahead-Sperre — siehe Moduldoku oben.
 */
export function isProgramActive(p: FiscalProgram, asOf: string): boolean {
  if (p.status === 'expired') return false;
  const asOfTime = new Date(asOf).getTime();
  const expiresTime = new Date(p.expiresAt).getTime();
  if (!isFinite(asOfTime) || !isFinite(expiresTime)) return false;
  if (expiresTime < asOfTime) return false; // TTL abgelaufen

  const publishedTime = new Date(p.source.publishedAt).getTime();
  // Lookahead-Sperre: ohne verwertbares publishedAt gilt das Programm defensiv als inaktiv.
  if (!isFinite(publishedTime)) return false;
  if (publishedTime > asOfTime) return false; // Programm "kannte" der Markt am asOf noch nicht

  // endYear ok: wenn gesetzt, darf das Kalenderjahr von asOf nicht danach liegen.
  if (p.endYear != null) {
    const asOfYear = new Date(asOf).getUTCFullYear();
    if (asOfYear > p.endYear) return false;
  }
  return true;
}

// ─── §2.13.2 invalidateProgram — Zustandsübergänge exakt nach Spezifikation ───

/**
 * Wendet ein InvalidationEvent auf ein Programm im Store an.
 *
 * Zustandsübergänge (§2.13.2, hart wie in der Spezifikation):
 *   denied | defunded | end_year | manual  → status=expired, expiresAt=ev.at, confidence=low (hard)
 *   contradiction                          → confidence downgrade (high→medium→low), TTL kurz (soft/hard)
 *   ttl_gc | overflow                      → delete (soft)
 *   sector_fix                             → Programm bleibt im Store unverändert zurückgegeben;
 *                                             die eigentliche sectorKeys-Korrektur erfolgt außerhalb
 *                                             (Caller patcht sectorKeys und ruft ggf. erneut store.set),
 *                                             siehe §2.13.1 I5 ("sectorKeys korrigieren; Catalyst-Recompute").
 */
export function invalidateProgram(
  store: Map<string, FiscalProgram>,
  ev: InvalidationEvent
): FiscalProgram | null {
  const p = store.get(ev.programId);
  if (!p) return null;

  if (ev.reason === 'denied' || ev.reason === 'defunded' || ev.reason === 'end_year' || ev.reason === 'manual') {
    const row: FiscalProgram = {
      ...p,
      status: 'expired',
      expiresAt: ev.at,
      confidence: 'low',
      // Audit: letzte Source behalten + optional note in snippet-chain
      source: ev.source ?? p.source,
    };
    store.set(row.id, row);
    return row;
  }

  if (ev.reason === 'contradiction') {
    const nextConfidence: FiscalConfidence = p.confidence === 'high' ? 'medium' : 'low';
    const row: FiscalProgram = {
      ...p,
      confidence: nextConfidence,
      expiresAt: computeExpiresAt(ev.at, p.status, nextConfidence),
    };
    store.set(row.id, row);
    return row;
  }

  if (ev.reason === 'ttl_gc' || ev.reason === 'overflow') {
    store.delete(ev.programId);
    return null;
  }

  // sector_fix und alle sonstigen (nicht destruktiven) Reasons: Programm unverändert zurückgeben.
  return p;
}

// ─── §2.13.4 Widerspruchs-Detection (automatisch) ─────────────────────────────

const DENIED_REGEX = /denied|cancelled|struck down/i;

const STATUS_RANK: Record<FiscalProgramStatus, number> = {
  announced: 1, legislated: 2, funded: 3, deploying: 4, expired: 0,
};

/**
 * Vergleicht eine neue Extraktion (next) gegen den bestehenden Cache-Zustand (prev)
 * und liefert einen InvalidationReason, falls ein Widerspruch erkannt wird — sonst null.
 * Exakt nach §2.13.4 spezifiziert:
 *   1. next.status === 'expired' ODER next.snippet matcht /denied|cancelled|struck down/i → 'denied'
 *   2. Volume-Drop > 50% (next < prev * 0.5, beide vorhanden) → 'contradiction'
 *   3. unerwartetes Status-Downgrade (Rang sinkt, aber next.status !== 'expired') → 'contradiction'
 */
export function detectContradiction(prev: FiscalProgram, next: ProgramExtraction): InvalidationReason | null {
  if (next.status === 'expired' || DENIED_REGEX.test(next.snippet))
    return 'denied';
  if (prev.volumeUsdBn != null && next.volumeUsdBn != null && next.volumeUsdBn < prev.volumeUsdBn * 0.5)
    return 'contradiction';
  // Hinweis: next.status ist an dieser Stelle durch TypeScript bereits auf
  // FiscalProgramStatus exkl. 'expired' verengt (erster Guard oben faengt 'expired'
  // ab und gibt fruehzeitig zurueck) -- der explizite "!== 'expired'"-Vergleich aus
  // der Referenzimplementierung (WORK_REVERSE_DCF_BRIDGE.md §2.13.4) ist deshalb
  // hier redundant (TS2367) und wurde entfernt, ohne die Logik zu aendern.
  if (STATUS_RANK[next.status] < STATUS_RANK[prev.status])
    return 'contradiction'; // unerwartetes Downgrade
  return null;
}

// ─── §2.13.3 Downstream-Propagierung: Score-Cache-Keys ───────────────────────

/**
 * Score-Cache-Keys, die von einem bestimmten Programm abhängen (weil catalystEV
 * oder Gates von prog:id abhingen). Diese Keys müssen nach invalidateProgram()
 * entweder neu berechnet oder aus dem Cache gedroppt werden — niemals aus einem
 * Warm-Cache mit dem invalidierten Programm weiterverwendet werden (§2.13.3).
 */
export function scoreCacheKeysTouchedByProgram(
  programId: string,
  tickers: string[],
  asOf: string
): string[] {
  return tickers.map(t => `score:${t}:${asOf}:prog:${programId}`);
}

// ─── Speicherung über server/disk-cache.ts-Pattern ────────────────────────────
// Key-Schema: fiscal__<programId> (siehe Moduldoku oben). Wiederverwendung des
// bestehenden diskResearcherGet/Set/Delete-Patterns (uppercase Segmente wie bei
// capex__US, hier aber die programId selbst als eindeutiger Schlüssel).

function fiscalDiskKey(programId: string): string {
  return `fiscal__${programId}`;
}

export function loadFiscalProgram(programId: string): FiscalProgram | null {
  const raw = diskResearcherGet(fiscalDiskKey(programId));
  if (!raw) return null;
  // diskResearcherGet reichert mit _cacheAge an — für FiscalProgram nicht Teil des Interfaces,
  // daher hier nur die bekannten Felder herausziehen.
  const { _cacheAge, ...program } = raw;
  return program as FiscalProgram;
}

export function saveFiscalProgram(program: FiscalProgram): void {
  diskResearcherSet(fiscalDiskKey(program.id), program);
}

export function deleteFiscalProgram(programId: string): void {
  diskResearcherDelete(fiscalDiskKey(programId));
}
