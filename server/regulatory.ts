/**
 * TEIL 8 — Regulatory Exposure (WORK2.md §8.1–§8.8)
 *
 * Kernprinzip (§8.1): Qualitätsprämie nur durch Zahlen, nicht durch Narrative.
 * Anti-Hardcoding: KEINE festen Programmnamen (Medicaid, IRA, CBAM, …) im
 * Prompt oder Code — Kontext kommt aus Sektor/Branche/Top-Umsatzländern,
 * gesucht wird über generische Überbegriffe (RegulationAxis), Treffer werden
 * erst NACH der Extraktion benannt.
 *
 * Pipeline (§8.9): Geo-Segmente (FMP) → Query-Builder → LLM (OpenRouter) →
 * JSON-Extraktion → Confidence-Filter (§8.6) → Test-Matrix (§8.7) →
 * REGULATORY_EXPOSURE-Gate (§8.8) → PESTEL/UI.
 *
 * Datenquellen: FMP-Geo-Segmente + OpenRouter-LLM — kein Perplexity-Finance-
 * Connector.
 */
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";

// ─── §8.2 Datenmodell ─────────────────────────────────────────────────────────

export type RegulationAxis =
  | 'price_regulation'
  | 'subsidy_incentive'
  | 'competition_antitrust'
  | 'environmental_climate'
  | 'data_privacy_tech'
  | 'labor_social'
  | 'trade_tariff'
  | 'procurement_public'
  | 'other';

const REGULATION_AXES: RegulationAxis[] = [
  'price_regulation', 'subsidy_incentive', 'competition_antitrust',
  'environmental_climate', 'data_privacy_tech', 'labor_social',
  'trade_tariff', 'procurement_public', 'other',
];

/** Deutsche Suchbegriffe je Achse — Überbegriffe, KEINE Programmnamen (§8.1). */
const AXIS_SEARCH_TERMS: Record<RegulationAxis, string> = {
  price_regulation: "Preisregulierung / staatliche Preisdeckel / Erstattungsregeln",
  subsidy_incentive: "Subventionen / Steueranreize / Förderprogramme (Kürzung oder Ausweitung)",
  competition_antitrust: "Wettbewerbsrecht / Kartellverfahren / Entflechtung",
  environmental_climate: "Umwelt- und Klimaauflagen / Emissionsgrenzwerte / CO2-Bepreisung",
  data_privacy_tech: "Datenschutz / Plattformregulierung / KI-Regulierung",
  labor_social: "Arbeitsrecht / Mindestlohn / Sozialabgaben",
  trade_tariff: "Zölle / Handelsbeschränkungen / Exportkontrollen",
  procurement_public: "Öffentliche Beschaffung / Vergaberecht / Buy-Local-Vorgaben",
  other: "Sonstige sektorspezifische Regulierung",
};

export type TimeHorizon = '0-12m' | '12-24m' | '24-36m' | 'structural';
export type Confidence = 'low' | 'medium' | 'high';

export interface RegulatoryExposureRaw {
  country: string;
  regulationAxis: RegulationAxis;
  title: string;
  description: string;
  /** Umsatzanteil des Unternehmens im betroffenen Land (0–1) */
  revenueShareInCountry: number | null;
  /** Geschätzte Umsatzwirkung im betroffenen Land (z.B. -0.08 = -8 %) */
  estimatedImpactOnSales: number | null;
  probability: number;   // 0–1
  timeHorizon: TimeHorizon;
  source: { url: string; publishedAt: string; snippet: string };
  confidence: Confidence;
}

export interface RegulatoryExposureScored extends RegulatoryExposureRaw {
  /** §8.5 — EPS-Impact in $ pro Aktie (probability- und zeitgewichtet) */
  epsImpact: number | null;
  /** §8.7 — besteht die Test-Matrix (Gate = Ja)? */
  material: boolean;
  /** Nur-Badge-Anzeige (confidence=low, aber nicht verworfen) */
  badgeOnly: boolean;
}

export interface RegulatoryGate {
  id: 'REGULATORY_EXPOSURE';
  active: boolean;
  cap: number;
  severity: 'hard' | 'warn';
  rationale: string;
}

