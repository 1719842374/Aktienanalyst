# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 29.08.2026 12:35 CEST  
> **Repo:** `1719842374/Aktienanalyst`  
> **Letzter Cache-Fix:** `bfa64b9` (disk-cache L2) + `bc5b10d` (WORK + Patch)

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien inkl. Index | **32** |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** (Key = `buildAnalyzeCacheKey`) |
| Researcher-Cache TTL | **6 h** + SQLite 1 d |
| Schema Disk | `2026-08-29-v2` |
| OpenRouter / LLM-Analyze | 4–7 Calls, nur bei L2-Miss oder force |
| OHLCV Cap | 2600 |
| FMP Historie Free | 5 Jahre |

Scoreboard: 16 ✅ / 9 🟡 / 6 ⬜ (Cache-Docs als umgesetzt gezählt; Route-Patch `git apply patches/0001-analyze-l2-disk-cache.patch`).

## Routing Cache

| Methode | Pfad | Cache |
|---------|------|-------|
| POST | `/api/analyze` | L1 20 min + L2 7 d nach Patch |
| POST | `/api/catalyst-enrich` | schreibt L1+L2 nach Patch |
| POST | `/api/risk-explanations` | kein Persist (v1.1) |
| POST | `/api/policy-context` | kein Persist (v1.1) |
| POST | `/api/researcher/*` | 6 h File / 1 d SQLite |

Vollständige Feature-Tabelle und offene Tickets: vorheriger Stand plus `WORK_ANALYZE_DISK_CACHE.md`.
