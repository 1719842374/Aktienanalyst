/**
 * Live-Beweis mit echten Daten, ohne Mocks: GuV-Posten (MSFT, AAPL, SAP.DE) und letzter
 * Earnings Call bzw. Earnings Release (RL, MSFT, SAP.DE) im KI-Chat.
 *
 * Kette wie in der UI:
 *   useIncomeStatementBrief / useEarningsBrief (apiRequest GET)
 *   → registerChatIncomeRoute / registerChatEarningsRoute (Standard-Deps, kein Override)
 *   → SEC EDGAR (companyfacts/XBRL, submissions, Filing-Dokument, 8-K/6-K Exhibit 99.1), FMP wenn Key da
 *   → withIncomeStatementFacts (S4) / withEarningsBriefFacts (S3) → enrichChatContext
 *   → validateChatRequest → buildChatPrompt → handleChat (echtes OpenRouter-LLM, wenn Key da)
 *
 * Der Kontext-Rahmen ist die MSFT-Analyse-Fixture (script/fixtures/analysis-MSFT.json) mit
 * getauschtem Ticker; geprüft werden nur die neuen S3/S4-Fakten, das Budget und der Prompt.
 * Ohne OPENROUTER_API_KEY bzw. FMP_API_KEY werden diese Teile ausdrücklich als SKIP gemeldet.
 *
 * Ausführen: npx tsx script/test-chat-sec-live.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  buildStockChatContext, enrichChatContext, withEarningsBriefFacts, withIncomeStatementFacts,
  CHAT_CONTEXT_BUDGET, CHAT_INCOME_SECTION_ID, chatFactAllowedChars, type ChatContext, type ChatRequestBody,
} from "../shared/chat-context";
import type { IncomeStatementBrief } from "../shared/chat-income";
import { extractTranscriptQuotes, type EarningsCallBrief } from "../shared/chat-earnings";
import { registerChatIncomeRoute } from "../server/chat-income-route";
import { registerChatEarningsRoute } from "../server/chat-earnings-route";
import {
  buildChatPrompt, CHAT_MODEL_ENV, CHAT_SYSTEM_PROMPT, chatLlmModels, handleChat, validateChatRequest,
} from "../server/chat-route";
import { callLLMJson, isLLMAvailable } from "../server/llm-openrouter";
import { isFmpAvailable } from "../server/fmp";

const INCOME_SYMBOLS = ["MSFT", "AAPL", "SAP.DE"] as const;
const EARNINGS_SYMBOLS = ["RL", "MSFT", "SAP.DE"] as const;
/** Ein Earnings Release ist höchstens ein Quartal plus Meldefrist alt. */
const EARNINGS_MAX_AGE_DAYS = 140;
/** Summenprüfung: Rundung der Mio-Werte und nicht getaggte Kleinposten. */
const CHECK_TOLERANCE_SHARE = 0.02;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEC_ARCHIVE = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//;

let passed = 0;
const ok = (name: string) => { passed++; console.log(`  ✅ ${name}`); };
const skip = (name: string, why: string) => console.log(`  ⏭️  SKIP ${name}: ${why}`);

const fixture = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));

function shellFor(symbol: string): ChatContext {
  return buildStockChatContext({ ...fixture, ticker: symbol });
}

function requestOf(context: ChatContext, sectionId: number | null, question: string): ChatRequestBody {
  return { dashboard: context.dashboard, sectionId, context, messages: [{ role: "user", content: question }] };
}

async function getJson<T>(base: string, path: string): Promise<{ http: number; body: T }> {
  const res = await fetch(`${base}${path}`);
  return { http: res.status, body: await res.json() as T };
}

function checkIncome(symbol: string, b: IncomeStatementBrief) {
  assert.equal(b.status, "ok", `${symbol}: ${b.reason}`);
  assert.equal(b.source, "sec-edgar/companyfacts", `${symbol}: Quelle ${b.source}`);
  assert.ok(b.accession && /^\d{10}-\d{2}-\d{6}$/.test(b.accession), `${symbol}: Accession ${b.accession}`);
  assert.ok(b.filingUrl && SEC_ARCHIVE.test(b.filingUrl), `${symbol}: Filing-URL ${b.filingUrl}`);
  assert.ok(b.period && b.priorPeriod, `${symbol}: Perioden fehlen`);
  assert.ok(b.priorPeriod!.end < b.period!.end, `${symbol}: Vorjahr ${b.priorPeriod!.end} nicht vor ${b.period!.end}`);
  const withBoth = b.lines.filter(l => l.current != null && l.prior != null);
  assert.ok(withBoth.length >= 4, `${symbol}: nur ${withBoth.length} Posten mit beiden Perioden`);
  for (const l of withBoth) assert.equal(l.deltaAbs, l.current! - l.prior!, `${symbol} ${l.key}: Δ`);
  for (const c of b.checks) {
    const tol = Math.max(1, Math.abs(c.reported) * CHECK_TOLERANCE_SHARE);
    assert.ok(Math.abs(c.diff) <= tol, `${symbol} ${c.parentKey}: Differenz ${c.diff} > ${tol}`);
  }
  assert.ok(b.outliers.length >= 1, `${symbol}: kein Ausreißer`);
  for (const o of b.outliers) assert.ok(o.explanation || o.explanationReason, `${symbol} ${o.key}: weder Erklärung noch Grund`);
}

