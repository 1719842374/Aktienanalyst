# WORK – Buffett-Indikator aus Aktien-Dashboard entfernen

**Stand:** 27.10.2026  
**Ziel:** Die Sektion „Makro-Kontext: Buffett-Indikator“ im Aktien-Analyse-Dashboard soll entfernt werden.

---

## Aktueller Stand

Die Sektion zeigt:
- Buffett-Indikator (US): 248 %
- Trend 134 %
- Abweichung +2,6 σ
- Label: stark überbewertet
- Hinweis: kein Score-Einfluss

---

## Warum entfernen

| Grund | Beschreibung |
|-------|--------------|
| Kein Score-Einfluss | Die Sektion hat keinen Einfluss auf die Ampel oder die Gates |
| Redundant | Der Buffett-Indikator ist im Rezessions-Dashboard vorhanden |
| Verwirrend | Zeigt Makro-Kontext bei einer Einzelaktien-Analyse |

---

## Umsetzung

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **1** | Sektion im Frontend ausblenden oder entfernen | 1–2 h |
| **2** | Backend-Call für Buffett im Aktien-Dashboard entfernen | 1 h |
| **3** | Prüfen, ob andere Sektionen betroffen sind | 1 h |
| **Gesamt** | | **~3–4 h** |

---

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `client/components/StockDashboard.tsx` | Sektion entfernen |
| `server/routes/stock.ts` | Buffett-Call entfernen (falls vorhanden) |

---

**Kurz:**  
Die Buffett-Sektion im Aktien-Dashboard wird entfernt. Sie hat keinen Score-Einfluss und ist im Rezessions-Dashboard vorhanden. Aufwand ~3–4 h.
