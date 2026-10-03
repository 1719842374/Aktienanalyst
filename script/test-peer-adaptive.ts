/**
 * Offen_WORK_PEER_ADAPTIVE.md — 2-Hop-Peer-Set.
 *
 * Ausführen: npx tsx script/test-peer-adaptive.ts
 * Keine echten FMP-Calls. fetchPeers/fetchProfile/search sind injiziert.
 */
import { curatedPeerFallbackSubjects, filterAndSelectPeers, PEER_COMPARE_CAP } from "../server/news-peers";
import {
  PEER_2HOP_TTL_MS,
  PEER_HOP_COUNT,
  PEER_TAKE,
  descriptionTokens,
  loadPeerHops,
  peer2HopCacheKey,
  resolveAdaptivePeers,
  selectAdaptivePeerSet,
  type AdaptiveCandidateProfile,
  type PeerHopCacheEntry,
} from "../server/peer-adaptive";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const DRUG = "Drug Manufacturers - General";
const HEALTH = "Healthcare";
const AUTO = "Auto - Manufacturers";
const CYCLICAL = "Consumer Cyclical";
const LUXURY = "Luxury Goods";

function profile(
  ticker: string,
  industry: string,
  sector: string,
  marketCap: number | null,
  description = "",
  segmentNames: string[] = [],
): AdaptiveCandidateProfile {
  return { ticker, sector, industry, marketCap, description, segmentNames };
}

const pharmaCaps: Record<string, number> = {
  NVO: 400e9,
  PFE: 150e9,
  SNY: 120e9,
  LLY: 700e9,
  ABBV: 300e9,
};

console.log("\n=== DoD 1: CURATED_PEER_FALLBACK wächst nicht, keine NVO-Zeile ===");
{
  const subjects = curatedPeerFallbackSubjects();
  check("Subjekte bleiben die fünf Auto/NEV-Notnägel", JSON.stringify([...subjects].sort()) === JSON.stringify(["BYDDY", "GELYF", "LI", "NIO", "XPEV"]));
  check("NVO-Zeile verboten", !subjects.includes("NVO"));
}

console.log("\n=== Tokens (E3, lokal, Länge ≥ 5, Stopwords) ===");
{
  const tokens = descriptionTokens("The Company Inc Group GLP-1 semaglutide diabetes obesity care");
  check("semaglutide bleibt", tokens.includes("semaglutide"));
  check("diabetes bleibt", tokens.includes("diabetes"));
  check("obesity bleibt", tokens.includes("obesity"));
  check("GLP-1 bleibt als Token Länge 5", tokens.includes("glp-1"));
  check("Stopword company fällt", !tokens.includes("company"));
  check("Stopword group fällt", !tokens.includes("group"));
  check("Kurz-Token care fällt", !tokens.includes("care"));
  check("Stopword the fällt", !tokens.includes("the"));
  check("Stopword inc fällt", !tokens.includes("inc"));
}

console.log("\n=== DoD 2: NVO-Graph Seeds {PFE,SNY}, PFE-Peers ⊃ {LLY} ⇒ LLY in F ===");
{
  const selected = selectAdaptivePeerSet({
    subject: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: pharmaCaps.NVO,
    subjectDescription: "Novo Nordisk develops GLP-1 semaglutide therapies for diabetes and obesity.",
    subjectSegmentNames: ["Diabetes and Obesity Care"],
    seeds: ["PFE", "SNY", "ABBV"],
    hopBySeed: {
      PFE: ["LLY", "MRK", "BMY"],
      SNY: ["AZN", "NVS"],
    },
    profiles: [
      profile("PFE", DRUG, HEALTH, pharmaCaps.PFE, "Pfizer biopharmaceutical group"),
      profile("SNY", DRUG, HEALTH, pharmaCaps.SNY, "Sanofi pharmaceutical company"),
      profile("ABBV", DRUG, HEALTH, pharmaCaps.ABBV, "AbbVie immunology"),
      profile("LLY", DRUG, HEALTH, pharmaCaps.LLY, "Eli Lilly GLP-1 obesity and diabetes medicines including semaglutide-class incretins."),
      profile("MRK", DRUG, HEALTH, 250e9, "Merck oncology"),
      profile("BMY", DRUG, HEALTH, 100e9, "Bristol Myers"),
      profile("AZN", DRUG, HEALTH, 200e9, "AstraZeneca"),
      profile("NVS", DRUG, HEALTH, 220e9, "Novartis"),
    ],
  });
  check("LLY ist in F", selected.includes("LLY"), JSON.stringify(selected));
  check("Subjekt NVO ist nicht in F", !selected.includes("NVO"), JSON.stringify(selected));
  check("F nimmt höchstens 5", selected.length <= PEER_TAKE && selected.length === 5, JSON.stringify(selected));
  check("Take-Konstante ist 5", PEER_TAKE === 5);
}

