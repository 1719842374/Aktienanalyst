const RISK_LEVEL_PHRASE: Record<string, string> = {
  Hoch: "Hohes Risiko",
  "Erhöht": "Erhöhtes Risiko",
  Moderat: "Moderates Risiko",
  Niedrig: "Niedriges Risiko",
};

/** German adjective inflection for recession riskLevel ("Hoch" → "Hohes Risiko", not "Hoches"). */
export function riskLevelPhrase(riskLevel: string): string {
  return RISK_LEVEL_PHRASE[riskLevel] ?? `Risiko: ${riskLevel}`;
}
