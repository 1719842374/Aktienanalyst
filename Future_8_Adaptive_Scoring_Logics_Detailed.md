# Adaptive Scoring-Logiken – Detaillierte Erklärung

## Warum die aktuelle Logik nur teilweise adaptiv ist

Die aktuelle Scoring-Logik verwendet **feste Zonen** (z. B. Buffett >200% = +16, CAPE >35 = +12.6, VIX >30 = +4).  
Diese Schwellen sind an die letzten ~25 Jahre kalibriert und funktionieren für die aktuelle Marktphase gut, sind aber nicht dynamisch.

**Problem bei historischen Crashes:**
- 2008: Buffett lag bei ~100–120% → Score -8 (kein Signal)
- 2000: CAPE ~44 → starkes Signal, aber Buffett nur schwach
- Die Zonen sind nicht an den langfristigen Mittelwert oder die aktuelle Verteilung angepasst

---

## 1. Was bedeutet „adaptiv“?

Eine adaptive Logik passt die Bewertungsschwellen an die historische Verteilung der jeweiligen Serie an, statt feste Absolutwerte zu nutzen.

**Zwei gängige Methoden:**

| Methode | Beschreibung | Vorteil | Nachteil |
|---------|--------------|---------|----------|
| **z-Score** | Wie viele Standardabweichungen liegt der aktuelle Wert vom rollierenden Mittelwert entfernt? | Gut für Normalverteilungen | Empfindlich gegenüber Ausreißern |
| **Perzentil** | In welchem Perzentil der letzten X Jahre liegt der aktuelle Wert? | Robust gegen Ausreißer | Braucht ausreichend Historie |

---

## 2. z-Score-Ansatz (rollierend)

### Formel
\[
z = \frac{\text{aktueller Wert} - \mu_{20J}}{\sigma_{20J}}
\]

- \(\mu_{20J}\): Mittelwert der letzten 20 Jahre
- \(\sigma_{20J}\): Standardabweichung der letzten 20 Jahre

### Score-Umrechnung (Beispiel)
```typescript
function zScoreToScore(z: number): number {
  // Begrenze auf ±4
  const capped = Math.max(-4, Math.min(4, z));
  return capped * 1.5; // Skalierung
}
```

**Beispiel Buffett 2008:**
- Wenn der 20-Jahres-Mittelwert ~120% und σ ~30% war → z ≈ -0.5 → schwacher negativer Score
- Aktuell (249%) wäre z sehr hoch → starker positiver Score

**Vorteil:** Die Schwelle passt sich automatisch an das Regime an.

---

## 3. Perzentil-Ansatz

### Logik
- Berechne das Perzentil des aktuellen Werts in der Historie der letzten 20–30 Jahre.
- >90. Perzentil → hoher Score
- <10. Perzentil → negativer Score

```typescript
function percentileScore(value: number, history: number[]): number {
  const sorted = [...history].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= value).length / sorted.length;
  const percentile = rank * 100;

  if (percentile > 90) return 4;
  if (percentile > 75) return 2;
  if (percentile < 10) return -4;
  if (percentile < 25) return -2;
  return 0;
}
```

**Vorteil:** Sehr robust, keine Annahmen über die Verteilung.

---

## 4. Vergleich: Fest vs. Adaptiv bei historischen Crashes

| Crash | Fest (aktuell) | z-Score (20J) | Perzentil (20J) |
|-------|----------------|---------------|-----------------|
| 2001 Buffett | +4 | Mittel | Mittel |
| 2008 Buffett | -8 | Neutral/schwach | Neutral |
| 2022 Buffett | +16 | Stark | Stark |
| 2000 CAPE | +12.6 | Sehr stark | Sehr stark |
| 2008 CAPE | 0 | Neutral | Neutral |

**Ergebnis:**  
Beide adaptive Methoden hätten 2008 nicht als extrem überbewertet eingestuft (korrekt, weil der Crash kreditgetrieben war), aber 2000 und 2021/22 klar erkannt.

---

## 5. Praktische Umsetzung im Code

### Minimaler Einstieg (z-Score)

```typescript
function calculateAdaptiveScore(
  current: number,
  history: number[], // letzte 20 Jahre monatlich
  maxScore: number = 4
): number {
  if (history.length < 60) return 0; // zu wenig Daten

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
  const std = Math.sqrt(variance);

  const z = std === 0 ? 0 : (current - mean) / std;
  const capped = Math.max(-4, Math.min(4, z));
  return (capped / 4) * maxScore;
}
```

### Empfehlung für das Dashboard

| Indikator | Empfohlene Methode | Fenster |
|-----------|--------------------|---------|
| Buffett | Perzentil oder z-Score | 20–25 Jahre |
| CAPE | Perzentil | 20–30 Jahre |
| VIX | Fest oder z-Score | 10–15 Jahre |
| Sahm | Fest (bereits adaptiv) | – |

---

## 6. Vor- und Nachteile

**Vorteile adaptiver Logik:**
- Weniger abhängig von festen Schwellen
- Passt sich an Regime-Wechsel an (z. B. höhere Bewertungen in Niedrigzinsphasen)
- Bessere historische Konsistenz

**Nachteile:**
- Braucht ausreichend lange Historie
- Komplexer zu erklären und zu debuggen
- Bei strukturellen Brüchen (z. B. neue Bewertungsregime) kann der rollierende Mittelwert verzerren

---

## 7. Fazit

Die aktuelle Logik ist **teilweise adaptiv** (VIX, Sahm), aber die wichtigsten Bewertungsindikatoren (Buffett, CAPE) nutzen feste Schwellen.  

Eine Umstellung auf **z-Score oder Perzentil über 20–30 Jahre** würde die Logik robuster machen und historische Crashes konsistenter bewerten, ohne dass man die Schwellen manuell anpassen muss.
