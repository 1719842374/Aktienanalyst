# Offen_WORK_DCF_BILANZ_KALIBRIERUNG — Implementierungsvorschlag

Stand: 18.11.2026 23:05 Europe/Madrid. Quelle: Raum Ideengenerierung, Philip 22:58 und 23:04 („klingt sehr gut … als Implementierungsvorschlag an Stabschef“). Prüfbericht: SECTION_DCF_CALIBRATION_REPORT.md (Cursor bc-7eca1f94, Lauf #6), main `cd26c2497980aa321fb960b57a2fe58236acf3a3`.

## Freigabegrenze
Ändert die DCF-Basis `decisionPerShare` und damit Entry/CRV (`shared/fazit-signal.ts:87–121`), die quantitative Score-Basis `5 + Upside/20` (`shared/bias-fixes.ts:789`) und das Katalysator-Ziel (UI + `server/pdf-export.ts:153–160`). Damit gilt: Keine Score-/Rating-/Entry-Änderung ohne Philips Vorher/Nachher-Freigabe. Build als Draft-PR erlaubt; Merge erst nach Philips Ja auf die Vorher/Nachher-Tabelle im PR-Body.

## Soll
1. Der DCF extrapoliert nicht: Bilanz-Finanzlage steuert WACC und Wachstum regelbasiert und stetig.
2. Bei Finanzlage Moderat oder schlechter liegt die Basis durch die Inputs nicht über dem Kurs, darunter schon. Kein harter Deckel „DCF ≤ Kurs“.
3. Eine Quelle für die Finanzlage für DCF, Segmente und Katalysatoren.

## Ist (main cd26c249)
- Finanzlage Excellent…Critical: `server/analyze-route.ts:1809–1813` → `financialStatements.health`. Kein Input von `buildDefaultDCFParams` (`shared/valuation-signal.ts:322–419`) und kein Bias-Trigger.
- DCF-Härtung nur sprunghaft ab ≥2 Triggern: `shared/bias-fixes.ts:372–407` (Schritte 19–21: +0,625/+1,05/+1,6 Pp WACC; g × 0,85/0,75/0,9). Triggerliste `bias-fixes.ts:302–343`.
- g* existiert: `calculateReverseDCF` `valuation-signal.ts:714–715` (g* = WACC − FCF/EV); genutzt nur als Trigger `reverse_g` (`bias-fixes.ts:298–300`).
- Terminal-Deckel fehlt; TV-Anteil wird nicht ausgewiesen.
- Altman/Piotroski/Interest Coverage: nicht verdrahtet. Keine sektorrelativen Health-Schwellen (FCF-Marge 20/10/0/−10, D/E 1/2 absolut).
- Zweiter, einfacher Server-DCF `analyze-route.ts:1714–1726` (clamp −5…+25 %) — nicht Teil dieses Auftrags, nur dokumentieren.

## Messwerte (Fixtures, keine FMP-Calls)
| Ticker | Lage | g1 | g* | WACC | DCF | Kurs | Abstand | TV-Anteil | terminal |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| MSFT | Excellent | 15 | 9,04 | 10,69 | 385,61 | 535,07 | −27,9 % | 59,6 % | 3,0 |
| SHEL.L | Moderate | 3 | 0,21 | 6,17 | 58,55 | 39,38 | +48,7 % | 68,7 % | 2,0 |

Teilrechnung (nur g1 = min(g1, max(Ist, g*)) bei Moderate + terminal ≤ min(2,5; WACC−3)):
| | DCF vorher | nachher | Abstand | Ziel Basis×(1+GB) vorher | nachher |
|---|---:|---:|---:|---:|---:|
| MSFT | 385,61 | 369,96 | −30,9 % | 453,13 | 434,74 |
| SHEL.L | 58,55 | 50,56 | +28,4 % | 67,54 | 58,32 |
→ g1 allein reicht nicht; SHEL.L braucht den WACC-Term (niedriger WACC trägt den Wert).

## Konfiguration (neu: `shared/dcf-calibration.ts`, eine Stelle für alle Konstanten)
```ts
export const DCF_CALIBRATION = {
  enabled: false,                // Feature-Flag, bleibt false bis Philip-Freigabe
  healthLevel: { Excellent: 0, Good: 1, Moderate: 2, Weak: 3, Critical: 4 }, // Namen gegen analyze-route.ts:1809 prüfen
  waccPerLevelPp: 0.40,          // WACC += 0,40 Pp × Stufe (Moderate +0,8, Critical +1,6)
  g1HaircutPerLevel: 0.08,       // g1 × (1 − 0,08 × Stufe)
  gStarCapFromLevel: 2,          // ab Moderate: g1 ≤ max(Ist-YoY, g*)
  terminalCapPct: 2.5,           // terminal ≤ min(2,5; WACC − 3 Pp)
  terminalWaccGapPp: 3.0,
  tvShareWarnPct: 75,            // Hinweis „DCF extrapolationsgetrieben“
};
```
Formeln (stetig, keine Schwelle „ab 2 Triggern“ für dasselbe Faktum):
```
lage     = healthLevel[financialStatements.health]
wacc     = waccRoh + waccPerLevelPp * lage
gAnker   = revenueGrowth (letztes Ist-YoY), ersatzweise Sektor-g1
g1       = min(g1Modell, gAnker) * (1 - g1HaircutPerLevel * lage)
g1       = min(g1, max(IstYoY, g*))      wenn lage >= gStarCapFromLevel
terminal = min(terminal, terminalCapPct, wacc - terminalWaccGapPp)
```
Regeln:
- Ersetzen, nicht ergänzen: Für Bilanz-Fakten keinen zusätzlichen Sprung aus `applyBiasAdjustment`; Schaden/Moat/Pricing-Power bleiben dort, werden aber nicht doppelt auf g1 multipliziert.
- Moat-Nachlauf ±1,5 im llmMode (`bias-fixes.ts:499–505`) getrennt ausweisen, moatFaktor = 1 bis separate Freigabe.
- Kein Zielwert-Fitting: Konstanten werden nicht so gewählt, dass der DCF den Kurs trifft.

## Datenfluss
Analyze-Handler (`server/analyze-route.ts`) schreibt `financialStatements.health` einmal → Cache `analyze:${ticker}:llm:0|1` (`analyze-route.ts:2456–2465`) → `buildDefaultDCFParams` / `calculateFCFFDCF` / `applyBiasAdjustment` lesen `health` aus demselben Objekt → Sektion 5/6/17, Fazit, PDF. `GET /api/financial-history` zeigt nur die Reihe, setzt keine Note. Schema: `health` + neue Ausweisfelder (`calibration: { lage, waccAddPp, g1Before, g1After, terminalBefore, terminalAfter, tvSharePct }`) in `shared/schema.ts` optional, damit alte Cache-Einträge nicht brechen. Gecachte Analysen beim Anzeigen neu rechnen (Inverter-Hinweis), nicht den gespeicherten Zielwert lesen.

## UI
Sektion 5/6 (DCF): Zeile „Bilanz-Kalibrierung: Stufe X, WACC +Y Pp, g1 a → b, terminal c → d“, Hinweis bei TV-Anteil > 75 %.

## Tests (Pflicht)
- MSFT- und SHEL.L-Fixtures: Vorher/Nachher DCF, decisionPerShare, Entry, CRV, Score, Ziel (UI+PDF) als Tabelle im PR-Body.
- Pins MSFT 4.058137820476081 und Buffett 5.638130012567666 bei `enabled: false` unverändert.
- Stetigkeit: Stufe 0…4 monoton fallender DCF, keine Sprünge.
- Gegenprobe: synthetischer Titel Excellent/Good mit DCF > Kurs bleibt > Kurs.
- Terminal-Deckel und TV-Warnung (synthetisch 74,9/75,1 %).
- Gecachter Lauf ohne `calibration`-Feld rendert ohne Fehler.

## Offen / blockiert
- NVO: kein Analyseobjekt (FCF, Aktienzahl, WACC) → braucht `FMP_API_KEY` als Cursor-Secret, Philip-Freigabe.
- Konsens-Umsatz 2–3 J., Median 3–5 J., Guidance-Mitte: nicht gespeichert (`fmpAnalystEstimates` holt Daten, Payload behält nur EPS, `analyze-route.ts:925–935`) → Folgeschritt.
- Sektorrelative Health-Schwellen (Versorger/Telekom): Folgeschritt.
- Separat: Teil A Katalysator-Ziel = Kurs × (1+GB) (UI + PDF, DCF als Referenzzeile, Hinweise) — eigener Auftrag, gleiche Freigabegrenze.

## Nachtrag 23:07 (Raum: Inverter, Professor, Analyst) — vor Build einarbeiten
1. g* auf geglätteten Kurs (3-Monats-Durchschnitt) rechnen, nicht Tageskurs. Ausweis: DCF-Reaktion auf ±20 % Kurs mit und ohne Glättung (Ziel: klar < 20 %).
2. Stufenmodell offen für Philip: stetig (0,40 Pp/Stufe, 5 Stufen aus health) vs. 3 Stufen +0/+1/+2 Pp aus Signalen (Net Debt/EBITDA > Sektor-Median+1×, Zinsdeckung < 4×, FCF-Trend 2 J. negativ, CapEx-Sprung > 30 % bei fallendem FCF; sektorrelativ). Beide im PR-Body vorher/nachher zeigen.
3. g1-Anker: min(Konsens 2–3 J., Median 3–5 J.) + 5 Pp; fallback letztes Ist; Guidance-Mitte begrenzt Jahr 1. Wo Daten fehlen: markieren, nicht schätzen ohne Kennzeichnung.
4. Pro Regel im Code und PR-Body: ersetzt oder ergänzt `bias-fixes.ts:372–407`; Summe WACC-Aufschlag + g-Abschlag je Ticker sichtbar.
5. Moat-Nachlauf ±1,5 (`bias-fixes.ts:499–505`) zuerst separat beheben/ausweisen, dann kalibrieren.
6. Gegenproben VOR Anwendung der Regel festlegen und begründen: (a) unauffällige Bilanz, DCF heute > 20 % über Kurs, Konsens stützt → muss über Kurs bleiben, sonst Regel zu scharf (Abbruch, Schwellen anpassen); (b) moderate Bilanz → DCF sinkt höchstens auf Kursniveau, nicht weit darunter.
7. Cache-Schlüssel der Ampel: Ticker + Datum des Abschlusses.
8. Jede Zahl mit Quelle (Fixture/FMP/rekonstruiert/geschätzt).

## Scope-Klärung 23:08 (auf Stabschef-Rückfrage) — verbindlich für Draft 1
- **Punkt (3) g1-Anker:** Draft 1 nutzt nur das letzte Ist-YoY (`financialStatements.incomeStatement.revenueGrowth`), ersatzweise Sektor-g1, plus Deckel. Konsens 2–3 J. und Median 3–5 J. kommen in einem **eigenen Folgeschritt** (Persistenz von `fmpAnalystEstimates`-Umsatz und Jahresreihe im Analyze-Payload). Diese Persistenz ist **nicht** Teil dieses PRs. Die Schnittstelle bleibt so offen, dass `gAnker` später ohne Umbau ersetzt werden kann (eine Funktion `resolveGrowthAnchor()` in `shared/dcf-calibration.ts`).
- **Punkt (2) Stufen:** Draft 1 nutzt die vorhandene absolute Note `financialStatements.health` (`analyze-route.ts:1809–1813`). Sektorrelative Schwellen und die Einzelsignale (Net Debt/EBITDA, Zinsdeckung, FCF-Trend, CapEx-Sprung) sind ebenfalls ein **Folgeschritt**, weil die Zinsdeckung u. a. nicht verdrahtet ist. Im PR-Body werden beide Stufenmodelle (stetig 0,40 Pp/Stufe und 3 Stufen +0/+1/+2 Pp) auf der absoluten Note gezeigt, Philip wählt.
- **Punkt (1) g* geglättet:** Nur dann in Draft 1, wenn ein 3-Monats-Kursverlauf auf dem Analyze-Payload schon vorliegt (MAIN-CODE-VORPRÜFUNG). Sonst Tageskurs, als Abweichung markiert, und Glättung als Folgeschritt.
- **Soll 2 umformuliert:** „Bei Moderat oder schlechter liegt die Basis nicht über dem Kurs“ ist eine **erwartete Wirkung bzw. Beobachtung**, kein Abnahmekriterium, und kein Ziel für das Fitten der Konstanten. Abnahmekriterien sind die Tests sowie die Gegenprobe (a), nämlich ein Ticker mit unauffälliger Bilanz und DCF über dem Kurs, der über dem Kurs bleiben muss.
