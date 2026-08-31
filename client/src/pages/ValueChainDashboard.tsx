/**
 * ValueChainDashboard.tsx
 * -----------------------
 * Sprint D6b (Redesign nach Referenzbild): Dark-Theme-Dashboard mit
 * Branchen-Dropdown oben rechts, gestufter/isometrisch wirkender
 * Kartenreihe (Stufen-Effekt via CSS `translateY`, siehe StageColumn.tsx)
 * und KPI-Kacheln unten (siehe ValueChainKpiTiles.tsx) — angelehnt an das
 * vom Nutzer vorgegebene "KI-Wertschöpfungskette"-Referenzbild, ABER
 * adaptiv aus den echten API-Stages generiert statt der 7 fixen KI-Stufen
 * aus der Vorlage. KEIN Graph-Canvas, KEIN React-Flow, KEINE neue
 * npm-Abhängigkeit — reines CSS/Tailwind/SVG.
 *
 * Datenquelle (unverändert, bereits vollständig funktionierend):
 * GET /api/valuechain?industry=&region=&minMarketCap=
 * (server/valuechain-routes.ts, server/valuechain-fmp-enrichment.ts)
 *
 * Sprint D6a (vorher): Branchen-Selector + Filter + einfache CSS-Grid-
 * Karten/Tabelle pro Stage — funktional, aber visuell schlicht. Diese
 * Datei ersetzt NUR die visuelle Darstellung; State/Fetch-Logik ist
 * unverändert aus D6a übernommen.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { RefreshCw, Factory, Info, ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { StageColumn } from "@/components/valuechain/StageColumn";
import { ValueChainKpiTiles } from "@/components/valuechain/ValueChainKpiTiles";
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
  const [showInfo, setShowInfo] = useState(false);

  // Sprint D6c: KI-Anreicherung (server/llm-openrouter.ts::enrichValueChainStages
  // via POST /api/valuechain/enrich). Eigener Loading-/Error-State, damit ein
  // Fehlschlag NICHT die bereits geladenen Basis-Stages (data) zerstört.
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

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
    setEnrichError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry, region, minMarketCap]);

  const enrichWithAI = useCallback(async () => {
    if (!data || data.stages.length === 0) return;
    setIsEnriching(true);
    setEnrichError(null);
    try {
      const res = await apiRequest("POST", "/api/valuechain/enrich", {
        industry,
        region,
        minMarketCap,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || `${res.status}: ${res.statusText}`);
      }
      setData(json);
    } catch (err: any) {
      setEnrichError(err?.message || String(err));
    } finally {
      setIsEnriching(false);
    }
  }, [data, industry, region, minMarketCap]);

  const currentIndustryLabel = useMemo(() => {
    return industries.find((i) => i.key === industry)?.label ?? industry;
  }, [industries, industry]);

  const datenstand = data
    ? new Date(data.generatedAt).toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    // Dark-Theme-Scope NUR für diese Seite (lokaler Wrapper, kein globales
    // App-Theme-Wechsel) — analog Referenzbild-Optik. `h-screen`+`overflow-hidden`
    // Außenhülle + `flex-1 overflow-y-auto` Innenbereich, analog zum
    // bestehenden Muster in RecessionDashboard/GoldDashboard/BTCDashboard
    // (globales `body{overflow:hidden}` aus index.css macht einen eigenen
    // Scroll-Container hier notwendig, sonst wird der untere Seiteninhalt
    // abgeschnitten).
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0e17] text-slate-100">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header: Icon + Titel + Untertitel + Branchen-Dropdown oben rechts + Info-Icon */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/80 to-slate-900/30 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-800/80 text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
              title="Zurück zur Startseite"
              data-testid="button-back-to-dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/30">
              <Factory className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white md:text-xl">Wertschöpfungskette</h1>
              <p className="text-xs text-slate-400 md:text-sm">
                End-to-End-Wertschöpfung in der Branche — {currentIndustryLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-slate-500">Branche</label>
              <select
                className="rounded-md border border-white/10 bg-slate-800/80 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
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
              <label className="text-[10px] uppercase tracking-wide text-slate-500">Region</label>
              <select
                className="rounded-md border border-white/10 bg-slate-800/80 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
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
              <label className="text-[10px] uppercase tracking-wide text-slate-500">Min. MCap</label>
              <select
                className="rounded-md border border-white/10 bg-slate-800/80 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
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
              className="mt-4 flex items-center gap-1.5 rounded-md border border-white/10 bg-slate-800/80 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Aktualisieren
            </button>

            <button
              onClick={enrichWithAI}
              disabled={isEnriching || !data || data.stages.length === 0}
              title="KI-Anreicherung — unternehmensspezifische Rollen-Beschreibung + Stage-Validierung via LLM (OpenRouter)"
              className={`mt-4 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                data?.llmValidated
                  ? "border-violet-400/40 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
                  : "border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
              }`}
              data-testid="button-valuechain-ai-enrich"
            >
              {isEnriching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              KI{data?.llmValidated ? " ✓" : ""}
            </button>

            <button
              onClick={() => setShowInfo((v) => !v)}
              className="mt-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              aria-label="Info"
              data-testid="button-info"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
        </header>

        {showInfo && (
          <div className="mb-4 rounded-lg border border-cyan-800/40 bg-cyan-950/20 px-4 py-3 text-xs text-cyan-200">
            Zeigt die reale Branchen-Wertschöpfungskette (Upstream → Midstream → Downstream) mit
            Firmen aus dem FMP-Company-Screener. CAPEX-Intensität = |Capex| / Umsatz (TTM), live
            berechnet. Keine KI-generierten oder erfundenen Kennzahlen.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-rose-800/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {enrichError && (
          <div
            className="mb-4 rounded-md border border-rose-800/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-300"
            data-testid="text-enrich-error"
          >
            KI-Anreicherung fehlgeschlagen: {enrichError}
          </div>
        )}

        {isLoading && !data && (
          <div className="text-sm text-slate-400">Lade Value-Chain-Daten…</div>
        )}

        {data && data.stages.length === 0 && !isLoading && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-8 text-center text-sm text-slate-400">
            Keine Firmen für diese Filterkombination gefunden.
          </div>
        )}

        {data && data.notes && data.notes.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-800/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-300">
            {data.notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        )}

        {/* Haupt-Visualisierung: gestufte Kartenreihe, adaptiv aus echten
            API-Stages (upstream → midstream → downstream), NICHT die 7
            fixen KI-Stufen aus dem Referenzbild. Desktop: Stufen-Layout via
            translateY; Mobile: einfache vertikale Liste (Media Query unten). */}
        {data && data.stages.length > 0 && (
          <div className="mb-6 overflow-x-auto rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/60 to-slate-950/60 p-5 md:overflow-visible">
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-6">
              {data.stages.map((stage, i) => (
                <StageColumn
                  key={stage.stageId}
                  stage={stage}
                  index={i}
                  total={data.stages.length}
                  onCompanyClick={(ticker) => navigate(`/?ticker=${ticker}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* KPI-Kachel-Reihe unten */}
        {data && data.stages.length > 0 && (
          <div className="mb-6">
            <ValueChainKpiTiles stages={data.stages} />
          </div>
        )}

        {/* Footer */}
        {data && (
          <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-3 text-[11px] text-slate-500">
            <span>Datenstand: {datenstand}</span>
            <span>·</span>
            <span>Aktualisierung: on-demand</span>
            <span>·</span>
            <span>{data.cacheHit ? "aus Cache" : "live geladen"}</span>
            <span>·</span>
            <span>llmValidated: {String(data.llmValidated)}</span>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
