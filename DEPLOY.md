# DEPLOY.md — LLM Coding Skill

> Dieses Dokument ist ein verbindlicher Coding-Skill für jedes LLM, das an diesem Projekt arbeitet.
> Jede Regel hier hat einen dokumentierten Grund — meist ein bereits aufgetretener Bug.
> Abweichungen führen zu Fehlern, die schwer zu debuggen sind.

---

## 1. PLATTFORM & UMGEBUNG

### 1.1 Produktionsumgebung

```
Plattform:   Perplexity Computer (pplx.app)
URL:         https://aktienanalyst-pro.pplx.app
Deploy-Tool: publish_website (Perplexity-internes Tool)
Node:        >= 18
Port:        5000 (fest, nicht konfigurierbar)
```

### 1.2 Kritisch: Perplexity Finance API (external-tool)

```
NUR verfügbar in: Perplexity Computer Sandbox (pplx.app)
NICHT verfügbar in: Docker, Railway, Render, lokaler Entwicklung

Fehler wenn extern aufgerufen:
  Error: external-tool CLI not found
  ENOENT: no such file or directory 'external-tool'

Konsequenz für Code:
  IMMER einen FMP-Fallback implementieren wenn external-tool genutzt wird.
  Niemals external-tool ohne try/catch aufrufen.
  Pattern:
    try { result = await callExternalTool(...); }
    catch { result = await fmpFallback(...); }
```

### 1.3 Environment Variables

```
Werden beim publish_website-Aufruf als credentials= injiziert.
NIEMALS im Code hardcoden. NIEMALS in Git commiten.

Variablen:
  FMP_API_KEY         Financial Modeling Prep (750 Calls/Tag, Free Tier)
  OPENROUTER_API_KEY  OpenRouter → Claude 3.5 Haiku
  PERPLEXITY_API_KEY  Für sonar-pro LLM-Search (WORK.md: /api/llm-search)

Lokal: .env-Datei (aus .env.example erzeugen)
  cp .env.example .env

Zugriff im Code:
  process.env.FMP_API_KEY
  // Nie ohne Nullcheck: process.env.FMP_API_KEY! nur in startup-Validierung
```

### 1.4 Lokale Entwicklung

```bash
cp .env.example .env         # Keys eintragen
npm install
npm run dev                  # Port 5000, hot-reload
npm run check                # TypeScript-Fehler prüfen
npm run build                # Produktions-Build
```

---

## 2. ARCHITEKTUR-REGELN

### 2.1 Monorepo-Struktur

```
projekt/
├── client/                   Frontend (React + Vite)
│   └── src/
│       ├── pages/            Dashboard-Seiten (BTCDashboard, StockDashboard, ...)
│       │   └── btc/          Modulare Sub-Komponenten für BTCDashboard
│       ├── components/       Wiederverwendbare UI-Komponenten
│       ├── lib/
│       │   ├── calculations.ts   Alle Rechenformeln (unit-testbar)
│       │   ├── formatters.ts     formatCurrency, formatPercent, ...
│       │   └── btcAnalysis.ts    BTC-spezifische Analyse-Logik
│       └── hooks/            Custom React Hooks
├── server/
│   ├── index.ts          Express-App, Middleware, Router-Registrierung
│   ├── routes/           Ein Handler pro Route-Gruppe (max 80 KB pro Datei)
│   └── db.ts             SQLite-Cache (7 Tage)
├── shared/
│   └── schema.ts         Zod-Schemas und TypeScript-Interfaces (geteilt Client+Server)
├── WORK.md               Aufgabenliste, Restore-Plan, Feature-Roadmap
└── DEPLOY.md             Dieser Skill
```

### 2.2 Anti-Truncation-Regel (kritisch)

