/**
 * analyze-helpers.ts
 * Parse utilities, FX, PESTEL, FMP budget tracker, quota guard, getFmpFallbackData.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import { execSync } from "child_process";
import type { PESTELAnalysis, PESTELFactor, PESTELFactorItem, CurrencyInfo } from "../shared/schema";
import {
  isFmpAvailable, fmpBatchQuote, fmpProfile, fmpIncomeStatement, fmpCashFlow,
  fmpBalanceSheet, fmpHistoricalPrices, fmpAnalystEstimates, fmpGrades, fmpPriceTarget,
  fmpSegments, fmpPeers, fmpRatios, fmpKeyMetrics, convertFmpRowsToUsd,
} from "./fmp";

// ============================================================
// FMP Budget Tracker
// ============================================================
const FMP_DAILY_LIMIT = 750;
const FMP_WARN_THRESHOLD = 600;
let fmpCallsToday = 0;
let fmpCallsDate = new Date().toDateString();

export function trackFmpCall(count = 1): number {
  const today = new Date().toDateString();
  if (today !== fmpCallsDate) { fmpCallsToday = 0; fmpCallsDate = today; }
  fmpCallsToday += count;
  if (fmpCallsToday === FMP_WARN_THRESHOLD)
    console.warn(`[FMP-BUDGET] ⚠ ${fmpCallsToday}/${FMP_DAILY_LIMIT} Calls — noch ${FMP_DAILY_LIMIT - fmpCallsToday} (~${Math.floor((FMP_DAILY_LIMIT - fmpCallsToday) / 13)} Analysen)`);
  return fmpCallsToday;
}

export function getFmpBudgetStatus() {
  const today = new Date().toDateString();
  if (today !== fmpCallsDate) { fmpCallsToday = 0; fmpCallsDate = today; }
  const remaining = FMP_DAILY_LIMIT - fmpCallsToday;
  return { ok: remaining > 0, today: fmpCallsToday, limit: FMP_DAILY_LIMIT, remaining, analyses: Math.floor(remaining / 13) };
}

// ============================================================
// Daily Quota Guard (legacy Perplexity Finance connector stub)
// ============================================================
const DAILY_FINANCE_LIMIT = 18;
let _quotaDate = new Date().toDateString();
let _quotaCount = 0;
let quotaExceededAt: number | null = null;
const QUOTA_RESET_MS = 60 * 60 * 1000;

export function markQuotaExceeded(): void { quotaExceededAt = Date.now(); }
export function markQuotaReset(): void { if (quotaExceededAt !== null) { console.log('[Quota] Manual reset'); quotaExceededAt = null; } }

export function incrementQuota() {
  const today = new Date().toDateString();
  if (today !== _quotaDate) { _quotaDate = today; _quotaCount = 0; }
  _quotaCount++;
  console.log(`[QUOTA] Finance analyses today: ${_quotaCount}/${DAILY_FINANCE_LIMIT}`);
}

export function isQuotaExceeded(): boolean {
  if (quotaExceededAt && (Date.now() - quotaExceededAt) > QUOTA_RESET_MS) { quotaExceededAt = null; }
  const today = new Date().toDateString();
  if (today !== _quotaDate) { _quotaDate = today; _quotaCount = 0; }
  if (_quotaCount >= DAILY_FINANCE_LIMIT) {
    console.warn(`[QUOTA] Daily limit reached (${_quotaCount}/${DAILY_FINANCE_LIMIT})`);
    return true;
  }
  return quotaExceededAt !== null;
}

export function getQuotaStatus() {
  if (quotaExceededAt && (Date.now() - quotaExceededAt) > QUOTA_RESET_MS) { quotaExceededAt = null; }
  const today = new Date().toDateString();
  if (today !== _quotaDate) { _quotaDate = today; _quotaCount = 0; }
  return { today: _quotaCount, limit: DAILY_FINANCE_LIMIT, remaining: Math.max(0, DAILY_FINANCE_LIMIT - _quotaCount), quotaExceededAt, resetsAt: quotaExceededAt ? new Date(quotaExceededAt + QUOTA_RESET_MS).toISOString() : null };
}

// ============================================================
// callFinanceToolThrottled — stub (external tool removed)
// ============================================================
export async function callFinanceToolThrottled(_toolName: string, _args: Record<string, any>, _opts: { spacingMs?: number; maxRetries?: number } = {}): Promise<any> {
  return null;
}

// ============================================================
// curlOrFetchSync / fetchUrlText
// ============================================================
export function curlOrFetchSync(url: string, timeoutMs = 30000): string {
  try {
    return execSync(`curl -sL "${url}"`, { encoding: "utf-8", timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 });
  } catch (curlErr: any) {
    console.warn(`[curlOrFetch] curl failed (${curlErr?.message?.substring(0, 80)}) for ${url.substring(0, 80)}`);
    throw curlErr;
  }
}

export async function fetchUrlText(url: string, timeoutMs = 30000): Promise<string> {
  try {
    return curlOrFetchSync(url, timeoutMs);
  } catch {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) throw new Error(`fetch ${resp.status} for ${url.substring(0, 80)}`);
    return resp.text();
  }
}

// ============================================================
// Cache LLM-mode compatibility check
// ============================================================
export function cacheLLMModeMatches(cachedUseLLM: boolean | undefined | null, requestedUseLLM: boolean): boolean {
  if (cachedUseLLM === undefined || cachedUseLLM === null) return true;
  return cachedUseLLM === requestedUseLLM;
}

// ============================================================
// Parse helpers
// ============================================================
export function parseMarkdownTable(content: string): Record<string, string>[] {
  const lines = content.split("\n");
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
    if (cells.length === 0) continue;
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    if (headers.length === 0) { headers = cells; }
    else { const row: Record<string, string> = {}; cells.forEach((c, i) => { if (headers[i]) row[headers[i]] = c; }); rows.push(row); }
  }
  return rows;
}

export function parseNumber(s: string | undefined): number {
  if (!s) return 0;
  let cleaned = s.replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "").trim();
  let multiplier = 1;
  if (/[Tt]$/.test(cleaned)) { multiplier = 1e12; cleaned = cleaned.slice(0, -1); }
  else if (/[Bb]$/.test(cleaned)) { multiplier = 1e9; cleaned = cleaned.slice(0, -1); }
  else if (/[Mm]$/.test(cleaned)) { multiplier = 1e6; cleaned = cleaned.slice(0, -1); }
  else if (/[Kk]$/.test(cleaned)) { multiplier = 1e3; cleaned = cleaned.slice(0, -1); }
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) cleaned = "-" + cleaned.slice(1, -1);
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n * multiplier;
}

export function parseCSVFromUrl(csvUrl: string): Record<string, string>[] {
  try {
    const csv = curlOrFetchSync(csvUrl, 30000);
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    return lines.slice(1).map(line => {
      const cells: string[] = []; let current = ""; let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
        current += ch;
      }
      cells.push(current.trim());
      const row: Record<string, string> = {};
      cells.forEach((c, i) => { if (headers[i]) row[headers[i]] = c; });
      return row;
    });
  } catch { return []; }
}

// ============================================================
// FMP Fallback Data Fetcher
// ============================================================
export async function getFmpFallbackData(ticker: string): Promise<{
  quote: any; profile: any;
  financials: { income: any[]; cashflow: any[]; balanceSheet: any[] };
  analyst: { priceTarget: any; grades: any[]; estimates: any[] };
  ohlcv: any[]; segments: any[]; peers: any[]; ratios: any[];
  source: 'fmp';
} | null> {
  if (!isFmpAvailable()) { console.warn(`[FMP-FALLBACK] FMP_API_KEY not set for ${ticker}`); return null; }
  console.log(`[FMP-FALLBACK] Fetching data from FMP for ${ticker}...`);
  const t0 = Date.now();
  try {
    const settledAll = await Promise.allSettled([
      fmpBatchQuote([ticker]),
      fmpProfile(ticker),
      fmpIncomeStatement(ticker, 3),
      fmpCashFlow(ticker, 3),
      fmpBalanceSheet(ticker, 1),
      fmpPriceTarget(ticker),
      fmpGrades(ticker, 20),
      fmpAnalystEstimates(ticker, 3),
      fmpHistoricalPrices(ticker,
        new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      ),
      fmpSegments(ticker),
      fmpPeers(ticker),
      fmpRatios(ticker, 3),
      fmpKeyMetrics(ticker, 3),
    ]);
    const get = (res: PromiseSettledResult<any>) => res.status === 'fulfilled' ? res.value : null;
    const [quoteRes, profileRes, incomeRes, cashflowRes, balanceSheetRes, priceTargetRes, gradesRes, estimatesRes, ohlcvRes, segmentsRes, peersRes, ratiosRes] = settledAll;
    const quoteData = get(quoteRes);
    const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
    if (!quote?.price) { console.warn(`[FMP-FALLBACK] No quote data for ${ticker}`); return null; }
    console.log(`[FMP-FALLBACK] OK for ${ticker} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const [incomeUsd, cashflowUsd, balanceSheetUsd] = await Promise.all([
      convertFmpRowsToUsd(get(incomeRes) || []),
      convertFmpRowsToUsd(get(cashflowRes) || []),
      convertFmpRowsToUsd(get(balanceSheetRes) || []),
    ]);
    return {
      quote, profile: get(profileRes),
      financials: { income: incomeUsd, cashflow: cashflowUsd, balanceSheet: balanceSheetUsd },
      analyst: { priceTarget: get(priceTargetRes), grades: get(gradesRes) || [], estimates: get(estimatesRes) || [] },
      ohlcv: get(ohlcvRes) || [], segments: get(segmentsRes) || [], peers: get(peersRes) || [], ratios: get(ratiosRes) || [],
      source: 'fmp',
    };
  } catch (err: any) { console.error(`[FMP-FALLBACK] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`); return null; }
}

// ============================================================
// Currency Detection & FX Conversion
// ============================================================
export function detectReportedCurrency(financialsContent: string): string | null {
  const match = financialsContent.match(/\(([A-Z]{3})\)/);
  if (match) return match[1];
  const currMatch = financialsContent.match(/[Cc]urrency[:\s]+([A-Z]{3})/);
  if (currMatch) return currMatch[1];
  const unitMatch = financialsContent.match(/(?:in|million|thousands?)\s+([A-Z]{3})/i);
  if (unitMatch) return unitMatch[1].toUpperCase();
  return null;
}

export function fetchFXRate(fromCurrency: string, toCurrency = "USD"): number | null {
  if (fromCurrency === toCurrency) return 1.0;
  const fallbackRates: Record<string, number> = {
    EUR: 1.09, GBP: 1.27, CHF: 1.13, JPY: 0.0067, CNY: 0.138,
    HKD: 0.128, KRW: 0.00074, SEK: 0.096, NOK: 0.094, DKK: 0.146,
    AUD: 0.65, CAD: 0.74, SGD: 0.75, INR: 0.012, BRL: 0.18,
    TWD: 0.031, ZAR: 0.055, MXN: 0.058, PLN: 0.26, CZK: 0.043,
    KZT: 0.00196, TRY: 0.026, ILS: 0.28, THB: 0.029, PHP: 0.017,
    IDR: 0.000061, VND: 0.000039, NGN: 0.00063, EGP: 0.02, ARS: 0.00089,
    CLP: 0.0011, COP: 0.00024, PEN: 0.27, RUB: 0.011, UAH: 0.024,
  };
  if (fallbackRates[fromCurrency]) { console.log(`[FX] Using fallback rate for ${fromCurrency}: ${fallbackRates[fromCurrency]}`); return fallbackRates[fromCurrency]; }
  return null;
}

export function convertFinancials(
  fxRate: number,
  data: { revenue: number; netIncome: number; ebitda: number; fcfTTM: number; totalDebt: number; cashEquivalents: number; totalEquity: number; totalAssets: number; netDebt: number; operatingIncome: number; grossProfit: number; sharesOutstanding: number }
): typeof data {
  return {
    revenue: data.revenue * fxRate, netIncome: data.netIncome * fxRate, ebitda: data.ebitda * fxRate,
    fcfTTM: data.fcfTTM * fxRate, totalDebt: data.totalDebt * fxRate, cashEquivalents: data.cashEquivalents * fxRate,
    totalEquity: data.totalEquity * fxRate, totalAssets: data.totalAssets * fxRate, netDebt: data.netDebt * fxRate,
    operatingIncome: data.operatingIncome * fxRate, grossProfit: data.grossProfit * fxRate,
    sharesOutstanding: data.sharesOutstanding,
  };
}

// ============================================================
// PESTEL Analysis Generator
// ============================================================
export function generatePESTELAnalysis(
  sector: string, industry: string, description: string,
  beta: number, govExposure: number, reportedCurrency: string
): PESTELAnalysis {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const factors: PESTELFactor[] = [];

  const regionMap: Record<string, string> = {
    USD: "USA", EUR: "Europa/EU", GBP: "UK", CHF: "Schweiz", JPY: "Japan",
    CNY: "China", HKD: "Hongkong/China", KRW: "Südkorea", TWD: "Taiwan",
    INR: "Indien", BRL: "Brasilien", CAD: "Kanada", AUD: "Australien",
    SEK: "Schweden", NOK: "Norwegen", DKK: "Dänemark", SGD: "Singapur",
    ZAR: "Südafrika", MXN: "Mexiko", PLN: "Polen", CZK: "Tschechien",
    KZT: "Kasachstan/Zentralasien", TRY: "Türkei", RUB: "Russland", ILS: "Israel",
    IDR: "Indonesien", THB: "Thailand", PHP: "Philippinen", VND: "Vietnam",
    NGN: "Nigeria", EGP: "Ägypten", ARS: "Argentinien", CLP: "Chile",
    COP: "Kolumbien", PEN: "Peru", UAH: "Ukraine",
  };
  const region = regionMap[reportedCurrency] || "Global";
  const isEU = ["EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK"].includes(reportedCurrency);
  const isAsia = ["CNY", "HKD", "JPY", "KRW", "TWD", "SGD", "INR", "THB", "PHP", "VND", "IDR"].includes(reportedCurrency);
  const isEM = ["CNY", "BRL", "INR", "ZAR", "MXN", "PLN", "CZK", "KZT", "TRY", "RUB", "IDR", "THB", "PHP", "VND", "NGN", "EGP", "ARS", "COP", "CLP", "PEN", "UAH"].includes(reportedCurrency);

  const isDefense = ind.includes("aerospace") || ind.includes("defense") || desc.includes("defense") || desc.includes("military");
  const isCyberSec = ind.includes("cyber") || desc.includes("cybersecurity");
  const isHealthcare = s.includes("health");
  const isPharma = ind.includes("pharma") || ind.includes("biotech");
  const isRenewable = ind.includes("renew") || ind.includes("solar") || ind.includes("wind") || desc.includes("renewable");
  const isFossil = (s.includes("energy") && !isRenewable) || ind.includes("oil") || ind.includes("gas");
  const isBank = ind.includes("bank") || ind.includes("financ");
  const isRealEstate = s.includes("real estate");
  const isConsumerStaple = s.includes("consumer") && (s.includes("stapl") || s.includes("defensive"));
  const isConsumerDisc = s.includes("consumer") && (s.includes("discret") || s.includes("cyclic") || s.includes("retail") || s.includes("leisure") || s.includes("restaurant") || s.includes("hotel") || s.includes("travel") || s.includes("auto"));
  const isSemiconductor = ind.includes("semicon") || desc.includes("semiconductor") || desc.includes("chip");
  const isUtil = s.includes("util");
  const isTech = s.includes("tech") || ind.includes("software") || desc.includes("cloud computing") || desc.includes("saas");

  function stockCorr(factorKey: string, genericImpact: "Positiv" | "Neutral" | "Negativ"): { stockCorrelation: "Positiv" | "Neutral" | "Negativ"; stockCorrelationNote: string } {
    if (isDefense) {
      const map: Record<string, ["Positiv" | "Neutral" | "Negativ", string]> = {
        trade: ["Neutral", "Rüstungsexporte unterliegen Sonderregeln, nicht klassischen Zöllen."],
        regulation: ["Neutral", "Strenge Regulierung schafft hohe Markteintrittsbarrieren → Moat-stärkend."],
        govDependency: ["Positiv", "Steigende Verteidigungsbudgets weltweit (NATO 2%+ BIP-Ziel) = direkter Umsatztreiber."],
        interest: ["Neutral", "Defense-Aufträge sind langfristig, WACC-Sensitivität moderat."],
        inflation: ["Positiv", "Verträge mit Inflationsanpassung, Cost-Plus-Modelle schützen Margen."],
        geo: ["Positiv", "Geopolitische Konflikte → höhere Verteidigungsausgaben → Kurstreiber."],
        climate: ["Neutral", "Moderate CO₂-Exponierung, kein primärer Emittent."],
        energy: ["Neutral", "Energiekosten marginal im Gesamtbild."],
        ai: ["Positiv", "AI/Autonome Systeme als Wachstumstreiber in Verteidigungstechnologie."],
        cyber: ["Positiv", "Cyber-Bedrohungen treiben Nachfrage nach Cybersecurity-Defense-Lösungen."],
        demo: ["Neutral", "Geringer Einfluss auf Defense-Nachfrage."],
        esg: ["Negativ", "ESG-Ausschlüsse reduzieren Investorenbasis (sin stocks)."],
      };
      if (map[factorKey]) return { stockCorrelation: map[factorKey][0], stockCorrelationNote: map[factorKey][1] };
    }
    if (isCyberSec) {
      if (factorKey === "cyber") return { stockCorrelation: "Positiv", stockCorrelationNote: "Steigende Cyberangriffe = direkte Nachfragesteigerung für Cybersecurity-Produkte." };
      if (factorKey === "regulation") return { stockCorrelation: "Positiv", stockCorrelationNote: "Strengere Datenschutzgesetze erzwingen Security-Investitionen → Umsatztreiber." };
    }
    if (isHealthcare || isPharma) {
      if (factorKey === "demo") return { stockCorrelation: "Positiv", stockCorrelationNote: "Alternde Bevölkerung erhöht Nachfrage nach Gesundheitsleistungen und Pharma-Produkten." };
      if (factorKey === "regulation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Preisregulierung (IRA Drug Pricing) und FDA-Anforderungen drücken auf Margen." };
      if (factorKey === "inflation") return { stockCorrelation: "Neutral", stockCorrelationNote: "Healthcare-Ausgaben relativ preisunelastisch → defensive Qualität." };
    }
    if (isBank) {
      if (factorKey === "interest") return { stockCorrelation: "Positiv", stockCorrelationNote: "Höhere Zinsen erweitern Nettozinsmarge (NIM) → direkter Gewinnhebel." };
      if (factorKey === "regulation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Basel III/IV Kapitalanforderungen begrenzen Leverage und ROE." };
    }
    if (isRealEstate) {
      if (factorKey === "interest") return { stockCorrelation: "Negativ", stockCorrelationNote: "Steigende Zinsen erhöhen Finanzierungskosten und drücken Immobilienbewertungen." };
    }
    if (isConsumerStaple) {
      if (factorKey === "inflation") return { stockCorrelation: "Neutral", stockCorrelationNote: "Pricing Power schützt Margen. Basiskonsumgüter relativ preisunelastisch." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Positiv", stockCorrelationNote: "Rezessionsresistent — Basiskonsum bleibt stabil, defensive Qualität als Vorteil." };
    }
    if (isConsumerDisc) {
      if (factorKey === "inflation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Kaufkraftverlust reduziert diskretionäre Ausgaben direkt." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Negativ", stockCorrelationNote: "Konjunkturabschwung trifft diskretionären Konsum überproportional." };
    }
    if (isTech) {
      const techMap: Record<string, ["Positiv" | "Neutral" | "Negativ", string]> = {
        interest: ["Negativ", "Steigende Zinsen komprimieren Growth-Multiples über DCF-Diskontierung."],
        ai: ["Positiv", "AI-Investitionszyklus treibt Cloud-Nachfrage und neue Revenue-Streams."],
        regulation: ["Negativ", "Kartellrecht, Digital Markets Act und Datenschutzgesetze begrenzen Wachstum."],
        trade: ["Negativ", "US-China Tech-Decoupling limitiert Absatzmärkte."],
        conjuncture: ["Neutral", "Enterprise-IT-Budgets zyklisch, aber Cloud-Migration strukturell — Mischeffekt."],
        cyber: ["Neutral", "Cybervorfälle erzeugen Reputationsrisiko, treiben aber auch Security-Umsätze."],
        inflation: ["Neutral", "Hohe Bruttomarge und Pricing Power bieten partiellen Schutz."],
      };
      if (techMap[factorKey]) return { stockCorrelation: techMap[factorKey][0], stockCorrelationNote: techMap[factorKey][1] };
    }
    if (isSemiconductor) {
      if (factorKey === "trade") return { stockCorrelation: "Negativ", stockCorrelationNote: "US Export Controls (CHIPS Act) und China-Restriktionen limitieren Absatzmärkte." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Negativ", stockCorrelationNote: "Semiconductor-Zyklus verstärkt konjunkturelle Schwankungen (Inventory-Cycle)." };
      if (factorKey === "ai") return { stockCorrelation: "Positiv", stockCorrelationNote: "AI-Rechenzentrum-Boom als säkularer Wachstumstreiber für High-End-Chips (GPU, HBM)." };
    }
    if (isFossil) {
      if (factorKey === "climate") return { stockCorrelation: "Negativ", stockCorrelationNote: "CO₂-Regulierung, CO₂-Steuer und Energiewende erhöhen strukturelle Stranded-Asset-Risiken." };
      if (factorKey === "esg") return { stockCorrelation: "Negativ", stockCorrelationNote: "ESG-Divestment-Trend reduziert Investorenbasis und erhöht Kapitalkosten." };
      if (factorKey === "trade") return { stockCorrelation: "Positiv", stockCorrelationNote: "Geopolitische Spannungen erhöhen Energie-Preispremien (Ukraine/Nahost)." };
    }
    if (isRenewable) {
      if (factorKey === "climate") return { stockCorrelation: "Positiv", stockCorrelationNote: "Klimaschutzpolitik (IRA, EU Green Deal) treibt Renewables-Kapazitätsausbau." };
      if (factorKey === "regulation") return { stockCorrelation: "Positiv", stockCorrelationNote: "Subventionen und Renewable Portfolio Standards schaffen planbare Nachfrage." };
    }
    return { stockCorrelation: genericImpact, stockCorrelationNote: "Branchenspezifische Auswirkungen variieren je nach Geschäftsmodell und Marktpositionierung." };
  }

  // === P: Political ===
  const pItems: PESTELFactorItem[] = [
    { item: govExposure > 20 ? `Hohe Regierungsabhängigkeit (${govExposure}% Government Revenue): direkte Budgetabhängigkeit von politischen Entscheidungen` : `Moderate Regulierungsexponierung in ${region}`, impact: govExposure > 20 ? "Negativ" : "Neutral", ...stockCorr("govDependency", govExposure > 20 ? "Negativ" : "Neutral") },
    { item: isEM ? `Politisches Risiko in Emerging Markets (${region}): Verstaatlichungsrisiko, Kapitalkontrollen, Sanktionsexponierung` : `Geopolitische Spannungen (US-China, Ukraine): Lieferkettendiversifizierung, Exportkontrollen`, impact: isEM ? "Negativ" : "Neutral", ...stockCorr("geo", isEM ? "Negativ" : "Neutral") },
    { item: isEU ? `EU-Regulierungsrahmen (GDPR, DSA/DMA, CSRD): Compliance-Kosten steigen, aber klarer Rechtsrahmen schafft Planungssicherheit` : `Handelspolitik und Zolländerungen (US-China Decoupling, CHIPS Act, IRA): direkte Auswirkung auf Lieferketten und Absatzmärkte`, impact: "Neutral", ...stockCorr("trade", "Neutral") },
  ];
  factors.push({ category: "Political", emoji: "🏦", items: pItems, overallImpact: govExposure > 30 ? "Negativ" : "Neutral" });

  // === E: Economic ===
  const eItems: PESTELFactorItem[] = [
    { item: `Zinspolitik der Zentralbanken (Fed, EZB): ${isBank ? "Zinserhöhungen erweitern NIM (Net Interest Margin) direkt" : isRealEstate ? "Hohe Zinsen belasten Immobilienbewertungen und Refinanzierungskosten" : "WACC-Impakt auf Discounted-Cash-Flow-Bewertung; Growth-Multiple-Kompression bei steigenden Zinsen"}`, impact: isBank ? "Positiv" : (isRealEstate || isTech) ? "Negativ" : "Neutral", ...stockCorr("interest", isBank ? "Positiv" : "Negativ") },
    { item: `Inflationsdynamik (${region === 'USA' ? 'US CPI' : region === 'Europa/EU' ? 'Euro-Inflation' : 'globale Inflation'}): ${isConsumerDisc ? "Kaufkraftverlust trifft diskretionären Konsum direkt" : isConsumerStaple ? "Pricing Power schützt Margen bei moderater Inflation" : "Input-Kostenp Pressure vs. Pricing Power als Gegenkraft"}`, impact: isConsumerDisc ? "Negativ" : "Neutral", ...stockCorr("inflation", "Neutral") },
    { item: `Konjunkturzyklus und BIP-Wachstum: ${isConsumerStaple || isUtil ? "Defensive Qualität — geringer Konjunktureinfluss" : `Beta ${beta.toFixed(1)} signalisiert ${beta > 1.3 ? "hohe" : beta > 0.8 ? "moderate" : "geringe"} Konjunktursensitivität`}`, impact: beta > 1.3 ? "Negativ" : beta < 0.7 ? "Positiv" : "Neutral", ...stockCorr("conjuncture", "Neutral") },
  ];
  factors.push({ category: "Economic", emoji: "📈", items: eItems, overallImpact: "Neutral" });

  // === S: Social ===
  const sItems: PESTELFactorItem[] = [
    { item: isHealthcare || isPharma ? `Demografischer Wandel: Alternde Bevölkerung (Baby-Boomer-Übergang) erhöht strukturell Gesundheitsausgaben; GLP-1/Adipositas-Welle als Megatrend` : `Demografischer Wandel und Konsumpräferenzen: ${isConsumerDisc ? 'Gen-Z/Millennial-Konsum (Digital-First, Nachhaltigkeit)' : 'Urbanisierung und Mittelschichtwachstum in Emerging Markets als Absatztreiber'}`, impact: isHealthcare ? "Positiv" : "Neutral", ...stockCorr("demo", isHealthcare ? "Positiv" : "Neutral") },
    { item: `ESG-Investorenpräferenzen und gesellschaftliche Erwartungen: ${isFossil ? 'ESG-Divestment-Trend reduziert Investorenbasis und erhöht Kapitalkosten strukturell' : isDefense ? 'Sin-Stocks-Stigma begrenzt ESG-Fonds-Investitionen, aber NATO-Zeitenwende verbessert ESG-Wahrnehmung' : 'Steigende ESG-Anforderungen schaffen Compliance-Kosten, aber auch Differenzierungschance'}`, impact: isFossil ? "Negativ" : isDefense ? "Neutral" : "Neutral", ...stockCorr("esg", isFossil ? "Negativ" : "Neutral") },
  ];
  factors.push({ category: "Social", emoji: "👥", items: sItems, overallImpact: isHealthcare ? "Positiv" : "Neutral" });

  // === T: Technological ===
  const tItems: PESTELFactorItem[] = [
    { item: `Künstliche Intelligenz & Automatisierung: ${isTech ? 'AI-Investitionszyklus als primärer Wachstumsmotor — Cloud-Workloads, Copilot-Monetarisierung, AI-as-a-Service' : isSemiconductor ? 'AI-Rechenzentrum-Boom treibt GPU/HBM-Nachfrage säkular' : 'AI-Integration in Produkte erhöht Wertschöpfung und Kundenbindung, aber erzeugt auch Disruptionsrisiko'}`, impact: isTech || isSemiconductor ? "Positiv" : "Neutral", ...stockCorr("ai", isTech ? "Positiv" : "Neutral") },
    { item: `Cybersecurity-Risiken: ${isCyberSec ? 'Steigende Cyberangriffe sind direkter Umsatzkatalysator (Nachfragetreiber)' : 'Zunehmende Cyberangriffe erhöhen IT-Sicherheitsausgaben; Supply-Chain-Angriffe als systemisches Risiko'}`, impact: isCyberSec ? "Positiv" : "Neutral", ...stockCorr("cyber", "Neutral") },
  ];
  factors.push({ category: "Technological", emoji: "🤖", items: tItems, overallImpact: isTech || isSemiconductor ? "Positiv" : "Neutral" });

  // === E: Environmental ===
  const envItems: PESTELFactorItem[] = [
    { item: `Klimapolitik und CO₂-Regulierung (${isEU ? 'EU ETS, CBAM, CSRD' : 'US IRA, EPA-Regularien, SEC Climate Disclosure'}): ${isFossil ? 'Stranded-Asset-Risiko und CO₂-Preise erhöhen strukturell operative Kosten' : isRenewable ? 'CO₂-Preise und Renewable-Förderprogramme (IRA, EU Green Deal) als Umsatzkatalysator' : 'Scope 1-3-Emissionsreporting verpflichtend; Carbon-Cost-of-Capital als Bewertungsfaktor'}`, impact: isFossil ? "Negativ" : isRenewable ? "Positiv" : "Neutral", ...stockCorr("climate", isFossil ? "Negativ" : isRenewable ? "Positiv" : "Neutral") },
    { item: `Energiekosten und Versorgungssicherheit: ${isUtil || isFossil ? 'Kerngeschäft direkt mit Energiepreisen korreliert' : 'Energie als Betriebskostenfaktor; Rechenzentren (AI-Workloads) treiben Stromverbrauch → Power Purchase Agreements als Hedge'}`, impact: isFossil ? "Positiv" : "Neutral", ...stockCorr("energy", "Neutral") },
  ];
  factors.push({ category: "Environmental", emoji: "🌱", items: envItems, overallImpact: isFossil ? "Negativ" : isRenewable ? "Positiv" : "Neutral" });

  // === L: Legal ===
  const lItems: PESTELFactorItem[] = [
    { item: `Regulatorische Anforderungen und Compliance: ${isTech ? 'Kartellverfahren (Google, Meta, Apple), Digital Markets Act, KI-Regulierung (EU AI Act) als strukturelle Risiken' : isPharma ? 'FDA-Zulassungsprozesse, Patentschutz und Paragraph-IV-Herausforderungen als binäre Risiken' : isBank ? 'Basel III/IV, Dodd-Frank, MiFID II: Kapitalanforderungen begrenzen Leverage und ROE' : `Branchenspezifische Regulierung in ${region} als Eintrittsbarriere und Compliance-Kostenfaktor`}`, impact: isTech || isPharma ? "Negativ" : "Neutral", ...stockCorr("regulation", "Neutral") },
    { item: `Geistiges Eigentum und IP-Schutz: ${isPharma ? 'Patentlaufzeiten (exklusiver Marktschutz) und Biosimilar-Bedrohungen als binärer Katalysator' : isTech ? 'Software-Patente, Urheberrecht an KI-Trainingsdaten und Open-Source-Compliance-Risiken' : 'Standard-IP-Schutz und Markenschutz als Wettbewerbsmoat'}`, impact: isPharma ? "Negativ" : "Neutral", ...stockCorr("ip", "Neutral") },
  ];
  factors.push({ category: "Legal", emoji: "⚖️", items: lItems, overallImpact: isTech || isPharma ? "Negativ" : "Neutral" });

  const positiveCount = factors.filter(f => f.overallImpact === "Positiv").length;
  const negativeCount = factors.filter(f => f.overallImpact === "Negativ").length;
  const overallSentiment: "Positiv" | "Neutral" | "Negativ" = positiveCount > negativeCount ? "Positiv" : negativeCount > positiveCount ? "Negativ" : "Neutral";

  return { factors, overallSentiment, region, analysisDate: new Date().toISOString().split('T')[0] };
}
