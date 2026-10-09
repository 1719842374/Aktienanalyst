# Google Trends Cache – Implementierung im Code (Stand 2026-10-09)

## Ziel
Den Google-Trends-„Recession“-Score so absichern, dass bei SerpApi-Fehlern (429, Timeout, leeres Ergebnis) nicht mehr Score 0 gesetzt wird, sondern der letzte gültige Wert 6–12 Stunden weiterverwendet wird.

---

## 1. In-Memory-Cache (schnellster Einstieg)

Neue Datei: `server/cache/google-trends-cache.ts`

```typescript
interface CachedTrend {
  value: number;
  timestamp: number; // Date.now()
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 Stunden
let cache: CachedTrend | null = null;

export function getCachedTrend(): number | null {
  if (!cache) return null;
  if (Date.now() - cache.timestamp > CACHE_TTL_MS) return null;
  return cache.value;
}

export function setCachedTrend(value: number): void {
  cache = { value, timestamp: Date.now() };
}

export function getCacheAgeHours(): number | null {
  if (!cache) return null;
  return (Date.now() - cache.timestamp) / (1000 * 60 * 60);
}
```

---

## 2. Integration in die Scoring-Pipeline

In der Stelle, die aktuell den SerpApi-Call macht (z. B. Scoring-Helper oder recession-scoring.ts):

```typescript
import { getCachedTrend, setCachedTrend, getCacheAgeHours } from "./cache/google-trends-cache";

async function getGoogleTrendsValue(): Promise<{ value: number | null; ageHours: number | null }> {
  // 1. Frischen Cache prüfen
  const cached = getCachedTrend();
  if (cached !== null) {
    return { value: cached, ageHours: getCacheAgeHours() };
  }

  // 2. Neuen Wert holen
  try {
    const result = await serpApi.getTrends("Recession", { geo: "US" });
    if (result?.value != null) {
      setCachedTrend(result.value);
      return { value: result.value, ageHours: 0 };
    }
  } catch (err: any) {
    console.warn("[GoogleTrends] Fetch failed:", err?.message);
  }

  // 3. Fallback: letzten bekannten Wert (auch wenn abgelaufen)
  // oder null zurückgeben
  return { value: cache?.value ?? null, ageHours: getCacheAgeHours() };
}
```

---

## 3. Scoring-Anpassung

```typescript
const trendResult = await getGoogleTrendsValue();

let googleTrendsScore = 0;
if (trendResult.value != null) {
  // bestehende Zonen-Logik anwenden
  googleTrendsScore = calculateGoogleTrendsScore(trendResult.value);
} else {
  // explizit als nicht verfügbar behandeln (nicht als 0)
  googleTrendsScore = null; // oder 0 mit Flag
}

// Im Response mitgeben:
{
  value: trendResult.value,
  score: googleTrendsScore,
  ageHours: trendResult.ageHours,
  isStale: (trendResult.ageHours ?? 0) > 6,
}
```

---

## 4. Frontend-Anzeige

In der Scoring-Tabelle / Heatmap:

```tsx
{googleTrends.ageHours != null && (
  <span className="text-xs text-muted-foreground">
    letzter Wert vor {googleTrends.ageHours.toFixed(1)}h
    {googleTrends.isStale && " (veraltet)"}
  </span>
)}
```

---

## 5. Redis-Variante (für Produktion)

Falls Redis verfügbar ist:

```typescript
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);

const KEY = "google-trends:recession";
const TTL_SECONDS = 12 * 60 * 60;

export async function getCachedTrend(): Promise<number | null> {
  const raw = await redis.get(KEY);
  return raw ? Number(raw) : null;
}

export async function setCachedTrend(value: number): Promise<void> {
  await redis.set(KEY, String(value), "EX", TTL_SECONDS);
}
```

---

## 6. Empfohlene Schritte

| Schritt | Aufwand | Priorität |
|---------|---------|-----------|
| In-Memory-Cache anlegen | Gering | Hoch |
| In Scoring-Pipeline einbauen | Gering | Hoch |
| Score ≠ 0 bei Fehler | Gering | Hoch |
| Frontend-Zeitstempel | Mittel | Mittel |
| Auf Redis umstellen | Mittel | Niedrig (später) |

---

## 7. Ergebnis nach Umsetzung

- Bei SerpApi-Fehler (429 etc.) wird der letzte gültige Wert weiterverwendet.
- Der Score wird nicht mehr künstlich auf 0 gesetzt.
- Der Nutzer sieht, wie alt der Wert ist.
- Rate-Limit-Risiko sinkt deutlich durch 12h-Cache.
