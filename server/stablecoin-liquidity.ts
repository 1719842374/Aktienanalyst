/**
 * Stablecoin-Liquidity-Kanal: Stablecoin-Market-Cap von DefiLlama.
 * Der T-Bill-Bedarf kommt nur aus belegten Reserveanteilen.
 *
 * Datenquelle: DefiLlama `/stablecoins` Endpoint (kein API-Key nötig).
 * https://stablecoins.llama.fi/stablecoins?includePrices=true
 *
 * WICHTIG (Zahlen-Prinzip, siehe stock-analyst-regression-guard):
 * - Stablecoin-Market-Cap-Zahlen (Total/USDT/USDC) sind ECHTE Live-Daten von
 *   DefiLlama — keine Schätzung.
 * - Der T-Bill-Holding-Anteil ist KEINE Live-Messung. Die Werte 75 und 55
 *   Prozent sind Schätzungen mit Datum und Quelle. Sie gehen nicht in den
 *   T-Bill-Bedarf, bis ein Bericht einen neuen Wert mit Beleg liefert.
 * - Ein Gesetzes-Score kommt nur aus einem belegten Instrument mit Status
 *   enacted oder implementing. Es gibt keinen stillen Score.
 * - Bei nicht erreichbarer DefiLlama-API: `null` + `available: false`-Flag,
 *   NIEMALS eine geschätzte/interpolierte Zahl zurückgeben.
 */

const DEFILLAMA_STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoins?includePrices=true";
const DEFILLAMA_TVL_URL = "https://api.llama.fi/v2/historicalChainTvl";
const FETCH_TIMEOUT_MS = 15000;

export interface StablecoinAggregate {
  symbol: string;
  name: string;
  circulatingUsd: number;
  circulatingPrevDayUsd: number | null;
  circulatingPrevWeekUsd: number | null;
  circulatingPrevMonthUsd: number | null;
}

export interface StablecoinMarketSnapshot {
  available: boolean;
  fetchedAt: string;
  totalMarketCapUsd: number | null;
  totalMarketCapPrevMonthUsd: number | null;
  usdt: StablecoinAggregate | null;
  usdc: StablecoinAggregate | null;
  /** Anzahl der peggedUSD-Stablecoins, die in die Summe eingegangen sind. */
  constituentCount: number | null;
  error?: string;
}

/**
 * Reserveanteile als Schätzung mit Datum und Quelle. usedInDemand bleibt
 * false, bis ein Scan beide Anteile mit Beleg liefert.
 */
export const RESERVE_SHARE_ESTIMATES = {
  asOfDate: "2026-08-24",
  source: "Tether Transparency und Circle Reserve Report, manuell gesichtet",
  kennzeichnung: "Schätzung mit Datum und Quelle. Geht nicht in den T-Bill-Bedarf, bis ein Bericht einen neuen Wert mit Beleg liefert.",
  tetherTBillShare: 0.75,
  usdcTBillShare: 0.55,
  usedInDemand: false,
} as const;

function toAggregate(entry: any): StablecoinAggregate | null {
  if (!entry) return null;
  const circulating = entry.circulating?.peggedUSD;
  if (typeof circulating !== "number" || !Number.isFinite(circulating)) return null;
  return {
    symbol: entry.symbol,
    name: entry.name,
    circulatingUsd: circulating,
    circulatingPrevDayUsd: typeof entry.circulatingPrevDay?.peggedUSD === "number" ? entry.circulatingPrevDay.peggedUSD : null,
    circulatingPrevWeekUsd: typeof entry.circulatingPrevWeek?.peggedUSD === "number" ? entry.circulatingPrevWeek.peggedUSD : null,
    circulatingPrevMonthUsd: typeof entry.circulatingPrevMonth?.peggedUSD === "number" ? entry.circulatingPrevMonth.peggedUSD : null,
  };
}

/**
 * Lädt das aktuelle Stablecoin-Universum von DefiLlama und aggregiert Total-
 * Market-Cap sowie USDT/USDC einzeln. Nutzt `fetch` (kein zusätzliches npm-
 * Package, analog zum bestehenden FRED-Fetch-Pattern in btc-macro.ts).
 *
 * Fallback-Prinzip: Bei jedem Fehler (Netzwerk, Timeout, unerwartetes Format)
 * wird `available: false` mit `null`-Feldern zurückgegeben — niemals eine
 * geschätzte oder zuletzt zwischengespeicherte Zahl als "aktuell" ausgegeben.
 */
