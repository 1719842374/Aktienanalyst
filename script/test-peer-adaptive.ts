/**
 * Offen_WORK_PEER_ADAPTIVE.md — 2-Hop-Peer-Set.
 *
 * DoD:
 *  1. CURATED_PEER_FALLBACK wächst nicht. Keine NVO-Zeile.
 *  2. NVO-Graph: Seeds {PFE,SNY}, PFE-Peers ⊃ {LLY} ⇒ LLY in F.
 *  3. BYDDY + CFR im 2-Hop ⇒ CFR fällt in D.
 *  4. Frischer peers2hop-Cache: keine +5 Calls in der heißen Minute.
 *     Fehlender oder >7 Tage alter Eintrag: Hops laufen einmal.
 *  5. LLM-Symbole ∩ F = ∅, außer sie kamen über Search und bestehen D.
 *
 * Ausführen: npx tsx script/test-peer-adaptive.ts
 */
import { applyPeerOverrides } from "../server/peer-cache-key";
import { CURATED_PEER_FALLBACK } from "../server/news-peers";
import {
  diskResearcherDelete,
  diskResearcherGetWithTtl,
  diskResearcherSet,
} from "../server/disk-cache";
import {
  PEERS_2HOP_TTL_MS,
  adaptiveProfileFromFmp,
  buildPeerSetF,
  clearPeerHopMemoryForTests,
  loadPeerHopSymbols,
  peerTokens,
  peers2HopCacheKey,
  resolveAdaptivePeerTickers,
  tokenOverlap,
  type AdaptivePeerProfile,
  type HopCacheRow,
} from "../server/peer-adaptive";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const DAY = 24 * 60 * 60 * 1000;

function drug(symbol: string, marketCap: number, description: string, segmentNames: string[] = []): AdaptivePeerProfile {
  return {
    symbol,
    sector: "Healthcare",
    industry: "Drug Manufacturers - General",
    marketCap,
    description,
    segmentNames,
  };
}

function auto(symbol: string, marketCap: number, description = "electric vehicles"): AdaptivePeerProfile {
  return {
    symbol,
    sector: "Consumer Cyclical",
    industry: "Auto - Manufacturers",
    marketCap,
    description,
    segmentNames: [],
  };
}

console.log("\n=== DoD 1: kuratierte Map wächst nicht, keine NVO-Zeile ===");
{
  const keys = Object.keys(CURATED_PEER_FALLBACK).sort();
  check("Keys bleiben BYDDY, GELYF, LI, NIO, XPEV", keys.join(",") === "BYDDY,GELYF,LI,NIO,XPEV", keys.join(","));
  check("keine NVO-Zeile", !Object.prototype.hasOwnProperty.call(CURATED_PEER_FALLBACK, "NVO"));
  check(
    "BYDDY-Liste unverändert",
    JSON.stringify(CURATED_PEER_FALLBACK.BYDDY) === JSON.stringify(["TSLA", "NIO", "LI", "XPEV", "GELYF"]),
    JSON.stringify(CURATED_PEER_FALLBACK.BYDDY),
  );
  const values = Object.values(CURATED_PEER_FALLBACK).flat();
  check("NVO steht auch nicht als kuratierter Peer", !values.includes("NVO"));
}

console.log("\n=== Tokens: Beschreibung ∩ Segmente, Stopwords, Länge ≥ 5 ===");
{
  const nvo = peerTokens("GLP-1 / semaglutide / diabetes / obesity", ["Obesity Care", "Incretin Franchise"]);
  const lly = peerTokens("GLP-1 therapies for diabetes and obesity, semaglutide class", ["Incretin"]);
  check("GLP-1 bleibt ein Token (Länge 5)", nvo.has("glp-1") && lly.has("glp-1"));
  check("semaglutide, diabetes, obesity treffen sich", ["semaglutide", "diabetes", "obesity"].every(t => nvo.has(t) && lly.has(t)));
  check("Segmentname Incretin zählt mit", nvo.has("incretin") && tokenOverlap(nvo, lly) >= 4);
  const stopped = peerTokens("The Company Inc Group Holdings", []);
  check("Stopwords inc, group, the, company fallen weg", !["inc", "group", "the", "company"].some(t => stopped.has(t)));
  check("Token kürzer als 5 fällt weg", !peerTokens("drug care auto", []).has("drug") && !peerTokens("drug care auto", []).has("care"));
}

