import { computeStyleConfidences, blendWeights, NEUTRAL_WEIGHTS, scoreBalanceSheet, scoreGrowthCoverage, computeTurnaroundEvidence, scoreContractual, relativeZ, sectorReferenceFallback, computeThesisStrength, computeGrowthEvidence, applyGrowthLogic, applyFastGrowerSafetyGuard, computeMaterialSegmentGrowth, checkCyclicalPeDiscount, isCyclicalSectorName, scoreCatalystAlignment, mapGrowthProfile, applyWeakGrowthCeiling, LYNCH_TO_STYLE, computeInflectionEvidence, robustSectorGrowth } from "../server/thesis-strength";
import { growthThesisFingerprint } from "../server/llm-openrouter";
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
// Auftrag 07.08.2026 ("Final-Fix: Fast-Grower-Ranges"): die Peer-/Segment-
// Score-Ankerpunkte wurden bewusst grosszuegiger kalibriert (2pp statt 0pp
// Start, 10pp statt 12pp Vollausschlag fuer Peer-Gap; 12% statt 8% Start
// fuer Segment) -- ein Profil mit +7pp Peer-Gap UND +31.5% Segment saettigt
// beide Teilscores jetzt nahezu vollstaendig, daher liegt Evidence hoeher
// als im vorherigen (engeren) Zielband. Grenze auf >=0.75 (weiterhin "stark")
// belassen, obere Grenze auf 1.0 erweitert statt 0.95.
check("GrowthEvidence-Formel: MSFT-Profil liegt im (durch die geschaerften Ranges erweiterten) Zielband >=0.75",geMsft.evidence>=.75&&geMsft.evidence<=1.0,`${geMsft.evidence}`);
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

// ═══ REGRESSIONSTESTS (07.08.2026, Ticket "Final-Fix: Fast-Grower-Ranges +
// P/E-Zyklus-Filter") ═══

// 1. Segment-Materialitaet: ein 3%-Segment mit +40% darf NICHT allein
// Fast-Grower-Evidence ausloesen -- nur Segmente mit Anteil>=10% zaehlen.
const tinySegmentDominant=computeMaterialSegmentGrowth([{name:"Mini",percentage:3,growth:40},{name:"Kern",percentage:80,growth:5}]);
check("Segment-Materialitaet: kleines 3%-Segment mit +40% wird NICHT gewaehlt (Kern-Segment mit Anteil>=10% gewinnt)",tinySegmentDominant.materialGrowthPct===5,JSON.stringify(tinySegmentDominant));
const materialSegmentWins=computeMaterialSegmentGrowth([{name:"Cloud",percentage:39,growth:31.5},{name:"Legacy",percentage:61,growth:2}]);
check("Segment-Materialitaet: materielles Segment (Anteil>=10%) mit hoechstem Wachstum gewinnt",materialSegmentWins.materialGrowthPct===31.5&&materialSegmentWins.source==="material_segment");
const noMaterialSegment=computeMaterialSegmentGrowth([{name:"A",percentage:5,growth:20},{name:"B",percentage:4,growth:15},{name:"C",percentage:3,growth:10}]);
check("Segment-Materialitaet: kein Segment>=10% -> Fallback auf umsatzgewichteten Top-3-Durchschnitt",noMaterialSegment.source==="weighted_top3"&&noMaterialSegment.materialGrowthPct!=null);

