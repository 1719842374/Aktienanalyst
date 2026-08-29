# WORK_ANALYZE_DISK_CACHE.md — 7-Tage-KI-Catch + Force-Override

> **Stand:** 29.08.2026 12:30 CEST  
> **Repo:** `1719842374/Aktienanalyst`  
> **Basis vor Fix:** `main` @ `d115ecc`  
> **Ziel:** OpenRouter-Antworten einer Aktienanalyse **7 Tage** halten, nur bei `force: true` neu kaufen.

---

## 0. Zahlen / Daten / Fakten (Ist vor dem Wiring)

| Kennzahl | Wert | Datei |
|----------|------|-------|
| Analyze-RAM-TTL | **20 min** = 20 × 60 × 1000 = 1 200 000 ms | `server/analyze-route.ts` `CACHE_TTL_MS` |
| Disk-Analyze-TTL (gebaut, unwired vor Fix) | **7 Tage** = 7 × 24 × 60 × 60 × 1000 = 604 800 000 ms | `server/disk-cache.ts` `CACHE_TTL_DAYS` |
| Researcher-File-TTL | **6 h** = 360 min | `server/researcher.ts` |
| Researcher-SQLite-TTL | **1 Tag** | `RESEARCHER_CACHE_TTL_MS` |
| Schema-Version alt | `2026-06-14-v1` | `CACHE_SCHEMA_VERSION` |
| Schema-Version nach Fix | `2026-08-29-v2` | gleicher Const |
| HP-Mindestlänge | **50** Punkte | Startup + Get |
| OHLCV-Cap Analyze | **2600** Punkte (~10Y) | `OHLCV_MAX_POINTS` |
| Client-Timeout | **90 s** | `queryClient.ts` |
| FMP-Calls / Analyze | bis ~**13** parallel + Earnings + Quartale | `getFmpFallbackData` |
| OpenRouter-Calls / `useLLM=true` | **4–7** | Schritte 11–16 |
| `diskCacheGet/Set` in Analyze vor Fix | **0** | toter Code |

### Cache-Key

```
analyze:{TICKER}:llm:{0|1}[:peers:+A,B:-C]
```

Beispiel: `analyze:NVO:llm:1:peers:+LLY:-`  
Builder: `buildAnalyzeCacheKey()` in `server/peer-cache-key.ts`.

L2-PK nach Fix = **derselbe String** (nicht mehr nur `NVO`).

---

## 1. Soll-Modell

1. `force === true` → L1+L2 löschen → voller Lauf → beide schreiben.
2. RAM-Hit Alter < 1 200 000 ms → return (L1).
3. Disk-Hit Alter < 604 800 000 ms und Schema aktuell → L1 wärmen → return (L2).
4. Miss → voller Lauf → L1+L2 schreiben.

FMP-Zahlen dürfen bei L2-Hit nachgeladen werden (1 History-Call). KI-Blöcke nicht.

---

## 2. Manuelles Override

Feld: `force` (`analyzeRequestSchema`).  
`force: true` muss `analysisCache.delete` **und** `diskCacheDelete` ausführen.

---

## 3. Betroffene Dateien / Routing

| Datei | Rolle |
|-------|-------|
| `server/analyze-route.ts` | POST `/api/analyze`, POST `/api/catalyst-enrich` |
| `server/disk-cache.ts` | SQLite `data.db`, 7 d, Seed |
| `server/peer-cache-key.ts` | Key inkl. Peers |
| `patches/0001-analyze-l2-disk-cache.patch` | Route-Hunks |
| `server/researcher.ts` | unverändert 6 h |

v1.1 offen: Risk/Policy/Regulatory/Thesis auf L2 mergen.

---

## 4. Acceptance

- Zweiter Analyze in 7 Tagen, force=false, gleicher Key → 0 OpenRouter-Calls, Log `Disk cache hit`
- Restart dazwischen → weiterhin Disk-Hit
- force=true → neuer OpenRouter-Lauf
- Peer +LLY trifft nicht den Key ohne LLY
- Enrich überlebt 30 min + Restart
- Researcher-Tabs weiter 6 h
