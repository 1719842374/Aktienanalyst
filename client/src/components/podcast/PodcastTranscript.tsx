import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { paragraphsOf, PODCAST_MARKET_SYMBOL, type PodcastTranscript } from "@shared/podcast-transcript";

/**
 * Economist-Lesetext für ein lokal gecachtes Transkript.
 * Kein Player-Audio: dafür steht n/a. 375 px bleibt im Fluss, 1440 px in der Spaltenbreite.
 */
export function PodcastTranscript({ symbol }: { symbol: string }) {
  const q = useQuery({
    queryKey: ["podcast-transcript", symbol],
    enabled: !!symbol,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/podcast-transcript/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<PodcastTranscript>;
    },
  });
  const text = q.data?.text ?? null;
  const paragraphs = text ? paragraphsOf(text) : [];
  return (
    <section className="min-w-0 max-w-prose rounded-lg border border-border bg-card/40 px-4 py-3 text-foreground" data-testid="podcast-transcript">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-border px-1.5 py-0.5 text-[9px] tracking-wider text-foreground" data-testid="podcast-narrated-badge">AI NARRATED</span>
        <span className="text-[10px] text-foreground">{symbol === PODCAST_MARKET_SYMBOL ? "Lokaler Cache · Markt-Skript der Pipeline" : `Lokaler Cache · ${symbol}`}</span>
      </div>
      <div className="mt-2 text-[11px] text-foreground" data-testid="podcast-player">n/a — keine Audiodatei im lokalen Cache</div>
      {q.isLoading && <p className="mt-3 text-sm text-foreground">Transkript wird gelesen …</p>}
      {q.isError && <p className="mt-3 text-sm text-foreground">n/a — Transkript nicht erreichbar</p>}
      {q.data && !text && <p className="mt-3 font-serif text-sm leading-7 text-foreground" data-testid="podcast-transcript-na">{q.data.reason ?? "n/a — kein Transkript im lokalen Cache"}</p>}
      {paragraphs.length > 0 && (
        <div className="mt-3 space-y-4 font-serif text-[15px] leading-7 text-foreground" data-testid="podcast-transcript-body">
          {paragraphs.map((p, i) => (
            <p key={i} className={i === 0 ? "first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-5xl first-letter:leading-none" : undefined}>{p}</p>
          ))}
        </div>
      )}
    </section>
  );
}
