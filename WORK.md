# WORK.md

> Stand: 28.07.2026 | Branch: `main`
> Regel: Kein Code-Push über GitHub API ohne lokale Validierung + PR + Review.
> Ausnahme: reine Dokumentations-Updates in WORK.md sind explizit freigegeben.
> RESTORE: Inhalt aus Commit 975dbe93ce11365a7fd1b0d5d7093cb638a6f4c6 wiederhergestellt.
> TEIL 8.12 (FRED/Macro/Tech) siehe WORK2.md

---

# TEIL 0 — PLATFORM-REALITÄT & SOFORT-FIXES (Stand 25.07.2026)

> Dieser Teil dokumentiert die echte Deploy-Situation und die daraus resultierenden
> P0-Fixes. Alle früheren Annahmen zu "Railway" sind falsch — das Projekt läuft
> NICHT auf Railway und hat es nie produktiv getan.

## 0.1 — Produktive Deployments

```
Plattform 1: Perplexity Computer (pplx.app)           [PRIMÄR]
  URL:        https://aktienanalyst-pro.pplx.app
  Deploy:     publish_website (Perplexity-internes Tool)
  Keys:       werden als credentials= beim publish_website-Aufruf injiziert
  Besonderheit: external-tool CLI verfügbar (wird aber nicht mehr genutzt, stub)

Plattform 2: Render (Docker-Container)                [SEKUNDÄR]
  URL:        https://aktienanalyst.onrender.com
  Deploy:     Dockerfile → node:20-slim, baut via npm run build, startet node dist/index.cjs
  Keys:       müssen im Render-Dashboard unter "Environment" gesetzt sein
  Port:       5000 (fest im Dockerfile: EXPOSE 5000)
  Branch:     main (auto-deploy bei Push)
```

## 0.2 — Railway: Nicht verwenden, aus Projekt entfernen

```
RAILWAY WIRD NICHT GENUTZT. Das Projekt läuft nicht über Railway.

Zu entfernen (Branch: chore/remove-railway):
[ ] railway.json (falls vorhanden) löschen
[ ] .github/workflows/*.yml auf Railway-Deploy-Steps prüfen und entfernen
[ ] Alle Kommentare/Docs die Railway erwähnen → durch Render ersetzen
[ ] README.md Deploy-Sektion auf pplx.app + Render aktualisieren

Prüfen:
  find . -name 'railway*' -o -name '*.railway*'
  grep -r 'railway' . --include='*.json' --include='*.yml' --include='*.md'
```

## 0.3 — Render: Environment Variables (P0)

```
Render Dashboard → dein Service → Environment → Add Environment Variable:

  FMP_API_KEY         = <dein FMP Key>          (Financial Modeling Prep)
  OPENROUTER_API_KEY  = sk-or-v1-...            (LLM-Calls via OpenRouter)
  PERPLEXITY_API_KEY  = pplx-...                (Sonar-Pro, optional aber empfohlen)
  NODE_ENV            = production
  PORT                = 5000
  PLAYWRIGHT_BROWSERS_PATH = /root/.cache/ms-playwright

Nach dem Setzen: Manual Deploy triggern.
Diagnose danach:
  curl https://aktienanalyst.onrender.com/api/health
  → Erwartung: { status: "ok", uptime: N }
  curl https://aktienanalyst.onrender.com/api/fmp-budget
  → Erwartung: { fmp: { calls: 0, budget: 750 }, fmpAvailable: true }
```

## 0.4 — Legacy Quota Guard: Deaktivieren (P0)

```
Datei: server/analyze-helpers.ts
Problem: DAILY_FINANCE_LIMIT = 18 ist ein Überbleibsel vom alten
  Perplexity Finance External Tool (das hatte 18 Analysen/Tag Limit).
  Auf Render/pplx.app mit FMP gibt es dieses Limit nicht mehr.
  isQuotaExceeded() kann Analysen still blockieren wenn _quotaCount >= 18.

Fix (Branch: fix/remove-legacy-quota-guard):

export function isQuotaExceeded(): boolean {
  // Legacy Perplexity Finance quota guard — deaktiviert.
  // FMP hat eigenes 750 Calls/Tag Limit (trackFmpCall / getFmpBudgetStatus).
  return false;
}

export function incrementQuota() {
  // Legacy stub — kein Tracking mehr nötig.
}
```

## 0.5 — Render Health-Check konfigurieren

```
Render Dashboard → dein Service → Settings → Health & Alerts:
  Health Check Path: /api/health
  Health Check Timeout: 30s
```

## 0.6 — Mega-Files: Anti-Truncation Split-Plan

```
Problem: GitHub API trunciert Dateien > ~100 KB Base64 still.
REGEL: Jede Datei < 80 KB. Prüfen: wc -c <datei>

Split-Strategie: Barrel-Pattern (Shell bleibt am alten Pfad)
  server/researcher.ts → server/researcher/
  server/llm-openrouter.ts → server/llm/
  client/src/pages/Researcher.tsx → pages/researcher/
```

## 0.7 — Checkliste: Render läuft wieder

```
[ ] 0.3 — Render Env Vars gesetzt (FMP_API_KEY, OPENROUTER_API_KEY)
[ ] 0.4 — Legacy Quota Guard deaktiviert
[ ] 0.5 — Health-Check-Pfad in Render konfiguriert (/api/health)
[ ] Test: curl https://aktienanalyst.onrender.com/api/health → { status: ok }
```

---

# TEIL 1 — BTC DASHBOARD RESTORE

GitHub API trunciert `BTCDashboard.tsx` bei ~100 KB. Sections 3–12 fehlen in main.
Lösung: Modular aufsplitten (BTCDashboard.tsx Shell + btc/Sections1to6, 7to12, Section13Miner).

