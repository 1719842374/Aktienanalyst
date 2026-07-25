# Aktienanalyst — Architecture & Configuration Reference

> **Stand:** 2026-07-25 | Plattform: **Render** (Web Service, Free Plan) + **GitHub Actions** (Keep-Alive)

---

## Stack-Übersicht

```
┌───────────────────────────────────────────────────────────────────┐
│  BROWSER                                                         │
│  React 18 + TypeScript + Vite 7                                  │
│  TanStack Query v5  │  Wouter (routing)  │  Recharts            │
│  Tailwind CSS 3  │  shadcn/ui (Radix)  │  Lucide Icons         │
└───────────────────────────────────────────────────────────────────┘
           │  HTTP (POST /api/analyze, GET /api/health, …)
           ▼
┌───────────────────────────────────────────────────────────────────┐
│  SERVER  (Node 20, Express 5, TypeScript → esbuild CJS)          │
│  server/index.ts  →  dist/index.cjs  (prod)                      │
│  ├─ /api/health        ─ uptime check, no external deps           │
│  ├─ /api/analyze       ─ FMP data fetch + optional LLM            │
│  ├─ /api/cache         ─ JSON file cache (.cache/)                │
│  ├─ /api/fmp-budget    ─ FMP quota status                        │
│  ├─ /api/watchlist     ─ server-side watchlist (SQLite)           │
│  └─ /api/researcher    ─ OpenRouter LLM chat endpoint             │
└───────────────────────────────────────────────────────────────────┘
           │  HTTPS
           ▼
┌───────────────────────────────────────────────────────────────────┐
│  EXTERNAL APIs                                                   │
│  ├─ Financial Modeling Prep (FMP)  ─ Aktien/Finanzdaten          │
│  └─ OpenRouter (Claude 3.5 Haiku)  ─ KI-Modus Katalysatoren      │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│  GITHUB ACTIONS (Keep-Alive)                                     │
│  .github/workflows/keep-alive.yml                               │
│  Cron */5 * * * *  →  GET aktienanalyst.onrender.com/api/health  │
│  environment: production  │  vars.RENDER_URL                      │
└───────────────────────────────────────────────────────────────────┘
```

---

## Verzeichnisstruktur

```
Aktienanalyst/
├── client/                  # Frontend (React + Vite)
│   └── src/
│       ├── pages/           # Haupt-Seiten
│       │   ├── Dashboard.tsx      # Aktien-Analyse (17 Sektionen)
│       │   ├── BTCDashboard.tsx   # Bitcoin-Analyse
│       │   ├── GoldDashboard.tsx  # Gold-Analyse
│       │   ├── RecessionDashboard.tsx
│       │   ├── ScreenerDashboard.tsx
│       │   ├── Researcher.tsx     # LLM Chat-Interface
│       │   └── Compare.tsx        # Ticker-Vergleich
│       ├── components/      # Wiederverwendbare UI-Komponenten
│       │   ├── sections/        # Section1–Section17 + Spezial-Sections
│       │   ├── ui/              # shadcn/ui Basiskomponenten
│       │   ├── ThemeProvider.tsx
│       │   └── TickerSearch.tsx
│       ├── lib/
│       │   ├── queryClient.ts   # TanStack Query + apiRequest()
│       │   ├── calculations.ts  # GBM Monte Carlo, DCF, Finanzformeln
│       │   └── exportPdf.ts     # jsPDF Export
│       └── hooks/
├── server/                  # Backend (Express 5 + TypeScript)
│   ├── index.ts             # Entry point, Route-Registrierung
│   ├── routes.ts            # API-Routen (/api/analyze etc.)
│   ├── fmp.ts               # FMP API-Client + Quota-Guard
│   ├── cache.ts             # JSON-File-Cache (.cache/)
│   ├── llm.ts               # OpenRouter / Claude Integration
│   └── db.ts                # better-sqlite3 (Watchlist)
├── shared/                  # Geteilte Typen (Frontend + Backend)
│   └── schema.ts            # StockAnalysis TypeScript-Interface + Zod
├── script/
│   └── build.ts             # Vite (client) + esbuild (server) Build
├── .github/workflows/
│   └── keep-alive.yml       # Render warm halten (alle 5 Min)
├── Dockerfile               # Multi-stage: node:20-slim
├── vite.config.ts           # Vite 7 Config (root: client/)
├── tsconfig.json
├── package.json             # Monorepo (ein package.json für alles)
└── .env.example             # Alle benötigten Env Vars dokumentiert
```

