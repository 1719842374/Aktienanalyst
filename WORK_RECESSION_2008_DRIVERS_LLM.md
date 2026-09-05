# WORK_RECESSION_2008_DRIVERS_LLM.md

Stand: **05.09.2026**. Zwei Aufträge in einer Spec.

1. Welche Serien vor 2008 wirklich vorliefen — und wie man sie **ohne** „Housing-2006“-Hardcode wiederfindet.
2. OpenRouter-LLM findet Key-Driver (Hormuz 1/2/3. Ordnung, Private Credit) — **setzt keine Scores**.

Eltern: [WORK_RECESSION_RSI_MACD.md](./WORK_RECESSION_RSI_MACD.md), Scoring-Ist `server/recession.ts`.
Hub: [docs/Doc_Soll_vs_Ist/README.md](./docs/Doc_Soll_vs_Ist/README.md).

---

## 0. Invertierung 2006–08 — nicht CAPE

Korrektur-Buch (Buffett/CAPE) hätte **2007 nicht** wie 2000 oder 2021 geschrien.
CAPE Jan 2007 **27,2** vs. Jan 2000 **43,8** vs. Board 05.09.2026 **41,4**.
Buffett Q2 2007 **~131 %** vs. Q1 2000 **~164–172 %** vs. Board **244 %**.
VIX-Schnitt 2007 **17,5** — Sorglosigkeit, kein Panic-Print.

Der Bruch 2008 war ein **Kredit-/Funding-Event**, das in Immobilien *sichtbar* wurde. House-Price-Index allein ist die Folge, nicht der Fühler.

---

## 1. Was vor Lehman (15.09.2008) gezogen hat

Zeitordnung, nicht Narrative.

| Wann | Serie | Was passierte | Buch |
|------|-------|---------------|------|
| Dez 2005 – 2007 | `T10Y2Y` | Kurve invertiert | Rezession Leading |
| 2005–06 | Case-Shiller / `CSUSHPINSA` Peak + Price/Rent, Price/Income | Bestand teuer, **Credit** schon locker | Fiskal/Kredit, nicht „Haus-Hardcode“ |
| 2006–07 | SLOOS `DRTSCIS` Net Tightening | Banken ziehen Standards an *bevor* ALQ steigt | Kreditangebot |
| Aug 2007 | TED / LIBOR–OIS, ABX, CP | BNP friert Fonds — Funding | Stress |
| 2007 H2 | `BAA10Y` weitet sich | Qualität vs. Treasury | schon im 17er-Set |
| 2007–08 | Financials vs. S&P, Broker-Stocks | relative Underperformance | Marktstruktur |
| 2008 | `WALCL` Notfall-QE, RRP/CPFF | nach dem Bruch | Geld |
| Dez 2008 | Sahm `SAHMREALTIME` ≥ 0,50 | **gleichlaufend**, zu spät für Vorwarnung | Rezession Coincident |

Sahm, PMI-Kollaps, VIX 80 sind **Bestätigung**, kein Alarm 12 Monate vorher.

Was *heute im Code* davon existiert:

| Ist `recession.ts` | 2008-Nutzen |
|--------------------|-------------|
| `scoreYieldCurve` `T10Y2Y` binär <0 | **Ja**, hätte 2006–07 gezogen |
| `scoreCreditSpreads` `BAA10Y` Zonen | **Ja**, 2007 H2 |
| `scoreSahm` binär 0,50 | **Nein** als Vorwarnung |
| `scoreBuffett` / `scoreCAPE` | **schwach** 2007 |
| `scoreVIX` konträr | 2007 eher Sorglosigkeit = Korrektur-Score hoch, aber nicht das Kreditereignis |
| `scoreMarginDebt` Regex | US-Aktienhebel, nicht CDO/SLOOS |
| `generateFazit` Hormuz-Essay Apr 2026 | **Hardcode**, nicht 2008, nicht adaptiv |

