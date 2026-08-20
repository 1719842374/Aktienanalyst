# WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md

> Stand: 20.08.2026  
> Status: **Planung / Implementation Ready**  
> Themen: Lynch-Klassen → DCF-Parameter-Automatisierung · Reverse-DCF g* als aktives Signal · Explizite Ablehnung FMP-DCF-Endpoints

---

## 0. Kontext & Entscheidungsgrundlage

Aus der Analyse vom 20.08.2026 ergeben sich drei klare Punkte:

| # | Thema | Status heute | Entscheidung |
|---|-------|--------------|--------------|
| 1 | Automatisierung Lynch-Klassen Parameter | Klassifikation vorhanden (`classifyLynch`), DCF-Defaults noch sektor- + generisch | **Umsetzen** |
| 2 | Reverse DCF implizite Erwartungen (g*) | g* wird berechnet + angezeigt, aber passiv | **Stärker aktivieren** |
| 3 | FMP-DCF-Endpoints (Standard / Levered / Custom Advanced / Custom Levered) | Nicht integriert | **Komplett weglassen** |

Begründung gegen FMP-DCF (kurz):

- Eigenes FCFF-Modell + Reverse DCF + Inverted DCF + Fiscal Overlay + WACC-Floor + TV-Guard + Margin-Stress + Structural Floor + Hardened CRV ist bereits deutlich mächtiger und transparenter.
- FMP-DCF liefert undurchsichtige Annahmen und ist für Fast-Grower / Deep-Value / Turnarounds oft zu optimistisch.
- Kein Integrationsaufwand → Fokus auf die beiden wertschöpfenden Punkte oben.

---

## 1. Automatisierung Lynch-Klassen Parameter

### 1.1 Ist-Zustand (Fakten aus Code)

**Klassifikation** (`server/catalyst-engine.ts` → `classifyLynch`):

```ts
export type LynchClass = 'slow_grower' | 'stalwart' | 'fast_grower' | 'cyclical' | 'turnaround' | 'asset_play';

// Kernregeln (vereinfacht):
// growthRate >= 20          → fast_grower
// growthRate < 5 || (< 8 && DivY > 2) → slow_grower
// zyklischer Sektor oder PE/FwdPE > 1.5 → cyclical
// PB < 1.5 + PE vorhanden   → asset_play
// PE <= 0 + FwdPE > 0 oder stark negatives EPS-Wachstum → turnaround
// sonst                     → stalwart
```

**Worst-Case Drawdowns** (bereits vorhanden in `calculations.ts`):

```ts
export const LYNCH_CLASS_BASE_DRAWDOWN: Record<string, number> = {
  fast_grower: 45,
  stalwart: 32,
  slow_grower: 28,
  cyclical: 55,
  turnaround: 60,
  asset_play: 30,
};
```

**DCF-Defaults** (`buildDefaultDCFParams`) sind aktuell primär:
- sektorgetrieben (`sectorProfile.growthAssumptions.g1`, `waccScenarios.avg`)
- + generische Fallbacks (EBIT-Marge aus Operating Income / EBITDA, Capex aus FS oder Proxy)
- **kein** direkter Switch nach `LynchClass`

### 1.2 Zielbild

`buildDefaultDCFParams(data)` soll die Lynch-Klasse als **primären Override-Layer** nutzen (nach Sektor, aber vor rein generischen Fallbacks).

### 1.3 Vorgeschlagene Parameter-Tabelle (Startwerte)

Alle Werte in %. Diese Tabelle ist der Single Source of Truth für die Automatisierung.

| Parameter                  | fast_grower | stalwart | slow_grower | cyclical | turnaround | asset_play |
|---------------------------|-------------|----------|-------------|----------|------------|------------|
| **revenueGrowthP1 (g1)**  | 20.0        | 9.0      | 4.0         | 6.0*     | 5.0        | 3.0        |
| **revenueGrowthP2 (g2)**  | 12.0        | 6.0      | 3.0         | 4.0      | 4.0        | 2.5        |
| **terminalG**             | 3.0         | 2.5      | 2.0         | 2.0      | 2.0        | 2.0        |
| **ebitMarginTerminal**    | +1.5 pp**   | 0 pp     | –0.5 pp     | 0 pp     | +2.0 pp*** | 0 pp       |
| **fcfHaircut Default**    | 5           | 3        | 2           | 8        | 12         | 5          |
| **WACC-Floor Add-on**     | +0.0        | +0.0     | +0.0        | +0.5     | +1.0       | +0.0       |
| **RSL-Malus aktiv**       | ja          | ja       | nein        | ja       | ja         | nein       |
| **Kommentar**             | Aggressive Phase-1, höheres Terminal | Stabiles Compounding | Dividenden-lastig, konservativ | *Mid-Cycle normalisiert | *** Recovery-Marge | Asset-Floor wichtiger als Growth |

