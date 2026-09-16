# WORK_REVERSE_DCF_BRIDGE.md

> Stand: 16.09.2026 | Nur Dokumentation  
> Reverse-DCF · Bridge · TTL · Cache-Invalidierung · DCF-Modellierung mit Fiskaldaten

---

# Teil 1 — Reverse DCF (Kern)

$$EV(g^*) = P \times Shares + NetDebt$$
g\* Binary Search · gapRatio = g\*/realized8Q → DCF_REALITY_CHECK

**NKE-Fixture (kein Buy-Case):**  
Code `server/scoring-gates.ts` (2026): g* = +4,6 %, realized8Q = -9,6 %.  
gapRatio = 4,6 / (-9,6) ≈ -0,48 < 1,5 → alter Quotient schaltete DCF_REALITY stumm.  
Zweiter Zweig: `realized8Q ≤ 0 UND g* > 0` → Gate wieder aktiv.

Ökonomie unverändert: keine Preissetzungsmacht → PRICING_POWER Cap **55** bindet.  
DCF_REALITY 65 ändert das Fazit „nicht attraktiv“ nicht.  
Ausführlich mit Rechenweg: [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) §19.

Fiscal ändert g* **nicht**. Fiscal mildert nur den DCF_REALITY-Cap, nie PP/SHARE/Inventar.

---

# Teil 2 — Bridge, TTL, Invalidierung

## 2.12 TTL (Kurz)

| status/confidence | TTL |
|-------------------|-----|
| announced/low | 3 d |
| announced/high | 14 d |
| legislated | 30 d |
| funded | 45 d |
| deploying | 60 d |
| expired | 0 |

Aktiv nur wenn: expiresAt ≥ asOf ∧ publishedAt ≤ asOf ∧ status ≠ expired ∧ endYear ok.

## 2.13 Cache-Invalidierung

TTL = passives Verfallen. Invalidierung = event-getriebenes Entfernen oder Zurückstufen.

Trigger I1–I8: denied, defunded, end_year, contradiction, sector_fix, overflow, ttl_gc, manual.
API: `invalidateProgram` / `InvalidationEvent` (Fassung 28.07.2026).

Downstream: listActive, catalystsForTicker, fiscalMegatrendQualifies, Score-Cache droppen.

---

# Teil 3 — DCF-Modellierung mit Fiskaldaten

1. Reverse-DCF g* bleibt clean (Price, FCF, WACC). Fiskal ändert g* nicht.
2. Forward-DCF: Overlay nur bei qualifies (legislated|funded|deploying, high).
3. Overlay additiv, startYear–endYear, probability-gewichtet, Cap 30 % von FCF_0.
4. DCF_REALITY vergleicht g* vs 8Q; Fiscal mildert nur Cap.
5. Private AI-Capex ≠ Overlay.

Zusatzzweig (NKE, Scoring §19): realized8Q ≤ 0 und g* > 0 → DCF_REALITY aktiv, auch wenn gapRatio < 1,5.

Rüstungs-Beispiel: volume 20 Mrd. USD, 2025–2028, share 8 %, FCF-Marge 12 %, p=0,75 → 36 Mio. USD/Jahr Overlay; Cap 120 Mio. bei FCF_0=400 Mio.

Checkliste: Overlay + Cap; Forward base vs fiscal; Reverse ohne Overlay; NKE-Zweig ohne Buy-Label; PP 55 bleibt hart.

**Weiter:** [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) §17 und §19  
**Regel:** Dokumentation. Implementierung lokal → PR → Review.
