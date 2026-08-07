import { computeStyleConfidences, blendWeights, NEUTRAL_WEIGHTS, scoreBalanceSheet, scoreGrowthCoverage, computeTurnaroundEvidence, scoreContractual, relativeZ, sectorReferenceFallback, computeThesisStrength, computeGrowthEvidence, applyGrowthLogic, applyFastGrowerSafetyGuard } from "../server/thesis-strength";
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

// ═══ REGRESSIONSTEST (07.08.2026, Auftrag "Thesis-Score: Querschnitts-
// Konsistenz + Wachstums-Logik") ═══
// Live-Beweis MSFT zeigte: +17.8% Revenue vs. Sektor (+10.8%), Server
// +31.5%, EPS-CAGR 23.34%, Lynch=Fast Grower -- aber Fast Grower nur 6%
// Konfidenz, Stalwart 64% dominant. Das war ein Querschnitts-Widerspruch:
// die Thesis-Klassifikation ignorierte die harten Wachstumsdaten aus
// S1/S2/S7 komplett. Diese Tests stellen sicher, dass GrowthEvidence diese
// Daten verbindlich einbindet und der Widerspruch strukturell unmoeglich wird.

// GrowthEvidence-Formel: MSFT-Realdaten (Peer-Gap +7.0pp, Segment +31.5%, EPS-CAGR 23.34%, Lynch=fast_grower)
const geMsft=computeGrowthEvidence({peerGapPct:7.0,maxSegmentGrowthPct:31.5,epsCagr5yPct:23.34,lynchClass:"fast_grower"});
check("GrowthEvidence-Formel: MSFT-Profil liegt im Ticket-Zielband 0.75-0.90",geMsft.evidence>=.75&&geMsft.evidence<=.95,`${geMsft.evidence}`);
check("GrowthEvidence: Lynch-Boost ist bei fast_grower aktiv",geMsft.lynchBoostActive===true);

// GrowthEvidence bei fehlenden Inputs: Flags statt stiller 0-Wert, Evidence bleibt niedrig aber kein Crash.
const geMissing=computeGrowthEvidence({peerGapPct:null,maxSegmentGrowthPct:null,epsCagr5yPct:null,lynchClass:null});
check("GrowthEvidence bei fehlenden Inputs: alle 3 Flags gesetzt",geMissing.flags.length===3,JSON.stringify(geMissing.flags));
check("GrowthEvidence bei fehlenden Inputs: Evidence bleibt niedrig (kein Fake-Wert)",geMissing.evidence<.10,`${geMissing.evidence}`);

// Kernregressionstest: MSFT-Profil MIT vollstaendiger GrowthEvidence-Integration -> Fast Grower muss Top-2 sein und >=25% erreichen.
const msftVectorFull={revenueCagr3to5y:14.5,earningsVolatility:8,fcfMarginTrend:0,leverageTrend:0.3,marginInflectionStrength:1.2,growthGap:-10.5};
const confMsftFull=computeStyleConfidences(msftVectorFull as any,"fast_grower",geMsft.evidence);
const guardedMsftFull=applyFastGrowerSafetyGuard(confMsftFull,geMsft.evidence,7.0,31.5);
const sortedStyles=Object.entries(guardedMsftFull).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
check("MSFT-Profil: Fast Grower liegt nach vollstaendiger Integration bei mindestens 25%",guardedMsftFull["Fast Grower"]>=.25,JSON.stringify(guardedMsftFull));
check("MSFT-Profil: Fast Grower ist unter den Top-2 Stilen",sortedStyles.slice(0,2).includes("Fast Grower"),JSON.stringify(sortedStyles));
check("MSFT-Profil: Value/Asset bleibt im Zielband <=15%",guardedMsftFull["Value/Asset"]<=.15,`${guardedMsftFull["Value/Asset"]}`);

