# WORK_RESEARCHER_PORTFOLIO.md — 3 Portfolios + Direkter Add aus Analyse/Researcher

> Stand: 14.08.2026 | Nur Dokumentation  
> Klärung nach UI-Screenshot (Portfolio mit MSFT / NVDA / NVO / LLY) und User-Feedback

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.  
Baut auf `WORK_PORTFOLIO.md` + bestehendem Positions-Tracker (`positions.ts`, `handleAddPosition`) auf.

---

# Kapitel 0 — Produktziel (final, verbindlich)

## 0.1 Drei Portfolios mit eigenen Rubriken

| # | Portfolio | Art | Sidebar | Befüllung |
|---|-----------|-----|---------|----------|
| **P1** | **Manuelles Portfolio** | Positions mit qty / entry / stop / Long-Short (wie **jetzt**) | 2 Investments (bestehend) | Manuell **oder** Ein-Klick aus Analyse / Screener / Researcher → erzeugt echte `PortfolioPosition` |
| **P2** | **Watchlist-Portfolio** | Auto-gewichteter Basket | **5 Watchlist-Portfolio** (NEU) | Jeder „Zur Watchlist“-Klick; Gewichtung = WORK_PORTFOLIO Pipeline (A/B/C) |
| **P3** | **Researcher-Portfolios** | Auto-Basket **pro Region** | **6 Researcher-Portfolios** (NEU) | Nur Einträge aus Researcher; Unter-Tabs: **USA · EU · China/Asien · Mixed** |

Bestehende Sidebar bleibt:

```
1 Übersicht
2 Investments          ← P1 Manuelles Portfolio (erweitert um Direkt-Add)
3 Policy
4 Optimierung
5 Watchlist-Portfolio  ← P2 NEU
6 Researcher-Portfolios← P3 NEU (USA | EU | China/Asien | Mixed)
```

## 0.2 Buttons — wo genau

| Ort | Button(s) | Ziel |
|-----|-----------|------|
| **Dashboard Aktienanalyse — Abschnitt 1 Datenaktualität** (und Header) | **① Zum Portfolio** + **② Zur Watchlist** | ① → P1 (`PortfolioPosition`) · ② → P2 |
| **BTC-Dashboard** | analog | BTC → P1 und/oder P2 |
| **Researcher — jeder Tab** | pro Ticker `+ Portfolio` / `+ Watchlist` + Bulk „Alle sichtbaren …“ | Screener, Sector Opportunity, Capex & Fiscal, Macro, Daily Briefing |
| **Researcher Daily Briefing** | betroffene Ticker + LLM-`watchlist[]` | regionstreu in P2 + P3 |

**Doppel-Check (verbindlich):**  
Button steht **in Abschnitt 1** der Aktienanalyse **und** in **jedem** Researcher-Tab (Macro / Sectors / Screener / Capex + Briefing).

## 0.3 Kern-Unterschied P1 vs. P2/P3

```
P1 Manuell:  User will eine echte virtuelle Position (Stück, Einstieg, Stopp, Performance-Tracking)
             → handleAddPosition(ticker)  (existiert bereits in PortfolioPage)

P2/P3:       User markiert Interesse / Research-Output
             → WatchlistEntry → automatische CAPM/Kelly-Gewichtung
             → kein qty/entry nötig
```

---

# Kapitel A — Ist-Zustand (Zahlen, Daten, Fakten)

## A.1 Aktuelles manuelles Portfolio (Screenshot 14.08.2026)

Aus Live-UI:

| Ticker | Name | Qty | Side | Einstieg | Kurs (Bsp.) | Performance |
|--------|------|-----|------|----------|-------------|-------------|
| MSFT | Microsoft Corporation | 1 | LONG | 499,99 € | 496,88 € | −0,62 % |
| NVDA | NVIDIA Corporation | 1 | LONG | 223,96 € | 225,30 € | +0,60 % |
| NVO | Novo Nordisk A/S | 1 | LONG | ~67,26 | ~66,72 | −1,x % |
| LLY | (Eli Lilly) | 1 | LONG | — | — | — |

**Ziel-Gewichte CAPM (Pie, Modus A/B/C):**  
MSFT 30 % · NVDA 30 % · LLY 30 % · NVO 10 %

**KPIs:** Profit ≈ −0,5 % · Bester Performer NVDA +0,6 % · Realisierter Profit —

**Persistenz heute:**  
`localStorage` Key `aktienanalyst_portfolio_positions_v1` + Policy `aktienanalyst_portfolio_policy_v1`

**Bereits vorhandene API im Code:**

```ts
// PortfolioPage.tsx — existiert
function handleAddPosition(ticker: string, name?: string) {
  // Dedup offene Positionen
  // entryPrice aus Analyse-Cache oder 0 (wird nachgezogen)
  // makePosition({ ticker, name, entryPrice })
  // fetchAnalysisForTicker(upper)
}
```

