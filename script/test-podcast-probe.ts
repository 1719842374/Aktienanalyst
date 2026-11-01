/**
 * Podcast-Probe: generisches Ranking, Prompt im Researcher-Stil, Audio-Adapter.
 * Kein Netz, kein OpenRouter, kein Score.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-podcast-probe.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PODCAST_DRIVER_PARAMS, changeScaleFromSeries, rankPodcastDrivers, type PodcastSeriesInput } from "../server/podcast-drivers";
import { PODCAST_STRUCTURE, podcastStructurePrinciples } from "../server/podcast-structure";
import { buildPodcastPrompt, podcastScriptFromLlm } from "../server/podcast-prompt";
import { CURSOR_VOICE_AUDIO_REASON, CursorVoiceAudioAdapter } from "../server/podcast-audio";
import { EARNINGS_BRIEF_UNAVAILABLE, collectPodcastInputs } from "../server/podcast-sources";
import { runPodcastProbe } from "../server/podcast-pipeline";
import { callPodcastLlm } from "../server/podcast-route";
import { PodcastProbePanel } from "../client/src/components/researcher/PodcastProbePanel";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function series(partial: Partial<PodcastSeriesInput> & Pick<PodcastSeriesInput, "id" | "points">): PodcastSeriesInput {
  return {
    label: partial.label ?? partial.id,
    source: partial.source ?? `FRED ${partial.id}`,
    channels: partial.channels ?? ["fred"],
    unit: partial.unit ?? "%",
    citation: partial.citation ?? `https://fred.stlouisfed.org/series/${partial.id}`,
    ...partial,
  };
}

function ramp(id: string, last: number, nPoints = 24, step = 0.01): PodcastSeriesInput {
  const points = Array.from({ length: nPoints }, (_, i) => ({
    date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    value: i === nPoints - 1 ? last : 1 + i * step,
  }));
  points.sort((a, b) => a.date.localeCompare(b.date));
  return series({ id, points, label: id });
}

async function main() {
  const quiet = ramp("QUIET", 1.2);
  const spike = ramp("SPIKE", 9);
  const ranked = rankPodcastDrivers([quiet, spike]);
  assert.equal(ranked.drivers[0]?.id, "SPIKE");
  assert.ok((ranked.drivers[0]?.relevance ?? 0) > (ranked.drivers[1]?.relevance ?? 0));
  assert.equal(ranked.drivers.some(d => d.value === 0 && d.id === "SPIKE"), false);
  ok("Ausreißer steht vor einer ruhigen Reihe, Wert ist der letzte Punkt");

  const flat = series({
    id: "FLAT",
    points: [
      { date: "2024-01-01", value: 3 },
      { date: "2024-02-01", value: 3 },
      { date: "2024-03-01", value: 3 },
      { date: "2024-04-01", value: 3 },
    ],
  });
  const flatRank = rankPodcastDrivers([flat]);
  assert.equal(flatRank.drivers.length, 0);
  assert.match(flatRank.skipped[0]?.status ?? "", /^n\/a —/);
  assert.equal(flatRank.skipped[0]?.status.includes("0"), false);
  ok("flache Reihe ist n/a, nicht Relevanz 0");

  const one = series({ id: "ONE", points: [{ date: "2024-06-01", value: 4.2 }] });
  const short = rankPodcastDrivers([one]);
  assert.equal(short.drivers.length, 0);
  assert.match(short.skipped[0]?.status ?? "", /n\/a —/);
  assert.match(short.skipped[0]?.status ?? "", /4\.2|Historie/);
  ok("ein Punkt wird nicht als Treiber mit Wert 0 geführt");

  const zeroBase = series({
    id: "ZERO",
    points: [
      { date: "2024-01-01", value: 1 },
      { date: "2024-02-01", value: 1.1 },
      { date: "2024-03-01", value: 1.2 },
      { date: "2024-04-01", value: 1.4 },
      { date: "2024-05-01", value: 1.1 },
      { date: "2024-06-01", value: 1.3 },
      { date: "2024-07-01", value: 0 },
      { date: "2024-08-01", value: 5 },
    ],
  });
  const zeroRank = rankPodcastDrivers([zeroBase]);
  assert.equal(zeroRank.drivers[0]?.components.changeRate, null);
  assert.match(zeroRank.drivers[0]?.reason ?? "", /Änderungsrate n\/a/);
  ok("Vorwert 0 lässt die Änderungsrate aus, statt sie auf 0 zu setzen");

  const weightsOff = rankPodcastDrivers([quiet, spike], {
    ...PODCAST_DRIVER_PARAMS,
    weights: { zScore: 0, percentileDeviation: 0, changeRate: 1 },
  });
  assert.equal(weightsOff.drivers.length > 0, true);
  assert.equal("weights" in PODCAST_DRIVER_PARAMS, false);
  assert.equal("maxDrivers" in PODCAST_DRIVER_PARAMS, false);
  assert.equal("changeScale" in PODCAST_DRIVER_PARAMS, false);
  const loud = series({
    id: "LOUD",
    points: Array.from({ length: 12 }, (_, i) => ({
      date: `2023-${String(i + 1).padStart(2, "0")}-15`,
      value: i === 11 ? 50 : 1 + (i % 3) * 0.05,
    })),
  });
  const mild = (id: string, bump: number) => series({
    id,
    points: Array.from({ length: 12 }, (_, i) => ({
      date: `2023-${String(i + 1).padStart(2, "0")}-15`,
      value: i === 11 ? 1.2 + bump : 1 + (i % 3) * 0.2,
    })),
  });
  const elbow = rankPodcastDrivers([loud, mild("M1", 0.01), mild("M2", 0.02), mild("M3", 0.03)]);
  assert.equal(elbow.drivers[0]?.id, "LOUD");
  assert.ok(elbow.drivers.length < 4);
  assert.match(elbow.skipped.map(item => item.status).join(" "), /Ellbogen|Median/);
  const quietScale = changeScaleFromSeries([1, 1.01, 1.02, 1.03, 1.2]);
  const wildScale = changeScaleFromSeries([1, 1.4, 0.8, 1.5, 1.2]);
  assert.ok(quietScale.scale != null && wildScale.scale != null && quietScale.scale < wildScale.scale);
  ok("Gewichte und changeScale kommen aus der Reihe, die Treiberzahl aus dem Ellbogen");

  const collected = await collectPodcastInputs({
    fredCsv: async (id) => {
      if (id === "T10Y2Y") {
        const rows = ["date,value", ...Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}-01,${i === 11 ? 2.5 : 0.2}`)];
        return rows.join("\n");
      }
      return "date,value\n";
    },
    macroIndicators: async () => ([
      { category: "Interest Rate", latestValue: "4.5", previousValue: "4.4", date: "2026-09-01", unit: "%", source: "FRED FEDFUNDS" },
    ]),
    goldQuarters: async () => ([
      { periodEnd: "2024-03-31", aisc: 1200 },
      { periodEnd: "2024-06-30", aisc: 1210 },
      { periodEnd: "2024-09-30", aisc: 1400 },
    ]),
    sectorBars: async (etf) => (
      etf === "XLK"
        ? Array.from({ length: 10 }, (_, i) => ({ date: `2024-${String(i + 1).padStart(2, "0")}-15`, value: i === 9 ? 300 : 100 + i }))
        : []
    ),
    news: async () => [{ title: "Gold hält sich", source: "Handelsblatt", url: "https://example.test/gold" }],
    researcherFiles: async () => [],
    earningsBrief: async () => null,
  });
  assert.ok(collected.series.some(s => s.id === "T10Y2Y" && s.channels.includes("recession")));
  assert.ok(collected.series.some(s => s.channels.includes("gold")));
  assert.ok(collected.series.some(s => s.channels.includes("sector-rotation") && s.id === "XLK"));
  assert.ok(collected.notes.some(note => note.text.includes("Gold hält sich")));
  assert.ok(collected.gaps.some(g => g.status === EARNINGS_BRIEF_UNAVAILABLE));
  assert.equal(collected.gaps.some(g => g.status === "0" || g.value === 0), false);
  const emptyEtf = collected.gaps.find(g => g.label.includes("XLF") || g.status.includes("XLF"));
  assert.ok(emptyEtf);
  assert.match(emptyEtf.status, /^n\/a —/);
  ok("Sammler übernimmt vorhandene Kataloge, Earnings-Brief und leere ETF bleiben n/a");

  const rankedCollected = rankPodcastDrivers(collected.series);
  const prompt = buildPodcastPrompt({
    today: "2026-11-01",
    drivers: rankedCollected.drivers,
    gaps: [...collected.gaps, ...rankedCollected.skipped],
    notes: collected.notes,
  });
  assert.match(prompt, /JSON:/);
  assert.match(prompt, /n\/a/);
  assert.match(prompt, /FRED T10Y2Y|T10Y2Y/);
  assert.match(prompt, /Quelle/);
  for (const line of podcastStructurePrinciples()) assert.ok(prompt.includes(line), line);
  assert.equal(prompt.includes("Anthropic S-1"), false);
  assert.equal(prompt.includes("David Solomon"), false);
  assert.equal(PODCAST_STRUCTURE[0]?.title.includes("Anthropic"), true);
  assert.equal(PODCAST_STRUCTURE[1]?.title.includes("David Solomon"), true);
  ok("Prompt zitiert nur gelieferte Quellen und die abgeleitete Struktur, nicht die Episodenthemen");

  const parsed = podcastScriptFromLlm({
    title: "Zinsdifferenz",
    hook: "Die Spanne ist ungewöhnlich.",
    thesis: "Der Markt preist eine Verschiebung.",
    takeaways: [{ driverId: "T10Y2Y", text: "Die Kurve liegt über der eigenen Historie. Quelle: FRED T10Y2Y." }],
    problem: "Die Historie anderer Reihen fehlt.",
    implication: "Das verändert die Einordnung, ohne eine Empfehlung zu sein.",
    close: "Dies ist keine Anlageberatung. KI-generiert im Research-Stil.",
    spokenScript: "Die Spanne ist ungewöhnlich. Das ist keine Anlageberatung.",
    citations: [{ source: "FRED T10Y2Y", used: "letzter Wert" }],
  });
  assert.equal(parsed.status, "ok");
  assert.match(parsed.script?.spokenScript ?? "", /keine Anlageberatung/);
  const missing = podcastScriptFromLlm(null);
  assert.equal(missing.status, "n/a");
  assert.match(missing.reason, /^n\/a —/);
  ok("Skript-JSON folgt dem Schema; ohne LLM bleibt n/a");

  const audio = await new CursorVoiceAudioAdapter().synthesize("Hallo");
  assert.equal(audio.status, "n/a");
  assert.equal(audio.audioUrl, null);
  assert.equal(audio.reason, CURSOR_VOICE_AUDIO_REASON);
  assert.match(audio.reason, /n\/a —/);
  assert.match(audio.reason, /Sprachausgabe/);
  ok("Cursor Voice bleibt ein Adapter ohne erfundene API");

  let sawAbort = false;
  const timed = await callPodcastLlm("Skript", {
    timeoutMs: 40,
    invoke: (opts) => new Promise(resolve => {
      opts.signal.addEventListener("abort", () => {
        sawAbort = true;
        resolve(null);
      });
    }),
  });
  assert.equal(sawAbort, true);
  assert.match(timed?.modelUsed ?? "", /^n\/a — OpenRouter-Timeout/);
  const fast = await callPodcastLlm("Skript", {
    timeoutMs: 500,
    invoke: async () => ({ data: { title: "ok" }, modelUsed: "mock" }),
  });
  assert.equal(fast?.modelUsed, "mock");
  ok("OpenRouter-Call bricht über AbortController ab, danach n/a");

  const pinPath = new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url);
  const before = JSON.parse(readFileSync(pinPath, "utf8")).expectOldHead;
  const beforePins = {
    VWAGY: Number(before.VWAGY.overallScore).toFixed(6),
    SAP: Number(before.SAP.overallScore).toFixed(6),
    MSFT: Number(before.MSFT.overallScore).toFixed(6),
  };
  const probe = await runPodcastProbe({
    collect: async () => collected,
    llm: async () => ({ data: parsed.script, modelUsed: "mock" }),
    audio: new CursorVoiceAudioAdapter(),
    today: "2026-11-01",
  });
  const after = JSON.parse(readFileSync(pinPath, "utf8")).expectOldHead;
  assert.equal(beforePins.VWAGY, "4.735718");
  assert.equal(beforePins.SAP, "5.174758");
  assert.equal(beforePins.MSFT, "4.058138");
  assert.equal(Number(after.VWAGY.overallScore).toFixed(6), beforePins.VWAGY);
  assert.equal(Number(after.SAP.overallScore).toFixed(6), beforePins.SAP);
  assert.equal(Number(after.MSFT.overallScore).toFixed(6), beforePins.MSFT);
  assert.equal(probe.audio.status, "n/a");
  assert.equal(probe.script?.title, "Zinsdifferenz");
  assert.ok(probe.drivers.length > 0);
  assert.ok(probe.progress.every(step => step.step && step.status));
  ok("Pins VOW3/SAP/MSFT vorher und nachher unverändert, Probe liefert Treiber und Skript");

  const noLlm = await runPodcastProbe({
    collect: async () => collected,
    llm: async () => null,
    audio: new CursorVoiceAudioAdapter(),
    today: "2026-11-01",
  });
  assert.match(noLlm.scriptStatus, /^n\/a —/);
  assert.equal(noLlm.script, null);
  assert.ok(noLlm.drivers.length > 0);
  ok("ohne OpenRouter bleiben die Treiber, das Skript ist n/a");

  const sources = [
    "server/podcast-drivers.ts",
    "server/podcast-sources.ts",
    "server/podcast-pipeline.ts",
    "server/podcast-route.ts",
    "server/podcast-prompt.ts",
    "server/podcast-audio.ts",
  ].map(file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(sources, /analyze-route|overallScore|applyBiasFix|finalScore/);
  ok("Podcast-Module importieren weder Analyse-Route noch Score");

  const long = "Wort ".repeat(80);
  for (const [vw] of [[375], [1440]] as const) {
    const html = renderToStaticMarkup(React.createElement(PodcastProbePanel, {
      viewportWidth: vw,
      state: {
        phase: "done",
        result: {
          ...probe,
          drivers: probe.drivers.map(d => ({ ...d, label: long, reason: long })),
          script: probe.script ? { ...probe.script, spokenScript: long } : null,
        },
      },
    }));
    assert.ok(html.includes('data-testid="podcast-probe"'), String(vw));
    assert.ok(html.includes("break-words"));
    assert.ok(html.includes("overflow-x-hidden"));
    assert.ok(html.includes(probe.drivers[0]!.source));
    assert.ok(html.includes("n/a —"));
    assert.equal(html.includes("whitespace-nowrap"), false);
    ok(`Panel bricht bei ${vw}px um und zeigt Quelle, Grund und n/a`);
  }

  console.log(`podcast probe: ${n} checks ok`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
