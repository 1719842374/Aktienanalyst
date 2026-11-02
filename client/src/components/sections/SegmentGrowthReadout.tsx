import type { SegmentGrowthAnnotation } from "@shared/segment-growth-calc";
import { formatNumber } from "../../lib/formatters";

export function calculatedGrowth(fact: number | null | undefined, annotation: SegmentGrowthAnnotation | null | undefined): SegmentGrowthAnnotation | null {
  if (typeof fact === "number" && Number.isFinite(fact)) return null;
  if (!annotation || annotation.basis !== "berechnet" || typeof annotation.growth !== "number" || !Number.isFinite(annotation.growth)) return null;
  return annotation;
}

export function growthTitle(annotation: SegmentGrowthAnnotation | null | undefined): string | undefined {
  if (!annotation) return undefined;
  if (annotation.basis === "berechnet") {
    return `berechnet · ${annotation.formula ?? "Formel fehlt"} · Quelle: ${annotation.source ?? "n/a"}`;
  }
  return annotation.reason ?? undefined;
}

export function SegmentGrowthReadout({
  fact,
  annotation,
}: {
  fact: number | null | undefined;
  annotation: SegmentGrowthAnnotation | null | undefined;
}) {
  const calculated = calculatedGrowth(fact, annotation);
  const value = typeof fact === "number" && Number.isFinite(fact) ? fact : calculated?.growth ?? null;
  if (value == null) {
    if (annotation?.basis === "n/a" && annotation.reason) {
      return (
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70" title={annotation.reason}>
          n/a
        </span>
      );
    }
    return null;
  }
  const positive = value >= 0;
  return (
    <span
      className={`text-[10px] font-mono tabular-nums ${positive ? "text-emerald-500" : "text-red-500"}`}
      title={calculated ? growthTitle(calculated) : undefined}
    >
      {positive ? "+" : ""}{formatNumber(value, 1)}%
      {calculated && (
        <span className="ml-1 text-[8px] font-sans font-semibold uppercase tracking-wide text-sky-300">
          berechnet
        </span>
      )}
    </span>
  );
}
