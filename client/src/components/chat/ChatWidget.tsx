/**
 * KI-Chatbot-Widget (WORK_DASHBOARD_FEATURES_2026-10.md §4 UI-Anforderungen, §4c gemeinsames Widget).
 * Dashboard-agnostisch: bekommt den Kontext vom Provider des jeweiligen Dashboards
 * (PR 1: nur Aktien, buildStockChatContext). Verschiebbar (Titelleiste), größenveränderbar
 * (Ecken/Ränder), Fenster-Controls (Zurück, Minimieren, Maximieren, Schließen),
 * Position/Größe in localStorage, Sektionsbindung. Kein Score-Einfluss: nur Lesen + Fragen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Crosshair, Loader2, Maximize2, MessageCircle, Minimize2, Minus, Send, Sparkles, X } from "lucide-react";
import { chatContextTrimOf, chatSectionKey, chatSectionName, chatSectionTag, formatChatContextTrim, mergeChatContextTrim, type ChatContext, type ChatSectionItem } from "@shared/chat-context";
import type { EarningsCallBrief } from "@shared/chat-earnings";
import { useDashboardChat } from "@/hooks/useDashboardChat";
import { useChatHistory } from "@/hooks/useChatHistory";
import { chatThreadTitle, isChatDashboard, newChatId, type ChatThread } from "@shared/chat-history";
import { ChatMarkdown } from "./ChatMarkdown";
import {
  chatWindowStorageKey, clampChatWindow, moveChatWindow, parseChatWindow, resizeChatWindow, serializeChatWindow,
  type ChatWindowState, type ResizeEdge,
} from "@/lib/chatWindowGeometry";

export interface ChatWidgetProps {
  dashboard: string;
  context: ChatContext | null;
  /** `key` = stabile Bindung (semantisch, z.B. Rezession "buffett"); `id` = angezeigte Nummer; `display` ersetzt die Nummer in der Auswahl (Gold-News). */
  sections: ChatSectionItem[];
  /** Liefert die aktuell sichtbare Sektion (für „Aktuelle Sektion binden“). */
  getActiveSectionId?: () => number | null;
  /** Springt im Dashboard zu einer Sektion (Antwort-Verweise). */
  onJumpToSection?: (id: number) => void;
  /** Beispiel-Fragen für den Startbildschirm. */
  suggestions?: string[];
  /** Letzter Earnings Call, dieselbe Antwort wie im Chat-Kontext. */
  earningsBrief?: EarningsCallBrief | null;
}

