# WORK_RECESSION_2008_DRIVERS_LLM.md

Stand: **05.09.2026 12:35 CEST**.

## Löschauftrag (Ist, Zahlen)

Datei [`server/recession.ts`](./server/recession.ts), Funktion `generateFazit`:

| Zeile | Text | Status |
|------|------|--------|
| ~1032 | Kommentar `Iran/Hormuz + Inflation + Zinsen` | löschen |
| ~1035 | *„Die Sperrung der Straße von Hormuz … 20% der globalen Ölversorgung … ein Fünftel … LNG“* | löschen |
| ~1070 | *„Iran/Hormuz-Ölpreisschock mit Stagflationspotenzial“* | löschen |
| ~1078 | Kartentitel `Geopolitik & Makro: Iran/Hormuz, Inflation, Zinsen` | ersetzen durch Driver-Karten oder „unauffällig“ |

DoD: `rg Hormuz server/recession.ts` → 0 Treffer. 17 rawScores unverändert. Ersatz ist nicht ein anderer fester Satz, sondern der Schwellen-Job unten.

---

## Schwelle zuerst — ja / nein / unauffällig

Zwei Messlatten, beide ohne Event-Namen:

| Latte | Formel | Bedeutung |
|-------|--------|-----------|
| **Ziel** (Policy-Konstante) | z. B. Kern-PCE/CPI **2 %** (`PCEPILFE` YoY oder `CPILFESL`) | über dem Mandat, kann trotzdem *üblich* sein |
| **Norm** (Historie) | \(z=(x-\mu_H)/(\sigma_H+\varepsilon)\), H = 10J | über der eigenen Verteilung |

Klassifikation pro Variable:

```
über Ziel?     ja/nein
über Norm |z|≥1? ja/nein

nein + nein → unauffällig / normal     → kein LLM
ja  + nein → Ziel verfehlt, historisch üblich → kein Deep-Dive, eine Zeile Zahl
nein + ja  → unter Ziel, aber unüblich        → LLM (selten)
ja  + ja   → auffällig                       → LLM: Gründe + 1./2./3. Ordnung
```

Beispiel Inflation 2 %: Headline 2,3 % ist über dem Ziel und oft \(|z|<1\) → **normal klassifizieren**, keine Hormuz-Karte. Headline 2,3 % **und** WTI \(z\ge 1\) → Call: *welche Headline erklärt die Energie-Serie?*

Dieselbe Matrix auf DFF (Niedrigzins-Terzil + \(z(\Delta_{90d})\)), `BAA10Y`, `WPU065`, `WTREGEN`. Kein Sonderpfad Dünger oder Private Credit.

---

## LLM nur auf der Menge A

\(A = \{id:\;|z|\ge 1\}\). Leer → 0 `callLLMJson`.
Nicht leer → News 7 Tage + Snap nur von A.

System:

*Nur Serien in A. Warum liegt die Serie über der Norm? Eine Kette order1/2/3. shareClaim nur mit Zitat aus NEWS_PACK. Keine Person, keine Score-Zahl, keine Serie außerhalb A. Keine Pflichtwörter. Wenn keine Headline passt: weglassen — Serie bleibt „auffällig, Grund offen“.*

Temperatur 0,2. Cache Driver 7 Tage, News 24 h. Trigger = FRED-Update, nicht Klick.

Implikation entsteht so von selbst: Inflation über Ziel+Norm → KI sieht WTI/Gas/Dünger in A → Kette Energie → CPI → BE/10Y. Liegt nur CPI über 2 % und Energie \(z<1\) → keine Kette erfinden.

---

## Whitelist

`DCOILWTICO DCOILBRENTEU PNGASUSUSDM WPU065 PWHEAMTUSDM T10YIE DGS10 DFII10 DFF WALCL WTREGEN BAA10Y T10Y2Y DRTSCIS PCEPILFE CPILFESL`

2 % ist Modellparameter am Inflations-Slot, analog Clip \(|z|=2\). Nicht „Hormuz = 20 % der Welt“.

---

## Dateien

| Datei | Soll |
|-------|------|
| `server/recession.ts` 1032–1078 | Hormuz raus |
| `server/llm-openrouter.ts` | `callLLMJson` |
| Soll `server/recession-drivers.ts` | Ziel+z-Matrix, Call nur wenn A ≠ ∅ |
| S9 Dashboard | „unauffällig“ oder Driver-Karte |

---

## DoD

1. `rg -n Hormuz server/recession.ts` = 0.
2. CPI 2,1 %, alle \(|z|<1\) → 0 Calls, UI unauffällig.
3. CPI 2,1 % + WTI \(z=1{,}4\) → Call, Grund nur aus Pack.
4. Headline Hormuz + WTI \(z=0{,}2\) → kein Driver.
5. Prompt ohne Hormuz/Dünger/Private-Credit als Pflicht.
6. 17 Scores unverändert.
