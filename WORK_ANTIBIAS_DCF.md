# WORK_ANTIBIAS_DCF.md — Anti-Bias bei Katalysatoren & Inverted DCF

> Stand: 28.07.2026 | Nur Dokumentation  
> Fix: keine hardcodierte 5-Downside-Tabelle · **eine** Adjustierungsschicht ·  
> Symmetrie + GB + Einpreisung über Reverse DCF · LLM/OpenRouter generisch

---

## 0. Anti-Hardcoding

```
❌ Fix-Liste Macro / Earnings Miss / Multiple / Patent Cliff / Policy mit festen EW×Impact
❌ Suchpflicht Medicaid, IRA, CBAM, Patent Cliff
❌ Gleichzeitig FV×(1−Damage) UND WACC↑ UND g↓

✅ Generische Achsen + LLM-Discovery + Symmetrie + GB
✅ Einpreisung über gapRatio (Reverse DCF)
✅ Inverted DCF: D− mappt EINMAL auf g ODER auf r
```

---

## 1. Architektur

```
A) FV_base = DCF(g_base, WACC)
B) g*, gapRatio = g*/realized8Q     (Reverse, clean)
C) LLM: Upside[] + Downside[]       (symmetrisch, Quellen)
D) Σ GB = Σ (PoS × Gross × (1−pricedIn))
E) FV_catalyst = FV_base × (1 + Σ GB)
F) FV_inv = DCF mit genau einem Hebel aus D−
G) Warnung wenn FV_inv < P / Asymmetrie / Symmetrie fail / hard Gate
```

---

## 2.–4. Katalysatoren, Symmetrie, PoS, GB

- Achsen generisch (`demand_macro`, `earnings_guidance`, …) — kein Programmname  
- `symmetryOk` · `pricedInFromReverse(gapRatio)` · `aggregateGb` Cap ±35 %  
- Details/Prompt OpenRouter: siehe vorherige Abschnitte in Git-History bei Bedarf  

$$
GB_k = \mathrm{PoS}_k \cdot \mathrm{Gross}_k \cdot (1-\pi_k^{\mathrm{priced}}), \quad
FV_{\mathrm{catalyst}} = FV_{\mathrm{base}}(1+\Sigma GB)
$$

---

## 5. Inverted DCF — mathematische Herleitung

### 5.0 Kernsatz

> **\(D^{-}\) verdichtet die Downside-Erwartungswerte; Inverted DCF mappt \(D^{-}\) entweder auf \(g\) oder auf \(r\), einmal — und liefert so einen pessimistischen FV ohne Mehrfachabschläge.**

### 5.1 Base-DCF

$$
EV(g,r) = \sum_{t=1}^{N} \frac{FCF_0(1+g)^t}{(1+r)^t}
  + \frac{FCF_0(1+g)^N(1+g_{\mathrm{term}})}{(r-g_{\mathrm{term}})(1+r)^N}
$$

$$
FV_{\mathrm{base}} = \frac{EV(g_{\mathrm{base}},r)-\mathrm{NetDebt}}{\mathrm{Shares}}
$$

### 5.2 Downside-Masse \(D^{-}\)

Nur negative Beiträge:

$$
\Sigma GB^{-} = \sum_{k:\,GB_k<0} GB_k \le 0
$$

$$
D^{-} = \min\bigl(0.35,\,-\Sigma GB^{-}\bigr) \in [0,\,0.35]
$$

\(D^{-}\) = erwarteter relativer Wertverlust aus Downside-Katalysatoren (gedeckelt).

### 5.3 Eine Mapping-Entscheidung (nie beides)

Klassischer Reverse-DCF löst \(g^*\) aus dem **Preis**.  
**Inverted DCF (Anti-Bias)** = Forward-DCF mit **einem** pessimistischen Parameter aus \(D^{-}\).

**Variante G (Default) — Wachstum:**

$$
g_{\mathrm{adj}} = g_{\mathrm{base}}\cdot(1-D^{-})
$$

$$
FV_{\mathrm{inv}} = \frac{EV(g_{\mathrm{adj}},\,r)-\mathrm{NetDebt}}{\mathrm{Shares}}
$$

Interpretation: Downside trifft den Cashflow-Pfad; effektives Wachstum sinkt proportional zum ungeschockten Anteil \((1-D^{-})\). Heuristik erster Ordnung, transparent.

**Variante W (optional) — Diskont:**

