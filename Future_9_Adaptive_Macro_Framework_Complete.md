# Adaptive Macro Framework – Rezessions- und Korrektur-Wahrscheinlichkeit
## Vollständige Dokumentation (Stand 2026-10-09)

### Ziel
Ein nicht-hardcodiertes, adaptives Scoring-System für Rezessions- und Korrektur-Wahrscheinlichkeiten, das sich an das Marktumfeld (Habitat) anpasst – analog zu Thesis- und Managing-Score bei Aktien.

---

## 1. Kernkonzept

Das Framework kombiniert:
- Adaptive quantitative Signale (z-Score / Perzentil über 15–20 Jahre)
- Ökonomische Dimensionen
- Managing-Score (Materialisierung von Narrativen)
- Makro-Bilanzwidersprüche
- Realized Growth Gap und Inventory/Demand Gap
- Habitat-basierte Layer-Gewichtung
- Optionalen LLM-Call

---

## 2. Datenquellen und Datenpunkte

| Signal | Quelle | Datenpunkt | Frequenz |
|--------|--------|------------|----------|
| Gewinnwachstum vs. Trend | Multpl / Shiller / FMP | S&P TTM EPS YoY | Quartalsweise |
| Realized Growth Gap | FMP / Earnings Aggregate | Surprise-Rate, Forward-Revisionen | Quartalsweise |
| Inventory/Demand Gap | FRED | Inventory-to-Sales, DGORDER vs Shipments | Monatlich |
| Sahm-Regel | FRED SAHMREALTIME | ALQ-Veränderung | Monatlich |
| Zinskurve | FRED T10Y2Y / T10Y3M | Spread | Täglich |
| Kreditspreads | FRED BAA10Y | Spread | Täglich |
| Margin Debt | FINRA | Debit Balances YoY | Monatlich |
| VIX | FRED VIXCLS | Close | Täglich |
| Buffett | Yahoo ^W5000 + FRED GDP | TMC/GDP | Täglich |
| CAPE | Multpl | Shiller PE10 | Monatlich |
| Realzins | FRED DFII10 | 10J Real Yield | Täglich |
| Konzentration | Berechnung | Cap-Weight RSL − Equal-Weight RSL | Täglich |
| CAPEX Hyperscaler | Aggregate / Berichte | YoY CAPEX | Quartalsweise |

---

## 3. Historische Prüfung (2001, 2008, 2022)

| Konzept | 2001 | 2008 | 2022 | Kommentar |
|---------|------|------|------|-----------|
| Reine Bewertung | Teilweise/spät | Nein | Ja | Sieht Level, nicht den Bruch |
| Realized Growth Gap | Nein/spät | Nein/spät | Mittel | Oft zu spät |
| Inventory/Demand Gap | Nein | Teilweise | Nein | Nur bei Lagerzyklen |
| Kredit / Margin Debt | Schwach | **Ja** | Mittel | 2008 klar |
| Managing-Score | **Besser** | Mittel | **Ja** | Zinsen + Earnings |
| Habitat-Gewichtung | **Besser** | Gut | **Ja** | Verstärkt richtige Signale |
| Managing + Habitat | **Am besten** | Gut | **Am besten** | Beste Kombi für 2001/2022 |

**Fazit:** Managing-Score + Habitat-Gewichtung am stärksten für bewertungs-/zinsgetriebene Phasen. Kredit-/Widerspruchs-Seite nötig für 2008.

---

## 4. Layer-Gewichtung (Code-Schema)

```typescript
function calculateAdaptiveWeights(habitat, signals) {
  const base = {
    bewertung: 1.8,
    kredit: 1.2,
    realwirtschaft: 1.0,
    geldpolitik: 1.0,
    sentiment: 0.8,
    managing: 1.5,
    widersprueche: 1.3,
  };

  // Habitat
  if (habitat.regime === "restrictive") {
    base.bewertung *= 1.3;
    base.managing *= 1.2;
    base.geldpolitik *= 1.2;
  }
  if (habitat.concentration > 0.4) {
    base.bewertung *= 1.15;
  }

  // Layer: Stärke erhöht Gewicht
  for (const s of signals) {
    const dim = mapToDimension(s.indicator);
    if (dim && base[dim]) {
      base[dim] *= (0.7 + s.strength * 0.6);
    }
  }
  return base;
}
```

---

## 5. Managing-Score (Korrektur)

Prüft Materialisierung:
- CAPEX vs. Trend
- EPS-Wachstum vs. Trend
- Realzins vs. Trend
- Konzentration (Cap − Equal RSL)

Negativer Score erhöht Korrektur-Wahrscheinlichkeit.

