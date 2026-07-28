# WORK.md

> Stand: 28.07.2026 | Branch: `main`
> Regel: Kein Code-Push über GitHub API ohne lokale Validierung + PR + Review.
> Ausnahme: reine Dokumentations-Updates in WORK.md sind explizit freigegeben.

---

# TEIL 8 — REGULATORY EXPOSURE, GEOGRAPHIC SEGMENTATION, ZÖLLE & PESTEL-INTEGRATION

> Stand: 28.07.2026  
> Quelle: Chat-Verlauf 27.–28.07.2026  
> Ziel: Automatische, länder- und aktienspezifische Erkennung von Regulierungs- und Zollrisiken  
> (Beispiel: Novo Nordisk – US Medicaid / IRA). Kein manuelles Nachziehen über X/News nötig.

## 8.1 Kernprinzip

**Qualitätsprämie nur durch Zahlen, nicht durch Narrative.**  
Regulatorische und tarifäre Risiken müssen quantifiziert (EPS-Impact + Probability) und  
gate-fähig sein – sonst bleiben sie Prosa.

## 8.2 Datenmodell

```ts
export interface RegulatoryExposureRaw {
  country: string;
  regulationType: 'drug_pricing' | 'medicaid_medicare' | 'ira' | 'antitrust' | 'carbon' | 'data_privacy' | 'subsidy' | 'other';
  title: string;
  description: string;
  revenueShareInCountry: number | null;   // 0–1
  estimatedImpactOnSales: number | null;  // z.B. -0.05
  probability: number;                    // 0–1
  timeHorizon: '0-12m' | '12-24m' | '24-36m' | 'structural';
  source: { url: string; publishedAt: string; snippet: string };
  confidence: 'low' | 'medium' | 'high';
}

export interface TariffExposure {
  countryOrRegion: string;
  title: string;
  description: string;
  estimatedImpactOnSales: number | null;
  probability: number;
  timeHorizon: '0-12m' | '12-24m' | '24-36m' | 'structural';
  source: { url: string; publishedAt: string; snippet: string };
  confidence: 'low' | 'medium' | 'high';
}

export interface GeoSegment {
  countryOrRegion: string;  // normalisiert: USA, China, Europe, ...
  revenue: number;
  percentage: number;       // 0–100
  year: number;
}

export interface EnrichedGeoExposure {
  countryOrRegion: string;
  revenueShare: number;     // 0–1
  revenueAbsolute: number;
  regulatoryRisks: RegulatoryExposureRaw[];
  tariffRisks: TariffExposure[];
  overallRiskScore: number; // 0–100
}
```

## 8.3 Geographic Segmentation (FMP)

```ts
export async function fetchGeographicSegments(ticker: string): Promise<GeoSegment[]> {
  const data = await fmpGet<any[]>(`/revenue-geographic-segmentation`, { symbol: ticker });
  if (!Array.isArray(data) || data.length === 0) return [];

  const latest = data[0];
  const year = latest.date ? new Date(latest.date).getFullYear() : new Date().getFullYear();
  const ignoreKeys = ['date', 'symbol', 'reportedCurrency', 'period', 'cik'];

  const entries = Object.entries(latest)
    .filter(([k]) => !ignoreKeys.includes(k) && typeof latest[k] === 'number')
    .map(([rawName, revenue]) => ({ rawName, revenue: revenue as number }));

  const total = entries.reduce((s, e) => s + e.revenue, 0);
  if (total <= 0) return [];

  return entries
    .map(({ rawName, revenue }) => ({
      countryOrRegion: normalizeGeoName(rawName),
      revenue,
      percentage: Math.round((revenue / total) * 1000) / 10,
      year,
    }))
    .filter(s => s.percentage > 0.5)
    .sort((a, b) => b.percentage - a.percentage);
}

function normalizeGeoName(raw: string): string {
  const map: Record<string, string> = {
    'united states': 'USA', 'u.s.': 'USA', 'us': 'USA', 'north america': 'USA',
    'china': 'China', 'greater china': 'China',
    'europe': 'Europe', 'european union': 'Europe', 'germany': 'Germany',
    'japan': 'Japan', 'rest of world': 'ROW', 'other': 'ROW',
  };
  return map[raw.toLowerCase().trim()] ?? raw;
}
```

## 8.4 LLM-Prompt (Regulatory + Zölle)

