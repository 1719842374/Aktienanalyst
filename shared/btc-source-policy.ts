/**
 * Quellenregel fuer Sektion 14. Nachrichten und Key-Event-Belege
 * nutzen dieselbe Hostliste. Kein Nachrichtentext und keine erfundenen Meldungen.
 */

export type BtcSourceRole = "Wire" | "Institution" | "Bitcoin" | "Primärquelle";

const MEDIA = [
  { role: "Wire" as const, hosts: ["reuters.com"], names: ["reuters"] },
  { role: "Wire" as const, hosts: ["bloomberg.com"], names: ["bloomberg"] },
  { role: "Institution" as const, hosts: ["ft.com"], names: ["financial times", "ft"] },
  { role: "Institution" as const, hosts: ["theblock.co"], names: ["the block"] },
  { role: "Bitcoin" as const, hosts: ["coindesk.com"], names: ["coindesk", "coin desk"] },
  { role: "Bitcoin" as const, hosts: ["bitcoinmagazine.com"], names: ["bitcoin magazine"] },
  { role: "Institution" as const, hosts: ["blockworks.co"], names: ["blockworks"] },
  { role: "Institution" as const, hosts: ["messari.io"], names: ["messari"] },
  { role: "Institution" as const, hosts: ["glassnode.com"], names: ["glassnode"] },
  { role: "Bitcoin" as const, hosts: ["decrypt.co"], names: ["decrypt"] },
  { role: "Bitcoin" as const, hosts: ["blocktrainer.de"], names: ["blocktrainer"] },
];

const DENY_HOSTS = [
  "cointelegraph.com",
  "newsbtc.com",
  "beincrypto.com",
  "ambcrypto.com",
  "youtube.com",
  "youtu.be",
  "t.me",
  "telegram.me",
  "telegram.org",
  "tagesschau.de",
];

const DENY_NAMES = [
  "cointelegraph",
  "newsbtc",
  "news btc",
  "beincrypto",
  "bein crypto",
  "ambcrypto",
  "amb crypto",
  "youtube",
  "telegram",
  "tagesschau",
];

export function btcSourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function hostIs(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

function normalizedName(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nameHits(source: string | undefined, names: string[]): boolean {
  const name = normalizedName(source);
  if (!name) return false;
  return names.some(alias => (alias.length <= 3 ? name === alias : name === alias || name.includes(alias)));
}

export function isDeniedBtcSource(url: string, sourceName?: string): boolean {
  const host = btcSourceHost(url);
  if (host && DENY_HOSTS.some(denied => hostIs(host, denied))) return true;
  return nameHits(sourceName, DENY_NAMES);
}

/** Amtsdokumente. Medien gehoeren nicht dazu. */
export function isOfficialEvidenceUrl(url: string): boolean {
  const host = btcSourceHost(url);
  if (!host) return false;
  if (hostIs(host, "federalregister.gov")) return true;
  if (hostIs(host, "govinfo.gov")) return true;
  if (hostIs(host, "bafin.de")) return true;
  return host.endsWith(".gov") || host.endsWith(".bund.de");
}

function isPrimaryCitation(url: string): boolean {
  if (isOfficialEvidenceUrl(url)) return true;
  const host = btcSourceHost(url);
  if (!host) return false;
  if (hostIs(host, "bitcoinops.org") || hostIs(host, "bitcoincore.org")) return true;
  if (hostIs(host, "blackrock.com") || hostIs(host, "fidelity.com") || hostIs(host, "bitwiseinvestments.com")) return true;
  if (host !== "github.com") return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.startsWith("/bitcoin/bitcoin") || path.startsWith("/bitcoin/bips");
  } catch {
    return false;
  }
}

function mediaMatch(url: string, sourceName?: string): (typeof MEDIA)[number] | null {
  const host = btcSourceHost(url);
  if (host) {
    const byHost = MEDIA.find(entry => entry.hosts.some(root => hostIs(host, root)));
    if (byHost) return byHost;
  }
  return MEDIA.find(entry => nameHits(sourceName, entry.names)) ?? null;
}

/** true nur fuer die Quellenliste oder eine Primärquelle, die in der URL steht. */
export function isAllowedBtcCitation(url: string, sourceName?: string): boolean {
  if (!url || isDeniedBtcSource(url, sourceName)) return false;
  if (isPrimaryCitation(url)) return true;
  return mediaMatch(url, sourceName) != null;
}

export function btcSourceRole(url: string, sourceName?: string): BtcSourceRole | null {
  if (!isAllowedBtcCitation(url, sourceName)) return null;
  if (isPrimaryCitation(url) && !mediaMatch(url, sourceName)) return "Primärquelle";
  return mediaMatch(url, sourceName)?.role ?? (isPrimaryCitation(url) ? "Primärquelle" : null);
}

export function btcMediaSiteQuery(): string {
  return MEDIA.flatMap(entry => entry.hosts).map(host => `site:${host}`).join(" OR ");
}

export function filterBtcNewsItems<T extends { url: string; source?: string }>(items: T[]): T[] {
  return items.filter(item => isAllowedBtcCitation(item.url, item.source));
}
