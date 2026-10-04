/**
 * script/test-valuechain-ranks-7-9.ts
 * -----------------------------------
 * Rang 7–8: custom-edge graph built from existing stages (cards stay).
 * Rang 9: Redis limiter is optional. No URL → in-process. Unreachable
 * URL → fail open, no throw, no required secret.
 *
 * Aufruf: npx tsx script/test-valuechain-ranks-7-9.ts
 */

import { buildValueChainFlow, VALUE_CHAIN_FLOW_COMPANY_CAP } from "../client/src/lib/valueChainFlow";
import type { ValueChainCompany, ValueChainStage } from "../client/src/lib/valueChainTypes";
import {
  acquireValueChainRedisPermit,
  concurrencyExceeded,
  FMP_REDIS_BUDGET_PER_MIN_DEFAULT,
  FMP_REDIS_CONCURRENCY_DEFAULT,
  fixedWindowExceeded,
  fmpFixedWindowKey,
  readRedisBudget,
  readRedisConcurrency,
  redisUrlFromEnv,
  resetValueChainRedisForTests,
  valueChainRateLimitMode,
} from "../server/valuechain-redis-ratelimit";

let failures = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}`);
  }
}

function company(ticker: string, marketCap: number): ValueChainCompany {
  return {
    ticker,
    name: ticker,
    marketCap,
    sector: "Information Technology",
    industry: "Semiconductors",
    capexIntensity: 0.2,
    validated: false,
  };
}

function stage(
  stageType: ValueChainStage["stageType"],
  name: string,
  tickers: string[]
): ValueChainStage {
  const companies = tickers.map((ticker, i) => company(ticker, 1_000_000_000 * (tickers.length - i)));
  return {
    stageId: `semiconductors-${stageType}`,
    stageName: name,
    stageType,
    description: name,
    companies,
    companyCount: companies.length,
    aggregatedMarketCap: companies.reduce((sum, c) => sum + (c.marketCap ?? 0), 0),
    avgCapexIntensity: 0.2,
  };
}

function testFlow(): void {
  const stages = [
    stage("upstream", "Upstream", ["ASML", "AMAT", "LRCX", "KLAC", "TER"]),
    stage("midstream", "Midstream", ["TSM", "INTC"]),
    stage("downstream", "Downstream", ["NVDA", "AMD", "AVGO", "QCOM"]),
  ];
  const before = stages.map((s) => s.companies.length);
  const graph = buildValueChainFlow(stages);

  assert(stages.map((s) => s.companies.length).join() === before.join(), "Eingabe-Stages bleiben unverändert");
  assert(graph.nodes.filter((n) => n.type === "stage").length === 3, "drei Stufen-Knoten");
  assert(
    graph.nodes.filter((n) => n.type === "company").length ===
      VALUE_CHAIN_FLOW_COMPANY_CAP + 2 + VALUE_CHAIN_FLOW_COMPANY_CAP,
    "Firmen im Graph sind auf drei je Stufe gedeckelt"
  );

  const flowEdges = graph.edges.filter((e) => e.data.kind === "flow");
  assert(flowEdges.length === 2, "zwei Custom Edges zwischen den vorhandenen Stufen");
  assert(flowEdges.every((e) => e.type === "valueChain"), "Flow-Kanten nutzen den Custom-Edge-Typ");
  assert(flowEdges.every((e) => e.animated && e.data.animate), "Flow-Kanten sind animiert");
  assert(flowEdges[0].sourceHandle === "out" && flowEdges[0].targetHandle === "in", "Flow-Kante hängt an out → in");
  assert(flowEdges[0].data.label === "Upstream → Midstream", "Flow-Kante beschriftet die Richtung");
  assert(
    graph.edges.filter((e) => e.data.kind === "member").every((e) => !e.animated && !e.data.animate),
    "Mitglieds-Kanten bleiben ruhig"
  );

  const one = buildValueChainFlow([stages[0]]);
  assert(one.edges.every((e) => e.data.kind !== "flow"), "eine Stufe erfindet keine fehlende Nachbarstufe");
  assert(buildValueChainFlow([]).nodes.length === 0, "leere Kette bleibt leer");
}

function testRedisPure(): void {
  const minute = Math.floor(Date.parse("2026-08-17T12:00:30Z") / 60_000);
  assert(
    fmpFixedWindowKey(new Date("2026-08-17T12:00:30Z")) === `fmp:ratelimit:${minute}`,
    "Fixed-Window-Key fmp:ratelimit:{minute}"
  );
  assert(fixedWindowExceeded(451, 450) && !fixedWindowExceeded(450, 450), "Fensterlimit zählt erst über dem Budget");
  assert(concurrencyExceeded(7, 6) && !concurrencyExceeded(6, 6), "Concurrency-Gate zählt erst über dem Limit");
  assert(readRedisBudget({}) === FMP_REDIS_BUDGET_PER_MIN_DEFAULT, "Budget-Default 450 ohne Env");
  assert(readRedisConcurrency({}) === FMP_REDIS_CONCURRENCY_DEFAULT, "Concurrency-Default 6 ohne Env");
  assert(redisUrlFromEnv({}) === null, "kein Redis-URL heißt kein Redis");
  assert(redisUrlFromEnv({ REDIS_URL: "  " }) === null, "leere REDIS_URL zählt nicht");
  assert(
    redisUrlFromEnv({ VALUECHAIN_REDIS_URL: "redis://example:6379", REDIS_URL: "redis://other:6379" }) ===
      "redis://example:6379",
    "VALUECHAIN_REDIS_URL hat Vorrang"
  );
}

async function testRedisOptional(): Promise<void> {
  const prevRedis = process.env.REDIS_URL;
  const prevVc = process.env.VALUECHAIN_REDIS_URL;
  const restore = () => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
    if (prevVc === undefined) delete process.env.VALUECHAIN_REDIS_URL;
    else process.env.VALUECHAIN_REDIS_URL = prevVc;
    resetValueChainRedisForTests();
  };

  try {
    delete process.env.REDIS_URL;
    delete process.env.VALUECHAIN_REDIS_URL;
    resetValueChainRedisForTests();
    assert(valueChainRateLimitMode() === "in-process", "ohne URL ist der Modus in-process");
    const open = await acquireValueChainRedisPermit();
    assert(open.mode === "in-process" && open.limited === false, "ohne URL kein Limit und kein Throw");
    await open.release();

    process.env.VALUECHAIN_REDIS_URL = "redis://127.0.0.1:6399";
    resetValueChainRedisForTests();
    const started = Date.now();
    const closed = await Promise.race([
      acquireValueChainRedisPermit(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("redis fail-open timeout")), 4000)),
    ]);
    assert(Date.now() - started < 4000, "unerreichbares Redis blockiert nicht");
    assert(closed.mode === "in-process" && closed.limited === false, "unerreichbares Redis fällt auf in-process zurück");
    assert(valueChainRateLimitMode() === "in-process", "nach dem Fehlschlag bleibt der Modus in-process");
    await closed.release();
  } finally {
    restore();
  }
}

async function main(): Promise<void> {
  testFlow();
  testRedisPure();
  await testRedisOptional();
  console.log(`\n${failures === 0 ? "✅ ALLE TESTS BESTANDEN" : `❌ ${failures} FEHLER`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ Testlauf fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
});
