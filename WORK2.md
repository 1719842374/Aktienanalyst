# WORK2.md — TEIL 8 (Regulatory, Geo, Zölle, PESTEL, FRED)

> Stand: 28.07.2026  
> Regel: Nur Dokumentation. Implementierung lokal → PR → Review.

---

# TEIL 8 — REGULATORY EXPOSURE, GEOGRAPHIC SEGMENTATION, ZÖLLE & PESTEL

## 8.1 Kernprinzip

**Qualitätsprämie nur durch Zahlen, nicht durch Narrative.**  
Regulatorische und tarifäre Risiken quantifizieren (EPS-Impact + Probability) und gate-fähig machen.

**Anti-Hardcoding:** Der Agent sucht **nicht** bei jedem Run nach festen Programmnamen  
(Medicaid, IRA, Section 301, CBAM, …). Stattdessen:

1. **Kontext** aus Sektor / Branche / Top-Umsatzländern  
2. **Überbegriffe** als Suchachsen (Subventionen, Preisregulierung, Wettbewerbsrecht, …)  
3. **Entdeckung** über LLM-Search + optional X-Verknüpfungen  
4. Treffer werden erst **nach** Extraktion benannt (welches konkrete Regime auch immer)

---

## 8.2 Datenmodell

```ts
/** regulationType = grobe Achse, NICHT der Programmname */
export type RegulationAxis =
  | 'price_regulation'      // Arzneimittelpreise, Utility-Tarife, Mietpreis, …
  | 'subsidy_incentive'     // Subventionen, Tax Credits, Grants (Zu- oder Wegfall)
  | 'competition_antitrust'
  | 'environmental_climate'
  | 'data_privacy_tech'
  | 'labor_social'
  | 'trade_tariff'           // Zölle, CBAM-ähnlich, Exportkontrollen — als Achse
  | 'procurement_public'    // öffentliche Auftrags-/Budgetregeln
  | 'other';

export interface RegulatoryExposureRaw {
  country: string;
  regulationAxis: RegulationAxis;   // generische Achse
  title: string;                    // konkreter Name erst nach Discovery
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
```

---

## 8.3 Geographic Segmentation (FMP)

`fetchGeographicSegments(ticker)` → Top-Länder mit Revenue-Share.  
Diese Liste steuert die **Suchkontexte** in 8.4 (nicht eine globale Fixliste).

---

## 8.4 LLM-Prompt & Discovery (Regulatory + Zölle) — generisch

### 8.4.1 Designziel

```
FALSCH:  "Suche Medicaid, IRA, Section 301, CBAM …"  (hardcoded Programme)
RICHTIG: Kontext (Sektor, Branche, Länder) + Überbegriffe
         → LLM/X findet aktuelle, material relevante Regime von selbst
```

Der Agent ist ein **Extraktions-Assistent**, kein Keyword-Scanner für US-Gesundheitsgesetze.

### 8.4.2 Suchachsen (Überbegriffe, stabil)

| Achse | Beispiel-Queries (dynamisch mit Sektor/Land) |
|-------|-----------------------------------------------|
| Subventionen / Anreize | `{sector} subsidies {country}`, `state aid {sector}`, `tax credit phase-out` |
| Preisregulierung | `{sector} price regulation {country}`, `reimbursement cuts`, `tariff review` |
| Wettbewerbsrecht | `{company} antitrust`, `{sector} merger control {country}` |
| Umwelt / Klima | `{sector} carbon cost {country}`, `emissions trading exposure` |
| Datenschutz / Tech | `{sector} data privacy enforcement {country}` |
| Handel / Zölle | `{sector} tariffs {exportCountry} {importCountry}`, `trade barrier {product}` |
| Öffentliche Beschaffung | `{sector} public procurement budget {country}` |

Konkrete Eigennamen (IRA, Medicaid, CBAM, …) dürfen **im Treffer** stehen —  
sie werden nur nicht als **Suchpflicht** vorgegeben.

### 8.4.3 Prompt-Vorlage (kein Programm-Hardcoding)