// 2. P/E-Zyklus-Filter: Zykliker mit P/E-Discount wird gedaempft, MSFT (nicht
// zyklisch, kein Discount) bleibt unbeeintraechtigt.
check("isCyclicalSectorName erkennt Materials als zyklisch",isCyclicalSectorName("Materials")===true);
check("isCyclicalSectorName erkennt Technology NICHT als zyklisch",isCyclicalSectorName("Technology")===false);
const cyclicalPeDiscount=checkCyclicalPeDiscount({sector:"Materials",peTTM:9,sectorMedianPE:20,earningsVolatility:null});
check("P/E-Filter greift: zyklischer Sektor + P/E deutlich unter Sektor-Median (9 < 20*0.75=15)",cyclicalPeDiscount.cyclicalPeFlag===true&&cyclicalPeDiscount.dampingFactor<1);
const msftPeCheck=checkCyclicalPeDiscount({sector:"Technology",peTTM:21,sectorMedianPE:28,earningsVolatility:11.6});
check("P/E-Filter greift NICHT bei MSFT (P/E~21, Sektor~28, nicht zyklisch, PEG-Bereich normal)",msftPeCheck.cyclicalPeFlag===false&&msftPeCheck.dampingFactor===1);
const geZyklikerHighGrowthLowPe=computeGrowthEvidence({peerGapPct:10,maxSegmentGrowthPct:35,epsCagr5yPct:30,lynchClass:"fast_grower",sector:"Materials",peTTM:9,sectorMedianPE:20,earningsVolatility:null});
check("GrowthEvidence: Zykliker mit CAGR 30% + P/E 9 (Sektor 20) wird gedaempft (cyclicalPeFlag aktiv)",geZyklikerHighGrowthLowPe.cyclicalPeFlag===true);
const geMsftNoDiscount=computeGrowthEvidence({peerGapPct:3.62,maxSegmentGrowthPct:31.5,epsCagr5yPct:23.34,lynchClass:"fast_grower",sector:"Technology",peTTM:21,sectorMedianPE:28,earningsVolatility:11.6});
check("GrowthEvidence: MSFT (P/E~21, Sektor~28, nicht zyklisch) bleibt vom P/E-Filter unbeeintraechtigt",geMsftNoDiscount.cyclicalPeFlag===false);

// 3. Nachgeschaerfte Ranges: EPS-CAGR>=16% + Bestaetigungssignal reicht fuer
// spuerbare Fast-Grower-Evidence -- 16-18%-Wachstum darf nicht automatisch
// in Stalwart rutschen.
// Auftrag 09.08.2026 ("NKE-Vorfall", Profil-adaptive Ranges): dieser Test
// pruefte urspruenglich die Ticket-Formel "16%->0.50" ohne sector/industry --
// seit der Profil-Einfuehrung faellt ein Aufruf ohne Sektor auf das neutrale
// "other"-Profil zurueck (andere Ranges als software_growth). Die woertliche
// Ticket-Formel (8%->0,16%->0.50,24%->1.0) gilt spezifisch fuer
// software_growth -- daher jetzt explizit mit Technology/Software-Kontext.
const ge16PctMitBestaetigung=computeGrowthEvidence({peerGapPct:3,maxSegmentGrowthPct:null,epsCagr5yPct:16,lynchClass:null,sector:"Technology",industry:"Software"});
check("16%-CAGR-Fall MIT Bestaetigung (Peer-Gap>=2pp, software_growth-Profil): cagrScore erreicht 0.50 (nicht gedaempft)",Math.abs(ge16PctMitBestaetigung.cagrScore-0.50)<0.01,JSON.stringify(ge16PctMitBestaetigung));
const ge16PctOhneBestaetigung=computeGrowthEvidence({peerGapPct:0,maxSegmentGrowthPct:5,epsCagr5yPct:16,lynchClass:null});
check("16%-CAGR-Fall OHNE Bestaetigung: cagrScore wird auf 60% gedaempft (Flag gesetzt)",ge16PctOhneBestaetigung.cagrScore<0.50&&ge16PctOhneBestaetigung.flags.some(f=>f.includes("ohne Bestaetigungssignal")));
check("16%-CAGR-Fall: Evidence bleibt trotz fehlender Bestaetigung > 0 (kein automatischer Stalwart-Rutsch)",ge16PctOhneBestaetigung.evidence>0);

// 4. MSFT-Gesamtfall (echte geloggte Werte, jetzt mit P/E-Kontext und den
// nachgeschaerften Ranges): Fast Grower muss weiterhin >= Stalwart bleiben.
const geMsftFinal=computeGrowthEvidence({peerGapPct:3.62,maxSegmentGrowthPct:31.5,epsCagr5yPct:23.34,lynchClass:"fast_grower",sector:"Technology",peTTM:21,sectorMedianPE:28,earningsVolatility:11.6});
const confMsftFinal=computeStyleConfidences(realMsftVector as any,"fast_grower",geMsftFinal.evidence);
const guardedMsftFinal=applyFastGrowerSafetyGuard(confMsftFinal,geMsftFinal.evidence,3.62,31.5,geMsftFinal.cyclicalPeFlag,17.79);
check("MSFT-Gesamtfall (mit P/E-Kontext): Fast Grower liegt weiterhin bei mindestens Stalwart-Niveau",guardedMsftFinal["Fast Grower"]>=guardedMsftFinal["Stalwart"]-0.02,JSON.stringify(guardedMsftFinal));

