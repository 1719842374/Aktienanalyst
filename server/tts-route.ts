/**
 * POST /api/tts/episode  — startet bzw. liest die Server-Sprachausgabe einer Player-Episode.
 * GET  /api/tts/audio/:scope/:id/:file — liefert die fertige Datei (Range über res.sendFile).
 * Kette: PodcastPlayer → usePodcastAudio → diese Route → TTS-Provider (Default Piper) → .cache/tts.
 * Cache-Schlüssel je Kapitel: Episode-ID (Ticker bzw. Researcher) + sha256(Stimme + Satztext).
 * Ohne Server-Stimme antwortet die Route mit status "n/a" und Grund; der Player nutzt dann Web Speech.
 * Ein Auftrag zur Zeit, damit Piper den RAM nicht mehrfach belegt.
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import type { TtsChapterAudio, TtsEpisodeRequest, TtsEpisodeStatus } from "../shared/podcast-player";
import { createPiperProvider } from "./tts/piper-provider";
import { resolveTtsProvider, type TtsProvider, type TtsResolution } from "./tts/provider";

export const TTS_ROUTE_PARAMS = {
  cacheDir: path.join(process.cwd(), ".cache", "tts"),
  maxChapters: 40,
  maxSentencesPerChapter: 600,
  maxSentenceChars: 1200,
  /** Obergrenze je Episode, rund 25 Minuten Sprache. */
  maxEpisodeChars: 60_000,
  /** Plattenplatz des Audio-Caches; älteste Dateien fallen zuerst. WAV bei 22,05 kHz ≈ 2,6 MB je Minute. */
  maxCacheBytes: 2 * 1024 * 1024 * 1024,
  hashChars: 16,
  /** So lange bleibt ein fehlgeschlagener Auftrag n/a, bevor ein neuer Versuch startet. */
  failureRetryMs: 10 * 60 * 1000,
} as const;

const ID = /^[A-Za-z0-9.\-_]{1,40}$/;
const CHAPTER = /^[a-z0-9\-]{1,40}$/;
const FILE = /^([a-z0-9\-]{1,40})__([a-f0-9]{8,64})\.([a-z0-9]{2,5})$/;

const requestSchema = z.object({
  scope: z.enum(["stock", "researcher"]),
  id: z.string().regex(ID),
  chapters: z.array(z.object({
    id: z.string().regex(CHAPTER),
    sentences: z.array(z.string().min(1).max(TTS_ROUTE_PARAMS.maxSentenceChars)).min(1).max(TTS_ROUTE_PARAMS.maxSentencesPerChapter),
  })).min(1).max(TTS_ROUTE_PARAMS.maxChapters),
}).strict();

export interface TtsService {
  episode(raw: unknown): Promise<{ http: number; body: TtsEpisodeStatus | { error: string } }>;
  filePath(scope: string, id: string, file: string): { path: string; mime: string } | null;
  /** Welche Stimme spricht, ohne einen Auftrag anzulegen (Audio-Status des Researcher-Podcasts). */
  providerStatus(): Promise<{ provider: string; providerLabel: string; server: boolean; reason: string | null }>;
  /** Wartet, bis die Warteschlange leer ist (Tests). */
  idle(): Promise<void>;
}

interface Task { key: string; abs: string; sentences: string[] }

export function chapterHash(voiceKey: string, sentences: string[]): string {
  return crypto.createHash("sha256").update(`${voiceKey}\n${sentences.join("\n")}`).digest("hex").slice(0, TTS_ROUTE_PARAMS.hashChars);
}

function pruneCache(dir: string, maxBytes: number): void {
  const files: Array<{ p: string; size: number; mtime: number }> = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const st = fs.statSync(p); files.push({ p, size: st.size, mtime: st.mtimeMs }); }
    }
  };
  walk(dir);
  let total = files.reduce((s, f) => s + f.size, 0);
  for (const f of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes) break;
    fs.rmSync(f.p, { force: true });
    total -= f.size;
  }
}

