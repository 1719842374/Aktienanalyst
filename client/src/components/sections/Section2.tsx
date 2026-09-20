import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis, RevenueSegment } from "../../../../shared/schema";
import { calculateFCFFDCF, buildDefaultDCFParams, calculateCatalystUpside, selectCatalystBase } from "../../lib/calculations";
import { formatPercentNoSign, formatNumber, formatCurrency, formatLargeNumber } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

// LOADER_MARKER - content continues via second push if truncated
export function Section2({ data }: Props) {
  return (
    <SectionCard number={3} title="INVESTMENTTHESE & KATALYSATOREN">
      <div>Loading full restore...</div>
    </SectionCard>
  );
}
