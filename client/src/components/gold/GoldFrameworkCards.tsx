/**
 * F10-22, F10-33, F10-34 und die offenen Philip-Punkte Gold-GIS / QE/QT.
 * Jede Karte lädt über useQuery (Default-Fetcher in queryClient) eine eigene Route.
 * Keine Karte schreibt in den GIS.
 */
import React, { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GoldMineSupplyResponse } from "@shared/gold-mine-supply";
import type { GoldMaBacktestResponse, GoldMaBacktestSide } from "@shared/gold-ma-backtest";
import { GOLD_CB_STANCE_LABEL, type GoldCentralBankResponse } from "@shared/gold-central-bank";
import { PHILIP_PENDING_TEXT, type GoldPhilipPendingResponse } from "@shared/gold-philip-pending";

function gatewayErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = /^(\d+)/.exec(message)?.[1];
  return status
    ? `n/a — Datenquelle nicht erreichbar (HTTP ${status})`
    : "n/a — Datenquelle nicht erreichbar";
}

function formatSignedPct(fraction: number | null, digits = 2): string {
  if (fraction == null || !Number.isFinite(fraction)) return "n/a";
  const pct = fraction * 100;
  const text = pct.toFixed(digits).replace(".", ",");
  return pct > 0 ? `+${text} %` : `${text} %`;
}

function formatPercentPoints(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1).replace(".", ",")} %`;
}

function formatKoz(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} koz`;
}

