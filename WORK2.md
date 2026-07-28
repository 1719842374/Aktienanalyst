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

export interface RegulatoryExposureRaw {
  country: string;
  regulationAxis: RegulationAxis;
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
```

---

## 8.3 Geographic Segmentation (FMP)

`fetchGeographicSegments(ticker)` → Top-Länder mit Revenue-Share.  
Steuert die Suchkontexte in 8.4.

---

## 8.4 LLM-Prompt & Discovery — generisch

**Kein Hardcoding** von Medicaid/IRA/CBAM.  
Kontext = Sektor + Branche + Top-Länder; Suche über Überbegriffe; Discovery via LLM/X.

Suchachsen: Subventionen · Preisregulierung · Wettbewerbsrecht · Umwelt · Datenschutz · Zölle · öffentliche Beschaffung.

Pipeline:

```
FMP Geo → topCountries → Query-Builder → LLM/X → JSON → Confidence-Filter → Gates
```

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

---

## 8.6 Confidence-Filter

| Confidence | Gate-wirksam? | UI |
| --- | --- | --- |
| high | ja | ja |
| medium | ja | ja |
| low | nein | nur Badge |
| probability unter 0.25 | nein | verworfen |
| fehlende Quelle | nein | verworfen |

---

## 8.7 Test-Matrix (Gate-Entscheidung)

Wann wird `REGULATORY_EXPOSURE` aktiv — und mit welchem Cap?

| Nr | Confidence | Impact auf Sales | Probability | Gate | Cap | Severity |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | high | ab 5 Prozent | ab 0.55 | Ja | 55 | hard |
| 2 | high | 3 bis 5 Prozent | ab 0.50 | Ja | 65 | warn |
| 3 | medium | ab 5 Prozent | ab 0.60 | Ja | 65 | warn |
| 4 | medium | 3 bis 5 Prozent | ab 0.55 | Ja | 70 | warn |
| 5 | low | beliebig | beliebig | Nein | — | — |
| 6 | beliebig | unter 3 Prozent | beliebig | Nein | — | — |
| 7 | beliebig | beliebig | unter 0.25 | Nein | — | — |

### Lesart

- **Impact** = Betrag von `estimatedImpactOnSales` (Umsatzwirkung im betroffenen Land)
- **Gate = Ja** → Eintrag geht in `buildGates` / `applyGates`
- **Cap 55** = härtestes Regulatory-Veto (vergleichbar PRICING_POWER)
- **Cap 65–70** = Warn-Deckel, Score darf nicht höher liegen
- **Gate = Nein** = nur Anzeige in PESTEL / UI, kein Score-Deckel

### Kumulierung

Wenn mehrere material negative Exposures zusammen **mindestens 7 Prozent** gewichteter Umsatz-Impact ergeben (Share × Impact × Probability) → immer Cap **55** / hard.

### Beispiele

| Fall | Confidence | Impact | p | Ergebnis |
| --- | --- | --- | --- | --- |
| Starkes Preisregime, klar belegt | high | 8 Prozent | 0.70 | Gate an, Cap 55 hard |
| Moderates Zollrisiko | high | 4 Prozent | 0.55 | Gate an, Cap 65 warn |
| Unklare Schlagzeile | low | 10 Prozent | 0.40 | kein Gate, nur Badge |
| Mini-Effekt | high | 1 Prozent | 0.80 | kein Gate (unter 3 Prozent) |

---

## 8.8 REGULATORY_EXPOSURE-Gate

```ts
// material = besteht Test-Matrix (Gate = Ja)
if (materialRegs.length > 0) {
  const totalNegativeEps = materialRegs
    .filter(r => (r.epsImpact ?? 0) < 0)
    .reduce((s, r) => s + (r.epsImpact ?? 0), 0);
  gates.push({
    id: 'REGULATORY_EXPOSURE',
    active: true,
    cap: totalNegativeEps < -1.5 ? 55 : 65,
    severity: totalNegativeEps < -1.0 ? 'hard' : 'warn',
    rationale: `Materielles Risiko: ${materialRegs[0].title} (${materialRegs[0].country})`,
  });
}
```

Rationale nennt den **entdeckten** Titel — keine Fixliste.

---

## 8.9–8.11 Pipeline / Umsetzung

```
FMP Geo → Query-Builder (Sektor+Land+Überbegriffe)
  → LLM/X → Extraktion → Filter (8.6) → Test-Matrix (8.7) → Gate (8.8) → PESTEL / Verdict
```

- [ ] regulationAxis generisch
- [ ] Prompt ohne Fixnamen
- [ ] buildRegulatorySearchQueries
- [ ] calcRegulatoryEpsImpact + Gate nach Matrix

---

## 8.12 FRED + Company-Tech

MacroSnapshot · R&D/Capex · Pestel Economic/Technological — unverändert.

---

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
