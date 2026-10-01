/**
 * Key-Event-Titel und Satzfilter fuer Sektion 14.
 * Ein Markdown-Link im Titel ist kein Dokumenttitel. Der Amtshinweis gewinnt,
 * sonst wird der URL-Slug zu einem lesbaren Titel. Der https-Link bleibt
 * nur in der Quelle. Englische Abstracts und Markdown-Saetze fallen weg.
 * Ein deutscher Satz im selben Text bleibt stehen. Kein neues Makro-Narrativ.
 */

const MARKDOWN_TITLE = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)?\s*$/;
const MARKDOWN_SENTENCE = /\[[^\]]*\]\(https?:\/\//;
const BARE_URL = /^https?:\/\/\S+$/;

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

const GERMAN_WORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "einem", "einen",
  "und", "oder", "fuer", "für", "von", "vom", "mit", "auf", "aus", "im", "in", "als",
  "ist", "sind", "wird", "werden", "nicht", "auch", "nur", "durch", "zur", "zum",
  "bei", "nach", "was", "dass", "daß", "sich", "wenn", "weil", "sowie", "deren",
  "dessen", "beim", "ins", "ans", "ueber", "über", "ohne", "unter", "zwischen",
  "hat", "haben", "kann", "koennen", "können", "soll", "sollen", "bleibt",
  "oeffnet", "öffnet", "erhoeht", "erhöht", "senkt", "schlaegt", "schlägt",
]);

const ENGLISH_WORDS = new Set([
  "the", "of", "and", "for", "to", "is", "are", "this", "that", "by", "with", "on",
  "behalf", "from", "its", "their", "which", "under", "into", "these", "those",
  "an", "or", "as", "at", "be", "was", "were", "has", "have", "adopting", "issuing",
]);

export interface NoticeTitle {
  title: string;
  url: string;
}

/** Reiner Markdown-Link, auch wenn die schliessende Klammer am Slice fehlt. */
export function markdownDocumentHref(title: string): string | null {
  const match = title.trim().match(MARKDOWN_TITLE);
  return match ? match[2] : null;
}

export function sameDocumentUrl(a: string, b: string): boolean {
  const key = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    try {
      const parsed = new URL(trimmed);
      const path = decodeURIComponent(parsed.pathname);
      return (parsed.hostname.replace(/^www\./, "") + path).replace(/\/+$/, "").toLowerCase();
    } catch {
      return trimmed.replace(/\/+$/, "").toLowerCase();
    }
  };
  const left = key(a);
  const right = key(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  return shorter.length >= 40 && shorter.includes("/documents/") && longer.startsWith(shorter);
}

/** regulation-d-reserve-requirements-of-depository-institutions → lesbarer Titel. */
export function spacedTitleFromUrl(url: string): string | null {
  let path = url.trim();
  try {
    path = new URL(path).pathname;
  } catch {
    path = path.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0] || "";
  }
  const parts = path.split("/").filter(Boolean);
  let slug = parts[parts.length - 1] || "";
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* Slug bleibt wie gelesen. */
  }
  slug = slug.replace(/\.(html?|pdf)$/i, "");
  if (!slug || slug.length < 8 || /^\d{4}-\d+$/.test(slug)) return null;
  if (!/[-_]/.test(slug)) return null;
  const words = slug.split(/[-_]+/).filter(Boolean);
  if (words.length < 2) return null;
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    if (lower.length === 1) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

/**
 * Dokumenttitel fuer die Kartenueberschrift.
 * Amtshinweis gewinnt, wenn der Modelltitel nur ein Markdown-Link ist.
 * Sonst der Slug. Ein echter Titel bleibt unveraendert.
 */
export function canonicalDocumentTitle(
  title: string,
  url: string | undefined,
  notices: NoticeTitle[] = [],
): string {
  const href = markdownDocumentHref(title);
  if (!href) return title.trim();
  const candidates = [url, href].filter((item): item is string => Boolean(item && item.trim()));
  for (const candidate of candidates) {
    const notice = notices.find(item => item.title.trim() && sameDocumentUrl(item.url, candidate));
    if (notice && !markdownDocumentHref(notice.title)) return notice.title.trim();
  }
  for (const candidate of candidates) {
    const spaced = spacedTitleFromUrl(candidate);
    if (spaced) return spaced;
  }
  return title.trim();
}

