# Kostenübersicht – Abos, Tools & Fixkosten

**Stand:** 31.10.2026  
**Repo:** Aktienanalyst (1719842374/Aktienanalyst)  
**Zweck:** Übersicht aller aktuell genutzten Dienste, monatlichen Fixkosten und Schätzung bei Skalierung zum Produktiv-Dashboard.

---

## 1) Daten & Infrastruktur

| Posten | Aktuell (ca.) | Bei Skalierung / Produktiv-Dashboard | Anmerkung |
|--------|---------------|---------------------------------------|-----------|
| **FMP API** | **~$60/Monat** | $49–69/Monat (Premium) oder $99/Monat (Ultimate, annual) | Du nennst ~60 $. Offiziell: Premium ~$49 annual / $69 monthly, Ultimate ~$99 annual / $139 monthly. |
| **Supabase** | Free (oder sehr niedrig) | **Pro $25/Monat** + Compute | Pro = $25 + $10 Compute-Credit (deckt 1× Micro). Zusätzliche Projekte ~$10+. |
| **Render** | Free / Hobby (schläft nach 15 min) | **$7–25/Monat** pro Service oder Pro-Workspace **$25/Monat** + Compute | Free reicht nicht für Always-On. |
| **Domain** | Noch nicht (nur Render-URL) | **~$10–11/Jahr** (.com bei Cloudflare) | Einmalig niedrig, danach jährlich. Cloudflare ~$10.46/Jahr. |
| **E-Mail-Versand** (Resend/SendGrid) | – | ~$0–20/Monat | Erst bei vielen Mails relevant. |

**Daten/Infra aktuell:** ~$60  
**Daten/Infra skaliert (kleines Produktiv-Dashboard):** ~$90–130/Monat

---

## 2) R&D / Tools

| Posten | Aktuell | Bei stärkerer Nutzung | Anmerkung |
|--------|---------|-----------------------|-----------|
| **SuperGrok / X Premium** | **$30/Monat** | $30 (Premium) oder $100 (Super) | Voice + Grok sind im Pool enthalten. |
| **Cursor** | **$60/Monat** | $30 (Premium) – $100 (Super) | Aktuell ~60 $. Neue Pläne: Plus $8, Premium $30, Super $100. Voice zieht aus dem gleichen wöchentlichen Pool. |
| **Wispr Flow** | Optional | **$12/Monat** (jährlich) oder $15/Monat | Unlimited Diktat. Nur sinnvoll, wenn Cursor-Voice nicht reicht. |
| **Voice Agent** | Im Cursor-Abo enthalten | Im Cursor-Abo | Kein Extra-Preis, solange der Pool reicht. |

**R&D aktuell:** ~$90/Monat ($30 + $60)  
**R&D mit Wispr Flow:** ~$102–105/Monat

---

## 3) Gesamtübersicht

| Szenario | Monatliche Fixkosten | Was enthalten ist |
|----------|----------------------|-------------------|
| **Jetzt (aktuell)** | **~$150** | FMP ~60 + SuperGrok 30 + Cursor 60. Render Free, Supabase Free, keine eigene Domain. |
| **Kleines skaliertes Dashboard** | **~$180–220** | + Supabase Pro ~25–40, Render Always-On ~7–25, Domain ~1, optional Wispr Flow 12. |
| **Produktiv mit Nutzern + Mails** | **~$220–280+** | + höhere FMP-Limits (Ultimate), mehr Render-Compute, E-Mail-Volumen, Supabase-Overages. |

---

## 4) Kurzfazit

- **Aktuell:** Du liegst bei etwa **150 $/Monat** (FMP + SuperGrok + Cursor).
- **Skalierung zum echten Dashboard:** Realistisch **+30–70 $** für Supabase Pro, Always-On-Hosting und Domain → **~180–220 $/Monat**.
- **Wispr Flow** ist optional. Wenn du mit dem Cursor-Voice-Agent (im bestehenden Abo) auskommst, sparst du die 12–15 $.
- Domain ist der günstigste Posten (~10 $/Jahr bei Cloudflare).

Die größten Sprünge kommen von FMP (Datenqualität) und dem Wechsel von Free- zu Paid-Hosting (Supabase + Render).

---

## 5) Genutzte Tools / Dienste (Stand 31.10.2026)

| Kategorie | Tool / Dienst | Zweck |
|-----------|---------------|-------|
| Daten | Financial Modeling Prep (FMP) | Fundamentals, Preise, News, Ratios, Historicals |
| Daten | Yahoo Finance (Fallback) | Preise, Charts, historische Serien |
| Daten | FRED | Makro-Serien (Buffett, Yield Curve, VIX, etc.) |
| Infra | Render | Hosting (aktuell Free/Hobby) |
| Infra | Supabase | Datenbank / Auth (aktuell Free) |
| Infra | GitHub | Repo, CI, Code |
| R&D | SuperGrok / xAI | LLM, Recherche, Agents |
| R&D | Cursor | Coding, Voice Agent, Cloud Agents |
| R&D | Wispr Flow (optional) | Diktat / Voice |
| Domain | Noch nicht | Nur Render-URL |

---

*Quellen: Offizielle Pricing-Seiten FMP, Supabase, Render, Cursor, xAI, Wispr Flow (Stand Ende Oktober 2026).*
