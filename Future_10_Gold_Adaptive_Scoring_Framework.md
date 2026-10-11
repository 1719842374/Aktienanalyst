# Gold Adaptive Scoring Framework
## Vollständige Dokumentation (Stand 2026-10-11)

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
| **Inflation** | Inflations-BE (T10YIE) | FRED T10YIE | Steigend = bullish (bedingt) |
| **Supply** | AISC-Margin, Kapitulationszone | Quartals-AISC großer Produzenten | Preis << AISC = Stress |
| **Technical** | RSI, MA200-Abweichung, Golden/Death Cross, Volumen | Preisdaten | Cross = Bestätigung |
| **Macro** | DXY-Trend | FRED DTWEXBGS / Yahoo | Fallend = bullish |
| **News** | LLM-Flag aus Gold-News | RSS / API + OpenRouter | Leichtes Flag |

### Datenpunkte

| Signal | FRED / Quelle | Frequenz |
|--------|---------------|----------|
| Real10Y | DFII10 | Täglich |
| M2 | M2SL | Monatlich |
| Fed Bilanz | WALCL | Wöchentlich |
| Inflations-BE | T10YIE | Täglich |
| DXY | DTWEXBGS | Täglich |
| Fed Funds | FEDFUNDS | Monatlich |
| Gold Preis | GCUSD / Yahoo | Täglich |
| Volumen | GCUSD / Yahoo | Täglich |
| AISC | Quartalsberichte Newmont / Barrick / Agnico Eagle | Quartalsweise |
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

## 5. Angebotsseite (Miner) – AISC-Linie

### Unterschied zu T10YIE
Der Chart-Chip „Breakeven“ zeigt aktuell die **Inflationserwartung** (FRED T10YIE), **nicht** die Produktionskosten der Minen. Der Chip wird umbenannt in „Inflations-BE (T10YIE)“.

### AISC-Linie (neu)
| Element | Beschreibung |
|---------|--------------|
| **Datenquelle** | Quartals-AISC aus den veröffentlichten Quartalsberichten von Newmont (NEM), Barrick (B) und Agnico Eagle (AEM) |
| **Speicherung** | Kleine statische Datendatei im Repo (z. B. `server/data/gold-aisc.json`), jeder Wert mit Quelle + Datum |
| **Plot** | Gestufte Linie auf der **Preisachse** (USD/oz), nicht auf der %-Achse |
| **Stresszone** | Preis < AISC × 1.10–1.15 als markierter Bereich (Kapitulations-/Stresszone) |
| **Fehlende Quartale** | n/a, nichts wird geschätzt oder interpoliert |
| **Optional** | Mittelwert oder Median der drei Produzenten als eine Linie; Einzelwerte als Tooltip |

**Hinweis:** World Gold Council (gold.org/goldhub/data/aisc-gold) bietet globale Aggregate (Metals Focus). Für eine stabile, quelloffene Lösung im Repo sind die Unternehmensberichte vorzuziehen.

| Signal | Beschreibung | Status |
|--------|--------------|--------|
| AISC-Margin | (Preis - AISC) / AISC | Gate vorhanden, als Signal erweitern |
| AISC-Linie | Gestufter Plot auf Preisachse | **Offen** |
| Kapitulationszone | Preis nahe oder unter AISC | **Offen** |
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
| **Inflations-BE (T10YIE)** | FRED | Mittel | Inflationserwartungen (nicht Miner-Kosten) |
| WALCL | FRED | Mittel | Fed-Bilanz |
| **50-MA / 200-MA** | Berechnet | **Hoch** | Golden/Death Cross |
| Volumen | Preisdaten | Mittel | Bestätigung |
| **AISC-Linie** | Quartalsberichte | Hoch (neu) | Miner-Kosten auf Preisachse |

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
10. Chart mit Makro-Overlays + 50/200-MA + Volumen + AISC-Linie
11. News-Sektion im Dashboard anzeigen

---

## 11. Offene Punkte

- **AISC-Linie implementieren** (Quartalsdaten Newmont/Barrick/Agnico Eagle als gestufter Preis-Overlay + Stresszone)
- Chip „Breakeven“ umbenennen in „Inflations-BE (T10YIE)“
- Kapitulationszone definieren
- Volumen-Daten zuverlässig anbinden
- Gold-News-Quellen anbinden (RSS/API)
- Backtest der MA-Cross-Signale auf Gold
- Europa-/globale Zentralbank-Käufe (LLM)

---

**Status:** Konzept dokumentiert inkl. detaillierter technischer Signale, Gold-News-Sektion und klarer Trennung zwischen Inflations-BE (T10YIE) und Miner-AISC.