\* Cyclical: g1 sollte idealerweise aus Mid-Cycle / Normalised Earnings abgeleitet werden (siehe 1.5).  
\*\* „+1.5 pp“ = aktuelle EBIT-Marge + 1.5 Prozentpunkte als Terminal-Ziel (Operating Leverage).  
\*\*\* Turnaround: leichte Margen-Erholung annehmen, aber mit hohem Haircut und WACC-Add-on absichern.

### 1.4 Implementierungs-Vorschlag (Code-Struktur)

```ts
// shared oder client/src/lib/lynch-dcf-defaults.ts

export interface LynchDcfOverrides {
  revenueGrowthP1: number;
  revenueGrowthP2: number;
  terminalG: number;
  ebitMarginTerminalDeltaPp: number; // relativ zur aktuellen Marge
  fcfHaircut: number;
  waccFloorAddon: number;            // wird auf bestehenden Floor addiert
  applyRslMalus: boolean;
}

export const LYNCH_DCF_DEFAULTS: Record<LynchClass, LynchDcfOverrides> = {
  fast_grower: {
    revenueGrowthP1: 20.0,
    revenueGrowthP2: 12.0,
    terminalG: 3.0,
    ebitMarginTerminalDeltaPp: 1.5,
    fcfHaircut: 5,
    waccFloorAddon: 0.0,
    applyRslMalus: true,
  },
  stalwart: {
    revenueGrowthP1: 9.0,
    revenueGrowthP2: 6.0,
    terminalG: 2.5,
    ebitMarginTerminalDeltaPp: 0.0,
    fcfHaircut: 3,
    waccFloorAddon: 0.0,
    applyRslMalus: true,
  },
  slow_grower: {
    revenueGrowthP1: 4.0,
    revenueGrowthP2: 3.0,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: -0.5,
    fcfHaircut: 2,
    waccFloorAddon: 0.0,
    applyRslMalus: false,
  },
  cyclical: {
    revenueGrowthP1: 6.0,          // Placeholder – siehe Mid-Cycle-Logik
    revenueGrowthP2: 4.0,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: 0.0,
    fcfHaircut: 8,
    waccFloorAddon: 0.5,
    applyRslMalus: true,
  },
  turnaround: {
    revenueGrowthP1: 5.0,
    revenueGrowthP2: 4.0,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: 2.0,
    fcfHaircut: 12,
    waccFloorAddon: 1.0,
    applyRslMalus: true,
  },
  asset_play: {
    revenueGrowthP1: 3.0,
    revenueGrowthP2: 2.5,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: 0.0,
    fcfHaircut: 5,
    waccFloorAddon: 0.0,
    applyRslMalus: false,
  },
};
```

In `buildDefaultDCFParams`:

1. Bestehende Sektor-Logik beibehalten (als Base).
2. `lynchClass` aus `data` lesen (muss ggf. in `StockAnalysis` durchgereicht werden).
3. Overrides aus `LYNCH_DCF_DEFAULTS[lynchClass]` anwenden (höhere Priorität als reine Sektor-Defaults, niedrigere als manuelle User-Overrides).
4. Für **cyclical**: zusätzliche Mid-Cycle-Normalisierung (siehe 1.5).

### 1.5 Spezielle Logik pro Klasse

**fast_grower**
- g1 darf nicht unter `max(sectorG1, 15)` fallen (Floor gegen zu konservative Sektor-Defaults).
- Terminal Growth max 3.5 % (Hard Cap).
- RSL-Malus bleibt aktiv (Momentum ist bei Fast Growern kritisch).

**stalwart**
- Sehr stabile Defaults. Keine aggressiven Margin-Expansions-Annahmen.
- PEGY-Logik (aus `calcLynchPEG`) bleibt parallel bestehen.

**slow_grower**
- Dividendenrendite stärker gewichten (bereits in PEGY vorhanden).
- Terminal Growth hart auf ≤ 2.0 % begrenzen.
- RSL-Malus deaktivieren (langsame Compounder dürfen auch bei schwachem Momentum fair bewertet werden).

**cyclical**
- Ideal: Mid-Cycle EPS / Revenue als Basis statt aktueller Peak/Trough.
- Solange keine volle Peak-Trough-Historie vorliegt → konservative g1 = 0.6 × sectorG1 oder 6 % (je nachdem was niedriger ist).
- Höherer FCF-Haircut (8 %) und +0.5 WACC-Addon.

