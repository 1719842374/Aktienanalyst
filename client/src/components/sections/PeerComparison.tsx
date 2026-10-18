import { useState, useMemo } from "react";
import type { StockAnalysis, PeerCompany } from "@shared/schema";
import type { PeerNaFill } from "@shared/peer-na-fill";
import { ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from "lucide-react";
import { PEER_RESET_NOTICE_TEXT, addListFull, removeListFull } from "@/lib/peerOverrideLimits";

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v) || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function fmtCap(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

const ROIC_ABS_CAP = 100;
const isRoicColumn = (key: string) => key === "roic" || key === "roic5Y";

// Cached responses may predate the backend plausibility rule. Do not surface
// those invalid values or let them affect a visual best-value highlight.
function sanitizedMetricValue(key: string, value: number | null | undefined): number | null {
  if (value == null || isNaN(value) || !isFinite(value)) return null;
  return isRoicColumn(key) && Math.abs(value) > ROIC_ABS_CAP ? null : value;
}

function fmtMetric(key: string, value: number | null | undefined, decimals: number, suffix: string): string {
  const sanitized = sanitizedMetricValue(key, value);
  if (sanitized == null) return isRoicColumn(key) ? "n/a" : "—";
  return `${fmt(sanitized, decimals)}${suffix}`;
}

type SortKey = "ticker" | "marketCap" | "pe" | "peg" | "ps" | "pb" | "epsGrowth1Y" | "epsGrowth5Y" | "roic" | "roic5Y";
type SortDir = "asc" | "desc";

// Find best value in a column (for green highlight)
function findBest(values: (number | null)[], lowerIsBetter: boolean): number | null {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  return lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
}

/** Max. sichtbare Peers (Server-Deckel applyPeerOverrides(…, 8) in peer-cache-key.ts). */
export const MAX_VISIBLE_PEERS = 8;

/**
 * PR A (WORK_PEER_SELECTION_DETAILED §2 „Max. Peers 8“): Deckel nur auf die sichtbare Liste.
 * `peers` enthält hinzugefügte Ticker bereits; activeAdd zusätzlich zu zählen sperrte bei 5 Auto-Peers schon bei 7.
 */
export function peerCapReached(peers: ReadonlyArray<{ ticker: string }>): boolean {
  return peers.length >= MAX_VISIBLE_PEERS;
}

/** Hinzugefügte Ticker, die nicht in der Peer-Tabelle angekommen sind (ungültig, außerhalb des Market-Cap-Bands, ohne Kennzahlen, Deckel 8). */
export function missingAddedPeers(activeAdd: readonly string[], peers: ReadonlyArray<{ ticker: string }>, subjectTicker: string): string[] {
  const shown = new Set(peers.map(p => p.ticker.toUpperCase()));
  const subject = subjectTicker.toUpperCase();
  return activeAdd.map(t => t.toUpperCase()).filter(t => t !== subject && !shown.has(t));
}

// Auftrag 09.08.2026 ("Peer-Liste nachziehbar"): onOverridesChange ist optional
// -- Aufrufer ohne den Callback (falls je vorhanden) sehen weiterhin nur die
// reine Tabelle, keine Verhaltensaenderung. Additiv, kein Ersatz bestehender Props.
export default function PeerComparison({ data, onOverridesChange, kiPeers = [], peerBusy = false }: {
  data: StockAnalysis;
  onOverridesChange?: (overrides: { add: string[]; remove: string[] }) => void;
  /** Session-only KI names. FMP metrics stay on the side list, not in the scored table. */
  kiPeers?: PeerNaFill[];
  /** True while the parent re-runs /api/analyze with the new peer overrides. */
  peerBusy?: boolean;
}) {
  const pc = data.peerComparison;
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [addInput, setAddInput] = useState("");

  // Lokaler Override-State, vorbelegt aus dem letzten Server-Response (falls
  // die Seite mit bereits aktiven Overrides geladen wurde).
  const activeAdd = data.activePeerOverrides?.add ?? [];
  const activeRemove = data.activePeerOverrides?.remove ?? [];

  const visiblePeers: PeerCompany[] = pc?.peers ?? [];
  const visibleCapReached = peerCapReached(visiblePeers);
  // #258 FAIL 5: harter Deckel auf die Add-Liste (Server-zod max. 8), zählt auch nicht übernommene Ticker.
  const addCapReached = addListFull(activeAdd);
  const capReached = visibleCapReached || addCapReached;
  const notAdopted = missingAddedPeers(activeAdd, visiblePeers, data.ticker);

  // Sort peers. #258: vor dem Early-Return (leere Peer-Liste), damit die Hook-Reihenfolge
  // beim Wechsel 0 Peers <-> Peers gleich bleibt (sonst "Rendered more/fewer hooks").
  const sortedPeers = useMemo(() => {
    if (!sortKey) return visiblePeers;
    return [...visiblePeers].sort((a, b) => {
      const av = sanitizedMetricValue(sortKey, (a as any)[sortKey]);
      const bv = sanitizedMetricValue(sortKey, (b as any)[sortKey]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortKey === "ticker") return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [visiblePeers, sortKey, sortDir]);

  const handleAddTicker = () => {
    if (!onOverridesChange) return;
    const t = addInput.trim().toUpperCase();
    if (!t || t === data.ticker) return;
    if (activeAdd.includes(t)) return;
    if (capReached) return; // Ticket: max. 8 sichtbare Peers, max. 8 Einträge in der Add-Liste
    onOverridesChange({ add: [...activeAdd, t], remove: activeRemove.filter(r => r !== t) });
    setAddInput("");
  };

  // #258 FAIL 5: nicht übernommene Ticker belegen Plätze in der Add-Liste und sind nicht
  // per „×“ in der Tabelle erreichbar -- einzeln aus der Add-Liste nehmen.
  const handleDropAdd = (ticker: string) => {
    if (!onOverridesChange) return;
    onOverridesChange({ add: activeAdd.filter(t => t.toUpperCase() !== ticker.toUpperCase()), remove: activeRemove });
  };

  const handleResetDefaults = () => {
    if (!onOverridesChange) return;
    onOverridesChange({ add: [], remove: [] });
  };

  // Auftrag 09.08.2026 ("Peer-Liste nachziehbar"): manuelles Nachziehen fehlender
  // Wettbewerber, serverseitig angewendet. PR A: auch bei leerer Peer-Liste sichtbar.
  const overrideControls = onOverridesChange ? (
    <PeerOverrideControls
      addInput={addInput}
      setAddInput={setAddInput}
      onAdd={handleAddTicker}
      onReset={handleResetDefaults}
      hasOverrides={activeAdd.length > 0 || activeRemove.length > 0}
      capReached={capReached}
      visibleCapReached={visibleCapReached}
      addCapReached={addCapReached}
      peerBusy={peerBusy}
      notAdopted={peerBusy ? [] : notAdopted}
      onDropAdd={handleDropAdd}
    />
  ) : null;

  if (!pc || !pc.peers || pc.peers.length === 0) {
    return (
      <div className="space-y-3" data-testid="peer-empty">
        {overrideControls && (
          <div className="text-xs text-muted-foreground" data-testid="peer-empty-note">
            Keine Wettbewerber mit Kennzahlen. Ticker hinzufügen, um Peers zu ergänzen.
          </div>
        )}
        {overrideControls}
        <KiSideList peers={kiPeers} />
      </div>
    );
  }

  const { subject, peers, peerAvg, sectorMedian } = pc;
  const scoredTickers = new Set(peers.map((p) => p.ticker.toUpperCase()));
  const sideKi = kiPeers.filter((row) => !scoredTickers.has(row.ticker.toUpperCase()));

  const handleRemove = (ticker: string) => {
    if (!onOverridesChange) return;
    if (removeListFull(activeRemove, ticker)) return; // #258 FAIL 5: Server-zod max. 8 auch für remove
    const newRemove = activeRemove.includes(ticker) ? activeRemove : [...activeRemove, ticker];
    const newAdd = activeAdd.filter(t => t !== ticker);
    onOverridesChange({ add: newAdd, remove: newRemove });
  };

  // Columns config
  const cols: { key: SortKey; label: string; lowerIsBetter: boolean; decimals: number; suffix: string }[] = [
    { key: "pe", label: "P/E", lowerIsBetter: true, decimals: 1, suffix: "" },
    { key: "peg", label: "PEG", lowerIsBetter: true, decimals: 2, suffix: "" },
    { key: "ps", label: "P/S", lowerIsBetter: true, decimals: 1, suffix: "" },
    { key: "pb", label: "P/B", lowerIsBetter: true, decimals: 1, suffix: "" },
    { key: "epsGrowth1Y", label: "EPS 1Y", lowerIsBetter: false, decimals: 1, suffix: "%" },
    { key: "epsGrowth5Y", label: "EPS 5Y", lowerIsBetter: false, decimals: 1, suffix: "%" },
    // ROIC (Return on Invested Capital) — vorher komplett fehlend. FMP liefert
    // returnOnInvestedCapital ueber /stable/key-metrics; roicFiscalYear zeigt
    // an, aus welchem Geschaeftsjahr der Wert stammt (Datenaktualitaet).
    // Auftrag 05.08.2026: Label enthaelt jetzt das Fiskaljahr des Subjekts
    // (z.B. "ROIC (FY2025)") statt generisch "ROIC", damit klar ist, welches
    // Jahr gemeint ist — unabhaengig ob Subjekt oder Peers ein anderes FY haben.
    { key: "roic", label: subject.roicFiscalYear ? `ROIC (FY${subject.roicFiscalYear})` : "ROIC (FY)", lowerIsBetter: false, decimals: 1, suffix: "%" },
    // Auftrag 05.08.2026: zweite ROIC-Spalte — arithmetischer Durchschnitt der
    // letzten bis zu 5 Geschaeftsjahre. Zeigt "n/a",
    // wenn < 3 Jahre mit echtem Wert vorliegen (server-seitig entschieden in
    // news-peers.ts extractRoicFromKeyMetricsRows).
    { key: "roic5Y", label: "ROIC 5Y Ø", lowerIsBetter: false, decimals: 1, suffix: "%" },
  ];

  // Toggle sort
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Default: lower-is-better → asc, higher-is-better → desc
      const col = cols.find(c => c.key === key);
      setSortDir(col?.lowerIsBetter ? "asc" : "desc");
    }
  }

  // All companies for best-value
  const allCompanies: PeerCompany[] = [subject, ...peers];
  const bestValues = new Map<string, number | null>();
  for (const col of cols) {
    bestValues.set(col.key, findBest(allCompanies.map(c => sanitizedMetricValue(col.key, (c as any)[col.key])), col.lowerIsBetter));
  }

  function isBest(key: string, val: number | null | undefined): boolean {
    const sanitized = sanitizedMetricValue(key, val);
    if (sanitized == null || sanitized <= 0) return false;
    const best = bestValues.get(key);
    return best != null && Math.abs(sanitized - best) < 0.01;
  }

  // Cell styling
  function cellCls(key: string, val: number | null | undefined, isSubject: boolean): string {
    const base = "py-1.5 px-1 text-right font-mono tabular-nums text-[11px]";
    if (isBest(key, val)) return `${base} text-emerald-400 font-bold`;
    return isSubject ? base : `${base} text-foreground/70`;
  }

  // Sort icon
  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-2.5 h-2.5 text-foreground/20" />;
    return sortDir === "asc" ? <ArrowUp className="w-2.5 h-2.5 text-primary" /> : <ArrowDown className="w-2.5 h-2.5 text-primary" />;
  }

  // Sector median value for a column
  function sectorVal(key: string): number | null {
    if (!sectorMedian) return null;
    if (key === "pe") return sectorMedian.pe;
    if (key === "peg") return sectorMedian.peg;
    if (key === "ps") return sectorMedian.ps;
    if (key === "pb") return sectorMedian.pb;
    if (key === "epsGrowth1Y" || key === "epsGrowth5Y") return sectorMedian.epsGrowth;
    // ROIC hat (noch) keinen Damodaran-Sektor-Median in sectorMedian — bewusst
    // null statt einer erfundenen Zahl.
    return null;
  }

  // Premium/discount cards
  function premiumPct(sv: number | null, av: number | null): string | null {
    if (sv == null || av == null || av === 0) return null;
    const d = ((sv - av) / av) * 100;
    return d > 0 ? `+${d.toFixed(0)}%` : `${d.toFixed(0)}%`;
  }
  function premColor(sv: number | null, av: number | null, lowerIsBetter: boolean): string {
    if (sv == null || av == null || av === 0) return "text-foreground/40";
    const d = ((sv - av) / av) * 100;
    const cheap = lowerIsBetter ? d < -5 : d > 5;
    const expensive = lowerIsBetter ? d > 5 : d < -5;
    if (cheap) return "text-emerald-400";
    if (expensive) return "text-red-400";
    return "text-foreground/50";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {peers.length} Wettbewerber — <span className="text-emerald-400 font-medium">■</span> bester Wert
          {subject.roicFiscalYear && (
            <span className="text-foreground/40" title="ROIC-Basis: letztes FY + 5Y-Durchschnitt (soweit verfügbar)">
              {" "}· ROIC-Basis: letztes FY ({subject.roicFiscalYear}) + 5Y-Durchschnitt (soweit verfügbar)
            </span>
          )}
        </div>
        {sortKey && (
          <button className="text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors" onClick={() => { setSortKey(null); setSortDir("asc"); }}>
            Sortierung zurücksetzen
          </button>
        )}
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[11px]" data-testid="peer-scored-table">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-1.5 text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground/80 transition-colors" onClick={() => handleSort("ticker")}>
                <div className="flex items-center gap-0.5">Ticker <SortIcon col="ticker" /></div>
              </th>
              <th className="text-right py-1.5 px-1 text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground/80 transition-colors" onClick={() => handleSort("marketCap")}>
                <div className="flex items-center justify-end gap-0.5">Mkt Cap <SortIcon col="marketCap" /></div>
              </th>
              {cols.map(c => (
                <th key={c.key} className="text-right py-1.5 px-1 text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground/80 transition-colors" onClick={() => handleSort(c.key)} title={c.key === "roic5Y" ? "Durchschnitt der letzten 3–5 verfügbaren Geschäftsjahre. \"n/a\" = zu kurze Historie oder unplausibler FMP-Wert" : undefined}>
                  <div className="flex items-center justify-end gap-0.5">{c.label} <SortIcon col={c.key} /></div>
                </th>
              ))}
              {onOverridesChange && <th className="w-6"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {/* Subject row */}
            <tr className="bg-primary/5 font-semibold">
              <td className="py-1.5 px-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-primary">{subject.ticker}</span>
                  <span className="text-[8px] px-1 py-px rounded bg-primary/15 text-primary/70">Analyse</span>
                </div>
              </td>
              <td className="py-1.5 px-1 text-right font-mono tabular-nums text-[11px]">{fmtCap(subject.marketCap)}</td>
              {cols.map(c => {
                const val = (subject as any)[c.key] as number | null;
                const sanitized = sanitizedMetricValue(c.key, val);
                return <td key={c.key} className={cellCls(c.key, sanitized, true)}>{fmtMetric(c.key, val, c.decimals, c.suffix)}</td>;
              })}
              {onOverridesChange && <td></td>}
            </tr>

            {/* Peer rows */}
            {sortedPeers.map((p, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <td className="py-1.5 px-1.5 text-foreground/80">{p.ticker}</td>
                <td className="py-1.5 px-1 text-right font-mono tabular-nums text-[11px] text-foreground/50">{fmtCap(p.marketCap)}</td>
                {cols.map(c => {
                  const val = (p as any)[c.key] as number | null;
                  const sanitized = sanitizedMetricValue(c.key, val);
                  return <td key={c.key} className={cellCls(c.key, sanitized, false)}>{fmtMetric(c.key, val, c.decimals, c.suffix)}</td>;
                })}
                {onOverridesChange && (
                  <td className="py-1.5 px-1 text-right">
                    <button
                      className="text-[10px] text-foreground/30 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={removeListFull(activeRemove, p.ticker) ? "Max. 8 entfernte Peers — Standard wiederherstellen" : `${p.ticker} aus Peer-Liste entfernen`}
                      disabled={removeListFull(activeRemove, p.ticker)}
                      onClick={() => handleRemove(p.ticker)}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {/* Peer Average row */}
            <tr className="border-t-2 border-border bg-muted/10 font-medium">
              <td className="py-1.5 px-1.5 text-muted-foreground">Ø Peers</td>
              <td className="py-1.5 px-1 text-right text-muted-foreground text-[11px]">—</td>
              {cols.map(c => {
                const avgVal = (peerAvg as any)[c.key] as number | null;
                return <td key={c.key} className="py-1.5 px-1 text-right font-mono tabular-nums text-[11px] text-muted-foreground">{fmtMetric(c.key, avgVal, c.decimals, c.suffix)}</td>;
              })}
              {onOverridesChange && <td></td>}
            </tr>

            {/* Sector Median row (Damodaran) */}
            {sectorMedian && (
              <tr className="bg-amber-500/5 border-t border-amber-500/20">
                <td className="py-1.5 px-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-amber-400/80 text-[10px]">◈</span>
                    <span className="text-amber-400/80 text-[10px]">Sektor</span>
                  </div>
                </td>
                <td className="py-1.5 px-1 text-right text-amber-400/50 text-[10px]">Median</td>
                {cols.map(c => {
                  const sv = sectorVal(c.key);
                  return <td key={c.key} className="py-1.5 px-1 text-right font-mono tabular-nums text-[10px] text-amber-400/70">{sv != null ? `${fmt(sv, c.decimals)}${c.suffix}` : "—"}</td>;
                })}
                {onOverridesChange && <td></td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Auftrag 09.08.2026 ("Peer-Liste nachziehbar"): manuelles Nachziehen
          fehlender Wettbewerber -- kein Hardcode im Core, der User kann jeden
          Ticker ergaenzen (z.B. LLY bei NVO), Overrides werden serverseitig
          angewendet und fliessen in Peer-Tabelle, Sektor-Median, g_required. */}
      {overrideControls}

      {/* Premium/Discount Summary Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {cols.map(c => {
          const sVal = sanitizedMetricValue(c.key, (subject as any)[c.key] as number | null);
          const aVal = sanitizedMetricValue(c.key, (peerAvg as any)[c.key] as number | null);
          const prem = premiumPct(sVal, aVal);
          const color = premColor(sVal, aVal, c.lowerIsBetter);
          const bgColor = color.includes("emerald") ? "bg-emerald-500/8 border-emerald-500/20" :
            color.includes("red") ? "bg-red-500/8 border-red-500/20" : "bg-muted/20 border-border/30";
          return (
            <div key={c.key} className={`rounded-lg border p-1.5 text-center ${bgColor}`}>
              <div className="text-[10px] text-muted-foreground">{c.label}</div>
              <div className={`text-sm font-mono font-bold ${color}`}>{prem || "—"}</div>
              <div className={`text-[9px] ${color}`}>
                {!prem ? "" : color.includes("emerald") ? (c.lowerIsBetter ? "Discount" : "Stärker") :
                 color.includes("red") ? (c.lowerIsBetter ? "Premium" : "Schwächer") : "Fair"}
              </div>
            </div>
          );
        })}
      </div>

      <KiSideList peers={sideKi} />
    </div>
  );
}

export function PeerOverrideControls({ addInput, setAddInput, onAdd, onReset, hasOverrides, capReached, visibleCapReached = capReached, addCapReached = false, peerBusy, notAdopted, onDropAdd }: {
  addInput: string;
  setAddInput: (v: string) => void;
  onAdd: () => void;
  onReset: () => void;
  hasOverrides: boolean;
  capReached: boolean;
  visibleCapReached?: boolean;
  addCapReached?: boolean;
  peerBusy: boolean;
  notAdopted: string[];
  onDropAdd?: (ticker: string) => void;
}) {
  return (
    <div className="space-y-1 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={addInput}
          onChange={e => setAddInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onAdd(); }}
          placeholder="Ticker hinzufügen (z.B. LLY)"
          className="text-[11px] bg-muted/30 border border-border/50 rounded-md px-2 py-1 w-40 focus:outline-none focus:ring-1 focus:ring-primary/40"
          maxLength={12}
          disabled={peerBusy}
          data-testid="input-peer-add"
        />
        <button
          onClick={onAdd}
          disabled={peerBusy || !addInput.trim() || capReached}
          className="text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="button-peer-add"
        >
          + Peer hinzufügen
        </button>
        {peerBusy && (
          <span className="text-[10px] text-primary flex items-center gap-1" data-testid="peer-add-loading" role="status">
            <Loader2 className="w-3 h-3 animate-spin" />
            Peer wird geladen…
          </span>
        )}
        <button
          onClick={onReset}
          disabled={peerBusy || !hasOverrides}
          title={hasOverrides ? "Hinzugefügte/entfernte Peers zurücksetzen" : "Keine manuellen Änderungen aktiv"}
          className="text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors ml-1 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="button-peer-reset"
        >
          Standard wiederherstellen
        </button>
        {visibleCapReached && (
          <span className="text-[10px] text-amber-400/70" data-testid="peer-cap-reached">Max. 8 Peers erreicht</span>
        )}
        {!visibleCapReached && addCapReached && (
          <span className="text-[10px] text-amber-400/70" data-testid="peer-add-cap-reached">Max. 8 Hinzufügungen erreicht — nicht übernommene entfernen oder Standard wiederherstellen</span>
        )}
      </div>
      {notAdopted.length > 0 && (
        <div
          className="text-[10px] text-amber-400/80"
          title="Möglich: Ticker ungültig, Market Cap außerhalb 5 %–20× des Analysewerts, keine Kennzahlen bei FMP oder Deckel 8 erreicht"
          data-testid="peer-not-adopted"
        >
          {notAdopted.join(", ")} nicht übernommen (ungültig, außerhalb des Market-Cap-Bands oder ohne Kennzahlen)
          {onDropAdd && (
            <span className="ml-1 inline-flex flex-wrap gap-1">
              {notAdopted.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onDropAdd(t)}
                  disabled={peerBusy}
                  className="rounded border border-amber-400/30 px-1 text-[10px] hover:bg-amber-400/10 disabled:opacity-40"
                  title={`${t} aus der Hinzufügen-Liste nehmen`}
                  data-testid={`peer-not-adopted-drop-${t}`}
                >
                  {t} ×
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type PeerCol = { key: SortKey; label: string; lowerIsBetter: boolean; decimals: number; suffix: string };

/** Stabschef-Follow-up #258: Hinweis nach automatischem Verwerfen abgelehnter Overrides (400). */
export function PeerOverrideResetNotice({ ticker, onDismiss }: { ticker: string; onDismiss?: () => void }) {
  return (
    <div
      role="status"
      className="mt-4 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300"
      data-testid="peer-reset-notice"
    >
      <span className="flex-1">
        {PEER_RESET_NOTICE_TEXT} — die gespeicherten Peer-Anpassungen für {ticker} wurden vom Server abgelehnt; Standard-Peers geladen.
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-amber-300/70 hover:text-amber-200"
          aria-label="Hinweis schließen"
          title="Hinweis schließen"
          data-testid="button-peer-reset-notice-dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

function KiBadge({ testId }: { testId?: string }) {
  return (
    <span
      className="ml-1 inline-flex items-center rounded border border-violet-500/40 bg-violet-500/15 px-1 align-middle text-[8px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-200"
      title="KI-Vorschlag. Kennzahlen von FMP, nicht vom Modell."
      aria-label="KI-Vorschlag"
      data-testid={testId}
    >
      KI
    </span>
  );
}

function KiPeerRow({ peer, cols, trailingCell }: { peer: PeerNaFill; cols: PeerCol[]; trailingCell: boolean }) {
  return (
    <tr className="bg-violet-500/5" data-testid={`row-peer-ki-${peer.ticker}`}>
      <td className="py-1.5 px-1.5 text-violet-700 dark:text-violet-200">
        {peer.ticker}
        <KiBadge testId={`badge-peer-ki-${peer.ticker}`} />
      </td>
      <td className="py-1.5 px-1 text-right font-mono tabular-nums text-[11px]">{fmtCap(peer.marketCap)}</td>
      {cols.map(c => {
        const val = (peer as unknown as Record<string, number | null | undefined>)[c.key];
        return (
          <td key={c.key} className="py-1.5 px-1 text-right font-mono tabular-nums text-[11px]">
            {fmtMetric(c.key, val, c.decimals, c.suffix)}
          </td>
        );
      })}
      {trailingCell ? <td></td> : null}
    </tr>
  );
}

const KI_ONLY_COLS: PeerCol[] = [
  { key: "pe", label: "P/E", lowerIsBetter: true, decimals: 1, suffix: "" },
  { key: "peg", label: "PEG", lowerIsBetter: true, decimals: 2, suffix: "" },
  { key: "ps", label: "P/S", lowerIsBetter: true, decimals: 1, suffix: "" },
  { key: "pb", label: "P/B", lowerIsBetter: true, decimals: 1, suffix: "" },
  { key: "epsGrowth1Y", label: "EPS 1Y", lowerIsBetter: false, decimals: 1, suffix: "%" },
  { key: "epsGrowth5Y", label: "EPS 5Y", lowerIsBetter: false, decimals: 1, suffix: "%" },
  { key: "roic", label: "ROIC (FY)", lowerIsBetter: false, decimals: 1, suffix: "%" },
  { key: "roic5Y", label: "ROIC 5Y Ø", lowerIsBetter: false, decimals: 1, suffix: "%" },
];

function KiSideList({ peers }: { peers: PeerNaFill[] }) {
  if (peers.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="peer-ki-side-list">
      <div className="text-[10px] text-violet-700 dark:text-violet-300">
        KI-Namen · nicht in der Peer-Tabelle · Kennzahlen von FMP
      </div>
      <KiOnlyPeerTable peers={peers} />
    </div>
  );
}

function KiOnlyPeerTable({ peers }: { peers: PeerNaFill[] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 px-1.5 text-muted-foreground font-medium">Ticker</th>
            <th className="text-right py-1.5 px-1 text-muted-foreground font-medium">Mkt Cap</th>
            {KI_ONLY_COLS.map(c => (
              <th key={c.key} className="text-right py-1.5 px-1 text-muted-foreground font-medium">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {peers.map(p => <KiPeerRow key={p.ticker} peer={p} cols={KI_ONLY_COLS} trailingCell={false} />)}
        </tbody>
      </table>
    </div>
  );
}
