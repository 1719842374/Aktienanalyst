# WORK_NEWS_SENTIMENT.md — News-Sentiment falsch rot (−100)

> Stand: 16.08.2026 | Nur Dokumentation  
> Symptom (Live LYB / Section 2): positive Headlines als **bearish / −100 / rot**, Header „8 bearish · 2 neutral“, **0 bullish**

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.

---

# 1 — Symptom (Zahlen, Daten, Fakten)

## 1.1 Live-Beispiel LyondellBasell (LYB), 16.08.2026

UI: Section 2 „Aktuelle Nachrichten (10)“ — Badge **▼ 8 bearish · 2 neutral**.

| Headline (Kurz) | Inhaltlich | UI-Score | UI-Farbe |
|-----------------|------------|----------|----------|
| Aktie **steigt** nach **starken** Q2-2026-Zahlen … | positiv | **−100** | rot |
| Position **Raised** by Russell Investments | eher positiv | **−100** | rot |
| Shares **Acquired** by Janney Montgomery Scott | eher positiv | **−100** | rot |
| Reports Stronger Results, Still Cheap? | eher positiv/neutral | **0** | grau |
| Quartalsdividende 0,69 USD … | neutral/positiv | **−100** | rot |
| Dividend Aug. 31 | neutral/positiv | **−100** | rot |
| stock **falls**, **underperforms** market | negativ | **−100** | rot (hier ok) |
| S&P-Titel … über diese Dividende … freuen | positiv | **−100** | rot |
| LYB Aktienkurs und Chart | neutral | **0** | grau |
| Up 28% YTD … | positiv | **−100** | rot |

**Fakt:** Score-Anzeige = `sentimentScore * 100`. **−100 ⇒ sentimentScore = −1.0**.

---

# 2 — UI-Logik (kein Bug in der Farbe)

**Datei:** `client/src/components/sections/Section2.tsx`

| `news.sentiment` | Punkt | Text | Badge |
|------------------|-------|------|-------|
| `bullish` | grün (`bg-emerald-400`) | grün | z. B. `+80` |
| `bearish` | rot (`bg-red-400`) | rot | z. B. `-100` |
| `neutral` | grau | grau | `0` |

```ts
const scoreStr = news.sentimentScore != null
  ? (news.sentimentScore > 0
      ? `+${(news.sentimentScore * 100).toFixed(0)}`
      : `${(news.sentimentScore * 100).toFixed(0)}`)
  : '';
```

**Fazit UI:** färbt nur, was Backend setzt. Backend setzt hier systematisch `bearish` / `-1`.

---

# 3 — Backend: zwei Pfade

## 3.1 Reihenfolge in `server/analyze-route.ts`

1. `fetchNewsFromGoogleRSS(ticker, companyName)` → Titel, Source, Zeit  
2. Wenn `useLLM`: `generateCatalystsAndMatchNews(...)` → **LLM setzt** `sentiment` + `sentimentScore` auf `newsItems`  
3. Nur wenn `catalysts.length < 3` (Fallback): `matchNewsToCatalysts(newsItems, catalysts)` → **Keyword-Score überschreibt**

**Wichtig:** Bei erfolgreichem LLM (≥ 3 Katalysatoren) bleiben **nur** die LLM-Scores — Keywords greifen **nicht**.

## 3.2 LLM-Pfad — Prompt-Bias (`server/llm-openrouter.ts`)

Im JSON-Beispiel der Combined-Prompt steht sinngemäß:

```json
"newsMatches":[{"idx":1,"sentiment":"bullish|bearish|neutral","score":-1.0,"catalyst":"K1|...|none"}]
```

| Problem | Wirkung |
|---------|--------|
| Beispiel-Score **−1.0** | Modell kopiert oft −1.0 für (fast) alle `idx` |
| Keine symmetrischen Beispiele (+0.8 / 0 / −0.8) | kein Gegengewicht |
| Keine harte Regel „Score aus Titel, Beispiel nicht kopieren“ | Bias bleibt |

Zuweisung nach LLM-Response:

```ts
item.sentiment = m.sentiment === "bearish" ? "bearish"
  : m.sentiment === "bullish" ? "bullish" : "neutral";
item.sentimentScore = Math.max(-1, Math.min(1, Number(m.score) || 0));
```

**Live-Muster LYB (8× −100):** passt zu „Beispiel −1.0 übernommen“, nicht zu Titelinhalt.

## 3.3 Keyword-Pfad — `matchNewsToCatalysts` (`server/news-peers.ts`)

```ts
const BULLISH_WORDS = [
  'beat','surpass','record','growth','surge','rally','upgrade','buy',
  'outperform','strong','profit','win','award','launch','expand','positive','exceed'
];
const BEARISH_WORDS = [
  'miss','fall','drop','decline','cut','downgrade','sell','underperform',
  'weak','loss','fine','penalty','recall','delay','concern','risk','layoff','warn'
];

const bullishHits = BULLISH_WORDS.filter(w => titleLower.includes(w)).length;
const bearishHits = BEARISH_WORDS.filter(w => titleLower.includes(w)).length;
const total = bullishHits + bearishHits;
const rawScore = total > 0 ? (bullishHits - bearishHits) / total : 0;
item.sentimentScore = Math.max(-1, Math.min(1, rawScore));
item.sentiment = rawScore > 0.1 ? 'bullish' : rawScore < -0.1 ? 'bearish' : 'neutral';
```