$$
r_{\mathrm{adj}} = r + \lambda D^{-}, \quad \lambda = 0.02\ \text{(Policy: max +70 bp bei } D^{-}=0.35\text{)}
$$

$$
FV_{\mathrm{inv}} = \frac{EV(g_{\mathrm{base}},\,r_{\mathrm{adj}})-\mathrm{NetDebt}}{\mathrm{Shares}}
$$

Interpretation: \(D^{-}\) dimensionslos → Zinsspread über \(\lambda\).

**Geschlossen:**

$$
\boxed{
FV_{\mathrm{inv}} =
\begin{cases}
\mathrm{DCF}\big(g_{\mathrm{base}}(1-D^{-}),\,r\) & \text{mode = growth}\\
\mathrm{DCF}\big(g_{\mathrm{base}},\,r+\lambda D^{-}\) & \text{mode = wacc}
\end{cases}
}
$$

### 5.4 Warum nicht dreifach strafen

\(EV\) fällt in \(r\) und steigt in \(g\). Gleichzeitig \(g\downarrow\) und \(r\uparrow\) multipliziert dieselbe Information \(D^{-}\) zweimal; plus \(FV\times(1-\mathrm{Damage})\) ein drittes Mal → systematisch \(FV_{\mathrm{inv}}\ll P\) und inflationäre Warnungen.

### 5.5 Reverse vs. Inverted

| | Reverse \(g^*\) | Inverted \(FV_{\mathrm{inv}}\) |
| --- | --- | --- |
| Input | Marktpreis \(P\) | \(D^{-}\) aus Downside-GB |
| Output | implizites Wachstum | pessimistischer FV |
| Gleichung | \(EV(g^*,r)=EV_{\mathrm{mkt}}\) | \(\mathrm{DCF}(g_{\mathrm{adj}}\ \mathrm{oder}\ r_{\mathrm{adj}})\) |
| Rolle | Einpreisung / Gate | Anti-Bias-Lesart |

### 5.6 Code-Kern

```ts
export function invertedDcf(opts: {
  fcf0: number;
  gBase: number;
  wacc: number;
  n?: number;
  gTerm?: number;
  netDebt: number;
  shares: number;
  sigmaGbDown: number; // Summe GB nur Downsides (≤ 0)
  mode: 'growth' | 'wacc';
  lambda?: number;     // default 0.02
}): { fvInv: number; gAdj: number; waccAdj: number; Dminus: number } {
  const Dminus = Math.min(0.35, Math.max(0, -opts.sigmaGbDown));
  const gAdj = opts.mode === 'growth' ? opts.gBase * (1 - Dminus) : opts.gBase;
  const waccAdj =
    opts.mode === 'wacc' ? opts.wacc + Dminus * (opts.lambda ?? 0.02) : opts.wacc;
  // Standard-N-Jahr-DCF(fcf0, gAdj, waccAdj) → equity / shares
  const fvInv = 0; // Placeholder: bestehende forwardDcf-Routine
  return { fvInv, gAdj, waccAdj, Dminus };
}
```

### 5.7 Zahlenbeispiel (mode = growth)

```
FV_base = 100
Σ GB+ = +0.08 · Σ GB− = −0.10 · Σ GB = −0.02
FV_catalyst = 98
D− = 0.10
g_base = 8 % → g_adj = 7.2 %
FV_inv ≈ DCF(7.2 %) z.B. 94
P = 105 → WARN (FV_inv < P, FV_catalyst < P)
```

### 5.8 Warnregeln

```
1) FV_inv < Preis
2) FV_catalyst < Preis
3) ¬symmetryOk
4) Σ GB_up > 2 × |Σ GB_down|
5) hard Gate aktiv
```

---

## 6. LLM / OpenRouter (generisch)

Query-Builder + Prompt **ohne** Fixnamen (Patent Cliff, Medicaid, …).  
Achsen nur als Suchhilfe. JSON → `BiasCatalyst[]` → PoS, pricedIn, GB → `invertedDcf`.

---

## 7. Checkliste

```
[ ] D− nur aus Downside-GB, Cap 0.35
[ ] mode growth | wacc exklusiv
[ ] kein FV×(1−Damage) parallel zur Inversion
[ ] Prompt generisch (OpenRouter)
[ ] Symmetrie + Warnungen
[ ] Tests: D−=0 → FV_inv=FV_base; mode nicht beides
```

**Weiter:** [WORK_REVERSE_DCF_BRIDGE.md](./WORK_REVERSE_DCF_BRIDGE.md) · [WORK2.md](./WORK2.md)

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
