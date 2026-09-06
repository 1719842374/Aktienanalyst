/**
 * LLM-Prosa gegen ein FactPack (FactSet-Form).
 *
 * Zero zitiert FactSet für Beats. Hier gibt es keinen FACTSET_API_KEY.
 * Dieselbe Felderliste wird aus FMP analyst-estimates + Income + Quote gefüllt.
 * Später: buildFactPackFromFactSet() gleiche Schnittstelle.
 *
 * Regel: Zahl im LLM-Text muss im Pack stehen (rel. 3 % oder EPS abs. 0.02).
 * Satz ohne Treffer fliegt. Pack leer → available:false, Text unverändert.
 */

export type FactUnit = "usd" | "eps" | "pct" | "count" | "multiple";

export interface FactEntry {
  id: string;
  value: number;
  unit: FactUnit;
  label: string;
  asOf?: string;
  source: "factset" | "fmp" | "internal";
}

export interface FactPack {
  ticker: string;
  source: "factset" | "fmp" | "mixed" | "empty";
  asOf: string;
  facts: FactEntry[];
}

export interface NumericClaim {
  raw: string;
  value: number;
  unit: FactUnit;
  sentence: string;
}

export interface ClaimCheck {
  claim: NumericClaim;
  ok: boolean;
  matchedId?: string;
  deltaPct?: number;
}

export interface FactCheckResult {
  available: boolean;
  ok: boolean;
  cleanedText: string;
  droppedSentences: string[];
  checks: ClaimCheck[];
}

const REL_TOL = 0.03;
const EPS_ABS = 0.02;

function toNumber(raw: string): number | null {
  const t = raw.replace(/ /g, " ").trim();
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-") || t.startsWith("−");
  let s = t.replace(/[()\s]/g, "").replace(/^[+−-]/, "").replace(/,/g, "");
  let mult = 1;
  if (/mrd\.?|billion|bn\b/i.test(s) || /[Bb]$/.test(s)) {
    mult = 1e9;
    s = s.replace(/mrd\.?|billion|bn|[Bb]$/gi, "");
  } else if (/mio\.?|million|mn\b/i.test(s) || /[Mm]$/.test(s)) {
    mult = 1e6;
    s = s.replace(/mio\.?|million|mn|[Mm]$/gi, "");
  } else if (/\bT\b|billionen|trillion/i.test(s)) {
    mult = 1e12;
    s = s.replace(/billionen|trillion|[Tt]$/gi, "");
  } else if (/[Kk]$/.test(s)) {
    mult = 1e3;
    s = s.replace(/[Kk]$/, "");
  }
  s = s.replace(/[%$\u20ac]/g, "");
  const n = parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return (neg ? -1 : 1) * n * mult;
}

function inferUnit(raw: string, sentence: string): FactUnit {
  const ctx = `${raw} ${sentence}`.toLowerCase();
  if (/%/.test(raw) || /\bpp\b|marge|wachstum|yoy/.test(ctx)) return "pct";
  if (/\beps\b|gewinn je|je aktie/.test(ctx) || /\$[0-9]+\.[0-9]{2}\b/.test(raw) && /eps|gewinn/.test(ctx)) return "eps";
  if (/\bkgv\b|\bkuv\b|\bpev\b|multiple|ev\/sales/.test(ctx)) return "multiple";
  if (/\$|€|usd|eur|mrd|mio|umsatz|ebitda|capex|verbindlich|barmittel/.test(ctx)) return "usd";
  return "count";
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/) 
    .map(s => s.trim())
    .filter(Boolean);
}

/** Zahlen mit optionalem $ € % und Mrd/Mio. */
// Bugfix (02.09.2026, pre-existing seit Commit 1685bbf): fehlende oeffnende
// Klammer der Alternativ-Gruppe blockierte den gesamten esbuild-Server-Build
// ("Unexpected ')' in regular expression"). Absicht laut umgebendem Code
// (\(?...\)? aussen, zwei Zahlenformat-Alternativen innen) war eine Gruppe
// um beide Alternativen -- ergaenzt, keine Verhaltensaenderung sonst.
const NUM_RE = /(?:\$|€)?\(?(?:-?[0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]+)?|-?[0-9]+(?:[.,][0-9]+)?)\)?\s*(?:Mrd\.?|Mio\.?|billion|million|bn|mn|%|B|M)?/gi;

