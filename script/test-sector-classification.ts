/**
 * Tests fuer getEffectiveSector() — Bugfix der zu aggressiven Fintech-
 * Umklassifizierung (live gefunden bei Xiaomi/XIACY, 04.08.2026).
 *
 * Root Cause: die urspruengliche Pruefung feuerte bei JEDEM einzelnen Treffer
 * einer generischen Fintech-Phrase ("payment", "banking", "lending", "credit")
 * irgendwo im Beschreibungstext — unabhaengig davon ob Fintech Kern- oder
 * Nebengeschaeft ist. Xiaomis Beschreibung nennt "internet finance, consumer
 * lending, virtual banking ... electronic payment solutions" als EIN
 * Nebensegment neben dem dominanten Smartphone-/IoT-Geschaeft — das reichte,
 * um FMPs korrektes sector="Technology" faelschlich auf "Financial Services"
 * umzuschreiben.
 *
 * Diese Tests sichern ab: (a) Xiaomi bleibt Technology, (b) echte Fintechs
 * (PayPal, Block, Affirm) werden weiterhin korrekt als Financial Services
 * erkannt, (c) andere bereits bestehende Reklassifizierungen (Semiconductor,
 * Cloud/Tech-Platform) bleiben unveraendert funktionsfaehig.
 *
 * Ausfuehren: npx tsx script/test-sector-classification.ts
 */
import { getEffectiveSector } from "../server/sector-data";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n=== Bugfix: Xiaomi bleibt Technology (Nebengeschaeft-Erwaehnung) ===");
{
  // Echte FMP-Beschreibung (live abgerufen, 04.08.2026, gekuerzt auf die
  // fintech-relevanten Saetze — der volle Text nennt Smartphones/IoT zuerst).
  const xiaomiDesc = "Xiaomi Corporation functions as an investment holding entity, "
    + "delivering a range of hardware, software, and online services. The company "
    + "organizes its business into distinct segments: Smartphones, IoT and Lifestyle "
    + "Products, Internet Services, and a broader 'Others' category. The Smartphones "
    + "division is dedicated to the sale of mobile telecommunication devices. Within "
    + "the Internet Services segment, Xiaomi offers advertising solutions and various "
    + "internet value-added services, while also participating in the online gaming "
    + "and financial technology (fintech) sectors. Its financial offerings include "
    + "internet finance, consumer lending, virtual banking, software-related "
    + "services, IT advisory, and electronic payment solutions.";

  const result = getEffectiveSector("Technology", "Consumer Electronics", xiaomiDesc);
  check(
    `Xiaomi bleibt sector=Technology (tatsächlich: ${result.sector})`,
    result.sector === "Technology"
  );
  check("keine Hybrid-Reklassifizierung ausgelöst", result.isHybrid === false);
}

console.log("\n=== Gegen-Test: echte Fintechs bleiben korrekt Financial Services ===");
{
  const paypalDesc = "PayPal Holdings, Inc. operates a technology platform that "
    + "enables digital payments. Its core business is primarily payment processing, "
    + "peer to peer payment, merchant finance, and consumer credit through PayPal "
    + "Credit. The company also offers Venmo for peer-to-peer payment and provides "
    + "buy now pay later (BNPL) services, banking-as-a-service, and lending products.";
  const result = getEffectiveSector("Technology", "Software - Infrastructure", paypalDesc);
  check(
    `PayPal wird zu Financial Services reklassifiziert (tatsächlich: ${result.sector})`,
    result.sector === "Financial Services"
  );
  check("Hybrid-Flag gesetzt für PayPal", result.isHybrid === true);
}
{
  const blockDesc = "Block, Inc. (formerly Square) primarily operates as a fintech "
    + "company. Core business is payment processing for merchants, consumer lending "
    + "through Cash App Borrow, banking services via Cash App, and buy now pay later "
    + "(BNPL) through the Afterpay platform. The company principally focuses on "
    + "merchant finance and peer to peer payment solutions.";
  const result = getEffectiveSector("Technology", "Software - Infrastructure", blockDesc);
  check(
    `Block/Square wird zu Financial Services reklassifiziert (tatsächlich: ${result.sector})`,
    result.sector === "Financial Services"
  );
}

console.log("\n=== Regressionsschutz: bestehende Reklassifizierungen unverändert ===");
{
  // Semiconductor-Sonderfall (bereits vor dem Fix vorhanden)
  const nxpDesc = "NXP Semiconductors provides microcontroller and power semiconductor "
    + "solutions for automotive and IoT applications.";
  const result = getEffectiveSector("Financial Services", "Semiconductors", nxpDesc);
  check(
    `Semiconductor-Sonderfall unverändert: Technology (tatsächlich: ${result.sector})`,
    result.sector === "Technology" && result.industry === "Semiconductors"
  );
}
{
  // Cloud/Tech-Platform-Reklassifizierung (bereits vor dem Fix vorhanden)
  const amznLikeDesc = "The company operates a cloud computing platform (similar to "
    + "Amazon Web Services) providing infrastructure and SaaS offerings, alongside "
    + "its e-commerce marketplace.";
  const result = getEffectiveSector("Consumer Cyclical", "Internet Retail", amznLikeDesc);
  check(
    `Cloud/Tech-Platform-Reklassifizierung unverändert: Technology (tatsächlich: ${result.sector})`,
    result.sector === "Technology" && result.isHybrid === true
  );
}
{
  // Unveränderter Normalfall: kein Trigger, Sektor bleibt wie von FMP gemeldet
  const genericDesc = "A traditional retail chain selling consumer goods across "
    + "multiple store locations.";
  const result = getEffectiveSector("Consumer Defensive", "Grocery Stores", genericDesc);
  check(
    `Normalfall ohne Trigger bleibt unverändert (tatsächlich: ${result.sector}/${result.industry})`,
    result.sector === "Consumer Defensive" && result.industry === "Grocery Stores" && !result.isHybrid
  );
}

console.log("\n=== Grenzfall: einzelne beiläufige Erwähnung reicht nicht mehr ===");
{
  // EIN einzelner Treffer ("payment") ohne "primarily/core business" und ohne
  // weitere Fintech-Phrasen darf NICHT mehr reklassifizieren (Kernregel des Fixes).
  const singleMentionDesc = "A hardware manufacturer of consumer electronics devices "
    + "including smartphones and IoT products, which also offers a payment app as "
    + "one of many auxiliary services.";
  const result = getEffectiveSector("Technology", "Consumer Electronics", singleMentionDesc);
  check(
    `einzelne "payment"-Erwähnung + Hardware-Kernbegriff → bleibt Technology (tatsächlich: ${result.sector})`,
    result.sector === "Technology"
  );
}

console.log(failed === 0 ? "\n✅ Alle Sektor-Klassifikations-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
