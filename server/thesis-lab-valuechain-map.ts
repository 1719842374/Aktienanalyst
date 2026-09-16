export interface ValueChainLookupTarget {
  industryKey: string;
  industryLabel: string;
  gicsSector: string;
  href: string;
}

export const STAGE_TO_INDUSTRIES: Record<string, string[]> = {
  memory: ["semiconductors"],
  process_lockin: ["semiconductors"],
  agent_runtime: ["software-infrastructure"],
  physical_motion: ["auto-manufacturers", "aerospace-defense"],
  farm_os: ["food-agri"],
  agent_liability: ["payments-market-infra"],
  unmapped: [],
};

export const INDUSTRY_META: Record<string, Omit<ValueChainLookupTarget, "href">> = {
  semiconductors: { industryKey: "semiconductors", industryLabel: "Halbleiter", gicsSector: "Information Technology" },
  "software-infrastructure": { industryKey: "software-infrastructure", industryLabel: "Software-Infrastruktur", gicsSector: "Information Technology" },
  "auto-manufacturers": { industryKey: "auto-manufacturers", industryLabel: "Automobilhersteller", gicsSector: "Consumer Discretionary" },
  "aerospace-defense": { industryKey: "aerospace-defense", industryLabel: "Luft- & Raumfahrt / Verteidigung", gicsSector: "Industrials" },
  "food-agri": { industryKey: "food-agri", industryLabel: "Food / Agri", gicsSector: "Consumer Staples" },
  "payments-market-infra": { industryKey: "payments-market-infra", industryLabel: "Payments / Marktinfra", gicsSector: "Financials" },
  "data-center-cloud": { industryKey: "data-center-cloud", industryLabel: "Data Center / Cloud", gicsSector: "Information Technology" },
  "utilities-generation-grid-retail": { industryKey: "utilities-generation-grid-retail", industryLabel: "Utilities / Grid", gicsSector: "Utilities" },
};

export function hrefForIndustry(industryKey: string): string {
  return `/#/valuechain?industry=${encodeURIComponent(industryKey)}`;
}

export function targetsForStage(stage: string): ValueChainLookupTarget[] {
  const keys = STAGE_TO_INDUSTRIES[stage] ?? [];
  return keys
    .map((k) => INDUSTRY_META[k])
    .filter(Boolean)
    .map((m) => ({ ...m, href: hrefForIndustry(m.industryKey) }));
}

export function labHrefForTicker(ticker: string): string {
  return `/#/lab?ticker=${encodeURIComponent(ticker)}`;
}

export function labHrefForStage(stage: string): string {
  return `/#/lab?stage=${encodeURIComponent(stage)}`;
}
