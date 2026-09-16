# WORK_THESIS_LAB.md

> **Stand: 16.09.2026**  
> Status: **MVP implementiert (Fixtures + API + eigene Route)**  
> Parent: Chat-These „KI/Zyklus eingepreist“ + Informationskurve  
> Abgrenzung: **nicht** Researcher-Tab, **nicht** Value-Chain-Index, **nicht** `/api/analyze`

---

## 0) Entscheidung (final)

| Frage | Entscheidung |
|---|---|
| Lab in Researcher-Tabs? | **Nein.** Eigene Hash-Route `/#/lab` |
| Value-Chain-Sektions-Index als Produkt? | **Nein** als handelbarer Index. Value Chain bleibt Lookup-Ziel |
| Sektorrotations-Rat? | **Ja, parallel** (`WORK_SEKTORROTATIONS_RAT.md`) als Makro-Phase |
| Wer färbt die Ampel? | **Deterministische Formel**, LLM nur Scout-Text |
| Analyze auto-triggern? | **Nein** (FMP 750/Tag) |

Schichten:

```
Lab (These + Ampel + Einpreisung)
  → Value Chain (Stufe / industryKey)
  → Ticker-Suche / /#/?ticker= (18 Sektionen)
  → Rotation-Rat (Phase, separat)
```

---

## 1) Dateien

| Pfad | Rolle |
|---|---|
| `WORK_THESIS_LAB.md` | diese Spec |
| `server/thesisLab.ts` | Hash, Einpreisung, Ampel, GB, Fixtures |
| `server/thesis-lab-routes.ts` | `/api/lab/*` |
| `server/routes-register.ts` | `registerThesisLabRoutes(app)` |
| `client/src/lib/thesisLabTypes.ts` | Shared Types |
| `client/src/components/thesislab/InfoCurvePlot.tsx` | SVG-Plot Einpreisung vs. Aufmerksamkeit |
| `client/src/pages/ThesisLabDashboard.tsx` | Dashboard |
| `client/src/App.tsx` | Route `/lab` |
| `client/src/pages/Dashboard.tsx` | Nav-Button **Lab** |

---

## 2) API-Contract

`GET /api/lab/theses?ampel=&stage=&q=`

```json
{ "asOf": "2026-09-16", "count": 6, "items": [ "ThesisLabResult" ] }
```

`GET /api/lab/thesis/:id`  
`GET /api/lab/lookup?ticker=CRM`  
`POST /api/lab/thesis`  Body: `{ "thesis": "...", "overrides": { } }`

Cache: Fixtures statisch. Free-Text-Eval ohne LLM im MVP.

## 3) Ampel

Grau wenn keine Gegen-These oder dataQuality=low (kein g* und kein PE/10J).  
Rot wenn pricedIn>70 oder Coverage>80 oder Layer=1.  
Grün wenn pricedIn<40 und Coverage<40 und Layer>=2.  
Sonst Gelb. LLM setzt Grün nicht allein.

Netto = Brutto * (1 - pricedIn/100); GB = PoS * Netto.

## 4) Fixtures

HBM Peak-Marge → Rot; SaaS stirbt → Gelb; VAT Lock-in → Gelb; Strain-Wave → Gelb; DE Farm-OS → Rot; Agenten-Haftpflicht → Grau.
