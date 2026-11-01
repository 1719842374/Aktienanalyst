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

export type MinerCapacityRole = (typeof MINER_BUBBLE_ROLES)[number] | "planned";

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
  lat: number;
  lon: number;
  coordNote: string;
  capacityMw: SourcedNumber | null;
  capacityNote: string | null;
  capacityRole: MinerCapacityRole | null;
  operators: MinerMapOperator[];
  /** Leer nur wenn kein Betreiber in der Quelle steht; dann operatorNote. */
  operatorNote: string | null;
  energyNote: string;
  regulatoryNote: string;
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

export const MINER_MAP_COUNTRY_SHARE_NOTE =
  "n/a — Cambridge Mining Map zeigt öffentlich zuletzt Januar 2022 und liefert keine freie aktuelle Länderquote. Der Stand 2022 wird nicht als Anteil 2026 angezeigt.";

export const MINER_MAP_GAPS: MinerMapGap[] = [
  {
    id: "kz",
    label: "Kasachstan",
    note: "n/a — keine freie Quelle mit aktueller MW- oder Hashrate-Zahl. Die Cambridge-Karte endet öffentlich im Januar 2022 und wird nicht fortgeschrieben.",
  },
  {
    id: "hut-vega",
    label: "HUT Vega",
    note: "n/a — CoinShares nennt 14.86 EH/s an Bitmain-Minern der Vega-Site im Q4-Kontext, aber keinen Ort. Ohne Lage kein Pin.",
  },
  {
    id: "cifr-barber",
    label: "CIFR Barber Lake",
    note: "n/a — CoinShares nennt 300 MW in Entwicklung für HPC, Umsatz noch nicht begonnen. Nicht als Mining-Betrieb gepinnt.",
  },
];

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
      siteHashrateNote: "n/a — FY26: Mining-Hardware wird abgebaut, Umstellung auf AI bis 31.12.2026 angestrebt. Historische 40.1 EH/s per 30.06.2025 werden nicht als Ist gezeigt.",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine aktuelle EH/s-Zahl in der gelesenen FY26-Meldung",
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh. Strom über BC Hydro, regulierter Tarif.",
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
      siteHashrateNote: "n/a — keine standortscharfe EH/s. Mining-Abbau bis Ende 2026 angestrebt.",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine aktuelle EH/s-Zahl in der gelesenen FY26-Meldung",
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh. Strom über BC Hydro.",
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
      siteHashrateNote: "n/a — keine standortscharfe EH/s. GPU-Finanzierung am Standort ist AI, nicht Hashrate.",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine aktuelle EH/s-Zahl in der gelesenen FY26-Meldung",
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh. Strom über BC Hydro.",
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
      siteHashrateNote: "n/a — FY26-Bericht: Mining-Hardware wird abgebaut. 40.1 EH/s per 30.06.2025 sind historisch und nicht als Ist übernommen.",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine aktuelle EH/s-Zahl in der gelesenen FY26-Meldung",
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein USD/kWh. Bezug über ERCOT-Wholesale, RECs bis 30.06.2026.",
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
      siteHashrateNote: "n/a — keine EH/s. Standort ist als Development beschrieben.",
      companyHashrateEHs: maraCompanyHash,
      companyHashrateNote: null,
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein Strompreis. Konzern „1.9 GW energized“ auf der Startseite ist nicht dieser Site zugeordnet.",
    }],
    operatorNote: null,
    energyNote: "n/a — kein Tarif. Erwarteter Netzanschluss, nicht energisiert in der gelesenen Stelle.",
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
    capacityMw: null,
    capacityNote: "n/a — CoinShares nennt den Odessa-PPA, aber keine MW. 300 MW Barber Lake sind HPC in Entwicklung und hier nicht eingerechnet.",
    capacityRole: null,
    operators: [{
      ticker: "CIFR",
      name: "Cipher Digital",
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — keine EH/s für Odessa in der gelesenen Stelle",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine aktuelle EH/s in der gelesenen CoinShares-Stelle",
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
      siteHashrateEHs: null,
      siteHashrateNote: "n/a — der Report nennt 40 MW, keine EH/s für Äthiopien",
      companyHashrateEHs: null,
      companyHashrateNote: "n/a — keine Konzern-EH/s in dem gelesenen Absatz",
      companyPowerUsdPerKwh: null,
      companyPowerNote: "n/a — kein äthiopischer Tarif. Konzernstrom 46 $/MWh im Q4-Absatz ist nicht diesem Land zugeordnet.",
    }],
    operatorNote: null,
    energyNote: "n/a — kein Tarif für das Land in dem Absatz.",
    regulatoryNote: "n/a — der Absatz nennt keine Regulierung.",
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

export function buildMinerMapBody(pipeline: MinerMapPipeline, asOf = new Date().toISOString()): MinerMapResponse {
  const sites = decorateMinerSites(MINER_MAP_SITES);
  return {
    layer: "miner",
    asOf,
    source: "SEC-Filings, Unternehmensmeldungen, CoinShares-Report (kostenlos), Live-Kontext aus server/btc-miner.ts",
    attribution: `Länderanteil: ${CAMBRIDGE} (zuletzt öffentlich Jan 2022, hier nicht als Ist verwendet). Standorte nicht geschätzt.`,
    coverage: minerCoverage(sites),
    sites,
    pipeline,
    countryShareNote: MINER_MAP_COUNTRY_SHARE_NOTE,
    gaps: MINER_MAP_GAPS,
  };
}