Fehlt: SLOOS, TED/CP, Price/Rent, Private-Credit/GDP, Bank-vs-Market, ABX-Ersatz.

---

## 2. Adaptive Erkennung — keine „Housing-2006“-Konstante

Dieselbe Philosophie wie Liquidity-Index: Rohserie → eigene Historie → \(z\) → \(s(z)\).

\[
z_t=\frac{x_t-\mu_{H}}{\sigma_{H}+\varepsilon},\quad
s=50+50\cdot\mathrm{clip}(z/2,-1,1)
\]

Entdeckung statt Namen:

\[
\begin{aligned}
\text{curveInv} &\iff z(T10Y2Y)<-1 \land T10Y2Y<0\\
\text{creditTighten} &\iff z(\Delta \text{SLOOS})>1 \land \Delta>0\\
\text{spreadStress} &\iff z(BAA10Y)>1 \land \Delta>0\\
\text{fundingStress} &\iff z(\text{TED oder CP–Bill})>1\\
\text{housingRich} &\iff z(\text{Price/Rent})>1 \lor z(\text{Price/Income})>1\\
\text{privLeverage} &\iff z(\Delta(\text{Private Credit}/GDP))>1
\end{aligned}
\]

`housingRich` ist **ein** Slot über Verhältnisse, nicht „wenn Case-Shiller > 184,6“.
EU/AS: dieselbe Funktion auf EZ-SLOOS-Analog, JP-Loan Officer, nicht US-Ticker kopieren.

Katalog (FRED, kein LLM):

| Slot | Serie | H |
|------|-------|---|
| Kurve | `T10Y2Y` | 20J |
| Credit Spread | `BAA10Y` | 20J |
| SLOOS C&I | `DRTSCIS` | 20J |
| House Price | `CSUSHPINSA` nur als Zähler | — |
| Rent | `CUSR0000SEHA` → Price/Rent | 20J |
| Disposable income | `DSPIC96` → Price/Income | 20J |
| Private Depository Credit | `TOTLL` oder BIS Credit/GDP | 20J |
| TED-Ersatz | `TEDRATE` (ende 2022) → `SOFR`–Bill oder `CPF3M–DTB3` | 10J |
| Financials vs SPX | FMP `XLF`/`SPY` Relativ-52W | 15J |

`n<H_min` → `available:false`, Slot 50, kein Default „Housing-Blase“.

Gewichte: Kredit-Fühler ins **Rezessions-Leading** (6M), nicht ins Korrektur-12M (das bleibt Buffett/CAPE). Sonst wiederholt ihr den 2007-Fehler umgekehrt: 2024 schreit Bewertung, 2007 schrie Kredit.

---

## 3. LLM / OpenRouter — Key-Driver, keine Score-Maschine

Ist: `generateFazit` in `server/recession.ts` §Geopolitik klebt **Iran/Hormuz April 2026** fest. Das ist der verbotene Hardcode.

Soll: ein Prompt, strukturiertes JSON, Cache ≥ 30 Tage wie Researcher-Briefing. Zahlen kommen aus FRED/FMP. LLM darf nur **benennen und Ordnungen legen**.

### 3.1 Output-Schema

```
{
  asOf, region: "US"|"EU"|"AS",
  drivers: [{
    id, title,
    book: "geo"|"credit"|"funding"|"fiscal"|"policy",
    order1: "direkt, eine Kette",
    order2: "eine Kette",
    order3: "eine Kette",
    seriesHint: ["DCOILWTICO", "BAA10Y"],
    confidence: 0..1,
    staleIfDays: 30
  }]
}
```

Max 5 Driver. Kein Satz „Korrektur 80 % wegen Hormuz“.

### 3.2 Ordnung — Hormuz als Beispiel, nicht als Default

