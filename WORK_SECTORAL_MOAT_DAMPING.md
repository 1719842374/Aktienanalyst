# WORK_SECTORAL_MOAT_DAMPING.md

**Stand:** 2026-10-28  
**Status:** Offen / Implementierungsvorschlag  
**Ziel:** Schwacher Moat + hohe Rivalität dämpft den Gesamtscore auch bei positivem Technical (Golden Cross). Generisch und adaptiv. Zusätzlich: Consumer Brands mit Heritage-Moat (Polo Ralph Lauren, Uniqlo etc.) werden nicht automatisch wie reiner Massenmarkt behandelt.

---

## 1. Ausgangslage

| Punkt | Ist-Zustand |
|-------|-------------|
| Tech-Moat-Override | Greift nur bei **Death Cross** + RSL < 105 + schwachem Moat |
| Golden Cross + schwacher Moat | Kann Score noch zu positiv halten |
| Sektorale Probleme (VW, BYD) | Hohe Rivalität + kein Moat → nicht ausreichend gedämpft bei positivem Technical |
| Consumer Brands | Heritage / Brand kann Moat sein – darf nicht mit reinem Massenmarkt gleichgesetzt werden |

**Beispiel NVO (bereits gefixt):** Death Cross + Moat 2.0 → Score auf NEUTRAL gedeckelt.  
**Lücke:** Golden Cross + kein Moat + hohe Rivalität bleibt unterdämpft.

---

## 2. Lösung: Adaptive Dämpfung bei schwachem Moat + hoher Rivalität

### 2.1 Bedingungen (generisch)

| Signal | Quelle | Schwelle (adaptiv) |
|--------|--------|--------------------|
| Moat schwach | `scoreMoat` → None oder Narrow | Moat-Score ≤ 2.5 |
| Rivalität hoch | Porter-Force „Rivalität“ | Score ≥ 6 |
| Beide gleichzeitig | – | Dämpfung aktiv |

### 2.2 Dämpfungsformel

```typescript
const moatWeak = moatRating === "None" || moatRating === "Narrow";
const rivalryHigh = porterRivalryScore >= 6;

if (moatWeak && rivalryHigh) {
  const moatStrength = 1 - (moatScore / 10);           // 0–1, höher = schwächer
  const rivalryStrength = (porterRivalryScore - 5) / 5; // 0–1
  const damping = 1 - (moatStrength * rivalryStrength * 0.5); // max ~50 %

  overallScore *= damping;
}
```

- Wirkt bei **positivem und negativem** Technical.
- Bestehender Death-Cross-Override bleibt unverändert.
- Keine Ticker-Liste, keine festen Sektor-Schwellen.

### 2.3 Wirkung (Beispiele)

| Aktie | Situation | Wirkung |
|-------|-----------|---------|
| VW / BYD | Kein Moat, Rivalität hoch, Golden Cross | Score gedämpft → nicht ATTRAKTIV nur wegen Technical |
| NVO | Schwacher Moat + Death Cross | Override + zusätzliche Dämpfung |
| MSFT | Wide Moat, niedrige Rivalität | Keine Dämpfung |
| Fast Grower mit Moat | Moat Narrow/Wide | Keine oder nur leichte Dämpfung |

---

## 3. Consumer Brands – Heritage als Moat (Inversion)

### 3.1 Problem

Reine Massenmarkt-Titel (z. B. Sportbekleidung ohne Differenzierung) und Heritage-Marken (Polo Ralph Lauren, Uniqlo) dürfen nicht gleich behandelt werden.

| Typ | Beispiel | Moat-Charakter |
|-----|----------|----------------|
| Reiner Massenmarkt | Günstige Sportbekleidung ohne Brand | Kein / schwacher Moat, hohe Rivalität |
| Heritage / Brand | Polo Ralph Lauren, Uniqlo | Brand / Heritage = Moat (Pricing Power, Switching Costs) |

### 3.2 Adaptive Behandlung

In `scoreMoat` (analyze-route.ts) gibt es bereits Keywords:

- `brand`, `premium`, `luxury` → +1 Punkt
- `network effect`, `platform` → +2
- `switching cost`, `sticky` → +1

**Ergänzung (generisch):**

| Signal | Wirkung |
|--------|---------|
| Beschreibung enthält „heritage“, „brand heritage“, „premium brand“ | +1 Moat-Punkt (analog Brand) |
| Hohe Bruttomarge (>40 %) + Brand/Heritage | Verstärkt Moat-Score |
| Niedrige Bruttomarge + keine Brand-Keywords | Bleibt schwach |

**Regel:**  
Wenn Moat durch Brand/Heritage auf Narrow oder höher steigt, greift die Dämpfung aus Abschnitt 2 **nicht** (oder nur schwach).  
Wenn Moat None bleibt trotz Brand-Keywords → Dämpfung greift.

### 3.3 Beispiele

| Aktie | Moat-Score (geschätzt) | Rivalität | Dämpfung? |
|-------|--------------------------|-------------|-------------|
| Polo Ralph Lauren | Narrow (Brand + Heritage) | Mittel | Nein / schwach |
| Uniqlo | Narrow (Brand + Cost) | Mittel | Nein / schwach |
| Reine Sportbekleidung ohne Brand | None | Hoch | Ja |
| VW / BYD | None | Hoch | Ja |

---

## 4. Integration

| Stelle | Änderung |
|--------|----------|
| `shared/bias-fixes.ts` | Dämpfungsfaktor neben bestehendem Tech-Moat-Override |
| `server/analyze-route.ts` (`scoreMoat`) | Heritage-/Brand-Keywords verstärken Moat-Score |
| Summary / Fazit | Kurze Begründung: „Score gedämpft durch schwachen Moat + hohe Rivalität“ oder „Heritage-Moat erkannt“ |

---

## 5. Zahlen & Fakten

| Metrik | Wert |
|--------|------|
| Bestehender Override | Death Cross + RSL < 105 + Moat ≤ 2.5 → NEUTRAL-Band |
| Neue Dämpfung | max ~50 % bei Moat None + Rivalität 10 |
| Moat-Schwelle | Score ≤ 2.5 oder Rating None/Narrow |
| Rivalitäts-Schwelle | Porter-Score ≥ 6 |
| Heritage-Bonus | +1 Punkt bei Brand/Heritage-Keywords |

---

## 6. Aufwand

| Teil | Aufwand |
|------|---------|
| Dämpfungslogik in bias-fixes.ts | 2–3 h |
| Heritage-Keywords in scoreMoat | 1 h |
| Summary-Text | 1 h |
| Test (VW, BYD, Polo, MSFT, NVO) | 2 h |
| **Gesamt** | **~6–7 h** |

---

## 7. Akzeptanzkriterien

1. VW / BYD mit Golden Cross + kein Moat + hohe Rivalität → Score gedämpft, nicht ATTRAKTIV nur wegen Technical.
2. Polo Ralph Lauren / Uniqlo mit Brand/Heritage → Moat Narrow oder höher → keine starke Dämpfung.
3. NVO (Death Cross) bleibt auf NEUTRAL oder darunter.
4. MSFT (Wide Moat) bleibt unberührt.
5. Keine Ticker-spezifischen Hardcodings.
6. Begründung im Summary sichtbar.

**Quellen:** analyze-route.ts (`scoreMoat`), shared/bias-fixes.ts (Tech-Moat-Override), WORK_NVO_TECHNICAL_OVERRIDE.md, WORK_SECTION_WEIGHTING_ADAPTIVE.md.
