/**
 * Unit-Tests für die Fiscal-Bridge-Logik (WORK_REVERSE_DCF_BRIDGE.md Teil 2 + Teil 3).
 * Läuft ohne Netzwerk/LLM — reine Funktionstests.
 *
 * Ausführen: npx tsx script/test-fiscal-bridge.ts
 */
import {
  invalidateProgram, detectContradiction, computeExpiresAt, ttlDaysFor, isProgramActive,
  scoreCacheKeysTouchedByProgram,
  type FiscalProgram, type InvalidationEvent, type ProgramExtraction,
} from "../server/fiscal-bridge";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mkProgram(over: Partial<FiscalProgram> = {}): FiscalProgram {
  return {
    id: "prog-1",
    name: "Testprogramm",
    region: "US",
    sectorKeys: ["defense"],
    status: "legislated",
    confidence: "high",
    volumeUsdBn: 20,
    startYear: 2025,
    endYear: 2028,
    source: { url: "https://example.gov/program", publishedAt: "2025-01-01T00:00:00.000Z", snippet: "…" },
    expiresAt: computeExpiresAt("2025-01-01T00:00:00.000Z", "legislated", "high"),
    ...over,
  };
}

// ─── §2.12 TTL-Tabelle ─────────────────────────────────────────────────────────
console.log("\n§2.12 ttlDaysFor / computeExpiresAt");
{
  check("announced/low = 3d", ttlDaysFor("announced", "low") === 3);
  check("announced/high = 14d", ttlDaysFor("announced", "high") === 14);
  check("legislated = 30d", ttlDaysFor("legislated", "high") === 30);
  check("funded = 45d", ttlDaysFor("funded", "medium") === 45);
  check("deploying = 60d", ttlDaysFor("deploying", "low") === 60);
  check("expired = 0d", ttlDaysFor("expired", "high") === 0);

  const at = "2026-01-01T00:00:00.000Z";
  const exp = computeExpiresAt(at, "legislated", "high");
  const expectedMs = new Date(at).getTime() + 30 * 24 * 60 * 60 * 1000;
  check("computeExpiresAt legislated +30d exakt", new Date(exp).getTime() === expectedMs, exp);
}

// ─── §2.12 isProgramActive + Lookahead-Sperre ─────────────────────────────────
console.log("\n§2.12 isProgramActive (inkl. harte Lookahead-Sperre publishedAt <= asOf)");
{
  const p = mkProgram({
    status: "legislated", confidence: "high",
    source: { url: "https://x", publishedAt: "2025-06-01T00:00:00.000Z", snippet: "" },
    expiresAt: computeExpiresAt("2025-06-01T00:00:00.000Z", "legislated", "high"),
    endYear: 2028,
  });
  check("aktiv innerhalb TTL, nach publishedAt", isProgramActive(p, "2025-06-15T00:00:00.000Z"));
  check("inaktiv NACH TTL-Ablauf", !isProgramActive(p, "2026-07-01T00:00:00.000Z"));
  check("inaktiv VOR publishedAt (Lookahead-Sperre)", !isProgramActive(p, "2025-01-01T00:00:00.000Z"));
  check("inaktiv wenn status=expired", !isProgramActive({ ...p, status: "expired" }, "2025-06-15T00:00:00.000Z"));
  check("inaktiv wenn asOf-Jahr > endYear", !isProgramActive(p, "2029-01-01T00:00:00.000Z"));
}