console.log("\n=== DoD 2: NVO-Graph, LLY über PFE in F ===");
{
  const f = buildPeerSetF({
    subject: "NVO",
    subjectSector: "Healthcare",
    subjectIndustry: "Drug Manufacturers - General",
    subjectMarketCap: 500e9,
    subjectDescription: "GLP-1 / semaglutide / diabetes / obesity",
    subjectSegmentNames: ["Diabetes Care"],
    candidates: [
      drug("PFE", 160e9, "immunology vaccines"),
      drug("SNY", 140e9, "vaccines sanofi"),
      drug("LLY", 700e9, "GLP-1 / semaglutide / diabetes / obesity incretin"),
      {
        symbol: "XOM",
        sector: "Energy",
        industry: "Oil & Gas Integrated",
        marketCap: 400e9,
        description: "crude oil",
        segmentNames: [],
      },
    ],
  });
  check("LLY ist in F", f.includes("LLY"), JSON.stringify(f));
  check("Energy-Kandidat fällt in D", !f.includes("XOM"), JSON.stringify(f));
  check("NVO selbst ist nicht in F", !f.includes("NVO"));
}

console.log("\n=== DoD 2 als Kette: Seeds {PFE,SNY}, Hop von PFE enthält LLY ===");
{
  clearPeerHopMemoryForTests();
  const calls: string[] = [];
  const graph: Record<string, string[]> = {
    PFE: ["LLY", "MRK", "NVO"],
    SNY: ["AZN"],
  };
  const profiles: Record<string, AdaptivePeerProfile> = {
    PFE: drug("PFE", 160e9, "immunology vaccines"),
    SNY: drug("SNY", 140e9, "vaccines sanofi"),
    LLY: drug("LLY", 700e9, "GLP-1 / semaglutide / diabetes / obesity"),
    MRK: drug("MRK", 250e9, "oncology vaccines"),
    AZN: drug("AZN", 200e9, "oncology respiratory"),
  };
  const resolved = await resolveAdaptivePeerTickers({
    subject: "NVO",
    subjectSector: "Healthcare",
    subjectIndustry: "Drug Manufacturers - General",
    subjectMarketCap: 500e9,
    subjectDescription: "GLP-1 / semaglutide / diabetes / obesity",
    subjectSegmentNames: ["Diabetes Care"],
    seeds: ["PFE", "SNY"],
    fmpPeers: async (symbol) => {
      calls.push(symbol);
      return graph[symbol] ?? [];
    },
    loadProfile: async (symbol) => profiles[symbol] ?? null,
    cacheGet: () => null,
    cacheSet: () => {},
    curatedFallback: [],
  });
  check("LLY liegt in F", resolved.tickers.includes("LLY"), JSON.stringify(resolved.tickers));
  check("Hop läuft auf den Seeds, nicht noch einmal auf NVO", calls.includes("PFE") && calls.includes("SNY") && !calls.includes("NVO"), calls.join(","));
  check("Subjekt aus dem Hop-Ergebnis fällt raus", !resolved.tickers.includes("NVO"));
}

