/**
 * Tageslimit des Aktien-Podcasts.
 * Fenster bis zur nächsten Mitternacht Europe/Madrid, Schlüssel ist der Ticker.
 * Gezählt wird nur ein Lauf, der neu erzeugt. Cache-Treffer rufen take() nicht auf.
 */
import { PODCAST_DAILY_MAX } from "../shared/podcast-types";

const stamps = new Map<string, number[]>();

export function resetPodcastDailyLimit(): void {
  stamps.clear();
}

export function madridDayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function madridDateLabel(now: Date): string {
  const key = madridDayKey(now);
  const [year, month, day] = key.split("-");
  return `${day}.${month}.${year}`;
}

function dayStamps(ticker: string, now: Date): number[] {
  const day = madridDayKey(now);
  return (stamps.get(ticker.toUpperCase()) ?? []).filter(ts => madridDayKey(new Date(ts)) === day);
}

export function podcastDailyCount(ticker: string, now: Date): number {
  return dayStamps(ticker, now).length;
}

export function podcastDailyWouldLimit(ticker: string, now: Date, max = PODCAST_DAILY_MAX): boolean {
  return podcastDailyCount(ticker, now) >= max;
}

/** true, wenn der Lauf gezählt wurde. false, wenn das Tageslimit schon voll ist. */
export function podcastDailyTake(ticker: string, now: Date, max = PODCAST_DAILY_MAX): boolean {
  const key = ticker.toUpperCase();
  const kept = dayStamps(key, now);
  if (kept.length >= max) {
    stamps.set(key, kept);
    return false;
  }
  kept.push(now.getTime());
  stamps.set(key, kept);
  return true;
}

export function podcastDailyRefund(ticker: string, now: Date): void {
  const key = ticker.toUpperCase();
  const kept = dayStamps(key, now);
  kept.pop();
  stamps.set(key, kept);
}

export function withStageTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">(resolve => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  p.catch(() => undefined);
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
