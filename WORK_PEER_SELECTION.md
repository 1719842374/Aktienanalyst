# WORK – Peer-Auswahl: Industry-Klassifikation + User-Kontrolle

**Stand:** 18.10.2026  
**Ziel:** Peer-Qualität im Dashboard verbessern, ohne proprietäre Algorithmen zu kopieren. Basis ist eine saubere Industry-Klassifikation (FMP / GICS) plus stabile User-Overrides und Caching.

---

## 1. Wie GuruFocus es macht

| Aspekt | Mechanismus | Quelle |
|--------|-------------|--------|
| Default-Peers | Industry competitors (GICS) | FactSet / GICS |
| Zusätzliche Tabs | Same PE, Same PS, Same Market Cap | Filter auf geladene Liste |
| Manuelle Bearbeitung | Hinzufügen / Entfernen per X | User-Input |
| Caching | Gespeicherte Views („My Views“) | User-Session |

**Fazit:** Kein geheimer Algorithmus. Industry-Peers + User-Filter + manuelle Overrides.

---

## 2. Aktueller Stand im Dashboard

| Punkt | Status | Problem |
|-------|--------|---------|
| Auto-Peers | FMP-Heuristik | Oft unvollständig (z. B. LLY bei NVO fehlt) |
| Manuelle Overrides | Vorhanden (`peerOverrides`) | Nach Reload nicht stabil sichtbar |
| Caching | Unzuverlässig | Hinzugefügte Ticker verschwinden |
| Industry-Filter | Nicht vorhanden | Keine „Same Market Cap“ / „Same PE“ Tabs |

**Beispiel NVO:**  
FMP liefert nicht automatisch LLY. User muss manuell hinzufügen. Nach Reload ist der Peer oft weg.

---

## 3. Empfohlener Mechanismus

### 3.1 Default-Peers
- Primär: FMP `/stable/stock-peers?symbol=NVO` oder GICS-Industry-Peers.
- Fallback: Manuelle Liste pro Sektor (Healthcare → LLY, PFE, AMGN, etc.).

### 3.2 User-Kontrolle
- `peerOverrides` beibehalten (add / remove).
- Gespeicherte Peer-Sets pro Ticker (analog „My Views“).
- Max. 8 Peers gleichzeitig.

### 3.3 Stabile Caching
- Peer-Liste (Auto + Overrides) im Cache mit Ticker als Key.
- TTL: 24 h oder bis manueller Reset.
- Nach Reload: gespeicherte Overrides wieder anzeigen.

### 3.4 Optionale Filter-Tabs
| Tab | Logik | Aufwand |
|-----|-------|---------|
| Same Market Cap | ±50 % Market Cap | Niedrig |
| Same PE | ±30 % Forward PE | Niedrig |
| Same Industry | GICS Sub-Industry | Niedrig |

---

## 4. Datenquellen

| Quelle | Endpoint / Methode | Qualität | Kosten |
|--------|--------------------|----------|--------|
| FMP Stock Peers | `/stable/stock-peers?symbol=` | Mittel | Bestehend |
| FMP Company Profile | Industry / Sector | Gut für Default | Bestehend |
| GICS (über FMP oder extern) | Industry-Klassifikation | Gut | Bestehend / niedrig |
| Manuelle Overrides | User-Input | Hoch (wenn gepflegt) | Keine |

**Beispiel-Peers NVO (Healthcare / Drug Manufacturers):**  
LLY, PFE, AMGN, BMY, AZN, GILD – Market Cap und PE in ähnlicher Größenordnung.

---

## 5. Akzeptanzkriterien

1. Auto-Peers laden zuverlässig beim ersten Aufruf.
2. Manuell hinzugefügte Peers bleiben nach Reload erhalten.
3. User kann Peers entfernen und die Liste speichern.
4. Optionale Filter (Same Market Cap / Same PE) funktionieren auf der geladenen Liste.
5. Keine Abhängigkeit von bezahlten Peer-APIs.

---

## 6. Aufwand

| Teil | Aufwand |
|------|---------|
| Stabiles Caching der Peer-Liste | 3–4 h |
| Gespeicherte Overrides pro Ticker | 2–3 h |
| Optionale Filter-Tabs | 2–3 h |
| **Gesamt** | **~8–10 h** |

**Priorität:** Hoch (aktuelles Peer-Add-Problem blockiert sinnvolle Vergleiche).

---

## 7. Kurzfassung

Peer-Qualität kommt von **Industry-Klassifikation + User-Kontrolle + stabilem Caching**, nicht von einem geheimen Algorithmus. Mit FMP + zuverlässigem Cache und Overrides ist das erreichbar, ohne GuruFocus zu kopieren.
