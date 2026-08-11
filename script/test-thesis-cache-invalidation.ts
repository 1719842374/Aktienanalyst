import {
  catalystSignature,
  invalidateThesisStrengthCache,
  thesisStrengthCache,
} from "../server/thesis-strength-cache";

let failed = 0;
let total = 0;
const check = (name: string, condition: boolean, detail = "") => {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name} ${detail}`);
  }
};

console.log("\n=== Thesis-Strength-Cache: Signatur + Invalidierung ===");

const genericCatalysts = [
  { name: "Margenverbesserung", generic: true },
  { name: "Marktwachstum", generic: true },
  { name: "Operativer Hebel", generic: true },
  { name: "Kapitalrückführung", generic: true },
];
const specificCatalysts = [
  { name: "Neue Produktplattform", generic: false },
  { name: "Internationaler Rollout", generic: false },
  { name: "Vertragsverlängerung", generic: false },
  { name: "Kapazitätserweiterung", generic: false },
  { name: "Preisdurchsetzung", generic: false },
];

const genericSignature = catalystSignature(genericCatalysts);
const specificSignature = catalystSignature(specificCatalysts);
check(
  "Unterschiedliche Katalysator-Sets erhalten unterschiedliche Signaturen",
  genericSignature !== specificSignature,
  `${genericSignature} vs ${specificSignature}`,
);
check(
  "Identische Katalysatoren behalten eine deterministische Signatur",
  genericSignature === catalystSignature(genericCatalysts.map(c => ({ ...c }))),
  `${genericSignature}`,
);

thesisStrengthCache.clear();
thesisStrengthCache.set(`TEST::${genericSignature}`, { data: { score: "alt" }, time: Date.now() });
thesisStrengthCache.set(`TEST::${specificSignature}`, { data: { score: "neu" }, time: Date.now() });
thesisStrengthCache.set(`ANDERER::${genericSignature}`, { data: { score: "unberührt" }, time: Date.now() });
invalidateThesisStrengthCache("test");

check(
  "Invalidierung entfernt alle Cache-Signaturvarianten des Tickers",
  !Array.from(thesisStrengthCache.keys()).some(key => key.startsWith("TEST::")),
  JSON.stringify(Array.from(thesisStrengthCache.keys())),
);
check(
  "Invalidierung lässt Einträge anderer Ticker unverändert",
  thesisStrengthCache.has(`ANDERER::${genericSignature}`),
  JSON.stringify(Array.from(thesisStrengthCache.keys())),
);

thesisStrengthCache.clear();
console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
