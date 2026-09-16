# WORK_SCORING_VORLAGE.md — Scoring-Logik Vorlage

> Stand: 16.09.2026 | Dokumentation  
> Kern-Pipeline · Gates · Backtesting · runScoringPipeline · Lookahead-Bias & Fiscal-Ausnahme  
> **§19 NKE-Fixture: Vorzeichen-Bug, keine Attraktivitäts-These**

---

## 0. Architektur

```
finalScore = min( qualityScore × trendMultiplier , gateCap )
catalystEV  → separat ausweisen
```

Gate-Caps: PRICING_POWER 55 · RELATIVE_GROWTH 60 · DCF_REALITY 65 · INVENTORY 70

---

## 13–16 (Kurz)

Gate-Implementierung · Backtest ohne Lookahead · Nike-Fixture · runScoringPipeline Beispiel · Integrations-Checkliste  
→ Detailcode in vorherigen Abschnitten dieser Datei.  
NKE-Lesart: **§19** (Fixture ≠ Buy-Case).

---

## 17. Lookahead-Bias vermeiden & Fiscal-Megatrend-Ausnahme

### 17.1 Grundsatz (Default = Anti-Bias)

```
DEFAULT: Strikter Anti-Bias.
- Reverse-DCF und 8Q-Trend sind die Realitätsschranke.
- Narrative („Megatrend“, „AI-Boom“, „Story“) dürfen KEIN Gate entschärfen.
- PRICING_POWER und RELATIVE_GROWTH sind NIEMALS narrativ überstimmbar.
- Backtest und Live-Pipeline: nur Informationen ≤ Bewertungszeitpunkt.
```

**Besonders Pflicht bei privaten Capex-Zyklen (AI, Cloud, Semi-Equipment ohne Staatsgarantie):**  
Auftragseingänge und Capex-Guidance können schnell drehen. Hier bleibt DCF_REALITY_CHECK  
voll aktiv. Kein „AI wird das wachsen“ ohne belegten 8Q-Trend bzw. vertraglich fixierte Umsätze.

### 17.2 Warum eine eng begrenzte Ausnahme existiert

Staatsfinanzierte Nachfrage kann **mehrjährig budgetiert** sein, bevor sie in der GuV  
und damit im Reverse-DCF ankommt:

| Beispiel | Mechanismus | Typisches Fenster |
|----------|-------------|-------------------|
| NATO-2%-Ziel / Sondervermögen | gesetzliche/budgetäre Verpflichtung der Staaten | 2–4 Jahre Order-Rückenwind |
| Rüstung (Rheinmetall, Leonardo, …) | oft schwache Bilanz, hohe Abhängigkeit vom Auftragseingang — trotzdem multi-year backlog aus Staatsbudgets | 2022–2025+ |
| Infrastruktur-Programme (IRA teilweise, EU Chips Act *wenn* Grant/Loan fix) | nur soweit **verbindlich** (Gesetz + Appropriation) | je Programm |

In diesen Fällen kann `impliedGrowth` aus dem Reverse-DCF **unter** dem liegen, was bereits  
politisch/vertraglich abgesichert ist — nicht weil der Markt „zu optimistisch“ ist, sondern  
weil die Historie die künftigen Budgetjahre noch nicht enthält.

**Das ist kein Freibrief für Stories.** Nur quantifizierbare Fiscal-Katalysatoren.

### 17.3 Was die Ausnahme NICHT ist

```
❌ AI-Capex der Hyperscaler          → privater Zyklus, Anti-Bias Pflicht
❌ „Semiconductor Super-Cycle“        → zyklisch, kein Staatsfix
❌ Management-Guidance ohne Vertrag   → Narrative
❌ ESG-/Theme-ETFs als Begründung     → Narrative
❌ PRICING_POWER oder SHARE_LOSS wegdrücken → niemals
```

### 17.4 Zulässigkeits-Kriterien (alle müssen gelten)

Ein Katalysator darf DCF_REALITY **nur abschwächen** (nicht löschen), wenn:

