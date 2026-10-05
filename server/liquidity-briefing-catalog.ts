/**
 * Realzins, Bücher, Spillover und EM-Kasten für den Liquiditäts-Briefing.
 * Spec: Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md §2–§6.
 * Snapshot-Prints werden nicht als Laufzeitkonstanten zurückgegeben.
 * π wird hier gerechnet und nicht in einen Liquiditätsindex addiert.
 */
import type {
  LiquidityBriefing,
  LiquidityBriefingChannel,
  LiquidityBriefingRate,
} from "@shared/schema";
import { jpnAssetsToTn } from "./liquidity-index-math";
import { QRA_SNAPSHOT, qraSnapshotStale } from "./qra-snapshot";
import {
  EM_INDEX_WEIGHT_CAP,
  LIVE_FRED_SERIES,
  PHI,
  type AppMonth,
  type DatedValue,
  type PeppMonth,
  BIS_CN_CBPOL_URL,
  BIS_IN_CBPOL_URL,
  OECD_IN_2Y_URL,
  WORLD_BANK_CN_M2_URL,
  briefingPricedIn,
  carryBp,
  cnNominalFisher,
  deltaOverDays,
  deltaSeries,
  exPostRealPercent,
  fisherCarrySeries,
  halfLifeYears,
  japanCpiYoy,
  lastInMonth,
  latestOnOrBefore,
  monthStockDiff,
  officialOrRatioVelocity,
  parseBisCbpol,
  parseEcbCsv,
  parseFredCsv,
  parseMofJgb10,
  parseMspdBillStockBn,
  parseOecdMeiJson,
  parseWorldBankLevels,
  percentToDecimal,
  preferNominal,
  qtNetBn,
  qtNetSeries,
  roundTo,
  somaNotesBn,
  spilloverEvent,
  usEmgFromSeries,
  worldBankYoy,
  yoyOnIndex,
  zOfLatest,
  type UsVelocitySource,
} from "./liquidity-briefing-math";

export const MOF_JGB_URL = "https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv";
export const MSPD_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/mspd/mspd_table_1" +
  "?filter=security_class_desc:eq:Bills,security_type_desc:eq:Marketable" +
  "&sort=-record_date&page[size]=40&fields=record_date,total_mil_amt";

const CATALOG_FRED = LIVE_FRED_SERIES.filter(id => id !== "JPNNGDP");

export interface CatalogTexts {
  fred: Record<string, string>;
  mof: string;
  mspd: string;
  wfs: string;
  worldBank?: string;
  bisCn?: string;
  bisIn?: string;
  oecdIn2y?: string;
}

export interface CatalogContext {
  usVelocity: number | null;
  usVelocityMedian: number | null;
  jpVelocity: number | null;
  jpVelocityMedian: number | null;
  ezVelocity: number | null;
  ezVelocityMedian: number | null;
  jpMoneyBn: number | null;
  fRestBn: number | null;
  deltaMBn: number | null;
  programAgeYears?: number | null;
  app: AppMonth[];
  pepp: PeppMonth[];
  nowIso: string;
}

export type BriefingCatalog = Pick<
  LiquidityBriefing,
  "rates" | "halfLife" | "pricedIn" | "spillover" | "em" | "books" | "qra" | "nakajima"
> & {
  usFill: {
    velocity: number | null;
    emg: number | null;
    velocityMedian10y: number | null;
    source: UsVelocitySource;
  };
};

