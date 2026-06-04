# Stock Analyst Pro — Deployment

## Aktuelle Deployment-Plattform: Perplexity Computer (pplx.app)

Die App läuft unter **https://aktienanalyst-pro.pplx.app**

### Deploy-Prozess
```bash
# 1. Code ändern
# 2. Build
npm run build

# 3. Deploy über Perplexity Computer (publish_website Tool)
# Keys werden als credentials= übergeben — nie im Code hardcoden
```

### Environment Variables (auf pplx.app)
Werden beim `publish_website`-Aufruf als `credentials=` injiziert:
- `FMP_API_KEY` — Financial Modeling Prep (FMP Free Tier, 750 Calls/Tag)
- `OPENROUTER_API_KEY` — OpenRouter für KI-Analysen (Claude 3.5 Haiku)

### Wichtig: Finance API
Die Perplexity Finance API (`external-tool` CLI) funktioniert **nur in der Perplexity Sandbox**.
Auf pplx.app ist sie verfügbar. Extern (Docker, Railway etc.) nicht.

---

## Lokale Entwicklung

```bash
# 1. .env erstellen
cp .env.example .env
# FMP_API_KEY und OPENROUTER_API_KEY eintragen

# 2. Dependencies installieren
npm install

# 3. Dev-Server starten (Port 5000)
npm run dev
```

---

## Docker (lokales Testing)

```bash
docker build -t stock-analyst-pro .
docker run -p 5000:5000 \
  -e FMP_API_KEY=your_key \
  -e OPENROUTER_API_KEY=your_key \
  stock-analyst-pro
```

**Hinweis:** Ohne Perplexity Finance API sind nur FMP-Fallback-Daten verfügbar.

---

## Tech Stack

| Schicht | Technologie |
|---|---|
| Frontend | React 18, Recharts, Tailwind CSS, shadcn/ui, wouter |
| Backend | Express, TypeScript (esbuild), Zod |
| Daten | FMP API, SEC EDGAR, Blockchain.info, mempool.space |
| KI | OpenRouter → Claude 3.5 Haiku (Katalysatoren, Risiko, Thesis) |
| Hosting | pplx.app (Perplexity Computer) |
| Cache | SQLite (data.db) — 7 Tage Analyse-Cache |
