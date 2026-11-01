# WORK – KI-Chat: Big Picture statt Sektions-Auflistung

**Stand:** 27.10.2026  
**Ziel:** Der KI-Chat soll Earnings Calls einbeziehen und eine kohärente Analyse geben, nicht nur Daten pro Sektion auflisten. Orientierung an finanzen.net zero.

---

## 1. Aktuelles Problem

Der Chat listet Daten pro Sektion auf (Moat, RSL, DCF, Katalysatoren). Er ordnet sie nicht ins Big Picture ein.

**Beispiel (aktuell):**
- Wide Moat, FCF-Marge 20,2 %
- RSL 117
- Inverse-DCF −27 %

**Was fehlt:**
- Was wurde im letzten Earnings Call gesagt?
- Welche Wachstumstreiber hat das Management genannt?
- Wie hängt das mit Zöllen, Wettbewerb, Ökosystem zusammen?

---

## 2. Ziel (analog finanzen.net zero)

| Bereich | Inhalt |
|---------|--------|
| **News** | Kontextualisierte Headlines (nicht nur Liste) |
| **Analysten** | Positive / negative Thesen |
| **Earnings** | Letzter Call + Beat/Miss + Ausblick |
| **Wettbewerb** | Ökosystem, Moat, Vergleich zu Peers |
| **Makro** | Zölle, Zinsen, Regulierung |
| **Wachstumstreiber** | Was das Management als Treiber nennt |

---

## 3. Datenquellen

| Quelle | Was | Endpoint / Methode |
|--------|-----|---------------------|
| **FMP Earnings Call** | Transkript letzter Call | `/stable/earning-call-transcript` |
| **FMP News** | Stock News | `/stable/news/stock` |
| **FMP Analyst** | Estimates, Ratings | `/stable/analyst-estimates` |
| **Bestehende Analyse** | DCF, Moat, Technical | Intern |

---

## 4. Prompt-Struktur

```
Du bist ein Analyst. Fasse die Analyse für [TICKER] kohärent zusammen.

Daten:
- Earnings Call (letzter): [Transkript-Zusammenfassung]
- News: [Top 5]
- Bewertung: [DCF, g*, Ampel]
- Moat: [Score]
- Technical: [RSL, Cross]

Aufgabe:
1. Wachstumstreiber aus dem Call
2. Wettbewerbsposition / Ökosystem
3. Makro-Risiken (Zölle, Zinsen)
4. Fazit in 3–4 Sätzen
```

---

## 5. Implementierung

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **Earnings Call holen** | FMP Transkript, Zusammenfassung | 4–6 h |
| **News holen** | FMP Stock News | 2–3 h |
| **Prompt anpassen** | Big-Picture-Struktur | 3–4 h |
| **Frontend** | Call-Zusammenfassung anzeigen | 2–3 h |
| **Gesamt** | | **~11–16 h** |

---

## 6. Beispiel-Output (Ziel)

> Microsoft hat im letzten Call die Copilot-Adoption und Azure-Nachfrage als Haupttreiber genannt. Die hohen Capex-Investitionen belasten kurzfristig die Marge, sollen aber die Infrastruktur für weiteres Wachstum sichern. Wettbewerber wie Oracle und Palantir wachsen schneller im KI-Segment, Microsoft hält aber den Plattform-Vorteil. Zölle spielen aktuell keine große Rolle. Fazit: Qualität ist hoch, Bewertung ist anspruchsvoll.

---

**Kurz:**  
Der Chat bekommt den letzten Earnings Call und News als Kontext. Der Prompt fordert eine kohärente Zusammenfassung statt einer Sektions-Liste. Aufwand ~11–16 h.
