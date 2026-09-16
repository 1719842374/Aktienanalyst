# WORK_VALUECHAIN_LAB_LOOKUP.md

> **Stand: 16.09.2026 22:56 CEST**
> Feature: Value-Chain-Lookup
> Parent: WORK_THESIS_LAB.md · Catalog: server/valuechain-catalog.ts

Lab-Stufe zu Catalog-industryKey ist eine feste Tabelle, kein LLM.

| Lab-Stage | Ticker | industryKey | n Thesen | Ampel |
|---|---|---|---|---|
| memory | MU, 000660.KS | semiconductors | 1 | Rot 87% |
| process_lockin | VACN.SW, IFCN.SW, SMHN.DE | semiconductors | 1 | Gelb 59% |
| agent_runtime | CRM, NOW | software-infrastructure | 1 | Gelb 45% |
| physical_motion | 6324.T, 6268.T | auto-manufacturers + aerospace-defense | 1 | Gelb 61% |
| farm_os | DE, AGCO | food-agri | 1 | Rot 83% |
| agent_liability | CB | payments-market-infra | 1 | Grau |

API: GET /api/lab/lookup?ticker=|stage=|industry=  und GET /api/lab/valuechain-map
Dateien: server/thesis-lab-valuechain-map.ts, server/thesis-lab-routes.ts
Value-Chain-Screener unverändert. Kein FMP-Call im Lookup.