console.log("\n=== DoD 3: BYDDY, CFR im 2-Hop fällt in D, kuratiert wird nicht vorangestellt ===");
{
  clearPeerHopMemoryForTests();
  const resolved = await resolveAdaptivePeerTickers({
    subject: "BYDDY",
    subjectSector: "Consumer Cyclical",
    subjectIndustry: "Auto - Manufacturers",
    subjectMarketCap: 100e9,
    subjectDescription: "electric vehicles batteries",
    subjectSegmentNames: ["Automobiles"],
    seeds: ["TSLA"],
    fmpPeers: async () => ["CFR", "NIO"],
    loadProfile: async (symbol) => {
      if (symbol === "TSLA") return auto("TSLA", 800e9);
      if (symbol === "NIO") return auto("NIO", 20e9);
      if (symbol === "CFR") {
        return {
          symbol: "CFR",
          sector: "Consumer Cyclical",
          industry: "Luxury Goods",
          marketCap: 90e9,
          description: "luxury watches jewelry",
          segmentNames: [],
        };
      }
      return null;
    },
    cacheGet: () => null,
    cacheSet: () => {},
  });
  check("CFR ist nicht in F", !resolved.tickers.includes("CFR"), JSON.stringify(resolved.tickers));
  check("TSLA bleibt (Auto, Cap-Band)", resolved.tickers.includes("TSLA"), JSON.stringify(resolved.tickers));
  check("kuratierte NEV-Liste wird nicht vor die Kette gestellt", !resolved.tickers.includes("GELYF") && !resolved.tickers.includes("XPEV"), JSON.stringify(resolved.tickers));
}

console.log("\n=== Notnagel: leeres F nutzt die Map, nicht-leeres F nicht ===");
{
  const empty = buildPeerSetF({
    subject: "BYDDY",
    subjectSector: "Consumer Cyclical",
    subjectIndustry: "Auto - Manufacturers",
    subjectMarketCap: 100e9,
    subjectDescription: "",
    subjectSegmentNames: [],
    candidates: [],
    curatedFallback: CURATED_PEER_FALLBACK.BYDDY,
  });
  check("leeres F fällt auf die kuratierte BYDDY-Liste", empty.includes("TSLA") && empty.includes("GELYF"), JSON.stringify(empty));

  const present = buildPeerSetF({
    subject: "BYDDY",
    subjectSector: "Consumer Cyclical",
    subjectIndustry: "Auto - Manufacturers",
    subjectMarketCap: 100e9,
    subjectDescription: "electric vehicles",
    subjectSegmentNames: [],
    candidates: [auto("TSLA", 800e9)],
    curatedFallback: CURATED_PEER_FALLBACK.BYDDY,
  });
  check("nicht-leeres F bleibt ohne kuratierte Auffüllung", present.length === 1 && present[0] === "TSLA", JSON.stringify(present));

  const nvoEmpty = buildPeerSetF({
    subject: "NVO",
    subjectSector: "Healthcare",
    subjectIndustry: "Drug Manufacturers - General",
    subjectMarketCap: 500e9,
    subjectDescription: "",
    subjectSegmentNames: [],
    candidates: [],
    curatedFallback: CURATED_PEER_FALLBACK.NVO,
  });
  check("NVO ohne Treffer erfindet keine Peers", nvoEmpty.length === 0, JSON.stringify(nvoEmpty));
}

console.log("\n=== D: Cap-Band und Rang E ===");
{
  const subjectCap = 100e9;
  const ranked = buildPeerSetF({
    subject: "MSFT",
    subjectSector: "Technology",
    subjectIndustry: "Software - Infrastructure",
    subjectMarketCap: subjectCap,
    subjectDescription: "cloud software azure",
    subjectSegmentNames: ["Cloud Platform"],
    candidates: [
      {
        symbol: "FAR",
        sector: "Technology",
        industry: "Software - Infrastructure",
        marketCap: subjectCap * 10,
        description: "unrelated hardware",
        segmentNames: [],
      },
      {
        symbol: "NEARSEC",
        sector: "Technology",
        industry: "Software - Application",
        marketCap: subjectCap,
        description: "cloud software azure",
        segmentNames: [],
      },
      {
        symbol: "TINY",
        sector: "Technology",
        industry: "Software - Infrastructure",
        marketCap: subjectCap * 0.01,
        description: "cloud software azure",
        segmentNames: [],
      },
      {
        symbol: "HUGE",
        sector: "Technology",
        industry: "Software - Infrastructure",
        marketCap: subjectCap * 21,
        description: "cloud software azure",
        segmentNames: [],
      },
    ],
  });
  check("Micro-Cap unter 5 % fällt in D", !ranked.includes("TINY"), JSON.stringify(ranked));
  check("über 20× fällt in D", !ranked.includes("HUGE"), JSON.stringify(ranked));
  check("exakte Industry steht vor näherem Sector-Nachbarn", ranked[0] === "FAR", JSON.stringify(ranked));
  check("Sector-Nachbar bleibt hinter der exakten Industry", ranked.includes("NEARSEC") && ranked.indexOf("FAR") < ranked.indexOf("NEARSEC"));

  const tie = buildPeerSetF({
    subject: "NVO",
    subjectSector: "Healthcare",
    subjectIndustry: "Drug Manufacturers - General",
    subjectMarketCap: 400e9,
    subjectDescription: "GLP-1 / semaglutide / diabetes / obesity",
    subjectSegmentNames: [],
    candidates: [
      drug("PLAIN", 400e9, "immunology vaccines"),
      drug("GLP", 400e9, "GLP-1 / semaglutide / diabetes / obesity"),
      drug("DIST", 200e9, "GLP-1 / semaglutide / diabetes / obesity"),
    ],
  });
  check("bei gleichem Cap gewinnt der Token-Überlapp", tie[0] === "GLP", JSON.stringify(tie));
  check("Cap-Abstand schlägt Token-Überlapp", tie.indexOf("PLAIN") < tie.indexOf("DIST"), JSON.stringify(tie));
}

