# WORK_RESEARCHER_PORTFOLIO.md — 3 Portfolios + Direkter Add aus Analyse/Researcher

> Stand: 14.08.2026 | Nur Dokumentation  
> Klärung nach UI-Screenshot (Portfolio mit MSFT / NVDA / NVO / LLY) und User-Feedback

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.  
Baut auf `WORK_PORTFOLIO.md` + bestehendem Positions-Tracker (`positions.ts`, `handleAddPosition`) auf.

---

# Kapitel 0 — Produktziel (final, verbindlich)

## 0.1 Drei Portfolios mit eigenen Rubriken

| # | Portfolio | Art | Sidebar | Befüllung |
|---|-----------|-----|---------|----------|
| **P1** | **Manuelles Portfolio** | Positions mit qty / entry / stop / Long-Short (wie **jetzt**) | 2 Investments (bestehend) | Manuell **oder** Ein-Klick aus Analyse / Screener / Researcher → erzeugt echte `PortfolioPosition` |
| **P2** | **Watchlist-Portfolio** | Auto-gewichteter Basket | **5 Watchlist-Portfolio** (NEU) | Jeder „Zur Watchlist“-Klick; Gewichtung = WORK_PORTFOLIO Pipeline (A/B/C) |
| **P3** | **Researcher-Portfolios** | Auto-Basket **pro Region** | **6 Researcher-Portfolios** (NEU) | Nur Einträge aus Researcher; Unter-Tabs: **USA · EU · China/Asien · Mixed** |

```
1 Übersicht
2 Investments          ← P1
3 Policy
4 Optimierung
5 Watchlist-Portfolio  ← P2 NEU
6 Researcher-Portfolios← P3 NEU
```

## 0.2 Buttons

| Ort | Buttons |
|-----|---------|
| **Dashboard §1 Datenaktualität** | **Zum Portfolio** + **Zur Watchlist** |
| **BTC** | analog |
| **Researcher jeder Tab + Briefing** | pro Ticker + Bulk „Alle sichtbaren …“ |

## 0.3 P1 vs P2/P3

- **P1:** echte Position (qty, entry, stop) via `handleAddPosition`
- **P2/P3:** WatchlistEntry → auto CAPM/Kelly, kein qty nötig

---

# Kapitel A — Ist-Zustand (Zahlen)

| Ticker | Qty | Side | Einstieg | Kurs | Perf. |
|--------|-----|------|----------|------|-------|
| MSFT | 1 | LONG | 499,99 € | 496,88 € | −0,62 % |
| NVDA | 1 | LONG | 223,96 € | 225,30 € | +0,60 % |
| NVO | 1 | LONG | ~67 | ~66,72 | −1,x % |
| LLY | 1 | LONG | — | — | — |

**Ziel-Pie CAPM:** MSFT 30 % · NVDA 30 % · LLY 30 % · NVO 10 %  
**KPIs:** Profit ≈ −0,5 % · Best: NVDA +0,6 %

---

# Kapitel B–I — Architektur, Modell, UI, Acceptance

Siehe Commit-Historie / vollständige Spec: Datenfluss, WatchlistEntry, Buttons, SECTIONS id 5+6, inferRegion, 12 Acceptance-Punkte, Phasen 1–7.

**Kurz Acceptance:**
```
[ ] §1 beide Buttons · Zum Portfolio → P1 · Zur Watchlist → P2
[ ] Sidebar 5+6 · Screener Bulk · Researcher-Region in P3
[ ] Keine Duplikate · bestehende MSFT/NVDA/NVO/LLY unberührt
```

---

# Kapitel J–Q — Zahlen, Daten, Fakten (vollständig)

→ **[WORK_RESEARCHER_PORTFOLIO_TEIL2.md](./WORK_RESEARCHER_PORTFOLIO_TEIL2.md)**

| Kap | Inhalt mit Zahlen |
|-----|-------------------|
| **J** | File-Map engine/weighting/covariance · Konstanten: maxWeight 0,30 · κ 0,35 · Ridge 1e−3 · Kelly 0,5/0,25 · HHI-Schwellen 0,6/0,7/0,9 |
| **K** | Modi A/B/C · pickWeightMode · maxWeight-Tabelle 60%/60%/40%/30% · Live-Pie 30/30/30/10 · Kelly-Beispiel f*=2,25 → capped 0,25 → 25.000 € |
| **L** | HHI **0,28** · Effective-N **≈3,57** · aktive Risiko-Mechanismen |
| **M** | Ridge + Diagonal-Shrinkage · **n=4 → δ=0,25** · ε-Beispiel 4e−5 |
| **N** | Efficient-Frontier Spec (Recharts, Ist vs CAPM-Marker) |
| **O** | Ist-Gewichte: MSFT **~48 %** vs Ziel 30 % (Δ **+18 pp**) · NVDA ~22 % vs 30 % |
| **P** | Behoben: Equal-Weight-Bug · Offen: Default-Cap, Direkt-Add, Frontier-UI |
| **Q** | Test-Checkliste HHI/δ/weightMarket |