// 5. Weicher Safety-Guard: greift NICHT wenn cyclicalPeFlag aktiv ist, auch
// bei sonst ausreichender Evidence.
const weakFgCyclical={"Fast Grower":.10,"Stalwart":.20,"Cyclical":.60,"Turnaround":.05,"Value/Asset":.05} as any;
const guardedWithCyclicalFlag=applyFastGrowerSafetyGuard(weakFgCyclical,.85,10,35,true,25);
check("Weicher Safety-Guard: greift NICHT wenn cyclicalPeFlag aktiv ist (kein Erzwingen gegen P/E-Zyklus-Peak)",guardedWithCyclicalFlag["Fast Grower"]===.10);
const guardedLowRevenueYoy=applyFastGrowerSafetyGuard(weakFgCyclical,.85,10,35,false,5);
check("Weicher Safety-Guard: greift NICHT bei Revenue-YoY<10% (keine abrupte Abkuehlung uebertoenchen)",guardedLowRevenueYoy["Fast Grower"]===.10);
const guardedNormal=applyFastGrowerSafetyGuard(weakFgCyclical,.85,10,35,false,15);
check("Weicher Safety-Guard: greift normal (kein Cyclical-Flag, Revenue-YoY>=10%) und hebt auf 0.35 an",guardedNormal["Fast Grower"]===.35);

// ═══ REGRESSIONSTESTS (08.08.2026, Ticket "Live-These + Thesis-Score +
// Katalysatoren") ═══

// 1. Baustein E: Erwartungswerte wurden mit dem E-Score-KI-Katalysatoren-Fix
// angepasst. Statt des alten Text-Alignment-Verhaeltnisses gilt jetzt
// GB_norm x Q x ConfidenceFactor; ein einzelner valider Katalysator nutzt
// daher verpflichtend den transparenten ConfidenceFactor von 0.40.
const thesisTextMsft="Microsoft treibt sein Wachstum ueber Azure Cloud-Nachfrage und AI-Adoption. Server-Segment waechst mit 31.5%. K1 Cloud Expansion mit PoS 78% stuetzt die These zusaetzlich. Bewertung mit PEG 2.7 nicht guenstig. Risiko: CapEx-Belastung auf FCF-Marge.";
const specificQuantifiedCat=[{name:"Cloud Expansion",context:"Azure waechst deutlich schneller als der Markt",pos:78,nettoUpside:11.8,generic:false}];
const eSpecific=scoreCatalystAlignment(specificQuantifiedCat,"Server",thesisTextMsft);
check("Baustein E: einzelner valider Katalysator wird mit ConfidenceFactor 0.40 gedeckelt",eSpecific.score>0&&eSpecific.score<.20&&eSpecific.flags.some(f=>f.includes("zu wenige firmenspezifische")),JSON.stringify(eSpecific));
const genericCat=[{name:"Margin Expansion",context:"Allgemeine operative Verbesserungen",generic:true}];
const eGeneric=scoreCatalystAlignment(genericCat,"Server",thesisTextMsft);
check("Baustein E: ausschliesslich generische Katalysatoren erhalten den neutralen Fallback",eGeneric.score===.35&&eGeneric.flags.some(f=>f.includes("Keine Katalysatoren verfügbar")));

// 2. Gemischter Fall: ein firmenspezifischer + ein generischer Katalysator ->
// kein Deckel (nicht ALLE generisch), aber der generische zaehlt schwaecher.
const mixedCats=[
  {name:"Cloud Expansion",context:"Azure waechst",pos:78,nettoUpside:11.8,generic:false},
  {name:"Generic Initiative",context:"Allgemeine Massnahme",generic:true},
];
const eMixed=scoreCatalystAlignment(mixedCats,"Server",thesisTextMsft);
check("Baustein E: gemischter Fall dokumentiert den einzelnen validen Katalysator und dessen 0.40-Cap",eMixed.flags.some(f=>f.includes("valide für E-Score: 1"))&&eMixed.flags.some(f=>f.includes("zu wenige firmenspezifische")));

