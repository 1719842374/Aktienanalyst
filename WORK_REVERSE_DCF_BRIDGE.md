# WORK_REVERSE_DCF_BRIDGE.md

> Stand: 28.07.2026 | Nur Dokumentation  
> Reverse-DCF Methodik · Bridge Programme→Sektor · **Fiskalprogramm Cache TTL Details**

---

# Teil 1 — Reverse DCF (Kurz)

$$EV(g^*)=P\times Shares+NetDebt$$
g\* per Binary Search · gapRatio = g\*/realized8Q → DCF_REALITY_CHECK  
Vollcode: §1.3 in Git-History / vorheriger Version.

---

# Teil 2 — Bridge + Cache

## 2.1–2.11 (Kurz)

FiscalProgram · THEME_SECTOR_MAP · programToCatalyst · Daily Briefing Flow ·  
AI-Capex = context_only · Staatsprogramm legislated/funded = catalyst

---

## 2.12 Fiskalprogramm Cache — TTL Details

### 2.12.1 Warum TTL (nicht „für immer“)

| Risiko ohne TTL | Folge |
|-----------------|--------|
| Veraltetes „announced“ ohne Funding | Falsche Catalysts / DCF-Milderung |
| Abgelaufenes Programm (endYear vorbei) | Scoring preist Rückenwind, der weg ist |
| Briefing-Noise / einmalige Schlagzeile | Cache voller Low-Confidence-Müll |
| Lookahead bei Backtests | expiresAt/publishedAt müssen as-of respektieren |

TTL ist die **Aktualitätsschranke**; `status` + `endYear` sind die **inhaltliche** Schranke.

### 2.12.2 TTL-Staffelung nach Status & Confidence

```
expiresAt = cachedAt + TTL(status, confidence)
```

| status | confidence | TTL | Begründung |
|--------|------------|-----|------------|
| `announced` | low | **3 Tage** | Schlagzeile, oft Dementi/Korrektur |
| `announced` | medium | **7 Tage** | warten auf Gesetzestext |
| `announced` | high | **14 Tage** | offizielle Ankündigung, noch nicht legislated |
| `legislated` | medium/high | **30 Tage** | Gesetz steht; Refresh für Funding-Updates |
| `funded` | high | **45 Tage** | Budget da; langsamere Änderung |
| `deploying` | high | **60 Tage** | mehrjährig; TTL nur für Re-Validation |
| `expired` | * | **0 / sofort raus** | nicht listen |
| * | low | max **7 Tage** | egal welcher Status |

```ts
export function computeTtlDays(
  status: FiscalProgram['status'],
  confidence: FiscalProgram['confidence']
): number {
  if (status === 'expired') return 0;
  if (confidence === 'low') return Math.min(7, status === 'announced' ? 3 : 7);

  const table: Record<FiscalProgram['status'], number> = {
    announced: confidence === 'high' ? 14 : 7,
    legislated: 30,
    funded: 45,
    deploying: 60,
    expired: 0,
  };
  return table[status] ?? 7;
}

export function computeExpiresAt(cachedAt: string, status: FiscalProgram['status'], confidence: FiscalProgram['confidence']): string {
  const days = computeTtlDays(status, confidence);
  const d = new Date(cachedAt);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
```

### 2.12.3 Harte Expiry-Regeln (zusätzlich zur TTL)

Ein Programm gilt als **inaktiv** (nicht in `listActive` / nicht als Catalyst), wenn **eine** gilt:

```
1) now > expiresAt                          // TTL abgelaufen
2) status === 'expired'
3) endYear != null && calendarYear > endYear // inhaltlich vorbei
4) source.publishedAt > asOf                 // Lookahead-Sperre im Backtest
```

```ts
export function isProgramActive(p: FiscalProgram, asOf: string): boolean {
  if (p.status === 'expired') return false;
  if (p.expiresAt < asOf) return false;
  if (p.source.publishedAt > asOf) return false;
  if (p.endYear != null) {
    const y = new Date(asOf).getUTCFullYear();
    if (y > p.endYear) return false;
  }
  return true;
}
```

### 2.12.4 Upsert & TTL-Refresh-Politik

```
Dedupe-Key: id (slug)  — z.B. "nato-2pct", "us-chips-act-2022"
```

| Ereignis | Aktion auf Cache-Eintrag |
|----------|--------------------------|
| Neues Programm (unbekannte id) | insert, `cachedAt=now`, `expiresAt=now+TTL` |
| Gleiche id, **höherer** status (announced→legislated→funded→deploying) | update Felder, **TTL neu setzen** (längere Staffel) |
| Gleiche id, gleicher status, neue Source/Volume | update Metadaten, **expiresAt verlängern** (Refresh = now+TTL) |
| Gleiche id, nur erneute Briefing-Erwähnung ohne Änderung | **soft touch**: expiresAt = max(expiresAt, now+TTL/2) — kein ewiges Verlängern durch Noise |
| status → expired oder endYear überschritten | status=expired, expiresAt=now (sofort inaktiv) |
| confidence steigt (medium→high) | update + TTL neu nach Tabelle |
| confidence fällt | confidence updaten; TTL **nicht** künstlich verlängern |

