export interface SegmentGapItem {
  parent: string;
  kind: "product" | "geographic";
  name: string;
  shareOfParentPct: number | null;
  growthPct: number | null;
  basis: string;
}

export interface SegmentGapResult {
  items: SegmentGapItem[];
  reason: string | null;
}
