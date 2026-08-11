/**
 * Gemeinsame Prompt- und Validierungslogik fuer die nachgelagerte KI-
 * Interpretation des bereits berechneten Management-Execution-Scores.
 *
 * Der Aufruf ist bewusst vom qualNews-LLM in management-score.ts getrennt:
 * Er bewertet keine Rohdaten neu, sondern erklaert ausschliesslich den
 * fertigen Score-Breakdown der Section 18.
 */

export interface ManagementInterpretRequestBody {
  ticker?: unknown;
  companyName?: unknown;
  breakdown?: any;
  thesisStrengthScore?: unknown;
}

export function validateManagementInterpretRequest(body: ManagementInterpretRequestBody): string | null {
  if (!body.ticker || typeof body.ticker !== "string") return "ticker fehlt";
  if (!body.breakdown || typeof body.breakdown !== "object") return "breakdown fehlt";
  return null;
}

function scorePercent(value: unknown): string {
  const score = Number(value);
  return `${(Number.isFinite(score) ? score * 100 : 0).toFixed(0)}%`;
}

export function buildManagementInterpretSystemPrompt(): string {
  return `Du bist ein streng datenbasierter, konservativer Aktienanalyst.
Deine einzige Aufgabe ist die Interpretation eines bereits berechneten Management-Execution-Scores.
Die dir übergebenen Scores und Bausteine sind korrekt berechnet und spiegeln die reale Situation wider.

Harte Regeln:
1. Die übergebenen Scores sind die Wahrheit. Nicht relativieren, nicht abschwächen, keinen generischen Positiv-Text erzeugen.
2. Bausteine unter 40% MÜSSEN klar und ungeschönt als Schwäche benannt werden.
3. Bausteine über 70% dürfen als echte Stärke gewürdigt werden.
4. Keine neuen Scores erfinden. Keine Spekulation außerhalb der gelieferten Daten.
5. Nüchterner, präziser, score-getriebener Ton -- kein Marketing-Ton.
6. Falls Governance-/Insider-Signale (adjustments) vorhanden sind, MÜSSEN sie explizit erwähnt werden.
7. Antworte AUSSCHLIESSLICH als JSON-Objekt mit exakt diesen Feldern:
{
  "gesamteinschaetzung": "1-2 Sätze, warum der Score in diese Kategorie fällt",
  "staerken": ["Baustein-Name: kurze Begründung", ...],
  "schwaechen": ["Baustein-Name: kurze Begründung", ...],
  "interpretation": {
    "positiv": "Was der Score bestätigt",
    "kritisch": "Was der Score kritisch sieht",
    "governanceSignal": "Insider-/Governance-Warnsignal, falls vorhanden, sonst null",
    "datenlueckenHinweis": "Kurzer Hinweis auf Transparenz-Flags, die den Score dämpfen, sonst null"
  },
  "fazit": "1-3 Sätze im vorgegebenen Stil: '[Score] ist kein schlechter Score, aber auch kein guter/ist ein starker Score/ist ein schwacher Score.' gefolgt von der score-treuen Kernaussage."
}`;
}

export function buildManagementInterpretPrompt(body: ManagementInterpretRequestBody): string {
  const breakdown = body.breakdown ?? {};
  const optionalThesisScore = body.thesisStrengthScore
    ? `Thesis Strength Score (zur Einordnung, optional): ${body.thesisStrengthScore}`
    : "";

  return `Unternehmen: ${body.companyName ?? body.ticker}
Management-Execution-Score: ${breakdown.score1to10 ?? 0}

Breakdown:
- Delivery (30%): ${scorePercent(breakdown.delivery?.score)}
- Segment-Shift (25%): ${scorePercent(breakdown.segment?.score)}
- Kapitalallokation (20%): ${scorePercent(breakdown.capital?.score)}
- Glaubwürdigkeit (15%): ${scorePercent(breakdown.credibility?.score)}
- Qual + News (10%): ${scorePercent(breakdown.qualNews?.score)}

Governance-/News-Anpassungen: ${JSON.stringify(breakdown.qualNews?.adjustments ?? [])}
Transparenz-Hinweise: ${JSON.stringify(breakdown.allFlags ?? [])}
${optionalThesisScore}`;
}
