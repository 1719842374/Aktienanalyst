/**
 * Aktuelle Amtshinweise fuer den Krypto-Regulierungsabruf.
 * Die Suche benutzt nur Themenwoerter. Gesetzesnamen kommen aus den Treffern,
 * nicht aus dem Code. US-Quelle: Federal Register, ohne Schluessel.
 */

export interface OfficialNotice {
  title: string;
  url: string;
  date: string;
  snippet: string;
  office: "treasury" | "central_bank" | "legislature" | "regulator";
  instrumentType: "statute" | "fiscal_program" | "debt_operation";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CRYPTO = /crypto|stablecoin|digital asset|virtual currency/i;
const SRO = /^self-regulatory organizations\b/i;

interface SearchQuery {
  term: string;
  keep: RegExp;
  /** Kurztext zaehlt mit. Nur bei der Krypto-Suche, damit neue Gesetze nicht an einem engen Titel scheitern. */
  inAbstract: boolean;
}

const SEARCHES: SearchQuery[] = [
  { term: "stablecoin", keep: CRYPTO, inAbstract: true },
  { term: "cryptocurrency", keep: CRYPTO, inAbstract: true },
  { term: "reserve requirements", keep: /reserve requirement|extensions of credit|federal funds|discount rate/i, inAbstract: false },
  { term: "redemption operations", keep: /redemption|buyback|marketable treasury/i, inAbstract: false },
];

function daysBefore(asOf: string, days: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "2025-01-01";
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function officeFor(agencies: unknown): OfficialNotice["office"] {
  const list = Array.isArray(agencies) ? agencies : [];
  const slug = list.map(item => {
    const row = asRecord(item);
    return typeof row?.slug === "string" ? row.slug.toLowerCase() : "";
  }).join(" ");
  if (slug.includes("federal-reserve")) return "central_bank";
  if (slug.includes("treasury")) return "treasury";
  if (slug.includes("congress")) return "legislature";
  return "regulator";
}

function typeFor(title: string, snippet: string): OfficialNotice["instrumentType"] {
  const text = `${title} ${snippet}`;
  if (/redemption|buyback|auction|treasury securit/i.test(text)) return "debt_operation";
  if (/appropriation|fiscal program|stimulus|spending bill/i.test(text) && !CRYPTO.test(text)) return "fiscal_program";
  return "statute";
}

export function parseFederalRegisterPage(payload: unknown, keep: RegExp, inAbstract = false): OfficialNotice[] {
  const root = asRecord(payload);
  const results = Array.isArray(root?.results) ? root.results : [];
  const notices: OfficialNotice[] = [];
  for (const item of results) {
    const row = asRecord(item);
    if (!row) continue;
    const title = typeof row.title === "string" ? row.title.trim().replace(/\s+/g, " ") : "";
    const url = typeof row.html_url === "string" ? row.html_url.trim() : "";
    const date = typeof row.publication_date === "string" ? row.publication_date.trim() : "";
    const snippet = typeof row.abstract === "string" ? row.abstract.trim().replace(/\s+/g, " ").slice(0, 280) : "";
    if (title.length < 8 || !DATE.test(date) || !/^https:\/\//i.test(url)) continue;
    if (SRO.test(title)) continue;
    if (!keep.test(title) && !(inAbstract && keep.test(snippet))) continue;
    notices.push({
      title: title.slice(0, 180),
      url,
      date,
      snippet,
      office: officeFor(row.agencies),
      instrumentType: typeFor(title, snippet),
    });
  }
  return notices;
}

async function fetchQuery(term: string, since: string, keep: RegExp, inAbstract: boolean): Promise<OfficialNotice[]> {
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("per_page", "10");
  url.searchParams.set("order", "newest");
  url.searchParams.set("conditions[publication_date][gte]", since);
  url.searchParams.set("conditions[term]", term);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    return parseFederalRegisterPage(await res.json(), keep, inAbstract);
  } catch {
    return [];
  }
}

/** US-Amtssuche. Andere Jurisdiktionen bleiben leer, die Websuche uebernimmt. */
export async function fetchOfficialNotices(jurisdiction: string, asOf: string): Promise<OfficialNotice[]> {
  if (jurisdiction.toUpperCase() !== "US") return [];
  const since = daysBefore(asOf, 540);
  const batches = await Promise.all(SEARCHES.map(q => fetchQuery(q.term, since, q.keep, q.inAbstract)));
  const seen = new Set<string>();
  const merged: OfficialNotice[] = [];
  for (const batch of batches) {
    for (const notice of batch) {
      if (seen.has(notice.url)) continue;
      seen.add(notice.url);
      merged.push(notice);
    }
  }
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return merged.slice(0, 8);
}

export function noticesToRegulationPayload(notices: OfficialNotice[], jurisdiction: string): { regulations: unknown[] } {
  return {
    regulations: notices.map(notice => ({
      id: notice.date + ":" + notice.title.slice(0, 40),
      title: notice.title,
      jurisdiction,
      office: notice.office,
      instrumentType: notice.instrumentType,
      status: "uncertain",
      // Richtung setzt das Modell aus der Wirkung des Hinweises. Hier kein Kanal ohne Textbeleg.
      channels: {},
      note: notice.snippet,
      evidence: [{ source: "Federal Register", url: notice.url, date: notice.date }],
    })),
  };
}

export function isRefusalSummary(summary: string | null): boolean {
  if (!summary) return false;
  return /ohne verifizierte|k[oö]nnen keine|kann keine|keine aktuellen|nicht benannt|nicht genannt/i.test(summary);
}

export function fallbackScanSummary(count: number): string {
  return `Die Amtssuche hat ${count} aktuelle Dokumente zu Krypto-Regeln, Fiskalprogrammen und dem Zinskanal geliefert. Leitzins, Realzins, die 10-Jahres-Rendite und M2 bleiben die gemessenen Werte. Ohne belegten Status bleibt die Wirkung unbestätigt.`;
}

export function mergeByTitle<T extends { title: string }>(primary: T[], extra: T[], cap = 8): T[] {
  const seen = new Set(primary.map(item => item.title.trim().toLowerCase()));
  const out = [...primary];
  for (const item of extra) {
    const key = item.title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (out.length >= cap) break;
    out.push(item);
    seen.add(key);
  }
  return out;
}
