import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/SectionCard";
import { usePublishChatSection } from "@/lib/chatSectionData";
import { INVENTORY_DEMAND_GAP_PARAMS, type InventoryDemandGap, type NaReading } from "@shared/inventory-demand-gap";

/**
 * F9-04 auf /recession. useQuery ['inventory-gap'] → GET /api/macro/inventory-demand-gap.
 * Zeigt ISRATIO-Perzentil und die Auftrags-Auslieferungs-Lücke mit Datum. Kein Score.
 * FRED nicht erreichbar → dieser Text, keine 0-Werte.
 */
function deNum(v: number, digits: number): string {
  const sign = v < 0 ? "−" : "";
  return sign + Math.abs(v).toFixed(digits).replace(".", ",");
}

function deDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function signedPp(v: number): string {
  if (v > 0) return `+${deNum(v, 1)} Pp`;
  return `${deNum(v, 1)} Pp`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function isFredDown(data: InventoryDemandGap): boolean {
  if (data.isratio.available || data.orderShipmentGap.available) return false;
  return [data.isratio, data.orderShipmentGap].some(r => /FRED nicht erreichbar/.test((r as NaReading).reason));
}

export function InventoryDemandGapCard({ number }: { number: number }) {
  const query = useQuery({
    queryKey: ["inventory-gap"],
    staleTime: INVENTORY_DEMAND_GAP_PARAMS.cacheTtlMs,
    queryFn: async (): Promise<InventoryDemandGap> => {
      const res = await fetch("/api/macro/inventory-demand-gap");
      if (!res.ok) throw new Error("FRED nicht erreichbar");
      const body = await res.json() as InventoryDemandGap;
      if (!body?.isratio || !body?.orderShipmentGap || !body?.gapWindow) throw new Error("FRED nicht erreichbar");
      return body;
    },
  });

  const data = query.data ?? null;
  usePublishChatSection("recession", "lager", data ? {
    isratioPerzentil: data.isratio.available ? round1(data.isratio.percentile) : null,
    isratioZ: data.isratio.available ? round1(data.isratio.z) : null,
    isratioDatum: data.isratio.available ? data.isratio.latestDate : null,
    lueckePp: data.orderShipmentGap.available ? round1(data.orderShipmentGap.gapPp) : null,
    lueckeDatum: data.orderShipmentGap.available ? data.orderShipmentGap.latestDate : null,
    lueckePerzentil: data.gapWindow.available ? round1(data.gapWindow.percentile) : null,
    lueckeZ: data.gapWindow.available ? round1(data.gapWindow.z) : null,
  } : null);

  const fredDown = query.isError || (data != null && isFredDown(data));

  return (
    <SectionCard
      number={number}
      title="Lager/Nachfrage-Lücke"
      subtitle="ISRATIO-Perzentil und Aufträge gegen Auslieferungen · nur Anzeige, kein Score"
    >
      <div className="space-y-3" data-testid="inventory-demand-gap">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="inventory-gap-loading">wird geladen …</p>
        ) : fredDown || !data ? (
          <p className="text-sm text-foreground" role="status" data-testid="inventory-gap-error">FRED nicht erreichbar</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Reading
              testId="inventory-gap-isratio"
              label="ISRATIO-Perzentil"
              value={data.isratio.available ? `${deNum(data.isratio.percentile, 1)} %` : data.isratio.reason}
              detail={data.isratio.available
                ? `Stand ${deDate(data.isratio.latestDate)} · z ${deNum(data.isratio.z, 2)} · ${INVENTORY_DEMAND_GAP_PARAMS.windowYears} Jahre`
                : "n/a"}
            />
            <Reading
              testId="inventory-gap-orders"
              label="Order-Shipment-Gap"
              value={data.orderShipmentGap.available ? signedPp(data.orderShipmentGap.gapPp) : data.orderShipmentGap.reason}
              detail={data.orderShipmentGap.available
                ? `Stand ${deDate(data.orderShipmentGap.latestDate)}${data.gapWindow.available ? ` · Perzentil ${deNum(data.gapWindow.percentile, 1)} % · z ${deNum(data.gapWindow.z, 2)}` : ""}`
                : "n/a"}
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">FRED ISRATIO · FRED DGORDER · FRED AMDMVS</p>
      </div>
    </SectionCard>
  );
}

function Reading({ testId, label, value, detail }: { testId: string; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 min-w-0" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-foreground break-words">{value}</div>
      <div className="text-[11px] text-muted-foreground break-words">{detail}</div>
    </div>
  );
}
