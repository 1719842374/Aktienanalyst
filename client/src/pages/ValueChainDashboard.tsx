/**
 * ValueChainDashboard.tsx
 * -----------------------
 * Sprint D6a (Rang 4): Branchen-Selector + Filter (Region/MarketCap) +
 * Ergebnis-Anzeige als CSS-Grid-Karten/Tabelle pro Stage (upstream/midstream/
 * downstream) — KEIN Graph-Canvas/React-Flow (siehe Ticket, "Explizit NICHT
 * in diesem Ticket"). StageNode/CompanyNode werden hier als reine
 * Anzeige-Komponenten (Props) verwendet.
 *
 * Datenquelle: GET /api/valuechain?industry=&region=&minMarketCap=
 * (server/valuechain-routes.ts, additiv registriert).
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { RefreshCw, Factory } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { StageNode } from "@/components/valuechain/StageNode";
import { CompanyNode } from "@/components/valuechain/CompanyNode";
import type { ValueChainResponse, Region } from "@/lib/valueChainTypes";

interface IndustryOption {
  key: string;
  label: string;
}

const REGION_OPTIONS: Array<{ value: Region; label: string }> = [
  { value: "GLOBAL", label: "Global" },
  { value: "US", label: "USA" },
  { value: "EU", label: "Europa" },
  { value: "ASIA", label: "Asien" },
];

const MARKET_CAP_OPTIONS = [
  { value: 0, label: "Alle" },
  { value: 1_000_000_000, label: "≥ 1 Mrd. $" },
  { value: 10_000_000_000, label: "≥ 10 Mrd. $" },
  { value: 100_000_000_000, label: "≥ 100 Mrd. $" },
];

export default function ValueChainDashboard() {
  const [, navigate] = useLocation();
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [industry, setIndustry] = useState<string>("semiconductors");
  const [region, setRegion] = useState<Region>("GLOBAL");
  const [minMarketCap, setMinMarketCap] = useState<number>(1_000_000_000);

  const [data, setData] = useState<ValueChainResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Branchen-Optionen einmalig laden (Dropdown-Inhalt)
  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/valuechain/industries");
        if (res.ok) {
          const json = await res.json();
          setIndustries(json.industries || []);
        }
      } catch {
        /* Dropdown bleibt leer, Auswahl per Freitext-Fallback unten */
      }
    })();
  }, []);

  const load = useCallback(async (force: boolean) => {
    if (!industry) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        industry,
        region,
        minMarketCap: String(minMarketCap),
      });
      if (force) params.set("force", "1");
      const res = await apiRequest("GET", `/api/valuechain?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || String(err));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [industry, region, minMarketCap]);

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry, region, minMarketCap]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-center gap-3">
          <Factory className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Value-Chain-Explorer</h1>
            <p className="text-sm text-slate-400">
              Branchen-Wertschöpfungskette: Upstream / Midstream / Downstream mit CAPEX-Intensität
            </p>
          </div>
        </header>

        {/* Branchen-Selector + Filter */}
        <div className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Branche</label>
            <select
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              data-testid="select-industry"
            >
              {industries.length === 0 && <option value="semiconductors">Halbleiter</option>}
              {industries.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Region</label>
            <select
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white"
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              data-testid="select-region"
            >
              {REGION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Min. Marktkapitalisierung</label>
            <select
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white"
              value={minMarketCap}
              onChange={(e) => setMinMarketCap(Number(e.target.value))}
              data-testid="select-marketcap"
            >
              {MARKET_CAP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => load(true)}
            disabled={isLoading}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Aktualisieren
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-800/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {isLoading && !data && (
          <div className="text-sm text-slate-400">Lade Value-Chain-Daten…</div>
        )}

        {data && data.stages.length === 0 && !isLoading && (
          <div className="text-sm text-slate-400">Keine Firmen für diese Filterkombination gefunden.</div>
        )}

        {data && data.notes && data.notes.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-800/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-300">
            {data.notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        )}

        {/* Stage-Spalten als CSS-Grid (kein Graph-Layout) */}
        {data && data.stages.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {data.stages.map((stage) => (
              <div key={stage.stageId} className="flex flex-col gap-3">
                <StageNode
                  data={{
                    stageId: stage.stageId,
                    stageName: stage.stageName,
                    stageType: stage.stageType,
                    description: stage.description,
                    companyCount: stage.companyCount ?? stage.companies.length,
                    aggregatedMarketCap: stage.aggregatedMarketCap,
                    avgCapexIntensity: stage.avgCapexIntensity,
                  }}
                />
                <div className="flex flex-col gap-2">
                  {stage.companies.map((c) => (
                    <CompanyNode
                      key={c.ticker}
                      data={{
                        ticker: c.ticker,
                        name: c.name,
                        marketCap: c.marketCap,
                        performance1Y: c.performance1Y,
                        valuationFlag: c.valuationFlag,
                        institutionalHolders13F: c.institutionalHolders13F,
                        starInvestorFlag: c.starInvestorFlag,
                        capexIntensity: c.capexIntensity,
                        logoUrl: c.logoUrl,
                        validated: c.validated,
                      }}
                      onClick={(ticker) => navigate(`/?ticker=${ticker}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          <div className="mt-6 text-[11px] text-slate-500">
            Stand: {new Date(data.generatedAt).toLocaleString("de-DE")} · {data.cacheHit ? "aus Cache" : "live geladen"} ·
            {" "}llmValidated: {String(data.llmValidated)}
          </div>
        )}
      </div>
    </div>
  );
}
