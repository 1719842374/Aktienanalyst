/**
 * Additive Route (Offen_WORK_CAPEX_SECTOR_MAP.md + Offen_WORK_RESEARCHER_CAPEX_MAP.md).
 * Mounted from routes-register.ts, researcher.ts bleibt unberührt.
 * GET /api/researcher/geo-map?layer=capex|sector|miner|gold|valuechain
 *
 * Capex und Sektor teilen sich eine Aggregation (FMP Cashflow, Firmensitz).
 * Der Kaltstart ist seriell und dauert auf Prod ~58 s. Damit ein Gateway-Timeout
 * nicht HTML statt JSON an den Client gibt: Cache mit benanntem TTL und
 * Stale-While-Revalidate, Antwortbudget, Aufwärmen nach dem Boot.
 * Nur Anzeige, kein Score.
 */
import type { Express, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { diskResearcherGetWithTtl, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import { buildGeoMapCapex, capexPayloadPrimaryListings, defaultGeoMapDeps, GEO_MAP_CACHE_TAB, type GeoMapDeps } from "./researcher-geo-map";
import { buildMinerMapBody, pipelineFromMiner, type MinerMapResponse } from "@shared/miner-map";
import {
  GEO_MAP_CACHE_TTL_MS,
  GEO_MAP_COUNTRIES,
  GEO_MAP_RESPONSE_BUDGET_MS,
  GEO_MAP_STALE_WHILE_REVALIDATE_MS,
  MINER_LOCATION_NOTE,
  MINER_NAMES_UNSOURCED,
  dominantSectorOf,
  type GeoMapMinerNetwork,
  type GeoMapMinerRegion,
  type GeoMapMinerResponse,
} from "@shared/geo-map";
import { buildGoldMapLayer, buildValueChainMapLayer } from "@shared/geo-map-layers";
import { tickerAliasGroupsFromCompanies } from "@shared/gold-aisc";
import { loadGoldAiscSeries } from "./gold-aisc";
import { ALL_INDUSTRIES } from "./valuechain-catalog";

const cacheDir = () => path.join(process.cwd(), ".cache", "researcher");
const PARAMS = "global";
const fileFor = (tab: string) => path.join(cacheDir(), `${tab}__${PARAMS}.json`);
const CAPEX_FILE = () => fileFor(GEO_MAP_CACHE_TAB);
const CAPEX_DISK = `${GEO_MAP_CACHE_TAB}__${PARAMS}`;
const MINER_TAB = "geo-map-miner";
const MINER_DISK = `${MINER_TAB}__${PARAMS}`;
const MAX_AGE_MS = GEO_MAP_CACHE_TTL_MS + GEO_MAP_STALE_WHILE_REVALIDATE_MS;
export const GEO_MAP_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

type Stored = { payload: any; ageMs: number; fresh: boolean };

export interface GeoMapRouteOpts {
  useCache?: boolean;
  refreshMinIntervalMs?: number;
  now?: () => number;
  responseBudgetMs?: number;
  minerNetwork?: () => Promise<GeoMapMinerNetwork>;
  minerRegions?: () => Promise<GeoMapMinerRegion[]>;
  /** Zusatz aus dem Filing-Katalog. Ersetzt regions, locationNote und namedOperators nicht. */
  buildMinerMap?: () => Promise<MinerMapResponse>;
}

function classify(parsed: any, nowMs: number): Stored | "expired" | null {
  if (!parsed || typeof parsed !== "object") return null;
  const storedAt = parsed._cachedAt ? new Date(parsed._cachedAt).getTime() : NaN;
  if (!Number.isFinite(storedAt)) return null;
  const ageMs = nowMs - storedAt;
  if (ageMs > MAX_AGE_MS) return "expired";
  return {
    payload: { ...parsed, _cached: true, _cacheAge: Math.round(Math.max(0, ageMs) / 60000) },
    ageMs,
    fresh: ageMs >= 0 && ageMs < GEO_MAP_CACHE_TTL_MS,
  };
}

function readNamed(file: string, diskKey: string, nowMs: number): Stored | null {
  let fromFile: Stored | null = null;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      const hit = classify(parsed, nowMs);
      if (hit === "expired") {
        try { fs.unlinkSync(file); } catch { /* n/a */ }
      } else if (hit) fromFile = hit;
    }
  } catch { /* n/a */ }
  let fromDisk: Stored | null = null;
  const row = diskResearcherGetWithTtl(diskKey, MAX_AGE_MS, Date.now());
  if (row?.data) {
    const hit = classify(row.data, nowMs);
    if (hit === "expired") {
      try { diskResearcherDelete(diskKey); } catch { /* n/a */ }
    } else if (hit) fromDisk = hit;
  }
  if (fromFile && fromDisk) return fromFile.ageMs <= fromDisk.ageMs ? fromFile : fromDisk;
  return fromFile || fromDisk;
}