---

## Build-Pipeline

```
npm run build
  └─ script/build.ts
       ├─ viteBuild()         ← client/  →  dist/public/  (React SPA)
       └─ esbuild()           ← server/index.ts  →  dist/index.cjs

npm run start
  └─ node dist/index.cjs     ← Express serviert dist/public/ als Static Files
```

### Bekannte Build-Fallstricke

| Problem | Ursache | Fix |
|---|---|---|
| `{ [Circular *1] }` + exit 1 | Vite 7 behandelt `CIRCULAR_DEPENDENCY` Warnings als Error (recharts/d3 false-positives) | `rollupOptions.onwarn` in `vite.config.ts` — **bereits gefixt** |
| `npm ci` exit 1 nach ~30s | Playwright postinstall lädt Chromium (~150 MB), Render-Builder Timeout | `ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` im Dockerfile **vor** `npm ci` — **bereits gefixt** |
| `better-sqlite3` binary error | native Addon, arm64 vs x64 mismatch | node:20-slim (x64) auf Render — kein Problem aktuell |
| TypeScript-Fehler in `tsx script/build.ts` | `import.meta.dirname` unbekannt in altem TS | tsconfig.json: `"module": "ESNext"`, `"moduleResolution": "Bundler"` |

---

## Konfiguration

### Render Environment Variables (Pflicht)

| Key | Wert | Wo gesetzt |
|---|---|---|
| `FMP_API_KEY` | Financial Modeling Prep API Key | Render → Environment |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | Render → Environment |
| `NODE_ENV` | `production` | Render → Environment |
| `PORT` | `5000` | Render → Environment |

### GitHub Environment `production` Variables (Pflicht für Keep-Alive)

| Key | Wert | Wo gesetzt |
|---|---|---|
| `RENDER_URL` | `https://aktienanalyst.onrender.com` | GitHub → Settings → Environments → production |

### Dockerfile ENV (bereits im Image gesetzt, nicht in Render UI)

| Key | Wert |
|---|---|
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` |
| `NODE_ENV` | `production` (Fallback) |
| `PORT` | `5000` (Fallback) |
| `PLAYWRIGHT_BROWSERS_PATH` | `/root/.cache/ms-playwright` |

---

## Bekannte Konfigurationsprobleme & Diagnose

### 1. `Retry 2/5` im Browser
**Ursache:** `POST /api/analyze` schlägt mehrfach fehl.  
**Diagnose:**
```
https://aktienanalyst.onrender.com/api/health
→ { "status": "ok" }   = Server läuft

