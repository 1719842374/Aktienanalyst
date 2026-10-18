# WORK – Peer-Auswahl: Detaillierter Lösungsvorschlag

**Stand:** 18.10.2026  
**Ziel:** Konkreter Implementierungsvorschlag für stabile Peer-Auswahl im Dashboard.  
**Problem:** FMP-Auto-Peers sind unvollständig (z. B. LLY fehlt bei NVO), manuelle Overrides verschwinden nach Reload.

---

## 1. Ist-Zustand

| Punkt | Aktuell | Problem |
|-------|---------|---------|
| Auto-Peers | FMP `/stable/stock-peers` | Oft unvollständig (NVO → LLY fehlt) |
| Manuelle Overrides | `peerOverrides` im Request | Nach Reload nicht persistent |
| Caching | Unzuverlässig | Hinzugefügte Ticker verschwinden |
| Filter | Keine | Keine „Same Market Cap“ / „Same PE“ |

**Beispiel NVO (Stand Analyse):**  
FMP liefert nicht automatisch LLY. User fügt LLY manuell hinzu → nach Reload ist LLY weg.

---

## 2. Soll-Zustand

| Anforderung | Beschreibung |
|-------------|--------------|
| Default-Peers | FMP Stock Peers + GICS-Industry-Fallback |
| Stabile Overrides | Manuell hinzugefügte/entfernte Peers bleiben nach Reload |
| Caching | Peer-Liste (Auto + Overrides) 24 h gecached |
| Optionale Filter | Same Market Cap (±50 %), Same PE (±30 %) |
| Max. Peers | 8 gleichzeitig |

---

## 3. Datenfluss

```typescript
// 1. Request kommt rein
const { symbol, peerOverrides } = req.body;

// 2. Cache prüfen
const cacheKey = `peers:${symbol}`;
let peers = await cache.get(cacheKey);

// 3. Falls nicht im Cache: Auto-Peers holen
if (!peers) {
  peers = await fetchFmpPeers(symbol);          // /stable/stock-peers
  if (peers.length < 3) {
    peers = await fetchIndustryPeers(symbol);   // GICS-Fallback
  }
  await cache.set(cacheKey, peers, 24 * 60 * 60); // 24 h
}

// 4. Overrides anwenden
const finalPeers = applyOverrides(peers, peerOverrides); // add / remove

// 5. Optional: Filter anwenden
const filtered = applyFilters(finalPeers, filters); // sameMarketCap, samePE

// 6. Response
return { peers: filtered.slice(0, 8), source: "fmp+overrides" };
```

---

## 4. Caching-Strategie

| Element | TTL | Key | Inhalt |
|---------|-----|-----|--------|
| Auto-Peers | 24 h | `peers:{symbol}` | FMP- oder GICS-Liste |
| User-Overrides | Persistent (DB oder LocalStorage) | `overrides:{symbol}` | add[] / remove[] |
| Final-Liste | Abgeleitet | – | Auto + Overrides |

**Wichtig:**  
Overrides werden **nicht** im 24-h-Cache gespeichert, sondern separat (User-spezifisch). Beim Laden werden sie immer auf die aktuelle Auto-Liste angewendet.

---

## 5. Override-Logik

```typescript
function applyOverrides(autoPeers: string[], overrides: { add?: string[]; remove?: string[] }) {
  let result = [...autoPeers];
  if (overrides.remove) {
    result = result.filter(p => !overrides.remove.includes(p));
  }
  if (overrides.add) {
    result = [...new Set([...result, ...overrides.add])];
  }
  return result.slice(0, 8);
}
```

**Beispiel NVO:**
- Auto: [PFE, AMGN, BMY]
- Override add: [LLY]
- Override remove: [BMY]
- Ergebnis: [PFE, AMGN, LLY]

---

## 6. Optionale Filter-Tabs

| Tab | Logik | Beispiel |
|-----|-------|----------|
| Same Market Cap | Market Cap ±50 % vom Basis-Ticker | NVO ~$170B → Peers $85–255B |
| Same PE | Forward PE ±30 % | NVO ~11.6 → Peers 8–15 |
| Same Industry | GICS Sub-Industry | Drug Manufacturers |

Filter werden **nach** den Overrides angewendet und sind optional (User wählt Tab).

---

## 7. Datenquellen

| Quelle | Endpoint | Fallback | Qualität |
|--------|----------|----------|----------|
| FMP Stock Peers | `/stable/stock-peers?symbol=` | Industry-Peers | Mittel |
| FMP Company Profile | Industry / Sector | – | Gut |
| GICS (über FMP) | Sub-Industry Peers | Manuelle Sektor-Liste | Gut |
| User Overrides | Request-Body | – | Hoch |

**Beispiel-Peers NVO (Healthcare):**  
LLY (~$800B), PFE (~$160B), AMGN (~$220B), BMY (~$120B), AZN (~$250B).

---

## 8. Akzeptanzkriterien

1. Beim ersten Aufruf von NVO werden Auto-Peers geladen und gecached.
2. User fügt LLY hinzu → LLY bleibt nach Reload sichtbar.
3. User entfernt BMY → BMY bleibt entfernt.
4. Filter „Same Market Cap“ zeigt nur Peers im ±50 %-Band.
5. Maximal 8 Peers gleichzeitig.
6. Keine Abhängigkeit von bezahlten Peer-APIs.

---

## 9. Aufwand

| Teil | Aufwand |
|------|---------|
| Cache-Layer für Auto-Peers (24 h) | 3–4 h |
| Persistente Overrides (DB oder LocalStorage) | 3–4 h |
| Filter-Tabs (Market Cap / PE) | 2–3 h |
| Frontend: Peer-Liste stabil anzeigen | 2 h |
| **Gesamt** | **~10–13 h** |

**Priorität:** Hoch (aktuelles Peer-Add-Problem blockiert sinnvolle Vergleiche).

---

## 10. Kurzfassung

**Mechanismus:**  
FMP/GICS Default-Peers → 24-h-Cache → User-Overrides persistent anwenden → optionale Filter (Same Market Cap / Same PE) → max. 8 Peers.

Damit bleibt LLY bei NVO nach Reload erhalten, ohne dass ein proprietärer Algorithmus nötig ist.
