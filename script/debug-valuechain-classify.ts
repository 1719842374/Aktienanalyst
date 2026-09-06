/**
 * script/debug-valuechain-classify.ts
 * Debug-Helfer (NICHT Teil des Deliverables) -- zeigt rohe Stage-Zuordnung
 * ohne Gate-Check, um Keyword-Pattern zu iterieren.
 * Aufruf: npx tsx script/debug-valuechain-classify.ts <chainKey>
 */
import { ALL_INDUSTRIES, classifyStageForChain } from "../server/valuechain-catalog";
// Bugfix (06.09.2026): Legacy-Ketten (z.B. "semiconductors") muessen ueber
// classifyStage() klassifiziert werden -- exakt wie im echten
// /api/valuechain-Endpunkt (server/valuechain-routes.ts:
// "catalogDef.legacy ? classifyStage(...) : classifyStageForChain(...)").
// Dieses Skript rief bisher IMMER classifyStageForChain() auf, was fuer
// Legacy-Ketten eine falsche Diagnose lieferte (ASML/AMAT/LRCX/KLAC/NVDA
// erschienen faelschlich als "midstream", obwohl der Produktions-Endpunkt
// sie weiterhin korrekt klassifiziert).
import { classifyStage } from "../server/valuechain-routes";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const key = process.env.FMP_API_KEY || "";

async function screener(sector: string, industry: string, mcap: number) {
  const url = new URL(`${FMP_BASE}/company-screener`);
  url.searchParams.set("sector", sector);
  url.searchParams.set("industry", industry);
  url.searchParams.set("marketCapMoreThan", String(mcap));
  url.searchParams.set("limit", "60");
  url.searchParams.set("isActivelyTrading", "true");
  url.searchParams.set("apikey", key);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  return Array.isArray(data) ? data.filter((r: any) => r?.symbol && !String(r.symbol).includes(".")) : [];
}

async function profile(symbol: string) {
  const url = `${FMP_BASE}/profile?symbol=${symbol}&apikey=${key}`;
  const resp = await fetch(url);
  const data = await resp.json();
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function main() {
  const chainKey = process.argv[2];
  const def = ALL_INDUSTRIES.find((i) => i.key === chainKey);
  if (!def) {
    console.error("Unknown chain", chainKey);
    process.exit(1);
  }
  const pairs = def.fmpPairs && def.fmpPairs.length > 0
    ? def.fmpPairs
    : def.fmpIndustries.map((ind) => ({ sector: def.fmpSector, industry: ind }));

  const seen = new Set<string>();
  const rows: any[] = [];
  for (const p of pairs) {
    const r = await screener(p.sector, p.industry, 1_000_000_000);
    for (const row of r) {
      if (!seen.has(row.symbol)) {
        seen.add(row.symbol);
        rows.push(row);
      }
    }
  }
  console.log(`${rows.length} raw candidates`);

  const counts: Record<string, number> = { upstream: 0, midstream: 0, downstream: 0 };
  for (const row of rows.slice(0, 200)) {
    const p = await profile(row.symbol);
    const text = `${p?.description || ""} ${row.companyName}`;
    const stage = def.legacy ? classifyStage(text) : classifyStageForChain(def, text);
    counts[stage]++;
    console.log(stage.padEnd(10), row.symbol.padEnd(8), row.companyName.slice(0, 50));
  }
  console.log(counts);
}

main();
