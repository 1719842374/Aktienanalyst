# WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md — Wiring L1 RAM + L2 SQLite

> **Stand:** 29.08.2026  
> **Spec:** `WORK_ANALYZE_DISK_CACHE.md`  
> **Status:** disk-cache L2 + Schema v2 auf `main`. Route-Hunks in `patches/0001-analyze-l2-disk-cache.patch`.

---

## 1. Schichtmodell

```
force=true  → delete L1+L2 → build → write L1+L2
force=false → L1 (20 min) → L2 (7 d, gleicher Key) → build → write L1+L2
```

| Schicht | Speicher | TTL | Key |
|---------|----------|-----|-----|
| L1 | Map analysisCache | 20 min | buildAnalyzeCacheKey |
| L2 | SQLite analysis_cache | 7 d | derselbe String als PK |
| Seed | cache-seed.json | Re-Deploy | INSERT OR IGNORE, HP last 252 |

Researcher 6 h / 1 d bleibt getrennt.

---

## 2. disk-cache.ts (dieser Commit)

- CACHE_SCHEMA_VERSION = 2026-08-29-v2
- Get: HP < 50 nicht löschen, Flag _needsOhlcv
- Fallback: analyze:NVO:llm:1 darf Alt-Seed NVO lesen, nur ohne :peers:
- Seed-Export: historicalPrices.slice(-252)
- Seed-Load: analyze:-Keys nicht komplett uppercasen
- Startup: nur kaputtes JSON droppen, kurze HP behalten

---

## 3. analyze-route.ts (Patch anwenden)

```bash
git apply patches/0001-analyze-l2-disk-cache.patch
```

Hunks:
1. Import diskCacheGet/Set/Delete
2. force → L1+L2 delete
3. nach RAM-Miss: diskCacheGet, optional fmpHistoricalPrices, L1 wärmen, return
4. nach Assemble: diskCacheSet(cacheKey, analysis)
5. nach Enrich: diskCacheSet(cacheKeyUsed, updated)

---

## 4. Verify

```bash
curl -s -X POST localhost:5000/api/analyze -H 'content-type: application/json' -d '{"ticker":"MSFT","useLLM":true}'
# zweiter Call / nach Restart: Log "Disk cache hit"
curl -s -X POST localhost:5000/api/analyze -H 'content-type: application/json' -d '{"ticker":"MSFT","useLLM":true,"force":true}'
```

SQLite: `SELECT ticker, datetime(updated_at/1000,'unixepoch'), length(data) FROM analysis_cache;`  
Erwartet: `analyze:MSFT:llm:1`

---

## 5. Rollback

Schema-String hochziehen oder diskCacheGet-Call entfernen. L1 20 min bleibt.
