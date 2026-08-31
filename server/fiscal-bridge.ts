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

// ═══════════════════════════════════════════════════════════════════════════
// TEIL 3 — DCF-Modellierung mit Fiskaldaten (WORK_REVERSE_DCF_BRIDGE.md §3.1–§3.8)
//
// Server-seitiges Gegenstück zu client/src/lib/calculations.ts
// (allocateProgramToFcf/capOverlays/forwardDcfWithFiscal, dort bereits für die
// Live-UI implementiert und durch script/test-fiscal-dcf.ts abgedeckt). Wird
// hier ADDITIV ergänzt, weil server/analyze-route.ts (registerAnalyzeRoute)
// nicht aus client/src/lib importieren kann/soll — beide Implementierungen
// nutzen exakt dieselbe Formel aus §3.2/§3.3 und denselben FiscalProgram-Typ
// (hier: das oben in diesem Modul definierte FiscalProgram, TEIL 2 — nicht der
// minimale Client-Subtyp FiscalProgramForFcf).
//
// KERNREGEL (§3.1/§3.4, PFLICHT): Diese Funktionen wirken AUSSCHLIESSLICH auf
// den separaten Forward-DCF-FCF-Pfad. Sie werden nirgends aus der Reverse-DCF-
// Berechnung (calcImpliedGStar/g*) heraus aufgerufen und verändern keinen ihrer
// Parameter. g* bleibt immer "was der Kurs auf Basis historischem FCF verlangt"
// — siehe §3.4 Tabelle und §3.5 Abgleich Forward vs Reverse.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * §3.2 — Ein einzelner Fiscal-FCF-Overlay-Eintrag für ein Kalenderjahr t.
 * probability bereits am Eintrag (z.B. 0.75 bei confidence=high), damit
 * capOverlays()/forwardDcfWithFiscal() konsistent π·ΔFCF rechnen können.
 */
export interface FiscalFcfOverlay {
  programId: string;
  year: number;                 // Kalenderjahr t
  deltaFcfUsd: number;          // absolute FCF-Wirkung in USD
  probability: number;          // 0–1
  source: FiscalProgram['source'];
}

/**
 * §3.2 — Verteilt das Programmvolumen linear über die Programmjahre auf den
 * Unternehmens-FCF (exakte Referenzformel):
 *   totalCompanyFcf = volumeUsdBn * 1e9 * companyShare * fcfMargin
 *   perYear         = totalCompanyFcf / (endYear - startYear + 1)
 *
 * Guardrails (§3.2/§3.6, Zahlen-Prinzip PFLICHT): volumeUsdBn/startYear/endYear
 * müssen gesetzt sein und endYear >= startYear, sonst [] — d.h. KEIN numerisches
 * Overlay, nur ein qualitativer Catalyst-Text bleibt möglich (ΔFCF=0-Fall aus
 * §3.6). companyShare wird hier NIE geraten/hartkodiert — der Aufrufer (analyze-
 * route.ts) darf diese Funktion nur mit einer belastbaren, dokumentierten
 * companyShare aus Research/Segment-Daten aufrufen, sonst gar nicht (siehe
 * WORK_REVERSE_DCF_BRIDGE.md §2.13.1 Guardrails "companyShare konservativ,
 * dokumentiert").
 */
export function allocateProgramToFcf(opts: {
  program: FiscalProgram;
  /** Anteil des Unternehmens am adressierbaren Markt/Orders, 0–1, aus Research/Segment */
  companyShare: number;
  /** Wie viel vom Revenue-Uplift als FCF ankommt, z.B. 0.15 */
  fcfMargin: number;
  probability: number;
}): FiscalFcfOverlay[] {
  const { program: p, companyShare, fcfMargin, probability } = opts;
  if (p.volumeUsdBn == null || p.startYear == null || p.endYear == null) return [];
  if (p.endYear < p.startYear) return [];

  const years = p.endYear - p.startYear + 1;
  const totalCompanyFcf = p.volumeUsdBn * 1e9 * companyShare * fcfMargin;
  const perYear = totalCompanyFcf / years;

  const out: FiscalFcfOverlay[] = [];
  for (let y = p.startYear; y <= p.endYear; y++) {
    out.push({
      programId: p.id,
      year: y,
      deltaFcfUsd: perYear,
      probability,
      source: p.source,
    });
  }
  return out;
}

