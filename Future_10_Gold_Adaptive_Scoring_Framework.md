# Gold Adaptive Scoring Framework
## Vollständige Dokumentation (Stand 2026-10-09)

### Ziel
Adaptives Scoring für Gold analog zur 1–20-Aktienanalyse und dem Makro-Framework. Bestehende Modelle (Real-Yield, Multi-Faktor, Gates) bleiben Basis, werden um Layer-Gewichtung, Policy-Signale und technische Bestätigung erweitert.

---

## 1. Bestehende Gold-Logik (Ist-Zustand)

| Komponente | Datei | Beschreibung |
|------------|-------|--------------|
| Technical Score | gold-routes.ts | RSI + MA200-Abweichung, feste Schwellen |
| Real-Yield-Modell | gold-realyield-model.ts | OLS Gold ~ Real10Y (252 Tage), Fair Value |
| Multi-Faktor | gold-realyield-model.ts | Real10Y + DXY + WALCL |
| Gates | gold-realyield-model.ts | GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS, Decoupling |
| Monte Carlo | gold-routes.ts | GBM |
| Chart | Client | Gold vs Real10Y (Dual-Axis) |

---

## 2. Neue adaptive Struktur

### Dimensionen und Signale

| Dimension | Signale | Datenquelle | Richtung |
|-----------|---------|-------------|----------|
| **Real Yield** | Fair-Value-Premium (z-Score), Real10Y-Trend | FRED DFII10 | Fallend = bullish |
| **Policy** | Fed Funds Änderung, Realzins-Rückgang | FRED FEDFUNDS, DFII10 | Senkung = bullish |
| **Liquidity** | M2 YoY, WALCL, Netto-Liquidität | FRED M2SL, WALCL | Steigend = bullish |
| **Inflation** | Breakeven (T10YIE) | FRED T10YIE | Steigend = bullish (bedingt) |
| **Supply** | AISC-Margin, Kapitulationszone | Aggregate / Berichte | Preis << AISC = Stress |
| **Technical** | RSI, MA200-Abweichung, Golden/Death Cross, Volumen | Preisdaten | Cross = Bestätigung |
| **Macro** | DXY-Trend | FRED DTWEXBGS / Yahoo | Fallend = bullish |
| **News** | LLM-Flag aus Gold-News | RSS / API + OpenRouter | Leichtes Flag |

### Datenpunkte

| Signal | FRED / Quelle | Frequenz |
|--------|---------------|----------|
| Real10Y | DFII10 | Täglich |
| M2 | M2SL | Monatlich |
| Fed Bilanz | WALCL | Wöchentlich |
| Breakeven | T10YIE | Täglich |
| DXY | DTWEXBGS | Täglich |
| Fed Funds | FEDFUNDS | Monatlich |
| Gold Preis | GCUSD / Yahoo | Täglich |
| Volumen | GCUSD / Yahoo | Täglich |
| AISC | Unternehmensaggregate | Quartalsweise |
| Gold-News | Kitco, Reuters, WGC, Fed | Laufend |

---

## 3. Layer-Gewichtung

```typescript
const baseWeights = {
  realYield: 1.8,
  policy: 1.3,
  liquidity: 1.2,
  inflation: 0.8,
  supply: 0.9,
  technical: 1.0,
  macro: 0.9,
};

// Habitat
if (regime === "stress") baseWeights.realYield *= 1.25;
if (realRateTrend < -0.3) baseWeights.policy *= 1.2;
if (m2GrowthZ > 1) baseWeights.liquidity *= 1.15;

// Stärke-Layer
effectiveWeight = baseWeight * (0.7 + strength * 0.6);
```

---

## 4. Technische Analyse (analog BTC) – detailliert

### MA-Crosses

| Signal | Definition | Score | Chart-Overlay |
|--------|------------|-------|---------------|
| **Golden Cross** | 50-Tage-MA kreuzt 200-Tage-MA von unten | +1 (bullish) | 50-MA + 200-MA |
| **Death Cross** | 50-Tage-MA kreuzt 200-Tage-MA von oben | -1 (bearish) | 50-MA + 200-MA |
| Preis > 200-MA | Aktueller Preis über 200-MA | positiv | 200-MA |
| Preis < 200-MA | Aktueller Preis unter 200-MA | negativ | 200-MA |

### Volumen

| Signal | Definition | Einbindung |
|--------|------------|------------|
| Volumen-Spike | Volumen > 1.5× 20-Tage-Durchschnitt | Bestätigung von Crosses |
| Volumen-Trend | Steigendes Volumen bei Aufwärtsbewegung | Bullish-Bestätigung |
| Volumen-Divergenz | Preis steigt, Volumen fällt | Warnung |

### Weitere technische Signale

| Signal | Definition | Analog BTC |
|--------|------------|------------|
| RSI(14) | Relativ zur eigenen 1–2-Jahres-Historie | Ja |
| MACD | 12/26/9 Cross | Ja |
| Bollinger Band | Preis außerhalb Band | Optional |
| ATR | Volatilität für Stops | Optional |

### Code-Schema MA-Cross

```typescript
function detectMACross(prices: number[]): {
  golden: boolean;
  death: boolean;
  ma50: number;
  ma200: number;
} {
  if (prices.length < 200) return { golden: false, death: false, ma50: 0, ma200: 0 };
  const ma50 = sma(prices, 50);
  const ma200 = sma(prices, 200);
  const prevMa50 = sma(prices.slice(0, -1), 50);
  const prevMa200 = sma(prices.slice(0, -1), 200);
  return {
    golden: prevMa50 <= prevMa200 && ma50 > ma200,
    death: prevMa50 >= prevMa200 && ma50 < ma200,
    ma50,
    ma200,
  };
}
```

