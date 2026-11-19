import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  alignHypeSelection,
  isHypePayload,
  HYPE_SIGNAL_LABEL,
  HYPE_WEIGHTS,
  type HypeCyclePayload,
  type HypeSignal,
} from "@shared/hype-cycle";

/**
 * Proxy-Hype für die gerade geladene Wertschöpfungskette.
 * Abruf erst auf Knopfdruck, damit kein stiller FMP-Lauf startet.
 * Ein Auswahlwechsel verwirft die vorherige Antwort.
 */
export function HypeCyclePanel({
  tickers,
  selectionKey,
  selectionLabel,
}: {
  tickers: string[];
  selectionKey: string;
  selectionLabel: string;
}) {
  const gen = useRef(0);
  const [state, setState] = useState<{
    selection: string;
    body: HypeCyclePayload | null;
    error: string | null;
    loading: boolean;
  }>({ selection: selectionKey, body: null, error: null, loading: false });
  const aligned = alignHypeSelection(state, selectionKey);

  useEffect(() => {
    gen.current += 1;
    setState(prev => {
      const next = alignHypeSelection(prev, selectionKey);
      if (next === prev) return prev;
      return { ...next, loading: false };
    });
  }, [selectionKey]);

  async function load() {
    const my = ++gen.current;
    const sel = selectionKey;
    setState(prev => ({ ...alignHypeSelection(prev, sel), loading: true, error: null }));
    try {
      const res = await apiRequest("POST", "/api/valuechain/hype", { tickers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      if (my !== gen.current) return;
      if (!isHypePayload(json)) throw new Error("n/a — Antwort ohne Hype-Felder");
      setState({ selection: sel, body: json, error: null, loading: false });
    } catch (err: unknown) {
      if (my !== gen.current) return;
      const message = err instanceof Error && err.message ? err.message : "n/a — Hype-Abruf fehlgeschlagen";
      setState({ selection: sel, body: null, error: message, loading: false });
    }
  }

  const data = aligned.selection === selectionKey ? aligned.body : null;
  const error = aligned.selection === selectionKey ? aligned.error : null;

  return (
    <section className="mb-6 min-w-0 rounded-xl border border-white/10 bg-slate-900/40 p-4" data-testid="hype-cycle-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Proxy-Hype-Cycle</h2>
        <button
          type="button"
          onClick={load}
          disabled={state.loading || tickers.length === 0}
          className="min-h-9 rounded border border-cyan-500/40 px-2 text-[11px] text-cyan-200 disabled:opacity-40 sm:min-h-7"
          data-testid="button-hype-load"
        >
          {state.loading ? "Lädt…" : "Hype aus FMP-Historie"}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        FMP-Proxy, kein Gartner-Datensatz. KGV gegen den eigenen 5-Jahres-Median ({HYPE_WEIGHTS.valuationVsHistory}), Capex-Intensität ({HYPE_WEIGHTS.capexMaterial}), EPS-Revision ({HYPE_WEIGHTS.analystRevisions}). Suchvolumen wird nicht abgefragt. News, Guidance und Narrativ bleiben n/a und zählen nicht als 0. Teil-z ist kein Aktien-Score.
      </p>
      <p className="mt-1 text-[11px] text-slate-300" data-testid="hype-selection">
        Auswahl: {selectionLabel} · {tickers.length === 0 ? "keine Firmen" : tickers.join(", ")}
      </p>
      {tickers.length === 0 && <p className="mt-2 text-[11px] text-slate-400">n/a — keine Firmen in der Kette</p>}
      {error && <p className="mt-2 text-[11px] text-amber-300" data-testid="hype-error">{error}</p>}
      {data && <HypeCycleResult data={data} />}
    </section>
  );
}

export function HypeCycleResult({ data }: { data: HypeCyclePayload }) {
  return (
    <div className="mt-3 space-y-3" data-testid="hype-result">
      {data.notes.map(n => <p key={n} className="text-[10px] text-slate-400">{n}</p>)}
      {data.gartnerDataset === false && (
        <p className="text-[10px] text-slate-500">Quelle der Phase: FMP-Proxy (Quartile der geladenen Auswahl), nicht Gartner.</p>
      )}
      {data.companies.map(c => (
        <article key={c.ticker} className="border-t border-white/5 pt-2" data-testid={`hype-row-${c.ticker}`}>
          <h3 className="font-mono text-[12px] text-slate-100">{c.ticker}</h3>
          <p className="text-[11px] text-slate-300">Proxy-Phase: {c.phaseReason}</p>
          <p className="text-[11px] text-slate-400">
            Teil-z (kein Aktien-Score): {c.compositeZ == null ? "n/a" : c.compositeZ.toFixed(2)} · Gewicht vorhanden: {c.weightUsed.toFixed(2)}
          </p>
          {c.dataNotes.map(n => <p key={n} className="text-[10px] text-amber-300/90">{n}</p>)}
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[11px] text-slate-200">
              <thead>
                <tr className="text-slate-400">
                  <th className="py-1 pr-2 font-medium">Signal</th>
                  <th className="py-1 pr-2 font-medium">Wert</th>
                  <th className="py-1 pr-2 font-medium">Coverage</th>
                  <th className="py-1 pr-2 font-medium">Stichtag</th>
                  <th className="py-1 font-medium">Quelle</th>
                </tr>
              </thead>
              <tbody>
                {c.signals.map(s => (
                  <tr key={s.id} className="border-t border-white/5" data-testid={`hype-signal-${c.ticker}-${s.id}`}>
                    <td className="py-1 pr-2">{HYPE_SIGNAL_LABEL[s.id]}</td>
                    <td className="py-1 pr-2 font-mono">{signalValue(s)}</td>
                    <td className="py-1 pr-2 font-mono" data-testid={`hype-coverage-${c.ticker}-${s.id}`}>{coverageText(s)}</td>
                    <td className="py-1 pr-2 font-mono">{s.asOf ?? s.asOfReason ?? "n/a"}</td>
                    <td className="py-1 text-slate-400">{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}

function signalValue(s: HypeSignal): string {
  if (s.gap == null) return s.reason ?? "n/a";
  const pct = `${s.gap > 0 ? "+" : ""}${(s.gap * 100).toFixed(1)} %`;
  return s.reason ? `${pct} · ${s.reason}` : pct;
}

function coverageText(s: HypeSignal): string {
  if (s.coverage.required == null) return "n/a";
  return `${s.coverage.available}/${s.coverage.required}`;
}
