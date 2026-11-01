/**
 * Antwort von GET /api/gold/backtest-cross.
 * Dieselbe Form auf dem Server und in der Info-Karte. Nur Anzeige, kein Score.
 *
 * Fenster aus Future_10 Z.84–85. Die Horizonte sind Handelstage
 * (etwa ein Monat, ein Quartal, ein Jahr), keine Signifikanz-Schwellen.
 * percentScale ist die Einheit des Perzentils. cacheTtlMs ist die Haltedauer
 * einer vollständigen Antwort.
 */

export interface GoldCrossBacktestParams {
  symbol: string;
  fastWindow: number;
  slowWindow: number;
  horizons: Readonly<Record<string, number>>;
  historyFrom: string;
  cacheTtlMs: number;
  percentScale: number;
}

export const GOLD_CROSS_BACKTEST_PARAMS: GoldCrossBacktestParams = {
  symbol: "GC=F",
  fastWindow: 50,
  slowWindow: 200,
  horizons: {
    oneMonth: 21,
    oneQuarter: 63,
    oneYear: 252,
  },
  historyFrom: "1970-01-01",
  cacheTtlMs: 6 * 60 * 60 * 1000,
  percentScale: 100,
};

/** Wie viel vom Fehlertext die Karte höchstens zeigt. */
export const FAILURE_DETAIL_MAX_CHARS = 160;

export interface GoldCrossHorizonResult {
  name: string;
  sessions: number;
  observations: number;
  hitRate: number | null;
  meanForwardReturn: number | null;
  medianForwardReturn: number | null;
  unconditionalMean: number | null;
  unconditionalObservations: number;
  zScore: number | null;
  percentile: number | null;
}

export interface GoldCrossSideResult {
  events: number;
  lastDate: string | null;
  dates: string[];
  horizons: GoldCrossHorizonResult[];
}

export interface GoldCrossBacktest {
  available: boolean;
  symbol: string;
  source: string;
  from: string | null;
  to: string | null;
  bars: number;
  fastWindow: number;
  slowWindow: number;
  inScore: false;
  unavailableReason: string | null;
  golden: GoldCrossSideResult;
  death: GoldCrossSideResult;
}

const EMPTY_SIDE: GoldCrossSideResult = {
  events: 0,
  lastDate: null,
  dates: [],
  horizons: [],
};

function failureBody(reason: string): GoldCrossBacktest {
  return {
    available: false,
    symbol: GOLD_CROSS_BACKTEST_PARAMS.symbol,
    source: `Yahoo ${GOLD_CROSS_BACKTEST_PARAMS.symbol}`,
    from: null,
    to: null,
    bars: 0,
    fastWindow: GOLD_CROSS_BACKTEST_PARAMS.fastWindow,
    slowWindow: GOLD_CROSS_BACKTEST_PARAMS.slowWindow,
    inScore: false,
    unavailableReason: reason,
    golden: EMPTY_SIDE,
    death: EMPTY_SIDE,
  };
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, FAILURE_DETAIL_MAX_CHARS);
}

function detailFromBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed || trimmed.startsWith("<")) return "";
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const record = parsed as { error?: unknown; message?: unknown };
        if (typeof record.error === "string") return clip(record.error);
        if (typeof record.message === "string") return clip(record.message);
      }
    } catch {
      return "";
    }
    return "";
  }
  return clip(trimmed);
}

/** HTTP-Status ist kein Ladezustand. Die Karte zeigt n/a mit diesem Grund. */
export function goldCrossBacktestHttpFailure(status: number, bodyText: string): GoldCrossBacktest {
  const detail = detailFromBody(bodyText);
  return failureBody(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
}

/** Netz- oder Parse-Fehler, ebenfalls n/a statt „lädt …“. */
export function goldCrossBacktestTransportFailure(reason: string): GoldCrossBacktest {
  const text = clip(reason);
  return failureBody(text.length > 0 ? text : "Abruf fehlgeschlagen");
}
