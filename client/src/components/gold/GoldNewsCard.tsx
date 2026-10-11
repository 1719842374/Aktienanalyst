import React from "react";
import type { GoldAnalysis } from "../../../../shared/gold-schema";

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

export function GoldNewsCard({ data }: { data: Pick<GoldAnalysis, "goldNews"> }) {
  const news = data.goldNews;
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="gold-news-card">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Gold-News</h2>
          <div className="text-[10px] font-mono tabular-nums text-muted-foreground" data-testid="gold-news-flag">
            Flag {news?.flag == null ? "N/A" : `${num(news.flag)} ${flagWord(news.flag)}`}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="gold-news-summary">
          {news?.summary || "N/A"}
        </p>
        <div className="text-[10px] text-muted-foreground">
          Stand {stamp(news?.updatedAt)}
          {news?.unavailableReason ? ` · ${news.unavailableReason}` : ""}
          {news ? ` · Cache ${news.cacheTtlHours} h` : ""}
        </div>
        {news && news.items.length > 0 && (
          <div className="space-y-1">
            {news.items.slice(0, 8).map((item, index) => (
              <a
                key={`${item.url}-${index}`}
                href={item.url || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-foreground/80 hover:text-amber-500"
              >
                {item.title}
                <span className="text-[10px] text-muted-foreground"> · {item.source || "N/A"}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