---

## 6. Vergleich zu Aktien-Thesis/Managing

| Aktien | Makro |
|--------|-------|
| Thesis prüft Narrativ vs. Zahlen | Managing prüft CAPEX/EPS im Zyklus |
| Managing prüft Umsetzung | Widersprüche prüfen Inkonsistenzen |
| Dynamische Gewichtung | Habitat + Layer-Gewichtung |
| Qualitative Einschätzung | LLM-Call |

---

## 7. Grenzen

- Datenverzug (Quartalsdaten)
- Exogene Schocks ohne Vorlauf
- Europa: teilweise schwächere Daten (Surprise-Rate, Equal-Weight, CAPEX)
- LLM nur leichte Kalibrierung

---

## 8. Verbesserungsvorschläge

- Europa-Fallbacks definieren
- Habitat-Erkennung verfeinern
- LLM-Output strukturiert (JSON) + Cache
- Transparenz im Dashboard (welche Gewichte angepasst wurden)
- Historische Validierung auf 2000/2008/2022

---

**Status:** Konzept vollständig dokumentiert. Umsetzung über Analyse-Button mit adaptiver Gewichtung und optionalem LLM-Call vorgesehen.

---

## 9. OpenRouter LLM-Call (Implementierung)

### Zweck
Leichte Kalibrierung der Gewichte und Frühwarn-Hinweise über OpenRouter.

### Code-Schema

```typescript
import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function getAIWeightSuggestion(
  habitat: Habitat,
  signals: Signal[],
  currentWeights: Record<string, number>
): Promise<Record<string, number> | null> {
  const prompt = `
Du bist ein Makro-Analyst. Analysiere das aktuelle Habitat und schlage leichte Gewichtungsanpassungen vor.

Habitat: ${habitat.regime}
Konzentration (Cap-Equal RSL): ${habitat.concentration.toFixed(2)}
Gewinnmomentum (z-Score): ${habitat.growthMomentum.toFixed(2)}

Aktuelle Signale:
${signals.slice(0, 10).map(s => 
  `- ${s.indicator}: z=${s.zScore.toFixed(2)}, strength=${s.strength.toFixed(2)}, direction=${s.direction}`
).join("\n")}

Aktuelle Gewichte:
${JSON.stringify(currentWeights, null, 2)}

Aufgabe:
1. Liegt ein struktureller Regime-Wechsel oder erhöhtes Risiko vor?
2. Schlage angepasste Gewichte vor (max ±25% Abweichung von den aktuellen Werten).
3. Gib eine kurze Begründung (1-2 Sätze).

Antworte ausschließlich im folgenden JSON-Format:
{
  "adjustedWeights": { "bewertung": 1.9, "managing": 1.6, ... },
  "riskFlag": 0,
  "reason": "Kurze Begründung"
}
`;

  try {
    const response = await openrouter.chat.completions.create({
      model: "anthropic/claude-3.5-sonnet", // oder anderes Modell
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    
    // Validierung: max ±25%
    const validated: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.adjustedWeights || {})) {
      const current = currentWeights[key] ?? 1;
      const clamped = Math.max(current * 0.75, Math.min(current * 1.25, value as number));
      validated[key] = clamped;
    }

    return validated;
  } catch (err) {
    console.warn("[OpenRouter] Weight suggestion failed:", err);
    return null; // Fallback auf quantitative Gewichte
  }
}
```

### Integration beim Analyse-Button

```typescript
// Nach Berechnung der quantitativen Gewichte
const quantWeights = calculateAdaptiveWeights(habitat, signals);

// Optional: OpenRouter-Call
const aiWeights = await getAIWeightSuggestion(habitat, signals, quantWeights);

// Finale Gewichte (AI oder Fallback)
const finalWeights = aiWeights ?? quantWeights;

// Scores berechnen
const scores = computeSubgroupScores(signals, finalWeights);
```

### Hinweise
- API-Key über `OPENROUTER_API_KEY` (Umgebungsvariable)
- Modell frei wählbar (Claude, GPT-4o, Gemini etc.)
- Bei Fehler oder Timeout: automatischer Fallback auf quantitative Gewichte
- Output wird validiert (max ±25% Abweichung)
- Empfehlung: Response cachen (z. B. 6–12h), um Kosten und Latenz zu reduzieren

### Beispiel-Response
```json
{
  "adjustedWeights": {
    "bewertung": 2.1,
    "managing": 1.8,
    "kredit": 1.1
  },
  "riskFlag": 1,
  "reason": "Restriktives Habitat mit steigenden Realzinsen. Bewertung und Managing sollten höher gewichtet werden."
}
```
