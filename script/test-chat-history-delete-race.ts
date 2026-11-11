/**
 * Regression am produktiven Hook useChatHistory (kein Ersatzalgorithmus, kein Stringvergleich).
 * Kette: createRoot → useChatHistory → apiRequest/fetch → echte registerChatHistoryRoute.
 * Nur synthetische Thread-Ids. Kein Modell, keine Nutzerthreads, kein Live-UI-PASS.
 *
 * Fall A: GET/PUT ist serverseitig schon vor DELETE fertig, die HTTP-200-Antwort kommt später.
 * Fall B: der schon abgesendete PUT erreicht den Server erst nach erfolgreichem DELETE.
 * Er darf den gelöschten Thread serverseitig nicht wiederbeleben. Ein bewusstes
 * Speichern nach dem Löschen bleibt ein eigenes Szenario. Abort liegt in apiRequest.
 * Fall Zwei-Tab: eine andere Epoche löscht (DELETE 200). Dieser Tab schreibt danach
 * PUT und bekommt 200 {rejected:"stale-write"}. Genau dieser Thread muss aus
 * sessionStorage und State verschwinden und nach Remount wegbleiben. Andere Chats bleiben.
 *
 * react-dom/client und der Hook werden erst nach installFakeDom geladen (Fenster muss stehen).
 * Ausführen (Repo-Root):
 * npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-history-delete-race.ts
 */
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import React from "react";
import express from "express";
import { CHAT_HISTORY_THREADS_PER_SESSION, CHAT_HISTORY_TTL_MS, CHAT_SESSION_HEADER, CHAT_WRITE_EPOCH_HEADER, CHAT_WRITE_REVISION_HEADER, type ChatThread } from "../shared/chat-history";
import { CHAT_HISTORY_SESSION_CAP, CHAT_HISTORY_TOMB_CAP, chatHistoryTombCount, deleteChatThread, listChatThreads, putChatThread, registerChatHistoryRoute, resetChatHistoryStore } from "../server/chat-history-route";
import { installFakeDom } from "./lib/fake-dom";

const { doc } = installFakeDom();
(globalThis as { React?: typeof React }).React = React;