export interface RegulatoryAssessment {
  ticker: string;
  exposures: RegulatoryExposureScored[];
  /** Anzahl vom Confidence-Filter verworfener Roh-Treffer (§8.6) */
  discarded: number;
  gate: RegulatoryGate | null;
  modelUsed: string;
  generatedAt: string;
}

// ─── §8.4 Query-Builder — generisch, ohne Fixnamen ────────────────────────────
/**
 * Baut die Such-/Analyseachsen aus Sektor + Branche + Top-Umsatzländern.
 * Bewusst KEINE konkreten Programmnamen — Entdeckung übernimmt das LLM.
 */
export function buildRegulatorySearchQueries(params: {
  sector: string;
  industry: string;
  topCountries: { countryOrRegion: string; percentage: number }[];
}): string[] {
  const countries = params.topCountries
    .filter(c => c.percentage >= 5) // nur materielle Umsatzländer
    .slice(0, 4);
  const queries: string[] = [];
  for (const c of countries) {
    for (const axis of REGULATION_AXES) {
      if (axis === 'other') continue;
      queries.push(
        `${AXIS_SEARCH_TERMS[axis]} — Auswirkungen auf ${params.industry || params.sector} in ${c.countryOrRegion} (Umsatzanteil ${c.percentage.toFixed(0)} %)`
      );
    }
  }
  return queries;
}

// ─── §8.5 EPS-Impact ──────────────────────────────────────────────────────────
export function calcRegulatoryEpsImpact(
  reg: Pick<RegulatoryExposureRaw, 'revenueShareInCountry' | 'estimatedImpactOnSales' | 'probability' | 'timeHorizon'>,
  context: { totalRevenue: number; operatingMargin: number; sharesOutstanding: number; taxRate?: number }
): number | null {
  if (reg.revenueShareInCountry == null || reg.estimatedImpactOnSales == null) return null;
  if (context.totalRevenue <= 0 || context.sharesOutstanding <= 0) return null;
  const taxRate = context.taxRate ?? 0.21;
  const revenueImpact = context.totalRevenue * reg.revenueShareInCountry * reg.estimatedImpactOnSales;
  const ebitImpact = revenueImpact * context.operatingMargin;
  const netIncomeImpact = ebitImpact * (1 - taxRate);
  const epsImpactRaw = netIncomeImpact / context.sharesOutstanding;
  const timeDecay =
    reg.timeHorizon === '0-12m' ? 1.0 :
    reg.timeHorizon === '12-24m' ? 0.75 :
    reg.timeHorizon === '24-36m' ? 0.55 : 0.40;
  return Math.round(epsImpactRaw * reg.probability * timeDecay * 100) / 100;
}

// ─── §8.6 Confidence-Filter ───────────────────────────────────────────────────
/**
 * verworfen:  probability < 0.25 ODER fehlende Quelle
 * low:        nicht gate-wirksam, nur Badge
 * medium/high: gate-fähig (Matrix entscheidet)
 */
export function applyConfidenceFilter(
  raw: RegulatoryExposureRaw[]
): { kept: RegulatoryExposureRaw[]; discarded: number } {
  let discarded = 0;
  const kept = raw.filter(r => {
    if (r.probability < 0.25) { discarded++; return false; }
    if (!r.source?.url || r.source.url.trim() === "") { discarded++; return false; }
    return true;
  });
  return { kept, discarded };
}

// ─── §8.7 Test-Matrix (Gate-Entscheidung) ─────────────────────────────────────
export interface MatrixDecision {
  gate: boolean;
  cap: number | null;
  severity: 'hard' | 'warn' | null;
  row: number | null;
}

