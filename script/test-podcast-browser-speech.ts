/**
 * Browser-Stimme der bestehenden Podcast-Texte.
 * Produktiver Pfad: API-Antwort → Session → gemockte Web Speech.
 * Helfer: Satzgrenzen. Kein Netz, kein Server-TTS, kein Piper.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-podcast-browser-speech.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserSpeechControls } from "../client/src/components/podcast/BrowserSpeechControls";
import { PodcastProbePanel } from "../client/src/components/researcher/PodcastProbePanel";
import {
  createBrowserSpeechSession,
  playbackIdForSymbols,
  podcastRunStillCurrent,
  speechSourceFromBrief,
  splitSpeechSentences,
  type BrowserSpeechEngine,
  type BrowserSpeechHandlers,
} from "../client/src/lib/podcast-browser-speech";
import type { PodcastProbeResult } from "../server/podcast-pipeline";

let n = 0;
const ok = (name: string) => { n += 1; console.log(`  ✅ ${name}`); };

function mockEngine(supported = true) {
  const spoken: string[] = [];
  let handlers: BrowserSpeechHandlers | null = null;
  let cancels = 0;
  const engine: BrowserSpeechEngine = {
    supported,
    speak(text, next) {
      spoken.push(text);
      handlers = next;
    },
    cancel() { cancels += 1; },
  };
  return {
    engine,
    spoken,
    cancelCount: () => cancels,
    start: () => handlers?.onstart(),
    end: () => handlers?.onend(),
    fail: (message: string) => handlers?.onerror(message),
  };
}

function probeResult(spokenScript: string | null, audioUrl: string | null): PodcastProbeResult {
  return {
    drivers: [],
    gaps: [],
    notes: [],
    script: spokenScript
      ? {
          title: "Zinsdifferenz",
          hook: "",
          thesis: "",
          takeaways: [],
          problem: "",
          implication: "",
          close: "Dies ist keine Anlageberatung. KI-generiert im Research-Stil.",
          spokenScript,
          citations: [],
        }
      : null,
    scriptStatus: spokenScript ? "ok" : "n/a — kein Skript",
    audio: { status: "n/a", reason: "n/a — keine Audiodatei", audioUrl },
    progress: [],
    modelUsed: null,
  };
}

function productivePath() {
  const voice = mockEngine();
  const session = createBrowserSpeechSession(voice.engine);
  const source = speechSourceFromBrief("MSFT", {
    script: { spokenScript: "Erster Satz. Zweiter Satz." },
    audio: { status: "n/a", reason: "n/a — keine Audiodatei", audioUrl: "https://example.test/fake.mp3" },
  });
  assert.equal(source.audioSrc, null);
  assert.equal(source.text, "Erster Satz. Zweiter Satz.");
  assert.match(source.fileDetail, /^n\/a — keine Audiodatei/);
  session.setSource(source.sourceId, source.text);
  session.play();
  assert.equal(session.getState().phase, "loading");
  assert.deepEqual(voice.spoken, ["Erster Satz."]);
  voice.start();
  assert.equal(session.getState().phase, "playing");
  assert.equal(session.getState().activeId, "MSFT");
  voice.end();
  assert.deepEqual(voice.spoken, ["Erster Satz.", "Zweiter Satz."]);
  voice.start();
  voice.end();
  assert.equal(session.getState().phase, "idle");
  assert.match(session.getState().detail, /beendet/);
  assert.equal(voice.spoken.join(" ").includes("fake.mp3"), false);
  ok("API-Text wird gesprochen, die Audiodatei bleibt unbenutzt");

  const missingVoice = mockEngine();
  const missing = createBrowserSpeechSession(missingVoice.engine);
  const noText = speechSourceFromBrief("AAPL", {
    script: null,
    audio: { status: "ok", reason: "sollte nicht ok sein", audioUrl: "https://example.test/a.wav" },
  });
  assert.equal(noText.text, null);
  assert.equal(noText.audioSrc, null);
  assert.match(noText.fileDetail, /^n\/a — kein Text/);
  missing.setSource(noText.sourceId, noText.text);
  missing.play();
  assert.equal(missing.getState().phase, "n/a");
  assert.equal(missingVoice.spoken.length, 0);
  ok("fehlender Text ist n/a und startet keine Wiedergabe");

  const failing = mockEngine();
  const failed = createBrowserSpeechSession(failing.engine);
  failed.setSource("MSFT", "Erster Satz. Zweiter Satz.");
  failed.play();
  failing.fail("Stimme abgelehnt");
  assert.equal(failed.getState().phase, "error");
  assert.match(failed.getState().detail, /n\/a — Stimme abgelehnt/);
  assert.deepEqual(failing.spoken, ["Erster Satz."]);
  ok("Fehler stoppt, der nächste Satz wird nicht erfunden");

  const stopped = mockEngine();
  const aborted = createBrowserSpeechSession(stopped.engine);
  aborted.setSource("MSFT", "Erster Satz. Zweiter Satz.");
  aborted.play();
  stopped.start();
  aborted.abort();
  assert.equal(aborted.getState().phase, "aborted");
  stopped.end();
  assert.equal(aborted.getState().phase, "aborted");
  assert.deepEqual(stopped.spoken, ["Erster Satz."]);
  aborted.replay();
  assert.equal(stopped.spoken.at(-1), "Erster Satz.");
  stopped.start();
  assert.equal(aborted.getState().phase, "playing");
  ok("Abbruch gibt die Stimme frei, Erneut liest von vorn");

  const ticker = mockEngine();
  const switched = createBrowserSpeechSession(ticker.engine);
  switched.setSource("MSFT", "Erster Satz. Zweiter Satz.");
  switched.play();
  ticker.start();
  const cancels = ticker.cancelCount();
  switched.setSource("SAP", "Anderer Titel.");
  assert.ok(ticker.cancelCount() > cancels);
  ticker.end();
  assert.equal(switched.getState().activeId, "SAP");
  assert.equal(switched.getState().phase, "idle");
  assert.equal(ticker.spoken.filter(line => line.startsWith("Zweiter") || line.startsWith("Anderer")).length, 0);
  ok("Tickerwechsel bricht die alte Wiedergabe ab und spricht den neuen Text nicht von selbst");

  const blocked = mockEngine(false);
  const unsupported = createBrowserSpeechSession(blocked.engine);
  unsupported.setSource("MSFT", "Text da.");
  unsupported.play();
  assert.equal(unsupported.getState().phase, "error");
  assert.match(unsupported.getState().detail, /Web Speech/);
  assert.equal(blocked.spoken.length, 0);
  ok("ohne Web Speech bleibt n/a und es entsteht keine Audiodatei");

  assert.equal(playbackIdForSymbols(["MSFT", "SAP"]), "MSFT,SAP");
  assert.equal(playbackIdForSymbols([]), "researcher");
  assert.equal(podcastRunStillCurrent(2, 2), true);
  assert.equal(podcastRunStillCurrent(2, 3), false);
  ok("später Antwortlauf nach Symbolwechsel gilt nicht mehr");

  const html = renderToStaticMarkup(React.createElement(PodcastProbePanel, {
    playbackId: "MSFT",
    state: { phase: "done", result: probeResult("Nur dieser Satz.", "https://example.test/fake.mp3") },
  }));
  assert.match(html, /data-testid="podcast-browser-speech"/);
  assert.match(html, /KI-generiert im Research-Stil/);
  assert.match(html, /Audio: n\/a — keine Audiodatei/);
  assert.equal(html.includes("<audio"), false);
  assert.equal(html.includes("fake.mp3"), false);
  assert.equal(html.includes("whitespace-nowrap"), false);
  const emptyHtml = renderToStaticMarkup(React.createElement(BrowserSpeechControls, { sourceId: "MSFT", text: null }));
  assert.match(emptyHtml, /n\/a — kein Text zum Vorlesen/);
  assert.match(emptyHtml, /disabled/);
  assert.equal(emptyHtml.includes("<audio"), false);
  ok("Panel zeigt den Browser-Spieler ohne Audio-Element und ohne erfundene URL");
}

function helperChecks() {
  assert.deepEqual(
    splitSpeechSentences("bis zum 30. September bleibt der Wert."),
    ["bis zum 30. September bleibt der Wert."],
  );
  assert.deepEqual(
    splitSpeechSentences("Umsatz 12 Mrd. Dollar. Danach die Marge."),
    ["Umsatz 12 Mrd. Dollar.", "Danach die Marge."],
  );
  assert.deepEqual(splitSpeechSentences("Absatz eins.\n\nAbsatz zwei."), ["Absatz eins.", "Absatz zwei."]);
  assert.deepEqual(splitSpeechSentences("   "), []);
  ok("Satzgrenzen lassen Datum, Abkürzung und Absatzgrenze ganz");

  const sources = [
    "client/src/lib/podcast-browser-speech.ts",
    "client/src/components/podcast/BrowserSpeechControls.tsx",
    "client/src/components/researcher/PodcastProbePanel.tsx",
    "client/src/components/podcast/PodcastTranscript.tsx",
  ].map(file => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(sources, /\/api\/tts|piper|TTS_PROVIDER|de_DE-thorsten/);
  const page = readFileSync("client/src/pages/Researcher.tsx", "utf8");
  assert.match(page, /playbackId=\{podcastPlaybackId\}/);
  assert.match(page, /podcastRunStillCurrent/);
  assert.match(page, /symbols: symbolsInResearcherView/);
  assert.doesNotMatch(page.slice(page.indexOf("async function runPodcast"), page.indexOf("async function runBriefing")), /ScreenerPanel|BriefingModal/);
  ok("keine Server-TTS-Quelle und der Researcher-Hunk bleibt auf der Podcast-Fläche");
}

function main() {
  console.log("produktiver Pfad");
  productivePath();
  console.log("Helfer");
  helperChecks();
  console.log(`podcast browser speech: ${n} checks ok`);
}

main();
