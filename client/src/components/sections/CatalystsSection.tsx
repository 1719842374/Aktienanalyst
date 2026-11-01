import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { formatNumber, formatCurrency, statementCurrency } from "../../lib/formatters";
import { calculateFCFFDCF, buildDefaultDCFParams, selectCatalystBase } from "../../lib/calculations";
import { buildBiasDecision, isNegativeCatalyst, sumUpsideGb } from "../../../../shared/bias-fixes";
import React from "react";
import { Lightbulb, Clock, Zap, Info, ChevronDown, ChevronUp, Building2, TrendingUp, Globe, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import { apiRequest } from "../../lib/queryClient";
import { CATALYST_EVENT_VARIABLES, DOWNSIDE_EVENT_MIN_POS_EXCLUSIVE, USER_EVENT_SUFFIX, catalystDisplayName, formatSignedPct, isDownsideEventBelowThreshold, isUserEvent } from "../../../../shared/catalyst-event";

interface Props {
  data: StockAnalysis;
  // Auftrag 08.08.2026 ("These direkt nach KI-Enrich aktualisieren"): additive
  // optionale Parameter -- bestehende Aufrufer, die nur (catalysts) erwarten,
  // bleiben unveraendert kompatibel (TypeScript optional params).
  // Bugfix (06.09.2026, Nutzer-Feedback): zusaetzlicher optionaler
  // execSummary-Parameter -- Server liefert nach KI-Enrich jetzt das neu
  // berechnete Executive Summary (S0-Karte) mit, das dann die neuen
  // firmenspezifischen Katalysatoren in Pro/Contra/PoS-Satz/Fazit zeigt
  // statt der alten generischen. Optional gehalten (aeltere Response-
  // Formen/Fehlerfaelle liefern es ggf. nicht).
  onCatalystsEnriched?: (catalysts: StockAnalysis['catalysts'], growthThesis?: string | null, growthThesisGeneratedAt?: string | null, execSummary?: any) => void;
  // S17 „Event hinzufügen“ (§4b Stufe 1): ein zusätzlicher Katalysator, Dashboard hängt ihn an data.catalysts (nur Session).
  onUserEvent?: (catalyst: StockAnalysis['catalysts'][number]) => void;
}

const GENERIC_CATALYST_NAMES = new Set<string>([
  "Revenue Growth Acceleration",
  "Margin Expansion / Operating Leverage",
  "Market Share Gains",
  "Strategic M&A / Partnerships",
  "AI / Cloud Adoption Tailwind",
  "Product Cycle / Platform Expansion",
  "Regulatory Rate Case",
  "Clean Energy Expansion",
  "Interest Rate Normalization Benefit",
  "Capital Return / Buyback Program",
  "Government Contract / Defense Spending",
  "Demographic Tailwind",
]);

function hasGenericCatalysts(cats: { name: string }[]): boolean {
  if (!cats || cats.length === 0) return false;
  const generic = cats.filter(c => GENERIC_CATALYST_NAMES.has(c.name)).length;
  return generic >= cats.length / 2;
}

export function CatalystsSection({ data, onCatalystsEnriched, onUserEvent }: Props) {
  const reasoning = data.catalystReasoning;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmDone, setLlmDone] = useState(false);
  const [llmSkipped, setLlmSkipped] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmEnrichedCatalysts, setLlmEnrichedCatalysts] = useState<any[] | null>(null);
  // S17 „Event hinzufügen“
  const [eventOpen, setEventOpen] = useState(false);
  const [eventMode, setEventMode] = useState<"text" | "structured">("text");
  const [eventText, setEventText] = useState("");
  const [eventForm, setEventForm] = useState({ name: "", variable: "umsatz", deltaPct: "", horizonMonths: "12", pos: "", einpreisungsgrad: "0" });
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [ignoredEvents, setIgnoredEvents] = useState<any[]>([]);

  const catalysts = (llmEnrichedCatalysts ?? data.catalysts) as typeof data.catalysts;
  const biasInput = useMemo(() => {
    if (!llmEnrichedCatalysts) return data;
    return { ...data, catalysts: llmEnrichedCatalysts, llmMode: true, catalystsSource: "llm" as const };
  }, [data, llmEnrichedCatalysts]);
  const bias = useMemo(() => buildBiasDecision(biasInput), [biasInput]);
  const upsideCatalysts = catalysts.filter(c => !isNegativeCatalyst(c));
  const downsideCatalysts = catalysts.filter(c => isNegativeCatalyst(c));
  const showGenericBanner = llmEnrichedCatalysts === null && hasGenericCatalysts(data.catalysts as any);

  async function triggerKI() {
    setLlmLoading(true);
    setLlmError(null);
    setLlmSkipped(false);
    try {
      // LLM-Enrich: two sequential model calls (~30s each) → allow 120s
      const res = await apiRequest("POST", "/api/catalyst-enrich", {
        ticker: data.ticker,
        useLLM: true,
        force: true,
      }, 120_000);
      const json = await res.json();
      if (json._llmSkipped) {
        setLlmSkipped(true);
        if (Array.isArray(json.catalysts)) setLlmEnrichedCatalysts(json.catalysts);
        setLlmError("KI-Analyse nicht verfügbar (Token-Budget erschöpft). Basis-Katalysatoren werden angezeigt.");
      } else if (Array.isArray(json.catalysts)) {
        setLlmEnrichedCatalysts(json.catalysts);
        setLlmDone(true);
        // Persist enriched catalysts into parent Dashboard state
        // so they survive navigation/re-renders (won't reset to generic)
        // Auftrag 08.08.2026: /api/catalyst-enrich liefert jetzt zusaetzlich
        // die sofort neu generierte These (Section 2) im selben Response --
        // wird additiv mit weitergegeben, damit S2 sofort konsistent mit den
        // gerade firmenspezifisch gewordenen Katalysatoren in S15 ist.
        onCatalystsEnriched?.(json.catalysts, json.growthThesis, json.growthThesisGeneratedAt, json.execSummary);
      } else {
        setLlmError("Keine Katalysatoren erhalten.");
      }
    } catch (err: any) {
      const msg = err?.message || "";
      console.warn(`[Section15] KI-Analyse fehlgeschlagen: ${msg}`);
      if (/timeout|90s|120s/i.test(msg)) {
        setLlmError("KI-Analyse: Server zu langsam — bitte erneut versuchen (LLM braucht 40-70s).");
      } else if (/503|402/.test(msg)) {
        setLlmError("KI-Analyse nicht verfügbar (Token-Budget erschöpft).");
      } else if (/404/.test(msg)) {
        setLlmError("Keine zwischengespeicherte Analyse — bitte zuerst Vollanalyse ausführen.");
      } else {
        setLlmError(msg || "KI-Analyse fehlgeschlagen.");
      }
    } finally {
      setLlmLoading(false);
    }
  }

  async function submitEvent() {
    setEventLoading(true);
    setEventError(null);
    try {
      const body = eventMode === "text"
        ? { ticker: data.ticker, companyName: data.companyName, currency: data.currency, currentPrice: data.currentPrice, text: eventText, existing: catalysts.map(c => c.name) }
        : { ticker: data.ticker, structured: eventForm };
      const res = await apiRequest("POST", "/api/catalyst-event", body, 90_000);
      const json = await res.json().catch(() => ({}));
      if (!json?.catalyst) {
        setEventError(json?.error || (json?.reason === "llm_unavailable" ? "KI nicht verfügbar — bitte strukturiert eingeben." : `Event nicht übernommen (${json?.reason || res.status}).`));
        return;
      }
      const cat = json.catalyst;
      if (isDownsideEventBelowThreshold(cat)) {
        // Philip 25.10.2026: Downside ≤ 50 % fließt nicht ein, wird nur angezeigt.
        setIgnoredEvents(prev => [...prev, cat]);
      } else {
        setLlmEnrichedCatalysts(prev => (prev ? [...prev, cat] : prev));
        onUserEvent?.(cat);
      }
      setEventText("");
      setEventOpen(false);
    } catch (err: any) {
      setEventError(err?.message || "Event fehlgeschlagen.");
    } finally {
      setEventLoading(false);
    }
  }

  // Compute conservative FCFF DCF — shared defaults via buildDefaultDCFParams
  // (same single source of truth as Section2/Section5/Section6, inkl. `rsl`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dcfParams = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);

  const conservativeDCF = useMemo(() => calculateFCFFDCF(dcfParams), [dcfParams]);

  // Smart Catalyst-Base-Selektor (Plausibilitäts-Gate — verhindert unsinnige
  // negative Catalyst-Targets bei Aktien mit verzerrt-niedrigem DCF)
  const totalGB = sumUpsideGb(catalysts);
  const decisionBase = Number.isFinite(bias.decisionPerShare) ? bias.decisionPerShare : conservativeDCF.perShare;
  const _baseInfoS11 = selectCatalystBase(decisionBase, totalGB, data.currentPrice, data.analystPT.median);
  const catalystDCFBase = _baseInfoS11.base;
  const catalystBaseFallback = _baseInfoS11.source !== "dcf";
  const catalystAdjTarget = catalystDCFBase * (1 + totalGB / 100);
  // JOB 23 (wie SummarySection): DCF-Werte in Statement-Währung; Kurs und Analyst-PT in Listing-Währung (data.currency).
  // Das Kat.-Ziel erbt die Währung seiner Basis (DCF → statementCurrency, Fallback Analyst PT → data.currency).
  const dcfCcy = statementCurrency(data);
  const catalystCcy = catalystBaseFallback ? data.currency : dcfCcy;

  return (
    <SectionCard number={17} title="KURSANSTIEG-KATALYSATOREN (Anti-Bias)">
      {/* === KI Analyse Button (analog Section 8) === */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => !llmLoading && triggerKI()}
          disabled={llmLoading}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
            llmDone
              ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
              : "text-foreground/50 border-border/50 hover:bg-muted/50 hover:text-foreground/70"
          } ${llmLoading ? "opacity-60 cursor-not-allowed" : ""}`}
          title="KI Analyse — unternehmensspezifische Katalysatoren via Claude 3.5 Haiku"
          data-testid="button-catalyst-ki-analyse"
        >
          {llmLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          KI Analyse
          {llmDone && !llmLoading && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          )}
          {llmSkipped && !llmLoading && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>

        {llmLoading && (
          <span className="text-[10px] text-muted-foreground animate-pulse">
            Generiere Katalysatoren…
          </span>
        )}

        <button
          onClick={() => setEventOpen(o => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border text-foreground/50 border-border/50 hover:bg-muted/50 hover:text-foreground/70 transition-all"
          title="Event hinzufügen — zusätzlicher Katalysator (z. B. aus dem letzten Earnings Call), Impact per KI-Schema"
          data-testid="button-catalyst-event-add"
        >
          <Zap className="w-3 h-3" />
          Event hinzufügen
        </button>

        {llmDone && !llmLoading && (
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-400 border-violet-500/20">
            ✦ KI
          </span>
        )}
      </div>

      {eventOpen && (
        <div className="text-[11px] border border-border/50 rounded px-3 py-2 space-y-2 bg-muted/20" data-testid="catalyst-event-form">
          <div className="flex gap-2">
            {(["text", "structured"] as const).map(m => (
              <button key={m} onClick={() => setEventMode(m)} className={`px-2 py-0.5 rounded border ${eventMode === m ? "border-primary/40 text-primary" : "border-border/50 text-foreground/50"}`}>
                {m === "text" ? "Freitext (KI)" : "Strukturiert"}
              </button>
            ))}
          </div>
          {eventMode === "text" ? (
            <div className="space-y-1">
              <label htmlFor="catalyst-event-text" className="block text-[10px] font-medium text-foreground/70">Event-Beschreibung (Freitext, Impact per KI)</label>
              <textarea id="catalyst-event-text" value={eventText} onChange={e => setEventText(e.target.value)} rows={3} className="w-full bg-background border border-border/50 rounded p-1.5"
                placeholder="z. B. Q3-Call: Guidance für FY27-Bruttomarge +150 bp angehoben" data-testid="catalyst-event-text" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" data-testid="catalyst-event-structured">
              {([
                { id: "catalyst-event-name", key: "name", label: "Name", placeholder: "z. B. Q3-Guidance", span: "col-span-2 sm:col-span-3" },
                { id: "catalyst-event-variable", key: "variable", label: "Variable", span: "" },
                { id: "catalyst-event-delta", key: "deltaPct", label: "Delta % (− = Downside)", placeholder: "z. B. 10 oder -15", span: "" },
                { id: "catalyst-event-horizon", key: "horizonMonths", label: "Horizont (Monate)", placeholder: "12", span: "" },
                { id: "catalyst-event-pos", key: "pos", label: "Wahrscheinlichkeit %", placeholder: "0–100", span: "" },
                { id: "catalyst-event-einpreisung", key: "einpreisungsgrad", label: "Einpreisung %", placeholder: "0–100", span: "" },
              ] as const).map(f => (
                <div key={f.id} className={`flex flex-col gap-0.5 min-w-0 ${f.span}`}>
                  <label htmlFor={f.id} className="text-[10px] font-medium text-foreground/70">{f.label}</label>
                  {f.key === "variable" ? (
                    <select id={f.id} value={eventForm.variable} onChange={e => setEventForm({ ...eventForm, variable: e.target.value })} className="w-full bg-background border border-border/50 rounded p-1">
                      {CATALYST_EVENT_VARIABLES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input id={f.id} value={eventForm[f.key]} onChange={e => setEventForm({ ...eventForm, [f.key]: e.target.value })}
                      placeholder={"placeholder" in f ? f.placeholder : undefined} inputMode={f.key === "name" ? undefined : "decimal"}
                      className="w-full bg-background border border-border/50 rounded p-1" />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => !eventLoading && submitEvent()} disabled={eventLoading} className="px-2.5 py-1 rounded border border-primary/40 text-primary" data-testid="button-catalyst-event-submit">
              {eventLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : null} Übernehmen
            </button>
            <span className="text-[10px] text-muted-foreground">Zusätzlicher Katalysator, bewertet nach der bestehenden Logik (nur diese Sitzung). Downside nur bei Wahrscheinlichkeit &gt; {DOWNSIDE_EVENT_MIN_POS_EXCLUSIVE} %.</span>
          </div>
          {eventError && <div className="text-red-400">⚠ {eventError}</div>}
        </div>
      )}

      {llmError && (
        <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          ⚠ {llmError}
        </div>
      )}

      <div className="text-[11px] text-foreground/70 bg-muted/30 border border-border/50 rounded px-3 py-2" data-testid="catalyst-mode-label">
        {bias.modeLabel}
        {bias.switched
          ? ` · Basis: ${bias.valuationBaseLabel} ${formatCurrency(bias.decisionPerShare, 2, dcfCcy)} · Unadjusted / Extrapolative ${formatCurrency(bias.unadjustedPerShare, 2, dcfCcy)}`
          : ` · Basis: ${bias.valuationBaseLabel}`}
        {downsideCatalysts.length > 0 ? ` · ${downsideCatalysts.length} ▼ aus der positiven GB-Summe ausgeschlossen` : ""}
      </div>

      {showGenericBanner && !llmError && (
        <div className="text-[11px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2">
          ⚠ Generische Katalysatoren erkannt — KI-Analyse für unternehmensspezifische Analyse empfohlen
        </div>
      )}

      {/* === WARUM GERADE INTERESSANT === */}
      {reasoning && (
        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Warum ist die Aktie gerade interessant?</span>
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed">
            {reasoning.whyInteresting}
          </p>
          <div className="flex flex-wrap gap-2">
            {reasoning.keyDrivers.map((driver, i) => (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-primary/10 text-primary border border-primary/20"
              >
                <Zap className="w-3 h-3" />
                {driver}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/50">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">Timing:</span>
            <span>{reasoning.timingRationale}</span>
          </div>
        </div>
      )}

      {/* Anti-bias disclaimer */}
      <div className="text-[10px] text-amber-500 bg-amber-500/5 rounded-md p-2 border border-amber-500/20">
        Anti-Bias-Protokoll: Kein selektiver Upside ohne symmetrischen Downside. PoS historisch begründet mit –10–15% Sicherheitsmarge.
        Einpreisungsgrad via Konsens/Reverse DCF geschätzt.
      </div>

      {/* === CATALYST TABLE === */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" data-testid="catalyst-table">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-2 text-left font-semibold text-muted-foreground w-6">Nr</th>
              <th className="py-2 pr-2 text-left font-semibold text-muted-foreground min-w-[160px]">Name & Kontext</th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground">Timeline</th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <div>PoS %</div>
                <div className="text-[9px] font-normal opacity-60">hist. begründet</div>
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <div>Brutto-Upside %</div>
                <div className="text-[9px] font-normal opacity-60">Begründung</div>
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <div>Einpreisungsgrad %</div>
                <div className="text-[9px] font-normal opacity-60">via Konsens/Rev. DCF</div>
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground">Netto-Upside %</th>
              <th className="py-2 text-right font-semibold text-muted-foreground">GB %</th>
            </tr>
          </thead>
          <tbody>
            {upsideCatalysts.map((c, i) => {
              const isExpanded = expandedRow === i;
              return (
                <tr
                  key={i}
                  className={`border-b border-border/50 cursor-pointer hover:bg-muted/20 transition-colors ${isExpanded ? "bg-muted/10" : ""}`}
                  onClick={() => setExpandedRow(isExpanded ? null : i)}
                  data-testid={`catalyst-row-${i}`}
                >
                  <td className="py-2 pr-2 font-mono text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span>K{i + 1}</span>
                      {c.newsSentiment && c.newsSentiment !== 'neutral' && (
                        <span className={`text-[9px] ${c.newsSentiment === 'bullish' ? 'text-emerald-400' : c.newsSentiment === 'bearish' ? 'text-red-400' : 'text-amber-400'}`}>
                          {c.newsSentiment === 'bullish' ? '▲' : c.newsSentiment === 'bearish' ? '▼' : '◆'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{c.name}</span>
                      {isUserEvent(c) && (
                        <span className="text-sky-400" data-testid="catalyst-user-event-badge">{USER_EVENT_SUFFIX.trim()}</span>
                      )}
                      {c.newsCount && c.newsCount > 0 && (
                        <span className={`text-[9px] px-1 py-px rounded ${c.newsSentiment === 'bullish' ? 'bg-emerald-500/15 text-emerald-400' : c.newsSentiment === 'bearish' ? 'bg-red-500/15 text-red-400' : c.newsSentiment === 'mixed' ? 'bg-amber-500/15 text-amber-400' : 'bg-foreground/5 text-foreground/40'}`}>
                          {c.newsCount}📰
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5 flex-shrink-0" />}
                    </div>
                    {isExpanded && (
                      <div className="mt-1.5 text-[10px] text-muted-foreground leading-relaxed bg-muted/20 rounded p-2.5 border border-border/30 space-y-1.5">
                        {/* Business-model context: what needs to happen for this catalyst */}
                        {c.context && (
                          <div className="text-foreground/90 leading-relaxed pb-1.5 mb-1.5 border-b border-border/20">
                            <span className="font-semibold text-primary">Geschäftsmodell-Kontext:</span>{' '}
                            {c.context}
                          </div>
                        )}
                        {/* Linked News Headlines for this catalyst */}
                        {(() => {
                          const linked = (data.newsItems || []).filter(n => n.matchedCatalystIdx === i).slice(0, 2);
                          if (linked.length === 0) return null;
                          return (
                            <div className="pb-1.5 mb-1.5 border-b border-border/20">
                              <div className="flex items-center gap-1 mb-1">
                                <span className="text-[10px]">📰</span>
                                <span className="font-semibold text-foreground/70 text-[10px]">Verknüpfte Nachrichten</span>
                              </div>
                              <div className="space-y-1">
                                {linked.map((news, ni) => {
                                  const sc = news.sentiment;
                                  const dotCls = sc === 'bullish' ? 'bg-emerald-400' : sc === 'bearish' ? 'bg-red-400' : 'bg-foreground/30';
                                  const txtCls = sc === 'bullish' ? 'text-emerald-300/90' : sc === 'bearish' ? 'text-red-300/90' : 'text-foreground/60';
                                  const scoreLabel = news.sentimentScore != null
                                    ? (news.sentimentScore > 0 ? `+${(news.sentimentScore * 100).toFixed(0)}` : `${(news.sentimentScore * 100).toFixed(0)}`)
                                    : '';
                                  return (
                                    <a
                                      key={ni}
                                      href={news.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="group flex items-start gap-1.5 rounded p-1 -mx-1 hover:bg-background/40 transition-colors"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <span className={`shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full ${dotCls}`} />
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-[10px] leading-snug line-clamp-1 group-hover:text-primary transition-colors ${txtCls}`}>
                                          {news.title}
                                        </p>
                                        <div className="flex items-center gap-1 mt-px">
                                          <span className="text-[9px] text-foreground/35">{news.source}</span>
                                          <span className="text-[9px] text-foreground/25">·</span>
                                          <span className="text-[9px] text-foreground/35">{news.relativeTime}</span>
                                          {scoreLabel && (
                                            <span className={`text-[8px] px-0.5 rounded font-mono ${sc === 'bullish' ? 'text-emerald-400/80' : sc === 'bearish' ? 'text-red-400/80' : 'text-foreground/30'}`}>
                                              {scoreLabel}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <span className="shrink-0 text-foreground/15 group-hover:text-primary text-[10px] mt-0.5">↗</span>
                                    </a>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                        <div className="flex items-start gap-1.5">
                          <Info className="w-3 h-3 flex-shrink-0 mt-0.5 text-primary" />
                          <div className="space-y-1.5">
                            <div>
                              <span className="font-semibold text-foreground/80">PoS-Herleitung:</span>{' '}
                              PoS-Schätzung: {c.pos}% (konservative Heuristik inkl. 10–15% Sicherheitsmarge).
                              {c.pos >= 70 && ' Hohe Eintrittswahrscheinlichkeit — Katalysator ist strukturell/regulatorisch unterstützt.'}
                              {c.pos >= 40 && c.pos < 70 && ' Moderate Wahrscheinlichkeit — hängt von Marktkondition und Execution ab.'}
                              {c.pos < 40 && ' Niedrige Wahrscheinlichkeit — spekulativ, aber hoher Payoff bei Eintreten.'}
                            </div>
                            <div>
                              <span className="font-semibold text-foreground/80">Brutto-Upside:</span>{' '}
                              Umsatz-/Margeneffekt bei Eintreten des Katalysators → <span className="text-emerald-500 font-medium">+{c.bruttoUpside}%</span>.
                              {c.bruttoUpside >= 15 ? ` Signifikanter Impact auf ${data.companyName}-Bewertung durch Umsatzexpansion oder Margensteigerung.` :
                               c.bruttoUpside >= 8 ? ' Moderater positiver Effekt auf Fundamentaldaten.' :
                               ' Geringer, aber messbarer Beitrag.'}
                            </div>
                            <div>
                              <span className="font-semibold text-foreground/80">Einpreisung:</span>{' '}
                              <span className="font-mono">{c.einpreisungsgrad}%</span> — {c.einpreisungsgrad >= 60 ? 'größtenteils in Konsens/Analyst PTs und Forward-PE reflektiert' : c.einpreisungsgrad >= 40 ? 'teilweise im Konsens berücksichtigt, Guidance noch nicht voll eingepreist' : 'niedrig eingepreist — Upside-Potenzial noch nicht im Konsens reflektiert'}.
                              Netto-Upside: {c.bruttoUpside}% × (1 - {c.einpreisungsgrad}/100) = <span className="text-emerald-400 font-medium">{formatNumber(c.nettoUpside, 2)}%</span>.
                            </div>
                            <div className="border-t border-border/20 pt-1">
                              <span className="font-semibold text-foreground/80">Gewichteter Beitrag (GB):</span>{' '}
                              {c.pos}% × {formatNumber(c.nettoUpside, 2)}% = <span className="text-emerald-500 font-bold">+{formatNumber(c.gb, 2)} Pkt.</span>
                            </div>
                          </div>
                        </div>

                        {/* === LLM Deep-Dive Panel === */}
                        {c.deepDive && (
                          <div className="mt-2 border-t border-border/20 pt-2 space-y-1.5">
                            <div className="text-[9px] font-semibold text-primary/70 uppercase tracking-wide">KI-Analyse</div>

                            {c.deepDive.unternehmenskontext && (
                              <div className="flex items-start gap-1.5">
                                <Building2 className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                                <div><span className="font-semibold text-foreground/80">Kontext: </span><span className="text-foreground/70">{c.deepDive.unternehmenskontext}</span></div>
                              </div>
                            )}
                            {c.deepDive.posHerleitung && (
                              <div className="flex items-start gap-1.5 border-t border-border/10 pt-1">
                                <Info className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                                <div><span className="font-semibold text-foreground/80">PoS: </span><span className="text-foreground/70">{c.deepDive.posHerleitung}</span></div>
                              </div>
                            )}
                            {c.deepDive.bewertungsauswirkung && (
                              <div className="flex items-start gap-1.5 border-t border-border/10 pt-1">
                                <TrendingUp className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                                <div><span className="font-semibold text-foreground/80">Bewertung: </span><span className="text-foreground/70">{c.deepDive.bewertungsauswirkung}</span></div>
                              </div>
                            )}
                            {c.deepDive.marktumfeld && (
                              <div className="flex items-start gap-1.5 border-t border-border/10 pt-1">
                                <Globe className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
                                <div><span className="font-semibold text-foreground/80">Markt: </span><span className="text-foreground/70">{c.deepDive.marktumfeld}</span></div>
                              </div>
                            )}
                            {c.deepDive.risiken && (
                              <div className={`flex items-start gap-1.5 border-t border-border/10 pt-1 rounded p-1 -mx-1 ${c.deepDive.unterschaetzt ? 'bg-emerald-500/8' : ''}`}>
                                <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1"><span className="font-semibold text-foreground/80">Risiken: </span><span className="text-foreground/70">{c.deepDive.risiken}</span></div>
                                {c.deepDive.unterschaetzt && (
                                  <span className="flex-shrink-0 text-[8px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 py-0.5 rounded uppercase">Unterschaetzt</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-center font-mono tabular-nums text-[10px]">{c.timeline}</td>
                  <td className="py-2 pr-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`font-mono tabular-nums font-medium px-1.5 py-0.5 rounded ${
                        c.pos >= 70 ? "bg-emerald-500/10 text-emerald-500" :
                        c.pos >= 50 ? "bg-primary/10 text-primary" :
                        "bg-amber-500/10 text-amber-500"
                      }`}>
                        {c.pos}%
                      </span>
                      {c.posAdjustment != null && c.posAdjustment !== 0 && (
                        <span className={`text-[9px] font-mono ${c.posAdjustment > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          ({c.posAdjustment > 0 ? '+' : ''}{c.posAdjustment} News)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-center font-mono tabular-nums text-emerald-500 font-medium">+{c.bruttoUpside}%</td>
                  <td className="py-2 pr-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full"
                          style={{ width: `${c.einpreisungsgrad}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-[10px]">{c.einpreisungsgrad}%</span>
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-center font-mono tabular-nums font-medium text-emerald-400">
                    {formatNumber(c.nettoUpside, 2)}%
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums font-bold text-emerald-500">
                    +{formatNumber(c.gb, 2)}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr className="border-t-2 border-primary/30 bg-primary/5">
              <td className="py-2 pr-2" colSpan={6}>
                <div className="font-bold text-xs">Σ Netto-Upside</div>
                <div className="text-[9px] text-muted-foreground font-normal">(vor PoS-Gewichtung)</div>
              </td>
              <td className="py-2 pr-2 text-center font-mono tabular-nums font-bold text-emerald-500">
                {formatNumber(upsideCatalysts.reduce((s, c) => s + c.nettoUpside, 0), 2)}%
              </td>
              <td className="py-2 text-right">
                <div className="font-mono tabular-nums font-bold text-emerald-500 text-sm">+{formatNumber(totalGB, 2)}</div>
                <div className="text-[9px] text-muted-foreground font-normal">GB-Summe (nach PoS)</div>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="text-[9px] text-muted-foreground/60 mt-1 px-1">
          Σ Netto-Upside = Summe aller Katalysatoren vor PoS-Gewichtung (Zwischenwert, nicht Kursziel-Inkrement).
          GB-Summe = Σ positiver Beiträge (Netto-Upside × PoS%). Katalysatoren mit ▼ oder negativer Richtung zählen 0.
        </div>
      </div>

      {/* Catalyst-Adjusted Target */}
      {(() => {
        const catVsKurs = ((catalystAdjTarget / data.currentPrice - 1) * 100);
        const isBelowKurs = catalystAdjTarget < data.currentPrice;
        return (
          <>
            <div className={`rounded-lg border p-3 flex items-center justify-between ${
              isBelowKurs ? 'border-red-500/30 bg-red-500/5' : 'border-primary/30 bg-primary/5'
            }`}>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Catalyst-Adj. Target
                  {catalystBaseFallback && (
                    <span className="ml-1.5 text-amber-500 font-normal">(Basis: Analyst PT)</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  = {catalystBaseFallback ? 'Analyst PT' : bias.valuationBaseLabel} × (1 + positive GB {formatNumber(totalGB, 2)}%) · {bias.modeLabel}
                </div>
                {/* Analyst PT Upside vs. current price — shown when PT is the basis */}
                {catalystBaseFallback && data.analystPT?.median > 0 && (() => {
                  const ptUpside = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;
                  return (
                    <div className="text-[10px] text-muted-foreground">
                      = Analyst PT {formatCurrency(data.analystPT.median, 2, data.currency)}
                      <span className={`ml-1 font-medium ${ptUpside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ({ptUpside >= 0 ? '+' : ''}{formatNumber(ptUpside, 1)}% vs. Kurs)
                      </span>
                      {' '}× (1 + {formatNumber(totalGB, 2)}%) = {formatCurrency(catalystAdjTarget, 2, catalystCcy)}
                    </div>
                  );
                })()}
                {!catalystBaseFallback && (
                  <div className="text-[10px] text-muted-foreground">
                    = {formatCurrency(catalystDCFBase, 2, catalystCcy)} × (1 + {formatNumber(totalGB, 2)}%) = {formatCurrency(catalystAdjTarget, 2, catalystCcy)}
                  </div>
                )}
                <div className={`text-[10px] font-medium mt-0.5 ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                  vs. Kurs ({formatCurrency(data.currentPrice, 2, data.currency)}): {catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%
                  {isBelowKurs && ' — Target UNTER aktuellem Kurs'}
                </div>
                {/* Catalyst Upside auf aktuellen Kurs aufgerechnet — immer sichtbar */}
                {totalGB > 0 && (() => {
                  const kursPlus = data.currentPrice * (1 + totalGB / 100);
                  return (
                    <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border/40">
                      <span className="text-muted-foreground/70">Katalysatoren auf akt. Kurs:</span>
                      {' '}{formatCurrency(data.currentPrice, 2, data.currency)} × (1 + {formatNumber(totalGB, 2)}%)
                      {' '}= <span className="font-medium text-emerald-400">{formatCurrency(kursPlus, 2, data.currency)}</span>
                      <span className="ml-1 font-medium text-emerald-400">(+{formatNumber(totalGB, 2)}% nicht eingepreist)</span>
                    </div>
                  );
                })()}
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold font-mono tabular-nums ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                  {formatCurrency(catalystAdjTarget, 2, catalystCcy)}
                </div>
                <div className={`text-xs font-mono font-medium ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                  {catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%
                </div>
              </div>
            </div>
            {catalystBaseFallback && (
              <div className="text-[10px] text-amber-500 bg-amber-500/5 rounded-md p-2 border border-amber-500/20">
                ⚠ DCF-Basis zu niedrig ({formatCurrency(decisionBase, 2, dcfCcy)}), verwende Analyst PT Median als Basis
                {bias.switched ? ` · Unadjusted / Extrapolative ${formatCurrency(bias.unadjustedPerShare, 2, dcfCcy)}` : ""}
              </div>
            )}
          </>
        );
      })()}

      {/* Symmetric downside catalysts (Anti-bias) */}
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Downside-Katalysatoren (Anti-Bias Pflicht)</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <tbody>
              <tr className="border-b border-border/30">
                <td className="py-1.5 pr-2 font-mono text-muted-foreground">D1</td>
                <td className="py-1.5 pr-2 font-medium">Earnings Miss / Guidance Cut</td>
                <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">Next Quarter</td>
                <td className="py-1.5 pr-2 text-center font-mono text-amber-500">25%</td>
                <td className="py-1.5 text-right font-mono text-red-500 font-medium">-15%</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-1.5 pr-2 font-mono text-muted-foreground">D2</td>
                <td className="py-1.5 pr-2 font-medium">Macro Shock / Black Swan</td>
                <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">Any time</td>
                <td className="py-1.5 pr-2 text-center font-mono text-amber-500">15%</td>
                <td className="py-1.5 text-right font-mono text-red-500 font-medium">-25%</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-1.5 pr-2 font-mono text-muted-foreground">D3</td>
                <td className="py-1.5 pr-2 font-medium">Regulierung / Kartellverfahren</td>
                <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">12-24M</td>
                <td className="py-1.5 pr-2 text-center font-mono text-amber-500">20%</td>
                <td className="py-1.5 text-right font-mono text-red-500 font-medium">-20%</td>
              </tr>
            </tbody>
          </table>
        </div>
        {downsideCatalysts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <tbody>
                {downsideCatalysts.map((c, i) => (
                  <tr key={`down-${i}`} className="border-b border-border/30">
                    <td className="py-1.5 pr-2 font-mono text-muted-foreground">▼</td>
                    <td className="py-1.5 pr-2 font-medium">{catalystDisplayName(c)}</td>
                    <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">{c.timeline}</td>
                    <td className="py-1.5 pr-2 text-center font-mono text-amber-500">{c.pos}%</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-red-500">{formatSignedPct(c.bruttoUpside, 1)}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">GB Upside 0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ignoredEvents.length > 0 && (
          <div className="overflow-x-auto" data-testid="catalyst-events-ignored">
            <table className="w-full text-[10px] opacity-60">
              <tbody>
                {ignoredEvents.map((c, i) => (
                  <tr key={`ign-${i}`} className="border-b border-border/30">
                    <td className="py-1.5 pr-2 font-mono text-muted-foreground">▼</td>
                    <td className="py-1.5 pr-2 font-medium">{catalystDisplayName(c)}</td>
                    <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">{c.timeline}</td>
                    <td className="py-1.5 pr-2 text-center font-mono text-amber-500">{c.pos}%</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-red-500">{formatSignedPct(c.bruttoUpside, 1)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">nicht berücksichtigt (≤ {DOWNSIDE_EVENT_MIN_POS_EXCLUSIVE} %)</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => setIgnoredEvents(prev => prev.filter((_, j) => j !== i))}
                        className="px-1.5 py-0.5 rounded border border-border/50 text-foreground/60 hover:text-foreground"
                        aria-label={`Event „${c.name}“ entfernen`} data-testid={`button-catalyst-event-remove-${i}`}>✕ Entfernen</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
