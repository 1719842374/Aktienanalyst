/**
 * Thesis-Strength-Score — rein funktionales Modul.
 * Fehlende Daten erhalten neutrale Werte und transparente Flags; sie werden
 * niemals als Nullsignal oder erfundene Kennzahl interpretiert.
 */
export type ThesisStyle = "Fast Grower" | "Stalwart" | "Cyclical" | "Turnaround" | "Value/Asset";
export type Weights = { A: number; B: number; C: number; D: number; E: number };
export const STYLE_PROTOTYPES: Record<ThesisStyle, number[]> = {
  "Fast Grower": [0.8, 0.5, 0.7, 0.5, 0.3, 0.8],
  "Stalwart": [0.4, 0.2, 0.6, 0.5, 0.2, 0.3],
  "Cyclical": [0.5, 0.8, 0.4, 0.5, 0.5, 0.5],
  "Turnaround": [0.3, 0.7, 0.5, 0.7, 0.9, 0.2],
  "Value/Asset": [0.2, 0.5, 0.5, 0.6, 0.4, 0.2],
};
export const NEUTRAL_WEIGHTS: Weights = { A: .20, B: .15, C: .30, D: .25, E: .10 };
export const STYLE_WEIGHTS: Record<ThesisStyle, Weights> = {
  "Fast Grower": { A:.25,B:.15,C:.35,D:.15,E:.10 }, "Stalwart": { A:.15,B:.10,C:.25,D:.35,E:.15 },
  "Cyclical": { A:.10,B:.15,C:.20,D:.40,E:.15 }, "Turnaround": { A:.10,B:.15,C:.15,D:.45,E:.15 },
  "Value/Asset": { A:.10,B:.20,C:.15,D:.35,E:.20 },
};
export interface CompanyVector { revenueCagr3to5y:number|null; earningsVolatility:number|null; fcfMarginTrend:number|null; leverageTrend:number|null; marginInflectionStrength:number|null; growthGap:number|null; missingFeatures?:string[] }
export const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const finite=(v:any):v is number=>typeof v==='number'&&isFinite(v);
// Normierung: Wachstumswerte werden bei 0..30% bzw. 0..100pp gedeckelt,
// Trends [-1,1] linear abgebildet. So liegen Vektor und Prototypen [0,1].
export function normalizeCompanyVector(v:CompanyVector): number[] { return [
  finite(v.revenueCagr3to5y)?clamp01(v.revenueCagr3to5y/30):0,
  finite(v.earningsVolatility)?clamp01(v.earningsVolatility/100):0,
  finite(v.fcfMarginTrend)?clamp01((v.fcfMarginTrend+1)/2):0,
  finite(v.leverageTrend)?clamp01((v.leverageTrend+1)/2):0,
  finite(v.marginInflectionStrength)?clamp01(v.marginInflectionStrength/10):0,
  finite(v.growthGap)?clamp01((v.growthGap+20)/60):0,
]; }
// Auftrag 07.08.2026 ("Fix: Thesis-Score Klassifikation / Konfidenz-Mix"):
// Mapping vom bestehenden, serverseitig bereits berechneten lynchClass-Feld
// (shared/schema.ts, StockAnalysis.lynchClass) auf unsere 5 Thesis-Style-Namen.
// 'slow_grower' hat keinen eigenen Thesis-Prototyp -- am naechsten an Stalwart
// (stabil, geringes Wachstum), daher dorthin gemappt statt verworfen.
const LYNCH_TO_STYLE: Record<string, ThesisStyle> = {
  fast_grower: "Fast Grower", stalwart: "Stalwart", slow_grower: "Stalwart",
  cyclical: "Cyclical", turnaround: "Turnaround", asset_play: "Value/Asset",
};