export function matrixDecision(
  confidence: Confidence,
  estimatedImpactOnSales: number | null,
  probability: number
): MatrixDecision {
  const none: MatrixDecision = { gate: false, cap: null, severity: null, row: null };
  if (estimatedImpactOnSales == null) return none;
  const impact = Math.abs(estimatedImpactOnSales); // §8.7: Betrag der Umsatzwirkung
  if (probability < 0.25) return { ...none, row: 7 };          // Nr 7
  if (impact < 0.03) return { ...none, row: 6 };               // Nr 6
  if (confidence === 'low') return { ...none, row: 5 };        // Nr 5
  if (confidence === 'high') {
    if (impact >= 0.05 && probability >= 0.55) return { gate: true, cap: 55, severity: 'hard', row: 1 };
    if (impact >= 0.03 && impact < 0.05 && probability >= 0.50) return { gate: true, cap: 65, severity: 'warn', row: 2 };
  }
  if (confidence === 'medium') {
    if (impact >= 0.05 && probability >= 0.60) return { gate: true, cap: 65, severity: 'warn', row: 3 };
    if (impact >= 0.03 && impact < 0.05 && probability >= 0.55) return { gate: true, cap: 70, severity: 'warn', row: 4 };
  }
  return none;
}

// ─── §8.8 REGULATORY_EXPOSURE-Gate ────────────────────────────────────────────
export function buildRegulatoryGate(
  scored: RegulatoryExposureScored[]
): RegulatoryGate | null {
  const material = scored.filter(r => r.material);
  if (material.length === 0) return null;

  // §8.7 Kumulierung: gewichteter Umsatz-Impact (Share × Impact × Probability)
  const cumWeighted = material.reduce((s, r) => {
    if (r.revenueShareInCountry == null || r.estimatedImpactOnSales == null) return s;
    const w = r.revenueShareInCountry * r.estimatedImpactOnSales * r.probability;
    return s + (w < 0 ? Math.abs(w) : 0); // nur negative Exposures kumulieren
  }, 0);

  const totalNegativeEps = material
    .filter(r => (r.epsImpact ?? 0) < 0)
    .reduce((s, r) => s + (r.epsImpact ?? 0), 0);

  // Härtester Einzel-Cap aus der Matrix
  const caps = material
    .map(r => matrixDecision(r.confidence, r.estimatedImpactOnSales, r.probability))
    .filter(d => d.gate && d.cap != null);
  let cap = Math.min(...caps.map(d => d.cap!));
  let severity: 'hard' | 'warn' = caps.some(d => d.severity === 'hard') ? 'hard' : 'warn';

  // Kumulierungs-Regel: ≥ 7 % gewichteter Umsatz-Impact → immer Cap 55 / hard
  if (cumWeighted >= 0.07) { cap = 55; severity = 'hard'; }
  // §8.8: starker kumulierter EPS-Schaden verschärft
  if (totalNegativeEps < -1.5) cap = Math.min(cap, 55);
  if (totalNegativeEps < -1.0) severity = 'hard';

  // Rationale nennt den ENTDECKTEN Titel — keine Fixliste (§8.8)
  const top = [...material].sort((a, b) => (a.epsImpact ?? 0) - (b.epsImpact ?? 0))[0];
  return {
    id: 'REGULATORY_EXPOSURE',
    active: true,
    cap,
    severity,
    rationale: `Materielles Risiko: ${top.title} (${top.country})`,
  };
}

// ─── §8.4 LLM-Discovery — Prompt ohne Fixnamen ────────────────────────────────

function axisList(): string {
  return REGULATION_AXES.map(a => `"${a}"`).join(" | ");
}

