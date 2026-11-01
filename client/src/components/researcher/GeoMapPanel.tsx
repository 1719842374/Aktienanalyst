/**
 * GeoMapPanel — Offen_WORK_CAPEX_SECTOR_MAP.md und Offen_WORK_RESEARCHER_CAPEX_MAP.md.
 * Capex- und Sektor-Layer: GET /api/researcher/geo-map?layer=capex|sector.
 * Miner-Layer: derselbe Pfad mit layer=miner (Netz aus btc-miner.ts).
 * Gold und Wertschöpfung: layer=gold|valuechain.
 * Größe und Farbe der Hotspots kommen aus dem Perzentil der geladenen Verteilung.
 * Sektor-Layer: Füllung = sectorColor(dominantSector), Legende = sectorLegendShares.
 * Rand und Karte = Perzentil-Ampel (shareBand, Terzile aus SECTOR_LAYER_PARAMS).
 * HTML und Zeitüberschreitung werden zu n/a mit Grund, nie zu einer Parser-Meldung.
 * Nur Anzeige, kein Score.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import worldUrl from "world-atlas/countries-110m.json?url";
import { AlertTriangle, Globe2, Loader2, RefreshCw, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { naReasonFromError, readApiJson } from "@shared/read-api-json";
import { MinerMapPanel } from "@/components/researcher/MinerMapPanel";
import {
  GEO_MAP_CLIENT_TIMEOUT_MS,
  GEO_MAP_PENDING_RETRY_LIMIT,
  GEO_MAP_PENDING_RETRY_MS,
  GEO_SCALE_COLORS,
  MINER_LOCATION_NOTE,
  colorForPercentile,
  metricPercentiles,
  radiusForPercentile,
  sectorColor,
  sectorLegendShares,
  type GeoMapCountry,
  type GeoMapMinerResponse,
  type GeoMapResponse,
  type GeoMapSectorResponse,
  type SectorBand,
} from "@shared/geo-map";
import { goldCountryHasProduction, type GoldMapCountry, type GoldMapResponse, type ValueChainMapResponse } from "@shared/geo-map-layers";

type Metric = "capex" | "yoy";
type LayerId = "capex" | "sector" | "miner" | "gold" | "valuechain";
type MapPayload = GeoMapResponse | GeoMapMinerResponse | GoldMapResponse | ValueChainMapResponse;

const LAYERS: { id: LayerId; label: string; available: boolean; hint?: string }[] = [
  { id: "capex", label: "Capex", available: true },
  { id: "sector", label: "Sektor-Exposure", available: true },
  { id: "miner", label: "BTC-Miner", available: true },
  { id: "gold", label: "Gold Mining", available: true },
  { id: "valuechain", label: "Wertschöpfungskette", available: true },
];

function isMiner(d: MapPayload): d is GeoMapMinerResponse {
  return d.layer === "miner";
}

function isSectorOverlay(d: MapPayload): d is GeoMapSectorResponse {
  return d.layer === "sector" && "sectorLayer" in d;
}

const BAND_LABEL: Record<SectorBand, string> = {
  green: "oberes Terzil",
  yellow: "Mitte",
  red: "unteres Terzil",
  neutral: "neutral",
};
const BAND_CLASS: Record<SectorBand, string> = {
  green: "text-emerald-300",
  yellow: "text-amber-300",
  red: "text-rose-300",
  neutral: "text-foreground/50",
};
const BAND_STROKE: Record<SectorBand, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#f43f5e",
  neutral: "#64748b",
};
const BAND_ORDER: readonly SectorBand[] = ["green", "yellow", "red", "neutral"];

function fmtBn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const bn = v / 1e9;
  return `${bn >= 10 ? bn.toFixed(0) : bn.toFixed(1)} Mrd $`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtNum(v: number | null | undefined, digits: number, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(digits)} ${unit}`;
}
function goldBubbleTitle(c: GoldMapCountry): string {
  const bits: string[] = [];
  if (typeof c.countrySharePct === "number" && c.countrySharePct > 0) bits.push(`${c.countrySharePct} %`);
  if (typeof c.productionOz === "number" && c.productionOz > 0) bits.push(`${c.productionOz} oz`);
  return bits.length > 0 ? `${c.name}: ${bits.join(" · ")}` : c.name;
}

export function GeoMapPanel({ onOpenSectorOpportunity }: { onOpenSectorOpportunity?: () => void } = {}) {
  const [data, setData] = useState<MapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<Metric>("capex");
  const [layer, setLayer] = useState<LayerId>("capex");
  const [selected, setSelected] = useState<string | null>(null);
  const retries = useRef(0);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    setData(prev => (prev && prev.layer === layer ? prev : null));
    try {
      const res = await apiRequest(
        "GET",
        `/api/researcher/geo-map?layer=${layer}${refresh ? "&refresh=1" : ""}`,
        undefined,
        GEO_MAP_CLIENT_TIMEOUT_MS,
      );
      const parsed = await readApiJson(res);
      if (!parsed.ok) {
        setData(null);
        setError(parsed.reason);
        return;
      }
      const json = parsed.json as { error?: string };
      if (json?.error) {
        setData(null);
        setError(json.error.startsWith("n/a") ? json.error : `n/a — ${json.error}`);
        return;
      }
      setData(parsed.json as MapPayload);
    } catch (err) {
      setData(null);
      setError(naReasonFromError(err));
    } finally {
      setLoading(false);
    }
  }, [layer]);

  useEffect(() => {
    retries.current = 0;
    setSelected(null);
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!data?.pending) return;
    if (retries.current >= GEO_MAP_PENDING_RETRY_LIMIT) return;
    const timer = setTimeout(() => {
      retries.current += 1;
      void load(false);
    }, GEO_MAP_PENDING_RETRY_MS);
    return () => clearTimeout(timer);
  }, [data, load]);

  const capexData = data && (data.layer === "capex" || data.layer === "sector") ? data : null;
  const sectorOverlay = data && isSectorOverlay(data) ? data : null;
  const minerData = data && isMiner(data) ? data : null;
  const goldData = data && data.layer === "gold" ? data : null;
  const chainData = data && data.layer === "valuechain" ? data : null;
  const minerSharePercentiles = useMemo(() => {
    const values = (minerData?.regions || []).map(r => r.hashrateSharePct);
    const pcts = metricPercentiles(values);
    const m = new Map<string, number | null>();
    (minerData?.regions || []).forEach((r, i) => m.set(r.id, pcts[i] ?? null));
    return m;
  }, [minerData]);

  const capexPercentiles = useMemo(() => {
    const values = (capexData?.countries || []).map(c => (c.status === "ok" ? c.capexUsd : null));
    const pcts = metricPercentiles(values);
    const m = new Map<string, number | null>();
    (capexData?.countries || []).forEach((c, i) => m.set(c.iso2, pcts[i] ?? null));
    return m;
  }, [capexData]);
  const yoyPercentiles = useMemo(() => {
    const values = (capexData?.countries || []).map(c => (c.status === "ok" ? c.yoyPct : null));
    const pcts = metricPercentiles(values);
    const m = new Map<string, number | null>();
    (capexData?.countries || []).forEach((c, i) => m.set(c.iso2, pcts[i] ?? null));
    return m;
  }, [capexData]);
  const byNum = useMemo(() => {
    const m = new Map<string, GeoMapCountry>();
    for (const c of capexData?.countries || []) m.set(c.isoNum, c);
    return m;
  }, [capexData]);
  const ranked = useMemo(() => {
    const rows = (capexData?.countries || []).filter(c => c.status === "ok");
    const value = (c: GeoMapCountry) => (layer === "capex" && metric === "yoy" ? c.yoyPct : c.capexUsd);
    return rows.sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
  }, [capexData, layer, metric]);
  const sectorLegend = useMemo(() => sectorLegendShares(capexData?.countries || []), [capexData]);
  const goldBubbles = useMemo(
    () => (goldData?.countries ?? []).filter(goldCountryHasProduction),
    [goldData],
  );
  const goldPercentiles = useMemo(() => {
    const values = goldBubbles.map(c => (
      typeof c.countrySharePct === "number" && c.countrySharePct > 0 ? c.countrySharePct
      : typeof c.productionOz === "number" && c.productionOz > 0 ? c.productionOz
      : null
    ));
    const pcts = metricPercentiles(values);
    const m = new Map<string, number | null>();
    goldBubbles.forEach((c, i) => m.set(c.iso2, pcts[i] ?? null));
    return m;
  }, [goldBubbles]);
  const sel = capexData?.countries.find(c => c.iso2 === selected) || null;

  const sizePercentile = (c: GeoMapCountry) => (
    layer === "capex" && metric === "yoy" ? yoyPercentiles.get(c.iso2) ?? null : capexPercentiles.get(c.iso2) ?? null
  );
  const radius = (c: GeoMapCountry) => radiusForPercentile(c.status === "ok" ? sizePercentile(c) : null);
  const fill = (c: GeoMapCountry) => {
    if (c.status !== "ok") return GEO_SCALE_COLORS.na;
    if (layer === "sector") return sectorColor(c.dominantSector);
    if (metric === "yoy") return colorForPercentile(yoyPercentiles.get(c.iso2) ?? null, "yoy");
    return colorForPercentile(capexPercentiles.get(c.iso2) ?? null, "capex");
  };
  const bubbleStroke = (c: GeoMapCountry) => {
    if (c.iso2 === selected) return "#fff";
    if (layer === "sector") return BAND_STROKE[c.sectorAmpel?.shareBand ?? "neutral"];
    return "rgba(15,23,42,0.6)";
  };

  return (
    <div className="mb-4 rounded-lg border border-border/30 bg-muted/20 p-3 space-y-3" data-testid="geo-map-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
            <Globe2 className="w-3.5 h-3.5 text-violet-400" /> Capex-Weltkarte
            <span className="font-normal text-[10px] text-foreground/45" data-testid="geo-attribution">
              · {layer === "miner" ? "Miner-Netz, keine Farms" : layer === "gold" ? "AISC je Firma, nicht je Land" : layer === "valuechain" ? "Katalog ohne Länderkette" : "nach Firmensitz"}
            </span>
          </div>
          {capexData && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {capexData.coverage.withData}/{capexData.coverage.total} Länder mit Daten · Stand {new Date(capexData.asOf).toLocaleDateString("de-DE")}
              {capexData.pending ? " · Aufbau" : capexData._stale ? " · Cache veraltet" : capexData._cached ? " · Cache" : ""}
            </div>
          )}
          {goldData && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {goldData.coverage.total > 0
                ? `${goldData.coverage.withData}/${goldData.coverage.total} Länder mit Produktionsanteil · `
                : ""}
              Stand {new Date(goldData.asOf).toLocaleDateString("de-DE")}
            </div>
          )}
          {chainData && (
            <div className="text-[11px] text-foreground/50 mt-0.5">Stand {new Date(chainData.asOf).toLocaleDateString("de-DE")}</div>
          )}
          {minerData && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {minerData.regions.length} Standorte · Stand {new Date(minerData.asOf).toLocaleDateString("de-DE")}
              {minerData.pending ? " · Aufbau" : minerData._stale ? " · Cache veraltet" : minerData._cached ? " · Cache" : ""}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {layer === "capex" && (["capex", "yoy"] as Metric[]).map(m => (
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
        {LAYERS.map(l => l.available ? (
          <button key={l.id} type="button" onClick={() => setLayer(l.id as LayerId)}
            className={`px-2 py-0.5 rounded-full text-[10px] border ${layer === l.id ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-border/30 text-foreground/60 hover:text-foreground"}`}
            data-testid={`chip-geo-layer-${l.id}`}>
            {l.label}{layer === l.id ? " · an" : ""}
          </button>
        ) : (
          <span key={l.id}
            className="px-2 py-0.5 rounded-full text-[10px] border border-border/30 text-foreground/35"
            title={`offen (${l.hint})`} data-testid={`chip-geo-layer-${l.id}`}>
            {l.label} · {l.hint}
          </span>
        ))}
      </div>

      {error && (
        <div className="p-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 flex items-start gap-2" data-testid="geo-na-reason">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {data?.pending && (
        <div className="text-[11px] text-foreground/60" data-testid="geo-pending">n/a — Aufbau läuft, die Karte wird nachgeliefert.</div>
      )}
      {!data && loading && (
        <div className="flex items-center justify-center py-16 text-[11px] text-foreground/50 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" /> Lade Karte…
        </div>
      )}

      {capexData && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
          <div className="rounded-md border border-border/30 bg-background/40 overflow-hidden">
            <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 160 }} width={800} height={400} style={{ width: "100%", height: "auto" }}>
              <Geographies geography={worldUrl}>
                {({ geographies }) => geographies.map(geo => {
                  const c = byNum.get(String(geo.id));
                  const isSel = c && c.iso2 === selected;
                  const sectorFill = layer === "sector" && c?.status === "ok";
                  return (
                    <Geography key={geo.rsmKey} geography={geo}
                      onClick={() => c && setSelected(c.iso2)}
                      fill={isSel ? "rgba(139,92,246,0.45)" : sectorFill ? sectorColor(c?.dominantSector) : c?.status === "ok" ? "rgba(139,92,246,0.18)" : "rgba(148,163,184,0.12)"}
                      fillOpacity={sectorFill && !isSel ? 0.55 : 1}
                      stroke="rgba(148,163,184,0.25)" strokeWidth={0.4}
                      className={c ? "outline-none cursor-pointer hover:opacity-80" : "outline-none"} />
                  );
                })}
              </Geographies>
              {capexData.countries.map(c => (
                <Marker key={c.iso2} coordinates={[c.lon, c.lat]} onClick={() => setSelected(c.iso2)}>
                  <circle r={radius(c)} fill={fill(c)} fillOpacity={c.status === "ok" ? 0.85 : 0.35}
                    stroke={bubbleStroke(c)} strokeWidth={c.iso2 === selected || layer === "sector" ? 1.5 : 0.6}
                    style={{ cursor: "pointer" }} data-testid={`geo-bubble-${c.iso2}`}>
                    <title>{layer === "sector"
                      ? `${c.name}: ${c.dominantSector ?? c.sectorAmpel?.dominantSector ?? "n/a"}${c.sectorAmpel?.dominantSharePct != null ? ` ${c.sectorAmpel.dominantSharePct.toFixed(0)} %` : ""} · ${c.sectorAmpel?.sectorNote ?? BAND_LABEL[c.sectorAmpel?.shareBand ?? "neutral"]}`
                      : `${c.name}: ${fmtBn(c.capexUsd)} · YoY ${fmtPct(c.yoyPct)}${c.dominantSector ? ` · ${c.dominantSector}` : ""}`}</title>
                  </circle>
                </Marker>
              ))}
            </ComposableMap>
            <div className="px-2 pb-1.5 text-[10px] text-foreground/40 flex flex-wrap gap-x-3 gap-y-1">
              {layer === "sector" ? (
                <span>Farbe = dominanter Sektor nach Capex-Anteil. Größe = Perzentil des Capex. Rand = Ampel (Terzil der Dominanz). Grau = n/a.</span>
              ) : metric === "yoy" ? (
                <span>Farbe und Größe = Perzentil des YoY in dieser Auswahl (niedrig → hoch). Grau = n/a.</span>
              ) : (
                <span>Farbe und Größe = Perzentil des Capex in dieser Auswahl (niedrig → hoch). Grau = n/a.</span>
              )}
            </div>
            {layer === "sector" && (
              <div className="px-2 pb-2 flex flex-wrap gap-1" data-testid="geo-sector-legend">
                {sectorLegend.length === 0 && <span className="text-[10px] text-foreground/45">n/a — keine Sektoren in der Auswahl</span>}
                {sectorLegend.map(item => (
                  <span key={item.sector} className="inline-flex items-center gap-1 text-[10px] text-foreground/70" data-testid={`geo-legend-${item.sector}`}>
                    <span className="w-2 h-2 rounded-full" style={{ background: sectorColor(item.sector) }} />
                    {item.sector} {item.pct.toFixed(1)} %
                  </span>
                ))}
              </div>
            )}
            {layer === "sector" && (
              <div className="px-2 pb-2 flex flex-wrap gap-2" data-testid="geo-sector-ampel-legend">
                {BAND_ORDER.map(band => (
                  <span key={band} className="inline-flex items-center gap-1 text-[10px] text-foreground/70">
                    <span className="w-2 h-2 rounded-full border-2" style={{ borderColor: BAND_STROKE[band] }} /> {BAND_LABEL[band]}
                  </span>
                ))}
              </div>
            )}
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
                {layer === "sector" && (
                  <div className="text-foreground/70">
                    Dominanter Sektor: {sel.dominantSector ?? "n/a"}
                    {onOpenSectorOpportunity && (
                      <button type="button" onClick={onOpenSectorOpportunity} className="ml-2 text-violet-300 hover:underline" data-testid="button-geo-open-sectors">Sector Opportunity</button>
                    )}
                  </div>
                )}
                {layer === "sector" && sel.sectorAmpel && (
                  <div className="rounded border border-border/30 p-1.5 space-y-0.5" data-testid={`geo-sector-ampel-${sel.iso2}`} data-sector-band={sel.sectorAmpel.shareBand}>
                    <div className="text-foreground/45 text-[10px]">Ampel der Dominanz</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{sel.sectorAmpel.dominantSector ?? "n/a"}</span>
                      <span className="font-mono">{sel.sectorAmpel.dominantSharePct != null ? `${sel.sectorAmpel.dominantSharePct.toFixed(0)} %` : "n/a"}</span>
                    </div>
                    <div className={`text-[10px] ${BAND_CLASS[sel.sectorAmpel.shareBand]}`}>
                      Ampel {BAND_LABEL[sel.sectorAmpel.shareBand]}
                      {sel.sectorAmpel.sharePercentile != null ? ` · Perzentil ${Math.round(sel.sectorAmpel.sharePercentile * 100)} %` : ""}
                      {sel.sectorAmpel.shareZ != null
                        ? ` · z ${sel.sectorAmpel.shareZ.toFixed(2)}`
                        : sel.sectorAmpel.dominantSharePct != null ? " · z n/a — keine Streuung oder zu wenige Länder" : ""}
                    </div>
                    {sectorOverlay && (
                      <div className="text-[10px] text-foreground/45">
                        Median der Dominanz {sectorOverlay.sectorLayer.peerMedianSharePct != null ? `${sectorOverlay.sectorLayer.peerMedianSharePct.toFixed(1)} %` : "n/a — keine Dominanz"} · n={sectorOverlay.sectorLayer.peerN}
                      </div>
                    )}
                    {sel.sectorAmpel.sectorNote && <div className="text-foreground/55 italic">{sel.sectorAmpel.sectorNote}</div>}
                  </div>
                )}
                {sel.note && <div className="text-foreground/45 italic" data-testid={`geo-note-${sel.iso2}`}>{sel.note}</div>}
                {sel.companies.length > 0 && (
                  <table className="w-full">
                    <thead><tr className="text-foreground/45 text-[10px]"><th className="text-left font-normal">Firma</th><th className="text-right font-normal">Capex</th><th className="text-right font-normal">YoY</th></tr></thead>
                    <tbody>
                      {sel.companies.map(co => (
                        <tr key={co.symbol} className="border-t border-border/20">
                          <td className="py-1"><a href={`#/?ticker=${encodeURIComponent(co.symbol)}`} className="font-mono text-violet-300 hover:underline" data-testid={`geo-link-${co.symbol}`}>{co.symbol}</a><div className="text-[10px] text-foreground/45 truncate max-w-[150px]">{co.name}{co.sector ? ` · ${co.sector}` : ""}</div>
                            {co.geoSegmentsNote && <div className="text-[10px] text-foreground/45 italic">{co.geoSegmentsNote}</div>}
                            {co.geoSegments?.map(g => (
                              <div key={g.name} className="text-[10px] text-foreground/60" data-testid={`geo-segment-${co.symbol}-${g.iso2 || "na"}`}>{g.name}{g.pct != null ? ` ${g.pct.toFixed(0)} %` : " n/a"}{g.iso2 ? ` → ${g.iso2}` : ""}{g.note ? ` · ${g.note}` : ""}</div>
                            ))}
                          </td>
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
                        <div className="flex-1 h-1.5 rounded bg-muted/40"><div className="h-1.5 rounded" style={{ width: `${s.pct}%`, background: sectorColor(s.sector) }} /></div>
                        <span className="w-10 text-right font-mono">{s.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-foreground/50 mb-1">Land anklicken für Top-Firmen. Ranking:</div>
                {ranked.length === 0 && <div className="text-foreground/45" data-testid="geo-rank-empty">n/a — keine Capex-Daten verfügbar</div>}
                {ranked.map((c, i) => (
                  <button key={c.iso2} type="button" onClick={() => setSelected(c.iso2)}
                    className="w-full flex items-center justify-between px-1.5 py-1 rounded hover:bg-muted/40" data-testid={`geo-rank-${c.iso2}`}>
                    <span className="text-foreground/75 text-left">{i + 1}. {c.name}{layer === "sector" && c.dominantSector ? ` · ${c.dominantSector}` : ""}</span>
                    <span className="font-mono shrink-0 ml-2">{fmtBn(c.capexUsd)} <span className="text-foreground/45">{fmtPct(c.yoyPct)}</span>
                      {layer === "sector" && c.sectorAmpel ? <span className={BAND_CLASS[c.sectorAmpel.shareBand]}>{c.sectorAmpel.dominantSharePct != null ? ` ${c.sectorAmpel.dominantSharePct.toFixed(0)}%` : " n/a"}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {goldData && (
        <div className="rounded-md border border-border/30 bg-background/40 p-2.5 text-[11px] space-y-1" data-testid="geo-gold-panel">
          {goldBubbles.length === 0 && (
            <div className="text-foreground/55 italic" data-testid="geo-gold-na">{goldData.note || "n/a — keine Produktions-Unzen und kein Länderanteil"}</div>
          )}
          {goldBubbles.length > 0 && (
            <div className="rounded-md border border-border/30 bg-background/40 overflow-hidden">
              <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 160 }} width={800} height={400} style={{ width: "100%", height: "auto" }}>
                <Geographies geography={worldUrl}>
                  {({ geographies }) => geographies.map(geo => (
                    <Geography key={geo.rsmKey} geography={geo} fill="rgba(148,163,184,0.12)" stroke="rgba(148,163,184,0.25)" strokeWidth={0.4} className="outline-none" />
                  ))}
                </Geographies>
                {goldBubbles.map(c => {
                  const pct = goldPercentiles.get(c.iso2) ?? null;
                  return (
                    <Marker key={c.iso2} coordinates={[c.lon, c.lat]}>
                      <circle r={radiusForPercentile(pct)} fill={colorForPercentile(pct, "capex")} fillOpacity={0.85}
                        data-testid={`geo-gold-bubble-${c.iso2}`}>
                        <title>{goldBubbleTitle(c)}</title>
                      </circle>
                    </Marker>
                  );
                })}
              </ComposableMap>
            </div>
          )}
          {goldData.goldCompanies.map(co => (
            <div key={co.symbol} className="border-t border-border/20 py-1" data-testid={`geo-gold-${co.symbol}`}>
              <div className="flex justify-between gap-2">
                <a href={`#/?ticker=${encodeURIComponent(co.symbol)}`} className="font-mono text-violet-300 hover:underline">{co.symbol}</a>
                <span className="font-mono">{co.aiscUsdPerOz != null ? `${co.aiscUsdPerOz} USD/oz${co.aiscQuarter ? ` · ${co.aiscQuarter}` : ""}` : "AISC n/a"}</span>
              </div>
              <div className="text-[10px] text-foreground/45">{co.name} · Produktion n/a</div>
              {co.note && <div className="text-[10px] text-foreground/55 italic">{co.note}</div>}
            </div>
          ))}
          <a href="#/gold" className="inline-block text-violet-300 underline" data-testid="geo-gold-dashboard">Gold-Dashboard</a>
          <div className="text-[10px] text-foreground/40">{goldData.attribution}</div>
        </div>
      )}

      {chainData && (
        <div className="rounded-md border border-border/30 bg-background/40 p-2.5 text-[11px] space-y-1" data-testid="geo-valuechain-panel">
          <div className="text-foreground/55 italic">{chainData.note}</div>
          {chainData.chains.map(ch => (
            <div key={ch.key}>
              <a href={ch.href} className="text-violet-300 hover:underline" data-testid={`geo-valuechain-${ch.key}`}>{ch.label}</a>
              <div className="text-[10px] text-foreground/45">{ch.placementNote}</div>
            </div>
          ))}
          <div className="text-[10px] text-foreground/40">{chainData.attribution}</div>
        </div>
      )}

      {minerData && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
          <div className="rounded-md border border-border/30 bg-background/40 overflow-hidden">
            <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 160 }} width={800} height={400} style={{ width: "100%", height: "auto" }}>
              <Geographies geography={worldUrl}>
                {({ geographies }) => geographies.map(geo => (
                  <Geography key={geo.rsmKey} geography={geo} fill="rgba(148,163,184,0.12)" stroke="rgba(148,163,184,0.25)" strokeWidth={0.4} className="outline-none" />
                ))}
              </Geographies>
              {minerData.regions.map(r => {
                const pct = minerSharePercentiles.get(r.id) ?? null;
                return (
                  <Marker key={r.id} coordinates={[r.lon, r.lat]} onClick={() => setSelected(r.id)}>
                    <circle r={radiusForPercentile(pct)} fill={colorForPercentile(pct, "capex")} fillOpacity={0.85}
                      data-testid={`geo-miner-${r.id}`}>
                      <title>{`${r.name}: ${r.hashrateSharePct == null ? "n/a" : `${r.hashrateSharePct}%`}`}</title>
                    </circle>
                  </Marker>
                );
              })}
            </ComposableMap>
            <div className="px-2 pb-1.5 text-[10px] text-foreground/40">Keine Farm-Marker, solange die Standortquelle n/a ist.</div>
          </div>
          <div className="rounded-md border border-border/30 bg-background/40 p-2.5 text-[11px] space-y-2" data-testid="geo-side-panel">
            <div className="text-foreground/70 leading-relaxed" data-testid="geo-miner-note">{minerData.locationNote || MINER_LOCATION_NOTE}</div>
            {minerData.regions.find(r => r.id === selected) && (
              <div className="text-foreground/80">
                {minerData.regions.find(r => r.id === selected)?.name}: {fmtPct(minerData.regions.find(r => r.id === selected)?.hashrateSharePct ?? null)}
              </div>
            )}
            <div>
              <div className="text-foreground/45 text-[10px] mb-1">Gesamtnetz (nicht ein Land)</div>
              <div className="font-mono">Hashrate {fmtNum(minerData.network.hashrateEH, 0, "EH/s")}</div>
              <div className="font-mono">Hashprice {fmtNum(minerData.network.hashpriceBtcPerThDay, 8, "BTC/TH/Tag")}</div>
              <div className="font-mono">Breakeven {minerData.network.breakevenUsd == null ? "n/a" : `${Math.round(minerData.network.breakevenUsd).toLocaleString("de-DE")} $`}</div>
              {minerData.network.note && <div className="text-foreground/45 italic mt-1">{minerData.network.note}</div>}
              {minerData.network.source && <div className="text-foreground/40 text-[10px]">Quelle: {minerData.network.source}</div>}
            </div>
            <div>
              <div className="text-foreground/45 text-[10px] mb-1">Namen aus der Spec, ohne IR-Zahlen</div>
              <table className="w-full">
                <tbody>
                  {minerData.namedOperators.map(op => (
                    <tr key={op.symbol} className="border-t border-border/20">
                      <td className="py-0.5 font-mono">{op.symbol}</td>
                      <td className="text-right text-foreground/50">Hashrate n/a</td>
                      <td className="text-right text-foreground/50">MW n/a</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <a href="#/btc" className="inline-block text-violet-300 underline" data-testid="link-btc-dashboard">BTC-Dashboard</a>
          </div>
        </div>
      )}
      {layer === "miner" && <MinerMapPanel />}
      {capexData && <div className="text-[10px] text-foreground/40 leading-relaxed">Quelle: {capexData.source}. {capexData.attribution}</div>}
      {minerData && <div className="text-[10px] text-foreground/40 leading-relaxed">Quelle: {minerData.source}. {minerData.attribution}</div>}
    </div>
  );
}
