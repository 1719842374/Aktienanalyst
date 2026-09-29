import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, FlaskConical, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { InfoCurvePlot } from "@/components/thesislab/InfoCurvePlot";
import { AMPEL_LABEL, type Ampel, type ThesisFeedResponse, type ThesisLabResult } from "@/lib/thesisLabTypes";

const STAGE_LABEL: Record<string, string> = {
  memory: "Memory / HBM",
  agent_runtime: "Agent Runtime / SaaS",
  process_lockin: "Process Lock-in / VAT",
  physical_motion: "Physical Motion / Strain-Wave",
  farm_os: "Farm-OS",
  agent_liability: "Agenten-Haftpflicht",
  unmapped: "Nicht zugeordnet",
};

const AMPEL_CLASS: Record<Ampel, string> = {
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40",
  yellow: "bg-amber-400/15 text-amber-200 ring-amber-400/40",
  red: "bg-rose-500/15 text-rose-300 ring-rose-400/40",
  gray: "bg-slate-500/20 text-slate-300 ring-slate-400/30",
};

interface LabFilters {
  ticker: string;
  stage: string;
  ampel: "" | Ampel;
  q: string;
}

function parseFilters(search: string): LabFilters {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const ampel = params.get("ampel");
  return {
    ticker: params.get("ticker") ?? "",
    stage: params.get("stage") ?? "",
    ampel: ampel === "green" || ampel === "yellow" || ampel === "red" || ampel === "gray" ? ampel : "",
    q: params.get("q") ?? "",
  };
}

