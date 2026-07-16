# BtcMinerSection — BTCDashboard.tsx Integration

> **Status:** `BtcMinerSection.tsx` ist committed und einsatzbereit.  
> Diese Datei beschreibt die **3 chirurgischen Änderungen** in `BTCDashboard.tsx`.
> Da die Datei 116 KB hat und nicht via GitHub API lesbar ist, sind die Patches
> hier exakt dokumentiert — kein Blindflug.

---

## Schritt 1 — Import hinzufügen

Suche den Block mit den anderen lokalen Imports oben in `BTCDashboard.tsx`.
Füge **eine Zeile** direkt darunter ein:

```tsx
// VORHER (irgendwo im Import-Block):
import { MonteCarloSection } from "../components/sections/MonteCarloSection";

// NACHHER — diese Zeile darunter einfügen:
import { BtcMinerSection } from "../components/sections/BtcMinerSection";
```

---

## Schritt 2 — Tab-Button hinzufügen

Suche die Tab-Leiste in BTCDashboard.tsx. Sie sieht ungefähr so aus:

```tsx
{[
  { id: 1, label: "Status & Preis" },
  { id: 2, label: "Halving-Zyklus" },
  { id: 3, label: "Indikatoren" },
  // ...
].map(tab => (
  <button key={tab.id} onClick={() => setActiveTab(tab.id)} ...>
    {tab.label}
  </button>
))}
```

Füge **⛏ Miner** als neuen Tab-Eintrag ein (z. B. nach Tab 3 "Indikatoren"):

```tsx
// Füge diesen Eintrag in das Tab-Array ein:
{ id: 3.5, label: "⛏ Miner" },   // oder nächste freie Nummer
```

> **Alternativ** (wenn IDs numerisch sequenziell sein müssen):  
> Nummeriere den neuen Tab als letzten Tab (höchste vorhandene ID + 1).

---

## Schritt 3 — Tab-Inhalt rendern

Suche den Switch/if-Block der Tab-Inhalte. Dort wo z. B. steht:

```tsx
{activeTab === 3 && (
  <div> {/* Indikatoren-Tab-Inhalt */} </div>
)}
```

Füge **direkt darunter** ein:

```tsx
{activeTab === 3.5 && (
  <BtcMinerSection btcPrice={analysis.btcPrice} />
)}
```

> Ersetze `3.5` durch die tatsächliche ID die du in Schritt 2 vergeben hast.  
> `analysis.btcPrice` ist der bestehende State/Prop aus `BTCAnalysis`.

---

## Warum BtcMinerSection selbst fetcht

`BtcMinerSection` ruft `/api/btc-miner` **selbstständig** auf (eigener `useEffect`).
Das bedeutet:
- **Kein Eingriff** in `btcAnalysis.ts` nötig
- **Kein Eingriff** in den `BTCAnalysis`-Typ nötig  
- **Lazy loading** — Daten werden nur geladen wenn der Tab aktiv ist
- **1h Cache** im Backend (mempool.space wird nicht überlastet)

---

## Vollständige Änderungsliste dieses PRs

| Datei | Änderung | Risiko |
|-------|----------|--------|
| `client/src/components/sections/BtcMinerSection.tsx` | **Neu** — 4 Miner-Karten | Kein |
| `BTCDashboard.tsx` | +1 Import, +1 Tab-Button, +1 Tab-Body | Minimal |
| `server/btc-miner.ts` | Unverändert ✅ | — |
| `server/routes.ts` | Unverändert ✅ (Route war bereits da) | — |
| `client/src/lib/btcAnalysis.ts` | Unverändert ✅ | — |

---

## Verifikation nach Merge

```bash
# 1. Backend-Endpunkt testen
curl http://localhost:5000/api/btc-miner | jq '.currentHashrateEH, .breakevenPrice, .puellMultiple'

# 2. Erwartete Ausgabe (Beispiel):
# 886
# 38420
# 0.4231

# 3. Im Browser: BTC-Dashboard öffnen → Tab "⛏ Miner" → 4 Karten sichtbar
```