```
Problem: GitHub API trunciert Dateien > ~100 KB Base64.
Symptom: Datei hört mitten im Code auf, kein Syntaxfehler, aber Funktionen fehlen.
Betroffen war: BTCDashboard.tsx (>2500 Zeilen), server/routes.ts

REGEL: Keine Datei darf > 80 KB werden.

Prüfen vor jedem Commit:
  wc -c client/src/pages/BTCDashboard.tsx
  wc -c server/routes/stock.ts
  # Wenn > 80000 Bytes → aufsplitten

Aufsplitten-Strategie:
  BTCDashboard.tsx → Shell (~200 Zeilen) + btc/Sections1to6.tsx + btc/Sections7to12.tsx + btc/Section13Miner.tsx
  server/routes.ts → server/routes/stock.ts + server/routes/btc.ts + server/routes/gold.ts

Shell-Datei-Prinzip: Nur Imports, State-Management, Router-Registrierung.
Keine Logik, keine langen Komponenten in der Shell.
```

### 2.3 Server-Routing

```ts
// server/index.ts — Registrierung aller Router
import stockRouter from './routes/stock';
import btcRouter   from './routes/btc';
import goldRouter  from './routes/gold';

app.use('/api/stock',  stockRouter);
app.use('/api/btc',    btcRouter);
app.use('/api/gold',   goldRouter);

// Jede routes/*.ts-Datei exportiert einen Express Router:
import { Router } from 'express';
const router = Router();
router.get('/:ticker', handler);
export default router;

// FEHLER: Niemals app direkt in routes/*.ts importieren.
// FEHLER: Niemals zwei Router auf demselben Pfad registrieren.
```

### 2.4 Frontend-Routing (wouter)

```tsx
// client/src/App.tsx
import { Route, Switch } from 'wouter';

// Alle Routen hier registrieren:
<Switch>
  <Route path="/"         component={Home} />
  <Route path="/stock"    component={StockDashboard} />
  <Route path="/btc"      component={BTCDashboard} />
  <Route path="/gold"     component={GoldDashboard} />
  <Route path="/recession" component={RecessionBoard} />
</Switch>

// Navigation zwischen Seiten:
import { useLocation } from 'wouter';
const [, setLocation] = useLocation();
setLocation('/btc');

// FEHLER: Niemals window.location.href für interne Navigation.
// FEHLER: Niemals react-router-dom installieren (Konflikt mit wouter).
```

---

## 3. SECTION-SYSTEM (Sidebar + Main)

### 3.1 Pattern für jedes Dashboard

```tsx
// Jedes Dashboard hat:
// 1. SECTIONS-Array (Sidebar-Konfiguration)
// 2. sectionRefs (für Scroll-Navigation)
// 3. renderSection-Funktion (Section-Switch)
// 4. activeSection-State

const SECTIONS = [
  { id: 1,  label: 'Status & Preis',    icon: Bitcoin     },
  { id: 2,  label: 'Halving-Zyklus',   icon: Activity    },
  // ... weitere Sections
  { id: 13, label: 'Miner-Zone',        icon: Cpu         },
] as const;

// sectionRefs: ein Ref pro Section-ID
const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});

// scrollToSection
const scrollToSection = useCallback((id: number) => {
  setActiveSection(id);
  sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}, []);

// Render-Switch
const renderSection = (id: number, data: SomeAnalysis) => {
  switch (id) {
    case 1:  return <Section1Status data={data} />;
    case 13: return <Section13Miner data={data} minerData={minerData} loading={minerLoading} error={minerError} />;
    default: return null;
  }
};
```

### 3.2 Neue Section hinzufügen (Checkliste)

```
[ ] 1. Eintrag in SECTIONS-Array: { id: N, label: '...', icon: ImportedIcon }
[ ] 2. case N: in renderSection-Switch
[ ] 3. Section-Komponente als eigene Datei (wenn > 100 Zeilen)
[ ] 4. Import der Komponente in Shell/Dashboard
[ ] 5. sectionRefs[N] wird automatisch durch Map abgedeckt — kein manueller Eingriff
[ ] 6. Backend-Endpunkt in server/routes/*.ts (falls nötig)
[ ] 7. useQuery/useMutation in Dashboard-Shell (falls nötig)
[ ] 8. Props-Interface in shared/schema.ts definieren
```

### 3.3 SectionCard-Komponente

```tsx
// client/src/components/SectionCard.tsx
// IMMER für neue Sections verwenden:
<SectionCard number={13} title="Miner-Zone">
  {/* Inhalt */}
</SectionCard>

// Props: number (int), title (string), children (ReactNode)
// Rendert: Nummer-Badge + Titel + scrollIntoView-Ref automatisch
```

