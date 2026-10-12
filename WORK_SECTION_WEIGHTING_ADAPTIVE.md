# WORK – Adaptive Sektions-Gewichtung für die Scoring-Logik

**Stand:** 12.10.2026  
**Ziel:** Jede der 20 Sektionen, soweit sie für die Analyse relevant ist, soll adaptiv und generisch in die Scoring-Logik einfließen. Die Gewichtung entsteht aus relativer Stärke (z-Score / Perzentil), nicht aus festen Prozent-Schwellen. Die bestehende Pipeline (Gates, Thesis Score, Management Score) bleibt, wird aber durch die Sektions-Signale ergänzt.

---

## 1. Prinzip

- **Keine festen Gewichte** pro Sektion oder Lynch-Klasse.
- Jede relevante Sektion liefert ein Signal mit **Richtung** (+1 / -1 / 0) und **Stärke** (0–1), abgeleitet aus relativer Abweichung zur eigenen Historie oder Peer-Vergleich.
- Das Gewicht einer Sektion steigt, wenn ihre Stärke hoch ist und sie mit anderen Signalen in die gleiche Richtung zeigt.
- Valuation darf Technical + Moat nicht einfach overrulen (siehe NVO-Fall).

---

## 2. Relevante Sektionen und Signale

| # | Sektion | Relevantes Signal | Richtung bei Negativ | Stärke-Quelle | Aktueller Einfluss | Soll |
|---|---------|-------------------|----------------------|---------------|--------------------|------|
| 1 | Executive Summary | Ampel / Fazit | – | Aggregat | Zeigt Ergebnis | Spiegelt gewichtetes Ergebnis |
| 5 | Bewertung | Inverse-DCF Upside, g* | Negativ wenn Upside hoch aber Technical negativ | Relativ zu Peer / Historie | Hoch | Gedämpft bei Technical-Negativ |
| 7 | DCF-Modell | Wachstumsannahmen, RSL-Adj. | – | RSL < 105 → -7.5 % | Aktiv | Beibehalten |
| 8 | CRV | Risk/Reward Ratio | Negativ bei niedrigem CRV | Relativ | Positiv | Gedämpft |
| 11 | RSL-Momentum | RSL < 105 | Negativ | RSL-Wert vs. 105 | Nur Growth-Adj. | Hartes negatives Signal |
| 12 | Tech. Analyse | Death Cross, MACD < 0, Kurs < MA200 | Negativ | Anzahl erfüllter Bedingungen (0–4) | „Weicher Zusatz“ | Hartes Gate / Cap |
| 13 | Moat / Porter | Moat Score ≤ 2.5 | Negativ | Moat Score | Schwach | Hartes negatives Signal |
| 14 | PESTEL | Exposure hoch (Political) | Negativ | Exposure-Score | Dämpfungsfaktor 0.94 | Beibehalten |
| 16 | Reverse DCF | g* vs. Modell | Neutral / Positiv | Gap | Sichtbar | Beibehalten |
| 17 | Katalysatoren | Netto-Upside | Positiv | GB-Summe | +13 % | Beibehalten, aber nicht allein entscheidend |
| 18 | Monte Carlo | Downside-Wahrscheinlichkeit | Negativ bei hoch | P(Verlust) | Sichtbar | Beibehalten |
| 19 | Management-Score | Score < 5 | Negativ | 0–10 Score | Separat | In Gesamt-Score einfließen |
| 20 | Zusammenfassung | Signal-Score, Konfliktmatrix | – | Aggregat | LEICHT ATTRAKTIV | Muss Technical + Moat reflektieren |

**Nicht direkt score-relevant (nur Kontext):** 2, 3, 4, 6, 9, 10, 15.

---

## 3. Adaptive Gewichtung – Logik

### 3.1 Signal-Stärke

```typescript
function signalStrength(value: number, threshold: number, history?: number[]): number {
  // Relativ: z-Score oder Abstand zum Schwellenwert
  if (history && history.length > 20) {
    const mean = history.reduce((a, b) => a + b) / history.length;
    const std = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length);
    return Math.min(1, Math.abs((value - mean) / (std || 1)) / 2);
  }
  // Fallback: Abstand zum Schwellenwert
  return Math.min(1, Math.abs(value - threshold) / threshold);
}
```

### 3.2 Dämpfung bei Technical + Moat Negativ

```typescript
const techNegative = deathCross && rsl < 105 && macd < 0;
const moatWeak = moatScore <= 2.5;

if (techNegative && moatWeak) {
  const techStrength = signalStrength(rsl, 105);
  const moatStrength = signalStrength(moatScore, 2.5);
  const damping = 1 - (techStrength * moatStrength * 0.6); // max ~40 % Dämpfung
  valuationWeight *= damping;
}
```

### 3.3 Cap durch Technical-Moat-Block

```typescript
if (techNegative && moatWeak) {
  applyCap("TECH_MOAT_OVERRIDE", 55); // oder dynamisch niedriger
}
```

---

## 4. NVO-Beispiel (Ist vs. Soll)

| Signal | Ist | Stärke | Wirkung im Fix |
|--------|-----|--------|----------------|
| Death Cross | Aktiv | Hoch | Trigger Cap |
| RSL | 87.1 | Hoch | Negativ |
| Moat | 2.0 | Hoch | Negativ |
| Inverse-DCF Upside | +57 % | Hoch | Gedämpft |
| Thesis Score | 4.8/10 | Mittel | Beibehalten |
| Management Score | 4.9/10 | Mittel | Beibehalten |
| **Ergebnis** | 49.5 ATTRAKTIV | – | ≤ 55, NEUTRAL / VORSICHTIG |

---

## 5. Integration in bestehende Pipeline

Aktuell:
```
Quality 55 × Trend 0.9 = 49.5
min(rohScore, strengster Gate-Cap) = 49.5
```

Soll:
```
Quality 55 × Trend 0.9 = 49.5
+ TECH_MOAT_OVERRIDE Cap (bei Death Cross + Moat ≤ 2.5)
+ Adaptive Dämpfung auf Valuation-Gewicht
→ Finaler Score ≤ 55
→ Ampel NEUTRAL / VORSICHTIG
```

Thesis Score und Management Score bleiben separat sichtbar, fließen aber als zusätzliche Dimension in den Gesamt-Score ein (Gewicht proportional zu ihrer Stärke).

---

## 6. Akzeptanzkriterien

1. NVO mit Death Cross + Moat 2.0 + RSL 87 zeigt nicht mehr ATTRAKTIV.
2. Ampel und Fazit wechseln auf NEUTRAL oder VORSICHTIG.
3. Valuation-Upside bleibt sichtbar, treibt den Score aber nicht über den Cap.
4. Titel ohne Death Cross und mit Moat > 3 bleiben unberührt.
5. Logik ist generisch für alle Lynch-Klassen.
6. Thesis Score und Management Score bleiben erhalten und fließen adaptiv ein.
7. Kurze Begründung im Summary: „Valuation gedämpft durch Death Cross + Moat 2.0“.

---

## 7. Betroffene Dateien

- `server/scoring-gates.ts` – neuer Cap TECH_MOAT_OVERRIDE
- `server/scoring-integration.ts` – adaptive Dämpfung
- `client/src/components/sections/SummarySection.tsx` – Ampel / Fazit
- Sektion 11, 12, 13 – Signale an Pipeline durchreichen

---

## 8. Aufwand

~6–10 Stunden (Signal-Stärke, Cap, Dämpfung, Ampel-Anpassung, Test mit NVO und Gegenbeispiel).

**Priorität:** Hoch.
