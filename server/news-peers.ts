/**
 * news-peers.ts
 * Google News RSS fetcher, news-to-catalyst matching, peer comparison via FMP.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import type { Catalyst } from "../shared/schema";
import { fmpBatchQuote, fmpRatios, fmpKeyMetrics } from "./fmp";
// parseMarkdownTable is no longer used here since the Perplexity Finance parser
// was removed — FMP peers are the sole peer source now.
// callFinanceToolThrottled kept only as a re-export target for legacy imports.

// ============================================================
// Google News RSS Parser
// ============================================================
export async function fetchNewsFromGoogleRSS(
  ticker: string, companyName: string
): Promise<{ title: string; source: string; pubDate: string; url: string; relativeTime: string; lang?: string }[]> {
  const shortName = companyName.replace(/,? (Inc|Corp|Ltd|LLC|plc|SE|NV|SA|AG|Co)\.?.*$/i, '').trim();

  function parseRssItems(xml: string, lang: string, maxItems: number) {
    const items: { title: string; source: string; pubDate: string; url: string; relativeTime: string; lang: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>([^<]+)<\/title>/);
      const linkMatch = itemXml.match(/<link\/?>(\s*)(https?:\/\/[^\s<]+)/);
      const pubDateMatch = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/);
      if (titleMatch) {
        const fullTitle = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const lastDash = fullTitle.lastIndexOf(' - ');
        const title = lastDash > 0 ? fullTitle.substring(0, lastDash).trim() : fullTitle;
        const source = lastDash > 0 ? fullTitle.substring(lastDash + 3).trim() : 'Google News';
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString();
        const url = linkMatch ? linkMatch[2] : '';
        const diffMs = Date.now() - new Date(pubDate).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        let relativeTime = '';
        if (diffMins < 60) relativeTime = `vor ${diffMins} Min.`;
        else if (diffHours < 24) relativeTime = `vor ${diffHours} Std.`;
        else if (diffDays === 1) relativeTime = 'gestern';
        else if (diffDays < 30) relativeTime = `vor ${diffDays} Tagen`;
        else relativeTime = `vor ${Math.floor(diffDays / 30)} Mon.`;
        items.push({ title, source, pubDate, url, relativeTime, lang });
      }
    }
    return items;
  }

  async function fetchFeed(url: string, label: string): Promise<string> {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockAnalystPro/1.0)' }, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) { console.log(`[NEWS] ${label} returned ${resp.status}`); return ''; }
      return await resp.text();
    } catch (err: any) { console.log(`[NEWS] ${label} failed: ${err?.message?.substring(0, 100)}`); return ''; }
  }

  try {
    const enQuery = encodeURIComponent(`${ticker} ${shortName} stock`);
    const deQuery = encodeURIComponent(`${shortName} Aktie`);
    const [enXml, deXml] = await Promise.all([
      fetchFeed(`https://news.google.com/rss/search?q=${enQuery}&hl=en-US&gl=US&ceid=US:en`, `EN-RSS ${ticker}`),
      fetchFeed(`https://news.google.com/rss/search?q=${deQuery}&hl=de&gl=DE&ceid=DE:de`, `DE-RSS ${ticker}`),
    ]);
    const enItems = parseRssItems(enXml, 'en', 5);
    const deItems = parseRssItems(deXml, 'de', 5);
    const allItems = [...enItems, ...deItems];
    const seen = new Set<string>();
    const dedupItems = allItems.filter(item => {
      const norm = item.title.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').substring(0, 40);
      if (seen.has(norm)) return false;
      seen.add(norm); return true;
    });
    dedupItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const result = dedupItems.slice(0, 10);
    console.log(`[NEWS] ${ticker}: ${result.length} items (${result.filter(i => i.lang === 'en').length} EN + ${result.filter(i => i.lang === 'de').length} DE)`);
    return result;
  } catch (err: any) { console.log(`[NEWS] Google News RSS failed for ${ticker}: ${err?.message?.substring(0, 150)}`); return []; }
}

// ============================================================
// News-to-Catalyst Matching (keyword-based)
// ============================================================
export async function matchNewsToCatalysts(
  newsItems: { title: string; source: string; pubDate: string; url: string; relativeTime: string; sentiment?: string; sentimentScore?: number; matchedCatalyst?: string; matchedCatalystIdx?: number }[],
  catalysts: Catalyst[],
  _ticker?: string,
  _companyName?: string
): Promise<void> {
  if (!newsItems.length || !catalysts.length) return;
  const BULLISH_WORDS = ['beat','surpass','record','growth','surge','rally','upgrade','buy','outperform','strong','profit','win','award','launch','expand','positive','exceed'];
  const BEARISH_WORDS = ['miss','fall','drop','decline','cut','downgrade','sell','underperform','weak','loss','fine','penalty','recall','delay','concern','risk','layoff','warn'];
  const CATALYST_KEYWORDS: Record<string, string[]> = {
    revenue: ['revenue','sales','growth','demand','order','backlog','booking'],
    margin: ['margin','cost','efficiency','operating','leverage','ebitda','profit'],
    'market share': ['market share','competitor','competition','customer','win','contract','displacement'],
    acquisition: ['acqui','merger','partner','deal','joint venture','alliance','agreement'],
    ai: ['ai','artificial intelligence','machine learning','automation','cloud','azure','copilot','llm'],
    product: ['product','launch','platform','cycle','version','upgrade','release','innovation'],
    defense: ['defense','military','contract','government','pentagon','nato','army','navy'],
    regulatory: ['fda','epa','sec','regulation','approve','approval','clearance','ruling'],
    energy: ['energy','solar','wind','battery','ev','electric','renewable','grid','power'],
    dividend: ['dividend','buyback','repurchase','shareholder','return','capital'],
    'interest rate': ['rate','fed','central bank','interest','yield','monetary'],
    demographic: ['demographic','aging','population','healthcare','biotech','drug','therapy'],
  };
  const catKeywords: string[][] = catalysts.map(cat => {
    const catName = cat.name.toLowerCase();
    const kws: string[] = catName.split(/[\s/()]+/).filter(w => w.length > 3);
    for (const [key, words] of Object.entries(CATALYST_KEYWORDS)) { if (catName.includes(key)) kws.push(...words); }
    return kws;
  });
  for (let i = 0; i < newsItems.length; i++) {
    const item = newsItems[i];
    const titleLower = ((item as any).title || (item as any).headline || '').toLowerCase();
    if (!titleLower) continue;
    const bullishHits = BULLISH_WORDS.filter(w => titleLower.includes(w)).length;
    const bearishHits = BEARISH_WORDS.filter(w => titleLower.includes(w)).length;
    const total = bullishHits + bearishHits;
    const rawScore = total > 0 ? (bullishHits - bearishHits) / total : 0;
    item.sentimentScore = Math.max(-1, Math.min(1, rawScore));
    item.sentiment = rawScore > 0.1 ? 'bullish' : rawScore < -0.1 ? 'bearish' : 'neutral';
    let bestCatIdx = -1, bestScore = 0;
    for (let ci = 0; ci < catalysts.length; ci++) {
      const hits = catKeywords[ci].filter(kw => titleLower.includes(kw)).length;
      if (hits > bestScore) { bestScore = hits; bestCatIdx = ci; }
    }
    if (bestCatIdx >= 0 && bestScore >= 1) { item.matchedCatalyst = catalysts[bestCatIdx].name; item.matchedCatalystIdx = bestCatIdx; }
    else if (Math.abs(rawScore) > 0.3 && catalysts.length > 0) { item.matchedCatalyst = catalysts[0].name; item.matchedCatalystIdx = 0; }
  }
  for (let i = 0; i < catalysts.length; i++) {
    const matched = newsItems.filter(n => n.matchedCatalystIdx === i);
    if (!matched.length) continue;
    const cat = catalysts[i];
    cat.newsCount = matched.length;
    cat.posOriginal = cat.pos;
    const avgScore = matched.reduce((s, n) => s + (n.sentimentScore || 0), 0) / matched.length;
    const bullish = matched.filter(n => n.sentiment === 'bullish').length;
    const bearish = matched.filter(n => n.sentiment === 'bearish').length;
    cat.newsSentiment = (bullish > 0 && bearish > 0) ? 'mixed' : avgScore > 0.2 ? 'bullish' : avgScore < -0.2 ? 'bearish' : 'neutral';
    const adjustment = Math.round(avgScore * 5);
    cat.posAdjustment = adjustment;
    cat.pos = Math.max(10, Math.min(85, cat.pos + adjustment));
    cat.nettoUpside = +(cat.bruttoUpside * (1 - cat.einpreisungsgrad / 100)).toFixed(2);
    cat.gb = +(cat.pos / 100 * cat.nettoUpside).toFixed(2);
  }
  console.log(`[NEWS-MATCH] Keyword-matched ${newsItems.filter(n => n.matchedCatalystIdx != null).length}/${newsItems.length} news items to catalysts`);
}

// ============================================================
// Peer-Auswahl: Industry-/Sector-Filter + kuratierter Fallback
// ============================================================
// Auftrag 05.08.2026: FMP /stock-peers liefert Peers rein aus einem
// Korrelations-/Similarity-Modell (Kursbewegung, Marktkapitalisierung), NICHT
// aus Sector/Industry. Live-Beispiel BYDDY: FMP liefert u.a. CFRHF/CFRUY
// (Richemont, Luxury Goods) und CHDRF/CHDRY (Christian Dior, Luxury Goods)
// als "Peers" fuer einen Auto-Hersteller — 6 von 10 FMP-Peers fuer BYDDY
// sind branchenfremd (Luxury Goods/Apparel statt Auto Manufacturers).
//
// Diese Funktion laeuft NACH fmpPeers() und VOR fetchPeerComparisonFromTickers():
// 1. Holt Sector/Industry fuer Subjekt + jeden FMP-Peer via fmpProfile()
//    (parallel, einzelne Calls — /stable/profile unterstuetzt keine
//    Comma-Batch-Symbole, siehe fmpBatchQuote-Kommentar fuer dasselbe Muster).
// 2. Verwirft jeden Peer, dessen Industry NICHT zur Subjekt-Industry passt
//    (siehe isIndustryCompatible) — loggt den Grund ("Industry mismatch: X vs Y").
// 3. Steht der Subjekt-Ticker in der kuratierten Fallback-Map (BYDDY, NIO,
//    LI, XPEV, GELYF), hat die kuratierte NEV-Pure-Play-Liste IMMER Vorrang
//    vor generischen FMP-Industry-Treffern (Owner-Entscheidung 05.08.2026:
//    BMW/Mercedes tragen zwar denselben FMP-Industry-String "Auto -
//    Manufacturers" wie BYDDY, sind aber traditionelle ICE-Hersteller statt
//    NEV-Pure-Plays — sollen nur als Auffuellung dienen, falls die kuratierte
//    Liste selbst < maxPeers Eintraege hat). Fuer alle anderen Subjekte (kein
//    kuratierter Eintrag) bleibt der reine Industry-Filter massgeblich.
// 4. Liefert nie mehr "Fake-Peers": lieber 3 echte als 5 falsche.
// ============================================================

import { fmpProfile } from "./fmp";

/** Branchen, die für Auto-/EV-Hersteller garantiert branchenfremd sind — auch
 *  wenn FMP sie (Kursbewegungs-Korrelation) als "Peer" ausspielt. */
