# WORK_RESEARCHER_BRIEFING_REGIONAL.md

> Kopie 04.09.2026 nach `docs/work-offen/`. Original bleibt `./WORK_RESEARCHER_BRIEFING_REGIONAL.md` bis SHA-Check.
> Stand: 04.09.2026 | Status: **SPEC** — Live-Briefing bleibt ein Block, US-lastig
> Route: `POST /api/researcher/daily-briefing` | UI: BriefingModal in `Researcher.tsx`
> Code: `server/researcher.ts` ab ~Z.1000

---

## 0. Ist — warum es nach USA aussieht

Der Job läuft schon über `regions = [US, EU, ASIA]` und diffed Key-Events aus allen drei Macro-Pulses. Trotzdem filtert das **Ergebnis** US:

| Stelle | Verhalten |
|--------|-----------|
| `REGION_CONTEXT_2025.US` | Trump, Zölle, OBBBA, NDAA, Tariff-Eskalation China/EU/MX — langer Block |
| `REGION_CONTEXT_2025.EU/ASIA` | kürzer, Programme, aber kein symmetrischer Handels-/Geld-Filter |
| Briefing-Prompt | ein Text: „Geld/Fiskal/Geopolitik letzten 24–48h“, **kein** Pflicht-Slot je Region |
| Diff-Regel | `NEW` nur wenn `severity===high` | US-Zoll-Headlines werden oft high, EZ-M3 nicht |
| Output | 1× `headline`, 1× `tacticalStance`, `topChanges` max 3 global |
| Cache | Berlin-Datum, ein File `briefing-result` | kein `briefing__US` |
| Zahlen | Liquidity-Index / `r` / `V` / `π` **nicht** im Prompt |

US bleibt der größte Markt — das darf die **Reihenfolge** der Cross-Zeile steuern, nicht die **Abwesenheit** von EZ/JP-Filtern.

---

## 1. Soll — gleiche drei Filter, drei Bücher

Filter überall identisch, nur das Amt wechselt (wie Liquidity-Index):

| Filter | US | EU | ASIA |
|--------|----|----|------|
| Geld | Fed Δi / SOMA / EMG / V | EZB DF-Satz / APP+PEPP Δ / M3 / V | BoJ Δi / JGB-Käufe / M2 / V |
| Fiskal | QRA/TGA/Netto-Bills + Programme | Kommission EU-Bonds/Bills + DE Sondervermögen | MoF JGB-Netto + JP/CN Stimulus |
| Handel/Zoll | USTR/Tariff | CBAM, EU-Zölle, Vergeltung | China export controls, JP/KR/TW semi, India tariff |

Kein Filter darf nur in einer Region existieren. Fehlt die Serie → Slot `n/v`, Zeile bleibt.

Struktur:

```
Briefing
  cross     ← 3 Zeilen Spillover (US→EZ, US→Asia, EZ→Asia)
  regions[] ← Pflichtlänge 3, Reihenfolge US, EU, ASIA
    money / fiscal / trade / stance / li / r / V / π
```

US zuerst in `regions[]` und in der Cross-Prio, weil größter Markt. Nicht weil nur US-Events `high` sind.

---

## 2. Zahlen zuerst, LLM nur Synthese

Pro Region in den Prompt (gecachte Index-Payloads, kein zweiter LLM-Zahlengenerator):

```
US: LI=.. label=.. r=.. V=.. EMG=.. π=.. moneyTrend=.. fiscalTrend=..
EU: …
ASIA: …
```

Fehlt `LI.available` → diese Region ohne Zahl, Text „Index n/v“. LLM darf **keine** `r`/`V` erfinden.

Prompt-Kern, ein Satz:

*Drei Regionsblöcke gleicher Felder. US-Zoll nicht als globales Event ohne EU- und Asia-Spillover-Zeile. Keine Personennamen als Score. Nur 2025–2026.*

`REGION_CONTEXT_2025` wird Katalog-Hinweis (Programme), nicht der Filter. Filter = Felder oben.