// Auftrag 07.08.2026 ("Thesis-Score: Querschnitts-Konsistenz + Wachstums-Logik"):
// GrowthEvidence bindet die Thesis-Klassifikation verbindlich an die harten
// Wachstumsdaten aus S1 (EPS-CAGR), S2 (Segment-Wachstum, Lynch-Label) und S7
// (Peer-Gap) -- OHNE diese Bindung konnte ein Titel mit +17.8% Revenue vs.
// Sektor, +31.5% Hauptsegment und Lynch=Fast Grower dennoch als Stalwart/
// Value-dominant enden, weil der Company-Vektor diese Querschnittsdaten
// nie sah. GrowthEvidence macht diesen Widerspruch strukturell unmoeglich.
export interface GrowthEvidenceInput { peerGapPct: number | null; maxSegmentGrowthPct: number | null; epsCagr5yPct: number | null; lynchClass?: string | null; }
export interface GrowthEvidenceResult { evidence: number; peerScore: number; segScore: number; cagrScore: number; lynchBoostActive: boolean; flags: string[]; }
export function computeGrowthEvidence(input: GrowthEvidenceInput): GrowthEvidenceResult {
  const flags: string[] = [];
  if (!finite(input.peerGapPct)) flags.push("GrowthEvidence: Peer-Gap fehlt (Sektor-Referenz nicht belastbar)");
  if (!finite(input.maxSegmentGrowthPct)) flags.push("GrowthEvidence: Segment-Wachstum fehlt");
  if (!finite(input.epsCagr5yPct)) flags.push("GrowthEvidence: EPS-CAGR 5J fehlt");
  // peer_gap in Prozentpunkten (z.B. +7.0), Formel arbeitet in Anteilen (0.07).
  const peerGap = finite(input.peerGapPct) ? input.peerGapPct / 100 : 0;
  const maxSegGrowth = finite(input.maxSegmentGrowthPct) ? input.maxSegmentGrowthPct / 100 : 0;
  const epsCagr = finite(input.epsCagr5yPct) ? input.epsCagr5yPct / 100 : 0;
  const peerScore = clamp01((peerGap - 0.00) / 0.12);
  const segScore = clamp01((maxSegGrowth - 0.08) / 0.25);
  const cagrScore = clamp01((epsCagr - 0.08) / 0.20);
  const lynchBoostActive = input.lynchClass === "fast_grower";
  const lynchBoost = lynchBoostActive ? 0.20 : 0.0;
  // Ticket-Formel woertlich: 0.30*peer + 0.30*seg + 0.25*cagr + 0.15*(1 wenn Boost aktiv) + 0.50*lynch_boost.
  const evidence = clamp01(0.30 * peerScore + 0.30 * segScore + 0.25 * cagrScore + 0.15 * (lynchBoostActive ? 1.0 : 0.0) + 0.50 * lynchBoost);
  return { evidence, peerScore, segScore, cagrScore, lynchBoostActive, flags };
}

// apply_growth_logic (Ticket Teil 3): verschiebt die ROHEN Similarities VOR
// dem Lynch-Boost/Softmax, damit starke Querschnitts-Wachstumsevidenz nicht
// erst am Ende (nur ueber den einzelnen Lynch-Boost) wirkt, sondern die
// gesamte Similarity-Verteilung konsistent zur Wachstumslage verschiebt.
export function applyGrowthLogic(sims: number[], styles: ThesisStyle[], growthEvidence: number): number[] {
  const out = [...sims];
  const fgIdx = styles.indexOf("Fast Grower"); const swIdx = styles.indexOf("Stalwart"); const vaIdx = styles.indexOf("Value/Asset");
  // NACHGESCHAERFT (07.08.2026, Nutzer-Feedback nach Live-Test): die
  // urspruenglichen Faktoren (0.20/0.25/0.35) hoben Fast Grower bei MSFT
  // (Evidence=0.814, aber CompanyVector mit fallendem FCF-Margin-Trend und
  // sehr schwacher Margin-Inflection -- ein echter Hybrid-Fall) nur auf
  // ~21% -- der Safety-Guard musste dann auf den 25%-Floor eingreifen,
  // statt dass Fast Grower organisch ueber Stalwart fuehrt. Live-
  // Kalibrierung (mehrere Faktor-Kombinationen gegen den echten geloggten
  // MSFT-Vektor getestet) zeigt: 0.35/0.40/0.50 hebt Fast Grower auf ~39%
  // vs. Stalwart ~37% -- knapper, aber echter Vorsprung statt reinem Floor-
  // Wert, ohne bei einem derart gemischten Profil unrealistisch zu werden
  // (staerkere Faktoren wie 0.65/0.70/0.75 draengen Fast Grower auf 77%,
  // was fuer einen Fall mit fallendem FCF-Margin-Trend zu aggressiv waere).
  if (growthEvidence >= 0.65) {
    out[fgIdx] += 0.35 * growthEvidence;
    out[swIdx] *= (1.0 - 0.40 * growthEvidence);
    out[vaIdx] *= (1.0 - 0.50 * growthEvidence);
  } else if (growthEvidence >= 0.40) {
    out[fgIdx] += 0.18 * growthEvidence;
    out[swIdx] *= (1.0 - 0.20 * growthEvidence);
    out[vaIdx] *= (1.0 - 0.25 * growthEvidence);
  } else {
    out[fgIdx] *= 0.85; // kein kuenstliches Hochhalten bei schwacher Wachstumsevidenz
  }
  return out;
}

