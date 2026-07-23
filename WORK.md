# WORK.md — BTC Dashboard Restore Plan & Follow-up Roadmap

> Erstellt: 23.07.2026 | Branch: `btc-restore-modular` (live, von `33c8e77`)
> **Regel: Kein Code-Push über GitHub API bis Plan vollständig lokal validiert.**

---

## 🔴 Diagnose — Was genau fehlt in `BTCDashboard.tsx`

Der GitHub API-Fetch bricht immer am selben Punkt ab — mitten in `Section2Halving` nach
`text-muted-fo`. Das bedeutet:

- **Sections 3–12** + der komplette `export default function BTCDashboard`
  (State-Management, Sidebar, useQuery für Miner, Main-Render-Loop) existieren in `main` **nicht mehr produktiv**.
- **Section 13** (`Section13Miner`) ist vorhanden, aber **nie eingebunden**,
  weil der Parent-Render fehlt.
- **Root cause:** Datei >100 KB Base64 → GitHub API trunciert. Identischer Bug wie bei `routes.ts`.

---

## 📋 Restore-Plan — 3 Phasen

### Phase 1 — Schadensbegrenzung ✅ (erledigt)

**Ziel:** Stabilen Backup-Branch erstellen, bevor weitere Commits landen.

```bash
# Branch btc-restore-modular wurde von 33c8e77 (HEAD main) erstellt
# Letzter bekannter guter Commit (vor Truncation):
# bafff3c — feat: BTC Miner Zone PR #31 Squash-Merge
git checkout -b btc-restore bafff3c
```

**Status:** Branch `btc-restore-modular` ist live auf GitHub.

---

### Phase 2 — BTCDashboard.tsx modular aufsplitten 🔲 (nächster Schritt, lokal)

**Warum:** ~2500+ Zeilen in einer Datei = GitHub API trunciert bei ~100 KB Base64.
Lösung identisch zur `routes.ts`-Modularisierung.

#### Ziel-Dateistruktur

```
client/src/pages/
├── BTCDashboard.tsx          ← Shell + export default (~200 Zeilen)
└── btc/
    ├── Section13Miner.tsx    ← vollständige Section 13 (Puell, Hash Ribbons, Breakeven, Miner Score)
    ├── Sections1to6.tsx      ← Status, Halving, Indikatoren, Power-Law, GWS, Monte Carlo
    └── Sections7to12.tsx     ← Kategorien, Zyklus, Finale Schätzung, TA, Fear&Greed, Fazit
```

#### BTCDashboard.tsx Shell (nach Modularisierung, ~200 Zeilen)

```tsx
// BTCDashboard.tsx — Shell only
import { Section13Miner }  from "./btc/Section13Miner";
import { Sections1to6 }    from "./btc/Sections1to6";
import { Sections7to12 }   from "./btc/Sections7to12";

export default function BTCDashboard() {
  const { data, isPending, mutate } = useMutation({ mutationFn: analyzeBTC });
  const { data: minerData, isLoading: minerLoading, isError: minerError } = useQuery({
    queryKey: ["btc-miner", data?.btcPrice],
    queryFn: () => fetch("/api/btc-miner").then(r => r.json()),
    enabled: !!data,
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      {/* Main content — SECTIONS-Array-driven render */}
    </div>
  );
}
```

#### Kritische Fix-Zeile (die komplett fehlt)

```tsx
// Im Section-Render-Switch:
case 13: return (
  <Section13Miner
    data={btcData}
    minerData={minerData ?? null}
    loading={minerLoading}
    error={minerError}
  />
);
```

#### SECTIONS-Array erweitern (in Shell)

```tsx
const SECTIONS = [
  // ... Sections 1–12 wie bisher ...
  { id: 13, label: "⛏ Miner-Zone", icon: Cpu },
];
```

---

### Phase 3 — Section 13 Validierung nach Perplexity-Pattern 🔲

Der Section-13-Code ist **strukturell korrekt**:

| Check | Status |
|---|---|
| `MetricCard`, `SectionCard` | ✅ korrekt |
| `bg-muted/20 rounded-lg border border-border p-4` | ✅ korrekt |
| `grid-cols-2 sm:grid-cols-4 gap-3` | ✅ korrekt |
| `tooltipStyle`-Konstante | ✅ korrekt |
| Ampelfarben `text-emerald-500/400/text-amber-400/text-red-500` | ✅ korrekt |
| **Eingebunden in Parent `BTCDashboard`** | ❌ **fehlt** |

**Einziges Problem:** `Section13Miner` wird nie vom Parent gerendert, weil `export default` fehlt.

