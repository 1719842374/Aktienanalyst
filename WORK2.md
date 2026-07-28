# WORK2.md — TEIL 8 (Regulatory, Geo, Zölle, PESTEL, FRED)

> Stand: 28.07.2026  
> Ergänzung zu WORK.md (TEIL 0–7 bleiben in WORK.md).  
> Quelle: Chat 27.–28.07.2026  
> Regel: Nur Dokumentation. Implementierung lokal → PR → Review.

---

# TEIL 8 — REGULATORY EXPOSURE, GEOGRAPHIC SEGMENTATION, ZÖLLE & PESTEL-INTEGRATION

## 8.1 Kernprinzip

**Qualitätsprämie nur durch Zahlen, nicht durch Narrative.**  
Regulatorische und tarifäre Risiken müssen quantifiziert (EPS-Impact + Probability) und gate-fähig sein.

## 8.2 Datenmodell

```ts
export interface RegulatoryExposureRaw {
  country: string;
  regulationType: 'drug_pricing' | 'medicaid_medicare' | 'ira' | 'antitrust' | 'carbon' | 'data_privacy' | 'subsidy' | 'other';
  title: string;
  description: string;
  revenueShareInCountry: number | null;
  estimatedImpactOnSales: number | null;
  probability: number;
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
  countryOrRegion: string;
  revenue: number;
  percentage: number;
  year: number;
}

export interface EnrichedGeoExposure {
  countryOrRegion: string;
  revenueShare: number;
  revenueAbsolute: number;
  regulatoryRisks: RegulatoryExposureRaw[];
  tariffRisks: TariffExposure[];
  overallRiskScore: number;
}

export interface FredObservation {
  date: string;
  value: number | null;
}

export interface MacroSnapshot {
  nominal10Y: number | null;
  real10Y: number | null;
  breakeven10Y: number | null;
  inflationYoY: number | null;
  coreInflationYoY: number | null;
  gdpGrowth: number | null;
  unemployment: number | null;
  policyUncertainty: number | null;
  usdEur: number | null;
  usdCny: number | null;
  asOf: string;
  source: 'fred';
}

export interface CompanyTechMetrics {
  rdIntensity: number | null;
  capexIntensity: number | null;
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
Unternehmen: {ticker} ({companyName}) | Sektor: {sector} | Datum: {currentDate}
Wichtigste Umsatzländer: {topCountries}

Extrahiere material relevante:
A) Regulatorische Risiken (Medicaid, IRA, Antitrust, Carbon, Data Privacy, Subventionen)
B) Zölle / Handelsbarrieren (Section 301, CBAM, Auto-Zölle, Retorsion)

Nur Fakten + Quelle + Datum. Keine Bewertung. Output als JSON:
{ "regulatory": [...], "tariffs": [...] }
```

## 8.5 EPS-Impact

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

## 8.6 Confidence-Filter

- high/medium → gate-wirksam + UI
- low → nur UI (Badge), kein Gate
- probability < 0.25 oder fehlende Quelle → verworfen

## 8.7 Test-Matrix

| Confidence | |Impact| | Probability | Gate? | Cap | Severity |
|------------|---------|-------------|---------|-----|----------|
| high | ≥ 5 % | ≥ 0.55 | Ja | 55 | hard |
| high | 3–5 % | ≥ 0.50 | Ja | 65 | warn |
| medium | ≥ 5 % | ≥ 0.60 | Ja | 65 | warn |
| medium | 3–5 % | ≥ 0.55 | Ja | 70 | warn |
| low | * | * | Nein | — | — |
| * | < 3 % | * | Nein | — | — |
| * | * | < 0.25 | Nein | — | — |

Kumulierung ≥ 7 % gewichteter negativer Umsatz-Impact → Cap 55 / hard.

## 8.8 REGULATORY_EXPOSURE-Gate

```ts
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

## 8.9 PESTEL Political/Legal

`buildPestelPoliticalLegal(enrichedGeo, gates)` — Länderkarten mit Revenue-Share, Risk-Score, Regulatory + Zölle, Gate-Hinweis.

## 8.10 Pipeline

```
FMP Geo → Top-Länder → LLM Search (Regulatory+Tariffs) → Confidence-Filter
  → Gates (med/high) + PESTEL Political/Legal + Katalysatoren + Verdict
```

## 8.11 Umsetzungsschritte

- [ ] Interfaces in shared/schema.ts
- [ ] fetchGeographicSegments + normalizeGeoName
- [ ] LLM-Prompt + fetchRegulatoryAndTariffExposuresSafe
- [ ] calcRegulatoryEpsImpact + processRegulatoryExposures
- [ ] Confidence-Filter + REGULATORY_EXPOSURE-Gate
- [ ] PESTEL Political/Legal Frontend
- [ ] FRED MacroSnapshot + CompanyTech (8.12)
- [ ] Economic + Technological Blöcke

---

## 8.12 PESTEL-Datenquellen: FRED + Company-Tech + Economic/Technological

### FRED Fetch

```ts
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

