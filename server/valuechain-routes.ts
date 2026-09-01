/**
 * valuechain-routes.ts
 * --------------------
 * Sprint D6a (Rang 4-6): Branchen-Selector + API-Contract + FMP-Enrichment +
 * CAPEX live berechnet, für die Industrie-Value-Chain-Explorer-Ansicht
 * (statische Karten/Tabelle, KEIN React-Flow-Graph — siehe Ticket
 * tickets/SPRINT_D6A_VALUECHAIN_DATEN.md, "Explizit NICHT in diesem Ticket").
 *
 * Additive neue Datei, registriert additiv über routes-register.ts
 * (gleiches Muster wie researcher-sector-rotation-route.ts /
 * researcher-liquidity-route.ts).
 *
 * Route: GET /api/valuechain?industry=&region=&minMarketCap=&force=
 * Response-Typ: ValueChainResponse (client/src/lib/valueChainTypes.ts,
 * UNVERÄNDERT — nur befüllt).
 *
 * Branchen-Zuordnung ist datengetrieben über FMP /stable/company-screener
 * (echter Live-Datensatz, KEINE feste Ticker-Liste im Code). Die
 * Stage-Klassifikation (upstream/midstream/downstream) verwendet einen
 * generischen Keyword-Alias-Katalog auf companyName/description — analog
 * zum bestehenden TAM_ALIASES-Muster in server/sector-data.ts (nur gelesen,
 * nicht verändert) — statt Ticker-Bedingungen.
 */

import type { Express } from "express";
import {
  computeCapexIntensity,
  aggregateStageCapexIntensity,
  type ValueChainResponse,
  type ValueChainStage,
  type ValueChainCompany,
  type StageType,
  type Region,
} from "../client/src/lib/valueChainTypes";
import { enrichTickersWithFmp } from "./valuechain-fmp-enrichment";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { enrichValueChainStages, type ValueChainEnrichCompanyInput } from "./llm-openrouter";
import {
  ALL_INDUSTRIES,
  classifyStageForChain,
  type IndustryDef as CatalogIndustryDef,
} from "./valuechain-catalog";

const FMP_BASE = "https://financialmodelingprep.com/stable";

// Kanonische Reihenfolge der 11 GICS-Sektoren (MSCI/S&P 2026-Taxonomie,
// Ticket-Vorgabe) fuer die Dropdown-Gruppierung -- immer alle 11 Header
// anzeigen, auch ohne Kette unter Gate (Ticket UI-Abschnitt).
const GICS_SECTOR_ORDER = [
  "Information Technology",
  "Health Care",
  "Financials",
  "Consumer Discretionary",
  "Communication Services",
  "Industrials",
  "Consumer Staples",
  "Energy",
  "Utilities",
  "Real Estate",
  "Materials",
];

function getApiKey(): string {
  return process.env.FMP_API_KEY || "";
}

// ---------------------------------------------------------------------------
// Branchen-Registry: Branchen-Key → FMP-Sektor/Industrie-Taxonomie.
// FMP-Werte kommen 1:1 aus /stable/available-industries (verifiziert live,
// 31.08.2026) — kein eigenes, erfundenes Vokabular.
//
// Ticket VALUECHAIN_GICS_COVERAGE.md: die vollstaendige Kette-Definition
// (11 GICS-Sektoren, stageAliases pro Kette, excludeKeywords, Gate-Regeln)
// lebt additiv in server/valuechain-catalog.ts. Diese Datei re-exportiert
// den kompatiblen Namen VALUECHAIN_INDUSTRIES (bestehende Importe in
// ValueChainDashboard.tsx/route-register bleiben unveraendert funktionsfaehig)
// als flache { key, label, fmpSector, fmpIndustry }-Liste NUR fuer die
// bestehenden 6 Legacy-Ketten (Downstream-zuerst-Klassifikation bleibt exakt
// wie vorher, siehe classifyStage() unten). Neue Ketten werden separat
// ueber /api/valuechain/industries (gruppiert nach GICS) ausgeliefert.
// ---------------------------------------------------------------------------
interface IndustryDef {
  key: string;
  label: string;
  fmpSector: string;
  fmpIndustry: string;
}

export const VALUECHAIN_INDUSTRIES: IndustryDef[] = ALL_INDUSTRIES.map((i) => ({
  key: i.key,
  label: i.label,
  fmpSector: i.fmpSector,
  fmpIndustry: i.fmpIndustries[0],
}));

