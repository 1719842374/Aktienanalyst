# WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md

**Stand:** 2026-10-28  
**Status:** Offen / Implementierungsvorschlag  
**Ziel:** KI-Ergänzung des Geschäftsmodells / der Segmentierung analog zum Peer-Vergleich. Unterposten werden **eingeschoben** (nicht als eigene Segmente), mit relativer Häufigkeit innerhalb des Eltern-Segments. Alles Geschätzte klar als Override markiert.

---

## 1. Ausgangslage (FMP + Bilanzierung)

### Tesla (TSLA) – Beispiel aus Dashboard (Stand Screenshot)

| Segment                          | Umsatz   | Anteil | YoY     |
|----------------------------------|----------|--------|---------|
| Automotive                       | $69,53B  | 73,3 % | −9,8 %  |
| Energy Generation & Storage      | $12,77B  | 13,5 % | +26,6 % |
| Services & Other                 | $12,53B  | 13,2 % | +18,9 % |
| **Summe**                        |          | **100 %** |      |

**Offizielle Bilanzierung (Tesla 10-K / 10-Q):**
- Zwei reportable Segmente: (i) Automotive, (ii) Energy Generation and Storage.
- Automotive umfasst Fahrzeuge + Services & Other (Supercharging, Wartung, Versicherung, Teile, Merchandise) + FSD (upfront und Subscriptions).
- FSD wird **nicht** als eigenes Segment ausgewiesen. Es steckt in Automotive (Verkauf) oder Services (Subscription). Es gibt Deferred Revenue für FSD-Features.
- Robotics / Optimus ist noch nicht material und nicht separat bilanziert.

**Ähnliche Unternehmen:**
- XPeng, NIO: oft nur ein Segment (Vehicle Sales and Related Business).
- Autonomes Fahren / Software wird bei den meisten EV-Herstellern nicht als eigenes Segment geführt, solange der CODM es nicht separat steuert.

---

## 2. Problem

- FMP liefert die offiziellen Segmente (Summe 100 %).
- Nicht bilanzierte / nicht separat ausgewiesene Werte (FSD, Robotics, Software-Anteile) stecken in den bestehenden Segmenten.
- Fehlende Wachstumszahlen (z. B. nächstes Jahr) müssen geschätzt werden.
- Der Override muss Sinn machen: User muss sehen, **wo** etwas drunter fällt und **wie viel relativ** innerhalb des Eltern-Segments.

---

## 3. Lösung: Unterposten einschieben (kein neues Segment)

### Prinzip

1. **Zuerst** die bestehenden FMP-Zahlen nehmen (Summe bleibt 100 %).
2. KI schätzt nur fehlende Wachstumszahlen für bestehende Segmente (aus Historie, Peers, letztem Call).
3. Nicht ausgewiesene Themen werden als **Unterposten** unter dem passenden Eltern-Segment eingeschoben (eingerückt nach rechts/unten).
4. Relative Häufigkeit / Anteil **innerhalb des Eltern-Segments** angeben (nicht vom Gesamtumsatz).
5. Alles, was nicht direkt aus FMP kommt, wird klar als **Override** markiert (Badge / Farbe / Tooltip).
6. Keine neuen Top-Level-Segmente erfinden. Summe der Top-Level-Segmente bleibt 100 %.

### UI-Darstellung (Beispiel TSLA)

```
Automotive                          73,3 %   −9,8 % YoY
  └─ FSD / Software (Override)        ~X % vom Automotive   Geschätzt / nicht separat ausgewiesen
Energy Generation & Storage         13,5 %   +26,6 % YoY
  └─ (keine Unterposten nötig)
Services & Other                    13,2 %   +18,9 % YoY
  └─ Supercharging / Service (Override)  ~Y % vom Services
  └─ Robotics / Optimus (Override)      <1 % oder n/a   nicht quantifiziert
```

- Unterposten sind eingerückt.
- Relative Häufigkeit bezieht sich auf das Eltern-Segment (z. B. „~15 % des Automotive-Umsatzes“).
- Wachstumsschätzungen für das nächste Jahr stehen als Override am Eltern-Segment.

