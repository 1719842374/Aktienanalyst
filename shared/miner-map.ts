/**
 * Bitcoin-Miner-Karte (Offen_WORK_BITCOIN_MINER_MAP.md).
 * Nur Anzeige. Kein Score, kein Rating, kein Live-P.
 * Jede Zahl hat Quelle und Stichtag. Fehlendes bleibt null plus „n/a — Grund“, nie 0.
 * Bubble-Größe ist der Perzentilrang der genannten MW, nicht eine feste MW-Schwelle.
 */
export const MINER_MAP_RADIUS = {
  /** Untere Kante der Bubble, Perzentil 0 der Stichprobe. */
  minPx: 5,
  /** Obere Kante der Bubble, Perzentil 1 der Stichprobe. */
  maxPx: 22,
  /** Zeichenpunkt ohne Datenradius. Steht nicht für 0 MW. */
  naPx: 4,
} as const;

/** Tertile des Perzentilrangs. Definition der drei Bänder, keine MW-Grenze. */
export const MINER_MAP_TERTILE = {
  lowMax: 1 / 3,
  midMax: 2 / 3,
} as const;

/**
 * Welche Kapazitätsrollen in die Bubble-Stichprobe eingehen.
 * `planned` bleibt im Panel, skaliert die Karte aber nicht.
 */
export const MINER_BUBBLE_ROLES = ["developed", "nameplate", "available"] as const;

export type MinerCapacityRole = (typeof MINER_BUBBLE_ROLES)[number] | "planned" | "hpc";

/**
 * MW aus Hashrate und Effizienz.
 * 1 EH/s = thPerEh TH/s. Leistung in Watt = TH/s × J/TH. 1 MW = wattsPerMw Watt.
 * MW = EH/s × J/TH. Eine fehlende Effizienz bleibt null, keine angenommene J/TH.
 */
export const HASHRATE_MW = {
  thPerEh: 1_000_000,
  wattsPerMw: 1_000_000,
} as const;

export function mwFromHashrateEh(ehPerS: number, joulesPerTh: number): number | null {
  if (!(typeof ehPerS === "number" && Number.isFinite(ehPerS) && ehPerS > 0)) return null;
  if (!(typeof joulesPerTh === "number" && Number.isFinite(joulesPerTh) && joulesPerTh > 0)) return null;
  const watts = ehPerS * HASHRATE_MW.thPerEh * joulesPerTh;
  const mw = watts / HASHRATE_MW.wattsPerMw;
  return Number.isFinite(mw) && mw > 0 ? mw : null;
}

/** EH/s aus MW und einer genannten Effizienz. Umkehr von mwFromHashrateEh: EH/s = MW / (J/TH). */
export function ehsFromMw(mw: number, joulesPerTh: number): number | null {
  if (!(typeof mw === "number" && Number.isFinite(mw) && mw > 0)) return null;
  if (!(typeof joulesPerTh === "number" && Number.isFinite(joulesPerTh) && joulesPerTh > 0)) return null;
  const eh = mw / joulesPerTh;
  return Number.isFinite(eh) && eh > 0 ? eh : null;
}

/** Obergrenze aus der Hut-8-Meldung, nicht eine gemessene Ist-Hashrate. */
export const VEGA_HASHRATE_CEILING = {
  ehPerS: 15,
  joulesPerTh: 13,
} as const;

export const VEGA_FORMULA_MW = mwFromHashrateEh(VEGA_HASHRATE_CEILING.ehPerS, VEGA_HASHRATE_CEILING.joulesPerTh);

const HUT_VEGA_RELEASE = "https://www.globenewswire.com/news-release/2025/06/30/3107324/0/en/hut-8-energizes-vega-data-center.html";
const CIFR_BARBER_2024 = "https://www.sec.gov/Archives/edgar/data/1819989/000181998924000026/cifr-20241031xex991.htm";
const CIFR_BARBER_LEASE = "https://www.sec.gov/Archives/edgar/data/1819989/000095010325012168/dp234624_ex9901.htm";
const CENSUS_TX_PLACES = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_48.txt";
const TDLR_BARBER = "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2026023534";
const CAMBRIDGE_ARCHIVE_URL = "https://www.jbs.cam.ac.uk/2022/bitcoin-mining-new-data-reveal-a-surprising-resurgence/";

export const MINER_BUBBLE_COLOR = {
  low: "#38bdf8",
  mid: "#f59e0b",
  high: "#f43f5e",
  na: "#64748b",
} as const;

/** Anzeige-Cache, gleiche Dauer wie der Erfolgs-Cache in server/btc-miner.ts. */
export const MINER_PIPELINE_CACHE_MS = 60 * 60 * 1000;

/** Wie lange die Karte auf die bestehende Miner-Pipeline wartet, danach Standorte ohne Live-Kontext. */
export const MINER_MAP_PIPELINE_WAIT_MS = 8_000;

export interface SourcedNumber {
  value: number;
  asOf: string;
  sourceLabel: string;
  sourceUrl: string;
  scope: string;
  /** Badge, wenn der Wert eine Schätzung und kein gemessener Primärwert ist. */
  estimateLabel?: string;
}

export interface MinerMapOperator {
  ticker: string;
  name: string;
  siteHashrateEHs: SourcedNumber | null;
  siteHashrateNote: string | null;
  companyHashrateEHs: SourcedNumber | null;
  companyHashrateNote: string | null;
  companyPowerUsdPerKwh: SourcedNumber | null;
  companyPowerNote: string | null;
}

export interface MinerMapSite {
  id: string;
  name: string;
  region: string;
  iso2: string;
  /** ISO-3166 numerisch, world-atlas countries-110m. */
  isoNum: string;
  /** null, wenn die Quelle keine Lage nennt. Dann kein Pin. */
  lat: number | null;
  lon: number | null;
  coordNote: string;
  capacityMw: SourcedNumber | null;
  capacityNote: string | null;
  capacityRole: MinerCapacityRole | null;
  operators: MinerMapOperator[];
  /** Leer nur wenn kein Betreiber in der Quelle steht; dann operatorNote. */
  operatorNote: string | null;
  energyNote: string;
  regulatoryNote: string;
  /** Quelle und Formel, wenn eine Zahl aus EH/s × J/TH oder einem Archiv erklärt wird. */
  formulaTooltip?: string | null;
  /** Gesetzt, wenn der Wert kein aktueller Primärwert ist. */
  estimateLabel?: string | null;
}

export interface MinerMapGap {
  id: string;
  label: string;
  note: string;
}

export type MinerBubbleBand = "low" | "mid" | "high" | "n/a";

export interface MinerMapBubble {
  radiusPx: number | null;
  percentile: number | null;
  band: MinerBubbleBand;
  color: string;
  note: string | null;
}

export interface MinerMapPipeline {
  networkHashrateEH: number | null;
  networkHashrateNote: string | null;
  hashpriceBtcPerThDay: number | null;
  hashpriceNote: string | null;
  hashpriceUsdPerThDay: number | null;
  hashpriceUsdNote: string | null;
  /** Gesetzt, wenn USD/TH/Tag = BTC/TH/Tag × Spot gerechnet ist. */
  hashpriceUsdFormula: string | null;
  btcSpotUsd: number | null;
  btcSpotNote: string | null;
  breakevenUsd: number | null;
  breakevenNote: string | null;
  puellMultiple: number | null;
  puellNote: string | null;
  hashrateSource: string | null;
  lastUpdated: string | null;
  stale: boolean;
  unavailableNote: string | null;
}

export interface MinerMapResponse {
  layer: "miner";
  asOf: string;
  source: string;
  attribution: string;
  coverage: { total: number; withMw: number; withSiteEhs: number; withCompanyEhs: number };
  sites: (MinerMapSite & { bubble: MinerMapBubble })[];
  pipeline: MinerMapPipeline;
  /** Länderanteil bewusst nicht befüllt. */
  countryShareNote: string;
  /** Archiv-Anteile. Nicht der Ist-Stand des Karten-Datums. */
  countryShares: MinerCountryShare[];
  gaps: MinerMapGap[];
  _cached?: boolean;
}