**Lücke:** `handleAddPosition` ist nur **innerhalb** PortfolioPage erreichbar.  
Analyse / Researcher können ihn noch **nicht** aufrufen → genau das schließt dieses Ticket.

## A.2 Bestehende Sidebar-Definition (Code)

```ts
const SECTIONS = [
  { id: 1, label: "Übersicht", icon: LayoutDashboard },
  { id: 2, label: "Investments", icon: Table2 },
  { id: 3, label: "Policy", icon: SlidersHorizontal },
  { id: 4, label: "Optimierung", icon: BarChart3 },
] as const;
```

Erweiterung auf id 5 + 6 ist der einzige strukturelle UI-Eingriff in der Navigation.

## A.3 Researcher-Tabs (Ist)

| Tab-ID | Label | Ticker-Quellen im Result |
|--------|-------|--------------------------|
| `macro` | Country Macro Pulse | selten explizite Ticker |
| `sectors` | Sector Opportunity | `listedBeneficiaries[].ticker` |
| `screener` | Undervalued Screener | `candidates[].ticker` + actionRecommendation |
| `capex` | Capex & Fiscal | `listedBeneficiaries` / affected |
| Briefing | Daily Briefing | `topChanges[].affectedTickers`, LLM-Feld `watchlist[]` |

Regionen: `US` | `EU` | `ASIA` (UI: USA / Europa / Asien → P3-Label „China / Asien“ für ASIA).

---

# Kapitel B — Ziel-Architektur

## B.1 Datenfluss

```
┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────┐
│ Dashboard §1         │  │ Researcher alle Tabs │  │ BTC         │
│ + Header             │  │ + Briefing + Bulk    │  │             │
└──────────┬───────────┘  └──────────┬───────────┘  └──────┬──────┘
           │                         │                      │
     ┌─────┴─────┐             ┌─────┴─────┐                │
     ▼           ▼             ▼           ▼                ▼
  [Zum         [Zur         [Zum         [Zur            …]
   Portfolio]   Watchlist]   Portfolio]   Watchlist]
     │           │             │           │
     ▼           └──────┬──────┘           │
┌─────────────┐         ▼                  │
│ P1 Positions│   ┌───────────────┐        │
│ localStorage│   │ Watchlist     │◄───────┘
│ positions_v1│   │ localStorage  │
└─────────────┘   │ watchlist_v1  │
                  └───────┬───────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
         P2 Watchlist  P3 USA     P3 EU / ASIA / Mixed
         Portfolio     (filter)   (filter)
              │           │           │
              └───────────┴───────────┘
                          ▼
              WORK_PORTFOLIO Pipeline
              (μ, Σ, pickWeightMode A|B|C,
               Sharpe, Kelly × Kapital K)
```

## B.2 Shared Add-Bridge (neu, klein)

```ts
// client/src/lib/portfolio/add-bridge.ts  (NEU)
export function addPositionFromOutside(opts: {
  ticker: string;
  name?: string;
  entryPrice?: number;
  source?: string;
}): { ok: boolean; reason?: "duplicate" | "empty" }

export function addWatchlistEntry(entry: Omit<WatchlistEntry, "addedAt" | "lastSeenAt"> & Partial<…>): void
```

---

# Kapitel C — Datenmodell

## C.1 WatchlistEntry (P2 + P3)

```ts
export type WatchlistSource =
  | "manual_analysis" | "btc" | "researcher_briefing"
  | "researcher_macro" | "researcher_sectors" | "researcher_screener"
  | "researcher_capex" | "researcher_bulk";

export type WatchlistRegion = "US" | "EU" | "ASIA" | "GLOBAL" | "UNKNOWN";

export interface WatchlistEntry {
  ticker: string;
  name?: string;
  source: WatchlistSource;
  region: WatchlistRegion;
  score?: number | null;
  conviction?: "high" | "medium" | "low" | null;
  actionRecommendation?: "Buy" | "Watch" | "Avoid" | null;
  rationale?: string | null;
  addedAt: string;
  lastSeenAt: string;
}
```

**Dedup:** 1 Eintrag pro `ticker`. **Storage:** `aktienanalyst_watchlist_v1`

## C.2 PortfolioPosition (P1) — unverändert

Bestehendes Interface in `positions.ts`. `addPositionFromOutside` → `makePosition({ ticker, name, entryPrice, qty: 1, side: "long" })`.

## C.3 Mapping Region → P3-Bucket

| Researcher-Region | P3-Label (UI) | Intern |
|-------------------|---------------|--------|
| US | USA | US |
| EU | EU | EU |
| ASIA | China / Asien | ASIA |
| — | Mixed | alle `source.startsWith("researcher")` |

