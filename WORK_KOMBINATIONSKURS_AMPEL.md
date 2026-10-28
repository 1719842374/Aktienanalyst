# WORK_KOMBINATIONSKURS_AMPEL.md

**Stand:** 2026-10-28  
**Status:** Offen / Implementierungsvorschlag  
**Sektion:** Technische Analyse (Sektion 12)  
**Ziel:** Ampel-Logik als farbige Overlay-Linie **direkt auf dem Kurs** (grün / gelb / rot Segmente).

---

## 1. Gewünschte Visualisierung (aus Bild 2)

Die Ampel soll **nicht** als separate Linie oder Punkte neben dem Kurs liegen, sondern **als farbige Segmente auf der Kurslinie selbst**:

- Rote Abschnitte = schwaches / teures Signal
- Gelbe Abschnitte = gemischt
- Grüne Abschnitte = starkes Kaufsignal

Zusätzlich ein Badge oben rechts: **„Ampel: Starkes Kaufsignal“** (grün).

Das ist die bevorzugte Darstellung.

---

## 2. Ampel-Logik (unverändert)

```typescript
function getAmpelStatus(data: {
  dcfUpside: number;
  rsl: number;
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

---

## 3. Technische Umsetzung des Overlays

### Frontend (Chart-Library, z. B. Lightweight Charts / Recharts)

1. Kursdaten holen.
2. Pro Datenpunkt den Ampel-Status berechnen.
3. Die Kurslinie in Segmente aufteilen, sobald sich die Farbe ändert.
4. Jedes Segment als eigene Linie mit der entsprechenden Farbe zeichnen (rot / gelb / grün).
5. Die Segmente nahtlos aneinanderreihen, sodass es wie eine durchgehende, farbwechselnde Kurslinie aussieht.

### Toggle

- Ein-/Ausschalten wie MA200 / RSI.
- Badge „Ampel: Starkes Kaufsignal“ nur anzeigen, wenn aktueller Status grün ist.

---

## 4. Aufwand (angepasst)

| Schritt | Aufwand |
|---------|---------|
| Ampel-Logik + Backend-Daten | 4–5 h |
| Segmentierte Overlay-Linie im Chart | 6–8 h |
| Badge + Tooltip | 2 h |
| **Gesamt** | **~12–15 h** |

---

## 5. Akzeptanzkriterien

1. Die Kurslinie wechselt Farbe (rot → gelb → grün) genau dort, wo sich der Ampel-Status ändert.
2. Overlay ist ein-/ausschaltbar.
3. Badge oben rechts zeigt den aktuellen Status.
4. Tooltip beim Hover: „Grün: DCF +17 %, RSL 102, Golden Cross“.
5. Keine neue Datenquelle – nur bestehende Signale aus Sektion 6/11/12/16.

---

**Quellen:** Screenshots (Bild 2 = gewünschtes Overlay auf dem Kurs), bestehende Golden-Cross- und Ampel-Logik.
