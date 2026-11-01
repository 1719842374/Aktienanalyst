# WORK – Learnings from Simply Wall St for KI-Chat

**Stand:** 26.10.2026  
**Ziel:** Was man von Simply Wall St (Charlie AI + Narratives) für den eigenen KI-Chat übernehmen kann. Markdown-Sterne im Interface entfernen.

---

## 1. Analyse Simply Wall St

### Charlie AI
- Kontextueller Chat direkt im Dashboard.
- Quick-Start-Prompts.
- AI Terms of Use Badge.
- Beantwortet Fragen zu Kennzahlen, Margen, Portfolio.

### Narratives
- Nutzer schreiben eigene Thesen zu Aktien.
- Struktur: Catalysts / Assumptions / Risks.
- Fair-Value-History-Chart.
- Updates über die Zeit.
- Community kann Narrative lesen und kommentieren.

### Snowflake
- Visueller 5-Achsen-Score (Valuation, Growth, Past Performance, Financial Health, Dividends).
- Schneller Überblick.

---

## 2. Vergleich zu deinem KI-Chat

| Feature | Simply Wall St | Dein KI-Chat (aktuell) | Empfehlung |
|---------|----------------|------------------------|------------|
| Kontext | Portfolio + Company | Asset-Analyse | Beibehalten |
| Quick Prompts | Ja | Ja (Scoring-Gates etc.) | Beibehalten |
| Markdown-Sterne | Sauber gerendert | **Sterne sichtbar** | **Fixen** |
| Narrative-Struktur | Catalysts / Assumptions / Risks | Scoring-Gates | Optional übernehmen |
| Community | Ja | Nein | Später |
| Snowflake | Ja | Ampel + Score | Optional als Visual |

---

## 3. Was übernehmen

### Sofort
1. **Markdown-Sterne entfernen**  
   Grok gibt `**INVENTORY**` aus. Im Frontend als Bold rendern oder Sterne strippen.
2. **AI Terms of Use Badge**  
   Klarer Hinweis: „KI-generiert, keine Anlageberatung“.

### Mittelfristig
3. **Narrative-Struktur im Chat**  
   Bei Asset-Fragen automatisch Catalysts / Assumptions / Risks ausgeben.
4. **Quick-Start-Prompts erweitern**  
   „Fasse die Analyse in 5 Punkten zusammen“, „Welche Gates sind aktiv?“, „Was passiert bei -5% Wachstum?“.

### Später
5. **Community Narratives**  
   Nutzer können eigene Thesen speichern und teilen.
6. **Visueller Score**  
   Snowflake-ähnliche Ampel für die 20 Sektionen.

---

## 4. Markdown-Sterne Fix

**Problem:**  
Grok gibt Markdown (`**Gate**`) aus. Im Interface werden die Sterne angezeigt.

**Lösung:**
- Frontend: Markdown-Renderer (z. B. `react-markdown`) verwenden.
- Oder Backend: Sterne strippen und nur Bold-Tags senden.
- Empfehlung: Frontend rendert Markdown korrekt.

**Aufwand:** 2–4 h.

---

## 5. Aufwand

| Schritt | Aufwand |
|---------|---------|
| Markdown-Sterne fixen | 2–4 h |
| AI Terms Badge | 1–2 h |
| Narrative-Struktur im Prompt | 4–6 h |
| **Gesamt (sofort + mittelfristig)** | **~7–12 h** |

---

**Kurz:**  
Von Simply Wall St lohnt sich vor allem die saubere Markdown-Darstellung und die Narrative-Struktur (Catalysts / Assumptions / Risks). Die Sterne im Interface müssen weg.

---

## 6. Chat History & Interface

**Problem:** Chat History fehlt. Simply Wall St hat sie (New Chat, History).

**Lösung:**
- Chat-History im Backend speichern (pro User / pro Asset).
- Sidebar oder Dropdown mit bisherigen Chats.
- „New Chat“-Button.

**Aufwand:** 6–8 h.

---

## 7. Podcast-Transkript – Economist-Niveau

**Ziel:** Transkript so hochwertig wie beim Economist (Fließtext, Drop-Cap, saubere Typografie).

**UI-Elemente:**
- Drop-Cap am Anfang.
- Serifen-Schrift für Fließtext.
- Klare Absätze.
- AI NARRATED Badge.
- Player oben.

**Aufwand:** 4–6 h (CSS + Komponenten).

---

## 8. MCP-Anbindung

**Ja, möglich.**

- FMP hat einen MCP-Server.
- OpenRouter unterstützt Tool-Calls.
- Eigener MCP-Server für den Podcast-Generator (Analyse-Daten + News als Tools).

**Aufwand:** 8–12 h (MCP-Server + Tool-Definitionen).

**Empfehlung:** Zuerst Chat History und Podcast-Styling, MCP später.