---

# Kapitel D — Button-Spezifikation (UI)

## D.1 Aktienanalyse — Abschnitt 1 Datenaktualität

```
[ + Zum Portfolio ]   [ + Watchlist ]
```

## D.2 Researcher — pro Tab

| Komponente | Pro-Ticker-Button | Bulk |
|------------|-------------------|------|
| ScreenerPanel (`candidates[]`) | `+ Portfolio` · `+ WL` | „Alle Buy/Watch zur Watchlist“ |
| Sector Opportunity | `+ Portfolio` · `+ WL` | „Alle Beneficiaries …“ |
| Capex & Fiscal | `+ Portfolio` · `+ WL` | analog |
| Briefing | `+ Portfolio` · `+ WL` | „Alle Briefing-Ticker …“ |

---

# Kapitel E — Sidebar & Views (P2 / P3)

```ts
const SECTIONS = [
  { id: 1, label: "Übersicht", icon: LayoutDashboard },
  { id: 2, label: "Investments", icon: Table2 },
  { id: 3, label: "Policy", icon: SlidersHorizontal },
  { id: 4, label: "Optimierung", icon: BarChart3 },
  { id: 5, label: "Watchlist-Portfolio", icon: Star },
  { id: 6, label: "Researcher-Portfolios", icon: Globe2 },
] as const;
```

## E.4 Defaults Pipeline

| Parameter | Wert |
|-----------|------|
| maxWeight | 0,30 (30 %) |
| scoreMin (nur Auto-Intake) | 65 |
| Button-Add | **ignoriert** scoreMin |
| Kelly fraction | 0,5 (Half-Kelly) |
| Kelly maxF | 0,25 (25 %) |
| Σ-Fenster | 252 Handelstage |
| κ Score-Tilt | 0,35 |
| Kapital K Default | 100 000 € |

---

# Kapitel F — Region-Inferenz & Edge Cases

```ts
function inferRegion(ticker: string): WatchlistRegion {
  const t = ticker.toUpperCase();
  if (/\.(DE|PA|AS|BR|MI|MC|HE|ST|OL|CO|LS|VI)$/.test(t) || t.endsWith(".L")) return "EU";
  if (/\.(HK|SS|SZ|T|KS|KQ|TW|JK|BK|SI)$/.test(t)) return "ASIA";
  if (t === "BTC" || t.startsWith("BTC")) return "GLOBAL";
  return "US";
}
```

---

# Kapitel G — Acceptance Criteria (messbar)

```
[ ] 1. AAPL analysieren → Abschnitt 1 zeigt beide Buttons
[ ] 2. „Zum Portfolio“ → Investments enthält AAPL (qty=1, entry≈Kurs)
[ ] 3. „Zur Watchlist“ → localStorage watchlist_v1 enthält AAPL
[ ] 4. Sidebar hat Punkte 5 und 6
[ ] 5. id=5 zeigt AAPL und rechnet Gewichte sobald ≥2 Ticker + Kurse
[ ] 6. Researcher Screener US → pro Candidate beide Buttons + Bulk
[ ] 7. Bulk Screener → source=researcher_screener, region=US
[ ] 8. id=6 Tab USA zeigt diese; EU-Tab leer (wenn nur US-Adds)
[ ] 9. Briefing affectedTickers → regionstreu in P2 + P3
[ ] 10. Bestehende MSFT/NVDA/NVO/LLY-Positionen unverändert
[ ] 11. Re-Add kein Duplikat in P1 (open) bzw. P2
[ ] 12. „Als Position übernehmen“ in Watchlist-View → P1
```

---

# Kapitel H — Umsetzungsreihenfolge

```
Phase 1  add-bridge.ts + Watchlist-Storage/Hook + Buttons
Phase 2  Dashboard Abschnitt 1 + BTC
Phase 3  Researcher alle Tabs + Bulk
Phase 4  PortfolioPage SECTIONS +5 / +6
Phase 5  View Watchlist-Portfolio (Pipeline)
Phase 6  View Researcher-Portfolios (4 Buckets)
Phase 7  (optional) Storage-Event + Server /api/watchlist
```

---

# Kapitel I — Abgrenzung

| Bestehend | Status |
|-----------|--------|
| `handleAddPosition` / positions.ts | unverändert, von außen aufrufbar machen |
| CAPM / Kelly / Sharpe / weighting.ts | wiederverwendet |
| Order-Routing / Broker | out of scope |

---

**Fortsetzung:** Kapitel J–Q (File-Map, Kapitalgewichtung mit Zahlen, Risiko, Shrinkage δ=0.25, Frontier, Ist-Gewichte MSFT ~48% vs 30%, Fehlerstatus) folgen im nächsten Commit.
