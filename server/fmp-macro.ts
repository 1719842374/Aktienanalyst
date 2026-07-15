// === Macro Snapshot via FRED + FMP ===
// Direct API calls only — no Perplexity / external connector dependency.
//
// FRED is queried through the public fredgraph.csv endpoint (no API key
// required). Values that cannot be resolved are simply omitted — callers
// must treat a missing indicator as "no data" (null), never as a hardcoded
// default.

export interface MacroIndicator {
  country: string;
  category: string;
  latestValue: string;
  date: string;
  previousValue: string;
  unit: string;
  source: string;
}

export interface MacroSnapshot {
  indicators: MacroIndicator[];
  // Markdown table kept in the same 7-column shape the old finance tool
  // produced, so existing `.content` parsers keep working unchanged:
  // | country | category | latest_value | date | previous_value | unit | source |
  content: string;
}

interface FredObs {
  date: string;
  value: number;
}

// Map a free-text macro keyword to a FRED series. US-only: FRED does not
// expose the international series the old tool aggregated, so non-US countries
// yield no rows (callers fall back to their LLM synthesis for those regions).
interface SeriesSpec {
  series: string;
  category: string;
  unit: string;
  mode: "level" | "yoy";
}

function keywordToSpec(keywordRaw: string): SeriesSpec | null {
  const k = keywordRaw.toLowerCase();
  if (k.includes("core inflation")) return { series: "CPILFESL", category: "Core Inflation Rate", unit: "%", mode: "yoy" };
  if (k.includes("inflation") || k.includes("cpi")) return { series: "CPIAUCSL", category: "Inflation Rate", unit: "%", mode: "yoy" };
  if (k.includes("interest") || k.includes("rate")) return { series: "FEDFUNDS", category: "Interest Rate", unit: "%", mode: "level" };
  if (k.includes("m2") || k.includes("money supply")) return { series: "M2SL", category: "Money Supply M2", unit: "USD Billion", mode: "level" };
  if (k.includes("government spending")) return { series: "FYONGDA188S", category: "Government Spending to GDP", unit: "%", mode: "level" };
  if (k.includes("government debt") || k.includes("debt")) return { series: "GFDEGDQ188S", category: "Government Debt to GDP", unit: "%", mode: "level" };
  if (k.includes("gdp")) return { series: "A191RL1Q225SBEA", category: "GDP Annual Growth Rate", unit: "%", mode: "level" };
  if (k.includes("consumer confidence") || k.includes("sentiment") || k.includes("michigan")) return { series: "UMCSENT", category: "Consumer Sentiment (Michigan CSI)", unit: "Index", mode: "level" };
  if (k.includes("unemployment") || k.includes("jobless")) return { series: "UNRATE", category: "Unemployment Rate", unit: "%", mode: "level" };
  if (k.includes("retail sales") || k.includes("consumption")) return { series: "RSAFS", category: "Retail Sales", unit: "USD Million", mode: "yoy" };
  if (k.includes("industrial production")) return { series: "INDPRO", category: "Industrial Production", unit: "Index", mode: "yoy" };
  if (k.includes("housing starts") || k.includes("new home")) return { series: "HOUST", category: "Housing Starts", unit: "Thousands", mode: "level" };
  if (k.includes("core pce") || k.includes("pce deflator")) return { series: "PCEPILFE", category: "Core PCE Inflation", unit: "%", mode: "yoy" };
  if (k.includes("credit spread") || k.includes("baa")) return { series: "BAA10Y", category: "Credit Spread BAA-10Y", unit: "%", mode: "level" };
  if (k.includes("vix") || k.includes("volatility")) return { series: "VIXCLS", category: "VIX Volatility Index", unit: "Index", mode: "level" };
  if (k.includes("yield") || k.includes("10y") || k.includes("2y") || k.includes("curve")) return { series: "T10Y2Y", category: "Yield Curve 10Y-2Y", unit: "%", mode: "level" };
  if (k.includes("sahm")) return { series: "SAHMREALTIME", category: "Sahm Rule Indicator", unit: "pp", mode: "level" };
  if (k.includes("nonfarm") || k.includes("payroll")) return { series: "PAYEMS", category: "Nonfarm Payrolls", unit: "Thousands", mode: "level" };
  if (k.includes("trade balance") || k.includes("trade deficit")) return { series: "BOPGSTB", category: "Trade Balance", unit: "USD Million", mode: "level" };
  // ISM Manufacturing/Non-Manufacturing PMI has no FRED equivalent (proprietary index) and is not
  // available via this FMP plan's /stable/economic or /stable/economic-indicators (verified 2026-07-15:
  // both return empty/"Invalid name"). Explicitly return null so callers surface "N/A" instead of a fake value.
  if (k.includes("non manufacturing pmi") || k.includes("services pmi") || k.includes("ism services") || k.includes("chicago pmi") || k.includes("manufacturing pmi") || k.includes("ism")) return null;
  return null;
}