---

## 4. API-INTEGRATION

### 4.1 FMP API — Korrektes Pattern

```ts
// server/lib/fmp.ts (Helper, einmal definieren, überall importieren)
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export async function fmpGet<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY nicht gesetzt');

  const url = new URL(`${FMP_BASE}${path}`);
  url.searchParams.set('apikey', key);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FMP ${path} HTTP ${res.status}`);

  const data = await res.json();
  // FMP gibt bei ungültigem Ticker manchmal { "Error Message": "..." } zurück
  if (data && typeof data === 'object' && 'Error Message' in data) {
    throw new Error(`FMP: ${(data as any)['Error Message']}`);
  }
  return data as T;
}

// Nutzung:
const profile = await fmpGet<FMPProfile[]>(`/profile/${ticker}`);
const history = await fmpGet<{ historical: FMPPrice[] }>(
  `/historical-price-full/${ticker}`,
  { from: '2015-01-01' }   // 10 Jahre
);
const income  = await fmpGet<FMPIncome[]>(`/income-statement/${ticker}`, { limit: '5' });
const metrics = await fmpGet<FMPMetrics[]>(`/key-metrics/${ticker}`, { limit: '3' });
```

### 4.2 FMP-Fehlerbehandlung (Pflicht in jedem Route-Handler)

```ts
router.get('/:ticker', async (req, res) => {
  const { ticker } = req.params;

  // Input-Validierung
  if (!ticker || !/^[A-Z]{1,10}$/.test(ticker.toUpperCase())) {
    return res.status(400).json({ error: 'Ungültiger Ticker' });
  }

  try {
    const data = await fmpGet<FMPProfile[]>(`/profile/${ticker.toUpperCase()}`);

    if (!data || data.length === 0) {
      return res.status(404).json({ error: `Ticker ${ticker} nicht gefunden` });
    }

    return res.json(data[0]);
  } catch (err) {
    console.error(`[FMP /profile/${ticker}]`, err);
    return res.status(502).json({
      error: 'FMP-API nicht erreichbar',
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});
```

### 4.3 LLM-Search (Perplexity sonar-pro)

```ts
// server/routes/llm-search.ts
router.post('/', async (req, res) => {
  const { query, ticker, context } = req.body;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [{ role: 'user', content: query }],
      search_recency_filter: 'month',
      return_citations: true,
    }),
  });

  const data = await response.json();
  // Response: data.choices[0].message.content, data.citations
  return res.json({
    answer: data.choices[0].message.content,
    sources: data.citations ?? [],
  });
});

// app.use('/api/llm-search', llmSearchRouter); in index.ts
```

### 4.4 mempool.space API (BTC)

```ts
// Kein API-Key nötig, kostenlos
const MEMPOOL = 'https://mempool.space/api';

// Hashrate 3 Jahre:
GET https://mempool.space/api/v1/mining/hashrate/3y
// Response: { hashrates: [{ timestamp, avgHashrate }], difficulty: [...] }

// Difficulty-Adjustments:
GET https://mempool.space/api/v1/mining/difficulty-adjustments
// Response: Array von { time, difficulty, difficultyChange }

// FEHLER: Rate-Limiting bei vielen Requests → Ergebnisse 24h cachen (SQLite)
```

### 4.5 FRED API (Gold/Makro)

```ts
// Kostenlos, API-Key über FRED_API_KEY
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// Realzins (DFII10):
const url = `${FRED_BASE}?series_id=DFII10&api_key=${FRED_KEY}&file_type=json&limit=100&sort_order=desc`;
// Response: { observations: [{ date: 'YYYY-MM-DD', value: '1.23' }] }

// Wichtig: value kann '.', 'N/A' oder leer sein bei fehlenden Datenpunkten
// Immer filtern: .filter(o => o.value !== '.' && o.value !== 'N/A')
```

---

## 5. FRONTEND-PATTERNS

### 5.1 React Query (Pflicht für alle API-Calls)

```tsx
import { useQuery, useMutation } from '@tanstack/react-query';

