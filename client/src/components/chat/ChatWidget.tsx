/**
 * KI-Chatbot-Widget (WORK_DASHBOARD_FEATURES_2026-10.md §4 UI-Anforderungen, §4c gemeinsames Widget).
 * Dashboard-agnostisch: bekommt den Kontext vom Provider des jeweiligen Dashboards
 * (PR 1: nur Aktien, buildStockChatContext). Verschiebbar (Titelleiste), größenveränderbar
 * (Ecken/Ränder), Fenster-Controls (Zurück, Minimieren, Maximieren, Schließen),
 * Position/Größe in localStorage, Sektionsbindung. Kein Score-Einfluss: nur Lesen + Fragen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Crosshair, Loader2, Maximize2, MessageCircle, Minimize2, Minus, Send, Sparkles, X } from "lucide-react";
import type { ChatContext } from "@shared/chat-context";
import { useDashboardChat } from "@/hooks/useDashboardChat";
import {
  chatWindowStorageKey, clampChatWindow, moveChatWindow, parseChatWindow, resizeChatWindow, serializeChatWindow,
  type ChatWindowState, type ResizeEdge,
} from "@/lib/chatWindowGeometry";

export interface ChatWidgetProps {
  dashboard: string;
  context: ChatContext | null;
  sections: Array<{ id: number; label: string }>;
  /** Liefert die aktuell sichtbare Sektion (für „Aktuelle Sektion binden“). */
  getActiveSectionId?: () => number | null;
  /** Springt im Dashboard zu einer Sektion (Antwort-Verweise). */
  onJumpToSection?: (id: number) => void;
  /** Beispiel-Fragen für den Startbildschirm. */
  suggestions?: string[];
}

function viewport() {
  return { vw: typeof window !== "undefined" ? window.innerWidth : 1280, vh: typeof window !== "undefined" ? window.innerHeight : 800 };
}

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function ChatWidget({ dashboard, context, sections, getActiveSectionId, onJumpToSection, suggestions = [] }: ChatWidgetProps) {
  const storageKey = chatWindowStorageKey(dashboard);
  const [win, setWin] = useState<ChatWindowState>(() => { const { vw, vh } = viewport(); return parseChatWindow(readStored(storageKey), vw, vh); });
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const { entries, pending, send, reset } = useDashboardChat(context, sectionId);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "move" | ResizeEdge; sx: number; sy: number; start: ChatWindowState } | null>(null);

  useEffect(() => { try { window.localStorage.setItem(storageKey, serializeChatWindow(win)); } catch { /* privat/voll: ignorieren */ } }, [storageKey, win]);
  useEffect(() => {
    const onResize = () => { const { vw, vh } = viewport(); setWin(w => clampChatWindow(w, vw, vh)); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [entries, pending]);
  // Neues Objekt (anderer Ticker) → Bindung lösen, Verlauf leeren (Antworten bezogen sich auf alte Daten).
  const entity = context?.entity ?? null;
  useEffect(() => { reset(); setSectionId(null); }, [entity, reset]);

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

  const sectionLabel = useMemo(() => sections.find(s => s.id === sectionId)?.label ?? null, [sections, sectionId]);
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
        <button type="button" onClick={() => { reset(); setSectionId(null); }} className="p-1.5 rounded hover:bg-muted" title="Zurück (neuer Chat)" data-testid="chat-back"><ArrowLeft className="w-3.5 h-3.5" /></button>
        <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-xs font-medium truncate flex-1">KI-Chat{context ? ` · ${context.entity}` : ""}{sectionLabel ? ` · ${sectionLabel}` : ""}</span>
        <button type="button" onClick={() => setWin(w => ({ ...w, minimized: !w.minimized, maximized: false }))} className="p-1.5 rounded hover:bg-muted" title={win.minimized ? "Wiederherstellen" : "Minimieren"} data-testid="chat-minimize"><Minus className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => setWin(w => ({ ...w, maximized: !w.maximized, minimized: false }))} className="p-1.5 rounded hover:bg-muted" title={win.maximized ? "Verkleinern" : "Maximieren"} data-testid="chat-maximize">{win.maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
        <button type="button" onClick={() => setWin(w => ({ ...w, open: false }))} className="p-1.5 rounded hover:bg-muted" title="Schließen" data-testid="chat-close"><X className="w-3.5 h-3.5" /></button>
      </div>

      {!win.minimized && (
        <>
          {/* Sektionsbindung */}
          <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-border/60 text-[11px]">
            <label htmlFor="chat-section" className="text-muted-foreground shrink-0">Sektion</label>
            <select
              id="chat-section"
              value={sectionId ?? ""}
              onChange={e => setSectionId(e.target.value === "" ? null : Number(e.target.value))}
              className="flex-1 min-w-0 h-7 rounded border border-border bg-background px-1.5"
              data-testid="chat-section-select"
              disabled={!context}
            >
              <option value="">Ganze Analyse</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.id}. {s.label}</option>)}
            </select>
            {getActiveSectionId && (
              <button type="button" disabled={!context} onClick={() => setSectionId(getActiveSectionId())} className="h-7 px-2 rounded border border-border hover:bg-muted flex items-center gap-1 shrink-0 disabled:opacity-40" title="Aktuell sichtbare Sektion binden" data-testid="chat-bind-visible">
                <Crosshair className="w-3 h-3" /> Aktuelle
              </button>
            )}
          </div>

          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2 text-xs" data-testid="chat-messages">
            {entries.length === 0 && (
              <div className="pt-4 space-y-3 text-center">
                <div className="text-base font-semibold" data-testid="chat-heading">Was sollen wir erkunden?</div>
                {!context ? (
                  <div className="text-muted-foreground">Erst eine Analyse laden – der Chat antwortet auf die geladenen Daten.</div>
                ) : (
                  <div className="flex flex-col gap-1.5 items-stretch">
                    {sectionId != null && (
                      <button type="button" onClick={() => submit(`Erkläre mir Sektion ${sectionId} (${sectionLabel}) detailliert und mit einem konkreten Beispiel aus diesen Daten.`)} className="text-left px-2.5 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20" data-testid="chat-explain-section">
                        Sektion {sectionId} ({sectionLabel}) erklären
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
                <div className={`max-w-[88%] rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words ${m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400" : "bg-muted"}`} data-testid={m.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}>
                  {m.content}
                  {m.sectionRefs && m.sectionRefs.length > 0 && onJumpToSection && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.sectionRefs.map(id => (
                        <button key={id} type="button" onClick={() => onJumpToSection(id)} className="px-1.5 py-0.5 rounded bg-background/60 border border-border text-[10px] hover:bg-background">→ S{id}</button>
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
          <div className="shrink-0 px-2 pb-1 text-[9px] text-muted-foreground/70">KI-Antworten nur auf Basis der geladenen Daten · keine Anlageberatung · ändert keine Scores</div>
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
