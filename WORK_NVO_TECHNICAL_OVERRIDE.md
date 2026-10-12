# WORK – NVO Technical Override Fix

**Stand:** 12.10.2026  
**Ticker:** NVO (Novo Nordisk A/S)  
**Problem:** Trotz klarer technischer Negativsignale (Death Cross, RSL 87, kein Moat) bleibt die Ampel auf ATTRAKTIV / LEICHT ATTRAKTIV und der Score bei 49.5/100.

---

## 1. Ist-Zustand (aus Screenshots)

| Kennzahl | Wert | Signal |
|----------|------|--------|
| Kurs | $38.64 | – |
| Gehärteter Inverse-DCF | $60.67 | Positiv |
| g* (Reverse-DCF) | 4.3 % (WACC 6.7 %) | – |
| Moat | Narrow, Score 2.0 | Negativ |
| RSL (Levy) | 87.1 | Weak Momentum |
| Technical | Kurs < MA200, MA50 < MA200 (Death Cross), MACD < 0 | Kein Buy-Signal |
| Government Exposure | 35 % | Negativ |
| Expected Damage | 20.9 % | Negativ |
| Scoring-Pipeline | 49.5 / 100 (roh 49.5, kein Gate greift) | LEICHT ATTRAKTIV |
| Ampel (S17) | ATTRAKTIV | – |
| Fazit | LEICHT ATTRAKTIV | – |

**Negative Faktoren (6):**
- Kurs über Max-Entry bei CRV 3:1
- Expected Damage 20.9 %
- RSL 87 – schwaches Momentum
- Technisch: KEIN Buy-Signal (Death Cross, MACD < 0)
- Kein erkennbarer Moat
- Staatsabhängigkeit 35 %

**Aktive Gates (Warnung, kein harter Cap auf 49.5):**
- PRICING_POWER Cap 55 (Marge -2.9 pp)
- INVENTORY Cap 70 (Lager +21.5 % YoY)

**Qualität × Trend:** Quality 55 × Trend 0.9 = 49.5

---

## 2. Soll-Zustand

- Bei gleichzeitigem **Death Cross** + **Moat Score ≤ 2.5** + **RSL < 105** darf der Titel **nicht** ATTRAKTIV oder LEICHT ATTRAKTIV bleiben.
- Ampel und Fazit müssen auf **NEUTRAL** oder **VORSICHTIG** wechseln.
- Valuation (Inverse-DCF, g*, CRV) darf die technischen Negativsignale nicht einfach overrulen.
- Alle 20 Sektionen müssen in die Scoring-Logik einfließen, insbesondere Sektion 11 (RSL), 12 (Tech. Analyse) und 13 (Moat).

---

## 3. Betroffene Sektionen und Kommunikation

| Sektion | Inhalt | Aktueller Einfluss auf Score | Soll-Einfluss |
|---------|--------|------------------------------|---------------|
| 1 Executive Summary | Ampel, Fazit | Zeigt ATTRAKTIV | Muss Technical + Moat reflektieren |
| 5 Bewertung | Inverse-DCF, g* | Hoch | Gedämpft bei Technical-Negativ |
| 7 DCF-Modell | Wachstumsannahmen | RSL-Adjustment aktiv (-7.5 %) | Beibehalten |
| 8 CRV | Risk/Reward | Positiv | Gedämpft |
| 11 RSL-Momentum | RSL 87.1 Weak | Nur Growth-Adj. | Hartes negatives Signal |
| 12 Tech. Analyse | Death Cross, MACD < 0 | „Weicher Zusatz“ | Hartes Gate / Cap |
| 13 Moat / Porter | Score 2.0 Narrow | Schwach | Hartes negatives Signal |
| 19 Zusammenfassung | Signal-Score 9+/6-/1n | LEICHT ATTRAKTIV | Muss negativer werden |
| 20 Scoring-Pipeline | Gates & Anti-Bias | Kein Gate greift auf 49.5 | Neuer Cap durch Technical + Moat |

**Kommunikation:**  
Sektion 11, 12 und 13 müssen einen gemeinsamen **Technical-Moat-Block** bilden, der einen Cap oder eine Dämpfung auf den Valuation-getriebenen Score auslöst. Der Block darf nicht von Sektion 5/8 überschrieben werden.

---

## 4. Scoring-Logik – Fix

### 4.1 Neuer Gate / Cap

```typescript
// Pseudo-Logik
const technicalNegative = hasDeathCross && rsl < 105 && macd < 0;
const moatWeak = moatScore <= 2.5;

if (technicalNegative && moatWeak) {
  // Cap auf 55 oder niedriger – Valuation darf nicht darüber
  applyCap("TECH_MOAT_OVERRIDE", 55);
}
```

### 4.2 Adaptive Dämpfung (ohne festen Faktor)

- Stärke der technischen Negativsignale relativ zur eigenen Historie (z-Score oder Perzentil).
- Bei hoher Stärke (Death Cross + RSL < 100) wird das Valuation-Gewicht reduziert.
- Dämpfungsfaktor aus Daten, nicht hardcoded (z. B. 0.45).

### 4.3 Integration in bestehende Pipeline

Aktuell:
```
Quality 55 × Trend 0.9 = 49.5
min(rohScore, strengster aktiver Gate-Cap) = 49.5
```

Soll:
```
Quality 55 × Trend 0.9 = 49.5
+ TECH_MOAT_OVERRIDE Cap 55 (oder niedriger bei stärkerem Signal)
→ Finaler Score ≤ 55, Ampel NEUTRAL / VORSICHTIG
```

---

## 5. Konkrete Zahlen für NVO

| Metrik | Wert | Wirkung im Fix |
|--------|------|----------------|
| Death Cross | Aktiv (MA50 < MA200) | Trigger für Cap |
| RSL | 87.1 | < 105 → Weak |
| Moat Score | 2.0 | ≤ 2.5 → Weak |
| Inverse-DCF | 60.67 | Wird gedämpft |
| g* | 4.3 % | Bleibt sichtbar, treibt Score nicht mehr allein |
| Erwarteter neuer Score | ≤ 55 | Ampel NEUTRAL |

---

## 6. Akzeptanzkriterien

1. NVO mit aktuellem Death Cross + Moat 2.0 + RSL 87 zeigt **nicht** mehr ATTRAKTIV / LEICHT ATTRAKTIV.
2. Ampel und Fazit wechseln auf NEUTRAL oder VORSICHTIG.
3. Valuation-Upside bleibt sichtbar, treibt aber den Score nicht über den Technical-Moat-Cap.
4. Titel ohne Death Cross und mit Moat > 3 bleiben unberührt.
5. Logik ist generisch für alle Lynch-Klassen (kein Hardcoding pro Klasse).
6. Kurze Begründung im Summary: „Valuation gedämpft durch Death Cross + Moat 2.0“.

---

## 7. Betroffene Dateien (vermutet)

- `server/scoring-gates.ts`
- `server/scoring-integration.ts`
- `client/src/components/sections/SummarySection.tsx` (Ampel / Fazit)
- Sektion 11 / 12 / 13 Komponenten (Signale an Pipeline durchreichen)

---

## 8. Aufwand

~4–8 Stunden (Gate-Logik + Ampel-Anpassung + Test mit NVO und Gegenbeispiel).

**Priorität:** Hoch (falsch positive ATTRAKTIV-Einstufung bei klarem technischen Negativsignal).
