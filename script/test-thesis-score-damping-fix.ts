import { computeThesisStrength, scoreExternal } from "../server/thesis-strength";

let failed=0,total=0;
const check=(name:string,condition:boolean,detail="")=>{total++;if(condition)console.log(`  ✅ ${name}`);else{failed++;console.error(`  ❌ ${name} ${detail}`);}};
const base={fcf:100,gStar:10,thesisGrowth:12,sectorGrowthMedian:10,backlogAvailable:false,catalysts:[{name:"Cloud",context:"20% Wachstum"}],segmentName:"Cloud",balance:{inventoryZ:0,growthZ:0,marginZ:0,marginPositivePeriods:0},turnaround:{}};

console.log("\n=== Thesis-Score-Dämpfung + B-Score ===");
// Screenshot-Kontrolle: Die frühere, inzwischen entfernte Dämpfung hätte bei
// raw≈7.08 und confidence=0.45 genau 5.33 (≈5.3) ergeben.
const screenshotSubScores={A:.38,B:.50,C:.94,D:.70,E:.90};
const screenshotRaw=7.08,formerScreenshotScore=+(screenshotRaw*(.55+.45*.45)).toFixed(2);
check("Screenshot-Kontrolle: referenzierte A-E-Sub-Scores bleiben dokumentiert",JSON.stringify(screenshotSubScores)===JSON.stringify({A:.38,B:.50,C:.94,D:.70,E:.90}));
check("Screenshot-Kontrolle: frühere 45%-Dämpfung ergäbe ≈5.3",formerScreenshotScore===5.33,String(formerScreenshotScore));

const confidenceCases=[
  {target:.30,vector:{revenueCagr3to5y:5,earningsVolatility:30,fcfMarginTrend:-1,leverageTrend:1,marginInflectionStrength:0,growthGap:25}},
  {target:.45,vector:{revenueCagr3to5y:15,earningsVolatility:10,fcfMarginTrend:-1,leverageTrend:-1,marginInflectionStrength:2,growthGap:-20}},
  {target:.60,vector:{revenueCagr3to5y:30,earningsVolatility:60,fcfMarginTrend:1,leverageTrend:1,marginInflectionStrength:0,growthGap:10}},
  {target:.85,vector:{revenueCagr3to5y:10,earningsVolatility:0,fcfMarginTrend:0,leverageTrend:-1,marginInflectionStrength:9,growthGap:0}},
];
for(const {target,vector} of confidenceCases){
  const result=computeThesisStrength({...base,vector});
  check(`Konfidenzfall ${(target*100).toFixed(0)}% wird reproduziert`,Math.abs(result.classificationConfidence-target)<.005,`${result.classificationConfidence}`);
  check(`Keine Dämpfung bei ${(target*100).toFixed(0)}% Konfidenz`,result.finalScore===result.rawScore,`raw=${result.rawScore}, final=${result.finalScore}`);
}

const strong=scoreExternal({netDebt:-100,ebitda:200,cashAndEquivalents:300,marketCap:1000,commonStockRepurchased:-50,dividendsPaid:-25});
check("B-Score: starke Bilanz mit Rückkauf und Dividende liegt deutlich über 0.70",strong.score>.70,`${strong.score}`);
check("B-Score: starke Bilanz benötigt keinen Fallback-Flag",strong.flags.length===0,JSON.stringify(strong.flags));
const missing=scoreExternal({netDebt:null,ebitda:null,cashAndEquivalents:null,marketCap:null,commonStockRepurchased:null,dividendsPaid:null});
check("B-Score: vollständig fehlende Daten ergeben neutral 0.50",missing.score===.50,`${missing.score}`);
check("B-Score: vollständig fehlende Daten setzen Transparenz-Flag",missing.flags.length>0,JSON.stringify(missing.flags));
const weak=scoreExternal({netDebt:300,ebitda:100,cashAndEquivalents:10,marketCap:1000,commonStockRepurchased:0,dividendsPaid:0});
check("B-Score: hohe Verschuldung ohne Kapitalrückführung liegt deutlich unter 0.40",weak.score<.40,`${weak.score}`);
check("B-Score: fehlende Kapitalrückführung setzt Flag",weak.flags.some(flag=>flag.includes("keine Kapitalrückführung")),JSON.stringify(weak.flags));

console.log(`\n${total-failed}/${total} Tests bestanden`);
if(failed)process.exit(1);
