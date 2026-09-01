/**
 * WORK2.md TEIL 8 — PESTEL-Risks aus bereits gescorten Exposures.
 * Kein LLM, keine Programmnamen. regulatory.ts bleibt unangetastet.
 */
import fs from "node:fs";
import path from "node:path";

export type PestelBucket = "political" | "legal";

export interface ScoredExposureLite {
  country: string;
  regulationAxis: string;
  title: string;
  description: string;
  estimatedImpactOnSales: number | null;
  probability: number;
  confidence: string;
  epsImpact: number | null;
  material: boolean;
  badgeOnly: boolean;
  source?: { url: string };
}

export interface PestelRisks {
  political: string[];
  legal: string[];
  badgeOnly: string[];
}

const POLITICAL_AXES = new Set([
  "price_regulation",
  "subsidy_incentive",
  "trade_tariff",
  "procurement_public",
]);

const LEGAL_AXES = new Set([
  "competition_antitrust",
  "environmental_climate",
  "data_privacy_tech",
  "labor_social",
  "other",
]);

export function bucketForAxis(axis: string): PestelBucket {
  if (POLITICAL_AXES.has(axis)) return "political";
  if (LEGAL_AXES.has(axis)) return "legal";
  return "legal";
}

function formatRisk(e: ScoredExposureLite): string {
  const impact =
    e.estimatedImpactOnSales == null
      ? "n/a"
      : `${(e.estimatedImpactOnSales * 100).toFixed(1)} % Umsatz`;
  const p = `${(e.probability * 100).toFixed(0)} %`;
  const eps =
    e.epsImpact == null
      ? ""
      : `, EPS ${e.epsImpact >= 0 ? "+" : ""}${e.epsImpact.toFixed(2)} $`;
  return `${e.title} (${e.country}): ${impact}, p=${p}${eps}`;
}

/** Material → P/L-Bullets. badgeOnly / nicht-material → nur Badge. Kein extra LLM. */
export function derivePestelRisks(exposures: ScoredExposureLite[]): PestelRisks {
  const political: string[] = [];
  const legal: string[] = [];
  const badgeOnly: string[] = [];
  for (const e of exposures) {
    if (!e?.title) continue;
    if (e.badgeOnly || !e.material) {
      badgeOnly.push(formatRisk(e));
      continue;
    }
    const line = formatRisk(e);
    if (bucketForAxis(e.regulationAxis) === "political") political.push(line);
    else legal.push(line);
  }
  return { political, legal, badgeOnly };
}

export function enrichAssessment<T extends { ticker?: string; exposures?: ScoredExposureLite[] }>(
  body: T
): T & { pestelRisks: PestelRisks } {
  const exposures = Array.isArray(body.exposures) ? body.exposures : [];
  return { ...body, pestelRisks: derivePestelRisks(exposures) };
}

function cacheDir(): string {
  return path.join(process.cwd(), ".cache", "regulatory");
}

export function persistAssessment(assessment: { ticker?: string } & Record<string, unknown>): void {
  const ticker = String(assessment.ticker ?? "").toUpperCase();
  if (!ticker) return;
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir(), `${ticker}.json`),
      JSON.stringify({ ...assessment, persistedAt: new Date().toISOString() }),
      "utf8"
    );
  } catch (err) {
    console.warn("[REGULATORY] persist failed:", (err as Error).message);
  }
}

export function readPersistedAssessment(ticker: string): Record<string, unknown> | null {
  const key = ticker.toUpperCase();
  try {
    const raw = fs.readFileSync(path.join(cacheDir(), `${key}.json`), "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const at = Date.parse(String(data.persistedAt ?? data.generatedAt ?? ""));
    if (Number.isFinite(at) && Date.now() - at > 24 * 60 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}