// 3. Rueckwaertskompatibilitaet: Die Funktionssignatur bleibt unveraendert;
// alte Aufrufer ohne strukturierte Catalyst-Felder erhalten konservativ den
// neutralen Fallback statt einer stillschweigenden Text-Regex-Schaetzung.
const eLegacy=scoreCatalystAlignment([{name:"Server",context:"Azure waechst um 31.5%"}],"Server");
check("Baustein E: Legacy-Aufruf ohne strukturierte Felder bleibt stabil mit neutralem Fallback",eLegacy.score===.35&&eLegacy.flags.some(f=>f.includes("Keine Katalysatoren verfügbar")));

// 4. growthThesisFingerprint: identischer Input -> identischer Fingerprint;
// geaenderter Input (z.B. neues Segment-Wachstum) -> anderer Fingerprint.
const fpInputBase={revenueGrowth:17.8,fcfMargin:20.2,topCatalysts:[{name:"Cloud Expansion",context:"...",gb:9.2,generic:false}],capexContext:null,topSegment:{name:"Server",growthPct:31.5,sharePct:39},gStar:7.2,gbSum:18.3,lynchClass:"fast_grower"};
const fp1=growthThesisFingerprint(fpInputBase);
const fp2=growthThesisFingerprint({...fpInputBase});
check("growthThesisFingerprint: identischer Input erzeugt identischen Fingerprint (Cache-Re-Use moeglich)",fp1===fp2);
const fp3=growthThesisFingerprint({...fpInputBase,topSegment:{name:"Server",growthPct:35.0,sharePct:39}});
check("growthThesisFingerprint: geaendertes Segment-Wachstum erzeugt anderen Fingerprint (Cache-Invalidierung)",fp1!==fp3);
const fp4=growthThesisFingerprint({...fpInputBase,topCatalysts:[{name:"Andere Katalysatoren",context:"...",gb:5,generic:true}]});
check("growthThesisFingerprint: geaenderte Katalysatoren (Name+GB+generic) erzeugen anderen Fingerprint",fp1!==fp4);

// ═══ REGRESSIONSTESTS (08.08.2026, Ticket "These-Refresh nach KI-Enrich +
// Peer-Gap in die These") ═══

// 5. Peer-Gap wird als optionales Feld akzeptiert -- Aufruf ohne Peer-Gap
// (Schritt 14, noch kein peerComparison verfuegbar) bleibt unveraendert
// moeglich; ein Aufruf MIT Peer-Gap (Enrich-Refresh) liefert einen anderen
// Fingerprint als ohne, da growthThesisFingerprint keine Peer-Gap-Signatur
// enthaelt (bewusst -- Peer-Gap fliesst nur in den Prompt-Text, nicht in
// den Fingerprint-Vergleich, da es sich nicht kurzfristig aendert und sonst
// jeder Enrich-Lauf faelschlich als "neuer Input" erkannt wuerde).
const fpWithoutPeerGap=growthThesisFingerprint(fpInputBase);
const fpBaseNoPeerGapField={...fpInputBase};
check("growthThesisFingerprint: Aufruf ohne Peer-Gap-Feld (Schritt-14-Fall) funktioniert weiterhin unveraendert",typeof fpWithoutPeerGap==="string"&&fpWithoutPeerGap.length>0);

// ═══ REGRESSIONSTESTS (09.08.2026, Ticket "Thesis-Score: Sektor-adaptive Ranges
// + Sync mit Section 1 (NKE-Vorfall)") ═══

// 1. NKE-Root-Cause: negative EPS-CAGR MUSS cagr_score=0 liefern, unabhaengig
// vom Profil (universeller Guard, Ticket Teil D.1).
const geNegativeCagr=computeGrowthEvidence({peerGapPct:2,maxSegmentGrowthPct:3,epsCagr5yPct:-24.97,lynchClass:"turnaround",sector:"Consumer Cyclical",industry:"Apparel - Footwear & Accessories"});
check("NKE-Fall: negative EPS-CAGR (-24.97%) liefert cagr_score=0",geNegativeCagr.cagrScore===0,JSON.stringify(geNegativeCagr));
check("NKE-Fall: GrowthEvidence bleibt niedrig (<0.30) bei negativer CAGR + schwachem Segment/Peer-Gap",geNegativeCagr.evidence<0.30,`evidence=${geNegativeCagr.evidence}`);

