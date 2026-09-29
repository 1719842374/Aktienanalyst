/**
 * Qualitative Ökosystem-Flag für Moat §13.
 *
 * Heuristik auf Geschäftsmodell-Text (Unternehmensbeschreibung und, falls
 * vorhanden, Porter-Narrative aus dem LLM). Kein Ticker- oder Namens-Lookup:
 * der Chip hängt nur an Sprachsignalen für ein eigenes Plattform-/Partner-
 * Ökosystem. Der Flag ändert weder Moat-Score, Lynch-Klasse noch DCF.
 */

export interface EcosystemAssessment {
  hasEcosystem: boolean;
  ecosystemNote?: string;
}

const OWN_NOTE = "Geschäftsmodell beschreibt ein eigenes Ökosystem";

const STRUCTURAL_RULES: ReadonlyArray<{ re: RegExp; note: string }> = [
  {
    re: /\bthird[- ]party (developers?|apps?|applications?|partners?|integrations?|software)\b/i,
    note: "Drittanbieter erweitern die Plattform",
  },
  {
    re: /\bdeveloper (community|platform|tools|sdks?)\b/i,
    note: "Entwicklerplattform mit Community",
  },
  {
    re: /\bapp stores?\b/i,
    note: "App-Store als Ökosystem-Zugang",
  },
  {
    re: /\bwalled garden\b/i,
    note: "Geschlossenes Plattform-Ökosystem",
  },
  {
    re: /\b(?:sdks?|apis?)\b[\s\S]{0,80}\b(?:developers?|partners?|third[- ]party)\b/i,
    note: "SDK/API mit Entwickler- oder Partnerbasis",
  },
  {
    re: /\b(?:developers?|partners?|third[- ]party)\b[\s\S]{0,80}\b(?:sdks?|apis?)\b/i,
    note: "SDK/API mit Entwickler- oder Partnerbasis",
  },
  {
    re: /\bcomplementary (products|platforms|services|software|hardware|offerings|devices)\b/i,
    note: "Komplementäre Produkte im Verbund",
  },
  {
    re: /(?:drittanbieter|entwicklerplattform|partner[- ]?ökosystem|partnernetz(?:werk)?)/i,
    note: "Partner- oder Entwickler-Ökosystem",
  },
];

function asText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function note(text: string): EcosystemAssessment {
  const ecosystemNote = text.trim().slice(0, 180);
  return ecosystemNote ? { hasEcosystem: true, ecosystemNote } : { hasEcosystem: true };
}

/**
 * A mention is someone else's ecosystem ("sells into the Apple ecosystem"),
 * not the company's own. Possessive immediately before the word ("our ecosystem",
 * "part of our ecosystem") stays own.
 */
function isExternalEcosystemMention(before: string): boolean {
  const tail = before.toLowerCase();
  if (/\b(our|its|their|own|proprietary)\s+$/i.test(tail)) return false;
  if (/\b(company(?:'s|s)?)\s+$/i.test(tail)) return false;
  if (/\b(unser(?:em|er|es)?|eigenes|eigenen|eigenem)\s+$/i.test(tail)) return false;
  return /\b(part of|within|into|inside|in the|member of|embedded in|supplier to|sells? into|benefit(?:s|ing)? from|depends? on|exposed to|teil des|in das|innerhalb)\b/i.test(tail);
}

function hasOwnEcosystemWord(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 48), match.index);
    if (!isExternalEcosystemMention(before)) return true;
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return false;
}

/** Description/LLM text → flag. Never reads a ticker. */
export function assessEcosystem(description: string | null | undefined): EcosystemAssessment {
  const text = asText(description);
  if (!text) return { hasEcosystem: false };

  if (hasOwnEcosystemWord(text, /ecosystems?/gi)) return note(OWN_NOTE);
  if (hasOwnEcosystemWord(text, /ökosysteme?|oekosysteme?/gi)) return note(OWN_NOTE);

  for (const rule of STRUCTURAL_RULES) {
    if (rule.re.test(text)) return note(rule.note);
  }
  return { hasEcosystem: false };
}

/**
 * Description first. If that is silent, the same heuristic runs on optional
 * LLM narrative (Porter summaries). Still no ticker lookup.
 */
export function resolveEcosystem(input: {
  description?: string | null;
  llmText?: string | null;
}): EcosystemAssessment {
  const fromDescription = assessEcosystem(input.description);
  if (fromDescription.hasEcosystem) return fromDescription;
  const fromLlm = assessEcosystem(input.llmText);
  if (fromLlm.hasEcosystem) return fromLlm;
  return { hasEcosystem: false };
}

/** Joins Porter LLM fields (summary, reasoning, keyFactors) into one text blob. */
export function collectPorterNarrative(forces: unknown): string {
  if (!Array.isArray(forces)) return "";
  return forces
    .map((force) => {
      if (!force || typeof force !== "object") return "";
      const row = force as { summary?: unknown; reasoning?: unknown; keyFactors?: unknown };
      const factors = Array.isArray(row.keyFactors) ? row.keyFactors.map((item) => String(item)) : [];
      return [row.summary, row.reasoning, ...factors]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ");
    })
    .filter((part) => part.length > 0)
    .join("\n");
}