```
1. type === 'fiscal' | 'capacity' (mit Staatsbezug)
2. confidence === 'high'
3. source: Gesetz / Haushaltsplan / verbindliche Order / NATO-Ziel-Dokument
   (url + publishedAt ≤ Analyse-Datum — kein Lookahead)
4. addressableVolume oder epsImpact numerisch gesetzt
5. eventDate oder Budget-Jahre explizit (z.B. 2025–2028)
6. probability ≥ 0.6
7. Summe fiscal catalystEV ist material (z.B. ≥ 5 % vom Kurs oder ≥ 10 % EPS)
```

Sonst: normale Gates, volle Schärfe.

### 17.5 Wirkung auf Gates (eng)

Nur `DCF_REALITY_CHECK` darf gemildert werden (Cap 65 → min(80, cap+10)).  
PRICING_POWER, RELATIVE_GROWTH, INVENTORY, REGULATORY: Fiscal-Ausnahme **niemals**.

Code: `softenDcfRealityGate` / `fiscalMegatrendQualifies` in `server/scoring-gates.ts`.

### 17.6–17.7

Pipeline nach `buildGates`: Fiscal-Qualifikation → soften nur DCF_REALITY → `applyGates`.  
Lookahead: `publishedAt ≤ asOf`. AI-Capex: `qualifies === false`.

### 17.8 Gegenüberstellung

| Fall | Realized 8Q schwach | Reverse DCF hoch | Fiscal high-conf? | Ergebnis |
|------|---------------------|------------------|-------------------|----------|
| Nike (siehe §19) | ja | g* positiv, 8Q negativ | nein | PP deckelt ≤ 55; DCF_REALITY nur als zweiter Check |
| AI-Capex-Hype, Orders noch dünn | ja | ja | nein | DCF_REALITY voll, Anti-Bias Pflicht |
| Rüstung nach NATO-2%-Beschluss, Backlog sichtbar | teils | ja | **ja** | DCF_REALITY Cap 65→75; PP/SHARE unverändert |
| Rüstung, aber Marge bricht + Share-Loss | ja | ja | ja | PP/SHARE deckeln weiter auf 55/60 — Fiscal hilft nicht |

### 17.9 Design-Absicht in einem Satz

> Staatsbudget mit belegter Mehrjährigkeit darf den **DCF-Realitätscheck entschärfen**,  
> niemals aber eine erodierende Preissetzungsmacht oder Marktanteilsverlust wegdefinieren.  
> Private Capex-Narrative (AI etc.) bekommen **keine** Ausnahme.

---

## 18. Checkliste (Ergänzung)

```
[ ] fiscalMegatrendQualifies + softenDcfRealityGate implementieren
[ ] Nur type fiscal/capacity + confidence high + probability ≥ 0.6
[ ] publishedAt ≤ as-of-date (Lookahead-Sperre)
[ ] AI-/Cloud-Capex-Fixtures: qualifies === false
[ ] NATO/Rüstung-Fixture: DCF-Cap gemildert, PP-Gate bleibt hart
[ ] Conflict-Text wenn Fiscal aktiv
[ ] NKE-Fixture nur als gapRatio-Vorzeichen-Test (§19), kein Buy-Label
```

---

## 19. NKE-Fixture — Zahlen, Fakten, was *nicht* gemeint ist

> Stand: 16.09.2026  
> Code: `server/scoring-gates.ts` (`negativeRealizedHit`, Kommentar ~Z. 319)  
> README Scoring-Gates: NKE-Beispiel +4,6 % vs. −9,6 %

### 19.1 Ökonomische Lesart (korrekt, nicht anfassen)

NKE hat faktisch **keine Preissetzungsmacht mehr**. Story („wir wachsen wieder“) gegen  
Bilanz/Marge ist genau der Fall, für den `PRICING_POWER` gebaut ist.

| Gate | Schwelle | Wirkung bei NKE-Typ | Cap |
|------|----------|---------------------|-----|
| PRICING_POWER | Op-Marge YoY ≤ −2 pp | **aktiv** — Preissetzung weg | **55** (strengster) |
| RELATIVE_GROWTH | 8Q < 5 % oder Share-Loss ≤ −2 pp | typisch aktiv | 60 |
| INVENTORY | Inventar-Tage YoY > 15 % | oft warn, wenn Lager steht | 70 |
| DCF_REALITY | siehe 19.2 | zweiter Check, nicht das Fazit | 65 |

```
finalScore = min(raw, 55, 60, 65, 70)  → bei aktivem PP: ≤ 55
```

