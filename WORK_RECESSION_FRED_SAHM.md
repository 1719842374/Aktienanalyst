# WORK_RECESSION_FRED_SAHM.md

Invertierte Fassung: Methodik fest, Schwellen aus der eigenen Historie.
Kein `val >= 0.5 → +4`. Kein 24-Monats-Fenster für z.

---

## 1. FRED — holen und reinigen (alle Serien gleich)

Endpoint unverändert:

```
https://fred.stlouisfed.org/graph/fredgraph.csv?id={SID}&cosd={YYYY-MM-DD}
```

`cosd` = heute − **H** (Sahm/Kurve/VIX: 20 Jahre; M2/Durable: 20J; Daily DGS10: 10J).
Heute: 24 bzw. 36 Monate — zu kurz für \(\sigma\).

Bereinigung, Reihenfolge fest:

1. Header weg, Zeilen `value ∈ {".", "", NaN}` droppen (FRED-Lücke).
2. Datum aufsteigend, Dubletten: letzter Stand gewinnt.
3. Daily → Monatsultimo nur wo der Slot monatlich ist (Sahm, M2).
   Daily-Slots (VIX, DGS10, WTI) bleiben daily, z auf 13W-Δ.
4. Revision: **Realtime-Serie bevorzugen** (`SAHMREALTIME` nicht `SAHM`).
   Vintage nicht mischen.
5. Einheit prüfen: `RECPROUSM156N` schon %, kein ×10.
6. `n < H_min` → `available:false`, Slot-Score 50, nicht Default-Regime.

\[
z_t=\frac{x_t-\mu_{t,H}}{\sigma_{t,H}+\varepsilon},\quad
s(z)=50+50\,\mathrm{clip}(z/2,-1,1)
\]

Roh-Score für die 17er-Tabelle:

\[
\mathrm{raw}=\mathrm{round}\bigl((s-50)/12.5\bigr)\in[-4,+4]
\]

Gewicht bleibt Modellparameter (Sahm ×1). Zone = Label aus s, nicht aus Eimer.

---

## 2. Sahm — selbst rechnen, dann s(z)

Definition (Claudia Sahm / FRED):

\[
U^{3m}_t=\tfrac13(U_t+U_{t-1}+U_{t-2}),\qquad
S_t=U^{3m}_t-\min_{k=0\ldots 11} U^{3m}_{t-k}
\]

US: \(U=\) `UNRATE`. Kontrolle: \(S_t\) muss `SAHMREALTIME` ± 0.02 treffen.

EZ/JP: dieselbe Formel auf `une_rt_m` / `LRUNTTTTJPM156S`.
Die 0.50-pp-Marke ist nur **Beschriftung** („historische US-Regel“), nicht der Sprung +4/−3.

Ist 05.09.2026: \(S=-0.07\) → heute raw −3 weil \(S<0.5\).
Soll: z von S über 20J. −0.07 liegt nahe μ → s ≈ 50 → raw ≈ 0, nicht −3.

`triggered = S ≥ 0.50` bleibt ein Boolean für die UI-Karte, ohne Score-Hebel.

DoD:
1. Fixture: aus `UNRATE` gebautes S = FRED `SAHMREALTIME` letzte 12 Monate, max |Diff| 0.02.
2. Löschen von `>= 0.5 ? 4 : -3` ändert s, sobald Historie da ist.
3. `n<24` Monate → available false.
4. EZ-Sahm ohne Hardcode-Ticker, nur ALQ-Serie.