---

## 12. AISC-Linie (Minen-Breakeven) – Umsetzung (Branch `feat/gold-aisc-line`, Basis `2172856`)

### Was die Linie zeigt
- **AISC (Minen-Breakeven):** Ø der Quartals-AISC (All-in Sustaining Cost, USD/oz, by-product) von Newmont, Barrick und Agnico Eagle. Gestufte Linie auf der **Preisachse**, eigener Chip „AISC (Minen-Breakeven)“ im Gold-Chart (Section 2), standardmäßig aus.
- **Stresszone:** schattiert je Quartalsstufe: rot zwischen AISC und AISC × 1,10 (Stress), gelb zwischen AISC × 1,10 und × 1,15 (Vorwarnung). Ist der Chip an, erweitert sich die Preisachse bis zur Zone.
- **Tooltip:** Quartal, Ø-Wert, Anzahl Firmen, Einzelwerte je Firma mit Veröffentlichungsdatum, Kurs/AISC-Verhältnis. Die Legende nennt das jüngste Quartal und den Abstand.

### Unterschied zu T10YIE
- Der frühere Chip „Breakeven“ heißt jetzt **„Inflations-BE (T10YIE)“**. Er zeigt die 10J-Breakeven-Inflation (FRED T10YIE) in Prozent auf einer rechten Achse, also eine **Inflationserwartung**.
- AISC ist ein **Kostenniveau der Minen in USD/oz**. Beide Größen haben nichts miteinander zu tun; die Funktion des T10YIE-Chips bleibt unverändert.

### Quelle und Regeln
- Datei: `shared/data/gold-aisc-quarterly.ts`. Jeder Eintrag hat Firma, Quartal, AISC, Quelle-URL (SEC-Exhibit des Quartalsberichts) und Veröffentlichungsdatum.
- Quartale 2024-Q3 bis 2026-Q2. Newmont erst ab 2025-Q1 (By-Product-AISC aus der Übersicht im Q2-2026-Bericht; 2024 nicht in dieser Basis belegt). Barrick und Agnico Eagle ab 2024-Q3.
- Ø nur bei mindestens 2 Firmenwerten, sonst **n/a**. Nichts wird geschätzt oder interpoliert; ein n/a-Quartal beendet die Stufe.
- Wirksam ab Quartalsende + 45 Tage (`availableFrom`). Alle zitierten Berichte erschienen innerhalb dieser Frist, damit gibt es im Score keinen Lookahead.
- Agnico Eagle hat 2026 die Zusammensetzung von AISC revidiert (Meadowbank/Nunavut). Für 2025-Q1/Q2 steht der Wert in der alten Zusammensetzung, ab 2026 in der neuen (FY2025: 1.313 neu vs. 1.339 alt).
- WGC/Metals Focus (globale AISC) bleibt eine mögliche spätere Ergänzung, ist aber nicht frei als Zeitreihe verfügbar.

### Eine Reihe für Chart, Supply-Layer und Gate
| Verbraucher | Datei | Eingang |
|---|---|---|
| Chart-Linie und Stresszone | `client/src/components/gold/GoldPriceChart.tsx` | `goldAiscAt(date)` |
| Supply-Layer (AISC-Margin, z-Score) | `server/gold-routes.ts` → `scoreGoldAdaptive({ aisc: goldAiscSteps() })` | vorher `aisc: null` |
| Gate `GOLD_AISC_STRESS` (Preis < AISC × 1,15) | `server/gold-routes.ts` → `runRealYieldGoldModel(…, goldAiscByDate(…), goldAiscAt(letztes Kursdatum))` | vorher ohne AISC |

### Gewollte Score-Änderung
- Vorher: Supply-Layer n/a („AISC-Quelle fehlt“), Gate `GOLD_AISC_STRESS` inaktiv („AISC-Daten nicht verfügbar“).
- Nachher: Supply-Layer mit AISC-Margin-z-Score. Das Gate wertet den Abstand zum jüngsten Quartal aus (2026-Q2: Ø 1.649 USD/oz).
- Test: `script/test-gold-aisc-line.ts` (Datenvalidierung, Stresszone, n/a-Pfad, Verdrahtung).

| Signal | Status |
|---|---|
| AISC-Linie | Umgesetzt (Branch, PR offen) |
| Kapitulationszone | Umgesetzt als Stresszone × 1,10 / × 1,15 |
| AISC-Margin im Supply-Layer | Umgesetzt |
| Angebotsreaktion (Minenproduktion) | Fehlt weiterhin |