const RIOT_10Q = "https://www.sec.gov/Archives/edgar/data/1167419/000110465926093448/R8.htm";
const RIOT_EX = "https://www.sec.gov/Archives/edgar/data/1167419/000110465926093406/riot-20260810xex99d2.htm";
const HIVE_EX = "https://www.sec.gov/Archives/edgar/data/1720424/000106299326002965/exhibit99-1.htm";
const IREN_20F = "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000052/iren-20260630.htm";
const CLSK_IR = "https://investors.cleanspark.com/news/news-details/2026/CleanSpark-Releases-August-2026-Operational-Update/default.aspx";
const CLSK_10Q = "https://ebs.publicnow.com/view/A41B7D68944796EAC04DD490719D6F774AA54BA7";
const BITF_PR = "https://investor.bitfarms.com/news-releases/news-release-details/bitfarms-announces-plans-conversion-washington-site-hpcai";
const MARA_8K_HANNIBAL = "https://www.sec.gov/Archives/edgar/data/1507605/000119312526193982/d54802dex991.htm";
const MARA_10Q_MINDEN = "https://www.sec.gov/Archives/edgar/data/1507605/000150760526000022/mara-20260630.htm";
const COINSHARES = "https://coinshares.com/corp/insights/research-data/bitcoin-mining-report-q1-2026/";
const CAMBRIDGE = "https://ccaf.io/cbnsi/cbeci/mining_map";

const riotCompanyHash: SourcedNumber = {
  value: 44.4,
  asOf: "2026-06-30",
  sourceLabel: "Riot Exhibit 99.2, Q2 2026",
  sourceUrl: RIOT_EX,
  scope: "Ending Hash Rate Capacity, Konzern, nicht Standort",
};
const riotCompanyPower: SourcedNumber = {
  value: 0.036,
  asOf: "2026-06-30",
  sourceLabel: "Riot Exhibit 99.2, Q2 2026",
  sourceUrl: RIOT_EX,
  scope: "all-in cost of power 3.6 c/kWh, Konzern, nicht Standort",
};

function riotOperator(siteHashrateNote: string): MinerMapOperator {
  return {
    ticker: "RIOT",
    name: "Riot Platforms",
    siteHashrateEHs: null,
    siteHashrateNote,
    companyHashrateEHs: riotCompanyHash,
    companyHashrateNote: null,
    companyPowerUsdPerKwh: riotCompanyPower,
    companyPowerNote: null,
  };
}

const hiveCompanyHash: SourcedNumber = {
  value: 25.1,
  asOf: "2026-03-31",
  sourceLabel: "HIVE Exhibit 99.1, FY2026",
  sourceUrl: HIVE_EX,
  scope: "Installed hashrate zum Bilanzstichtag, Konzern. Die Meldung nennt zusätzlich 25.3 EH/s am Veröffentlichungstag ohne eigenes Datum.",
};

const clsCompanyHash: SourcedNumber = {
  value: 50,
  asOf: "2026-08-31",
  sourceLabel: "CleanSpark Operational Update August 2026",
  sourceUrl: CLSK_IR,
  scope: "Operational hashrate, Konzern. Average operating hashrate derselben Meldung: 38.3 EH/s.",
};
const clsCompanyPower: SourcedNumber = {
  value: 0.052,
  asOf: "2026-03-31",
  sourceLabel: "CleanSpark Quartalsbericht, drei Monate bis 31.03.2026",
  sourceUrl: CLSK_10Q,
    scope: "Cost per kWh der Owned Facilities, Konzern, nicht ein Bundesstaat. Gelesen im 10-Q-Spiegel, drei Monate bis 31.03.2026.",
};

const maraCompanyHash: SourcedNumber = {
  value: 53.2,
  asOf: "2025-12-31",
  sourceLabel: "CoinShares Bitcoin Mining Report Q1 2026",
  sourceUrl: COINSHARES,
  scope: "Energised hashrate Ende Dezember 2025, Konzern. Kein späterer freier Wert in den gelesenen Quellen.",
};

const irenCompanyHash: SourcedNumber = {
  value: 23.2,
  asOf: "2026-06-30",
  sourceLabel: "IREN Form 10-K FY2026",
  sourceUrl: IREN_20F,
  scope: "Installed Bitcoin mining capacity etwa 23.2 EH/s auf etwa 380 MW, Konzern, nicht ein Standort. Stand 30.06.2026.",
};

const HUT_10Q = "https://www.sec.gov/Archives/edgar/data/1964789/000110465926090025/hut-20260630x10q.htm";
const hutCompanyHash: SourcedNumber = {
  value: 28.1,
  asOf: "2026-06-30",
  sourceLabel: "Hut 8 Form 10-Q, Quartal bis 30.06.2026",
  sourceUrl: HUT_10Q,
  scope: "American Bitcoin, konsolidierte Tochter: owned fleet nach der Drumheller-Lieferung im April 2026 etwa 28.1 EH/s, vorher etwa 25.1. Sechs Standorte, nicht Vega allein.",
};

const CIFR_Q3_2026 = "https://ciphermining.gcs-web.com/static-files/db20d559-f9b5-4a1c-b0ac-b55165955b78";
const cifrSiteHash: SourcedNumber = {
  value: 11.6,
  asOf: "2026-09-30",
  sourceLabel: "Cipher Digital, Q3 2026 Business Update, 02.11.2026",
  sourceUrl: CIFR_Q3_2026,
  scope: "etwa 11.6 EH/s auf der Odessa-Folie, neben 296 BTC im Quartal, 207 MW und etwa 17.2 J/TH. Die Tilde steht in der Quelle. Kontrollrechnung der Nameplate: EH/s = MW / (J/TH) = 207 / 17.2 = 12.03. Die 12.03 ersetzen die genannten 11.6 nicht.",
};
const cifrCompanyHash: SourcedNumber = {
  value: 11.6,
  asOf: "2026-09-30",
  sourceLabel: "Cipher Digital, Q3 2026 Business Update, 02.11.2026",
  sourceUrl: CIFR_Q3_2026,
  scope: "etwa 11.6 EH/s Total Hashrate, in dem Update dem Odessa-Mining zugeordnet. Kein zweiter Mining-Standort in der gelesenen Folie.",
};

const BTDR_SEP_2026 = "https://ir.bitdeer.com/node/9916/pdf";
const BTDR_Q2_2026 = "https://ir.bitdeer.com/news-releases/news-release-details/bitdeer-reports-unaudited-financial-results-second-quarter-2026";
const btdrCompanyHash: SourcedNumber = {
  value: 82.3,
  asOf: "2026-09-30",
  sourceLabel: "Bitdeer, September 2026 Production Update",
  sourceUrl: BTDR_SEP_2026,
  scope: "Self-Mining in eigenen Rechenzentren, etwa 82.3 EH/s per 30.09.2026. Nicht Äthiopien allein. Total Proprietary derselben Meldung: 86.4 EH/s.",
};
const btdrCompanyPower: SourcedNumber = {
  value: 44 / 1000,
  asOf: "2026-06-30",
  sourceLabel: "Bitdeer, Q2 2026 unaudited results",
  sourceUrl: BTDR_Q2_2026,
  scope: "Average cost of electricity 44 $/MWh im Quartal bis 30.06.2026, Konzern, nicht Äthiopien.",
};

const ERCOT_IMM_AUG2026 = "https://www.potomaceconomics.com/wp-content/uploads/2026/09/2026-08_Nodal_Monthly_Report.pdf";

function ercotHubPower(hub: "West" | "Houston", usdPerMwh: number): SourcedNumber {
  return {
    value: usdPerMwh / 1000,
    asOf: "2026-08",
    sourceLabel: "Potomac Economics, ERCOT IMM Monthly Report, August 2026",
    sourceUrl: ERCOT_IMM_AUG2026,
    scope: `Schätzung. ERCOT ${hub} Hub, Average Real-Time Price August 2026, ${usdPerMwh.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $/MWh. Regionspreis, nicht der Vertragspreis des Standorts.`,
    estimateLabel: "Schätzung",
  };
}

