/**
 * Test fuer den Peer-Auswahl-Fix (Auftrag 05.08.2026): Industry-/Sector-Filter
 * + kuratierter Fallback fuer bekannte Problemfaelle (BYDDY, NIO, XPeng, Li
 * Auto, Geely).
 *
 * Ist-Zustand vor diesem Fix: FMP /stock-peers gruppiert Ticker rein nach
 * Kursbewegungs-/Marktkap-Aehnlichkeit. Fuer BYDDY (Auto - Manufacturers)
 * liefert FMP u.a. CFRHF/CFRUY (Richemont, Luxury Goods) und CHDRF/CHDRY
 * (Christian Dior, Luxury Goods) — 6 von 10 FMP-Peers sind branchenfremd.
 *
 * Diese Datei testet filterAndSelectPeers() (server/news-peers.ts) mit
 * ECHTEN FMP-Profile-Calls (kein Mock) gegen:
 *  1. BYDDY: die tatsaechliche FMP-Rohliste (Live-verifiziert 05.08.2026) —
 *     Richemont/Dior/Fast Retailing MUESSEN verworfen werden, Ergebnis MUSS
 *     entweder aus echten Auto/EV-Filtertreffern bestehen oder auf die
 *     kuratierte Fallback-Liste zurueckfallen.
 *  2. TSLA (positiver Kontrollfall): Auto/EV-Peers muessen bestehen bleiben.
 *  3. MSFT (positiver Kontrollfall): kein Auto-Ticker darf durchrutschen.
 *
 * Ausfuehren: npx tsx script/test-peer-filter.ts
 * (macht echte FMP-Calls — benoetigt FMP_API_KEY in .env)
 */
import "dotenv/config";
import { filterAndSelectPeers } from "../server/news-peers";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n=== BYDDY: echte FMP-Rohliste (Live-verifiziert 05.08.2026) ===");
  {
    // Exakte rohe FMP /stock-peers-Antwort fuer BYDDY zum Testzeitpunkt.
    const rawFmpPeers = ["BAMXF", "CFRHF", "CFRUY", "CHDRF", "CHDRY", "FRCOF", "FRCOY", "FYGGY", "MBGAF", "MBGYY"];
    const result = await filterAndSelectPeers("BYDDY", "Consumer Cyclical", "Auto - Manufacturers", rawFmpPeers, 5);
    console.log(`  Ergebnis: ${JSON.stringify(result)}`);

    check("Richemont (CFRHF) NICHT in der finalen Liste", !result.includes("CFRHF"));
    check("Richemont (CFRUY) NICHT in der finalen Liste", !result.includes("CFRUY"));
    check("Dior (CHDRF) NICHT in der finalen Liste", !result.includes("CHDRF"));
    check("Dior (CHDRY) NICHT in der finalen Liste", !result.includes("CHDRY"));
    check("Fast Retailing (FRCOF/FRCOY) NICHT in der finalen Liste", !result.includes("FRCOF") && !result.includes("FRCOY"));
    check("Ergebnis nicht leer", result.length > 0, "Peer-Filter darf niemals 0 Peers liefern, wenn ein Fallback existiert");
    check("Mindestens 3 Peers", result.length >= 3, `nur ${result.length} Peers`);

    // Owner-Entscheidung 05.08.2026: kuratierte NEV-Pure-Plays haben Vorrang
    // vor generischen FMP-Industry-Treffern (BMW/Mercedes) fuer Subjekte mit
    // kuratierter Fallback-Liste — auch wenn BAMXF/MBGAF/MBGYY den reinen
    // Industry-Filter technisch bestehen wuerden.
    check("Enthaelt echte EV-Pure-Plays aus der kuratierten Liste (TSLA/NIO/LI/XPEV/GELYF)",
      result.some(t => ["TSLA", "NIO", "LI", "XPEV", "GELYF"].includes(t)), JSON.stringify(result));
    check("BMW (BAMXF) hat KEINEN Vorrang vor der kuratierten NEV-Liste",
      result[0] !== "BAMXF", JSON.stringify(result));
  }

  console.log("\n=== TSLA: positiver Kontrollfall (Auto/EV-Peers muessen bestehen bleiben) ===");
  {
    // TSLAs echte FMP-Peers sind ueberwiegend Auto/EV — hier simulieren wir
    // eine Mischung aus echten Auto-Peers und einem absichtlich falschen
    // Luxury-Ticker, um zu pruefen, dass der Filter selektiv arbeitet (nicht
    // alles verwirft, nur den Fehltreffer).
    const mixedCandidates = ["BYDDY", "NIO", "XPEV", "CFRHF", "GELYF"];
    const result = await filterAndSelectPeers("TSLA", "Consumer Cyclical", "Auto - Manufacturers", mixedCandidates, 5);
    console.log(`  Ergebnis: ${JSON.stringify(result)}`);

    check("Echte Auto/EV-Peers bleiben erhalten (mind. 1 von BYDDY/NIO/XPEV/GELYF)",
      result.some(t => ["BYDDY", "NIO", "XPEV", "GELYF"].includes(t)));
    check("Richemont (CFRHF) wird auch hier verworfen", !result.includes("CFRHF"));
  }

  console.log("\n=== MSFT: positiver Kontrollfall (kein Auto-Ticker darf durchrutschen) ===");
  {
    // Absichtlich gemischte Kandidaten: echte Software/Cloud-Peers + ein
    // Auto-Ticker, der NICHT durchrutschen darf.
    const mixedCandidates = ["GOOGL", "ORCL", "CRM", "BYDDY", "TSLA"];
    const result = await filterAndSelectPeers("MSFT", "Technology", "Software - Infrastructure", mixedCandidates, 5);
    console.log(`  Ergebnis: ${JSON.stringify(result)}`);

    check("BYDDY (Auto) NICHT in der finalen Liste fuer MSFT", !result.includes("BYDDY"));
    check("TSLA (Auto) NICHT in der finalen Liste fuer MSFT", !result.includes("TSLA"));
    check("Mindestens ein echter Software/Cloud-Peer bleibt erhalten",
      result.some(t => ["GOOGL", "ORCL", "CRM"].includes(t)));
  }

  console.log("\n=== Edge Case: leere FMP-Rohliste + kuratierter Fallback vorhanden ===");
  {
    const result = await filterAndSelectPeers("BYDDY", "Consumer Cyclical", "Auto - Manufacturers", [], 5);
    console.log(`  Ergebnis: ${JSON.stringify(result)}`);
    check("Fallback greift bei komplett leerer FMP-Liste", result.length > 0);
    check("Fallback-Ergebnis enthaelt TSLA (Teil der kuratierten Liste)", result.includes("TSLA"));
  }

  console.log("\n=== Edge Case: kein Fallback fuer unbekanntes Subjekt + schlechte FMP-Peers ===");
  {
    // Kein Eintrag fuer AAPL in CURATED_PEER_FALLBACK — Filter muss einfach
    // die (wenigen) uebrig bleibenden FMP-Treffer liefern, notfalls leer,
    // aber NIE crashen und NIE Fake-Peers erfinden.
    const result = await filterAndSelectPeers("AAPL", "Technology", "Consumer Electronics", ["BYDDY"], 5);
    console.log(`  Ergebnis: ${JSON.stringify(result)}`);
    check("Kein Crash, branchenfremder Kandidat wird schlicht verworfen", !result.includes("BYDDY"));
  }

  console.log(failed === 0 ? "\n✅ Alle Peer-Filter-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