export function extractClaims(text: string): NumericClaim[] {
  const out: NumericClaim[] = [];
  for (const sentence of splitSentences(text)) {
    const matches = sentence.match(NUM_RE) || [];
    for (const raw of matches) {
      const trimmed = raw.trim();
      if (!/[0-9]/.test(trimmed)) continue;
      if (/^\d{4}$/.test(trimmed) && Number(trimmed) >= 1990 && Number(trimmed) <= 2100) continue;
      const value = toNumber(trimmed);
      if (value == null) continue;
      if (Math.abs(value) < 1e-9) continue;
      out.push({ raw: trimmed, value, unit: inferUnit(trimmed, sentence), sentence });
    }
  }
  return out;
}

function compatible(claimUnit: FactUnit, factUnit: FactUnit): boolean {
  if (claimUnit === factUnit) return true;
  if (claimUnit === "count" || factUnit === "count") return true;
  if ((claimUnit === "eps" && factUnit === "usd") || (claimUnit === "usd" && factUnit === "eps")) return true;
  return false;
}

function closeEnough(claim: number, fact: number, unit: FactUnit): { ok: boolean; deltaPct: number } {
  if (!Number.isFinite(claim) || !Number.isFinite(fact) || fact === 0) {
    const abs = Math.abs(claim - fact);
    return { ok: abs <= EPS_ABS, deltaPct: 0 };
  }
  const deltaPct = Math.abs(claim - fact) / Math.abs(fact);
  if (unit === "eps") return { ok: Math.abs(claim - fact) <= EPS_ABS || deltaPct <= REL_TOL, deltaPct };
  if (unit === "pct") {
    const a = Math.abs(claim) <= 1 && Math.abs(fact) > 1 ? claim * 100 : claim;
    const b = Math.abs(fact) <= 1 && Math.abs(claim) > 1 ? fact * 100 : fact;
    return { ok: Math.abs(a - b) <= 0.6 || Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) <= REL_TOL, deltaPct };
  }
  return { ok: deltaPct <= REL_TOL, deltaPct };
}

export function validateTextAgainstFactPack(text: string, pack: FactPack | null | undefined): FactCheckResult {
  const raw = (text || "").trim();
  if (!pack || pack.facts.length === 0) {
    return { available: false, ok: true, cleanedText: raw, droppedSentences: [], checks: [] };
  }
  const claims = extractClaims(raw);
  if (claims.length === 0) {
    return { available: true, ok: true, cleanedText: raw, droppedSentences: [], checks: [] };
  }
  const checks: ClaimCheck[] = claims.map(claim => {
    let best: ClaimCheck = { claim, ok: false };
    for (const fact of pack.facts) {
      if (!compatible(claim.unit, fact.unit)) continue;
      const c = closeEnough(claim.value, fact.value, claim.unit);
      if (c.ok && (best.deltaPct == null || c.deltaPct < best.deltaPct)) {
        best = { claim, ok: true, matchedId: fact.id, deltaPct: c.deltaPct };
      }
    }
    return best;
  });

  const badSentences = new Set(checks.filter(c => !c.ok).map(c => c.claim.sentence));
  const kept = splitSentences(raw).filter(s => !badSentences.has(s));
  const dropped = [...badSentences];
  const cleanedText = kept.join(" ").trim();
  return {
    available: true,
    ok: dropped.length === 0,
    cleanedText: cleanedText || raw,
    droppedSentences: dropped,
    checks,
  };
}

