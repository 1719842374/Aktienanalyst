import { computeThesisStrength, scoreCatalystAlignment, scoreCatalystConfidenceFromE } from "../server/thesis-strength";

let failed=0, total=0;
const check=(name:string,condition:boolean,detail="")=>{total++;if(condition)console.log(`  ✅ ${name}`);else{failed++;console.error(`  ❌ ${name} ${detail}`);}};
const msftCatalysts=[
  {name:"Azure AI demand",timeline:"6-12M",pos:78,nettoUpside:10.6,generic:false},
  {name:"Copilot monetisation",timeline:"12-18M",pos:73,nettoUpside:14.7,generic:false},
  {name:"Cloud operating leverage",timeline:"12-24M",pos:80,nettoUpside:12.6,generic:false},
  {name:"Security cross-sell",timeline:"12-36M",pos:70,nettoUpside:8.6,generic:false},
];

console.log("\n=== E-Score KI-Katalysatoren ===");
const four=scoreCatalystAlignment(msftCatalysts);
// GB_total=0.34427, GB_norm=1.00; Q=0.9125; ConfidenceFactor=1.00 -> E=0.9125.
console.log(`  MSFT-Beispiel E=${four.score.toFixed(4)} | ${four.flags.join(" | ")}`);
check("Vier valide firmenspezifische Katalysatoren werden gezählt",four.flags.some(f=>f.includes("erhalten: 4, valide für E-Score: 4")),JSON.stringify(four));
check("Vier valide Katalysatoren erhalten ConfidenceFactor 1.00",four.flags.some(f=>f.includes("ConfidenceFactor=1.00")),JSON.stringify(four));
check("MSFT-Beispiel liegt in plausibler hoher Größenordnung",four.score>.85&&four.score<.95,`${four.score}`);

const one=scoreCatalystAlignment([msftCatalysts[0]]);
check("Ein valider Katalysator erhält ConfidenceFactor 0.40",one.flags.some(f=>f.includes("ConfidenceFactor=0.40")),JSON.stringify(one));
check("Ein valider Katalysator erhält den transparenten 0.40-Cap-Flag",one.flags.some(f=>f.includes("zu wenige firmenspezifische")),JSON.stringify(one));
check("Ein valider Katalysator ergibt einen niedrigen E-Score",one.score>0&&one.score<.20,`${one.score}`);

const none=scoreCatalystAlignment([]);
check("Keine Katalysatoren ergeben den neutralen E-Score 0.35",none.score===.35&&none.flags.some(f=>f.includes("Keine Katalysatoren verfügbar")),JSON.stringify(none));
const genericOnly=scoreCatalystAlignment([{name:"Template",timeline:"6-12M",pos:70,nettoUpside:12,generic:true}]);
// Alle generic:true sind nicht valide; dies nutzt bewusst denselben neutralen
// Fallback wie keine Daten, statt Template-Daten als firmenspezifisch zu werten.
check("Ausschließlich generische Katalysatoren ergeben den neutralen Fallback",genericOnly.score===.35&&genericOnly.flags.some(f=>f.includes("valide für E-Score: 0")),JSON.stringify(genericOnly));

check("Katalysator-Konfidenz: E=0.90 ergibt exakt 0.81",scoreCatalystConfidenceFromE(.90)===.81,`${scoreCatalystConfidenceFromE(.90)}`);
check("Katalysator-Konfidenz: E=1.00 wird bei 0.85 gedeckelt",scoreCatalystConfidenceFromE(1)===.85,`${scoreCatalystConfidenceFromE(1)}`);
const thesis=computeThesisStrength({vector:{revenueCagr3to5y:12,earningsVolatility:10,fcfMarginTrend:0,leverageTrend:0,marginInflectionStrength:2,growthGap:0},fcf:100,gStar:5,thesisGrowth:8,backlogAvailable:true,catalysts:msftCatalysts,balance:{inventoryZ:0,growthZ:0,marginZ:0,marginPositivePeriods:2},turnaround:{}});
check("computeThesisStrength gibt catalystConfidence additiv zurück",Math.abs(thesis.catalystConfidence-scoreCatalystConfidenceFromE(thesis.subScores.E))<1e-12,JSON.stringify({E:thesis.subScores.E,catalystConfidence:thesis.catalystConfidence}));

console.log(`\n${total-failed}/${total} Checks grün.`);
if(failed)process.exit(1);
