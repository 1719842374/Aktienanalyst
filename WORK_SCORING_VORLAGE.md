# WORK_SCORING_VORLAGE.md — Scoring-Logik Vorlage

> Stand: 28.07.2026 | Nur Dokumentation  
> Kern-Pipeline · Gates · Backtesting · runScoringPipeline · **Lookahead-Bias & Fiscal-Ausnahme**

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

```ts
export function softenDcfRealityGate(
  gate: Gate,
  fiscal: { qualifies: boolean; catalystEV: number }
): Gate {
  // Nur DCF_REALITY_CHECK darf gemildert werden
  if (gate.id !== 'DCF_REALITY_CHECK' || !gate.active || !fiscal.qualifies) {
    return gate;
  }
  // Cap anheben (weniger streng), nicht deaktivieren
  // 65 → 75 wenn fiscal material; hard Gates unberührt
  return {
    ...gate,
    cap: Math.min(80, gate.cap + 10),
    severity: 'warn',
    rationale: gate.rationale +
      ' · Fiscal-Megatrend belegt: DCF_REALITY gemildert (nicht aufgehoben)',
  };
}

/** Qualifikation — deterministisch, kein LLM-Urteil */
export function fiscalMegatrendQualifies(catalysts: Catalyst[]): {
  qualifies: boolean;
  catalystEV: number;
  reasons: string[];
} {
  const fiscal = catalysts.filter(c =>
    (c.type === 'fiscal' || c.type === 'capacity') &&
    c.confidence === 'high' &&
    c.probability >= 0.6 &&
    c.source?.url &&
    c.epsImpact != null
  );
  const reasons: string[] = [];
  if (!fiscal.length) {
    return { qualifies: false, catalystEV: 0, reasons: ['no_high_confidence_fiscal'] };
  }
  // EV grob in %-Punkten vom Kurs — caller übergibt price separat in Pipeline
  reasons.push(`fiscal_count=${fiscal.length}`);
  return { qualifies: true, catalystEV: 0, reasons }; // EV wird in Pipeline mit price berechnet
}
```

**Unveränderlich:**

| Gate | Fiscal-Ausnahme? |
|------|------------------|
| PRICING_POWER | **Nein** |
| RELATIVE_GROWTH | **Nein** |
| INVENTORY | **Nein** |
| REGULATORY_EXPOSURE | **Nein** |
| DCF_REALITY_CHECK | Ja — Cap +10, bleibt warn, wird nicht gelöscht |

### 17.6 Einbau in buildGates / Pipeline

```ts
// In runScoringPipeline, nach buildGates:
const fiscal = fiscalMegatrendQualifies(input.catalysts);
const fiscalEV = catalystExpectedValue(
  input.catalysts.filter(c => c.type === 'fiscal' && c.confidence === 'high'),
  input.price
);
const qualifies = fiscal.qualifies && fiscalEV >= 5; // z.B. ≥ 5 % vom Kurs

const gatesAdjusted = gates.map(g =>
  softenDcfRealityGate(g, { qualifies, catalystEV: fiscalEV })
);

const { score, cappedBy } = applyGates(input.qualityScore, trendMult, gatesAdjusted);
```

Zusätzlich im Verdict/Conflicts:

```
if (qualifies) {
  conflicts.push(
    'Fiscal-Megatrend aktiv: DCF_REALITY gemildert — Rückenwind aus Staatsbudget, '
    + 'nicht aus historischem Run-Rate. Bilanz-/Order-Risiko bleibt.'
  );
}
```

### 17.7 Lookahead-Regeln (Backtest + Live)

```
[ ] Katalysator-Quelle publishedAt ≤ Analyse-/Backtest-Datum
[ ] Haushaltsgesetze / NATO-Beschlüsse nur wenn zum Zeitpunkt öffentlich
[ ] Keine „ex-post wussten wir, dass Rheinmetall …“-Labels im Training
[ ] Forward-Returns nur als Evaluation-Label, nie als Score-Input
[ ] AI-Capex-Cases im Backtest: qualifies muss false bleiben
```

### 17.8 Gegenüberstellung

| Fall | Realized 8Q schwach | Reverse DCF hoch | Fiscal high-conf? | Ergebnis |
|------|---------------------|------------------|-------------------|----------|
| Nike 2023 | ja | ja | nein | DCF_REALITY + PP + SHARE → score ≤ 55 |
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
```

**Regel:** Dokumentation. Implementierung lokal → PR → Review.