/**
 * §3.2 — Cap gegen Explosiv-Szenarien: Summe π·ΔFCF über alle Programme in
 * einem Kalenderjahr darf maxFraction (Default 30%) von baseFcf0 nicht
 * überschreiten. Skaliert bei Überschreitung alle Overlays des betroffenen
 * Jahres proportional herunter (exakte Referenzformel §3.2).
 */
export function capOverlays(
  baseFcf0: number,
  overlays: FiscalFcfOverlay[],
  maxFraction = 0.30
): FiscalFcfOverlay[] {
  const byYear = new Map<number, FiscalFcfOverlay[]>();
  for (const o of overlays) {
    const arr = byYear.get(o.year) ?? [];
    arr.push(o);
    byYear.set(o.year, arr);
  }
  const result: FiscalFcfOverlay[] = [];
  // Array.from() statt for...of ueber Map.values(), analog client/src/lib/
  // calculations.ts und server/sector-data.ts (TS2802 downlevelIteration).
  Array.from(byYear.values()).forEach((arr: FiscalFcfOverlay[]) => {
    const raw = arr.reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0);
    const cap = Math.abs(baseFcf0) * maxFraction;
    const scale = raw > cap && raw > 0 ? cap / raw : 1;
    arr.forEach(o => result.push({ ...o, deltaFcfUsd: o.deltaFcfUsd * scale }));
  });
  return result;
}

export interface ForwardDcfWithFiscalResult {
  equityValue: number;
  fairValuePerShare: number;
  fcfPath: number[];
}

/**
 * §3.3 — Forward-DCF mit optionalem Fiscal-Overlay pro Jahr (exakte
 * Referenzformel). baseGrowth ist die organische Wachstumsrate OHNE Fiscal —
 * der Fiscal-Beitrag kommt additiv aus `overlays` (π·ΔFCF pro Jahr).
 *
 * Diese Funktion hat KEINE Wechselwirkung mit calcImpliedGStar()/g* — komplett
 * getrennter Rechenweg mit eigenem Fair-Value-Ergebnis (§3.4/§3.5-Tabelle:
 * "Fair Value Forward + Overlay" ist NUR die "mit Programm"-Szenario-Spalte,
 * g* bleibt in der "nein"-Spalte).
 */
