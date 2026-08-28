# WORK_TAM_RESIDUAL_XBOX.md — Residuum-Mix + Xbox-Wachstum

> **Stand:** 28.08.2026
> **Status:** Spec-Addendum zu [WORK_TAM_SEGMENT_MAPPING.md](./WORK_TAM_SEGMENT_MAPPING.md)
> **Repro:** MSFT Section-7 Screenshot (Mix 97.5 %, Xbox Wachstum n/a, Coverage 91 %)

**Regel:** Dokumentation. Implementierung lokal → PR → Review.

---

## 1. Residuum-Mix — Zahlen

| | Wert |
|--|--|
| Summe Spalte „Anteil“ (8 Zeilen) | \(39.0+30.7+6.6+6.0+5.1+4.6+2.8+2.7 = \mathbf{97.5\,\%}\) |
| Residual-Mix | \(100-97.5 = \mathbf{2.5\,\%}\) |
| Summe Rev. 8 Zeilen | \(129.4+102.0+21.8+19.8+17.1+15.2+9.2+9.0 = \mathbf{\$323.5B}\) |
| Karte Konzernumsatz | \(\mathbf{\$331.8B}\) |
| Residual-Rev | \(331.8-323.5 = \mathbf{\$8.3B}\) |
| Check | \(8.3/331.8 \approx 2.50\,\%\) |

Genau **eine** Restklasse. Umsatz über Differenz, kein Hardcode.

## 2. Adaptive Regel

```text
nHolesRev = Anzahl Segmente ohne gültiges revenue
residualRev = companyRevenue - Σ known segment revenue
residualMix = 100 - Σ known percentage

WENN nHolesRev == 0 UND 0 < residualMix <= 15:
    UI-Zeile "Other / nicht segmentiert"
    Rev = residualRev, Anteil = residualMix
    Wachstum / TAM / CAGR / Anteil am TAM / vs TAM = n/a
    matched = false  // zählt nicht in TAM-Coverage

WENN nHolesRev == 1 UND residualRev > 0:
    genau dieses eine Rev-Loch füllen
    TAM unmatched wenn Name nicht mappt

WENN nHolesRev >= 2:
    nichts ableiten
```

Other bekommt **kein** Katalog-TAM.

Nicht Residual:

- Server 39 % / $129.4B — Umsatz bekannt, nur SAM fehlt
- Xbox 6.6 % / $21.8B — Umsatz bekannt, nur YoY fehlt

Other +2.5 pp hebt Mapping-Coverage ohne Server (~58.5 %) nicht über 70.

## 3. Xbox-Wachstum — UI: n/a

Formel nur mit Vorjahr:

\[
g_X = \mathrm{Rev}_t / \mathrm{Rev}_{t-1} - 1
\]

FMP liefert hier kein \(\mathrm{Rev}_{t-1}\) → `growth = null` (nicht 0).

Identität aus der Tabelle:

- Konzern-YoY \(+17.8\,\%\)
- Segment-gew. Wachstum \(+21.3\,\%\) auf **91 %** Coverage
- \(91 \approx 97.5 - 6.6\) → Xbox ist das aus der Wachstumsgewichtung genommene Stück
- Other 2.5 % hat ebenfalls kein \(g\)

\[
17.8 = 0.91 \times 21.3 + 0.066\, g_X + 0.025\, g_{\mathrm{Other}}
\]

\[
0.066\, g_X + 0.025\, g_{\mathrm{Other}} = -1.583
\]

Zwei Unbekannte → nicht lösbar (gleiche Regel wie nHoles ≥ 2).

Nur zur Sensitivität, **nicht** anzeigen:

| Annahme \(g_{\mathrm{Other}}\) | implizites \(g_X\) |
|--|--|
| 17.8 % (Konzern) | \(\approx -30.7\,\%\) |
| 21.3 % (known segments) | \(\approx -32.1\,\%\) |
| 0 % | \(\approx -24.0\,\%\) |

Vorzeichen plausibel (\(21.3 > 17.8\) ⇒ Xbox+Other langsamer). Niveau nicht robust (Perimeter GitHub/Other).

**Soll:** Xbox-YoY nur aus Vorjahres-Rev. Sonst n/a. Kein „Unter vs. Cloud 16 %“ ohne \(g_X\).

## 4. Acceptance

- [ ] Other-Zeile MSFT: ~$8.3B / 2.5 %, TAM n/a
- [ ] Xbox Wachstum n/a ohne Vorjahr; kein Invertieren 17.8 vs 21.3
- [ ] Zwei Löcher → kein Solve
- [ ] Residual füllt nicht Server-TAM und nicht Xbox-CAGR