### Schätzlogik der KI

| Fehlend                          | Basis für Schätzung                                      | Beispiel Ergebnis     | Markierung                  |
|----------------------------------|------------------------------------------------------------|-----------------------|-----------------------------|
| Wachstum nächstes Jahr (Energy)  | Historische YoY (+26,6 %) + Call-Guidance falls vorhanden | ~20–25 %             | Override: „geschätzt aus Historie“ |
| Wachstum nächstes Jahr (Auto)    | Letzte 4 Quartale + Call (Cybertruck / Refresh)           | −5 % bis +5 %        | Override: „geschätzt“        |
| FSD-Anteil innerhalb Automotive  | Call-Aussagen, Deferred Revenue, Peer-Analogien           | Hinweis + grobe Range | Override: „nicht separat ausgewiesen“ |
| Robotics / Optimus               | Kein FMP-Segment, Call erwähnt Pilot                      | <1 % oder n/a         | Override: „nicht quantifiziert“ |

**Regeln für die KI:**
- Zuerst FMP-Daten verwenden.
- Nur schätzen, wenn Historie, Peers oder Call-Aussagen vorhanden.
- Bei fehlender Basis: „nicht schätzbar“ markieren.
- Konservativer Wert bei widersprüchlichen Quellen.
- Relative Anteile immer auf das Eltern-Segment beziehen.

---

## 4. Analogie zum Peer-Vergleich

- Peer-Vergleich: KI kann Vorschläge machen / Overrides markieren.
- Hier gleich: KI ergänzt fehlende Wachstumszahlen und Unterposten-Hinweise, alles klar als Override gekennzeichnet.
- User kann Overrides manuell überschreiben oder bestätigen.

---

## 5. Zusätzliche Aufgabe: Perplexity-Link entfernen

| Element                                      | Aktion     |
|----------------------------------------------|------------|
| „Created with Perplexity Computer“            | Entfernen  |
| Link `https://www.perplexity.ai/computer`    | Entfernen  |

**Aufwand:** ~1 h

---

## 6. Implementierungsaufwand

| Teil                                      | Aufwand   |
|-------------------------------------------|-----------|
| Backend: FMP-Segmente laden + Lücken erkennen | 3–4 h    |
| KI-Call (Kontext: FMP-Daten + Historie)   | 2–3 h    |
| Frontend: Unterposten eingerückt darstellen + Override-Badge | 3–4 h |
| Tooltip / Quelle der Schätzung             | 1 h       |
| Perplexity-Link entfernen                 | 1 h       |
| **Gesamt**                                | **~10–13 h** |

---

## 7. Beispiel-Output (final)

**Automotive (73,3 %):** Umsatz −9,8 % YoY. Enthält Fahrzeuge und FSD-Software (nicht separat ausgewiesen). Geschätztes Wachstum nächstes Jahr: −5 % bis +5 % (Override).  
  └─ FSD / Software: Anteil innerhalb Automotive geschätzt / Hinweis (Override).

**Energy (13,5 %):** Umsatz +26,6 % YoY. Geschätztes Wachstum nächstes Jahr: ~20–25 % (Override).

**Services & Other (13,2 %):** Umsatz +18,9 % YoY. Enthält Service, Supercharging und weitere Anteile. Geschätztes Wachstum nächstes Jahr: ~15–20 % (Override).  
  └─ Robotics / Optimus: nicht quantifiziert (Override).

---

## 8. Nächste Schritte

1. Backend-Endpoint für Segment-Daten + KI-Ergänzung bauen.
2. Frontend-Darstellung mit eingerückten Unterposten und Override-Markierung.
3. Perplexity-Footer entfernen.
4. Test mit TSLA, MSFT und einem klassischen Industrie-Titel.

**Quellen:** Tesla 10-K / 10-Q (Segment Reporting, Revenue Recognition), FMP Segment-Daten, Dashboard-Screenshot.  
**Regel:** Keine neuen Top-Level-Segmente. Summe bleibt 100 %. Unterposten nur als Hinweis + relative Häufigkeit innerhalb des Eltern-Segments.
