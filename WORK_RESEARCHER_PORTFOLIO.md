# WORK_RESEARCHER_PORTFOLIO.md — 3 Portfolios + Direkter Add aus Analyse/Researcher

> Stand: 14.08.2026 | Nur Dokumentation  
> Klärung nach UI-Screenshot (Portfolio mit MSFT / NVDA / NVO / LLY) und User-Feedback

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.  
Baut auf `WORK_PORTFOLIO.md` + bestehendem Positions-Tracker (`positions.ts`, `handleAddPosition`) auf.

---

**VOLLSTÄNDIGE SPEC:** Die komplette Datei (Kapitel 0–Q, ~830 Zeilen, Shrinkage, Frontier, Ist-Gewichte, File-Map, 3 Portfolios) liegt im Chat-Artifact.

Wegen Payload-Limit beim MCP-Push wurde hier ein Stub committed.  
Bitte lokal ersetzen mit dem Artifact `WORK_RESEARCHER_PORTFOLIO.md` (sha256 bdd46ebbf3750e85fbc4e6042d5c4451538b7d83d5df358e258338aca21f1f65).

## Kurz-Index der Kapitel

| Kap | Thema |
|-----|-------|
| 0 | 3 Portfolios P1/P2/P3, Buttons Section 1 + Researcher |
| A–I | Architektur, Datenmodell, UI, Acceptance, Phasen |
| J | File-Map, Routing, Konstanten |
| K | Kapitalgewichtung A/B/C, maxWeight, Kelly, Live-Pie 30/30/30/10 |
| L | Risikomanagement, HHI 0.28 |
| M | Shrinkage Ridge + Diagonal δ=0.25 bei n=4 |
| N | Efficient Frontier Spec |
| O | Ist-Gewichte Zahlen-Check MSFT ~48% vs Ziel 30% |
| P–Q | Fehlerstatus + Checkliste |

**WORK.md Index ist bereits aktualisiert** und verlinkt auf diese Datei.
