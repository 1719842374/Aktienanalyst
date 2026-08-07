import { computeStyleConfidences, blendWeights, NEUTRAL_WEIGHTS, scoreBalanceSheet, scoreGrowthCoverage, computeTurnaroundEvidence, scoreContractual, relativeZ, sectorReferenceFallback, computeThesisStrength } from "../server/thesis-strength";
let failed=0, total=0; const check=(n:string,c:boolean,d="")=>{total++;if(c)console.log(`  ✅ ${n}`);else{failed++;console.error(`  ❌ ${n} ${d}`)}};
console.log("\n=== Thesis Strength Score ===");
const dominant=computeStyleConfidences({revenueCagr3to5y:8,earningsVolatility:70,fcfMarginTrend:0,leverageTrend:1,marginInflectionStrength:9,growthGap:-8});
check("Konfidenzmischung: klarer Stil hat dominantes Gewicht", Math.max(...Object.values(dominant))>.30,JSON.stringify(dominant));

// REGRESSIONSTEST (07.08.2026, Folge-Ticket "Fix: Thesis-Score Klassifikation
// / Konfidenz-Mix"): Live-Beweis MSFT zeigte einen harten 100%-Kollaps auf
// Stalwart, waehrend das bestehende lynchClass-Feld "fast_grower" meldete.
// Root Cause war eine viel zu hohe Softmax-Temperatur (250) auf eng
// beieinanderliegenden Cosine-Similarities. Dieser Test reproduziert exakt
// das MSFT-Profil (moderates Gesamt-CAGR, niedrige Volatilitaet, stabile
// Trends -- typisch fuer einen Mega-Cap mit einem schnell wachsenden
// Cloud-Segment) und verlangt: kein Stil > 90%, UND Fast Grower bleibt klar
// sichtbar (> 15%) wenn das Lynch-Label "fast_grower" ist.
const msftLikeVector={revenueCagr3to5y:14.5,earningsVolatility:8,fcfMarginTrend:0,leverageTrend:0.3,marginInflectionStrength:1.2,growthGap:7.37};
const msftConfNoLynch=computeStyleConfidences(msftLikeVector as any);
check("Kein 100%-Kollaps ohne Lynch-Label (max < 90%)", Math.max(...Object.values(msftConfNoLynch))<.90, JSON.stringify(msftConfNoLynch));
const msftConfWithLynch=computeStyleConfidences(msftLikeVector as any, "fast_grower");
check("Fast Grower bleibt sichtbar (>15%) wenn Lynch-Label = fast_grower", msftConfWithLynch["Fast Grower"]>.15, JSON.stringify(msftConfWithLynch));
check("Kein 100%-Kollaps auch mit Lynch-Boost (max < 90%)", Math.max(...Object.values(msftConfWithLynch))<.90, JSON.stringify(msftConfWithLynch));
check("Denoising-Floor: kein Stil exakt 0% (immer >= 2%)", Object.values(msftConfWithLynch).every(v=>v>=.02), JSON.stringify(msftConfWithLynch));
// Kontrollfall: ein WIRKLICH eindeutiger Zykliker darf trotzdem hoch genug
// ausfallen -- der Floor darf echte Klarheit nicht kuenstlich verwaschen.
const clearCyclical=computeStyleConfidences({revenueCagr3to5y:15,earningsVolatility:80,fcfMarginTrend:0,leverageTrend:0,marginInflectionStrength:5,growthGap:10} as any);
check("Eindeutiger Zykliker (Vektor praktisch identisch zum Cyclical-Prototyp) bleibt klar dominant (>50%)", clearCyclical["Cyclical"]>.50, JSON.stringify(clearCyclical));
const neutral={"Fast Grower":.2,"Stalwart":.2,"Cyclical":.2,"Turnaround":.2,"Value/Asset":.2} as any; check("Neutral-Fallback nutzt neutrale Gewichte",JSON.stringify(blendWeights(neutral))===JSON.stringify(NEUTRAL_WEIGHTS));
check("Inventory-Malus bei z>1.2 und schwachem Wachstum",scoreBalanceSheet({inventoryZ:1.3,growthZ:-.1,marginZ:0,marginPositivePeriods:0,turnaroundConfidence:0,turnaroundEvidence:0}).normalScore<.70);
check("Kein Inventory-Malus bei positivem Wachstum",scoreBalanceSheet({inventoryZ:1.3,growthZ:.1,marginZ:0,marginPositivePeriods:0,turnaroundConfidence:0,turnaroundEvidence:0}).normalScore===.70);
check("Margin-Signal verlangt Persistenz",scoreBalanceSheet({inventoryZ:0,growthZ:0,marginZ:1.2,marginPositivePeriods:1,turnaroundConfidence:0,turnaroundEvidence:0}).normalScore===.70);
check("Persistentes Margin-Signal wirkt",scoreBalanceSheet({inventoryZ:0,growthZ:0,marginZ:1.2,marginPositivePeriods:2,turnaroundConfidence:0,turnaroundEvidence:0}).normalScore>.70);
const neg=scoreGrowthCoverage({fcf:-1,gStar:8,thesisGrowth:30});check("Negativer FCF setzt S_C fest auf 0.40",neg.score===.4&&neg.flags.some(x=>x.includes("Reverse-DCF")));
const cap=scoreGrowthCoverage({fcf:1,gStar:10,thesisGrowth:100});check("g_thesis-Cap auf exakt 1.5× g_required",cap.gThesis===15&&cap.gRequired===10,String(cap.gThesis));
const one=computeTurnaroundEvidence({margins:[1,2,3,4]});check("Ein Turnaround-Signal bleibt bei maximal 0.20",one.evidence<=.20,String(one.evidence));
const two=computeTurnaroundEvidence({margins:[1,2,3,4],leverage:[5,4,3,2]});check("Zwei persistente Signale erhöhen TurnaroundEvidence",two.evidence>.20,String(two.evidence));
const d0=scoreBalanceSheet({inventoryZ:0,growthZ:0,marginZ:0,marginPositivePeriods:0,turnaroundConfidence:.5,turnaroundEvidence:.2});check("Evidence <0.35 löst keinen D-Boost aus",d0.score===d0.normalScore);
const a=scoreContractual(false);check("Fehlende Backlog-Daten neutral 0.375 + Flag",a.score===.375&&a.flags.length>0);
check("Sektor-Referenz mit fehlendem std liefert z=0",relativeZ(.2,.1,null)===0);
const sectorFallback=sectorReferenceFallback(4);check("<5 Peers neutralisieren z-Scores und setzen den Transparenz-Flag",sectorFallback.neutral&&sectorFallback.flags.includes("Sektor-Referenz nicht belastbar (<5 Peers)"));
const msft=computeThesisStrength({vector:{revenueCagr3to5y:16,earningsVolatility:20,fcfMarginTrend:1,leverageTrend:1,marginInflectionStrength:3,growthGap:5},fcf:100,gStar:8,thesisGrowth:26,sectorGrowthMedian:8,backlogAvailable:false,catalysts:[{name:"Server Azure",context:"31.5% Wachstum"}],segmentName:"Server",balance:{inventoryZ:0,growthZ:1,marginZ:1,marginPositivePeriods:3},turnaround:{}});check("MSFT-Regression: plausibler Score >6",msft.finalScore>6,`${msft.finalScore}`);
console.log(`\n${total-failed}/${total} Checks grün.`); if(failed)process.exit(1);
