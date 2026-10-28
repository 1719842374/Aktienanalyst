# WORK_KOMBINATIONSKURS_AMPEL.md

**Stand:** 2026-10-28  
**Status:** Offen / Implementierungsvorschlag  
**Sektion:** Technische Analyse (Sektion 12)  
**Ziel:** Eine Kurslinie mit Ampel-Logik (grün / gelb / rot), die zeigt, ob die Aktie gerade fundamental (DCF), vom Momentum (RSL) oder technisch unterbewertet / attraktiv ist.

---

## 1. Idee

Statt nur den reinen Kurs zu zeigen, eine **Kombinations-Ampel** als Overlay oder eigene Linie:

| Farbe | Bedeutung | Beispiel-Logik |
|-------|-----------|----------------|
| **Grün** | Fundamental + Momentum + Technik passen zusammen | DCF-Upside > 15 % **und** RSL > 100 **und** Golden Cross aktiv |
| **Gelb** | Gemischtes Signal | DCF positiv, aber RSL < 95 oder Death Cross |
| **Rot** | Fundamental teuer oder Momentum schwach | DCF-Upside < 0 % **oder** RSL < 90 **oder** Kurs < MA200 |

Die Ampel wird als farbige Linie oder farbige Punkte auf dem bestehenden Kurs-Chart gelegt.

---

## 2. Datenquellen (bereits im Dashboard vorhanden)

| Signal | Quelle im Projekt | Sektion |
|--------|-------------------|---------|
| DCF-Upside / g* | Gehärteter Inverse-DCF | 6 / 16 |
| RSL-Momentum | RSL-Score | 11 |
| Golden / Death Cross | MA50 vs MA200 | 12 |
| Kurs vs MA200 | Technische Analyse | 12 |
| MACD | Technische Analyse | 12 |
| Moat / Quality | Moat-Score | 13 |

---

## 3. Ampel-Logik (Vorschlag)

```typescript
function getAmpelStatus(data: {
  dcfUpside: number;      // z. B. +17.5 %
  rsl: number;            // z. B. 87
  goldenCross: boolean;
  deathCross: boolean;
  priceAboveMA200: boolean;
  macdPositive: boolean;
}): "green" | "yellow" | "red" {

  const fundamentalOk = data.dcfUpside > 10;
  const momentumOk   = data.rsl > 95;
  const technicalOk  = data.goldenCross || (data.priceAboveMA200 && data.macdPositive);

  if (fundamentalOk && momentumOk && technicalOk) return "green";
  if (fundamentalOk && (momentumOk || technicalOk)) return "yellow";
  return "red";
}
```

### Schwellen (adaptiv anpassbar)

| Signal | Grün | Gelb | Rot |
|--------|------|------|-----|
| DCF-Upside | > 15 % | 0–15 % | < 0 % |
| RSL | > 100 | 90–100 | < 90 |
| Technik | Golden Cross + Kurs > MA200 | Kurs > MA200 | Death Cross oder Kurs < MA200 |

---

## 4. Visualisierung

### Option A: Farbige Punkte auf dem Kurs
- Jeder Handelstag bekommt einen Punkt in Grün / Gelb / Rot.
- Der Punkt liegt auf dem Kurs oder leicht darüber.

### Option B: Ampel-Linie als Overlay
- Eine zweite Linie (gestrichelt), deren Farbe sich ändert.
- Dual-Axis nicht nötig, da nur Farbe relevant ist.

### Option C: Ampel-Badge im Chart-Header
- Aktueller Status als großes Badge (z. B. „Grün – Fundamental + Momentum passen“).
- Historischer Verlauf als farbige Balken unter dem Chart.

---

## 5. Implementierungsschritte

| Schritt | Aufwand | Beschreibung |
|---------|---------|--------------|
| Backend-Endpoint | 3–4 h | Liefert pro Tag den Ampel-Status (aus bestehenden Daten) |
| Ampel-Logik | 2–3 h | Kombination aus DCF, RSL, MA, MACD |
| Frontend-Overlay | 4–6 h | Farbige Punkte oder Linie im bestehenden Chart |
| Tooltip | 1–2 h | „Grün: DCF +17 %, RSL 102, Golden Cross“ |
| **Gesamt** | **~10–15 h** | – |

---

## 6. Beispiel (aus Screenshot)

| Datum | Kurs | Ampel | Begründung |
|-------|------|-------|--------------|
| 30. Juli 2026 | $451 | Gelb | Golden Cross aktiv, aber RSL noch nicht stark |
| 31. Aug. 2026 | – | Grün | Golden Cross + 59 Tage aktiv |

---

## 7. Akzeptanzkriterien

1. Ampel-Status wird für den aktuellen Tag und historisch berechnet.
2. Overlay ist ein-/ausschaltbar (Toggle wie MA200 / RSI).
3. Tooltip erklärt, welche Signale gerade grün / gelb / rot sind.
4. Logik nutzt nur bereits vorhandene Daten (kein neuer API-Call).
5. Bei fehlenden Daten (z. B. kein DCF) fällt die Ampel auf „Gelb“ oder „n.v.“ zurück.

---

**Quellen:** Screenshot Technische Analyse (Golden Cross), bestehende Sektionen 6/11/12/16, DCF- und RSL-Logik im Dashboard.
