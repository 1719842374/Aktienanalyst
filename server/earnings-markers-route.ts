/**
 * GET /api/earnings-markers/:ticker — Beat/Miss für das Kurs-Chart.
 * Quelle: /stable/earnings-surprises, sonst die schon genutzte /earnings-Zeile.
 * Nur Anzeige.
 */
import type { Express, Request, Response } from "express";
import { fmpEarningsCalendar, fmpEarningsSurprises } from "./fmp";
import { buildEarningsMarkers, type EarningsRaw } from "../shared/earnings-markers";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function rowsFromFmp(raw: unknown): EarningsRaw[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: EarningsRaw[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date.slice(0, 10) : "";
    if (!date) continue;
    out.push({
      date,
      revenueActual: num(r.revenueActual ?? r.actualRevenue ?? r.revenue),
      revenueEstimate: num(r.revenueEstimated ?? r.estimatedRevenue),
      epsActual: num(r.epsActual ?? r.actualEarningResult ?? r.eps),
      epsEstimate: num(r.epsEstimated ?? r.estimatedEarning),
    });
  }
  return out;
}

export async function loadEarningsMarkers(ticker: string, deps: {
  surprises: (t: string) => Promise<unknown>;
  earnings: (t: string) => Promise<unknown>;
} = { surprises: fmpEarningsSurprises, earnings: fmpEarningsCalendar }) {
  let source: "earnings-surprises" | "earnings" | "none" = "none";
  let note: string | null = null;
  let rows: EarningsRaw[] = [];
  try {
    rows = rowsFromFmp(await deps.surprises(ticker));
    source = rows.length ? "earnings-surprises" : "none";
    if (!rows.length) note = "earnings-surprises ohne Zeilen";
  } catch (err: any) {
    note = `earnings-surprises nicht erreichbar${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}`;
  }
  if (!rows.length) {
    try {
      const fallback = rowsFromFmp(await deps.earnings(ticker));
      if (fallback.length) {
        rows = fallback;
        source = "earnings";
        note = note ? `${note}, Fallback /earnings` : "Fallback /earnings";
      } else note = note ? `${note}, /earnings ohne Zeilen` : "n/a — keine Earnings-Zeilen";
    } catch (err: any) {
      note = `${note ?? "earnings-surprises leer"}, /earnings fehlgeschlagen${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}`;
    }
  }
  const built = buildEarningsMarkers(rows);
  return { ticker, source, note, ...built };
}

export function registerEarningsMarkersRoute(app: Express): void {
  app.get("/api/earnings-markers/:ticker", async (req: Request, res: Response) => {
    const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "Ungültiger Ticker" });
    res.json(await loadEarningsMarkers(ticker));
  });
}
