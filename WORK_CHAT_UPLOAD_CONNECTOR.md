# WORK – Chat Uploads & Dashboard als Connector

**Stand:** 26.10.2026  
**Ziel:**  
1. Warum der KI-Chat keine Dokumente/Fotos/Screenshots akzeptiert und wie man das fixt.  
2. Dashboard als Connector für externe Agents (Grok Bot, Claude Code etc.).

---

## 1. Chat Uploads (Dokumente, Fotos, Screenshots)

### Aktueller Stand
Der KI-Chat akzeptiert nur Text. Der User kann keine Dateien, Bilder oder Screenshots einfügen.

### Warum es nicht geht
- Frontend hat keinen File-Upload.
- Backend hat keinen Endpoint für Multimodal-Input.
- LLM-Call (Grok) wird nur mit Text aufgerufen.

### Implementierungsvorschlag

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **Frontend** | Drag & Drop oder Button für Upload (PDF, PNG, JPG). | 4–6 h |
| **Backend** | Endpoint `/chat/upload` speichert Datei und extrahiert Text (PDF) oder sendet Bild an Vision-Modell. | 6–8 h |
| **LLM-Call** | Multimodal: Text + Bild-URL oder extrahierter Text wird dem Prompt mitgegeben. | 2–3 h |
| **Caching** | Uploads werden pro Chat gespeichert. | 2–3 h |
| **Gesamt** | | **~14–20 h** |

**Unterstützte Formate (Vorschlag):**
- PDF (Text-Extraktion)
- PNG / JPG (Vision)
- Optional: Excel / CSV (Tabellen-Extraktion)

---

## 2. Dashboard als Connector (kein Skill)

### Ziel
Externe Agents (Grok Bot, Claude Code, Cursor etc.) können über einen Account die quantitative Scoring-Logik des Dashboards nutzen.

### Unterschied Skill vs. Connector

| | Skill | Connector |
|---|-------|-----------|
| **Wo** | Im Agent-Repo | Externer Service |
| **Auth** | Keine | Account + API-Key |
| **Daten** | Lokal | Live aus dem Dashboard |
| **Beispiel** | Lokales Python-Skript | API-Call an `/scoring/NVO` |

### Architektur

```
Agent (Grok Bot / Claude Code)
    ↓
API-Key (User-Account)
    ↓
Dashboard-Backend (/api/scoring/:symbol)
    ↓
Scoring-Logik + Analyse-Daten
    ↓
JSON-Response an Agent
```

### Endpoints (Vorschlag)

| Endpoint | Funktion |
|----------|----------|
| `GET /api/scoring/:symbol` | Ampel, Gates, Score, Top-Treiber |
| `GET /api/analysis/:symbol` | Vollständige Analyse (DCF, Technical, Moat) |
| `POST /api/podcast/:symbol` | Podcast generieren (optional) |

### Auth
- User erstellt API-Key im Dashboard.
- Agent sendet Key im Header.
- Rate-Limits pro Key.

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| API-Endpoints bauen | 8–10 h |
| Auth + API-Key-System | 6–8 h |
| Dokumentation für Agents | 3–4 h |
| **Gesamt** | **~17–22 h** |

---

## Priorisierung

| Priorität | Feature | Aufwand | Nutzen |
|-----------|---------|---------|--------|
| **1** | Chat Uploads | 14–20 h | User kann Screenshots/PDFs einfügen |
| **2** | Connector | 17–22 h | Agents können Scoring nutzen |

**Gesamt:** ~31–42 h.
