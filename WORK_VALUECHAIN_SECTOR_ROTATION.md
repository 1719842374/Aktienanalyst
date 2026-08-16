# WORK_VALUECHAIN_SECTOR_ROTATION.md

> **Stand: 17.08.2026**  
> Detaillierte Spezifikation für den Block **Industrie- & Sektor-Visualisierung**  
> inkl. React-Flow Nodes, Custom Edges, FMP Rate-Limit (Backoff + Jitter + Redis), CAPEX-Intensität.

---

## Implementierungsphase – Aktuelle Reihenfolge

| Rang | Task | Status |
|------|------|--------|
| 1 | React-Flow Node-Spezifikation + Komponenten | ✅ |
| 2 | `withExponentialBackoff` (Equal + Decorrelated Jitter) | ✅ gepusht |
| 3 | CAPEX Color / Border Helpers | ✅ gepusht |
| 4 | Branchen-Selector + API-Contract | offen |
| 5 | FMP Enrichment + Rate-Limit-Schichten | offen |
| 6 | CAPEX live berechnen + Badge/Farbe | offen |
| 7 | Custom Edges (MVP) | offen |
| 8 | Edge-Animationen | Nice-to-have |
| 9 | Redis-basiertes Rate Limiting (optional) | offen / später |

---

## 1. Exponential Backoff + Jitter (implementiert)

**Datei:** `client/src/lib/withBackoff.ts`

### Unterstützte Jitter-Strategien

| Strategie | Formel | Wann |
|-----------|--------|------|
| `equal` (Default) | `exp * (0.7 + random()*0.6)` | Guter Alltags-Kompromiss |
| `decorrelated` | `random(base, previousDelay * 3)` | Sehr robust gegen Thundering Herd (AWS-Stil) |
| `full` | `random(0, exp)` | Maximale Streuung |
| `none` | `exp` | Nur zum Vergleich / Debugging |

### Empfohlene Defaults

```ts
baseDelayMs: 1000
maxDelayMs: 16000
maxRetries: 4
jitter: "equal"          // oder "decorrelated" bei starkem Parallelismus
```

### Zahlenbeispiel (base = 1000 ms)

| Attempt | Equal Jitter (ca.) | Decorrelated Jitter (ca.) |
|---------|--------------------|---------------------------|
| 0 | 700–1300 ms | 1000–3000 ms |
| 1 | 1400–2600 ms | hängt vom vorherigen Delay ab |
| 2 | 2800–5200 ms | weiter gestreut |
| 3 | 5600–10400 ms | bis maxDelay |

**Decorrelated Jitter** ist besonders stark, wenn viele parallele Worker denselben 429 sehen – die Retries verteilen sich deutlich besser als bei festem Multiplikator.

---

## 2. Redis für Rate Limiting (optional / später)

### Warum Redis?

In-Memory-Limiter (Token Bucket im Node-Prozess) funktionieren nur **innerhalb einer Instanz**.  
Bei mehreren Render/Railway-Instanzen oder Serverless-Funktionen braucht man einen **zentralen** Zähler.

### Typische Patterns mit Redis

| Pattern | Redis-Befehl / Idee | Vorteil |
|---------|---------------------|--------|
| **Fixed Window** | `INCR` + `EXPIRE` pro Minute-Key | Sehr einfach |
| **Sliding Window** | Sorted Set mit Timestamps | Präziser |
| **Token Bucket** | Lua-Script: Tokens nachfüllen + abziehen | Glättet Bursts am besten |
| **Concurrency Gate** | `INCR`/`DECR` mit TTL | Max. parallele Calls cluster-weit |

### Konkrete Zahlen für FMP

| Setting | Vorschlag |
|---------|----------|
| Global Budget | z. B. 300–600 Calls / Minute (je nach FMP-Plan) |
| Concurrency | 5–8 parallele Calls cluster-weit |
| Key-Schema | `fmp:ratelimit:{minute}` oder `fmp:tokens` |
| TTL | 60–120 s |

### Aufwand vs. Nutzen

| Ansatz | Aufwand | Wann sinnvoll |
|--------|--------|---------------|
| In-Process Concurrency + Backoff + Cache | gering | **Jetzt / MVP** (eine Instanz) |
| Redis Token Bucket | mittel (1–2 Tage inkl. Infra) | Mehrere Instanzen oder sehr hohe Last |
| Redis + bestehendes `wouldExceedBudget` | mittel | Produktions-Härtung |

**Empfehlung:**  
Für den aktuellen Stand (einzelne Render-Instanz + 12–24 h Cache) reicht **In-Process Limit + `withExponentialBackoff` + Cache**.  
Redis wird erst interessant, wenn ihr horizontal skaliert oder den FMP-Budget sehr eng ausreizt.

---

## 3. CAPEX-Visualisierung (Helper gepusht)

**Datei:** `client/src/lib/valueChainTypes.ts`

```ts
capexColorClass(intensity)   // text-emerald / amber / rose
capexBorderClass(intensity)  // border-*-500/60 für StageNode
```

Schwellen:
- `< 10%` → emerald (asset-light)
- `10–25%` → amber (mittel)
- `> 25%` → rose (kapitalintensiv)

StageNode kann das Badge + Rahmenfarbe direkt nutzen, sobald `avgCapexIntensity` befüllt ist.

---

## Zusammenspiel (Rate Limit Schichten)

```
Request
  → Cache Hit? → fertig
  → Concurrency Gate (max 5–8)
  → wouldExceedBudget()
  → withExponentialBackoff(fn, { jitter: "equal" | "decorrelated" })
  → FMP Call
  → bei 429 → Backoff + Jitter → Retry
  → Ergebnis cachen (12–24 h)
```

Optional später: Redis als zentraler Token-Bucket / Concurrency-Gate vor dem lokalen Backoff.

---

*Aktualisiert 17.08.2026: withBackoff.ts (Equal + Decorrelated Jitter), CAPEX Color Helpers, Redis Rate-Limiting Spec.*