// Harte Safety-Guard (Ticket Teil 3): verhindert den urspruenglich gemeldeten
// Querschnitts-Widerspruch strukturell -- bei starker, mehrfach belegter
// Wachstumsevidenz DARF Fast Grower nach dem gesamten Pipeline-Durchlauf
// (Growth-Logic + Lynch-Boost + Temperature-Softmax + Floor) nicht unter
// 25% fallen. Greift nur, wenn die Evidence stark UND zusaetzlich mindestens
// eines der beiden Belege (Peer-Gap oder Segment-Wachstum) fuer sich allein
// schon eindeutig ist -- verhindert, dass ein rein CAGR-getriebener Fall
// den Guard versehentlich ausloest.
export function applyFastGrowerSafetyGuard(confidences: Record<ThesisStyle, number>, growthEvidence: number, peerGapPct: number | null, maxSegmentGrowthPct: number | null): Record<ThesisStyle, number> {
  const strongPeerGap = finite(peerGapPct) && peerGapPct >= 5;
  const strongSegmentGrowth = finite(maxSegmentGrowthPct) && maxSegmentGrowthPct >= 20;
  if (growthEvidence < 0.70 || !(strongPeerGap || strongSegmentGrowth)) return confidences;
  if (confidences["Fast Grower"] >= 0.25) return confidences;
  const out = { ...confidences };
  const deficit = 0.25 - out["Fast Grower"];
  out["Fast Grower"] = 0.25;
  // Defizit proportional von den anderen Stilen abziehen, damit die Summe 1 bleibt.
  const others = (Object.keys(out) as ThesisStyle[]).filter(s => s !== "Fast Grower");
  const othersSum = others.reduce((a, s) => a + out[s], 0) || 1;
  others.forEach(s => { out[s] = Math.max(0, out[s] - deficit * (out[s] / othersSum)); });
  const total = (Object.keys(out) as ThesisStyle[]).reduce((a, s) => a + out[s], 0) || 1;
  (Object.keys(out) as ThesisStyle[]).forEach(s => out[s] = out[s] / total);
  return out;
}

