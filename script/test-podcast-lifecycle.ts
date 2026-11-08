/**
 * Lebenszyklus an den produktiven Flächen.
 * Transport: eine gemeinsame speechSynthesis-Schnittstelle und fetch.
 * Zwei BrowserSpeechControls und zwei Sessions nutzen browserSpeechEngine(),
 * keine privaten Mock-Engines.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-podcast-lifecycle.ts
 */
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { pathToFileURL } from "node:url";

register("./empty-css-loader.mjs", pathToFileURL("./script/"));

const require = createRequire(import.meta.url);
const { JSDOM } = require("/tmp/jsdom-local/node_modules/jsdom");

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/researcher",
  pretendToBeVisual: true,
});
const windowRef = dom.window;
function expose(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
expose("window", windowRef);
expose("document", windowRef.document);
expose("HTMLElement", windowRef.HTMLElement);
expose("Node", windowRef.Node);
expose("Element", windowRef.Element);
expose("DocumentFragment", windowRef.DocumentFragment);
expose("Event", windowRef.Event);
expose("MouseEvent", windowRef.MouseEvent);
expose("getComputedStyle", windowRef.getComputedStyle.bind(windowRef));
expose("location", windowRef.location);
expose("history", windowRef.history);
expose("IS_REACT_ACT_ENVIRONMENT", true);
if (!windowRef.matchMedia) {
  windowRef.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
}
globalThis.matchMedia = windowRef.matchMedia;

class Utterance {
  text: string;
  lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const synth = {
  cancelCount: 0,
  pauseCount: 0,
  resumeCount: 0,
  current: null as Utterance | null,
  speaking: false,
  paused: false,
  pending: false,
  speak(utterance: Utterance) {
    this.current = utterance;
    this.speaking = true;
    this.paused = false;
  },
  cancel() {
    this.cancelCount += 1;
    const current = this.current;
    this.current = null;
    this.speaking = false;
    this.paused = false;
    current?.onerror?.({ error: "interrupted" });
  },
  pause() {
    this.pauseCount += 1;
    this.paused = true;
  },
  resume() {
    this.resumeCount += 1;
    this.paused = false;
  },
  getVoices() {
    return [];
  },
  start() {
    this.current?.onstart?.();
  },
  end() {
    const current = this.current;
    this.current = null;
    this.speaking = false;
    current?.onend?.();
  },
  browserCancel(error: "canceled" | "interrupted") {
    const current = this.current;
    this.current = null;
    this.speaking = false;
    this.paused = false;
    current?.onerror?.({ error });
  },
};

windowRef.speechSynthesis = synth;
globalThis.speechSynthesis = synth;
windowRef.SpeechSynthesisUtterance = Utterance;
globalThis.SpeechSynthesisUtterance = Utterance;

const podcastBodies: Array<{ symbols?: string[] }> = [];
let releaseBrief: ((response: Response) => void) | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tickers(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({ ticker: `${prefix}${index + 1}` }));
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/podcast/brief")) {
    podcastBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Promise<Response>(resolve => {
      releaseBrief = resolve;
    });
  }
  if (url.includes("/api/researcher/macro")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { region?: string };
    const region = body.region === "EU" ? "EU" : "US";
    return jsonResponse({
      candidates: region === "EU" ? tickers("EU", 3) : tickers("US", 12),
    });
  }
  return jsonResponse({ error: "n/a" });
}) as typeof fetch;

const ReactMod = await import("react");
const React = ReactMod.default;
const { useState } = ReactMod;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { BrowserSpeechControls } = await import("../client/src/components/podcast/BrowserSpeechControls");
const { createBrowserSpeechSession, browserSpeechEngine } = await import("../client/src/lib/podcast-browser-speech");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Router } = await import("wouter");

const failures: string[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.log(`  ❌ ${name}`);
    console.log(message);
    failures.push(name);
  } finally {
    document.body.replaceChildren();
  }
}

async function waitForTestId(testId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (document.querySelector(`[data-testid="${testId}"]`)) return;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
    });
  }
  throw new Error(`timeout ${testId}`);
}

function statusTexts(): string[] {
  return [...document.querySelectorAll("[data-testid='podcast-browser-status']")].map(node => node.textContent ?? "");
}

