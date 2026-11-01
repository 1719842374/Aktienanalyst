/**
 * Future_7 §6 / Future_8: z-Score und Perzentil neben den festen Zonen.
 * Der Live-Score bleibt. Fehlende Reihen: „n/a — Grund“, nie 0.
 * Daten: useRecessionAdaptive → queryClient → GET /api/analyze-recession/adaptive.
 */
import { adaptiveNaText, type AdaptiveIndicator, type AdaptiveReading } from "@shared/recession-adaptive";
import { useRecessionAdaptive } from "@/hooks/useRecessionAdaptive";

function deNum(value: number, digits: number): string {
  const sign = value < 0 ? "−" : "";
  return sign + Math.abs(value).toFixed(digits).replace(".", ",");
}

function deDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function gatewayErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = /^(\d+)/.exec(message)?.[1];
  return status
    ? `n/a — Datenquelle nicht erreichbar (HTTP ${status})`
    : "n/a — Datenquelle nicht erreichbar";
}

function bandLabel(score: number): string {
  if (score >= 4) return "oberes Band";
  if (score >= 2) return "erhöht";
  if (score === 0) return "mittleres Band";
  if (score <= -4) return "unteres Band";
  return "niedrig";
}

function ReadingBody({ reading }: { reading: AdaptiveReading }) {
  if (!reading.available) {
    return <p className="text-[11px] leading-snug text-muted-foreground break-words">{adaptiveNaText(reading.reason)}</p>;
  }
  return (
    <div className="space-y-1 text-[11px] leading-snug">
      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {deNum(reading.value, 1)}
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">Stand {deDate(reading.asOf)}</span>
      </p>
      <p className="text-muted-foreground break-words">
        Median {deNum(reading.median, 1)} · Mittel {deNum(reading.mean, 1)} · σ {deNum(reading.std, 1)}
        {" · "}Abstand zum Median {deNum(reading.deviationFromMedian, 1)}
      </p>
      <p className="text-foreground break-words">
        z {deNum(reading.z, 2)} · z×1,5 {deNum(reading.zScoreScaled, 2)} · normiert {deNum(reading.normalizedScore, 2)}
      </p>
      <p className="text-foreground break-words" data-testid="adaptive-percentile-line">
        Perzentil {deNum(reading.percentile, 1)} · Perzentil-Score {deNum(reading.percentileScore, 0)} ({bandLabel(reading.percentileScore)})
      </p>
      <p className="text-muted-foreground">
        {reading.observations} Beobachtungen ab {deDate(reading.windowStart)}, {reading.windowYears} Jahre
      </p>
    </div>
  );
}

function IndicatorCard({ indicator }: { indicator: AdaptiveIndicator }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-2" data-testid={`adaptive-card-${indicator.id}`}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-xs font-semibold">{indicator.name}</span>
        <span className="text-[9px] text-muted-foreground">{indicator.role === "fest" ? "fest" : `${indicator.windowYears} Jahre`}</span>
      </div>
      {indicator.role === "fest" ? (
        <p className="text-[11px] leading-snug text-muted-foreground break-words" data-testid={`adaptive-fixed-${indicator.id}`}>
          fest — {indicator.fixedNote}
        </p>
      ) : indicator.reading ? (
        <ReadingBody reading={indicator.reading} />
      ) : (
        <p className="text-[11px] text-muted-foreground">n/a — keine Berechnung</p>
      )}
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground break-words">{indicator.source}</p>
    </div>
  );
}

export function RecessionAdaptiveCard() {
  const query = useRecessionAdaptive();
  const report = query.data?.adaptiv;

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3" data-testid="recession-adaptive">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Adaptive Schwellen (z-Score und Perzentil)</span>
        <span className="text-[9px] text-muted-foreground">nur Anzeige, kein Score</span>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground break-words">
        Die festen Zonen oben bleiben der Rezessions-Score. Diese Karte fließt nicht in Netto, Max oder die Wahrscheinlichkeiten ein.
      </p>
      {query.isLoading ? (
        <p className="text-[11px] text-muted-foreground" data-testid="adaptive-loading">wird geladen …</p>
      ) : query.isError ? (
        <p className="text-[11px] leading-snug text-muted-foreground break-words" role="status" data-testid="adaptive-error">
          {gatewayErrorText(query.error)}
        </p>
      ) : !report ? (
        <p className="text-[11px] text-muted-foreground" role="status" data-testid="adaptive-error">n/a — keine Daten</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="adaptive-grid">
            {report.indicators.map(indicator => <IndicatorCard key={indicator.id} indicator={indicator} />)}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground break-words">{report.note} {report.peerNote}</p>
        </>
      )}
    </div>
  );
}
