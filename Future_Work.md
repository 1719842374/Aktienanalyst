# Future Work — Offene Roadmap Stock Analyst Pro (Aktienanalyst)

> **Stand: 11.10.2026**  
> Abgeglichen mit aktuellem Code-Stand auf `main`, README.md, BACKLOG.md und den live vorhandenen Komponenten.

Dieses Dokument listet die **noch nicht (vollständig) umgesetzten Ideen** und verweist explizit auf den bereits erreichten Implementierungsstand.

---

## Bereits umgesetzte Kernbereiche (Referenz)

| Feature | Status | Referenz / Code |
|---------|--------|-----------------|
| **18-Sektionen Aktien-Analyse** | ✅ | `client/src/components/sections/*`, `server/analyze-route.ts` |
| **Peer-Overrides** (manuelles Hinzufügen/Entfernen) | ⚠️ Teilweise (Bug) | `PeerComparison.tsx`, `peer-cache-key.ts` |
| **Virtuelles Portfolio** | ✅ | `PortfolioPage.tsx` |
| **Equity Researcher** | ✅ | `server/researcher.ts` |
| **BTC-Dashboard** | ✅ | `BTCDashboard.tsx` |
| **Gold-Dashboard** | ✅ | `gold-realyield-model.ts` |
| **Rezessions-Dashboard** | ✅ | `server/recession.ts` |
| **Scoring-Pipeline + Gates** | ✅ | `scoring-gates.ts` |
| **Thesis Strength / Management Score** | ✅ | |
| **Cache-System** | ✅ (Basis) | `disk-cache.ts` |

---

## Noch nicht (vollständig) umgesetzte Ideen

### NEU (11.10.2026) — Peer hinzufügen funktioniert nicht zuverlässig

**Bug / Feature-Gap (hohe Priorität)**

Im Peer-Vergleich (Sektion 7 / `PeerComparison.tsx`) funktioniert das manuelle Hinzufügen eines Tickers nicht zuverlässig:

- Manuelle Eingabe eines Tickers (z. B. „LLY“) lädt nicht oder wird nicht angezeigt.
- Nach Reload der Seite ist der hinzugefügte Peer verschwunden.
- Caching-Probleme: Overrides werden nicht korrekt im Analyse-Cache berücksichtigt oder die Response wird nicht neu geladen.
- Die UI zeigt den Peer nicht sofort nach dem Klick auf „+ Peer hinzufügen“.

**Ursachenanalyse (Code-Fakten):**

1. **Frontend (`PeerComparison.tsx`)**  
   - `handleAdd()` ruft nur `onOverridesChange({ add: [...], remove: [...] })` auf.  
   - Es gibt keinen direkten API-Call oder Trigger für einen erneuten Analyse-Request.  
   - Die Anzeige hängt davon ab, dass der Parent (`StockAnalysis` / Dashboard) die Overrides an `/api/analyze` weitergibt und die neue Response zurückliefert.  
   - Wenn der Parent nicht sofort neu analysiert oder der Cache den alten Key verwendet, bleibt die Tabelle unverändert.

2. **Cache-Key (`peer-cache-key.ts`)**  
   - `buildAnalyzeCacheKey` berücksichtigt `peerAddList` und `peerRemoveList`.  
   - Root-Cause früherer Bugs: Listen wurden nicht sortiert/dedupliziert → unterschiedliche Keys für semantisch gleiche Overrides.  
   - Aktuell normalisiert, aber wenn der Client die Overrides nicht korrekt an den Analyse-Call anhängt oder der Cache nicht invalidiert wird, greift der alte Eintrag.

3. **Backend-Anwendung (`applyPeerOverrides`)**  
   - Overrides werden nur angewendet, wenn der Analyse-Endpoint mit den neuen `peerOverrides` aufgerufen wird.  
   - Kein separater Lightweight-Endpoint für Peer-Updates (immer volle Analyse nötig).

