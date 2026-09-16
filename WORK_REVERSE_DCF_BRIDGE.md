# WORK_REVERSE_DCF_BRIDGE.md

> Stand: 16.09.2026 | Nur Dokumentation  
> Reverse-DCF · Bridge · TTL · Cache-Invalidierung · DCF-Modellierung mit Fiskaldaten

---

# Teil 1 — Reverse DCF (Kern)

$$EV(g^*) = P \times Shares + NetDebt$$
g\* Binary Search · gapRatio = g\*/realized8Q → DCF_REALITY_CHECK

**NKE-Fixture (kein Buy-Case):**  
Code `scoring-gates.ts` 2026: g\* = +4,6 %, realized8Q = −9,6 %.  
gapRatio = 4,6/(−9,6) ≈ −0,48 < 1,5 → alter Quotient schaltete DCF_REALITY stumm.  
Zweiter Zweig: `realized8Q ≤ 0 UND g* > 0` → Gate wieder aktiv.

Ökonomie unverändert: NKE ohne Preissetzungsmacht → PRICING_POWER Cap 55 bindet.  
DCF_REALITY 65 ändert das Fazit „nicht attraktiv“ nicht.  
Ausführlich: [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) §19.

Fiscal ändert g\* **nicht**. Fiscal mildert nur den DCF_REALITY-Cap, nie PP/SHARE/Inventar.

---

# Teil 2 — Bridge, TTL, Invalidierung

Siehe vorherige Fassung im Git-Verlauf für TTL-Tabellen, Invalidierungs-API und Fiscal-Overlay  
(allocateProgramToFcf, capOverlays 30 %, forwardDcfWithFiscal). Inhalt Teil 2–3 unverändert  
gegenüber 28.07.2026; dieser Commit ergänzt nur Teil 1 um die NKE-Klarstellung.

**Regel:** Dokumentation. Implementierung lokal → PR → Review.