function monthsAgoISO(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

async function fetchFredSeries(series: string): Promise<FredObs[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${monthsAgoISO(30)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    const csv = await resp.text();
    if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
    const lines = csv.trim().split("\n").slice(1);
    const out: FredObs[] = [];
    for (const line of lines) {
      const [date, valStr] = line.split(",");
      const value = parseFloat(valStr?.trim());
      if (date && !isNaN(value)) out.push({ date: date.trim(), value });
    }
    return out;
  } catch {
    return [];
  }
}

function computeLevel(obs: FredObs[]): { latest: number; prev: number; date: string } | null {
  if (obs.length === 0) return null;
  const latest = obs[obs.length - 1];
  const prev = obs.length >= 2 ? obs[obs.length - 2].value : NaN;
  return { latest: latest.value, prev, date: latest.date };
}

function computeYoY(obs: FredObs[]): { latest: number; prev: number; date: string } | null {
  if (obs.length < 13) return null;
  const n = obs.length;
  const latestDate = obs[n - 1].date;
  const yoy = (a: number, b: number) => (b !== 0 ? ((a - b) / b) * 100 : NaN);
  const latest = yoy(obs[n - 1].value, obs[n - 13].value);
  const prev = n >= 14 ? yoy(obs[n - 2].value, obs[n - 14].value) : NaN;
  if (isNaN(latest)) return null;
  return { latest, prev, date: latestDate };
}

function fmt(v: number): string {
  if (isNaN(v)) return "N/A";
  return (Math.round(v * 100) / 100).toString();
}

/**
 * Fetch a macro snapshot for the given countries + keywords.
 * Returns structured indicators plus a markdown `content` table in the legacy
 * 7-column layout. Missing values are omitted (never faked).
 */
export async function fetchMacroSnapshot(opts: {
  countries: string[];
  keywords: string[];
}): Promise<MacroSnapshot> {
  const { countries, keywords } = opts;

  // Resolve requested keywords to unique FRED specs.
  const specs: SeriesSpec[] = [];
  const seenSeries = new Set<string>();
  for (const kw of keywords) {
    const spec = keywordToSpec(kw);
    if (spec && !seenSeries.has(spec.series)) {
      seenSeries.add(spec.series);
      specs.push(spec);
    }
  }

  const indicators: MacroIndicator[] = [];
  const usRequested = countries.some(c => /united states|usa|^us$/i.test(c.trim()));

  if (usRequested && specs.length > 0) {
    const results = await Promise.all(specs.map(s => fetchFredSeries(s.series)));
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const obs = results[i];
      const computed = spec.mode === "yoy" ? computeYoY(obs) : computeLevel(obs);
      if (!computed || isNaN(computed.latest)) continue;
      indicators.push({
        country: "United States",
        category: spec.category,
        latestValue: fmt(computed.latest),
        date: computed.date,
        previousValue: fmt(computed.prev),
        unit: spec.unit,
        source: `FRED ${spec.series}`,
      });
    }
  }

  // Non-US countries intentionally yield zero rows above: FRED has no international series here,
  // and FMP's /stable/economic-indicators `country` parameter is ignored on this plan (verified
  // 2026-07-15 — `country=DE` returned identical values to no country param, i.e. US data mislabeled
  // as German data). Rather than silently attribute US numbers to another country, we leave the
  // snapshot empty for non-US regions; callers (researcher.ts) already fall back to LLM synthesis.
  const header = "| country | category | latest_value | date | previous_value | unit | source |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- |";
  const rows = indicators.map(
    r => `| ${r.country} | ${r.category} | ${r.latestValue} | ${r.date} | ${r.previousValue} | ${r.unit} | ${r.source} |`,
  );
  const content = [header, sep, ...rows].join("\n");

  return { indicators, content };
}