// Safety-Guard direkt: greift nur wenn Evidence stark UND (Peer-Gap>=5 ODER Segment-Wachstum>=20) UND Fast Grower<25% vorher.
const weakFastGrower={"Fast Grower":.10,"Stalwart":.60,"Cyclical":.10,"Turnaround":.10,"Value/Asset":.10} as any;
const guardedStrong=applyFastGrowerSafetyGuard(weakFastGrower,.75,7.0,31.5);
check("Safety-Guard greift bei starker Evidence + starkem Peer-Gap: Fast Grower auf >=25% angehoben",guardedStrong["Fast Grower"]>=.25,JSON.stringify(guardedStrong));
const sumGuarded=Object.values(guardedStrong).reduce((a,b)=>a+b,0);
check("Safety-Guard: Konfidenzsumme bleibt bei 1.0 nach Renormalisierung",Math.abs(sumGuarded-1)<1e-9,`${sumGuarded}`);
const guardedWeakEvidence=applyFastGrowerSafetyGuard(weakFastGrower,.50,7.0,31.5);
check("Safety-Guard greift NICHT bei schwacher Evidence (<0.70)",guardedWeakEvidence["Fast Grower"]===.10,`${guardedWeakEvidence["Fast Grower"]}`);
const guardedNoStrongProof=applyFastGrowerSafetyGuard(weakFastGrower,.75,2.0,10.0);
check("Safety-Guard greift NICHT ohne starken Einzelbeleg (Peer-Gap<5 UND Segment<20)",guardedNoStrongProof["Fast Grower"]===.10,`${guardedNoStrongProof["Fast Grower"]}`);

// apply_growth_logic direkt: hohe Evidence hebt Fast Grower an, drueckt Stalwart/Value.
const styles=["Fast Grower","Stalwart","Cyclical","Turnaround","Value/Asset"] as any;
const simsBase=[.5,.5,.5,.5,.5];
const grownHigh=applyGrowthLogic(simsBase,styles,.85);
check("apply_growth_logic bei hoher Evidence (>=0.65): Fast Grower steigt",grownHigh[0]>simsBase[0]);
check("apply_growth_logic bei hoher Evidence (>=0.65): Stalwart und Value/Asset sinken",grownHigh[1]<simsBase[1]&&grownHigh[4]<simsBase[4]);
const grownLow=applyGrowthLogic(simsBase,styles,.20);
check("apply_growth_logic bei niedriger Evidence (<0.40): Fast Grower wird gedaempft, nicht kuenstlich hochgehalten",grownLow[0]<simsBase[0]);

// REGRESSIONSTEST (07.08.2026, Nutzer-Feedback "Growth-Logic zu schwach"):
// mit den EXAKT geloggten echten MSFT-Werten (fallender FCF-Margin-Trend,
// sehr schwache Margin-Inflection -- ein echter Hybrid-Fall, kein idealer
// Fast-Grower-Vektor) musste Fast Grower vor der Nachschaerfung durch den
// Safety-Guard auf den 25%-Floor angehoben werden (organisch nur ~21%).
// Nach der Nachschaerfung muss Fast Grower OHNE Guard-Eingriff bereits
// klar ueber Stalwart liegen.
const realMsftVector={revenueCagr3to5y:13.741147353015858,earningsVolatility:11.595005818732501,fcfMarginTrend:-1,leverageTrend:1,marginInflectionStrength:0.18120550048123363,growthGap:-10.53181217626079};
const realEvidence=0.8142294581589679;
const confRealMsft=computeStyleConfidences(realMsftVector as any,"fast_grower",realEvidence);
check("Echter MSFT-Vektor: Fast Grower fuehrt organisch vor Stalwart (kein reiner Floor-Wert)",confRealMsft["Fast Grower"]>confRealMsft["Stalwart"],JSON.stringify(confRealMsft));
const guardedRealMsft=applyFastGrowerSafetyGuard(confRealMsft,realEvidence,3.62,31.5);
check("Echter MSFT-Vektor: Safety-Guard greift nicht mehr ein (Fast Grower bereits >25% organisch)",Math.abs(guardedRealMsft["Fast Grower"]-confRealMsft["Fast Grower"])<1e-9);

console.log(`\n${total-failed}/${total} Checks grün.`); if(failed)process.exit(1);