const HUT_FLEET_J_PER_TH = 16;
const VEGA_SITE_EH = ehsFromMw(205, HUT_FLEET_J_PER_TH);
const BTDR_FLEET_J_PER_TH = 15.8;
const ETHIOPIA_MW = 40;
const ETHIOPIA_SITE_EH = ehsFromMw(ETHIOPIA_MW, BTDR_FLEET_J_PER_TH);

export interface MinerCountryShare {
  iso2: string;
  name: string;
  /** Monat des Archivs, nicht das Veröffentlichungsdatum. */
  asOf: string;
  sharePct: number | null;
  hashrateEH: number | null;
  label: "Schätzung / keine Primärquelle" | "Schätzung";
  sourceLabel: string;
  sourceUrl: string;
  note: string | null;
}

const CAMBRIDGE_ARCHIVE_LABEL = "Cambridge Judge Business School, 17.05.2022, CCAF Mining Map Januar 2022";

/** USA 70.97 EH/s sind 37.84 % derselben Tabelle. China-EH/s = 70.97 × (21.11 / 37.84). */
export const CAMBRIDGE_CHINA_JAN2022_EH = Math.round(70.97 * (21.11 / 37.84) * 100) / 100;

/** Anteile aus dem Cambridge-Artikel. Kein Ist 2026, keine Fortschreibung. */
export const CAMBRIDGE_ARCHIVE_SHARES: readonly MinerCountryShare[] = [
  {
    iso2: "US",
    name: "USA",
    asOf: "2022-01",
    sharePct: 37.84,
    hashrateEH: 70.97,
    label: "Schätzung / keine Primärquelle",
    sourceLabel: CAMBRIDGE_ARCHIVE_LABEL,
    sourceUrl: CAMBRIDGE_ARCHIVE_URL,
    note: null,
  },
  {
    iso2: "CN",
    name: "China",
    asOf: "2022-01",
    sharePct: 21.11,
    hashrateEH: CAMBRIDGE_CHINA_JAN2022_EH,
    label: "Schätzung / keine Primärquelle",
    sourceLabel: CAMBRIDGE_ARCHIVE_LABEL,
    sourceUrl: CAMBRIDGE_ARCHIVE_URL,
    note: `Formel: EH/s = USA-EH/s × (China-Anteil / USA-Anteil) = 70.97 × (21.11 / 37.84) = ${CAMBRIDGE_CHINA_JAN2022_EH}. Dieselbe Cambridge-Tabelle Januar 2022. Der Artikel nennt keine absolute EH/s-Zahl für China. 30.47 EH/s vom September 2021 bleiben ungenutzt.`,
  },
  {
    iso2: "KZ",
    name: "Kasachstan",
    asOf: "2022-01",
    sharePct: 13.22,
    hashrateEH: 24.79,
    label: "Schätzung / keine Primärquelle",
    sourceLabel: CAMBRIDGE_ARCHIVE_LABEL,
    sourceUrl: CAMBRIDGE_ARCHIVE_URL,
    note: null,
  },
  {
    iso2: "CA",
    name: "Kanada",
    asOf: "2022-01",
    sharePct: 6.48,
    hashrateEH: 12.15,
    label: "Schätzung / keine Primärquelle",
    sourceLabel: CAMBRIDGE_ARCHIVE_LABEL,
    sourceUrl: CAMBRIDGE_ARCHIVE_URL,
    note: null,
  },
  {
    iso2: "RU",
    name: "Russland",
    asOf: "2022-01",
    sharePct: 4.66,
    hashrateEH: 8.74,
    label: "Schätzung / keine Primärquelle",
    sourceLabel: CAMBRIDGE_ARCHIVE_LABEL,
    sourceUrl: CAMBRIDGE_ARCHIVE_URL,
    note: null,
  },
];

/** Jüngere Länder-Schätzung, getrennt vom Cambridge-Archiv Januar 2022. */
export const HASHRATE_INDEX_CHINA_Q4: MinerCountryShare = {
  iso2: "CN",
  name: "China (Hashrate Index, Q4 2026)",
  asOf: "2026-09",
  sharePct: 11.7,
  hashrateEH: 110,
  label: "Schätzung",
  sourceLabel: "Hashrate Index, Global Hashrate Heatmap Q4 2026, 05.10.2026",
  sourceUrl: "https://hashrateindex.com/blog/global-hashrate-heatmap-update-q4-2026-c/",
  note: "Schätzung. Artikel vom 05.10.2026 zum Stand Ende Q3 2026: China etwa 110 EH/s, 11.7 % von etwa 941 EH/s Netz. Die Tilde steht in der Quelle. Kein Primärfiling und nicht das Cambridge-Archiv Januar 2022.",
};

export const MINER_FILING_LOWER_BOUND_NOTE =
  "Filing-Untergrenze: n/a — keine gemessene standortscharfe EH/s. Vega nennt bis zu 15 EH/s als Obergrenze bei voller Energisierung. Obergrenzen zählen nicht als Untergrenze und werden nicht als 0 geführt.";

export function formatCambridgeShareNote(shares: readonly MinerCountryShare[], filingNote: string): string {
  const bits = shares.map(share => {
    const eh = share.hashrateEH == null ? "EH/s n/a" : `${share.hashrateEH} EH/s`;
    const pct = share.sharePct == null ? "Anteil n/a" : `${share.sharePct} %`;
    return `${share.name} ${eh} (${pct})`;
  });
  const source = shares[0];
  const head = source
    ? `${source.label}. ${source.sourceLabel} (${source.sourceUrl}), Stand ${source.asOf}, nicht Ist 2026`
    : "Schätzung / keine Primärquelle. Keine Archivzeile";
  return `${head}: ${bits.join("; ")}. ${filingNote}`;
}

export const MINER_MAP_COUNTRY_SHARE_NOTE = formatCambridgeShareNote(CAMBRIDGE_ARCHIVE_SHARES, MINER_FILING_LOWER_BOUND_NOTE);

/** Die drei früheren Lücken haben eine Quelle. Was ohne Koordinate oder Effizienz bleibt, steht an der Site. */
export const MINER_MAP_GAPS: MinerMapGap[] = [];