```text
Du bist ein Extraktions-Assistent für regulatorische und handelspolitische Risiken.

Kontext (nur das nutzen, nichts erfinden):
- Unternehmen: {ticker} ({companyName})
- Sektor / Branche: {sector} / {industry}
- Analyse-Datum: {currentDate}
- Wichtigste Umsatzländer (Revenue-Share): {topCountries}

Auftrag:
Finde material relevante Entwicklungen der letzten ~18 Monate, die Umsatz,
Marge oder Zugang in diesen Ländernern für DIESE Branche beeinflussen können.

Arbeite entlang generischer Achsen — nicht entlang einer Fixliste von Gesetzen:
1) Subventionen & staatliche Anreize (Einführung, Kürzung, Auslaufen)
2) Preis- / Erstattungs- / Tarifregulierung
3) Wettbewerbsrecht & Marktzugang
4) Umwelt- und Klimauflage mit Kostenwirkung
5) Datenschutz / Tech-Regulierung (wenn sektorsrelevant)
6) Zölle, Handelsbarrieren, Exportkontrollen zwischen den Umsatzländern
7) Öffentliche Beschaffung / Budgetregeln (wenn sektorsrelevant)

Regeln:
- Keine Bewertung, keine Kauf-/Verkaufsempfehlung.
- Nur Fakten mit Quelle (URL) und Datum (publishedAt).
- Wenn nichts Materiales: leere Arrays zurückgeben.
- Programm-/Gesetzesnamen nur nennen, wenn die Quelle sie so bezeichnet.
- Nicht pauschal US-Gesundheits- oder EU-Klimaregime auflisten, nur weil sie berühmt sind.

Output streng als JSON:
{
  "regulatory": [
    {
      "country": "...",
      "regulationAxis": "subsidy_incentive|price_regulation|competition_antitrust|environmental_climate|data_privacy_tech|labor_social|procurement_public|other",
      "title": "...",
      "description": "...",
      "estimatedImpactOnSales": null,
      "probability": 0.0,
      "timeHorizon": "0-12m|12-24m|24-36m|structural",
      "source": { "url": "...", "publishedAt": "YYYY-MM-DD", "snippet": "..." },
      "confidence": "low|medium|high"
    }
  ],
  "tariffs": [
    {
      "countryOrRegion": "...",
      "title": "...",
      "description": "...",
      "estimatedImpactOnSales": null,
      "probability": 0.0,
      "timeHorizon": "0-12m|12-24m|24-36m|structural",
      "source": { "url": "...", "publishedAt": "YYYY-MM-DD", "snippet": "..." },
      "confidence": "low|medium|high"
    }
  ]
}
```

### 8.4.4 Query-Builder (vor dem LLM, optional Sonar/X)

```ts
/** Baut Suchstrings aus Sektor + Ländernern — ohne Fix-Programmnamen */
export function buildRegulatorySearchQueries(opts: {
  sector: string;
  industry?: string;
  topCountries: string[];
}): string[] {
  const { sector, industry, topCountries } = opts;
  const branch = industry || sector;
  const qs: string[] = [];

  for (const c of topCountries.slice(0, 4)) {
    qs.push(`${branch} regulation OR subsidy OR "price control" OR tariff ${c}`);
    qs.push(`${branch} trade tariff OR "import duty" OR "export control" ${c}`);
  }
  // sektor-globale Achsen ohne Land
  qs.push(`${branch} state aid OR subsidy phase-out OR incentive`);
  qs.push(`${branch} antitrust OR "merger control" enforcement`);
  return [...new Set(qs)].slice(0, 8); // Budget-Deckel
}
```

X / Sonar: dieselben Queries, Results → Prompt als `sourceCandidates` anreichern  
(oder Prompt allein mit Live-Search-Modell).

### 8.4.5 Pipeline-Schritt

```
FMP Geo → topCountries
  → buildRegulatorySearchQueries(sector, industry, topCountries)
  → LLM/Sonar/X Discovery (Überbegriffe + Kontext)
  → JSON Extraktion (Prompt 8.4.3)
  → Confidence-Filter → Gates / PESTEL / Katalysatoren
```

**Nicht:** fester String „Medicaid|IRA|Section 301“ in jedem Run.

---

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
- low → nur UI  
- probability < 0.25 oder fehlende Quelle → verworfen

## 8.7 Test-Matrix

| Confidence | |Impact| | Probability | Gate? | Cap |
|------------|---------|-------------|---------|-----|
| high | ≥ 5 % | ≥ 0.55 | Ja | 55 hard |
| high | 3–5 % | ≥ 0.50 | Ja | 65 warn |
| medium | ≥ 5 % | ≥ 0.60 | Ja | 65 warn |
| low / <3 % Impact / p<0.25 | * | Nein | — |

## 8.8 REGULATORY_EXPOSURE-Gate

Material + negativer EPS → Cap 55/65. Rationale nennt **entdeckten** `title` + `country`  
(nicht eine vordefinierte Programmliste).

## 8.9–8.11 PESTEL / Pipeline / Umsetzung

```
FMP Geo → Query-Builder (Sektor+Land+Überbegriffe)
  → LLM/X Search → Extraktion → Filter → Gates + PESTEL + Verdict
```

- [ ] regulationAxis statt program-enum  
- [ ] Prompt 8.4.3 ohne Fixnamen  
- [ ] buildRegulatorySearchQueries  
- [ ] fetchGeographicSegments  
- [ ] calcRegulatoryEpsImpact + Gate  

---

## 8.12 FRED + Company-Tech + Pestel Economic/Technological

Unverändert: MacroSnapshot (DGS10, DFII10, …), R&D/Capex-Intensität,  
`buildPestelEconomic` / `buildPestelTechnological` / `buildFullPestelInput`.

Environmental/Social weiter LLM-getrieben mit **denselben generischen Achsen**  
(kein Pflicht-Keyword CBAM o.Ä.).

---

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
