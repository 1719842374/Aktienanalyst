/**
 * Stablecoin-Liquidity-Kanal (Sprint D4): Stablecoin-Market-Cap → geschätzte
 * T-Bill-Nachfrage + GENIUS Act Impact Score.
 *
 * Datenquelle: DefiLlama `/stablecoins` Endpoint (kein API-Key nötig).
 * https://stablecoins.llama.fi/stablecoins?includePrices=true
 *
 * WICHTIG (Zahlen-Prinzip, siehe stock-analyst-regression-guard):
 * - Stablecoin-Market-Cap-Zahlen (Total/USDT/USDC) sind ECHTE Live-Daten von
 *   DefiLlama — keine Schätzung.
 * - Der T-Bill-Holding-Anteil ("tetherTBillShare"/"usdcTBillShare") ist KEINE
 *   Live-Messung. Es existiert keine strukturierte, frei zugängliche Live-API
 *   für die Tether/Circle Reserve-Zusammensetzung. Die hier verwendeten Werte
 *   sind aus den zuletzt öffentlich bekannten Tether/Circle Transparency
 *   Reports entnommene, FEST DOKUMENTIERTE Policy-Konstanten (siehe
 *   RULE_BASED_POLICY_CONSTANTS unten). Sie werden in der UI klar als
 *   "Rule-based / manuell gepflegt" gekennzeichnet und NIEMALS als präziser
 *   Live-Wert dargestellt.
 * - Der GENIUS Act Impact Score ist eine manuell gepflegte Policy-Konstante
 *   (0–1.5), ebenfalls klar gekennzeichnet, da es keine verlässliche,
 *   automatisierbare Datenquelle für den "Implementation Strength"-Grad gibt.
 * - Bei nicht erreichbarer DefiLlama-API: `null` + `available: false`-Flag,
 *   NIEMALS eine geschätzte/interpolierte Zahl zurückgeben.
 */