export async function fetchStablecoinMarketSnapshot(): Promise<StablecoinMarketSnapshot> {
  const fetchedAt = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(DEFILLAMA_STABLECOINS_URL, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return {
        available: false,
        fetchedAt,
        totalMarketCapUsd: null,
        totalMarketCapPrevMonthUsd: null,
        usdt: null,
        usdc: null,
        constituentCount: null,
        error: `DefiLlama HTTP ${res.status}`,
      };
    }

    const json: any = await res.json();
    const assets: any[] = Array.isArray(json?.peggedAssets) ? json.peggedAssets : [];
    if (assets.length === 0) {
      return {
        available: false,
        fetchedAt,
        totalMarketCapUsd: null,
        totalMarketCapPrevMonthUsd: null,
        usdt: null,
        usdc: null,
        constituentCount: null,
        error: "DefiLlama-Antwort enthielt kein peggedAssets-Array",
      };
    }

    const usdAssets = assets.filter((a) => a?.pegType === "peggedUSD");

    // Summiert werden ausschliesslich Konstituenten, die fuer das jeweilige
    // Feld einen numerischen Wert melden. DefiLlama liefert fuer einzelne,
    // faktisch inaktive/delistete Micro-Coins ein leeres `circulatingPrevMonth:
    // {}`-Objekt (kein `peggedUSD`-Key) -- das darf die 30d-Gesamtsumme nicht
    // pauschal auf null setzen, da die grossen, marktrelevanten Stablecoins
    // (USDT/USDC etc.) den Wert regulaer liefern. Jede einzelne fehlende
    // Konstituente wird gezaehlt und transparent zurueckgegeben.
    let totalCurrent = 0;
    let currentKnownCount = 0;
    let totalPrevMonth = 0;
    let prevMonthKnownCount = 0;
    for (const a of usdAssets) {
      const cur = a?.circulating?.peggedUSD;
      if (typeof cur === "number" && Number.isFinite(cur)) {
        totalCurrent += cur;
        currentKnownCount++;
      }
      const prevMonth = a?.circulatingPrevMonth?.peggedUSD;
      if (typeof prevMonth === "number" && Number.isFinite(prevMonth)) {
        totalPrevMonth += prevMonth;
        prevMonthKnownCount++;
      }
    }

    const usdtEntry = usdAssets.find((a) => a?.symbol === "USDT");
    const usdcEntry = usdAssets.find((a) => a?.symbol === "USDC");

    return {
      available: true,
      fetchedAt,
      totalMarketCapUsd: currentKnownCount > 0 ? totalCurrent : null,
      totalMarketCapPrevMonthUsd: prevMonthKnownCount > 0 ? totalPrevMonth : null,
      usdt: toAggregate(usdtEntry),
      usdc: toAggregate(usdcEntry),
      constituentCount: usdAssets.length,
    };
  } catch (err: any) {
    return {
      available: false,
      fetchedAt,
      totalMarketCapUsd: null,
      totalMarketCapPrevMonthUsd: null,
      usdt: null,
      usdc: null,
      constituentCount: null,
      error: err?.message?.substring(0, 200) || "Unbekannter Fehler beim DefiLlama-Fetch",
    };
  }
}

export interface TBillDemandEstimate {
  available: boolean;
  kennzeichnung: string;
  mcapChange30dUsd: number | null;
  dynamicMultiplier: number | null;
  estimatedTBillDemandUsd: number | null;
  note: string;
}

/**
 * Die 30-Tage-Änderung der Marktkapitalisierung ist gemessen. Der Bedarf
 * bleibt leer, bis ein Scan beide Reserveanteile mit Beleg hat.
 */
