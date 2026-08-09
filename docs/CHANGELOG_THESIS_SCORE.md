# Changelog — Thesis Strength Score

Kompakte Änderungsdokumentation für `server/thesis-strength.ts` (+ zugehörige Verdrahtung in `server/routes.ts`, `script/test-thesis-strength.ts`). Chronologisch, neueste Änderung oben. Jeder Eintrag verlinkt den Commit-SHA für den vollen Diff.

---

## 09.08.2026 — Inflection-Logik (cyclical) + robuste Peer-Median-Bereinigung

**Commit:** [`b76c66d`](https://github.com/1719842374/Aktienanalyst/commit/b76c66d)

**Root-Problem:** Bei zyklischen Profilen (`profile==cyclical`) zählte nur das Wachstums-*Niveau* (CAGR), nicht die *Verbesserung über Zeit* (Boden → Erholung). Der Peer-Median für `g_required` nutzte außerdem den rohen Median, der bei kleinen Peer-Gruppen (n<6) von einzelnen Hyper-Growth-Ausreißern verzerrt werden kann.

**Änderungen:**
- `computeInflectionEvidence()` — neue Funktion. Vergleicht Mittelwert der letzten 2 Perioden vs. der 2 Perioden davor (`delta`), für Revenue/EPS/Marge. `inflection_raw = clamp(delta/10, 0, 1)`.
  - Guard: Zeitreihe <4 Perioden → Score 0.
  - Guard: exakt 4 Perioden (kein 3. Fenster für Persistenz-Bestätigung) → Rohwert auf max. 0.40 gedeckelt.
  - **Breadth-Filter** (abgestuft, nicht binär): 0 Metriken verbessern sich → Faktor 0.0, 1 → 0.6, 2 → 0.90, 3 → 1.0. Verhindert, dass ein einmaliger Basiseffekt in nur einer Kennzahl (z. B. Revenue) einen hohen Score erzeugt, während EPS/Marge weiter fallen.
- Einbindung in `computeGrowthEvidence()`: nur für `profile==cyclical` ersetzt `0.40×Niveau + 0.60×Inflection` den reinen CAGR-Beitrag. Alle anderen Profile (`software_growth`/`consumer_brands`/`other`) bleiben unverändert bei der reinen Niveau-Formel.
- `robustSectorGrowth()` — erweitert:
  - n≥6 → Winsorized **Median**.
  - n<6 mit Industry-Median-Referenz → 40/60-Blend Richtung Industry.
  - n<6 ohne Industry-Referenz (aktueller Regelfall) → Winsorized **Mean** statt Median. *Grund:* Winsorize-Median bleibt bei ungerader Stichprobengröße unverändert, wenn der mittlere sortierte Wert selbst kein Extremwert ist (mathematische Eigenschaft, kein Bug) — der Mean reagiert dagegen sichtbar auf die Randkappung.
- `server/routes.ts`: `revenueGrowthSeries`/`opMarginsChrono` (chronologisch, älteste zuerst) additiv gebaut, `sectorMedianForGRequired` nutzt jetzt den robusten Wert statt des rohen Peer-Medians.

**Live-Verifikation:**
- NKE: `profile=consumer_brands` (kein cyclical → `inflection=null`, korrekt). Peer-Median 24,16% → **18,72%** (Winsorized Mean), `g_required` sinkt entsprechend.
- NUE (Nucor, `profile=cyclical`, echter Zykliker): Inflection wird berechnet, Delta −1,57pp (kein Boden), Breadth-Faktor 0.00 (0 von 3 Metriken verbessern sich) → kein künstlicher Boost.
- MSFT (Regression): `inflection=null` außerhalb cyclical, GrowthEvidence 0.898 unverändert.

**Tests:** 94/94 in `test-thesis-strength.ts` (14 neue Checks).

---

## 09.08.2026 — Root-Cause-Fix Segment-Skalierung + Sektor-adaptive Ranges ("NKE-Vorfall")

**Commit:** [`f3bc745`](https://github.com/1719842374/Aktienanalyst/commit/f3bc745)

**Root-Problem (live an NKE beobachtet):** EPS-CAGR −24,97% ergab trotzdem CAGR-Score ~96%, GrowthEvidence ~90%, Fast-Grower-Konfidenz 45% (Turnaround nur 3%) — trotz Lynch-Label "Zykliker/Turnaround". Ursachen: (1) doppelte `*100`-Skalierung bei `maxSegmentGrowthPct` (Funktion gibt bereits Prozent zurück), (2) feste Software-Ranges wurden auf alle Sektoren angewendet (Sektor-Referenz zeigte fälschlich Technology 14,2% statt Consumer/Apparel), (3) kein Materialitäts-Filter — ein 0,3%-Mini-Segment mit +93,2% Wachstum trieb den Segment-Score.

**Änderungen (generisch, keine Ticker-Hardcodes):**
- Fix: `maxSegmentGrowthPct = materialSegment.materialGrowthPct*100` → `*100` entfernt (doppelte Skalierung).
- `mapGrowthProfile(sector, industry)` — neue Funktion, mappt auf `software_growth | consumer_brands | cyclical | other` per Substring-Heuristik auf Industry/Sector (keine Ticker-Liste).
- `GROWTH_PROFILE_RANGES` — profil-adaptive Floors/Spans für CAGR- und Segment-Score. Software bleibt bei den bisherigen Anker-Werten (8%→0, 16%→0,50, 24%→1,0); consumer_brands/cyclical/other nutzen niedrigere Floors (10–16% gilt dort bereits als stark).
- **G1 (universeller Guard):** `epsCagr<=0 → cagr_score=0`, unabhängig vom Profil.
- **G3 (Segment-Materialität):** `computeMaterialSegmentGrowth()` — nur Segmente mit `percentage>=10` zählen; Mini-Segmente können den Score nicht treiben. Fallback bei keinem materiellen Segment: umsatzgewichteter Top-3-Durchschnitt.
- **G2 (Weak-Growth-Ceiling):** `applyWeakGrowthCeiling()` — wenn Revenue YoY UND EPS-CAGR beide <5%, wird Fast-Grower-Konfidenz auf ≤15% gedeckelt, Überschuss proportional auf die anderen Stile verteilt.
- **G4 (Lynch-Boost nur auf Label-Stil):** `LYNCH_TO_STYLE`-Export — Zykliker boostet nur Cyclical, Turnaround nur Turnaround usw., nie Cross-Boost (z. B. Zykliker → Fast Grower).
- `robustSectorGrowth()` (Erstversion, Median-basiert) für `g_required` statt pauschalem Technology-Default.

**Live-Verifikation:** NKE — cagr_score 0, GrowthEvidence <30%, Fast Grower ≤15%, Turnaround/Cyclical dominant, Sektor-Referenz Consumer/Apparel statt Technology. MSFT-Regression grün (Fast Grower weiterhin führend).

**Tests:** Erweitert auf 79 Checks (G1–G4 einzeln, Profil-Mapping, NKE/MSFT-Regression).

---

## 09.08.2026 — These-Refresh nach KI-Enrich + Peer-Gap/Sektor-Median in die These

**Commit:** [`eee6f69`](https://github.com/1719842374/Aktienanalyst/commit/eee6f69)

- `generateThesisWithFingerprintCache()` — gemeinsamer Helper (extrahiert aus `analyze-route.ts` Step 14), jetzt auch von `/api/catalyst-enrich` genutzt, damit die Live-These direkt nach dem KI-Enrich-Klick mit echten Peer-Gap-Daten aktualisiert wird statt erst beim nächsten vollen Analyze-Call.
- `growthThesisFingerprint` erweitert um `sectorMedianRevenueYoyPct`, `peerGapPct` — die These reagiert jetzt auf Sektor-/Peer-Kontextänderungen, nicht nur auf Kernkennzahlen.
- Live auf Render verifiziert.

---

## 09.08.2026 — Live-These + Thesis-Score + Katalysatoren (Ausgangsticket)

**Commit:** [`9d2e39c`](https://github.com/1719842374/Aktienanalyst/commit/9d2e39c)

- Investmentthese in Abschnitt 2 wird jetzt LLM-generiert (4–8 Sätze, 5 Pflichtpunkte) statt leer zu bleiben — Fingerprint-Cache verhindert unnötige Regenerierung bei unveränderten Kernfakten.
- `Catalyst.generic?:boolean` (additiv in `shared/schema.ts`) — explizites Flag statt Heuristik, ob ein Katalysator generisch oder firmenspezifisch ist.
- Baustein E (Katalysator-Score) an eine frische These gebunden.

---

## Betroffene Dateien (kumulativ, alle 5 Commits)

| Datei | Rolle |
|---|---|
| `server/thesis-strength.ts` | Kern-Scoring-Modul: Guards, Profil-Mapping, Inflection, robuster Peer-Median |
| `server/routes.ts` | `/api/thesis-strength`-Route: Datenverdrahtung (Section-1-Felder, Peer-/Sektor-Aggregation) |
| `server/analyze-route.ts` | `generateThesisWithFingerprintCache()`-Helper |
| `server/llm-openrouter.ts` | `GrowthThesisInput`/Prompt für die Live-These |
| `shared/schema.ts` | additive Felder: `Catalyst.generic`, `StockAnalysis.growthThesisGeneratedAt` |
| `script/test-thesis-strength.ts` | 94 Checks, 10 Suiten insgesamt im Repo |

## Baseline (Stand nach allen 5 Commits)

- `tsc --noEmit`: 102 Fehler (unverändert seit Sessionbeginn, nur bestehende, keine neuen)
- `npm run build`: erfolgreich
- Alle 10 Testsuiten grün
- Keine Ticker-Hardcodes — sämtliche Guards/Profile arbeiten über Sector-/Industry-Strings und Live-Daten