**turnaround**
- Sehr hoher FCF-Haircut (12 %) und +1.0 WACC-Addon.
- g1 bewusst niedrig halten (5 %), auch wenn Analysten optimistischer sind.
- Margin-Recovery (+2 pp) nur als Terminal-Ziel, nicht in Phase 1.

**asset_play**
- Growth-Annahmen sekundär. DCF dient eher als Cross-Check zum Asset-Value / PB.
- Niedrige g-Werte, kein RSL-Malus.

### 1.6 Durchreichung der LynchClass

Aktuell wird `classifyLynch` in `catalyst-engine.ts` aufgerufen.  
Die resultierende Klasse muss in `StockAnalysis` (shared/schema) landen und bis in `buildDefaultDCFParams` + UI (Sektion 5 / 14) durchgereicht werden.

Checkliste:

```
[ ] LynchClass in StockAnalysis-Schema aufnehmen (falls noch nicht)
[ ] classifyLynch-Ergebnis in analyze-route / researcher speichern
[ ] buildDefaultDCFParams liest lynchClass und wendet LYNCH_DCF_DEFAULTS an
[ ] UI zeigt „DCF-Defaults nach Lynch-Klasse: fast_grower“ (Transparenz)
[ ] Manuelle Overrides (User-Slider) haben weiterhin höchste Priorität
```

---

## 2. Reverse DCF – implizite Erwartungen (g*) stärker nutzen

### 2.1 Ist-Zustand

```ts
// calculateReverseDCF
g* = WACC - FCF / EV

Rating:
  negativ      → g* < 0
  realistic    → g* ≤ Referenzwachstum
  sportlich    → g* ≤ 1.5 × Referenz
  unrealistic  → g* > 1.5 × Referenz

Referenzwachstum = max(sectorG1, epsGrowth5Y, 3 %)
```

g* wird bereits für den **Einpreisungsgrad** von Katalysatoren genutzt (`calcEinpreisungsgrad`).  
Ansonsten ist es primär eine Anzeige in Sektion 14.

### 2.2 Zielbild – g* als aktives Signal

Vier konkrete Verwendungen:

| # | Verwendung | Beschreibung | Priorität |
|---|------------|--------------|-----------|
| A | Gap-Analyse | `gap = g* – eigene g1` → Warnung / Score-Abzug wenn |gap| groß | Hoch |
| B | Thesis-Strength Input | g*-Rating fließt in Thesis-Strength / Scoring-Gates ein | Hoch |
| C | Soft-Signal für Lynch | Wenn g* ≥ 25 % und aktuelle Klasse ≠ fast_grower → Hinweis / Soft-Override | Mittel |
| D | Reality-Check UI | Expliziter Block „Markt preist X % vs. unser Modell Y %“ | Hoch |

### 2.3 Konkrete Implementierungs-Vorschläge

**A – Gap-Analyse (einfach & wirkungsvoll)**

```ts
export function calculateGrowthGap(impliedGStar: number, modelG1: number): {
  gapPp: number;
  gapRatio: number;
  flag: 'aligned' | 'market_more_optimistic' | 'market_more_pessimistic' | 'extreme';
} {
  const gapPp = impliedGStar - modelG1;
  const gapRatio = modelG1 !== 0 ? impliedGStar / modelG1 : (impliedGStar > 0 ? Infinity : 0);

  let flag: 'aligned' | 'market_more_optimistic' | 'market_more_pessimistic' | 'extreme' = 'aligned';
  if (Math.abs(gapPp) <= 3) flag = 'aligned';
  else if (gapPp > 8 || gapRatio > 1.6) flag = 'extreme';
  else if (gapPp > 3) flag = 'market_more_optimistic';
  else flag = 'market_more_pessimistic';

  return { gapPp, gapRatio, flag };
}
```

Verwendung:
- In Sektion 14 + Summary anzeigen
- Bei `extreme` → automatischer Hinweis im Thesis-Strength / Score

**B – Thesis-Strength Integration**

In `thesis-strength.ts` / Scoring-Gates:

- `unrealistic` → leichter Score-Abzug oder Gate-Warnung („Markt preist unrealistisches Wachstum“)
- `negativ` → separates Flag (Markt erwartet Schrumpfung)
- `realistic` → neutral bis leicht positiv

**C – Soft-Signal für Lynch-Klassifikation**

Nur als Hinweis, kein Hard-Override:

```ts
if (gStar >= 25 && lynchClass !== 'fast_grower') {
  // UI: "Markt preist Fast-Grower-Wachstum ein (g* = 27 %), Klassifikation ist aktuell 'stalwart'"
}
```

**D – UI-Block (Sektion 14 / Summary)**

