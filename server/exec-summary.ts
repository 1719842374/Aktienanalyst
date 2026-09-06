/**
 * Adaptive Executive Summary — gilt für jeden Ticker.
 * Keine MSFT-Konstanten. Alles aus der Analyze-Response / Cache.
 * UI-Hook: Response-Feld execSummary + Karte über Sektion 1.
 */

export interface ExecLine {
  text: string;
  src: string;
  value?: number;
}

export interface ExecSummaryInput {
  ticker: string;
  companyName: string;
  price: number;
  marketCap?: number;
  revenueGrowthPct?: number | null;
  waccPct?: number | null;
  gStarPct?: number | null;
  g1Pct?: number | null;
  pe?: number | null;
  forwardPe?: number | null;
  peg?: number | null;
  dcfConservative?: number | null;
  analystPtMedian?: number | null;
  riskAdjTarget?: number | null;
  invertedDcf?: number | null;
  crvBase?: number | null;
  crvRiskAdj?: number | null;
  maxEntryCrv3?: number | null;
  scoreCapped?: number | null;
  scoreGate?: string | null;
  s17Verdict?: string | null;
  nextEarningsDate?: string | null;
  lastReportedQuarter?: string | null;
  /** S9 cache — omit Cross sentence when undefined */
  ma50AboveMA200?: boolean | null;
  priceAboveMA200?: boolean | null;
  catalysts?: Array<{
    name: string; pos?: number; einpreisungsgrad?: number;
    gb?: number; nettoUpside?: number;
  }>;
  downside?: Array<{ name: string; impactPct?: number }>;
  risks?: Array<{
    name: string; expectedDamagePct?: number; underestimated?: boolean;
  }>;
  moat?: string | null;
  porterHighForces?: string[];
  pestel?: Array<{ key: string; exposure: string; kurstreiber?: number; kursrisiko?: number }>;
  segments?: Array<{ name: string; revenue?: number; sharePct?: number; yoyPct?: number }>;
}

export interface ExecSummary {
  ticker: string;
  headline: string;
  callLine: string;
  callAvailable: boolean;
  porterLine: string;
  pestelLine: string;
  pro: ExecLine[];
  contra: ExecLine[];
  fazit: { lage: string; bruch: string; handlung: string };
  /** DoD: always present */
  crvLine: string;
  /** DoD: P_alle / P_bind from Top-3 PoS≥40 with GB */
  posLine: string;
  /** DoD: only when ma50AboveMA200 is boolean in cache; else empty */
  crossLine: string;
}

const MONTH_DE = [
  "Januar","Februar","März","April","Mai","Juni",
  "Juli","August","September","Oktober","November","Dezember",
];

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} Bio.`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} Mio.`;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

