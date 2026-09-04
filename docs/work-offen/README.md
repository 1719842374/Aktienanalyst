# docs/work-offen — Spec ohne Engine

> Stand: 04.09.2026
> Regel: Datei landet hier, wenn der **Soll-Zustand nicht im Live-Code** steht.
> **Noch keine Datei hierher verschoben.** Originale im Root. Nächster Schritt: Copy 1:1, SHA prüfen, dann Root-Datei löschen.

## Code-Stichprobe 04.09.2026 (warum offen)

| Spec (Root) | Soll | Ist Code |
|-------------|------|----------|
| WORK_FISCAL_FRONTEND_ADAPTIVE.md | s(z) auf Bills/TGA/SOMA/DFF, kein Kalender | `classifyPolicy` + `BESSENT_WINDOW` 09.09.–04.11.2026 in `liquidity-regime-math.ts` |
| WORK_RESEARCHER_LIQUIDITY_INDEX.md | LI US/EU/ASIA, 4 Kanäle s(z) | eine Route C2, nur US WALCL/RRP/TGA |
| WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md | Buch M/F, APP/PEPP, BoJ/MoF | kein `CATALOG[EU\|ASIA]`, kein APP-Parser |
| WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md | Debt/GDP, r, V, π, T½=ln2/ln(1+r) | `M2V` US-only; Eimer ΔV=0.02; kein DFII10 im Researcher |
| WORK_RESEARCHER_BRIEFING_REGIONAL.md | 3 Regionsblöcke + Spillover + Handel-Pflicht | ein Prompt, `topChanges`≤3, NEW nur severity=high |
| WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md | Serienkatalog + X-Allowlist | kein `liqidx_v1__*`, kein X-Pager |

C2 (`WORK_RESEARCHER_LIQUIDITY_REGIME.md`) bleibt **Dokumentation** — das ist der US-Ist. Nicht doppelt hier ablegen.

## Tickets in den Specs (noch nicht Code)

1. Velocity-Formel prüfen (EMG-Fenster, EZ/JP Quotient)
2. Realzins Asien (`IRLTLT01JPM156N` − CPI, kein DFII)
3. V+π 1:1 zu g*/WACC
4. Cross-Spillover Briefing
5. EM-Kasten Briefing (Index-Gewicht CN ≤ 0.10)