function findIndustry(key: string): IndustryDef | undefined {
  return VALUECHAIN_INDUSTRIES.find((i) => i.key === key.toLowerCase().trim());
}

function findCatalogIndustry(key: string): CatalogIndustryDef | undefined {
  return ALL_INDUSTRIES.find((i) => i.key === key.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Stage-Klassifikation: generischer Keyword-Alias-Katalog (kein Ticker-Match).
// Reihenfolge = Prioritaet, erstes Match gewinnt. Analog TAM_ALIASES-Muster
// aus server/sector-data.ts (nur als Stilvorbild gelesen, keine Aenderung
// an dieser Datei).
// ---------------------------------------------------------------------------
const STAGE_ALIASES: Array<{ test: RegExp; stage: StageType }> = [
  // Downstream: Design / Vertrieb / Endprodukte / Marken / Retail / Marketing.
  // MUSS vor Upstream/Midstream geprueft werden: fabless Chip-Designer
  // ("designs, develops and markets") enthalten sonst haeufig generische
  // Business-Woerter wie "equipment" (z.B. "original equipment manufacturers"
  // als Vertriebskanal) oder "manufactures" (laesst extern fertigen), die
  // faelschlich Upstream/Midstream triggern wuerden (live beobachtet: NVDA).
  {
    // Bugfix (Nutzer-Feedback 01.09.2026): das blosse Wort "computational"
    // matchte auch "computational lithography solutions" in ASML's FMP-
    // Beschreibung -- ein Fertigungsverfahren, kein fabless-Vertriebssignal.
    // ASML (Lithografie-Equipment-Hersteller) wurde dadurch faelschlich als
    // Downstream statt Upstream klassifiziert, noch bevor der eigentlich
    // zutreffende Upstream-Alias ("lithograph", siehe unten) ueberhaupt
    // geprueft wurde -- dieser Downstream-Block laeuft laut Kommentar oben
    // bewusst ZUERST. Fix: "computational" komplett entfernt (zu
    // unspezifisch, kommt in Fertigungs- wie in Konsumenten-Kontexten vor).
    // "graphics" bleibt als eigenstaendiges Signal erhalten -- das war der
    // urspruenglich tragende Begriff fuer den NVIDIA-Fall ("advanced
    // graphics, computational, and networking solutions") und matcht dort
    // weiterhin unabhaengig von "computational". Verifiziert: NVDA-Text
    // matcht weiter ueber "graphics", ASML-Text matcht nicht mehr und faellt
    // korrekt durch zum Upstream-Alias "lithograph".
    test: /\b(fabless|designs?,?( and)? (develops|markets)|graphics|end[- ]user|branded|consumer products|distribution to|dealership)\b/i,
    stage: "downstream",
  },
  // Upstream: Ausrüster / Materialien / Test-Equipment / Rohstoffe — bewusst
  // spezifische Mehrwort-Phrasen statt des blossen Worts "equipment" (das
  // auch in generischen OEM-Vertriebssaetzen vorkommt, siehe oben).
  // Bugfix (Nutzer-Feedback 01.09.2026): KLAC (Metrology/Inspection-
  // Equipment-Hersteller, wie ASML/AMAT/LRCX ein reiner Upstream-Ausruester)
  // landete faelschlich Midstream, weil sein FMP-Text "IC fabrication"
  // erwaehnt (beschreibt den Fertigungsprozess des KUNDEN, nicht KLACs
  // eigene Taetigkeit) und keiner der bisherigen Upstream-Aliase traf.
  // Ergaenzt: process-control/wafer-inspection/metrology/yield-enhancement
  // -- die Kernbegriffe von Semiconductor-Equipment-Herstellern.
  {
    test: /\b(supplier of equipment|semiconductor (processing )?equipment|equipment (vital|used) for semiconductor|process equipment|lithograph|deposition system|etch(ing)? system|wafer fabrication (tools|equipment)|materials (supplier|engineering)|specialty materials|automated test equipment|testing equipment|exploration|drilling|upstream supplier|raw material|process control|wafer inspection|yield enhancement|metrology)\b/i,
    stage: "upstream",
  },
  // Midstream: Fertigung / Foundry / Verarbeitung / Assembly / Refining / Midstream-Logistik
  {
    test: /\b(foundry|manufactures, packages|packaging|assembly|fabrication|refin(e|ing|ery)|midstream|pipeline|processing plant)\b/i,
    stage: "midstream",
  },
];

function classifyStage(text: string): StageType {
  const lower = text.toLowerCase();
  for (const alias of STAGE_ALIASES) {
    if (alias.test.test(lower)) return alias.stage;
  }
  // Default: midstream (neutrale Kernfertigung/Kern-Geschäft), wenn keine
  // klaren Signalwoerter gefunden wurden — NICHT geschaetzt/erfunden, nur
  // eine neutrale Einordnung ohne Ticker-Bezug.
  return "midstream";
}

const STAGE_META: Record<StageType, { stageName: string; description: string }> = {
  upstream: { stageName: "Upstream", description: "Ausrüstung, Materialien & vorgelagerte Zulieferer" },
  midstream: { stageName: "Midstream", description: "Fertigung, Verarbeitung & Kern-Wertschöpfung" },
  downstream: { stageName: "Downstream", description: "Design, Vertrieb & Endkunden-nahe Wertschöpfung" },
};

// ---------------------------------------------------------------------------
// Region-Country-Sets (Ticket-Vorgabe: "nie US-Firmen in EU/ASIA-Filter
// zeigen"). US wird bereits serverseitig per FMP `country=US` gefiltert
// (siehe fetchScreenerForFmpIndustry). EU/ASIA werden hier nachgefiltert,
// weil FMP company-screener nur EIN Land pro Call akzeptiert.
// ---------------------------------------------------------------------------
const EU_COUNTRY_CODES = new Set([
  "DE", "FR", "NL", "CH", "GB", "IT", "ES", "SE", "DK", "FI", "NO", "BE", "AT", "IE", "PT", "PL", "LU",
]);
const ASIA_COUNTRY_CODES = new Set([
  "JP", "TW", "KR", "CN", "HK", "SG", "IN", "ID", "TH", "MY", "PH", "VN",
]);

function filterRowsByRegion<T extends { symbol: string }>(rows: Array<T & { country?: string }>, region: Region): Array<T & { country?: string }> {
  if (region === "GLOBAL" || region === "US") return rows; // US bereits per FMP-Query gefiltert
  const set = region === "EU" ? EU_COUNTRY_CODES : region === "ASIA" ? ASIA_COUNTRY_CODES : null;
  if (!set) return rows;
  return rows.filter((r) => r.country && set.has(r.country));
}

// ---------------------------------------------------------------------------
// FMP company-screener (live, datengetrieben — KEINE Ticker-Hardcodes)
// ---------------------------------------------------------------------------
type ScreenerRow = { symbol: string; companyName: string; marketCap: number; sector: string; industry: string; country?: string };

async function fetchScreenerForFmpIndustry(
  fmpSector: string,
  fmpIndustry: string,
  minMarketCap: number,
  region: Region
): Promise<ScreenerRow[]> {
  const key = getApiKey();
  if (!key) return [];
  const url = new URL(`${FMP_BASE}/company-screener`);
  url.searchParams.set("sector", fmpSector);
  url.searchParams.set("industry", fmpIndustry);
  url.searchParams.set("marketCapMoreThan", String(minMarketCap));
  url.searchParams.set("limit", "60");
  url.searchParams.set("isActivelyTrading", "true");
  // Region-Filter (Ticket-Vorgabe: "nie US-Firmen in EU/ASIA-Filter zeigen").
  // FMP company-screener nutzt ISO-Country-Codes, keine Regionen — daher
  // wird bei US ein Land gesetzt, bei EU/ASIA client-seitig via Land-Set
  // nachgefiltert (siehe REGION_COUNTRY_SETS unten), GLOBAL setzt keinen Filter.
  if (region === "US") url.searchParams.set("country", "US");
  url.searchParams.set("apikey", key);

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`FMP company-screener ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((row: any) => row?.symbol && !String(row.symbol).includes("."))
    .map((row: any) => ({
      symbol: String(row.symbol),
      companyName: String(row.companyName || row.symbol),
      marketCap: Number(row.marketCap) || 0,
      sector: String(row.sector || ""),
      industry: String(row.industry || ""),
      country: typeof row.country === "string" ? row.country : undefined,
    }));
}

async function fetchScreenerCompanies(
  def: IndustryDef,
  minMarketCap: number
): Promise<ScreenerRow[]> {
  return fetchScreenerForFmpIndustry(def.fmpSector, def.fmpIndustry, minMarketCap, "GLOBAL");
}

/** Fuer neue (Katalog-)Ketten: laeuft ueber ALLE fmpIndustries der Kette,
 *  dedupliziert per Symbol (eine Firma kann in mehreren FMP-Industries
 *  auftauchen, z.B. Battery-EV nutzt Auto-Manufacturers + Specialty
 *  Chemicals). */
async function fetchScreenerForCatalogChain(
  def: CatalogIndustryDef,
  minMarketCap: number,
  region: Region
): Promise<ScreenerRow[]> {
  // fmpPairs (mehrere Sektor/Industry-Kombinationen) hat Vorrang, falls
  // gesetzt -- z.B. Renewables/Data-Center-Cloud brauchen FMP-Industries
  // aus verschiedenen FMP-Sektoren.
  const pairs = def.fmpPairs && def.fmpPairs.length > 0
    ? def.fmpPairs
    : def.fmpIndustries.map((ind) => ({ sector: def.fmpSector, industry: ind }));
  const results = await Promise.all(
    pairs.map((p) => fetchScreenerForFmpIndustry(p.sector, p.industry, minMarketCap, region))
  );
  const bySymbol = new Map<string, ScreenerRow>();
  for (const rows of results) {
    for (const row of rows) {
      if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
    }
  }
  return filterRowsByRegion(Array.from(bySymbol.values()), region);
}

// ---------------------------------------------------------------------------
// GATE je Kette (Ticket-Vorgabe, nur fuer neue Katalog-Ketten -- die 6
// Legacy-Ketten sind vom Gate ausgenommen):
//  - >= 12 Kandidaten mit mcap >= 1 Mrd USD (Global) ODER >= 8 wenn der
//    Sektor strukturell klein ist (smallStructural, z.B. REITs)
//  - Capex-Feld bei >= 70% der gemappten Firmen
//  - Jede Stufe >= 3 Firmen nach Mapping
//  - Fail => Kette skippen (Report-Zeile, nicht ins Dropdown)
// ---------------------------------------------------------------------------
export interface GateResult {
  pass: boolean;
  candidateCount: number;
  candidateThreshold: number;
  capexCoveragePct: number;
  stageCounts: Record<StageType, number>;
  reasons: string[];
}

function evaluateGate(
  def: CatalogIndustryDef,
  rawCount: number,
  stageCounts: Record<StageType, number>,
  capexCoveredCount: number,
  mappedCount: number
): GateResult {
  const threshold = def.smallStructural ? 8 : 12;
  const capexCoveragePct = mappedCount > 0 ? (capexCoveredCount / mappedCount) * 100 : 0;
  const reasons: string[] = [];

  if (rawCount < threshold) {
    reasons.push(`Nur ${rawCount} Kandidaten mit mcap-Filter (Schwelle: ${threshold}).`);
  }
  if (capexCoveragePct < 70) {
    reasons.push(`Capex-Coverage ${capexCoveragePct.toFixed(1)}% < 70%.`);
  }
  (Object.keys(stageCounts) as StageType[]).forEach((s) => {
    if (stageCounts[s] < 3) {
      reasons.push(`Stufe ${s} hat nur ${stageCounts[s]} Firmen (< 3).`);
    }
  });

  return {
    pass: reasons.length === 0,
    candidateCount: rawCount,
    candidateThreshold: threshold,
    capexCoveragePct,
    stageCounts,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Cache (12-24h TTL, disk-cache.ts Muster — gleiche Schicht wie das
// FMP-Enrichment selbst, aber auf Ebene der ganzen Branchen-Antwort)
// ---------------------------------------------------------------------------
const RESPONSE_CACHE_TTL_MS = Number(process.env.VALUECHAIN_RESPONSE_CACHE_TTL_MS ?? 12 * 60 * 60 * 1000);

function responseCacheKey(industry: string, region: string, minMarketCap: number): string {
  return `valuechain_response__${industry}__${region}__${minMarketCap}`;
}

// ---------------------------------------------------------------------------
// Sprint D6c: KI-Anreicherungs-Cache (7 Tage TTL, analog zum bestehenden
// KI-Katalysator-Feature/catalyst-enrich). Getrennter Cache-Namespace von
// der Basis-Response, damit ein Force-Refresh der Basisdaten den teuren
// LLM-Call nicht unnötig invalidiert.
// ---------------------------------------------------------------------------
const ENRICH_CACHE_TTL_MS = Number(process.env.VALUECHAIN_ENRICH_CACHE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);

function enrichCacheKey(industry: string, region: string, minMarketCap: number): string {
  return `valuechain_enrich__${industry}__${region}__${minMarketCap}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerValueChainRoutes(app: Express): void {
  app.get("/api/valuechain", async (req, res) => {
    try {
      const industryKey = String(req.query.industry || "").toLowerCase().trim();
      const region = (String(req.query.region || "GLOBAL").toUpperCase() as Region) || "GLOBAL";
      const minMarketCap = Number(req.query.minMarketCap) > 0 ? Number(req.query.minMarketCap) : 1_000_000_000;
      const force = req.query.force === "1" || req.query.force === "true";

      if (!industryKey) {
        return res.status(400).json({
          error: "industry query param required",
          availableIndustries: VALUECHAIN_INDUSTRIES.map((i) => ({ key: i.key, label: i.label })),
        });
      }

      const def = findIndustry(industryKey);
      const catalogDef = findCatalogIndustry(industryKey);
      if (!def || !catalogDef) {
        return res.status(404).json({
          error: `Unbekannte Branche: ${industryKey}`,
          availableIndustries: VALUECHAIN_INDUSTRIES.map((i) => ({ key: i.key, label: i.label })),
        });
      }

      const cacheKey = responseCacheKey(def.key, region, minMarketCap);
      if (!force) {
        const cached = diskResearcherGet(cacheKey);
        if (cached) {
          const age = Date.now() - new Date(cached.generatedAt || 0).getTime();
          if (Number.isFinite(age) && age < RESPONSE_CACHE_TTL_MS) {
            return res.json({ ...cached, cacheHit: true } as ValueChainResponse);
          }
        }
      }

      // Rang 4: Branchen-Roster live von FMP (datengetrieben, kein Hardcode).
      // Legacy-Ketten (6 bestehende): einzelner fmpIndustry-Call, GLOBAL-Filter
      // (unveraendertes Verhalten). Neue Katalog-Ketten: Multi-Industry-Call +
      // Region-Filter (siehe fetchScreenerForCatalogChain).
      const rawCompanies = catalogDef.legacy
        ? await fetchScreenerCompanies(def, minMarketCap)
        : await fetchScreenerForCatalogChain(catalogDef, minMarketCap, region);

      if (rawCompanies.length === 0) {
        const empty: ValueChainResponse = {
          industry: def.key,
          region,
          stages: [],
          generatedAt: new Date().toISOString(),
          cacheHit: false,
          llmValidated: false,
          notes: ["Keine Firmen von FMP company-screener zurückgegeben (API-Key fehlt, Branche zu eng gefiltert, oder minMarketCap zu hoch)."],
        };
        return res.json(empty);
      }

      // Rang 5: FMP-Enrichment (CAPEX/Revenue TTM/marketCap) durch die
      // vollständige Rate-Limit-Schichten-Kette (Cache → Gate → Budget →
      // Backoff → FMP-Call → Cache-Write).
      const enrichment = await enrichTickersWithFmp(rawCompanies.map((c) => c.symbol));

      // Stage-Zuordnung: description (aus Enrichment) bevorzugt, sonst
      // companyName als Fallback-Signal — beides generisch, kein Ticker-Bezug.
      // Legacy-Ketten: classifyStage() (Downstream-zuerst, globale
      // STAGE_ALIASES) -- EXAKT unveraendert, keine Regression.
      // Neue Katalog-Ketten: classifyStageForChain() (Upstream-zuerst,
      // chain-eigene stageAliases/excludeKeywords aus valuechain-catalog.ts).
      const byStage: Record<StageType, ValueChainCompany[]> = {
        upstream: [],
        midstream: [],
        downstream: [],
      };

      let missingCount = 0;
      let capexCoveredCount = 0;
      for (const raw of rawCompanies) {
        const enr = enrichment.get(raw.symbol.toUpperCase());
        const classifyText = `${enr?.description || ""} ${raw.companyName}`;
        const stage = catalogDef.legacy ? classifyStage(classifyText) : classifyStageForChain(catalogDef, classifyText);

        // Rang 6: CAPEX-Intensity live berechnen (computeCapexIntensity aus
        // valueChainTypes.ts, UNVERÄNDERT importiert) — fehlende FMP-Daten
        // führen zu null, NIEMALS zu einer Schätzung.
        const capexIntensity = enr
          ? computeCapexIntensity(enr.capex, enr.revenueTTM)
          : null;
        if (!enr || enr.dataMissing) missingCount++;
        if (capexIntensity != null) capexCoveredCount++;

        const company: ValueChainCompany = {
          ticker: raw.symbol,
          name: raw.companyName,
          marketCap: enr?.marketCap ?? (raw.marketCap || null),
          sector: enr?.sector || raw.sector,
          industry: enr?.industry || raw.industry,
          capexIntensity,
          validated: false, // llmValidated bewusst false — kein LLM-Call in diesem Ticket
        };
        byStage[stage].push(company);
      }

      // GATE (nur neue Katalog-Ketten, Legacy-Ketten ausgenommen -- Ticket-
      // Vorgabe "Die bestehenden 6 Ketten sind vom Gate ausgenommen").
      let gate: GateResult | null = null;
      if (!catalogDef.legacy) {
        const stageCounts: Record<StageType, number> = {
          upstream: byStage.upstream.length,
          midstream: byStage.midstream.length,
          downstream: byStage.downstream.length,
        };
        gate = evaluateGate(catalogDef, rawCompanies.length, stageCounts, capexCoveredCount, rawCompanies.length);
        if (!gate.pass) {
          const gateFailResponse: ValueChainResponse = {
            industry: def.key,
            region,
            stages: [],
            generatedAt: new Date().toISOString(),
            cacheHit: false,
            llmValidated: false,
            notes: [
              `GATE FAIL: ${gate.reasons.join(" ")}`,
              "Kette angelegt, Coverage unter Gate -- nicht gelistet.",
            ],
          };
          return res.json({ ...gateFailResponse, gate });
        }
      }

      const stages: ValueChainStage[] = (["upstream", "midstream", "downstream"] as StageType[])
        .map((stageType) => {
          const companies = byStage[stageType].sort(
            (a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)
          );
          const aggregatedMarketCap = companies.reduce(
            (sum, c) => sum + (c.marketCap ?? 0),
            0
          );
          return {
            stageId: `${def.key}-${stageType}`,
            stageName: STAGE_META[stageType].stageName,
            stageType,
            description: STAGE_META[stageType].description,
            companies,
            aggregatedMarketCap: aggregatedMarketCap > 0 ? aggregatedMarketCap : null,
            avgCapexIntensity: aggregateStageCapexIntensity(companies),
            companyCount: companies.length,
          };
        })
        .filter((s) => s.companyCount > 0);

      const notes: string[] = [];
      if (missingCount > 0) {
        notes.push(`${missingCount} von ${rawCompanies.length} Firmen ohne vollständige FMP-CAPEX/Revenue-Daten (capexIntensity: null).`);
      }

      const response: ValueChainResponse = {
        industry: def.key,
        region,
        stages,
        generatedAt: new Date().toISOString(),
        cacheHit: false,
        llmValidated: false,
        notes,
      };

      try {
        diskResearcherSet(cacheKey, response);
      } catch {
        /* best-effort */
      }

      return res.json(gate ? { ...response, gate } : response);
    } catch (err: any) {
      console.error("[ValueChain] /api/valuechain failed:", err?.message || err);
      return res.status(500).json({ error: err?.message || "valuechain failed" });
    }
  });

  // Hilfsroute für den Branchen-Selector im Frontend (Dropdown-Optionen).
  // Ticket VALUECHAIN_GICS_COVERAGE.md, UI-Abschnitt: "Dropdown/UI GRUPPIERT
  // nach den 11 GICS-Sektoren, darunter die Ketten eingerueckt". `industries`
  // (flache Liste) bleibt zur Abwaertskompatibilitaet erhalten, `sectors`
  // (GICS-gruppiert, inkl. Ketten unter dem Gate mit gate:false) ist neu.
  app.get("/api/valuechain/industries", (_req, res) => {
    const bySector = new Map<string, Array<{ key: string; label: string }>>();
    for (const gs of GICS_SECTOR_ORDER) bySector.set(gs, []);
    for (const i of ALL_INDUSTRIES) {
      const arr = bySector.get(i.gicsSector) || [];
      arr.push({ key: i.key, label: i.label });
      bySector.set(i.gicsSector, arr);
    }
    const sectors = GICS_SECTOR_ORDER.map((gicsSector) => ({
      gicsSector,
      chains: bySector.get(gicsSector) || [],
    }));
    res.json({
      industries: VALUECHAIN_INDUSTRIES.map((i) => ({ key: i.key, label: i.label })),
      sectors,
    });
  });

  // Sprint D6c: KI-Anreicherung der bereits geladenen Value-Chain-Stages.
  // Holt die (ggf. gecachte) Basis-Response ueber dieselbe Pipeline wie
  // GET /api/valuechain, ruft dann enrichValueChainStages() (echter LLM-Call,
  // server/llm-openrouter.ts) auf und liefert die angereicherten Stages
  // zurueck. llmValidated wird NUR bei einem tatsaechlich erfolgreichen Call
  // auf true gesetzt -- niemals bei Fallback/Fehler (Zahlen-Prinzip).
  app.post("/api/valuechain/enrich", async (req, res) => {
    try {
      const industryKey = String(req.body?.industry || "").toLowerCase().trim();
      const region = (String(req.body?.region || "GLOBAL").toUpperCase() as Region) || "GLOBAL";
      const minMarketCap = Number(req.body?.minMarketCap) > 0 ? Number(req.body.minMarketCap) : 1_000_000_000;
      const force = req.body?.force === true || req.body?.force === "1";

      const def = findIndustry(industryKey);
      if (!def) {
        return res.status(404).json({
          error: `Unbekannte Branche: ${industryKey}`,
          availableIndustries: VALUECHAIN_INDUSTRIES.map((i) => ({ key: i.key, label: i.label })),
        });
      }

      const eCacheKey = enrichCacheKey(def.key, region, minMarketCap);
      if (!force) {
        const cachedEnrich = diskResearcherGet(eCacheKey);
        if (cachedEnrich) {
          const age = Date.now() - new Date(cachedEnrich.generatedAt || 0).getTime();
          if (Number.isFinite(age) && age < ENRICH_CACHE_TTL_MS) {
            return res.json({ ...cachedEnrich, cacheHit: true });
          }
        }
      }

      // Basis-Stages laden -- nutzt denselben Response-Cache wie GET
      // /api/valuechain (kein doppelter FMP-Call noetig, wenn frisch im Cache).
      const baseCacheKey = responseCacheKey(def.key, region, minMarketCap);
      let base: ValueChainResponse | null = diskResearcherGet(baseCacheKey);
      if (!base) {
        return res.status(409).json({
          error: "Keine Basis-Value-Chain-Daten im Cache -- zuerst GET /api/valuechain aufrufen.",
        });
      }

      const companiesInput: ValueChainEnrichCompanyInput[] = base.stages.flatMap((stage) =>
        stage.companies.map((c) => ({
          ticker: c.ticker,
          name: c.name,
          sector: c.sector,
          industry: c.industry,
          stageType: stage.stageType,
        }))
      );

      if (companiesInput.length === 0) {
        return res.status(400).json({ error: "Keine Firmen in den geladenen Stages zum Anreichern." });
      }

      const enrichResult = await enrichValueChainStages({
        industryLabel: def.label,
        companies: companiesInput,
      });

      if (!enrichResult) {
        // Kein Fake-Erfolg: llmValidated bleibt false, keine erfundenen Rollen.
        return res.status(502).json({
          error: "KI-Anreicherung nicht verfuegbar (kein OPENROUTER_API_KEY, Rate-Limit, oder LLM nicht erreichbar).",
          llmValidated: false,
        });
      }

      const roleByTicker = new Map(enrichResult.companies.map((c) => [c.ticker.toUpperCase(), c]));
      const enrichedStages = base.stages.map((stage) => ({
        ...stage,
        companies: stage.companies.map((c) => {
          const hit = roleByTicker.get(c.ticker.toUpperCase());
          if (!hit) return c;
          return {
            ...c,
            aiRole: hit.role,
            stageCorrected: hit.stageCorrected,
            validated: true,
          };
        }),
      }));

      const response = {
        industry: def.key,
        region,
        stages: enrichedStages,
        generatedAt: new Date().toISOString(),
        cacheHit: false,
        llmValidated: true,
        modelUsed: enrichResult.modelUsed,
      };

      try {
        diskResearcherSet(eCacheKey, response);
      } catch {
        /* best-effort */
      }

      return res.json(response);
    } catch (err: any) {
      console.error("[ValueChain] /api/valuechain/enrich failed:", err?.message || err);
      return res.status(500).json({ error: err?.message || "valuechain enrich failed", llmValidated: false });
    }
  });
}
