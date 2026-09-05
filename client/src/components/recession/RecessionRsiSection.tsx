import { SectionCard } from "@/components/SectionCard";
import { RegionRsiPanel } from "@/components/recession/RegionRsiPanel";

/** WORK_RECESSION_RSI_MACD §6 — mount after S7 in RecessionDashboard */
export function RecessionRsiSection({ number = 8 }: { number?: number }) {
  return (
    <SectionCard number={number} title="Markt-RSI / MACD nach Region">
      <RegionRsiPanel />
    </SectionCard>
  );
}
