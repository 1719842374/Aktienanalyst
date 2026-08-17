# WORK_SEGMENT_DEDUP.md — Segment-Deduplizierung (Produkt vs. Geographic)

> **Stand:** 17.08.2026  
> **Status:** Spec fertig · Implementierung offen (Quick-Win ~1–2 h)  
> **Referenz:** Chat 17.08.2026 (Amazon-Screenshot + Analyse der Segment-Pipeline)  
> **Eintrag in:** [Future_Work.md](./Future_Work.md) §6

---

## Problem

FMP liefert bei manchen Titeln denselben Segmentnamen sowohl in  
`/revenue-product-segmentation` als auch in `/revenue-geographic-segmentation`.

**Beispiel AMZN:**
- Business Segments: Online Stores, Third-Party Seller Services, **Amazon Web Services**, …
- Geographic Segments: North America, International, **Amazon Web Services Segment**

→ AWS erscheint doppelt in der UI (Section 2).

Der generische Pipeline-Code (`fmp.ts` → `normaliseSegmentRows` + `analyze-route.ts` + `Section2.tsx`) dedupliziert **nicht** nach Name.

---

## Lösung (ticker-agnostisch, keine Hardcodes)

### 1. Zentrale Helper-Funktion

In `server/fmp.ts` (direkt unter `normaliseSegmentRows` oder vor den Exporten) einfügen:

```ts
/**
 * Dedupliziert Segmente nach normalisiertem Namen.
 * - Behält den Eintrag mit dem höheren Revenue (bei Gleichstand den ersten).
 * - Ticker-agnostisch, keine Hardcodes.
 * - Entfernt leere / ungültige Namen.
 */
export function dedupeSegmentsByName<T extends { name: string; revenue: number }>(
  segs: T[]
): T[] {
  if (!Array.isArray(segs) || segs.length === 0) return [];

  const map = new Map<string, T>();

  for (const s of segs) {
    if (!s || typeof s.name !== "string" || !s.name.trim()) continue;

    // Normalisierung: Kleinbuchstaben, Sonderzeichen raus, "Segment" am Ende weg
    const key = s.name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]/g, "")
      .replace(/segment$/, "")
      .trim();

    if (!key) continue;

    const existing = map.get(key);
    if (!existing || (Number(s.revenue) || 0) > (Number(existing.revenue) || 0)) {
      map.set(key, s);
    }
  }

  // Absteigend nach Revenue sortieren (wie bisher)
  return Array.from(map.values()).sort(
    (a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0)
  );
}
```

### 2. Anwendung in `analyze-route.ts`

**A) Produkt-Segmente**  
Nach dem gesamten Block, der `revenueSegments` befüllt (also nach dem SEC-/curated-Fallback, ca. nach Schritt 7b):

```ts
// Nach dem gesamten revenueSegments-Aufbau:
revenueSegments = dedupeSegmentsByName(revenueSegments);
```

**B) Geographic Segments**  
Direkt vor dem Zusammenbau des Response-Objekts:

```ts
const rawGeo = Array.isArray(geoSegments) ? geoSegments : [];
const geoSegmentsClean = dedupeSegmentsByName(rawGeo);
```

Im finalen `analysis`-Objekt dann:

```ts
geoSegments: geoSegmentsClean,
```

statt `geoSegments: Array.isArray(geoSegments) ? geoSegments : []`.

### 3. Optional: Cross-Dedup (empfohlen)

Wenn derselbe Name in **beiden** Listen vorkommt (z. B. „Amazon Web Services“), behalte ihn nur in den Business Segments und entferne ihn aus den Geographic Segments:

```ts
const productKeys = new Set(
  revenueSegments.map(s =>
    s.name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]/g, "")
      .replace(/segment$/, "")
      .trim()
  )
);

const geoWithoutOverlap = geoSegmentsClean.filter(g => {
  const key = g.name
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, "")
    .replace(/segment$/, "")
    .trim();
  return !productKeys.has(key);
});
```

Dann im Response:

```ts
geoSegments: geoWithoutOverlap,
```

### 4. Import in `analyze-route.ts`

Oben bei den FMP-Imports ergänzen:

```ts
import {
  // ... bestehende Imports
  fmpSegments,
  fmpGeoSegments,          // falls noch nicht vorhanden
  dedupeSegmentsByName,    // NEU
} from "./fmp";
```

### 5. Reihenfolge der Änderungen (sicher)

1. Helper in `fmp.ts` hinzufügen und speichern  
2. Import in `analyze-route.ts` ergänzen  
3. `revenueSegments = dedupeSegmentsByName(revenueSegments);` einfügen  
4. Geo-Dedup + optional Cross-Dedup einbauen  
5. Commit + Deploy  
6. Test mit **AMZN** (AWS darf nur noch einmal erscheinen)

---

## Erwartetes Verhalten nach dem Fix

| Ticker | Vorher                              | Nachher                              |
|--------|-------------------------------------|--------------------------------------|
| AMZN   | AWS in Produkt + Geo                | AWS nur noch in Business Segments    |
| MSFT   | ggf. Cloud doppelt                  | nur noch einmal                      |
| Andere | unverändert (keine Duplikate)       | unverändert                          |

---

## Betroffene Dateien

| Datei                        | Änderung                                      |
|------------------------------|-----------------------------------------------|
| `server/fmp.ts`              | `dedupeSegmentsByName` hinzufügen             |
| `server/analyze-route.ts`    | Import + Aufrufe + optional Cross-Dedup       |
| `client/.../Section2.tsx`    | **keine Änderung nötig** (Daten kommen sauber)|

---

## Acceptance-Checkliste

- [ ] `dedupeSegmentsByName` in `fmp.ts` vorhanden und exportiert
- [ ] Import in `analyze-route.ts` korrekt
- [ ] Produkt-Segmente werden dedupliziert
- [ ] Geo-Segmente werden dedupliziert
- [ ] Cross-Dedup aktiv (empfohlen)
- [ ] AMZN-Analyse: AWS erscheint nur einmal (Business Segments)
- [ ] Keine Regression bei Tickern ohne Duplikate (z. B. NVO, ASML)
- [ ] UI (Section 2) zeigt weiterhin korrekte Prozent- und Revenue-Werte

---

*Spec erstellt 17.08.2026 · Quick-Win ~1–2 h*
