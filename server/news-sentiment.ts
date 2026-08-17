/**
 * news-sentiment.ts
 * Keyword-Sentiment (DE + EN) + LLM-Anti-Bias-Reconcile
 *
 * Zahlen / Daten / Fakten
 * -----------------------
 * Score:  raw = (bullHits − bearHits) / (bullHits + bearHits)  ∈ [−1, +1]
 * Label:  > 0.10 → bullish | < −0.10 → bearish | sonst neutral
 *
 * LYB-Regression 16.08.2026:
 *   "Aktie steigt nach starken Q2-Zahlen" war −100 (LLM-Beispiel score:-1.0).
 *   Mit Keywords (steigt, starken) → +1.0 → grün.
 *
 * Reconcile:
 *   1) |kw| ≥ 0.5 und Vorzeichen ≠ LLM → Keyword gewinnt
 *   2) |LLM| ≥ 0.99 und |kw| ≥ 0.3 und Konflikt → Keyword gewinnt
 *   3) sonst LLM behalten
 */

const BULLISH_WORDS = [
  // EN
  "beat", "surpass", "record", "growth", "surge", "rally", "upgrade", "buy",
  "outperform", "strong", "stronger", "profit", "win", "award", "launch",
  "expand", "positive", "exceed", "raised", "acquire", "acquired", "acquisition",
  "dividend", "buyback", "raises", "rise", "rises", "rising", "gain", "gains",
  "upside", "boost", "boosts", "higher", "beats", "soars", "soar",
  // DE
  "steigt", "steigen", "gestiegen", "stark", "starken", "starke", "wachstum",
  "gewinn", "gewinne", "dividende", "dividendenrendite", "übertrifft", "uebertrifft",
  "rekord", "positiv", "positive", "übernahme", "uebernahme",
  "kauft", "zukauf", "erhöht", "erhoeht", "anhebung", "besser", "bessere",
];

const BEARISH_WORDS = [
  // EN
  "miss", "misses", "fall", "falls", "drop", "drops", "decline", "declines",
  "cut", "cuts", "downgrade", "sell", "underperform", "weak", "loss", "losses",
  "fine", "penalty", "recall", "delay", "delays", "concern", "risk", "layoff",
  "layoffs", "warn", "warning", "plunge", "plunges", "slump", "slumps",
  "lawsuit", "probe", "investigation", "fraud", "default",
  // DE
  "fällt", "faellt", "fallen", "gesunken", "rückgang", "rueckgang", "schwäche",
  "schwaeche", "verlust", "verluste", "warnung", "warnt", "senkt", "kürzung",
  "kuerzung", "entlassung", "klage", "skandal", "pleite", "minus", "schwach",
];

function countWordHits(titleLower: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strict = new RegExp(`(?:^|[^a-zäöüß])${esc}(?:[^a-zäöüß]|$)`, "i");
    const stem =
      w.length >= 5
        ? new RegExp(`(?:^|[^a-zäöüß])[a-zäöüß]*${esc}[a-zäöüß]*`, "i")
        : null;
    if (strict.test(titleLower) || (stem && stem.test(titleLower))) hits += 1;
  }
  return hits;
}

export function scoreHeadlineSentiment(title: string): {
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  bullHits: number;
  bearHits: number;
} {
  const titleLower = (title || "").toLowerCase();
  if (!titleLower.trim()) {
    return { sentiment: "neutral", sentimentScore: 0, bullHits: 0, bearHits: 0 };
  }
  const bullHits = countWordHits(titleLower, BULLISH_WORDS);
  const bearHits = countWordHits(titleLower, BEARISH_WORDS);
  const total = bullHits + bearHits;
  const rawScore = total > 0 ? (bullHits - bearHits) / total : 0;
  const sentimentScore = Math.max(-1, Math.min(1, rawScore));
  const sentiment: "bullish" | "bearish" | "neutral" =
    sentimentScore > 0.1 ? "bullish" : sentimentScore < -0.1 ? "bearish" : "neutral";
  return { sentiment, sentimentScore, bullHits, bearHits };
}

export function applyKeywordSentimentToNews(newsItems: any[]): void {
  if (!newsItems?.length) return;
  for (const item of newsItems) {
    const title = String(item?.title ?? "");
    if (!title) continue;
    const { sentiment, sentimentScore } = scoreHeadlineSentiment(title);
    item.sentiment = sentiment;
    item.sentimentScore = sentimentScore;
    item.sentimentSource = "keyword";
  }
}

export function reconcileNewsSentiment(newsItems: any[]): void {
  if (!newsItems?.length) return;
  for (const item of newsItems) {
    const title = String(item?.title ?? "");
    if (!title) continue;
    const kw = scoreHeadlineSentiment(title);
    const llmScore = typeof item.sentimentScore === "number" ? item.sentimentScore : null;

    if (llmScore == null || item.sentimentSource === "keyword") {
      item.sentiment = kw.sentiment;
      item.sentimentScore = kw.sentimentScore;
      item.sentimentSource = "keyword";
      continue;
    }

    const signKw = Math.sign(kw.sentimentScore);
    const signLlm = Math.sign(llmScore);
    const extremeLlm = Math.abs(llmScore) >= 0.99;
    const decisiveKw = Math.abs(kw.sentimentScore) >= 0.5;
    const conflict = signKw !== 0 && signLlm !== 0 && signKw !== signLlm;

    if ((decisiveKw && conflict) || (extremeLlm && Math.abs(kw.sentimentScore) >= 0.3 && conflict)) {
      item.sentiment = kw.sentiment;
      item.sentimentScore = kw.sentimentScore;
      item.sentimentSource = "keyword_override";
    } else {
      item.sentimentSource = "llm";
    }
  }
}