// GET-Request:
const { data, isLoading, isError, error } = useQuery({
  queryKey: ['stock-profile', ticker],
  queryFn: async () => {
    const r = await fetch(`/api/stock/${ticker}`);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${r.status}`);
    }
    return r.json();
  },
  enabled: !!ticker,
  retry: 2,
  staleTime: 5 * 60 * 1000,   // 5 Min Cache
});

// POST-Request (z.B. Analyse ausführen):
const { mutate, isPending } = useMutation({
  mutationFn: (input: AnalyseInput) =>
    fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(r => r.json()),
});

// FEHLER: Niemals fetch() direkt in useEffect ohne React Query.
// FEHLER: Niemals queryKey ohne den eigentlichen Parameter (ticker, etc.).
```

### 5.2 Loading/Error-States (Pflicht in jeder Section)

```tsx
function Section1Overview({ ticker }: { ticker: string }) {
  const { data, isLoading, isError, error } = useQuery({ ... });

  if (isLoading) return (
    <SectionCard number={1} title="Übersicht">
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    </SectionCard>
  );

  if (isError) return (
    <SectionCard number={1} title="Übersicht">
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-500">
        {error instanceof Error ? error.message : 'Fehler beim Laden'}
      </div>
    </SectionCard>
  );

  if (!data) return null;

  return (
    <SectionCard number={1} title="Übersicht">
      {/* Inhalt */}
    </SectionCard>
  );
}
```

### 5.3 Styling-Regeln (Tailwind + shadcn/ui)

```tsx
// Farb-Ampel (einheitlich im gesamten Projekt):
// Positiv/Bull:   text-emerald-500  bg-emerald-500/10  border-emerald-500/30
// Neutral/Warn:   text-amber-500    bg-amber-500/10    border-amber-500/30
// Negativ/Bear:   text-red-500      bg-red-500/10      border-red-500/30
// Muted/Info:     text-muted-foreground

// Karten:
// bg-muted/30 border border-border rounded-lg p-3

// Grid-Layout für MetricCards:
// grid grid-cols-2 sm:grid-cols-4 gap-3

// Recharts Tooltip (einheitlich):
const tooltipStyle = {
  fontSize: 11,
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
};

// FEHLER: Keine hardcodierten Hex-Farben (#ffffff) für UI-Elemente.
// FEHLER: Keine inline style={{ color: 'green' }} für Statusfarben.
// Ausnahme: Recharts Cell fill="#22c55e" ist erlaubt (keine CSS-Variable möglich).
```

### 5.4 MetricCard (Standardkomponente)

```tsx
// client/src/pages/BTCDashboard.tsx (oder eigene Datei)
function MetricCard({ label, value, subValue, color }: {
  label: string; value: string; subValue?: string; color?: string;
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${color ?? 'text-foreground'}`}>{value}</div>
      {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}

// FEHLER: Nicht in jeder Datei neu definieren — einmal exportieren, dann importieren.
```

### 5.5 Numerische Eingabefelder (freie Eingabe mit Validierung)

```tsx
// Pattern für alle freien Zahlen-Inputs (Iterationen, Horizont, etc.):
const [input, setInput] = useState('10000');     // String-State für freie Eingabe
const [value, setValue] = useState(10000);       // Number-State für Berechnung

<input
  type="text"
  inputMode="numeric"
  value={input}
  onChange={e => setInput(e.target.value.replace(/[^0-9]/g, ''))}
  onBlur={() => {
    const parsed = parseInt(input, 10);
    const clamped = isNaN(parsed) ? value : Math.min(MAX, Math.max(MIN, parsed));
    setValue(clamped);
    setInput(String(clamped));
  }}
/>
// FEHLER: type="number" — führt zu Problemen mit Leereingabe und Browser-Verhalten.
// FEHLER: direkt value als Number-State verwenden — Eingabe während Tippen unmöglich.
```

---

## 6. TYPESCRIPT-REGELN

### 6.1 Interfaces in shared/schema.ts

```ts
// Alle geteilten Typen (Client + Server) in shared/schema.ts:
export interface BTCAnalysis { ... }
export interface MinerData { ... }
export interface StockProfile { ... }

// Import im Client:
import type { BTCAnalysis } from '@shared/schema';
// Import im Server:
import type { BTCAnalysis } from '../shared/schema';

// FEHLER: Dasselbe Interface in Client und Server duplizieren.
// FEHLER: any-Type für API-Responses. Immer typisieren.
```

### 6.2 Zod-Validierung (Server-Input)

```ts
import { z } from 'zod';

const TickerSchema = z.string().min(1).max(10).regex(/^[A-Z]+$/);
const AnalyseInputSchema = z.object({
  ticker: TickerSchema,
  wacc: z.number().min(0.01).max(0.30).optional().default(0.09),
  terminalGrowth: z.number().min(0).max(0.10).optional().default(0.025),
});

// In Route-Handler:
const parsed = AnalyseInputSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: parsed.error.flatten() });
}
const { ticker, wacc } = parsed.data;
```

### 6.3 Null-Safety

```ts
// FMP-Felder können null sein — immer defensiv:
const pe = profile.pe ?? null;             // null statt undefined
const price = profile.price ?? 0;          // 0 als sicherer Fallback für Zahlen
const name = profile.companyName ?? ticker; // Ticker als Fallback für Strings

