import React from "react";
import type { GoldAnalysis } from "../../../../shared/gold-schema";
import {
  NewsHeader,
  SentimentNewsList,
  newsBoxClass,
  newsSentimentCounts,
  relativeTimeDe,
  type SentimentNewsItem,
} from "../news/SentimentNewsList";

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function flagWord(flag: number | null | undefined): string {
  if (flag == null || !Number.isFinite(flag)) return "N/A";
  if (flag > 0) return "bullish";
  if (flag < 0) return "bearish";
  return "neutral";
}

function flagClass(flag: number | null | undefined): string {
  if (flag == null || !Number.isFinite(flag)) return "bg-foreground/5 text-foreground/40";
  if (flag > 0) return "bg-emerald-500/15 text-emerald-400";
  if (flag < 0) return "bg-red-500/15 text-red-400";
  return "bg-foreground/5 text-foreground/50";
}

/**
 * Gold-News im Stil der Aktien-News ("Aktuelle Nachrichten", Section2) über die gemeinsame
 * SentimentNewsList. Per-Item-Sentiment ist Keyword-basiert (Anzeige). Das LLM-Flag bleibt
 * der Gesamtwert und ist das einzige News-Signal für die adaptive Schicht.
 */
export function GoldNewsCard({ data, now }: { data: Pick<GoldAnalysis, "goldNews">; now?: number }) {
  const news = data.goldNews;
  const items: SentimentNewsItem[] = (news?.items ?? []).slice(0, 8).map(item => ({
    title: item.title,
    source: item.source || null,
    url: item.url || null,
    sentiment: item.sentiment ?? null,
    sentimentScore: typeof item.sentimentScore === "number" ? item.sentimentScore : null,
    lang: item.lang ?? null,
    relativeTime: relativeTimeDe(item.pubDate, now),
  }));
  const box = newsBoxClass(newsSentimentCounts(items).overall);
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="gold-news-card">
      <div className={`m-3 rounded-lg border p-3 ${box}`}>
        <NewsHeader
          title="Gold-News"
          items={items}
          extra={
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono tabular-nums ${flagClass(news?.flag)}`}
              data-testid="gold-news-flag"
              title="Gesamt-Flag aus OpenRouter (−1…+1), leichter Hinweis in der adaptiven Schicht"
            >
              Flag {news?.flag == null ? "N/A" : `${num(news.flag)} ${flagWord(news.flag)}`}
            </span>
          }
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-2" data-testid="gold-news-summary">
          {news?.summary || "N/A"}
        </p>
        {items.length > 0 ? (
          <SentimentNewsList items={items} showMissing />
        ) : (
          <p className="text-[11px] text-muted-foreground italic">Keine Gold-Meldungen verfügbar.</p>
        )}
        <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/40" data-testid="gold-news-stand">
          Stand {stamp(news?.updatedAt)}
          {news?.unavailableReason ? ` · ${news.unavailableReason}` : ""}
          {news ? ` · Cache ${news.cacheTtlHours} h` : ""}
          {items.length > 0 ? " · Sentiment je Meldung: Keyword (Anzeige)" : ""}
        </div>
        {news?.lastGood && (
          <div className="text-[10px] text-amber-400 mt-1" data-testid="gold-news-last-good">
            Letzter guter Stand vom {stamp(news.updatedAt)} · aktueller Abruf: {news.lastGoodReason || "n/a"}
          </div>
        )}
      </div>
    </div>
  );
}