| Ordnung | Kette | Messbar |
|---------|-------|---------|
| 1 | Enge dicht → Spot-Brent/WTI \(\uparrow\) | `DCOILWTICO`, `DCOILBRENTEU` \(z(\Delta_{20d})\) |
| 2 | Energie → Headline-CPI, Dünger, Fracht | CPI Energy-Gewicht ~3,5 % Benzin; Dallas Fed short-run ε≈0 |
| 3 | BE-Inflation → 10Y \(\uparrow\) → WACC \(\uparrow\) → Wachstums-/ALQ-Risiko | `T10YIE`, `DGS10`, `DFII10` |

Private Credit analog:

| 1 | Funds stoppen Redemptions / Spreads leveraged loans | kein FRED-Pflicht; Flag aus Briefing + `BAA10Y` |
| 2 | Bank-Kreditlinien gezogen, SLOOS strafft | `DRTSCIS` |
| 3 | Capex runter, Default-Welle → ALQ | Sahm *danach* |

LLM schreibt die Ketten. Code prüft, ob `seriesHint` \(z\) wirklich läuft. Wenn WTI-\(z\)<0,5: Driver `available:false`, Text ausblenden — genau das hätte den April-2026-Hormuz-Absatz ohne Spot-Schock verhindert.

### 3.3 Prompt-Kern (ein Satz)

*Extrahiere höchstens fünf Treiber. Jeder Treiber: Buch, drei Ordnungen, FRED/FMP-IDs. Keine Personen, keine Score-Zahl, kein „Administration bullish“. Wenn die Kette ohne Serie auskommt: verwerfen.*

Modell: bestehendes `callLLMJson` / OpenRouter (Haiku oder gleich). Nicht Perplexity-Computer als Score.

Trigger: wöchentlich nach H.4.1 **oder** wenn irgendein Kredit-/Öl-Slot \(|z|>1{,}5\). Nicht bei jedem Dashboard-Klick.

---

## 4. Dateien

| Datei | Rolle |
|-------|-------|
| **diese Spec** | Soll |
| `server/recession.ts` | 17er Ist; `generateFazit` Hormuz raus |
| `server/recession-markets.ts` | RSI/MACD, anderes Buch |
| `shared/tech-rsi.ts` | nicht hier |
| `server/llm-openrouter.ts` | `callLLMJson` |
| `server/researcher.ts` | Briefing-Cache-Vorbild |
| `WORK_RESEARCHER_BRIEFING_REGIONAL.md` | Spillover-Prompt |
| `WORK_RECESSION_RATE_OIL_BRIDGE.md` | Öl → CPI → 10Y |
| `WORK_RECESSION_FRED_SAHM.md` | Sahm \(s(z)\) |
| `client/src/pages/RecessionDashboard.tsx` | S9 Fazit durch Driver-Karten ersetzen |

Neu (Soll-Code, noch nicht gebaut):

- `server/recession-credit-book.ts` — SLOOS, Price/Rent, TED-Ersatz, \(s(z)\)
- `server/recession-drivers.ts` — OpenRouter → Schema + Gate gegen Live-\(z\)
- Cache-Key `recession_drv_v1_{region}_{week}`

---

## 5. DoD

1. Fixture 2006-12: `T10Y2Y<0` → Leading-Slot nicht 50.
2. Fixture 2007-01: CAPE 27 ≠ Max-Eimer; \(P_{Korr,12M}\) nicht 80.
3. Fixture 2008-10: Sahm feuert, Label coincident, nicht „hätte 2006 gewarnt“.
4. Löschen des Hormuz-Strings in `generateFazit` ändert keine der 17 rawScores.
5. Driver ohne \(|z|>0{,}5\) auf `seriesHint` → UI aus.
6. Kein `BESSENT_WINDOW`, kein `if (year===2008) housing=true`.
7. GIS/Korrektur-Gewicht unverändert 0,15 / Buffett×2 — Kredit-Slots extra, nicht doppelt auf CAPE.
