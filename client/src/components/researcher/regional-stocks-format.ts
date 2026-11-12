/**
 * Display for the regional stocks row.
 * Bond size stays in the source unit (Mrd. of home currency). At 1 000 Mrd.
 * the tile shows Bio. and keeps the currency suffix from that unit.
 */

export interface RegionalStocksDisplay {
  debtGdpPct: number | null;
  bondMarketBn: number | null;
  bondMarketGdpPct: number | null;
  bondMarketUnit?: string | null;
  bondMarketSource?: string | null;
  bondMarketAsOf?: string | null;
  realRatePct: number | null;
  tHalfYears: number | null;
  velocity: number | null;
  velocityLabel?: string | null;
  fiscalTrend: number | null;
  moneyTrend: number | null;
  pricedIn: number | null;
  velocityOverMedian: number | null;
  piNote?: string | null;
}

export type StockTileRow = "levels" | "trends" | "pi";

export interface StockTile {
  row: StockTileRow;
  label: string;
  value: string;
  hint: string;
  title: string;
  testId?: string;
}

const BIO_FROM_MRD = 1000;

function fmtDe(value: number, digits: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function fmtRaw(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(value);
}

function num(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function text(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function bondValue(bn: number, unit: string): string {
  if (Math.abs(bn) >= BIO_FROM_MRD && unit.startsWith("Mrd.")) {
    return `${fmtDe(bn / BIO_FROM_MRD, 1)} ${unit.replace("Mrd.", "Bio.")}`;
  }
  return `${fmtRaw(bn)} ${unit}`;
}

function velocityHint(label: string | null): string {
  if (label) return `${label}, dimensionslos`;
  return "dimensionslos, Verhältnis BIP / Geldmenge";
}

export function formatRegionalStockTiles(stocks: RegionalStocksDisplay): StockTile[] {
  const debt = num(stocks.debtGdpPct);
  const bn = num(stocks.bondMarketBn);
  const gdp = num(stocks.bondMarketGdpPct);
  const real = num(stocks.realRatePct);
  const velocity = num(stocks.velocity);
  const fiscal = num(stocks.fiscalTrend);
  const money = num(stocks.moneyTrend);
  const pricedIn = num(stocks.pricedIn);
  const ratio = num(stocks.velocityOverMedian);
  const tHalf = num(stocks.tHalfYears);
  const unit = text(stocks.bondMarketUnit);
  const label = text(stocks.velocityLabel);
  const gdpText = gdp == null ? "n/a" : `${fmtDe(gdp, 1)} % BIP`;
  const piNote = text(stocks.piNote);
  const piExplain = "Einpreisungsgrad 0–1. 1 = voll eingepreist.";
  let piValue = "n/a";
  if (pricedIn != null) piValue = fmtDe(pricedIn, 2);
  else if (stocks.piNote === "program start unknown") piValue = "start unknown";

  let bondValueText = "n/a";
  let bondTitle = "Bondmarkt ohne Wert";
  if (bn != null && unit) {
    bondValueText = `${bondValue(bn, unit)} · ${gdpText}`;
    const source = text(stocks.bondMarketSource) ?? "fehlt";
    const asOf = text(stocks.bondMarketAsOf) ?? "fehlt";
    bondTitle = `Rohwert ${fmtRaw(bn)} ${unit} · Quelle ${source} · Stand ${asOf}`;
  } else if (bn != null) {
    bondValueText = `${fmtRaw(bn)} · ${gdpText}`;
    bondTitle = "Einheit fehlt in der Quelle";
  }

  const scoreHint = "Score 0–100, 50 = neutral";
  const scoreTitle = "s(z) von 0 bis 100. 50 = neutral.";

  return [
    {
      row: "levels",
      label: "Debt/GDP",
      value: debt == null ? "n/a" : `${fmtDe(debt, 1)} %`,
      hint: "",
      title: "Schuldenquote in % des BIP.",
    },
    {
      row: "levels",
      label: "Bondmarkt",
      value: bondValueText,
      hint: "",
      title: bondTitle,
      testId: "text-bond-market",
    },
    {
      row: "levels",
      label: "Realzins r",
      value: real == null ? "n/a" : `${fmtDe(real, 2)} %`,
      hint: "",
      title: "Realzins in %.",
    },
    {
      row: "levels",
      label: "Velocity",
      value: velocity == null ? "n/a" : fmtDe(velocity, 3),
      hint: velocityHint(label),
      title: label
        ? `Velocity ${label}. Dimensionsloses Verhältnis nominales BIP / Geldmenge.`
        : "Dimensionsloses Verhältnis nominales BIP / Geldmenge.",
    },
    {
      row: "trends",
      label: "Fiscal trend",
      value: fiscal == null ? "n/a" : fmtDe(fiscal, 0),
      hint: scoreHint,
      title: `${scoreTitle} Veränderung der Schuldenquote.`,
    },
    {
      row: "trends",
      label: "Geldtrend",
      value: money == null ? "n/a" : fmtDe(money, 0),
      hint: scoreHint,
      title: `${scoreTitle} Zins und Policy-Portfolio.`,
    },
    {
      row: "pi",
      label: "π",
      value: piValue,
      hint: "Anteil 0–1, 1 = voll eingepreist",
      title: piNote ? `${piExplain} ${piNote}` : piExplain,
      testId: "text-priced-in",
    },
    {
      row: "pi",
      label: "V/V̄",
      value: ratio == null ? "n/a" : fmtDe(ratio, 2),
      hint: "1 = eigener Median",
      title: "Velocity geteilt durch den Median der eigenen Serie.",
      testId: "text-velocity-ratio",
    },
    {
      row: "pi",
      label: "T½",
      value: tHalf == null ? "n/a" : `${fmtDe(tHalf, 1)} Jahre`,
      hint: "Halbwertszeit des Realzinses",
      title: "T½ = ln(2)/ln(1+r) · clip(V̄/V, 0,5–2). Einheit: Jahre.",
      testId: "text-thalf",
    },
    {
      row: "pi",
      label: "V",
      value: velocity == null ? "n/a" : fmtDe(velocity, 3),
      hint: label ? `dieselbe Velocity (${label})` : "dieselbe Velocity",
      title: "Dieselbe Velocity wie oben, dimensionslos.",
      testId: "text-velocity",
    },
  ];
}