export function estimateTBillDemand(snapshot: StablecoinMarketSnapshot): TBillDemandEstimate {
  const kennzeichnung = "T-Bill-Bedarf nur aus belegten Reserveanteilen. Die Schätzungen gehen nicht in die Formel.";
  const mcapChange30dUsd =
    snapshot.available && snapshot.totalMarketCapUsd != null && snapshot.totalMarketCapPrevMonthUsd != null
      ? snapshot.totalMarketCapUsd - snapshot.totalMarketCapPrevMonthUsd
      : null;
  return {
    available: false,
    kennzeichnung,
    mcapChange30dUsd,
    dynamicMultiplier: null,
    estimatedTBillDemandUsd: null,
    note: mcapChange30dUsd == null
      ? "DefiLlama lieferte keine vollständige 30-Tage-Änderung."
      : "Die 30-Tage-Änderung ist gemessen. Der Bedarf bleibt leer, bis beide Anteile mit Beleg vorliegen.",
  };
}

export interface DefiTvlSnapshot {
  available: boolean;
  fetchedAt: string;
  tvlUsd: number | null;
  change30dUsd: number | null;
  error?: string;
}

/** Letzter Punkt und der Stand 30 Tage davor. Reine Funktion, kein Netz. */
export function defiTvlFromSeries(rows: { date: number; tvl: number }[], now = new Date()): DefiTvlSnapshot {
  const fetchedAt = now.toISOString();
  const points = rows
    .filter(p => Number.isFinite(p.date) && Number.isFinite(p.tvl) && p.tvl > 0)
    .sort((a, b) => a.date - b.date);
  const last = points[points.length - 1];
  if (!last) {
    return { available: false, fetchedAt, tvlUsd: null, change30dUsd: null, error: "DefiLlama lieferte keine TVL-Punkte" };
  }
  const cutoff = last.date - 30 * 86400;
  const prior = [...points].reverse().find(p => p.date <= cutoff);
  return {
    available: true,
    fetchedAt,
    tvlUsd: last.tvl,
    change30dUsd: prior ? last.tvl - prior.tvl : null,
  };
}

export async function fetchDefiTvlSnapshot(): Promise<DefiTvlSnapshot> {
  const fetchedAt = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(DEFILLAMA_TVL_URL, { signal: controller.signal, headers: { Accept: "application/json" } });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      return { available: false, fetchedAt, tvlUsd: null, change30dUsd: null, error: `DefiLlama TVL HTTP ${res.status}` };
    }
    const json: unknown = await res.json();
    if (!Array.isArray(json)) {
      return { available: false, fetchedAt, tvlUsd: null, change30dUsd: null, error: "DefiLlama-TVL war kein Array" };
    }
    return defiTvlFromSeries(json as { date: number; tvl: number }[]);
  } catch (err: any) {
    return { available: false, fetchedAt, tvlUsd: null, change30dUsd: null, error: err?.message?.substring(0, 200) || "TVL-Abruf fehlgeschlagen" };
  }
}

export interface StablecoinLiquidityResponse {
  fetchedAt: string;
  stablecoins: StablecoinMarketSnapshot;
  tBillDemand: TBillDemandEstimate;
  statute: {
    score: number | null;
    scoreMax: number;
    status: string;
    kennzeichnung: string;
  };
  reserveEstimates: {
    tetherTBillShare: number;
    usdcTBillShare: number;
    asOfDate: string;
    source: string;
    kennzeichnung: string;
    usedInDemand: false;
  };
  defiTvl: DefiTvlSnapshot;
}

export async function buildStablecoinLiquidityResponse(): Promise<StablecoinLiquidityResponse> {
  const [stablecoins, defiTvl] = await Promise.all([
    fetchStablecoinMarketSnapshot(),
    fetchDefiTvlSnapshot(),
  ]);
  const tBillDemand = estimateTBillDemand(stablecoins);

  return {
    fetchedAt: stablecoins.fetchedAt,
    stablecoins,
    tBillDemand,
    statute: {
      score: null,
      scoreMax: 1.5,
      status: "Kein stiller Score. Ein Gesetz zählt nur bei Status enacted oder implementing und mit Beleg.",
      kennzeichnung: "Der Beitrag kommt aus dem Politik-Scan.",
    },
    reserveEstimates: {
      tetherTBillShare: RESERVE_SHARE_ESTIMATES.tetherTBillShare,
      usdcTBillShare: RESERVE_SHARE_ESTIMATES.usdcTBillShare,
      asOfDate: RESERVE_SHARE_ESTIMATES.asOfDate,
      source: RESERVE_SHARE_ESTIMATES.source,
      kennzeichnung: RESERVE_SHARE_ESTIMATES.kennzeichnung,
      usedInDemand: false,
    },
    defiTvl,
  };
}