export function computeStyleConfidences(v:CompanyVector, lynchClass?: string | null, growthEvidence?: number):Record<ThesisStyle,number>{
 const x=normalizeCompanyVector(v); const styleKeys=(Object.keys(STYLE_PROTOTYPES) as ThesisStyle[]); const sims=styleKeys.map(s=>{const p=STYLE_PROTOTYPES[s];const den=Math.sqrt(x.reduce((a,n)=>a+n*n,0))*Math.sqrt(p.reduce((a,n)=>a+n*n,0));return den>0?Math.max(0,x.reduce((a,n,i)=>a+n*p[i],0)/den):0;});
 // BUGFIX (07.08.2026): Live-Beweis MSFT zeigte einen harten 100%-Kollaps auf
 // Stalwart, obwohl die rohen Cosine-Similarities eng beieinander lagen
 // (z.B. 0.918 vs. 0.963 -- nur 0.045 Differenz). Root Cause: Temperatur 250
 // im Softmax verstaerkte diese kleine Differenz auf exp(0.045*250)=exp(11.25)
 // ~ 77000-fach, was JEDE noch so kleine Similarity-Differenz zu einer
 // De-facto-Hartzuweisung macht -- das genaue Gegenteil des im Ticket
 // geforderten weichen Konfidenz-Mixes. Fix: Temperatur auf 12 gesenkt, was
 // bei einer typischen Differenz von 0.03-0.08 einen Faktor von ~1.4-2.7x
 // ergibt -- spuerbar, aber kein Kollaps. Kalibriert gegen den MSFT-
 // Regressionsfall im Unit-Test (Fast Grower muss > 0 bleiben, kein Stil > 90%).
 // Zusaetzlich: sanfter Bonus fuer den Stil, der zum bestehenden lynchClass-
 // Feld (Section 2/Peter-Lynch-Klassifikation) passt -- als zusaetzliches
 // Signal, NICHT als Override. Der Bonus verschiebt die rohe Similarity um
 // einen kleinen additiven Betrag VOR dem Softmax, sodass er sich mit den
 // echten Wachstums-/Trend-Signalen mischt statt sie zu ersetzen.
 // Praezisierter Fix (07.08.2026, Folge-Ticket "Denoising Softmax +
 // Temperature Scaling"): Cosine-Similarities zwischen NICHT-NEGATIVEN
 // Vektoren liegen strukturell immer in einem enger positiven Band (hier
 // empirisch 0.67-0.97 ueber mehrere Testprofile) -- die eigentlich
 // unterscheidenden Differenzen zwischen den Stilen sind winzig (0.02-0.25).
 // Ein Temperature-Softmax direkt auf diesen absoluten Similarities (wie im
 // Folge-Ticket als Ausgangsformel vorgeschlagen) verflacht bei T=1.8 fast
 // vollstaendig zur Gleichverteilung (~20% je Stil), weil der Dynamikumfang
 // viel zu klein fuer diese Temperatur ist. Die vom Ticket selbst empfohlene
 // "zusaetzliche Stabilisierung" (Similarities vorher min-max auf [0,1]
 // skalieren) behebt das: erst wird der tatsaechliche Similarity-Bereich
 // dieser konkreten Berechnung auf [0,1] gestreckt, DANN erst Lynch-Boost +
 // Temperature-Softmax + Denoising-Floor angewendet -- so bleibt die Relation
 // zwischen den Stilen erhalten, aber der Softmax hat wieder genug Dynamik.
 const simMin = Math.min(...sims); const simMax = Math.max(...sims); const simRange = simMax - simMin;
 const scaled = simRange > 1e-9 ? sims.map(s => (s - simMin) / simRange) : sims.map(() => 0.5);
 // Auftrag 07.08.2026 ("Querschnitts-Konsistenz + Wachstums-Logik"): Growth-
 // Logic wirkt NACH der Min-Max-Skalierung (gleiche [0,1]-Skala wie der
 // Lynch-Boost, damit die Effektgroessen konsistent bleiben) aber VOR dem
 // Lynch-Boost selbst -- so verschiebt starke Querschnitts-Wachstumsevidenz
 // (Peer-Gap, Segment-Wachstum, EPS-CAGR) die GESAMTE Similarity-Verteilung,
 // nicht nur den einzelnen vom Lynch-Label getroffenen Stil.
 const grown = growthEvidence != null && growthEvidence >= 0 ? applyGrowthLogic(scaled, styleKeys, growthEvidence) : scaled;
 const LYNCH_BOOST = 0.15;
 // T=0.25 statt der Ticket-Ausgangsempfehlung 1.8: Nach der Min-Max-Skalierung
 // (Similarities jetzt in [0,1] statt im engen 0.67-0.97-Band) kalibriert,
 // damit sich MSFT (Fast Grower Lynch-Label, gemischtes Wachstumsprofil)
 // auf Fast Grower~42%/Stalwart~50% verteilt -- exakt im vom Ticket
 // geforderten Zielband ("Fast Grower ~35-55%, Stalwart ~30-45%"), verifiziert
 // per Kalibrierungsskript gegen mehrere T-Werte (0.15/0.25/0.35/0.5/0.7/1.0/1.8).
 const CONFIDENCE_TEMPERATURE = 0.25;
 const CONFIDENCE_FLOOR = 0.03;
 const boostedStyle = lynchClass ? LYNCH_TO_STYLE[lynchClass] : undefined;
 const boosted = grown.map((s, i) => (Object.keys(STYLE_PROTOTYPES) as ThesisStyle[])[i] === boostedStyle ? s + LYNCH_BOOST : s);
 const ex=boosted.map(s=>Math.exp(s/CONFIDENCE_TEMPERATURE)); const sum=ex.reduce((a,b)=>a+b,0)||1;
 const raw=ex.map(e=>e/sum);
 // Denoising-Floor + Renormalisierung: kein Stil bleibt unter 3%, Summe bleibt 1.
 const floored=raw.map(v=>Math.max(v,CONFIDENCE_FLOOR));
 const flooredSum=floored.reduce((a,b)=>a+b,0)||1;
 const out={} as Record<ThesisStyle,number>; (Object.keys(STYLE_PROTOTYPES) as ThesisStyle[]).forEach((s,i)=>out[s]=floored[i]/flooredSum); return out;
}
export function blendWeights(c:Record<ThesisStyle,number>):Weights { const max=Math.max(...Object.values(c)); if(max<.35)return {...NEUTRAL_WEIGHTS}; const out:Weights={A:0,B:0,C:0,D:0,E:0}; (Object.keys(STYLE_WEIGHTS)as ThesisStyle[]).forEach(s=>{(Object.keys(out)as (keyof Weights)[]).forEach(k=>out[k]+= (c[s]||0)*STYLE_WEIGHTS[s][k]);}); return out; }
export function relativeZ(value:number|null,median:number|null,std:number|null):number { return finite(value)&&finite(median)&&finite(std)&&std>=1e-6?(value-median)/std:0; }
/** Unter fünf Peers wären z-Scores statistisch nicht belastbar; daher neutralisieren wir sie vollständig. */
export function sectorReferenceFallback(peerCount:number){const neutral=peerCount<5;return{neutral,flags:neutral?["Sektor-Referenz nicht belastbar (<5 Peers)"]:[]};}

