/**
 * FW-05 — Query-Keys für den gemeinsamen Refresh von Analyse, Researcher
 * und Portfolio. invalidateQueries auf jedem dieser Keys trifft die
 * zugehörige Query und damit die API-Route dahinter.
 */
export const CROSS_MODULE_QUERY_KEYS = {
  analyze: ["cross-module", "analyze"] as const,
  researcher: ["cross-module", "researcher"] as const,
  portfolio: ["cross-module", "portfolio"] as const,
};

export type CrossModuleSlot = keyof typeof CROSS_MODULE_QUERY_KEYS;

export function crossModuleQueryKeyList(): ReadonlyArray<readonly [string, CrossModuleSlot]> {
  return [
    CROSS_MODULE_QUERY_KEYS.analyze,
    CROSS_MODULE_QUERY_KEYS.researcher,
    CROSS_MODULE_QUERY_KEYS.portfolio,
  ];
}
