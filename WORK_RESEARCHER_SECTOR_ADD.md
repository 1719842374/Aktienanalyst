# WORK_RESEARCHER_SECTOR_ADD.md — Fehlende Add-to-Portfolio/Watchlist Buttons im Sector Opportunity Tab

> **Stand: 19.08.2026**  
> Bug / Feature-Gap dokumentiert nach User-Report (Screenshot Sector Opportunity — Asien)

---

## Problem (Ist-Zustand)

Im **Researcher → Sector Opportunity** Tab können die Kandidaten-Ticker (`topPlayers`) **nicht** zum Portfolio oder zur Watchlist hinzugefügt werden.

Im **Undervalued Screener** funktioniert es einwandfrei (sowohl Einzel-Buttons als auch Bulk „Alle sichtbaren zur Watchlist“).

### Reproduktion
1. Researcher öffnen → Region „Asien“ wählen
2. Tab „Sector Opportunity“ → Analyse starten / laden
3. Bei jedem Sektor erscheinen Ticker-Tags (z. B. `TSM.TW`, `SAMSUNG.KS`, `BABA.US` …)
4. **Kein** „Portfolio“- oder „Watchlist“-Button sichtbar → Klick auf die Tags macht nichts

### Vergleich (Zahlen / Fakten aus Code)

| Komponente | Datei | TickerAddButtons | Bulk-Add | Status |
|------------|-------|------------------|----------|--------|
| **Undervalued Screener** | `ScreenerPanel.tsx` | ✅ pro Kandidat | ✅ „Alle sichtbaren zur Watchlist“ | funktioniert |
| **Daily Briefing Modal** | `Researcher.tsx` (BriefingChangeCard) | ✅ compact pro Ticker | ✅ „Alle → Watchlist“ | funktioniert |
| **Sector Opportunity** | `SectorsPanel.tsx` | ❌ **fehlt komplett** | ❌ fehlt | **Bug** |
| MacroPanel / CapexPanel | — | — | — | (keine Ticker-Listen) |

**Ursache (Code-Fakt):**  
In `client/src/components/researcher/SectorsPanel.tsx` werden die `topPlayers` nur als statische `<span>` gerendert:

```tsx
{t.topPlayers?.map((p: string, i: number) => (
  <span key={i} className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] font-mono ...">{p}</span>
))}
```

Es gibt **keinen Import** von `TickerAddButtons` und **keinen** Aufruf von `addTickerToManualPortfolio` / `addTickerToWatchlist` / `bulkAddToWatchlist`.

Die generische Komponente `TickerAddButtons` (aus `client/src/components/portfolio/TickerAddButtons.tsx`) und die Bridge-Funktionen existieren bereits und werden vom Screener + Briefing erfolgreich genutzt.

---

## Erwartetes Verhalten (Soll)

Laut `WORK_RESEARCHER_PORTFOLIO.md` (Kapitel 0.2):

> Researcher **jeder Tab** + Briefing → pro Ticker + Bulk „Alle sichtbaren …“

Für Sector Opportunity bedeutet das:

1. **Pro Ticker** in `topPlayers`:  
   `TickerAddButtons` (compact-Variante) neben jedem Ticker-Tag  
   → „Zum Portfolio (P1)“ + „Zur Watchlist (P2/P3)“

2. **Optional Bulk** pro Sektor oder global:  
   „Alle sichtbaren Sektor-Ticker zur Watchlist“ (analog Screener)

3. Source-Flag: `source="researcher"` (damit P3 Researcher-Portfolios die Herkunft korrekt filtern)

---

## Fix-Vorschlag (minimaler Aufwand)

**Datei:** `client/src/components/researcher/SectorsPanel.tsx`

1. Import hinzufügen:
   ```ts
   import { TickerAddButtons, bulkAddToWatchlist } from "@/components/portfolio/TickerAddButtons";
   ```

2. In der `topPlayers`-Map die static spans durch klickbare Variante ersetzen:
   ```tsx
   {t.topPlayers?.map((p: string, i: number) => (
     <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted/40 text-[10px] font-mono text-foreground/70">
       {p}
       <TickerAddButtons ticker={p} source="researcher" compact />
     </span>
   ))}
   ```

3. (Optional) Oben im Panel einen Bulk-Button analog ScreenerPanel:
   ```tsx
   <button onClick={() => {
     const all = trends.flatMap(t => t.topPlayers || []).map(p => ({ ticker: p }));
     const r = bulkAddToWatchlist(all, "researcher");
     window.alert(`Watchlist: ${r.added} neu, ${r.skipped} übersprungen`);
   }}>
     Alle Sektor-Ticker → Watchlist
   </button>
   ```

**Aufwand:** ~30–60 Minuten (inkl. kurzer visueller Prüfung in allen 3 Regionen).

**Keine Backend-Änderung** nötig — die Portfolio-Bridge und Watchlist-Logik existieren bereits.

---

## Acceptance

- [ ] In Sector Opportunity (US / EU / ASIA) erscheinen neben jedem `topPlayers`-Ticker die beiden compact-Buttons (Portfolio + Watchlist)
- [ ] Klick „Portfolio“ fügt den Ticker in P1 (manuelles Portfolio) ein
- [ ] Klick „Watchlist“ fügt den Ticker in P2/P3 (source=researcher) ein
- [ ] Optional: Bulk-Button funktioniert und meldet added/skipped
- [ ] Screener und Briefing bleiben unverändert funktionsfähig
- [ ] Keine Console-Errors, keine Duplikat-Crashes

---

*Dokumentiert 19.08.2026 nach User-Report (Sector Opportunity — Asien Screenshot)*