```text
Du bist ein Extraktions-Assistent für regulatorische und handelspolitische Risiken.

Kontext:
- Unternehmen: {ticker} ({companyName})
- Sektor: {sector}
- Aktuelles Datum: {currentDate}
- Wichtigste Umsatzländer: {topCountries}

Aufgabe:
Extrahiere die aktuellsten material relevanten Informationen zu:
A) Regulatorischen Risiken und Gesetzesänderungen
B) Zöllen, Handelsbarrieren, tarifären Maßnahmen und Subventionsänderungen

Nur Fakten mit klarer Quelle und Datum. Keine Bewertung, keine Adjektive, keine Prognosen.
Fehlende Zahlen nicht schätzen. Bei Unsicherheit confidence senken.

Output ausschließlich als JSON:
{
  "regulatory": [ { country, regulationType, title, description, revenueShareInCountry, estimatedImpactOnSales, probability, timeHorizon, source, confidence } ],
  "tariffs": [ { countryOrRegion, title, description, estimatedImpactOnSales, probability, timeHorizon, source, confidence } ]
}

Sektor-Hinweise:
- Healthcare: Medicaid, Medicare, IRA, Drug Price Negotiation, Volume-Based Procurement (China)
- Auto: CO₂-Flottenziele, Subventionen, US-/EU-/China-Zölle, CBAM
- Tech: Antitrust, DMA, Data Privacy, Exportkontrollen
- Industrials: Stahl-/Aluminium-Zölle, CBAM
```

## 8.5 EPS-Impact Berechnung

```ts
export function calcRegulatoryEpsImpact(
  reg: RegulatoryExposureRaw,
  context: { totalRevenue: number; operatingMargin: number; sharesOutstanding: number; taxRate?: number }
): number | null {
  if (reg.revenueShareInCountry == null || reg.estimatedImpactOnSales == null) return null;

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
```

## 8.6 Confidence-Filter + Fehlerbehandlung

```ts
export function filterByConfidence<T extends { confidence: 'low'|'medium'|'high'; probability: number; source?: { url?: string } }>(
  items: T[],
  options = { minProbability: 0.25, requireSource: true, allowLowForDisplay: true }
) {
  return items.map(item => {
    if (item.probability < options.minProbability) return { item, keep: false, reason: 'probability_too_low' };
    if (options.requireSource && !item.source?.url) return { item, keep: false, reason: 'missing_source' };
    if (item.confidence === 'low') return { item, keep: options.allowLowForDisplay, reason: 'low_confidence_display_only' };
    return { item, keep: true };
  });
}
```

- **high/medium** → gate-wirksam + UI  
- **low** → nur UI (Badge „Low confidence“), kein Gate  
- fehlende Quelle / probability < 0.25 → verworfen

## 8.7 Test-Matrix (Gate-Verhalten)

| Confidence | |Impact| | Probability | Gate? | Cap | Severity |
|------------|---------|-------------|---------|-----|----------|
| high | ≥ 5 % | ≥ 0.55 | Ja | 55 | hard |
| high | 3–5 % | ≥ 0.50 | Ja | 65 | warn |
| medium | ≥ 5 % | ≥ 0.60 | Ja | 65 | warn |
| medium | 3–5 % | ≥ 0.55 | Ja | 70 | warn |
| low | beliebig | beliebig | Nein | — | — |
| beliebig | < 3 % | beliebig | Nein | — | — |
| beliebig | beliebig | < 0.25 | Nein | — | — |

Kumulierung: Summe der gewichteten negativen Impacts ≥ 7 % Umsatz → Cap 55 / hard.

## 8.8 Gate-Erweiterung

```ts
// in buildGates() zusätzlich:
const materialRegs = regulatoryExposures.filter(r => r.isMaterial);
if (materialRegs.length > 0) {
  const totalNegativeEps = materialRegs
    .filter(r => (r.epsImpact ?? 0) < 0)
    .reduce((s, r) => s + (r.epsImpact ?? 0), 0);

  gates.push({
    id: 'REGULATORY_EXPOSURE',
    active: true,
    cap: totalNegativeEps < -1.5 ? 55 : 65,
    severity: totalNegativeEps < -1.0 ? 'hard' : 'warn',
    rationale: `Materielles regulatorisches Risiko: ${materialRegs[0].title} (${materialRegs[0].country})`,
  });
}
```

## 8.9 PESTEL-Integration (Political / Legal)

