export interface SegmentGapItem {
  parent: string;
  kind: "product" | "geographic";
  name: string;
  shareOfParentPct: number | null;
  growthPct: number | null;
  basis: string;
  /** fact = Umsatz / Elternumsatz in derselben Währung. null = nicht belegbar. */
  shareOrigin?: "fact" | "estimate" | null;
  /** Sichtbarer Grund, wenn shareOfParentPct null ist. */
  shareNote?: string | null;
  /** Interner Hinweis aus der Modellantwort. Das Panel liest das Feld nicht. */
  hostHint?: string | null;
}

export interface SegmentGapResult {
  items: SegmentGapItem[];
  reason: string | null;
  /** Prompt-Stand, damit ein Client eine alte Antwort von einer neuen unterscheidet. */
  promptVersion?: string | null;
  /** true, wenn der Handler die gespeicherte Antwort ausliefert. */
  cached?: boolean;
  /** Eltern, die in dieser Anfrage an die KI oder den Cache gingen. */
  queried?: number | null;
  /** Eltern dieser Anfrage, einschließlich der nicht abgefragten. */
  total?: number | null;
  /**
   * parent_not_listed, wenn die Zeile den n/a-Satz schon selbst zeigt.
   * Das Panel liest dieses Feld nicht.
   */
  internalReason?: string | null;
}

/** Gleicher Schlüssel für „A & B“ und „A and B“. Kein Ticker-Mapping. */
export function segmentGapKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Allgemeine Geografie für Segmentberichte. Kein Firmen- oder Ticker-Mapping.
 * Ein Land enthält keine andere Region. Makroregionen enthalten ihre Mitglieder, auch über Zwischenstufen.
 */
const DIRECT_MEMBERS: Record<string, readonly string[]> = {
  "north america": ["united states", "canada", "mexico"],
  "latin america": ["mexico", "brazil", "argentina", "chile", "colombia", "peru"],
  "south america": ["brazil", "argentina", "chile", "colombia", "peru"],
  americas: ["north america", "latin america", "south america"],
  europe: [
    "germany", "france", "united kingdom", "italy", "spain", "netherlands", "sweden", "switzerland",
    "poland", "austria", "belgium", "ireland", "norway", "denmark", "finland", "portugal", "greece",
    "czechia", "romania", "hungary",
  ],
  "middle east": ["saudi arabia", "united arab emirates", "israel", "qatar", "kuwait", "turkey"],
  africa: ["south africa", "egypt", "nigeria", "morocco", "kenya"],
  emea: ["europe", "middle east", "africa"],
  asia: [
    "china", "japan", "india", "south korea", "taiwan", "hong kong", "singapore", "indonesia",
    "malaysia", "thailand", "vietnam", "philippines",
  ],
  "asia pacific": ["asia", "australia", "new zealand"],
  "greater china": ["china", "hong kong", "taiwan"],
  international: ["americas", "emea", "asia pacific"],
  "rest of world": ["americas", "emea", "asia pacific"],
};

const GEO_ALIAS: Record<string, string> = {
  us: "united states",
  "u s": "united states",
  "u s a": "united states",
  usa: "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  "u k": "united kingdom",
  britain: "united kingdom",
  "great britain": "united kingdom",
  uae: "united arab emirates",
  "u a e": "united arab emirates",
  prc: "china",
  "mainland china": "china",
  "peoples republic of china": "china",
  "people s republic of china": "china",
  apac: "asia pacific",
  korea: "south korea",
  "republic of korea": "south korea",
  holland: "netherlands",
  "czech republic": "czechia",
  hk: "hong kong",
};

const PLACES = new Set<string>();
for (const [parent, members] of Object.entries(DIRECT_MEMBERS)) {
  PLACES.add(parent);
  for (const member of members) PLACES.add(member);
}
for (const target of Object.values(GEO_ALIAS)) PLACES.add(target);

const CONTAINED = new Map<string, Set<string>>();
for (const parent of Object.keys(DIRECT_MEMBERS)) {
  const seen = new Set<string>();
  const stack = [...(DIRECT_MEMBERS[parent] ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    for (const child of DIRECT_MEMBERS[next] ?? []) stack.push(child);
  }
  CONTAINED.set(parent, seen);
}

export function canonicalPlace(name: string): string | null {
  const key = segmentGapKey(name);
  if (!key) return null;
  const aliased = GEO_ALIAS[key] ?? key;
  return PLACES.has(aliased) ? aliased : null;
}

export function isGeographicPlace(name: string): boolean {
  return canonicalPlace(name) != null;
}

/** „Non Us“ ist ein Geo-Label: Verneinung plus ein bekannter Ort. Kein Produktname. */
export function isGeoLabel(name: string): boolean {
  if (isGeographicPlace(name)) return true;
  const key = segmentGapKey(name);
  const stripped = key.replace(/^(non|ex|outside|excl|excluding|except)\s+/, "");
  return stripped !== key && stripped.length > 0 && isGeographicPlace(stripped);
}

/** true, wenn die Elternregion die Kindregion geografisch enthält. Ein Land enthält keine andere Region. */
export function regionFitsParent(parent: string, child: string): boolean {
  const parentPlace = canonicalPlace(parent);
  const childPlace = canonicalPlace(child);
  if (!parentPlace || !childPlace || parentPlace === childPlace) return false;
  return CONTAINED.get(parentPlace)?.has(childPlace) === true;
}
