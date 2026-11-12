/**
 * Piper (rhasspy/piper, MIT) mit der Stimme de_DE-thorsten-high (Datensatz CC0).
 * Läuft als eigener Prozess je Kapitel, schreibt je Satz eine WAV (--json-input) und setzt sie
 * mit fester Pause zu einer Datei zusammen. So sind die Satzstarts für das Sync-Highlight exakt.
 * Binärdatei und Modell installiert script/install-piper.sh nach vendor/piper (Docker-Build).
 * Fehlt etwas oder reicht der RAM nicht, meldet availability() den Grund; der Player spricht dann im Browser.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { spokenForm } from "../../shared/podcast-player";
import type { TtsProvider, TtsSynthesis } from "./provider";

export const PIPER_PARAMS = {
  dir: path.join(process.cwd(), "vendor", "piper"),
  binary: path.join("piper", "piper"),
  voice: "de_DE-thorsten-high",
  /** Spitzen-RSS von Piper mit thorsten-high, gemessen 353 MB (4 vCPU, 125 s Audio), plus Reserve. */
  peakRssBytes: 400 * 1024 * 1024,
  /** Pause zwischen zwei Sätzen in der fertigen Datei. */
  sentencePauseMs: 350,
  /** Piper hängt keine eigene Stille an; die Pause setzt concatWavs, damit die Satzstarts stimmen. */
  piperSentenceSilenceSeconds: 0,
  /** Abbruch, falls Piper hängt. Bei RTF 0,13 braucht ein Kapitel von 8 Minuten rund 1 Minute. */
  jobTimeoutMs: 15 * 60 * 1000,
} as const;

/** Liest den RIFF-Container und liefert Format und PCM-Daten. */
export function parseWav(buf: Buffer): { sampleRate: number; channels: number; bitsPerSample: number; pcm: Buffer } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("keine WAV-Datei");
  let off = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bitsPerSample: buf.readUInt16LE(body + 14) };
    if (id === "data") {
      if (!fmt) throw new Error("WAV ohne fmt-Block");
      return { ...fmt, pcm: buf.subarray(body, Math.min(buf.length, body + size)) };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV ohne data-Block");
}

export function wavHeader(dataBytes: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const h = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Sätze → eine WAV mit fester Pause dazwischen. Liefert Dauer und Satzstarts. */
export function concatWavs(parts: Buffer[], pauseMs: number): { wav: Buffer } & TtsSynthesis {
  if (!parts.length) throw new Error("keine Sätze");
  const parsed = parts.map(parseWav);
  const { sampleRate, channels, bitsPerSample } = parsed[0];
  const bytesPerMs = (sampleRate * channels * bitsPerSample) / 8 / 1000;
  const blockAlign = (channels * bitsPerSample) / 8;
  const pauseBytes = Math.round((pauseMs * bytesPerMs) / blockAlign) * blockAlign;
  const silence = Buffer.alloc(pauseBytes);
  const chunks: Buffer[] = [];
  const sentenceStartsMs: number[] = [];
  let bytes = 0;
  parsed.forEach((p, i) => {
    if (p.sampleRate !== sampleRate || p.channels !== channels || p.bitsPerSample !== bitsPerSample) throw new Error("uneinheitliches WAV-Format");
    if (i > 0) { chunks.push(silence); bytes += silence.length; }
    sentenceStartsMs.push(Math.round(bytes / bytesPerMs));
    chunks.push(p.pcm);
    bytes += p.pcm.length;
  });
  return { wav: Buffer.concat([wavHeader(bytes, sampleRate, channels, bitsPerSample), ...chunks]), durationMs: Math.round(bytes / bytesPerMs), sentenceStartsMs };
}

/** cgroup-Grenze (Container) vor os.totalmem(); auf Render greift die cgroup. */
export function memoryLimitBytes(read: (p: string) => string | null = safeRead): number {
  const v2 = read("/sys/fs/cgroup/memory.max")?.trim();
  if (v2 && /^\d+$/.test(v2)) return Number(v2);
  const v1 = read("/sys/fs/cgroup/memory/memory.limit_in_bytes")?.trim();
  if (v1 && /^\d+$/.test(v1) && Number(v1) < os.totalmem()) return Number(v1);
  return os.totalmem();
}

function safeRead(p: string): string | null {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

const MB = 1024 * 1024;

export function createPiperProvider(opts: { dir?: string; voice?: string; memoryLimit?: () => number; rss?: () => number } = {}): TtsProvider {
  const dir = opts.dir ?? PIPER_PARAMS.dir;
  const voice = opts.voice ?? PIPER_PARAMS.voice;
  const bin = path.join(dir, PIPER_PARAMS.binary);
  const model = path.join(dir, `${voice}.onnx`);
  const memoryLimit = opts.memoryLimit ?? (() => memoryLimitBytes());
  const rss = opts.rss ?? (() => process.memoryUsage().rss);
  return {
    id: "piper",
    label: `Piper · ${voice}`,
    mime: "audio/wav",
    fileExt: "wav",
    voiceKey: `piper:${voice}`,
    async availability() {
      if (!fs.existsSync(bin)) return { ok: false, reason: "Piper ist auf diesem Server nicht installiert" };
      if (!fs.existsSync(model) || !fs.existsSync(`${model}.json`)) return { ok: false, reason: `Stimme ${voice} fehlt auf diesem Server` };
      const free = memoryLimit() - rss();
      if (free < PIPER_PARAMS.peakRssBytes) {
        return { ok: false, reason: `zu wenig RAM für Piper (${Math.round(free / MB)} MB frei, ${Math.round(PIPER_PARAMS.peakRssBytes / MB)} MB nötig)` };
      }
      return { ok: true };
    },
    async synthesize(sentences, outPath) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "piper-"));
      try {
        const files = sentences.map((_, i) => path.join(tmp, `${i}.wav`));
        const input = sentences.map((s, i) => JSON.stringify({ text: spokenForm(s), output_file: files[i] })).join("\n") + "\n";
        await new Promise<void>((resolve, reject) => {
          const child = spawn(bin, ["--model", model, "--json-input", "--sentence_silence", String(PIPER_PARAMS.piperSentenceSilenceSeconds), "--quiet"], {
            cwd: path.dirname(bin), stdio: ["pipe", "ignore", "pipe"],
          });
          let err = "";
          const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Piper-Zeitlimit erreicht")); }, PIPER_PARAMS.jobTimeoutMs);
          child.stderr.on("data", (d) => { err = (err + String(d)).slice(-400); });
          child.on("error", (e) => { clearTimeout(timer); reject(e); });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`Piper Exit ${code}: ${err.trim().slice(0, 200)}`));
          });
          child.stdin.end(input);
        });
        const out = concatWavs(files.map(f => fs.readFileSync(f)), PIPER_PARAMS.sentencePauseMs);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(`${outPath}.part`, out.wav);
        fs.renameSync(`${outPath}.part`, outPath);
        return { durationMs: out.durationMs, sentenceStartsMs: out.sentenceStartsMs };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}
