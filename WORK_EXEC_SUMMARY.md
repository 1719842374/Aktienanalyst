# WORK_EXEC_SUMMARY.md

> Soll · Builder [`server/exec-summary.ts`](./server/exec-summary.ts) · Karte [`client/src/components/ExecSummaryCard.tsx`](./client/src/components/ExecSummaryCard.tsx)
> Stand: 09.09.2026 09:59 CEST — S2-Text + S8/S15 → S0 (mit/ohne KI)

S0 und S17-Fazit nutzen dieselbe Ampel. Technik aus S9. **KI-Fließtext aus S2 (`growthThesis`)**. Katalysatoren aus S15. Risiken aus S8.

---

## 6. Verknüpfung S2 / S8 / S15 → S0 (verbindlich)

### 6.1 S2-Text in S0, sobald KI an ist

Feld: **`StockAnalysis.growthThesis`**

UI-Quelle S2 (`Section2.tsx`):

```tsx
<h3>Investment These & Katalysatoren-Logik</h3>
<p>{data.growthThesis}</p>
```

Generator: `server/llm-openrouter.ts` (4–8 Sätze, Pflicht: Kernthese, Segmente, K1–K4 mit PoS+Netto-Upside, Bewertung+g*+FCF, ein Risiko).
Fingerprint: `growthThesisFingerprint`, Zeit: `growthThesisGeneratedAt`.

MSFT Live 09.09.2026 09:52 (Ist, nach KI):

> Microsofts Wertschöpfung wird primär durch die Monetarisierung von KI-Infrastruktur und Enterprise-Software getrieben … K1 Copilot Pro (PoS 72 %, Netto-Upside 10,8 %), K2 Azure AI … (68 %, 14,7 %), K3 LinkedIn … (65 %, 12,8 %), K4 Dynamics … (70 %, 11,8 %) … Gesamtupside **+36,1 %** … Forward-KGV 25,0x, Reverse-DCF g* 7,2 %, FCF-Marge 20,2 %, OM 46,8 %, PT 535 (+8 %). Hauptrisiko: Azure-GPU-Kapazität (K2).

Regel:

| KI | `growthThesis` | S0 zeigt |
| --- | --- | --- |
| aus | leer / Template ohne Firmen-K-Namen | Lage/Bruch/Handlung aus Zahlen (DCF, CRV, Cross) — **kein** erfundener These-Absatz |
| an | 4–8 Sätze wie oben | **denselben String** unter Headline, vor oder im Fazit-Kasten. Kein zweites LLM, kein Umformulieren |

S0-Feld: `execSummary.thesisLine = analysis.growthThesis` (trim, unverändert).

Wenn `growthThesis` nach KI < 80 Zeichen oder keine K1/K2-Namen enthält → These veraltet, S0-Hinweis „S2-These fehlt/veraltet“, nicht den alten Generic-Fließtext als KI ausgeben.

Attach:

```ts
// server/exec-summary-attach.ts
thesisLine: typeof a.growthThesis === "string" ? a.growthThesis.trim() : "",
thesisAt: a.growthThesisGeneratedAt ?? null,
```

Karte:

```tsx
{s.thesisLine && (
  <div className="text-xs leading-relaxed text-foreground/85">
    <div className="text-[10px] uppercase text-muted-foreground mb-1">Investmentthese (S2)</div>
    {s.thesisLine}
  </div>
)}
```

### 6.2 S15 → S0 Pro + Upside (mit und ohne KI)

Dieselbe Array `data.catalysts` wie S15. Kein Parallel-Array.

| Modus | Was in `catalysts[]` steht | S0-Pro | S0-Upside |
| --- | --- | --- | --- |
| ohne KI | oft generische Namen (`generic: true`): Revenue Growth Acceleration, AI/Cloud Tailwind | Top-2 GB trotzdem anzeigen, Badge **generisch** | GB-Summe + Kat.-Ziel aus `calculateCatalystUpside` |
| mit KI | firmenspezifisch (`generic: false`): Azure AI …, LinkedIn …, Dynamics … | **genau diese Namen** + GB | dieselbe Formel, MSFT Σ GB **+36,05 %**, Ziel **705,91**, vs Kurs **+42,9 %** |

Nach KI-Enrich ruft Analyze S15-Katalysatoren **und** `growthThesis` mit denselben K-Namen neu auf (`analyze-route.ts`). S0 muss **nach** diesem Schritt `attachExecSummary` noch einmal laufen, sonst bleiben Generic-Pros in der Karte.

