/**
 * Anzeige der Podcast-Probe. Fehlendes bleibt „n/a — Grund“.
 * Der Block bricht um, damit 375 und 1440 nicht seitlich überlaufen.
 */
import React from "react";
import type { PodcastProbeResult } from "../../../../server/podcast-pipeline";

export const PODCAST_REQUEST_TIMEOUT_MS = 120_000;

function showValue(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) return "n/a — kein Zahlenwert";
  const text = String(Math.round(value * 1000) / 1000);
  return unit ? `${text} ${unit}` : text;
}

function driverValueLine(driver: { value: number; unit: string | null; asOf: string; source: string; reading?: "yoy" }): string {
  const shown = showValue(driver.value, driver.unit);
  if (driver.reading === "yoy") return `YoY: ${shown} · Stand ${driver.asOf} · Quelle: ${driver.source}`;
  return `Quelle: ${driver.source} · Wert: ${shown} · Stand ${driver.asOf}`;
}

export function PodcastProbePanel({
  viewportWidth,
  state,
}: {
  viewportWidth?: number;
  state: {
    phase: "idle" | "loading" | "done" | "error";
    result?: PodcastProbeResult | null;
    error?: string | null;
  };
}) {
  const result = state.result;
  return (
    <section
      data-testid="podcast-probe"
      data-viewport={viewportWidth ?? ""}
      className="max-w-full min-w-0 overflow-x-hidden break-words rounded-lg border border-border bg-card text-foreground p-3 space-y-3"
    >
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-foreground">Key-Driver-Podcast</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border">
          KI-generiert im Research-Stil
        </span>
      </div>

      {state.phase === "loading" && (
        <p className="text-[12px] text-foreground" data-testid="podcast-progress">
          Quellen, Ranking und Skript …
        </p>
      )}
      {state.phase === "error" && (
        <p className="text-[12px] text-destructive break-words">{state.error || "n/a — Podcast-Abruf fehlgeschlagen"}</p>
      )}

      {result && (
        <div className="space-y-3 min-w-0">
          <ol className="space-y-1" data-testid="podcast-progress">
            {result.progress.map(step => (
              <li key={step.step} className="text-[11px] text-foreground break-words">
                {step.step}: {step.detail?.startsWith("n/a") ? step.detail : `${step.status}${step.detail ? ` — ${step.detail}` : ""}`}
              </li>
            ))}
          </ol>

          <div data-testid="podcast-drivers" className="space-y-2">
            {result.drivers.map(driver => (
              <article key={driver.id} className="rounded border border-border bg-background p-2 min-w-0">
                <div className="text-[12px] font-semibold text-foreground break-words">
                  {driver.rank}. {driver.label}
                </div>
                <p className="text-[11px] text-foreground break-words">
                  {driverValueLine(driver)}
                </p>
                <p className="text-[11px] text-foreground break-words">{driver.reason}</p>
              </article>
            ))}
            {!result.drivers.length && (
              <p className="text-[11px] text-foreground">n/a — kein Treiber aus der eigenen Historie</p>
            )}
          </div>

          <div data-testid="podcast-gaps" className="space-y-1">
            {result.gaps.map((gap, index) => (
              <p key={`${gap.channel}-${gap.label}-${index}`} className="text-[11px] text-foreground break-words">
                {gap.label}: {gap.status}
              </p>
            ))}
          </div>

          {result.notes.length > 0 && (
            <div className="space-y-1">
              {result.notes.map((note, index) => (
                <p key={`${note.channel}-${index}`} className="text-[11px] text-foreground break-words">
                  {note.channel}: {note.text}
                </p>
              ))}
            </div>
          )}

          <div data-testid="podcast-script" className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-foreground">Skript</div>
            {result.script ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground break-words">{result.script.title}</p>
                <p className="text-[12px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                  {result.script.spokenScript}
                </p>
              </div>
            ) : (
              <p className="text-[12px] text-foreground break-words">{result.scriptStatus}</p>
            )}
          </div>

          <p className="text-[11px] text-foreground break-words" data-testid="podcast-audio">
            Audio: {result.audio.reason}
          </p>
        </div>
      )}
    </section>
  );
}
