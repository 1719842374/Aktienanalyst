/**
 * Gemeinsame News-Liste mit Sentiment (Aktien Sektion 3 "Aktuelle Nachrichten" und Gold-News).
 * Markup 1:1 aus Section2.tsx herausgezogen, damit beide Seiten dieselbe Logik nutzen.
 * Fehlende Felder bleiben ehrlich leer bzw. "n/a"; es wird nichts erfunden.
 */
import React, { type ReactNode } from "react";

export type NewsSentiment = "bullish" | "bearish" | "neutral";

export interface SentimentNewsItem {
  title: string;
  source?: string | null;
  url?: string | null;
  sentiment?: NewsSentiment | string | null;
  sentimentScore?: number | null;
  lang?: string | null;
  relativeTime?: string | null;
  matchedCatalyst?: string | null;
  matchedCatalystIdx?: number | null;
}

export function newsSentimentCounts(items: SentimentNewsItem[]) {
  const bullish = items.filter(n => n.sentiment === "bullish").length;
  const bearish = items.filter(n => n.sentiment === "bearish").length;
  const neutral = items.length - bullish - bearish;
  const avgScore = items.length > 0 ? items.reduce((s, n) => s + (n.sentimentScore || 0), 0) / items.length : 0;
  const overall: NewsSentiment = avgScore > 0.15 ? "bullish" : avgScore < -0.15 ? "bearish" : "neutral";
  return { bullish, bearish, neutral, avgScore, overall };
}

export function newsBoxClass(overall: NewsSentiment): string {
  return overall === "bullish" ? "bg-emerald-500/10 border-emerald-500/20" : overall === "bearish" ? "bg-red-500/10 border-red-500/20" : "bg-card/50 border-border/50";
}

/** Gleiches Format wie server/news-peers.ts (vor X Min./Std., gestern, vor X Tagen, vor X Mon.). */
export function relativeTimeDe(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMins = Math.max(0, Math.floor((now - t) / 60000));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 60) return `vor ${diffMins} Min.`;
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  if (diffDays === 1) return "gestern";
  if (diffDays < 30) return `vor ${diffDays} Tagen`;
  return `vor ${Math.floor(diffDays / 30)} Mon.`;
}

export function NewsSentimentPills({ items }: { items: SentimentNewsItem[] }) {
  const { bullish, bearish, neutral } = newsSentimentCounts(items);
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="news-sentiment-pills">
      {bullish > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">▲ {bullish} bullish</span>}
      {bearish > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">▼ {bearish} bearish</span>}
      {neutral > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/40">● {neutral} neutral</span>}
    </div>
  );
}

export function NewsHeader({ title, items, extra }: { title: string; items: SentimentNewsItem[]; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-sm">📰</span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-foreground/50">({items.length})</span>
        {extra}
      </div>
      <NewsSentimentPills items={items} />
    </div>
  );
}

export function SentimentNewsList({ items, showMissing = false }: { items: SentimentNewsItem[]; showMissing?: boolean }) {
  return (
    <div className="space-y-1">
      {items.map((news, idx) => {
        const sc = news.sentiment;
        const dotColor = sc === "bullish" ? "bg-emerald-400" : sc === "bearish" ? "bg-red-400" : "bg-foreground/30";
        const textColor = sc === "bullish" ? "text-emerald-300/90" : sc === "bearish" ? "text-red-300/90" : "text-foreground/70";
        const scoreStr = news.sentimentScore != null ? (news.sentimentScore > 0 ? `+${(news.sentimentScore * 100).toFixed(0)}` : `${(news.sentimentScore * 100).toFixed(0)}`) : "";
        const lang = news.lang ? news.lang.toLowerCase() : null;
        const time = news.relativeTime || (showMissing ? "n/a" : "");
        return (
          <a
            key={idx}
            href={news.url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/50 transition-colors cursor-pointer"
            data-testid="news-item"
          >
            <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${dotColor}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs leading-snug line-clamp-2 group-hover:text-primary transition-colors ${textColor}`}>
                {news.title}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-foreground/40">{news.source || (showMissing ? "n/a" : "")}</span>
                {lang ? (
                  <span className={`text-[8px] px-1 py-px rounded font-semibold uppercase ${lang === "de" ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400"}`}>
                    {lang}
                  </span>
                ) : showMissing ? (
                  <span className="text-[8px] px-1 py-px rounded font-semibold bg-foreground/5 text-foreground/40">n/a</span>
                ) : null}
                <span className="text-[10px] text-foreground/30">·</span>
                <span className="text-[10px] text-foreground/40">{time}</span>
                {scoreStr && (
                  <span className={`text-[9px] px-1 py-px rounded font-mono ${sc === "bullish" ? "bg-emerald-500/15 text-emerald-400" : sc === "bearish" ? "bg-red-500/15 text-red-400" : "bg-foreground/5 text-foreground/40"}`}>
                    {scoreStr}
                  </span>
                )}
                {news.matchedCatalyst && (
                  <span className="text-[9px] px-1.5 py-px rounded bg-primary/10 text-primary/70 truncate max-w-[140px]" title={news.matchedCatalyst}>
                    → K{(news.matchedCatalystIdx ?? 0) + 1}
                  </span>
                )}
              </div>
            </div>
            <span className="shrink-0 text-foreground/20 group-hover:text-primary text-xs mt-0.5">↗</span>
          </a>
        );
      })}
    </div>
  );
}