---

## ✅ Priorisierte Aufgabenliste

| Priorität | Aufgabe | Zeit | Status |
|---|---|---|---|
| **P0** | `git checkout -b btc-restore bafff3c` — Backup vor weiteren Commits | 2 min | ✅ Done (btc-restore-modular) |
| **P0** | `export default function BTCDashboard` aus pplx.app-HTML-Quelle rekonstruieren | 30 min | 🔲 offen |
| **P1** | BTCDashboard in 4 Dateien aufsplitten (Anti-Truncation) | 20 min | 🔲 offen |
| **P1** | `Section13Miner` in Shell einbinden (`case 13`) | 5 min | 🔲 offen |
| **P2** | FMP-Migration Aktien-Dashboard (unabhängig, kein BTC-Overlap) | separat | 🔲 offen |

---

## 🔁 Follow-up Roadmap — Nach dem Restore

### Follow-up 1 — PR-Workflow & Squash-Merge-Regel

**Regel für alle zukünftigen Code-Änderungen:**

```
1. Feature-Branch erstellen: git checkout -b fix/description
2. Lokal entwickeln + testen (npm run dev)
3. Push: git push origin fix/description
4. PR öffnen auf GitHub
5. Code-Review durch zweiten Agent (Doublecheck)
6. Squash & Merge in main — KEIN direkter push auf main
```

**Warum Squash:** Verhindert Commit-Flood, hält `git log --oneline` lesbar,
jeder PR = 1 atomarer Commit in main.

---

### Follow-up 2 — Anti-Truncation Protokoll (dauerhaft)

**Regel:** Jede Datei >80 KB → **muss** aufgesplittet werden, bevor sie über GitHub API gepusht wird.

```
Prüfen vor jedem push_files:
  wc -c client/src/pages/BTCDashboard.tsx
  # Wenn > 80000 Bytes → aufsplitten
```

Bekannte truncation-gefährdete Dateien:
- `client/src/pages/BTCDashboard.tsx` → in 4 Dateien aufsplitten (Phase 2)
- `server/routes.ts` → bereits modularisiert ✅

---

### Follow-up 3 — Code-Review durch zweiten Agent

**Vor jedem Merge-PR:**

1. PR öffnen
2. Copilot-Review anfordern: `mcp_tool_github_mcp_direct_request_copilot_review`
3. Review-Kommentare adressieren
4. Erst dann Squash & Merge

**Doublecheck-Checkliste für BTCDashboard-Splits:**
- [ ] Alle Imports korrekt (keine zirkulären Dependencies)
- [ ] `export` / `export default` konsistent
- [ ] `tooltipStyle`, `formatCurrency`, `MetricCard` nicht doppelt definiert
- [ ] `BTCAnalysis`-Interface nur einmal (in Shell oder separatem `btc/types.ts`)
- [ ] Section 13 Props: `data`, `minerData`, `loading`, `error` korrekt übergeben
- [ ] `SECTIONS`-Array enthält alle 13 Einträge
- [ ] `sectionRefs` deckt alle 13 IDs ab

---

### Follow-up 4 — Lokale Validierung vor jedem Push

```bash
# 1. TypeScript-Check
npm run check

# 2. Dev-Server starten + manuell Section 1–13 durchtesten
npm run dev

# 3. Dateigrößen prüfen
find client/src/pages/btc -name '*.tsx' | xargs wc -c
# Jede Datei sollte < 80 KB sein

# 4. Nur dann pushen
git push origin btc-restore-modular
```

---

### Follow-up 5 — FMP-Migration Aktien-Dashboard (P2, unabhängig)

- Kein BTC-Overlap
- Eigener Branch: `fix/fmp-migration`
- Erst nach vollständigem BTC-Restore starten
- Scope: `server/routes.ts` FMP-Endpunkte auf neuen API-Key migrieren

---

## 🗂 Bekannte gute Commits (Referenz)

| SHA | Beschreibung | Verwendung |
|---|---|---|
| `33c8e77` | fix(btc-dashboard): Scroll-Bug beheben (#34) | HEAD main, Basis für btc-restore-modular |
| `5bf8a2d` | feat: Section 13 Miner-Zone (direkter Push, kein PR) | Enthält vollständige Section 13 |
| `bafff3c` | feat: BTC Miner Zone — Section 13 PR #31 Squash | Letzter valider Stand vor Truncation |

---

> **Nächste Aktion:** Lokal auf `btc-restore-modular` wechseln,
> `export default function BTCDashboard` schreiben,
> dann 4 Dateien aufsplitten — **kein direkter Push auf main ohne PR + Review**.