async function click(testId: string) {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  assert.ok(node, `Knopf fehlt: ${testId}`);
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function mount(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return {
    root,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

async function speechOwnership() {
  const cancelsAtRest = synth.cancelCount;
  function Harness() {
    const [second, setSecond] = useState(false);
    const [first, setFirst] = useState(true);
    return React.createElement("div", null,
      first ? React.createElement(BrowserSpeechControls, { sourceId: "A", text: "Alpha eins. Alpha zwei." }) : null,
      second ? React.createElement(BrowserSpeechControls, { sourceId: "B", text: "Beta eins." }) : null,
      React.createElement("button", { "data-testid": "mount-b", onClick: () => setSecond(true) }, "B"),
      React.createElement("button", { "data-testid": "unmount-a", onClick: () => setFirst(false) }, "weg"),
    );
  }
  const view = mount(React.createElement(Harness));
  assert.equal(synth.cancelCount, cancelsAtRest, "erster Render cancelt die globale Stimme");
  const playButtons = [...document.querySelectorAll("[data-testid='podcast-browser-play']")];
  assert.equal(playButtons.length, 1);
  await click("podcast-browser-play");
  assert.equal(synth.current?.text, "Alpha eins.");
  await act(async () => { synth.start(); });
  assert.match(statusTexts()[0] ?? "", /läuft/);

  const cancelsWhileA = synth.cancelCount;
  await click("mount-b");
  assert.equal(synth.cancelCount, cancelsWhileA, "Montage von B cancelt A");
  assert.equal(synth.current?.text, "Alpha eins.");
  assert.match(statusTexts()[0] ?? "", /läuft/);

  const bPlay = document.querySelectorAll("[data-testid='podcast-browser-play']")[1];
  assert.ok(bPlay);
  await act(async () => {
    bPlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => { synth.start(); });
  assert.equal(synth.current?.text, "Beta eins.");
  assert.doesNotMatch(statusTexts()[0] ?? "", /läuft/);
  assert.match(statusTexts()[1] ?? "", /läuft/);

  await click("unmount-a");
  assert.equal(synth.current?.text, "Beta eins.");
  assert.match(statusTexts()[0] ?? "", /läuft/);
  view.unmount();
  assert.equal(synth.current, null);
}

async function sessionCallbacks() {
  const engine = browserSpeechEngine();
  const first = createBrowserSpeechSession(engine);
  const second = createBrowserSpeechSession(browserSpeechEngine());
  first.setSource("A", "Alpha eins. Alpha zwei.");
  second.setSource("B", "Beta eins.");
  const before = synth.cancelCount;
  second.setSource("B2", "Beta zwei.");
  second.release();
  assert.equal(synth.cancelCount, before, "inaktive Session cancelt beim Quellenwechsel oder release");

  first.play();
  assert.equal(synth.current?.text, "Alpha eins.");
  synth.start();
  assert.equal(first.getState().phase, "playing");
  first.pause();
  assert.equal(first.getState().phase, "paused");
  assert.equal(synth.pauseCount, 1);
  const pauses = synth.pauseCount;
  second.pause();
  second.resume();
  assert.equal(synth.pauseCount, pauses);
  assert.equal(synth.resumeCount, 0);
  first.resume();
  assert.equal(first.getState().phase, "playing");
  assert.equal(synth.resumeCount, 1);

  synth.browserCancel("canceled");
  assert.notEqual(first.getState().phase, "playing");
  assert.equal(synth.current, null);
  assert.equal(first.getState().phase, "aborted");

  first.replay();
  synth.start();
  assert.equal(synth.current?.text, "Alpha eins.");
  first.abort();
  assert.equal(first.getState().phase, "aborted");
  synth.end();
  synth.browserCancel("interrupted");
  assert.equal(first.getState().phase, "aborted");
  assert.notEqual(synth.current?.text, "Alpha zwei.");

  const bare = browserSpeechEngine();
  const unsupportedWindow = windowRef;
  delete unsupportedWindow.speechSynthesis;
  delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  const missing = createBrowserSpeechSession(browserSpeechEngine());
  missing.setSource("A", "Text da.");
  missing.play();
  assert.equal(missing.getState().phase, "error");
  assert.match(missing.getState().detail, /Web Speech/);
  unsupportedWindow.speechSynthesis = synth;
  globalThis.speechSynthesis = synth;
  void bare;
}

async function researcherLateResponse() {
  const ResearcherMod = await import("../client/src/pages/Researcher");
  const Researcher = ResearcherMod.default;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, cacheTime: 0 },
      mutations: { retry: false, gcTime: 0, cacheTime: 0 },
    },
  });
  const here = () => ["/researcher", () => undefined];
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client },
      React.createElement(Router, { hook: here }, React.createElement(Researcher))));
  });
  await click("button-run-analysis");
  await waitForTestId("button-refresh-analysis");
  await click("button-region-EU");
  await waitForTestId("button-run-analysis");
  await click("button-run-analysis");
  await waitForTestId("button-refresh-analysis");

  await click("button-podcast");
  assert.ok(releaseBrief, "Podcast-Transport hängt");
  const symbols = podcastBodies.at(-1)?.symbols ?? [];
  console.log("  Quellen der Anfrage:", symbols.join(","));
  assert.equal(symbols.length, 12);
  assert.equal(symbols.includes("EU1"), false);
  assert.equal(symbols[0], "US1");

  await click("button-tab-sectors");
  const resolve = releaseBrief;
  releaseBrief = null;
  await act(async () => {
    resolve(jsonResponse({
      drivers: [],
      gaps: [],
      notes: [],
      script: {
        title: "Alt",
        hook: "",
        thesis: "",
        takeaways: [],
        problem: "",
        implication: "",
        close: "Dies ist keine Anlageberatung. KI-generiert im Research-Stil.",
        spokenScript: "Spaete Antwort der vorherigen Ansicht.",
        citations: [],
      },
      scriptStatus: "ok",
      audio: { status: "n/a", reason: "n/a — keine Audiodatei", audioUrl: null },
      progress: [],
      modelUsed: null,
    }));
    await Promise.resolve();
  });
  assert.equal((document.body.textContent ?? "").includes("Spaete Antwort der vorherigen Ansicht."), false);
  await act(async () => root.unmount());
  client.clear();
  host.remove();
}

console.log("gemeinsame Browser-Stimme");
await check("Montage, Play und Unmount teilen sich die Stimme nicht ungefragt", speechOwnership);
console.log("Adapter-Callbacks");
await check("Pause, Resume, Stop, Replay, canceled und fehlende Stimme", sessionCallbacks);
console.log("Researcher-Ansicht");
await check("Ansichtswechsel verwirft eine späte Antwort, obwohl der Symbolschlüssel gleich bleibt", researcherLateResponse);

windowRef.close();
if (failures.length) {
  console.log(`podcast lifecycle: ${failures.length} fehlgeschlagen: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("podcast lifecycle: ok");
