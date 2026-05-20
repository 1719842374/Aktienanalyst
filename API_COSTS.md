# API Kosten & Konfiguration — Aktienanalyst Pro

Stand: 2026-05-20 | Letzte Aktualisierung: Philip Diaz

---

## Übersicht

| Service | Wozu | Kosten | Key-Speicherort |
|---|---|---|---|
| Perplexity Finance Connector | Kurse, Financials, News | Perplexity Credits (intern) | Automatisch (Browser-Auth) |
| OpenRouter | LLM-Katalysatoren, Risk Deep-Dive, Researcher | ~$0.004 / Analyse | `.env` → `OPENROUTER_API_KEY` |
| FMP (Financial Modeling Prep) | Fallback wenn Finance-Connector RATE_LIMITED | $0 (750 Calls/Tag Free Tier) | `.env` → `FMP_API_KEY` |

---

## 1. Perplexity Finance Connector

**Wozu:** Primäre Datenquelle für alle Aktienanalysen.

| Datenpunkt | Tool | Limit |
|---|---|---|
| Aktueller Kurs, Volumen, 52W High/Low | `finance_quotes` | ~20 Analysen/Tag |
| Unternehmensprofil, Beschreibung, Sektor | `finance_company_profile` | s.o. |
| Financials (Revenue, EBITDA, FCF, Bilanz) | `finance_financials` | s.o. |
| Analyst Price Targets, Buy/Hold/Sell | `finance_analyst_research` | s.o. |
| Earnings Estimates | `finance_estimates` | s.o. |
| OHLCV History (6M, für RSL + Chart) | `finance_ohlcv_histories` | s.o. |
| Revenue-Segmente | `finance_segments` | s.o. |
| Aktuelle News (Google RSS) | `finance_massive` | s.o. |
| Peer-Vergleich | `finance_company_peers` | s.o. |

**Key:** Kein manueller Key — läuft über Perplexity-internen Token.  
Token refresht sich **nur wenn die App im Browser geöffnet wird.**  
Läuft als `external-tool` Binary in der pplx.app Sandbox.

**Tageslimit:** Ca. 20 neue Analysen/Tag (8 Calls pro Analyse).  
**Optimierung aktiv:**
- Calls laufen parallel in 2 Batches (statt sequentiell) → doppelte Geschwindigkeit
- Quote-only Refresh: wenn Cache < 48h alt → nur 1 Call statt 8
- FMP übernimmt automatisch bei RATE_LIMITED

---

## 2. OpenRouter (LLM)

**Account:** Stock_Analyst  
**Key:** in `.env` → `OPENROUTER_API_KEY`  
**Guthaben Stand 2026-05-20:** $0.113 (11 Cent)

### Modell-Konfiguration

| Priorität | Modell | Input $/M Token | Output $/M Token | Kontext | Wofür |
|---|---|---|---|---|---|
| **Primary** | `anthropic/claude-3.5-haiku` | $0.80 | $4.00 | 200K | Katalysatoren, Risiken, DeepDive |
| Fallback 1 | `anthropic/claude-3-haiku` | $0.25 | $1.25 | 200K | Bei Haiku 3.5 Rate-Limit |
| Fallback 2 | `x-ai/grok-4.3` | $1.25 | $2.50 | 1000K | Letzter Fallback |

### Wofür wird LLM genutzt (nur bei KI-Button aktiv)

| Feature | Calls | Tokens ca. | Kosten ca. |
|---|---|---|---|
| Firmenspezifische Katalysatoren (Sek. 15) | 1 | 1000 in / 700 out | **$0.0036** |
| Risk Deep-Dive Texte (Sek. 8, KI-Button) | 1 | 800 in / 650 out | **$0.0030** |
| Catalyst Deep-Dive Panel (Sek. 15, extra) | 1 | 700 in / 600 out | **$0.0027** |
| Researcher Macro (1 Region) | 2 | 400 in / 700 out | **$0.0031** |
| Researcher Sectors | 2 | 600 in / 750 out | **$0.0038** |
| Researcher Screener | 1 | 500 in / 600 out | **$0.0027** |
| Researcher Capex | 1 | 400 in / 600 out | **$0.0025** |
| Researcher Daily Briefing | 1 | 400 in / 600 out | **$0.0025** |

**Vollständige Aktienanalyse mit KI (useLLM=true):**
= Katalysatoren + Risk Deep-Dive + Catalyst DeepDive
= ~$0.0036 + $0.0030 + $0.0027 = **~$0.009 pro Analyse** (~1 Cent)

