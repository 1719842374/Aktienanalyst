import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SectionCard } from "@/components/SectionCard";
import { apiRequest } from "@/lib/queryClient";
import { usePublishChatSection } from "@/lib/chatSectionData";
import type { EuropeFallbackSlot } from "@shared/europe-macro-fallbacks";
import type { MacroAdaptiveLayer } from "@shared/macro-adaptive-layer";
import { EUROPE_MACRO_PARAMS } from "@shared/europe-macro-fallbacks";
import { HYPERSCALER_CAPEX_PARAMS } from "@shared/hyperscaler-capex";
import type { DistributionReading } from "@shared/adaptive-window";

/**
 * F9-18 auf /recession. Der Knopf lädt F9-08 und F9-14.
 * Kein Abruf beim Seitenladen. scoreSwitch bleibt aus. Kein Score.
 */
function deNum(value: number, digits: number): string {
  const sign = value < 0 ? "−" : "";
  return sign + Math.abs(value).toFixed(digits).replace(".", ",");
}

function deDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function signedPct(value: number): string {
  const body = `${deNum(value, 1)} %`;
  return value > 0 ? `+${body}` : body;
}

function distText(distribution: DistributionReading): string {
  if (!distribution.available) return distribution.reason;
  return `Perzentil ${deNum(distribution.percentile, 1)} % · z ${deNum(distribution.z, 2)} · Median ${deNum(distribution.median, 2)} · ab ${distribution.windowStart}`;
}

function isLayer(value: unknown): value is MacroAdaptiveLayer {
  if (!value || typeof value !== "object") return false;
  const layer = value as MacroAdaptiveLayer;
  return layer.scoreSwitch === "aus" && layer.liveScoreUnchanged === true && !!layer.hyperscalerCapex && !!layer.europe?.slots;
}

