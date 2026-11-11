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

## Soll-Ist-Teil-Fortschritt 11.11.2026 – #469 @fb5546ea · HEAD main `63a5cbcf`

- Soll §1: Chat-History (New Chat, bisherigen Chat öffnen, Chat löschen, Verlauf beim Öffnen wieder laden).
- Ist @`fb5546ea9768140679e72185ba7ff50860e506de` (#469, https://github.com/1719842374/Aktienanalyst/pull/469, Squash über `727ca998`): `ChatWidget` → `client/src/hooks/useChatHistory.ts` → GET/PUT/DELETE `/api/chat/history` → `server/routes.ts:559` → `server/chat-history-route.ts` → `shared/chat-history.ts`. DELETE löscht den Chat. DC Post-Merge KLAR. Prod-Smoke: P1 Löschen+Reload PASS, P3 Chat PASS, P2 Zwei-Tab FAIL (Tab B zeigt den gelöschten Titel nach Reload wieder, trotz PUT stale-write; Client-Wiederbelebung). Fix-Lane läuft. Ampel 🟡 TEILWEISE, nicht grün.
- §1 bleibt OFFEN. Dateiname `WORK_CHAT_PODCAST_MCP.md` bleibt. Kein Rename. Kein `fertig_`/`Fertig_`. `fertig_`/`Fertig_` nicht zurück auf `Offen_`.

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