function writeNamed(file: string, diskKey: string, data: any, nowMs: number): void {
  const payload = { ...data, _cachedAt: new Date(nowMs).toISOString() };
  delete payload._stale;
  delete payload.pending;
  try {
    if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  } catch { /* n/a */ }
  try { diskResearcherSet(diskKey, payload); } catch { /* n/a */ }
}

function deleteNamed(file: string, diskKey: string): void {
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* n/a */ }
  try { diskResearcherDelete(diskKey); } catch { /* n/a */ }
}

function withDominant(data: any, layer: "capex" | "sector") {
  const countries = Array.isArray(data?.countries) ? data.countries : [];
  return {
    ...data,
    layer,
    pending: false,
    countries: countries.map((c: any) => ({
      ...c,
      dominantSector: c?.dominantSector ?? dominantSectorOf(Array.isArray(c?.sectorShares) ? c.sectorShares : []),
    })),
  };
}

function present(stored: Stored, layer: "capex" | "sector") {
  const body = withDominant(stored.payload, layer);
  if (!stored.fresh) body._stale = true;
  else delete body._stale;
  return body;
}

function pendingCapex(layer: "capex" | "sector", nowMs: number) {
  return {
    layer,
    asOf: new Date(nowMs).toISOString(),
    source: "FMP company-screener + cash-flow-statement (FY, capitalExpenditure), FX → USD",
    attribution: "Zuordnung nach Firmensitz. Der Kaltstart läuft noch — Werte folgen, nichts wird geschätzt.",
    coverage: { withData: 0, total: GEO_MAP_COUNTRIES.length },
    countries: GEO_MAP_COUNTRIES.map(def => ({
      ...def,
      status: "n/a" as const,
      capexUsd: null,
      yoyPct: null,
      companies: [],
      sectorShares: [],
      dominantSector: null,
      note: "n/a — Karte wird aufgebaut (Kaltstart dauert länger als das Antwortbudget)",
    })),
    pending: true,
  };
}

function withinBudget<T>(p: Promise<T>, budgetMs: number): Promise<T | "budget"> {
  if (!(budgetMs > 0) || !Number.isFinite(budgetMs)) return p;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("budget"), budgetMs);
    p.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

const EMPTY_NETWORK: GeoMapMinerNetwork = {
  hashrateEH: null,
  hashpriceBtcPerThDay: null,
  breakevenUsd: null,
  source: null,
  note: "n/a — Miner-Pipeline ohne Daten",
};

async function defaultMinerNetwork(): Promise<GeoMapMinerNetwork> {
  try {
    const { fetchMinerData } = await import("./btc-miner");
    const data = await fetchMinerData();
    if (!data) return { ...EMPTY_NETWORK, note: "n/a — Miner-Pipeline ohne Daten" };
    return {
      hashrateEH: Number.isFinite(data.currentHashrateEH) ? data.currentHashrateEH : null,
      hashpriceBtcPerThDay: Number.isFinite(data.hashprice) ? data.hashprice : null,
      breakevenUsd: Number.isFinite(data.breakevenPrice) ? data.breakevenPrice : null,
      source: data.hashrateSource ?? "btc-miner",
      note: null,
    };
  } catch (err: any) {
    return { ...EMPTY_NETWORK, note: `n/a — Miner-Pipeline: ${err?.message || "Fehler"}` };
  }
}

function filingForNetwork(network: GeoMapMinerNetwork, asOf: string): MinerMapResponse {
  const missing = network.hashrateEH == null && network.hashpriceBtcPerThDay == null && network.breakevenUsd == null;
  const reason = missing ? (network.note?.replace(/^n\/a — /, "") || "Miner-Pipeline ohne Daten") : null;
  return buildMinerMapBody(pipelineFromMiner({
    currentHashrateEH: network.hashrateEH,
    hashprice: network.hashpriceBtcPerThDay,
    breakevenPrice: network.breakevenUsd,
    hashrateSource: network.source,
    lastUpdated: asOf,
  }, reason), asOf);
}

function withFiling(body: GeoMapMinerResponse, filing: MinerMapResponse) {
  return {
    ...body,
    sites: filing.sites,
    pipeline: filing.pipeline,
    gaps: filing.gaps,
    countryShareNote: filing.countryShareNote,
  };
}

function minerBody(nowMs: number, regions: GeoMapMinerRegion[], network: GeoMapMinerNetwork, extra: Partial<GeoMapMinerResponse> = {}): GeoMapMinerResponse {
  return {
    layer: "miner",
    asOf: new Date(nowMs).toISOString(),
    source: "btc-miner.ts (Netz) + keine Standortquelle",
    attribution: "Hashrate-Anteil und MW je Land sind n/a, solange CBECI ein Captcha verlangt und keine IR-Zahlen angebunden sind. Netzwerte sind das Gesamtnetz, nicht ein Land.",
    regions,
    locationNote: MINER_LOCATION_NOTE,
    namedOperators: MINER_NAMES_UNSOURCED.map(symbol => ({ symbol, hashrateEH: null, powerMw: null })),
    network,
    pending: false,
    ...extra,
  };
}