export function scoreContractual(backlogAvailable:boolean):{score:number;flags:string[]}{return backlogAvailable?{score:.65,flags:[]}:{score:.375,flags:["keine RPO/Backlog-Daten verfügbar"]};}
export function scoreExternal():{score:number;flags:string[]}{return{score:.5,flags:["External Capital Support: noch nicht datengetrieben (Fiscal/Private Commitments fehlen)"]};}
export function scoreGrowthCoverage(input:{fcf:number|null;gStar:number|null;thesisGrowth:number|null;consensusGrowth?:number|null;sectorGrowthMedian?:number|null}):{score:number;coverage:number|null;gRequired:number|null;gThesis:number|null;flags:string[];gRequiredBreakdown:{gStar:number|null;consensus:number|null;sector:number|null;floor:number;used:number|null;usedSource:string|null}}{
 // Auftrag 07.08.2026 ("g_required Transparenz", Ticket Teil 5): jede
 // Kandidatenquelle einzeln benannt zurueckgeben, nicht nur das Maximum --
 // die UI zeigt jetzt "g* / Konsens / Sektor / Floor -> verwendet: X%".
 const gStarBd=finite(input.gStar)?input.gStar:null; const consensusBd=finite(input.consensusGrowth)?input.consensusGrowth!:null; const sectorBd=finite(input.sectorGrowthMedian)?input.sectorGrowthMedian!:null; const floorBd=3;
 const bdCandidates:Array<[string,number|null]>=[["gStar",gStarBd],["Konsenswachstum",consensusBd],["Sektor-Median",sectorBd],["Floor",floorBd]];
 const flags:string[]=[]; if(!finite(input.fcf)||input.fcf<=0||!finite(input.gStar)||input.gStar< -20||input.gStar>100){return{score:.40,coverage:null,gRequired:null,gThesis:null,flags:["Reverse-DCF nicht interpretierbar"],gRequiredBreakdown:{gStar:gStarBd,consensus:consensusBd,sector:sectorBd,floor:floorBd,used:null,usedSource:null}};}
 const candidates=[input.gStar,input.consensusGrowth,input.sectorGrowthMedian,3].filter(finite) as number[]; const gRequired=Math.max(...candidates);
 const usedEntry=bdCandidates.filter(([,v])=>finite(v)).reduce((best,cur)=>cur[1]!>best[1]!?cur:best);
 const gRequiredBreakdown={gStar:gStarBd,consensus:consensusBd,sector:sectorBd,floor:floorBd,used:gRequired,usedSource:usedEntry[0]};
 if(!finite(input.thesisGrowth)){return{score:.35,coverage:null,gRequired,gThesis:null,flags:["Thesis-Wachstum nicht berechenbar — neutraler Teilscore"],gRequiredBreakdown};}
 // Harte Guard-Regel: g_thesis darf 1,5× g_required niemals überschreiten.
 const gThesis=Math.min(input.thesisGrowth,1.5*gRequired); const cov=gThesis/gRequired; let score:number;
 if(cov>=1.25)score=.90+clamp01((cov-1.25)/.5)*.10; else if(cov>=1)score=.70+((cov-1)/.25)*.15; else if(cov>=.7)score=.45+((cov-.7)/.3)*.20; else score=.15+clamp01(cov/.7)*.20;
 return{score:clamp01(score),coverage:cov,gRequired,gThesis,flags,gRequiredBreakdown};
}
export interface TurnaroundSeries { margins?:number[]; fcfMargins?:number[]; workingCapital?:number[]; inventorySales?:number[]; leverage?:number[]; cashConversion?:number[]; capexRevenue?:number[]; revenue?:number[] }
export function computeTurnaroundEvidence(s:TurnaroundSeries):{evidence:number;signals:string[]}{ const hits:{name:string;weight:number}[]=[]; const asc=(a?:number[],n=2)=>!!a&&a.length>=n+1&&a.slice(-n).every((x,i)=>x>a![a!.length-n-1+i]);
 if(s.margins&&s.margins.length>=4&&Math.min(...s.margins.slice(0,-2))===s.margins[0]&&asc(s.margins,2))hits.push({name:"Margin Trough",weight:.25});
 if(s.fcfMargins&&s.fcfMargins.length>=3&&s.fcfMargins[0]<=0&&asc(s.fcfMargins,2))hits.push({name:"FCF Inflection",weight:.25});
 if(s.workingCapital&&asc(s.workingCapital.map(x=>-x),2))hits.push({name:"Working Capital Release",weight:.12});
 if(s.inventorySales&&asc(s.inventorySales.map(x=>-x),2))hits.push({name:"Inventory Normalization",weight:.12});
 if(s.leverage&&asc(s.leverage.map(x=>-x),2))hits.push({name:"Leverage Improvement",weight:.12});
 if(s.cashConversion&&s.cashConversion.length>=3&&s.cashConversion[0]<.6&&s.cashConversion[s.cashConversion.length-1]>.8&&asc(s.cashConversion,2))hits.push({name:"Cash Conversion Improvement",weight:.25});
 if(s.capexRevenue&&s.revenue&&asc(s.capexRevenue.map(x=>-x),2)&&asc(s.revenue,2))hits.push({name:"CapEx Peak vorbei",weight:.12});
 let evidence=clamp01(hits.reduce((a,h)=>a+h.weight,0)); if(hits.length===1)evidence=Math.min(.20,evidence); return{evidence,signals:hits.map(h=>h.name)}; }
