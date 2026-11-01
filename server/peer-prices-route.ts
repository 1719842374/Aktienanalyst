/**
 * GET /api/peer-prices?symbols=A,B — Kurse für das Peer-Overlay in Sektion 12.
 * Höchstens PEER_OVERLAY_MAX Symbole. Nur Anzeige.
 */
import type { Express, Request, Response } from "express";
import { fmpHistoricalPrices } from "./fmp";
import { PEER_OVERLAY_MAX, limitPeerTickers, type PeerPricePoint } from "../shared/peer-price-overlay";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

function pointsOf(raw: unknown): PeerPricePoint[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PeerPricePoint[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date.slice(0, 10) : "";
    const close = typeof r.close === "number" ? r.close : typeof r.adjClose === "number" ? r.adjClose : null;
    if (!date || close == null || !Number.isFinite(close)) continue;
    out.push({ date, close });
  }
  return out;
}

export async function loadPeerPrices(symbols: readonly string[], deps: {
  prices: (t: string) => Promise<unknown>;
} = { prices: (t) => fmpHistoricalPrices(t) }) {
  const { kept, dropped } = limitPeerTickers(symbols.filter(s => TICKER_RE.test(s.trim().toUpperCase())));
  const series = await Promise.all(kept.map(async ticker => {
    try {
      const points = pointsOf(await deps.prices(ticker));
      return { ticker, points, note: points.length ? null : "n/a — keine Kurse" };
    } catch (err: any) {
      return { ticker, points: [] as PeerPricePoint[], note: `n/a — Kurse nicht erreichbar${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}` };
    }
  }));
  return {
    series,
    dropped,
    note: dropped.length ? `n/a — mehr als ${PEER_OVERLAY_MAX} Peers, Rest nicht geladen: ${dropped.join(", ")}` : null,
  };
}

export function registerPeerPricesRoute(app: Express): void {
  app.get("/api/peer-prices", async (req: Request, res: Response) => {
    const raw = String(req.query.symbols ?? "");
    const symbols = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (!symbols.length) return res.status(400).json({ error: "symbols fehlt" });
    res.json(await loadPeerPrices(symbols));
  });
}
