/**
 * KI-Chatbot-Widget: Fenster-Geometrie (Position/Größe/Zustand) + localStorage-Persistenz
 * (WORK_DASHBOARD_FEATURES_2026-10.md §4 „Position und Größe werden im LocalStorage gespeichert“).
 * Reine Funktionen, damit sie ohne DOM testbar sind.
 */
export interface ChatWindowState {
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
  minimized: boolean;
  maximized: boolean;
}

export const CHAT_WINDOW_MIN = { w: 300, h: 260 } as const;
export const CHAT_WINDOW_DEFAULT_SIZE = { w: 380, h: 520 } as const;
export const CHAT_WINDOW_MARGIN = 16;
export const CHAT_WINDOW_TITLE_H = 40;

export function chatWindowStorageKey(dashboard: string): string {
  return `chatWidget:v1:${dashboard}`;
}

/** Standard: unten rechts (Spec-Screenshot 1), auf kleinen Viewports volle Breite minus Rand. */
export function defaultChatWindow(vw: number, vh: number): ChatWindowState {
  const w = Math.min(CHAT_WINDOW_DEFAULT_SIZE.w, Math.max(CHAT_WINDOW_MIN.w, vw - 2 * CHAT_WINDOW_MARGIN));
  const h = Math.min(CHAT_WINDOW_DEFAULT_SIZE.h, Math.max(CHAT_WINDOW_MIN.h, vh - 2 * CHAT_WINDOW_MARGIN - 64));
  return clampChatWindow({ x: vw - w - CHAT_WINDOW_MARGIN, y: vh - h - CHAT_WINDOW_MARGIN - 56, w, h, open: false, minimized: false, maximized: false }, vw, vh);
}

/** Hält das Fenster im Viewport: Größe ≥ Minimum und ≤ Viewport, Titelleiste immer erreichbar. */
export function clampChatWindow(s: ChatWindowState, vw: number, vh: number): ChatWindowState {
  const maxW = Math.max(CHAT_WINDOW_MIN.w, vw);
  const maxH = Math.max(CHAT_WINDOW_MIN.h, vh);
  const w = Math.round(Math.min(maxW, Math.max(CHAT_WINDOW_MIN.w, s.w)));
  const h = Math.round(Math.min(maxH, Math.max(CHAT_WINDOW_MIN.h, s.h)));
  const x = Math.round(Math.min(Math.max(0, vw - w), Math.max(0, s.x)));
  const y = Math.round(Math.min(Math.max(0, vh - CHAT_WINDOW_TITLE_H), Math.max(0, s.y)));
  return { ...s, x, y, w, h };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseChatWindow(raw: string | null, vw: number, vh: number): ChatWindowState {
  const def = defaultChatWindow(vw, vh);
  if (!raw) return def;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return def;
    const s: ChatWindowState = {
      x: isNum(o.x) ? o.x : def.x, y: isNum(o.y) ? o.y : def.y,
      w: isNum(o.w) ? o.w : def.w, h: isNum(o.h) ? o.h : def.h,
      open: o.open === true, minimized: o.minimized === true, maximized: o.maximized === true,
    };
    return clampChatWindow(s, vw, vh);
  } catch {
    return def;
  }
}

export function serializeChatWindow(s: ChatWindowState): string {
  return JSON.stringify({ x: s.x, y: s.y, w: s.w, h: s.h, open: s.open, minimized: s.minimized, maximized: s.maximized });
}

export function moveChatWindow(s: ChatWindowState, dx: number, dy: number, vw: number, vh: number): ChatWindowState {
  return clampChatWindow({ ...s, x: s.x + dx, y: s.y + dy }, vw, vh);
}

export type ResizeEdge = "se" | "e" | "s" | "w" | "sw";

/** Größenänderung an Ecke/Rand; linke Kanten verschieben x mit, damit die rechte Kante steht. */
export function resizeChatWindow(s: ChatWindowState, edge: ResizeEdge, dx: number, dy: number, vw: number, vh: number): ChatWindowState {
  let { x, w, h } = s;
  if (edge === "se" || edge === "e") w = s.w + dx;
  if (edge === "se" || edge === "s" || edge === "sw") h = s.h + dy;
  if (edge === "w" || edge === "sw") {
    const nw = Math.max(CHAT_WINDOW_MIN.w, s.w - dx);
    x = s.x + (s.w - nw);
    w = nw;
  }
  w = Math.min(w, vw - Math.max(0, x));
  h = Math.min(h, vh - s.y);
  return clampChatWindow({ ...s, x, w, h }, vw, vh);
}