function checkIncomeContext(symbol: string, b: IncomeStatementBrief): ChatContext {
  const ctx = enrichChatContext(withIncomeStatementFacts(shellFor(symbol), b), null, { gatesSectionId: 20 });
  const s4 = ctx.sections.find(s => s.id === CHAT_INCOME_SECTION_ID)!.facts;
  assert.equal(s4.guvFilingUrl, b.filingUrl);
  assert.ok(String(s4.guvPeriode).includes(b.period!.label) && String(s4.guvPeriode).includes(b.priorPeriod!.label));
  const lineKeys = Object.keys(s4).filter(k => k.startsWith("guv_"));
  assert.ok(lineKeys.length >= 4, `${symbol}: nur ${lineKeys.length} guv_-Fakten`);
  assert.ok(Object.keys(s4).some(k => k.startsWith("guvAusreisser_")), `${symbol}: kein guvAusreisser_`);
  const guvChars = Object.entries(s4).filter(([k]) => k.startsWith("guv")).reduce((n, [k, v]) => n + k.length + String(v).length, 0);
  assert.ok(guvChars <= chatFactAllowedChars("guv"), `${symbol}: GuV-Gruppe ${guvChars} > ${chatFactAllowedChars("guv")}`);
  assert.ok(JSON.stringify(ctx).length <= CHAT_CONTEXT_BUDGET, `${symbol}: Kontext über Budget`);
  return ctx;
}

function checkEarnings(symbol: string, b: EarningsCallBrief, fmpKey: boolean) {
  assert.equal(b.status, "ok", `${symbol}: ${b.reason}`);
  assert.ok(b.date && /^\d{4}-\d{2}-\d{2}/.test(b.date), `${symbol}: Datum ${b.date}`);
  const age = (Date.now() - Date.parse(b.date!)) / DAY_MS;
  assert.ok(age >= 0 && age <= EARNINGS_MAX_AGE_DAYS, `${symbol}: Release ${b.date} ist ${Math.round(age)} Tage alt`);
  assert.ok(b.quotes && b.quotes.length >= 1, `${symbol}: keine Zitate`);
  for (const q of b.quotes!) assert.ok(/: „.+“$/.test(q), `${symbol}: Zitatform ${q.slice(0, 80)}`);
  assert.ok(b.excerpt && b.excerpt.length > 500, `${symbol}: Auszug fehlt`);
  if (b.kind === "earnings-release") {
    assert.ok(b.sourceUrl && SEC_ARCHIVE.test(b.sourceUrl), `${symbol}: Quelle-URL ${b.sourceUrl}`);
    assert.ok(/Exhibit 99\.1/.test(String(b.source)), `${symbol}: Quelle ${b.source}`);
    assert.ok(/FMP/.test(String(b.reason)), `${symbol}: FMP-Grund fehlt im Hinweis`);
    if (!fmpKey) assert.ok(/FMP_API_KEY/.test(String(b.reason)), `${symbol}: ${b.reason}`);
  } else {
    assert.equal(b.kind, "transcript");
    assert.ok(fmpKey, `${symbol}: Transkript ohne FMP-Key?`);
  }
}

function checkEarningsContext(symbol: string, b: EarningsCallBrief) {
  const ctx = enrichChatContext(withEarningsBriefFacts(shellFor(symbol), b), null, { gatesSectionId: 20 });
  const s3 = ctx.sections.find(s => s.id === 3)!.facts;
  assert.equal(s3.earningsCallDatum, b.date);
  assert.ok(String(s3.earningsCallZitate).includes(b.quotes![0].slice(0, 40)), `${symbol}: Zitat fehlt in S3`);
  assert.ok(typeof s3.earningsCallAuszug === "string" && s3.earningsCallAuszug.length > 0);
  assert.ok(typeof s3.earningsCallArt === "string");
  if (b.sourceUrl) assert.equal(s3.earningsCallQuelleUrl, b.sourceUrl);
  const chars = Object.entries(s3).filter(([k]) => k.startsWith("earningsCall")).reduce((n, [k, v]) => n + k.length + String(v).length, 0);
  assert.ok(chars <= chatFactAllowedChars("earningsCall"), `${symbol}: Earnings-Gruppe ${chars} > ${chatFactAllowedChars("earningsCall")}`);
  assert.ok(JSON.stringify(ctx).length <= CHAT_CONTEXT_BUDGET);
  const v = validateChatRequest(requestOf(ctx, 3, "Was sagte das Management im letzten Earnings Call?"));
  assert.equal(v.ok, true, v.ok ? "" : v.error);
  const prompt = buildChatPrompt(v.ok ? v.body : requestOf(ctx, 3, ""));
  assert.ok(prompt.includes("earningsCallZitate") && prompt.includes(b.date!));
}