```
Markt-implizite Erwartung (g*)     14.2 %   [sportlich]
Unser Modell g1                   9.0 %
Gap                               +5.2 pp  → Markt optimistischer
```

### 2.4 Guardrails

- g* bleibt **clean** (kein Fiscal-Overlay) – Regel aus WORK_REVERSE_DCF_BRIDGE.md bleibt unangetastet.
- Gap-Analyse und Soft-Signals dürfen die Reverse-DCF-Formel selbst nicht verändern.
- Keine automatische Überschreibung der User-Wachstumsannahmen – nur Hinweise + Score-Einfluss.

---

## 3. FMP-DCF-Endpoints – explizite Entscheidung

### 3.1 Entscheidung

**Keine Integration** der folgenden FMP-Endpoints:

- `/discounted-cash-flow` (Standard DCF Valuation)
- `/levered-dcf`
- Custom DCF Advanced
- Custom DCF Levered

### 3.2 Begründung (kurz & belastbar)

1. Eigenes Modell deckt bereits ab: FCFF-Projektion, WACC-Override, g1/g2, Margen, Capex, Terminal, Haircut, Reverse DCF, Inverted DCF, Fiscal Overlay, RSL-Malus, WACC-Floor, TV-Guard, Margin-Stress, Structural Floor, Hardened CRV.
2. FMP-DCF ist Black-Box (Annahmen nicht transparent steuerbar).
3. Für Fast-Grower und Deep-Value / Turnarounds sind FMP-Defaults häufig zu optimistisch.
4. Zusätzliche API-Calls belasten das FMP-Budget unnötig (aktuell ~13 Calls pro Analyse).
5. Entwicklungsaufwand besser in Lynch-Parameter + g*-Nutzung investieren.

### 3.3 Dokumentation im Repo

Dieser Abschnitt gilt als verbindliche Entscheidung.  
Falls später doch ein externer Vergleich gewünscht wird, nur als **optionaler Side-by-Side** (nicht als primäre Quelle) und nur nach explizitem Ticket.

---

## 4. Umsetzungs-Reihenfolge (empfohlen)

| Phase | Aufgabe | Aufwand (geschätzt) | Abhängigkeit |
|-------|---------|---------------------|--------------|
| 1 | `LYNCH_DCF_DEFAULTS` + Integration in `buildDefaultDCFParams` | 0.5–1 Tag | LynchClass muss in StockAnalysis vorhanden sein |
| 2 | Gap-Analyse + UI-Anzeige in Sektion 14 / Summary | 0.5 Tag | Phase 1 nicht zwingend |
| 3 | g*-Rating in Thesis-Strength / Scoring-Gates | 0.5–1 Tag | Phase 2 |
| 4 | Soft-Signal Lynch vs. g* (nur Hinweis) | 0.25 Tag | Phase 1 + 2 |
| 5 | Dokumentation + Tests (Unit-Tests für Defaults + Gap) | 0.5 Tag | – |

Gesamt: ca. 2–3 Tage fokussierte Arbeit.

---

## 5. Test-Checkliste

```
[ ] classifyLynch liefert für bekannte Ticker die erwartete Klasse (MSFT → stalwart/fast_grower je nach Wachstum, NVO etc.)
[ ] buildDefaultDCFParams setzt g1/g2/terminalG/haircut korrekt nach Lynch-Klasse
[ ] Manuelle Overrides überschreiben Lynch-Defaults weiterhin
[ ] Gap-Analyse liefert korrekte Flags (aligned / market_more_optimistic / extreme)
[ ] g* bleibt identisch mit/ohne Fiscal-Overlay (Regression aus WORK_REVERSE_DCF_BRIDGE)
[ ] Thesis-Strength reagiert auf unrealistic / negativ
[ ] Keine FMP-DCF-Calls im Network-Log / Budget-Tracker
```

---

## 6. Offene Punkte / spätere Erweiterungen

- Mid-Cycle-Normalisierung für Cyclicals (Peak/Trough-EPS aus Historie) – aktuell nur Placeholder.
- Feineres Mapping von Sektor + Lynch-Klasse (z. B. Healthcare-Stalwart vs. Tech-Stalwart).
- Optional: User kann Lynch-Klasse manuell überschreiben (dann Defaults neu berechnen).
- Optional: g* als einer von mehreren Inputs in ein Ensemble-Wachstum (nicht als Hard-Override).

---

**Regel:** Dokumentation. Implementierung lokal → PR → Review.  
**Verwandte Docs:**  
- [WORK_REVERSE_DCF_BRIDGE.md](./WORK_REVERSE_DCF_BRIDGE.md)  
- [WORK_ANTIBIAS_DCF.md](./WORK_ANTIBIAS_DCF.md)  
- [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md)