**Monatliche Kosten bei täglicher Nutzung:**
- 1 Analyse/Tag mit KI: ~$0.27/Monat
- 5 Analysen/Tag mit KI: ~$1.35/Monat
- Mit $0.113 Guthaben: ca. **12-13 vollständige KI-Analysen** verfügbar

### Benachrichtigung bei leerem Guthaben

Aktuell kein automatischer Alert. Bei leerem Guthaben:
- LLM fällt auf Free-Modelle zurück (DeepSeek/Llama) → generische Katalysatoren
- Sichtbar in Section 15: gelbes Banner "Generische Katalysatoren erkannt"

**TODO:** OpenRouter-Guthaben überwachen → Notification wenn < $0.05

---

## 3. FMP (Financial Modeling Prep)

**Account:** Free Tier  
**Key:** in `.env` → `FMP_API_KEY`  
**Kosten:** $0 (Free Tier: 750 Requests/Tag)

### Wofür wird FMP genutzt

FMP ist der **Fallback** wenn der Perplexity Finance Connector RATE_LIMITED zurückgibt.

| Datenpunkt | FMP Endpoint |
|---|---|
| Aktueller Kurs | `/stable/quote` |
| Unternehmensprofil | `/stable/profile` |
| Income Statement | `/stable/income-statement` |
| Cash Flow | `/stable/cash-flow-statement` |
| Balance Sheet | `/stable/balance-sheet-statement` |
| Analyst Price Targets | `/stable/price-target-consensus` |
| Historical Prices | `/stable/historical-price-eod/full` |
| Revenue Segmente | `/stable/revenue-product-segmentation` |
| Peer-Liste | `/stable/stock-peers` |
| Analyst Ratings | `/stable/grades` |

**Fallback-Kette bei RATE_LIMITED:**
```
1. Perplexity Finance Connector (Primary)
   ↓ RATE_LIMITED?
2. FMP Free Tier (Fallback, 750 Calls/Tag)
   ↓ FMP auch fail?
3. SQLite Disk Cache (letzte bekannte Daten, bis 7 Tage alt)
   ↓ Cache auch leer?
4. HTTP 429 an Frontend
```

---

## 4. Konfiguration (.env Datei)

Die `.env` Datei liegt im Projektroot und wird **nicht ins Git-Repo committed** (steht in `.gitignore`).

```env
# OpenRouter LLM (Claude 3.5 Haiku primary)
OPENROUTER_API_KEY=sk-or-v1-...

# FMP Financial Modeling Prep (Free Tier Fallback)
FMP_API_KEY=...
```

**Für neue Deployments:** Die `.env` Datei muss manuell in die neue Sandbox kopiert werden, da sie nicht im Repo ist.

---

## 5. Monitoring Crons (täglich Mo-Fr)

| Uhrzeit (CEST) | Was wird geprüft | Notification bei |
|---|---|---|
| 06:45 | Researcher Macro Refresh (US/EU/ASIA) | Fehler oder leere Daten |
| 07:00 | Finance-Quota + FMP Schema-Check | RATE_LIMITED schon um 07:00 |
| 07:30 | Timeout-Regression (7 Endpoints) | Endpoint > Zielzeit oder HTTP Error |
| 07:45 | 503 + Token-Failure Monitor | RATE_LIMITED oder Server down |
| 07:55 | LLM Specificity Test (MSFT + IFX.DE) | Generische Katalysatoren nach Commit |
| 08:00 | Health-Check + GitHub Commit Correlation | Server down oder RATE_LIMITED |

---

## 6. Kosten-Gesamtübersicht (Monat)

| Posten | Kosten/Monat | Anmerkung |
|---|---|---|
| Perplexity Finance Connector | in Perplexity Abo enthalten | ~20 neue Analysen/Tag |
| OpenRouter (1 Analyse/Tag mit KI) | ~$0.27 | Bei aktuell $0.11 Guthaben: ~12 Analysen |
| FMP Free Tier | $0.00 | 750 Calls/Tag, reicht für Fallback |
| GitHub (privates Repo) | $0.00 | kostenloser Plan |
| **Gesamt** | **~$0.27/Monat** | bei täglicher Nutzung mit KI |

---

## 7. Wo Keys gesetzt werden

```
Lokal (Entwicklung):   /home/user/workspace/aktienanalyst/.env
Deployed (pplx.app):   .env wird bei jedem Deploy mitgegeben
                        (muss bei neuem Deploy manuell vorhanden sein)
```

**Wichtig für pplx.app Deployments:** Die `.env` Datei muss im `dist/public` Ordner NICHT vorhanden sein — sie wird vom Backend Server aus dem Projektroot gelesen. Das Backend Bundle (`dist/index.cjs`) liest `process.env` zur Laufzeit.