Fiscal darf PP **nicht** mildern (§17.5). LLM-These darf PP **nicht** überschreiben.  
Einstufung „nicht attraktiv“ ist die gewollte Ausgabe.

### 19.2 Was die Fixture *nur* testet: gapRatio-Vorzeichen

Live-Fixture im Code (2026):

```
g*          = +4,6 %     // Reverse-DCF, Kurs verlangt Wachstum
realized 8Q = −9,6 %     // Run-Rate schrumpft
```

Alte einzige Regel:

```
gapRatio = g* / realized8Q = 4,6 / (−9,6) ≈ −0,48
Gate aktiv nur wenn gapRatio ≥ 1,5
```

−0,48 < 1,5 → DCF_REALITY blieb **stumm**, obwohl das die maximale Realitätslücke ist  
(Markt preist Wachstum, Historie ist negativ).

Zweiter Zweig (Pflicht, kein Buy-Signal):

```
negativeRealizedHit =
  realized8Q ≤ 0  UND  g* > 0
DCF_REALITY aktiv = positiveGapHit OR negativeRealizedHit
```

Rechenweg:

```
positiveGapHit     = false   (gapRatio nicht ≥ 1,5, Quotient negativ)
negativeRealizedHit = true   (−9,6 ≤ 0 und +4,6 > 0)
DCF_REALITY.active  = true   Cap 65, severity hard
```

### 19.3 Zahlenbeispiel — warum PP das Fazit trägt

Annahme roh `quality × trend = 72` (illustrativ, nicht Live-Kurs).

| Schritt | Score |
|---------|-------|
| raw | 72 |
| nach DCF_REALITY (65) allein | 65 |
| nach RELATIVE_GROWTH (60) | 60 |
| nach PRICING_POWER (55) | **55** |
| Fiscal auf NKE? | nein — privater Konsum, keine Staatsorder |
| Endfazit | nicht attraktiv, PP bindet |

DCF_REALITY 65 ändert am Urteil nichts, sobald Marge ≤ −2 pp bricht.  
Der NKE-Zweig verhindert nur, dass Reality **zusätzlich stumm** bleibt,  
wenn jemand nur auf gapRatio ≥ 1,5 schaut.

### 19.4 Gegenbeispiel: Utility ohne PP-Bruch

```
Utility: g* = 3 %, realized8Q = 3 %, Marge YoY = 0 pp
gapRatio = 1,0  → DCF_REALITY aus
PP aus, Inventar oft N/A
NKE-Zweig greift nicht (8Q nicht ≤ 0)
```

Kein Transfer „NKE-Logik → jede Aktie unattraktiv“.

### 19.5 Was die Fixture **nicht** ist

```
❌ NKE müsste ein Buy sein
❌ Peer-z ist an NKE gescheitert
❌ Reverse-DCF widerspricht der PP-Lesart
❌ Guidance „wir wachsen“ überstimmt die Marge
✓ Nur: Quotient g*/8Q darf bei negativem Nenner DCF_REALITY nicht abschalten
```

Acceptance (ohne Lieblingsaktie):

```
[ ] g* = +4,6 und 8Q = −9,6 → DCF_REALITY.active === true
[ ] zugleich marginDeltaYoYPp ≤ −2 → PRICING_POWER.active === true
[ ] finalScore ≤ 55 wenn PP aktiv (PP strenger als DCF 65)
[ ] Fiscal.qualifies === false (Konsum, kein Staatsbudget)
[ ] Testname/Kommentar: „gapRatio-Vorzeichen“, nicht „NKE Buy“
[ ] Kein if (ticker === "NKE") in scoring-gates.ts
```

### 19.6 Bezug Peer-z / GICS

Peer-z und GICS-Industry-Filter brauchen NKE **nicht** als Attraktivitäts-Gegenbeispiel.  
NKE ist ohne Peer-z unattraktiv, sobald PP greift.  
NKE darf DCF_REALITY-Zweig `g* > 0 ∧ 8Q ≤ 0` **nicht ersetzen** — das ist ein  
absoluter Reality-Check, kein Relativ-z.

---

**Weiter:** [WORK_REVERSE_DCF_BRIDGE.md](./WORK_REVERSE_DCF_BRIDGE.md) Teil 1  
**Regel:** Dokumentation. Implementierung lokal → PR → Review.
