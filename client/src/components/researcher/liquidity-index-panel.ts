/**
 * View helpers for LiquidityIndexPanel.
 * The panel reads GET /api/researcher/liquidity?region= — it does not open a second route.
 */
export type LiquidityRegion = "US" | "EU" | "ASIA";

export interface IndexSlot {
  role: string;
  available: boolean;
  series: string[];
  score: number | null;
  x: number | null;
}

export interface IndexBooks {
  books: { M: IndexSlot[]; F: IndexSlot[] };
  money: IndexSlot[];
}

const TITLES: Record<LiquidityRegion, string> = {
  US: "Liquidity Index · USA",
  EU: "Liquidity Index · EZ",
  ASIA: "Liquidity Index · JP",
};

export function liquidityIndexPath(region: LiquidityRegion, refresh = false): string {
  const params = new URLSearchParams({ region });
  if (refresh) params.set("refresh", "1");
  return `/api/researcher/liquidity?${params.toString()}`;
}

export function liquidityIndexTitle(region: LiquidityRegion): string {
  return TITLES[region];
}

export function formatLi(li: number | null): string {
  if (li == null || !Number.isFinite(li)) return "n/v";
  return li.toFixed(1);
}

/** Channel D. Missing or all-down slots stay a mask, never a copied US print. */
export function fiscalOfferLine(slots: IndexSlot[]): string {
  const offer = slots.filter(s => s.role === "netIssuance" || s.role === "buybacks");
  const live = offer.filter(s => s.available);
  if (!live.length) return "Fiskal-Angebot n/v";
  return live.flatMap(s => s.series).join(", ");
}

export function listedSeries(payload: IndexBooks): string[] {
  return [...payload.books.M, ...payload.books.F, ...payload.money].flatMap(s => s.series);
}
