/**
 * Industry-Fallback und Thesis-Peer-Set: Flag default AUS.
 * Vorher/Nachher der Peer-Liste plus die drei festgenagelten Scores.
 * Aufruf: npx tsx script/test-peer-rating-flag.ts
 */
import { readFileSync } from "node:fs";
import { PEER_RATING_EXTENSIONS, selectExtendedPeerSet, type PeerPoint } from "../shared/peer-rating-extensions";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

const subject: PeerPoint = { ticker: "MSFT", sector: "Technology", industry: "Software", marketCap: 100, pe: 20 };
const base = ["ORCL"];
const candidates: PeerPoint[] = [
  { ticker: "ADBE", sector: "Technology", industry: "Software", marketCap: 110, pe: 21 },
  { ticker: "CRM", sector: "Technology", industry: "Software", marketCap: 90, pe: 19 },
  { ticker: "FAR", sector: "Technology", industry: "Software", marketCap: 10000, pe: 200 },
  { ticker: "TINY", sector: "Technology", industry: "Software", marketCap: 1, pe: 2 },
  { ticker: "OTHER", sector: "Energy", industry: "Oil", marketCap: 100, pe: 20 },
];
const sameIndustry = (c: PeerPoint) => c.industry === subject.industry;

const off = selectExtendedPeerSet({ enabled: false, baseTickers: base, subject, candidates, sameIndustry });
const on = selectExtendedPeerSet({ enabled: true, baseTickers: base, subject, candidates, sameIndustry });
const live = selectExtendedPeerSet({
  enabled: PEER_RATING_EXTENSIONS.thesisPeerSet || PEER_RATING_EXTENSIONS.industryFallback,
  baseTickers: base,
  subject,
  candidates,
  sameIndustry,
});

check("Flags default aus", PEER_RATING_EXTENSIONS.industryFallback === false && PEER_RATING_EXTENSIONS.thesisPeerSet === false);
check("Flag aus: dieselbe Referenz", off.tickers === base && off.applied === false);
check("Live-Konstante lässt die Basis stehen", live.tickers === base && live.applied === false);
check("Flag an ergänzt die nahen Industrie-Peers", on.applied === true && on.tickers.includes("ADBE") && on.tickers.includes("CRM"), on.tickers.join(","));
check("Flag an verwirft den Ausreißer und die fremde Branche", !on.tickers.includes("FAR") && !on.tickers.includes("TINY") && !on.tickers.includes("OTHER"), on.tickers.join(","));
check("Basis bleibt vorn", on.tickers[0] === "ORCL");

const full = selectExtendedPeerSet({
  enabled: true,
  baseTickers: ["A", "B", "C"],
  subject,
  candidates,
  sameIndustry,
});
check("volle Basis wird nicht ersetzt", full.applied === false && full.tickers.join(",") === "A,B,C");

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
const scores = {
  VOW3: Number(pin.VWAGY.overallScore),
  SAP: Number(pin.SAP.overallScore),
  MSFT: Number(pin.MSFT.overallScore),
};
check("VOW3 4.735718", scores.VOW3.toFixed(6) === "4.735718", String(scores.VOW3));
check("SAP 5.174758", scores.SAP.toFixed(6) === "5.174758", String(scores.SAP));
check("MSFT 4.058138", scores.MSFT.toFixed(6) === "4.058138", String(scores.MSFT));

const route = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
check("Thesis-Route hängt am Flag", route.includes("PEER_RATING_EXTENSIONS.thesisPeerSet") && route.includes("selectExtendedPeerSet"));
check("analyze-route wird von diesem Modul nicht importiert", !readFileSync(new URL("../shared/peer-rating-extensions.ts", import.meta.url), "utf8").includes("analyze-route"));

console.log("\n| Ticker | Flag | Peers vorher | Peers nachher | angewendet | Score |");
console.log("|---|---|---|---|---|---|");
for (const [ticker, score] of Object.entries(scores)) {
  console.log(`| ${ticker} | aus (live) | unverändert | unverändert | nein | ${score.toFixed(6)} |`);
}
console.log(`| MSFT Beispiel | aus | ${off.tickers.join(",")} | ${off.tickers.join(",")} | ${off.applied ? "ja" : "nein"} | 4.058138 |`);
console.log(`| MSFT Beispiel | an | ${base.join(",")} | ${on.tickers.join(",")} | ${on.applied ? "ja" : "nein"} | nicht live |`);
console.log(`Grund aus: ${off.reason}`);
console.log(`Grund an: ${on.reason}`);

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nPeer-Flag ok");