// Im Frontend:
const peDisplay = pe !== null ? pe.toFixed(2) : 'N/A';

// FEHLER: profile.price.toFixed(2) ohne Nullcheck (crashes wenn price = null)
```

---

## 7. DATENBANK (SQLite Cache)

```ts
// server/db.ts
// Cache-Tabelle: analyses (ticker TEXT, data JSON, created_at INTEGER)
// TTL: 7 Tage (604800 Sekunden)

// Lesen:
const cached = db.prepare(
  'SELECT data FROM analyses WHERE ticker = ? AND created_at > ?'
).get(ticker, Date.now() - 7 * 24 * 3600 * 1000);
if (cached) return JSON.parse(cached.data);

// Schreiben:
db.prepare(
  'INSERT OR REPLACE INTO analyses (ticker, data, created_at) VALUES (?, ?, ?)'
).run(ticker, JSON.stringify(result), Date.now());

// FEHLER: Cache niemals ohne TTL — veraltete Daten werden sonst ewig ausgeliefert.
// FEHLER: Große JSON-Blobs (> 1 MB) nicht cachen ohne Größencheck.
```

---

## 8. GIT-WORKFLOW

### 8.1 Branch-Strategie

```
Hauptbranch: main (produktiv, immer stabil)

Feature/Fix-Branches:
  fix/fmp-helper
  fix/btc-dashboard-split
  feat/gold-dashboard
  feat/reverse-dcf

Branch-Lebensdauer: Merge → löschen
Kein direkter Push auf main.
```

### 8.2 Commit-Konventionen

```
Format: <type>(<scope>): <beschreibung>

Types:
  feat     Neues Feature
  fix      Bugfix
  docs     Nur Dokumentation (WORK.md, DEPLOY.md, README)
  refactor Code-Umstrukturierung ohne Feature-Änderung
  chore    Build, Abhängigkeiten, Config

Beispiele:
  feat(btc): Section 13 Miner-Zone Hashprice Chart
  fix(fmp): korrekte Fehlerbehandlung bei HTTP 429 (Rate Limit)
  docs(WORK.md): FMP-Migration Migrationsplan ergänzt
  refactor(btc-dashboard): Sections 1-6 in eigene Datei ausgelagert
```

### 8.3 PR-Checkliste (vor jedem Merge)

```
[ ] npm run check — keine TypeScript-Fehler
[ ] npm run dev — App startet, keine Console-Errors
[ ] Alle betroffenen Sections manuell durchklickt
[ ] Dateigrößen: wc -c auf alle geänderten Dateien — keine > 80 KB
[ ] Keine hardcodierten API-Keys im Diff
[ ] Keine console.log für sensible Daten (API-Keys, User-Daten)
[ ] Copilot-Review angefordert und Kommentare addressiert
[ ] Squash & Merge (kein Merge-Commit, kein Rebase-Chaos)
```

---

## 9. HÄUFIGE FEHLER (aus vergangenen Sessions dokumentiert)

```
FEHLER 1: BTCDashboard.tsx trunciert
  Ursache:  Datei > 100 KB, GitHub API Base64-Limit
  Symptom:  Sections 3-12 + export default fehlen, App lädt aber zeigt nichts
  Fix:      Datei in btc/Sections1to6.tsx + btc/Sections7to12.tsx + Shell aufsplitten
  Prävention: wc -c vor jedem Push