https://aktienanalyst.onrender.com/api/fmp-budget
→ { "fmpAvailable": true }   = FMP Key gültig
```
**Häufigste Ursachen:**
- Render Cold Start (Server schließt nach 15 Min Inaktivität) → Keep-Alive-Workflow verhindert das
- `FMP_API_KEY` fehlt oder abgelaufen → Render Environment setzen
- FMP Tageslimit (18 Calls/Tag Free Plan) → Reset Mitternacht UTC

### 2. Render Deploy `Failed` in < 20s
**Ursache:** Build-Fehler, kein Runtime-Problem.  
**Diagnose:** Render → Deploys → letzter Eintrag → **View logs** → letzte rote Zeile  
**Häufige Ursachen:**
- `CIRCULAR_DEPENDENCY` exit 1 (Vite 7) → **bereits gefixt**
- Playwright postinstall timeout → **bereits gefixt**
- `package-lock.json` veraltet → `npm install` lokal, dann `package-lock.json` pushen

### 3. KI-Modus (violet Badge) antwortet nicht
**Ursache:** `OPENROUTER_API_KEY` fehlt oder kein Credit.  
**Diagnose:** `POST /api/researcher` gibt HTTP 402 oder `{"error": "No credits"}`  
**Fix:** OpenRouter Dashboard → Credits aufladen oder Key erneuern

### 4. Keep-Alive Workflow pingt leere URL
**Ursache:** `vars.RENDER_URL` im GitHub Environment `production` nicht gesetzt.  
**Diagnose:** GitHub → Actions → letzter `Keep Server Alive` Run → Step "Ping Render" → `HTTP status: 000`  
**Fix:** GitHub → Settings → Environments → production → Variables → `RENDER_URL` setzen

### 5. `dist/index.cjs not found` beim Start
**Ursache:** `npm run build` war nie erfolgreich (kein `dist/` Verzeichnis).  
**Fix:** Render → Manual Deploy → nach Build-Fix

---

## Frontend-Technologien im Detail

| Technologie | Version | Rolle |
|---|---|---|
| React | 18.3 | UI-Framework |
| TypeScript | 5.6.3 | Typsicherheit Frontend + Backend |
| Vite | ^7.3 | Dev-Server + Bundler (Client) |
| TanStack Query | v5 | Server-State, Caching, Retry-Logik |
| Wouter | ^3.3 | Client-Side Routing (`/`, `/btc`, `/gold`, `/researcher`, …) |
| Recharts | ^2.15 | Charts (Line, Bar, Area, Scatter) |
| Tailwind CSS | ^3.4 | Utility-First Styling |
| shadcn/ui | — | Radix-basierte UI-Komponenten |
| Lucide React | ^0.453 | Icons |
| jsPDF | ^4.2 | PDF-Export |
| Framer Motion | ^11 | Animationen |

## Backend-Technologien im Detail

| Technologie | Version | Rolle |
|---|---|---|
| Node.js | 20 (slim Docker) | Runtime |
| Express | ^5.0 | HTTP-Server |
| esbuild | ^0.25 | Server-Bundler → `dist/index.cjs` |
| better-sqlite3 | ^12 | Watchlist-Datenbank (lokale SQLite) |
| Drizzle ORM | ^0.39 | Schema + Migrations |
| Zod | ^3.24 | Runtime-Validierung API-Responses |
| Playwright | ^1.59 | PDF-Screenshot (optional) |
| OpenAI SDK | ^6.37 | Wird für OpenRouter genutzt (kompatibel) |

---

## API-Endpoints Referenz

| Methode | Pfad | Auth | Beschreibung |
|---|---|---|---|
| `GET` | `/api/health` | — | Uptime-Check, kein FMP, kein DB |
| `GET` | `/api/cache` | — | Cache-Status + Token-Refresh-Trigger |
| `GET` | `/api/fmp-budget` | — | FMP Quota-Status |
| `POST` | `/api/analyze` | — | Aktienanalyse (Body: `{ticker, useLLM, force}`) |
| `GET` | `/api/watchlist` | — | Watchlist lesen |
| `POST` | `/api/watchlist` | — | Watchlist schreiben |
| `POST` | `/api/researcher` | — | LLM Chat (Body: `{messages, model}`) |

---

## Wichtige Docs im Repo

| Datei | Inhalt |
|---|---|
| [`DEPLOY.md`](./DEPLOY.md) | Render-Deploy-Anleitung (teilweise veraltet: noch pplx.app Referenzen) |
| [`API_COSTS.md`](./API_COSTS.md) | FMP + OpenRouter Kosten pro Analyse |
| [`API_FAILURE_MAP.md`](./API_FAILURE_MAP.md) | Alle FMP-Endpunkte + Fallback-Verhalten |
| [`DATA_SOURCES.md`](./DATA_SOURCES.md) | Alle Datenquellen + Felder |
| [`WORK.md`](./WORK.md) | Entwicklungs-Journal (Aufgaben, Status) |
| [`.env.example`](./.env.example) | Alle Env Vars mit Beispielwerten |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | **Dieses Dokument** |