function fmtPx(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

export function formatEarningsCall(
  nextEarningsDate?: string | null,
  lastReportedQuarter?: string | null,
): { callLine: string; callAvailable: boolean; headlineBit: string } {
  if (!nextEarningsDate) {
    return {
      callAvailable: false,
      headlineBit: "Call n/v",
      callLine: "Ein Call-Termin steht im Cache nicht.",
    };
  }
  const d = new Date(nextEarningsDate);
  if (Number.isNaN(d.getTime())) {
    return {
      callAvailable: false,
      headlineBit: "Call n/v",
      callLine: "Ein Call-Termin steht im Cache nicht.",
    };
  }
  const long = `${d.getUTCDate()}. ${MONTH_DE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const short = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  const last = lastReportedQuarter ? `; zuletzt gemeldet wurde ${lastReportedQuarter}` : "";
  return {
    callAvailable: true,
    headlineBit: `Call ${short}`,
    callLine: `Der nächste Earnings Call ist am ${long}${last}.`,
  };
}

function topCatalysts(input: ExecSummaryInput) {
  return [...(input.catalysts || [])]
    .filter(c => finite(c.gb) && (c.pos == null || c.pos >= 40))
    .sort((a, b) => (b.gb || 0) - (a.gb || 0));
}

export function pickPro(input: ExecSummaryInput): ExecLine[] {
  const out: ExecLine[] = [];
  for (const c of topCatalysts(input).slice(0, 2)) {
    out.push({
      src: "S15",
      value: c.gb,
      text: `${c.name} · GB ${c.gb!.toFixed(2)} %`,
    });
  }
  if (input.moat) {
    out.push({ src: "S11", text: `Moat ${input.moat}` });
  }
  const tech = (input.pestel || []).find(p => /tech|techno/i.test(p.key) && (p.kurstreiber || 0) >= 1);
  if (tech) out.push({ src: "S12", text: `PESTEL ${tech.key}: Kurstreiber` });
  if (finite(input.revenueGrowthPct) && finite(input.waccPct) && input.revenueGrowthPct > input.waccPct) {
    out.push({
      src: "S4/S5",
      value: input.revenueGrowthPct,
      text: `Umsatz +${input.revenueGrowthPct.toFixed(1)} % über WACC ${input.waccPct.toFixed(2)} %`,
    });
  }
  return out.slice(0, 5);
}

export function pickContra(input: ExecSummaryInput): ExecLine[] {
  const out: ExecLine[] = [];
  const risks = [...(input.risks || [])].sort(
    (a, b) => (b.expectedDamagePct || 0) - (a.expectedDamagePct || 0),
  );
  if (risks[0] && finite(risks[0].expectedDamagePct)) {
    out.push({
      src: "S8",
      value: risks[0].expectedDamagePct,
      text: `${risks[0].name} · ED ${risks[0].expectedDamagePct.toFixed(2)} %${risks[0].underestimated ? " · zu klein gerechnet" : ""}`,
    });
  }
  for (const f of input.porterHighForces || []) {
    out.push({ src: "S11", text: `Porter ${f} hoch` });
  }
  const legal = (input.pestel || []).find(p => /recht|legal/i.test(p.key) && /hoch|high/i.test(p.exposure));
  if (legal) out.push({ src: "S12", text: `PESTEL ${legal.key} hoch` });
  if (finite(input.riskAdjTarget) && finite(input.price) && input.riskAdjTarget < input.price * 0.95) {
    const gap = (input.riskAdjTarget / input.price - 1) * 100;
    out.push({
      src: "S8",
      value: input.riskAdjTarget,
      text: `Risk-Ziel ${fmtPx(input.riskAdjTarget)} (${gap.toFixed(1)} % vs Kurs)`,
    });
  }
  if (finite(input.crvRiskAdj) && input.crvRiskAdj < 1) {
    out.push({ src: "S6", value: input.crvRiskAdj, text: `CRV risikoadjustiert ${input.crvRiskAdj.toFixed(1)}:1` });
  }
  const k5ish = (input.catalysts || []).filter(c => (c.pos ?? 100) < 40 || (c.einpreisungsgrad ?? 0) >= 60);
  for (const c of k5ish.slice(0, 1)) {
    out.push({ src: "S15", text: `${c.name} eher Bremse (PoS ${c.pos ?? "–"} %, Einpr. ${c.einpreisungsgrad ?? "–"} %)` });
  }
  return out.slice(0, 5);
}

export function buildFazit(input: ExecSummaryInput): ExecSummary["fazit"] {
  const name = input.companyName || input.ticker;
  const verdict = (input.s17Verdict || "NEUTRAL").toLowerCase();
  const gStar = finite(input.gStarPct) ? input.gStarPct.toFixed(1) : null;
  const g1 = finite(input.g1Pct) ? input.g1Pct.toFixed(0) : null;
  const dcf = finite(input.dcfConservative) ? fmtPx(input.dcfConservative) : null;
  const px = fmtPx(input.price);
  const pt = finite(input.analystPtMedian) ? fmtPx(input.analystPtMedian) : null;
  const risk = finite(input.riskAdjTarget) ? fmtPx(input.riskAdjTarget) : null;
  const entry = finite(input.maxEntryCrv3) ? fmtPx(input.maxEntryCrv3) : null;
  const call = formatEarningsCall(input.nextEarningsDate, input.lastReportedQuarter);

  const lage = [
    `${name} ist ${verdict}.`,
    dcf ? `Das konservative DCF sitzt bei ${dcf} Dollar gegenüber ${px} Dollar Kurs.` : null,
    gStar && g1 ? `Der Markt preist rund ${gStar} % Dauerwachstum, das Modell eher ${g1} %.` : null,
    pt ? `Das Analystenziel liegt bei ${pt} Dollar.` : null,
  ].filter(Boolean).join(" ");

  const topRisk = [...(input.risks || [])].sort(
    (a, b) => (b.expectedDamagePct || 0) - (a.expectedDamagePct || 0),
  )[0];
  const bruch = [
    "Was nicht im Preis steckt, ist der Risikoabschlag.",
    topRisk ? `${topRisk.name} wird zu klein gerechnet.` : null,
    risk ? `Mit Abschlag eher ${risk} Dollar als ${px}.` : null,
  ].filter(Boolean).join(" ");

  const waitBecause =
    finite(input.maxEntryCrv3) && input.price > input.maxEntryCrv3
      ? `Nachkaufen erst unter ${entry} Dollar.`
      : "Position nicht überstürzen.";
  const handlung = `Deshalb warten. ${waitBecause} ${call.callLine}`;

  return { lage, bruch, handlung };
}


export function buildCrvLine(input: ExecSummaryInput): string {
  const entry = finite(input.maxEntryCrv3) ? input.maxEntryCrv3 : null;
  const crvBase = finite(input.crvBase) ? input.crvBase : null;
  const crvRA = finite(input.crvRiskAdj) ? input.crvRiskAdj : null;
  if (entry != null && input.price <= entry) {
    return "Chance zu Risiko 3 zu 1 ist am Kurs erfüllt.";
  }
  const baseBit = crvBase != null ? crvBase.toFixed(1) : "n/v";
  const raBit = crvRA != null ? crvRA.toFixed(1) : "n/v";
  const entryBit = entry != null ? fmtPx(entry) : "n/v";
  return `3 zu 1 ist am Kurs nicht erfüllt (jetzt ${baseBit}:1, risikoadjustiert ${raBit}:1). Dafür erst unter ${entryBit}.`;
}

/** Top 3 catalysts with GB + PoS, PoS ≥ 40 — same pool as S15/S2. */
export function buildPosLine(input: ExecSummaryInput): string {
  const ranked = [...(input.catalysts || [])]
    .filter(c => finite(c.gb) && finite(c.pos) && (c.pos as number) >= 40)
    .sort((a, b) => (b.gb || 0) - (a.gb || 0))
    .slice(0, 3);
  if (ranked.length === 0) {
    return "Für P_alle/P_bind fehlen Katalysatoren mit GB und PoS ≥ 40.";
  }
  const names = ranked.map(c => c.name).join(", ");
  const pcts = ranked.map(c => Math.round(c.pos as number)).join(", ");
  let pAlle = 1;
  for (const c of ranked) pAlle *= (c.pos as number) / 100;
  const pBind = Math.min(...ranked.map(c => (c.pos as number) / 100));
  const bindName = ranked.reduce((a, b) => ((a.pos as number) <= (b.pos as number) ? a : b)).name;
  const allePct = Math.round(pAlle * 100);
  const bindPct = Math.round(pBind * 100);
  return `${names} stehen bei ${pcts} Prozent. Dass alle kommen, sind unter Unabhängigkeit knapp ${allePct} Prozent. Der bindende Fall ist ${bindName} mit ${bindPct} Prozent.`;
}

export function buildCrossLine(input: ExecSummaryInput): string {
  if (typeof input.ma50AboveMA200 !== "boolean") return "";
  if (input.ma50AboveMA200 === false) {
    return "Im Chart liegt ein Death Cross (50-Tage unter 200-Tage) — Bärenlage, die Bewertung ist kein Timing.";
  }
  if (input.ma50AboveMA200 === true && input.priceAboveMA200 === true) {
    return "50-Tage über 200-Tage (Golden-Cross-Lage), Kurs über der 200-Tage.";
  }
  // Golden-cross flag true but price not above MA200 — still one factual sentence, no invent
  if (input.ma50AboveMA200 === true) {
    return "50-Tage über 200-Tage (Golden-Cross-Lage).";
  }
  return "";
}

export function buildExecSummary(input: ExecSummaryInput): ExecSummary {
  const call = formatEarningsCall(input.nextEarningsDate, input.lastReportedQuarter);
  const pestelBits = (input.pestel || []).map(p => `${p.key[0]?.toUpperCase() || "?"}:${p.exposure[0]?.toUpperCase() || "?"}`);
  return {
    ticker: input.ticker,
    headline: [
      input.ticker,
      fmtPx(input.price),
      finite(input.scoreCapped) ? String(input.scoreCapped) : null,
      finite(input.gStarPct) ? `g* ${input.gStarPct.toFixed(1)} %` : null,
      call.headlineBit,
    ].filter(Boolean).join(" · "),
    callLine: call.callLine,
    callAvailable: call.callAvailable,
    porterLine: `Moat ${input.moat || "n/v"}${(input.porterHighForces || []).length ? ` · hoch: ${input.porterHighForces!.join(", ")}` : ""}`,
    pestelLine: pestelBits.length ? pestelBits.join(" · ") : "PESTEL n/v",
    pro: pickPro(input),
    contra: pickContra(input),
    fazit: buildFazit(input),
    crvLine: buildCrvLine(input),
    posLine: buildPosLine(input),
    crossLine: buildCrossLine(input),
  };
}