```ts
export function buildPestelPoliticalLegal(enrichedGeo: EnrichedGeoExposure[], gates: Gate[]) {
  const relevant = enrichedGeo
    .filter(g => g.overallRiskScore >= 20 || g.regulatoryRisks.length || g.tariffRisks.length)
    .sort((a, b) => b.overallRiskScore - a.overallRiskScore);

  const maxScore = relevant[0]?.overallRiskScore ?? 0;
  const riskLevel = maxScore >= 55 ? 'high' : maxScore >= 30 ? 'medium' : 'low';
  const regulatoryGate = gates.find(g => g.id === 'REGULATORY_EXPOSURE' && g.active);

  return {
    summary: relevant.length === 0
      ? 'Keine materialen länderbezogenen Regulierungs- oder Zollrisiken identifiziert.'
      : `Risiken in ${relevant.length} Märkten. Höchstes Exposure: ${relevant[0].countryOrRegion} (Score ${relevant[0].overallRiskScore}).`,
    riskLevel,
    countries: relevant.map(g => ({
      country: g.countryOrRegion,
      revenueShare: g.revenueShare,
      overallRiskScore: g.overallRiskScore,
      regulatory: g.regulatoryRisks,
      tariffs: g.tariffRisks,
    })),
    gateTriggered: !!regulatoryGate,
    gateRationale: regulatoryGate?.rationale,
  };
}
```

Frontend: Länderkarten mit Revenue-Share, Risk-Score, Liste Regulatory + Zölle, Gate-Hinweis.

## 8.10 Gesamt-Pipeline

```
FMP Geographic Segmentation
        ↓
Top-Länder (≥ 8 % Umsatz)
        ↓
LLM Search (Sonar → OpenRouter Fallback) – Regulatory + Tariffs
        ↓
Confidence-Filter
        ↓
┌────────────────────┬──────────────────────┐
│ Gate-Logik         │ PESTEL Political/Legal│
│ (nur med/high)     │ (med/high + low)      │
└────────────────────┴──────────────────────┘
        ↓
Katalysatoren (EPS-Impact) + Verdict/Konfliktmatrix
```

## 8.11 Nächste Umsetzungsschritte

- [ ] Interfaces in `shared/schema.ts`
- [ ] `fetchGeographicSegments` + `normalizeGeoName`
- [ ] LLM-Prompt + `fetchRegulatoryAndTariffExposuresSafe`
- [ ] `calcRegulatoryEpsImpact` + `processRegulatoryExposures`
- [ ] Confidence-Filter
- [ ] REGULATORY_EXPOSURE-Gate in `gates.ts`
- [ ] PESTEL Political/Legal Block + Frontend
- [ ] Anbindung an bestehende Katalysator-Sektion
- [ ] FRED MacroSnapshot + CompanyTech (siehe 8.12)
- [ ] Economic + Technological PESTEL-Blöcke

---

## 8.12 PESTEL-Datenquellen: FRED-Makro + Company-Tech + Economic/Technological

> Ergänzung 28.07.2026 — konkrete Fetch-Funktionen und Builder für die restlichen PESTEL-Dimensionen.

### 8.12.1 Interfaces

```ts
export interface FredObservation {
  date: string;   // YYYY-MM-DD
  value: number | null;
}

export interface MacroSnapshot {
  nominal10Y: number | null;       // DGS10
  real10Y: number | null;          // DFII10
  breakeven10Y: number | null;     // T10YIE
  inflationYoY: number | null;     // CPIAUCSL YoY
  coreInflationYoY: number | null; // CPILFESL YoY
  gdpGrowth: number | null;        // A191RL1Q225SBEA
  unemployment: number | null;     // UNRATE
  policyUncertainty: number | null; // USEPUINDXD
  usdEur: number | null;           // DEXUSEU
  usdCny: number | null;           // DEXCHUS
  asOf: string;
  source: 'fred';
}

export interface CompanyTechMetrics {
  rdIntensity: number | null;      // R&D / Revenue
  capexIntensity: number | null;   // Capex / Revenue
  rdAbsolute: number | null;
  capexAbsolute: number | null;
}

export interface PestelInput {
  ticker: string;
  companyName: string;
  sector: string;
  geoSegments: GeoSegment[];
  regulatory: RegulatoryExposureRaw[];
  tariffs: TariffExposure[];
  macro: MacroSnapshot;
  companyTech: CompanyTechMetrics;
}
```