4. **Fehlende Analogie zu TickerSearch**  
   - Die Haupt-Ticker-Suche (`TickerSearch.tsx`) hat Autocomplete, Validierung und direkten Analyse-Trigger.  
   - Das Peer-Input-Feld ist ein einfaches `<input>` ohne Suche, ohne Validierung und ohne sofortiges Feedback.

**Anforderungen / Fix-Vorschlag:**

- Peer-Hinzufügen soll **analog zur Aktienanalyse-Ticker-Suche** funktionieren:  
  - Autocomplete / Vorschläge (optional).  
  - Sofortiges Feedback (Loading-State).  
  - Trigger eines neuen Analyse-Calls mit den aktualisierten `peerOverrides`.  
  - Persistenz über Reload (Overrides im Request-Body oder localStorage + Cache-Key).  
  - Korrekte Cache-Invalidierung oder Force-Refresh bei Override-Änderung.

- Minimaler Fix:  
  1. Parent-Komponente muss bei `onOverridesChange` sofort `/api/analyze` mit neuem Body aufrufen.  
  2. Cache-Key muss die normalisierten Overrides enthalten (bereits implementiert).  
  3. UI zeigt Loading und aktualisiert die Tabelle aus der neuen Response.

**Aufwand:** 2–4 Stunden (Frontend-Trigger + Cache-Prüfung + Test).

**Priorität:** Hoch (Peer-Vergleich ist Kern der relativen Bewertung).

---

### 1. Sprach- & UI-Grundlagen

- Komplettes Dashboard auf Englisch und Deutsch (i18n).

### 2. Industrie- & Sektor-Visualisierung

- Industrie-Wertschöpfungskette mit LLM.
- Sektorrotations-Rat / Kostolany-Rad.

### 3. Cache- & Modul-Kommunikation

- Volle bidirektionale Synchronisation zwischen Analyse, Researcher und Portfolio.

### 4. BTC-Dashboard – Erweiterungen

- M2 / Fiscal Spending Overlay.
- Vollständige Miner-Indikatoren + Kapitulationszonen.
- WALCL / QE-QT-Regime.

### 5. Gold-Dashboard – Erweiterungen

- AISC / Cash-Cost als kontinuierliches Signal.
- Multi-Faktor Phase 2 (WALCL + DXY).
- Gold-News-Sektion (analog BTC-Liquidität).
- Technische Overlays (50/200 MA, Golden/Death Cross, Volumen).

### 6. Analyse-Engine & Parameter

- Monte-Carlo-Parameter flexibel.
- Segment-Deduplizierung.
- Konsistente Formeln.

### 7. Rezessions-Dashboard

- Google-Trend-Score fixen.
- Adaptive Scoring (Layer-Gewichtung, Managing-Score, Realized Growth Gap etc.).

### 8. Scoring & Fazit

- Fazit als Konfliktmatrix.

---

## Prioritäten-Übersicht (aktualisiert 11.10.2026)

| Priorität | Thema | Status |
|-----------|-------|--------|
| **Hoch** | **Peer-Add funktioniert nicht (Cache + Trigger)** | neu 11.10.2026 |
| **Hoch** | Gold adaptive Scoring + News + MA-Cross | dokumentiert in Future_10 |
| **Hoch** | BTC/Gold WALCL / QE-QT | offen |
| **Hoch** | i18n DE/EN | offen |
| **Mittel** | Segment-Dedup | offen |
| **Mittel** | Researcher Sector Add-Buttons | offen |

---

## Nächste Schritte

1. Peer-Add-Bug fixen (Trigger + Cache + UI-Feedback).
2. Gold-News-Sektion und MA-Overlays umsetzen.
3. Adaptive Layer-Gewichtung für Rezession und Gold verdrahten.

---

*Aktualisiert 11.10.2026 (Peer-Add-Bug dokumentiert) · Referenz-Repo: https://github.com/1719842374/Aktienanalyst*
