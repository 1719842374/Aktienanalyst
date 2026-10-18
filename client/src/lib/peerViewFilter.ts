/**
 * PR B Peer-Selection (WORK_PEER_SELECTION_DETAILED §3 Filter-Tabs): reine Ansicht.
 *
 * Server-Ø (peerAvg), Scoring und PDF laufen weiter auf dem vollen Peer-Set.
 * Diese Helfer filtern nur die sichtbaren Tabellenzeilen und berechnen einen
 * separaten Ansichts-Ø („Ansicht, nicht score-wirksam“).
 *
 * KGV: es wird das vorhandene `pe`-Feld verglichen (kein Forward-P/E). Neutrales Label „KGV“,
 * weil die Basis gemischt ist: Subjekt ≈ TTM (quote.pe, analyze-route), Peers letztes GJ (/ratios, news-peers).
 */
import type { PeerCompany } from "@shared/schema";

export type PeerViewTab = "all" | "marketCap" | "pe" | "industry";

export const PEER_VIEW_MCAP_BAND = 0.5; // ±50 %
export const PEER_VIEW_PE_BAND = 0.3; // ±30 %

export const PEER_VIEW_PE_TOOLTIP = "Subjekt ≈ TTM (quote.pe), Peers letztes Geschäftsjahr (/ratios)";

export const PEER_VIEW_TABS: { key: PeerViewTab; label: string; title: string }[] = [
  { key: "all", label: "Alle", title: "Volles Peer-Set (Basis für Ø Peers, Score und PDF)" },
  { key: "marketCap", label: "Ähnliche Market Cap (±50 %)", title: "Market Cap innerhalb ±50 % des Analysewerts" },
  { key: "pe", label: "Ähnliches KGV (±30 %)", title: PEER_VIEW_PE_TOOLTIP },
  { key: "industry", label: "Gleiche Industrie", title: "Gleiche FMP-Branche wie der Analysewert. Peers ohne Profil: n/a" },
];

function positive(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** gleiche Normalisierung wie server/news-peers.ts normaliseIndustry */
export function normaliseIndustryLabel(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
}

export function withinRelativeBand(value: number | null | undefined, reference: number | null | undefined, band: number): boolean {
  const v = positive(value);
  const r = positive(reference);
  if (v == null || r == null) return false;
  return Math.abs(v / r - 1) <= band + 1e-12;
}

/** Peers, die in der Ansicht sichtbar sind. Fehlende Daten (null/n/a) → nicht im gefilterten Tab. */
export function filterPeersForView(
  peers: readonly PeerCompany[],
  subject: Pick<PeerCompany, "marketCap" | "pe">,
  subjectIndustry: string | null | undefined,
  tab: PeerViewTab,
): PeerCompany[] {
  if (tab === "all") return [...peers];
  if (tab === "marketCap") return peers.filter(p => withinRelativeBand(p.marketCap, subject.marketCap, PEER_VIEW_MCAP_BAND));
  if (tab === "pe") return peers.filter(p => withinRelativeBand(p.pe, subject.pe, PEER_VIEW_PE_BAND));
  const key = normaliseIndustryLabel(subjectIndustry);
  if (!key) return [];
  return peers.filter(p => normaliseIndustryLabel(p.industry) === key);
}

/** Anzeige der Peer-Branche: Feld fehlt → null (nichts anzeigen), null/leer → „n/a“. */
export function peerIndustryLabel(p: Pick<PeerCompany, "industry">): string | null {
  if (!("industry" in p) || p.industry === undefined) return null;
  return p.industry && p.industry.trim() ? p.industry : "n/a";
}

// Gleiche Grenzen wie der Server-Ø in server/news-peers.ts (fetchPeerComparisonFromTickers → peerAvg).
const AVG_BOUNDS: Record<string, [number, number]> = {
  pe: [0, 500], peg: [0, 20], ps: [0, 100], pb: [0, 200],
  epsGrowth1Y: [-100, 300], epsGrowth5Y: [-100, 300], roic: [-1000, 1000], roic5Y: [-1000, 1000],
};

function avg(values: (number | null | undefined)[], lo: number, hi: number): number | null {
  const valid = values.filter((v): v is number => v != null && !isNaN(v) && isFinite(v) && v > lo && v < hi);
  return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null;
}

/** Ansichts-Ø der sichtbaren Peers. Nur Anzeige, fließt in keinen Score. */
export function viewAverage(peers: readonly PeerCompany[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [key, [lo, hi]] of Object.entries(AVG_BOUNDS)) {
    let values = peers.map(p => (p as any)[key] as number | null | undefined);
    if (key === "pb") values = values.map(v => (v && v > 0 ? v : null));
    if (key === "roic" || key === "roic5Y") values = values.map(v => (v == null || !isFinite(v) || Math.abs(v) > 100 ? null : v));
    out[key] = avg(values, lo, hi);
  }
  return out;
}
