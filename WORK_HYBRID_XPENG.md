# WORK – Hybrid-Klassifikation: Übertragbarkeit auf XPeng

**Stand:** 27.10.2026  
**Frage:** Ist der Vorschlag adaptiv und generisch, also ohne Hardcoding auf XPeng übertragbar?

---

## Antwort

**Ja – wenn der Thesis Score aus den Daten kommt.**

### Warum übertragbar

| Punkt | Adaptiv? |
|-------|----------|
| Anteile (Cyclical / Fast Grower / Stalwart) | Ja, aus den Daten berechnet |
| Dominante Klasse | Ja, größter Anteil |
| Sekundäre Klasse bei >20 % | Ja, keine feste Schwelle |
| Produktnamen | Nein, nicht hardcoded |

### Beispiel

| Aktie | Cyclical | Fast Grower | Anzeige |
|-------|----------|-------------|---------|
| **TSLA** | 60 % | 25 % | Cyclical / Fast Grower |
| **XPeng** | 70 % | 15 % | Cyclical |
| **NIO** | 65 % | 20 % | Cyclical / Fast Grower |

Die Anteile kommen aus dem Thesis Score. Kein festes Label für TSLA oder XPeng.

---

**Kurz:**  
Ja. Solange der Thesis Score die Anteile aus den Daten berechnet, ist der Vorschlag auf XPeng und andere Hybride übertragbar.
