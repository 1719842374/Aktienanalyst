import {
  HYSTERESIS_BARS,
  WHIPSAW_LOOKBACK_YEARS,
  crossDelayTooltip,
  crossTone,
  hitsLabel,
  stateLabel,
  type CrossEvent,
  type CrossView,
} from "@/lib/taCrossConfirmation";

const KIND: Record<CrossEvent["type"], string> = {
  golden: "GOLDEN CROSS",
  death: "DEATH CROSS",
};

/**
 * Gemeinsames Banner für Aktien-TA und BTC. Farbe nur bei bestätigtem Cross.
 * PENDING, verfallen und Fehlsignal bleiben neutral.
 */
export function CrossStatusBanner({ view, emptyNote }: { view: CrossView; emptyNote?: string | null }) {
  const event = view.latest;
  if (!event) {
    if (!emptyNote) return null;
    return (
      <div className="rounded-lg p-3 mb-3 border bg-muted/30 border-border text-xs text-muted-foreground" data-testid="cross-banner" data-state="none">
        {emptyNote}
      </div>
    );
  }
  const tone = crossTone(event);
  const box = tone === "positive"
    ? "bg-emerald-500/10 border-emerald-500/30"
    : tone === "negative"
      ? "bg-red-500/10 border-red-500/30"
      : "bg-muted/40 border-border";
  const ink = tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-red-500" : "text-foreground";
  const kind = KIND[event.type];
  const delay = crossDelayTooltip();
  return (
    <div
      className={`rounded-lg p-3 mb-3 border flex items-start gap-3 ${box}`}
      data-testid="cross-banner"
      data-state={event.state}
      data-tone={tone}
      data-hits={String(event.hits)}
      data-age-bars={String(event.ageBars)}
      title={delay}
    >
      <div className={`text-2xl font-bold leading-none ${ink}`}>{tone === "positive" ? "✦" : tone === "negative" ? "✕" : "•"}</div>
      <div className="min-w-0">
        <div className={`text-sm font-bold ${ink}`}>
          {kind}
          <span className="text-xs font-normal text-muted-foreground ml-1.5">
            {stateLabel(event.state)} · {hitsLabel(event.hits)} · vor {event.ageBars} Handelstagen
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Ereignis {event.date} (erste Kerze der {HYSTERESIS_BARS}-Tage-Folge). Whipsaw {view.whipsaw.w}/{view.whipsaw.n} über {WHIPSAW_LOOKBACK_YEARS} Jahre.
          {event.counterDate ? ` Gegen-Event ${event.counterDate}.` : ""}
        </div>
        <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
          {event.criteria.map(item => (
            <li key={item.id}>
              {item.met === true ? "ja" : item.met === false ? "nein" : "n/a"}
              {" · "}
              {item.label}
              {item.preisbasiert ? " · preisbasiert" : ""}
              {" · "}
              {item.detail}
            </li>
          ))}
        </ul>
        <div className="text-[10px] text-muted-foreground mt-1">{delay}</div>
      </div>
    </div>
  );
}
