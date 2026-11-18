# WORK_HYPECYCLE_EMAIL_SUPABASE.md

**Stand:** 2026-10-31  
**Status:** Offen / Implementierungsvorschlag  
**Themen:**  
1. Proxy-Gartner-Hype-Cycle für die Wertschöpfungskette (13 Industrien)  
2. Automatische E-Mails bei ATTRAKTIV-Status + Admin-Zugang ohne Login (Supabase)

---

## Wichtige Links

- **Supabase Dashboard (Storage / Files):**  
  https://supabase.com/dashboard/project/xtfkebsshlrzdqsrrejs/storage/files  
  (Relevant für Podcast-Work.mds und Datei-Ablage)

- **Cursor Voice Agent Dashboard:**  
  https://cursor.com/dashboard/voice?from=2026-09-01&to=2026-10-31  
  Pricing (Stand Okt 2026): Plus $8/mo (Grok only), Premium $30/mo, Super $100/mo, Ultra $200/mo. Voice-Nutzung zieht aus dem wöchentlichen Usage-Pool. Exakte Kosten pro Minute nicht öffentlich – hängt vom Plan und der Nutzung ab.

---

## 1. Proxy-Hype-Cycle für Wertschöpfungskette

### Hintergrund
Gartner positioniert Technologien **qualitativ** (Analysten-Konsens, Markt-Signale, Umfragen). Eine 1:1-Replikation ist nicht möglich. Ein **Proxy** ist aber sinnvoll und adaptiv umsetzbar.

### Adaptive Inputs (nicht hardcodiert)

| Signal | Quelle | Gewicht (Vorschlag) | Kommentar |
|--------|--------|---------------------|-----------|
| News-/Suchvolumen | Google Trends / FMP News | 0.25 | Hype-Intensität |
| CAPEX-/Investitions-Erwähnungen | Earnings Calls / FMP | 0.20 | Materialisierung |
| Relative Bewertung vs. 5J-Median | FMP Key Metrics | 0.20 | Erwartungs-Level |
| Analysten-Revisionen (EPS) | FMP Analyst Estimates | 0.15 | Erwartungs-Anpassung |
| Forward Guidance Stärke | FMP / LLM-Extraktion | 0.10 | Narrative-Stärke |
| LLM-Narrative-Score | Optional OpenRouter | 0.10 | Qualitativer Check |

### Phasen-Mapping (Proxy)

| Phase | Proxy-Bedingung (Beispiel) | Typische Dauer |
|-------|----------------------------|----------------|
| Innovation Trigger | Trends steigen, Bewertung noch niedrig | 6–18 Monate |
| Peak of Inflated Expectations | Trends + Bewertung > 1.5σ | 6–12 Monate |
| Trough of Disillusionment | Trends fallen, Revisionen negativ | 12–24 Monate |
| Slope of Enlightenment | CAPEX steigt, Revisionen stabilisieren | 12–36 Monate |
| Plateau of Productivity | Bewertung ~ Median, CAPEX stabil | – |

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| Datenaggregation pro Industrie | 8–12 h |
| Proxy-Score + Phasen-Logik | 6–8 h |
| Visualisierung im Value-Chain-Dashboard | 6–8 h |
| **Gesamt** | **~20–28 h** |

---

## 2. Automatische E-Mails bei ATTRAKTIV (analog GuruFocus)

### Datenmodell (Supabase)

```sql
-- Watchlist / Subscriptions
CREATE TABLE user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  email text NOT NULL,
  ticker text NOT NULL,
  notify_on text[] DEFAULT ARRAY['ATTRAKTIV'], -- oder Schwellenwert
  created_at timestamptz DEFAULT now()
);

-- Scoring-Status (wird vom Backend geschrieben)
CREATE TABLE stock_scores (
  ticker text PRIMARY KEY,
  status text, -- ATTRAKTIV / NEUTRAL / UNATTRAKTIV
  score numeric,
  updated_at timestamptz DEFAULT now()
);
```

### Trigger-Logik

1. Scoring-Pipeline schreibt neuen Status in `stock_scores`.
2. Database Webhook (Supabase) feuert bei UPDATE, wenn `status = 'ATTRAKTIV'`.
3. Edge Function oder externer Dienst (Resend / SendGrid) verschickt Mail.
4. Inhalt: Ticker, Ampel, kurze Begründung (DCF-Upside, RSL, Golden Cross), Link zum Dashboard.

### Admin-Zugang ohne Login

| Methode | Beschreibung |
|---------|--------------|
| Service-Role-Key | Backend-Routen mit Service-Role (nur serverseitig) |
| Admin-Code | Environment-Variable / Secret, der Auth umgeht |
| Google OAuth | Optional für User; Session bleibt „remembered“ via Refresh Token |
| Supabase Dashboard | Voller DB-Zugriff für dich als Owner |

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| Tabellen + RLS | 3–4 h |
| Webhook + Edge Function | 4–6 h |
| E-Mail-Template + Versand | 3–4 h |
| Admin-Bypass | 2–3 h |
| **Gesamt** | **~12–17 h** |

---

## 3. Gesamtübersicht

| Thema | Aufwand | Priorität |
|-------|---------|-----------|
| Proxy-Hype-Cycle | 20–28 h | Mittel |
| ATTRAKTIV-E-Mails + Admin | 12–17 h | Hoch |
| **Gesamt** | **~32–45 h** | – |

---

**Quellen:** Gartner Hype Cycle Methodology, Supabase Database Webhooks, bestehende Scoring-Logik im Aktienanalyst-Dashboard, GuruFocus-Screenshot als Referenz, Cursor Pricing (Okt 2026).
