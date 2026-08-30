/**
 * history-fallback.ts
 *
 * Sprint B1 (SPRINT_B1_OHLCV_FALLBACK.md / WORK_DATA_PROVIDERS.md §5):
 * FMP Free/Starter liefert nur ~5 Jahre taegliche Kurshistorie. Bei UI-
 * Timeframes > 5Y (v.a. 10Y) fehlen dadurch Kerzen und die MA200/Death-Cross-
 * Logik hat nicht genug Bars. Dieses Modul implementiert die in
 * WORK_DATA_PROVIDERS.md Abschnitt 5 vorgeschlagene Fallback-Skizze 1:1:
 *
 *   1) fromDateForTimeframe(): Wunsch-Startdatum je UI-Timeframe.
 *   2) fetchDailyHistory(): FMP zuerst, dann bei Luecke einen Alt-Provider
 *      (Yahoo Finance Chart-API, mit Stooq als Reserve) nachladen und mergen.
 *      FMP-Daten haben IMMER Vorrang; der Alt-Provider fuellt nur Luecken
 *      bzw. verlaengert die Serie nach links (aeltere Daten).
 *
 * WICHTIG (Regel aus dem Ticket): Kein Secret verlaesst den Server. Diese
 * Datei laeuft ausschliesslich server-seitig (kein "use client", kein Export
 * Richtung client/). Yahoo/Stooq sind oeffentliche, unauthentifizierte Free-
 * Endpunkte -- es gibt hier keinen API-Key zu schuetzen, aber auch kein Grund,
 * das jemals aus dem Browser aufzurufen.
 *
 * Additiv: Diese Datei ist komplett neu und aendert keine bestehende Datei.
 * Der einzige Call-Site-Eingriff erfolgt minimal-invasiv in analyze-route.ts.
 */

export type HistoryProvider = "fmp" | "yahoo" | "stooq";

export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: HistoryProvider;
}

export type Timeframe = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y";

/** Wunsch-Spanne aus UI (1:1 aus WORK_DATA_PROVIDERS.md §5 uebernommen). */
export function fromDateForTimeframe(tf: Timeframe, now: Date = new Date()): string {
  const days: Record<Timeframe, number> = {
    "3M": 95, "6M": 185, "1Y": 370, "2Y": 740, "3Y": 1100, "5Y": 1825, "10Y": 3650,
  };
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (days[tf] ?? 370));
  return d.toISOString().slice(0, 10);
}

/**
 * Yahoo Finance Chart-API als Alt-Provider (server-seitig, kein API-Key
 * noetig). WORK_DATA_PROVIDERS.md §3 empfiehlt Yahoo als einfachste Option
 * fuer lange Daily-Historie. Ein plausibler User-Agent-Header ist noetig,
 * sonst antwortet der Endpoint mit 429 (in der Sandbox verifiziert).
 *
 * range=10y liefert die maximal sinnvolle Spanne fuer unseren Use-Case in
 * einem einzigen Request; wir schneiden serverseitig auf [from, to] zu.
 */
export async function yahooFetch(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json",
    },
  });
  if (!resp.ok) throw new Error(`Yahoo chart API HTTP ${resp.status}`);
  const json: any = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo chart API: leere Antwort");

  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens: (number | null)[] = quote.open ?? [];
  const highs: (number | null)[] = quote.high ?? [];
  const lows: (number | null)[] = quote.low ?? [];
  const closes: (number | null)[] = quote.close ?? [];
  const volumes: (number | null)[] = quote.volume ?? [];

  const bars: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date < from || date > to) continue;
    bars.push({
      date,
      open: opens[i] ?? close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      close,
      volume: volumes[i] ?? 0,
      source: "yahoo",
    });
  }
  return bars;
}