const LUXURY_INDUSTRY_BLOCKLIST = [
  "luxury goods", "apparel", "apparel manufacturing", "apparel retail",
  "jewelry", "watches", "footwear", "fashion", "textile", "department stores",
];

/** Kuratierte Fallback-Peers für bekannte Problemfälle, bei denen FMPs
 *  Similarity-Modell systematisch branchenfremde Ergebnisse liefert (v.a.
 *  chinesische NEV-ADRs, die FMP mit anderen China-ADRs/Luxusmarken statt
 *  echten Auto-/EV-Herstellern gruppiert). Nur ADRs/US-Listings, die FMP
 *  auch mit Financials/ROIC beliefern kann (Regel #3 im Auftrag). Greift NUR,
 *  wenn die FMP-Peers den Industry-Filter nicht bestehen (siehe Regel #4).
 */
const CURATED_PEER_FALLBACK: Record<string, string[]> = {
  BYDDY: ["TSLA", "NIO", "LI", "XPEV", "GELYF"],
  NIO: ["BYDDY", "LI", "XPEV", "TSLA", "GELYF"],
  LI: ["BYDDY", "NIO", "XPEV", "TSLA", "GELYF"],
  XPEV: ["BYDDY", "NIO", "LI", "TSLA", "GELYF"],
  GELYF: ["BYDDY", "TSLA", "NIO", "LI", "XPEV"],
};

