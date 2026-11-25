import React from "react";
import type { GoldAnalysis, GoldCentralBankBuying } from "../../../../shared/gold-schema";
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

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** F10-34: Zentralbank-Goldkäufe, nur Anzeige (kein Flag, kein Score). Jeder Eintrag mit Quelle und Datum. */
function CentralBankLine({ cb }: { cb: GoldCentralBankBuying | null | undefined }) {
  const entries = cb?.entries ?? [];
  return (
    <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/40" data-testid="gold-cb-buying">
      <span className="font-medium text-foreground/70">Zentralbank-Goldkäufe (Europa/global, LLM, nur Anzeige):</span>{" "}
      {entries.length === 0 ? (
        <span data-testid="gold-cb-buying-na">n/a · {cb?.unavailableReason || "keine Daten"}</span>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {entries.map((e, i) => (
            <li key={i} data-testid="gold-cb-buying-entry">
              {e.institution} · {e.direction === "buy" ? "Kauf" : "Verkauf"} · {e.tonnes == null ? "Tonnen n/a" : `${e.tonnes.toLocaleString("de-DE")} t`}
              {e.period ? ` · ${e.period}` : ""} ·{" "}
              <a href={e.url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">{e.source}</a>, {day(e.date)}
            </li>
          ))}
        </ul>
      )}
      {cb && (cb.updatedAt || cb.discarded > 0) ? (
        <div className="mt-0.5">
          {cb.updatedAt ? `Stand ${stamp(cb.updatedAt)}` : ""}
          {cb.discarded > 0 ? ` · ${cb.discarded} LLM-Eintrag/Einträge ohne Beleg verworfen` : ""}
        </div>
      ) : null}
    </div>
  );
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
        <CentralBankLine cb={news?.centralBankBuying} />
        {news?.lastGood && (
          <div className="text-[10px] text-amber-400 mt-1" data-testid="gold-news-last-good">
            Letzter guter Stand vom {stamp(news.updatedAt)} · aktueller Abruf: {news.lastGoodReason || "n/a"}
          </div>
        )}
      </div>
    </div>
  );
}