export async function discoverRegulatoryExposures(input: {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description?: string;
  topCountries: { countryOrRegion: string; percentage: number }[];
}): Promise<{ exposures: RegulatoryExposureRaw[]; modelUsed: string } | null> {
  if (!isLLMAvailable()) return null;

  const countriesTxt = input.topCountries
    .filter(c => c.percentage >= 5)
    .slice(0, 4)
    .map(c => `${c.countryOrRegion} (${c.percentage.toFixed(0)} % vom Umsatz)`)
    .join(", ") || "unbekannt";

  const queries = buildRegulatorySearchQueries({
    sector: input.sector, industry: input.industry, topCountries: input.topCountries,
  });

  // WICHTIG (§8.1/§8.4): Der Prompt nennt bewusst KEINE konkreten Gesetze oder
  // Programme — nur generische Achsen. Das LLM entdeckt und benennt die
  // konkreten Regime selbst ("Treffer werden erst NACH Extraktion benannt").
  const prompt = `Du bist ein Regulierungs-Analyst für Aktienanalysen. Identifiziere die materiellen regulatorischen und tarifären Risiken/Chancen für dieses Unternehmen.

UNTERNEHMEN: ${input.companyName} (${input.ticker})
SEKTOR: ${input.sector} | BRANCHE: ${input.industry}
TOP-UMSATZLÄNDER: ${countriesTxt}
${input.description ? `PROFIL: ${input.description.substring(0, 350)}` : ""}

ANALYSE-ACHSEN (generisch — du benennst die konkreten Regime selbst):
${queries.slice(0, 12).map((q, i) => `${i + 1}. ${q}`).join("\n")}

REGELN:
- Maximal 5 Einträge, nur MATERIELLE Exposures (erwartete Umsatzwirkung im Land ≥ 3 %). Lieber 1-2 belastbare als 5 spekulative.
- Negative UND positive Wirkungen möglich (estimatedImpactOnSales negativ = Belastung, positiv = Rückenwind).
- probability = realistische Eintritts-/Fortbestandswahrscheinlichkeit (0-1). KEINE Einträge unter 0.25.
- source: verweise auf die offizielle Regulierungsbehörde/Gesetzgebungsquelle oder etablierte Finanzpresse. Wenn du keine belastbare Quelle kennst: Eintrag WEGLASSEN.
- confidence: "high" nur bei verabschiedeter/aktiver Regulierung, "medium" bei konkretem Verfahren/Entwurf, "low" bei Spekulation.
- revenueShareInCountry: Anteil des Konzernumsatzes im betroffenen Land als Dezimalzahl (nutze die Umsatzanteile oben).
- Alle Texte auf DEUTSCH.

Antworte NUR mit JSON:
{
  "exposures": [
    {
      "country": "Land/Region",
      "regulationAxis": ${axisList()},
      "title": "Konkreter, vom dir entdeckter Name des Regimes/Verfahrens",
      "description": "2-3 Sätze: Mechanismus und Wirkung auf das Unternehmen",
      "revenueShareInCountry": 0.45,
      "estimatedImpactOnSales": -0.06,
      "probability": 0.6,
      "timeHorizon": "0-12m" | "12-24m" | "24-36m" | "structural",
      "source": { "url": "https://…", "publishedAt": "YYYY-MM", "snippet": "Kernaussage der Quelle" },
      "confidence": "low" | "medium" | "high"
    }
  ]
}`;

  const result = await callLLMJson({
    prompt,
    maxTokens: 2200,
    temperature: 0.3,
    systemPrompt: "Du bist ein präziser Regulierungs-Analyst. Antworte ausschließlich mit validem JSON. Erfinde keine Quellen — lasse Einträge ohne belastbare Quelle weg.",
  });
  if (!result?.data) return null;

  const rawList: any[] = Array.isArray(result.data?.exposures) ? result.data.exposures
    : Array.isArray(result.data) ? result.data : [];

  const exposures: RegulatoryExposureRaw[] = rawList
    .filter(e => e && typeof e.title === "string" && typeof e.country === "string")
    .map(e => ({
      country: String(e.country),
      regulationAxis: REGULATION_AXES.includes(e.regulationAxis) ? e.regulationAxis : 'other',
      title: String(e.title).substring(0, 160),
      description: String(e.description ?? "").substring(0, 500),
      revenueShareInCountry: typeof e.revenueShareInCountry === "number" ? Math.max(0, Math.min(1, e.revenueShareInCountry)) : null,
      estimatedImpactOnSales: typeof e.estimatedImpactOnSales === "number" ? Math.max(-1, Math.min(1, e.estimatedImpactOnSales)) : null,
      probability: typeof e.probability === "number" ? Math.max(0, Math.min(1, e.probability)) : 0,
      timeHorizon: (['0-12m', '12-24m', '24-36m', 'structural'] as TimeHorizon[]).includes(e.timeHorizon) ? e.timeHorizon : 'structural',
      source: {
        url: String(e.source?.url ?? ""),
        publishedAt: String(e.source?.publishedAt ?? ""),
        snippet: String(e.source?.snippet ?? "").substring(0, 250),
      },
      confidence: (['low', 'medium', 'high'] as Confidence[]).includes(e.confidence) ? e.confidence : 'low',
    }));

  return { exposures, modelUsed: result.modelUsed };
}