export function forwardDcfWithFiscal(opts: {
  fcf0: number;
  baseGrowth: number;           // organische g ohne Fiscal (Dezimal, z.B. 0.05 = 5%)
  wacc: number;                 // Dezimal, z.B. 0.09 = 9%
  n?: number;
  terminalGrowth?: number;
  overlays: FiscalFcfOverlay[]; // bereits probability-gewichtet oder roh
  netDebt: number;
  shares: number;
}): ForwardDcfWithFiscalResult {
  const n = opts.n ?? 5;
  const gTerm = opts.terminalGrowth ?? 0.025;
  const startYear = new Date().getUTCFullYear();

  const fcfPath: number[] = [];
  let pv = 0;
  for (let t = 1; t <= n; t++) {
    const year = startYear + t - 1;
    const base = opts.fcf0 * Math.pow(1 + opts.baseGrowth, t);
    const fiscal = opts.overlays
      .filter(o => o.year === year)
      .reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0);
    const fcfT = base + fiscal;
    fcfPath.push(fcfT);
    pv += fcfT / Math.pow(1 + opts.wacc, t);
  }
  const last = fcfPath[n - 1];
  const term = last * (1 + gTerm) / ((opts.wacc - gTerm) * Math.pow(1 + opts.wacc, n));
  const ev = pv + term;
  const equity = ev - opts.netDebt;
  return {
    equityValue: equity,
    fairValuePerShare: opts.shares > 0 ? equity / opts.shares : 0,
    fcfPath,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint D3 (SPRINT_D3_FISCAL_BRIDGE_WIRING.md Ziel 6) — Adapter: Capex-Researcher-
// Cache (server/researcher.ts, NUR gelesen über diskResearcherGet("capex__US/EU/ASIA"),
// keine Strukturänderung dort) → qualifizierende Live-Ticker-Treffer für den
// Fiscal-Overlay in registerAnalyzeRoute.
//
// WICHTIGER BEFUND (dokumentiert statt erfunden): Die Capex-Researcher-Cache-
// Struktur (CapexFiscalResult in researcher.ts) liefert programmes[]/
// sectorExposure[].listedBeneficiaries[] mit Ticker-Treffern, aber KEIN
// strukturiertes volumeUsdBn (nur freie Budget-Strings wie "$20bn"), KEIN
// startYear/endYear (nur freie Timeline-Strings wie "2025-2027") und KEIN
// Item-Level source.url. Ein FiscalProgram (oben, TEIL 2) verlangt genau diese
// Felder typisiert; ein Catalyst (shared/schema.ts) verlangt zusaetzlich
// epsImpact != null UND source.url nicht-leer, um bei fiscalMegatrendQualifies()
// (server/scoring-gates.ts) bzw. addressableVolume>0 (ReverseDCFSection.tsx) zu
// qualifizieren.
//
// Deshalb: DIESER Adapter parst/errät NIEMALS Zahlen aus den Freitext-Feldern
// (budget-String, timeline-String) — das waere genau das im Ticket verbotene
// "companyShare/volumeUsdBn raten". Er liefert ausschliesslich einen TEXTUELLEN
// Treffer (Ticker + Quelle des Programms/Sektors), aus dem der Aufrufer NUR einen
// qualitativen Catalyst (kein numerisches Overlay, ΔFCF=0) bauen darf — exakt der
// "volumeUsdBn == null"-Pfad aus §3.6. Sobald der Researcher-Cache irgendwann
// strukturiertes volumeUsdBn/startYear/endYear/source.url liefert (additive
// Erweiterung von researcher.ts durch ein anderes Ticket), kann dieser Adapter
// ohne Aenderung an allocateProgramToFcf/capOverlays/forwardDcfWithFiscal auf
// echte numerische Overlays umgestellt werden.
// ═══════════════════════════════════════════════════════════════════════════

/** Minimaler Blick auf den Teil des CapexFiscalResult-Caches (server/researcher.ts),
 * der fuer die Ticker-Treffersuche benoetigt wird. Bewusst als eigener, loser Typ
 * gehalten statt Import aus researcher.ts (dort nicht exportiert; Struktur-
 * Aenderung an researcher.ts ist laut Ticket nicht erlaubt). */
export interface CapexResearchCacheSlice {
  region?: string;
  asOf?: string;
  programmes?: Array<{
    name: string;
    timeline?: string;
    amountUSD?: string;
    listedBeneficiaries?: Array<{ ticker: string; name: string; rationale: string }>;
  }>;
  sectorExposure?: Array<{
    sector: string;
    timeline?: string;
    listedBeneficiaries?: Array<{ ticker: string; name: string; rationale: string }>;
  }>;
}

export interface FiscalResearchMatch {
  region: string;
  programName: string;
  sector?: string;
  ticker: string;
  beneficiaryName: string;
  rationale: string;
  timeline?: string;
  /** Freitext-Budget-String aus dem Researcher-Cache (z.B. "$20bn") — bewusst
   * NICHT geparst, siehe Moduldoku oben. Nur zur textuellen Anzeige geeignet. */
  amountUSDText?: string;
  asOf?: string;
}

/**
 * Sucht in einem Capex-Researcher-Cache-Snapshot (eine Region) nach echten
 * Ticker-Treffern fuer den analysierten Titel — sowohl in programmes[].
 * listedBeneficiaries[] als auch in sectorExposure[].listedBeneficiaries[].
 * Reine Lesefunktion, keine Zahlen-Herleitung (siehe Moduldoku oben).
 * Kein Ticker-Hardcode: `ticker` ist ein Parameter, kein literaler Wert im Code.
 */
export function findFiscalResearchMatches(
  cache: CapexResearchCacheSlice | null | undefined,
  ticker: string
): FiscalResearchMatch[] {
  if (!cache) return [];
  const wantedTicker = ticker.trim().toUpperCase();
  if (!wantedTicker) return [];
  const region = cache.region ?? "";
  const out: FiscalResearchMatch[] = [];

  for (const p of cache.programmes ?? []) {
    for (const b of p.listedBeneficiaries ?? []) {
      if (b.ticker?.toUpperCase() === wantedTicker) {
        out.push({
          region, programName: p.name, ticker: wantedTicker,
          beneficiaryName: b.name, rationale: b.rationale,
          timeline: p.timeline, amountUSDText: p.amountUSD, asOf: cache.asOf,
        });
      }
    }
  }
  for (const s of cache.sectorExposure ?? []) {
    for (const b of s.listedBeneficiaries ?? []) {
      if (b.ticker?.toUpperCase() === wantedTicker) {
        out.push({
          region, programName: s.sector, sector: s.sector, ticker: wantedTicker,
          beneficiaryName: b.name, rationale: b.rationale,
          timeline: s.timeline, asOf: cache.asOf,
        });
      }
    }
  }
  return out;
}