/**
 * Grobe Industry-Kompatibilitaets-Pruefung. Exact-Match ODER beide Seiten
 * enthalten denselben Auto-/EV-Wortstamm. Bewusst konservativ (Substring statt
 * Taxonomie-Tabelle) — FMPs Industry-Strings sind uneinheitlich genug
 * ("Auto - Manufacturers", "Auto Manufacturers", "Electric Vehicle Industry"),
 * dass ein exaktes Enum schnell veraltet. Substring-Match auf normalisierten
 * (lowercase, Bindestriche entfernt) Strings deckt alle beobachteten FMP-
 * Varianten ab, ohne bei jedem FMP-Naming-Wechsel neu gepflegt werden zu muessen.
 */
function normaliseIndustry(s: string): string {
  return s.toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
}

const AUTO_EV_KEYWORDS = ["auto", "vehicle", "ev ", " ev", "electric vehicle"];

function isAutoEvIndustry(industry: string): boolean {
  const n = normaliseIndustry(industry);
  return AUTO_EV_KEYWORDS.some(k => n.includes(k.trim()));
}

function isLuxuryIndustry(industry: string): boolean {
  const n = normaliseIndustry(industry);
  return LUXURY_INDUSTRY_BLOCKLIST.some(l => n.includes(l));
}

