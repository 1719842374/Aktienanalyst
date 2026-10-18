/**
 * #258 Tester-FAILs 3 und 5 (dod-258/REPORT.md).
 *
 * FAIL 3: Alle Peers entfernt → API liefert peerComparison: null. Section7 muss
 *   PeerComparison trotzdem rendern (Eingabe + „Standard wiederherstellen“), und Reset
 *   muss {add:[],remove:[]} auslösen. Geprüft über den Section7-Renderpfad (SSR +
 *   flacher Klick-Renderer), nicht nur die Komponente allein.
 * FAIL 5: Add-Liste hart auf 8 (auch nicht übernommene Ticker), localStorage beim Laden
 *   auf 8 säubern, 400 auf Overrides → verwerfen + neu laden statt Dauer-„Invalid request“.
 *   400-Shape gegen den echten analyzeRequestSchema geprüft.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-override-limits.ts
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeRequestSchema } from "../shared/schema";
import { analyzePostBody, readOverrides, writeOverrides, type KeyValueStore } from "../shared/peer-override-persist";
import {
  MAX_PEER_OVERRIDE_ENTRIES, addListFull, clampPeerOverrides, discardRejectedOverrides,
  isPeerOverrideRejection, removeListFull, sameOverrides,
  PEER_RESET_NOTICE_TEXT, peerResetNoticeAfterSuccess, peerResetNoticeFor, type PeerResetNotice,
} from "../client/src/lib/peerOverrideLimits";
import { Section7 } from "../client/src/components/sections/Section7";

(globalThis as any).React = React;

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

// ── Flacher Renderer: expandiert Funktionskomponenten mit Default-Hook-Werten, damit
//    onClick-Handler im Section7-Baum aufrufbar sind (kein DOM nötig).
const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
const fakeDispatcher = {
  useState: (init: any) => [typeof init === "function" ? init() : init, () => {}],
  useReducer: (_r: any, init: any, f?: any) => [f ? f(init) : init, () => {}],
  useRef: (init: any) => ({ current: init }),
  useMemo: (fn: () => any) => fn(),
  useCallback: (fn: any) => fn,
  useEffect: () => {}, useLayoutEffect: () => {}, useInsertionEffect: () => {},
  useContext: (ctx: any) => ctx?._currentValue,
  useId: () => "id", useTransition: () => [false, (f: any) => f()], useDeferredValue: (v: any) => v,
  useSyncExternalStore: (_s: any, get: () => any) => get(), useDebugValue: () => {}, useImperativeHandle: () => {},
};
type Node = any;
function expand(node: Node): Node {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const { type, props } = node;
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      const inst = new type(props); return expand(inst.render());
    }
    const prev = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = fakeDispatcher;
    try { return expand(type(props)); } finally { internals.ReactCurrentDispatcher.current = prev; }
  }
  if (type && typeof type === "object") {
    const tag = String(type.$$typeof);
    if (tag.includes("forward_ref")) return expand(type.render(props, null));
    if (tag.includes("memo")) return expand({ ...node, type: type.type });
    return { ...node, props: { ...props, children: expand(props?.children) } };
  }
  return { ...node, props: { ...props, children: expand(props?.children) } };
}
function findByTestId(node: Node, id: string): Node | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findByTestId(n, id); if (r) return r; } return null; }
  if (node.props?.["data-testid"] === id) return node;
  return findByTestId(node.props?.children, id);
}

async function main() {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8"));
  const allRemoved = ["AMGN", "AZN", "BMY", "GILD", "JNJ", "LLY", "MRK", "PFE"];

  console.log("FAIL 3 — alle Peers entfernt, Section7-Renderpfad");
  // Prod-Antwort laut REPORT: peerComparison null, peerSet.peerCount 0, Banner, remove=8
  const removedData = {
    ...fixture, ticker: "NVO",
    peerComparison: null,
    peerSet: { ...(fixture.peerSet ?? {}), peerCount: 0, banner: "Peer-Set unvollständig — Relativ nicht score-wirksam" },
    activePeerOverrides: { add: [], remove: allRemoved },
  };
  const calls: any[] = [];
  const onPeerOverridesChange = (o: any) => calls.push(o);
  const html = renderToStaticMarkup(React.createElement(Section7 as any, { data: removedData, onPeerOverridesChange }));
  check("Section7: Banner sichtbar", html.includes('data-testid="peer-set-incomplete-banner"'));
  check("Section7: Eingabefeld sichtbar (peerComparison null)", html.includes('data-testid="input-peer-add"'));
  check("Section7: „Standard wiederherstellen“ sichtbar", html.includes('data-testid="button-peer-reset"') && html.includes("Standard wiederherstellen"));
  check("Section7: Reset aktiv (remove=8 aktiv)", !/disabled=""[^>]*data-testid="button-peer-reset"/.test(html));
  check("Section7: Empty-State-Hinweis sichtbar", html.includes('data-testid="peer-empty-note"'));

  const tree = expand(React.createElement(Section7 as any, { data: removedData, onPeerOverridesChange }));
  const resetBtn = findByTestId(tree, "button-peer-reset");
  check("Klickpfad: Reset-Button im Section7-Baum gefunden", !!resetBtn && typeof resetBtn.props.onClick === "function");
  resetBtn?.props.onClick();
  check("Klickpfad: Reset löst {add:[],remove:[]} aus", JSON.stringify(calls) === JSON.stringify([{ add: [], remove: [] }]), JSON.stringify(calls));
  const resetBody = analyzePostBody({ ticker: "NVO", useLLM: false, force: true, peerOverrides: calls[0] });
  check("Reset-Body ohne peerOverrides (Standard-Peers, Cache-Key ohne Suffix)", !("peerOverrides" in resetBody));
  const store = new MemoryStore();
  writeOverrides(store, "NVO", { add: [], remove: allRemoved });
  writeOverrides(store, "NVO", calls[0]);
  check("Reset leert localStorage (Reload bleibt Standard)", JSON.stringify(readOverrides(store, "NVO")) === JSON.stringify({ add: [], remove: [] }));

  const nullNoBanner = { ...fixture, ticker: "NVO", peerComparison: null, peerSet: undefined, activePeerOverrides: { add: [], remove: [] } };
  const html2 = renderToStaticMarkup(React.createElement(Section7 as any, { data: nullNoBanner, onPeerOverridesChange }));
  check("Section7: peerComparison null ohne Banner/Overrides → Eingabe trotzdem da", html2.includes('data-testid="input-peer-add"'));
  const zeroPeers = { ...fixture, ticker: "NVO", peerComparison: { ...fixture.peerComparison, peers: [] }, activePeerOverrides: { add: ["XXXX1"], remove: [] } };
  const html3 = renderToStaticMarkup(React.createElement(Section7 as any, { data: zeroPeers, onPeerOverridesChange }));
  check("Section7: 0 Peers → Eingabe, Reset, „XXXX1 nicht übernommen“", html3.includes('data-testid="input-peer-add"') && html3.includes("Standard wiederherstellen") && html3.includes("XXXX1 nicht übernommen"));
  const html4 = renderToStaticMarkup(React.createElement(Section7 as any, { data: fixture }));
  check("Section7 ohne Callback: keine Steuerung (unverändert)", !html4.includes('data-testid="input-peer-add"'));
  const html5 = renderToStaticMarkup(React.createElement(Section7 as any, { data: fixture, onPeerOverridesChange }));
  check("Section7 mit Peers: Tabelle + Steuerung wie bisher", html5.includes('data-testid="peer-scored-table"') && html5.includes('data-testid="input-peer-add"'));

  console.log("\nFAIL 5 — Deckel 8 auf der Add-Liste");
  const nineAdds = ["XXXX1", "XXXX2", "XXXX3", "XXXX4", "XXXX5", "XXXX6", "XXXX7", "ZTS", "XXXX8"];
  // 400-Shape mit dem echten Schema: 9 Adds → fieldErrors.peerOverrides
  const parsed9 = analyzeRequestSchema.safeParse({ ticker: "NVO", force: true, peerOverrides: { add: nineAdds, remove: [] } });
  const flat = parsed9.success ? null : parsed9.error.flatten();
  check("Server-Schema lehnt 9 Adds ab (400-Shape fieldErrors.peerOverrides)", !parsed9.success && !!flat?.fieldErrors?.peerOverrides?.some((m: string) => m.includes("at most 8")), JSON.stringify(flat));
  const clamped = clampPeerOverrides({ add: nineAdds, remove: [] });
  check("clamp: 9 → 8 Adds", clamped.add.length === MAX_PEER_OVERRIDE_ENTRIES, JSON.stringify(clamped));
  check("clamp: Ergebnis passiert das Server-Schema", analyzeRequestSchema.safeParse({ ticker: "NVO", peerOverrides: clamped }).success);
  check("clamp: auch remove auf 8", clampPeerOverrides({ add: [], remove: [...allRemoved, "ABBV", "GSK"] }).remove.length === 8);
  check("clamp: Ticker > 20 Zeichen raus (Schema .max(20))", clampPeerOverrides({ add: ["A".repeat(21), "LLY"], remove: [] }).add.join() === "LLY");
  check("clamp: dedupe/upper/sort wie Server", clampPeerOverrides({ add: ["lly ", "LLY", "abt"], remove: [] }).add.join() === "ABT,LLY");
  check("addListFull: 7 nein, 8 ja (auch Fantasie-Ticker)", !addListFull(nineAdds.slice(0, 7)) && addListFull(nineAdds.slice(0, 8)));
  check("removeListFull: 8 voll für neuen Ticker, bekannter bleibt erlaubt", removeListFull(allRemoved, "ABBV") && !removeListFull(allRemoved, "LLY") && !removeListFull(allRemoved.slice(0, 7), "ABBV"));

  // UI: 8 Fantasie-Adds, 5 Auto-Peers sichtbar → Button gesperrt, Hinweis, einzelne Ticker entfernbar
  const autoFive = (fixture.peerComparison.peers as any[]).slice(0, 2);
  const eightFantasy = nineAdds.slice(0, 8).sort();
  const capData = { ...fixture, ticker: "NVO", activePeerOverrides: { add: eightFantasy, remove: [] } };
  const capHtml = renderToStaticMarkup(React.createElement(Section7 as any, { data: capData, onPeerOverridesChange }));
  check("UI: 8 Adds (keiner übernommen) → „Max. 8 Hinzufügungen erreicht“", capHtml.includes('data-testid="peer-add-cap-reached"'), String(autoFive.length));
  check("UI: kein „Max. 8 Peers erreicht“ (sichtbar < 8)", !capHtml.includes('data-testid="peer-cap-reached"'));
  check("UI: Add-Button gesperrt", /<button disabled=""[^>]*data-testid="button-peer-add"/.test(capHtml));
  calls.length = 0;
  const capTree = expand(React.createElement(Section7 as any, { data: capData, onPeerOverridesChange }));
  const dropBtn = findByTestId(capTree, "peer-not-adopted-drop-XXXX1");
  dropBtn?.props.onClick();
  check("UI: nicht übernommenen Ticker einzeln aus der Add-Liste nehmen", JSON.stringify(calls) === JSON.stringify([{ add: eightFantasy.filter(t => t !== "XXXX1"), remove: [] }]), JSON.stringify(calls));
  const sevenData = { ...capData, activePeerOverrides: { add: eightFantasy.slice(0, 7), remove: [] } };
  const sevenHtml = renderToStaticMarkup(React.createElement(Section7 as any, { data: sevenData, onPeerOverridesChange }));
  check("UI: 7 Adds → kein Add-Deckel", !sevenHtml.includes('data-testid="peer-add-cap-reached"'));

  console.log("\nFAIL 5 — localStorage säubern und 400-Recovery");
  const ls = new MemoryStore();
  ls.setItem("aktienanalyst.peerOverrides.v1:NVO", JSON.stringify({ add: nineAdds, remove: [] }));
  const loaded = readOverrides(ls, "NVO");
  const resolved = clampPeerOverrides(loaded);
  check("Laden: 9 gespeicherte Adds → 8 im Request", loaded.add.length === 9 && resolved.add.length === 8);
  check("Laden: geänderter Stand wird zurückgeschrieben (sameOverrides=false)", !sameOverrides(loaded, resolved));
  const body = analyzePostBody({ ticker: "NVO", useLLM: false, force: false, peerOverrides: resolved });
  check("Request-Body nach dem Laden passiert das Server-Schema", analyzeRequestSchema.safeParse(body).success);
  check("400 + Overrides → Override-Ablehnung", isPeerOverrideRejection(400, { add: ["LLY"], remove: [] }));
  check("400 ohne Overrides → keine Override-Ablehnung (kein Loop)", !isPeerOverrideRejection(400, { add: [], remove: [] }));
  check("500/502 mit Overrides → keine Override-Ablehnung (normale Retries)", !isPeerOverrideRejection(502, { add: ["LLY"], remove: [] }) && !isPeerOverrideRejection(500, { add: ["LLY"], remove: [] }));
  const after = discardRejectedOverrides(ls, "NVO");
  check("Nach 400: localStorage geleert, Neu-Lauf ohne Overrides", JSON.stringify(readOverrides(ls, "NVO")) === JSON.stringify({ add: [], remove: [] }) && !("peerOverrides" in analyzePostBody({ ticker: "NVO", useLLM: false, force: false, peerOverrides: after })));

  const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
  check("Dashboard: startAnalyze kürzt per clampPeerOverrides", dash.includes("const resolved: PeerOverrideLists = clampPeerOverrides(loaded);"));
  check("Dashboard: gesäuberte Overrides werden zurückgeschrieben", dash.includes("if (explicit || !sameOverrides(loaded, resolved)) writeOverrides(storage, args.ticker, resolved);"));
  check("Dashboard: 400 auf Overrides ohne Retries", dash.includes("if (isPeerOverrideRejection(res.status, peerOverrides))") && dash.includes("if (err?.errorCode === PEER_OVERRIDES_REJECTED) throw err;"));
  check("Dashboard: onError verwirft + lädt neu", dash.includes("discardRejectedOverrides(safeLocalStorage(), variables.ticker)") && dash.includes("startAnalyze({ ticker: variables.ticker, llm: !!variables.llm, force: false, peerOverrides: cleared, peerResetRecovery: true })"));

  console.log("\nStabschef-Follow-up — UI-Hinweis nach automatischem Verwerfen");
  // Zustandsfolge wie im Dashboard: 400 → Hinweis setzen → Recovery-Lauf ok → nächste Analyse ok
  let notice: PeerResetNotice = null;
  notice = { ticker: "NVO" }; // onError: setPeerResetNotice({ ticker })
  notice = peerResetNoticeAfterSuccess(notice, { peerResetRecovery: true });
  check("Recovery-Lauf erfolgreich → Hinweis bleibt stehen", notice?.ticker === "NVO");
  check("Hinweis nur beim betroffenen Ticker (Groß/Klein egal)", peerResetNoticeFor(notice, "nvo")?.ticker === "NVO" && peerResetNoticeFor(notice, "MSFT") === null && peerResetNoticeFor(null, "NVO") === null);
  notice = peerResetNoticeAfterSuccess(notice, { peerResetRecovery: false });
  check("nächste erfolgreiche Analyse → Hinweis verschwindet", notice === null);
  check("ohne Variablen → kein Hinweis", peerResetNoticeAfterSuccess({ ticker: "NVO" }, undefined) === null);

  const dismissed: number[] = [];
  const recovered = { ...fixture, ticker: "NVO", activePeerOverrides: { add: [], remove: [] } };
  const nHtml = renderToStaticMarkup(React.createElement(Section7 as any, { data: recovered, onPeerOverridesChange, peerResetNotice: "NVO", onDismissPeerResetNotice: () => dismissed.push(1) }));
  check("Section7: Hinweis sichtbar mit Text", nHtml.includes('data-testid="peer-reset-notice"') && nHtml.includes(PEER_RESET_NOTICE_TEXT) && nHtml.includes("NVO"));
  check("Section7: Hinweis hat Schließen-Button", nHtml.includes('data-testid="button-peer-reset-notice-dismiss"'));
  check("Section7: Hinweis steht vor dem Peer-Block (Peer-Bereich)", nHtml.indexOf('data-testid="peer-reset-notice"') < nHtml.indexOf('data-testid="input-peer-add"'));
  const hiddenBlock = { ...fixture, ticker: "NVO", peerComparison: null, peerSet: undefined, activePeerOverrides: { add: [], remove: [] } };
  const nHtml2 = renderToStaticMarkup(React.createElement(Section7 as any, { data: hiddenBlock, peerResetNotice: "NVO" }));
  check("Section7: Hinweis auch ohne sichtbaren Peer-Block", nHtml2.includes('data-testid="peer-reset-notice"') && !nHtml2.includes('data-testid="input-peer-add"'));
  const nHtml3 = renderToStaticMarkup(React.createElement(Section7 as any, { data: recovered, onPeerOverridesChange }));
  check("Section7: ohne Hinweis-Prop kein Hinweis", !nHtml3.includes('data-testid="peer-reset-notice"'));
  const nTree = expand(React.createElement(Section7 as any, { data: recovered, onPeerOverridesChange, peerResetNotice: "NVO", onDismissPeerResetNotice: () => dismissed.push(1) }));
  findByTestId(nTree, "button-peer-reset-notice-dismiss")?.props.onClick();
  check("Klickpfad: Schließen ruft onDismiss", dismissed.length === 1);
  check("Dashboard: Verwerfen setzt Hinweis", /setPeerResetNotice\(\{ ticker: variables\.ticker \}\);\s*startAnalyze\(/.test(dash));
  check("Dashboard: onSuccess räumt Hinweis per peerResetNoticeAfterSuccess", dash.includes("setPeerResetNotice((cur) => peerResetNoticeAfterSuccess(cur, variables));"));
  check("Dashboard: Recovery-Flag geht bis in die Mutation-Variablen", dash.includes("reqId, peerResetRecovery: args.peerResetRecovery })"));
  check("Dashboard: Section7 bekommt Hinweis + Dismiss", dash.includes("peerResetNotice={peerResetNoticeFor(peerResetNotice, data.ticker)?.ticker ?? null} onDismissPeerResetNotice={() => setPeerResetNotice(null)}"));

  console.log(failed === 0 ? "\n✅ Alle Peer-Override-Limit-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(err => { console.error(err); process.exit(1); });
