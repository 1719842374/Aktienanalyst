# WORK_PEER_RELATIVE_VALUATION_BUGS.md

**Stand:** 2026-10-28  
**Status:** Offen / Bug-Dokumentation  
**Sektion:** Rel. Bewertung (Sektion 9)  
**Ticker-Beispiel:** TSLA

---

## 1. Peer hinzufügen funktioniert nicht / wird nicht geladen

### Ist-Zustand (Screenshot)

| Punkt | Beobachtung |
|-------|-------------|
| Button | „+ Peer hinzufügen“ |
| Verhalten | Zeigt „Peer wird geladen…“, lädt aber nicht zu Ende |
| Ergebnis | Peer erscheint nicht in der Tabelle |
| Fehlermeldung | „XPEV nicht übernommen (ungültig, außerhalb des Market-Cap-Bands oder ohne Kennzahlen)“ |

### Erwartetes Verhalten

- Ticker eingeben → Button klicken → Peer wird geladen und in der Tabelle angezeigt.
- Bei Ablehnung klare Begründung (Market-Cap-Band, fehlende Kennzahlen etc.).
- Peer-Set wird aktualisiert, sodass bei ≥ 3 validen Peers das RELATIVE_GROWTH-Gate score-wirksam werden kann.

### Vermutete Ursache

- Frontend-Request hängt oder schlägt still fehl.
- Backend filtert zu streng (Market-Cap-Band, fehlende Kennzahlen).
- Cache oder State-Update nach erfolgreichem Laden fehlt.

---

## 2. Suche in Relativer Bewertung zeigt keine automatischen Vorschläge

### Ist-Zustand

| Punkt | Beobachtung |
|-------|-------------|
| Eingabefeld | „Ticker hinzufügen (z.B. LLY)“ |
| Verhalten | Keine Vorschläge unter dem Feld beim Tippen |
| Vergleich | Haupt-Suchleiste oben zeigt Vorschläge automatisch |

### Erwartetes Verhalten

- Beim Tippen (ab 1–2 Zeichen) erscheinen Vorschläge darunter (analog zur Haupt-Suchleiste).
- Vorschläge basieren auf FMP-Suche oder lokalem Cache.
- Klick auf Vorschlag füllt das Feld und kann direkt hinzugefügt werden.

### Vermutete Ursache

- Kein Autocomplete-Handler am Peer-Eingabefeld.
- Unterschiedliche Komponente zur Haupt-Suchleiste.
- API-Call für Vorschläge fehlt oder ist nicht angebunden.

---

## 3. KI findet weniger als 3 Peers und stellt sie falsch dar

### Ist-Zustand (Screenshot)

| Punkt | Beobachtung |
|-------|-------------|
| KI-Vorschlag | „1 Ticker · KI-Vorschlag · Kennzahlen von FMP · Relativ-Score unverändert.“ |
| Anzahl | Nur 1 KI-Peer (GM) |
| Darstellung | GM steht **unter** der Peer-Tabelle unter „KI-Namen · nicht in der Peer-Tabelle“ |
| Score | Relativ-Score unverändert, Gate bleibt inaktiv |

### Erwartetes Verhalten

- KI schlägt **mindestens 3** vergleichbare Peers vor.
- Vorgeschlagene Peers erscheinen **in derselben Tabelle** (nicht darunter).
- Bei ≥ 3 validen Peers wird RELATIVE_GROWTH score-wirksam.
- KI-Peers sind klar markiert (z. B. Badge), aber in der gleichen Ansicht.

### Vermutete Ursache

- KI-Prompt oder Filter liefert zu wenige Treffer.
- Frontend rendert KI-Peers in einem separaten Block statt in der Haupttabelle.
- Market-Cap-Band oder Industrie-Filter schließt zu viele Kandidaten aus.

---

## 4. Zusammenhang mit Scoring-Gate

| Bedingung | Status bei TSLA |
|-----------|-----------------|
| |Peers| ≥ 3 | Nicht erfüllt (nur 2) |
| peerMaterial | Vermutlich true (Narrow Moat / hohe Rivalität) |
| RELATIVE_GROWTH | Deaktiviert |
| Folge | Relatives Wachstum fließt nicht in den Score ein |

Sobald die Bugs gefixt sind und ≥ 3 valide Peers vorhanden sind, sollte das Gate automatisch aktiv werden.

---

## 5. Betroffene Stellen (vermutet)

| Komponente | Datei / Bereich |
|------------|-----------------|
| Peer-Hinzufügen | Client: Relative Valuation Section |
| Autocomplete | Client: Peer-Eingabefeld |
| KI-Peer-Vorschläge | Server: peer-adaptive / LLM-Call + Client-Rendering |
| Gate-Logik | `server/scoring-gates.ts` (relativeScoreApplies) |

---

## 6. Aufwand (Schätzung)

| Aufgabe | Aufwand |
|---------|---------|
| Peer-Hinzufügen fixen (Laden + Fehlerbehandlung) | 3–4 h |
| Autocomplete analog Haupt-Suche | 2–3 h |
| KI-Peers ≥ 3 + in gleicher Tabelle anzeigen | 3–4 h |
| Test mit TSLA, MSFT, NVO | 2 h |
| **Gesamt** | **~10–13 h** |

---

## 7. Akzeptanzkriterien

1. Peer manuell hinzufügen lädt und erscheint in der Tabelle.
2. Beim Tippen im Peer-Feld erscheinen Vorschläge darunter.
3. KI schlägt mindestens 3 Peers vor.
4. KI-Peers stehen in derselben Tabelle (nicht darunter).
5. Bei ≥ 3 validen Peers wird RELATIVE_GROWTH score-wirksam.
6. Klare Fehlermeldung, wenn ein Peer abgelehnt wird.

**Quellen:** Screenshots (TSLA Peer-Vergleich), `server/scoring-gates.ts`, WORK_PEER_PRICING_POWER.md (falls vorhanden).