/**
 * Sector/Industry-Kompatibilitaet zwischen Subjekt und Kandidat-Peer.
 *  - Wenn das Subjekt ein Auto-/EV-Hersteller ist: Kandidat MUSS ebenfalls
 *    Auto/EV sein. Luxury/Apparel/Jewelry/Watches/Fashion sind PFLICHT-
 *    ausgeschlossen, selbst wenn der generische Sector (Consumer Cyclical)
 *    zufaellig uebereinstimmt (Regel #2 im Auftrag).
 *  - Sonst: exakter Industry-Match ODER exakter Sector-Match als Mindestmass
 *    (deckt AAPL/MSFT-Kontrollfaelle ab, ohne branchenfremde Auto-Ticker
 *    durchzulassen).
 */
function isIndustryCompatible(
  subjectSector: string,
  subjectIndustry: string,
  candidateSector: string,
  candidateIndustry: string
): { ok: boolean; reason: string } {
  const subjIsAutoEv = isAutoEvIndustry(subjectIndustry);

  if (subjIsAutoEv) {
    if (isLuxuryIndustry(candidateIndustry)) {
      return { ok: false, reason: `Industry mismatch: ${candidateIndustry} (Luxury Goods) vs ${subjectIndustry} (Auto/EV)` };
    }
    if (!isAutoEvIndustry(candidateIndustry)) {
      return { ok: false, reason: `Industry mismatch: ${candidateIndustry} vs ${subjectIndustry} (Auto/EV)` };
    }
    return { ok: true, reason: "Auto/EV-Industry-Match" };
  }

  // Generischer Fall (nicht Auto/EV-Subjekt): exakter Industry- ODER
  // Sector-Match als Mindestanforderung — verhindert branchenfremde Peers
  // (z.B. Auto-Ticker als "Peer" fuer AAPL/MSFT), ohne die enge Auto/EV-
  // Sonderregel auf alle anderen Branchen auszudehnen.
  const nSubjInd = normaliseIndustry(subjectIndustry);
  const nCandInd = normaliseIndustry(candidateIndustry);
  const nSubjSec = normaliseIndustry(subjectSector);
  const nCandSec = normaliseIndustry(candidateSector);

  if (nSubjInd && nCandInd && nSubjInd === nCandInd) {
    return { ok: true, reason: "Exact Industry-Match" };
  }
  if (nSubjSec && nCandSec && nSubjSec === nCandSec) {
    return { ok: true, reason: "Sector-Match" };
  }
  return { ok: false, reason: `Industry mismatch: ${candidateIndustry || "unbekannt"} (${candidateSector || "unbekannt"}) vs ${subjectIndustry || "unbekannt"} (${subjectSector || "unbekannt"})` };
}

/**
 * Filtert eine rohe FMP-/stock-peers-Ticker-Liste nach Sector/Industry-
 * Kompatibilitaet mit dem Subjekt und greift bei Bedarf auf eine kuratierte
 * Fallback-Liste zurueck (nur wenn der Filter zu wenige Treffer liefert).
 *
 * WICHTIG: reine Verdrahtungs-/Filterschicht — ROIC-Berechnung, Scoring-Gate-
 * Logik und die uebrigen Peer-Spalten (pe/peg/ps/pb/epsGrowth) bleiben
 * unveraendert; diese Funktion aendert nur, WELCHE Ticker in die Pipeline
 * gelangen, nicht WIE sie berechnet werden.
 */