function viewport() {
  return { vw: typeof window !== "undefined" ? window.innerWidth : 1280, vh: typeof window !== "undefined" ? window.innerHeight : 800 };
}

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function ChatWidget({ dashboard, context, sections, getActiveSectionId, onJumpToSection, suggestions = [], earningsBrief }: ChatWidgetProps) {
  const storageKey = chatWindowStorageKey(dashboard);
  const [win, setWin] = useState<ChatWindowState>(() => { const { vw, vh } = viewport(); return parseChatWindow(readStored(storageKey), vw, vh); });
  // Bindung über den stabilen Schlüssel: verschiebt sich die Nummerierung (Rezession: Regionen
  // laden nach, #284 fügt TA ein), bleibt die gebundene Sektion dieselbe.
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const bound = useMemo(() => (boundKey == null ? null : sections.find(s => chatSectionKey(s) === boundKey) ?? null), [sections, boundKey]);
  const sectionId = bound?.id ?? null;
  const bindId = useCallback((id: number | null) => {
    const s = id == null ? null : sections.find(x => x.id === id);
    setBoundKey(s ? chatSectionKey(s) : null);
  }, [sections]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState(newChatId);
  const { entries, pending, send, reset, load, contextTrimmed } = useDashboardChat(context, sectionId);
  const entity = context?.entity ?? null;
  const history = useChatHistory(dashboard, entity);
  const trimHint = formatChatContextTrim(mergeChatContextTrim(chatContextTrimOf(context), contextTrimmed));
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "move" | ResizeEdge; sx: number; sy: number; start: ChatWindowState } | null>(null);

  useEffect(() => { try { window.localStorage.setItem(storageKey, serializeChatWindow(win)); } catch { /* privat/voll: ignorieren */ } }, [storageKey, win]);
  useEffect(() => {
    const onResize = () => { const { vw, vh } = viewport(); setWin(w => clampChatWindow(w, vw, vh)); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [entries, pending]);
  // Anderes Asset → neuer Chat. Der bisherige Verlauf bleibt im Session-Cache.
  const seenEntity = useRef(entity);
  useEffect(() => {
    if (seenEntity.current === entity) return;
    seenEntity.current = entity;
    setThreadId(newChatId());
    reset();
    setBoundKey(null);
  }, [entity, reset]);
  useEffect(() => {
    const messages = entries.filter(e => !e.error).map(e => ({ role: e.role, content: e.content }));
    if (!messages.some(m => m.role === "user") || !isChatDashboard(dashboard)) return;
    const thread: ChatThread = {
      id: threadId,
      dashboard,
      entity,
      title: chatThreadTitle(messages),
      updatedAt: new Date().toISOString(),
      messages,
    };
    void history.save(thread);
  }, [entries, threadId, entity, dashboard, history.save]);

  const startPointer = useCallback((mode: "move" | ResizeEdge) => (e: ReactPointerEvent<HTMLElement>) => {
    if (win.maximized || e.button !== 0) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button,select")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, start: win };
  }, [win]);
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const { vw, vh } = viewport();
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    setWin(d.mode === "move" ? moveChatWindow(d.start, dx, dy, vw, vh) : resizeChatWindow(d.start, d.mode, dx, dy, vw, vh));
  }, []);
  const endPointer = useCallback(() => { dragRef.current = null; }, []);

  const sectionLabel = bound?.label ?? null;
  const submit = (text: string) => { if (!text.trim()) return; send(text); setInput(""); };

  if (!win.open) {
    return (
      <button
        type="button"
        onClick={() => setWin(w => ({ ...w, open: true, minimized: false }))}
        className="fixed bottom-4 right-4 z-40 h-11 px-4 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center gap-2 text-xs font-medium hover:opacity-90"
        data-testid="chat-launcher"
        title="KI-Chat öffnen"
      >
        <MessageCircle className="w-4 h-4" /> KI-Chat
      </button>
    );
  }

  const style = win.maximized
    ? { left: 0, top: 0, width: "100vw", height: "100dvh" }
    : { left: win.x, top: win.y, width: win.w, height: win.minimized ? 40 : win.h };

  const edge = (mode: ResizeEdge, cls: string) => (
    <div
      onPointerDown={startPointer(mode)} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}
      className={`absolute ${cls}`} data-testid={`chat-resize-${mode}`} aria-hidden
    />
  );

  return (
    <div
      className="fixed z-50 flex flex-col rounded-xl border border-border bg-card text-foreground shadow-2xl overflow-hidden"
      style={style}
      role="dialog"
      aria-label="KI-Chat"
      data-testid="chat-window"
    >
      {/* Titelleiste: Drag-Fläche + Fenster-Controls */}
      <div
        onPointerDown={startPointer("move")} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}
        onDoubleClick={() => setWin(w => ({ ...w, maximized: !w.maximized, minimized: false }))}
        className={`h-10 shrink-0 flex items-center gap-1 px-1.5 border-b border-border bg-muted/40 select-none ${win.maximized ? "" : "cursor-move"} touch-none`}
        data-testid="chat-titlebar"
      >
        <button type="button" onClick={() => { setThreadId(newChatId()); reset(); setBoundKey(null); }} className="p-1.5 rounded hover:bg-muted" title="Neuer Chat" data-testid="chat-back"><ArrowLeft className="w-3.5 h-3.5" /></button>
        <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-xs font-medium truncate flex-1">KI-Chat{context ? ` · ${context.entity}` : ""}{sectionLabel ? ` · ${sectionLabel}` : ""}</span>
        <button type="button" onClick={() => setWin(w => ({ ...w, minimized: !w.minimized, maximized: false }))} className="p-1.5 rounded hover:bg-muted" title={win.minimized ? "Wiederherstellen" : "Minimieren"} data-testid="chat-minimize"><Minus className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => setWin(w => ({ ...w, maximized: !w.maximized, minimized: false }))} className="p-1.5 rounded hover:bg-muted" title={win.maximized ? "Verkleinern" : "Maximieren"} data-testid="chat-maximize">{win.maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
        <button type="button" onClick={() => setWin(w => ({ ...w, open: false }))} className="p-1.5 rounded hover:bg-muted" title="Schließen" data-testid="chat-close"><X className="w-3.5 h-3.5" /></button>
      </div>

      {!win.minimized && (
        <>
          {/* Sektionsbindung */}
          <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-border/60 text-[11px]">
            <label htmlFor="chat-section" className="text-muted-foreground shrink-0">Sektion</label>
            <select
              id="chat-section"
              value={bound ? chatSectionKey(bound) : ""}
              onChange={e => setBoundKey(e.target.value === "" ? null : e.target.value)}
              className="flex-1 min-w-0 h-7 rounded border border-border bg-background px-1.5"
              data-testid="chat-section-select"
              disabled={!context}
            >
              <option value="">Ganze Analyse</option>
              {sections.map(s => <option key={chatSectionKey(s)} value={chatSectionKey(s)}>{chatSectionTag(s)} {s.label}</option>)}
            </select>
            {getActiveSectionId && (
              <button type="button" disabled={!context} onClick={() => bindId(getActiveSectionId())} className="h-7 px-2 rounded border border-border hover:bg-muted flex items-center gap-1 shrink-0 disabled:opacity-40" title="Aktuell sichtbare Sektion binden" data-testid="chat-bind-visible">
                <Crosshair className="w-3 h-3" /> Aktuelle
              </button>
            )}
            <label htmlFor="chat-history" className="text-muted-foreground shrink-0">Verlauf</label>
            <select
              id="chat-history"
              value={threadId}
              onChange={e => {
                const id = e.target.value;
                if (id === threadId) return;
                const thread = history.threads.find(t => t.id === id);
                if (!thread) return;
                setThreadId(thread.id);
                load(thread.messages.map(m => ({ role: m.role, content: m.content })));
              }}
              className="min-w-0 flex-1 h-7 rounded border border-border bg-background px-1.5"
              data-testid="chat-history"
            >
              <option value={threadId}>{history.threads.find(t => t.id === threadId)?.title ?? "Dieser Chat"}</option>
              {history.threads.filter(t => t.id !== threadId).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { void history.remove(threadId); setThreadId(newChatId()); reset(); }}
              className="h-7 px-2 rounded border border-border hover:bg-muted shrink-0"
              title="Diesen Chat löschen"
              data-testid="chat-history-delete"
            >
              Löschen
            </button>
          </div>

          {earningsBrief !== undefined && (
            <div className="shrink-0 max-h-28 overflow-y-auto break-words border-b border-border/60 px-3 py-2 text-[11px] leading-relaxed" data-testid="chat-earnings-brief">
              <div className="font-medium text-foreground">Letzter Earnings Call{earningsBrief?.date ? ` · ${earningsBrief.date}` : ""}{earningsBrief?.year != null && earningsBrief.quarter != null ? ` · FY${earningsBrief.year} Q${earningsBrief.quarter}` : ""}</div>
              <p className="mt-1 text-muted-foreground">
                {earningsBrief?.summary
                  ?? earningsBrief?.excerpt
                  ?? earningsBrief?.reason
                  ?? "n/a — Earnings-Call noch nicht geladen"}
              </p>
              {earningsBrief?.summary && earningsBrief.reason && (
                <p className="mt-1 text-muted-foreground/80">{earningsBrief.reason}</p>
              )}
              {earningsBrief?.status === "ok" && earningsBrief.source && (
                <p className="mt-1 text-muted-foreground/80" data-testid="chat-earnings-source">
                  {earningsBrief.kind === "earnings-release" ? "Earnings Release, kein Call-Transkript · " : ""}Quelle:{" "}
                  {earningsBrief.sourceUrl && /^https?:\/\//i.test(earningsBrief.sourceUrl)
                    ? <a href={earningsBrief.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{earningsBrief.source}</a>
                    : earningsBrief.source}
                </p>
              )}
            </div>
          )}

          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2 text-xs" data-testid="chat-messages">
            {entries.length === 0 && (
              <div className="pt-4 space-y-3 text-center">
                <div className="text-base font-semibold" data-testid="chat-heading">Was sollen wir erkunden?</div>
                {!context ? (
                  <div className="text-muted-foreground">Erst eine Analyse laden – der Chat antwortet auf die geladenen Daten.</div>
                ) : (
                  <div className="flex flex-col gap-1.5 items-stretch">
                    {bound != null && (
                      <button type="button" onClick={() => submit(`Erkläre mir Sektion ${chatSectionName(bound)} detailliert und mit einem konkreten Beispiel aus diesen Daten.`)} className="text-left px-2.5 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20" data-testid="chat-explain-section">
                        Sektion {chatSectionName(bound)} erklären
                      </button>
                    )}
                    {suggestions.map(q => (
                      <button key={q} type="button" onClick={() => submit(q)} className="text-left px-2.5 py-1.5 rounded-md border border-border hover:bg-muted">{q}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {entries.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] min-w-0 rounded-lg px-2.5 py-1.5 break-words ${m.role === "assistant" && !m.error ? "" : "whitespace-pre-wrap"} ${m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400" : "bg-muted"}`} data-testid={m.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}>
                  {m.role === "assistant" && !m.error ? <ChatMarkdown content={m.content} /> : m.content}
                  {m.sectionRefs && m.sectionRefs.length > 0 && onJumpToSection && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.sectionRefs.map(id => (
                        <button key={id} type="button" onClick={() => onJumpToSection(id)} className="px-1.5 py-0.5 rounded bg-background/60 border border-border text-[10px] hover:bg-background">→ {sections.find(s => s.id === id)?.display ?? `S${id}`}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pending && <div className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> KI denkt…</div>}
          </div>

          <form className="shrink-0 flex items-end gap-1.5 p-2 border-t border-border" onSubmit={e => { e.preventDefault(); submit(input); }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }}
              maxLength={2000}
              rows={2}
              disabled={!context}
              placeholder={context ? (sectionLabel ? `Frage zu ${sectionLabel}…` : "Frage zur Analyse…") : "Keine Analyse geladen"}
              className="flex-1 min-w-0 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              data-testid="chat-input"
            />
            <button type="submit" disabled={!context || pending || !input.trim()} className="h-8 w-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40" title="Senden" data-testid="chat-send">
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
          {trimHint && (
            <div className="shrink-0 px-2 pt-1 text-[10px] leading-snug text-muted-foreground" data-testid="chat-context-trimmed">{trimHint}</div>
          )}
          <div className="shrink-0 px-2 pb-1 flex flex-wrap items-center gap-1">
            <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300" data-testid="chat-ai-terms">KI-generiert, keine Anlageberatung</span>
            <span className="text-[9px] text-muted-foreground/70">KI-Antworten nur auf Basis der geladenen Daten · keine Anlageberatung · ändert keine Scores</span>
          </div>
        </>
      )}

      {!win.maximized && !win.minimized && (
        <>
          {edge("e", "top-10 right-0 w-1.5 h-[calc(100%-3.5rem)] cursor-ew-resize touch-none")}
          {edge("w", "top-10 left-0 w-1.5 h-[calc(100%-3.5rem)] cursor-ew-resize touch-none")}
          {edge("s", "bottom-0 left-4 right-4 h-1.5 cursor-ns-resize touch-none")}
          {edge("sw", "bottom-0 left-0 w-4 h-4 cursor-nesw-resize touch-none")}
          <div
            onPointerDown={startPointer("se")} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none"
            data-testid="chat-resize-se" title="Größe ändern"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4 text-muted-foreground/70"><path d="M15 6L6 15M15 10L10 15M15 14L14 15" stroke="currentColor" strokeWidth="1.2" /></svg>
          </div>
        </>
      )}
    </div>
  );
}