console.log("\n=== F nimmt 5, Override danach bis 8 ===");
{
  const symbols = ["AAAAA", "BBBBB", "CCCCC", "DDDDD", "EEEEE", "FFFFF"];
  const f = buildPeerSetF({
    subject: "NVO",
    subjectSector: "Healthcare",
    subjectIndustry: "Drug Manufacturers - General",
    subjectMarketCap: 100e9,
    subjectDescription: "",
    subjectSegmentNames: [],
    candidates: symbols.map(symbol => drug(symbol, 100e9, "oncology vaccines")),
  });
  check("Take ist 5", f.length === 5, JSON.stringify(f));
  check("der sechste nach Symbol-Rang fällt weg", !f.includes("FFFFF"), JSON.stringify(f));
  const withOverride = applyPeerOverrides(f, "NVO", ["ZZZA", "ZZZB", "ZZZC", "ZZZD"], [], 8);
  check("Override hängt nach F an, Deckel 8", withOverride.length === 8 && withOverride.slice(0, 5).join(",") === f.join(","), JSON.stringify(withOverride));
}

console.log("\n=== DoD 5: LLM-Symbol nur über Search + D ===");
{
  const f = buildPeerSetF({
    subject: "NVO",
    subjectSector: "Healthcare",
    subjectIndustry: "Drug Manufacturers - General",
    subjectMarketCap: 500e9,
    subjectDescription: "diabetes",
    subjectSegmentNames: [],
    candidates: [drug("PFE", 160e9, "immunology")],
    llmSymbols: ["ZZZZ", "LLY", "CFR"],
    searchedCompetition: [
      drug("LLY", 700e9, "diabetes incretin"),
      {
        symbol: "CFR",
        sector: "Consumer Cyclical",
        industry: "Luxury Goods",
        marketCap: 80e9,
        description: "luxury watches",
        segmentNames: [],
      },
    ],
  });
  check("nacktes LLM-Symbol ZZZZ ist nicht in F", !f.includes("ZZZZ"), JSON.stringify(f));
  check("LLY aus Search besteht D und ist in F", f.includes("LLY"), JSON.stringify(f));
  check("CFR aus Search scheitert an D", !f.includes("CFR"), JSON.stringify(f));
}

