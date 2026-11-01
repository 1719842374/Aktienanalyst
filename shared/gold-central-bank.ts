/**
 * F10-34 Käufe der Zentralbanken (Europa / global) als Hinweis aus den Gold-Schlagzeilen.
 * Kein Tonnenwert, kein Flag, kein GIS. Unklar bleibt n/a.
 */
export const GOLD_CB_STANCES = ["net_buying", "net_selling", "unchanged"] as const;
export type GoldCbStance = (typeof GOLD_CB_STANCES)[number];

export const GOLD_CB_STANCE_LABEL: Record<GoldCbStance, string> = {
  net_buying: "Nettokäufe",
  net_selling: "Nettoverkäufe",
  unchanged: "unverändert",
};

export interface GoldCentralBankResponse {
  affectsScore: false;
  available: boolean;
  stance: GoldCbStance | null;
  stanceLabel: string | null;
  summary: string | null;
  updatedAt: string | null;
  cacheTtlHours: number;
  headlineCount: number;
  reason: string | null;
}

export function interpretCentralBankLlm(
  data: unknown,
  llmAvailable: boolean,
): { stance: GoldCbStance | null; summary: string | null; reason: string | null } {
  if (!llmAvailable) {
    return { stance: null, summary: null, reason: "n/a — OPENROUTER_API_KEY fehlt" };
  }
  const record = data && typeof data === "object" ? data as { stance?: unknown; summary?: unknown } : {};
  const stance = typeof record.stance === "string" ? record.stance.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!GOLD_CB_STANCES.includes(stance as GoldCbStance)) {
    return { stance: null, summary: null, reason: "n/a — Schlagzeilen ohne belastbare Zentralbankkäufe" };
  }
  return {
    stance: stance as GoldCbStance,
    summary: summary || null,
    reason: null,
  };
}

export function centralBankResponse(input: {
  cacheTtlHours: number;
  headlineCount: number;
  stance: GoldCbStance | null;
  summary: string | null;
  updatedAt: string | null;
  reason: string | null;
}): GoldCentralBankResponse {
  return {
    affectsScore: false,
    available: input.stance != null,
    stance: input.stance,
    stanceLabel: input.stance ? GOLD_CB_STANCE_LABEL[input.stance] : null,
    summary: input.summary,
    updatedAt: input.updatedAt,
    cacheTtlHours: input.cacheTtlHours,
    headlineCount: input.headlineCount,
    reason: input.reason,
  };
}