function slotTitle(id: EuropeFallbackSlot["id"]): string {
  switch (id) {
    case "surprise":
      return "Überraschungsquote";
    case "equalWeight":
      return "Equal-Weight";
    case "capex":
      return "CAPEX-Ersatz";
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

export function MacroAdaptiveLayerBody({ view }: { view: MacroAdaptiveLayer }) {
  const capex = view.hyperscalerCapex;
  return (
    <div className="space-y-3" data-testid="macro-adaptive-layer-body">
      <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="macro-layer-switch">
        Score-Schalter {view.scoreSwitch}. Die Live-P und die Aktien-Ratings bleiben unverändert.
      </p>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0" data-testid="macro-layer-hyperscaler">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hyperscaler-CAPEX, YoY</div>
        <div className="text-sm font-semibold tabular-nums text-foreground break-words">
          {capex.aggregate.available ? signedPct(capex.aggregate.yoyPct) : capex.aggregate.reason}
        </div>
        <div className="text-[11px] text-muted-foreground break-words">
          {capex.aggregate.available
            ? `Stand ${capex.aggregate.quarter} · ${HYPERSCALER_CAPEX_PARAMS.windowYears} Jahre · ${distText(capex.distribution)}`
            : "n/a"}
        </div>
        {capex.aggregate.available && capex.aggregate.incompleteReason && (
          <div className="text-[11px] text-muted-foreground break-words" data-testid="macro-layer-hyperscaler-gap">
            {capex.aggregate.incompleteReason}
          </div>
        )}
        <ul className="mt-2 space-y-1">
          {capex.names.map(name => (
            <li key={name.symbol} className="text-[11px] text-foreground break-words" data-testid={`macro-layer-name-${name.symbol}`}>
              <span className="font-medium">{name.symbol}</span>
              <span className="text-muted-foreground">
                {name.yoyPct == null || name.quarter == null
                  ? ` · ${name.reason ?? "n/a"}`
                  : ` · ${name.quarter} · ${signedPct(name.yoyPct)}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-muted-foreground break-words">{capex.formula}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {view.europe.slots.map(slot => (
          <SlotCard key={slot.id} slot={slot} />
        ))}
      </div>
    </div>
  );
}

function SlotCard({ slot }: { slot: EuropeFallbackSlot }) {
  const title = slotTitle(slot.id);
  if (slot.id === "surprise") {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0" data-testid="macro-layer-surprise">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-sm font-semibold text-foreground break-words">{slot.reason}</div>
        <div className="text-[11px] text-muted-foreground">braucht Philip · kein Ersatz aus FRED oder Yahoo</div>
      </div>
    );
  }
  if (slot.id === "equalWeight") {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0" data-testid="macro-layer-equal">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-sm font-semibold tabular-nums text-foreground break-words">
          {slot.spread.available ? deNum(slot.spread.spread, 3) : slot.spread.reason}
        </div>
        <div className="text-[11px] text-muted-foreground break-words">
          {slot.spread.available
            ? `Stand ${deDate(slot.spread.date)} · ${slot.capSymbol} ${deNum(slot.spread.capRsl, 3)} − ${slot.equalSymbol} ${deNum(slot.spread.equalRsl, 3)} · ${distText(slot.distribution)}`
            : "n/a"}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground break-words">{slot.prior}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0" data-testid="macro-layer-gfcf">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="text-sm font-semibold tabular-nums text-foreground break-words">
        {slot.yoy.available ? signedPct(slot.yoy.yoyPct) : slot.yoy.reason}
      </div>
      <div className="text-[11px] text-muted-foreground break-words">
        {slot.yoy.available
          ? `Stand ${slot.yoy.quarter} · ${EUROPE_MACRO_PARAMS.windowYears} Jahre · ${distText(slot.distribution)}`
          : "n/a"}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground break-words">{slot.note}</p>
    </div>
  );
}

export function MacroAdaptiveLayerCard({ number }: { number: number }) {
  const [view, setView] = useState<MacroAdaptiveLayer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (): Promise<MacroAdaptiveLayer> => {
      const response = await apiRequest("POST", "/api/macro/adaptive-layer", {});
      if (!response.ok) throw new Error(`n/a — Schicht nicht erreichbar (${response.status})`);
      const body: unknown = await response.json();
      if (!isLayer(body)) throw new Error("n/a — Antwort der Makro-Schicht unvollständig");
      return body;
    },
    onSuccess: result => {
      setFailure(null);
      setView(result);
    },
    onError: (err: unknown) => {
      setView(null);
      setFailure(err instanceof Error ? err.message : "n/a — Schicht nicht erreichbar");
    },
  });

  const capex = view?.hyperscalerCapex.aggregate;
  const equal = view?.europe.slots[1];
  const gfcf = view?.europe.slots[2];
  usePublishChatSection("recession", "makroSchicht", view ? {
    scoreSchalter: view.scoreSwitch,
    hyperscalerYoyPct: capex?.available ? Math.round(capex.yoyPct * 10) / 10 : null,
    hyperscalerQuartal: capex?.available ? capex.quarter : null,
    equalWeightSpanne: equal?.spread.available ? Math.round(equal.spread.spread * 1000) / 1000 : null,
    gfcfYoyPct: gfcf?.yoy.available ? Math.round(gfcf.yoy.yoyPct * 10) / 10 : null,
    surprise: view.europe.slots[0].reason,
  } : null);

  return (
    <SectionCard
      number={number}
      title="Makro-Schicht"
      subtitle="Hyperscaler-CAPEX und Europa-Ersatz · nur nach dem Knopf, kein Score"
    >
      <div className="space-y-3" data-testid="macro-adaptive-layer">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid="macro-layer-analyze"
          className="w-full sm:w-auto px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors disabled:opacity-60"
        >
          {mutation.isPending ? "Schicht wird geladen …" : "Schicht analysieren"}
        </button>
        {!view && !failure && !mutation.isPending && (
          <p className="text-sm text-muted-foreground break-words" data-testid="macro-layer-idle">
            n/a — noch nicht analysiert. Der Knopf lädt die Hyperscaler-CAPEX und die Europa-Ersatzdaten.
          </p>
        )}
        {failure && (
          <p className="text-sm text-foreground break-words" role="status" data-testid="macro-layer-error">{failure}</p>
        )}
        {view && <MacroAdaptiveLayerBody view={view} />}
      </div>
    </SectionCard>
  );
}