console.log("\n=== Profilfelder für D: mktCap, sector, industry, description ===");
{
  const mapped = adaptiveProfileFromFmp("lly", {
    sector: "Healthcare",
    industry: "Drug Manufacturers - General",
    mktCap: 700e9,
    description: "GLP-1 / semaglutide / diabetes / obesity",
  });
  check("mktCap wird zur Cap, Symbol wird groß", mapped?.symbol === "LLY" && mapped.marketCap === 700e9 && mapped.industry.includes("Drug"));
  const alt = adaptiveProfileFromFmp("AMZN", { marketCap: 2e12, sector: "Consumer Cyclical", industry: "Internet Retail", description: "" });
  check("marketCap ist der Ersatz für mktCap", alt?.marketCap === 2e12);
  const blank = adaptiveProfileFromFmp("X", { mktCap: 0, description: "no cap" });
  check("Cap 0 ist keine Cap", blank?.marketCap === null);
  check("ohne Profil keine Kandidatendaten", adaptiveProfileFromFmp("X", null) === null);
}

console.log("\n=== DoD 4: Cache 7 Tage, heiße Minute ohne neue Hop-Calls ===");
{
  clearPeerHopMemoryForTests();
  const store = new Map<string, HopCacheRow>();
  const cacheGet = (key: string) => store.get(key) ?? null;
  const cacheSet = (key: string, row: HopCacheRow) => { store.set(key, row); };
  let calls = 0;
  const fmpPeers = async (symbol: string) => {
    calls += 1;
    return symbol === "PFE" ? ["LLY"] : ["AZN"];
  };
  const seeds = ["PFE", "SNY", "MRK", "ABBV", "AZN", "BMY"];
  const now = 1_700_000_000_000;
  const first = await loadPeerHopSymbols({
    subject: "nvo",
    seeds,
    now,
    cacheGet,
    cacheSet,
    fmpPeers,
  });
  check("ohne Cache: genau die Top 5 Seeds, nicht der sechste", calls === 5 && first.symbols.includes("LLY"), `calls=${calls} symbols=${first.symbols.join(",")}`);
  check("Cache-Key ist peers2hop:{TICKER}", store.has(peers2HopCacheKey("NVO")));
  const afterFirst = calls;
  const second = await loadPeerHopSymbols({
    subject: "NVO",
    seeds,
    now: now + 60_000,
    cacheGet,
    cacheSet,
    fmpPeers,
  });
  check("heiße Minute mit frischem Cache: keine weiteren Calls", calls === afterFirst && second.symbols.includes("LLY"));

  store.set(peers2HopCacheKey("NVO"), { symbols: ["LLY"], storedAt: now - 2 * DAY });
  calls = 0;
  const warm = await loadPeerHopSymbols({
    subject: "NVO",
    seeds,
    now,
    cacheGet,
    cacheSet,
    fmpPeers,
  });
  check("Eintrag jünger als 7 Tage: keine +5 Calls", calls === 0 && warm.symbols.includes("LLY"), `calls=${calls}`);

  store.set(peers2HopCacheKey("NVO"), { symbols: ["STALE"], storedAt: now - PEERS_2HOP_TTL_MS - 1 });
  calls = 0;
  const stale = await loadPeerHopSymbols({
    subject: "NVO",
    seeds,
    now,
    cacheGet,
    cacheSet,
    fmpPeers,
  });
  check("Eintrag älter als 7 Tage: Hops laufen erneut", calls === 5 && stale.symbols.includes("LLY") && !stale.symbols.includes("STALE"), `calls=${calls} ${stale.symbols.join(",")}`);
}

console.log("\n=== researcher_cache: 7 Tage, nicht die 1-Tages-Frist ===");
{
  const key = "peers2hop:__TEST_PEER_ADAPTIVE__";
  try {
    diskResearcherDelete(key);
    diskResearcherSet(key, { symbols: ["LLY"] });
    const realNow = Date.now();
    const hit = diskResearcherGetWithTtl(key, PEERS_2HOP_TTL_MS, realNow + 2 * DAY);
    check("2 Tage alter peers2hop-Eintrag bleibt bei TTL 7d lesbar", hit?.data?.symbols?.[0] === "LLY" && typeof hit?.storedAt === "number");
    const expired = diskResearcherGetWithTtl(key, DAY, realNow + 2 * DAY);
    check("dieselbe Zeile ist bei TTL 1d abgelaufen", expired === null);
  } finally {
    diskResearcherDelete(key);
  }
}

console.log(failed === 0 ? "\n✅ peer-adaptive Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