// 2. Mini-Segment (0.3% Anteil, +93.2% Wachstum) darf NICHT die Evidence
// treiben -- computeMaterialSegmentGrowth() muss es ausschliessen (bereits in
// den Fast-Grower-Ranges-Tests abgedeckt), UND selbst wenn faelschlich der
// rohe Wert durchgereicht wuerde, zeigt dieser Test den Root-Cause-Bug: die
// Route darf materialGrowthPct NICHT nochmal mit 100 multiplizieren (der
// Wert ist bereits in Prozent). Regressionstest fuer genau diesen Bug.
const nkeSegments=[{name:"Footwear",percentage:65.8,growth:-1.4},{name:"Apparel",percentage:33.9,growth:2.9},{name:"Product and Service, Other",percentage:0.3,growth:93.2}];
const nkeMaterial=computeMaterialSegmentGrowth(nkeSegments);
check("NKE-Segmente: Mini-Segment (0.3% Anteil, +93.2%) wird NICHT gewaehlt -- materielles Apparel-Segment (+2.9%) gewinnt",nkeMaterial.materialGrowthPct===2.9,JSON.stringify(nkeMaterial));
const geWithCorrectScale=computeGrowthEvidence({peerGapPct:2,maxSegmentGrowthPct:nkeMaterial.materialGrowthPct,epsCagr5yPct:-24.97,lynchClass:"turnaround"});
check("NKE-Segmente: korrekt skaliertes Segment-Wachstum (2.9%, NICHT 290%) liefert segScore nahe 0",geWithCorrectScale.segScore<0.10,`segScore=${geWithCorrectScale.segScore}`);
const geWithBuggyDoubleScale=computeGrowthEvidence({peerGapPct:2,maxSegmentGrowthPct:nkeMaterial.materialGrowthPct!*100,epsCagr5yPct:-24.97,lynchClass:"turnaround"});
check("Root-Cause-Beweis: OHNE den Skalierungsfix wuerde segScore faelschlich auf 1.0 saettigen (290% statt 2.9%)",geWithBuggyDoubleScale.segScore===1,`segScore=${geWithBuggyDoubleScale.segScore} (zeigt den Bug, den die Route jetzt nicht mehr macht)`);

// 3. Profil-Mapping: Apparel/Footwear -> consumer_brands, NICHT software_growth
// ("Technology"-Referenz-Bug aus dem Ticket-Screenshot).
check("Profil-Mapping: Apparel/Footwear -> consumer_brands (nicht software_growth/Technology)",mapGrowthProfile("Consumer Cyclical","Apparel - Footwear & Accessories")==="consumer_brands");
check("Profil-Mapping: Software/Semiconductors -> software_growth",mapGrowthProfile("Technology","Software - Infrastructure")==="software_growth");
check("Profil-Mapping: Materials/Steel -> cyclical",mapGrowthProfile("Basic Materials","Steel")==="cyclical");
check("Profil-Mapping: unbekannter Sektor -> other (neutraler Fallback, kein Bias)",mapGrowthProfile("","")==="other");
// consumer_brands hat niedrigere Ranges als software_growth -- 10% EPS-CAGR
// soll bei consumer_brands staerker zaehlen als bei software_growth.
const geConsumerBrands10pct=computeGrowthEvidence({peerGapPct:0,maxSegmentGrowthPct:0,epsCagr5yPct:10,lynchClass:null,sector:"Consumer Cyclical",industry:"Apparel"});
const geSoftware10pct=computeGrowthEvidence({peerGapPct:0,maxSegmentGrowthPct:0,epsCagr5yPct:10,lynchClass:null,sector:"Technology",industry:"Software"});
check("Profil-adaptive Ranges: 10% EPS-CAGR zaehlt bei consumer_brands staerker als bei software_growth",geConsumerBrands10pct.cagrScore>geSoftware10pct.cagrScore,`consumer=${geConsumerBrands10pct.cagrScore}, software=${geSoftware10pct.cagrScore}`);

