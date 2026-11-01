/**
 * Miner-Layer der Weltkarte. Daten: useMinerMap → GET /api/btc/miner-map.
 * Bubble = Perzentil der genannten MW. Fehlende Zahlen bleiben „n/a — Grund“.
 */
import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, useMapContext } from "react-simple-maps";
import worldUrl from "world-atlas/countries-110m.json?url";
import { AlertTriangle, Loader2, Pickaxe } from "lucide-react";
import { useMinerMap } from "@/hooks/useMinerMap";
import { MINER_MAP_RADIUS, formatMinerCoverage, spreadMarkerOffsets, type MarkerPixel, type MinerMapResponse, type MinerMapSite, type MinerMapBubble } from "@shared/miner-map";

type SiteView = MinerMapSite & { bubble: MinerMapBubble };

function fmtMw(site: SiteView): string {
  if (!site.capacityMw) return site.capacityNote ?? "n/a — keine MW";
  return `${site.capacityMw.value.toLocaleString("de-DE")} MW`;
}

function fmtEh(value: number | null, note: string | null): string {
  if (value == null) return note ?? "n/a — keine EH/s";
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 2 })} EH/s`;
}

function fmtCt(value: number | null, note: string | null): string {
  if (value == null) return note ?? "n/a — kein Tarif";
  return `${(value * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} ct/kWh`;
}

function fmtPipeline(value: number | null, note: string | null, digits: number, unit: string): string {
  if (value == null) return note ?? "n/a";
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: digits })} ${unit}`;
}

function drawnRadius(site: SiteView): number {
  return site.bubble.radiusPx ?? MINER_MAP_RADIUS.naPx;
}

/** Versatz in der Pixelebene der gerade gezeichneten Projektion, also relativ zu deren Maßstab. */
function MinerBubbles({ sites, selected, onSelect }: { sites: SiteView[]; selected: string | null; onSelect: (id: string) => void }) {
  const { projection } = useMapContext();
  const placed = useMemo(() => {
    const points: MarkerPixel[] = [];
    for (const site of sites) {
      const xy = projection([site.lon, site.lat]);
      if (!xy) continue;
      points.push({ id: site.id, x: xy[0], y: xy[1], radiusPx: drawnRadius(site) });
    }
    const offset = new Map(spreadMarkerOffsets(points).map(item => [item.id, item]));
    return sites.map(site => ({ site, dx: offset.get(site.id)?.dx ?? 0, dy: offset.get(site.id)?.dy ?? 0 }));
  }, [projection, sites]);

  return (
    <>
      {placed.map(({ site, dx, dy }) => (
        <Marker key={site.id} coordinates={[site.lon, site.lat]} onClick={() => onSelect(site.id)}>
          <g transform={`translate(${dx}, ${dy})`}>
            <circle
              r={drawnRadius(site)}
              fill={site.bubble.color}
              fillOpacity={site.bubble.radiusPx == null ? 0.45 : 0.8}
              stroke={site.id === selected ? "#fff" : "rgba(15,23,42,0.65)"}
              strokeWidth={site.id === selected ? 1.5 : 0.6}
              style={{ cursor: "pointer" }}
              data-testid={`miner-bubble-${site.id}`}
            >
              <title>{`${site.name}: ${fmtMw(site)}`}</title>
            </circle>
          </g>
        </Marker>
      ))}
    </>
  );
}

