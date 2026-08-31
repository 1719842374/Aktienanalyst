# Sprint D6c — Verknüpfungs-Audit (vor jeder Änderung durchgeführt)

Datum: 31.08.2026. Baseline: `git pull origin main` → bereits auf `7b6e230` (nichts Neues zu pullen).
`npx tsc --noEmit` Baseline: **97 Fehler** (bestätigt, identisch mit D6b-Wert).

## 1. `client/src/App.tsx` — Route `/valuechain` registriert?

**JA.** Zeile 18: `import ValueChainDashboard from "@/pages/ValueChainDashboard";`
Zeile 37: `<Route path="/valuechain" component={ValueChainDashboard} />`
Die Route existiert und funktioniert bereits (D6a/D6b) — nur der Einstiegspunkt fehlt.

## 2. `client/src/pages/Dashboard.tsx` — Top-Bar-Buttons: welche Routen verlinkt, welche fehlen?

Top-Bar (Zeilen ~401-448) verlinkt aktuell:
- KI-Toggle (kein Navigations-Button, State-Toggle)
- `NavToBTC` → `/btc`
- Gold (amber) → `/gold`
- Rezession (orange) → `/recession`
- Screener (cyan) → `/screener`
- Researcher (violet) → `/researcher`
- Portfolio (emerald) → `/portfolio`
- VGL (neutral) → `/compare`
- Theme-Toggle

**FEHLT: kein Button für `/valuechain`.** Bestätigt den Nutzer-Screenshot exakt.
Freie Akzentfarben (noch nicht belegt): Indigo, Teal, Sky, Rose, Lime. → Indigo gewählt für den neuen Button
(Icon `Network` aus lucide-react, noch nicht importiert).

## 3. `client/src/pages/ValueChainDashboard.tsx` — Importe korrekt? Zurück-Button vorhanden?

Importe (Zeilen 23-29) sind korrekt: `StageColumn`, `ValueChainKpiTiles`, `ValueChainResponse`/`Region`-Typen,
`apiRequest`, `useLocation` aus wouter — alles vollständig und funktionsfähig.

**FEHLT: kein "Zurück zur Startseite"-Link/Button.** Die Seite hat einen Header mit Branchen-/Region-/
MCap-Dropdowns, Aktualisieren- und Info-Button, aber keinen Weg zurück zur Startseite außer Browser-Back.
`useLocation`/`navigate` ist bereits importiert (wird für Karten-Klicks zu `/?ticker=` genutzt, Zeile 263),
kann direkt für einen Zurück-Button wiederverwendet werden.

## 4. `server/routes-register.ts` — ist `valuechain-routes.ts` serverseitig aktiv eingehängt?

**JA, aktiv eingehängt.** Zeile 19-20 in `routes-register.ts`:
```ts
const { registerValueChainRoutes } = await import("./valuechain-routes");
registerValueChainRoutes(app);
```
Dies wird in `registerRoutes()` ausgeführt, welches wiederum von `server/index.ts` beim Serverstart
aufgerufen wird. Die Route ist nicht nur als Datei vorhanden, sondern live erreichbar unter
`GET /api/valuechain` und `GET /api/valuechain/industries`.

## 5. `server/valuechain-routes.ts` — wird `llmValidated`/`validated` je auf `true` gesetzt?

**NEIN — überall hartkodiert `false`.**
- Zeile 247: `validated: false, // llmValidated bewusst false — kein LLM-Call in diesem Ticket` (pro Firma)
- Zeile 207: `llmValidated: false` (Empty-Response-Zweig, keine Firmen von FMP)
- Zeile 285: `llmValidated: false` (Haupt-Response-Zweig)
Es gibt keinen Code-Pfad, der diese Felder je auf `true` setzt. Kommentar bestätigt Absicht aus D6a explizit.

## 6. `server/llm-openrouter.ts` — beste Vorlage für den neuen Call?

**`generateCatalystDeepDives` (Zeile 362-442)** ist die beste Vorlage:
- Nutzt `getClient()` (Lazy-Singleton, `null` wenn kein `OPENROUTER_API_KEY`) → saubere Kein-Fake-Daten-
  Rückgabe bei fehlendem Key.
- Nutzt `callWithFallback()` mit der zentralen `MODEL_FALLBACK_CHAIN` (Haiku 4.5 → Deepseek → Llama 3.3 →
  Gemma 3).
- `response_format: { type: 'json_object' }` + Markdown-Fence-Stripping (Zeilen 401-404) — nötig, weil
  manche Modelle trotz `json_object`-Modus ` ```json ` einfügen (live beobachtet für MSFT, siehe Kommentar).
- `JSON.parse` mit `salvageTruncatedJson`-Fallback bei abgeschnittenem JSON.
- Try/Catch gibt bei jedem Fehler `null` zurück statt Fake-Daten — genau das Zahlen-Prinzip, das für
  `llmValidated` gefordert ist.
- `CatalystDeepDiveInput`-Interface-Muster (klar typisiertes Input-Objekt) wird für
  `ValueChainEnrichInput`/`enrichValueChainStages` übernommen.

Sandbox-Umgebungsvariable `OPENROUTER_API_KEY` ist NICHT als Shell-Env gesetzt, ABER in `.env` im
Repo-Root vorhanden und wird von `server/index.ts` via `import "dotenv/config"` (Zeile 3) beim
Serverstart geladen — d.h. ein echter Live-Test des LLM-Calls über den laufenden Dev-Server ist möglich.

## 7. Weitere "tote" Routen/Features aus D6a/D6b?

Geprüft: keine weiteren toten Server-Routen gefunden — `/api/valuechain` und `/api/valuechain/industries`
werden beide vom Frontend (`ValueChainDashboard.tsx`) genutzt. Die "Weitere Dashboards"-Willkommenskarte
auf der Startseite (Zeilen 694-719 in Dashboard.tsx) verlinkt aktuell BTC-Analyse, Rezessions-Dashboard,
Virtuelles Portfolio — **auch hier fehlt Value-Chain** (Ticket-Punkt 4, Teil 1). Das einzige bestätigte
"tote Feature" ist also: Value-Chain-Seite komplett ohne Einstiegspunkt (weder Top-Bar noch Willkommenskarte)
und ohne Rückweg. Wird in Teil 1 behoben.

## Zusammenfassung Audit

| # | Frage | Ergebnis |
|---|---|---|
| 1 | Route `/valuechain` in App.tsx? | ✅ Vorhanden |
| 2 | Top-Bar-Button für Value-Chain? | ❌ Fehlt — wird ergänzt |
| 3 | Importe in ValueChainDashboard.tsx? | ✅ Korrekt / ❌ Zurück-Button fehlt — wird ergänzt |
| 4 | Serverseitige Registrierung aktiv? | ✅ Aktiv über routes-register.ts |
| 5 | `llmValidated`/`validated` je `true`? | ❌ Nie — überall hartkodiert `false` (by design, D6a) |
| 6 | Beste LLM-Vorlage? | `generateCatalystDeepDives` (callWithFallback + json_object + Fence-Stripping) |
| 7 | Weitere tote Features? | Willkommenskarte fehlt ebenfalls Value-Chain-Eintrag — wird ergänzt |