/** Frischer Bau setzt geoSegments an jeder Firma. Ein älterer Cache ohne das Feld ist kein Treffer. */
export function capexPayloadCarriesGeoSegments(payload: unknown): boolean {
  const countries = (payload as { countries?: unknown } | null)?.countries;
  if (!Array.isArray(countries)) return false;
  for (const country of countries) {
    const companies = (country as { companies?: unknown } | null)?.companies;
    if (!Array.isArray(companies)) return false;
    for (const company of companies) {
      if (!company || typeof company !== "object" || !Object.prototype.hasOwnProperty.call(company, "geoSegments")) return false;
    }
  }
  return true;
}

function goldLayerInput(): { points: { code: string; quarter: string; aisc: number }[] | null; aliases: ReturnType<typeof tickerAliasGroupsFromCompanies> } {
  const series = loadGoldAiscSeries();
  if (!series) return { points: null, aliases: [] };
  const points: { code: string; quarter: string; aisc: number }[] = [];
  for (const quarter of series.quarters) {
    for (const value of quarter.values) {
      if (value && typeof value.aisc === "number" && Number.isFinite(value.aisc)) {
        points.push({ code: String(value.company), quarter: quarter.quarter, aisc: value.aisc });
      }
    }
  }
  return { points, aliases: tickerAliasGroupsFromCompanies(series.companies) };
}

let warmImpl: () => void = () => {};

/** Nach dem Listen aufrufen. Baut die Capex-Karte im Hintergrund, wenn der Cache fehlt oder veraltet ist. */
export function warmGeoMapCache(): void {
  try { warmImpl(); } catch (err: any) {
    console.error("[geo-map] warmup failed:", err?.message);
  }
}

