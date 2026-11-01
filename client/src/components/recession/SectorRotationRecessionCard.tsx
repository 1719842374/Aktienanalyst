import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SectionCard } from "@/components/SectionCard";
import { apiRequest } from "@/lib/queryClient";
import { usePublishChatSection } from "@/lib/chatSectionData";
import { groupSectorValuation, type SectorValuationGroups, type SectorValuationInput } from "@shared/recession-sector-view";

/**
 * FW-31. Dieselbe Route wie der Researcher
 * (GET /api/researcher/sector-rotation → researcher-sector-rotation-route → sector-rotation).
 * Zeigt Unter-/Überbewertung. Kein Eingang in die Rezessions-P.
 */

interface SectorPayload {
  asOf?: string;
  phase?: string;
  sectors?: SectorValuationInput[];
  dataQuality?: { source?: string };
  error?: string;
}

export interface SectorRotationViewModel {
  status: "ok" | "na";
  reason: string | null;
  asOf: string | null;
  phase: string | null;
  source: string;
  groups: SectorValuationGroups;
}

const EMPTY: SectorValuationGroups = { overvalued: [], undervalued: [], mid: [], unavailable: [] };

export function sectorRotationView(body: SectorPayload | null, fetchError: string | null): SectorRotationViewModel {
  if (fetchError) {
    return { status: "na", reason: `n/a — ${fetchError}`, asOf: null, phase: null, source: "GET /api/researcher/sector-rotation", groups: EMPTY };
  }
  const sectors = body?.sectors;
  if (!Array.isArray(sectors) || sectors.length === 0) {
    return { status: "na", reason: "n/a — keine Sektorzeilen", asOf: body?.asOf ?? null, phase: body?.phase ?? null, source: body?.dataQuality?.source ?? "GET /api/researcher/sector-rotation", groups: EMPTY };
  }
  return {
    status: "ok",
    reason: null,
    asOf: body?.asOf ?? null,
    phase: body?.phase ?? null,
    source: body?.dataQuality?.source ?? "Researcher-Sektorrotation",
    groups: groupSectorValuation(sectors),
  };
}

function Bucket({ title, testId, lines, empty }: { title: string; testId: string; lines: SectorValuationGroups["overvalued"]; empty: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-1">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {lines.map(line => (
            <li key={`${line.etf}-${line.label}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-foreground">{line.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{line.etf}</span>
              <span className="text-[11px] text-muted-foreground">{line.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SectorRotationRecessionView({ model, onOpenResearcher }: { model: SectorRotationViewModel; onOpenResearcher: () => void }) {
  return (
    <div className="space-y-3" data-testid="recession-sector-rotation">
      {model.status === "na" ? (
        <p className="text-sm text-foreground" role="status" data-testid="recession-sector-na">{model.reason}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Bucket title="Überbewertet" testId="recession-sector-over" lines={model.groups.overvalued} empty="keines" />
          <Bucket title="Angemessen" testId="recession-sector-mid" lines={model.groups.mid} empty="keines" />
          <Bucket title="Unterbewertet" testId="recession-sector-under" lines={model.groups.undervalued} empty="keines" />
        </div>
      )}
      {model.status === "ok" && model.groups.unavailable.length > 0 && (
        <Bucket title="Ohne Bewertung" testId="recession-sector-na-rows" lines={model.groups.unavailable} empty="" />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span data-testid="recession-sector-meta">
          {model.phase ? `Phase ${model.phase}` : "Phase n/a"}
          {model.asOf ? ` · Stand ${model.asOf}` : ""}
          {` · Quelle ${model.source}`}
          {" · nur Anzeige, kein Einfluss auf die Rezessions-P"}
        </span>
        <button
          type="button"
          onClick={onOpenResearcher}
          className="text-xs text-primary underline-offset-2 hover:underline"
          data-testid="link-recession-sector-researcher"
        >
          Im Researcher öffnen
        </button>
      </div>
    </div>
  );
}

export function SectorRotationRecessionCard({ number }: { number: number }) {
  const [, navigate] = useLocation();
  const query = useQuery({
    queryKey: ["recession-sector-rotation"],
    queryFn: async (): Promise<SectorPayload> => {
      const res = await apiRequest("GET", "/api/researcher/sector-rotation");
      const body = await res.json().catch(() => ({})) as SectorPayload;
      if (!res.ok || body?.error) throw new Error(body?.error || `Sektorrotation HTTP ${res.status}`);
      return body;
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: 0,
  });

  const model = sectorRotationView(query.data ?? null, query.isError ? (query.error instanceof Error ? query.error.message : "Sektorrotation nicht erreichbar") : null);
  const shown = query.isPending ? null : model;
  usePublishChatSection("recession", "sektor", shown && shown.status === "ok" ? {
    phase: shown.phase,
    ueberbewertet: shown.groups.overvalued.map(l => l.label).join(", ") || null,
    unterbewertet: shown.groups.undervalued.map(l => l.label).join(", ") || null,
    ohneBewertung: shown.groups.unavailable.length,
  } : shown ? { hinweis: shown.reason } : null);

  return (
    <SectionCard
      number={number}
      title="Sektorrotation Unter-/Überbewertet"
      subtitle="Dieselbe Researcher-Sektorrotation · nur Anzeige, kein Score"
    >
      {query.isPending ? (
        <p className="text-sm text-muted-foreground" data-testid="recession-sector-loading">wird geladen …</p>
      ) : (
        <SectorRotationRecessionView model={model} onOpenResearcher={() => navigate("/researcher")} />
      )}
    </SectionCard>
  );
}