```ts
export function upsertProgram(
  store: Map<string, FiscalProgram>,
  incoming: FiscalProgram,
  now: string
): FiscalProgram {
  const prev = store.get(incoming.id);
  const statusRank = { announced: 1, legislated: 2, funded: 3, deploying: 4, expired: 0 };

  if (!prev) {
    const row = {
      ...incoming,
      cachedAt: now,
      expiresAt: computeExpiresAt(now, incoming.status, incoming.confidence),
    };
    store.set(row.id, row);
    return row;
  }

  const upgraded = statusRank[incoming.status] > statusRank[prev.status];
  const sameStatus = incoming.status === prev.status;

  let expiresAt = prev.expiresAt;
  if (upgraded) {
    expiresAt = computeExpiresAt(now, incoming.status, incoming.confidence);
  } else if (sameStatus && incoming.confidence === prev.confidence) {
    // soft touch: nur halb TTL verlängern, Cap = full TTL ab now
    const half = computeTtlDays(incoming.status, incoming.confidence) / 2;
    const soft = new Date(now);
    soft.setUTCDate(soft.getUTCDate() + half);
    const full = new Date(computeExpiresAt(now, incoming.status, incoming.confidence));
    expiresAt = (soft > new Date(prev.expiresAt) ? soft : new Date(prev.expiresAt)) > full
      ? full.toISOString()
      : (soft > new Date(prev.expiresAt) ? soft.toISOString() : prev.expiresAt);
  } else if (incoming.confidence === 'high' && prev.confidence !== 'high') {
    expiresAt = computeExpiresAt(now, incoming.status, 'high');
  }

  const row: FiscalProgram = {
    ...prev,
    ...incoming,
    cachedAt: prev.cachedAt, // Original-First-Seen behalten
    expiresAt,
    rawBriefingIds: [...new Set([...(prev.rawBriefingIds ?? []), ...(incoming.rawBriefingIds ?? [])])],
  };
  store.set(row.id, row);
  return row;
}
```

### 2.12.5 Persistenz & Speicher

| Umgebung | Store | Hinweis |
|----------|-------|--------|
| Dev | In-Memory `Map` | reicht für Tests |
| Render / Prod | Redis oder SQLite/JSON-File | TTL-Index auf `expiresAt` |
| Serverless (pplx) | KV / File mit periodischem GC | bei jedem Briefing `gcExpired(now)` |

```ts
export function gcExpired(store: Map<string, FiscalProgram>, asOf: string): number {
  let n = 0;
  for (const [id, p] of store) {
    if (!isProgramActive(p, asOf)) {
      // optional: soft-delete flag statt hard delete für Audit
      store.delete(id);
      n++;
    }
  }
  return n;
}
```

**Max-Größe:** z.B. 200 aktive Programme; bei Overflow zuerst `announced+low`, dann älteste `cachedAt`.

### 2.12.6 Zusammenspiel mit Daily Briefing

```
Täglich (oder bei Briefing-Run):
  1. Extractions aus Sonar/LLM
  2. upsertProgram je Extraction
  3. gcExpired(now)
  4. listActive(now) → activePrograms + programsBySector

Scoring-Request:
  catalystsForTicker(..., asOf=heute)
    → filter isProgramActive
    → programToCatalyst
```

Briefing soll **nicht** bei jedem Page-Load die TTL verlängern — nur bei echtem Upsert aus neuem Briefing-Job.

### 2.12.7 Backtest / as-of

```
Backtest-Tag T:
  listActive(T) = Programme mit
    publishedAt ≤ T
    expiresAt ≥ T     // TTL-Uhr historisch simulieren
    endYear ≥ year(T) oder null
    status ≠ expired

Historische TTL-Simulation:
  cachedAt ≈ publishedAt (oder first-seen in Briefing-Archiv)
  expiresAt = cachedAt + TTL(status_at_T, confidence)
```

Ohne archivierte Briefings: nur Programme mit `publishedAt ≤ T` und `status` zum damaligen Kenntnisstand — lieber zu wenig als Lookahead.

### 2.12.8 Defaults (Zusammenfassung)

| Parameter | Wert |
|-----------|------|
| TTL announced/low | 3 d |
| TTL announced/high | 14 d |
| TTL legislated | 30 d |
| TTL funded | 45 d |
| TTL deploying | 60 d |
| Soft-touch Verlängerung | +TTL/2, Cap = full TTL ab now |
| GC | bei jedem Briefing-Run + optional cron 6h |
| Max aktive Einträge | 200 |
| Lookahead | publishedAt ≤ asOf immer |

### 2.12.9 Checkliste TTL

```
[ ] computeTtlDays / computeExpiresAt
[ ] isProgramActive (TTL + endYear + publishedAt + status)
[ ] upsert mit Status-Upgrade → TTL-Reset
[ ] soft-touch ohne Statuswechsel
[ ] gcExpired im Briefing-Job
[ ] Backtest nutzt asOf, kein „now“
[ ] expired nie als Catalyst
```

---

**Weiter:** [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) §17 Fiscal-Ausnahme  
**Regel:** Dokumentation. Implementierung lokal → PR → Review.