// ─── Gesamtpipeline (§8.9) ────────────────────────────────────────────────────

// 24h-Cache pro Ticker (LLM-Kosten sparen; Regulierung ändert sich nicht stündlich)
const _cache = new Map<string, { data: RegulatoryAssessment; time: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Liest ein bereits vorhandenes Regulatory-Assessment aus dem In-Memory-Cache,
 * OHNE einen neuen LLM-Call auszulösen (Punkt 1, HOCH-Ticket 05.08.2026:
 * REGULATORY-Gate an die Scoring-Pipeline verdrahten).
 *
 * WARUM non-blocking/read-only: Die Regulatory-Analyse ist bewusst lazy — sie
 * laeuft nur, wenn der Nutzer das PESTEL-KI-Panel im Frontend oeffnet (POST
 * /api/regulatory, eigener LLM-Call, eigener Cache-Eintrag). /api/analyze
 * selbst ruft assessRegulatoryExposure() NICHT auf (kein zusaetzlicher LLM-
 * Roundtrip bei jeder Analyse — das waere teuer und die Aufgabenstellung
 * verlangt ausdruecklich, nur die Verdrahtung zu aendern, nicht die
 * bestehende Lazy-Loading-Architektur). Diese Funktion liest daher nur, was
 * ggf. bereits vom PESTEL-Panel-Aufruf im Cache liegt (24h TTL, siehe oben).
 * Wurde die Regulatory-Analyse fuer diesen Ticker noch nie ausgefuehrt, gibt
 * es hier `null` — das REGULATORY_EXPOSURE-Gate bleibt dann in buildGates()
 * korrekt inaktiv (kein Fake-Default, exakt wie in der Aufgabenstellung
 * gefordert).
 */
export function getCachedRegulatoryAssessment(ticker: string): RegulatoryAssessment | null {
  const key = ticker.toUpperCase();
  const cached = _cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.time >= CACHE_TTL_MS) return null; // abgelaufen -> wie "nicht vorhanden" behandeln
  return cached.data;
}

export async function assessRegulatoryExposure(input: {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description?: string;
  topCountries: { countryOrRegion: string; percentage: number }[];
  totalRevenue: number;
  operatingMargin: number;
  sharesOutstanding: number;
  taxRate?: number;
  force?: boolean;
}): Promise<RegulatoryAssessment | null> {
  const key = input.ticker.toUpperCase();
  const cached = _cache.get(key);
  if (!input.force && cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data;

  const discovery = await discoverRegulatoryExposures(input);
  if (!discovery) return null;

  const { kept, discarded } = applyConfidenceFilter(discovery.exposures);

  const scored: RegulatoryExposureScored[] = kept.map(r => {
    const decision = matrixDecision(r.confidence, r.estimatedImpactOnSales, r.probability);
    return {
      ...r,
      epsImpact: calcRegulatoryEpsImpact(r, {
        totalRevenue: input.totalRevenue,
        operatingMargin: input.operatingMargin,
        sharesOutstanding: input.sharesOutstanding,
        taxRate: input.taxRate,
      }),
      material: decision.gate,
      badgeOnly: !decision.gate && r.confidence === 'low',
    };
  });

  const assessment: RegulatoryAssessment = {
    ticker: key,
    exposures: scored,
    discarded,
    gate: buildRegulatoryGate(scored),
    modelUsed: discovery.modelUsed,
    generatedAt: new Date().toISOString(),
  };

  _cache.set(key, { data: assessment, time: Date.now() });
  console.log(
    `[REGULATORY] ${key}: ${scored.length} Exposures (${discarded} verworfen), ` +
    `Gate ${assessment.gate ? `AKTIV cap=${assessment.gate.cap} ${assessment.gate.severity}` : 'inaktiv'} | ${discovery.modelUsed}`
  );
  return assessment;
}