function yearsAgo(now: Date, years: number): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function catalogSourceUrls(now = new Date()): { id: string; url: string }[] {
  const start = yearsAgo(now, 6);
  const startPeriod = start.slice(0, 7);
  const fred = CATALOG_FRED.map(id => ({
    id,
    url: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`,
  }));
  return [
    ...fred,
    { id: "MOF_JGB", url: MOF_JGB_URL },
    { id: "MSPD", url: MSPD_URL },
    {
      id: "ECB_WFS",
      url: `https://data-api.ecb.europa.eu/service/data/ILM/W.U2.C.L050100.U2.EUR?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    { id: "WB_CN_M2", url: WORLD_BANK_CN_M2_URL },
    { id: "BIS_CN_CBPOL", url: BIS_CN_CBPOL_URL },
    { id: "BIS_IN_CBPOL", url: BIS_IN_CBPOL_URL },
    { id: "OECD_IN_2Y", url: OECD_IN_2Y_URL },
  ];
}

function rateOf(points: DatedValue[] | undefined, source: string, digits = 3): LiquidityBriefingRate {
  const sorted = [...(points ?? [])].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  return {
    value: last ? roundTo(last.value, digits) : null,
    asOf: last?.period ?? null,
    source,
  };
}

function channel(
  id: LiquidityBriefingChannel["id"],
  points: DatedValue[],
  unit: string,
  latestOverride?: number | null,
): LiquidityBriefingChannel {
  const z = zOfLatest(points);
  const last = points.length ? points[points.length - 1] : null;
  const latest = latestOverride !== undefined ? latestOverride : (last ? roundTo(last.value, 3) : null);
  return {
    id,
    latest,
    unit,
    z: z ? roundTo(z.z, 2) : null,
    event: spilloverEvent(z?.z ?? null),
  };
}

function millionsToBn(points: DatedValue[]): DatedValue[] {
  return points.map(p => ({ period: p.period, value: p.value / 1000 }));
}

export function assembleCatalog(texts: CatalogTexts, ctx: CatalogContext): BriefingCatalog {
  const fred: Record<string, DatedValue[]> = {};
  for (const id of CATALOG_FRED) {
    fred[id] = parseFredCsv(texts.fred[id] || "").sort((a, b) => a.period.localeCompare(b.period));
  }
  const mof = parseMofJgb10(texts.mof || "");
  const mspd = parseMspdBillStockBn(texts.mspd || "");
  const wfsRaw = parseEcbCsv(texts.wfs || "").sort((a, b) => a.period.localeCompare(b.period));
  const wfsBn = millionsToBn(wfsRaw);

  const jpNominal = preferNominal(mof, fred.IRLTLT01JPM156N || []);
  const jpCpi = japanCpiYoy(fred.JPNCPIALLMINMEI || [], fred.FPCPITOTLZGJPN || [], jpNominal?.asOf ?? null);
  const jpReal = jpNominal && jpCpi ? exPostRealPercent(jpNominal.value, jpCpi.latest) : null;
  const usReal = rateOf(fred.DFII10, "FRED DFII10");
  const us10y = rateOf(fred.DGS10, "FRED DGS10");
  const cnCpi = yoyOnIndex(fred.CHNCPIALLMINMEI || []);
  const cnFisher = cnNominalFisher(usReal.value, cnCpi?.latest ?? null);
  const cn10y: LiquidityBriefingRate = cnFisher != null && cnCpi
    ? {
      value: roundTo(cnFisher, 3),
      asOf: cnCpi.period,
      source: "Fisher DFII10 + FRED CHNCPIALLMINMEI (kein live FRED-CN-10y)",
    }
    : {
      value: null,
      asOf: null,
      source: "kein live FRED-CN-10y (IRLTLT01CNM156N HTML) — Fisher needs DFII10 and CN CPI",
    };
  const de10y = rateOf(fred.IRLTLT01DEM156N, "FRED IRLTLT01DEM156N");

  const usFillRaw = officialOrRatioVelocity(fred.M2V || [], fred.GDP || [], fred.M2SL || []);
  const usEmg = usEmgFromSeries(fred.M2SL || [], fred.GDPC1 || [], fred.CPIAUCSL || []);
  const usFill = {
    velocity: usFillRaw.velocity == null ? null : roundTo(usFillRaw.velocity, 3),
    emg: usEmg == null ? null : roundTo(usEmg, 2),
    velocityMedian10y: usFillRaw.median == null ? null : roundTo(usFillRaw.median, 3),
    source: usFillRaw.source,
  };
  const velForPi = ctx.usVelocity ?? usFill.velocity;
  const vBarForPi = ctx.usVelocityMedian ?? usFill.velocityMedian10y;
  const usDecimal = usReal.value == null ? null : percentToDecimal(usReal.value);
  const jpDecimal = jpReal == null ? null : percentToDecimal(jpReal);
  const ezHicpLast = latestPoint(fred.CPHPTT01EZM659N);
  const ezHicpPct = ezHicpLast ? { latest: ezHicpLast.value, period: ezHicpLast.period } : null;
  const ezRealPct = de10y.value != null && ezHicpPct != null
    ? exPostRealPercent(de10y.value, ezHicpPct.latest)
    : null;
  const ezDecimal = ezRealPct == null ? null : percentToDecimal(ezRealPct);
  const halfLife = {
    usYears: usDecimal == null ? null : roundTo(halfLifeYears(usDecimal, velForPi, vBarForPi) ?? NaN, 2),
    jpYears: jpDecimal == null ? null : roundTo(halfLifeYears(jpDecimal, ctx.jpVelocity, ctx.jpVelocityMedian) ?? NaN, 2),
    ezYears: ezDecimal == null ? null : roundTo(halfLifeYears(ezDecimal, ctx.ezVelocity, ctx.ezVelocityMedian) ?? NaN, 2),
  };
  if (halfLife.usYears != null && !Number.isFinite(halfLife.usYears)) halfLife.usYears = null;
  if (halfLife.jpYears != null && !Number.isFinite(halfLife.jpYears)) halfLife.jpYears = null;
  if (halfLife.ezYears != null && !Number.isFinite(halfLife.ezYears)) halfLife.ezYears = null;

  const priced = briefingPricedIn(ctx.programAgeYears ?? null, velForPi, vBarForPi);
  const pricedIn: BriefingCatalog["pricedIn"] = {
    pi: priced.pi == null ? null : roundTo(priced.pi, 3),
    available: priced.available,
    phi: PHI,
    addedToLi: false,
    note: priced.note,
  };

  const wbM2 = worldBankYoy(parseWorldBankLevels(texts.worldBank || ""));
  const wbM2Levels = parseWorldBankLevels(texts.worldBank || "");
  const wbM2Last = wbM2Levels.length ? wbM2Levels[wbM2Levels.length - 1] : null;

  const oecdIn2y = parseOecdMeiJson(texts.oecdIn2y || "");
  const bisIn = parseBisCbpol(texts.bisIn || "");
  const bisCn = parseBisCbpol(texts.bisCn || "");
  const in2ySeries = oecdIn2y.length ? oecdIn2y : bisIn;
  const in2y: LiquidityBriefingRate = in2ySeries.length
    ? {
      value: roundTo(in2ySeries[in2ySeries.length - 1].value, 3),
      asOf: in2ySeries[in2ySeries.length - 1].period,
      source: oecdIn2y.length
        ? "OECD MEI_FIN IRLTTE02 IND (2y G-Sec)"
        : "BIS WS_CBPOL IN (RBI repo; kein stabiles 2y-CSV)",
    }
    : { value: null, asOf: null, source: "OECD IRLTTE02 / BIS WS_CBPOL IN — beide leer" };
  const cnRrLast = bisCn.length ? bisCn[bisCn.length - 1] : null;

  const carry = fisherCarrySeries(fred.DGS10 || [], fred.DFII10 || [], fred.CHNCPIALLMINMEI || []);
  const usEz = spreadSeriesPoints(fred.DFII10 || [], fred.IRLTLT01DEM156N || [], 1);
  const qt = qtNetSeries(ctx.app, ctx.pepp);
  const latestCarry = us10y.value != null && cn10y.value != null ? carryBp(us10y.value, cn10y.value) : null;

  const spillover: LiquidityBriefingChannel[] = [
    channel("us-asia-carry", carry, "bp", latestCarry == null ? null : roundTo(latestCarry, 1)),
    channel("us-ez", usEz, "pp"),
    channel("ez-qt", qt, "bn-eur", qt.length ? qt[qt.length - 1].value : null),
    channel("fx-jpy", fred.DEXJPUS || [], "jpy-per-usd"),
    channel("fx-eur", fred.DEXUSEU || [], "usd-per-eur"),
    channel("fx-cny", fred.DEXCHUS || [], "cny-per-usd"),
  ];

  const walcl = latestPoint(fred.WALCL);
  const rrp = latestPoint(fred.RRPONTSYD);
  const tga = latestPoint(fred.WTREGEN);
  const dff = latestPoint(fred.DFF);
  const bills = latestPoint(fred.WSHOBL);
  const notesTotal = latestPoint(fred.WSHOTSL);
  const notesAligned = notesTotal && bills
    ? latestOnOrBefore(fred.WSHOBL || [], notesTotal.period)
    : null;
  const debt = latestPoint(fred.GFDEGDQ188S);
  const assets = latestPoint(fred.JPNASSETS);
  const wfsLast = wfsBn.length ? wfsBn[wfsBn.length - 1] : null;
  const appLast = ctx.app.length ? ctx.app[ctx.app.length - 1] : null;
  const peppLast = ctx.pepp.length ? ctx.pepp[ctx.pepp.length - 1] : null;

  return {
    rates: {
      usReal,
      us10y,
      usBei: rateOf(fred.T10YIE, "FRED T10YIE"),
      jp10y: jpNominal
        ? {
          value: roundTo(jpNominal.value, 3),
          asOf: jpNominal.asOf,
          source: jpNominal.source === "mof-daily" ? "MoF constant-maturity" : "FRED IRLTLT01JPM156N",
        }
        : { value: null, asOf: null, source: "MoF constant-maturity" },
      jpCpiYoy: jpCpi
        ? { value: roundTo(jpCpi.latest, 2), asOf: jpCpi.period, source: jpCpi.source }
        : { value: null, asOf: null, source: "FRED JPNCPIALLMINMEI" },
      jpRealExPost: jpReal == null ? null : roundTo(jpReal, 3),
      cn10y,
      cnCpiYoy: cnCpi
        ? { value: roundTo(cnCpi.latest, 2), asOf: cnCpi.period, source: "FRED CHNCPIALLMINMEI" }
        : { value: null, asOf: null, source: "FRED CHNCPIALLMINMEI" },
      de10y,
      in2y,
    },
    halfLife,
    pricedIn,
    spillover,
    em: {
      weightCap: EM_INDEX_WEIGHT_CAP,
      cnM2Yoy: wbM2 ? roundTo(wbM2.latest, 2) : null,
      cnM2AsOf: wbM2?.period ?? wbM2Last?.period ?? null,
      cnM2Source: "World Bank FM.LBL.BMNY.CN annual YoY",
      cnRr7d: cnRrLast ? roundTo(cnRrLast.value, 2) : null,
      cnRrAsOf: cnRrLast?.period ?? null,
      cnRrSource: "BIS WS_CBPOL CN (PBoC policy / LPR; kein separates 7d-RR CSV)",
      cn10y: cn10y.value,
      in2y: in2y.value,
      in2yAsOf: in2y.asOf,
      in2ySource: in2y.source,
      tradeNote: "KR/TW Semi und Exportregeln sind ein Handel-Filter, keine Serie.",
    },
    usFill,
    books: {
      us: {
        walclBn: walcl ? roundTo(walcl.value / 1000, 1) : null,
        rrpBn: rrp ? roundTo(rrp.value, 1) : null,
        tgaBn: tga ? roundTo(tga.value / 1000, 1) : null,
        dff: dff ? roundTo(dff.value, 2) : null,
        dffDelta90: roundOrNull(deltaOverDays(fred.DFF || [], 90), 2),
        somaBillsMn: bills ? roundTo(bills.value, 0) : null,
        somaNotesBn: notesTotal && notesAligned ? roundOrNull(somaNotesBn(notesTotal.value, notesAligned.value), 1) : null,
        debtGdp: debt ? roundTo(debt.value, 2) : null,
        billsDiffBn: roundOrNull(monthStockDiff(mspd), 3),
      },
      eu: {
        wfsDepositsBn: wfsLast ? roundTo(wfsLast.value, 1) : null,
        appNetBn: appLast ? roundTo(appLast.netBn, 3) : null,
        peppNetBn: peppLast ? roundTo(peppLast.netBn, 3) : null,
        qtNetBn: appLast && peppLast ? qtNetBn(appLast.netBn, peppLast.netBn) : null,
      },
      jp: {
        assetsTn: assets ? jpnAssetsToTn(assets.value) : null,
        m2Bn: ctx.jpMoneyBn == null ? null : roundTo(ctx.jpMoneyBn, 1),
      },
    },
    qra: {
      nextRelease: QRA_SNAPSHOT.nextRelease,
      stale: qraSnapshotStale(ctx.nowIso),
      usFrontendOnly: true,
    },
    nakajima: { cached: false },
  };
}

function spreadSeriesPoints(left: DatedValue[], right: DatedValue[], scale: number): DatedValue[] {
  const rightByMonth = new Map(lastInMonth(right).map(p => [p.period, p.value]));
  const out: DatedValue[] = [];
  for (const point of lastInMonth(left)) {
    const other = rightByMonth.get(point.period);
    if (other == null) continue;
    out.push({ period: point.period, value: (point.value - other) * scale });
  }
  return out;
}

function latestPoint(points: DatedValue[] | undefined): DatedValue | null {
  const sorted = [...(points ?? [])].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  return sorted.length ? sorted[sorted.length - 1] : null;
}

function roundOrNull(value: number | null, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return roundTo(value, digits);
}

export async function loadBriefingCatalog(
  now: Date,
  ctx: Omit<CatalogContext, "nowIso">,
  fetchText: (url: string) => Promise<string>,
): Promise<BriefingCatalog> {
  const urls = catalogSourceUrls(now);
  const texts: CatalogTexts = { fred: {}, mof: "", mspd: "", wfs: "", worldBank: "", bisCn: "", bisIn: "", oecdIn2y: "" };
  await Promise.all(urls.map(async entry => {
    const body = await fetchText(entry.url).catch(() => "");
    if (entry.id === "MOF_JGB") texts.mof = body;
    else if (entry.id === "MSPD") texts.mspd = body;
    else if (entry.id === "ECB_WFS") texts.wfs = body;
    else if (entry.id === "WB_CN_M2") texts.worldBank = body;
    else if (entry.id === "BIS_CN_CBPOL") texts.bisCn = body;
    else if (entry.id === "BIS_IN_CBPOL") texts.bisIn = body;
    else if (entry.id === "OECD_IN_2Y") texts.oecdIn2y = body;
    else texts.fred[entry.id] = body;
  }));
  return assembleCatalog(texts, { ...ctx, nowIso: now.toISOString().slice(0, 10) });
}