console.log("\n=== DoD 3: BYDDY + CFR im 2-Hop ⇒ CFR fliegt in D ===");
{
  const selected = selectAdaptivePeerSet({
    subject: "BYDDY",
    subjectSector: CYCLICAL,
    subjectIndustry: AUTO,
    subjectMarketCap: 100e9,
    subjectDescription: "BYD builds electric vehicles.",
    seeds: ["PFE"],
    hopBySeed: {
      PFE: ["CFR", "TSLA", "NIO"],
    },
    profiles: [
      profile("PFE", DRUG, HEALTH, 150e9, "Pfizer"),
      profile("CFR", LUXURY, CYCLICAL, 80e9, "Richemont luxury goods watches"),
      profile("TSLA", AUTO, CYCLICAL, 800e9, "Tesla electric vehicles"),
      profile("NIO", AUTO, CYCLICAL, 12e9, "NIO electric vehicles"),
    ],
  });
  check("CFR ist nicht in F", !selected.includes("CFR"), JSON.stringify(selected));
  check("TSLA bleibt (Auto, Cap-Band)", selected.includes("TSLA"), JSON.stringify(selected));
  check("PFE fällt (Industry)", !selected.includes("PFE"), JSON.stringify(selected));
}

console.log("\n=== Rang: exact industry, dann |log Cap|, dann Token-Überlapp ===");
{
  const selected = selectAdaptivePeerSet({
    subject: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: 400e9,
    subjectDescription: "semaglutide diabetes obesity",
    seeds: ["FAR", "NEAR", "SECT", "TIEA", "TIEB"],
    hopBySeed: {},
    profiles: [
      profile("SECT", "Medical Devices", HEALTH, 400e9, "unrelated devices"),
      profile("FAR", DRUG, HEALTH, 40e9, "plain pharma"),
      profile("NEAR", DRUG, HEALTH, 200e9, "plain pharma"),
      profile("TIEA", DRUG, HEALTH, 200e9, "plain pharma company"),
      profile("TIEB", DRUG, HEALTH, 800e9, "semaglutide diabetes obesity franchise"),
    ],
    maxPeers: 5,
  });
  const exact = selected.filter(t => t !== "SECT");
  check("Sektor-only steht hinter exact industry", selected.indexOf("SECT") > selected.indexOf("NEAR"), JSON.stringify(selected));
  check("Näherer Cap (NEAR) vor fernerem Cap (FAR)", selected.indexOf("NEAR") < selected.indexOf("FAR"), JSON.stringify(selected));
  check("Bei gleichem Cap-Abstand gewinnt Token-Überlapp (TIEB vor TIEA)", selected.indexOf("TIEB") < selected.indexOf("TIEA"), JSON.stringify(selected));
  check("Rang liefert nur Überlebende", exact.length >= 4, JSON.stringify(selected));
}

console.log("\n=== Cap-Band 5% … 20× wirft Micro und Riesen raus ===");
{
  const selected = selectAdaptivePeerSet({
    subject: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: 400e9,
    seeds: ["OK", "TINY", "HUGE", "EDGE"],
    hopBySeed: {},
    profiles: [
      profile("OK", DRUG, HEALTH, 100e9),
      profile("TINY", DRUG, HEALTH, 400e9 * 0.04),
      profile("HUGE", DRUG, HEALTH, 400e9 * 21),
      profile("EDGE", DRUG, HEALTH, 400e9 * 0.05),
    ],
  });
  check("OK bleibt", selected.includes("OK"), JSON.stringify(selected));
  check("5%-Kante bleibt", selected.includes("EDGE"), JSON.stringify(selected));
  check("unter 5% fliegt", !selected.includes("TINY"), JSON.stringify(selected));
  check("über 20× fliegt", !selected.includes("HUGE"), JSON.stringify(selected));
}

console.log("\n=== Kuratierte Map nur als leerer Notnagel ===");
{
  const empty = selectAdaptivePeerSet({
    subject: "BYDDY",
    subjectSector: CYCLICAL,
    subjectIndustry: AUTO,
    subjectMarketCap: 100e9,
    seeds: ["CFR"],
    hopBySeed: {},
    profiles: [profile("CFR", LUXURY, CYCLICAL, 80e9)],
    curatedFallback: ["TSLA", "NIO", "LI", "XPEV", "GELYF"],
  });
  check("Leeres F fällt auf die bestehende BYDDY-Liste zurück", empty.includes("TSLA") && empty[0] === "TSLA", JSON.stringify(empty));

  const filled = selectAdaptivePeerSet({
    subject: "BYDDY",
    subjectSector: CYCLICAL,
    subjectIndustry: AUTO,
    subjectMarketCap: 100e9,
    seeds: ["BAMXF"],
    hopBySeed: {},
    profiles: [profile("BAMXF", AUTO, CYCLICAL, 60e9, "BMW vehicles")],
    curatedFallback: ["TSLA", "NIO", "LI", "XPEV", "GELYF"],
  });
  check("Industry-Treffer verdrängt die Map nicht", filled.includes("BAMXF") && !filled.includes("TSLA"), JSON.stringify(filled));
}