export async function filterAndSelectPeers(
  subjectTicker: string,
  subjectSector: string,
  subjectIndustry: string,
  rawPeerTickers: string[],
  maxPeers: number = 5
): Promise<string[]> {
  const upperSubject = subjectTicker.toUpperCase();

  // Kandidaten begrenzen (FMP liefert bis zu 10) — genug Spielraum, dass nach
  // dem Filter i.d.R. noch >= 3 uebrig bleiben, ohne unnoetig viele Profile-
  // Calls zu machen.
  const candidates = rawPeerTickers.slice(0, 10);
  if (candidates.length === 0) {
    return CURATED_PEER_FALLBACK[upperSubject]?.slice(0, maxPeers) ?? [];
  }

  let candidateProfiles: Array<{ symbol: string; sector: string; industry: string } | null>;
  try {
    candidateProfiles = await Promise.all(
      candidates.map(async (sym) => {
        try {
          const p = await fmpProfile(sym);
          if (!p) return null;
          return { symbol: sym, sector: String(p.sector ?? ""), industry: String(p.industry ?? "") };
        } catch {
          return null;
        }
      })
    );
  } catch {
    candidateProfiles = candidates.map(() => null);
  }

  const filtered: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const sym = candidates[i];
    const prof = candidateProfiles[i];
    if (!prof) {
      console.log(`[PEERS] ${upperSubject}: ${sym} verworfen — Profil nicht abrufbar`);
      continue;
    }
    const check = isIndustryCompatible(subjectSector, subjectIndustry, prof.sector, prof.industry);
    if (check.ok) {
      filtered.push(sym);
    } else {
      console.log(`[PEERS] ${upperSubject}: ${sym} verworfen — ${check.reason}`);
    }
    // Kein fruehes Abbrechen mehr bei maxPeers hier — wir brauchen ALLE
    // branchengerechten Kandidaten, um sie unten ggf. mit der kuratierten
    // Liste zu kombinieren (Auffuell-Reihenfolge), statt sie zu verwerfen.
  }

  // Owner-Entscheidung (05.08.2026): fuer Subjekte mit kuratierter NEV-
  // Fallback-Liste (BYDDY, NIO, LI, XPEV, GELYF) hat die kuratierte Liste
  // IMMER Vorrang vor generischen FMP-Industry-Treffern wie BMW/Mercedes
  // (die zwar denselben FMP-Industry-String "Auto - Manufacturers" tragen,
  // aber traditionelle ICE-Hersteller statt NEV-Pure-Plays sind). FMP-Treffer
  // dienen hier nur noch als Auffuellung, falls die kuratierte Liste selbst
  // < maxPeers Eintraege hat (z.B. GELYF vergriffen). Fuer alle anderen
  // Subjekte (kein kuratierter Eintrag) bleibt der reine Industry-Filter
  // massgeblich — siehe Regel #5 im Auftrag: "lieber weniger Peers als
  // falsche", kein Fake-Auffuellen mit branchenfremden Tickern.
  const curated = CURATED_PEER_FALLBACK[upperSubject];
  if (curated) {
    const combined = [...curated];
    for (const sym of filtered) {
      if (combined.length >= maxPeers) break;
      if (!combined.includes(sym)) combined.push(sym);
    }
    console.log(`[PEERS] ${upperSubject}: kuratierte NEV-Peer-Liste verwendet (${curated.length} kuratiert${filtered.length > 0 ? `, ${Math.max(0, combined.length - curated.length)} FMP-Treffer aufgefuellt` : ""})`);
    return combined.slice(0, maxPeers);
  }

  return filtered.slice(0, maxPeers);
}

// ============================================================
// Peer Comparison via FMP (fast path)
// ============================================================
// Peer comparison fed by FMP only. WORK_SCORING_VORLAGE / relative-valuation
// docs require every peer column to be populated when the data is available
// (per-share ratios are computed from FMP /ratios rows chronologically).
//
// Fields expected by the Rel. Bewertung section (Section 7):
//   subject: { ticker, name, pe, peg, ps, pb, epsGrowth1Y, epsGrowth5Y,
//              marketCap, revenueGrowth }
//   peers:   same shape
//   peerAvg: { pe, peg, ps, pb, epsGrowth1Y, epsGrowth5Y }
//
// The 5Y CAGR needs ≥6 annual ratio rows (start + 5 growth periods), the 1Y
// YoY needs 2 rows, so we fetch 6. FMP /stable/ratios returns rows sorted
// most-recent first.
// ============================================================
// ROIC (Return on Invested Capital) — Subjekt + Peers
// ============================================================
// FMP liefert ROIC direkt als `returnOnInvestedCapital` in /stable/key-metrics
// (0..1-Skala, hier ×100 fuer %-Anzeige). War bisher NIRGENDS im Code genutzt:
// fmpKeyMetrics() wurde importiert und sogar schon fuer den Fallback-Pfad
// aufgerufen (analyze-helpers.ts), aber das Ergebnis wurde beim Destrukturieren
// mit einem leeren Slot (",") verworfen. Im primaeren Analyze-Pfad wurde die
// Funktion gar nicht erst aufgerufen. Diese Datei ergaenzt additiv einen
// eigenen ROIC-Fetch fuer Subjekt + Peers inkl. Fiskaljahr/Datum, damit die
// Rel.-Bewertung-Tabelle eine echte Kapitalrendite-Spalte zeigen kann statt
// gar keine.
export interface RoicPoint {
  roicPercent: number | null;   // returnOnInvestedCapital × 100, oder null wenn nicht berechenbar
  fiscalYear: string | null;    // z.B. "2025"
  periodDate: string | null;    // z.B. "2025-09-27" — fuer Datenaktualitaets-Anzeige
  // Auftrag 05.08.2026 (Peer-Vergleich: zwei ROIC-Spalten): arithmetischer
  // Durchschnitt ueber die letzten bis zu 5 verfuegbaren Geschaeftsjahre.
  // null, wenn < 3 Jahre mit einem echten numerischen Wert vorliegen (siehe
  // MIN_ROIC_5Y_YEARS unten) — NIEMALS 0 als Platzhalter fuer "zu wenig Daten".
  roic5YPercent: number | null;
  // Anzahl der Jahre, die tatsaechlich in den 5Y-Durchschnitt eingeflossen
  // sind (3, 4 oder 5) — fuer den UI-Tooltip ("Durchschnitt aus 4 Jahren").
  roic5YYearsUsed: number;
}