async function main() {
  const app = express();
  registerChatIncomeRoute(app);
  registerChatEarningsRoute(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fmpKey = isFmpAvailable();
  const llmKey = isLLMAvailable();
  console.log(`FMP_API_KEY ${fmpKey ? "vorhanden" : "fehlt"}, OPENROUTER_API_KEY ${llmKey ? "vorhanden" : "fehlt"}, Chat-Modellkette ${chatLlmModels().join(" → ")} (${process.env[CHAT_MODEL_ENV]?.trim() ? CHAT_MODEL_ENV : "Code-Default"})`);

  try {
    assert.ok(/guv_/.test(CHAT_SYSTEM_PROMPT) && /guvFilingUrl/.test(CHAT_SYSTEM_PROMPT) && /guvAusreisser_/.test(CHAT_SYSTEM_PROMPT));
    assert.ok(/Vorjahr/.test(CHAT_SYSTEM_PROMPT) && /Tabelle/.test(CHAT_SYSTEM_PROMPT) && /n\/a/.test(CHAT_SYSTEM_PROMPT));
    assert.ok(/earningsCallZitate/.test(CHAT_SYSTEM_PROMPT) && /earningsCallQuelleUrl/.test(CHAT_SYSTEM_PROMPT));
    ok("System-Prompt verlangt Tabelle, Vorjahresvergleich, Ausreißer, Quelle und n/a ohne Daten");

    console.log("\nGuV-Posten (SEC EDGAR, echte Daten):");
    const msftCtx: Record<string, ChatContext> = {};
    for (const symbol of INCOME_SYMBOLS) {
      const { http, body } = await getJson<IncomeStatementBrief>(base, `/api/chat/income-statement/${encodeURIComponent(symbol)}`);
      assert.equal(http, 200);
      checkIncome(symbol, body);
      const top = body.outliers[0];
      console.log(`     ${symbol}: ${body.form} ${body.accession} ${body.period!.label} gegen ${body.priorPeriod!.label}, ${body.lines.length} Posten, ${body.filingUrl}`);
      for (const o of body.outliers) console.log(`       Ausreißer ${o.label}: Δ ${o.deltaAbs} — ${(o.explanation ?? o.explanationReason ?? "").slice(0, 160)}`);
      ok(`${symbol}: Posten mit beiden Perioden, Δ stimmt, Summenprüfung, Ausreißer ${top.label}, Link sec.gov`);
      msftCtx[symbol] = checkIncomeContext(symbol, body);
      ok(`${symbol}: guv_-Fakten, Periode, Link und Ausreißer in S4, GuV-Gruppe und Kontext im Budget`);
      if (symbol === "MSFT") {
        const other = body.outliers.find(o => o.parentKey === "sonstigesNetto");
        assert.ok(other, "MSFT: Ausreißer der sonstigen Erträge/Aufwendungen fehlt");
        assert.ok(other!.explanation, `MSFT: keine Filing-Erklärung (${other!.explanationReason})`);
        assert.ok(!/PART I|effective tax rate/i.test(other!.explanation!), `MSFT: fremder Abschnitt in der Erklärung: ${other!.explanation}`);
        const rd = body.outliers.find(o => o.key === "forschung");
        if (rd?.explanation) assert.ok(!/Months Ended/.test(rd.explanation), `MSFT: Tabellenkopf in der Erklärung: ${rd.explanation}`);
        ok(`MSFT: Ausreißer der sonstigen Erträge/Aufwendungen mit Filing-Erklärung (${other!.label})`);
      }
      if (symbol === "SAP.DE") {
        assert.ok(body.notes.some(n => /ADR/.test(n)), `SAP.DE: ADR-Hinweis fehlt (${body.notes.join(" | ")})`);
        ok(`SAP.DE: über den ADR-Filer, Hinweise: ${body.notes.join(" | ").slice(0, 160)}`);
      }
    }

    const msftPrompt = (() => {
      const v = validateChatRequest(requestOf(msftCtx.MSFT, CHAT_INCOME_SECTION_ID, "Schlüssle die sonstigen Erträge und Aufwendungen der GuV auf."));
      assert.equal(v.ok, true, v.ok ? "" : v.error);
      return v.ok ? v.body : null;
    })()!;
    const prompt = buildChatPrompt(msftPrompt);
    assert.ok(prompt.includes("guvFilingUrl") && prompt.includes("guvAusreisser_") && /sec\.gov/.test(prompt));
    ok("MSFT: Request validiert, Prompt trägt GuV-Fakten, Ausreißer und sec.gov-Link");

    const na = await getJson<IncomeStatementBrief>(base, "/api/chat/income-statement/ZZZZQ");
    assert.equal(na.body.status, "n/a");
    assert.ok(/^SEC: n\/a/.test(String(na.body.reason)), String(na.body.reason));
    const naS4 = withIncomeStatementFacts(shellFor("ZZZZQ"), na.body).sections.find(s => s.id === CHAT_INCOME_SECTION_ID)!.facts;
    assert.ok(/n\/a/.test(String(naS4.guvHinweis)) && !Object.keys(naS4).some(k => k.startsWith("guv_")));
    ok(`Unbekanntes Symbol: n/a mit Grund, keine erfundenen Posten (${String(na.body.reason).slice(0, 120)})`);

    console.log("\nLetzter Earnings Call / Release (echte Daten):");
    for (const symbol of EARNINGS_SYMBOLS) {
      const { http, body } = await getJson<EarningsCallBrief>(base, `/api/chat/earnings-brief/${encodeURIComponent(symbol)}`);
      assert.equal(http, 200);
      checkEarnings(symbol, body, fmpKey);
      console.log(`     ${symbol}: ${body.kind} ${body.date} ${body.source} ${body.sourceUrl ?? ""}`);
      for (const q of body.quotes ?? []) console.log(`       ${q.slice(0, 170)}`);
      ok(`${symbol}: ${body.kind === "transcript" ? "FMP-Transkript" : "SEC Exhibit 99.1"} vom ${body.date} mit ${body.quotes!.length} Zitat(en) und Quelle`);
      checkEarningsContext(symbol, body);
      ok(`${symbol}: Datum, Art, Zitate, Auszug, Quelle in S3, Gruppe im Budget, Prompt enthält Zitate`);
    }

    const transcript = [
      "Operator: Good afternoon and welcome to the call. Please stand by.",
      "Satya Nadella: Thank you. This quarter, Microsoft Cloud revenue surpassed a new milestone as customers scaled their AI workloads on Azure.",
      "Amy Hood: Thanks, Satya. Commercial bookings increased significantly, driven by long-term Azure commitments and strong renewal execution.",
    ].join("\n");
    const quotes = extractTranscriptQuotes(transcript);
    assert.deepEqual(quotes.map(q => q.split(":")[0]), ["Satya Nadella", "Amy Hood"]);
    assert.ok(!quotes.some(q => /Thank/.test(q)));
    ok("extractTranscriptQuotes: je Sprecher ein wörtliches Zitat, ohne Operator und Begrüßung");

    if (!fmpKey) {
      skip("FMP-Transkript-Pfad", "FMP_API_KEY fehlt in dieser Umgebung; SEC-Fallback oben ist der Beweis");
    }

    console.log("\nEchte Chat-Antwort:");
    if (!llmKey) {
      skip(`LLM-Antwort (${chatLlmModels().join(" → ")})`, "OPENROUTER_API_KEY fehlt in dieser Umgebung");
    } else {
      for (const symbol of INCOME_SYMBOLS) {
        const res = await handleChat(requestOf(msftCtx[symbol], CHAT_INCOME_SECTION_ID, "Breakdown the other expenses in the income statement."), { llmAvailable: isLLMAvailable, llm: callLLMJson });
        const answer = String(res.body.answer ?? "");
        console.log(`     ${symbol} (${res.body.model}):\n${answer.split("\n").map(l => `       ${l}`).join("\n")}`);
        assert.equal(res.body.status, "ok", `${symbol}: ${res.body.error}`);
        assert.ok(/^\s*\|.+\|\s*$/m.test(answer), `${symbol}: keine Markdown-Tabelle`);
        assert.ok(/Vorjahr/i.test(answer), `${symbol}: kein Vorjahresvergleich`);
        assert.ok(/sec\.gov/.test(answer), `${symbol}: kein sec.gov-Link`);
        ok(`${symbol}: Antwort mit Tabelle, Vorjahresvergleich und SEC-Link (${res.body.model})`);
      }
    }
  } finally {
    server.close();
  }
  console.log(`\n${passed} Prüfungen bestanden.`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