console.log("\n=== DoD 5: LLM-Output ∩ F = ∅, außer Search+D ===");
{
  const blocked = selectAdaptivePeerSet({
    subject: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: 400e9,
    seeds: ["PFE"],
    hopBySeed: { PFE: ["ABBV"] },
    profiles: [
      profile("PFE", DRUG, HEALTH, 150e9),
      profile("ABBV", DRUG, HEALTH, 300e9),
      profile("LLY", DRUG, HEALTH, 700e9, "Eli Lilly"),
    ],
    llmSymbols: ["LLY", "FAKE"],
  });
  check("Rohes LLM-Symbol LLY kommt nicht in F", !blocked.includes("LLY"), JSON.stringify(blocked));
  check("Rohes LLM-Symbol FAKE kommt nicht in F", !blocked.includes("FAKE"), JSON.stringify(blocked));
  check("Graph-Peer PFE bleibt", blocked.includes("PFE"), JSON.stringify(blocked));

  const admitted = selectAdaptivePeerSet({
    subject: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: 400e9,
    seeds: ["PFE"],
    hopBySeed: {},
    profiles: [
      profile("PFE", DRUG, HEALTH, 150e9),
      profile("LLY", DRUG, HEALTH, 700e9, "Eli Lilly semaglutide"),
      profile("CFR", LUXURY, CYCLICAL, 80e9, "Richemont"),
    ],
    llmSymbols: ["LLY", "CFR"],
    searchedCompetition: [
      { name: "Eli Lilly", symbol: "LLY" },
      { name: "Richemont", symbol: "CFR" },
    ],
  });
  check("Search+D lässt LLY in F", admitted.includes("LLY"), JSON.stringify(admitted));
  check("Search ohne Industry-Filter lässt CFR nicht in F", !admitted.includes("CFR"), JSON.stringify(admitted));
}

console.log("\n=== DoD 4: ohne frischen 2-Hop-Nachladezwang keine +5 Calls ===");
{
  const seeds = ["PFE", "SNY", "ABBV", "MRK", "AZN", "BMY"];
  let calls: string[] = [];
  const memory = new Map<string, PeerHopCacheEntry>();
  const now = 1_700_000_000_000;

  const cold = await loadPeerHops("NVO", seeds, {
    now,
    readCache: (key) => memory.get(key) ?? null,
    writeCache: (key, entry) => { memory.set(key, entry); },
    fetchPeers: async (ticker) => {
      calls.push(ticker);
      if (ticker === "PFE") return ["LLY", "NVO"];
      return ["X" + ticker];
    },
  });
  check("Kalter Cache hoppt genau die Top 5, nicht den 6. Seed", calls.length === PEER_HOP_COUNT && JSON.stringify(calls) === JSON.stringify(["PFE", "SNY", "ABBV", "MRK", "AZN"]), JSON.stringify(calls));
  check("Hop-Limit ist 5", PEER_HOP_COUNT === 5);
  check("Subjekt wird nicht gehoppt", !calls.includes("NVO"));
  check("Cache-Key ist peers2hop:{TICKER}", peer2HopCacheKey("nvo") === "peers2hop:NVO");
  check("TTL ist 7 Tage, nicht 1 Tag", PEER_2HOP_TTL_MS === 7 * 24 * 60 * 60 * 1000);
  check("PFE-Hop enthält LLY", cold.bySeed.PFE?.includes("LLY") === true, JSON.stringify(cold.bySeed));

  calls = [];
  const hot = await loadPeerHops("NVO", seeds, {
    now: now + 60_000,
    readCache: (key) => memory.get(key) ?? null,
    writeCache: (key, entry) => { memory.set(key, entry); },
    fetchPeers: async (ticker) => {
      calls.push(ticker);
      return [];
    },
  });
  check("In der heißen Minute (Cache < 7d) keine +5 Calls", calls.length === 0 && hot.hopCalls === 0, JSON.stringify(calls));
  check("Warmer Cache behält LLY aus PFE", hot.bySeed.PFE?.includes("LLY") === true);

  calls = [];
  const stale = await loadPeerHops("NVO", seeds, {
    now: now + PEER_2HOP_TTL_MS + 1,
    readCache: (key) => memory.get(key) ?? null,
    writeCache: (key, entry) => { memory.set(key, entry); },
    fetchPeers: async (ticker) => {
      calls.push(ticker);
      return ["Y" + ticker];
    },
  });
  check("Älter als 7 Tage: wieder genau 5 Calls", stale.hopCalls === 5 && calls.length === 5, JSON.stringify(calls));
}

