# WORK – Chat History, Economist-Transkript & MCP-Anbindung

**Stand:** 26.10.2026  
**Ziel:** Detaillierte Dokumentation der drei Punkte mit Zahlen, Daten und Fakten.

---

## 1. Chat History

**Problem:**  
Der KI-Chat hat keine History. Simply Wall St hat sie (New Chat, bisherige Konversationen).

**Lösung:**

| Komponente | Beschreibung |
|------------|--------------|
| **Speicher** | Backend speichert Chats pro User und optional pro Asset (JSON oder DB). |
| **UI** | Sidebar oder Dropdown mit Liste der bisherigen Chats. |
| **Funktionen** | „New Chat“, Chat auswählen, Chat löschen. |
| **Kontext** | Beim Öffnen eines alten Chats wird der Verlauf geladen und dem LLM mitgegeben. |

**Ablauf:**
1. User stellt Frage.
2. Antwort wird generiert.
3. Frage + Antwort werden gespeichert.
4. Beim nächsten Öffnen sieht der User die History.

**Aufwand:** 6–8 h.

---

## 2. Podcast-Transkript – Economist-Niveau

**Ziel:**  
Das Transkript soll so hochwertig aussehen wie beim Economist (Fließtext, Drop-Cap, saubere Typografie).

**UI-Elemente:**

| Element | Umsetzung |
|---------|-----------|
| **Drop-Cap** | Erster Buchstabe groß und dekorativ. |
| **Schrift** | Serifen-Schrift für den Fließtext (z. B. Georgia oder Source Serif). |
| **Absätze** | Klare, luftige Absätze. |
| **AI NARRATED Badge** | Gelbes Badge wie beim Economist. |
| **Player** | Oben, mit Fortschrittsbalken und Geschwindigkeit. |
| **Zeitstempel** | Optional: Klick auf Absatz springt im Audio. |

**Beispiel-Struktur:**
```
[Player]
[AI NARRATED Badge]
[Drop-Cap] LL POPULISTS promise much...
[Weiterer Fließtext in Serifen-Schrift]
```

**Aufwand:** 4–6 h (CSS + Komponenten).

---

## 3. MCP-Anbindung mit FMP Server

**Was ist MCP?**  
Model Context Protocol. Das LLM kann externe Tools (z. B. FMP) direkt aufrufen.

**FMP MCP-Server:**
```
https://financialmodelingprep.com/mcp?apikey=YOUR_FMP_API_KEY
```

**Verfügbare Tools (Auswahl):**

| Tool | Funktion |
|------|----------|
| `profile` | Unternehmensprofil |
| `income-statement` | Gewinn- und Verlustrechnung |
| `balance-sheet` | Bilanz |
| `cash-flow` | Cashflow |
| `ratios` / `key-metrics` | Kennzahlen |
| `stock-news` | Aktien-News |
| `press-releases` | Pressemitteilungen |
| `analyst-estimates` | Analystenschätzungen |

**Ablauf für den Podcast:**
1. Podcast-Generator bekommt Symbol (z. B. NVO).
2. MCP-Client ruft intern `profile`, `income-statement`, `stock-news` auf.
3. Ergebnisse werden in den Prompt gepackt.
4. Skript wird generiert.

**Vorteil:**  
Keine hardcodierten Endpoints mehr. Das LLM oder der Agent holt die Daten selbst.

**Aufwand:** 8–12 h.

---

## Priorisierung

| Priorität | Punkt | Aufwand | Warum |
|-----------|-------|---------|-------|
| **1** | Chat History | 6–8 h | Sofort spürbar für den User |
| **2** | Economist-Transkript | 4–6 h | Hochwertiger Look |
| **3** | MCP-Anbindung | 8–12 h | Technische Verbesserung, später |

**Gesamt:** ~18–26 h für alle drei.
