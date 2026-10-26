# WORK – Earnings Yield & ROIC Plot: Implementierung, Peer-Logik & Stand

**Stand:** 26.10.2026  
**Ziel:** Detaillierte Dokumentation der Implementierung, Peer-Ticker-Logik und aktueller Stand.

---

## 1. Wie erstelle ich die Implementierung

### Backend

| Endpoint | Funktion |
|----------|----------|
| `GET /api/chart/earnings-yield/:symbol` | Liefert Zeitreihe EBIT/EV |
| `GET /api/chart/roic/:symbol` | Liefert ROIC der letzten 5 Jahre |
| `GET /api/chart/peer/:symbol` | Liefert Kurs oder ROIC für Peer-Ticker |

**Datenquellen:**
- Earnings Yield: FMP `/stable/income-statement` + `/stable/enterprise-values`
- ROIC: FMP `/stable/key-metrics` oder berechnet aus NOPAT / Invested Capital
- Peer-Kurs: Yahoo oder FMP Historical Prices

### Frontend
- Bestehenden Chart in Sektion 12 erweitern.
- Neue Toggles: Earnings Yield, ROIC 5Y, Peer hinzufügen.
- Dual-Axis: Kurs links, Yield/ROIC rechts.

**Aufwand:** ~17–24 h.

---

## 2. Peer-Ticker-Logik

**Wie Peers gefunden werden:**
- Analog zu Sektion 9 (Rel. Bewertung).
- User tippt Ticker ein oder wählt aus Vorschlägen.
- Vorschläge basieren auf gleicher Industrie (FMP `/stable/stock-peers` oder Industry-Klassifikation).

**Was geplottet wird:**
- Peer-Kurs als gestrichelte Linie auf linker Achse.
- Peer-ROIC als gestrichelte Linie auf rechter Achse.
- User kann pro Peer wählen: Kurs oder ROIC.

**Beispiel:**
- MSFT Kurs (links, durchgezogen)
- ORCL ROIC (rechts, gestrichelt)
- SAP Kurs (links, gestrichelt)

---

## 3. Aktueller Stand

| Feature | Status |
|---------|--------|
| Earnings Yield Plot | Nicht vorhanden |
| ROIC 5Y Plot | Nicht vorhanden |
| Peer-Ticker im Chart | Nicht vorhanden |
| Dual-Axis in Sektion 12 | Nicht vorhanden |
| Peer-Suche in Sektion 9 | Vorhanden |

**Nächster Schritt:**  
Backend-Endpoints für Earnings Yield und ROIC bauen, dann Frontend-Toggles ergänzen.

---

## Code-Skizze (Backend)

```typescript
// server/routes/chart.ts
app.get("/api/chart/earnings-yield/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const income = await fmp(`/stable/income-statement?symbol=${symbol}&limit=5`);
  const ev = await fmp(`/stable/enterprise-values?symbol=${symbol}&limit=5`);
  const series = income.map((row, i) => ({
    date: row.date,
    earningsYield: (row.ebit / ev[i].enterpriseValue) * 100,
  }));
  res.json(series);
});

app.get("/api/chart/roic/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const metrics = await fmp(`/stable/key-metrics?symbol=${symbol}&limit=5`);
  const series = metrics.map(row => ({
    date: row.date,
    roic: row.roic * 100,
  }));
  res.json(series);
});
```

---

**Kurz:**  
Endpoints für Earnings Yield und ROIC, Peer-Logik analog Sektion 9, Dual-Axis im bestehenden Chart. Aktuell nichts davon implementiert.
