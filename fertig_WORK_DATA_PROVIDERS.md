# WORK_DATA_PROVIDERS.md — Kurs-Historie: FMP-Limits & Alternativen

> Stand: 28.07.2026 | Nur Dokumentation  
> Kontext: Technische Analyse — **10Y-Timeframe** liefert unter FMP Free/Starter keine volle Historie.

---

## 1. Problem

UI bietet `3M | 6M | 1Y | 2Y | 3Y | 5Y | 10Y`.  
Bei **10Y** (teilweise schon bei längeren Spannen) fehlen Kerzen oder die Achse zeigt nur ~1–5 Jahre.

Ursachen typischerweise:

1. **FMP-Plan-Limit** (Free/Starter = max. 5 Jahre Historie)  
2. **Request** zu kurz (`from`/`to`/`limit`)  
3. **Chart-Domain** clamped, obwohl mehr Daten da sind

---

## 2. FMP API — Historie-Limits nach Plan

Quelle: [FMP Pricing Plans](https://site.financialmodelingprep.com/pricing-plans) (Stand Doku 2026).

| Plan | Richtpreis | Historical Data Range | Calls (Orientierung) |
| --- | --- | --- | --- |
| Free | 0 | **5 years** | 250 / Tag |
| Starter | ~$19 / Mo | **5 years** | 300 / Min |
| Premium | ~$49 / Mo | **30+ years** | 750 / Min |
| Ultimate | ~$99 / Mo | **30+ years** | höher |

### Konsequenzen für Aktienanalyst

| Timeframe | Free / Starter | Premium+ |
| --- | --- | --- |
| bis 5Y | ok (wenn Request korrekt) | ok |
| **10Y** | **nicht voll unterstützt** | ok |
| Death-Cross / MA200 über lange Sicht | eingeschränkt | ok |

**Daily EOD** (nicht Intraday) ist für 5Y/10Y-TA der relevante Endpoint, z. B.:

```text
GET /api/v3/historical-price-full/{symbol}?from=YYYY-MM-DD&to=YYYY-MM-DD&apikey=...
```

Intraday-Historie ist ohnehin deutlich kürzer (oft Monate bis ~2 Jahre) — für 10Y irrelevant.

### Schnell-Diagnose

```bash
# Frühestes Datum in der Antwort prüfen
curl -s "https://financialmodelingprep.com/api/v3/historical-price-full/AAPL?from=2010-01-01&apikey=KEY" \
  | jq '[.historical[].date] | min'
```

| Ergebnis | Bedeutung |
| --- | --- |
| ca. heute − 5 Jahre | Plan-Limit Free/Starter |
| 10–30+ Jahre zurück | Plan ok → Bug in Client/Chart |
| nur wenige Monate | Request-Parameter / falscher Endpoint |

---

## 3. Alternative Datenanbieter (Daily OHLCV)

Ziel: **lange Daily-Historie** für 10Y-Charts und stabile MA200/Death-Cross-Logik, ohne FMP Premium erzwingen zu müssen.

| Anbieter | Historie (typisch) | Kosten-Skizze | API / Zugang | Hinweise |
| --- | --- | --- | --- | --- |
| **Yahoo Finance** | oft 10–20+ Jahre Daily | frei (inoffiziell) | `yfinance` / Chart API | robust für EOD; ToS/Rate-Limits beachten; kein „offizieller“ Prod-SLA |
| **Stooq** | sehr lange Daily | frei | CSV-Download / HTTP | gut für Backfills; weniger „Realtime“ |
| **Polygon.io** | je Plan, lange Aggregates | Free tier + Paid | REST | saubere API; US stark; Limits je Plan |
| **Tiingo** | lange Daily | günstige Paid-Pläne | REST | klar dokumentiert, gut für EOD |
| **EODHD** | 30+ Jahre viele Symbole | Paid | REST | stark bei internationaler Abdeckung |
| **Alpha Vantage** | lang, aber streng rate-limited | Free + Premium | REST | Free: sehr niedrige Calls/Min — ungeeignet als Primärquelle |
| **FMP Premium+** | 30+ Jahre | ~$49+ / Mo | REST (bereits integriert) | einfachster Fix, wenn Budget ok |

### Empfehlung Aktienanalyst

```
Primär:     FMP (Quotes, Fundamentals, Segmente, kurze–mittlere TA)
Fallback:   Yahoo oder Tiingo/Polygon nur für Daily OHLCV wenn timeframe > 5Y
            oder wenn FMP-Serie kürzer als requested from-date
```

Hybrid-Regel:

```
requestedYears = timeframeToYears(uiTimeframe)  // 10Y → 10
if (fmpEarliest > today - requestedYears) {
  series = mergeOrReplaceWithFallback(fmpSeries, altProviderSeries)
  flag dataSource = 'fmp+yahoo' | 'yahoo' | …
}
```

---

## 4. UI- / Client-Verhalten (sollte so spezifiziert werden)

| Timeframe | Verhalten bei 5Y-Plan |
| --- | --- |
| 3M–5Y | normal FMP |
| 10Y | (a) disable + Tooltip „Plan max. 5Y“ **oder** (b) Fallback-Provider laden |
| MA200 / Death-Cross | nur anzeigen wenn genug Kerzen (z. B. ≥ 200 trading days); sonst Badge „Historie zu kurz“ |

Chart-Domain immer an **tatsächlich geladene** Min/Max-Daten binden — nicht an den Button-Label „10Y“, wenn nur 2Y ankommen.

---

## 5. Implementierungs-Skizze Fallback

```ts
export type HistoryProvider = 'fmp' | 'yahoo' | 'tiingo' | 'polygon';

export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: HistoryProvider;
}

/** Wunsch-Spanne aus UI */
export function fromDateForTimeframe(tf: '3M'|'6M'|'1Y'|'2Y'|'3Y'|'5Y'|'10Y', now = new Date()): string {
  const days: Record<string, number> = {
    '3M': 95, '6M': 185, '1Y': 370, '2Y': 740, '3Y': 1100, '5Y': 1825, '10Y': 3650,
  };
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (days[tf] ?? 370));
  return d.toISOString().slice(0, 10);
}

/**
 * 1) FMP full historical from..to
 * 2) Wenn rawEarliest zu jung für tf → Alternative nachladen
 * 3) Merge nach date (Alternative füllt Lücken / verlängert links)
 */
export async function fetchDailyHistory(opts: {
  symbol: string;
  timeframe: '3M'|'6M'|'1Y'|'2Y'|'3Y'|'5Y'|'10Y';
  fmpFetch: (from: string, to: string) => Promise<DailyBar[]>;
  altFetch?: (from: string, to: string) => Promise<DailyBar[]>;
}): Promise<{ bars: DailyBar[]; source: string; truncated: boolean }> {
  const to = new Date().toISOString().slice(0, 10);
  const from = fromDateForTimeframe(opts.timeframe);
  let bars = await opts.fmpFetch(from, to);
  bars.sort((a, b) => a.date.localeCompare(b.date));

  const needFrom = from;
  const gotFrom = bars[0]?.date;
  let truncated = !gotFrom || gotFrom > needFrom;
  let source = 'fmp';

  if (truncated && opts.altFetch) {
    const alt = await opts.altFetch(needFrom, gotFrom ?? to);
    const byDate = new Map(bars.map(b => [b.date, b]));
    for (const a of alt) if (!byDate.has(a.date)) byDate.set(a.date, a);
    bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    source = 'fmp+alt';
    truncated = !bars[0] || bars[0].date > needFrom;
  }

  return { bars, source, truncated };
}
```

Yahoo-Fallback (Server-seitig, z. B. über bestehende Python/Node-Bridge) nur Daily Adj Close/OHLCV — keine Intraday-Pflicht.

---

## 6. Entscheidungsmatrix

| Situation | Maßnahme |
| --- | --- |
| Budget für FMP Premium ok | Premium → 30Y, ein Provider |
| Starter behalten, 10Y selten | UI 10Y disable oder klar „max 5Y“ |
| Starter + 10Y wichtig | Hybrid FMP + Yahoo/Tiingo/Polygon |
| Internationale Ticker schwach bei Yahoo | EODHD oder FMP Premium |
| Nur MA200 über 1Y-Chart | 5Y-Plan reicht oft |

---

## 7. Checkliste

```
[ ] FMP-Plan dokumentieren (ENV/README: free|starter|premium)
[ ] fromDateForTimeframe + truncated-Flag in TA-API
[ ] Chart-Domain = data min/max, nicht Button-Label
[ ] 10Y: disable ODER altFetch
[ ] MA200 / Death-Cross: mind. 200 Bars, sonst Warnung
[ ] dataSource in UI klein anzeigen (fmp | fmp+yahoo)
[ ] Keine Secrets im Client — Fallback nur server-side
```

---

**Bezug:** Technische-Analyse-Chart (MA50/MA200, Death Cross).  
**Regel:** Dokumentation. Implementierung lokal → PR → Review.