Reihenfolge:

```
1. Zahlen/DCF/Risiken bauen
2. Katalysatoren (Template oder KI)
3. growthThesis (nur wenn KI + frische K-Namen)
4. attachExecSummary(analysis)   // ZULETZT, liest 2+3
5. res.json
```

Upside-Zeile immer, KI an oder aus:

\[
\mathrm{GB}_i = \mathrm{PoS}_i \times \text{Netto-Upside}_i
\]

\[
T_{\mathrm{Kat}} = \mathrm{DCF}_{\mathrm{kons}} \times \bigl(1 + \textstyle\sum \mathrm{GB}_i\bigr)
\]

MSFT S15: K2 68 % × 14,74 % = 10,02 … Summe 36,05 % · 518,86 × 1,3605 = 705,91.

### 6.3 S8 → S0 Contra (mit und ohne KI)

Dieselbe Array `data.risks` wie S8 Inversion.

| Modus | Quelle | S0-Contra |
| --- | --- | --- |
| ohne KI | Template-Risiken + ED = EW × Impact | Top-2 nach ED, plus CRV-RA wenn < 1 |
| mit KI | KI-Risikotexte, **dieselben** ED-Zahlen | Top-2 ED + Satz „wird zu klein gerechnet“ wenn underestimated |

MSFT S8 Ist: Total ED **19,9 %**, Tech Disruption 5,00 %, Macro 4,20 %, Risk-Adj. Target **428,80** = 535 × (1 − 0,199).

Feld-Map (Pflicht, sonst Contra leer):

```ts
expectedDamagePct: r.expectedDamagePct ?? r.expectedDamage
```

S0-Contra ohne diese Map zeigt CRV/K5 statt Macro/Tech Disruption.

### 6.4 Was S0 in beiden Modi zeigt

```
Headline          immer (Ticker · Kurs · g* · Call)
Pro               S15 Top-GB (Badge generisch / KI)
Contra            S8 Top-ED + CRV-RA
Upside-Zeile      S15 GB-Summe + Ziel + vs Kurs     IMMER
Risk-Zeile        S8 ED-Summe + Risk-Adj. Target    IMMER
S2-These          nur wenn growthThesis gesetzt     NUR MIT KI
Ampel + Faktoren  buildSummaryFazit(data)           IMMER (wie S17)
Technik           S9 currentStatus                  wenn Felder da
Call / Cross      unverändert
```

Ohne KI darf S0 **nicht** so tun, als gäbe es eine Azure/LinkedIn-These.
Mit KI darf S0 den S2-Absatz **nicht umschreiben**.

### 6.5 Dateien

| Datei | Rolle |
| --- | --- |
| `client/src/components/sections/Section2.tsx` | rendert `growthThesis` — Quelle |
| `client/src/components/sections/CatalystsSection.tsx` | S15 GB / PoS / Netto-Upside |
| S8 Inversion | `data.risks[].expectedDamage` |
| `server/llm-openrouter.ts` | schreibt `growthThesis` |
| `server/analyze-route.ts` | Reihenfolge: K → These → attachExecSummary |
| `server/exec-summary-attach.ts` | Map thesis + ED-Feld + catalysts |
| `server/exec-summary.ts` | `thesisLine`, `upsideLine` |
| `client/src/components/ExecSummaryCard.tsx` | These-Block + Upside + Ampel |

### 6.6 Acceptance

```
[ ] KI aus: S0 hat keine Azure/LinkedIn-Sätze, Pro darf generic=true zeigen
[ ] KI an: S0-These === data.growthThesis (Zeichen-gleich, inkl. +36,1 %)
[ ] KI an: S0-Pro-Namen === S15 K2/K3/K4-Namen
[ ] S0-Upside-Zeile da mit UND ohne KI (Zahl aus derselben calculateCatalystUpside)
[ ] S0-Contra-Top === argmax ED aus S8
[ ] attachExecSummary läuft NACH Thesis-Enrich, nicht davor
[ ] S17-Ampel-Badge === S0-Ampel-Badge
```

---

## 0–5 bleibt gültig

Ampel-Score S = n+ − n−, MSFT 7 − 6 = NEUTRAL.
DCF-Zahl in S0-Lage = S5 `perShare` (nicht 252,37 wenn S15 mit 518,86 rechnet).