export const MINER_MAP_SITES: MinerMapSite[] = [
  {
    id: "us-tx-rockdale",
    name: "Rockdale",
    region: "Texas, USA",
    iso2: "US",
    isoNum: "840",
    lat: 30.655,
    lon: -97.001,
    coordNote: "Ungefähre Lage Rockdale, Texas. Kein vermessener Anlagenpunkt.",
    capacityMw: {
      value: 700,
      asOf: "2026-06-30",
      sourceLabel: "Riot Form 10-Q",
      sourceUrl: RIOT_10Q,
      scope: "bis zu ca. 700 MW developed capacity für Bitcoin-Mining und Data-Center-Leasing",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [riotOperator("n/a — die 44.4 EH/s sind die Ending Hash Rate Capacity des Konzerns, nicht von Rockdale")],
    operatorNote: null,
    energyNote: "Konzern Q2 2026: all-in cost of power 3.6 c/kWh. Kein eigener Rockdale-Tarif in der gelesenen Stelle. Teile der Fläche sind an AMD und ein AI-Lab vermietet.",
    regulatoryNote: "n/a — die gelesene Riot-Stelle nennt keine Rockdale-spezifische Regulierung. Texas SB 6 steht in der IREN-Jahresmeldung, nicht in diesem Riot-Auszug.",
  },
  {
    id: "us-tx-corsicana",
    name: "Corsicana",
    region: "Texas, USA",
    iso2: "US",
    isoNum: "840",
    lat: 32.095,
    lon: -96.469,
    coordNote: "Ungefähre Lage Corsicana, Texas. Kein vermessener Anlagenpunkt.",
    capacityMw: {
      value: 400,
      asOf: "2026-06-30",
      sourceLabel: "Riot Form 10-Q",
      sourceUrl: RIOT_10Q,
      scope: "bis zu ca. 400 MW developed capacity für Bitcoin-Mining",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [riotOperator("n/a — Konzern-Hashrate, nicht Corsicana zugeordnet")],
    operatorNote: null,
    energyNote: "Siehe Konzernwert 3.6 c/kWh Q2 2026. Kein Corsicana-Tarif in der gelesenen Stelle.",
    regulatoryNote: "n/a — keine standortspezifische Regulierung in der gelesenen Riot-Stelle.",
  },
  {
    id: "us-ky-riot",
    name: "Kentucky (zwei Sites)",
    region: "Kentucky, USA",
    iso2: "US",
    isoNum: "840",
    lat: 37.5,
    lon: -85.3,
    coordNote: "Landesmitte Kentucky. Die 10-Q nennt zwei Sites, aber keine Orte.",
    capacityMw: {
      value: 192,
      asOf: "2026-06-30",
      sourceLabel: "Riot Form 10-Q",
      sourceUrl: RIOT_10Q,
      scope: "ca. 192 MW developed capacity, beide Kentucky-Sites zusammen",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [riotOperator("n/a — Konzern-Hashrate, nicht auf die Kentucky-Sites verteilt")],
    operatorNote: null,
    energyNote: "n/a — kein Kentucky-Tarif in der gelesenen Stelle. Konzern 3.6 c/kWh steht am Betreiber.",
    regulatoryNote: "n/a — keine Kentucky-spezifische Regulierung in der gelesenen Stelle.",
  },
  {
    id: "py-hive",
    name: "Yguazú / Valenzuela",
    region: "Paraguay",
    iso2: "PY",
    isoNum: "600",
    lat: -25.6,
    lon: -55.2,
    coordNote: "Ungefähre Lage zwischen Yguazú und Valenzuela. Die 300 MW sind nicht auf die Phasen verteilt.",
    capacityMw: {
      value: 300,
      asOf: "2025-11-10",
      sourceLabel: "HIVE Exhibit 99.1, FY2026",
      sourceUrl: HIVE_EX,
      scope: "300 MW Paraguay-Ausbau, drei Phasen, Wasserkraft, ANDE-Verträge",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [{
      ticker: "HIVE",
      name: "HIVE Digital Technologies",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 25.1 EH/s sind die installierte Konzern-Hashrate, nicht nur Paraguay",
      companyHashrateEHs: hiveCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh in der gelesenen HIVE-Meldung",
    }],
    operatorNote: null,
    energyNote: "Wasserkraft. Operative globale Leistung 440 MW über Kanada, Schweden und Paraguay, ohne Länder-Split der restlichen 140 MW.",
    regulatoryNote: "Die Meldung nennt die weitere Unterstützung der paraguayischen Behörden und ANDE-Stromverträge als Abhängigkeit.",
  },
  {
    id: "ca-bc-canal-flats",
    name: "Canal Flats",
    region: "British Columbia, Kanada",
    iso2: "CA",
    isoNum: "124",
    lat: 50.183,
    lon: -115.822,
    coordNote: "Ungefähre Lage Canal Flats, British Columbia.",
    capacityMw: {
      value: 30,
      asOf: "2026-06-30",
      sourceLabel: "IREN Jahresbericht, Properties",
      sourceUrl: IREN_20F,
      scope: "angekündigte Leistung gross MW; die Tabelle mischt Betrieb, Umbau, Bau und Entwicklung",
    },
    capacityNote: null,
    capacityRole: "nameplate",
    operators: [{
      ticker: "IREN",
      name: "IREN Limited",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 10-K FY2026: 23.2 EH/s und etwa 380 MW sind der Konzern, nicht Canal Flats. Keine J/TH und kein Standort-Split, deshalb keine Schätzung aus der Nameplate. Historische 40.1 EH/s per 30.06.2025 bleiben ungenutzt.",
      companyHashrateEHs: irenCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh im 10-K. BC Hydro ist ein regulierter Tarif, der Centwert steht in der gelesenen Stelle nicht.",
    }],
    operatorNote: null,
    energyNote: "BC Hydro, seit Betriebsbeginn als erneuerbar beschrieben (Netz plus RECs).",
    regulatoryNote: "Regulierter Strommarkt British Columbia, Lieferung durch BC Hydro.",
  },
  {
    id: "ca-bc-prince-george",
    name: "Prince George",
    region: "British Columbia, Kanada",
    iso2: "CA",
    isoNum: "124",
    lat: 53.917,
    lon: -122.749,
    coordNote: "Ungefähre Lage Prince George, British Columbia.",
    capacityMw: {
      value: 50,
      asOf: "2026-06-30",
      sourceLabel: "IREN Jahresbericht, Properties",
      sourceUrl: IREN_20F,
      scope: "angekündigte Leistung gross MW; Tabelle ohne Status je Zeile",
    },
    capacityNote: null,
    capacityRole: "nameplate",
    operators: [{
      ticker: "IREN",
      name: "IREN Limited",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 10-K FY2026: 23.2 EH/s und etwa 380 MW sind der Konzern, nicht Prince George. Keine J/TH und kein Standort-Split, deshalb keine Schätzung aus der Nameplate.",
      companyHashrateEHs: irenCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh im 10-K. BC Hydro ist ein regulierter Tarif, der Centwert steht in der gelesenen Stelle nicht.",
    }],
    operatorNote: null,
    energyNote: "BC Hydro, erneuerbar laut IREN (Netz plus RECs).",
    regulatoryNote: "Regulierter Strommarkt British Columbia.",
  },
  {
    id: "ca-bc-mackenzie",
    name: "Mackenzie",
    region: "British Columbia, Kanada",
    iso2: "CA",
    isoNum: "124",
    lat: 55.338,
    lon: -123.094,
    coordNote: "Ungefähre Lage Mackenzie, British Columbia.",
    capacityMw: {
      value: 80,
      asOf: "2026-06-30",
      sourceLabel: "IREN Jahresbericht, Properties",
      sourceUrl: IREN_20F,
      scope: "angekündigte Leistung gross MW; Tabelle ohne Status je Zeile",
    },
    capacityNote: null,
    capacityRole: "nameplate",
    operators: [{
      ticker: "IREN",
      name: "IREN Limited",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 10-K FY2026: 23.2 EH/s und etwa 380 MW sind der Konzern, nicht Mackenzie. Keine J/TH und kein Standort-Split, deshalb keine Schätzung aus der Nameplate. GPU-Finanzierung am Standort ist AI, nicht Hashrate.",
      companyHashrateEHs: irenCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh im 10-K. BC Hydro ist ein regulierter Tarif, der Centwert steht in der gelesenen Stelle nicht.",
    }],
    operatorNote: null,
    energyNote: "BC Hydro. Zusätzliche Flüssigkühlung 2027 ist als AI-Nutzung der Leistungsreserve beschrieben.",
    regulatoryNote: "Regulierter Strommarkt British Columbia.",
  },
  {
    id: "us-tx-childress",
    name: "Childress",
    region: "Texas, USA",
    iso2: "US",
    isoNum: "840",
    lat: 34.426,
    lon: -100.204,
    coordNote: "Ungefähre Lage Childress, Texas.",
    capacityMw: {
      value: 750,
      asOf: "2026-06-30",
      sourceLabel: "IREN Jahresbericht, Properties",
      sourceUrl: IREN_20F,
      scope: "angekündigte Leistung gross MW. Nicht als reine Mining-Last gelesen: AI-Umbau läuft.",
    },
    capacityNote: null,
    capacityRole: "nameplate",
    operators: [{
      ticker: "IREN",
      name: "IREN Limited",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 10-K FY2026: 23.2 EH/s und etwa 380 MW sind der Konzern, nicht Childress. Die 750 MW Nameplate sind nicht diese Mining-Last, und eine J/TH fehlt, deshalb keine Schätzung Nameplate/(J/TH). 40.1 EH/s per 30.06.2025 bleiben ungenutzt.",
      companyHashrateEHs: irenCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: ercotHubPower("West", 37.8),
      companyPowerNote: null,
    }],
    operatorNote: null,
    energyNote: "ERCOT-Wholesale. RECs für den Verbrauch bis 30.06.2026. Horizon-Flächen am Standort sind GPU-Verträge, keine Hashrate.",
    regulatoryNote: "IREN nennt Texas SB 6 (2025): neue Anschlussregeln für Lasten ab 75 MW, einschließlich ERCOT und PUCT.",
  },
  {
    id: "us-oh-hannibal",
    name: "Hannibal",
    region: "Ohio, USA",
    iso2: "US",
    isoNum: "840",
    lat: 39.67,
    lon: -80.87,
    coordNote: "Ungefähre Lage Hannibal, Ohio. Kein vermessener Anlagenpunkt.",
    capacityMw: {
      value: 200,
      asOf: "2026-04-30",
      sourceLabel: "MARA Form 8-K Exhibit 99.1",
      sourceUrl: MARA_8K_HANNIBAL,
      scope: "200 MW bestehende Kapazität des Hannibal-Rechenzentrums. Form 8-K Exhibit 99.1, Filing-Datum 2026-04-30.",
    },
    capacityNote: null,
    capacityRole: "available",
    operators: [{
      ticker: "MARA",
      name: "MARA Holdings",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — Form 8-K Exhibit 99.1 vom 30.04.2026 nennt keine EH/s für Hannibal.",
      companyHashrateEHs: maraCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — Form 8-K Exhibit 99.1 vom 30.04.2026 nennt keinen Strompreis für Hannibal.",
    }],
    operatorNote: null,
    energyNote: "n/a — kein Tarif im Form 8-K Exhibit 99.1 vom 30.04.2026.",
    regulatoryNote: "n/a — Form 8-K Exhibit 99.1 vom 30.04.2026 nennt keine Regulierung für Hannibal.",
  },
  {
    id: "us-ne-minden",
    name: "Minden",
    region: "Nebraska, USA",
    iso2: "US",
    isoNum: "840",
    lat: 40.498,
    lon: -98.948,
    coordNote: "Ungefähre Lage Minden, Nebraska.",
    capacityMw: {
      value: 42,
      asOf: "2026-08-06",
      sourceLabel: "MARA Form 10-Q",
      sourceUrl: MARA_10Q_MINDEN,
      scope: "42 MW nameplate, Central Nebraska. Form 10-Q, Filing-Datum 2026-08-06.",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [{
      ticker: "MARA",
      name: "MARA Holdings",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — Form 10-Q vom 06.08.2026 nennt keine EH/s für Minden.",
      companyHashrateEHs: maraCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — Form 10-Q vom 06.08.2026 nennt keinen Strompreis für Minden.",
    }],
    operatorNote: null,
    energyNote: "n/a — als netzgekoppelt beschrieben, ohne Tarif im Form 10-Q vom 06.08.2026.",
    regulatoryNote: "n/a — Form 10-Q vom 06.08.2026 nennt keine Regulierung für Minden.",
  },
  {
    id: "us-tx-matagorda",
    name: "Matagorda",
    region: "Texas, USA",
    iso2: "US",
    isoNum: "840",
    lat: 28.8,
    lon: -96.0,
    coordNote: "Ungefähre Mitte Matagorda County. Entwicklungsfläche, kein Betriebspunkt.",
    capacityMw: null,
    capacityNote: "n/a — MARA nennt „up to 2 GW of expected power access“. Das ist eine Erwartung, keine Betriebs-MW, und geht nicht in die Bubble.",
    capacityRole: "planned",
    operators: [{
      ticker: "MARA",
      name: "MARA Holdings",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — keine EH/s und keine J/TH. Standort ist als Development beschrieben, deshalb keine Schätzung MW/(J/TH).",
      companyHashrateEHs: maraCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: ercotHubPower("Houston", 37.99),
      companyPowerNote: null,
    }],
    operatorNote: null,
    energyNote: "Kein Vertragspreis. Am Betreiber steht der ERCOT-Houston-Hub als Schätzung. Erwarteter Netzanschluss, nicht energisiert in der gelesenen Stelle.",
    regulatoryNote: "n/a — die Seite nennt keine Regulierung für Matagorda.",
  },
  {
    id: "us-ga-cleanspark",
    name: "Georgia (CleanSpark)",
    region: "Georgia, USA",
    iso2: "US",
    isoNum: "840",
    lat: 32.7,
    lon: -83.2,
    coordNote: "Landesmitte Georgia. Sandersville ist 2026 als Baustelle genannt, ohne eigene MW-Zahl.",
    capacityMw: null,
    capacityNote: "n/a — August 2026: 808 MW utilized nur für den Konzern. Historisch Oktober 2024: Southeast-Georgia nach Helene wieder 365 MW. Die 365 MW werden nicht als Ist 2026 gezeigt.",
    capacityRole: null,
    operators: [{
      ticker: "CLSK",
      name: "CleanSpark",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 50 EH/s operational sind der Konzern, nicht Georgia",
      companyHashrateEHs: clsCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: clsCompanyPower,
      companyPowerNote: null,
    }],
    operatorNote: null,
    energyNote: "Konzern Q1 2026 (bis 31.03.): 5.2 c/kWh an Owned Facilities, Verträge variabel und je Standort verschieden. Standorte laut Quartalsbericht auch Tennessee, Mississippi, Wyoming.",
    regulatoryNote: "n/a — das August-Update nennt ERCOT/PUCT und die Prüfung des Gouverneurs für Texas, nicht für Georgia.",
  },
  {
    id: "us-wa-bitfarms",
    name: "Washington",
    region: "Washington, USA",
    iso2: "US",
    isoNum: "840",
    lat: 47.4,
    lon: -120.5,
    coordNote: "Landesmitte Washington. Die Meldung nennt den Ort nicht.",
    capacityMw: {
      value: 18,
      asOf: "2025-11-13",
      sourceLabel: "Bitfarms Pressemitteilung",
      sourceUrl: BITF_PR,
      scope: "18 MW Bitcoin-Mining-Facility, Umbau auf HPC/AI angekündigt",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [{
      ticker: "BITF",
      name: "Bitfarms",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — die Meldung nennt keine EH/s",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine aktuelle EH/s in der gelesenen Meldung",
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein Strompreis in der gelesenen Meldung",
    }],
    operatorNote: null,
    energyNote: "n/a — kein Tarif. Die Meldung beschreibt den Umbau, nicht den Stromvertrag.",
    regulatoryNote: "n/a — keine regulatorische Aussage in der gelesenen Meldung. Umbau der Mining-Facility auf HPC/AI ist angekündigt.",
  },
  {
    id: "us-tx-odessa",
    name: "Odessa",
    region: "Texas, USA",
    iso2: "US",
    isoNum: "840",
    lat: 31.845,
    lon: -102.368,
    coordNote: "Ungefähre Lage Odessa, Texas.",
    capacityMw: {
      value: 207,
      asOf: "2026-09-30",
      sourceLabel: "Cipher Digital, Q3 2026 Business Update, 02.11.2026",
      sourceUrl: CIFR_Q3_2026,
      scope: "207 MW Total Capacity, Odessa Site Snapshot. 300 MW Barber Lake bleiben HPC und sind hier nicht eingerechnet.",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [{
      ticker: "CIFR",
      name: "Cipher Digital",
      siteHashrateEHs: cifrSiteHash,
      siteHashrateNote: null,
      companyHashrateEHs: cifrCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: {
        value: 0.028,
        asOf: "2025-12-31",
        sourceLabel: "CoinShares Bitcoin Mining Report Q1 2026",
        sourceUrl: COINSHARES,
        scope: "Odessa PPA, von CoinShares als ~2.8 c/kWh genannt. Q4-Kontext, keine exaktere Zahl.",
      },
      companyPowerNote: null,
    }],
    operatorNote: null,
    energyNote: "PPA etwa 2.8 c/kWh laut CoinShares. Die Tilde steht in der Quelle.",
    regulatoryNote: "n/a — die gelesene Stelle nennt für Odessa keine Regulierung. Firmenname seit 20.02.2026 Cipher Digital.",
    formulaTooltip: "207 MW und etwa 11.6 EH/s stehen im Q3-Update 2026. Kontrollrechnung: EH/s = MW / (J/TH) = 207 / 17.2 = 12.03 bei etwa 17.2 J/TH. Angezeigt wird die genannte Hashrate 11.6 EH/s, nicht die 12.03.",
  },
  {
    id: "et-btdr",
    name: "Äthiopien (Bitdeer)",
    region: "Äthiopien",
    iso2: "ET",
    isoNum: "231",
    lat: 9.1,
    lon: 40.5,
    coordNote: "Landesmitte. CoinShares nennt kein Werk und keine Stadt.",
    capacityMw: {
      value: 40,
      asOf: "2026-03-31",
      sourceLabel: "CoinShares Bitcoin Mining Report Q1 2026",
      sourceUrl: COINSHARES,
      scope: "40 MW Bitdeer in Äthiopien, Länderhinweis im Report, kein Primärfiling",
    },
    capacityNote: null,
    capacityRole: "developed",
    operators: [{
      ticker: "BTDR",
      name: "Bitdeer",
      siteHashrateEHs: ETHIOPIA_SITE_EH == null ? null : {
        value: ETHIOPIA_SITE_EH,
        asOf: "2026-06-30",
        sourceLabel: "Schätzung aus CoinShares Q1 2026 (40 MW) und Bitdeer Q2 2026 (15.8 J/TH)",
        sourceUrl: BTDR_Q2_2026,
        scope: `Schätzung. EH/s = MW / (J/TH) = ${ETHIOPIA_MW} / ${BTDR_FLEET_J_PER_TH} = ${ETHIOPIA_SITE_EH}. 40 MW sind der Länderhinweis im CoinShares-Report Q1 2026, keine gemessene Auslastung. 15.8 J/TH ist die durchschnittliche Miner-Effizienz im Quartal bis 30.06.2026, Konzern, nicht Äthiopien.`,
        estimateLabel: "Schätzung",
      },
      siteHashrateNote: ETHIOPIA_SITE_EH == null ? "n/a — MW oder J/TH fehlt, deshalb keine Schätzung" : null,
      companyHashrateEHs: btdrCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: btdrCompanyPower,
      companyPowerNote: null,
    }],
    operatorNote: null,
    energyNote: "Kein äthiopischer Tarif in dem Absatz. Am Betreiber steht der Konzernschnitt 44 $/MWh aus dem Q2 2026, nicht das Land.",
    regulatoryNote: "n/a — der Absatz nennt keine Regulierung.",
    formulaTooltip: `Schätzung Standort-EH/s = MW / (J/TH) = ${ETHIOPIA_MW} / ${BTDR_FLEET_J_PER_TH} = ${ETHIOPIA_SITE_EH}. 40 MW CoinShares Q1 2026, 15.8 J/TH Bitdeer Q2 2026, Konzern.`,
  },
  {
    id: "om-country",
    name: "Oman",
    region: "Oman",
    iso2: "OM",
    isoNum: "512",
    lat: 21.5,
    lon: 55.9,
    coordNote: "Landesmitte. Kein benanntes Werk.",
    capacityMw: null,
    capacityNote: "n/a — CoinShares nennt Oman unter den Top 10, ohne Prozent und ohne MW.",
    capacityRole: null,
    operators: [],
    operatorNote: "n/a — kein benannter Betreiber in der gelesenen Stelle.",
    energyNote: "n/a — kein Tarif.",
    regulatoryNote: "n/a — keine regulatorische Aussage in dem Satz.",
  },
  {
    id: "se-hive",
    name: "Schweden (HIVE)",
    region: "Schweden",
    iso2: "SE",
    isoNum: "752",
    lat: 62.0,
    lon: 15.0,
    coordNote: "Landesmitte. Die FY2026-Meldung nennt Schweden, aber keine Stadt.",
    capacityMw: null,
    capacityNote: "n/a — 440 MW operativ global über Kanada, Schweden und Paraguay. 300 MW davon Paraguay. Der Rest ist nicht auf Schweden und Kanada verteilt.",
    capacityRole: null,
    operators: [{
      ticker: "HIVE",
      name: "HIVE Digital Technologies",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — 25.1 EH/s sind der Konzern, nicht Schweden",
      companyHashrateEHs: hiveCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein schwedischer Tarif in der Meldung",
    }],
    operatorNote: null,
    energyNote: "Als green energy zusammen mit Kanada und Paraguay beschrieben, ohne schwedischen Tarif.",
    regulatoryNote: "n/a — die Meldung nennt die Regulierung der Länder mit Standorten nur pauschal, ohne Schweden-Satz.",
  },
  {
    id: "us-tx-vega",
    name: "Vega (HUT)",
    region: "Texas, ERCOT",
    iso2: "US",
    isoNum: "840",
    lat: null,
    lon: null,
    coordNote: "n/a — keine Koordinate. Die Meldung vom 30.06.2025 nennt das ERCOT-Netz und Texas als Beispiel für hohe Außentemperatur, aber keine Stadt. Kein Pin.",
    capacityMw: {
      value: 205,
      asOf: "2025-06-30",
      sourceLabel: "Hut 8, Energize Vega, 30.06.2025",
      sourceUrl: HUT_VEGA_RELEASE,
      scope: `205 MW Nameplate. Formel MW = EH/s × J/TH = ${VEGA_HASHRATE_CEILING.ehPerS} × ${VEGA_HASHRATE_CEILING.joulesPerTh} = ${VEGA_FORMULA_MW} MW ASIC-Last (1 EH/s = ${HASHRATE_MW.thPerEh} TH/s, 1 MW = ${HASHRATE_MW.wattsPerMw} W). Die Formel erklärt die bis zu 15 EH/s bei 13 J/TH und ersetzt die genannten 205 MW nicht.`,
    },
    capacityNote: null,
    capacityRole: "nameplate",
    operators: [{
      ticker: "HUT",
      name: "Hut 8",
      siteHashrateEHs: VEGA_SITE_EH == null ? null : {
        value: VEGA_SITE_EH,
        asOf: "2026-06-30",
        sourceLabel: "Schätzung aus Hut-8-Nameplate 30.06.2025 und 10-Q-Effizienz",
        sourceUrl: HUT_10Q,
        scope: `Schätzung. EH/s = Nameplate-MW / (J/TH) = 205 / ${HUT_FLEET_J_PER_TH} = ${VEGA_SITE_EH}. 205 MW Nameplate, Hut 8, 30.06.2025. Etwa 16.0 J/TH ist die Portfolio-Effizienz der American-Bitcoin-Flotte nach April 2026, nicht eine Vega-Messung. Nimmt an, die ganze Nameplate läuft mit dieser Effizienz. Bis zu 15 EH/s bei 13 J/TH bleiben eine Obergrenze und sind nicht dieser Wert.`,
        estimateLabel: "Schätzung",
      },
      siteHashrateNote: VEGA_SITE_EH == null ? "n/a — Nameplate oder J/TH fehlt, deshalb keine Schätzung" : null,
      companyHashrateEHs: hutCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: ercotHubPower("West", 37.8),
      companyPowerNote: null,
    }],
    operatorNote: null,
    energyNote: "ERCOT-Netz und Windpark hinter dem Zähler, PUE 1.06. Kein Vertragspreis in der Vega-Meldung. Am Betreiber steht der ERCOT-West-Hub August 2026 als Schätzung.",
    regulatoryNote: "n/a — die Meldung nennt keine Genehmigung über den ERCOT-Anschluss hinaus.",
    formulaTooltip: `Formel: MW = EH/s × J/TH = ${VEGA_HASHRATE_CEILING.ehPerS} × ${VEGA_HASHRATE_CEILING.joulesPerTh} = ${VEGA_FORMULA_MW} MW ASIC-Last. Nameplate bleibt 205 MW. Quelle: Hut 8, 30.06.2025. Schätzung Standort-EH/s = 205 / ${HUT_FLEET_J_PER_TH} = ${VEGA_SITE_EH}.`,
  },
  {
    id: "us-tx-barber-lake",
    name: "Barber Lake (CIFR)",
    region: "Colorado City, Texas",
    iso2: "US",
    isoNum: "840",
    lat: 32.399486,
    lon: -100.858304,
    coordNote: "Census 2025 Place internal point Colorado City city, GEOID 4816120, nicht die Parzelle. Adresse 951 County Road 204 steht im TDLR-Eintrag TABS2026023534, ohne eigene Koordinate.",
    capacityMw: {
      value: 300,
      asOf: "2024-10-31",
      sourceLabel: "Cipher Mining, Q3 2024 Update, Exhibit 99.1",
      sourceUrl: CIFR_BARBER_2024,
      scope: "300 MW bei der Übernahme, sofort verfügbar zur Energisierung, West Texas. HPC-Vertrag 25.09.2025: 168 MW Critical IT Load, maximal 244 MW brutto, Fluidstack in Colorado City. Die 168 MW ersetzen die 300 MW nicht.",
    },
    capacityNote: null,
    capacityRole: "hpc",
    operators: [],
    operatorNote: "n/a — der Vertragspartner im Exhibit vom 25.09.2025 ist Fluidstack für HPC, kein Bitcoin-Miner-Ticker.",
    energyNote: "n/a — kein Tarif. Die Meldung vom 31.10.2024 nennt 300 MW und eine Umspannstation, keinen Strompreis.",
    regulatoryNote: "TDLR-Projekt TABS2026023534, Barber Lake, 951 County Road 204, Colorado City, Mitchell County. HPC-Colocation, nicht als Mining-MW in der Perzentil-Stichprobe.",
    formulaTooltip: `300 MW sind die genannte Standortleistung vom 31.10.2024, keine Rechnung aus Hashrate. HPC-Vertrag: ${CIFR_BARBER_LEASE}. Lage der Stadt: ${CENSUS_TX_PLACES}. Adresse: ${TDLR_BARBER}.`,
  },
  {
    id: "kz-archive",
    name: "Kasachstan (Cambridge-Archiv)",
    region: "Kasachstan",
    iso2: "KZ",
    isoNum: "398",
    lat: 48.40585039153326,
    lon: 67.23568238185362,
    coordNote: "Flächenschwerpunkt aus world-atlas countries-110m, ISO 398. Keine Farm-Adresse. Schätzung / keine Primärquelle für die Lage einer Anlage.",
    capacityMw: null,
    capacityNote: "n/a — Cambridge nennt 24.79 EH/s im Januar 2022, aber keine Effizienz in J/TH. MW = EH/s × J/TH wird nicht mit einer angenommenen Effizienz gefüllt.",
    capacityRole: null,
    operators: [],
    operatorNote: "n/a — der Cambridge-Artikel nennt kein Unternehmen.",
    energyNote: "Der Artikel vom 17.05.2022 nennt Stromausfälle bis Januar 2022. Kein Tarif in USD/kWh.",
    regulatoryNote: "Der Artikel beschreibt eine Steuererhöhung und ein Vorgehen gegen nicht registrierte Miner bis Januar 2022. Kein Gesetzestext in dieser Quelle.",
    estimateLabel: "Schätzung / keine Primärquelle",
    formulaTooltip: "Schätzung / keine Primärquelle. Kasachstan Januar 2022: 24.79 EH/s, 13.22 % der globalen Hashrate. Cambridge Judge Business School, 17.05.2022. Kein Ist 2026. Keine J/TH, deshalb keine MW.",
  },
];

export function positiveSample(values: number[]): number[] {
  return values.filter(v => Number.isFinite(v) && v > 0);
}

/** Perzentilrang 0…1. Halbe Masse der Gleichstände zählt mit (kein fester MW-Schnitt). */
export function percentileRank(value: number, sample: number[]): number | null {
  const xs = positiveSample(sample).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return 0.5;
  const below = xs.filter(v => v < value).length;
  const equal = xs.filter(v => v === value).length;
  if (equal === 0) return null;
  return (below + equal * 0.5) / xs.length;
}

export function bubbleCapacitySample(sites: MinerMapSite[]): number[] {
  const out: number[] = [];
  for (const s of sites) {
    if (!s.capacityMw) continue;
    if (!s.capacityRole || !(MINER_BUBBLE_ROLES as readonly string[]).includes(s.capacityRole)) continue;
    if (s.capacityMw.value > 0) out.push(s.capacityMw.value);
  }
  return out;
}

export function bandForPercentile(percentile: number | null): MinerBubbleBand {
  if (percentile == null || !Number.isFinite(percentile)) return "n/a";
  if (percentile < MINER_MAP_TERTILE.lowMax) return "low";
  if (percentile < MINER_MAP_TERTILE.midMax) return "mid";
  return "high";
}

export function bubbleForCapacity(value: number | null, role: MinerCapacityRole | null, sample: number[]): MinerMapBubble {
  const inSample = value != null && value > 0 && role != null && (MINER_BUBBLE_ROLES as readonly string[]).includes(role);
  if (!inSample || value == null) {
    return {
      radiusPx: null,
      percentile: null,
      band: "n/a",
      color: MINER_BUBBLE_COLOR.na,
      note: "n/a — keine MW in der Perzentil-Stichprobe (fehlt, geplant oder nicht positiv)",
    };
  }
  const percentile = percentileRank(value, sample);
  const band = bandForPercentile(percentile);
  const radiusPx = percentile == null
    ? null
    : MINER_MAP_RADIUS.minPx + percentile * (MINER_MAP_RADIUS.maxPx - MINER_MAP_RADIUS.minPx);
  return {
    radiusPx,
    percentile,
    band,
    color: MINER_BUBBLE_COLOR[band === "n/a" ? "na" : band],
    note: null,
  };
}

export function siteHasFigure(site: MinerMapSite): boolean {
  if (site.capacityMw) return true;
  return site.operators.some(o => o.siteHashrateEHs != null || o.companyHashrateEHs != null || o.companyPowerUsdPerKwh != null);
}

function siteHasMw(site: MinerMapSite): boolean {
  return site.capacityMw != null && site.capacityMw.value > 0;
}

function siteHasSiteEhs(site: MinerMapSite): boolean {
  return site.operators.some(o => o.siteHashrateEHs != null && o.siteHashrateEHs.value > 0);
}

function siteHasCompanyEhs(site: MinerMapSite): boolean {
  return site.operators.some(o => o.companyHashrateEHs != null && o.companyHashrateEHs.value > 0);
}

/** MW und EH/s getrennt. Konzern-EH/s ist nicht die Standort-Hashrate. Fehlendes bleibt 0 in der Zählung, kein Ersatzwert. */
export function minerCoverage(sites: MinerMapSite[]): MinerMapResponse["coverage"] {
  return {
    total: sites.length,
    withMw: sites.filter(siteHasMw).length,
    withSiteEhs: sites.filter(siteHasSiteEhs).length,
    withCompanyEhs: sites.filter(siteHasCompanyEhs).length,
  };
}

export function formatMinerCoverage(coverage: MinerMapResponse["coverage"]): string {
  return `${coverage.withMw}/${coverage.total} mit MW · ${coverage.withSiteEhs}/${coverage.total} mit Standort-EH/s · ${coverage.withCompanyEhs}/${coverage.total} mit Konzern-EH/s`;
}

export interface MarkerPixel {
  id: string;
  x: number;
  y: number;
  radiusPx: number;
}

export interface MarkerPixelOffset {
  id: string;
  dx: number;
  dy: number;
}

/**
 * Trennt überlappende Marker in der Pixelebene der Kartenprojektion.
 * Zielabstand ist die Summe der gezeichneten Radien. Der Versatz ist die
 * fehlende Pixeldistanz. Ein größerer Projektionsmaßstab vergrößert die
 * Pixeldistanz und verkleinert den Versatz. Kein fester Grad- oder Pixel-Schritt.
 */
export function spreadMarkerOffsets(points: MarkerPixel[]): MarkerPixelOffset[] {
  const n = points.length;
  const pos = points.map(p => ({ x: p.x, y: p.y, r: p.radiusPx }));
  const sweeps = n * n;
  for (let pass = 0; pass < sweeps; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dist = Math.hypot(dx, dy);
        const need = pos[i].r + pos[j].r;
        if (!(dist < need)) continue;
        if (need - dist <= Number.EPSILON * need * Math.max(n, 1)) continue;
        const coincident = dist === 0;
        const angle = (2 * Math.PI * (j - i)) / n;
        const ux = coincident ? Math.cos(angle) : dx / dist;
        const uy = coincident ? Math.sin(angle) : dy / dist;
        const push = coincident ? need / 2 : (need - dist) / 2;
        pos[i].x -= ux * push;
        pos[i].y -= uy * push;
        pos[j].x += ux * push;
        pos[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return points.map((p, i) => ({
    id: p.id,
    dx: pos[i].x - p.x,
    dy: pos[i].y - p.y,
  }));
}

export function decorateMinerSites(sites: MinerMapSite[]): (MinerMapSite & { bubble: MinerMapBubble })[] {
  const sample = bubbleCapacitySample(sites);
  return sites.map(s => ({
    ...s,
    bubble: bubbleForCapacity(s.capacityMw?.value ?? null, s.capacityRole, sample),
  }));
}

export function emptyPipeline(unavailableNote: string): MinerMapPipeline {
  return {
    networkHashrateEH: null,
    networkHashrateNote: "n/a — " + unavailableNote,
    hashpriceBtcPerThDay: null,
    hashpriceNote: "n/a — " + unavailableNote,
    hashpriceUsdPerThDay: null,
    hashpriceUsdNote: "n/a — Hashprice der Pipeline ist BTC je TH und Tag. Ein USD-Wert bräuchte einen Spot, den dieser GET nicht lädt.",
    hashpriceUsdFormula: null,
    btcSpotUsd: null,
    btcSpotNote: null,
    breakevenUsd: null,
    breakevenNote: "n/a — " + unavailableNote,
    puellMultiple: null,
    puellNote: "n/a — Puell braucht die Preis-Historie von POST /api/btc-miner. Der Karten-GET lädt sie nicht.",
    hashrateSource: null,
    lastUpdated: null,
    stale: false,
    unavailableNote: "n/a — " + unavailableNote,
  };
}

export function pipelineFromMiner(input: {
  currentHashrateEH?: number | null;
  hashprice?: number | null;
  breakevenPrice?: number | null;
  puellMultiple?: number | null;
  hashrateSource?: string | null;
  lastUpdated?: string | null;
  stale?: boolean;
} | null, unavailableNote: string | null): MinerMapPipeline {
  if (!input) return emptyPipeline(unavailableNote ?? "Miner-Pipeline ohne Daten");
  const positive = (n: number | null | undefined): number | null =>
    n != null && Number.isFinite(n) && n > 0 ? n : null;
  const hashrate = positive(input.currentHashrateEH);
  const hashprice = positive(input.hashprice);
  const breakeven = positive(input.breakevenPrice);
  const puell = input.puellMultiple != null && Number.isFinite(input.puellMultiple) ? input.puellMultiple : null;
  const base = emptyPipeline(unavailableNote ?? "Miner-Pipeline ohne positive Zahl");
  return {
    ...base,
    networkHashrateEH: hashrate,
    networkHashrateNote: hashrate == null ? base.networkHashrateNote : null,
    hashpriceBtcPerThDay: hashprice,
    hashpriceNote: hashprice == null ? base.hashpriceNote : null,
    breakevenUsd: breakeven,
    breakevenNote: breakeven == null ? base.breakevenNote : null,
    puellMultiple: puell,
    puellNote: puell == null ? base.puellNote : null,
    hashrateSource: input.hashrateSource ?? null,
    lastUpdated: input.lastUpdated ?? null,
    stale: input.stale === true,
    unavailableNote: hashrate == null && hashprice == null && breakeven == null
      ? base.unavailableNote
      : null,
  };
}

export interface BtcSpotQuote {
  usd: number;
  asOf: string;
  sourceLabel: string;
  sourceUrl: string;
}

/** USD/TH/Tag = BTC/TH/Tag × Spot der bestehenden Preis-Pipeline. */
export function applyHashpriceUsd(pipeline: MinerMapPipeline, spot: BtcSpotQuote | null): MinerMapPipeline {
  const spotUsd = spot != null && Number.isFinite(spot.usd) && spot.usd > 0 ? spot.usd : null;
  const btc = pipeline.hashpriceBtcPerThDay;
  if (spotUsd == null) {
    return {
      ...pipeline,
      btcSpotUsd: null,
      btcSpotNote: "n/a — BTC-Spot der Preis-Pipeline nicht geladen (CoinGecko simple/price, sonst Blockchain.com Ticker).",
      hashpriceUsdFormula: null,
      hashpriceUsdPerThDay: null,
      hashpriceUsdNote: btc == null
        ? pipeline.hashpriceUsdNote
        : "n/a — Hashprice in BTC/TH/Tag liegt vor, der BTC-Spot der Preis-Pipeline nicht.",
    };
  }
  if (btc == null) {
    return {
      ...pipeline,
      btcSpotUsd: spotUsd,
      btcSpotNote: null,
      hashpriceUsdPerThDay: null,
      hashpriceUsdFormula: null,
      hashpriceUsdNote: "n/a — Hashprice in BTC/TH/Tag fehlt, deshalb kein Produkt mit dem BTC-Spot.",
    };
  }
  const usd = btc * spotUsd;
  return {
    ...pipeline,
    btcSpotUsd: spotUsd,
    btcSpotNote: null,
    hashpriceUsdPerThDay: usd,
    hashpriceUsdNote: null,
    hashpriceUsdFormula: `USD/TH/Tag = BTC/TH/Tag × Spot = ${btc} × ${spotUsd} USD. Spot: ${spot?.sourceLabel ?? ""}, ${spot?.asOf ?? ""}.`,
  };
}

export function buildMinerMapBody(pipeline: MinerMapPipeline, asOf = new Date().toISOString()): MinerMapResponse {
  const sites = decorateMinerSites(MINER_MAP_SITES);
  return {
    layer: "miner",
    asOf,
    source: "SEC-Filings, Unternehmensmeldungen, CoinShares-Report (kostenlos), Hashrate Index, ERCOT IMM, Live-Kontext aus server/btc-miner.ts, BTC-Spot aus der Preis-Pipeline (CoinGecko simple/price)",
    attribution: `Länderanteil: Schätzung / keine Primärquelle, Cambridge-Archiv Januar 2022 (${CAMBRIDGE_ARCHIVE_URL}), nicht Ist 2026. China aktuell: ${HASHRATE_INDEX_CHINA_Q4.sourceLabel} (${HASHRATE_INDEX_CHINA_Q4.sourceUrl}). Die Karte ${CAMBRIDGE} wird nicht als aktueller Abruf verwendet. Standorte ohne Koordinate bleiben ohne Pin.`,
    coverage: minerCoverage(sites),
    sites,
    pipeline,
    countryShareNote: `${MINER_MAP_COUNTRY_SHARE_NOTE} ${HASHRATE_INDEX_CHINA_Q4.note}`,
    countryShares: [...CAMBRIDGE_ARCHIVE_SHARES, HASHRATE_INDEX_CHINA_Q4],
    gaps: MINER_MAP_GAPS,
  };
}