export function createTtsService(opts: { resolve?: () => TtsResolution; cacheDir?: string; maxCacheBytes?: number; now?: () => number } = {}): TtsService {
  const cacheDir = opts.cacheDir ?? TTS_ROUTE_PARAMS.cacheDir;
  const maxCacheBytes = opts.maxCacheBytes ?? TTS_ROUTE_PARAMS.maxCacheBytes;
  const now = opts.now ?? (() => Date.now());
  const resolution = opts.resolve ?? (() => resolveTtsProvider({ piper: () => createPiperProvider() }));
  const queue: Task[] = [];
  const queued = new Set<string>();
  const failures = new Map<string, { at: number; reason: string }>();
  let running: Promise<void> | null = null;
  let provider: TtsProvider | null = null;

  const runQueue = async (p: TtsProvider) => {
    while (queue.length) {
      const t = queue.shift()!;
      try {
        fs.mkdirSync(path.dirname(t.abs), { recursive: true });
        const out = await p.synthesize(t.sentences, t.abs);
        fs.writeFileSync(`${t.abs}.json`, JSON.stringify(out));
        pruneCache(cacheDir, maxCacheBytes);
      } catch (err) {
        const reason = String((err as Error)?.message ?? err).slice(0, 160);
        console.warn(`[TTS] ${p.id} fehlgeschlagen: ${reason}`);
        failures.set(t.key, { at: now(), reason: `${p.label} fehlgeschlagen: ${reason}` });
      } finally {
        queued.delete(t.key);
      }
    }
  };

  const kick = (p: TtsProvider) => {
    if (running) return;
    running = runQueue(p).finally(() => { running = null; });
  };

  return {
    async episode(raw) {
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return { http: 400, body: { error: `Ungültige Anfrage: ${parsed.error.issues[0]?.path.join(".") ?? ""}` } };
      const req = parsed.data as TtsEpisodeRequest;
      const chars = req.chapters.reduce((s, c) => s + c.sentences.reduce((a, x) => a + x.length, 0), 0);
      if (chars > TTS_ROUTE_PARAMS.maxEpisodeChars) return { http: 400, body: { error: "Ungültige Anfrage: Episode zu lang" } };
      const total = req.chapters.length;
      const res = resolution();
      if (res.kind === "browser") {
        return { http: 200, body: { status: "n/a", provider: res.id, providerLabel: res.label, reason: res.reason, doneChapters: 0, totalChapters: total, chapters: [] } };
      }
      const p = res.provider;
      provider = p;
      const avail = await p.availability();
      if (!avail.ok) {
        return { http: 200, body: { status: "n/a", provider: p.id, providerLabel: p.label, reason: avail.reason, doneChapters: 0, totalChapters: total, chapters: [] } };
      }
      const ready: TtsChapterAudio[] = [];
      let failed: string | null = null;
      for (const c of req.chapters) {
        const hash = chapterHash(p.voiceKey, c.sentences);
        const file = `${c.id}__${hash}.${p.fileExt}`;
        const abs = path.join(cacheDir, req.scope, req.id, file);
        const key = `${req.scope}/${req.id}/${file}`;
        if (fs.existsSync(abs) && fs.existsSync(`${abs}.json`)) {
          const meta = JSON.parse(fs.readFileSync(`${abs}.json`, "utf8")) as { durationMs: number; sentenceStartsMs: number[] };
          fs.utimesSync(abs, new Date(now()), new Date(now()));
          ready.push({ chapterId: c.id, url: `/api/tts/audio/${req.scope}/${encodeURIComponent(req.id)}/${file}`, mime: p.mime, durationMs: meta.durationMs, sentenceStartsMs: meta.sentenceStartsMs });
          continue;
        }
        const fail = failures.get(key);
        if (fail && now() - fail.at < TTS_ROUTE_PARAMS.failureRetryMs) { failed = fail.reason; continue; }
        if (!queued.has(key)) {
          queued.add(key);
          queue.push({ key, abs, sentences: c.sentences });
        }
      }
      if (failed) {
        return { http: 200, body: { status: "n/a", provider: p.id, providerLabel: p.label, reason: failed, doneChapters: ready.length, totalChapters: total, chapters: ready } };
      }
      if (ready.length === total) {
        return { http: 200, body: { status: "ready", provider: p.id, providerLabel: p.label, reason: null, doneChapters: total, totalChapters: total, chapters: ready } };
      }
      kick(p);
      return { http: 200, body: { status: "pending", provider: p.id, providerLabel: p.label, reason: null, doneChapters: ready.length, totalChapters: total, chapters: ready } };
    },
    filePath(scope, id, file) {
      if ((scope !== "stock" && scope !== "researcher") || !ID.test(id) || !FILE.test(file)) return null;
      const abs = path.join(cacheDir, scope, id, file);
      if (!fs.existsSync(abs) || !fs.existsSync(`${abs}.json`)) return null;
      const ext = FILE.exec(file)?.[3];
      const mime = provider && provider.fileExt === ext ? provider.mime : ext === "wav" ? "audio/wav" : "application/octet-stream";
      return { path: abs, mime };
    },
    async providerStatus() {
      const res = resolution();
      if (res.kind === "browser") return { provider: res.id, providerLabel: res.label, server: false, reason: res.reason };
      const avail = await res.provider.availability();
      return avail.ok
        ? { provider: res.provider.id, providerLabel: res.provider.label, server: true, reason: null }
        : { provider: res.provider.id, providerLabel: res.provider.label, server: false, reason: avail.reason };
    },
    async idle() {
      while (running) await running;
    },
  };
}

let shared: TtsService | null = null;

/** Eine Instanz für Route und Researcher-Adapter, damit Warteschlange und Fehlerliste gemeinsam sind. */
export function sharedTtsService(): TtsService {
  return (shared ??= createTtsService());
}

export function registerTtsRoute(app: Express, service?: TtsService): void {
  const svc = service ?? sharedTtsService();
  app.post("/api/tts/episode", async (req: Request, res: Response) => {
    try {
      const out = await svc.episode(req.body);
      res.status(out.http).json(out.body);
    } catch (err) {
      console.warn(`[TTS] Episode fehlgeschlagen: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      res.status(500).json({ error: "Sprachausgabe nicht verfügbar" });
    }
  });
  app.get("/api/tts/audio/:scope/:id/:file", (req: Request, res: Response) => {
    const hit = svc.filePath(String(req.params.scope), String(req.params.id), String(req.params.file));
    if (!hit) {
      res.status(404).json({ error: "Audio nicht gefunden" });
      return;
    }
    res.sendFile(hit.path, { headers: { "Content-Type": hit.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
  });
}