// ─── §2.13.2 invalidateProgram — I1-I8 Zustandsübergänge ──────────────────────
console.log("\n§2.13.2 invalidateProgram — Invalidierungs-Trigger I1-I8");
{
  const mkEvent = (reason: InvalidationEvent["reason"], over: Partial<InvalidationEvent> = {}): InvalidationEvent => ({
    programId: "prog-1", reason, at: "2026-03-01T00:00:00.000Z", ...over,
  });

  // I1 — Quelle dementiert (denied) → expired, hard
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const row = invalidateProgram(store, mkEvent("denied"));
    check("I1 denied → status=expired", row?.status === "expired");
    check("I1 denied → expiresAt=ev.at", row?.expiresAt === "2026-03-01T00:00:00.000Z");
    check("I1 denied → confidence=low", row?.confidence === "low");
  }

  // I2 — Budget gestrichen (defunded) → expired, hard
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const row = invalidateProgram(store, mkEvent("defunded"));
    check("I2 defunded → status=expired", row?.status === "expired");
    check("I2 defunded → confidence=low", row?.confidence === "low");
  }

  // I3 — endYear überschritten → expired, hard
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const row = invalidateProgram(store, mkEvent("end_year"));
    check("I3 end_year → status=expired", row?.status === "expired");
  }

  // I4 — Widerspruch (contradiction) → confidence downgrade + TTL kurz, soft/hard
  {
    const store = new Map([["prog-1", mkProgram({ confidence: "high", status: "funded" })]]);
    const row = invalidateProgram(store, mkEvent("contradiction"));
    check("I4 contradiction high→medium", row?.confidence === "medium");
    check("I4 contradiction status bleibt (nur confidence sinkt)", row?.status === "funded");
    const expectedExp = computeExpiresAt("2026-03-01T00:00:00.000Z", "funded", "medium");
    check("I4 contradiction TTL neu berechnet (funded/medium)", row?.expiresAt === expectedExp, `${row?.expiresAt} vs ${expectedExp}`);

    // zweiter contradiction-Hit: medium → low
    store.set("prog-1", row!);
    const row2 = invalidateProgram(store, mkEvent("contradiction"));
    check("I4 contradiction medium→low (zweiter Hit)", row2?.confidence === "low");
  }

  // I5 — Sector-Map-Treffer falsch (sector_fix) → Programm bleibt bestehen (Caller korrigiert sectorKeys)
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const before = store.get("prog-1")!;
    const row = invalidateProgram(store, mkEvent("sector_fix"));
    check("I5 sector_fix → Programm unverändert zurückgegeben (kein Delete/Expire)", row?.status === before.status && row?.id === before.id);
    check("I5 sector_fix → Store weiterhin vorhanden", store.has("prog-1"));
  }

  // I6 — Max-Size Overflow → drop oldest (delete), soft
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const row = invalidateProgram(store, mkEvent("overflow"));
    check("I6 overflow → return null", row === null);
    check("I6 overflow → aus Store gelöscht", !store.has("prog-1"));
  }

  // I7 — GC-Cron / Briefing-Ende (ttl_gc) → delete, soft
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const row = invalidateProgram(store, mkEvent("ttl_gc"));
    check("I7 ttl_gc → return null", row === null);
    check("I7 ttl_gc → aus Store gelöscht", !store.has("prog-1"));
  }

  // I8 — Admin/API invalidate(id) (manual) → hard delete oder expired (hier: expired)
  {
    const store = new Map([["prog-1", mkProgram()]]);
    const row = invalidateProgram(store, mkEvent("manual"));
    check("I8 manual → status=expired", row?.status === "expired");
    check("I8 manual → confidence=low", row?.confidence === "low");
  }

  // Edge case: unbekannte programId → null, kein Crash
  {
    const store = new Map<string, FiscalProgram>();
    const row = invalidateProgram(store, mkEvent("denied", { programId: "nicht-vorhanden" }));
    check("Unbekannte programId → null (kein Crash)", row === null);
  }
}

// ─── §2.13.4 detectContradiction ──────────────────────────────────────────────
console.log("\n§2.13.4 detectContradiction");
{
  const prev = mkProgram({ status: "funded", volumeUsdBn: 20, confidence: "high" });

  const mkExtraction = (over: Partial<ProgramExtraction> = {}): ProgramExtraction => ({
    status: "funded", volumeUsdBn: 20, snippet: "Programm läuft wie geplant", ...over,
  });

  check(
    "status=expired → 'denied'",
    detectContradiction(prev, mkExtraction({ status: "expired" })) === "denied"
  );
  check(
    "snippet matcht 'denied' → 'denied'",
    detectContradiction(prev, mkExtraction({ snippet: "Program was denied by court" })) === "denied"
  );
  check(
    "snippet matcht 'cancelled' → 'denied'",
    detectContradiction(prev, mkExtraction({ snippet: "Funding was cancelled" })) === "denied"
  );
  check(
    "snippet matcht 'struck down' → 'denied'",
    detectContradiction(prev, mkExtraction({ snippet: "Law was struck down by court" })) === "denied"
  );
  check(
    "Volume-Drop > 50% → 'contradiction'",
    detectContradiction(prev, mkExtraction({ volumeUsdBn: 9 })) === "contradiction" // 9 < 20*0.5=10
  );
  check(
    "Volume-Drop genau 50% (nicht >) → kein Trigger",
    detectContradiction(prev, mkExtraction({ volumeUsdBn: 10 })) === null // 10 !< 10
  );
  check(
    "Status-Downgrade (funded→announced) → 'contradiction'",
    detectContradiction(prev, mkExtraction({ status: "announced", volumeUsdBn: 20 })) === "contradiction"
  );
  check(
    "Status-Upgrade (funded→deploying) → kein Trigger",
    detectContradiction(prev, mkExtraction({ status: "deploying", volumeUsdBn: 20 })) === null
  );
  check(
    "Kein Widerspruch bei stabilen Daten → null",
    detectContradiction(prev, mkExtraction()) === null
  );
}

// ─── §2.13.3 scoreCacheKeysTouchedByProgram ───────────────────────────────────
console.log("\n§2.13.3 scoreCacheKeysTouchedByProgram");
{
  const keys = scoreCacheKeysTouchedByProgram("prog-1", ["AAPL", "MSFT"], "2026-03-01");
  check("2 Keys für 2 Ticker", keys.length === 2, JSON.stringify(keys));
  check("Key-Format korrekt", keys[0] === "score:AAPL:2026-03-01:prog:prog-1", keys[0]);
}

console.log(failed === 0 ? "\n✅ Alle Fiscal-Bridge-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