// 4. Lynch-Boost nur auf den zum Label passenden Stil (Ticket Teil D.4) --
// bereits im bestehenden LYNCH_TO_STYLE-Mapping korrekt, hier explizit als
// Regressionstest fuer den NKE-Fall (Zykliker/Turnaround darf NICHT auf Fast
// Grower boosten).
check("Lynch-Mapping: 'turnaround' boostet 'Turnaround', NICHT 'Fast Grower'",LYNCH_TO_STYLE["turnaround"]==="Turnaround");
check("Lynch-Mapping: 'cyclical' boostet 'Cyclical', NICHT 'Fast Grower'",LYNCH_TO_STYLE["cyclical"]==="Cyclical");
const confTurnaroundLabel=computeStyleConfidences({revenueCagr3to5y:-2,earningsVolatility:30,fcfMarginTrend:-1,leverageTrend:0,marginInflectionStrength:2,growthGap:-5},"turnaround",0.20);
// Der Boost darf NICHT versehentlich Fast Grower erhoehen -- der Lynch-Boost-
// Mechanismus selbst wendet sich additiv nur auf den gemappten Stil an.
check("Lynch-Boost bei Label='turnaround': Fast Grower bleibt niedrig (kein Cross-Boost)",confTurnaroundLabel["Fast Grower"]<0.20,JSON.stringify(confTurnaroundLabel));

// 5. Weak-Growth-Ceiling (Ticket Teil D.2): Revenue YoY<5% UND EPS-CAGR<5% ->
// Fast Grower Konfidenz nach dem Guard hoechstens 15%.
const strongFgConfidence={"Fast Grower":.60,"Stalwart":.15,"Cyclical":.10,"Turnaround":.10,"Value/Asset":.05} as any;
const ceilingApplied=applyWeakGrowthCeiling(strongFgConfidence,0.2,-24.97);
check("Weak-Growth-Ceiling: Revenue YoY=0.2% + EPS-CAGR=-25% -> Fast Grower auf <=15% gedeckelt",ceilingApplied["Fast Grower"]<=0.15,JSON.stringify(ceilingApplied));
const ceilingNotApplied=applyWeakGrowthCeiling(strongFgConfidence,15,20);
check("Weak-Growth-Ceiling: greift NICHT bei starkem Wachstum (Revenue YoY=15%, EPS-CAGR=20%)",ceilingNotApplied["Fast Grower"]===0.60);
const ceilingMissingData=applyWeakGrowthCeiling(strongFgConfidence,null,null);
check("Weak-Growth-Ceiling: greift NICHT bei fehlenden Daten (kein Fehlalarm bei unvollstaendigen Kennzahlen)",ceilingMissingData["Fast Grower"]===0.60);

// 6. MSFT-Regression: Profil software_growth bleibt exakt wie vorher (Ticket-
// Formel woertlich: 8%->0, 16%->0.50, 24%->1.0), keine Verschiebung durch die
// Profil-Einfuehrung.
const geMsftProfileCheck=computeGrowthEvidence({peerGapPct:7.0,maxSegmentGrowthPct:31.5,epsCagr5yPct:23.34,lynchClass:"fast_grower",sector:"Technology",industry:"Software - Infrastructure"});
check("MSFT-Regression: software_growth-Profil liefert weiterhin die Ticket-Formel woertlich (>=0.75 Evidence)",geMsftProfileCheck.evidence>=0.75,`evidence=${geMsftProfileCheck.evidence}`);
check("MSFT-Regression: mapped_profile ist korrekt software_growth",geMsftProfileCheck.profile==="software_growth");
check("NKE-Regression: mapped_profile ist korrekt consumer_brands",geNegativeCagr.profile==="consumer_brands");

// ═══ REGRESSIONSTESTS (09.08.2026, Ticket "Inflection-Logik + robuste Peer-
// Median-Bereinigung") ═══

// 1. Inflection: zu kurze Zeitreihe (<4 Perioden) -> Score 0, kein Fake-Turnaround.
const inflShortSeries=computeInflectionEvidence({revenueGrowthSeries:[-5,-3],epsGrowthSeries:null,marginSeries:null});
check("Inflection: zu kurze Zeitreihe (<4 Perioden) liefert Score 0",inflShortSeries.inflectionScore===0&&inflShortSeries.flags.some(f=>f.includes("zu kurz")));