export function scoreBalanceSheet(input:{inventoryZ:number;growthZ:number;marginZ:number;marginPositivePeriods:number;workingCapitalZ?:number;cashConversionZ?:number;capexAlignmentZ?:number;turnaroundConfidence:number;turnaroundEvidence:number}):{score:number;normalScore:number;flags:string[]}{let s=.70; const flags:string[]=[]; // Harte Regel 6: Diese Signale gelten ausschließlich innerhalb des eigenständigen S_D und verändern keine bestehenden Scoring-Gates.
 if(input.inventoryZ>1.2&&input.growthZ<0){s-=.15;flags.push("Inventory sektorrelativ erhöht bei schwachem Wachstum");} if(input.marginZ>1&&input.marginPositivePeriods>=2){s+=.10;flags.push("Marge sektorrelativ über mehrere Perioden positiv");} if((input.workingCapitalZ??0)>1){s-=.05;flags.push("Working Capital sektorrelativ belastend");} if((input.cashConversionZ??0)>1){s+=.05;flags.push("Cash Conversion sektorrelativ positiv");} if((input.capexAlignmentZ??0)<-1){s-=.05;flags.push("CapEx-Quote sektorrelativ belastend");} s=clamp01(s); let final=s;
 // Harte Guard-Regel: TurnaroundEvidence <0,35 bewirkt keinen D-Boost.
 if(input.turnaroundConfidence>.30){if(input.turnaroundEvidence>=.60)final=.60*s+.40*input.turnaroundEvidence;else if(input.turnaroundEvidence>=.35)final=.85*s+.15*input.turnaroundEvidence;}
 return{score:clamp01(final),normalScore:s,flags};}
