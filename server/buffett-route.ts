/**
 * Buffett-Quote für das Rezessions-Dashboard.
 * US: Financial Accounts plus VGR-Gewinne. Europa und China: die Weltbank-Quote,
 * solange keine Gewinnreihe mit demselben Rand vorliegt.
 */
import type { Express, Request, Response } from "express";
import {
  buildBuffettSeries,
  type BuffettObservation,
  type BuffettPoint,
} from "./buffett-ratio";

const REGIONS = ["US", "EU", "CN"] as const;
type RegionId = (typeof REGIONS)[number];

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

const US_SOURCES = [
  { id: "NCBEILQ027S", role: "Marktwert, nichtfinanzielle Kapitalgesellschaften, Mio. $" },
  { id: "FBCELLQ027S", role: "Marktwert, finanzielle Kapitalgesellschaften, Mio. $" },
  { id: "GDP", role: "nominales BIP, Mrd. $, Jahresrate" },
  { id: "CPATAX", role: "Unternehmensgewinn nach Steuern, Mrd. $" },
  { id: "A445RC1Q027SBEA", role: "Unternehmensgewinn Inland, Mrd. $" },
  { id: "B394RC1Q027SBEA", role: "Unternehmensgewinn Ausland, Mrd. $" },
  { id: "DIVIDEND", role: "Nettodividenden, Mrd. $" },
  { id: "DGS10", role: "zehnjährige US-Rendite" },
];

interface FredPoint {
  date: string;
  value: number;
}

function isRegion(value: string): value is RegionId {
  return (REGIONS as readonly string[]).includes(value);
}

async function fetchFred(seriesId: string, from: string): Promise<FredPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${from}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) return [];
  const text = await response.text();
  if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return [];
  const out: FredPoint[] = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null) continue;
    const value = Number(raw.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !Number.isFinite(value)) continue;
    out.push({ date: date.trim(), value });
  }
  return out;
}

function asMap(points: FredPoint[]): Map<string, number> {
  return new Map(points.map(point => [point.date, point.value]));
}

function quarterStart(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(quarterMonth).padStart(2, "0")}-01`;
}

function quarterYield(daily: FredPoint[]): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const point of daily) {
    const key = quarterStart(point.date);
    const list = buckets.get(key) ?? [];
    list.push(point.value);
    buckets.set(key, list);
  }
  const out = new Map<string, number>();
  for (const [key, values] of buckets) {
    out.set(key, values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return out;
}

async function buildUnitedStates(): Promise<{ points: BuffettPoint[]; note: string }> {
  const [nfc, financial, gdp, profits, domestic, foreign, dividends, yields] = await Promise.all([
    fetchFred("NCBEILQ027S", "1952-01-01"),
    fetchFred("FBCELLQ027S", "1952-01-01"),
    fetchFred("GDP", "1952-01-01"),
    fetchFred("CPATAX", "1947-01-01"),
    fetchFred("A445RC1Q027SBEA", "1947-01-01"),
    fetchFred("B394RC1Q027SBEA", "1947-01-01"),
    fetchFred("DIVIDEND", "1947-01-01"),
    fetchFred("DGS10", "1962-01-01"),
  ]);
  const nfcMap = asMap(nfc);
  const financialMap = asMap(financial);
  const gdpMap = asMap(gdp);
  const profitMap = asMap(profits);
  const domesticMap = asMap(domestic);
  const foreignMap = asMap(foreign);
  const dividendMap = asMap(dividends);
  const yieldMap = quarterYield(yields);
  const dates = [...nfcMap.keys()].filter(date => financialMap.has(date) && gdpMap.has(date)).sort();
  const observations: BuffettObservation[] = dates.map(date => ({
    date,
    marketCapBn: ((nfcMap.get(date) ?? 0) + (financialMap.get(date) ?? 0)) / 1000,
    gdpBn: gdpMap.get(date) ?? 0,
    afterTaxProfitBn: profitMap.get(date) ?? null,
    domesticProfitBn: domesticMap.get(date) ?? null,
    foreignProfitBn: foreignMap.get(date) ?? null,
    dividendBn: dividendMap.get(date) ?? null,
    yieldPct: yieldMap.get(date) ?? null,
  }));
  return {
    points: buildBuffettSeries(observations),
    note: "Der Zähler ist der Marktwert aller Unternehmensanteile aus den Financial Accounts, börsennotiert und nicht börsennotiert. Der Auslandsanteil ist der VGR-Gewinn aus dem Ausland geteilt durch Inland- plus Auslandsgewinn, jeweils über zehn Jahre. Das ist nicht die Umsatzquote des S&P.",
  };
}

async function buildAnnualRatio(seriesId: string): Promise<BuffettPoint[]> {
  const points = await fetchFred(seriesId, "1975-01-01");
  return points.map(point => ({
    date: point.date,
    rawPct: Math.round(point.value * 10) / 10,
    geoPct: null,
    justifiedPct: null,
    foreignShare: null,
    multiple: null,
    qStar: null,
    gapPct: null,
    yieldPct: null,
    profitCagrPct: null,
    payout: null,
    gordonMultiple: null,
    gordonPct: null,
  }));
}

const ANNUAL_REGIONS: Record<Exclude<RegionId, "US">, { id: string; note: string }> = {
  EU: {
    id: "DDDM01EZA156NWDB",
    note: "Euroraum, börsennotierte Inlandsfirmen in Prozent des BIP (Weltbank über FRED). Die Reihe endet mit dem letzten veröffentlichten Jahr. Gewinn, Auslandsanteil und Zinsmodell bleiben leer, bis eine Gewinnreihe denselben Rand hat.",
  },
  CN: {
    id: "DDDM01CNA156NWDB",
    note: "China, börsennotierte Inlandsfirmen in Prozent des BIP (Weltbank über FRED). Die Reihe endet mit dem letzten veröffentlichten Jahr. Gewinn, Auslandsanteil und Zinsmodell bleiben leer, bis eine Gewinnreihe denselben Rand hat.",
  },
};

function latestDefined(points: BuffettPoint[]): BuffettPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].rawPct != null) return points[i];
  }
  return null;
}

export function registerBuffettRatioRoute(app: Express): void {
  app.get("/api/analyze-recession/buffett", async (req: Request, res: Response) => {
    const region = String(req.query.region || "US").toUpperCase();
    if (!isRegion(region)) {
      return res.status(400).json({ error: "Region muss US, EU oder CN sein" });
    }
    const hit = cache.get(region);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    try {
      const annual = region === "US" ? null : ANNUAL_REGIONS[region];
      const built = region === "US"
        ? await buildUnitedStates()
        : {
            points: await buildAnnualRatio(annual!.id),
            note: annual!.note,
          };
      const latest = latestDefined(built.points);
      const body = {
        region,
        asOf: latest?.date ?? null,
        latest,
        note: built.note,
        sources: region === "US" ? US_SOURCES : [{ id: annual!.id, role: "Börsenkapitalisierung in Prozent des BIP" }],
        points: built.points,
      };
      if (built.points.length > 0) cache.set(region, { at: Date.now(), body });
      res.json(body);
    } catch (err: any) {
      console.error("[GET /api/analyze-recession/buffett]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "Buffett-Quote nicht verfügbar" });
    }
  });
}