FEHLER 2: FMP gibt leeres Array zurück
  Ursache:  Ticker nicht in FMP-Datenbank (z.B. OTC-Aktien, falsches Symbol)
  Symptom:  Undefined-Error im Frontend bei data[0].price
  Fix:      if (!data || data.length === 0) → 404 zurückgeben
  Prävention: Immer Array-Länge prüfen vor Zugriff

FEHLER 3: external-tool nicht gefunden auf Docker/lokal
  Ursache:  CLI nur auf pplx.app verfügbar
  Symptom:  ENOENT Error, gesamter Analyse-Handler crashed
  Fix:      try/catch + FMP-Fallback
  Prävention: Immer Fallback implementieren

FEHLER 4: React Query queryKey ohne Parameter
  Ursache:  queryKey: ['stock-profile'] statt ['stock-profile', ticker]
  Symptom:  Caching-Bug: falscher Ticker liefert gecachte Daten vom vorherigen Ticker
  Fix:      Alle variablen Parameter in queryKey aufnehmen
  Prävention: queryKey immer mit allen Inputs die das Ergebnis beeinflussen

FEHLER 5: Direkter push auf main
  Ursache:  Code-Änderung direkt committed ohne Branch + PR
  Symptom:  Kaputte main, kein einfaches Rollback
  Fix:      git revert <commit-sha>
  Prävention: Branch-Workflow strikt einhalten

FEHLER 6: type="number" Input bei freien Werten
  Ursache:  Browser-natives number-Input
  Symptom:  Leereingabe zeigt '0', Dezimalkomma vs. Punkt-Problem, kein Commit-on-blur
  Fix:      type="text" inputMode="numeric" + String-State + onBlur-Validierung

FEHLER 7: Interface in Client und Server dupliziert
  Ursache:  Typ lokal definiert statt aus shared/schema importiert
  Symptom:  Typ-Inkonsistenz, TypeScript-Fehler nach API-Änderung nur in einer Hälfte
  Fix:      Alle geteilten Typen in shared/schema.ts, überall importieren

FEHLER 8: FMP 'Error Message' Key nicht geprüft
  Ursache:  FMP gibt { "Error Message": "Invalid API KEY." } mit HTTP 200 zurück
  Symptom:  Data wird als gültig behandelt, aber data[0].price ist undefined
  Fix:      if ('Error Message' in data) throw new Error(data['Error Message'])

FEHLER 9: FRED-Wert '.' nicht gefiltert
  Ursache:  FRED gibt '.' für fehlende Datenpunkte
  Symptom:  parseFloat('.') = NaN, Chart zeigt Lücken oder crashed
  Fix:      .filter(o => o.value !== '.' && o.value !== 'N/A')

FEHLER 10: GWS-Score für Aktien verwendet
  Ursache:  GWS (Gesamt-Weighted-Score) ist ein BTC-spezifisches Modell
  Symptom:  Begriff verwirrt, kein Standard in Aktienanalyse
  Fix:      Für Aktien: Thesis Score verwenden (WORK.md dokumentiert)
```

---

## 10. TECH STACK (Referenz)

| Schicht | Technologie | Version |
|---|---|---|
| Frontend | React | 18 |
| Frontend | Vite | aktuell |
| Frontend | Tailwind CSS | 3 |
| Frontend | shadcn/ui | aktuell |
| Frontend | Recharts | 2 |
| Frontend | wouter | 3 (KEIN react-router) |
| Frontend | @tanstack/react-query | 5 |
| Frontend | lucide-react | aktuell |
| Backend | Express | 4 |
| Backend | TypeScript (esbuild) | 5 |
| Backend | Zod | 3 |
| Daten | FMP API | v3 |
| Daten | mempool.space | kostenlos |
| Daten | FRED API | kostenlos |
| Daten | Glassnode | free tier |
| KI | Perplexity sonar-pro | aktuell |
| KI | OpenRouter → Claude 3.5 Haiku | aktuell |
| Cache | SQLite (better-sqlite3) | — |
| Hosting | pplx.app | — |