### 8.12.2 FRED Fetch

```ts
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

export async function fetchFredSeries(
  seriesId: string,
  options: { limit?: number; sortOrder?: 'asc' | 'desc' } = {}
): Promise<FredObservation[]> {
  const key = process.env.FRED_API_KEY;
  if (!key) { console.warn('[FRED] FRED_API_KEY fehlt'); return []; }

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: key,
    file_type: 'json',
    sort_order: options.sortOrder ?? 'desc',
    limit: String(options.limit ?? 12),
  });

  try {
    const res = await fetch(`${FRED_BASE}?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.observations ?? [])
      .map((o: any) => ({ date: o.date, value: o.value === '.' ? null : Number(o.value) }))
      .filter((o: FredObservation) => o.value !== null && !Number.isNaN(o.value));
  } catch {
    return [];
  }
}

export async function fetchFredLatest(seriesId: string): Promise<number | null> {
  const series = await fetchFredSeries(seriesId, { limit: 3, sortOrder: 'desc' });
  return series[0]?.value ?? null;
}

export async function fetchFredYoY(seriesId: string): Promise<number | null> {
  const series = await fetchFredSeries(seriesId, { limit: 15, sortOrder: 'desc' });
  if (series.length < 13) return null;
  const current = series[0].value;
  const yearAgo = series[12].value;
  if (current == null || yearAgo == null || yearAgo === 0) return null;
  return (current / yearAgo - 1) * 100;
}

export async function buildMacroSnapshot(): Promise<MacroSnapshot> {
  const [
    nominal10Y, real10Y, breakeven10Y,
    inflationYoY, coreInflationYoY, gdpGrowth,
    unemployment, policyUncertainty, usdEur, usdCny,
  ] = await Promise.all([
    fetchFredLatest('DGS10'),
    fetchFredLatest('DFII10'),
    fetchFredLatest('T10YIE'),
    fetchFredYoY('CPIAUCSL'),
    fetchFredYoY('CPILFESL'),
    fetchFredLatest('A191RL1Q225SBEA'),
    fetchFredLatest('UNRATE'),
    fetchFredLatest('USEPUINDXD'),
    fetchFredLatest('DEXUSEU'),
    fetchFredLatest('DEXCHUS'),
  ]);

  return {
    nominal10Y, real10Y, breakeven10Y,
    inflationYoY, coreInflationYoY, gdpGrowth,
    unemployment, policyUncertainty, usdEur, usdCny,
    asOf: new Date().toISOString().slice(0, 10),
    source: 'fred',
  };
}
```

**Env:** `FRED_API_KEY` (kostenlos: https://fred.stlouisfed.org/docs/api/api_key.html)

### 8.12.3 Company-Tech aus FMP

```ts
export async function fetchCompanyTechMetrics(ticker: string): Promise<CompanyTechMetrics> {
  try {
    const [income, cashflow] = await Promise.all([
      fmpGet<any[]>(`/income-statement`, { symbol: ticker, limit: '1' }),
      fmpGet<any[]>(`/cash-flow-statement`, { symbol: ticker, limit: '1' }),
    ]);
    const inc = income?.[0];
    const cf = cashflow?.[0];
    if (!inc) return { rdIntensity: null, capexIntensity: null, rdAbsolute: null, capexAbsolute: null };

    const revenue = inc.revenue ?? 0;
    const rd = inc.researchAndDevelopmentExpenses ?? 0;
    const capex = Math.abs(cf?.capitalExpenditure ?? 0);

    return {
      rdAbsolute: rd,
      capexAbsolute: capex,
      rdIntensity: revenue > 0 ? rd / revenue : null,
      capexIntensity: revenue > 0 ? capex / revenue : null,
    };
  } catch {
    return { rdIntensity: null, capexIntensity: null, rdAbsolute: null, capexAbsolute: null };
  }
}
```

### 8.12.4 Economic- & Technological-Builder

```ts
export function buildPestelEconomic(macro: MacroSnapshot) {
  const flags: string[] = [];
  if (macro.real10Y != null && macro.real10Y > 2.0)
    flags.push('Hohe Realzinsen → Belastung für Wachstums- und Langläufer-Assets');
  if (macro.inflationYoY != null && macro.inflationYoY > 3.5)
    flags.push('Erhöhte Inflation → mögliche Margen- und Nachfrage-Risiken');
  if (macro.policyUncertainty != null && macro.policyUncertainty > 150)
    flags.push('Erhöhte Policy Uncertainty → Risikoaufschlag möglich');
  if (macro.unemployment != null && macro.unemployment > 5.0)
    flags.push('Steigende Arbeitslosigkeit → Konsumschwäche-Risiko');

  return {
    summary: flags.length ? flags.join(' · ') : 'Makroumfeld derzeit ohne extreme Ausschläge.',
    metrics: {
      real10Y: macro.real10Y,
      inflationYoY: macro.inflationYoY,
      gdpGrowth: macro.gdpGrowth,
      unemployment: macro.unemployment,
      policyUncertainty: macro.policyUncertainty,
    },
    flags,
  };
}

