# WORK – KI-Chat: Zeichenlimit für alle Felder

**Stand:** 27.10.2026  
**Ziel:** Das Zeichenlimit soll für alle Felder gelten, nicht nur für `wachstumsthese`. Der Chat soll funktionieren, wenn die KI-Analyse aktiv ist.

---

## Aktueller Fehler

```
context.sections.2.facts.wachstumsthese 
String must contain at most 400 character(s)
```

---

## Fix

| Feld | Aktuelles Limit | Neues Limit |
|------|-----------------|-------------|
| `wachstumsthese` | 400 | 1000 |
| Alle anderen `facts`-Felder | Unbekannt | 1000 |
| Gesamtkontext | Unbekannt | Prüfen |

### Umsetzung

1. Alle String-Felder in `context.sections.*.facts` auf mindestens 1000 Zeichen setzen.
2. Prüfen, ob weitere Felder Limits haben.
3. Testen mit aktiver KI-Analyse.

---

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| Schema / Validierung für `context.sections` | Limits erhöhen |

---

**Kurz:**  
Das Limit wird für alle Felder erhöht, nicht nur für die Wachstumsthese. Der Chat soll funktionieren, wenn die KI-Analyse aktiv ist.