export function registerGeoMapRoute(app: Express, deps: GeoMapDeps = defaultGeoMapDeps, opts: GeoMapRouteOpts = {}): void {
  const useCache = opts.useCache !== false;
  const refreshMinIntervalMs = opts.refreshMinIntervalMs ?? GEO_MAP_REFRESH_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const responseBudgetMs = opts.responseBudgetMs ?? GEO_MAP_RESPONSE_BUDGET_MS;
  const minerNetwork = opts.minerNetwork ?? defaultMinerNetwork;
  const minerRegions = opts.minerRegions ?? (async () => [] as GeoMapMinerRegion[]);
  let inflight: Promise<any> | null = null;
  let minerInflight: Promise<GeoMapMinerNetwork> | null = null;
  let lastRefreshAt: number | null = null;

  function startBuild(): Promise<any> {
    if (!inflight) {
      const job = buildGeoMapCapex(deps, new Date(now())).then(result => {
        if (useCache && result?.coverage?.withData > 0) writeNamed(CAPEX_FILE(), CAPEX_DISK, result, now());
        return result;
      });
      const tracked = job.finally(() => { inflight = null; });
      tracked.catch(() => {});
      inflight = tracked;
    }
    return inflight;
  }

  function startMiner(): Promise<GeoMapMinerNetwork> {
    if (!minerInflight) {
      const job = minerNetwork().then(net => {
        const usable = net && (net.hashrateEH != null || net.hashpriceBtcPerThDay != null || net.breakevenUsd != null);
        if (useCache && usable) writeNamed(fileFor(MINER_TAB), MINER_DISK, { network: net }, now());
        return net;
      });
      const tracked = job.finally(() => { minerInflight = null; });
      tracked.catch(() => {});
      minerInflight = tracked;
    }
    return minerInflight;
  }

  function readCapex(nowMs: number): Stored | null {
    const hit = readNamed(CAPEX_FILE(), CAPEX_DISK, nowMs);
    // Altbestand ohne geoSegments, oder ein Fremdlisting zum Firmensitz (NEO-CDR).
    // Die Prüfung ist rein. Ein Neubau schreibt das Primärlisting, der nächste Read bleibt Treffer.
    if (hit && (!capexPayloadCarriesGeoSegments(hit.payload) || !capexPayloadPrimaryListings(hit.payload))) {
      deleteNamed(CAPEX_FILE(), CAPEX_DISK);
      return null;
    }
    return hit;
  }

  warmImpl = () => {
    if (!deps.hasKey()) {
      console.log("[geo-map] warmup skipped: FMP nicht konfiguriert");
      return;
    }
    const hit = useCache ? readCapex(now()) : null;
    if (hit?.fresh) {
      console.log("[geo-map] warmup skipped: cache fresh");
      return;
    }
    console.log("[geo-map] warmup started");
    startBuild().catch(err => console.error("[geo-map] warmup failed:", err?.message));
  };

  async function sendCapex(res: Response, layer: "capex" | "sector", forceRefresh: boolean) {
    let force = forceRefresh;
    const t = now();
    if (useCache && force) {
      if (lastRefreshAt != null && t - lastRefreshAt < refreshMinIntervalMs) {
        const cached = readCapex(t);
        if (cached) return res.json({ ...present(cached, layer), _refreshThrottled: true });
        force = false;
      } else {
        lastRefreshAt = t;
        deleteNamed(CAPEX_FILE(), CAPEX_DISK);
      }
    }
    if (useCache && !force) {
      const cached = readCapex(t);
      if (cached?.fresh) return res.json(present(cached, layer));
      if (cached && !cached.fresh) {
        startBuild().catch(err => console.error("[geo-map] revalidate failed:", err?.message));
        return res.json(present(cached, layer));
      }
    }
    try {
      const result = await withinBudget(startBuild(), responseBudgetMs);
      if (result === "budget") return res.json(pendingCapex(layer, now()));
      return res.json(withDominant(result, layer));
    } catch (err: any) {
      console.error("[RESEARCHER/geo-map] failed:", err?.message);
      res.status(500).json({ error: err?.message || "geo-map failed" });
    }
  }

  async function sendMiner(res: Response) {
    const t = now();
    let regions: GeoMapMinerRegion[] = [];
    try { regions = await minerRegions(); } catch (err: any) {
      return res.json(minerBody(t, [], { ...EMPTY_NETWORK, note: `n/a — Standorte: ${err?.message || "Fehler"}` }));
    }
    if (!Array.isArray(regions)) regions = [];
    const cached = useCache ? readNamed(fileFor(MINER_TAB), MINER_DISK, t) : null;
    const cachedNet: GeoMapMinerNetwork | null = cached?.payload?.network ?? null;
    if (cached?.fresh && cachedNet) {
      return res.json(withFiling(minerBody(t, regions, cachedNet, { _cached: true }), filingForNetwork(cachedNet, new Date(t).toISOString())));
    }
    try {
      const result = await withinBudget(startMiner(), responseBudgetMs);
      if (result === "budget") {
        if (cachedNet) return res.json(withFiling(minerBody(t, regions, cachedNet, { _stale: true, _cached: true }), filingForNetwork(cachedNet, new Date(t).toISOString())));
        const pendingNet = { ...EMPTY_NETWORK, note: "n/a — Netzwerkzahlen werden noch geladen" };
        return res.json(withFiling(minerBody(t, regions, pendingNet, { pending: true }), filingForNetwork(pendingNet, new Date(t).toISOString())));
      }
      return res.json(withFiling(minerBody(t, regions, result), filingForNetwork(result, new Date(t).toISOString())));
    } catch (err: any) {
      console.error("[RESEARCHER/geo-map] miner failed:", err?.message);
      res.status(500).json({ error: err?.message || "geo-map miner failed" });
    }
  }

  app.get("/api/researcher/geo-map", async (req, res) => {
    const layer = String(req.query?.layer ?? "capex");
    if (layer === "gold") {
      const gold = goldLayerInput();
      return res.json(buildGoldMapLayer(new Date(now()).toISOString(), gold.points, gold.aliases));
    }
    if (layer === "valuechain") return res.json(buildValueChainMapLayer(new Date(now()).toISOString(), ALL_INDUSTRIES));
    if (layer !== "capex" && layer !== "sector" && layer !== "miner") {
      return res.status(400).json({ error: `layer=${layer} nicht verfügbar (capex, sector, miner, gold, valuechain)` });
    }
    if (layer === "miner" && opts.buildMinerMap) {
      try {
        const filing = await opts.buildMinerMap();
        const t = now();
        let regions: GeoMapMinerRegion[] = [];
        try { regions = await minerRegions(); } catch { regions = []; }
        if (!Array.isArray(regions)) regions = [];
        const net = filing.pipeline;
        const network: GeoMapMinerNetwork = {
          hashrateEH: net?.networkHashrateEH ?? null,
          hashpriceBtcPerThDay: net?.hashpriceBtcPerThDay ?? null,
          breakevenUsd: net?.breakevenUsd ?? null,
          source: net?.hashrateSource ?? null,
          note: net?.unavailableNote ?? null,
        };
        return res.json(withFiling(minerBody(t, regions, network), filing));
      } catch (err: any) {
        console.error("[RESEARCHER/geo-map miner] failed:", err?.message);
        return res.status(500).json({ error: err?.message || "miner-map failed" });
      }
    }
    if (layer === "miner") return sendMiner(res);
    const force = req.query?.refresh === "1" || req.query?.refresh === "true";
    return sendCapex(res, layer, force);
  });
}