Bekannte gute Commits: 33c8e77, 5bf8a2d, bafff3c

---

# TEIL 2 — AKTIENANALYSE: BEKANNTE BUGS

## BUG A — FMP-Laufstatus
GET /api/fmp-budget → fmpAvailable: true prüfen. Key in credentials setzen.

## BUG B — Peer-Vergleich: ROIC 3J + ROE fehlen
Branch: fix/peer-comparison-section7
ROIC = NOPAT / Invested Capital; FMP /key-metrics?limit=3

## BUG C — Revenue-Segmente (Produkt + Region)
Branch: fix/revenue-segments-product-geo
FMP: /revenue-product-segmentation + /revenue-geographic-segmentation

## BUG D — DCF/CRV bei Nicht-USD (NVO, ASML, SAP)
Alle Betrags-Felder mit fxRate multiplizieren (toUSD).

---

# TEIL 3 — KATALYSATOREN-SEKTION 15: FORMELN

```
Netto-Upside = Brutto-Upside × (1 - Einpreisungsgrad/100)
GB % = PoS/100 × Netto-Upside
catalystTarget = dcfFairValue × (1 + sumGB/100)
```

Reverse DCF: Binary Search g* (N=5J), siehe calcImpliedGStarExact.

---

# TEIL 4 — RESEARCHER: OPENROUTER 402 / FALLBACK

Root-Cause: callLLMJson gibt bei 402 null → Fallback-Text im UI.
Fix: 3-Modell-Kette Haiku → Llama-3.1-8B-Free → Gemini-Flash-Free.
Plus callPerplexitySonar() für Live-Daten (Macro/Capex/Briefing).

---

# TEIL 5 — FMP-MIGRATION (P0)

1. /api/fmp-budget Frontend  2. Non-USD DCF  3. Peer+ROIC  4. Segments
5. Reverse DCF exact  6. Catalyst Math Rules  7. OpenRouter Fallback  8. Integration-Test

---

# TEIL 6 — FEATURE-ROADMAP

- Section 8 WACC/TV individuell
- Section 14 PESTEL
- Section 15 Reverse DCF
- Section 17 Zusammenfassungstabelle
- Thesis Score, Kelly Portfolio
- Rezessionsboard, BTC Section 13 Miner

---

# TEIL 7 — TREND-GATES, PRICING POWER & BIG-PICTURE-SCORING + GOLD vs REAL YIELDS

Ziel: Nike-2023-Fehlinvestments strukturell verhindern — relativ, selbstkalibrierend, ohne Hardcoding.

## 7.1 Problem: Level statt Delta
17 Sektionen sind level-basiert. Nike Q3 2023: Fundamental/ROIC/Marke grün, DCF grün, Technik rot als "Chance". Pricing Power fehlt.

## 7.2 Designprinzipien
1. Keine absoluten Schwellen (Perzentile/Peers)
2. Delta vor Level (z-standardisiert 8Q)
3. Gates deckeln multiplikativ
4. LLM extrahiert, urteilt nicht
5. Konflikte sichtbar machen

## 7.3 Module (Dokumentation)

### pricingPower.ts
marginVsCostDivergence, aspTrend, volumeTrend, discountPressure, relativeMarginTrend → score 0–100 + flags

### relativeMomentum.ts
growthGap, negativeQuarters, inventoryStress → SHARE_LOSS / INVENTORY_BUILD

### gates.ts
PRICING_POWER cap 55, RELATIVE_GROWTH cap 60, DCF_REALITY_CHECK cap 65, INVENTORY cap 70
applyGates: min(quality×trendMult, activeCaps)

### trendMultiplier
0.5–1.15, asymmetrisch (Verschlechterung härter)

## 7.4 Katalysatoren quantifiziert
Catalyst{probability, epsImpact, eventDate} → catalystExpectedValue mit Decay

## 7.5 Porter dynamisch
porterDelta(t0, t1) — nur Delta fließt in Score; 6. Kraft disruption

## 7.6 LLM: ExtractedFact
field, value, quote, source, confidence — kein Urteil

## 7.7 Verdict: Konfliktmatrix
buildVerdict → score, conflicts, cappedBy, testQuestion (kein blindes Rating)

## 7.8 Gold vs Real Yields
Real Yield = DFII10 oder Nominal − Breakeven
goldRealYieldInverseScore (Pearson, window 60)
Chart dual-axis; Gate GOLD_REAL_YIELD_REGIME bei Decoupling

## 7.9 Nächste Schritte
- [ ] pricingPower + relativeMomentum als Lib
- [ ] Gates in Verdict-Pipeline
- [ ] Gold/RealYield Chart im Researcher
- [ ] LLM ASP/Volume/Discount aus Calls

---

# TEIL 8 — REGULATORY EXPOSURE, GEO, ZÖLLE & PESTEL

> Vollständige Detail-Spezifikation (Interfaces, Prompts, FRED, 8.12) in **WORK2.md**
> https://github.com/1719842374/Aktienanalyst/blob/main/WORK2.md

Kurz:
- RegulatoryExposureRaw + TariffExposure + GeoSegment
- FMP Geographic Segmentation + normalizeGeoName
- LLM-Prompt Regulatory + Zölle (Sonar → OpenRouter Fallback)
- calcRegulatoryEpsImpact, Confidence-Filter, Test-Matrix
- REGULATORY_EXPOSURE-Gate (cap 55/65)
- PESTEL Political/Legal aus enrichedGeo
- 8.12: FRED MacroSnapshot (DGS10, DFII10, CPI, UNRATE, USEPUINDXD…), CompanyTech (R&D/Capex), buildPestelEconomic / Technological

**Regel:** Alles Design-Dokumentation. Implementierung lokal → PR → Review.