export function applyNoticeTitles<T extends { title?: string; evidence?: { url: string }[] }>(
  rows: T[],
  notices: NoticeTitle[],
): T[] {
  return rows.map(row => {
    if (!row.title) return row;
    const url = row.evidence?.find(item => /^https:\/\//i.test(item.url || ""))?.url;
    const title = canonicalDocumentTitle(row.title, url, notices);
    return title === row.title ? row : { ...row, title };
  });
}

function wordHits(text: string, words: Set<string>): number {
  const tokens = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  return tokens.reduce((count, token) => count + (words.has(token) ? 1 : 0), 0);
}

/** Englischer Boilerplate-Satz. Deutsch mit Umlaut oder Funktionswoertern bleibt. */
export function isEnglishOnlyProse(text: string): boolean {
  if (/[äöüÄÖÜß]/.test(text)) return false;
  const german = wordHits(text, GERMAN_WORDS);
  const english = wordHits(text, ENGLISH_WORDS);
  if (german >= 2) return false;
  if (german >= 1 && english === 0) return false;
  return english >= 2 && english > german;
}

export function isMarkdownProse(text: string): boolean {
  const trimmed = text.trim();
  return MARKDOWN_SENTENCE.test(trimmed) || BARE_URL.test(trimmed);
}

/**
 * Unbrauchbare Saetze fallen weg, ein deutscher Rest bleibt.
 * Gibt es keinen deutschen Satz, bleibt der Text leer.
 */
export function usableEventSentences(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const parts = text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean);
  const sentences = parts.length > 0 ? parts : [text.trim()];
  const kept = sentences.filter(sentence => !isMarkdownProse(sentence) && !isEnglishOnlyProse(sentence));
  const joined = kept.join(" ").trim();
  return joined || null;
}

function evidenceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Federal Register und andere Amtsdomains. Nachrichtenseiten gehoeren nicht dazu. */
export function isOfficialEvidenceUrl(url: string): boolean {
  const host = evidenceHost(url);
  if (!host) return false;
  if (host === "federalregister.gov" || host.endsWith(".federalregister.gov")) return true;
  if (host === "govinfo.gov" || host.endsWith(".govinfo.gov")) return true;
  return host.endsWith(".gov");
}

/**
 * Key Events: Amtshinweis oder eine echte blocktrainer.de-Adresse.
 * tagesschau.de und andere Nachrichtenseiten fallen weg. Es wird keine
 * Ersatzkarte erfunden.
 */
export function isAllowedKeyEventUrl(url: string): boolean {
  const host = evidenceHost(url);
  if (!host) return false;
  if (isOfficialEvidenceUrl(url)) return true;
  return host === "blocktrainer.de" || host.endsWith(".blocktrainer.de");
}

export function allowedKeyEventEvidence<T extends { url: string }>(evidence: T[] | undefined): T[] {
  return (evidence ?? []).filter(item => /^https:\/\//i.test(item.url || "") && isAllowedKeyEventUrl(item.url));
}

/** Kundenidentifizierung, Zulassung oder Permitted-Issuer-Rahmen. Kein einzelner Gesetzesname. */
function isIssuanceFrameworkTitle(title: string): boolean {
  return /customer identification|identification program|permitted payment stablecoin issuer|kundenidentifiz|zulassungsrahmen|\blizenz|\blicensing\b/i.test(title);
}

function rateDirection(channels: Record<string, string> | undefined): "up" | "down" | null {
  const votes = [channels?.policyRate, channels?.realYield, channels?.longYield].filter(
    (value): value is "up" | "down" => value === "up" || value === "down",
  );
  const ups = votes.filter(value => value === "up").length;
  const downs = votes.length - ups;
  if (ups > 0 && downs === 0) return "up";
  if (downs > 0 && ups === 0) return "down";
  return null;
}

/**
 * Ein Satz aus dem Dokumenttitel und den Kanaelen, die schon auf der Karte stehen.
 * Ein Zulassungs- oder Identifizierungsrahmen oeffnet die Ausgabe, solange der
 * Kanal das nicht ausdruecklich verneint. Keine Zahl, kein Datum, kein neues Narrativ.
 */
export function germanNoticeBody(title: string, channels: Record<string, string> | undefined): string {
  const label = title.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
  const effects: string[] = [];
  const liquidity = channels?.cryptoLiquidity;
  if (liquidity === "down") {
    effects.push("beschränkt die Stablecoin-Ausgabe und senkt die Krypto-Liquidität");
  } else if (liquidity === "up" || isIssuanceFrameworkTitle(label)) {
    effects.push("öffnet einen Zulassungsrahmen für die Stablecoin-Ausgabe und legitimiert die Krypto-Liquidität");
  }
  const rates = rateDirection(channels);
  if (rates === "up") effects.push("hebt das Zinsniveau");
  if (rates === "down") effects.push("senkt das Zinsniveau");
  if (channels?.inflation === "up") effects.push("hebt den Preisdruck");
  if (channels?.inflation === "down") effects.push("senkt den Preisdruck");
  if (effects.length === 0) {
    return `Der Amtshinweis „${label}“ liegt als belegtes Dokument vor.`;
  }
  const tail = effects.length === 1
    ? effects[0]
    : `${effects.slice(0, -1).join(", ")} und ${effects[effects.length - 1]}`;
  return `Der Amtshinweis „${label}“ ${tail}.`;
}

/** Deutscher Modellsatz gewinnt. Sonst ein Satz nur fuer einen Amtshinweis. */
export function keyEventBody(
  note: string | null | undefined,
  title: string,
  channels: Record<string, string> | undefined,
  evidence: { url: string }[] | undefined,
): string | null {
  const german = usableEventSentences(note);
  if (german) return german;
  if (!(evidence ?? []).some(item => isOfficialEvidenceUrl(item.url))) return null;
  return germanNoticeBody(title, channels);
}
