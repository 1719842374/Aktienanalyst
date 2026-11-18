/**
 * GET/POST /api/podcast-transcript/:symbol
 * Liegt im bestehenden Researcher-Disk-Cache. Kein Supabase, kein neuer Store.
 * Kein Audio. Fehlt der Eintrag: n/a.
 */
import type { Express, Request, Response } from "express";
import { diskResearcherGetWithTtl, diskResearcherSet } from "./disk-cache";
import {
  PODCAST_CACHE_TTL_MS,
  acceptTranscriptText,
  emptyTranscript,
  podcastCacheKey,
  type PodcastTranscript,
} from "../shared/podcast-transcript";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

type CacheDeps = {
  read: (key: string) => { data: unknown; storedAt: number } | null;
  write: (key: string, data: unknown) => void;
};

function defaultDeps(): CacheDeps {
  return {
    read: (key) => diskResearcherGetWithTtl(key, PODCAST_CACHE_TTL_MS),
    write: (key, data) => diskResearcherSet(key, data),
  };
}

export function readPodcastTranscript(symbol: string, deps: CacheDeps = defaultDeps()): PodcastTranscript {
  const hit = deps.read(podcastCacheKey(symbol));
  if (!hit) return emptyTranscript(symbol, "n/a — kein Transkript im lokalen Cache");
  const data = hit.data as { text?: unknown; storedAt?: unknown } | null;
  const accepted = acceptTranscriptText(data?.text);
  if (!accepted.text) return emptyTranscript(symbol, accepted.reason ?? "n/a — Cache-Eintrag ohne Text");
  const storedAt = typeof data?.storedAt === "string" ? data.storedAt : new Date(hit.storedAt).toISOString();
  return { symbol, text: accepted.text, storedAt, reason: null };
}

export function writePodcastTranscript(symbol: string, text: unknown, deps: CacheDeps = defaultDeps()): PodcastTranscript {
  const accepted = acceptTranscriptText(text);
  if (!accepted.text) return emptyTranscript(symbol, accepted.reason ?? "n/a — leeres Transkript");
  const storedAt = new Date().toISOString();
  deps.write(podcastCacheKey(symbol), { text: accepted.text, storedAt });
  const readBack = deps.read(podcastCacheKey(symbol));
  if (!readBack) return emptyTranscript(symbol, "n/a — lokaler Cache nicht erreichbar");
  return { symbol, text: accepted.text, storedAt, reason: null };
}

export function registerPodcastTranscriptRoute(app: Express): void {
  app.get("/api/podcast-transcript/:symbol", (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(symbol)) return res.status(400).json({ error: "Ungültiger Ticker" });
    res.json(readPodcastTranscript(symbol));
  });
  app.post("/api/podcast-transcript/:symbol", (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(symbol)) return res.status(400).json({ error: "Ungültiger Ticker" });
    res.json(writePodcastTranscript(symbol, req.body?.text));
  });
}