export function MinerMapPanel({ showBtcLink = true }: { showBtcLink?: boolean }) {
  const query = useMinerMap(true);
  const data = query.data ?? null;
  const [selected, setSelected] = useState<string | null>(null);

  const sites = data?.sites ?? [];
  const sel = sites.find(s => s.id === selected) ?? null;
  const byNum = useMemo(() => {
    const m = new Map<string, SiteView>();
    for (const s of sites) m.set(s.isoNum, s);
    return m;
  }, [sites]);
  const ranked = useMemo(
    () => sites.filter(s => s.bubble.radiusPx != null).sort((a, b) => (b.capacityMw?.value ?? 0) - (a.capacityMw?.value ?? 0)),
    [sites],
  );

  return (
    <div className="space-y-2" data-testid="miner-map-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
            <Pickaxe className="w-3.5 h-3.5 text-amber-400" /> BTC-Miner-Karte
          </div>
          {data && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {formatMinerCoverage(data.coverage)} · Stand {new Date(data.asOf).toLocaleDateString("de-DE")}
              {data.pipeline.stale ? " · Pipeline veraltet" : ""}
            </div>
          )}
        </div>
        {showBtcLink && (
          <a href="#/btc?section=13" className="text-[11px] text-amber-300 underline underline-offset-2" data-testid="link-miner-map-btc">
            Miner-Zone im BTC-Dashboard
          </a>
        )}
      </div>

      {query.isError && (
        <div className="p-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{query.error instanceof Error ? query.error.message : "Miner-Karte fehlgeschlagen"}</span>
        </div>
      )}
      {query.isLoading && (
        <div className="flex items-center justify-center py-10 text-[11px] text-foreground/50 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> Lade Miner-Standorte…
        </div>
      )}
      {!query.isLoading && !data && !query.isError && (
        <div className="text-[11px] text-foreground/50" data-testid="miner-map-empty">n/a — keine JSON-Antwort vom Endpunkt</div>
      )}

      {data && <PipelineStrip data={data} />}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
          <div className="rounded-md border border-border/30 bg-background/40 overflow-hidden min-w-0">
            <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 155 }} width={800} height={400} style={{ width: "100%", height: "auto" }}>
              <Geographies geography={worldUrl}>
                {({ geographies }) => geographies.map(geo => {
                  const hit = byNum.get(String(geo.id));
                  const isSel = sel && hit && hit.isoNum === sel.isoNum;
                  return (
                    <Geography key={geo.rsmKey} geography={geo}
                      fill={isSel ? "rgba(245,158,11,0.35)" : hit ? "rgba(245,158,11,0.12)" : "rgba(148,163,184,0.12)"}
                      stroke="rgba(148,163,184,0.25)" strokeWidth={0.4}
                      className="outline-none" />
                  );
                })}
              </Geographies>
              <MinerBubbles sites={sites} selected={selected} onSelect={setSelected} />
            </ComposableMap>
            <div className="px-2 pb-1.5 text-[10px] text-foreground/40 leading-relaxed">
              Größe und Farbe = Perzentil der genannten MW (developed, nameplate, available). Grau = keine MW in der Stichprobe, kein Wert 0.
            </div>
          </div>

          <div className="rounded-md border border-border/30 bg-background/40 p-2.5 text-[11px] min-w-0" data-testid="miner-side-panel">
            {sel ? <SiteCard site={sel} onClose={() => setSelected(null)} /> : (
              <div className="space-y-1">
                <div className="text-foreground/50 mb-1">Standort anklicken. Mit MW, nach Perzentil-Stichprobe:</div>
                {ranked.length === 0 && <div className="text-foreground/45">n/a — keine MW in der Stichprobe</div>}
                {ranked.map((s, i) => (
                  <button key={s.id} type="button" onClick={() => setSelected(s.id)}
                    className="w-full flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-muted/40 text-left"
                    data-testid={`miner-rank-${s.id}`}>
                    <span className="text-foreground/75 truncate">{i + 1}. {s.name}</span>
                    <span className="font-mono shrink-0">{fmtMw(s)}</span>
                  </button>
                ))}
                <div className="text-foreground/40 pt-1">Ohne MW in der Stichprobe: {sites.filter(s => s.bubble.radiusPx == null).map(s => s.name).join(", ") || "keine"}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {data && data.gaps.length > 0 && (
        <div className="text-[10px] text-foreground/45 space-y-0.5" data-testid="miner-map-gaps">
          {data.gaps.map(g => <div key={g.id}>{g.label}: {g.note}</div>)}
        </div>
      )}
      {data && (
        <div className="text-[10px] text-foreground/40 leading-relaxed">
          {data.countryShareNote} Quelle: {data.source}. {data.attribution}
        </div>
      )}
    </div>
  );
}

function PipelineStrip({ data }: { data: MinerMapResponse }) {
  const p = data.pipeline;
  const cells = [
    ["Netz-Hashrate", fmtPipeline(p.networkHashrateEH, p.networkHashrateNote, 0, "EH/s")],
    ["Hashprice", p.hashpriceBtcPerThDay == null ? (p.hashpriceNote ?? "n/a") : `${p.hashpriceBtcPerThDay.toExponential(2)} BTC/TH/Tag`],
    ["Hashprice USD", p.hashpriceUsdNote ?? "n/a"],
    ["Breakeven", fmtPipeline(p.breakevenUsd, p.breakevenNote, 0, "USD")],
    ["Puell", p.puellMultiple == null ? (p.puellNote ?? "n/a") : p.puellMultiple.toLocaleString("de-DE", { maximumFractionDigits: 2 })],
  ] as const;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-1.5" data-testid="miner-pipeline">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded border border-border/30 px-2 py-1 min-w-0">
          <div className="text-[10px] text-foreground/45">{label}</div>
          <div className="font-mono text-[10px] break-words">{value}</div>
        </div>
      ))}
    </div>
  );
}

function SiteCard({ site, onClose }: { site: SiteView; onClose: () => void }) {
  return (
    <div className="space-y-2" data-testid={`miner-site-${site.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-foreground/85">{site.name}</div>
          <div className="text-[10px] text-foreground/45">{site.region}</div>
        </div>
        <button type="button" onClick={onClose} className="text-foreground/40 hover:text-foreground text-[10px]">Schließen</button>
      </div>
      <div>
        <div className="text-foreground/45 text-[10px]">Leistung</div>
        <div className="font-mono">{fmtMw(site)}</div>
        {site.capacityMw && <div className="text-[10px] text-foreground/45">{site.capacityMw.scope} · {site.capacityMw.asOf}</div>}
      </div>
      {site.operatorNote && <div className="text-foreground/60">{site.operatorNote}</div>}
      {site.operators.map(op => (
        <div key={op.ticker} className="border-t border-border/20 pt-1.5 space-y-0.5">
          <div className="font-mono text-foreground/80">{op.ticker} <span className="font-sans text-foreground/50">{op.name}</span></div>
          <div>Standort-Hashrate: {fmtEh(op.siteHashrateEHs?.value ?? null, op.siteHashrateNote)}</div>
          <div>Konzern-Hashrate: {fmtEh(op.companyHashrateEHs?.value ?? null, op.companyHashrateNote)}</div>
          {op.companyHashrateEHs && <div className="text-[10px] text-foreground/45">{op.companyHashrateEHs.scope}</div>}
          <div>Strom: {fmtCt(op.companyPowerUsdPerKwh?.value ?? null, op.companyPowerNote)}</div>
          {op.companyPowerUsdPerKwh && <div className="text-[10px] text-foreground/45">{op.companyPowerUsdPerKwh.scope}</div>}
        </div>
      ))}
      <div><span className="text-foreground/45">Energie. </span>{site.energyNote}</div>
      <div><span className="text-foreground/45">Regulierung. </span>{site.regulatoryNote}</div>
      <div className="text-[10px] text-foreground/40">{site.coordNote}</div>
    </div>
  );
}
