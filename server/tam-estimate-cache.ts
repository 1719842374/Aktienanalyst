/**
 * Schätz-Cache auf der Platte, damit ein Prozess-Neustart dieselbe Zahl liefert.
 * Liegt unter .cache/ (gitignore). Ein neues Deploy mit leerem Dateisystem leert ihn.
 */
import fs from "fs";
import path from "path";
import type { TamNaFill, TamNaReason } from "../shared/tam-na-fill";

export interface TamEstimateCacheBody {
  fills: TamNaFill[];
  naReasons: TamNaReason[];
  coveragePct: number | null;
  coverageNote: string;
  modelUsed: string;
}

const FILE = path.resolve(process.cwd(), ".cache", "tam-estimate-cache.json");

function isBody(value: unknown): value is TamEstimateCacheBody {
  if (!value || typeof value !== "object") return false;
  const row = value as TamEstimateCacheBody;
  return Array.isArray(row.fills)
    && Array.isArray(row.naReasons)
    && (row.coveragePct === null || typeof row.coveragePct === "number")
    && typeof row.coverageNote === "string"
    && typeof row.modelUsed === "string";
}

function readAll(): Record<string, TamEstimateCacheBody> {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, TamEstimateCacheBody> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isBody(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, TamEstimateCacheBody>): boolean {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
    return true;
  } catch {
    return false;
  }
}

export function readTamEstimateCache(key: string): TamEstimateCacheBody | null {
  return readAll()[key] ?? null;
}

export function writeTamEstimateCache(key: string, body: TamEstimateCacheBody): boolean {
  const all = readAll();
  all[key] = body;
  return writeAll(all);
}

export function clearTamEstimateCache(): void {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    // Ein gesperrtes Verzeichnis lässt den Speicher-Cache in Ruhe.
  }
}
