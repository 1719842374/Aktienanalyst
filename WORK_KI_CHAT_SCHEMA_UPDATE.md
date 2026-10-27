# WORK – KI-Chat Schema: Thesis Score Korrektur

**Stand:** 27.10.2026  
**Korrektur:** Thesis Score wird immer angezeigt. Es wird die dominante Klasse gezeigt (größter Anteil), nicht nur bei Wachstum > 30 %.

---

## Thesis Score

| Statt | Richtig |
|-------|---------|
| Nur bei Wachstum > 30 % | Immer den größten Anteil zeigen |
| Feste Schwelle | Keine Schwelle |

### Beispiel

| Aktie | Größter Anteil | Anzeige |
|-------|----------------|---------|
| MSFT | Fast Grower 56 % | Fast Grower |
| NVO | Stalwart 40 % | Stalwart |
| XYZ | Cyclical 45 % | Cyclical |

Der größte Wert zeigt, um welche Art Aktie es sich handelt.

---

## Aktualisierte Struktur

| Block | Bedingung |
|-------|-----------|
| Wachstumstreiber | Immer |
| Financials | Immer |
| Moat / Ökosystem | Immer |
| PESTEL | Nur wenn stark / rot |
| Technical | Immer |
| Bewertung | Immer |
| Management Score | Immer |
| **Thesis Score** | **Immer (dominante Klasse)** |
| Fazit | Immer |
