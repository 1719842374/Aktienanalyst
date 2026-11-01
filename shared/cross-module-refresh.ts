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

export interface RefreshModuleError {
  module: string;
  message: string;
}

/** Eine Zeile für Toast und Fehlerzeile: „analyze: HTTP 500: … · capex: …“. */
export function refreshErrorLine(errors: readonly RefreshModuleError[]): string {
  return errors.map((entry) => `${entry.module}: ${entry.message}`).join(" · ");
}

/**
 * Ein force-Call pro Ticker. Der zweite Aufruf (andere Schreibweise, anderes Modul)
 * hängt sich an dasselbe Promise und startet job nicht erneut.
 */
export function createForceAnalyzeGate(): {
  once(ticker: string, job: () => Promise<void>): Promise<void>;
} {
  const claims = new Map<string, Promise<void>>();
  return {
    once(ticker: string, job: () => Promise<void>): Promise<void> {
      const key = ticker.trim().toUpperCase();
      if (!key) return Promise.resolve();
      const existing = claims.get(key);
      if (existing) return existing;
      const pending = (async () => {
        await job();
      })();
      claims.set(key, pending);
      return pending;
    },
  };
}
