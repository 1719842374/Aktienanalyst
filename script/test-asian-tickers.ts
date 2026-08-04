/**
 * Tests fuer die Asien/Nicht-US/EU-Ticker-Untersuchung (04.08.2026).
 *
 * Zusammenfassung der live gegen FMP verifizierten Befunde:
 *  1. Die Route GET /api/search-ticker existierte NIE im Server, obwohl
 *     TickerSearch.tsx sie seit jeher aufruft — betraf ALLE Ticker, nicht nur
 *     asiatische (jetzt in server/routes.ts registriert).
 *  2. US-ADR/OTC-Notierungen asiatischer Unternehmen funktionieren mit dem
 *     aktuellen FMP-Plan vollstaendig: BYDDY, XIACY, TCEHY, TSM, TM, SONY
 *     liefern Kurs, Financials, Historie, Peers, Scoring.
 *  3. Native asiatische Primaerboersen (.HK, .T, .KS, .SS, .SZ) und auch
 *     einige westliche Sekundaerboersen (.F, .HM, .BE, .DU, .MU, .MX) sind
 *     mit dem aktuellen Plan komplett gesperrt (Premium-Fehler statt Daten).
 *  4. Bugfix: Xiaomis Beschreibung nennt ein Fintech-Nebensegment — die
 *     Sektor-Heuristik klassifizierte das faelschlich als "Financial
 *     Services" um, obwohl FMP selbst korrekt "Technology" meldet.
 *
 * Diese Datei testet die reine Sortier-/Markierungslogik der Suchroute
 * (isLikelyUnavailable-Aequivalent) isoliert, da server/routes.ts die
 * eigentliche Funktion nicht exportiert (sie lebt inline in registerRoutes).
 *
 * Ausfuehren: npx tsx script/test-asian-tickers.ts
 */

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Spiegel der Suffix-Liste aus server/routes.ts (live gegen FMP verifiziert,
// siehe Kommentar dort für die einzelnen Testergebnisse).
const UNAVAILABLE_EXCHANGE_SUFFIXES = [
  ".HK", ".T", ".KS", ".SS", ".SZ", ".TW", ".KQ",
  ".F", ".HM", ".BE", ".DU", ".MU", ".MX",
];
function isLikelyUnavailable(symbol: string): boolean {
  return UNAVAILABLE_EXCHANGE_SUFFIXES.some(suf => symbol.toUpperCase().endsWith(suf));
}

console.log("\n=== Live-verifizierte gesperrte Börsen-Suffixe ===");
{
  check("1810.HK (Xiaomi, Hongkong) → unavailable", isLikelyUnavailable("1810.HK"));
  check("0700.HK (Tencent, Hongkong) → unavailable", isLikelyUnavailable("0700.HK"));
  check("7203.T (Toyota, Tokio) → unavailable", isLikelyUnavailable("7203.T"));
  check("006400.KS (Samsung SDI, Seoul) → unavailable", isLikelyUnavailable("006400.KS"));
  check("600519.SS (Kweichow Moutai, Shanghai) → unavailable", isLikelyUnavailable("600519.SS"));
  check("000858.SZ (Wuliangye, Shenzhen) → unavailable", isLikelyUnavailable("000858.SZ"));
  check("3CP.F (Xiaomi, Frankfurt) → unavailable (nicht asien-spezifisch!)", isLikelyUnavailable("3CP.F"));
  check("SONYN.MX (Sony, Mexiko) → unavailable", isLikelyUnavailable("SONYN.MX"));
}

console.log("\n=== Live-verifizierte FUNKTIONIERENDE US-ADR/OTC-Varianten ===");
{
  check("BYDDY (BYD, OTC-ADR) → NICHT unavailable", !isLikelyUnavailable("BYDDY"));
  check("XIACY (Xiaomi, OTC-ADR) → NICHT unavailable", !isLikelyUnavailable("XIACY"));
  check("TCEHY (Tencent, OTC-ADR) → NICHT unavailable", !isLikelyUnavailable("TCEHY"));
  check("TSM (TSMC, NYSE-ADR) → NICHT unavailable", !isLikelyUnavailable("TSM"));
  check("TM (Toyota, NYSE-ADR) → NICHT unavailable", !isLikelyUnavailable("TM"));
  check("SONY (Sony, NYSE-ADR) → NICHT unavailable", !isLikelyUnavailable("SONY"));
  check("BABA (Alibaba, NYSE) → NICHT unavailable", !isLikelyUnavailable("BABA"));
  check("0L2T.L (Samsung SDI, London) → NICHT unavailable (live OK verifiziert)", !isLikelyUnavailable("0L2T.L"));
}

console.log("\n=== Sortierung: verfügbare Ticker vor gesperrten ===");
{
  interface R { ticker: string; unavailable: boolean }
  const results: R[] = [
    { ticker: "1810.HK", unavailable: true },
    { ticker: "81810.HK", unavailable: true },
    { ticker: "XIACF", unavailable: false },
    { ticker: "XIACY", unavailable: false },
    { ticker: "3CP.F", unavailable: true },
  ].map(r => ({ ...r, unavailable: isLikelyUnavailable(r.ticker) }));
  const sorted = [...results].sort((a, b) => Number(a.unavailable) - Number(b.unavailable));
  check(
    "verfügbare Ticker (XIACF, XIACY) stehen nach Sortierung vor den gesperrten (.HK/.F)",
    !sorted[0].unavailable && !sorted[1].unavailable && sorted[2].unavailable && sorted[3].unavailable && sorted[4].unavailable,
    JSON.stringify(sorted)
  );
}

console.log(failed === 0 ? "\n✅ Alle Asien-Ticker-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