/** Mindestanzahl an Jahren mit echtem numerischem ROIC-Wert, damit ROIC 5Y
 *  ueberhaupt einen Durchschnitt zeigt (statt "n/a") — Regel #2 im Auftrag
 *  05.08.2026 ("Wenn < 3 Jahre verfuegbar -> n/a"). */
const MIN_ROIC_5Y_YEARS = 3;
/** Maximale Anzahl Jahre, die in den 5Y-Durchschnitt einfliessen. */
const MAX_ROIC_5Y_YEARS = 5;

/** Einzelne rohe returnOnInvestedCapital-Extraktion aus einer FMP-key-metrics-
 *  Zeile. NULL/undefined bleibt NULL (niemals 0) — Number(null) waere 0, also
 *  muss explizit auf null/undefined geprueft werden, BEVOR Number() aufgerufen
 *  wird, sonst wird "keine Daten" faelschlich als "ROIC = 0 %" interpretiert. */
export function extractRoicPercentFromRow(row: any): number | null {
  if (!row) return null;
  const field = row.returnOnInvestedCapital;
  const raw = field == null ? NaN : Number(field);
  return isFinite(raw) ? +(raw * 100).toFixed(1) : null;
}

export function extractRoicFromKeyMetricsRows(rows: any[]): RoicPoint {
  const arr = Array.isArray(rows) ? rows : [];
  const latest = arr[0];
  if (!latest) {
    return { roicPercent: null, fiscalYear: null, periodDate: null, roic5YPercent: null, roic5YYearsUsed: 0 };
  }
  const roicPercent = extractRoicPercentFromRow(latest);

  // ROIC 5Y: arithmetischer Durchschnitt ueber die letzten bis zu 5 Jahre.
  // Nur Jahre mit einem echten numerischen Wert fliessen ein (null/undefined
  // werden UEBERSPRUNGEN, nicht als 0 gezaehlt — Regel #2 im Auftrag).
  // Negative Werte und 0 werden normal einbezogen (kein Ausfiltern nach
  // Groesse) — auch ein Jahr mit ROIC=-940% (echter Datenausreisser, z.B.
  // Sondereffekt) zaehlt als gueltiger Datenpunkt, nicht als fehlend.
  const window = arr.slice(0, MAX_ROIC_5Y_YEARS);
  const yearValues = window
    .map(r => extractRoicPercentFromRow(r))
    .filter((v): v is number => v !== null);
  const roic5YPercent = yearValues.length >= MIN_ROIC_5Y_YEARS
    ? +(yearValues.reduce((a, b) => a + b, 0) / yearValues.length).toFixed(1)
    : null;

  return {
    roicPercent,
    fiscalYear: latest.fiscalYear != null ? String(latest.fiscalYear) : null,
    periodDate: typeof latest.date === "string" ? latest.date : null,
    roic5YPercent,
    roic5YYearsUsed: yearValues.length,
  };
}

/**
 * ROIC fuer das Subjekt UND alle Peers in EINEM Batch (parallel), damit die
 * Rel.-Bewertung-Tabelle eine konsistente Spalte fuellen kann. Holt bis zu
 * MAX_ROIC_5Y_YEARS (5) Jahre Historie in EINEM Call pro Ticker (kein
 * zusaetzlicher Call fuer den 5Y-Durchschnitt — derselbe /key-metrics-
 * Endpoint liefert sowohl den aktuellen FY-Wert als auch die Historie).
 */
export async function fetchRoicForTickers(
  tickers: string[]
): Promise<Record<string, RoicPoint>> {
  const out: Record<string, RoicPoint> = {};
  if (tickers.length === 0) return out;
  const rows = await Promise.all(
    tickers.map(t => fmpKeyMetrics(t, MAX_ROIC_5Y_YEARS).catch(() => []))
  );
  tickers.forEach((t, i) => {
    const arr: any[] = Array.isArray(rows[i]) ? rows[i] : [];
    out[t] = extractRoicFromKeyMetricsRows(arr);
  });
  return out;
}