---

## 3. Diff-Regel symmetrisch

Ist: `NEW` nur `severity=high` → US-Tariff gewinnt.

Soll, pro Region eigener Diff, dann Merge:

```
keep if
  changeType in {NEW, ESCALATED, DIRECTION_FLIP}
  OR category in {Geldpolitik, Fiskalpolitik, Handel}
  OR LI-Slot oder r um ≥ 0.5 σ gesprungen (Zahlen-Event, kein LLM)
```

Quota: mindestens **1 Event je Region** in `topChanges` (oder explizit `none` + Stance). Global-Cap 6 statt 3, davon ≤ 3 US.

---

## 4. Payload

```ts
type RegionId = "US" | "EU" | "ASIA";

interface RegionBrief {
  region: RegionId;
  stance: "Vorsichtig" | "Neutral" | "Opportunistisch";
  money: string;     // 1 Satz, darf Zahl aus Cache zitieren
  fiscal: string;
  trade: string;     // Zoll/CBAM/Exportkontrolle — Pflichtfeld, auch wenn „keine Änderung“
  li: number | null;
  realRatePct: number | null;
  velocity: number | null;
  pricedIn: number | null;
}

interface DailyBriefingV2 {
  asOf: string;
  headline: string;           // ein Satz, muss 2+ Regionen nennen oder „cross“
  cross: string[];            // genau 3 Spillover-Zeilen
  regions: [RegionBrief, RegionBrief, RegionBrief];
  topChanges: Array<{
    region: RegionId;
    category: "Geldpolitik" | "Fiskalpolitik" | "Handel" | "Geopolitik" | "Sonstiges";
    title: string;
    changeType: "NEW" | "ESCALATED" | "DIRECTION_FLIP" | "UNCHANGED";
    dcfImplications?: { waccDeltaBps: string; affectedSectors: string[] };
  }>;
  tacticalStance: "Vorsichtig" | "Neutral" | "Opportunistisch";
  stanceRationale: string;
}
```

FE: BriefingModal bekommt drei Spalten (US|EU|ASIA) plus Cross-Band. Altes ein-Block-Layout nur Fallback wenn `regions` fehlt (`_schema=v1`).

---

## 5. Cache

| Key | TTL |
|-----|-----|
| `briefing_v2__{Berlin-date}` | bis 18:00 Berlin oder 6 h, wie Ist |
| Input-Hashes | `liqidx_v1__US/EU/ASIA` + `macro__{region}` |

Ein Briefing-Lauf liest die drei Index-Caches (Request-Cache reicht). Kein dritter FRED-Roundtrip, wenn Index frisch.

---

## 6. Dateien

| Datei | Änderung |
|-------|----------|
| `server/researcher.ts` | Prompt + Quota + `regions[]`; `REGION_CONTEXT` darf bleiben als Hint |
| `client/src/pages/Researcher.tsx` | BriefingModal 3 Spalten |
| `server/liquidity-index.ts` | Briefing liest Cache, schreibt nicht |
| Tests | Fixture: Output ohne `regions.length===3` ist fail; US-only `topChanges` fail |

---

## 7. DoD

1. Response hat `regions.length === 3` mit IDs US, EU, ASIA.
2. Jede Region hat nicht-leeres `trade` (auch „keine Tarifänderung seit gestern“).
3. `topChanges` nicht 3× US.
4. `headline` ohne zweites Regionskürzel → fail (außer explizites Flag `singleRegionFocus`, default aus).
5. Zahlen in `li`/`r`/`V` kommen aus Cache oder sind `null` — nie LLM-Halluzination.
6. v1-Modal rendert weiter, wenn altes Cache-File ohne `regions` kommt.

---

**Satz:** USA zuerst weil größter Markt. Filter Geld/Fiskal/Handel in allen drei Regionen Pflicht. Briefing = Synthese über gecachte Indexzahlen, nicht ein US-Zoll-Essay.