| Schwäche | Fakt |
|----------|------|
| **Nur Englisch** | DE „steigt“, „stark“, „Wachstum“, „Gewinn“ → 0 Hits |
| **Fehlende positive EN-Wörter** | `raised`, `acquired`, `dividend`, `buyback`, `upgrade` (upgrade ist drin), `beats` |
| **Substring `includes`** | z. B. `cut` / `fine` / `win` können in anderen Wörtern matchen |
| **Kein DE-Bearish-Gegenstück** | asymmetrisches Risiko bei Mischsprachen |

### Headline-Checks gegen Keyword-Liste

| Titel-Fragment | Bullish-Hits | Bearish-Hits | Keyword-Score |
|----------------|--------------|--------------|---------------|
| „steigt nach starken Q2-Zahlen“ (DE) | 0 | 0 | **0 → neutral** |
| „Position Raised by Russell“ | 0 (*raised* fehlt) | 0 | **0** |
| „Shares Acquired by …“ | 0 (*acquired* fehlt) | 0 | **0** |
| „stock falls … underperforms“ | 0 | ≥1 (`fall`, `underperform`) | **≤ −0.5 → bearish** (korrekt) |
| „Stronger Results“ | ≥1 (`strong` in stronger) | 0 | **> 0.1 → bullish** |

Wenn nur Keywords liefen, wären viele LYB-Zeilen **grau (0)**, nicht rot (−100).  
**Rot kommt primär vom LLM-Pfad**, nicht vom Keyword-Fallback.

---

# 4 — Root-Cause (Priorität)

| Prio | Ursache | Datei |
|------|---------|-------|
| **P0** | Prompt-Beispiel `score: -1.0` → LLM kopiert −1 für viele/alle News | `llm-openrouter.ts` |
| **P1** | Bei LLM-Erfolg kein Keyword-Sanity-Check | `analyze-route.ts` |
| **P2** | Keyword-Liste nur EN, Lücken bei raised/acquired/dividend/DE | `news-peers.ts` |
| **P3** | `includes` statt Wortgrenze | `news-peers.ts` |

---

# 5 — Fix-Spec (umzusetzen)

## 5.1 Prompt (`llm-openrouter.ts`)

- Beispiel-`newsMatches` **symmetrisch**: z. B. ein `score: 0.8` (bullish), ein `0.0`, ein `-0.8` (bearish).
- Explizite Instruktion: *„score und sentiment strikt aus dem Nachrichtentitel ableiten; Beispielwerte nicht kopieren.“*
- Optional: *„Deutsche Titel: steigt/stark/Gewinn/Dividende ≈ bullish; fällt/Verlust/Warnung ≈ bearish.“*

## 5.2 Keyword-Liste erweitern (`news-peers.ts`)

**BULLISH ergänzen (EN + DE):**  
`raised`, `acquire`, `acquired`, `dividend`, `buyback`, `raises`, `upgrade` (schon), `steigt`, `stark`, `starke`, `starken`, `wachstum`, `gewinn`, `rekord`, `anheben`, `übernehmen`

**BEARISH ergänzen (DE):**  
`fällt`, `sinkt`, `verlust`, `warnung`, `kürzung`, `entlassung`

## 5.3 Sanity nach LLM (`analyze-route.ts` oder `news-peers.ts`)

Nach LLM-Matches **immer** Keyword-Score berechnen:

- Wenn Keyword klar bullish (`rawScore > 0.3`) und LLM-Score `< -0.3` → auf Keyword setzen oder Mittelwert (Konflikt-Flag loggen).
- Analog inverse Richtung.

## 5.4 Matching robuster

Wortgrenzen statt reines `includes`, z. B. Regex `\b${word}\b` (EN) bzw. sinnvolle DE-Token-Regeln — verhindert False Positives durch Teilstrings.

## 5.5 Acceptance

```
[ ] Headline „steigt nach starken Zahlen“ → sentiment bullish oder neutral, Score > -0.3 (nicht −1)
[ ] „Position Raised“ / „Shares Acquired“ → nicht systematisch −1
[ ] „falls … underperforms“ → weiterhin bearish
[ ] Prompt-Beispiele enthalten +score und −score
[ ] Bei useLLM=true und ≥3 Katalysatoren: Sanity-Check läuft trotzdem
[ ] Section2: mindestens einige grüne Badges bei gemischt positiven RSS-Titeln (LYB-ähnlich)
```

---

# 6 — File-Map

| Datei | Rolle |
|-------|--------|
| `client/src/components/sections/Section2.tsx` | Anzeige Farbe/Score (ok) |
| `server/llm-openrouter.ts` | LLM newsMatches + Prompt-Beispiel **P0** |
| `server/news-peers.ts` | `matchNewsToCatalysts` Keywords **P2/P3** |
| `server/analyze-route.ts` | Reihenfolge LLM vs. Keywords **P1** |

---

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