export async function fetchPeerComparisonFromTickers(
  ticker: string,
  peerTickers: string[],
  pe: number,
  peg: number,
  revenue: number,
  marketCap: number,
  revenueGrowth: number,
  epsGrowth5Y: number,
  subjectExtras?: { pb?: number | null; epsGrowth1Y?: number | null }
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    const [quotes, ratiosPerPeer, roicByTicker, subjectRoic] = await Promise.all([
      fmpBatchQuote(peerTickers),
      Promise.all(peerTickers.map(t => fmpRatios(t, 6).catch(() => []))),
      // ROIC additiv: bisher komplett fehlend (fmpKeyMetrics wurde importiert,
      // aber das Ergebnis nirgends verwendet). Ein Batch fuer alle Peers +
      // Subjekt zusammen, damit die Tabelle konsistent befuellt ist.
      fetchRoicForTickers(peerTickers),
      fetchRoicForTickers([ticker]).then(r => r[ticker]),
    ]);
    const quoteByTicker = new Map<string, any>((quotes || []).map((q: any) => [q.symbol, q]));

    // Small helper to CAGR two same-unit per-share values across `years`.
    // Sign-safe: skips negatives (can't take fractional power of a negative).
    const cagr = (endValue: number | undefined, startValue: number | undefined, years: number): number | null => {
      if (!endValue || !startValue || years <= 0) return null;
      if (endValue <= 0 || startValue <= 0) return null;
      return +((Math.pow(endValue / startValue, 1 / years) - 1) * 100).toFixed(1);
    };

    const peers: any[] = [];
    peerTickers.forEach((t, idx) => {
      const q = quoteByTicker.get(t);
      const ratios: any[] = Array.isArray(ratiosPerPeer[idx]) ? ratiosPerPeer[idx] : [];
      const r0 = ratios[0]; const r1 = ratios[1];

      // Valuation multiples — prefer /ratios, fall back to quote-derived P/E.
      const peerPE = Number(r0?.priceToEarningsRatio ?? r0?.priceEarningsRatio ?? 0)
        || (q?.price && q?.eps > 0 ? q.price / q.eps : null);
      const peerPS = Number(r0?.priceToSalesRatio ?? 0) || null;
      const peerPB = Number(r0?.priceToBookRatio ?? 0) || null;

      // EPS 1Y YoY — uses netIncomePerShare (diluted EPS proxy).
      let epsGrowth1Y: number | null = null;
      if (r0?.netIncomePerShare != null && r1?.netIncomePerShare != null && r1.netIncomePerShare > 0) {
        epsGrowth1Y = +(((r0.netIncomePerShare / r1.netIncomePerShare) - 1) * 100).toFixed(1);
      }

      // EPS 5Y CAGR — needs 6 rows (start + 5 growth years). Ratios come newest
      // first, so oldest is the last element. Use up to 5-year lookback.
      let epsGrowth5Y_peer: number | null = null;
      if (ratios.length >= 3) {
        const endEps = r0?.netIncomePerShare;
        const lookback = Math.min(5, ratios.length - 1);
        const startEps = ratios[lookback]?.netIncomePerShare;
        epsGrowth5Y_peer = cagr(endEps, startEps, lookback);
      }

      // Revenue growth (YoY) — revenuePerShare is share-count-neutral.
      let revenueGrowthPeer: number | null = null;
      if (r0?.revenuePerShare != null && r1?.revenuePerShare != null && r1.revenuePerShare > 0) {
        revenueGrowthPeer = +(((r0.revenuePerShare / r1.revenuePerShare) - 1) * 100).toFixed(1);
      }

      // PEG for the peer: prefer forward-ish 1Y growth if positive, else 5Y CAGR.
      const growthForPEG = epsGrowth1Y && epsGrowth1Y > 0
        ? epsGrowth1Y
        : (epsGrowth5Y_peer && epsGrowth5Y_peer > 0 ? epsGrowth5Y_peer : (epsGrowth5Y > 0 ? epsGrowth5Y : null));
      const peerPEG = peerPE && growthForPEG && growthForPEG > 0
        ? +(peerPE / growthForPEG).toFixed(2)
        : null;

      if (!q && !r0) return;
      const peerRoic = roicByTicker[t];
      peers.push({
        ticker: t,
        name: q?.name || t,
        pe: peerPE ? +Number(peerPE).toFixed(1) : null,
        peg: peerPEG,
        ps: peerPS ? +Number(peerPS).toFixed(1) : null,
        pb: peerPB ? +Number(peerPB).toFixed(1) : null,
        epsGrowth1Y,
        epsGrowth5Y: epsGrowth5Y_peer,
        marketCap: q?.marketCap || null,
        revenueGrowth: revenueGrowthPeer,
        roic: peerRoic?.roicPercent ?? null,
        roicFiscalYear: peerRoic?.fiscalYear ?? null,
        // Auftrag 05.08.2026: zweite ROIC-Spalte (5Y-Durchschnitt). null,
        // wenn < 3 Jahre mit echtem Wert vorliegen — UI zeigt dann "n/a",
        // niemals 0 %.
        roic5Y: peerRoic?.roic5YPercent ?? null,
        roic5YYearsUsed: peerRoic?.roic5YYearsUsed ?? 0,
      });
    });

    const validPeers = peers.filter(p => p.pe !== null || p.ps !== null || p.pb !== null).slice(0, 6);
    console.log(`[PEERS-FMP] Valid peers: ${validPeers.length}/${peers.length} (with growth series)`);
    if (validPeers.length === 0) return null;

    // Average helper: filters nulls/NaN and clamps to a sensible range so a
    // single outlier peer with pb=-153 doesn't destroy the peer-avg PB.
    const avg = (arr: (number | null)[], lo = -1000, hi = 1000): number | null => {
      const valid = arr.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > lo && v < hi);
      return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null;
    };

    const ps = revenue > 0 && marketCap > 0 ? +(marketCap / revenue).toFixed(1) : null;
    const subject = {
      ticker,
      name: ticker,
      pe: pe > 0 ? +pe.toFixed(1) : null,
      peg: peg > 0 ? +peg.toFixed(2) : null,
      ps,
      pb: subjectExtras?.pb != null && subjectExtras.pb > 0 ? +Number(subjectExtras.pb).toFixed(1) : null,
      epsGrowth1Y: subjectExtras?.epsGrowth1Y != null && isFinite(subjectExtras.epsGrowth1Y) ? +Number(subjectExtras.epsGrowth1Y).toFixed(1) : null,
      epsGrowth5Y: epsGrowth5Y > 0 ? +epsGrowth5Y.toFixed(1) : null,
      marketCap,
      revenueGrowth: revenueGrowth ? +revenueGrowth.toFixed(1) : null,
      roic: subjectRoic?.roicPercent ?? null,
      roicFiscalYear: subjectRoic?.fiscalYear ?? null,
      roic5Y: subjectRoic?.roic5YPercent ?? null,
      roic5YYearsUsed: subjectRoic?.roic5YYearsUsed ?? 0,
    };
    const peerAvg = {
      pe: avg(validPeers.map(p => p.pe), 0, 500),
      peg: avg(validPeers.map(p => p.peg), 0, 20),
      ps: avg(validPeers.map(p => p.ps), 0, 100),
      // PB avg tolerates positives only — negative book value peers (DOCN) are outliers.
      pb: avg(validPeers.map(p => p.pb).map(v => v && v > 0 ? v : null), 0, 200),
      epsGrowth1Y: avg(validPeers.map(p => p.epsGrowth1Y), -100, 300),
      epsGrowth5Y: avg(validPeers.map(p => p.epsGrowth5Y), -100, 300),
      // ROIC-Range statt Avg allein tolerant: negative ROIC (Turnaround-Peers)
      // sind real und sollen NICHT als Ausreisser gefiltert werden — nur NaN/Inf raus.
      roic: avg(validPeers.map(p => p.roic), -500, 500),
      // Gleiche Toleranz-Range wie roic oben — 5Y-Durchschnitte koennen durch
      // einzelne Ausreisser-Jahre (z.B. Sondereffekte) genauso stark ausschlagen.
      roic5Y: avg(validPeers.map(p => p.roic5Y), -500, 500),
    };
    return { subject, peers: validPeers, peerAvg };
  } catch (err: any) {
    console.error(`[PEERS-FMP] Failed for ${ticker}: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}

// ============================================================
// Peer Comparison Fetcher (full path with EPS history)
// ============================================================
export async function fetchPeerComparison(
  ticker: string, companyName: string, pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number,
  fmpPeerTickers: string[] = []
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    if (fmpPeerTickers.length > 0) {
      console.log(`[PEERS] Using ${fmpPeerTickers.length} FMP peer tickers for ${ticker}`);
      return fetchPeerComparisonFromTickers(ticker, fmpPeerTickers, pe, peg, revenue, marketCap, revenueGrowth, epsGrowth5Y);
    }
    // Legacy fallback path used the Perplexity Finance external-tool to discover
    // peers when FMP peers were empty. That tool is gone — the FMP peer list
    // (fmpPeers) is the only source now. If it's empty, there's no peer view.
    console.log(`[PEERS] No FMP peer tickers for ${ticker} — skipping peer comparison`);
    return null;
  } catch (err: any) { console.log(`[PEERS] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`); return null; }
}