/** Keep the query inside the hash (`#/lab?ticker=`) and clear location.search. */
function replaceHash(path: string, filters: LabFilters) {
  const params = new URLSearchParams();
  if (filters.ticker.trim()) params.set("ticker", filters.ticker.trim());
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.ampel) params.set("ampel", filters.ampel);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  const qs = params.toString();
  const url = new URL(window.location.href);
  url.hash = qs ? `${path}?${qs}` : path;
  url.search = "";
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === next) return;
  history.pushState(null, "", next);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function pct(n: number, digits = 1): string {
  return `${n.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

export default function ThesisLabDashboard() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const filters = useMemo(() => parseFilters(search), [search]);
  const [form, setForm] = useState<LabFilters>(filters);
  const [items, setItems] = useState<ThesisLabResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evaluated, setEvaluated] = useState<ThesisLabResult | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(filters);
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.ampel) params.set("ampel", filters.ampel);
      if (filters.stage) params.set("stage", filters.stage);
      if (filters.q.trim()) params.set("q", filters.q.trim());
      const qs = params.toString();
      const res = await apiRequest("GET", `/api/lab/theses${qs ? `?${qs}` : ""}`);
      const body = (await res.json().catch(() => ({}))) as Partial<ThesisFeedResponse> & { error?: string };
      if (!res.ok) throw new Error(body.error || `${res.status}`);
      let next = body.items ?? [];
      if (filters.ticker.trim()) {
        const lookupRes = await apiRequest("GET", `/api/lab/lookup?ticker=${encodeURIComponent(filters.ticker.trim())}`);
        const lookup = (await lookupRes.json().catch(() => ({}))) as { items?: ThesisLabResult[]; error?: string };
        if (!lookupRes.ok) throw new Error(lookup.error || `${lookupRes.status}`);
        const ids = new Set((lookup.items ?? []).map((item) => item.id));
        next = next.filter((item) => ids.has(item.id));
      }
      setItems(next);
      setSelectedId((current) => (current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null));
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = evaluated && evaluated.id === selectedId
    ? evaluated
    : items.find((item) => item.id === selectedId) ?? null;

  async function onEvaluate(event: FormEvent) {
    event.preventDefault();
    const thesis = draft.trim();
    if (thesis.length < 8) {
      setError("These ist zu kurz (mindestens 8 Zeichen).");
      return;
    }
    setEvaluating(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/lab/thesis", { thesis });
      const body = (await res.json().catch(() => ({}))) as ThesisLabResult & { error?: string };
      if (!res.ok) throw new Error(body.error || `${res.status}`);
      setEvaluated(body);
      setSelectedId(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0a0e17] text-slate-100">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/80 to-slate-900/30 px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                title="Zurück zur Startseite"
                data-testid="button-back-to-dashboard"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/30">
                <FlaskConical className="h-5 w-5 text-cyan-300" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white md:text-xl">Thesis Lab</h1>
                <p className="text-xs text-slate-400 md:text-sm">Informationskurve, Ampel und Value-Chain-Lookup — ohne Analyze-Lauf</p>
              </div>
            </div>
          </header>

          <form
            className="flex flex-wrap items-end gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              replaceHash("/lab", form);
            }}
          >
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              Ticker
              <input
                value={form.ticker}
                onChange={(event) => setForm((prev) => ({ ...prev, ticker: event.target.value }))}
                className="w-28 rounded-md border border-white/10 bg-slate-800/80 px-2 py-1.5 text-sm normal-case tracking-normal text-white"
                data-testid="input-ticker"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              Stufe
              <select
                value={form.stage}
                onChange={(event) => setForm((prev) => ({ ...prev, stage: event.target.value }))}
                className="rounded-md border border-white/10 bg-slate-800/80 px-2 py-1.5 text-sm normal-case tracking-normal text-white"
                data-testid="select-stage"
              >
                <option value="">Alle</option>
                {Object.entries(STAGE_LABEL).filter(([key]) => key !== "unmapped").map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              Ampel
              <select
                value={form.ampel}
                onChange={(event) => setForm((prev) => ({ ...prev, ampel: event.target.value as LabFilters["ampel"] }))}
                className="rounded-md border border-white/10 bg-slate-800/80 px-2 py-1.5 text-sm normal-case tracking-normal text-white"
                data-testid="select-ampel"
              >
                <option value="">Alle</option>
                {(Object.keys(AMPEL_LABEL) as Ampel[]).map((key) => (
                  <option key={key} value={key}>{AMPEL_LABEL[key]}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              Suche
              <input
                value={form.q}
                onChange={(event) => setForm((prev) => ({ ...prev, q: event.target.value }))}
                className="rounded-md border border-white/10 bg-slate-800/80 px-2 py-1.5 text-sm normal-case tracking-normal text-white"
                data-testid="input-q"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-white/10 bg-slate-800/80 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
              data-testid="button-apply-filters"
            >
              Filtern
            </button>
          </form>

          {error && (
            <div className="rounded-md border border-rose-800/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-300" data-testid="lab-error">
              {error}
            </div>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <section className="rounded-2xl border border-white/5 bg-slate-900/40" data-testid="thesis-list">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 text-xs text-slate-400">
                <span>Fixtures</span>
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Lade Thesen" />}
              </div>
              <ul className="divide-y divide-white/5">
                {items.map((item) => {
                  const active = item.id === selected?.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setEvaluated(null);
                          setSelectedId(item.id);
                        }}
                        className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-white/[0.03] ${active ? "bg-cyan-500/10" : ""}`}
                        data-testid={`thesis-item-${item.id}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${AMPEL_CLASS[item.infoCurve]}`} data-testid={`ampel-${item.id}`}>
                            {AMPEL_LABEL[item.infoCurve]}
                          </span>
                          <span className="text-xs tabular-nums text-slate-300">{pct(item.pricedInPct, 0)}</span>
                        </span>
                        <span className="text-sm text-slate-100">{STAGE_LABEL[item.valueChainStage] ?? item.valueChainStage}</span>
                        <span className="line-clamp-2 text-xs text-slate-400">{item.thesis}</span>
                      </button>
                    </li>
                  );
                })}
                {!loading && items.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-slate-400">Keine These für diese Filter.</li>
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 md:p-5" data-testid="thesis-detail">
              {!selected && <p className="text-sm text-slate-400">These aus der Liste wählen.</p>}
              {selected && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ${AMPEL_CLASS[selected.infoCurve]}`} data-testid="ampel">
                      {AMPEL_LABEL[selected.infoCurve]}
                    </span>
                    <span className="text-xs text-slate-400">{STAGE_LABEL[selected.valueChainStage] ?? selected.valueChainStage}</span>
                    <span className="text-xs text-slate-500">Stand {selected.asOf}</span>
                  </div>
                  <h2 className="text-base font-medium leading-snug text-white">{selected.thesis}</h2>
                  <p className="text-sm leading-relaxed text-slate-300" data-testid="counter-thesis">
                    {selected.counterThesis.trim()
                      ? selected.counterThesis
                      : "Keine Gegenthese — Ampel bleibt auf Datenlücke."}
                  </p>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="PoS" value={selected.pos.toLocaleString("de-DE", { maximumFractionDigits: 2 })} />
                    <Metric label="Brutto" value={pct(selected.grossUpsidePct)} />
                    <Metric label="Netto" value={pct(selected.netUpsidePct)} />
                    <Metric label="GB" value={pct(selected.gbPct)} />
                    <Metric label="Einpreisung" value={pct(selected.pricedInPct)} />
                    <Metric label="Layer" value={String(selected.techLayer)} />
                    <Metric label="Coverage" value={pct(selected.cyclePhaseFit, 0)} />
                    <Metric label="Daten" value={selected.dataQuality} />
                  </dl>
                  <InfoCurvePlot points={selected.curvePoints} ampel={selected.infoCurve} />
                  <div className="flex flex-wrap gap-2">
                    {selected.tickers.map((ticker) => (
                      <span key={ticker.symbol} className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-slate-800/70 px-2 py-1 text-xs">
                        <a href={`#/?ticker=${encodeURIComponent(ticker.symbol)}`} className="text-cyan-300 hover:underline" data-testid={`link-analyze-${ticker.symbol}`}>
                          {ticker.symbol}
                        </a>
                        <span className="text-slate-500">{ticker.role}</span>
                        <a href={`#/lab?ticker=${encodeURIComponent(ticker.symbol)}`} className="text-slate-400 hover:text-white" data-testid={`link-lab-${ticker.symbol}`}>
                          Lab
                        </a>
                      </span>
                    ))}
                    {selected.industryKey && selected.industryKey !== "unmapped" && (
                      <a
                        href={`#/valuechain?industry=${encodeURIComponent(selected.industryKey)}`}
                        className="inline-flex items-center rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
                        data-testid="link-valuechain"
                      >
                        Value Chain · {selected.industryKey}
                      </a>
                    )}
                  </div>
                  {selected.sources.length > 0 && (
                    <p className="text-[11px] text-slate-500">{selected.sources.join(" · ")}</p>
                  )}
                </div>
              )}

              <form onSubmit={onEvaluate} className="mt-6 border-t border-white/5 pt-4">
                <label className="mb-2 block text-[10px] uppercase tracking-wide text-slate-500" htmlFor="lab-freetext">
                  Freitext prüfen (deterministisch, kein LLM)
                </label>
                <textarea
                  id="lab-freetext"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  data-testid="input-freetext"
                />
                <button
                  type="submit"
                  disabled={evaluating}
                  className="mt-2 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                  data-testid="button-evaluate"
                >
                  {evaluating ? "Prüfe…" : "These bewerten"}
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm tabular-nums text-slate-100">{value}</dd>
    </div>
  );
}
