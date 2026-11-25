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

---

## Soll-Ist 2026-11-02 — Peer-Dividende und Tooltip des Haupttitels

Dieselbe Tabelle wie in `WORK_EARNINGS_YIELD_ROIC_PLOT.md`. Die Skizze oben ist der Plan vom 26.10. Die laufende Peer-Route ist `GET /api/chart/peer-price/:symbol?from&to`, nicht `GET /api/chart/peer/:symbol`.

| | Ist vorher | Soll | Stand |
| --- | --- | --- | --- |
| Kette Haupttitel | UI-Tooltip las `_ey` / `_roic`. Die Queries `useEarningsYield` / `useRoicSeries` liefen nur bei Chip an. Bei Peer an und Chip aus war die Note null → `n/a — kein Wert`. Der Peer nutzte `useRoicSeries(peerQuery, peerOn)` und kam an. | UI → Hook → `GET /api/chart/earnings-yield/:symbol` und `GET /api/chart/roic/:symbol` → `loadEarningsYield` / `loadRoicSeries` → Join auf die Kurstage | `fundActive = showEy \|\| showRoic \|\| peerOn`. Tooltip liest `earningsYieldKnown` / `roicKnown`. Ohne FMP-Key beginnt das Yahoo-Jahres-EPS von MSFT am 30.06.2023 (9.68). Am 04.05.2023 bleibt der konkrete Warmup-Grund. |
| Peer-Dividende | nur die eigene Linie über `useDividendHistory(data.ticker, showDividend)` → `GET /api/dividends/:ticker` | zweite Linie, Formel `Dividende TTM / Kurs`, Quelle FMP zuerst, Yahoo als Fallback. Das gilt auch für `.DE`, wie die Dividendenroute auf main. | `useDividendHistory(peerQuery, showDividend && peerOn)` plus `usePeerPriceBars`, `peerDividendYieldOnDates`. Kein Yahoo-zuerst. |
| .DE EY/ROIC | Yahoo zuerst, FMP ergänzt | unverändert, nur Earnings Yield und ROIC | deutsche Ticker bleiben in `loadGermanEarningsYield` / `loadGermanRoic`. Die Peer-Dividende nutzt diese Reihenfolge nicht. |
| Pins / Score / tsc | VOW3 4.735718, SAP 5.174758, MSFT 4.058138, buildBias 5.6381, tsc 101 | unverändert | keine Score-Datei, kein `analyze-route.ts`, kein `researcher.ts`, kein `shared/schema.ts` |
