# WORK – KI-Chat Schema für ganze Analyse

**Stand:** 27.10.2026  
**Ziel:** Schema für die ganze Analyse, das generisch und adaptiv auf alle Aktien übertragbar ist. Inklusive PESTEL, Management Score, Thesis Score und Sichtbarkeit der KI-generierten Antworten.

---

## 1. Struktur der ganzen Analyse

| Block | Inhalt | Quelle | Bedingung |
|-------|--------|--------|-----------|
| **1. Wachstumstreiber** | Hauptsegment + Kontext | Earnings Call + Segmente | Immer |
| **2. Financials** | Was die 3 Statements zeigen | Sektion 4 | Immer |
| **3. Moat / Ökosystem** | Burggraben und Bindung | Sektion 12 | Immer |
| **4. PESTEL** | Makro-Exposure | Sektion 14 | Nur wenn rot / stark |
| **5. Technical** | Momentum-Signal | Sektion 11 | Immer |
| **6. Bewertung** | Was der Preis impliziert | Sektion 6/7 | Immer |
| **7. Management Score** | Delivery, Kapitalallokation | Sektion 19 | Immer |
| **8. Thesis Score** | Fast Grower / Stalwart etc. | Thesis Strength | Nur wenn Wachstum > 30 % |
| **9. Fazit** | 2–3 Sätze | Alles | Immer |

---

## 2. Beispiel-Output

> **Wachstumstreiber:** Azure (Cloud-Wachstum) ist das Segment mit dem höchsten Umsatzanteil und wurde im letzten Call als Haupttreiber genannt.  
> **Financials:** Die Statements zeigen hohe Margen und starken FCF. Capex belastet kurzfristig, sichert aber die Infrastruktur.  
> **Moat:** Switching Costs und Plattform-Effekte sind ausgeprägt. Das Ökosystem verstärkt die Bindung.  
> **PESTEL:** Political Exposure ist hoch (Government Exposure 35 %).  
> **Technical:** Golden Cross und RSL über 100 zeigen positives Momentum.  
> **Bewertung:** Der Kurs liegt über dem gehärteten Inverse-DCF. Die Bewertung ist anspruchsvoll.  
> **Management:** Delivery ist stark, Kapitalallokation ist diszipliniert.  
> **Thesis:** Fast Grower 56 %, Stalwart 25 %. Wachstum ist vorhanden.  
> **Fazit:** Qualität und Momentum sind stark. Die Bewertung lässt wenig Raum für Enttäuschungen.

---

## 3. KI-generierte Antworten sichtbar machen

Wenn der lila Button (KI-Analyse) gedrückt wird, soll der Chat alle KI-generierten Antworten der Sektionen sehen.

| Was | Wie |
|-----|-----|
| **KI-Antworten pro Sektion** | Werden im Kontext mitgegeben |
| **Earnings Call Summary** | Wird im Kontext mitgegeben |
| **News Summary** | Wird im Kontext mitgegeben |

Der Chat kann dann auf die KI-generierten Inhalte referenzieren, nicht nur auf die Rohdaten.

---

## 4. Aufwand

| Schritt | Aufwand |
|---------|---------|
| Schema im Prompt | 2–3 h |
| PESTEL-Bedingung | 1–2 h |
| Thesis-Score-Bedingung | 1–2 h |
| KI-Antworten in Kontext | 3–4 h |
| **Gesamt** | **~7–11 h** |

---

**Kurz:**  
Die ganze Analyse folgt einer festen Struktur. PESTEL nur bei starker Exposure, Thesis Score nur bei Wachstum > 30 %. Der Chat sieht die KI-generierten Antworten, wenn der lila Button gedrückt wurde.