export function buildPestelTechnological(tech: CompanyTechMetrics, sector: string) {
  const flags: string[] = [];
  if (tech.rdIntensity != null) {
    if (tech.rdIntensity < 0.03 && ['Technology', 'Healthcare', 'Communication Services'].includes(sector))
      flags.push('Niedrige R&D-Intensität relativ zum Sektor → mögliches Innovationsrisiko');
    if (tech.rdIntensity > 0.15)
      flags.push('Hohe R&D-Intensität → starker Technologie-Fokus, aber Ergebnisvolatilität möglich');
  }
  return {
    summary: tech.rdIntensity != null
      ? `R&D-Intensität ${(tech.rdIntensity * 100).toFixed(1)} % · Capex-Intensität ${tech.capexIntensity != null ? (tech.capexIntensity * 100).toFixed(1) + ' %' : 'n/a'}`
      : 'Keine ausreichenden Tech-Metriken verfügbar.',
    metrics: tech,
    flags,
  };
}
```

### 8.12.5 Gesamt-Builder

```ts
export async function buildFullPestelInput(params: {
  ticker: string;
  companyName: string;
  sector: string;
}): Promise<PestelInput> {
  const { ticker, companyName, sector } = params;

  const [geoSegments, macro, companyTech] = await Promise.all([
    fetchGeographicSegments(ticker),
    buildMacroSnapshot(),
    fetchCompanyTechMetrics(ticker),
  ]);

  const topCountries = geoSegments
    .filter(s => s.percentage >= 8)
    .map(s => s.countryOrRegion)
    .slice(0, 4);

  const { regulatory, tariffs } = await fetchRegulatoryAndTariffExposuresSafe({
    ticker, companyName, sector,
    topCountries: topCountries.length ? topCountries : ['USA', 'China', 'Europe'],
  });

  return { ticker, companyName, sector, geoSegments, regulatory, tariffs, macro, companyTech };
}

export async function buildPestelAnalysis(params: {
  ticker: string;
  companyName: string;
  sector: string;
  gates?: Gate[];
}) {
  const input = await buildFullPestelInput(params);
  const enrichedGeo = enrichGeoWithRegulatoryAndTariffs(input.geoSegments, input.regulatory, input.tariffs);

  return {
    politicalLegal: buildPestelPoliticalLegal(enrichedGeo, params.gates ?? []),
    economic: buildPestelEconomic(input.macro),
    technological: buildPestelTechnological(input.companyTech, input.sector),
    social: { summary: 'Über LLM/News zu ergänzen', flags: [] },
    environmental: { summary: 'Über LLM/News zu ergänzen (CBAM, Klima)', flags: [] },
    legal: { summary: 'Über Regulatory Exposure abgedeckt', flags: [] },
    meta: {
      asOf: input.macro.asOf,
      topCountries: input.geoSegments.slice(0, 4).map(g => g.countryOrRegion),
    },
  };
}
```

### 8.12.6 Datenquellen-Übersicht PESTEL

| Dimension | Primärquelle | Sekundär |
|-----------|--------------|----------|
| Political | Regulatory Exposure + Geo + LLM | FRED Policy Uncertainty |
| Economic | FRED (Zinsen, Inflation, GDP, UNRATE) | LLM Zentralbank-Kommentare |
| Social | LLM / News | — |
| Technological | FMP R&D + Capex | LLM Disruption |
| Environmental | LLM (CBAM, Klima) | — |
| Legal | Regulatory Exposure | LLM Verfahren |

**Regel:** Alles Design-Dokumentation. Implementierung lokal → PR → Review.