---

## 5. Angebotsseite (Miner)

| Signal | Beschreibung | Status |
|--------|--------------|--------|
| AISC-Margin | (Preis - AISC) / AISC | Gate vorhanden, als Signal erweitern |
| Kapitulationszone | Preis nahe AISC + Produktionsrückgang | Fehlt |
| Angebotsreaktion | Veränderung Minenproduktion | Fehlt |

---

## 6. Policy- und Liquiditätssignale

| Treiber | Positiv wenn | Daten |
|---------|--------------|-------|
| Zinsenkungen | Real10Y fällt, Fed Funds sinkt | DFII10, FEDFUNDS |
| Fiskal | Defizitwachstum | Treasury / FRED |
| M2-Expansion | M2 YoY hoch | M2SL |
| Fed-Bilanz | WALCL steigt | WALCL |

---

## 7. Makro-Overlays für den Gold-Chart

| Overlay | Quelle | Priorität | Begründung |
|---------|--------|-----------|------------|
| Real10Y (DFII10) | FRED | **Sehr hoch** | Kern-Treiber |
| M2 YoY | FRED M2SL | Hoch | Liquidität |
| DXY | FRED / Yahoo | Hoch | Inverser Treiber |
| Breakeven (T10YIE) | FRED | Mittel | Inflationserwartungen |
| WALCL | FRED | Mittel | Fed-Bilanz |
| **50-MA / 200-MA** | Berechnet | **Hoch** | Golden/Death Cross |
| Volumen | Preisdaten | Mittel | Bestätigung |
| AISC-Linie | Aggregate | Niedrig–Mittel | Angebotsseite |

---

## 8. Gates (bestehend + Erweiterung)

| Gate | Bedingung | Wirkung |
|------|-----------|---------|
| GOLD_REAL_YIELD_REGIME | Stress-Regime + nicht decoupled | Warnung |
| GOLD_AISC_STRESS | Preis < AISC × 1.15 | Warnung |
| Decoupling | corr > -0.25 | Modell unzuverlässig |
| Neu: Policy-Mismatch | Hoher Preis bei steigendem Realzins | Warnung |
| Neu: Death Cross aktiv | 50-MA < 200-MA | Technische Warnung |

---

## 9. Gold-News-Sektion (analog BTC-Liquidität)

### Zweck
Qualitative News und Catalysts für Gold erfassen und als leichtes Flag in den Score einfließen lassen – analog zur BTC-Liquiditätssektion.

### Quellen
- Kitco, Reuters, World Gold Council (WGC)
- Fed-Statements, Zentralbank-Käufe
- Minen-News (große Produzenten)
- Geopolitische Ereignisse

### LLM-Integration (OpenRouter)

```typescript
async function getGoldNewsImpact(newsItems: string[]): Promise<{
  flag: number; // -1 bis +1
  summary: string;
}> {
  const prompt = `
Aktuelle Gold-relevante News:
${newsItems.slice(0, 8).map((n, i) => `${i + 1}. ${n}`).join("\n")}

Bewerte den Gesamteinfluss auf Gold:
- flag: -1 (bearish) bis +1 (bullish), 0 = neutral
- summary: 1-2 Sätze Begründung

Antworte nur als JSON:
{ "flag": 0.3, "summary": "..." }
`;

  const response = await openrouter.chat.completions.create({
    model: "anthropic/claude-3.5-sonnet",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  return {
    flag: Math.max(-1, Math.min(1, parsed.flag ?? 0)),
    summary: parsed.summary ?? "Keine klare Richtung",
  };
}
```

### Einbindung in den Score
- News-Flag (±0.3 bis ±1) als leichte Anpassung der Policy- oder Supply-Dimension
- Oder als separater Hinweis im Dashboard (nicht als harter Score-Bestandteil)
- Cache: 6–12h, um API-Kosten zu begrenzen

### Dashboard-Anzeige
- Kurze News-Zusammenfassung
- Flag (bullish / neutral / bearish)
- Timestamp der letzten Aktualisierung

---

## 10. Gesamtfluss

1. Daten laden (FRED + Preis + Volumen)
2. Adaptive Signale berechnen (z-Score / Stärke)
3. Regime / Habitat bestimmen
4. Layer-Gewichtung anwenden
5. Technical (MA-Cross, Volumen, RSI) einbeziehen
6. Supply-Signale (AISC) ergänzen
7. Optional: Gold-News-Flag via LLM einholen
8. Score aggregieren
9. Gates als Warnungen anzeigen
10. Chart mit Makro-Overlays + 50/200-MA + Volumen
11. News-Sektion im Dashboard anzeigen

---

## 11. Offene Punkte

- AISC-Zeitreihe beschaffen
- Kapitulationszone definieren
- Volumen-Daten zuverlässig anbinden
- Gold-News-Quellen anbinden (RSS/API)
- Backtest der MA-Cross-Signale auf Gold
- Europa-/globale Zentralbank-Käufe (LLM)

---

**Status:** Konzept dokumentiert inkl. detaillierter technischer Signale (Death/Golden Cross, Volumen) und Gold-News-Sektion (analog BTC-Liquidität).