export async function fetchFredSeries(seriesId: string, options: { limit?: number; sortOrder?: 'asc'|'desc' } = {}): Promise<FredObservation[]> {
  const key = process.env.FRED_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    series_id: seriesId, api_key: key, file_type: 'json',
    sort_order: options.sortOrder ?? 'desc', limit: String(options.limit ?? 12),
  });
  try {
    const res = await fetch(`${FRED_BASE}?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.observations ?? [])
      .map((o: any) => ({ date: o.date, value: o.value === '.' ? null : Number(o.value) }))
      .filter((o: FredObservation) => o.value !== null && !Number.isNaN(o.value));
  } catch { return []; }
}

export async function fetchFredLatest(seriesId: string): Promise<number | null> {
  const s = await fetchFredSeries(seriesId, { limit: 3, sortOrder: 'desc' });
  return s[0]?.value ?? null;
}

export async function fetchFredYoY(seriesId: string): Promise<number | null> {
  const s = await fetchFredSeries(seriesId, { limit: 15, sortOrder: 'desc' });
  if (s.length < 13) return null;
  const cur = s[0].value, prev = s[12].value;
  if (cur == null || prev == null || prev === 0) return null;
  return (cur / prev - 1) * 100;
}

export async function buildMacroSnapshot(): Promise<MacroSnapshot> {
  const [nominal10Y, real10Y, breakeven10Y, inflationYoY, coreInflationYoY,
         gdpGrowth, unemployment, policyUncertainty, usdEur, usdCny] = await Promise.all([
    fetchFredLatest('DGS10'), fetchFredLatest('DFII10'), fetchFredLatest('T10YIE'),
    fetchFredYoY('CPIAUCSL'), fetchFredYoY('CPILFESL'),
    fetchFredLatest('A191RL1Q225SBEA'), fetchFredLatest('UNRATE'),
    fetchFredLatest('USEPUINDXD'), fetchFredLatest('DEXUSEU'), fetchFredLatest('DEXCHUS'),
  ]);
  return {
    nominal10Y, real10Y, breakeven10Y, inflationYoY, coreInflationYoY,
    gdpGrowth, unemployment, policyUncertainty, usdEur, usdCny,
    asOf: new Date().toISOString().slice(0, 10), source: 'fred',
  };
}
```

**Env:** `FRED_API_KEY` (kostenlos: https://fred.stlouisfed.org/docs/api/api_key.html)

### Company-Tech (FMP)

```ts
export async function fetchCompanyTechMetrics(ticker: string): Promise<CompanyTechMetrics> {
  try {
    const [income, cashflow] = await Promise.all([
      fmpGet<any[]>(`/income-statement`, { symbol: ticker, limit: '1' }),
      fmpGet<any[]>(`/cash-flow-statement`, { symbol: ticker, limit: '1' }),
    ]);
    const inc = income?.[0], cf = cashflow?.[0];
    if (!inc) return { rdIntensity: null, capexIntensity: null, rdAbsolute: null, capexAbsolute: null };
    const revenue = inc.revenue ?? 0;
    const rd = inc.researchAndDevelopmentExpenses ?? 0;
    const capex = Math.abs(cf?.capitalExpenditure ?? 0);
    return {
      rdAbsolute: rd, capexAbsolute: capex,
      rdIntensity: revenue > 0 ? rd / revenue : null,
      capexIntensity: revenue > 0 ? capex / revenue : null,
    };
  } catch {
    return { rdIntensity: null, capexIntensity: null, rdAbsolute: null, capexAbsolute: null };
  }
}
```

### Economic- & Technological-Builder

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
    metrics: { real10Y: macro.real10Y, inflationYoY: macro.inflationYoY, gdpGrowth: macro.gdpGrowth, unemployment: macro.unemployment, policyUncertainty: macro.policyUncertainty },
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
      ? `R&D ${(tech.rdIntensity * 100).toFixed(1)} % · Capex ${tech.capexIntensity != null ? (tech.capexIntensity * 100).toFixed(1) + ' %' : 'n/a'}`
      : 'Keine ausreichenden Tech-Metriken.',
    metrics: tech, flags,
  };
}
```

### Gesamt-Builder

```ts
export async function buildFullPestelInput(params: {
  ticker: string; companyName: string; sector: string;
}): Promise<PestelInput> {
  const { ticker, companyName, sector } = params;
  const [geoSegments, macro, companyTech] = await Promise.all([
    fetchGeographicSegments(ticker),
    buildMacroSnapshot(),
    fetchCompanyTechMetrics(ticker),
  ]);
  const topCountries = geoSegments.filter(s => s.percentage >= 8).map(s => s.countryOrRegion).slice(0, 4);
  const { regulatory, tariffs } = await fetchRegulatoryAndTariffExposuresSafe({
    ticker, companyName, sector,
    topCountries: topCountries.length ? topCountries : ['USA', 'China', 'Europe'],
  });
  return { ticker, companyName, sector, geoSegments, regulatory, tariffs, macro, companyTech };
}

export async function buildPestelAnalysis(params: {
  ticker: string; companyName: string; sector: string; gates?: Gate[];
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
    meta: { asOf: input.macro.asOf, topCountries: input.geoSegments.slice(0, 4).map(g => g.countryOrRegion) },
  };
}
```

### Datenquellen-Übersicht

| Dimension | Primärquelle | Sekundär |
|-----------|--------------|----------|
| Political | Regulatory + Geo + LLM | FRED Policy Uncertainty |
| Economic | FRED (Zinsen, Inflation, GDP, UNRATE) | LLM |
| Social | LLM / News | — |
| Technological | FMP R&D + Capex | LLM Disruption |
| Environmental | LLM (CBAM, Klima) | — |
| Legal | Regulatory Exposure | LLM Verfahren |

**Regel:** Nur Dokumentation. Implementierung lokal → PR → Review.