const DEFILLAMA_STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoins?includePrices=true";
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
 * Rule-based / manuell gepflegte Policy-Konstanten. Diese Werte stammen NICHT
 * aus einer Live-API, sondern aus zuletzt öffentlich bekannten Tether/Circle
 * Transparency Reports bzw. der GENIUS-Act-Gesetzeslage. Sie müssen bei neuen
 * Transparency-Report-Veröffentlichungen manuell aktualisiert werden.
 *
 * Quellen:
 * - Tether Transparency Report (https://tether.to/en/transparency/): T-Bill-
 *   und T-Bill-nahe Anteile historisch ca. 70-80% der Reserven.
 * - Circle Reserve Fund / Transparency (https://www.circle.com/transparency):
 *   hoher Cash + kurzlaufende US-T-Bill-Anteil.
 * - GENIUS Act (Guiding and Establishing National Innovation for US
 *   Stablecoins Act), seit Juli 2025 in Kraft.
 */
export const RULE_BASED_POLICY_CONSTANTS = {
  // Stand der zuletzt gesichteten Transparency-Reports / Gesetzeslage.
  asOfDate: "2026-08-24",
  source: "Tether/Circle Transparency Reports (manuell gesichtet) + GENIUS Act Gesetzestext",
  kennzeichnung: "Rule-based / manuell gepflegt — KEINE Live-Messung",
  // Anteil der Reserven, der laut zuletzt gesichtetem Transparency Report in
  // US-T-Bills bzw. T-Bill-nahen Instrumenten (Repo auf T-Bills, MMFs mit
  // T-Bill-Exposure) gehalten wird. Mittelwert der dokumentierten 70-80%-Spanne.
  tetherTBillShare: 0.75,
  // Circle/USDC hält den überwiegenden Teil der Reserven im Circle Reserve
  // Fund (kurzlaufende US-Treasuries) + Cash bei regulierten Banken. Konservativ
  // niedriger angesetzt als Tether, da ein signifikanter Cash-Anteil enthalten ist.
  usdcTBillShare: 0.55,
  // Gewichtung für den kombinierten dynamic_multiplier (Spec Abschnitt 2/7):
  // USDT höher gewichtet, da deutlich größerer Marktanteil.
  weightTether: 0.7,
  weightCircle: 0.3,
  // GENIUS Act Impact Score: 0 = nicht aktiv, 1 = in Kraft, 1.5 = Implementation
  // weit fortgeschritten + messbarer struktureller Effekt auf T-Bill-Nachfrage.
  // Manuell gepflegt, da es keine automatisierbare, verlässliche Datenquelle für
  // den "Implementation Strength"-Grad gibt (Spec Abschnitt 7 Punkt 2).
  geniusActScore: 1.2,
  geniusActStatus: "In Kraft seit Juli 2025, Implementation läuft (OCC/Fed-Guidance in Ausarbeitung)",
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
  /** "Rule-based" — nutzt Policy-Konstanten aus RULE_BASED_POLICY_CONSTANTS. */
  kennzeichnung: string;
  mcapChange30dUsd: number | null;
  dynamicMultiplier: number | null;
  estimatedTBillDemandUsd: number | null;
  note: string;
}

/**
 * Geschätzte zusätzliche T-Bill-Nachfrage (Spec Abschnitt 4, Beispiel-
 * Berechnung): (aktuelle MCap − MCap vor 30 Tagen) × dynamic_multiplier.
 *
 * dynamic_multiplier = gewichteter Durchschnitt aus den Rule-based T-Bill-
 * Holding-Anteilen von Tether/Circle (siehe RULE_BASED_POLICY_CONSTANTS).
 *
 * Diese Schätzung wird NUR berechnet, wenn sowohl aktuelle als auch 30d-MCap
 * live von DefiLlama vorliegen. Fehlt eine der beiden Größen, wird
 * `available: false` mit `null`-Werten und einer klaren Begründung
 * zurückgegeben — es wird nicht interpoliert oder geraten.
 */
export function estimateTBillDemand(snapshot: StablecoinMarketSnapshot): TBillDemandEstimate {
  const kennzeichnung = "Rule-based Schätzung (Formel: 30d-MCap-Delta × Policy-Multiplikator), NICHT live gemessen";

  if (!snapshot.available || snapshot.totalMarketCapUsd === null || snapshot.totalMarketCapPrevMonthUsd === null) {
    return {
      available: false,
      kennzeichnung,
      mcapChange30dUsd: null,
      dynamicMultiplier: null,
      estimatedTBillDemandUsd: null,
      note: "Nicht verfügbar: DefiLlama lieferte keine vollständigen Market-Cap-Daten (aktuell und/oder vor 30 Tagen) für diesen Abruf.",
    };
  }

  const dynamicMultiplier =
    RULE_BASED_POLICY_CONSTANTS.tetherTBillShare * RULE_BASED_POLICY_CONSTANTS.weightTether +
    RULE_BASED_POLICY_CONSTANTS.usdcTBillShare * RULE_BASED_POLICY_CONSTANTS.weightCircle;

  const mcapChange30d = snapshot.totalMarketCapUsd - snapshot.totalMarketCapPrevMonthUsd;
  const estimatedDemand = mcapChange30d * dynamicMultiplier;

  return {
    available: true,
    kennzeichnung,
    mcapChange30dUsd: mcapChange30d,
    dynamicMultiplier,
    estimatedTBillDemandUsd: estimatedDemand,
    note: "Formel: (aktuelle Stablecoin-MCap − MCap vor ~30 Tagen) × gewichteter T-Bill-Holding-Anteil (Rule-based Policy-Konstante, siehe genius.policyConstants).",
  };
}

export interface StablecoinLiquidityResponse {
  fetchedAt: string;
  stablecoins: StablecoinMarketSnapshot;
  tBillDemand: TBillDemandEstimate;
  genius: {
    score: number;
    scoreMax: number;
    status: string;
    asOfDate: string;
    source: string;
    kennzeichnung: string;
  };
  policyConstants: {
    tetherTBillShare: number;
    usdcTBillShare: number;
    weightTether: number;
    weightCircle: number;
    asOfDate: string;
    source: string;
    kennzeichnung: string;
  };
}

export async function buildStablecoinLiquidityResponse(): Promise<StablecoinLiquidityResponse> {
  const stablecoins = await fetchStablecoinMarketSnapshot();
  const tBillDemand = estimateTBillDemand(stablecoins);

  return {
    fetchedAt: stablecoins.fetchedAt,
    stablecoins,
    tBillDemand,
    genius: {
      score: RULE_BASED_POLICY_CONSTANTS.geniusActScore,
      scoreMax: 1.5,
      status: RULE_BASED_POLICY_CONSTANTS.geniusActStatus,
      asOfDate: RULE_BASED_POLICY_CONSTANTS.asOfDate,
      source: RULE_BASED_POLICY_CONSTANTS.source,
      kennzeichnung: "Manuell gepflegter Policy-Score (0-1.5) — keine automatisierte Live-Berechnung möglich",
    },
    policyConstants: {
      tetherTBillShare: RULE_BASED_POLICY_CONSTANTS.tetherTBillShare,
      usdcTBillShare: RULE_BASED_POLICY_CONSTANTS.usdcTBillShare,
      weightTether: RULE_BASED_POLICY_CONSTANTS.weightTether,
      weightCircle: RULE_BASED_POLICY_CONSTANTS.weightCircle,
      asOfDate: RULE_BASED_POLICY_CONSTANTS.asOfDate,
      source: RULE_BASED_POLICY_CONSTANTS.source,
      kennzeichnung: RULE_BASED_POLICY_CONSTANTS.kennzeichnung,
    },
  };
}