/**
 * Stooq CSV-Download als zweite Alt-Provider-Option (WORK_DATA_PROVIDERS.md
 * §3: "gut fuer Backfills"). US-Ticker brauchen das ".us"-Suffix. Wird nur
 * als Reserve genutzt, falls Yahoo aus der jeweiligen Umgebung nicht
 * zuverlaessig erreichbar ist (z.B. Rate-Limit/429 ohne Retry-Erfolg).
 */
export async function stooqFetch(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  const stooqSymbol = symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!resp.ok) throw new Error(`Stooq HTTP ${resp.status}`);
  const csv = await resp.text();
  if (!csv || /<html/i.test(csv)) throw new Error("Stooq: keine CSV-Antwort (evtl. Bot-Schutz)");

  const lines = csv.trim().split("\n");
  const bars: DailyBar[] = [];
  // Erwartetes Header-Format: Date,Open,High,Low,Close,Volume
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 6) continue;
    const [date, open, high, low, close, volume] = cols;
    if (!date || date < from || date > to) continue;
    const closeNum = Number(close);
    if (!isFinite(closeNum) || closeNum <= 0) continue;
    bars.push({
      date,
      open: Number(open) || closeNum,
      high: Number(high) || closeNum,
      low: Number(low) || closeNum,
      close: closeNum,
      volume: Number(volume) || 0,
      source: "stooq",
    });
  }
  return bars;
}

/**
 * 1) FMP full historical from..to
 * 2) Wenn rawEarliest zu jung fuer tf -> Alternative nachladen
 * 3) Merge nach date (Alternative fuellt Luecken / verlaengert links)
 *
 * 1:1 Signatur-Vorlage aus WORK_DATA_PROVIDERS.md §5, minimal erweitert um
 * ein ehrliches `truncated`-Flag falls auch der Fallback nicht ausreicht
 * (Ticket-Regel "Zahlen-Prinzip": nicht kuenstlich verlaengern/interpolieren).
 */
export async function fetchDailyHistory(opts: {
  symbol: string;
  timeframe: Timeframe;
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
  let source = "fmp";

  if (truncated && opts.altFetch) {
    try {
      const alt = await opts.altFetch(needFrom, gotFrom ?? to);
      if (alt.length > 0) {
        const byDate = new Map(bars.map((b) => [b.date, b]));
        for (const a of alt) if (!byDate.has(a.date)) byDate.set(a.date, a);
        bars = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        source = "fmp+alt";
      }
    } catch (err) {
      // Alt-Provider fehlgeschlagen (z.B. Rate-Limit) -> ehrlich truncated
      // lassen statt stillschweigend nur FMP-Daten zu zeigen als waeren sie
      // vollstaendig. Kein Interpolieren, kein Fake-Fuellen (Ticket-Regel).
      console.warn(`[HISTORY-FALLBACK] altFetch fehlgeschlagen fuer ${opts.symbol}: ${(err as Error)?.message ?? err}`);
    }
    truncated = !bars[0] || bars[0].date > needFrom;
  }

  return { bars, source, truncated };
}

/**
 * Praktischer Wrapper fuer die konkrete Provider-Kombination im Projekt:
 * Yahoo primaer als Alt-Provider, Stooq als Reserve falls Yahoo wirft.
 * Wird von analyze-route.ts genutzt, um nicht die Provider-Auswahl-Logik
 * an der Call-Site duplizieren zu muessen.
 */
export async function altFetchYahooThenStooq(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  try {
    const bars = await yahooFetch(symbol, from, to);
    if (bars.length > 0) return bars;
  } catch (err) {
    console.warn(`[HISTORY-FALLBACK] Yahoo fehlgeschlagen fuer ${symbol}: ${(err as Error)?.message ?? err}`);
  }
  try {
    return await stooqFetch(symbol, from, to);
  } catch (err) {
    console.warn(`[HISTORY-FALLBACK] Stooq fehlgeschlagen fuer ${symbol}: ${(err as Error)?.message ?? err}`);
    return [];
  }
}
