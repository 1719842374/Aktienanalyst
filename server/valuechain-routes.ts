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

const FMP_BASE = "https://financialmodelingprep.com/stable";

function getApiKey(): string {
  return process.env.FMP_API_KEY || "";
}

// ---------------------------------------------------------------------------
// Branchen-Registry: Branchen-Key → FMP-Sektor/Industrie-Taxonomie.
// FMP-Werte kommen 1:1 aus /stable/available-industries (verifiziert live,
// 31.08.2026) — kein eigenes, erfundenes Vokabular. Erweiterbar durch
// zusätzliche Einträge, KEINE Ticker hier.
// ---------------------------------------------------------------------------
interface IndustryDef {
  key: string;
  label: string;
  fmpSector: string;
  fmpIndustry: string;
}

export const VALUECHAIN_INDUSTRIES: IndustryDef[] = [
  { key: "semiconductors", label: "Halbleiter", fmpSector: "Technology", fmpIndustry: "Semiconductors" },
  { key: "software-infrastructure", label: "Software-Infrastruktur", fmpSector: "Technology", fmpIndustry: "Software - Infrastructure" },
  { key: "oil-gas", label: "Öl & Gas", fmpSector: "Energy", fmpIndustry: "Oil & Gas Integrated" },
  { key: "auto-manufacturers", label: "Automobilhersteller", fmpSector: "Consumer Cyclical", fmpIndustry: "Auto - Manufacturers" },
  { key: "aerospace-defense", label: "Luft- & Raumfahrt / Verteidigung", fmpSector: "Industrials", fmpIndustry: "Aerospace & Defense" },
  { key: "biotechnology", label: "Biotechnologie", fmpSector: "Healthcare", fmpIndustry: "Biotechnology" },
];

function findIndustry(key: string): IndustryDef | undefined {
  return VALUECHAIN_INDUSTRIES.find((i) => i.key === key.toLowerCase().trim());
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
    test: /\b(fabless|designs?,?( and)? (develops|markets)|graphics|computational|end[- ]user|branded|consumer products|distribution to|dealership)\b/i,
    stage: "downstream",
  },
  // Upstream: Ausrüster / Materialien / Test-Equipment / Rohstoffe — bewusst
  // spezifische Mehrwort-Phrasen statt des blossen Worts "equipment" (das
  // auch in generischen OEM-Vertriebssaetzen vorkommt, siehe oben).
  {
    test: /\b(supplier of equipment|semiconductor (processing )?equipment|equipment (vital|used) for semiconductor|process equipment|lithograph|deposition system|etch(ing)? system|wafer fabrication (tools|equipment)|materials (supplier|engineering)|specialty materials|automated test equipment|testing equipment|exploration|drilling|upstream supplier|raw material)\b/i,
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
// FMP company-screener (live, datengetrieben — KEINE Ticker-Hardcodes)
// ---------------------------------------------------------------------------
async function fetchScreenerCompanies(
  def: IndustryDef,
  minMarketCap: number
): Promise<Array<{ symbol: string; companyName: string; marketCap: number; sector: string; industry: string }>> {
  const key = getApiKey();
  if (!key) return [];
  const url = new URL(`${FMP_BASE}/company-screener`);
  url.searchParams.set("sector", def.fmpSector);
  url.searchParams.set("industry", def.fmpIndustry);
  url.searchParams.set("marketCapMoreThan", String(minMarketCap));
  url.searchParams.set("limit", "60");
  url.searchParams.set("isActivelyTrading", "true");
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
    }));
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
      if (!def) {
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

      // Rang 4: Branchen-Roster live von FMP (datengetrieben, kein Hardcode)
      const rawCompanies = await fetchScreenerCompanies(def, minMarketCap);

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
      const byStage: Record<StageType, ValueChainCompany[]> = {
        upstream: [],
        midstream: [],
        downstream: [],
      };

      let missingCount = 0;
      for (const raw of rawCompanies) {
        const enr = enrichment.get(raw.symbol.toUpperCase());
        const classifyText = `${enr?.description || ""} ${raw.companyName}`;
        const stage = classifyStage(classifyText);

        // Rang 6: CAPEX-Intensity live berechnen (computeCapexIntensity aus
        // valueChainTypes.ts, UNVERÄNDERT importiert) — fehlende FMP-Daten
        // führen zu null, NIEMALS zu einer Schätzung.
        const capexIntensity = enr
          ? computeCapexIntensity(enr.capex, enr.revenueTTM)
          : null;
        if (!enr || enr.dataMissing) missingCount++;

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

      return res.json(response);
    } catch (err: any) {
      console.error("[ValueChain] /api/valuechain failed:", err?.message || err);
      return res.status(500).json({ error: err?.message || "valuechain failed" });
    }
  });

  // Hilfsroute für den Branchen-Selector im Frontend (Dropdown-Optionen)
  app.get("/api/valuechain/industries", (_req, res) => {
    res.json({
      industries: VALUECHAIN_INDUSTRIES.map((i) => ({ key: i.key, label: i.label })),
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
