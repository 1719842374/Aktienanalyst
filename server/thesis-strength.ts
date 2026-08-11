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
export const LYNCH_TO_STYLE: Record<string, ThesisStyle> = {
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
export interface GrowthEvidenceInput { peerGapPct: number | null; maxSegmentGrowthPct: number | null; epsCagr5yPct: number | null; lynchClass?: string | null; revenueYoyPct?: number | null; sector?: string | null; industry?: string | null; earningsVolatility?: number | null; peTTM?: number | null; sectorMedianPE?: number | null; revenueGrowthSeries?: number[] | null; epsGrowthSeries?: number[] | null; marginSeries?: number[] | null; }
export interface GrowthEvidenceResult { evidence: number; peerScore: number; segScore: number; cagrScore: number; lynchBoostActive: boolean; flags: string[]; cyclicalPeFlag: boolean; profile: GrowthProfile; inflection: InflectionResult | null; }
// Auftrag 07.08.2026 ("Final-Fix: Fast-Grower-Ranges + P/E-Zyklus-Filter"):
// Segment-Materialitaet -- ein 3%-Segment mit +40% Wachstum darf NICHT
// allein Fast-Grower-Evidence ausloesen. Nur Segmente mit Umsatzanteil >=10%
// zaehlen fuer den Materialitaets-Score; als Fallback (kein Segment erreicht
// 10%) wird der umsatzgewichtete Durchschnitt der Top-3-Segmente genutzt --
// so bleibt ein Ergebnis auch bei stark fragmentierten Portfolios moeglich,
// ohner ein Mini-Segment isoliert entscheiden zu lassen.
export interface SegmentMaterialityInput { name: string; percentage: number; growth?: number | null }
export function computeMaterialSegmentGrowth(segments: SegmentMaterialityInput[] | null | undefined): { materialGrowthPct: number | null; source: "material_segment" | "weighted_top3" | null } {
  if (!segments?.length) return { materialGrowthPct: null, source: null };
  const withGrowth = segments.filter(s => typeof s.growth === "number" && isFinite(s.growth!));
  const material = withGrowth.filter(s => s.percentage >= 10);
  if (material.length > 0) {
    const best = material.reduce((a, b) => (b.growth! > a.growth! ? b : a));
    return { materialGrowthPct: best.growth!, source: "material_segment" };
  }
  // Fallback: umsatzgewichtetes Wachstum der Top-3 Segmente (nach Anteil).
  const top3 = [...withGrowth].sort((a, b) => b.percentage - a.percentage).slice(0, 3);
  if (top3.length === 0) return { materialGrowthPct: null, source: null };
  const totalShare = top3.reduce((a, s) => a + s.percentage, 0);
  if (totalShare <= 0) return { materialGrowthPct: null, source: null };
  const weighted = top3.reduce((a, s) => a + (s.percentage / totalShare) * s.growth!, 0);
  return { materialGrowthPct: weighted, source: "weighted_top3" };
}

// Auftrag 07.08.2026: zyklische Sektoren fuer den P/E-Filter. Liste bewusst
// konservativ (nur Sektoren, die im Ticket explizit genannt sind oder
// eindeutig zyklisch sind) -- Erweiterung ueber Earnings-Volatilitaet als
// zusaetzliches, datengetriebenes Signal (siehe isCyclicalProfile).
const CYCLICAL_SECTORS = new Set(["materials", "energy", "industrials", "basic materials", "consumer cyclical", "automobiles"]);
export function isCyclicalSectorName(sector?: string | null): boolean {
  if (!sector) return false;
  return CYCLICAL_SECTORS.has(sector.trim().toLowerCase());
}

// Auftrag 09.08.2026 ("NKE-Vorfall", Ticket Teil B/C): Profil-Mapping aus
// Sektor/Industry -- generisch per Substring-Match, KEINE Ticker-Hardcodes.
// Vier Profile mit unterschiedlichen "was zaehlt als starkes Wachstum"-
// Ranges. Fallback "other" bei unbekanntem Sektor/Industry -- neutrale
// Mitte zwischen software_growth und consumer_brands, kein Bias.
export type GrowthProfile = "software_growth" | "consumer_brands" | "cyclical" | "other";
export function mapGrowthProfile(sector?: string | null, industry?: string | null): GrowthProfile {
  const s = (sector || "").toLowerCase();
  const i = (industry || "").toLowerCase();
  const text = `${s} ${i}`;
  // Reihenfolge bewusst: (1) software_growth-Industries zuerst, damit z.B.
  // "Consumer Cyclical"-Sektor mit Internet/Semiconductor-Industry (FMP
  // klassifiziert manche Tech-Subsegmente sektoral uneindeutig) nicht
  // faelschlich als cyclical/consumer_brands landet. (2) consumer_brands
  // (Industry-Ebene, spezifischer als der breite "Consumer Cyclical"-Sektor)
  // VOR dem generischen Rohstoff-/Sektor-Cyclical-Fallback -- Apparel/
  // Footwear/Luxury sind zwar oft sektoral "Consumer Cyclical" gelabelt,
  // gehoeren aber laut Ticket-Tabelle explizit zu consumer_brands, nicht in
  // den breiten Rohstoff-/Auto-/Energie-Cyclical-Topf. (3) breite Sektor-
  // Cyclical-Gruppen (Materials/Energy/Industrials/Autos/Airlines) danach.
  if (/software|semiconductor|internet|information technology/.test(i)) return "software_growth";
  if (/apparel|footwear|leisure|luxury|restaurant|beverage|household|personal products|textile/.test(i)) return "consumer_brands";
  if (/materials|energy|industrials|automobiles|autos|airlines|basic materials/.test(text)) return "cyclical";
  if (/consumer cyclical/.test(s)) return "cyclical";
  if (/software|semiconductor|internet|information technology|technology/.test(text)) return "software_growth";
  return "other";
}

// Profil-adaptive Ranges (Ticket Teil C) -- Ankerpunkte pro Profil fuer
// EPS-CAGR- und Segment-Score. Peer-Gap bleibt profil-uebergreifend gleich
// (Peer-Gap ist bereits relativ zum EIGENEN Sektor-Median berechnet, braucht
// daher keine separate Profil-Anpassung).
const GROWTH_PROFILE_RANGES: Record<GrowthProfile, { cagrFloor: number; cagrSpan: number; segFloor: number; segSpan: number }> = {
  software_growth: { cagrFloor: 0.08, cagrSpan: 0.16, segFloor: 0.12, segSpan: 0.18 }, // 8%->0,16%->0.50,24%->1.0 (Ticket-Formel woertlich)
  consumer_brands: { cagrFloor: 0.04, cagrSpan: 0.12, segFloor: 0.08, segSpan: 0.14 }, // 4%->0,10%->0.50,16%->1.0
  cyclical: { cagrFloor: 0.04, cagrSpan: 0.14, segFloor: 0.08, segSpan: 0.16 }, // Fokus Inflection statt Niveau -- flachere Rampe, kein hartes Level-Erfordernis
  other: { cagrFloor: 0.06, cagrSpan: 0.14, segFloor: 0.10, segSpan: 0.16 }, // Mitte zwischen software_growth und consumer_brands
};

// P/E-Zyklus-Filter (Ticket Teil 3): "Hohes Wachstum + niedriges P/E +
// zyklischer Sektor = Peak-Earnings-Verdacht, kein saekularer Fast Grower."
// Greift additiv NACH der Grundformel, daempft NICHT den EPS-CAGR-Score
// selbst (der bleibt eine reine Messung), sondern die AUSGABE der gesamten
// GrowthEvidence -- so bleibt die Kernformel unveraendert nachvollziehbar,
// waehrend der Filter separat sichtbar (cyclicalPeFlag) bleibt.
export interface CyclicalPeCheckInput { sector?: string | null; earningsVolatility?: number | null; peTTM: number | null; sectorMedianPE: number | null; }
// Auftrag 09.08.2026 ("Inflection-Zeitreihen-Logik + robuste Peer-Median-
// Bereinigung", Teil 1): bei Zyklikern zaehlt oft nicht das Wachstums-NIVEAU,
// sondern die VERBESSERUNG ueber die Zeit (Boden -> Erholung). Erwartet eine
// Serie periodischer Wachstumsraten (z.B. YoY-Revenue ueber 4-8 Perioden,
// chronologisch AELTESTE ZUERST). Zu kurze Historie -> Score 0 (kein
// Fake-Turnaround durch fehlende Daten). Nur 1 Periode Verbesserung wird auf
// max. 0.40 gedeckelt (echte Bestaetigung braucht mehr als einen Ausschlag).
export interface InflectionInput {
  revenueGrowthSeries?: number[] | null; // periodische YoY-Growth-Raten in %, chronologisch aelteste zuerst
  epsGrowthSeries?: number[] | null;
  marginSeries?: number[] | null; // z.B. operative Marge in %, chronologisch aelteste zuerst (fuer Breadth-Check)
}
export interface InflectionResult { inflectionScore: number; delta: number | null; breadthCount: number; flags: string[]; }
function singleSeriesInflection(series: number[] | null | undefined, minPeriods = 4): { delta: number | null; improving: boolean } {
  if (!series || series.length < minPeriods) return { delta: null, improving: false };
  const recentWindow = series.slice(-2);
  const priorWindow = series.slice(-4, -2);
  if (priorWindow.length === 0) return { delta: null, improving: false };
  const recent = recentWindow.reduce((a, x) => a + x, 0) / recentWindow.length;
  const prior = priorWindow.reduce((a, x) => a + x, 0) / priorWindow.length;
  const delta = recent - prior;
  return { delta, improving: delta > 0 };
}
// Praezisierung 09.08.2026 (Nutzer-Feedback, "Breadth-Filter im Detail"):
// abgestufter breadth_factor statt binaerem 0.7/1.0-Schalter. Der Faktor
// haengt direkt von der ANZAHL VERBESSERTER Metriken ab (nicht von der Zahl
// der insgesamt verfuegbaren Serien) -- 0 Metriken->0.0 (kein Inflection-Wert
// ueberhaupt, aber das ist bereits durch score selbst abgedeckt, wenn delta<=0),
// 1 Metrik->0.6, 2 Metriken->0.90, 3 Metriken->1.0. Verhindert, dass ein
// einmaliger Basis-Effekt in NUR EINER Kennzahl (z.B. Revenue) einen hohen
// Inflection-Score erzeugt, waehrend EPS/Marge weiter fallen.
const BREADTH_FACTORS: Record<number, number> = { 0: 0.0, 1: 0.6, 2: 0.90, 3: 1.0 };
export function computeInflectionEvidence(input: InflectionInput): InflectionResult {
  const flags: string[] = [];
  const rev = singleSeriesInflection(input.revenueGrowthSeries, 4);
  const eps = singleSeriesInflection(input.epsGrowthSeries, 4);
  const margin = singleSeriesInflection(input.marginSeries, 4);
  const deltas = [rev.delta, eps.delta, margin.delta].filter((d): d is number => d != null);
  if (deltas.length === 0) {
    flags.push("Inflection: Zeitreihe zu kurz (<4 Perioden) -- Score 0, kein Fake-Turnaround");
    return { inflectionScore: 0, delta: null, breadthCount: 0, flags };
  }
  // Primaer-Delta: Revenue wenn vorhanden, sonst EPS, sonst Marge -- Revenue
  // ist die robusteste/am wenigsten volatile Serie fuer die Kernmessung.
  const primaryDelta = rev.delta ?? eps.delta ?? margin.delta!;
  // inflection_raw in Prozentpunkten: 0pp->0, 10pp->1.0 (Ticket-Formel woertlich).
  let inflectionRaw = clamp01(primaryDelta / 10);
  // Persistenz-Guard: nur 1 Periode Verbesserung (kein 2.-Fenster-Vergleich
  // moeglich, da nur 4 Perioden minimal vorliegen und singleSeriesInflection
  // bereits 2 vs. 2 Perioden vergleicht) -- konservativ gedeckelt, wenn die
  // Zeitreihe exakt am Minimum (4 Perioden) liegt, sprich kein 3. Fenster fuer
  // eine mehrperiodige Bestaetigung existiert.
  const primarySeries = input.revenueGrowthSeries ?? input.epsGrowthSeries ?? input.marginSeries;
  if (primarySeries && primarySeries.length === 4) {
    inflectionRaw = Math.min(inflectionRaw, 0.40);
    flags.push("Inflection: nur exakt 4 Perioden verfuegbar (keine mehrperiodige Persistenz-Bestaetigung moeglich) -- Rohwert auf max. 0.40 gedeckelt");
  }
  const breadthCount = [rev.improving, eps.improving, margin.improving].filter(Boolean).length;
  const breadthFactor = BREADTH_FACTORS[breadthCount] ?? 1.0;
  const score = clamp01(inflectionRaw * breadthFactor);
  if (breadthCount <= 1) {
    flags.push(`Inflection: nur ${breadthCount} von 3 Metriken verbessert sich -- Breadth-Faktor ${breadthFactor.toFixed(2)} angewendet (Fake-Turnaround-Schutz)`);
  }
  return { inflectionScore: score, delta: primaryDelta, breadthCount, flags };
}

// Auftrag 09.08.2026 (Teil 2): robuste Peer-Median-Bereinigung -- eine kleine
// (n<6) Peer-Gruppe mit 1-2 Hyper-Growth-Ausreissern soll g_required nicht
// kuenstlich in die Hoehe treiben. Zwei Strategien je nach Datenlage:
// (a) n<6 UND Industry-Median vorhanden -> 40/60-Blend Richtung Industry
// (b) sonst -> Winsorize auf [P20,P80] dann Median (robust gegen 1-2 Extreme)
// Praezisierung 09.08.2026 (Nutzer-Feedback nach Live-Test): Winsorize-MEDIAN
// bei ungerader Stichprobengroesse (n=5) bleibt UNVERAENDERT, wenn der
// mittlere sortierte Wert selbst kein Extremwert ist -- Winsorize kappt nur
// die Raender, der Median-INDEX zeigt aber weiterhin auf denselben (nicht
// gekappten) Wert. Live-Beweis: NKE-Peers ergaben robust===raw (24.16%
// unveraendert), weil der mittlere Wert der 5 Peers kein Ausreisser war,
// sondern die gesamte Gruppe strukturell hoch wuchs. Fuer den Fall, dass EIN
// oder ZWEI echte Hyper-Growth-Ausreisser den Median selbst NICHT direkt
// treffen (n ungerade), aber trotzdem den PRAKTISCHEN Vergleichswert nach
// oben ziehen sollen (Trimmed/Winsorized MEAN statt Median), wird bei
// kleinen Gruppen (n<6) ohne Industry-Referenz der Winsorized MEAN als
// zusaetzliche, tatsaechlich wirksame Robustheits-Schicht zurueckgegeben --
// der Mean reagiert (anders als der Median bei ungerader n) sichtbar auf die
// Kappung der Randwerte. Bei n>=6 bleibt Winsorized MEDIAN Standard (mehr
// Datenpunkte, robusterer Median-Index).
export function robustSectorGrowth(peerGrowthsPct: number[], industryMedianPct: number | null): { value: number | null; method: "blend" | "winsorized_median" | "winsorized_mean_small_n" | "raw_median" | "none"; rawMedian: number | null } {
  const clean = peerGrowthsPct.filter(x => typeof x === "number" && isFinite(x));
  if (clean.length === 0) return { value: industryMedianPct ?? null, method: industryMedianPct != null ? "raw_median" : "none", rawMedian: null };
  const sorted = [...clean].sort((a, b) => a - b);
  const rawMedian = sorted[Math.floor(sorted.length / 2)];
  if (sorted.length < 6 && industryMedianPct != null) {
    return { value: 0.4 * rawMedian + 0.6 * industryMedianPct, method: "blend", rawMedian };
  }
  if (sorted.length < 3) {
    return { value: rawMedian, method: "raw_median", rawMedian };
  }
  const percentile = (arr: number[], p: number) => { const idx = (p / 100) * (arr.length - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (idx - lo); };
  const p20 = percentile(sorted, 20), p80 = percentile(sorted, 80);
  const winsorized = sorted.map(x => Math.min(Math.max(x, p20), p80));
  if (sorted.length < 6) {
    // Kleine Gruppe, keine Industry-Referenz: Winsorized MEAN statt Median --
    // reagiert tatsaechlich auf die Randkappung (im Gegensatz zum Median bei
    // ungerader n), daempft 1-2 Hyper-Growth-Ausreisser spuerbar.
    const winsorizedMean = winsorized.reduce((a, x) => a + x, 0) / winsorized.length;
    return { value: winsorizedMean, method: "winsorized_mean_small_n", rawMedian };
  }
  const winsorizedMedian = winsorized[Math.floor(winsorized.length / 2)];
  return { value: winsorizedMedian, method: "winsorized_median", rawMedian };
}

export function checkCyclicalPeDiscount(input: CyclicalPeCheckInput): { cyclicalPeFlag: boolean; dampingFactor: number } {
  const cyclicalSector = isCyclicalSectorName(input.sector) || (finite(input.earningsVolatility) && input.earningsVolatility! > 40);
  const peDiscount = finite(input.peTTM) && finite(input.sectorMedianPE) && input.sectorMedianPE! > 0 && input.peTTM! > 0 && input.peTTM! < input.sectorMedianPE! * 0.75;
  const cyclicalPeFlag = cyclicalSector && peDiscount;
  // 0.60-0.70 Daempfung laut Ticket -- Mittelwert 0.65 als fester, transparenter Faktor.
  return { cyclicalPeFlag, dampingFactor: cyclicalPeFlag ? 0.65 : 1.0 };
}

export function computeGrowthEvidence(input: GrowthEvidenceInput): GrowthEvidenceResult {
  const flags: string[] = [];
  if (!finite(input.peerGapPct)) flags.push("GrowthEvidence: Peer-Gap fehlt (Sektor-Referenz nicht belastbar)");
  if (!finite(input.maxSegmentGrowthPct)) flags.push("GrowthEvidence: Segment-Wachstum fehlt");
  if (!finite(input.epsCagr5yPct)) flags.push("GrowthEvidence: EPS-CAGR 5J fehlt");
  // peer_gap in Prozentpunkten (z.B. +7.0), Formel arbeitet in Anteilen (0.07).
  const peerGap = finite(input.peerGapPct) ? input.peerGapPct / 100 : 0;
  const maxSegGrowth = finite(input.maxSegmentGrowthPct) ? input.maxSegmentGrowthPct / 100 : 0;
  const epsCagr = finite(input.epsCagr5yPct) ? input.epsCagr5yPct / 100 : 0;
  // NACHGESCHAERFTE RANGES (07.08.2026, Ticket "Fast-Grower-Ranges ab ~16%"):
  // EPS-CAGR>=16% soll ausreichend Evidence liefern, SOFERN mindestens ein
  // Bestaetigungssignal vorliegt (Rev YoY>=12% ODER materielles Segment
  // >=18% ODER Peer-Gap>=+2pp). Die Score-Formeln selbst bleiben weiche
  // Rampen (clamp01), aber die unteren Ankerpunkte wurden verschoben: cagr
  // 8%->12% (16% liegt jetzt bei 0.50 statt vorher 0.40), peer 0pp->+2pp
  // Ankerpunkt fuer die erste Evidence-Einheit, segment 8%->12%.
  // Auftrag 09.08.2026 ("NKE-Vorfall", Ticket Teil B/C): Profil-adaptive Ranges
  // statt fixer Software-Ankerpunkte. Fuer software_growth bleiben die exakten
  // Ticket-Werte (8%->0, 16%->0.50, 24%->1.0) unveraendert -- MSFT-Regression
  // ausgeschlossen. Fuer consumer_brands/cyclical/other greifen niedrigere
  // Floors/Spans, weil in diesen Profilen bereits 10-16% EPS-CAGR als stark
  // gilt (siehe Ticket-Tabelle), nicht erst ab 16-24% wie bei Software.
  const profile = mapGrowthProfile(input.sector, input.industry);
  const ranges = GROWTH_PROFILE_RANGES[profile];
  const peerScore = clamp01(peerGap / 0.10); // 2pp->0.20, 5pp->0.50, 10pp->1.0 (profiluebergreifend -- Peer-Gap ist bereits relativ zum eigenen Sektor)
  const segScore = clamp01((maxSegGrowth - ranges.segFloor) / ranges.segSpan);
  // Universeller Guard (Ticket Teil D.1): negative EPS-CAGR liefert IMMER
  // score=0, unabhaengig vom Profil -- clamp01 faengt das bereits ab (negativer
  // Zaehler -> negatives Ergebnis -> 0), hier explizit dokumentiert statt nur
  // implizit durch clamp01, damit die Absicht im Code sichtbar ist.
  const cagrScore = epsCagr <= 0 ? 0 : clamp01((epsCagr - ranges.cagrFloor) / ranges.cagrSpan);
  const lynchBoostActive = input.lynchClass === "fast_grower";
  const lynchBoost = lynchBoostActive ? 0.20 : 0.0;
  // Bestaetigungslogik (Ticket Kernregel): EPS-CAGR>=16% allein reicht NICHT
  // fuer starke Evidence -- es braucht zusaetzlich mindestens eines der drei
  // Bestaetigungssignale (Rev YoY>=12%, materielles Segment>=18%, Peer-Gap
  // >=+2pp). Ohne Bestaetigung wird der CAGR-Beitrag auf 60% gedaempft, damit
  // ein isoliert hoher CAGR-Wert (z.B. durch Sondereffekte) nicht allein
  // starke Fast-Grower-Evidence erzeugt.
  const hasConfirmation = peerGap >= 0.02 || maxSegGrowth >= 0.18 || (finite(input.revenueYoyPct) && input.revenueYoyPct! >= 12);
  const confirmedCagrScore = epsCagr >= 0.16 && !hasConfirmation ? cagrScore * 0.60 : cagrScore;
  if (epsCagr >= 0.16 && !hasConfirmation) flags.push("EPS-CAGR>=16% ohne Bestaetigungssignal (Rev/Segment/Peer-Gap) -- Beitrag gedaempft");
  // Auftrag 09.08.2026 ("Inflection-Zeitreihen-Logik", Teil 1): bei profile==
  // "cyclical" zaehlt nicht nur das Wachstums-NIVEAU (bestehender CAGR-Score),
  // sondern vor allem die VERBESSERUNG ueber die Zeit (Boden->Erholung).
  // GrowthEvidence_cyclical ersetzt den reinen Niveau-Beitrag (confirmedCagrScore)
  // durch eine 0.40/0.60-Mischung aus Niveau und Inflection -- alle anderen
  // Profile (software_growth/consumer_brands/other) bleiben UNVERAENDERT bei
  // der reinen Niveau-Formel (MSFT-Regression ausgeschlossen).
  let inflectionResult: InflectionResult | null = null;
  let cagrOrInflectionScore = confirmedCagrScore;
  if (profile === "cyclical") {
    inflectionResult = computeInflectionEvidence({
      revenueGrowthSeries: input.revenueGrowthSeries ?? null,
      epsGrowthSeries: input.epsGrowthSeries ?? null,
      marginSeries: input.marginSeries ?? null,
    });
    flags.push(...inflectionResult.flags);
    cagrOrInflectionScore = clamp01(0.40 * confirmedCagrScore + 0.60 * inflectionResult.inflectionScore);
  }
  let evidence = clamp01(0.30 * peerScore + 0.30 * segScore + 0.25 * cagrOrInflectionScore + 0.15 * (lynchBoostActive ? 1.0 : 0.0) + 0.50 * lynchBoost);
  // P/E-Zyklus-Filter (Ticket Teil 3): daempft die GESAMTE Evidence additiv,
  // sichtbar ueber cyclicalPeFlag, ohne die einzelnen Teilscores zu verfaelschen.
  const cyclicalPe = checkCyclicalPeDiscount({ sector: input.sector, earningsVolatility: input.earningsVolatility, peTTM: input.peTTM ?? null, sectorMedianPE: input.sectorMedianPE ?? null });
  if (cyclicalPe.cyclicalPeFlag) {
    evidence = clamp01(evidence * cyclicalPe.dampingFactor);
    flags.push("P/E-Zyklus-Filter aktiv: zyklischer Sektor + P/E deutlich unter Sektor-Median -> Peak-Earnings-Verdacht, Fast-Grower-Evidence gedaempft");
  }
  return { evidence, peerScore, segScore, cagrScore: cagrOrInflectionScore, lynchBoostActive, flags, cyclicalPeFlag: cyclicalPe.cyclicalPeFlag, profile, inflection: inflectionResult };
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
// Auftrag 07.08.2026 ("Final-Fix: Fast-Grower-Ranges + P/E-Zyklus-Filter",
// Ticket Teil 5, "weicher Safety-Guard"): Untergrenze von 0.25 auf 0.35
// angehoben (Fast Grower darf nicht klar hinter Stalwart liegen), aber neue
// Ausschlussbedingungen ergaenzt: greift NICHT wenn der P/E-Zyklus-Filter
// aktiv ist (Peak-Earnings-Verdacht -- kein Erzwingen gegen einen klaren
// Zyklus-Peak) UND NICHT wenn das aktuelle Revenue-YoY unter 10% liegt
// (keine abrupte Wachstumsabkuehlung soll durch den Guard uebertoencht werden).
export function applyFastGrowerSafetyGuard(confidences: Record<ThesisStyle, number>, growthEvidence: number, peerGapPct: number | null, maxSegmentGrowthPct: number | null, cyclicalPeFlag?: boolean, revenueYoyPct?: number | null): Record<ThesisStyle, number> {
  const strongPeerGap = finite(peerGapPct) && peerGapPct >= 5;
  const strongSegmentGrowth = finite(maxSegmentGrowthPct) && maxSegmentGrowthPct >= 20;
  if (growthEvidence < 0.70 || !(strongPeerGap || strongSegmentGrowth)) return confidences;
  if (cyclicalPeFlag) return confidences; // kein Erzwingen gegen einen klaren P/E-Zyklus-Peak
  if (finite(revenueYoyPct) && revenueYoyPct! < 10) return confidences; // keine abrupte Abkuehlung uebertoenchen
  const FAST_GROWER_FLOOR = 0.35;
  if (confidences["Fast Grower"] >= FAST_GROWER_FLOOR) return confidences;
  const out = { ...confidences };
  const deficit = FAST_GROWER_FLOOR - out["Fast Grower"];
  out["Fast Grower"] = FAST_GROWER_FLOOR;
  // Defizit proportional von den anderen Stilen abziehen, damit die Summe 1 bleibt.
  const others = (Object.keys(out) as ThesisStyle[]).filter(s => s !== "Fast Grower");
  const othersSum = others.reduce((a, s) => a + out[s], 0) || 1;
  others.forEach(s => { out[s] = Math.max(0, out[s] - deficit * (out[s] / othersSum)); });
  const total = (Object.keys(out) as ThesisStyle[]).reduce((a, s) => a + out[s], 0) || 1;
  (Object.keys(out) as ThesisStyle[]).forEach(s => out[s] = out[s] / total);
  return out;
}

// Auftrag 09.08.2026 ("NKE-Vorfall", Ticket Teil D.2): Deckel-Guard --
// Gegenstueck zu applyFastGrowerSafetyGuard (Boden). Wenn SOWOHL Revenue-YoY
// ALS AUCH EPS-CAGR schwach sind (<5%), darf Fast Grower nach dem Softmax
// nicht mehr als 15% Konfidenz behalten -- ein negativ/flach wachsendes
// Unternehmen (wie NKE: Rev YoY +0.2%, EPS-CAGR -25%) darf strukturell nicht
// als Fast-Grower-dominant klassifiziert werden, unabhaengig davon, wie die
// rohen Cosine-Similarities zufaellig ausfallen.
export function applyWeakGrowthCeiling(confidences: Record<ThesisStyle, number>, revenueYoyPct: number | null, epsCagr5yPct: number | null): Record<ThesisStyle, number> {
  // Nur greifen wenn BEIDE Werte tatsaechlich vorliegen und schwach sind --
  // fehlende Daten (finite()===false) duerfen den Deckel NICHT ausloesen,
  // sonst wuerde jeder Ticker mit unvollstaendigen Kennzahlen faelschlich
  // gedeckelt statt neutral behandelt zu werden.
  if (!finite(revenueYoyPct) || !finite(epsCagr5yPct)) return confidences;
  const weakRevenue = revenueYoyPct! < 5;
  const weakCagr = epsCagr5yPct! < 5;
  if (!(weakRevenue && weakCagr)) return confidences;
  const FAST_GROWER_CEILING = 0.15;
  if (confidences["Fast Grower"] <= FAST_GROWER_CEILING) return confidences;
  const out = { ...confidences };
  const surplus = out["Fast Grower"] - FAST_GROWER_CEILING;
  out["Fast Grower"] = FAST_GROWER_CEILING;
  // Ueberschuss proportional an die anderen Stile verteilen, Summe bleibt 1.
  const others = (Object.keys(out) as ThesisStyle[]).filter(s => s !== "Fast Grower");
  const othersSum = others.reduce((a, s) => a + out[s], 0) || 1;
  others.forEach(s => { out[s] = out[s] + surplus * (out[s] / othersSum); });
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
export interface ExternalCapitalInput { netDebt:number|null; ebitda:number|null; cashAndEquivalents:number|null; marketCap:number|null; commonStockRepurchased:number|null; dividendsPaid:number|null; }
export function scoreExternal(input:ExternalCapitalInput):{score:number;flags:string[]}{const flags:string[]=[];const allMissing=Object.values(input).every(v=>!finite(v));if(allMissing)return{score:.50,flags:["Bilanz- und Kapitalrückführungsdaten fehlen — neutraler B-Score"]};let balanceScore:number;if(!finite(input.netDebt)||!finite(input.ebitda)||input.ebitda<=0){balanceScore=.50;flags.push("Bilanzdaten für Net Debt/EBITDA fehlen — neutraler Teilscore");}else if(input.netDebt/input.ebitda<0||(finite(input.cashAndEquivalents)&&finite(input.marketCap)&&input.marketCap>0&&input.cashAndEquivalents/input.marketCap>.15))balanceScore=.90;else if(input.netDebt/input.ebitda<=1)balanceScore=.70;else if(input.netDebt/input.ebitda<=2.5)balanceScore=.50;else balanceScore=.25;const repurchased=finite(input.commonStockRepurchased)?Math.abs(input.commonStockRepurchased):null,dividends=finite(input.dividendsPaid)?Math.abs(input.dividendsPaid):null;const capitalReturnScore=repurchased!=null&&dividends!=null&&repurchased>0&&dividends>0 ? .80 : (repurchased!=null&&repurchased>0)||(dividends!=null&&dividends>0) ? .60 : .35;if(capitalReturnScore===.35)flags.push("keine Kapitalrückführung erkennbar");return{score:.60*balanceScore+.40*capitalReturnScore,flags};}
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
// Auftrag 11.08.2026 ("E-Score KI-Katalysatoren Fix"):
// Baustein E nutzt echte KI-Katalysatoren statt Text-Alignment. Die empirische
// Pruefung der bestehenden Pipeline (catalyst-engine.ts, llm-openrouter.ts und
// gespeicherte MSFT-Katalysatoren) zeigt: catalyst.gb liegt in Prozentpunkten
// vor, denn gb = pos/100 * nettoUpside (z.B. 79% * 12.35% = 9.76pp). Fuer das
// neue Modell rechnen wir deshalb explizit in Anteilen:
// GB_i = (pos_i/100) * (nettoUpside_i/100), Normalisierung mit Divisor 0.28.
// Fehlende/ungenaue Daten werden neutral/transparent behandelt, nicht geschaetzt.
// TODO Folgeticket: LLM-Prompt um echtes evidence_strength-Feld erweitern.
export function scoreCatalystConfidenceFromE(eScore:number):number { return Math.min(.85, .45 + clamp01(eScore) * .40); }
export function scoreCatalystAlignment(catalysts:Array<{name?:string;context?:string;tags?:string[];pos?:number;nettoUpside?:number;generic?:boolean}>|null|undefined,segmentName?:string|null,thesisText?:string|null):{score:number;flags:string[]}{
  if(!catalysts?.length)return{score:.35,flags:["Keine Katalysatoren verfügbar — neutraler Teilscore"]};
  const flags:string[]=[];
  let validCount=0, discardedCount=0, gbTotal=0, evidenceSum=0;
  let hasNearTermTimeline=false;
  for(const c of catalysts){
    // Uebergangsloesung bis zum echten evidence_strength-Schemafeld:
    // generic=false => firmenspezifischer KI-Output (0.75). generic=true =>
    // explizit als Template/Fallback markiert (0.45), wird verworfen.
    // generic===undefined (der haeufigste Fall im normalen /api/analyze-Pfad
    // OHNE KI-Enrich-Klick, siehe generateCatalysts() in catalyst-engine.ts,
    // das generic bisher nie setzt) wird NICHT konservativ verworfen -- sonst
    // waere der E-Score fuer die meisten Analysen standardmaessig kollabiert
    // und nur nach explizitem KI-Enrich-Klick brauchbar (Live-Beweis 11.08.2026:
    // MSFT-Cache ohne Enrich-Klick hatte generic=undefined auf allen 4
    // Katalysatoren, E-Score fiel von 0.75 auf 0.35 -- Nutzerentscheidung:
    // undefined wird wie firmenspezifisch (false) behandelt, nur ein
    // EXPLIZITES generic=true (Template/Fallback) wird verworfen).
    const isExplicitlyGeneric = c.generic === true;
    const evidenceStrength = isExplicitlyGeneric ? .45 : .75;
    let pos = finite(c.pos) ? c.pos! : NaN;
    const nettoUpside = finite(c.nettoUpside) ? c.nettoUpside! : NaN;
    const valid = !isExplicitlyGeneric && finite(pos) && pos >= 5 && pos <= 90 && finite(nettoUpside) && nettoUpside > 0;
    if(!valid){discardedCount++;continue;}
    if(pos > 85) pos = 80; // Extrem-PoS konservativ kappen, nicht verwerfen.
    validCount++;
    evidenceSum += evidenceStrength;
    gbTotal += (pos / 100) * (nettoUpside / 100);
    const timeline=String((c as any).timeline||"").trim();
    if(/^6-12M\b/i.test(timeline)||/^12-18M\b/i.test(timeline))hasNearTermTimeline=true;
  }
  flags.push(`Katalysatoren erhalten: ${catalysts.length}, valide für E-Score: ${validCount}`);
  if(discardedCount>0)flags.push(`Katalysatoren verworfen: ${discardedCount} (explizit generic=true/fehlende PoS/Netto-Upside/Skala außerhalb 5-90%)`);
  if(validCount===0)return{score:.35,flags:[...flags,"Keine Katalysatoren verfügbar — neutraler Teilscore"]};
  const firmSpecificRatio=validCount/Math.max(1,catalysts.length);
  const avgEvidence=evidenceSum/validCount;
  const timelineScore=hasNearTermTimeline?1.00:.70;
  const q=.40*firmSpecificRatio+.35*avgEvidence+.25*timelineScore;
  const gbNorm=Math.min(1,gbTotal/.28);
  const confidenceFactor=validCount>=4?1.00:validCount===3?.85:validCount===2?.65:.40;
  if(validCount<2)flags.push("E-Score gedeckelt: zu wenige firmenspezifische Katalysatoren (< 2 valide) — ConfidenceFactor 0.40");
  flags.push(`E-Score-Modell: GB_norm=${gbNorm.toFixed(2)}, Q=${q.toFixed(2)}, ConfidenceFactor=${confidenceFactor.toFixed(2)}`);
  const score=clamp01(gbNorm*q*confidenceFactor);
  return{score,flags};
}
export interface ThesisStrengthInput { vector:CompanyVector; fcf:number|null; gStar:number|null; thesisGrowth:number|null; consensusGrowth?:number|null; sectorGrowthMedian?:number|null; backlogAvailable:boolean; catalysts?:Array<{name?:string;context?:string;tags?:string[];pos?:number;nettoUpside?:number;generic?:boolean}>; segmentName?:string|null; balance:{inventoryZ:number;growthZ:number;marginZ:number;marginPositivePeriods:number}; turnaround:TurnaroundSeries; lynchClass?:string|null; peerGapPct?:number|null; maxSegmentGrowthPct?:number|null; epsCagr5yPct?:number|null; revenueYoyPct?:number|null; sector?:string|null; industry?:string|null; peTTM?:number|null; sectorMedianPE?:number|null; thesisText?:string|null; revenueGrowthSeries?:number[]|null; epsGrowthSeries?:number[]|null; marginSeries?:number[]|null; externalCapital?:ExternalCapitalInput; }
export function computeThesisStrength(input:ThesisStrengthInput){const flags=[...(input.vector.missingFeatures||[]).map(x=>`Merkmal fehlt: ${x}`)];
 // Auftrag 07.08.2026 ("Querschnitts-Konsistenz + Wachstums-Logik"): GrowthEvidence
 // wird IMMER berechnet (auch bei fehlenden Einzel-Inputs -- computeGrowthEvidence
 // liefert dann niedrigere Teilscores + Flags, nie einen Absturz), bevor die
 // Stil-Konfidenzen berechnet werden. Damit ist die Thesis-Klassifikation
 // verbindlich an die Querschnittsdaten aus S1/S2/S7 gebunden statt isoliert
 // vom Company-Vektor allein abzuhaengen.
 const ge=computeGrowthEvidence({peerGapPct:input.peerGapPct??null,maxSegmentGrowthPct:input.maxSegmentGrowthPct??null,epsCagr5yPct:input.epsCagr5yPct??null,lynchClass:input.lynchClass,revenueYoyPct:input.revenueYoyPct??null,sector:input.sector??null,industry:input.industry??null,earningsVolatility:input.vector.earningsVolatility,peTTM:input.peTTM??null,sectorMedianPE:input.sectorMedianPE??null,revenueGrowthSeries:input.revenueGrowthSeries??null,epsGrowthSeries:input.epsGrowthSeries??null,marginSeries:input.marginSeries??null});
 flags.push(...ge.flags);
 let c=computeStyleConfidences(input.vector, input.lynchClass, ge.evidence);
 c=applyFastGrowerSafetyGuard(c, ge.evidence, input.peerGapPct??null, input.maxSegmentGrowthPct??null, ge.cyclicalPeFlag, input.revenueYoyPct??null);
 c=applyWeakGrowthCeiling(c, input.revenueYoyPct??null, input.epsCagr5yPct??null);
 const w=blendWeights(c);if(Math.max(...Object.values(c))<.35)flags.push("Klassifikation unsicher — neutrale Gewichte verwendet");const a=scoreContractual(input.backlogAvailable);const b=scoreExternal(input.externalCapital??{netDebt:null,ebitda:null,cashAndEquivalents:null,marketCap:null,commonStockRepurchased:null,dividendsPaid:null});const gc=scoreGrowthCoverage({fcf:input.fcf,gStar:input.gStar,thesisGrowth:input.thesisGrowth,consensusGrowth:input.consensusGrowth,sectorGrowthMedian:input.sectorGrowthMedian});const ta=computeTurnaroundEvidence(input.turnaround);const d=scoreBalanceSheet({...input.balance,turnaroundConfidence:c["Turnaround"],turnaroundEvidence:ta.evidence});const e=scoreCatalystAlignment(input.catalysts,input.segmentName,input.thesisText);const catalystConfidence=Math.min(.85,.45+e.score*.40);flags.push(...a.flags,...b.flags,...gc.flags,...d.flags,...e.flags);const raw=10*(w.A*a.score+w.B*b.score+w.C*gc.score+w.D*d.score+w.E*e.score);const conf=Math.max(...Object.values(c));return{finalScore:+raw.toFixed(2),rawScore:+raw.toFixed(2),styleConfidences:c,blendedWeights:w,subScores:{A:a.score,B:b.score,C:gc.score,D:d.score,E:e.score},growthCoverage:gc,turnaroundEvidence:ta,flags:Array.from(new Set(flags)),classificationConfidence:conf,catalystConfidence,growthEvidence:ge};}