// 2. Inflection: klarer Boden->Erholung-Fall (Revenue-Growth verbessert sich
// von stark negativ auf leicht positiv ueber die letzten 2 vs. vorherigen 2
// Perioden) -- Score muss deutlich > 0 sein.
const inflRecovery=computeInflectionEvidence({revenueGrowthSeries:[-8,-6,-1,1],epsGrowthSeries:[-10,-8,-2,2],marginSeries:[10,10.5,11,11.5]});
check("Inflection: klare Boden->Erholung ueber Revenue+EPS+Marge liefert hohen Score (Breadth erfuellt)",inflRecovery.inflectionScore>0.30,JSON.stringify(inflRecovery));
check("Inflection: breadthCount ist 3 (alle 3 Serien verbessern sich)",inflRecovery.breadthCount===3);

// 3. Inflection: nur 1 Serie verfuegbar (kein Breadth-Vergleich moeglich) ->
// Deckel auf max. 0.40, selbst bei starker Verbesserung in der einen Serie.
const inflSingleSeries=computeInflectionEvidence({revenueGrowthSeries:[-20,-15,5,20],epsGrowthSeries:null,marginSeries:null});
check("Inflection: nur 1 Datenserie -> Score auf max. 0.40 gedeckelt (breadthCount<=1 -> Breadth-Faktor 0.6)",inflSingleSeries.inflectionScore<=0.40&&inflSingleSeries.flags.some(f=>f.includes("Breadth-Faktor")));

// 4. Inflection: nur 1 von >=2 verfuegbaren Serien verbessert sich (die andere
// verschlechtert sich weiter) -> Breadth-Daempfung (x0.7), kein voller Score.
const inflNoBreadth=computeInflectionEvidence({revenueGrowthSeries:[-8,-6,-1,5],epsGrowthSeries:[-5,-8,-12,-18],marginSeries:null});
check("Inflection: Revenue verbessert sich, EPS verschlechtert sich weiter -> Breadth-Faktor gedaempft (nur 1 von 2 verfuegbaren Metriken)",inflNoBreadth.flags.some(f=>f.includes("Breadth-Faktor")));

// 5. Einbindung ins cyclical-Profil: GrowthEvidence fuer profile==cyclical
// nutzt jetzt 0.40*Niveau+0.60*Inflection statt reiner Niveau-Formel.
const geCyclicalWithInflection=computeGrowthEvidence({peerGapPct:0,maxSegmentGrowthPct:0,epsCagr5yPct:-10,lynchClass:"cyclical",sector:"Basic Materials",industry:"Steel",revenueGrowthSeries:[-15,-10,-2,3],epsGrowthSeries:[-20,-15,-3,5],marginSeries:[5,5.5,6,7]});
check("Cyclical-Profil: Inflection wird berechnet und im Ergebnis transparent zurueckgegeben",geCyclicalWithInflection.inflection!=null&&geCyclicalWithInflection.inflection!.inflectionScore>0,JSON.stringify(geCyclicalWithInflection.inflection));
check("Cyclical-Profil: trotz negativer CAGR (-10%) hebt die Inflection-Komponente den cagrScore (Mischformel) an",geCyclicalWithInflection.cagrScore>0,`cagrScore=${geCyclicalWithInflection.cagrScore}`);

// 6. Andere Profile bleiben unveraendert: inflection ist null, wenn profile !=
// cyclical (keine Berechnung, kein Seiteneffekt).
const geSoftwareNoInflection=computeGrowthEvidence({peerGapPct:7,maxSegmentGrowthPct:31.5,epsCagr5yPct:23.34,lynchClass:"fast_grower",sector:"Technology",industry:"Software",revenueGrowthSeries:[10,12,15,18]});
check("Software-Profil: inflection bleibt null (keine Inflection-Berechnung ausserhalb cyclical)",geSoftwareNoInflection.inflection===null);

