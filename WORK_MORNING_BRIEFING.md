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

## Ampel / Soll-Ist (Nachzug main `4220d4e9`, 18.11.2026; Vorgänger `01bf6089`, 09.11.2026 Europe/Madrid)

| | |
|---|---|
| Spec-SHA (Blob) | `f1eb82241516debec795d8ea77e317d9ce6929e0` (Commit `01bf6089`, +55) |
| Ampel | 🟡 teilweise |
| Soll | Pre-Market Briefing im Researcher Tab optisch/strukturell 1:1 Country-Macro-Pulse (Bild 1): Event-Karten 2-Spalten-Grid, Kategorie-Badge, Impact INFLATION/ZINSEN/AKTIEN, Sektor-Tags, Hero+Tag |
| Ist UI Briefing | main `4220d4e9e46cecf19364d56630044b46f320d966`. Route `#/researcher` (`client/src/App.tsx:65`, Hash `useHashLocation` `App.tsx:3`, Router `App.tsx:105`). `BriefingModal`: Hero `client/src/pages/Researcher.tsx:589–596` (`data-testid="briefing-hero"`), KeyEventCard-Aufruf `:607` (Grid `:604–611`, Abschnitt `:597–613`). Zitierte Spanne `:589–607` beginnt am Hero und endet auf dem Aufruf; der Block schließt `:613`. Tabs `:34–38` vorhanden (Country Macro Pulse, Sector Opportunity, Undervalued Screener, Capex & Fiscal), gerendert `:353–373`. POST `:139` vorhanden (`runBriefing` `:133`, Retry `:146`). #180 gemergt, Squash `1a8791bb1173e1ab1272e76671169514b433c932` (2026-11-09 14:38 -0800) ist Vorfahr von main. Draft-SHA `dc486855` liegt nicht auf main. |
| Ist UI Macro (Referenz Soll-Design) | `client/src/components/researcher/MacroPanel.tsx`: `ImpactBadge` `:162–185`, Impact-Zeile Inflation/Zinsen/Aktien `:203–207`, Sektor-Tags `affectedSectors` `:211–217`, `KeyEventCard` `:187–220`. Zitierte Spanne `:162–217` ist vorhanden. |
| Ist Kette Briefing (Daten) | UI `runBriefing` `Researcher.tsx:133–139` → `apiRequest` `client/src/lib/queryClient.ts:51` `POST /api/researcher/daily-briefing` → `server/index.ts:110` `registerRoutes` → `server/routes-register.ts:8` → `server/routes.ts:294` `registerResearcherRoutes(app)` → `server/researcher.ts:1520` `app.post("/api/researcher/daily-briefing")`. Kartenfelder `briefingCardForChange` `server/researcher.ts:1238` (`shared/briefing-key-event.ts:79–103`). Mapping `toBriefingKeyEvent` `:105–128` (Return `:113–127`; zitiert `:105–127`, Funktion schließt `:128`). Schema `BriefingKeyEventCard` `:7–18`. Client mappt `Researcher.tsx:542–544`. |
| Tests | `script/test-briefing-modal-render.ts` und `script/test-briefing-source-index.ts` liegen auf main. `npx tsx` am 18.11.2026 gegen `4220d4e9`: modal render passed (Exit 0), source index passed (Exit 0). |
| Was fehlt | Country-Macro-Pulse-Header/Nav im Briefing bleibt offen (fehlte am 09.11., auf main `4220d4e9` weiter so): Modal-Titel „Pre-Market Briefing“ `Researcher.tsx:550`, keine Nav Sector Opportunity / Undervalued Screener / Capex & Fiscal im Modal. Seiten-H1 ist „Researcher“ (`:301`). Die Tab-Leiste `:34–38` / `:353–373` ist die Researcher-Navigation, nicht der Briefing-Header aus Bild 1. Kein fertig_-Rename. |
