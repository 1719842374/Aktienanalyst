/**
 * GeoMapPanel — Offen_WORK_CAPEX_SECTOR_MAP.md Slice 1 (Capex-Layer).
 * 2D-Weltkarte (react-simple-maps + world-atlas, Asset lokal gebündelt) mit Capex-Bubbles je Land,
 * Klick → Seitenpanel mit Top-Firmen (Capex USD, YoY, Sektor-Anteile).
 * Daten: GET /api/researcher/geo-map?layer=capex. Fehlende Werte = n/a, nichts geschätzt.
 * Nur Anzeige, kein Score.
 */
import { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import worldUrl from "world-atlas/countries-110m.json?url";
import { AlertTriangle, Globe2, Loader2, RefreshCw, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { GeoMapCountry, GeoMapResponse } from "@shared/geo-map";

type Metric = "capex" | "yoy";

const LAYERS: { id: string; label: string; available: boolean; hint?: string }[] = [
  { id: "capex", label: "Capex", available: true },
  { id: "sector", label: "Sektor-Exposure", available: false, hint: "Slice 2" },
  { id: "miner", label: "BTC-Miner", available: false, hint: "Slice 3" },
  { id: "gold", label: "Gold-Minen", available: false, hint: "Vorschlag" },
];

function fmtBn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const bn = v / 1e9;
  return `${bn >= 10 ? bn.toFixed(0) : bn.toFixed(1)} Mrd $`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function yoyColor(v: number | null): string {
  if (v == null) return "#64748b";
  if (v >= 10) return "#10b981";
  if (v >= 0) return "#84cc16";
  if (v > -10) return "#f59e0b";
  return "#f43f5e";
}

export function GeoMapPanel() {
  const [data, setData] = useState<GeoMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<Metric>("capex");
  const [selected, setSelected] = useState<string | null>(null);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("GET", `/api/researcher/geo-map?layer=capex${refresh ? "&refresh=1" : ""}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Weltkarte fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(false); }, []);

  const maxCapex = useMemo(
    () => Math.max(0, ...(data?.countries || []).map(c => c.capexUsd ?? 0)),
    [data]
  );
  const byNum = useMemo(() => {
    const m = new Map<string, GeoMapCountry>();
    for (const c of data?.countries || []) m.set(c.isoNum, c);
    return m;
  }, [data]);
  const ranked = useMemo(
    () => (data?.countries || []).filter(c => c.status === "ok").sort((a, b) => (b.capexUsd ?? 0) - (a.capexUsd ?? 0)),
    [data]
  );
  const sel = data?.countries.find(c => c.iso2 === selected) || null;

  const radius = (c: GeoMapCountry) => (c.capexUsd && maxCapex > 0 ? 4 + 22 * Math.sqrt(c.capexUsd / maxCapex) : 3);
  const fill = (c: GeoMapCountry) => (c.status !== "ok" ? "#64748b" : metric === "yoy" ? yoyColor(c.yoyPct) : "#8b5cf6");

  return (
    <div className="mb-4 rounded-lg border border-border/30 bg-muted/20 p-3 space-y-3" data-testid="geo-map-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
            <Globe2 className="w-3.5 h-3.5 text-violet-400" /> Capex-Weltkarte
            <span className="font-normal text-[10px] text-foreground/45" data-testid="geo-attribution">· nach Firmensitz</span>
          </div>
          {data && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {data.coverage.withData}/{data.coverage.total} Länder mit Daten · Stand {new Date(data.asOf).toLocaleDateString("de-DE")}
              {data._cached ? " · Cache" : ""}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["capex", "yoy"] as Metric[]).map(m => (
            <button key={m} type="button" onClick={() => setMetric(m)}
              className={`px-2 py-1 rounded-md text-[10px] border ${metric === m ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-border/30 text-foreground/50 hover:text-foreground"}`}
              data-testid={`button-geo-metric-${m}`}>
              {m === "capex" ? "Capex USD" : "YoY %"}
            </button>
          ))}
          <button type="button" onClick={() => load(true)} disabled={loading}
            className="px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1"
            data-testid="button-refresh-geo-map">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Aktualisieren
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {LAYERS.map(l => (
          <span key={l.id}
            className={`px-2 py-0.5 rounded-full text-[10px] border ${l.available ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-border/30 text-foreground/35"}`}
            title={l.available ? "aktiv" : `geplant (${l.hint})`} data-testid={`chip-geo-layer-${l.id}`}>
            {l.label}{l.available ? " · an" : ` · ${l.hint}`}
          </span>
        ))}
      </div>

      {error && (
        <div className="p-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {!data && loading && (
        <div className="flex items-center justify-center py-16 text-[11px] text-foreground/50 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" /> Lade Capex je Land (FMP, erster Aufbau bis ~1 min)…
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
          <div className="rounded-md border border-border/30 bg-background/40 overflow-hidden">
            <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 160 }} width={800} height={400} style={{ width: "100%", height: "auto" }}>
              <Geographies geography={worldUrl}>
                {({ geographies }) => geographies.map(geo => {
                  const c = byNum.get(String(geo.id));
                  const isSel = c && c.iso2 === selected;
                  return (
                    <Geography key={geo.rsmKey} geography={geo}
                      onClick={() => c && setSelected(c.iso2)}
                      fill={isSel ? "rgba(139,92,246,0.45)" : c?.status === "ok" ? "rgba(139,92,246,0.18)" : "rgba(148,163,184,0.12)"}
                      stroke="rgba(148,163,184,0.25)" strokeWidth={0.4}
                      className={c ? "outline-none cursor-pointer hover:opacity-80" : "outline-none"} />
                  );
                })}
              </Geographies>
              {(data.countries || []).map(c => (
                <Marker key={c.iso2} coordinates={[c.lon, c.lat]} onClick={() => setSelected(c.iso2)}>
                  <circle r={radius(c)} fill={fill(c)} fillOpacity={c.status === "ok" ? 0.7 : 0.35}
                    stroke={c.iso2 === selected ? "#fff" : "rgba(15,23,42,0.6)"} strokeWidth={c.iso2 === selected ? 1.5 : 0.6}
                    style={{ cursor: "pointer" }} data-testid={`geo-bubble-${c.iso2}`}>
                    <title>{`${c.name}: ${fmtBn(c.capexUsd)} · YoY ${fmtPct(c.yoyPct)}`}</title>
                  </circle>
                </Marker>
              ))}
            </ComposableMap>
            <div className="px-2 pb-1.5 text-[10px] text-foreground/40 flex flex-wrap gap-x-3">
              <span>Bubble-Größe = Capex (USD, letztes GJ)</span>
              {metric === "yoy" && <span>Farbe = YoY (grün ≥ +10 %, rot ≤ −10 %, grau n/a)</span>}
              <span>grau = n/a</span>
            </div>
          </div>

          <div className="rounded-md border border-border/30 bg-background/40 p-2.5 text-[11px]" data-testid="geo-side-panel">
            {sel ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-foreground/85">{sel.name}</div>
                  <button type="button" onClick={() => setSelected(null)} className="text-foreground/40 hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex gap-4">
                  <div><div className="text-foreground/45 text-[10px]">Capex</div><div className="font-mono">{fmtBn(sel.capexUsd)}</div></div>
                  <div><div className="text-foreground/45 text-[10px]">YoY</div><div className="font-mono">{fmtPct(sel.yoyPct)}</div></div>
                </div>
                {sel.note && <div className="text-foreground/45 italic">{sel.note}</div>}
                {sel.companies.length > 0 && (
                  <table className="w-full">
                    <thead><tr className="text-foreground/45 text-[10px]"><th className="text-left font-normal">Firma</th><th className="text-right font-normal">Capex</th><th className="text-right font-normal">YoY</th></tr></thead>
                    <tbody>
                      {sel.companies.map(co => (
                        <tr key={co.symbol} className="border-t border-border/20">
                          <td className="py-1"><div className="font-mono text-foreground/80">{co.symbol}</div><div className="text-[10px] text-foreground/45 truncate max-w-[150px]">{co.name}{co.sector ? ` · ${co.sector}` : ""}</div></td>
                          <td className="text-right font-mono">{fmtBn(co.capexUsd)}{co.fiscalYear ? <div className="text-[9px] text-foreground/40">GJ {co.fiscalYear}</div> : null}</td>
                          <td className="text-right font-mono">{fmtPct(co.yoyPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {sel.sectorShares.length > 0 && (
                  <div>
                    <div className="text-foreground/45 text-[10px] mb-1">Sektor-Anteil am erfassten Capex</div>
                    {sel.sectorShares.map(s => (
                      <div key={s.sector} className="flex items-center gap-2 mb-0.5">
                        <span className="w-24 truncate text-foreground/70">{s.sector}</span>
                        <div className="flex-1 h-1.5 rounded bg-muted/40"><div className="h-1.5 rounded bg-violet-500/70" style={{ width: `${s.pct}%` }} /></div>
                        <span className="w-10 text-right font-mono">{s.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-foreground/50 mb-1">Land anklicken für Top-Firmen. Ranking:</div>
                {ranked.length === 0 && <div className="text-foreground/45">n/a — keine Capex-Daten verfügbar</div>}
                {ranked.map((c, i) => (
                  <button key={c.iso2} type="button" onClick={() => setSelected(c.iso2)}
                    className="w-full flex items-center justify-between px-1.5 py-1 rounded hover:bg-muted/40" data-testid={`geo-rank-${c.iso2}`}>
                    <span className="text-foreground/75">{i + 1}. {c.name}</span>
                    <span className="font-mono">{fmtBn(c.capexUsd)} <span className="text-foreground/45">{fmtPct(c.yoyPct)}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {data && <div className="text-[10px] text-foreground/40 leading-relaxed">Quelle: {data.source}. {data.attribution}</div>}
    </div>
  );
}
