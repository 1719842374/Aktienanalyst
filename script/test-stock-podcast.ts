/**
 * Podcast-Player Section 2 + Researcher-Podcast + Server-Stimme.
 * Kette: Section1 → StockPodcastCard → useStockPodcast → POST /api/stock-podcast → earnings-call-source (FMP/SEC) + OpenRouter;
 *        PodcastPlayer → usePodcastAudio → POST /api/tts/episode → Piper → GET /api/tts/audio;
 *        Researcher → PodcastProbePanel → PodcastPlayer (gleiche Komponente) → TtsPlayerAudioAdapter.
 * FMP und OpenRouter sind gestubbt (kein Key im Test). SEC und Piper laufen live, außer SKIP_LIVE=1.
 * Score, Rating, Schema und analyze-route werden hier nicht berechnet und nicht verändert.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-stock-podcast.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStockChatContext, fitChatContextBudget } from "../shared/chat-context";
import {
  PLAYER_PARAMS, audioStatusLine, sentencesOfParagraphs, spokenForm, splitSentences,
  type PlayerEpisode, type TtsEpisodeStatus,
} from "../shared/podcast-player";
import { researcherPodcastEpisode } from "../shared/researcher-podcast-episode";
import {
  STOCK_PODCAST_MODEL, STOCK_PODCAST_PARAMS, stockPodcastCacheKey, stockPodcastEpisode, type StockPodcastScript,
} from "../shared/stock-podcast";
import {
  decodeEntities, defaultSecDeps, earningsFilingCandidates, exhibitFromIndex, fetchTranscript, fetchTranscriptDates,
  parseFiscalQuarter, parsePeriodEnd, resetEarningsCallMemo, resolveLatestEarningsCall, transcriptSymbolFor,
  type EarningsCallDeps, type FetchedEarningsCall, type ObservedFetch,
} from "../server/earnings-call-source";
import { FMP_LEGACY_BASE } from "../server/fmp";
import { buildStockPodcast, earningsBlockWords, registerStockPodcastRoute, resetStockPodcastCache, type StockPodcastDeps } from "../server/stock-podcast-route";
import { concatWavs, createPiperProvider, memoryLimitBytes, parseWav, wavHeader } from "../server/tts/piper-provider";
import { resolveTtsProvider, type TtsProvider } from "../server/tts/provider";
import { createTtsService, registerTtsRoute } from "../server/tts-route";
import { CursorVoiceAudioAdapter, TtsPlayerAudioAdapter } from "../server/podcast-audio";
import { runPodcastProbe } from "../server/podcast-pipeline";
import { PodcastPlayer } from "../client/src/components/podcast/PodcastPlayer";
import { PodcastProbePanel } from "../client/src/components/researcher/PodcastProbePanel";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
process.exitCode = 1;
const LIVE = process.env.SKIP_LIVE !== "1";

type Obs = { status: number; json: unknown | null; detail: string };
function fmpStub(routes: Record<string, Obs>, calls: string[]): ObservedFetch {
  return async (p, params, base) => {
    const key = `${base === FMP_LEGACY_BASE ? "legacy" : "stable"}${p}?${new URLSearchParams(params).toString()}`;
    calls.push(key);
    return routes[key] ?? { status: 404, json: null, detail: "not found" };
  };
}

const noSec = { cik: async () => null, getText: async () => ({ status: 404, text: "" }) };

function wav(ms: number, rate = 22050): Buffer {
  const samples = Math.round((ms / 1000) * rate);
  return Buffer.concat([wavHeader(samples * 2, rate, 1, 16), Buffer.alloc(samples * 2, 1)]);
}

async function main() {
  // ── Gemeinsames Earnings-Modul ───────────────────────────────────────────
  assert.equal(transcriptSymbolFor("SAP.DE"), "SAP");
  assert.equal(transcriptSymbolFor("VOW3.DE"), "VWAPY");
  assert.equal(transcriptSymbolFor("msft"), "MSFT");
  ok("ADR-Map: SAP.DE → SAP, VOW3.DE → VWAPY, MSFT bleibt");

  const calls: string[] = [];
  const fmp = fmpStub({
    "stable/earning-call-transcript-dates?symbol=MSFT": { status: 402, json: null, detail: "Premium Query Parameter" },
    "legacy/v4/earning_call_transcript?symbol=MSFT": { status: 200, json: [[4, 2026, "2026-07-29 17:30:00"], [1, 2027, "2026-10-28 17:30:00"], [3, 2026, "2026-04-29 17:30:00"]], detail: "" },
    "stable/earning-call-transcript?symbol=MSFT&year=2027&quarter=1": { status: 402, json: null, detail: "Premium" },
    "legacy/v3/earning_call_transcript/MSFT?year=2027&quarter=1": { status: 200, json: [{ symbol: "MSFT", year: 2027, quarter: 1, content: "Satya Nadella: Azure grew 40 percent. Operator: Next question from Keith Weiss." }], detail: "" },
  }, calls);
  const deps: EarningsCallDeps = { fmp, sec: noSec, now: () => 1 };
  resetEarningsCallMemo();
  const call = await resolveLatestEarningsCall("MSFT", deps);
  assert.equal(call.status, "ok");
  assert.equal(call.meta?.kind, "fmp-transcript");
  assert.equal(call.meta?.fiscalYear, 2027);
  assert.equal(call.meta?.quarter, 1);
  assert.equal(call.meta?.date, "2026-10-28");
  assert.match(call.content ?? "", /Satya Nadella/);
  assert.deepEqual(calls, [
    "stable/earning-call-transcript-dates?symbol=MSFT",
    "legacy/v4/earning_call_transcript?symbol=MSFT",
    "stable/earning-call-transcript?symbol=MSFT&year=2027&quarter=1",
    "legacy/v3/earning_call_transcript/MSFT?year=2027&quarter=1",
  ]);
  assert.ok(call.diagnostics.some(d => /stable.*HTTP 402 — Premium Query Parameter/.test(d)));
  assert.ok(call.diagnostics.some(d => /api\/v4.*HTTP 200/.test(d)));
  ok("FMP 402 auf stable → Legacy-Versuch, neuester Termin nach Datum (Q1 FY2027), Status je Schritt in der Diagnose");

  calls.length = 0;
  await resolveLatestEarningsCall("MSFT", deps);
  assert.equal(calls.length, 0);
  ok("Gelöster Call ist je Symbol im Prozess gemerkt, FMP-Dates laufen nicht erneut");

  await assert.rejects(fetchTranscriptDates("MSFT", async () => ({ status: 0, json: null, detail: "FMP_API_KEY not set" })), /FMP_API_KEY not set/);
  await assert.rejects(fetchTranscript("MSFT", 2027, 1, async () => ({ status: 500, json: null, detail: "x" })), (e: any) => e.fmpStatus === 500);
  const sapCalls: string[] = [];
  await fetchTranscriptDates("SAP.DE", fmpStub({ "stable/earning-call-transcript-dates?symbol=SAP": { status: 200, json: [], detail: "" } }, sapCalls));
  assert.deepEqual(sapCalls, ["stable/earning-call-transcript-dates?symbol=SAP"]);
  ok("Default-Deps für Chat/Researcher: Key fehlt → gleiche Fehlermeldung wie bisher, HTTP-Status bleibt lesbar, ADR-Symbol");

  resetEarningsCallMemo();
  const naCall = await resolveLatestEarningsCall("XYZ", { fmp: fmpStub({}, []), sec: noSec, now: () => 1 });
  assert.equal(naCall.status, "n/a");
  assert.match(naCall.reason ?? "", /^n\/a — FMP antwortete HTTP 404; SEC-Fallback/);
  assert.equal(naCall.content, null);
  ok("Ohne Transkript und ohne SEC-Meldung: n/a mit Grund, kein Inhalt");

  const index = `<table class="tableFile"><tr><th>Seq</th></tr>
    <tr><td>1</td><td>8-K</td><td><a href="/ix?doc=/Archives/edgar/data/1/0001/a.htm">a.htm</a></td><td>8-K</td><td>1</td></tr>
    <tr><td>2</td><td>EX-99.1</td><td><a href="/Archives/edgar/data/1/0001/ex99.htm">ex99.htm</a></td><td>EX-99.1</td><td>2</td></tr></table>`;
  assert.equal(exhibitFromIndex(index), "https://www.sec.gov/Archives/edgar/data/1/0001/ex99.htm");
  const subs = { filings: { recent: {
    form: ["4", "8-K", "8-K", "6-K", "10-Q"], items: ["", "5.07", "2.02,9.01", "", ""],
    filingDate: ["2026-10-30", "2026-10-29", "2026-10-28", "2026-07-01", "2026-10-27"],
    accessionNumber: ["a", "b", "c", "d", "e"],
  } } };
  assert.deepEqual(earningsFilingCandidates(subs).map(f => f.accession), ["c", "d"]);
  assert.deepEqual(parseFiscalQuarter("RALPH LAUREN REPORTS BETTER THAN EXPECTED FIRST QUARTER FISCAL 2027 RESULTS"), { quarter: 1, fiscalYear: 2027 });
  assert.deepEqual(parseFiscalQuarter("Quarterly Statement Q3 2026 Current cloud backlog"), { quarter: 3, fiscalYear: 2026 });
  assert.deepEqual(parseFiscalQuarter("Microsoft Announces First Quarter Results REDMOND"), { quarter: 1, fiscalYear: null });
  assert.equal(parseFiscalQuarter("Annual meeting results"), null);
  assert.equal(parsePeriodEnd("results for the quarter ended September 30, 2026, as compared"), "2026-09-30");
  assert.equal(decodeEntities("REDMOND &#x2014; &euro;24.1 &#8226; A&amp;B"), "REDMOND — €24.1 • A&B");
  ok("SEC: 8-K nur mit Item 2.02 oder 6-K, EX-99.1 aus dem Index, Quartal nur aus dem Kopf, sonst null");

  if (LIVE) {
    const live: Record<string, FetchedEarningsCall> = {};
    for (const s of ["MSFT", "RL", "SAP.DE"]) {
      resetEarningsCallMemo();
      live[s] = await resolveLatestEarningsCall(s, { fmp: async () => ({ status: 0, json: null, detail: "FMP_API_KEY not set" }), sec: defaultSecDeps, now: () => Date.now() });
      assert.equal(live[s].status, "ok", `${s}: ${live[s].reason} ${live[s].diagnostics.join(" | ")}`);
      assert.equal(live[s].meta?.kind, "sec-exhibit");
      assert.match(live[s].meta?.sourceUrl ?? "", /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//);
      assert.ok((live[s].content ?? "").length > 5000, s);
      console.log(`     live ${s}: ${live[s].meta?.sourceLabel} · Q${live[s].meta?.quarter ?? "?"} FY${live[s].meta?.fiscalYear ?? "?"} · ${live[s].content?.length} Zeichen`);
    }
    assert.equal(live.MSFT.meta?.quarter, 1);
    assert.equal(live.MSFT.meta?.periodEnd, "2026-09-30");
    assert.equal(live.RL.meta?.fiscalYear, 2027);
    assert.equal(live["SAP.DE"].meta?.sourceSymbol, "SAP");
    assert.equal(live["SAP.DE"].meta?.quarter, 3);
    assert.match(live["SAP.DE"].meta?.sourceLabel ?? "", /6-K/);
    ok("Live SEC: MSFT 8-K, RL 8-K, SAP.DE über SAP 6-K mit EX-99.1, Quelle und Quartal aus der Meldung");
  }

  // ── Skript-Route Section 2 ───────────────────────────────────────────────
  const raw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  const before = JSON.stringify(raw);
  const ctx = fitChatContextBudget(buildStockChatContext(raw));
  assert.equal(JSON.stringify(raw), before);
  const secCall: FetchedEarningsCall = {
    status: "ok", reason: "Kein FMP-Transkript (FMP_API_KEY nicht konfiguriert); Quelle ist die SEC-Pressemitteilung", diagnostics: ["SEC ok"],
    content: "Microsoft Announces First Quarter Results. \"We are seeing strong demand,\" said Satya Nadella, chairman and chief executive officer.",
    meta: { kind: "sec-exhibit", fiscalYear: null, quarter: 1, periodEnd: "2026-09-30", date: "2026-10-28", sourceLabel: "SEC 8-K Exhibit 99.1 (Pressemitteilung, 2026-10-28)", sourceUrl: "https://www.sec.gov/x", sourceSymbol: "MSFT" },
  };
  const prompts: Array<{ prompt: string; systemPrompt?: string; model?: string; maxTokens?: number }> = [];
  const store = new Map<string, StockPodcastScript>();
  const words = (k: number) => Array.from({ length: k }, (_, i) => `Wort${i}`).join(" ") + ".";
  const podDeps = (over: Partial<StockPodcastDeps> = {}): StockPodcastDeps => ({
    earnings: async () => secCall,
    llmAvailable: () => true,
    llm: async (o) => {
      prompts.push(o);
      const isEarnings = /QUELLE:/.test(o.prompt);
      return { data: { paragraphs: [isEarnings ? `Satya Nadella sagte sinngemäß, die Nachfrage sei stark. ${words(900)}` : `Microsoft wächst. ${words(500)}`] }, modelUsed: STOCK_PODCAST_MODEL };
    },
    cacheGet: (k) => store.get(k) ?? null,
    cacheSet: (k, s) => { store.set(k, s); },
    now: () => Date.parse("2026-11-02T10:00:00Z"),
    ...over,
  });
  resetStockPodcastCache();
  const first = await buildStockPodcast("MSFT", { context: ctx, companyName: "Microsoft" }, podDeps());
  assert.equal(first.http, 200);
  const script = first.script!;
  assert.equal(script.cached, false);
  assert.equal(script.earnings.status, "ok");
  assert.equal(script.analysis.status, "ok");
  assert.match(script.earnings.text, /^Microsoft, Quartalsmeldung vom 28\.10\.2026, Q1 \(bis 30\.09\.2026\)\. Quelle: SEC 8-K Exhibit 99\.1/);
  assert.match(script.earnings.text, /Fragerunde ist deshalb nicht Teil/);
  assert.equal(script.cacheKey, "stock_podcast_v1__MSFT__2026-10-28");
  assert.equal(script.earnings.diagnostics[0], secCall.reason);
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every(p => p.model === STOCK_PODCAST_MODEL && p.maxTokens === STOCK_PODCAST_PARAMS.maxTokensPerChapter));
  const ep = prompts.find(p => /QUELLE:/.test(p.prompt))!;
  const w = earningsBlockWords("sec-exhibit");
  assert.equal(w.qa, 0);
  assert.equal(w.guidance + w.segments + w.quotes, STOCK_PODCAST_PARAMS.earningsTargetWords);
  assert.match(ep.prompt, new RegExp(`Guidance und Ausblick \\(rund ${w.guidance} Wörter\\)`));
  assert.match(ep.prompt, /Kein Zitat ohne Sprecher aus der Quelle/);
  assert.match(ep.prompt, /Q&A: n\/a, die Pressemitteilung enthält keine Fragerunde/);
  assert.match(ep.prompt, /Länge gesamt 960 bis 1440 Wörter/);
  assert.match(ep.systemPrompt ?? "", /Erfinde nichts/);
  const wf = earningsBlockWords("fmp-transcript");
  assert.equal(wf.qa, STOCK_PODCAST_PARAMS.earningsTargetWords * STOCK_PODCAST_PARAMS.earningsShares.qa);
  const ap = prompts.find(p => /KONTEXT:/.test(p.prompt))!;
  assert.match(ap.prompt, /Dashboard: Aktien-Analyse/);
  assert.match(ap.systemPrompt ?? "", /keine neuen Score-Werte/);
  ok("Kapitel 1 aus SEC-Quelle: fester Einstieg mit Datum/Quartal/Quelle, Anteile als Wörter, Zitate nur mit Sprecher, Q&A n/a; Kapitel 2 aus dem Chat-Kontext");

  const second = await buildStockPodcast("MSFT", { context: ctx, companyName: "Microsoft" }, podDeps());
  assert.equal(second.script?.cached, true);
  assert.equal(prompts.length, 2);
  resetStockPodcastCache();
  const fromDisk = await buildStockPodcast("MSFT", { context: ctx }, podDeps());
  assert.equal(fromDisk.script?.cached, true);
  assert.equal(prompts.length, 2);
  ok("Cache je Ticker und Quartal: zweiter Aufruf aus Speicher, nach Neustart aus Disk, kein zweiter LLM-Call");

  resetStockPodcastCache();
  store.clear();
  prompts.length = 0;
  const missing = await buildStockPodcast("MSFT", { context: ctx }, podDeps({
    earnings: async () => ({ status: "n/a", reason: "n/a — FMP antwortete HTTP 402; SEC-Fallback ohne Quartalsmeldung", meta: null, content: null, diagnostics: [] }),
  }));
  assert.equal(missing.script?.earnings.status, "n/a");
  assert.match(missing.script?.earnings.reason ?? "", /HTTP 402/);
  assert.equal(missing.script?.analysis.status, "ok");
  assert.equal(prompts.length, 1);
  const missingEp = stockPodcastEpisode(missing.script!, "Microsoft");
  assert.deepEqual(missingEp.chapters.map(c => c.id), ["earnings-call", "analysis"]);
  assert.equal(missingEp.chapters[0].sentences.length, 0);
  assert.ok(missingEp.chapters[1].sentences.length > 0);
  ok("Fehlt der Call: Kapitel 1 n/a mit Grund, kein LLM-Call dafür, nur Kapitel 2 spielt");

  resetStockPodcastCache();
  store.clear();
  let llmCalls = 0;
  const noKey = await buildStockPodcast("MSFT", { context: ctx }, podDeps({ llmAvailable: () => false, llm: async () => { llmCalls++; return null; } }));
  assert.equal(llmCalls, 0);
  assert.equal(noKey.script?.earnings.status, "n/a");
  assert.match(noKey.script?.analysis.reason ?? "", /kein OpenRouter-Key konfiguriert/);
  assert.equal(store.size, 0);
  ok("Ohne OpenRouter-Key: beide Kapitel n/a mit der Chat-Meldung, nichts gecacht");

  assert.equal((await buildStockPodcast("MSFT", { context: { ...ctx, dashboard: "btc" } }, podDeps())).http, 400);
  assert.equal((await buildStockPodcast("AAPL", { context: ctx }, podDeps())).http, 400);
  assert.equal((await buildStockPodcast("MSFT", { context: null }, podDeps())).http, 400);
  ok("Kontext wird mit dem Chat-Schema geprüft: falsches Dashboard, falscher Ticker, leer → 400");

  assert.equal(stockPodcastCacheKey("rl", { fiscalYear: 2027, quarter: 1, date: "2026-08-06" }), "stock_podcast_v1__RL__FY2027Q1");
  const epi = stockPodcastEpisode(script, "Microsoft");
  assert.equal(epi.title, "Microsoft: Q1 (bis 30.09.2026) Earnings Call & KI-Analyse");
  assert.equal(epi.chapters[0].sourceUrl, "https://www.sec.gov/x");
  ok("Episode: feste Reihenfolge Call → Analyse, Quelle sichtbar");

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  resetStockPodcastCache();
  store.clear();
  registerStockPodcastRoute(app, podDeps());
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const resp = await fetch(`http://127.0.0.1:${port}/api/stock-podcast/MSFT`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: ctx, companyName: "Microsoft" }) });
  const body = await resp.json() as StockPodcastScript;
  assert.equal(resp.status, 200);
  assert.equal(body.earnings.meta?.kind, "sec-exhibit");
  const bad = await fetch(`http://127.0.0.1:${port}/api/stock-podcast/..%2F..`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(bad.status, 400);
  server.close();
  ok("POST /api/stock-podcast/:symbol über Express: 200 mit Skript, ungültiges Symbol 400");

  // ── Sätze und Sprechform ────────────────────────────────────────────────
  assert.deepEqual(splitSentences("Der Umsatz stieg auf 77,7 Mrd. Dollar. Das ist gut! Q1 lief."), ["Der Umsatz stieg auf 77,7 Mrd. Dollar.", "Das ist gut!", "Q1 lief."]);
  assert.deepEqual(sentencesOfParagraphs("A eins.\n\nB zwei."), ["A eins.", "B zwei."]);
  assert.equal(spokenForm("Q1 FY2027: +18 % auf 77,7 Mrd. am 28.10.2026 bzw. 2026-09-30, €24,1 und $5"), "Quartal 1 Geschäftsjahr 2027: +18 Prozent auf 77,7 Milliarden am 28. Oktober 2026 bzw. 30. September 2026, 24,1 Euro und 5 Dollar");
  ok("Satzgrenzen lassen Zahlen ganz; Sprechform liest Q1, FY, %, Mrd., Datum und Währung aus");

  // ── TTS-Provider und Route ──────────────────────────────────────────────
  const piperRes = resolveTtsProvider({ piper: () => createPiperProvider() }, {});
  assert.equal(piperRes.kind, "server");
  assert.equal(piperRes.kind === "server" && piperRes.provider.label, "Piper · de_DE-thorsten-high");
  const browserRes = resolveTtsProvider({ piper: () => createPiperProvider() }, { TTS_PROVIDER: "browser" });
  assert.equal(browserRes.kind, "browser");
  let paidKey: string | null | undefined;
  const paid = resolveTtsProvider({ piper: () => createPiperProvider(), paid: (k) => { paidKey = k; return createPiperProvider(); } }, { TTS_PROVIDER: "paid", TTS_API_KEY: "k-test" });
  assert.equal(paid.kind, "server");
  assert.equal(paidKey, "k-test");
  const unknown = resolveTtsProvider({ piper: () => createPiperProvider() }, { TTS_PROVIDER: "elevenlabs", TTS_API_KEY: "x" });
  assert.equal(unknown.kind, "browser");
  assert.match(unknown.kind === "browser" ? unknown.reason : "", /nicht eingebaut/);
  ok("Provider: Default Piper ohne Env, TTS_PROVIDER/TTS_API_KEY für spätere Provider, nicht eingebauter Provider → Browser mit Grund");

  const joined = concatWavs([wav(1000), wav(500)], 350);
  assert.equal(joined.durationMs, 1850);
  assert.deepEqual(joined.sentenceStartsMs, [0, 1350]);
  assert.equal(parseWav(joined.wav).pcm.length, Math.round(1.85 * 22050) * 2);
  assert.equal(memoryLimitBytes(p => (p.endsWith("memory.max") ? "536870912\n" : null)), 536870912);
  const lowRam = createPiperProvider({ dir: "vendor/piper", memoryLimit: () => 512 * 1024 * 1024, rss: () => 300 * 1024 * 1024 });
  const lowAvail = await lowRam.availability();
  if (existsSync("vendor/piper/piper/piper")) assert.match(lowAvail.ok ? "" : lowAvail.reason, /zu wenig RAM für Piper \(212 MB frei, 400 MB nötig\)/);
  const missingBin = await createPiperProvider({ dir: "/nonexistent" }).availability();
  assert.match(missingBin.ok ? "" : missingBin.reason, /nicht installiert/);
  ok("WAV-Verkettung mit fester Pause, exakte Satzstarts; RAM-Grenze aus cgroup (512 MB-Plan → Browser-Fallback mit Grund)");

  const dir = mkdtempSync(path.join(os.tmpdir(), "tts-test-"));
  let synthCalls = 0;
  let fail = false;
  const fake: TtsProvider = {
    id: "fake", label: "Fake · test", mime: "audio/wav", fileExt: "wav", voiceKey: "fake:v1",
    availability: async () => ({ ok: true }),
    synthesize: async (sentences, out) => {
      synthCalls++;
      if (fail) throw new Error("kaputt");
      const parts = sentences.map(() => wav(200));
      const r = concatWavs(parts, 100);
      writeFileSync(out, r.wav);
      return { durationMs: r.durationMs, sentenceStartsMs: r.sentenceStartsMs };
    },
  };
  const svc = createTtsService({ resolve: () => ({ kind: "server", provider: fake }), cacheDir: dir });
  const req = { scope: "stock", id: "MSFT", chapters: [{ id: "earnings-call", sentences: ["Eins.", "Zwei."] }, { id: "analysis", sentences: ["Drei."] }] };
  const s1 = await svc.episode(req);
  assert.equal((s1.body as TtsEpisodeStatus).status, "pending");
  await svc.idle();
  const s2 = (await svc.episode(req)).body as TtsEpisodeStatus;
  assert.equal(s2.status, "ready");
  assert.equal(s2.chapters.length, 2);
  assert.deepEqual(s2.chapters[0].sentenceStartsMs, [0, 300]);
  assert.match(s2.chapters[0].url, /^\/api\/tts\/audio\/stock\/MSFT\/earnings-call__[a-f0-9]{16}\.wav$/);
  assert.equal(synthCalls, 2);
  await svc.episode(req);
  await svc.idle();
  assert.equal(synthCalls, 2);
  const changed = { ...req, chapters: [{ id: "earnings-call", sentences: ["Eins.", "Anders."] }, req.chapters[1]] };
  await svc.episode(changed);
  await svc.idle();
  assert.equal(synthCalls, 3);
  ok("TTS-Cache: Schlüssel ID + Text-Hash; gleicher Text → keine neue Synthese, neuer Text → neues Audio");

  const file = s2.chapters[0].url.split("/").pop()!;
  assert.ok(svc.filePath("stock", "MSFT", file));
  assert.equal(svc.filePath("stock", "..", file), null);
  assert.equal(svc.filePath("stock", "MSFT", "../../etc/passwd"), null);
  assert.equal(svc.filePath("other", "MSFT", file), null);
  assert.equal((await svc.episode({ scope: "stock", id: "../x", chapters: [] })).http, 400);
  assert.equal((await svc.episode({ ...req, chapters: [{ id: "a", sentences: ["x".repeat(2000)] }] })).http, 400);
  ok("Audio-Pfade nur über Whitelist-Muster, kein Path-Traversal; Anfragegrenzen über Zod");

  fail = true;
  const failReq = { scope: "researcher", id: "MARKT", chapters: [{ id: "intro", sentences: ["Fehler."] }] };
  await svc.episode(failReq);
  await svc.idle();
  const failed = (await svc.episode(failReq)).body as TtsEpisodeStatus;
  assert.equal(failed.status, "n/a");
  assert.match(failed.reason ?? "", /Fake · test fehlgeschlagen: kaputt/);
  assert.match(audioStatusLine(failed), /^ok — Browser-Stimme \(Web Speech API\) · Server-Stimme: Fake/);
  const off = createTtsService({ resolve: () => ({ kind: "browser", id: "browser", label: "Browser-Stimme (Web Speech API)", reason: "TTS_PROVIDER=browser" }), cacheDir: dir });
  const offStatus = (await off.episode(req)).body as TtsEpisodeStatus;
  assert.equal(offStatus.status, "n/a");
  assert.equal(offStatus.provider, "browser");
  ok("Synthese-Fehler oder keine Server-Stimme → n/a mit Grund, Player spricht mit Web Speech");

  const tapp = express();
  tapp.use(express.json());
  registerTtsRoute(tapp, svc);
  const tserver = tapp.listen(0);
  const tport = (tserver.address() as AddressInfo).port;
  const audioResp = await fetch(`http://127.0.0.1:${tport}${s2.chapters[0].url}`, { headers: { Range: "bytes=0-43" } });
  assert.equal(audioResp.status, 206);
  assert.equal(audioResp.headers.get("content-type"), "audio/wav");
  assert.equal((await audioResp.arrayBuffer()).byteLength, 44);
  assert.equal((await fetch(`http://127.0.0.1:${tport}/api/tts/audio/stock/MSFT/nope__0123456789abcdef.wav`)).status, 404);
  tserver.close();
  rmSync(dir, { recursive: true, force: true });
  ok("GET /api/tts/audio liefert WAV mit Range (206), unbekannte Datei 404");

  if (LIVE && existsSync("vendor/piper/piper/piper")) {
    const liveDir = mkdtempSync(path.join(os.tmpdir(), "tts-live-"));
    const piper = createTtsService({ cacheDir: liveDir });
    const ps = await piper.providerStatus();
    assert.equal(ps.server, true, ps.reason ?? "");
    const sentences = sentencesOfParagraphs(script.earnings.text).slice(0, 2).concat(["Der Umsatz stieg im Q1 um 18 % auf 77,7 Mrd. Dollar."]);
    const t0 = Date.now();
    await piper.episode({ scope: "stock", id: "MSFT", chapters: [{ id: "earnings-call", sentences }] });
    await piper.idle();
    const done = (await piper.episode({ scope: "stock", id: "MSFT", chapters: [{ id: "earnings-call", sentences }] })).body as TtsEpisodeStatus;
    assert.equal(done.status, "ready", done.reason ?? "");
    assert.equal(done.chapters[0].sentenceStartsMs.length, sentences.length);
    const wavFile = piper.filePath("stock", "MSFT", done.chapters[0].url.split("/").pop()!)!;
    const parsed = parseWav(readFileSync(wavFile.path));
    assert.equal(parsed.sampleRate, 22050);
    console.log(`     live Piper: ${sentences.length} Sätze, ${(done.chapters[0].durationMs / 1000).toFixed(1)} s Audio in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    rmSync(liveDir, { recursive: true, force: true });
    ok("Live Piper de_DE-thorsten-high: WAV 22,05 kHz, Satzstarts je Satz, Status ready");
  }

  // ── Researcher-Podcast ──────────────────────────────────────────────────
  const adapter = new TtsPlayerAudioAdapter(async () => ({ provider: "piper", providerLabel: "Piper · de_DE-thorsten-high", server: true, reason: null }), "Browser-Stimme (Web Speech API)");
  assert.deepEqual(await adapter.synthesize("Hallo."), { status: "ok", reason: "ok — Piper · de_DE-thorsten-high", audioUrl: null });
  const fallback = new TtsPlayerAudioAdapter(async () => ({ provider: "piper", providerLabel: "Piper", server: false, reason: "Piper ist auf diesem Server nicht installiert" }), "Browser-Stimme (Web Speech API)");
  assert.equal((await fallback.synthesize("Hallo.")).reason, "ok — Browser-Stimme (Web Speech API) · Server-Stimme: Piper ist auf diesem Server nicht installiert");
  assert.equal((await adapter.synthesize("  ")).status, "n/a");
  const routeSrc = readFileSync("server/podcast-route.ts", "utf8");
  assert.match(routeSrc, /new TtsPlayerAudioAdapter\(\(\) => sharedTtsService\(\)\.providerStatus\(\)/);
  assert.equal(routeSrc.includes("new CursorVoiceAudioAdapter()"), false);
  ok("Researcher-Audio: Provider und „ok“ statt n/a; ohne Server-Stimme ok mit Browser-Stimme und Grund");

  const driver = (id: string, rank: number, label: string) => ({ id, rank, label, source: `FRED ${id}`, channels: ["fred"], value: 1, unit: null, asOf: "2026-11-01", citation: null, relevance: 1, reason: "r", components: {} as any });
  const probeScript = {
    title: "Gold und Zinsen", hook: "Gold steigt.", thesis: "Die Kosten laufen mit.",
    takeaways: [{ driverId: "GOLD_AISC", text: "Die AISC liegen hoch. Quelle: Gold AISC." }, { driverId: "T10Y2Y", text: "Die Kurve dreht." }],
    problem: "Die Historie fehlt.", implication: "Das ändert die Einordnung.", close: "Keine Anlageberatung.",
    spokenScript: "Gold steigt.", citations: [],
  };
  const probe = await runPodcastProbe({
    collect: async () => ({ series: [], gaps: [], notes: [] } as any),
    llm: async () => ({ data: probeScript, modelUsed: "mock" }),
    audio: adapter,
    today: "2026-11-02",
  });
  assert.equal(probe.progress.find(p => p.step === "audio")?.detail, "ok — Piper · de_DE-thorsten-high");
  const old = await runPodcastProbe({ collect: async () => ({ series: [], gaps: [], notes: [] } as any), llm: async () => null, audio: new CursorVoiceAudioAdapter(), today: "2026-11-02" });
  assert.match(old.progress.find(p => p.step === "audio")?.detail ?? "", /^n\/a — Cursor Voice/);
  const rEp = researcherPodcastEpisode(probeScript, [driver("GOLD_AISC", 1, "Gold AISC"), driver("T10Y2Y", 2, "Zinskurve 10J-2J")], "2026-11-01");
  assert.deepEqual(rEp.chapters.map(c => c.title), ["Einstieg", "1. Gold AISC", "2. Zinskurve 10J-2J", "Einordnung & Schluss"]);
  assert.equal(rEp.chapters[1].sourceLabel, "FRED GOLD_AISC");
  assert.equal(rEp.id, "MARKT");
  ok("Researcher-Kapitel aus den Treibern („1. Gold AISC“), Audio-Fortschritt zeigt den Adaptergrund");

  // ── Gemeinsamer Player, statisch gerendert ──────────────────────────────
  const players: Array<[string, PlayerEpisode]> = [["stock", epi], ["researcher", rEp]];
  for (const [scope, episode] of players) {
    const html = renderToStaticMarkup(React.createElement(PodcastPlayer, { episode, scope: scope as "stock" | "researcher" }));
    for (const id of ["podcast-player", "podcast-play", "podcast-back", "podcast-forward", "podcast-speed", "podcast-sleep", "podcast-chapters", "podcast-transcript-toggle", "podcast-player-time"]) {
      assert.ok(html.includes(`data-testid="${id}"`), `${scope}: ${id}`);
    }
    assert.ok(html.includes(`${PLAYER_PARAMS.skipSeconds} Sekunden zurück`));
    for (const m of PLAYER_PARAMS.sleepMinutes) assert.ok(html.includes(`${m} Minuten`));
    assert.ok(html.includes("Ende des Kapitels"));
    assert.ok(html.includes("bg-card") && html.includes("text-foreground") && html.includes("border-border"));
    assert.equal(html.includes("whitespace-nowrap"), false);
    assert.equal(html.includes("text-muted-foreground"), false);
  }
  const missingHtml = renderToStaticMarkup(React.createElement(PodcastPlayer, { episode: missingEp, scope: "stock" }));
  assert.ok(missingHtml.includes("HTTP 402"));
  assert.equal(missingHtml.includes('data-testid="podcast-segment-earnings-call"'), false);
  assert.ok(missingHtml.includes('data-testid="podcast-segment-analysis"'));
  ok("Ein Player für beide Stellen: Play/Pause, ±15 s, Speed, Sleep (15/30/45/60/Kapitel), Kapitel, Transkript; n/a-Kapitel mit Grund ohne Segment");

  const withDrivers = { ...probe, drivers: [driver("GOLD_AISC", 1, "Gold AISC"), driver("T10Y2Y", 2, "Zinskurve 10J-2J")] };
  const panelHtml = renderToStaticMarkup(React.createElement(PodcastProbePanel, { state: { phase: "done", result: withDrivers }, playRequest: 1 }));
  assert.ok(panelHtml.includes('data-testid="podcast-player"'));
  assert.ok(panelHtml.includes("1. Gold AISC"));
  assert.ok(panelHtml.includes("Audio: ok — Piper · de_DE-thorsten-high"));
  const page = readFileSync("client/src/pages/Researcher.tsx", "utf8");
  assert.match(page, /setPodcastPlayRequest\(n => n \+ 1\)/);
  assert.match(page, /playRequest=\{podcastPlayRequest\}/);
  ok("Researcher-Panel nutzt denselben Player; Podcast-Knopf startet bzw. öffnet ihn");

  // ── Leitplanken ─────────────────────────────────────────────────────────
  const newSources = [
    "server/earnings-call-source.ts", "server/stock-podcast-route.ts", "server/tts-route.ts", "server/tts/provider.ts",
    "server/tts/piper-provider.ts", "shared/podcast-player.ts", "shared/stock-podcast.ts", "shared/researcher-podcast-episode.ts",
    "client/src/components/podcast/PodcastPlayer.tsx", "client/src/components/podcast/StockPodcastCard.tsx",
    "client/src/hooks/useStockPodcast.ts", "client/src/hooks/usePodcastAudio.ts",
  ].map(f => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(newSources, /from\s+["'][^"']*analyze-route|import\(["'][^"']*analyze-route|overallScore|applyBiasFix|finalScore/);
  assert.equal(execSync("git hash-object shared/schema.ts").toString().trim().slice(0, 8), "1d3edc73");
  assert.equal(execSync("git diff --name-only origin/main -- server/analyze-route.ts shared/schema.ts").toString().trim(), "");
  ok("Neue Module ohne Score/analyze-route; shared/schema.ts Hash 1d3edc73, analyze-route.ts unverändert");

  console.log(`stock podcast: ${n} checks ok`);
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