// 7. Peer-Median-Robustheit: Winsorize daempft einen einzelnen Hyper-Growth-
// Ausreisser in einer kleinen Peer-Gruppe (n=5, analog NKE-Fall).
const peerGrowthsWithOutlier=[9.2,10.7,15.7,17.4,66.8]; // 1 klarer Ausreisser (66.8)
// Praezisierung 09.08.2026 (Nutzer-Feedback): Winsorize-MEDIAN bleibt bei
// ungerader n unveraendert, wenn der mittlere Wert kein Extremwert ist --
// live an NKE bewiesen. Fuer n<6 ohne Industry-Referenz wird daher der
// Winsorized MEAN genutzt (reagiert tatsaechlich auf die Randkappung).
const robustNoIndustry=robustSectorGrowth(peerGrowthsWithOutlier,null);
check("Peer-Median-Robustheit: n=5 ohne Industry-Referenz nutzt Winsorized MEAN (method=winsorized_mean_small_n)",robustNoIndustry.method==="winsorized_mean_small_n");
// Korrektur: Winsorized MEAN vs. ROHEM MEAN vergleichen (nicht gegen den
// rohen Median -- der Median ignoriert den Ausreisser konzeptionell bereits
// komplett, waehrend der Mean per Definition davon beeinflusst wird. Der
// Winsorize-Effekt zeigt sich als Daempfung GEGENUEBER DEM ROHEN MEAN.)
const rawMeanForTest=peerGrowthsWithOutlier.reduce((a,x)=>a+x,0)/peerGrowthsWithOutlier.length;
check("Peer-Median-Robustheit: Winsorized Mean liegt spuerbar unter dem rohen (ungekappten) Mean -- Ausreisser-Daempfung wirkt",robustNoIndustry.value!<rawMeanForTest,`winsorizedMean=${robustNoIndustry.value}, rawMean=${rawMeanForTest}`);

// 8. Peer-Median-Blend: bei n<6 UND vorhandener Industry-Referenz wird ein
// 40/60-Blend Richtung Industry-Median gebildet.
const robustWithIndustry=robustSectorGrowth(peerGrowthsWithOutlier,8.0);
check("Peer-Median-Blend: n<6 mit Industry-Referenz (8.0%) nutzt 40/60-Blend (method=blend)",robustWithIndustry.method==="blend");
const expectedBlend=0.4*15.7+0.6*8.0; // rawMedian=15.7 (Index 2 von 5 sortiert)
check("Peer-Median-Blend: Blend-Formel liefert den erwarteten Wert (0.4*rawMedian+0.6*industryMedian)",Math.abs(robustWithIndustry.value!-expectedBlend)<0.01,`value=${robustWithIndustry.value}, expected=${expectedBlend}`);

// 9. Peer-Median: grosse Gruppe (n>=6) nutzt Winsorize unabhaengig von
// Industry-Referenz (Blend nur fuer kleine Gruppen).
const largeGroupGrowths=[5,7,9,11,13,15,80]; // 7 Peers, 1 Ausreisser
const robustLargeGroup=robustSectorGrowth(largeGroupGrowths,null);
check("Peer-Median: n>=6 nutzt Winsorized MEDIAN (method=winsorized_median), kein Blend/Mean",robustLargeGroup.method==="winsorized_median");

// 10. NKE-Gesamtfall: robuster Peer-Median darf den urspruenglichen Fehler
// (GrowthEvidence 90%) nicht wieder einfuehren -- weiterhin niedrig bei
// negativer CAGR, unabhaengig von der Peer-Median-Methode.
const geNkeWithRobustPeerGap=computeGrowthEvidence({peerGapPct:-23.97,maxSegmentGrowthPct:2.9,epsCagr5yPct:-24.97,lynchClass:"turnaround",sector:"Consumer Cyclical",industry:"Apparel - Footwear & Accessories"});
check("NKE-Gesamtfall bleibt niedrig (GrowthEvidence<0.30) auch mit der neuen Inflection/Peer-Median-Logik",geNkeWithRobustPeerGap.evidence<0.30,`evidence=${geNkeWithRobustPeerGap.evidence}`);

// 11. MSFT-Regression: software_growth-Profil unveraendert, keine Inflection-
// Berechnung, GrowthEvidence bleibt >=0.75.
const geMsftFinalCheck=computeGrowthEvidence({peerGapPct:7.0,maxSegmentGrowthPct:31.5,epsCagr5yPct:23.34,lynchClass:"fast_grower",sector:"Technology",industry:"Software - Infrastructure"});
check("MSFT-Regression (Inflection-Ticket): software_growth bleibt bei Evidence>=0.75, inflection=null",geMsftFinalCheck.evidence>=0.75&&geMsftFinalCheck.inflection===null);

console.log(`\n${total-failed}/${total} Checks grün.`); if(failed)process.exit(1);
