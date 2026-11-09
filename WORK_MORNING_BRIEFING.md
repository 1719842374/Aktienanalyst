# WORK_MORNING_BRIEFING.md

## Ziel

Das **Morning Briefing** (Pre-Market Briefing) im **Researcher Tab** soll das Design und den Style von Bild 1 (Country Macro Pulse) **1:1 übernehmen**.

Bild 2 ist der **aktuelle Ist-Zustand** und **nicht** der Soll-Zustand.

## Bild 1 – Gewünschter Soll-Zustand (Country Macro Pulse Style)

**Layout & Stil:**
- Dunkles, cleanes Dashboard mit klarem Header ("Country Macro Pulse")
- Navigation oben: Sector Opportunity, Undervalued Screener, Capex & Fiscal
- Hero-Banner mit kurzer Makro-Zusammenfassung + Tag (z. B. "Watch + Rotate")
- Event-Karten im 2-Spalten-Grid mit:
  - Farbigem Dot + Titel
  - Kategorie-Badge (Fiskalpolitik, Geopolitik, Konjunktur) + Zeitraum
  - Kurzer Erklärungstext
  - Impact-Zeile: INFLATION / ZINSEN / AKTIEN mit Pfeilen und Farben (grün positiv, rot negativ, grau neutral)
  - Sektor-Tags unten (Technology, Manufacturing, Defense, Energy, etc.)
- Sehr gute Lesbarkeit, viel Weißraum, professionelle Typografie

**Inhaltliche Beispiele aus Bild 1:**
- OBBBA (One Big Beautiful Bill Act) – Verabschiedung & Implementierung
- Tariff-Eskalation Phase 2: China-Zölle auf 60%+
- Stargate AI-Infrastruktur-Milestone: $500B Capex-Commitments

## Bild 2 – Aktueller Ist-Zustand (nicht gewünscht)

**Layout & Stil:**
- Pre-Market Briefing Modal/Panel im Researcher Tab
- Dichter Textblock mit CROSS-Sektion (US↔EZ, US→Asia, EZ→Asia)
- Drei Spalten US / EU / ASIA mit kurzen Bullet-Punkten
- Darunter "TOP CHANGES" als nummerierte Liste
- Weniger visuell hierarchisch, dichter, weniger kartenbasiert
- Kein Impact-Farbsystem und keine Sektor-Tags wie in Bild 1

## Anforderung

- Morning Briefing im Researcher Tab muss **optisch und strukturell 1:1** dem Country-Macro-Pulse-Design (Bild 1) entsprechen.
- Event-Karten mit Impact-Indikatoren (INFLATION / ZINSEN / AKTIEN), Kategorie-Badges und Sektor-Tags.
- Klare visuelle Hierarchie, dunkles Theme, professionelle Abstände.
- Bild 2 dient nur als Referenz für den aktuellen (nicht gewünschten) Stand.

## Nächste Schritte

1. UI-Komponente des Pre-Market Briefing im Researcher Tab auf das Karten-Layout von Bild 1 umbauen.
2. Impact-Farblogik und Sektor-Tags übernehmen.
3. Datenstruktur so anpassen, dass die Events in dem kartenbasierten Format gerendert werden.

**Screenshots:**
- Bild 1 (Soll): Country Macro Pulse Style
- Bild 2 (Ist): Aktuelles Pre-Market Briefing

Stand: 2026-11-07

---

## Ampel / Soll-Ist (Nachzug main `01bf6089`, 09.11.2026 Europe/Madrid)

| | |
|---|---|
| Spec-SHA (Blob) | `f1eb82241516debec795d8ea77e317d9ce6929e0` (Commit `01bf6089`, +55) |
| Ampel | 🔴 offen |
| Soll | Pre-Market Briefing im Researcher Tab optisch/strukturell 1:1 Country-Macro-Pulse (Bild 1): Event-Karten 2-Spalten-Grid, Kategorie-Badge, Impact INFLATION/ZINSEN/AKTIEN, Sektor-Tags, Hero+Tag |
| Ist UI Briefing | `client/src/pages/Researcher.tsx` `BriefingModal` + Button „Briefing“ → dichter Textblock / Cross / 3 Spalten US\|EU\|ASIA / Top Changes (= Bild 2, Spec selbst als Ist) |
| Ist UI Macro (Referenz Soll-Design) | Tab „Country Macro Pulse“ → `MacroPanel.tsx` `KeyEventCard` + `ImpactBadge` (Inflation/Zinsen/Aktien) + Kategorie-Badge + `affectedSectors`-Tags |
| Ist Kette Briefing (Daten) | UI `runBriefing` → `apiRequest` `POST /api/researcher/daily-briefing` (`client/src/lib/queryClient.ts`) → `server/researcher.ts` (daily-briefing) |
| Was fehlt | BriefingModal rendert **nicht** KeyEventCard-/Impact-/Sektor-Layout. Draft #180 `dc486855` „restore Pre-Market Briefing as Key-Event cards“ offen/Draft/nicht gemergt (HOLD). Kein fertig_-Rename. |
