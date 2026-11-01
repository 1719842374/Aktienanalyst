# WORK – KI-Chat Fehler bei KI-Analyse

**Stand:** 27.10.2026  
**Problem:** Wenn der lila Button (KI-Analyse) gedrückt wird, funktioniert der KI-Chat nicht. Die Daten werden nicht gesehen.

---

## Fehler

```
Ungültige Anfrage: context.sections.2.facts.wachstumsthese 
String must contain at most 400 character(s)
```

### Ursache

Das Feld `wachstumsthese` in Sektion 2 (Investmentthese) ist länger als 400 Zeichen. Die Validierung lehnt die Anfrage ab.

### Folge

Der Chat bekommt keinen Kontext und kann nicht antworten.

---

## Fix

| Option | Beschreibung | Aufwand |
|--------|--------------|---------|
| **A** | Limit auf 800–1000 Zeichen erhöhen | 1 h |
| **B** | Wachstumsthese vor dem Senden kürzen | 2–3 h |
| **C** | Beides | 3–4 h |

**Empfehlung:** Option A. 400 Zeichen sind zu kurz für eine Investmentthese.

---

## Betroffene Datei

| Datei | Änderung |
|-------|----------|
| Schema / Validierung für `context.sections` | Limit erhöhen |

---

**Kurz:**  
Der KI-Chat funktioniert nicht, wenn die KI-Analyse aktiv ist, weil die Wachstumsthese das 400-Zeichen-Limit überschreitet. Limit erhöhen.
