/**
 * Test fuer die Capex-Selbstheilung (server/researcher.ts):
 * capexCacheIsThin() + Rate-Limit-Logik (capexSelfHealAllowed/markCapexSelfHealAttempt).
 *
 * Hintergrund: Live-Screenshot zeigte einen gecachten Capex-Eintrag mit
 * programmes=[] und sectorExposure=[], aber gesetztem headline/summary — das
 * Frontend zeigte "Gecachte Analyse ohne KI-Inhalt" und wartete auf einen
 * manuellen Klick. Dieser Test prueft die reine Schwellen-/Rate-Limit-Logik
 * ueber ein kleines Nachbau-Modul (identische Konstanten/Funktionen wie in
 * researcher.ts, da die Originale dort nicht exportiert sind — Duplikation
 * bewusst minimal gehalten, nur fuer den Test).
 */

const CAPEX_MIN_PROGRAMMES = 4;
const CAPEX_MIN_SECTOR_EXPOSURE = 4;
const CAPEX_SELFHEAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function capexCacheIsThin(payload: any): boolean {
  const programmesN = Array.isArray(payload?.programmes) ? payload.programmes.length : 0;
  const sectorExposureN = Array.isArray(payload?.sectorExposure) ? payload.sectorExposure.length : 0;
  return programmesN < CAPEX_MIN_PROGRAMMES || sectorExposureN < CAPEX_MIN_SECTOR_EXPOSURE;
}

function makeAllowedChecker() {
  const attempts = new Map<string, number>();
  return {
    allowed(region: string, now: number): boolean {
      const last = attempts.get(region) ?? 0;
      return now - last >= CAPEX_SELFHEAL_COOLDOWN_MS;
    },
    mark(region: string, now: number): void {
      attempts.set(region, now);
    },
  };
}

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { console.log(`  ✅ ${label}`); pass++; }
  else { console.log(`  ❌ ${label}`); fail++; }
}

console.log("§ capexCacheIsThin — Schwelle 4 programmes (Live-verifizierter Soll-Stand)");
// sectorExposure wird hier bewusst >= 4 mitgegeben, damit ausschliesslich die
// programmes-Dimension getestet wird (die zweite Dimension hat einen eigenen
// Block weiter unten) -- ohne sectorExposure waere jeder Fall automatisch
// thin, weil das Feld fehlt (0 < 4), unabhaengig von programmes.
const withOkSectorExposure = { sectorExposure: [1, 2, 3, 4] };
check("0 programmes -> thin", capexCacheIsThin({ ...withOkSectorExposure, programmes: [] }) === true);
check("3 programmes -> thin", capexCacheIsThin({ ...withOkSectorExposure, programmes: [1, 2, 3] }) === true);
check("4 programmes -> NICHT thin", capexCacheIsThin({ ...withOkSectorExposure, programmes: [1, 2, 3, 4] }) === false);
check("5 programmes -> NICHT thin", capexCacheIsThin({ ...withOkSectorExposure, programmes: [1, 2, 3, 4, 5] }) === false);
check("programmes fehlt komplett -> thin (sectorExposure allein reicht nicht)", capexCacheIsThin({ ...withOkSectorExposure }) === true);
check("programmes ist kein Array -> thin (defensiv)", capexCacheIsThin({ ...withOkSectorExposure, programmes: null }) === true);
check("beide Felder fehlen komplett -> thin", capexCacheIsThin({}) === true);

console.log("\n§ capexCacheIsThin — zweite Dimension sectorExposure (Prompt fordert exakt 5, Schwelle bewusst bei 4)");
check("4 programmes + 0 sectorExposure -> thin (sectorExposure zu niedrig)", capexCacheIsThin({ programmes: [1, 2, 3, 4], sectorExposure: [] }) === true);
check("4 programmes + 3 sectorExposure -> thin", capexCacheIsThin({ programmes: [1, 2, 3, 4], sectorExposure: [1, 2, 3] }) === true);
check("4 programmes + 4 sectorExposure -> NICHT thin (Live-beobachteter Normalfall, LLM liefert manchmal 4 statt Prompt-Soll 5)", capexCacheIsThin({ programmes: [1, 2, 3, 4], sectorExposure: [1, 2, 3, 4] }) === false);
check("4 programmes + 5 sectorExposure -> NICHT thin (Prompt-Soll exakt erreicht)", capexCacheIsThin({ programmes: [1, 2, 3, 4], sectorExposure: [1, 2, 3, 4, 5] }) === false);
check("5 programmes + 3 sectorExposure -> thin (programmes allein reicht nicht, sectorExposure zaehlt eigenstaendig)", capexCacheIsThin({ programmes: [1, 2, 3, 4, 5], sectorExposure: [1, 2, 3] }) === true);

console.log("\n§ Rate-Limit — max 1 Selbstheilungs-Versuch pro Region pro 6h");
{
  const checker = makeAllowedChecker();
  // t0 muss deutlich groesser als CAPEX_SELFHEAL_COOLDOWN_MS sein, sonst faellt
  // der "noch nie versucht" -> last=0 -> now-0>=COOLDOWN Check faelschlich negativ.
  const t0 = CAPEX_SELFHEAL_COOLDOWN_MS * 10;
  check("erster Versuch erlaubt", checker.allowed("US", t0) === true);
  checker.mark("US", t0);
  check("sofort danach gesperrt", checker.allowed("US", t0 + 1000) === false);
  check("nach 5h59min noch gesperrt", checker.allowed("US", t0 + (5 * 60 + 59) * 60 * 1000) === false);
  check("nach 6h wieder erlaubt", checker.allowed("US", t0 + CAPEX_SELFHEAL_COOLDOWN_MS) === true);
  check("Regionen sind unabhaengig voneinander", checker.allowed("EU", t0 + 1000) === true);
}

console.log("\n§ Live-Fall aus dem Screenshot (Bild 5) — Reproduktion");
{
  // Genau der beobachtete Zustand: headline+summary gesetzt, aber programmes/
  // sectorExposure leer. isStaleCache() in researcher.ts erkennt das bereits
  // (programmes.length === 0), aber dieser Guard ist strenger (Schwelle 4)
  // und greift zusaetzlich, wenn isStaleCache() aus irgendeinem Grund nicht
  // getriggert hat (z.B. alter Cache-Eintrag von vor dem isStaleCache-Fix).
  const screenshotCache = {
    headline: "OBBBA Steuerreformen 2025 und Stargate AI-Infrastruktur katalysieren $3.4T Capex-Zyklus...",
    summary: "Die „One Big Beautiful Bill",
    totalCapexEstimate: "Die „One Big Beautiful Bill",
    govSpendingTrend: "OBBBA Steuerreformen 2025 und Stargate AI-Infrastruktur...",
    programmes: [],
    sectorExposure: [],
  };
  check("Screenshot-Fall wird als thin erkannt", capexCacheIsThin(screenshotCache) === true);

  const liveFixedCache = {
    headline: "OBBBA Steuerreformen 2025...",
    programmes: [{ name: "OBBBA" }, { name: "CHIPS" }, { name: "Stargate" }, { name: "NDAA" }],
    sectorExposure: [1, 2, 3, 4, 5],
  };
  check("Live-verifizierter Fix-Zustand (4 programmes) wird NICHT als thin erkannt", capexCacheIsThin(liveFixedCache) === false);
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} Checks bestanden`);
if (fail > 0) process.exit(1);