function formatDays(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value)} Tage`;
}

function CardShell({ testId, title, children }: { testId: string; title: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden min-w-0 max-w-full" data-testid={testId} data-layout="fluid">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground tracking-tight break-words">{title}</h2>
          <span className="text-[10px] text-muted-foreground ml-auto">nur Anzeige, kein Score</span>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2 min-w-0">{children}</div>
    </div>
  );
}

function LoadingOrError({ loading, error, empty }: { loading: boolean; error: unknown; empty: string }) {
  if (loading) return <p className="text-[11px] text-muted-foreground">wird geladen …</p>;
  if (error) return <p className="text-[11px] text-muted-foreground break-words" data-testid="gold-framework-error">{gatewayErrorText(error)}</p>;
  return <p className="text-[11px] text-muted-foreground break-words">{empty}</p>;
}

export function GoldMineSupplyBody({ data }: { data: GoldMineSupplyResponse }) {
  return (
    <CardShell testId="gold-mine-supply" title="Angebotsreaktion (Minenproduktion)">
      {!data.available ? (
        <p className="text-[11px] text-muted-foreground break-words" data-testid="gold-mine-supply-na">{data.reason}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground break-words" data-testid="gold-mine-supply-quarter">
            Letztes belegtes Quartal {data.quarter}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-0">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 font-medium">Produzent</th>
                  <th className="text-right py-1.5 font-medium">Menge</th>
                  <th className="text-right py-1.5 font-medium">YoY</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => (
                  <tr key={row.company} className="border-b border-border/50" data-testid={`gold-mine-supply-${row.company}`}>
                    <td className="py-1.5 pr-2 break-words">{row.name}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatKoz(row.koz)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {row.yoy == null ? row.yoyReason : formatSignedPct(row.yoy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground break-words" data-testid="gold-mine-supply-peer">
            Peer-Median YoY {data.peerMedianYoy == null ? data.peerMedianReason : formatSignedPct(data.peerMedianYoy)}
            {" · "}
            Perzentil {data.percentile == null ? data.percentileReason : formatPercentPoints(data.percentile)}
            {" · "}
            z {data.z == null ? data.zReason : data.z.toFixed(2).replace(".", ",")}
          </p>
        </>
      )}
    </CardShell>
  );
}

export function GoldMineSupplyCard() {
  const query = useQuery<GoldMineSupplyResponse | null>({
    queryKey: ["/api/analyze-gold/mine-supply"],
  });
  if (query.isLoading || query.isError || !query.data) {
    return (
      <CardShell testId="gold-mine-supply" title="Angebotsreaktion (Minenproduktion)">
        <LoadingOrError loading={query.isLoading} error={query.error} empty="n/a — keine Daten" />
      </CardShell>
    );
  }
  return <GoldMineSupplyBody data={query.data} />;
}

function SideLine({ label, side }: { label: string; side: GoldMaBacktestSide | null }) {
  if (!side || side.reason) {
    return (
      <p className="text-[11px] text-muted-foreground break-words">
        {label}: {side?.reason ?? "n/a — kein Ergebnis"}
      </p>
    );
  }
  return (
    <p className="text-[11px] text-foreground break-words">
      {label}: Median {formatSignedPct(side.medianReturn)} · Treffer {formatPercentPoints(side.hitShare == null ? null : side.hitShare * 100)} · Haltedauer {formatDays(side.medianHoldDays)} · {side.completed} abgeschlossen{side.open > 0 ? `, ${side.open} offen` : ""}
    </p>
  );
}

export function GoldMaBacktestBody({ data }: { data: GoldMaBacktestResponse }) {
  return (
    <CardShell testId="gold-ma-backtest" title="Backtest MA-Kreuze (Gold)">
      {!data.available ? (
        <p className="text-[11px] text-muted-foreground break-words" data-testid="gold-ma-backtest-na">{data.reason}</p>
      ) : (
        <div className="space-y-1" data-testid="gold-ma-backtest-body">
          <p className="text-[11px] text-muted-foreground break-words">
            {data.source ?? "n/a"} · {data.pointCount ?? "n/a"} Schlüsse · MA {data.fastPeriod}/{data.slowPeriod}
            {data.from && data.to ? ` · ${data.from} – ${data.to}` : ""}
          </p>
          <SideLine label="Golden Cross" side={data.golden} />
          <SideLine label="Death Cross" side={data.death} />
          <p className="text-[10px] text-muted-foreground break-words">
            Rendite vom Kreuz bis zum gegenteiligen Kreuz. Offene Signale zählen nicht.
          </p>
        </div>
      )}
    </CardShell>
  );
}

export function GoldMaBacktestCard() {
  const query = useQuery<GoldMaBacktestResponse | null>({
    queryKey: ["/api/analyze-gold/ma-cross-backtest"],
  });
  if (query.isLoading || query.isError || !query.data) {
    return (
      <CardShell testId="gold-ma-backtest" title="Backtest MA-Kreuze (Gold)">
        <LoadingOrError loading={query.isLoading} error={query.error} empty="n/a — keine Daten" />
      </CardShell>
    );
  }
  return <GoldMaBacktestBody data={query.data} />;
}

export function GoldCentralBankBody({ data }: { data: GoldCentralBankResponse }) {
  return (
    <CardShell testId="gold-central-bank" title="Zentralbankkäufe (Europa / global)">
      {!data.available ? (
        <p className="text-[11px] text-muted-foreground break-words" data-testid="gold-central-bank-na">{data.reason}</p>
      ) : (
        <div data-testid="gold-central-bank-body">
          <p className="text-sm font-medium break-words">{data.stanceLabel ?? GOLD_CB_STANCE_LABEL[data.stance!]}</p>
          {data.summary && <p className="text-[11px] text-muted-foreground break-words">{data.summary}</p>}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground break-words">
        {data.updatedAt ? `Stand ${data.updatedAt}` : "Stand n/a"} · Cache {data.cacheTtlHours} h · Hinweis aus Gold-Schlagzeilen, keine Mengenangabe
      </p>
    </CardShell>
  );
}

export function GoldCentralBankCard() {
  const query = useQuery<GoldCentralBankResponse | null>({
    queryKey: ["/api/analyze-gold/central-bank-purchases"],
  });
  if (query.isLoading || query.isError || !query.data) {
    return (
      <CardShell testId="gold-central-bank" title="Zentralbankkäufe (Europa / global)">
        <LoadingOrError loading={query.isLoading} error={query.error} empty="n/a — keine Daten" />
      </CardShell>
    );
  }
  return <GoldCentralBankBody data={query.data} />;
}

export function GoldPhilipPendingBody({ data }: { data: GoldPhilipPendingResponse }) {
  return (
    <CardShell testId="gold-philip-pending" title="Offene Gold-Entscheidungen">
      {[data.gis, data.qeQt].map(slot => (
        <div key={slot.id} className="min-w-0" data-testid={`gold-philip-${slot.id}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium">{slot.title}</span>
            <span className="text-[11px] font-mono text-muted-foreground break-words">{slot.text}</span>
          </div>
          <p className="text-[10px] text-muted-foreground break-words">{slot.detail}</p>
        </div>
      ))}
    </CardShell>
  );
}

export function GoldPhilipPendingCard() {
  const query = useQuery<GoldPhilipPendingResponse | null>({
    queryKey: ["/api/analyze-gold/philip-pending"],
  });
  if (query.isLoading || query.isError || !query.data) {
    return (
      <CardShell testId="gold-philip-pending" title="Offene Gold-Entscheidungen">
        <LoadingOrError loading={query.isLoading} error={query.error} empty={PHILIP_PENDING_TEXT} />
      </CardShell>
    );
  }
  return <GoldPhilipPendingBody data={query.data} />;
}
