# WORK_RECESSION_2008_DRIVERS_LLM.md

Stand: **05.09.2026 12:32 CEST**.

Invert der Tickets „Z-Score für Dünger“ / „Private-Credit-Risiken prüfen“:
**nicht** zwei Hardcode-Module. Dieselbe Schwelle wie im Aktien-Analysten (Katalysator nur, wenn die Zahl sich bewegt).

---

## Prinzip (Aktien-Analog)

Analyze: LLM schreibt keinen GB, wenn der FactPack die Zahl nicht hergibt.
Hier: LLM schreibt keine 2./3.-Ordnung, wenn die Serie nicht über der eigenen Historie liegt.

\[
z_t=\frac{x_t-\mu_H}{\sigma_H+\varepsilon}
\]

| \(|z|\) | Code | LLM |
|---------|------|-----|
| \(<1\) | Slot `normal`, Score-Beitrag 50 / Flag aus | **kein** Deep-Dive, höchstens Klasse-Tag |
| \(\ge 1\) | Event-Cache auf, `seriesHint` Pflicht | `callLLMJson` filtert *welche* Headline zur Serie passt |
| \(\ge 2\) | clip wie Liquidity \(s(z)\) | gleiche JSON-Form, höhere Priorität in den max. 5 Treibern |

Dünger ist `WPU065` (oder Gas/Weizen als Vorstufe). Private Credit ist SLOOS/`BAA10Y`/Credit-GDP. Beide stehen in der **gleichen** Whitelist. Kein Ticket „Implementiere Dünger“, kein Ticket „Prüfe PC“ — sonst entsteht wieder Hormuz-Hardcode mit anderem Label.

---

## Ablauf (Reihenfolge fest)

1. FRED-Cache liest Whitelist, rechnet \(z_{20d}\) und \(z_{H}\) (H = 10J Preise, 20J Spreads/SLOOS).
2. Menge \(A=\{id:|z|\ge 1\}\). Ist \(A\) leer → **kein** OpenRouter-Call. UI: „normal klassifiziert“.
3. Nur wenn \(A\neq\emptyset\): News-Pack der letzten 7 Tage + `SERIES_SNAP` nur für \(A\) an `callLLMJson`.
4. LLM mappt Headline → `class` + order1/2/3 + optional `shareClaim`. Darf **keine** Serie erfinden, die nicht in \(A\) ist.
5. Gate: Evidence-Substring im Pack; Claim-\% ohne Quelle → null. Output cached 7 Tage.

Damit findet die KI Hormuz/Dünger/PC **nur**, wenn WTI, `WPU065` oder Spreads schon gezogen haben — analog Katalysator-Sektion, nicht analog `generateFazit`.

---

## OpenRouter

```ts
callLLMJson({
  systemPrompt: DRIVER_SYSTEM,
  prompt: DRIVER_USER(newsPack, seriesSnapA),
  maxTokens: 1800,
  temperature: 0.2,
})
```

System, ein Block:

*Nur Serien in LISTE_A (bereits |z|≥1). Höchstens fünf Treiber. Klassen geo_inflation|fiscal|monetary_regime|credit. order1/2/3 eine Kette. shareClaim nur mit Zitat aus NEWS_PACK. Keine Person, keine Score-Zahl, keine Serie außerhalb LISTE_A. Wenn keine Headline zur Serie passt: driver weglassen, Serie bleibt „normal + z sichtbar“.*

Trigger: Whitelist-Job nach FRED-Update. Nicht Dashboard-Klick, nicht Sonntag „wenn nichts \(z\)“.

---

## Whitelist (Methodik, keine Meinung)

| id | Buch | H |
|----|------|---|
| `DCOILWTICO` `DCOILBRENTEU` | geo_inflation 1 | 10J |
| `PNGASUSUSDM` | Gas → Dünger-Vorstufe | 10J |
| `WPU065` | Dünger-PPI | 10J |
| `PWHEAMTUSDM` | Weizen | 10J |
| `T10YIE` `DGS10` `DFII10` | Ordnung 3 | 10J |
| `DFF` `WALCL` | monetary_regime | 10J / 20J |
| `WTREGEN` | fiscal | 10J |
| `BAA10Y` `T10Y2Y` `DRTSCIS` | credit | 20J |

`n<H_min` → nicht in \(A\), auch wenn der Preis „hoch wirkt“.

Regime nach Niedrigzins bleibt Code:

\[
\text{hikeAfterEase}\iff z(\Delta_{90d}DFF)>1 \land i_{t-90}\text{ unteres 10J-Terzil}
\]

---

## 2008 (unverändert, zur Einordnung)

Kurve und `BAA10Y` hätten \(|z|\ge 1\) geliefert → LLM hätte *dann* Subprime/Funding zuordnen dürfen.
CAPE 27 wäre nicht in \(A\) des Korrektur-Max-Eimers. Sahm erst 2008-12 — coincident.

---

## Dateien

| Datei | Rolle |
|-------|-------|
| diese Spec | Soll |
| `server/llm-openrouter.ts` | `callLLMJson` |
| `server/recession.ts` | `generateFazit` Hormuz-Absatz löschen |
| Soll `server/recession-drivers.ts` | \(A\) bauen, Call nur wenn \(A\neq\emptyset\) |
| `WORK_RECESSION_RATE_OIL_BRIDGE.md` | Öl→CPI Formeln |
| `client/.../RecessionDashboard.tsx` S9 | „normal“ vs. Driver-Karte |

Kein `fertilizer.ts`. Kein `privateCredit.ts`.

---

## DoD

1. \(|z|<1\) auf allen Whitelist-IDs → 0 OpenRouter-Calls in der Woche.
2. `WPU065` \(z=1{,}2\) + Headline ohne Dünger → Serie in UI mit z, **kein** erfundener Driver.
3. Headline „Hormuz“ + WTI \(z=0{,}2\) → nicht in \(A\), kein Driver.
4. Headline „Hormuz“ + WTI \(z=1{,}4\) → Call, shareClaim nur mit Pack-Zitat.
5. Prompt ohne Pflichtwörter Dünger/Hormuz/Private-Credit.
6. Löschen des April-2026-Essays ändert keine 17 rawScores.
