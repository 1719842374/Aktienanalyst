# WORK_THESIS_LAB.md

> **Stand: 16.09.2026 22:56 CEST**  
> Status: MVP + Value-Chain-Lookup-Spec  
> Lookup-Details: `WORK_VALUECHAIN_LAB_LOOKUP.md`

## 0) Entscheidung

Lab = eigene Route `/#/lab`. Value Chain = Lookup-Ziel, kein Index. Rotation-Rat = Phase. Ampel = Formel.

## 1) Dateien

| Pfad | Rolle |
|---|---|
| `WORK_THESIS_LAB.md` | Lab-Spec |
| `WORK_VALUECHAIN_LAB_LOOKUP.md` | Lookup-Spec, Mapping, Acceptance |
| `server/thesisLab.ts` | Engine + Fixtures |
| `server/thesis-lab-valuechain-map.ts` | Stage → industryKey |
| `server/thesis-lab-routes.ts` | `/api/lab/*` inkl. lookup |
| `server/routes-register.ts` | registerThesisLabRoutes |
| `server/valuechain-routes.ts` | unverändert Screener |
| `server/valuechain-catalog.ts` | unverändert Keys |
| `client/src/lib/thesisLabTypes.ts` | Types |
| `client/src/components/thesislab/InfoCurvePlot.tsx` | Plot |
| `client/src/pages/ThesisLabDashboard.tsx` | `/#/lab` |
| `client/src/pages/ValueChainDashboard.tsx` | Banner + industry-Query |
| `client/src/components/valuechain/StageColumn.tsx` | Lab-Badge |
| `client/src/App.tsx` | Route `/lab` |
| `client/src/pages/Dashboard.tsx` | Nav Lab |

## 2) API

- GET `/api/lab/theses?ampel=&stage=&q=`
- GET `/api/lab/thesis/:id`
- GET `/api/lab/lookup?ticker=` `|` `stage=` `|` `industry=`
- GET `/api/lab/valuechain-map`
- POST `/api/lab/thesis`

Kein `/api/analyze`, kein FMP im Lookup.

## 3) Ampel

Grau: keine Gegen-These oder dataQuality=low. Rot: pricedIn>70 oder Coverage>80 oder Layer=1. Grün: pricedIn<40 und Coverage<40 und Layer>=2. Sonst Gelb.

Netto = Brutto *(1 - pricedIn/100). GB = PoS * Netto.

## 4) Fixtures

HBM Rot 87%. SaaS Gelb 45%. VAT Gelb 59%. Strain-Wave Gelb 61%. DE Farm-OS Rot 83%. Haftpflicht Grau.

## 5) Value-Chain-Lookup

| Stage | industryKey |
|---|---|
| memory, process_lockin | semiconductors |
| agent_runtime | software-infrastructure |
| physical_motion | auto-manufacturers + aerospace-defense |
| farm_os | food-agri |
| agent_liability | payments-market-infra |

Deep-Links: `/#/valuechain?industry=` und `/#/lab?ticker=`.
Vollständige Tabelle, GB-Zahlen, Acceptance: `WORK_VALUECHAIN_LAB_LOOKUP.md`.
