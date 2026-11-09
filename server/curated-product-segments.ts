/**
 * Kuratierte Produktsegmente, wenn FMP keine Produktzeilen liefert.
 * Dieselbe Liste benutzt /api/analyze und die Untersegment-Whitelist.
 */
export const CURATED_PRODUCT_SEGMENTS: Record<string, Array<{ name: string; pct: number }>> = {
  // Novo Nordisk FY2024 (annual report): Diabetes & obesity care 91.7%
  // (GLP-1 Diabetes 43.6%, Obesity care 22.4%, Insulin 8.6%, Other D&O 17.1%),
  // Rare disease 5.4%, Other 2.9%. Simplified into the 4 major buckets.
  NVO: [
    { name: "GLP-1 Diabetes (Ozempic/Rybelsus)", pct: 43.6 },
    { name: "Obesity Care (Wegovy/Saxenda)", pct: 22.4 },
    { name: "Insulin & Other Diabetes", pct: 25.7 },
    { name: "Rare Disease", pct: 5.4 },
    { name: "Other", pct: 2.9 },
  ],
  // ASML FY2024: EUV 40%, ArFi 26%, ArF Dry 4%, KrF 8%, Metrology & Inspection 3%,
  // Installed Base Mgmt (Service) 19%.
  ASML: [
    { name: "EUV Lithography", pct: 40 },
    { name: "ArFi Immersion", pct: 26 },
    { name: "Installed Base Mgmt (Service)", pct: 19 },
    { name: "KrF Lithography", pct: 8 },
    { name: "ArF Dry", pct: 4 },
    { name: "Metrology & Inspection", pct: 3 },
  ],
  // TSMC FY2024: HPC 51%, Smartphone 35%, IoT 6%, Automotive 5%, DCE 1%, Other 2%.
  TSM: [
    { name: "HPC (AI & Data Center)", pct: 51 },
    { name: "Smartphone", pct: 35 },
    { name: "IoT", pct: 6 },
    { name: "Automotive", pct: 5 },
    { name: "Digital Consumer Electronics", pct: 1 },
    { name: "Other", pct: 2 },
  ],
  // Nestle FY2024: Powdered & Liquid Beverages 26%, PetCare 21%, Nutrition & Health Science 17%,
  // Prepared Dishes & Cooking 12%, Milk & Ice cream 10%, Confectionery 8%, Water 4%, Other 2%.
  NSRGY: [
    { name: "Powdered & Liquid Beverages", pct: 26 },
    { name: "PetCare", pct: 21 },
    { name: "Nutrition & Health Science", pct: 17 },
    { name: "Prepared Dishes & Cooking", pct: 12 },
    { name: "Milk Products & Ice Cream", pct: 10 },
    { name: "Confectionery", pct: 8 },
    { name: "Water", pct: 4 },
    { name: "Other", pct: 2 },
  ],
  // SAP FY2024: Cloud 45%, Software licenses & support 40%, Services 15%.
  SAP: [
    { name: "Cloud", pct: 45 },
    { name: "Software Licenses & Support", pct: 40 },
    { name: "Services", pct: 15 },
  ],
  // LVMH FY2024: Fashion & Leather Goods 48%, Wines & Spirits 8%, Perfumes & Cosmetics 10%,
  // Watches & Jewelry 13%, Selective Retailing 21%.
  LVMUY: [
    { name: "Fashion & Leather Goods", pct: 48 },
    { name: "Selective Retailing", pct: 21 },
    { name: "Watches & Jewelry", pct: 13 },
    { name: "Perfumes & Cosmetics", pct: 10 },
    { name: "Wines & Spirits", pct: 8 },
  ],
  // Toyota FY2024 (Mar 2025 fiscal): Automotive 90%, Financial Services 7%, Other 3%.
  TM: [
    { name: "Automotive", pct: 90 },
    { name: "Financial Services", pct: 7 },
    { name: "Other", pct: 3 },
  ],
};

export function curatedSegmentNames(ticker: string): string[] {
  return (CURATED_PRODUCT_SEGMENTS[ticker.trim().toUpperCase()] ?? []).map((row) => row.name);
}
