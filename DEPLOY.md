# Stock Analyst Pro — Deployment Guide

## Automatisches Deployment (Railway + GitHub Actions)

### Einmalige Einrichtung (10 Minuten)

#### 1. FMP API Key holen (kostenlos)
1. Registriere dich auf [financialmodelingprep.com](https://site.financialmodelingprep.com/developer/docs)
2. Free Tier: 250 API-Calls/Tag (reicht für ~25 Aktienanalysen/Tag)
3. Kopiere deinen API-Key

#### 2. Railway Projekt erstellen
1. Gehe zu [railway.app](https://railway.app) → "New Project"
2. "Deploy from GitHub Repo" → wähle `1719842374/Aktienanalyst`
3. Railway erkennt `Dockerfile` + `railway.toml` automatisch
4. Unter **Variables** setzen:
   ```
   FMP_API_KEY=dein_fmp_key
   ANTHROPIC_API_KEY=sk-ant-...  (optional, nur für KI-Katalysatoren)
   NODE_ENV=production
   PORT=5000
   ```
5. Unter **Settings → Networking**: "Generate Domain"
   → z.B. `stock-analyst-pro.up.railway.app`

#### 3. GitHub Actions einrichten
1. In Railway: **Settings → Tokens → New Project Token** → kopieren
2. In GitHub: **Repo → Settings → Secrets → Actions → New Secret**:
   - Name: `RAILWAY_TOKEN`
   - Value: dein Railway-Token

#### 4. Fertig!
Ab jetzt wird bei **jedem Push auf `main`** automatisch:
- Docker-Image gebaut
- Auf Railway deployed
- Dashboard ist in ~2 Minuten live mit neuester Version

---

## Wie die Daten-Pipeline funktioniert

```
┌──────────────────────────────────────┐
│         Nutzer öffnet Dashboard       │
├──────────────────────────────────────┤
│  Frontend (React)                     │
│  → POST /api/analyze { ticker }       │
├──────────────────────────────────────┤
│  Backend (Express)                    │
│  ┌─ FMP_API_KEY gesetzt?             │
│  │  JA → FMP API (Echte Börsendaten) │
│  │  NEIN → Perplexity Finance API    │
│  │         (nur in Sandbox)           │
│  └─ Ergebnis → .cache/{TICKER}.json  │
├──────────────────────────────────────┤
│  + Google News RSS (immer kostenlos)  │
│  + SEC EDGAR 10-K (immer kostenlos)   │
│  + Anthropic Claude (optional, $)     │
└──────────────────────────────────────┘
```

---

## FMP API Endpoints (was genutzt wird)

| Daten | FMP Endpoint | Free Tier |
|-------|-------------|-----------|
| Kurse | `/v3/quote/{symbol}` | ✅ |
| Profil | `/v3/profile/{symbol}` | ✅ |
| Income Statement | `/v3/income-statement/{symbol}` | ✅ |
| Balance Sheet | `/v3/balance-sheet-statement/{symbol}` | ✅ |
| Cash Flow | `/v3/cash-flow-statement/{symbol}` | ✅ |
| Historische Preise | `/v3/historical-price-full/{symbol}` | ✅ |
| Analyst Estimates | `/v3/analyst-estimates/{symbol}` | ✅ |
| Analyst Grades | `/v3/grade/{symbol}` | ✅ |
| Price Targets | `/v4/price-target-consensus` | ✅ |
| Revenue Segments | `/v4/revenue-product-segmentation` | ✅ |
| Peers | `/v4/stock_peers` | ✅ |
| Ratios | `/v3/ratios/{symbol}` | ✅ |

---

## Lokales Development

```bash
# 1. Klone das Repo
git clone https://github.com/1719842374/Aktienanalyst.git
cd Aktienanalyst

# 2. Dependencies installieren
npm install

# 3. .env erstellen
cp .env.example .env
# FMP_API_KEY und optional ANTHROPIC_API_KEY eintragen

# 4. Dev Server starten
npm run dev
# → http://localhost:5000
```

## Docker (lokal)

```bash
docker build -t stock-analyst-pro .
docker run -p 5000:5000 \
  -e FMP_API_KEY=dein_key \
  -e NODE_ENV=production \
  stock-analyst-pro
```