type HistoryApi = {
  sessionId: string;
  threads: ChatThread[];
  save: (thread: ChatThread) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

type HoldStage = "after-server" | "before-forward";

type Hold = {
  method: string;
  stage: HoldStage;
  urlPart?: string;
  fail?: "throw" | number;
  release: () => void;
  gate: Promise<void>;
  clientSent: Promise<void>;
  markClientSent: () => void;
  serverDone: Promise<void>;
  markServerDone: () => void;
  status: number | null;
  bodyIds: string[];
  rejected: string | null;
};

const trace: string[] = [];
const queue: Hold[] = [];
const armed: Hold[] = [];
const failures: string[] = [];
const live: Array<{ unmount: () => Promise<void> }> = [];

function note(line: string) {
  trace.push(line);
  console.log(`  · ${line}`);
}

function idsOfBody(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const body = parsed as { threads?: { id?: string }[]; thread?: { id?: string } };
  if (Array.isArray(body.threads)) return body.threads.flatMap(t => (t?.id ? [t.id] : []));
  if (body.thread?.id) return [body.thread.id];
  return [];
}

function createHold(method: string, stage: HoldStage, urlPart?: string, fail?: "throw" | number): Hold {
  let release = () => {};
  const gate = new Promise<void>(resolve => {
    release = () => resolve();
  });
  let markClientSent = () => {};
  const clientSent = new Promise<void>(resolve => {
    markClientSent = () => resolve();
  });
  let markServerDone = () => {};
  const serverDone = new Promise<void>(resolve => {
    markServerDone = () => resolve();
  });
  const hold: Hold = {
    method, stage, urlPart, fail, release, gate, clientSent, markClientSent, serverDone, markServerDone,
    status: null, bodyIds: [], rejected: null,
  };
  queue.push(hold);
  armed.push(hold);
  return hold;
}

function takeHold(method: string, url: string): Hold | undefined {
  const index = queue.findIndex(hold => hold.method === method && (hold.urlPart == null || url.includes(hold.urlPart)));
  if (index < 0) return undefined;
  return queue.splice(index, 1)[0];
}

function releaseArmed() {
  for (const hold of armed) hold.release();
  armed.length = 0;
  queue.length = 0;
}

function synth(id: string, content: string, dashboard: ChatThread["dashboard"] = "stock", entity: string | null = "SYNTH"): ChatThread {
  return {
    id,
    dashboard,
    entity,
    title: content,
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [{ role: "user", content }],
  };
}

function storedThreads(sessionId: string): ChatThread[] {
  const raw = sessionStorage.getItem(`chatThreads:v1:${sessionId}`);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as ChatThread[];
  return Array.isArray(parsed) ? parsed : [];
}

function storedIds(sessionId: string): string[] {
  return storedThreads(sessionId).map(thread => thread.id).sort();
}

function assertOrder(parts: string[]) {
  let from = 0;
  for (const part of parts) {
    const index = trace.findIndex((line, lineNo) => lineNo >= from && line.includes(part));
    assert.ok(index >= 0, `Reihenfolge fehlt: ${part}\n${trace.join("\n")}`);
    from = index + 1;
  }
}

async function main() {
  const { createRoot } = await import("react-dom/client");
  const { useChatHistory } = await import("../client/src/hooks/useChatHistory.ts");
  const act = (React as { act?: (cb: () => Promise<void>) => Promise<void> }).act;
  if (!act) throw new Error("React.act fehlt");

  const realFetch = globalThis.fetch.bind(globalThis);
  const app = express();
  app.use(express.json());
  registerChatHistoryRoute(app);
  const srv: Server = await new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const port = (srv.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("/api/chat/history")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const hold = takeHold(method, url);
    const session = new Headers(init?.headers).get(CHAT_SESSION_HEADER);
    note(`client-sent ${method} ${url} session=${session ?? ""}`);
    hold?.markClientSent();
    if (hold?.fail === "throw") {
      note(`client-error ${method} synthetic-network`);
      throw new Error("synthetic-network");
    }
    if (typeof hold?.fail === "number") {
      hold.status = hold.fail;
      hold.markServerDone();
      note(`deliver-response ${method} status=${hold.fail} body=`);
      return new Response(JSON.stringify({ error: "synthetic" }), {
        status: hold.fail,
        headers: { "content-type": "application/json" },
      });
    }
    if (hold?.stage === "before-forward") {
      note(`hold-before-forward ${method} ${url}`);
      await hold.gate;
      note(`forward-after-hold ${method} ${url}`);
    }
    const res = await realFetch(`${base}${url}`, init);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    let bodyIds: string[] = [];
    let rejected: string | null = null;
    try {
      const parsed = JSON.parse(text) as { rejected?: unknown };
      bodyIds = idsOfBody(parsed);
      rejected = typeof parsed.rejected === "string" ? parsed.rejected : null;
    } catch {
      bodyIds = [];
      rejected = null;
    }
    if (hold) {
      hold.status = res.status;
      hold.bodyIds = bodyIds;
      hold.rejected = rejected;
      hold.markServerDone();
    }
    note(`server-finished ${method} status=${res.status} body=${bodyIds.join(",")} rejected=${rejected ?? ""}`);
    if (hold?.stage === "after-server") {
      note(`hold-after-server ${method} ${url}`);
      await hold.gate;
    }
    note(`deliver-response ${method} status=${res.status} body=${bodyIds.join(",")}`);
    return new Response(buf, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  }) as typeof fetch;

  function Probe({ dashboard, entity, bag }: { dashboard: string; entity: string | null; bag: { api: HistoryApi | null } }) {
    const api = useChatHistory(dashboard, entity);
    bag.api = api;
    return React.createElement("span", { "data-testid": "thread-ids" }, api.threads.map(thread => thread.id).sort().join(","));
  }

  function begin(sessionId: string) {
    resetChatHistoryStore();
    sessionStorage.clear();
    sessionStorage.setItem("chatSession:v1", sessionId);
    trace.length = 0;
  }

  function apiOf(bag: { api: HistoryApi | null }): HistoryApi {
    if (!bag.api) throw new Error("Hook nicht gemountet");
    return bag.api;
  }

  function localIds(bag: { api: HistoryApi | null }): string[] {
    return apiOf(bag).threads.map(thread => thread.id).sort();
  }

  async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }

  async function settle(pred: () => boolean) {
    for (let i = 0; i < 40; i++) {
      if (pred()) {
        await flush();
        return;
      }
      await flush();
    }
    throw new Error(`Timeout\n${trace.join("\n")}`);
  }

  async function mount(dashboard = "stock", entity: string | null = "SYNTH") {
    const bag: { api: HistoryApi | null } = { api: null };
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(React.createElement(Probe, { dashboard, entity, bag })); });
    const mounted = {
      bag,
      async unmount() {
        await act(async () => { root.unmount(); });
        container.parentNode?.removeChild(container);
      },
    };
    live.push(mounted);
    return mounted;
  }

  async function serverIds(sessionId: string, dashboard = "stock", entity = "SYNTH"): Promise<string[]> {
    const params = new URLSearchParams({ dashboard });
    if (entity) params.set("entity", entity);
    const res = await realFetch(`${base}/api/chat/history?${params}`, { headers: { [CHAT_SESSION_HEADER]: sessionId } });
    const body = await res.json() as { threads?: { id: string }[] };
    return (body.threads ?? []).map(thread => thread.id).sort();
  }

  async function observe(label: string, sessionId: string): Promise<string[]> {
    const ids = await serverIds(sessionId);
    note(`observe-server ${label} ids=${ids.join(",")}`);
    return ids;
  }

  async function revisionWrite(method: "PUT" | "DELETE", sessionId: string, id: string, epoch: string, revision: number, content = "synthetic-revision"): Promise<{ status: number; body: { ok?: boolean; thread?: { id?: string } } }> {
    const headers: Record<string, string> = {
      [CHAT_SESSION_HEADER]: sessionId,
      [CHAT_WRITE_REVISION_HEADER]: String(revision),
      [CHAT_WRITE_EPOCH_HEADER]: epoch,
    };
    if (method === "PUT") headers["content-type"] = "application/json";
    const res = await realFetch(`${base}/api/chat/history/${id}`, {
      method,
      headers,
      body: method === "PUT" ? JSON.stringify({ dashboard: "stock", entity: "SYNTH", messages: [{ role: "user", content }] }) : undefined,
    });
    return { status: res.status, body: await res.json() as { ok?: boolean; thread?: { id?: string } } };
  }

  async function seed(sessionId: string, thread: ChatThread): Promise<ChatThread> {
    const res = await realFetch(`${base}/api/chat/history/${thread.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", [CHAT_SESSION_HEADER]: sessionId },
      body: JSON.stringify({ dashboard: thread.dashboard, entity: thread.entity, messages: thread.messages }),
    });
    assert.equal(res.status, 200, `Seed ${thread.id}`);
    const body = await res.json() as { thread: ChatThread };
    return body.thread;
  }

  async function deliver(hold: Hold) {
    await act(async () => {
      hold.release();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  async function deliverSave(hold: Hold, pending: Promise<void>) {
    await act(async () => {
      hold.release();
      await pending;
    });
  }

  async function scenario(name: string, run: () => Promise<void>) {
    console.log(`\n## ${name}`);
    try {
      await run();
      console.log(`  ✅ ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`  ❌ ${name}`);
      console.error(error);
    } finally {
      releaseArmed();
      while (live.length) {
        const mounted = live.pop();
        if (mounted) await mounted.unmount().catch(() => {});
      }
    }
  }

  try {
    await scenario("A GET: Antwort nach DELETE, Serverstand war vorher schon gelesen", async () => {
      const sessionId = "sess-a-get01";
      const deleted = synth("synth-del-get", "synthetic-delete-get");
      const keeper = synth("synth-keep-get", "synthetic-keep-get");
      const serverOnly = synth("synth-srv-get", "synthetic-server-only-get");
      begin(sessionId);
      await seed(sessionId, deleted);
      await seed(sessionId, keeper);
      await seed(sessionId, serverOnly);
      sessionStorage.setItem("chatThreads:v1:sess-a-get01", JSON.stringify([deleted, keeper]));
      const held = createHold("GET", "after-server");
      const mounted = await mount();
      await held.serverDone;
      const beforeDeleteServer = await observe("nach-GET-vor-DELETE", sessionId);
      assert.deepEqual(beforeDeleteServer, ["synth-del-get", "synth-keep-get", "synth-srv-get"].sort());
      assert.deepEqual(localIds(mounted.bag), ["synth-del-get", "synth-keep-get"]);
      assert.equal(sessionStorage.getItem("chatSession:v1"), sessionId);
      assert.equal(apiOf(mounted.bag).sessionId, sessionId);
      await act(async () => { await apiOf(mounted.bag).remove(deleted.id); });
      const afterDeleteServer = await observe("nach-DELETE-vor-Antwort", sessionId);
      assert.deepEqual(afterDeleteServer, ["synth-keep-get", "synth-srv-get"]);
      assert.deepEqual(localIds(mounted.bag), ["synth-keep-get"]);
      assert.deepEqual(storedIds(sessionId), ["synth-keep-get"]);
      await deliver(held);
      const localAfter = localIds(mounted.bag);
      const storedAfter = storedIds(sessionId);
      note(`local-after-late-get ids=${localAfter.join(",")} stored=${storedAfter.join(",")}`);
      await mounted.unmount();
      live.pop();
      const remount = await mount();
      await settle(() => trace.filter(line => line.startsWith("deliver-response GET status=200")).length >= 2);
      const remountIds = localIds(remount.bag);
      note(`remount-after-late-get ids=${remountIds.join(",")}`);
      assert.equal(held.status, 200);
      assert.deepEqual(held.bodyIds.sort(), ["synth-del-get", "synth-keep-get", "synth-srv-get"].sort());
      assertOrder(["server-finished GET status=200", "server-finished DELETE status=200", "deliver-response GET status=200"]);
      assert.equal(localAfter.includes("synth-keep-get"), true, "Keeper bleibt");
      assert.equal(localAfter.includes("synth-srv-get"), true, `verspätetes GET muss den neuen Serverthread übernehmen, ist ${localAfter.join(",")}`);
      assert.equal(localAfter.includes(deleted.id), false, `gelöschter Thread nach verspätetem GET wieder lokal: ${localAfter.join(",")}`);
      assert.equal(storedAfter.includes(deleted.id), false, `gelöschter Thread nach verspätetem GET wieder in sessionStorage: ${storedAfter.join(",")}`);
      assert.equal(remountIds.includes(deleted.id), false, `Remount zeigt gelöschten Thread aus verseuchtem sessionStorage: ${remountIds.join(",")}`);
      assert.equal(remountIds.includes("synth-srv-get"), true, "Remount behält den Serverthread, den das GET neu brachte");
    });

    await scenario("A PUT: 200-Antwort nach DELETE, Server hatte den PUT schon vorher ausgeführt", async () => {
      const sessionId = "sess-a-put01";
      const deleted = synth("synth-del-put", "synthetic-delete-put");
      const keeper = synth("synth-keep-put", "synthetic-keep-put-v1");
      const keeperNext = synth("synth-keep-put", "synthetic-keep-put-v2");
      begin(sessionId);
      const seededKeeper = await seed(sessionId, keeper);
      sessionStorage.setItem(`chatThreads:v1:${sessionId}`, JSON.stringify([seededKeeper]));
      const mounted = await mount();
      await settle(() => trace.some(line => line.startsWith("deliver-response GET")));
      const putDeleted = createHold("PUT", "after-server", deleted.id);
      const putKeeper = createHold("PUT", "after-server", keeper.id);
      let saveDeleted: Promise<void> = Promise.resolve();
      await act(async () => { saveDeleted = apiOf(mounted.bag).save(deleted); });
      await putDeleted.serverDone;
      assert.deepEqual(await observe("PUT-del-auf-Server", sessionId), ["synth-del-put", "synth-keep-put"]);
      let saveKeeper: Promise<void> = Promise.resolve();
      await act(async () => { saveKeeper = apiOf(mounted.bag).save(keeperNext); });
      await putKeeper.serverDone;
      await act(async () => { await apiOf(mounted.bag).remove(deleted.id); });
      const afterDelete = await observe("DELETE-vor-PUT-Antworten", sessionId);
      assert.deepEqual(afterDelete, ["synth-keep-put"]);
      assert.equal(localIds(mounted.bag).includes(deleted.id), false);
      await deliverSave(putDeleted, saveDeleted);
      await deliverSave(putKeeper, saveKeeper);
      const localAfter = localIds(mounted.bag);
      const keeperThread = apiOf(mounted.bag).threads.find(thread => thread.id === keeper.id);
      note(`local-after-late-put ids=${localAfter.join(",")} keep=${keeperThread?.messages[0]?.content ?? ""}`);
      assert.equal(putDeleted.status, 200);
      assert.deepEqual(putDeleted.bodyIds, [deleted.id]);
      assert.equal(putKeeper.status, 200);
      assertOrder([
        `server-finished PUT status=200 body=${deleted.id}`,
        "server-finished DELETE status=200",
        `deliver-response PUT status=200 body=${deleted.id}`,
      ]);
      assert.equal(keeperThread?.messages[0]?.content, "synthetic-keep-put-v2", "verspätete PUT-Antwort eines anderen Threads bleibt wirksam");
      assert.equal(storedIds(sessionId).includes(keeper.id), true);
      assert.equal(localAfter.includes(deleted.id), false, `gelöschter Thread nach verspätetem PUT wieder lokal: ${localAfter.join(",")}`);
      assert.equal(storedIds(sessionId).includes(deleted.id), false, `gelöschter Thread nach verspätetem PUT wieder in sessionStorage: ${storedIds(sessionId).join(",")}`);
    });

    await scenario("A mehrere ausstehende PUTs, nur der gelöschte Thread bleibt weg", async () => {
      const sessionId = "sess-a-multi1";
      const first = synth("synth-multi-a", "synthetic-multi-a");
      const second = synth("synth-multi-b", "synthetic-multi-b1");
      const secondNext = synth("synth-multi-b", "synthetic-multi-b2");
      begin(sessionId);
      const mounted = await mount();
      await settle(() => trace.some(line => line.startsWith("deliver-response GET")));
      const holdA = createHold("PUT", "after-server", first.id);
      const holdB1 = createHold("PUT", "after-server", second.id);
      const holdB2 = createHold("PUT", "after-server", second.id);
      let saveA: Promise<void> = Promise.resolve();
      let saveB1: Promise<void> = Promise.resolve();
      let saveB2: Promise<void> = Promise.resolve();
      await act(async () => { saveA = apiOf(mounted.bag).save(first); });
      await holdA.serverDone;
      await act(async () => { saveB1 = apiOf(mounted.bag).save(second); });
      await holdB1.serverDone;
      await act(async () => { saveB2 = apiOf(mounted.bag).save(secondNext); });
      await holdB2.serverDone;
      assert.deepEqual(await observe("drei-PUTs-vor-DELETE", sessionId), ["synth-multi-a", "synth-multi-b"]);
      await act(async () => { await apiOf(mounted.bag).remove(first.id); });
      assert.deepEqual(await observe("nach-DELETE-von-a", sessionId), ["synth-multi-b"]);
      await deliverSave(holdA, saveA);
      await deliverSave(holdB1, saveB1);
      await deliverSave(holdB2, saveB2);
      const localAfter = localIds(mounted.bag);
      const secondThread = apiOf(mounted.bag).threads.find(thread => thread.id === second.id);
      note(`local-after-multi ids=${localAfter.join(",")} b=${secondThread?.messages[0]?.content ?? ""}`);
      assert.equal(holdA.status, 200);
      assert.equal(holdB1.status, 200);
      assert.equal(holdB2.status, 200);
      assert.equal(secondThread?.messages[0]?.content, "synthetic-multi-b2");
      assert.equal(localAfter.includes(first.id), false, `mehrere verspätete PUTs holen ${first.id} zurück: ${localAfter.join(",")}`);
      assert.equal(storedIds(sessionId).includes(first.id), false, "sessionStorage holt den gelöschten Thread aus einem der PUTs zurück");
    });

    await scenario("A zweite Hook-Instanz derselben Session: verspätetes GET schreibt nicht zurück", async () => {
      const sessionId = "sess-a-inst01";
      const deleted = synth("synth-inst-del", "synthetic-instance-delete");
      const keeper = synth("synth-inst-keep", "synthetic-instance-keep");
      begin(sessionId);
      await seed(sessionId, deleted);
      await seed(sessionId, keeper);
      sessionStorage.setItem(`chatThreads:v1:${sessionId}`, JSON.stringify([deleted, keeper]));
      const first = await mount();
      await settle(() => trace.filter(line => line.startsWith("deliver-response GET")).length >= 1);
      const held = createHold("GET", "after-server");
      const second = await mount();
      await held.serverDone;
      assert.equal(apiOf(first.bag).sessionId, apiOf(second.bag).sessionId);
      assert.deepEqual(await observe("GET-der-zweiten-Instanz", sessionId), ["synth-inst-del", "synth-inst-keep"]);
      await act(async () => { await apiOf(first.bag).remove(deleted.id); });
      assert.deepEqual(await observe("DELETE-der-ersten-Instanz", sessionId), ["synth-inst-keep"]);
      assert.equal(localIds(first.bag).includes(deleted.id), false);
      await deliver(held);
      const firstIds = localIds(first.bag);
      const secondIds = localIds(second.bag);
      const stored = storedIds(sessionId);
      note(`instances-after first=${firstIds.join(",")} second=${secondIds.join(",")} stored=${stored.join(",")}`);
      assert.equal(held.status, 200);
      assert.equal(held.bodyIds.includes(deleted.id), true, "die festgehaltene GET-Antwort enthält den gelöschten Thread");
      assert.equal(secondIds.includes(keeper.id), true);
      assert.equal(firstIds.includes(deleted.id), false);
      assert.equal(secondIds.includes(deleted.id), false, `zweite Instanz setzt den gelöschten Thread wieder: ${secondIds.join(",")}`);
      assert.equal(stored.includes(deleted.id), false, `zweite Instanz schreibt den gelöschten Thread in die gemeinsame Session: ${stored.join(",")}`);
    });

    await scenario("B PUT erreicht den Server erst nach DELETE und belebt den Thread nicht wieder", async () => {
      const sessionId = "sess-b-put01";
      const id = "synth-b-put";
      begin(sessionId);
      const mounted = await mount();
      await settle(() => trace.some(line => line.startsWith("deliver-response GET")));
      const first = createHold("PUT", "before-forward", id);
      const second = createHold("PUT", "before-forward", id);
      let saveFirst: Promise<void> = Promise.resolve();
      let saveSecond: Promise<void> = Promise.resolve();
      await act(async () => {
        saveFirst = apiOf(mounted.bag).save(synth(id, "synthetic-b-v1"));
        saveSecond = apiOf(mounted.bag).save(synth(id, "synthetic-b-v2"));
      });
      await first.clientSent;
      await second.clientSent;
      assert.deepEqual(await observe("vor-Forward-und-vor-DELETE", sessionId), []);
      await act(async () => { await apiOf(mounted.bag).remove(id); });
      assert.deepEqual(await observe("DELETE-bevor-PUT-den-Server-erreicht", sessionId), []);
      assert.equal(localIds(mounted.bag).includes(id), false);
      await deliverSave(first, saveFirst);
      const afterFirst = await observe("erster-PUT-nach-DELETE", sessionId);
      await deliverSave(second, saveSecond);
      const afterSecond = await observe("zweiter-PUT-nach-DELETE", sessionId);
      const localAfter = localIds(mounted.bag);
      note(`local-after-b ids=${localAfter.join(",")}`);
      await mounted.unmount();
      live.pop();
      const remount = await mount();
      await settle(() => trace.filter(line => line.startsWith("deliver-response GET status=200")).length >= 2);
      const remountThread = apiOf(remount.bag).threads.find(thread => thread.id === id);
      note(`remount-b content=${remountThread?.messages[0]?.content ?? "absent"} ids=${localIds(remount.bag).join(",")}`);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.deepEqual(afterFirst, [], `erster verspäteter PUT hat ${id} serverseitig wieder angelegt: ${afterFirst.join(",")}`);
      assert.deepEqual(afterSecond, [], `zweiter verspäteter PUT hat ${id} serverseitig wieder angelegt: ${afterSecond.join(",")}`);
      assertOrder([
        "hold-before-forward PUT",
        "server-finished DELETE status=200",
        "forward-after-hold PUT",
        "server-finished PUT status=200 body=",
      ]);
      assert.equal(remountThread, undefined, `Remount-GET zeigt den wiederbelebten Thread: ${remountThread?.messages[0]?.content ?? ""}`);
      assert.equal(localAfter.includes(id), false, `Antwort des nach dem DELETE ausgeführten PUT darf lokal nicht wieder einfügen: ${localAfter.join(",")}`);
    });

    await scenario("Erhalten: Laden, anderer Thread, neuer Chat, Speichern nach Löschen", async () => {
      const sessionId = "sess-keep-01";
      const older = synth("synth-keep-old", "synthetic-old");
      const fresh = synth("synth-keep-new", "synthetic-new-chat");
      const again = synth("synth-keep-old", "synthetic-saved-again");
      const btc = synth("synth-btc-one", "synthetic-btc", "btc", null);
      begin(sessionId);
      sessionStorage.setItem(`chatThreads:v1:${sessionId}`, JSON.stringify([older]));
      const held = createHold("GET", "after-server");
      const mounted = await mount();
      await held.serverDone;
      assert.deepEqual(localIds(mounted.bag), ["synth-keep-old"], "sessionStorage ist sichtbar, bevor das GET ankommt");
      await deliver(held);
      await settle(() => localIds(mounted.bag).includes("synth-keep-old"));
      await act(async () => { await apiOf(mounted.bag).save(fresh); });
      await settle(() => localIds(mounted.bag).includes(fresh.id));
      assert.deepEqual(localIds(mounted.bag), ["synth-keep-new", "synth-keep-old"].sort(), "zweiter Chat löscht den ersten nicht");
      await act(async () => { await apiOf(mounted.bag).save(btc); });
      await settle(() => storedIds(sessionId).includes(btc.id));
      assert.equal(localIds(mounted.bag).includes(btc.id), false, "anderer Dashboard-Thread bleibt aus der Aktienliste");
      assert.equal(storedIds(sessionId).includes(btc.id), true);
      await act(async () => { await apiOf(mounted.bag).remove(older.id); });
      await settle(() => !localIds(mounted.bag).includes(older.id));
      assert.equal(localIds(mounted.bag).includes(fresh.id), true, "Löschen trifft den anderen Thread nicht");
      assert.deepEqual(await serverIds(sessionId), [fresh.id]);
      await act(async () => { await apiOf(mounted.bag).save(again); });
      await settle(() => localIds(mounted.bag).includes(again.id));
      const restored = apiOf(mounted.bag).threads.find(thread => thread.id === again.id);
      assert.equal(restored?.messages[0]?.content, "synthetic-saved-again");
      assert.deepEqual(await serverIds(sessionId), [again.id, fresh.id].sort());
      assert.equal(storedIds(sessionId).includes(btc.id), true, "BTC-Thread bleibt in der Session, während Aktien-Threads wechseln");
    });

    await scenario("Erhalten: GET-Fehler, PUT-Fehler und DELETE-Netzfehler lassen den lokalen Stand", async () => {
      const sessionId = "sess-error01";
      const keeper = synth("synth-err-keep", "synthetic-error-keep");
      begin(sessionId);
      await seed(sessionId, keeper);
      sessionStorage.setItem(`chatThreads:v1:${sessionId}`, JSON.stringify([keeper]));
      const getFail = createHold("GET", "after-server", undefined, 500);
      const mounted = await mount();
      await getFail.serverDone;
      await flush();
      assert.equal(getFail.status, 500);
      assert.deepEqual(localIds(mounted.bag), [keeper.id], "HTTP 500 beim GET lässt den sessionStorage-Stand");
      assert.deepEqual(await serverIds(sessionId), [keeper.id]);

      const putFail = createHold("PUT", "after-server", "synth-err-put", 400);
      const rejected = synth("synth-err-put", "synthetic-put-rejected");
      let saveRejected: Promise<void> = Promise.resolve();
      await act(async () => { saveRejected = apiOf(mounted.bag).save(rejected); });
      await deliverSave(putFail, saveRejected);
      assert.equal(putFail.status, 400);
      assert.equal(localIds(mounted.bag).includes(rejected.id), true, "optimistischer Stand bleibt, wenn PUT nicht ok ist");
      assert.equal((await serverIds(sessionId)).includes(rejected.id), false);

      const putThrow = createHold("PUT", "before-forward", "synth-err-net", "throw");
      const offline = synth("synth-err-net", "synthetic-put-offline");
      let saveOffline: Promise<void> = Promise.resolve();
      await act(async () => { saveOffline = apiOf(mounted.bag).save(offline); });
      await act(async () => { await saveOffline; });
      assert.equal(localIds(mounted.bag).includes(offline.id), true, "Netzfehler beim PUT lässt den lokalen Stand");

      createHold("DELETE", "before-forward", keeper.id, "throw");
      await act(async () => { await apiOf(mounted.bag).remove(keeper.id); });
      assert.equal(localIds(mounted.bag).includes(keeper.id), false, "lokales Löschen bleibt auch wenn DELETE scheitert");
      assert.equal(storedIds(sessionId).includes(keeper.id), false);
      assert.equal((await serverIds(sessionId)).includes(keeper.id), true, "gescheitertes DELETE lässt den Serverstand unverändert");
    });

    await scenario("M1 Reload: DELETE mit neuem Zähler löscht einen älteren Seitenstand", async () => {
      const sessionId = "sess-reload1";
      const id = "synth-reload1";
      begin(sessionId);
      const put = await revisionWrite("PUT", sessionId, id, "epoch-page-old", 50, "synthetic-reload-old");
      assert.equal(put.status, 200);
      assert.deepEqual(await observe("nach-altem-Seitenstand", sessionId), [id]);
      const del = await revisionWrite("DELETE", sessionId, id, "epoch-page-new", 1);
      assert.equal(del.status, 200);
      assert.equal(del.body.ok, true);
      const left = await observe("GET-nach-Reload-DELETE", sessionId);
      assert.deepEqual(left, [], `Reload-DELETE ließ ${id} liegen: ${left.join(",")}`);
    });

    await scenario("M1 zweiter Tab: DELETE löscht, alter Tab belebt nicht, neuer Tab darf danach speichern", async () => {
      const sessionId = "sess-tab-dup1";
      const id = "synth-tab-dup1";
      begin(sessionId);
      assert.equal((await revisionWrite("PUT", sessionId, id, "epoch-tab-old", 50, "synthetic-tab-old")).status, 200);
      const del = await revisionWrite("DELETE", sessionId, id, "epoch-tab-new", 1);
      assert.equal(del.status, 200);
      assert.equal(del.body.ok, true);
      const afterDelete = await observe("GET-nach-Tab-DELETE", sessionId);
      assert.deepEqual(afterDelete, [], `zweiter Tab löschte ${id} nicht: ${afterDelete.join(",")}`);
      await revisionWrite("PUT", sessionId, id, "epoch-tab-old", 51, "synthetic-old-tab-late");
      const afterOld = await observe("PUT-des-alten-Tabs", sessionId);
      assert.deepEqual(afterOld, [], `alter Tab hat ${id} wieder angelegt: ${afterOld.join(",")}`);
      await revisionWrite("PUT", sessionId, id, "epoch-tab-new", 2, "synthetic-saved-after-tab-delete");
      const afterNew = await observe("Speichern-im-löschenden-Tab", sessionId);
      assert.deepEqual(afterNew, [id], `bewusstes Speichern nach dem Löschen fehlt: ${afterNew.join(",")}`);
    });

    await scenario("M2 Löschvermerk läuft mit der Thread-TTL ab und ist je Session gedeckelt", async () => {
      const sessionId = "sess-tomb-ttl";
      const id = "synth-tomb-ttl";
      const t0 = 1_700_000_000_000;
      begin(sessionId);
      assert.ok(putChatThread(sessionId, synth(id, "synthetic-tomb-old"), t0, 50, "epoch-tomb-old"));
      assert.equal(deleteChatThread(sessionId, id, t0, 1, "epoch-tomb-new"), true);
      assert.deepEqual(listChatThreads(sessionId, "stock", "SYNTH", t0 + 1).map(thread => thread.id), []);
      assert.equal(putChatThread(sessionId, synth(id, "synthetic-tomb-stale"), t0 + 1, 40, "epoch-tomb-old"), null);
      const revived = putChatThread(sessionId, synth(id, "synthetic-tomb-after-ttl"), t0 + CHAT_HISTORY_TTL_MS, 40, "epoch-tomb-old");
      assert.equal(revived?.messages[0]?.content, "synthetic-tomb-after-ttl", "Vermerk älter als die Thread-TTL blockiert nicht mehr");

      const capped = "sess-tomb-cap";
      resetChatHistoryStore();
      const overflow = CHAT_HISTORY_THREADS_PER_SESSION + 1;
      for (let i = 0; i < overflow; i++) {
        const threadId = `synth-cap-${i}`;
        assert.ok(putChatThread(capped, synth(threadId, `synthetic-cap-${i}`), t0, 9, "epoch-cap-old"));
        deleteChatThread(capped, threadId, t0 + i, 1, "epoch-cap-new");
      }
      const oldest = putChatThread(capped, synth("synth-cap-0", "synthetic-cap-0-back"), t0 + overflow, 2, "epoch-cap-old");
      const newestId = `synth-cap-${CHAT_HISTORY_THREADS_PER_SESSION}`;
      const newest = putChatThread(capped, synth(newestId, "synthetic-cap-newest-back"), t0 + overflow, 2, "epoch-cap-old");
      assert.equal(oldest?.id, "synth-cap-0", "der älteste Vermerk fällt aus dem Cap");
      assert.equal(newest, null, "der jüngste Vermerk bleibt innerhalb des Caps");
    });

    await scenario("M3 DELETE mit Schreibstand legt keine Session an", async () => {
      const kept = "sess-m3-kept1";
      begin(kept);
      await seed(kept, synth("synth-m3-kept", "synthetic-m3-kept"));
      for (let i = 0; i < CHAT_HISTORY_SESSION_CAP; i++) {
        const del = await revisionWrite("DELETE", `sess-m3-new-${i}`, "synth-m3-miss", "epoch-m3-page", 1);
        assert.equal(del.status, 200);
        assert.equal(del.body.ok, true);
      }
      assert.deepEqual(await observe("Session-nach-leeren-DELETEs", kept), ["synth-m3-kept"]);
    });

    await scenario("M4 viele DELETEs fremder Sessions bleiben unter dem Gesamt-Cap", async () => {
      const t0 = 1_800_000_000_000;
      resetChatHistoryStore();
      const flood = CHAT_HISTORY_TOMB_CAP + 40;
      for (let i = 0; i < flood; i++) {
        deleteChatThread(`sess-m4-${i}`, "synth-m4-flood", t0 + i, 1, "epoch-m4-flood");
      }
      const size = chatHistoryTombCount();
      note(`tomb-count=${size} cap=${CHAT_HISTORY_TOMB_CAP} flood=${flood}`);
      assert.ok(size > 0 && size <= CHAT_HISTORY_TOMB_CAP, `Vermerke ${size} über Cap ${CHAT_HISTORY_TOMB_CAP}`);
      const oldest = putChatThread("sess-m4-0", synth("synth-m4-flood", "synthetic-m4-oldest"), t0 + flood, 2, "epoch-m4-other");
      const newest = putChatThread(`sess-m4-${flood - 1}`, synth("synth-m4-flood", "synthetic-m4-newest"), t0 + flood, 2, "epoch-m4-other");
      assert.equal(oldest?.id, "synth-m4-flood", "der älteste fremde Vermerk wird verdrängt");
      assert.equal(newest, null, "ein junger fremder Vermerk bleibt");
    });

    await scenario("Zwei Tabs: stale-write verwirft nur den abgelehnten Thread", async () => {
      const sessionId = "sess-stale-tab";
      const deleted = synth("synth-stale-del", "synthetic-stale-deleted-title");
      const keeper = synth("synth-stale-keep", "synthetic-stale-keeper-server");
      const unsaved = synth("synth-stale-local", "synthetic-stale-unsaved-other");
      const btc = synth("synth-stale-btc", "synthetic-stale-btc", "btc", null);
      begin(sessionId);
      const seededDeleted = await seed(sessionId, deleted);
      const seededKeeper = await seed(sessionId, keeper);
      const keeperDraft = {
        ...seededKeeper,
        title: "synthetic-stale-keeper-unsaved",
        updatedAt: "2099-01-01T00:00:00.000Z",
        messages: [{ role: "user" as const, content: "synthetic-stale-keeper-unsaved" }],
      };
      sessionStorage.setItem(`chatThreads:v1:${sessionId}`, JSON.stringify([seededDeleted, keeperDraft, unsaved, btc]));
      const tabB = await mount();
      await settle(() => trace.some(line => line.startsWith("deliver-response GET")));
      assert.equal(apiOf(tabB.bag).threads.find(thread => thread.id === keeper.id)?.messages[0]?.content, "synthetic-stale-keeper-unsaved", "ungespeicherter Keeper bleibt vor dem fremden DELETE sichtbar");
      assert.equal(localIds(tabB.bag).includes(unsaved.id), true, "ungespeicherter fremder Thread bleibt in der Liste");
      assert.equal(localIds(tabB.bag).includes(btc.id), false, "anderer Dashboard-Thread bleibt aus der Aktienliste");
      assert.equal(storedIds(sessionId).includes(btc.id), true);
      const del = await revisionWrite("DELETE", sessionId, deleted.id, "epoch-tab-a-stale", 1);
      assert.equal(del.status, 200);
      assert.equal(del.body.ok, true);
      assert.deepEqual(await observe("GET-nach-anderem-Tab-DELETE", sessionId), [keeper.id]);
      assert.equal(localIds(tabB.bag).includes(deleted.id), true, "Tab B hat lokal noch den Titel, den der andere Tab schon gelöscht hat");
      const late = {
        ...seededDeleted,
        title: seededDeleted.title,
        updatedAt: new Date().toISOString(),
        messages: [
          ...seededDeleted.messages,
          { role: "assistant" as const, content: "synthetic-stale-old-answer" },
          { role: "user" as const, content: "synthetic-stale-late-keystroke" },
        ],
      };
      const holds = [createHold("PUT", "after-server", deleted.id), createHold("PUT", "after-server", deleted.id), createHold("PUT", "after-server", deleted.id)];
      let save1: Promise<void> = Promise.resolve();
      let save2: Promise<void> = Promise.resolve();
      let save3: Promise<void> = Promise.resolve();
      await act(async () => {
        save1 = apiOf(tabB.bag).save(late);
        save2 = apiOf(tabB.bag).save(late);
        save3 = apiOf(tabB.bag).save(late);
      });
      await holds[0].serverDone;
      await holds[1].serverDone;
      await holds[2].serverDone;
      assert.deepEqual(holds.map(hold => hold.status), [200, 200, 200]);
      assert.deepEqual(holds.map(hold => hold.rejected), ["stale-write", "stale-write", "stale-write"]);
      assert.deepEqual(holds.map(hold => hold.bodyIds), [[], [], []]);
      assert.deepEqual(await observe("drei-PUTs-nach-DELETE", sessionId), [keeper.id], "abgelehnte PUTs legen den Thread serverseitig nicht wieder an");
      assert.equal(localIds(tabB.bag).includes(deleted.id), true, "vor der Antwort steht der optimistische Stand noch");
      await deliverSave(holds[0], save1);
      await deliverSave(holds[1], save2);
      await deliverSave(holds[2], save3);
      const localAfter = localIds(tabB.bag);
      const storedAfter = storedThreads(sessionId);
      const storedJson = JSON.stringify(storedAfter);
      note(`local-after-stale ids=${localAfter.join(",")} stored=${storedAfter.map(thread => thread.id).join(",")}`);
      assert.equal(localAfter.includes(deleted.id), false, `stale-write ließ den gelöschten Titel lokal stehen: ${localAfter.join(",")}`);
      assert.equal(storedAfter.some(thread => thread.id === deleted.id), false, `stale-write ließ den Thread in sessionStorage: ${storedAfter.map(thread => thread.id).join(",")}`);
      assert.equal(storedJson.includes("synthetic-stale-deleted-title"), false, "der gelöschte Titel liegt noch im sessionStorage");
      assert.equal(storedJson.includes("synthetic-stale-late-keystroke"), false, "die abgelehnte Eingabe liegt noch im sessionStorage");
      assert.equal(apiOf(tabB.bag).threads.find(thread => thread.id === keeper.id)?.messages[0]?.content, "synthetic-stale-keeper-unsaved", "ungespeicherte Eingabe eines anderen Chats bleibt");
      assert.equal(localAfter.includes(unsaved.id), true, "ungespeicherter fremder Thread bleibt");
      assert.equal(storedAfter.find(thread => thread.id === btc.id)?.messages[0]?.content, "synthetic-stale-btc", "Thread eines anderen Dashboards bleibt in der Session");
      assert.equal(localAfter.includes(btc.id), false);
      await tabB.unmount();
      live.pop();
      const remountGet = createHold("GET", "after-server");
      const remount = await mount();
      await remountGet.serverDone;
      const hydrated = localIds(remount.bag);
      note(`remount-before-get ids=${hydrated.join(",")}`);
      assert.equal(hydrated.includes(deleted.id), false, `Reload aus sessionStorage zeigt den gelöschten Titel: ${hydrated.join(",")}`);
      assert.equal(apiOf(remount.bag).threads.find(thread => thread.id === keeper.id)?.messages[0]?.content, "synthetic-stale-keeper-unsaved");
      assert.equal(hydrated.includes(unsaved.id), true, "Reload behält den ungespeicherten fremden Thread");
      await deliver(remountGet);
      const remountIds = localIds(remount.bag);
      const selectable = apiOf(remount.bag).threads.map(thread => thread.id);
      note(`remount-after-get ids=${remountIds.join(",")}`);
      assert.equal(remountGet.status, 200);
      assert.equal(remountGet.bodyIds.includes(deleted.id), false, "der Server-GET nach dem Löschen enthält den Thread nicht");
      assert.equal(selectable.includes(deleted.id), false, `Auswahl liest threads und bietet den gelöschten Verlauf an: ${selectable.join(",")}`);
      assert.equal(remountIds.includes(keeper.id), true);
      assert.equal(apiOf(remount.bag).threads.find(thread => thread.id === keeper.id)?.messages[0]?.content, "synthetic-stale-keeper-unsaved");
      assert.equal(remountIds.includes(unsaved.id), true);
      assert.equal(storedIds(sessionId).includes(btc.id), true);
      assert.equal(storedIds(sessionId).includes(deleted.id), false);
    });
  } finally {
    releaseArmed();
    globalThis.fetch = realFetch;
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }

  console.log("\nGrenze: sessionStorage dieses Fensters. Ein zweiter Tab ist eine andere Epoche auf demselben Server, nicht eine zweite Hook-Instanz.");
  console.log("Fall stale-write: DELETE der anderen Epoche, danach PUT dieses Tabs mit 200 rejected. Nur dieser Thread fällt lokal weg.");
  console.log("Fall B: ein vor dem DELETE ausgelöster PUT darf den Thread serverseitig nicht wiederbeleben.");
  console.log("Der Hook bricht den Fetch nicht ab; apiRequest besitzt den AbortController. Belegt ist HTTP 200.");
  console.log("Kein Live-UI-PASS. UI-Dateien wurden nicht gerendert.");
  console.log(failures.length === 0 ? "\nchat history delete race: all checks ok" : `\nchat history delete race: ${failures.length} scenario(s) failed: ${failures.join(" | ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