console.log("\n=== resolve: Bundle-Seeds werden nicht noch einmal geholt; LLY aus PFE-Hop ===");
{
  const fetched: string[] = [];
  const selected = await resolveAdaptivePeers({
    subjectTicker: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: pharmaCaps.NVO,
    subjectDescription: "GLP-1 semaglutide diabetes obesity",
    rawPeerTickers: ["PFE", "SNY"],
    maxPeers: 5,
    fetchPeers: async (ticker) => {
      fetched.push(ticker);
      if (ticker === "PFE") return ["LLY", "MRK"];
      if (ticker === "SNY") return ["AZN"];
      return [];
    },
    fetchProfile: async (ticker) => {
      const caps: Record<string, number> = { PFE: 150e9, SNY: 120e9, LLY: 700e9, MRK: 250e9, AZN: 200e9 };
      if (!(ticker in caps)) return null;
      return profile(ticker, DRUG, HEALTH, caps[ticker], ticker === "LLY" ? "semaglutide diabetes obesity" : "pharma");
    },
    readHopCache: () => null,
    writeHopCache: () => {},
    searchTicker: async () => [],
  });
  check("fmpPeers(S) wird nicht wiederholt", !fetched.includes("NVO"), JSON.stringify(fetched));
  check("Nur die Seeds werden gehoppt", JSON.stringify(fetched) === JSON.stringify(["PFE", "SNY"]), JSON.stringify(fetched));
  check("Resolve-F enthält LLY", selected.includes("LLY"), JSON.stringify(selected));
}

console.log("\n=== resolve: warmer Cache unterdrückt die Hop-Calls, F kommt aus dem Cache ===");
{
  const fetched: string[] = [];
  const selected = await resolveAdaptivePeers({
    subjectTicker: "NVO",
    subjectSector: HEALTH,
    subjectIndustry: DRUG,
    subjectMarketCap: pharmaCaps.NVO,
    rawPeerTickers: ["PFE", "SNY"],
    fetchPeers: async (ticker) => {
      fetched.push(ticker);
      return [];
    },
    fetchProfile: async (ticker) => {
      const caps: Record<string, number> = { PFE: 150e9, SNY: 120e9, LLY: 700e9 };
      if (!(ticker in caps)) return null;
      return profile(ticker, DRUG, HEALTH, caps[ticker]);
    },
    readHopCache: () => ({
      bySeed: { PFE: ["LLY"], SNY: ["AZN"] },
      fetchedAt: Date.now(),
    }),
    writeHopCache: () => {},
  });
  check("Warmer Resolve-Cache: 0 Hop-Calls", fetched.length === 0, JSON.stringify(fetched));
  check("LLY aus dem Cache ist in F", selected.includes("LLY"), JSON.stringify(selected));
}

console.log("\n=== filterAndSelectPeers delegiert an den 2-Hop, nicht an die Map ===");
{
  const fetched: string[] = [];
  const selected = await filterAndSelectPeers("NVO", HEALTH, DRUG, ["PFE", "SNY"], 5, {
    subjectMarketCap: pharmaCaps.NVO,
    subjectDescription: "semaglutide diabetes obesity",
    fetchPeers: async (ticker) => {
      fetched.push(ticker);
      return ticker === "PFE" ? ["LLY"] : [];
    },
    fetchProfile: async (ticker) => {
      const caps: Record<string, number> = { PFE: 150e9, SNY: 120e9, LLY: 700e9 };
      if (!(ticker in caps)) return null;
      return profile(ticker, DRUG, HEALTH, caps[ticker], ticker === "LLY" ? "semaglutide diabetes obesity" : "pharma");
    },
    readHopCache: () => null,
    writeHopCache: () => {},
  });
  check("Einstieg hoppt PFE und SNY", JSON.stringify(fetched) === JSON.stringify(["PFE", "SNY"]), JSON.stringify(fetched));
  check("Einstieg findet LLY ohne NVO-Map", selected.includes("LLY"), JSON.stringify(selected));
  check("NVO bleibt aus der kuratierten Map", !curatedPeerFallbackSubjects().includes("NVO"));
}

console.log("\n=== Peer-Tabelle behält Override-Breite 8 ===");
{
  check("Vergleichstabelle kappt nicht unter dem Override-Maximum 8", PEER_COMPARE_CAP === 8);
}

console.log(failed === 0 ? "\n✅ Peer-Adaptive-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