export function applyFactPackToCatalysts<T extends { context?: string; name?: string }>(
  catalysts: T[],
  pack: FactPack | null | undefined,
): T[] {
  if (!pack || pack.facts.length === 0) return catalysts;
  return catalysts.map(c => {
    const ctx = validateTextAgainstFactPack(c.context || "", pack);
    const name = validateTextAgainstFactPack(c.name || "", pack);
    return {
      ...c,
      context: ctx.cleanedText,
      name: name.ok || !extractClaims(c.name || "").length ? c.name : (c.name || ""),
      factCheck: {
        ok: ctx.ok && name.ok,
        dropped: ctx.droppedSentences.length,
        source: pack.source,
      },
    };
  });
}

function push(facts: FactEntry[], id: string, value: unknown, unit: FactUnit, label: string, source: FactEntry["source"]) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return;
  facts.push({ id, value: n, unit, label, source });
}

/** FMP-Estimates + Quote + Income → FactSet-förmiges Pack. */
export function buildFactPackFromFmp(opts: {
  ticker: string;
  estimates?: any[] | null;
  quote?: any | null;
  income?: any[] | null;
  price?: number | null;
  pe?: number | null;
  revenue?: number | null;
  revenueGrowthPct?: number | null;
}): FactPack {
  const facts: FactEntry[] = [];
  const src: FactEntry["source"] = "fmp";
  const est = Array.isArray(opts.estimates) ? opts.estimates : [];
  const latest = est[0] || {};
  push(facts, "eps_avg", latest.epsAvg ?? latest.estimatedEpsAvg, "eps", "EPS Konsens", src);
  push(facts, "eps_high", latest.epsHigh ?? latest.estimatedEpsHigh, "eps", "EPS High", src);
  push(facts, "eps_low", latest.epsLow ?? latest.estimatedEpsLow, "eps", "EPS Low", src);
  push(facts, "rev_avg", latest.revenueAvg ?? latest.estimatedRevenueAvg, "usd", "Umsatz Konsens", src);
  push(facts, "rev_high", latest.revenueHigh, "usd", "Umsatz High", src);
  const inc = Array.isArray(opts.income) ? opts.income[0] : null;
  push(facts, "rev_actual", inc?.revenue ?? opts.revenue, "usd", "Umsatz reported", src);
  push(facts, "ni_actual", inc?.netIncome, "usd", "Jahresüberschuss", src);
  push(facts, "eps_actual", inc?.eps ?? inc?.epsdiluted, "eps", "EPS reported", src);
  push(facts, "price", opts.quote?.price ?? opts.price, "usd", "Kurs", src);
  push(facts, "pe", opts.quote?.pe ?? opts.pe, "multiple", "KGV", src);
  push(facts, "mcap", opts.quote?.marketCap, "usd", "Marktkap", src);
  if (opts.revenueGrowthPct != null) push(facts, "rev_yoy", opts.revenueGrowthPct, "pct", "Umsatz YoY %", "internal");
  return {
    ticker: (opts.ticker || "").toUpperCase(),
    source: facts.length ? "fmp" : "empty",
    asOf: new Date().toISOString().slice(0, 10),
    facts,
  };
}

/** Platzhalter: gleiche Form, wenn FACTSET_API_KEY + Client existieren. */
export function buildFactPackFromFactSet(payload: {
  ticker: string;
  actualEps?: number;
  consensusEps?: number;
  surpriseEps?: number;
  actualRevenue?: number;
  consensusRevenue?: number;
  surpriseRevenue?: number;
  asOf?: string;
}): FactPack {
  const facts: FactEntry[] = [];
  push(facts, "eps_actual", payload.actualEps, "eps", "EPS actual", "factset");
  push(facts, "eps_cons", payload.consensusEps, "eps", "EPS consensus", "factset");
  push(facts, "eps_surp", payload.surpriseEps, "eps", "EPS surprise", "factset");
  push(facts, "rev_actual", payload.actualRevenue, "usd", "Revenue actual", "factset");
  push(facts, "rev_cons", payload.consensusRevenue, "usd", "Revenue consensus", "factset");
  push(facts, "rev_surp", payload.surpriseRevenue, "usd", "Revenue surprise", "factset");
  return {
    ticker: payload.ticker.toUpperCase(),
    source: facts.length ? "factset" : "empty",
    asOf: payload.asOf || new Date().toISOString().slice(0, 10),
    facts,
  };
}