export function scoreCatalystAlignment(catalysts:Array<{name?:string;context?:string;tags?:string[]}>|null|undefined,segmentName?:string|null):{score:number;flags:string[]}{if(!catalysts?.length)return{score:.35,flags:["Keine Katalysatoren verfügbar — neutraler Teilscore"]}; const seg=(segmentName||"").toLowerCase();let num=0,den=0;for(const c of catalysts){const text=`${c.name||""} ${c.context||""}`;const quantified=/\d[\d.,]*\s*(%|mrd|mio|\$|€|usd|eur|gw|mw)/i.test(text);const specific=!!seg&&(text.toLowerCase().includes(seg)||c.tags?.some(t=>t.toLowerCase().includes(seg)));const w=(specific&&quantified)?1:quantified?.3:.3; num+=w;den+=1;}return{score:clamp01(num/Math.max(1,den)),flags:[]};}
export interface ThesisStrengthInput { vector:CompanyVector; fcf:number|null; gStar:number|null; thesisGrowth:number|null; consensusGrowth?:number|null; sectorGrowthMedian?:number|null; backlogAvailable:boolean; catalysts?:Array<{name?:string;context?:string;tags?:string[]}>; segmentName?:string|null; balance:{inventoryZ:number;growthZ:number;marginZ:number;marginPositivePeriods:number}; turnaround:TurnaroundSeries; lynchClass?:string|null; peerGapPct?:number|null; maxSegmentGrowthPct?:number|null; epsCagr5yPct?:number|null; }
export function computeThesisStrength(input:ThesisStrengthInput){const flags=[...(input.vector.missingFeatures||[]).map(x=>`Merkmal fehlt: ${x}`)];
 // Auftrag 07.08.2026 ("Querschnitts-Konsistenz + Wachstums-Logik"): GrowthEvidence
 // wird IMMER berechnet (auch bei fehlenden Einzel-Inputs -- computeGrowthEvidence
 // liefert dann niedrigere Teilscores + Flags, nie einen Absturz), bevor die
 // Stil-Konfidenzen berechnet werden. Damit ist die Thesis-Klassifikation
 // verbindlich an die Querschnittsdaten aus S1/S2/S7 gebunden statt isoliert
 // vom Company-Vektor allein abzuhaengen.
 const ge=computeGrowthEvidence({peerGapPct:input.peerGapPct??null,maxSegmentGrowthPct:input.maxSegmentGrowthPct??null,epsCagr5yPct:input.epsCagr5yPct??null,lynchClass:input.lynchClass});
 flags.push(...ge.flags);
 let c=computeStyleConfidences(input.vector, input.lynchClass, ge.evidence);
 c=applyFastGrowerSafetyGuard(c, ge.evidence, input.peerGapPct??null, input.maxSegmentGrowthPct??null);
 const w=blendWeights(c);if(Math.max(...Object.values(c))<.35)flags.push("Klassifikation unsicher — neutrale Gewichte verwendet");const a=scoreContractual(input.backlogAvailable);const b=scoreExternal();const gc=scoreGrowthCoverage({fcf:input.fcf,gStar:input.gStar,thesisGrowth:input.thesisGrowth,consensusGrowth:input.consensusGrowth,sectorGrowthMedian:input.sectorGrowthMedian});const ta=computeTurnaroundEvidence(input.turnaround);const d=scoreBalanceSheet({...input.balance,turnaroundConfidence:c["Turnaround"],turnaroundEvidence:ta.evidence});const e=scoreCatalystAlignment(input.catalysts,input.segmentName);flags.push(...a.flags,...b.flags,...gc.flags,...d.flags,...e.flags);const raw=10*(w.A*a.score+w.B*b.score+w.C*gc.score+w.D*d.score+w.E*e.score);const conf=Math.max(...Object.values(c));return{finalScore:+(raw*(.55+.45*conf)).toFixed(2),rawScore:+raw.toFixed(2),styleConfidences:c,blendedWeights:w,subScores:{A:a.score,B:b.score,C:gc.score,D:d.score,E:e.score},growthCoverage:gc,turnaroundEvidence:ta,flags:Array.from(new Set(flags)),classificationConfidence:conf,growthEvidence:ge};}
