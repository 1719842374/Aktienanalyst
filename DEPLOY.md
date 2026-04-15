# Stock Analyst Pro — Self-Hosted Deployment

## Railway (Empfohlen)

### 1. Repository verbinden
1. Gehe zu [railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub Repo"
3. Wähle `1719842374/Aktienanalyst`
4. Railway erkennt automatisch das `Dockerfile` und `railway.toml`

### 2. Environment Variables setzen
In Railway → Settings → Variables:

```
NODE_ENV=production
PORT=5000
ANTHROPIC_API_KEY=sk-ant-...  (für KI-Katalysatoren, optional)
```

### 3. Domain zuweisen
Railway → Settings → Networking → "Generate Domain"
→ Du bekommst eine URL wie `stock-analyst-pro-production.up.railway.app`

### 4. Fertig
Die App läuft permanent. Kein Token-Ablauf, kein Session-Ende.

---

## Einschränkung: Finance API

Die Aktien-Daten kommen über die **Perplexity Finance API** (`external-tool` CLI).
Diese funktioniert **nur in der Perplexity Computer Sandbox**.

Auf Railway/Self-Hosted gibt es zwei Optionen:

### Option A: FMP API (Financial Modeling Prep)
1. Registriere dich auf [financialmodelingprep.com](https://financialmodelingprep.com)
2. Setze `FMP_API_KEY` in Railway
3. Die `callFinanceTool` Funktion in `server/routes.ts` muss angepasst werden

### Option B: Perplexity API als Proxy
Falls Perplexity in Zukunft eine REST-API für Finance-Daten anbietet,
kann die `callFinanceTool` Funktion auf diese umgestellt werden.

### Option C: Hybrid
- App auf Railway für permanentes Hosting
- Finance-Daten über die gecachten Analysen aus der Sandbox
- Neue Analysen nur wenn die Sandbox aktiv ist

---

## Docker (lokal)

```bash
docker build -t stock-analyst-pro .
docker run -p 5000:5000 -e NODE_ENV=production stock-analyst-pro
```

Öffne `http://localhost:5000`

---

## Architektur

```
client/           → React Frontend (Vite, Tailwind, shadcn/ui)
server/           → Express Backend (TypeScript)
shared/           → Shared Types (Schema)
.cache/           → Server-side Analysis Cache (JSON files)
dist/             → Build Output
  index.cjs       → Server bundle
  public/         → Static frontend assets
```

## Tech Stack
- **Frontend**: React 18, Recharts, Tailwind CSS, shadcn/ui, wouter
- **Backend**: Express, Zod, jsPDF
- **Data**: Perplexity Finance API, SEC EDGAR, Google News RSS
- **AI**: Anthropic Claude (optional, für KI-Katalysatoren)
