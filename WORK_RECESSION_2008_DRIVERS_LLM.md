# WORK_RECESSION_2008_DRIVERS_LLM.md

Stand: **05.09.2026 12:27 CEST**.

1. 2008-Vorläufer ohne Housing-Hardcode.
2. OpenRouter findet **Events** (Geo→Inflation, Fiskal, Geld nach Niedrigzins) über News, cached Implikationen 1–3. Ordnung — **setzt keine Scores**.

Hub: [docs/Doc_Soll_vs_Ist/README.md](./docs/Doc_Soll_vs_Ist/README.md).
Code-Haken: `callLLMJson` in [`server/llm-openrouter.ts`](./server/llm-openrouter.ts) (JSON-Object, Fallback-Kette, Default Haiku).

---

## 0. 2008-Invertierung (kurz)

CAPE 27 / Buffett ~131 % ≠ heutige 41 / 244 %. Vorlauf war Kredit.
Kurve `T10Y2Y` und `BAA10Y` sind im 17er-Set. SLOOS, Price/Rent, Funding fehlen.
Erkennung: \(z\) auf der eigenen Serie, nicht `if (2008) housing`.

---

## 1. Drei Event-Klassen — Katalog, keine Namen

Die KI darf **kein** festes Event-Set („Hormuz“, „Bessent“, „QT“) als Score schreiben. Sie darf nur in Klassen einsortieren. Die Klasse existiert, das Event nicht.

| Klasse | Was News liefern darf | Was Code danach misst |
|--------|----------------------|------------------------|
| `geo_inflation` | Physische Enge, Embargo, Ernte, Krieg um Rohstoffroute | \(z(\Delta)\) auf `DCOILWTICO` / `DCOILBRENTEU` / `PNGASUSUSDM` / `PWHEAMTUSDM` / `WPU065` (Dünger-PPI) |
| `fiscal` | Emissionskalender, TGA, Defizit, Buybacks — **Amt nicht Person** | `WTREGEN`, Bills-Netto, QRA-Identität |
| `monetary_regime` | Erste Straffung nach langer Niedrigzinsphase, QT/QE, RMP | \(z(\Delta_{90d} DFF)\), \(z(\Delta WALCL)\), Notes vs Bills getrennt |
| `credit` | Private Credit, SLOOS, Funding | `DRTSCIS`, `BAA10Y`, CP−Bill |

Regime-Logik Geld **ohne FOMC-Text**:

\[
\text{hikeAfterEase}\iff z(\Delta_{90d} i_{DFF})>1 \land i_{t-90}\text{ im unteren Terzil der 10J-Historie}
\]

Dann Kette fest (Code, nicht LLM):

\[
\Delta i_{10}\approx \Delta r_{10}+\Delta\pi^e \quad(DFII10+T10YIE=DGS10)
\]

\[
\Delta P/P \approx -D_{eq}\cdot\Delta i_{10},\quad D_{eq}\approx 15
\]

LLM sagt höchstens: „Regimewechsel-Kandidat“. Ob \(z(\Delta DFF)\) wirklich >1, entscheidet FRED.

---

## 2. OpenRouter-Call — Konfiguration

Bestehende Funktion, nicht neuer Vendor:

```ts
callLLMJson({
  systemPrompt: DRIVER_SYSTEM,
  prompt: DRIVER_USER(newsPack, seriesSnapshot),
  maxTokens: 1800,
  temperature: 0.2,
})
```

`temperature` 0.2 (Ist-Default 0.4 ist für Katalysatoren zu lose).
Modell: Fallback-Kette in `llm-openrouter.ts`, kein Fixname im Scorer.

### 2.1 System (unveränderlich)

*Du extrahierst höchstens fünf Treiber. Klassen nur geo_inflation | fiscal | monetary_regime | credit. Jeder Treiber: title, klasse, order1/2/3 als eine Kette, seriesHint aus der erlaubten Liste, optional shareClaim (Zahl+Einheit, Quelle im Text). Personennamen ignorieren. Keine Score-Zahl. Kein „Administration bullish“. Kein Event erfinden, das nicht in NEWS_PACK steht. Wenn die Kette ohne Serie auskommt: weglassen.*

Erlaubte `seriesHint` (Whitelist im Prompt **und** im Gate — das ist Methodik, keine Marktmeinung):

`DCOILWTICO, DCOILBRENTEU, PNGASUSUSDM, PWHEAMTUSDM, WPU065, T10YIE, DGS10, DFII10, DFF, WALCL, WTREGEN, BAA10Y, T10Y2Y, DRTSCIS, DCOILBRENTEU`

### 2.2 User-Pack (kein Hormuz-String)

`NEWS_PACK`: letzte 7 Tage Researcher-Headlines + FMP-News-Titel, Region-Tag US/EU/AS, **ohne** vorformulierte Implikation.
`SERIES_SNAP`: für jede Whitelist-ID `{ id, last, d20, z20, asOf }` aus FRED-Cache. Die KI sieht die Zahl, darf sie nicht überschreiben.

### 2.3 JSON-Soll

```
{
  asOf, region,
  drivers: [{
    id, title, class,
    order1, order2, order3,
    seriesHint: ["DCOILWTICO", "WPU065", "T10YIE"],
    shareClaim: { qty: 20, unit: "pct_seaborne_oil", evidence: "quote from NEWS_PACK" } | null,
    fertilizerLink: true | false,
    confidence: 0..1
  }]
}
```

`shareClaim.qty=20` ist eine **Behauptung aus News**, kein Modellparameter. Gate:

- ohne `evidence` ∨ `evidence` nicht im NEWS_PACK → Claim drop.
- `fertilizerLink=true` nur wenn `WPU065` oder Weizen/Gas in `seriesHint`.
- UI zeigt Claim nur zusammen mit Live-\(z\) der Hint-Serie.

---

## 3. Implikation cachen — Beispiel Öl 20 % + Dünger

Nicht den Satz „20 % der Weltölversorgung“ hardcoden (Ist-Fazit). Cachen so:

```
impl:{
  driverId,
  order: 1|2|3,
  channel: "oil"|"lng"|"fertilizer"|"cpi"|"be10"|"wacc",
  claimPct: 20 | null,
  seriesId: "DCOILWTICO",
  z: 1.4,
  passedGate: true,
  cachedUntil: ISO
}
```

Auswertung **Code**:

| Ordnung | Kette | Gate |
|---------|-------|------|
| 1 | Route/Event → Spot | \(|z_{20d}(WTI \lor Brent \lor Henry Hub)|\ge 0{,}5\) sonst Text aus |
| 2 | Spot → CPI / Dünger | Benzin-Gewicht CPI **3,5 %** ist Modellkonstante; \(\Delta CPI \approx 0{,}035\cdot\Delta\%\) Benzin; Dünger nur wenn `WPU065` \(z\) mitläuft |
| 3 | \(\pi^e\) → 10Y → WACC | `T10YIE`, `DGS10`; Duration-Näherung \(D_{eq}\approx 15\) |

Niedrigzins → erste hike (Klasse `monetary_regime`):

| 1 | \(\Delta DFF_{90d}\) | FRED `DFF` |
| 2 | Front-End / Bills | DTS/QRA, nicht LLM |
| 3 | 10Y und Equity-Multiple | `DGS10`, nicht „FOMC hawkish“ |

Cache: `recession_drv_v2_{region}_{yyyy-ww}` TTL **7 Tage**. News-Pack separat `recession_news_{region}` TTL **24 h**. Driver ohne frisches News-Pack nicht neu halluzinieren — alten Driver mit `stale:true` stehen lassen.

Trigger: Sonntag 22:00 ET **oder** irgendein Whitelist-\(|z|>1{,}5\). Nicht beim Dashboard-Klick.

---

## 4. Was verboten bleibt

- Score aus Reden / „Administration“.
- GENIUS oder Hormuz auf 1,3 setzen.
- QE inferieren, weil WALCL steigt (kann RMP-Bills sein).
- `generateFazit`-Absatz mit festem Iran-Text.
- 20 % als Konstante im Scorer (nur Claim+Gate).

---

## 5. Dateien

| Datei | Rolle |
|-------|-------|
| diese Spec | Soll |
| `server/llm-openrouter.ts` | `callLLMJson` |
| `server/recession.ts` | `generateFazit` Hormuz löschen |
| `server/researcher.ts` | News/Briefing-Pack wiederverwenden |
| `WORK_RECESSION_RATE_OIL_BRIDGE.md` | Öl→CPI→10Y Formeln |
| `WORK_FISCAL_FRONTEND_ADAPTIVE.md` | TGA/Bills \(s(z)\) |
| Soll-neu `server/recession-drivers.ts` | Pack + Prompt + Gate + Cache |
| Soll-neu `server/recession-credit-book.ts` | SLOOS / Price-Rent \(s(z)\) |
| `client/.../RecessionDashboard.tsx` S9 | Driver-Karten statt Essay |

---

## 6. DoD

1. Prompt ohne das Wort Hormuz, Output kann Hormuz enthalten **wenn** NEWS_PACK es trägt.
2. Claim 20 % ohne Evidence-Substring → `shareClaim=null`.
3. `fertilizerLink` ohne `WPU065`/`PWHEAMT` in Hint → false.
4. \(|z_{WTI}|<0{,}5\) → Driver in UI aus, Cache bleibt.
5. `hikeAfterEase` nur über `DFF`-Historie, nicht über FOMC-Headline allein.
6. Löschen des April-2026-Hormuz-Strings ändert keine 17 rawScores.
7. Fixture 2006-12: `T10Y2Y<0` Leading ≠ 50; CAPE 27 ≠ Korrektur 80.
